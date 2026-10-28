import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { firebaseAuth, firebaseConfigured } from "./firebase.js";
import {
  createId,
  confirmClientRenewal,
  createService,
  createTeamMemberAccount,
  deleteTransaction,
  deleteService,
  deleteTeamMemberAccount,
  formatCurrency,
  formatShortDate,
  getDateInDays,
  getClientRenewalStatus,
  getMonthKey,
  getMonthlyIncome,
  getReceivableTotal,
  getRevenueTotal,
  getUpcomingRenewals,
  isRenewalDue,
  loadData,
  removeClientRevenue,
  syncClientRevenue,
  syncClientRenewalStatuses,
  subscribeData,
  updateData,
  updateProfilePhoto,
  updateService,
} from "./data.js";
import { getUserProfile, validateProfilePhotoUrl } from "./profile.js";

const loginPath = `${import.meta.env.BASE_URL}login.html`;
const themeStorageKey = "nexo-theme";

const pages = {
  overview: "Visão geral",
  clients: "Clientes",
  finance: "Financeiro",
  services: "Serviços",
  team: "Equipe",
};

function getSavedTheme() {
  return window.localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
}

function Status({ value }) {
  const normalized = String(value || "").toLocaleUpperCase("pt-BR");
  const tone = normalized === "ATIVO" || normalized === "RECEBIDO" || normalized === "PAGO" ? "" :
    normalized.startsWith("PRAZO ") || normalized === "PENDENTE" || normalized === "EM IMPLANTAÇÃO" ? "pending" :
      normalized === "EXPIRADO" || normalized === "ATRASADO" ? "overdue" : "inactive";
  return <span className={`status ${tone}`}>{value}</span>;
}

