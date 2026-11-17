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
  formatActivityDate,
  formatCurrency,
  formatShortDate,
  getClientContracts,
  getFinanceAllocation,
  getDateInDays,
  getClientRenewalStatus,
  getConfirmedIncome,
  getMonthKey,
  getMonthlyIncome,
  getMonthlyOutflow,
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
  withClientContracts,
} from "./data.js";
import { getUserProfile, validateProfilePhotoUrl } from "./profile.js";
import ascendMark from "./assets/ascend-mark.svg";

const loginPath = `${import.meta.env.BASE_URL}login.html`;
const themeStorageKey = "ascend-theme";
const legacyThemeStorageKey = "nexo-theme";
const PAGE_FADE_OUT_DURATION = 150;
const PAGE_FADE_IN_DURATION = 220;

const pages = {
  overview: "Visão geral",
  clients: "Clientes",
  finance: "Financeiro",
  services: "Serviços",
  team: "Equipe",
};

function getSavedTheme() {
  const savedTheme = window.localStorage.getItem(themeStorageKey)
    || window.localStorage.getItem(legacyThemeStorageKey);
  return savedTheme === "dark" ? "dark" : "light";
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

function ClientServiceCell({ client }) {
  const contracts = getClientContracts(client);
  if (contracts.length > 1) return <span>Múltiplos Serviços</span>;
  const contract = contracts[0];
  return <span className="client-service-cell">{contract.plan || "—"}{contract.serviceType && <small>{contract.serviceType}</small>}</span>;
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

function ActivityList({ activity, transactions, limit = 4 }) {
  if (!activity.length) return <div className="empty-state">Ainda não há atividades registradas.</div>;
  return (
    <div className="activity-list">
      {activity.slice(0, limit).map((entry, index) => {
        const legacyDescription = !entry.createdAt && entry.text.startsWith("Novo lançamento: ")
          ? entry.text.slice("Novo lançamento: ".length)
          : "";
        const relatedTransaction = legacyDescription
          ? [...transactions].reverse().find((transaction) => transaction.description === legacyDescription)
          : null;
        const displayText = relatedTransaction
          ? `${relatedTransaction.type === "income" ? "Entrada" : "Despesa"}: ${relatedTransaction.description} · ${formatCurrency(relatedTransaction.amount)}`
          : entry.text;
        const transactionDate = relatedTransaction?.date
          ? new Date(`${relatedTransaction.date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
          : "";
        const displayTime = formatActivityDate(entry.createdAt)
          || transactionDate
          || (entry.time?.startsWith("Hoje, ")
            ? `Data não registrada · ${entry.time.slice("Hoje, ".length)}`
            : entry.time || "Data não registrada");

        return (
          <div className="activity-item" key={entry.createdAt || `${entry.text}-${index}`}>
            <span className={`activity-dot ${entry.tone || ""}`} />
            <div className="activity-text"><p>{displayText}</p><small>{displayTime}</small></div>
          </div>
        );
      })}
    </div>
  );
}

function ClientRows({ clients, onView, onEdit, onDelete, onConfirmRenewal }) {
  if (!clients.length) return <tr><td colSpan="8" className="empty-state">Nenhum cliente encontrado.</td></tr>;
  return clients.map((client) => (
    <tr
      key={client.id}
      className="client-row-clickable"
      tabIndex={0}
      aria-label={`Ver detalhes do cliente ${client.name}`}
      aria-haspopup="dialog"
      onClick={(event) => {
        if (!event.target.closest("button")) onView(client);
      }}
      onKeyDown={(event) => {
        if (event.target.closest("button")) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onView(client);
        }
      }}
    >
      <td><PersonCell person={client} subtitle={client.company} /></td>
      <td>{client.discord || "—"}</td>
      <td><ClientServiceCell client={client} /></td>
      <td>{formatCurrency(client.monthly)}</td>
      <td>{formatCurrency(client.entryAmount)}</td>
      <td><span className="client-service-cell">{getClientContracts(client).map((contract) => (
        <span key={contract.id}>{formatShortDate(contract.renewal)}</span>
      ))}</span></td>
      <td><Status value={client.status} /></td>
      <td><div className="row-actions">
        {getClientContracts(client).filter((contract) => Number(contract.monthly) > 0 && isRenewalDue(contract)).map((contract) => (
          <button className="row-action renewal-confirm" type="button" key={contract.id} onClick={() => onConfirmRenewal(client, contract.id)} aria-label={`Confirmar renovação de ${client.name} — ${contract.plan}`} title={`Confirmar renovação: ${contract.plan}`}>✓</button>
        ))}
        <button className="row-action" type="button" onClick={() => onEdit(client, "contract")} aria-label={`Adicionar serviço para ${client.name}`} title="Adicionar serviço">+</button>
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

function EntryDialog({ type, services = [], client, service, onClose, onSave }) {
  const dialogRef = useRef(null);
  const [transactionType, setTransactionType] = useState("Receita");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const primaryContract = client ? getClientContracts(client)[0] : null;
  const matchedClientService = services.find((service) => service.id === primaryContract?.serviceId || service.name === primaryContract?.plan);
  const clientServiceChoices = [
    { value: "", label: services.length ? "Selecione um serviço" : "Nenhum serviço cadastrado", disabled: true },
    ...services.map((service) => ({ value: service.id, label: service.name })),
    ...(primaryContract?.plan && !matchedClientService ? [{ value: "__existing__", label: primaryContract.plan }] : []),
  ];
  const clientStatusChoices = client
    ? [primaryContract?.status || "ATIVO", ...(String(primaryContract?.status || "").toLocaleUpperCase("pt-BR") === "CANCELADO" ? [] : ["CANCELADO"])]
    : ["ATIVO"];

  function applyServicePrices(event) {
    const service = services.find((item) => item.id === event.currentTarget.value);
    const form = event.currentTarget.form;
    if (service) {
      form.elements.namedItem("monthly").value = Number(service.monthly || 0);
      form.elements.namedItem("entryAmount").value = Number(service.entryAmount || 0);
    } else if (event.currentTarget.value === "__existing__" && primaryContract) {
      form.elements.namedItem("monthly").value = Number(primaryContract.monthly || 0);
      form.elements.namedItem("entryAmount").value = Number(primaryContract.entryAmount || 0);
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
        <Field label="Serviço / contrato principal" name="serviceId" choices={clientServiceChoices} full defaultValue={matchedClientService?.id || (primaryContract?.plan ? "__existing__" : "")} onChange={applyServicePrices} />
        <Field label="Mensalidade (R$)" name="monthly" type="number" min="0" step="0.01" defaultValue={primaryContract?.monthly} />
        <Field label="Valor fixo / de entrada (R$)" name="entryAmount" type="number" min="0" step="0.01" defaultValue={primaryContract?.entryAmount ?? 0} required={false} />
        <Field label="Próxima renovação" name="renewal" type="date" defaultValue={primaryContract?.renewal ?? getDateInDays(30)} disabled={primaryContract?.status === "EXPIRADO"} />
        <Field label="Status" name="status" choices={clientStatusChoices} defaultValue={primaryContract?.status ?? "ATIVO"} />
      </>,
    },
    contract: {
      title: `Adicionar serviço para ${client?.name || "cliente"}`,
      fields: <>
        <Field label="Serviço / contrato" name="serviceId" choices={[{ value: "", label: services.length ? "Selecione um serviço" : "Nenhum serviço cadastrado", disabled: true }, ...services.map((item) => ({ value: item.id, label: item.name }))]} full defaultValue="" onChange={applyServicePrices} />
        <Field label="Mensalidade (R$)" name="monthly" type="number" min="0" step="0.01" defaultValue={0} />
        <Field label="Valor fixo / de entrada (R$)" name="entryAmount" type="number" min="0" step="0.01" defaultValue={0} required={false} />
        <Field label="Próxima renovação" name="renewal" type="date" defaultValue={getDateInDays(30)} />
        <Field label="Status" name="status" choices={["ATIVO", "CANCELADO"]} defaultValue="ATIVO" />
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
      title: service ? "Editar serviço" : "Novo serviço",
      fields: <>
        <Field label="Nome do serviço" name="name" full placeholder="Ex.: Site institucional" defaultValue={service?.name} />
        <Field label="Tipo" name="type" choices={["Site", "Bot"]} defaultValue={service?.type} />
        <Field label="Mensalidade (R$)" name="monthly" type="number" min="0" step="0.01" defaultValue={service?.monthly} />
        <Field label="Valor fixo / de entrada (R$)" name="entryAmount" type="number" min="0" step="0.01" defaultValue={service?.entryAmount ?? 0} required={false} />
        <Field label="Status" name="status" choices={["Ativo", "Em implantação", "Inativo"]} defaultValue={service?.status ?? "Ativo"} />
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
      await onSave(type, Object.fromEntries(new FormData(event.currentTarget).entries()), client, service);
    } catch (error) {
      setSubmitError(error.message || (type === "member" ? "Não foi possível criar o usuário." : "Não foi possível salvar os dados."));
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
        {(type === "client" || type === "contract") && !services.length && <p className="security-note">Cadastre um serviço na aba Serviços antes de adicionar um cliente.</p>}
        {submitError && <p className="form-error" role="alert">{submitError}</p>}
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="button button-primary" type="submit" disabled={saving}>{saving ? "Salvando..." : type === "member" ? "Criar usuário" : "Salvar"}</button>
        </div>
      </form>
    </dialog>
  );
}

function ClientDetailsDialog({ client, onClose }) {
  const dialogRef = useRef(null);
  const contracts = getClientContracts(client);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.showModal();
    dialog.querySelector("button")?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      className="app-dialog client-details-dialog"
      ref={dialogRef}
      aria-labelledby="client-details-title"
      onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="dialog-card">
        <div className="dialog-heading">
          <div><span className="eyebrow">CLIENTE</span><h2 id="client-details-title">{client.name}</h2></div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <div className="client-details-content">
          <section>
            <h3>Informações do cliente</h3>
            <div className="client-details-grid">
              <div><small>Empresa</small><strong>{client.company || "—"}</strong></div>
              <div><small>E-mail</small><strong>{client.email || "—"}</strong></div>
              <div><small>WhatsApp</small><strong>{client.whatsapp || "—"}</strong></div>
              <div><small>Discord</small><strong>{client.discord || "—"}</strong></div>
            </div>
          </section>
          <section>
            <h3>Serviços e contratos</h3>
            <div className="client-contract-list">
              {contracts.map((contract) => (
                <article className="client-contract-card" key={contract.id}>
                  <div className="client-contract-heading">
                    <div><strong>{contract.plan || "Serviço"}</strong><small>{contract.serviceType || "Tipo não informado"}</small></div>
                    <Status value={contract.status || "ATIVO"} />
                  </div>
                  <div className="client-contract-stats">
                    <div><small>Mensalidade</small><strong>{formatCurrency(contract.monthly)}</strong></div>
                    <div><small>Entrada</small><strong>{formatCurrency(contract.entryAmount)}</strong></div>
                    <div><small>Próxima renovação</small><strong>{formatShortDate(contract.renewal)}</strong></div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onClose}>Fechar</button>
        </div>
      </div>
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
  const financeAllocation = getFinanceAllocation(data.transactions, data.financePlan);
  const pending = getReceivableTotal(data.transactions);
  const activeServices = data.services.filter((service) => service.status === "Ativo").length;
  const dueSoon = getUpcomingRenewals(data.clients);
  const today = new Date();
  const dateLabel = today.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).toLocaleUpperCase("pt-BR");
  const greeting = today.getHours() < 12 ? "Bom dia" : today.getHours() < 18 ? "Boa tarde" : "Boa noite";
  const monthLabels = Array.from({ length: 6 }, (_, index) => getMonthKey(index - 5));
  const currentMonth = getMonthKey();
  const monthValues = monthLabels.map((month) => ({
    month,
    income: month === currentMonth
      ? getMonthlyIncome(data.transactions, month)
      : getConfirmedIncome(data.transactions, month),
    outflow: getMonthlyOutflow(data.transactions, month, data.financePlan),
  }));
  const maxMonthValue = Math.max(...monthValues.flatMap(({ income, outflow }) => [income, outflow.total]), 1);
  const currentOutflow = monthValues[monthValues.length - 1].outflow.total;
  const chartDescription = monthLabels.map((month, index) => {
    const date = new Date(`${month}-01T12:00:00`);
    const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
    const values = monthValues[index];
    return `${label}: entradas ${formatCurrency(values.income)}, saídas ${formatCurrency(values.outflow.total)}, incluindo despesas de ${formatCurrency(values.outflow.expenses)}, guardar ${formatCurrency(values.outflow.saving)} e investir ${formatCurrency(values.outflow.investing)}`;
  }).join("; ");

  return (
    <>
      <section className="welcome-panel">
        <div className="welcome-copy"><span>{dateLabel}</span><h1>{greeting}{userName ? `, ${userName}` : ""} 👋</h1><p>Acompanhe a saúde da sua operação em um só lugar.</p></div>
        <button className="button" type="button" onClick={onNewClient}><span className="button-symbol">+</span> Novo cliente</button>
      </section>
      <section className="metric-grid overview-metrics">
        <Metric title="Clientes ativos" value={data.clients.filter((client) => client.status === "ATIVO").length} icon="◎" note={`${data.clients.length} cadastrados`} />
        <Metric title="Receita do mês" value={formatCurrency(monthIncome)} icon="R$" note="Mensalidades ativas e receitas recebidas" tone="green" />
        <Metric title="Serviços ativos" value={activeServices} icon="⌘" note={`${data.services.length} serviços cadastrados`} tone="orange" />
        <Metric title="A receber" value={formatCurrency(pending)} icon="↗" note="Lançamentos pendentes" tone="pink" />
        <Metric title="Separado para guardar/investir" value={formatCurrency(financeAllocation.total)} icon="↗" note={`Guardar ${formatCurrency(financeAllocation.saving)} · Investir ${formatCurrency(financeAllocation.investing)}`} tone="green" />
      </section>
      <section className="overview-grid">
        <article className="panel">
          <div className="panel-heading"><div><h2>Entradas e saídas ao longo do tempo</h2><p>Saídas incluem despesas e valores separados segundo as regras atuais de guardar e investir.</p></div><div className="chart-legend"><span><i className="chart-legend-income" />Entradas</span><span><i className="chart-legend-outflow" />Saídas</span></div></div>
          <div className="chart-totals">
            <div className="chart-summary"><strong>{formatCurrency(monthIncome)}</strong><span className="positive">entradas este mês</span></div>
            <div className="chart-summary"><strong>{formatCurrency(currentOutflow)}</strong><span className="chart-outflow-label">saídas este mês</span></div>
          </div>
          <div className="chart" role="img" aria-label={chartDescription}>{monthValues.map(({ month, income, outflow }, index) => {
            const date = new Date(`${month}-01T12:00:00`);
            const label = new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "");
            return <div className="chart-column" key={month}><div className="chart-bars">
              <div className="chart-bar is-income" style={{ height: `${income > 0 ? income / maxMonthValue * 100 : 0}%` }} title={`${label}: entradas ${formatCurrency(income)}`} />
              <div className="chart-bar is-expense" style={{ height: `${outflow.total > 0 ? outflow.total / maxMonthValue * 100 : 0}%` }} title={`${label}: saídas ${formatCurrency(outflow.total)}`} />
            </div><span>{label}</span></div>;
          })}</div>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><h2>Atividade recente</h2><p>Últimas atualizações da operação</p></div></div>
          <ActivityList activity={data.activity} transactions={data.transactions} />
        </article>
      </section>
      <section className="overview-tables">
        <section className="panel table-panel">
          <div className="panel-heading"><div><h2>Clientes recentes</h2><p>Visão rápida dos contratos da operação</p></div><button className="text-link" type="button" onClick={() => onNavigate("clients")}>Ver todos <span aria-hidden="true">→</span></button></div>
          <DataTable columns={["CLIENTE", "SERVIÇO", "MENSALIDADE", "RENOVAÇÃO", "STATUS", ""]}>
            {data.clients.slice(-4).reverse().map((client) => <tr key={client.id}><td><PersonCell person={client} subtitle={client.company} /></td><td><ClientServiceCell client={client} /></td><td>{formatCurrency(client.monthly)}</td><td>{formatShortDate(client.renewal)}</td><td><Status value={client.status} /></td><td><button className="row-action" type="button" onClick={() => onDeleteClient(client)} aria-label={`Excluir ${client.name}`}>×</button></td></tr>)}
            {!data.clients.length && <tr><td colSpan="6" className="empty-state">Cadastre seu primeiro cliente para começar.</td></tr>}
          </DataTable>
        </section>
        <section className="panel table-panel">
          <div className="panel-heading"><div><h2>Renovações próximas</h2><p>Clientes com vencimento nos próximos 10 dias</p></div></div>
          <DataTable columns={["CLIENTE", "SERVIÇO", "RENOVAÇÃO", "VALOR", "STATUS"]}>
            {dueSoon.map((client) => <tr key={`${client.id}-${client.contractId}`}><td><PersonCell person={client} subtitle={client.company} /></td><td><ClientServiceCell client={client} /></td><td>{formatShortDate(client.renewal)}</td><td>{formatCurrency(client.monthly)}</td><td><Status value={client.status} /></td></tr>)}
            {!dueSoon.length && <tr><td colSpan="5" className="empty-state">Nenhuma renovação nos próximos dias.</td></tr>}
          </DataTable>
        </section>
      </section>
    </>
  );
}

function ClientsPage({ data, search, onNew, onView, onEdit, onDelete, onConfirmRenewal }) {
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
        <DataTable columns={["CLIENTE", "DISCORD", "SERVIÇO / CONTRATO", "MENSALIDADE", "ENTRADA", "RENOVAÇÃO", "STATUS", "AÇÕES"]}><ClientRows clients={clients} onView={onView} onEdit={onEdit} onDelete={onDelete} onConfirmRenewal={onConfirmRenewal} /></DataTable>
      </section>
    </>
  );
}

function FinancePage({ data, search, onNew, onDelete, onSavePlan }) {
  const [draftPlan, setDraftPlan] = useState(() => ({
    savingPercent: data.financePlan?.savingPercent ?? 0,
    savingFixed: data.financePlan?.savingFixed ?? 0,
    investingPercent: data.financePlan?.investingPercent ?? 0,
    investingFixed: data.financePlan?.investingFixed ?? 0,
  }));
  const transactions = data.transactions.filter((entry) => [entry.description, entry.category, entry.type, entry.status].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(search))).sort((a, b) => b.date.localeCompare(a.date));
  const income = getRevenueTotal(data.transactions);
  const expense = data.transactions.filter((item) => item.type === "expense").reduce((total, item) => total + Number(item.amount), 0);
  const pending = getReceivableTotal(data.transactions);
  const allocation = getFinanceAllocation(data.transactions, draftPlan);

  function submitPlan(event) {
    event.preventDefault();
    onSavePlan({
      savingPercent: Number(draftPlan.savingPercent),
      savingFixed: Number(draftPlan.savingFixed),
      investingPercent: Number(draftPlan.investingPercent),
      investingFixed: Number(draftPlan.investingFixed),
    });
  }

  return (
    <>
      <PageHeading title="Financeiro" description="Acompanhe receitas, despesas e valores a receber." action={<button className="button button-primary" type="button" onClick={onNew}><span className="button-symbol">+</span> Novo lançamento</button>} />
      <section className="finance-summary">
        <article className="finance-card income"><span>Receitas registradas</span><strong>{formatCurrency(income)}</strong></article>
        <article className="finance-card expense"><span>Despesas registradas</span><strong>{formatCurrency(expense)}</strong></article>
        <article className="finance-card"><span>Saldo da operação</span><strong>{formatCurrency(income - expense)}</strong><span className="finance-card-note">Após descontar o total separado: {formatCurrency(allocation.operatingBalance - allocation.total)}</span></article>
        <article className="finance-card allocation-total"><span>Total separado</span><strong>{formatCurrency(allocation.total)}</strong></article>
      </section>
      <section className="finance-workspace">
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
        <section className="panel finance-allocation-panel">
          <div className="panel-heading"><div><h2>Separar investimento</h2><p>Defina percentuais e valores fixos para seu saldo.</p></div></div>
          <div className="allocation-results">
            <article><span>Guardar</span><strong>{formatCurrency(allocation.saving)}</strong></article>
            <article><span>Investir</span><strong>{formatCurrency(allocation.investing)}</strong></article>
          </div>
          <p className="allocation-note">Percentuais calculados sobre o saldo positivo da operação ({formatCurrency(allocation.operatingBalance)}). Valores fixos são somados ao cálculo.</p>
          <form className="allocation-form" onSubmit={submitPlan}>
            <div className="allocation-fields">
              <div className="form-field"><label htmlFor="saving-percent">Guardar (%)</label><input id="saving-percent" name="savingPercent" type="number" min="0" max="100" step="0.01" value={draftPlan.savingPercent} onChange={(event) => setDraftPlan((current) => ({ ...current, savingPercent: event.target.value }))} /></div>
              <div className="form-field"><label htmlFor="saving-fixed">Valor fixo (R$)</label><input id="saving-fixed" name="savingFixed" type="number" min="0" step="0.01" value={draftPlan.savingFixed} onChange={(event) => setDraftPlan((current) => ({ ...current, savingFixed: event.target.value }))} /></div>
              <div className="form-field"><label htmlFor="investing-percent">Investir (%)</label><input id="investing-percent" name="investingPercent" type="number" min="0" max="100" step="0.01" value={draftPlan.investingPercent} onChange={(event) => setDraftPlan((current) => ({ ...current, investingPercent: event.target.value }))} /></div>
              <div className="form-field"><label htmlFor="investing-fixed">Valor fixo (R$)</label><input id="investing-fixed" name="investingFixed" type="number" min="0" step="0.01" value={draftPlan.investingFixed} onChange={(event) => setDraftPlan((current) => ({ ...current, investingFixed: event.target.value }))} /></div>
            </div>
            <button className="button button-primary allocation-save" type="submit">Salvar separação</button>
          </form>
        </section>
      </section>
    </>
  );
}

function ServicesPage({ data, search, onNew, onEdit, onDelete, onToggle }) {
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
            <td><div className="row-actions">
              <button className="row-action" type="button" onClick={() => onEdit(service)} aria-label={`Editar ${service.name}`} title="Editar serviço">✎</button>
              <button className="row-action" type="button" onClick={() => onDelete(service)} aria-label={`Excluir ${service.name}`}>×</button>
            </div></td>
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
  const [pageTransition, setPageTransition] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [theme, setTheme] = useState(getSavedTheme);
  const [dialogType, setDialogType] = useState("");
  const [editingClient, setEditingClient] = useState(null);
  const [viewingClientId, setViewingClientId] = useState(null);
  const [editingService, setEditingService] = useState(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [storageError, setStorageError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const dataRef = useRef(null);
  const writeQueueRef = useRef(Promise.resolve());
  const pageTransitionTimerRef = useRef(null);
  const pendingPageRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#101522" : "#f5f7fb");
  }, [theme]);

  useEffect(() => () => {
    if (pageTransitionTimerRef.current) window.clearTimeout(pageTransitionTimerRef.current);
  }, []);

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
    navigate("clients", true);
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
        createdAt: new Date().toISOString(),
        tone,
      }, ...current.activity].slice(0, 8),
    };
  }

  async function handleSave(type, values, clientToUpdate = null, serviceToUpdate = null) {
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
      const serviceChanges = {
        name: normalizedName,
        type: values.type,
        monthly: Number(values.monthly),
        entryAmount: Number(values.entryAmount || 0),
        status: values.status,
      };
      if (serviceToUpdate) {
        await updateService(user.uid, serviceToUpdate.id, serviceChanges);
        setToast(`Serviço ${normalizedName} atualizado. Clientes e financeiro sincronizados.`);
      } else {
        await createService(user.uid, { id: createId("s"), ...serviceChanges });
        setToast("Serviço cadastrado com sucesso.");
      }
      setDialogType("");
      setEditingService(null);
      return;
    }

    commit((current) => {
      if (type === "contract") {
        const selectedService = dataRef.current?.services.find((service) => service.id === values.serviceId);
        if (!clientToUpdate || !selectedService) throw new Error("Selecione um serviço válido para este cliente.");
        const addedContract = {
          id: createId("ct"),
          serviceId: selectedService.id,
          plan: selectedService.name,
          serviceType: selectedService.type,
          monthly: Number(values.monthly),
          entryAmount: Number(values.entryAmount || 0),
          renewal: values.renewal,
          status: getClientRenewalStatus({ renewal: values.renewal, status: values.status }),
          revenueExclusions: [],
        };
        const savedClient = withClientContracts(
          clientToUpdate,
          [...getClientContracts(clientToUpdate), addedContract],
        );
        const next = {
          ...current,
          clients: current.clients.map((entry) => entry.id === clientToUpdate.id ? savedClient : entry),
          transactions: syncClientRevenue(current.transactions, savedClient),
        };
        return addActivity(next, `Serviço ${addedContract.plan} adicionado para ${clientToUpdate.name}`);
      }
      if (type === "client") {
        const selectedService = dataRef.current?.services.find((service) => service.id === values.serviceId);
        const oldContracts = clientToUpdate ? getClientContracts(clientToUpdate) : [];
        const oldPrimary = oldContracts[0];
        const primaryContract = {
          ...oldPrimary,
          id: oldPrimary?.id || createId("ct"),
          serviceId: selectedService?.id || oldPrimary?.serviceId || "",
          plan: selectedService?.name || oldPrimary?.plan || "",
          serviceType: selectedService?.type || oldPrimary?.serviceType || "",
          monthly: Number(values.monthly),
          entryAmount: Number(values.entryAmount || 0),
          renewal: values.renewal || oldPrimary?.renewal || "",
          status: getClientRenewalStatus({
            renewal: values.renewal || oldPrimary?.renewal,
            status: values.status || oldPrimary?.status,
          }),
        };
        const savedClient = withClientContracts({
          ...clientToUpdate,
          ...values,
          id: clientToUpdate?.id || createId("c"),
          name: normalizedName,
          photoUrl: validateProfilePhotoUrl(values.photoUrl || ""),
          email: values.email.trim(),
          whatsapp: values.whatsapp.trim(),
          discord: values.discord.trim(),
          initials: normalizedName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
        }, [primaryContract, ...oldContracts.slice(1)]);
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
        const transaction = { id: createId("t"), ...values, amount: Number(values.amount), type: values.type === "Receita" ? "income" : "expense" };
        const next = { ...current, transactions: [...current.transactions, transaction] };
        const movement = transaction.type === "income"
          ? `Entrada${transaction.category ? ` de ${transaction.category}` : ""}`
          : `Despesa${transaction.category ? ` · ${transaction.category}` : ""}`;
        const detail = `${movement}: ${transaction.description} · ${formatCurrency(transaction.amount)}`;
        return addActivity(next, detail, transaction.type === "income" ? "green" : "orange");
      }
      const member = { id: createId("u"), ...values, name: normalizedName, initials: normalizedName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(), tone: "avatar-blue", status: "Ativo" };
      const next = { ...current, team: [...current.team, member] };
      return addActivity(next, `${normalizedName} foi adicionado à equipe`);
    }, ({
      client: clientToUpdate ? "Cliente atualizado com sucesso." : "Cliente cadastrado com sucesso.",
      contract: "Serviço adicionado ao cliente com sucesso.",
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
        const movement = item.type === "income" ? "Entrada" : "Despesa";
        next = addActivity(deleteTransaction(current, item.id), `${movement} removida: ${item.description} · ${formatCurrency(item.amount)}`, "orange");
      }
      return next;
    }, collection === "transactions" ? "Lançamento removido." : "Registro removido.");
  }

  function handleConfirmRenewal(client, contractId) {
    commit((current) => {
      const next = confirmClientRenewal(current, client.id, contractId);
      return next === current ? current : addActivity(next, `Renovação de ${client.name} confirmada`);
    }, "Renovação confirmada. Cliente reativado e lançamento financeiro atualizado.");
  }

  async function deleteMember(member) {
    if (member.role === "Administrador" && data.team.filter((person) => person.role === "Administrador").length === 1) {
      setToast("Mantenha pelo menos uma pessoa administradora.");
      return;
    }
    if (!window.confirm(`Remover ${member.name} da equipe? A pessoa perderá o acesso ao Ascend desta empresa.`)) return;
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

  function navigate(page, preserveSearch = false) {
    if (page === currentPage && !pendingPageRef.current) {
      if (!preserveSearch) setSearchTerm("");
      setMenuOpen(false);
      return;
    }

    pendingPageRef.current = page;
    if (!preserveSearch) setSearchTerm("");
    setMenuOpen(false);

    if (pageTransitionTimerRef.current) window.clearTimeout(pageTransitionTimerRef.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCurrentPage(page);
      setPageTransition("");
      pendingPageRef.current = null;
      pageTransitionTimerRef.current = null;
      return;
    }

    setPageTransition("is-fading-out");
    pageTransitionTimerRef.current = window.setTimeout(() => {
      const nextPage = pendingPageRef.current;
      pendingPageRef.current = null;
      setCurrentPage(nextPage);
      setPageTransition("is-fading-in");
      pageTransitionTimerRef.current = window.setTimeout(() => {
        setPageTransition("");
        pageTransitionTimerRef.current = null;
      }, PAGE_FADE_IN_DURATION);
    }, PAGE_FADE_OUT_DURATION);
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
  const viewingClient = data?.clients.find((client) => client.id === viewingClientId);

  if (!authReady || !user) return <div className="auth-loading" role="status">Verificando acesso...</div>;
  if (storageError) {
    return <main className="page-content"><section className="panel storage-error" role="alert"><h1>Não foi possível acessar os dados do Firebase</h1><p>{storageError}</p><p>Confira se o Firestore está criado e se as regras foram publicadas no mesmo projeto Firebase configurado no app.</p></section></main>;
  }
  if (!data) return <div className="auth-loading" role="status">Carregando Ascend...</div>;

  const common = {
    data,
    search,
    onDelete: (item) => deleteItem("clients", item, `Excluir o cliente ${item.name}?`),
    onNew: () => setDialogType(currentPage === "clients" ? "client" : currentPage === "finance" ? "transaction" : currentPage === "services" ? "service" : "member"),
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar${menuOpen ? " is-open" : ""}`} id="sidebar">
        <button className="brand brand-button" type="button" onClick={() => navigate("overview")} aria-label="Ascend, início">
          <img className="brand-mark" src={ascendMark} alt="" /><span className="brand-copy"><strong>Ascend</strong><small>GESTÃO</small></span>
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
          <div className="breadcrumbs"><span>Ascend</span><span aria-hidden="true">/</span><strong>{pages[currentPage]}</strong></div>
          <div className="topbar-actions">
            <label className="search-box"><span aria-hidden="true">⌕</span><input id="global-search" type="search" placeholder="Buscar clientes..." autoComplete="off" aria-label="Buscar clientes; pressione Enter para ver os resultados" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} onKeyDown={submitSearch} /><kbd>Enter</kbd></label>
            <button className="theme-toggle" type="button" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label={`Ativar tema ${theme === "light" ? "escuro" : "claro"}`} title={`Ativar tema ${theme === "light" ? "escuro" : "claro"}`} aria-pressed={theme === "dark"}>
              <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span><span className="theme-toggle-label">{theme === "light" ? "Dark" : "Light"}</span>
            </button>
            <button className="icon-button notification-button" type="button" aria-label="Notificações"><span aria-hidden="true">♧</span><i /></button>
            <ProfileAvatar profile={profile} className="top-avatar" />
          </div>
        </header>
        <main className={`page-content${pageTransition ? ` ${pageTransition}` : ""}`} id="page-content" tabIndex="-1">
          {currentPage === "overview" && <Overview data={data} userName={user.displayName || user.email?.split("@")[0]} onNavigate={navigate} onNewClient={() => setDialogType("client")} onDeleteClient={(client) => deleteItem("clients", client, `Excluir o cliente ${client.name}?`)} />}
          {currentPage === "clients" && <ClientsPage {...common} onNew={() => { if (!data.services.length) return setToast("Cadastre um serviço na aba Serviços antes de adicionar um cliente."); setEditingClient(null); setDialogType("client"); }} onView={(client) => setViewingClientId(client.id)} onEdit={(client, dialog = "client") => { if (dialog === "contract" && !data.services.length) return setToast("Cadastre um serviço na aba Serviços antes de adicionar um contrato."); setEditingClient(client); setDialogType(dialog); }} onDelete={(client) => deleteItem("clients", client, `Excluir o cliente ${client.name}?`)} onConfirmRenewal={handleConfirmRenewal} />}
          {currentPage === "finance" && <FinancePage {...common} onNew={() => setDialogType("transaction")} onDelete={(entry) => deleteItem("transactions", entry, `Excluir o lançamento "${entry.description}"?${entry.clientId ? " A cobrança atual será removida; o cliente continuará cadastrado." : ""}`)} onSavePlan={(financePlan) => commit((current) => {
            const allocation = getFinanceAllocation(current.transactions, financePlan);
            return addActivity({ ...current, financePlan }, `Separação definida: Guardar ${formatCurrency(allocation.saving)} · Investir ${formatCurrency(allocation.investing)}`);
          }, "Separação para guardar e investir salva.")} />}
          {currentPage === "services" && <ServicesPage {...common} onNew={() => { setEditingService(null); setDialogType("service"); }} onEdit={(service) => { setEditingService(service); setDialogType("service"); }} onDelete={(service) => deleteItem("services", service, `Excluir o serviço "${service.name}"?`)} onToggle={toggleService} />}
          {currentPage === "team" && <TeamPage {...common} onNew={() => setDialogType("member")} onDelete={deleteMember} />}
        </main>
        <footer className="page-footer"><span>Ascend Gestão</span><span>Uma operação mais conectada.</span></footer>
      </div>
      {dialogType && <EntryDialog key={`${dialogType}-${editingClient?.id || editingService?.id || "new"}`} type={dialogType} services={data.services} client={dialogType === "client" || dialogType === "contract" ? editingClient : null} service={dialogType === "service" ? editingService : null} onClose={() => { setDialogType(""); setEditingClient(null); setEditingService(null); }} onSave={handleSave} />}
      {viewingClient && <ClientDetailsDialog key={viewingClient.id} client={viewingClient} onClose={() => setViewingClientId(null)} />}
      {profileDialogOpen && <ProfilePhotoDialog photoUrl={profile.photoUrl} onClose={() => setProfileDialogOpen(false)} onSave={handleProfilePhotoSave} />}
      {toast && <div className="toast is-visible" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}