function PersonCell({ person, subtitle, tone = "avatar-blue" }) {
  const initials = person.initials || person.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="table-person">
      <span className={`avatar${person.photoUrl ? " profile-avatar" : ""} ${tone}`}>
        {initials}
        {person.photoUrl && <img src={person.photoUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
      </span>
      <span><strong>{person.name}</strong><small>{subtitle}</small></span>
    </div>
  );
}

function Metric({ title, value, icon, note, tone = "" }) {
  return (
    <article className="metric-card">
      <div className="metric-top"><span>{title}</span><span className={`metric-icon ${tone}`}>{icon}</span></div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </article>
  );
}

function PageHeading({ title, description, action }) {
  return (
    <div className="page-heading">
      <div><span className="eyebrow">NEXO / GESTÃO</span><h1>{title}</h1><p>{description}</p></div>
      {action}
    </div>
  );
}

function ActivityList({ activity, limit = 4 }) {
  if (!activity.length) return <div className="empty-state">Ainda não há atividades registradas.</div>;
  return (
    <div className="activity-list">
      {activity.slice(0, limit).map((entry, index) => (
        <div className="activity-item" key={`${entry.time}-${index}`}>
          <span className={`activity-dot ${entry.tone || ""}`} />
          <div className="activity-text"><p>{entry.text}</p><small>{entry.time}</small></div>
        </div>
      ))}
    </div>
  );
}

function ClientRows({ clients, onEdit, onDelete, onConfirmRenewal }) {
  if (!clients.length) return <tr><td colSpan="8" className="empty-state">Nenhum cliente encontrado.</td></tr>;
  return clients.map((client) => (
    <tr key={client.id}>
      <td><PersonCell person={client} subtitle={client.company} /></td>
      <td>{client.discord || "—"}</td>
      <td>{client.plan}</td>
      <td>{formatCurrency(client.monthly)}</td>
      <td>{formatCurrency(client.entryAmount)}</td>
      <td>{formatShortDate(client.renewal)}</td>
      <td><Status value={client.status} /></td>
      <td><div className="row-actions">
        {Number(client.monthly) > 0 && isRenewalDue(client) && (
          <button className="row-action renewal-confirm" type="button" onClick={() => onConfirmRenewal(client)} aria-label={`Confirmar renovação de ${client.name}`} title="Confirmar renovação">✓</button>
        )}
        <button className="row-action" type="button" onClick={() => onEdit(client)} aria-label={`Editar ${client.name}`} title="Editar cliente">✎</button>
        <button className="row-action" type="button" onClick={() => onDelete(client)} aria-label={`Excluir ${client.name}`} title="Excluir cliente">×</button>
      </div></td>
    </tr>
  ));
}

function DataTable({ children, columns }) {
  return (
    <div className="table-wrap">
      <table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{children}</tbody></table>
    </div>
  );
}

function Field({ label, name, type = "text", choices, full = false, placeholder, defaultValue, onChange, min, minLength, step, required = true, disabled = false }) {
  return (
    <div className={`form-field${full ? " full" : ""}`}>
      <label htmlFor={`field-${name}`}>{label}</label>
      {choices
        ? <select id={`field-${name}`} name={name} required={required} disabled={disabled} defaultValue={defaultValue ?? (typeof choices[0] === "string" ? choices[0] : choices[0]?.value)} onChange={onChange}>{choices.map((choice) => typeof choice === "string" ? <option key={choice} value={choice}>{choice}</option> : <option key={choice.value} value={choice.value} disabled={choice.disabled}>{choice.label}</option>)}</select>
        : <input id={`field-${name}`} name={name} type={type} required={required} disabled={disabled} min={min} minLength={minLength} step={step} defaultValue={defaultValue} placeholder={placeholder} />}
    </div>
  );
}

function EntryDialog({ type, services = [], client, onClose, onSave }) {
  const dialogRef = useRef(null);
  const [transactionType, setTransactionType] = useState("Receita");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const matchedClientService = services.find((service) => service.id === client?.serviceId || service.name === client?.plan);
  const clientServiceChoices = [
    { value: "", label: services.length ? "Selecione um serviço" : "Nenhum serviço cadastrado", disabled: true },
    ...services.map((service) => ({ value: service.id, label: service.name })),
    ...(client?.plan && !matchedClientService ? [{ value: "__existing__", label: client.plan }] : []),
  ];
  const clientStatusChoices = client
    ? [client.status || "ATIVO", ...(String(client.status || "").toLocaleUpperCase("pt-BR") === "CANCELADO" ? [] : ["CANCELADO"])]
    : ["ATIVO"];

  function applyServicePrices(event) {
    const service = services.find((item) => item.id === event.currentTarget.value);
    const form = event.currentTarget.form;
    if (service) {
      form.elements.namedItem("monthly").value = Number(service.monthly || 0);
      form.elements.namedItem("entryAmount").value = Number(service.entryAmount || 0);
    } else if (event.currentTarget.value === "__existing__" && client) {
      form.elements.namedItem("monthly").value = Number(client.monthly || 0);
      form.elements.namedItem("entryAmount").value = Number(client.entryAmount || 0);
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.showModal();
    dialog.querySelector("input,select")?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const config = {
    client: {
      title: client ? "Editar cliente" : "Novo cliente",
      fields: <>
        <Field label="Nome do cliente" name="name" full placeholder="Ex.: Mariana Costa" defaultValue={client?.name} />
        <Field label="URL da imagem" name="photoUrl" type="url" full placeholder="https://exemplo.com/imagem.jpg" defaultValue={client?.photoUrl} required={false} />
        <Field label="Empresa" name="company" placeholder="Nome do negócio" defaultValue={client?.company} />
        <Field label="E-mail" name="email" type="email" placeholder="cliente@email.com" defaultValue={client?.email} required={false} />
        <Field label="WhatsApp" name="whatsapp" type="tel" placeholder="Ex.: +55 11 99999-9999" defaultValue={client?.whatsapp} required={false} />
        <Field label="Discord (usuário)" name="discord" placeholder="Ex.: usuario" defaultValue={client?.discord} required={false} />
        <Field label="Serviço / contrato" name="serviceId" choices={clientServiceChoices} full defaultValue={matchedClientService?.id || (client?.plan ? "__existing__" : "")} onChange={applyServicePrices} />
        <Field label="Mensalidade (R$)" name="monthly" type="number" min="0" step="0.01" defaultValue={client?.monthly} />
        <Field label="Valor fixo / de entrada (R$)" name="entryAmount" type="number" min="0" step="0.01" defaultValue={client?.entryAmount ?? 0} required={false} />
        <Field label="Próxima renovação" name="renewal" type="date" defaultValue={client?.renewal ?? getDateInDays(30)} disabled={client?.status === "EXPIRADO"} />
        <Field label="Status" name="status" choices={clientStatusChoices} defaultValue={client?.status ?? "ATIVO"} />
      </>,
    },
    transaction: {
      title: "Novo lançamento",
      fields: <>
        <Field label="Descrição" name="description" full placeholder="Ex.: Mensalidade do cliente" />
        <Field label="Tipo" name="type" choices={["Receita", "Despesa"]} onChange={(event) => setTransactionType(event.target.value)} />
        <Field label="Categoria" name="category" choices={["Mensalidade", "Projeto", "Serviço", "Infraestrutura", "Ferramentas", "Outros"]} />
        <Field label="Valor (R$)" name="amount" type="number" min="0" step="0.01" />
        <Field label="Data" name="date" type="date" defaultValue={getDateInDays(0)} />
        <Field label="Status" name="status" choices={transactionType === "Despesa" ? ["Pago", "Pendente"] : ["Recebido", "Pendente"]} />
      </>,
    },
    service: {
      title: "Novo serviço",
      fields: <>
        <Field label="Nome do serviço" name="name" full placeholder="Ex.: Site institucional" />
        <Field label="Tipo" name="type" choices={["Site", "Bot"]} />
        <Field label="Mensalidade (R$)" name="monthly" type="number" min="0" step="0.01" />
        <Field label="Valor fixo / de entrada (R$)" name="entryAmount" type="number" min="0" step="0.01" required={false} />
        <Field label="Status" name="status" choices={["Ativo", "Em implantação", "Inativo"]} />
      </>,
    },
    member: {
      title: "Criar usuário da equipe",
      fields: <>
        <Field label="Nome" name="name" full placeholder="Nome completo" />
        <Field label="Usuário de acesso" name="username" placeholder="Ex.: maria.silva" />
        <Field label="Senha inicial" name="password" type="password" minLength="6" placeholder="Mínimo de 6 caracteres" />
        <Field label="E-mail de contato (opcional)" name="email" type="email" full placeholder="pessoa@empresa.com" required={false} />
        <Field label="Nível de acesso" name="role" choices={["Administrador", "Financeiro", "Operações", "Leitura"]} />
      </>,
    },
  }[type];

  if (!config) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setSubmitError("");
    try {
      await onSave(type, Object.fromEntries(new FormData(event.currentTarget).entries()), client);
    } catch (error) {
      setSubmitError(error.message || "Não foi possível criar o usuário.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog className="app-dialog" ref={dialogRef} aria-labelledby="dialog-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="dialog-card" onSubmit={handleSubmit}>
        <div className="dialog-heading">
          <div><span className="eyebrow">NEXO GESTÃO</span><h2 id="dialog-title">{config.title}</h2></div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <div className="dialog-fields">{config.fields}</div>
        {type === "member" && <p className="security-note">O usuário entrará pelo nome de usuário e senha. A senha não será salva nos dados da equipe.</p>}
        {type === "client" && !services.length && <p className="security-note">Cadastre um serviço na aba Serviços antes de adicionar um cliente.</p>}
        {submitError && <p className="form-error" role="alert">{submitError}</p>}
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="button button-primary" type="submit" disabled={saving}>{saving ? "Criando..." : type === "member" ? "Criar usuário" : "Salvar"}</button>
        </div>
      </form>
    </dialog>
  );
}

function ProfilePhotoDialog({ photoUrl, onClose, onSave }) {
  const dialogRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.showModal();
    dialog.querySelector("input")?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const values = new FormData(event.currentTarget);
      const url = validateProfilePhotoUrl(String(values.get("photoUrl") || ""));
      await onSave(url);
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar a foto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog className="app-dialog" ref={dialogRef} aria-labelledby="profile-dialog-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="dialog-card" onSubmit={handleSubmit}>
        <div className="dialog-heading">
          <div><span className="eyebrow">MEU PERFIL</span><h2 id="profile-dialog-title">Foto de perfil</h2></div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <div className="dialog-fields">
          <Field label="URL da imagem" name="photoUrl" type="url" full placeholder="https://exemplo.com/minha-foto.jpg" defaultValue={photoUrl} required={false} />
        </div>
        <p className="security-note">Use um link público direto para a imagem. Deixe vazio para remover a foto.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="button button-primary" type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar foto"}</button>
        </div>
      </form>
    </dialog>
  );
}

function ProfileAvatar({ profile, className = "" }) {
  return (
    <span className={`avatar avatar-purple${className ? ` ${className}` : ""} profile-avatar`}>
      {profile.initials}
      {profile.photoUrl && <img src={profile.photoUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
    </span>
  );
}

function Overview({ data, userName, onNavigate, onNewClient, onDeleteClient }) {
  const monthIncome = getMonthlyIncome(data.transactions, getMonthKey());
  const pending = getReceivableTotal(data.transactions);
  const activeServices = data.services.filter((service) => service.status === "Ativo").length;
  const dueSoon = getUpcomingRenewals(data.clients);
  const today = new Date();
  const dateLabel = today.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).toLocaleUpperCase("pt-BR");
  const greeting = today.getHours() < 12 ? "Bom dia" : today.getHours() < 18 ? "Boa tarde" : "Boa noite";
  const monthValues = Array.from({ length: 6 }, (_, index) => getMonthKey(index - 5)).map((month) => data.transactions
    .filter((entry) => entry.type === "income" && ["Recebido", "Pago"].includes(entry.status) && entry.date?.startsWith(month))
    .reduce((total, entry) => total + Number(entry.amount), 0));
  const maxMonthValue = Math.max(...monthValues, 1);
  const confirmedMonthIncome = monthValues[monthValues.length - 1];
  const monthLabels = Array.from({ length: 6 }, (_, index) => getMonthKey(index - 5));

  return (
    <>
      <section className="welcome-panel">
        <div className="welcome-copy"><span>{dateLabel}</span><h1>{greeting}{userName ? `, ${userName}` : ""} 👋</h1><p>Acompanhe a saúde da sua operação em um só lugar.</p></div>
        <button className="button" type="button" onClick={onNewClient}><span className="button-symbol">+</span> Novo cliente</button>
      </section>
      <section className="metric-grid">
        <Metric title="Clientes ativos" value={data.clients.filter((client) => client.status === "ATIVO").length} icon="◎" note={`${data.clients.length} cadastrados`} />
        <Metric title="Receita do mês" value={formatCurrency(monthIncome)} icon="R$" note="Mensalidades ativas e receitas recebidas" tone="green" />
        <Metric title="Serviços ativos" value={activeServices} icon="⌘" note={`${data.services.length} serviços cadastrados`} tone="orange" />
        <Metric title="A receber" value={formatCurrency(pending)} icon="↗" note="Lançamentos pendentes" tone="pink" />
      </section>
      <section className="overview-grid">
        <article className="panel">
          <div className="panel-heading"><div><h2>Receita ao longo do tempo</h2><p>Entradas confirmadas nos últimos 6 meses</p></div><span className="role-pill">Mensal</span></div>
          <div className="chart-summary"><strong>{formatCurrency(confirmedMonthIncome)}</strong><span className="positive">recebido este mês</span></div>
          <div className="chart">{monthValues.map((value, index) => {
            const date = new Date(`${monthLabels[index]}-01T12:00:00`);
            const label = new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "");
            return <div className="chart-column" key={monthLabels[index]}><div className={`chart-bar ${index === monthValues.length - 1 ? "is-current" : ""}`} style={{ height: `${Math.max(value / maxMonthValue * 100, 3)}%` }} /><span>{label}</span></div>;
          })}</div>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><h2>Atividade recente</h2><p>Últimas atualizações da operação</p></div></div>
          <ActivityList activity={data.activity} />
        </article>
      </section>
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Clientes recentes</h2><p>Visão rápida dos contratos da operação</p></div><button className="text-link" type="button" onClick={() => onNavigate("clients")}>Ver todos <span aria-hidden="true">→</span></button></div>
        <DataTable columns={["CLIENTE", "SERVIÇO", "MENSALIDADE", "RENOVAÇÃO", "STATUS", ""]}>
          {data.clients.slice(-4).reverse().map((client) => <tr key={client.id}><td><PersonCell person={client} subtitle={client.company} /></td><td>{client.plan}</td><td>{formatCurrency(client.monthly)}</td><td>{formatShortDate(client.renewal)}</td><td><Status value={client.status} /></td><td><button className="row-action" type="button" onClick={() => onDeleteClient(client)} aria-label={`Excluir ${client.name}`}>×</button></td></tr>)}
          {!data.clients.length && <tr><td colSpan="6" className="empty-state">Cadastre seu primeiro cliente para começar.</td></tr>}
        </DataTable>
      </section>
      <section className="panel table-panel" style={{ marginTop: 16 }}>
        <div className="panel-heading"><div><h2>Renovações próximas</h2><p>Clientes com vencimento nos próximos 10 dias</p></div></div>
        <DataTable columns={["CLIENTE", "SERVIÇO", "RENOVAÇÃO", "VALOR", "STATUS"]}>
          {dueSoon.map((client) => <tr key={client.id}><td><PersonCell person={client} subtitle={client.company} /></td><td>{client.plan}</td><td>{formatShortDate(client.renewal)}</td><td>{formatCurrency(client.monthly)}</td><td><Status value={client.status} /></td></tr>)}
          {!dueSoon.length && <tr><td colSpan="5" className="empty-state">Nenhuma renovação nos próximos dias.</td></tr>}
        </DataTable>
      </section>
    </>
  );
}

function ClientsPage({ data, search, onNew, onEdit, onDelete, onConfirmRenewal }) {
  const clients = data.clients.filter((client) => [client.name, client.company, client.email, client.whatsapp, client.discord, client.plan, client.status].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(search)));
  const activeMonthly = data.clients
    .filter((client) => client.status === "ATIVO" || String(client.status).startsWith("PRAZO "))
    .reduce((total, client) => total + Number(client.monthly), 0);
  return (
    <>
      <PageHeading title="Clientes" description="Gerencie seus clientes, contratos e renovações." action={<button className="button button-primary" type="button" onClick={onNew}><span className="button-symbol">+</span> Novo cliente</button>} />
      <section className="metric-grid">
        <Metric title="Total de clientes" value={data.clients.length} icon="◎" note="Contas cadastradas" />
        <Metric title="Clientes ativos" value={data.clients.filter((client) => client.status === "ATIVO").length} icon="✓" note="Com serviços em andamento" tone="green" />
        <Metric title="Receita recorrente" value={formatCurrency(activeMonthly)} icon="R$" note="Mensalidades ativas" tone="orange" />
        <Metric title="Expirados" value={data.clients.filter((client) => client.status === "EXPIRADO").length} icon="…" note="Renovação não confirmada" tone="pink" />
      </section>
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Todos os clientes</h2><p>{clients.length} de {data.clients.length} registros</p></div></div>
        <DataTable columns={["CLIENTE", "DISCORD", "SERVIÇO / CONTRATO", "MENSALIDADE", "ENTRADA", "RENOVAÇÃO", "STATUS", "AÇÕES"]}><ClientRows clients={clients} onEdit={onEdit} onDelete={onDelete} onConfirmRenewal={onConfirmRenewal} /></DataTable>
      </section>
    </>
  );
}

function FinancePage({ data, search, onNew, onDelete }) {
  const transactions = data.transactions.filter((entry) => [entry.description, entry.category, entry.type, entry.status].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(search))).sort((a, b) => b.date.localeCompare(a.date));
  const income = getRevenueTotal(data.transactions);
  const expense = data.transactions.filter((item) => item.type === "expense").reduce((total, item) => total + Number(item.amount), 0);
  const pending = getReceivableTotal(data.transactions);
  return (
    <>
      <PageHeading title="Financeiro" description="Acompanhe receitas, despesas e valores a receber." action={<button className="button button-primary" type="button" onClick={onNew}><span className="button-symbol">+</span> Novo lançamento</button>} />
      <section className="finance-summary">
        <article className="finance-card income"><span>Receitas registradas</span><strong>{formatCurrency(income)}</strong></article>
        <article className="finance-card expense"><span>Despesas registradas</span><strong>{formatCurrency(expense)}</strong></article>
        <article className="finance-card"><span>Saldo da operação</span><strong>{formatCurrency(income - expense)}</strong></article>
      </section>
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Lançamentos</h2><p>{formatCurrency(pending)} aguardando recebimento</p></div></div>
        <DataTable columns={["DESCRIÇÃO", "CATEGORIA", "DATA", "TIPO", "VALOR", "STATUS", "AÇÕES"]}>
          {transactions.map((entry) => <tr key={entry.id}>
            <td><strong className="table-strong">{entry.description}</strong></td><td>{entry.category}</td><td>{formatShortDate(entry.date)}</td>
            <td><span className={entry.type === "income" ? "positive" : ""}>{entry.type === "income" ? "Receita" : "Despesa"}</span></td>
            <td className={entry.type === "income" ? "amount-income" : "amount-expense"}>{entry.type === "income" ? "+" : "−"} {formatCurrency(entry.amount)}</td>
            <td><Status value={entry.status} /></td><td><button className="row-action" type="button" onClick={() => onDelete(entry)} aria-label={`Excluir lançamento ${entry.description}`} title="Excluir lançamento">×</button></td>
          </tr>)}
          {!transactions.length && <tr><td colSpan="7" className="empty-state">{data.transactions.length ? "Nenhum lançamento encontrado." : "Adicione seu primeiro lançamento."}</td></tr>}
        </DataTable>
      </section>
    </>
  );
}

function ServicesPage({ data, search, onNew, onDelete, onToggle }) {
  const services = data.services.filter((service) => [service.name, service.type, service.status].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(search)));
  const sites = data.services.filter((service) => service.type === "Site");
  const bots = data.services.filter((service) => service.type === "Bot");
  return (
    <>
      <PageHeading title="Serviços" description="Acompanhe os serviços e projetos da sua operação." action={<button className="button button-primary" type="button" onClick={onNew}><span className="button-symbol">+</span> Novo serviço</button>} />
      <section className="service-grid">
        <article className="service-card"><div className="service-card-top"><div className="service-card-title"><span className="metric-icon">⌘</span><span><strong>Sites e aplicações</strong><small>Catálogo de serviços da empresa</small></span></div><span className="role-pill">{sites.length} serviços</span></div><p>Cadastre os serviços disponíveis para vincular aos clientes e seus valores.</p><div className="service-card-stats"><span><strong>{sites.filter((item) => item.status === "Ativo").length}</strong>Ativos</span><span><strong>{sites.filter((item) => item.status !== "Ativo").length}</strong>Em implantação</span></div></article>
        <article className="service-card"><div className="service-card-top"><div className="service-card-title"><span className="metric-icon orange">✳</span><span><strong>Bots e automações</strong><small>Catálogo de serviços da empresa</small></span></div><span className="role-pill">{bots.length} serviços</span></div><p>Cadastre bots e automações e selecione-os depois no cadastro do cliente.</p><div className="service-card-stats"><span><strong>{bots.filter((item) => item.status === "Ativo").length}</strong>Ativos</span><span><strong>{bots.filter((item) => item.status !== "Ativo").length}</strong>Em implantação</span></div></article>
      </section>
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Serviços cadastrados</h2><p>{services.length} de {data.services.length} registros</p></div></div>
        <DataTable columns={["SERVIÇO", "TIPO", "MENSALIDADE", "VALOR FIXO", "STATUS", "AÇÕES"]}>
          {services.map((service) => <tr key={service.id}>
            <td><strong className="table-strong">{service.name}</strong></td><td>{service.type}</td><td>{formatCurrency(service.monthly)}</td><td>{formatCurrency(service.entryAmount)}</td>
            <td><button className="status-button" type="button" onClick={() => onToggle(service)} aria-label={`Alterar status de ${service.name}`}><Status value={service.status} /></button></td>
            <td><button className="row-action" type="button" onClick={() => onDelete(service)} aria-label={`Excluir ${service.name}`}>×</button></td>
          </tr>)}
          {!services.length && <tr><td colSpan="6" className="empty-state">{data.services.length ? "Nenhum serviço encontrado." : "Cadastre seu primeiro serviço."}</td></tr>}
        </DataTable>
      </section>
    </>
  );
}

function TeamPage({ data, search, onNew, onDelete }) {
  const members = data.team.filter((person) => [person.name, person.username, person.email, person.role, person.status].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(search)));
  return (
    <>
      <PageHeading title="Equipe" description="Organize as pessoas e os níveis de acesso da sua operação." action={<button className="button button-primary" type="button" onClick={onNew}><span className="button-symbol">+</span> Adicionar pessoa</button>} />
      <section className="metric-grid">
        <Metric title="Pessoas na equipe" value={data.team.length} icon="♙" note="Membros cadastrados" />
        <Metric title="Administradores" value={data.team.filter((person) => person.role === "Administrador").length} icon="◇" note="Acesso completo" tone="orange" />
        <Metric title="Acessos ativos" value={data.team.filter((person) => person.status === "Ativo").length} icon="✓" note="Contas habilitadas" tone="green" />
        <Metric title="Níveis de acesso" value={new Set(data.team.map((person) => person.role)).size} icon="⌘" note="Papéis configurados" tone="pink" />
      </section>
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Membros da equipe</h2><p>Os acessos são organizados por função</p></div></div>
        <DataTable columns={["PESSOA", "USUÁRIO", "E-MAIL DE CONTATO", "NÍVEL DE ACESSO", "STATUS", "AÇÕES"]}>
          {members.map((person) => <tr key={person.id}><td><PersonCell person={person} subtitle={person.role} tone={person.tone} /></td><td>{person.username ? `@${person.username}` : "—"}</td><td>{person.email || "—"}</td><td><span className="role-pill">{person.role}</span></td><td><Status value={person.status} /></td><td><button className="row-action" type="button" onClick={() => onDelete(person)} aria-label={`Remover ${person.name}`}>×</button></td></tr>)}
          {!members.length && <tr><td colSpan="6" className="empty-state">{data.team.length ? "Nenhuma pessoa encontrada." : "Adicione o primeiro membro da equipe."}</td></tr>}
        </DataTable>
      </section>
      <p className="security-note">Administradores podem criar usuários. As outras funções ainda não restringem o acesso às telas do app.</p>
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [membership, setMembership] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [currentPage, setCurrentPage] = useState("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [theme, setTheme] = useState(getSavedTheme);
  const [dialogType, setDialogType] = useState("");
  const [editingClient, setEditingClient] = useState(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [storageError, setStorageError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const dataRef = useRef(null);
  const writeQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#101522" : "#f5f7fb");
  }, [theme]);

  useEffect(() => {
    if (!firebaseConfigured || !firebaseAuth) {
      window.location.replace(loginPath);
      return undefined;
    }
    let active = true;
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (authenticatedUser) => {
      if (!authenticatedUser) {
        window.location.replace(loginPath);
        return;
      }
      setUser(authenticatedUser);
      setMembership(null);
      setAuthReady(false);
      setData(null);
      dataRef.current = null;
      try {
        await loadData(authenticatedUser.uid);
        const { data: currentData } = await updateData(authenticatedUser.uid, syncClientRenewalStatuses);
        if (active) {
          dataRef.current = currentData;
          setData(currentData);
          setStorageError("");
        }
      } catch (error) {
        console.error("Não foi possível carregar os dados do Firebase.", error);
        if (active) setStorageError(error.message);
      } finally {
        if (active) setAuthReady(true);
      }
    }, (error) => {
      console.error("Não foi possível validar a sessão do Firebase.", error);
      window.location.replace(loginPath);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user || !data) return undefined;

    function checkDueRenewals() {
      commit((current) => syncClientRenewalStatuses(current));
    }

    const interval = window.setInterval(checkDueRenewals, 60_000);
    window.addEventListener("focus", checkDueRenewals);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", checkDueRenewals);
    };
  }, [user, data]);

  useEffect(() => {
    if (!user || !data) return undefined;
    let active = true;
    let unsubscribe = () => {};

    subscribeData(user.uid, (sharedData) => {
      if (!active) return;
      dataRef.current = sharedData;
      setData(sharedData);
      setStorageError("");
    }, (error) => {
      console.error("Não foi possível sincronizar os dados compartilhados da empresa.", error);
      if (error.code === "membership/not-found") {
        signOut(firebaseAuth)
          .then(() => window.location.replace(loginPath))
          .catch((signOutError) => {
            console.error("Não foi possível encerrar a sessão sem vínculo de empresa.", signOutError);
            if (active) setStorageError("O vínculo com a empresa foi removido. Encerre a sessão e entre novamente.");
          });
        return;
      }
      if (active) setToast("A sincronização com o Firebase falhou. Verifique as regras e sua conexão.");
    }, (accountMembership) => {
      if (active) setMembership(accountMembership);
    }).then((stop) => {
      unsubscribe = stop;
      if (!active) unsubscribe();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [user, Boolean(data)]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector("#global-search")?.focus();
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  const search = searchTerm.trim().toLocaleLowerCase("pt-BR");

  function submitSearch(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setCurrentPage("clients");
    setMenuOpen(false);
  }

  function commit(update, message) {
    const operation = writeQueueRef.current.then(async () => {
      if (!dataRef.current) throw new Error("Os dados ainda não foram carregados.");
      const { data: next, changed } = await updateData(user.uid, update);
      if (!changed) return;
      dataRef.current = next;
      setData(next);
      if (message) setToast(message);
    });
    writeQueueRef.current = operation.catch((error) => {
      console.error("Não foi possível salvar os dados no Firebase.", error);
      setToast("Não foi possível salvar no Firebase. Verifique sua conexão e as regras do Firestore.");
    });
  }

  function addActivity(current, text, tone = "green") {
    return {
      ...current,
      activity: [{
        text,
        time: `Hoje, ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
        tone,
      }, ...current.activity].slice(0, 8),
    };
  }

  async function handleSave(type, values, clientToUpdate = null) {
    const normalizedName = values.name?.trim();
    if (type === "member") {
      const member = {
        id: createId("u"),
        name: normalizedName,
        username: values.username.trim().toLocaleLowerCase("en-US"),
        email: values.email.trim(),
        role: values.role,
        initials: normalizedName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
        tone: "avatar-blue",
        status: "Ativo",
      };
      await writeQueueRef.current;
      const result = await createTeamMemberAccount(
        user.uid,
        member.username,
        values.password,
        member,
        (current, savedMember) => addActivity(
          { ...current, team: [...current.team, savedMember] },
          `${normalizedName} foi adicionado à equipe`,
        ),
      );
      dataRef.current = result.data;
      setData(result.data);
      setToast(`Usuário @${result.username} criado e vinculado à empresa.`);
      setDialogType("");
      return;
    }
    if (type === "service") {
      const service = {
        id: createId("s"),
        name: normalizedName,
        type: values.type,
        monthly: Number(values.monthly),
        entryAmount: Number(values.entryAmount || 0),
        status: values.status,
      };
      await createService(user.uid, service);
      commit((current) => addActivity(current, `Serviço ${normalizedName} adicionado`), "Serviço cadastrado com sucesso.");
      setDialogType("");
      return;
    }

    commit((current) => {
      if (type === "client") {
        const selectedService = dataRef.current?.services.find((service) => service.id === values.serviceId);
        const savedClient = {
          ...clientToUpdate,
          ...values,
          serviceId: selectedService?.id || clientToUpdate?.serviceId || "",
          plan: selectedService?.name || clientToUpdate?.plan || "",
          id: clientToUpdate?.id || createId("c"),
          name: normalizedName,
          status: getClientRenewalStatus({ ...values, status: values.status }),
          photoUrl: validateProfilePhotoUrl(values.photoUrl || ""),
          email: values.email.trim(),
          whatsapp: values.whatsapp.trim(),
          discord: values.discord.trim(),
          monthly: Number(values.monthly),
          entryAmount: Number(values.entryAmount || 0),
          initials: normalizedName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
        };
        const clients = clientToUpdate
          ? current.clients.map((entry) => entry.id === clientToUpdate.id ? savedClient : entry)
          : [...current.clients, savedClient];
        const next = {
          ...current,
          clients,
          transactions: syncClientRevenue(current.transactions, savedClient),
        };
        return addActivity(next, clientToUpdate ? `Cliente ${normalizedName} atualizado` : `Novo cliente ${normalizedName} cadastrado`);
      }
      if (type === "transaction") {
        const next = { ...current, transactions: [...current.transactions, { id: createId("t"), ...values, amount: Number(values.amount), type: values.type === "Receita" ? "income" : "expense" }] };
        return addActivity(next, `Novo lançamento: ${values.description}`, "orange");
      }
      const member = { id: createId("u"), ...values, name: normalizedName, initials: normalizedName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(), tone: "avatar-blue", status: "Ativo" };
      const next = { ...current, team: [...current.team, member] };
      return addActivity(next, `${normalizedName} foi adicionado à equipe`);
    }, ({
      client: "Cliente cadastrado com sucesso.",
      transaction: "Lançamento adicionado com sucesso.",
      service: "Serviço cadastrado com sucesso.",
      member: "Pessoa adicionada à equipe.",
    })[type]);
    setDialogType("");
    setEditingClient(null);
  }

  function deleteItem(collection, item, label) {
    if (!window.confirm(label)) return;
    if (collection === "services") {
      deleteService(user.uid, item.id).then(() => {
        commit((current) => addActivity(current, `Serviço ${item.name} removido`, "orange"), "Serviço removido.");
      }).catch((error) => {
        console.error("Não foi possível excluir o serviço no Firebase.", error);
        setToast(error.message || "Não foi possível excluir o serviço. Verifique sua conexão.");
      });
      return;
    }
    commit((current) => {
      let next = { ...current, [collection]: current[collection].filter((entry) => entry.id !== item.id) };
      if (collection === "clients") {
        next.transactions = removeClientRevenue(current.transactions, item);
        next = addActivity(next, `Cliente ${item.name} removido`, "orange");
      } else if (collection === "transactions") {
        next = addActivity(deleteTransaction(current, item.id), `Lançamento ${item.description} removido`, "orange");
      }
      return next;
    }, collection === "transactions" ? "Lançamento removido." : "Registro removido.");
  }

  function handleConfirmRenewal(client) {
    commit((current) => {
      const next = confirmClientRenewal(current, client.id);
      return next === current ? current : addActivity(next, `Renovação de ${client.name} confirmada`);
    }, "Renovação confirmada. Cliente reativado e lançamento financeiro atualizado.");
  }

  async function deleteMember(member) {
    if (member.role === "Administrador" && data.team.filter((person) => person.role === "Administrador").length === 1) {
      setToast("Mantenha pelo menos uma pessoa administradora.");
      return;
    }
    if (!window.confirm(`Remover ${member.name} da equipe? A pessoa perderá o acesso ao Nexo desta empresa.`)) return;
    if (!member.authUid) {
      commit((current) => {
        const team = current.team.filter((person) => person.id !== member.id);
        if (team.length === current.team.length) return current;
        return addActivity({ ...current, team }, `${member.name} foi removido da equipe`, "orange");
      }, "Membro removido da lista. A conta Firebase antiga precisa ser removida manualmente no Console.");
      return;
    }

    try {
      await writeQueueRef.current;
      const next = await deleteTeamMemberAccount(user.uid, member.authUid, (current) => {
        const team = current.team.filter((person) => person.id !== member.id);
        if (team.length === current.team.length) return current;
        return addActivity({ ...current, team }, `${member.name} foi removido da equipe`, "orange");
      });
      dataRef.current = next;
      setData(next);
      setToast(`${member.name} foi removido da equipe e perdeu o vínculo com a empresa.`);
    } catch (error) {
      console.error("Não foi possível remover o membro da equipe no Firebase.", error);
      setToast(error.message || "Não foi possível remover o membro. Verifique sua conexão e as regras do Firestore.");
    }
  }

  function toggleService(service) {
    updateService(user.uid, service.id, { status: service.status === "Ativo" ? "Inativo" : "Ativo" })
      .then(() => setToast(`Serviço ${service.status === "Ativo" ? "desativado" : "ativado"}.`))
      .catch((error) => {
        console.error("Não foi possível atualizar o serviço no Firebase.", error);
        setToast(error.message || "Não foi possível atualizar o serviço. Verifique sua conexão.");
      });
  }

  function navigate(page) {
    setCurrentPage(page);
    setSearchTerm("");
    setMenuOpen(false);
  }

  async function handleSignOut() {
    setLoggingOut(true);
    try {
      await signOut(firebaseAuth);
      window.location.replace(loginPath);
    } catch (error) {
      console.error("Não foi possível encerrar a sessão.", error);
      setToast("Não foi possível sair da conta. Tente novamente.");
      setLoggingOut(false);
    }
  }

  async function handleProfilePhotoSave(photoUrl) {
    await updateProfilePhoto(user.uid, photoUrl);
    setMembership((current) => ({ ...current, photoUrl }));
    setProfileDialogOpen(false);
    setToast(photoUrl ? "Foto de perfil atualizada." : "Foto de perfil removida.");
  }

  const profile = useMemo(() => getUserProfile(user, data, membership), [user, data, membership]);

  if (!authReady || !user) return <div className="auth-loading" role="status">Verificando acesso...</div>;
  if (storageError) {
    return <main className="page-content"><section className="panel storage-error" role="alert"><h1>Não foi possível acessar os dados do Firebase</h1><p>{storageError}</p><p>Confira se o Firestore está criado e se as regras foram publicadas no mesmo projeto Firebase configurado no app.</p></section></main>;
  }
  if (!data) return <div className="auth-loading" role="status">Carregando Nexo...</div>;

  const common = {
    data,
    search,
    onDelete: (item) => deleteItem("clients", item, `Excluir o cliente ${item.name}?`),
    onNew: () => setDialogType(currentPage === "clients" ? "client" : currentPage === "finance" ? "transaction" : currentPage === "services" ? "service" : "member"),
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar${menuOpen ? " is-open" : ""}`} id="sidebar">
        <button className="brand brand-button" type="button" onClick={() => navigate("overview")} aria-label="Nexo, início">
          <span className="brand-mark">N</span><span className="brand-copy"><strong>Nexo</strong><small>GESTÃO</small></span>
        </button>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Navegação principal">
          <button className={`nav-item${currentPage === "overview" ? " is-active" : ""}`} type="button" data-page="overview" aria-current={currentPage === "overview" ? "page" : undefined} onClick={() => navigate("overview")}><span className="nav-icon" aria-hidden="true">⌂</span><span>Visão geral</span></button>
          <div className="nav-section-label">GESTÃO</div>
          <button className={`nav-item${currentPage === "clients" ? " is-active" : ""}`} type="button" data-page="clients" aria-current={currentPage === "clients" ? "page" : undefined} onClick={() => navigate("clients")}><span className="nav-icon" aria-hidden="true">◎</span><span>Clientes</span><span className="nav-count">{data.clients.length}</span></button>
          <button className={`nav-item${currentPage === "finance" ? " is-active" : ""}`} type="button" data-page="finance" aria-current={currentPage === "finance" ? "page" : undefined} onClick={() => navigate("finance")}><span className="nav-icon" aria-hidden="true">R$</span><span>Financeiro</span></button>
          <button className={`nav-item${currentPage === "services" ? " is-active" : ""}`} type="button" data-page="services" aria-current={currentPage === "services" ? "page" : undefined} onClick={() => navigate("services")}><span className="nav-icon" aria-hidden="true">⌘</span><span>Serviços</span></button>
          <button className={`nav-item${currentPage === "team" ? " is-active" : ""}`} type="button" data-page="team" aria-current={currentPage === "team" ? "page" : undefined} onClick={() => navigate("team")}><span className="nav-icon" aria-hidden="true">♙</span><span>Equipe</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon" aria-hidden="true">✳</span><strong>Organize sua operação</strong><p>Clientes, serviços e financeiro em um só lugar.</p></div>
          <div className="profile">
            <button className="profile-edit-button" type="button" onClick={() => setProfileDialogOpen(true)} aria-label="Alterar foto de perfil" title="Alterar foto de perfil"><ProfileAvatar profile={profile} /></button>
            <button className="profile-copy profile-details-button" type="button" onClick={() => setProfileDialogOpen(true)} aria-label="Alterar foto de perfil"><strong>{profile.name}</strong><small>{profile.privilege}</small></button>
            <button className="logout-button" type="button" disabled={loggingOut} onClick={handleSignOut} aria-label="Sair da conta" title="Sair da conta">⇥</button>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button className="mobile-menu" id="mobile-menu" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Abrir menu" aria-expanded={menuOpen}>☰</button>
          <div className="breadcrumbs"><span>Nexo</span><span aria-hidden="true">/</span><strong>{pages[currentPage]}</strong></div>
          <div className="topbar-actions">
            <label className="search-box"><span aria-hidden="true">⌕</span><input id="global-search" type="search" placeholder="Buscar clientes..." autoComplete="off" aria-label="Buscar clientes; pressione Enter para ver os resultados" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} onKeyDown={submitSearch} /><kbd>Enter</kbd></label>
            <button className="theme-toggle" type="button" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label={`Ativar tema ${theme === "light" ? "escuro" : "claro"}`} title={`Ativar tema ${theme === "light" ? "escuro" : "claro"}`} aria-pressed={theme === "dark"}>
              <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span><span className="theme-toggle-label">{theme === "light" ? "Dark" : "Light"}</span>
            </button>
            <button className="icon-button notification-button" type="button" aria-label="Notificações"><span aria-hidden="true">♧</span><i /></button>
            <ProfileAvatar profile={profile} className="top-avatar" />
          </div>
        </header>
        <main className="page-content" id="page-content" tabIndex="-1">
          {currentPage === "overview" && <Overview data={data} userName={user.displayName || user.email?.split("@")[0]} onNavigate={navigate} onNewClient={() => setDialogType("client")} onDeleteClient={(client) => deleteItem("clients", client, `Excluir o cliente ${client.name}?`)} />}
          {currentPage === "clients" && <ClientsPage {...common} onNew={() => { if (!data.services.length) return setToast("Cadastre um serviço na aba Serviços antes de adicionar um cliente."); setEditingClient(null); setDialogType("client"); }} onEdit={(client) => { setEditingClient(client); setDialogType("client"); }} onDelete={(client) => deleteItem("clients", client, `Excluir o cliente ${client.name}?`)} onConfirmRenewal={handleConfirmRenewal} />}
          {currentPage === "finance" && <FinancePage {...common} onNew={() => setDialogType("transaction")} onDelete={(entry) => deleteItem("transactions", entry, `Excluir o lançamento "${entry.description}"?${entry.clientId ? " A cobrança atual será removida; o cliente continuará cadastrado." : ""}`)} />}
          {currentPage === "services" && <ServicesPage {...common} onNew={() => setDialogType("service")} onDelete={(service) => deleteItem("services", service, `Excluir o serviço "${service.name}"?`)} onToggle={toggleService} />}
          {currentPage === "team" && <TeamPage {...common} onNew={() => setDialogType("member")} onDelete={deleteMember} />}
        </main>
        <footer className="page-footer"><span>Nexo Gestão</span><span>Uma operação mais conectada.</span></footer>
      </div>
      {dialogType && <EntryDialog key={`${dialogType}-${editingClient?.id || "new"}`} type={dialogType} services={data.services} client={dialogType === "client" ? editingClient : null} onClose={() => { setDialogType(""); setEditingClient(null); }} onSave={handleSave} />}
      {profileDialogOpen && <ProfilePhotoDialog photoUrl={profile.photoUrl} onClose={() => setProfileDialogOpen(false)} onSave={handleProfilePhotoSave} />}
      {toast && <div className="toast is-visible" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}
