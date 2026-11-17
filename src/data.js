const LEGACY_STORAGE_KEY = "nexo-gestao-data-v1";
const STORAGE_PREFIX = "nexo-gestao-data-v1";

const dateInDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

function initialData() {
  return {
    clients: [],
    transactions: [],
    services: [],
    team: [],
    activity: [],
  };
}

function validateData(data) {
  if (!data || ["clients", "transactions", "services", "team", "activity"].some((key) => !Array.isArray(data[key]))) {
    throw new Error("Formato de dados inválido.");
  }
  return data;
}

function loadLocalData(uid) {
  const storageKey = `${STORAGE_PREFIX}:${uid}`;
  let stored = localStorage.getItem(storageKey);

  if (!stored) {
    const legacyData = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyData) {
      stored = legacyData;
      localStorage.setItem(storageKey, legacyData);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  }

  if (!stored) return initialData();

  try {
    return validateData(JSON.parse(stored));
  } catch (error) {
    console.error("Não foi possível carregar os dados salvos do Ascend.", error);
    throw new Error("Os dados salvos estão inválidos. Limpe os dados do site e tente novamente.");
  }
}

export async function loadData(uid) {
  const { loadCloudData } = await import("./cloudData.js");
  try {
    return await loadCloudData(uid, () => loadLocalData(uid), removeMigratedData, validateData);
  } catch (error) {
    throw getCloudDataError(error);
  }
}

export async function updateData(uid, update) {
  const { updateCloudData } = await import("./cloudData.js");
  try {
    return await updateCloudData(uid, update, validateData);
  } catch (error) {
    throw getCloudDataError(error);
  }
}

export async function createTeamMemberAccount(uid, username, password, member, update) {
  const { createCloudTeamMember } = await import("./cloudData.js");
  try {
    return await createCloudTeamMember(uid, username, password, member, update, validateData);
  } catch (error) {
    throw getCloudDataError(error);
  }
}

export async function deleteTeamMemberAccount(uid, memberUid, update) {
  const { deleteCloudTeamMember } = await import("./cloudData.js");
  try {
    return await deleteCloudTeamMember(uid, memberUid, update, validateData);
  } catch (error) {
    throw getCloudDataError(error);
  }
}

export async function createService(uid, service) {
  const { createCloudService } = await import("./cloudData.js");
  try {
    await createCloudService(uid, service);
  } catch (error) {
    throw getCloudDataError(error);
  }
}

export async function updateService(uid, serviceId, changes) {
  const { updateCloudService } = await import("./cloudData.js");
  try {
    await updateCloudService(uid, serviceId, changes, updateServiceAndClients, validateData);
  } catch (error) {
    throw getCloudDataError(error);
  }
}

export async function deleteService(uid, serviceId) {
  const { deleteCloudService } = await import("./cloudData.js");
  try {
    await deleteCloudService(uid, serviceId);
  } catch (error) {
    throw getCloudDataError(error);
  }
}

export async function updateProfilePhoto(uid, photoUrl) {
  const { updateCloudProfilePhoto } = await import("./cloudData.js");
  try {
    await updateCloudProfilePhoto(uid, photoUrl);
  } catch (error) {
    throw getCloudDataError(error);
  }
}

export async function subscribeData(uid, onData, onError, onMembership = () => {}) {
  try {
    const { subscribeCloudData } = await import("./cloudData.js");
    return subscribeCloudData(uid, onData, (error) => onError(getCloudDataError(error)), validateData, onMembership);
  } catch (error) {
    onError(getCloudDataError(error));
    return () => {};
  }
}

function getCloudDataError(error) {
  if (error?.code === "auth/email-already-in-use") {
    return new Error("Esse nome de usuário já está cadastrado no Firebase. Escolha outro.");
  }
  if (error?.code === "auth/weak-password") {
    return new Error("A senha inicial deve ter pelo menos 6 caracteres.");
  }
  if (error?.code === "auth/operation-not-allowed") {
    return new Error("Ative o método E-mail/senha em Authentication > Sign-in method no Firebase Console.");
  }
  if (error?.code === "permission-denied" || error?.code === "firestore/permission-denied") {
    return new Error(
      "O Firestore negou a criação do membro. Confirme se as regras atuais de firestore.rules foram publicadas no mesmo projeto, se seu vínculo tem active=true e canManageUsers=true e se a versão mais recente do app foi publicada no GitHub Pages.",
      { cause: error },
    );
  }
  return error instanceof Error ? error : new Error("Não foi possível acessar os dados do Firestore.");
}

function removeMigratedData(uid) {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}:${uid}`);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    console.warn("Os dados foram migrados, mas não foi possível limpar a cópia local.", error);
  }
}

export function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}

const RENEWAL_WINDOW_DAYS = 10;
const CLIENT_CANCELLED = "CANCELADO";
const CLIENT_EXPIRED = "EXPIRADO";
const CLIENT_ACTIVE = "ATIVO";

export function getClientContracts(client) {
  if (Array.isArray(client.contracts) && client.contracts.length) return client.contracts;
  return [{
    id: client.contractId || `legacy-${client.id}`,
    serviceId: client.serviceId || "",
    plan: client.plan || "",
    serviceType: client.serviceType || "",
    monthly: Number(client.monthly || 0),
    entryAmount: Number(client.entryAmount || 0),
    renewal: client.renewal || "",
    status: client.status || CLIENT_ACTIVE,
    revenueExclusions: client.revenueExclusions || [],
  }];
}

export function withClientContracts(client, contracts) {
  const primary = contracts[0];
  const statuses = contracts.map((contract) => contract.status || getClientRenewalStatus(contract));
  const status = statuses.length === 1
    ? statuses[0]
    : statuses.includes(CLIENT_ACTIVE)
      ? CLIENT_ACTIVE
      : statuses.find((value) => value.startsWith("PRAZO "))
        || (statuses.includes(CLIENT_EXPIRED) ? CLIENT_EXPIRED : statuses[0] || CLIENT_ACTIVE);
  return {
    ...client,
    contracts,
    serviceId: primary?.serviceId || "",
    plan: primary?.plan || "",
    serviceType: primary?.serviceType || "",
    monthly: contracts.reduce((total, contract) => total + Number(contract.monthly || 0), 0),
    entryAmount: contracts.reduce((total, contract) => total + Number(contract.entryAmount || 0), 0),
    renewal: contracts.map((contract) => contract.renewal).filter(Boolean).sort()[0] || "",
    status,
    revenueExclusions: primary?.revenueExclusions || [],
  };
}

function isCancelledClient(client) {
  return String(client.status || "").toLocaleUpperCase("pt-BR") === CLIENT_CANCELLED;
}

function isInactiveClient(client) {
  return String(client.status || "").toLocaleLowerCase("pt-BR") === "inativo";
}

function daysUntilRenewal(renewal, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(renewal || "")) return null;
  const [year, month, day] = renewal.split("-").map(Number);
  const renewalDate = new Date(year, month - 1, day);
  if (renewalDate.getFullYear() !== year || renewalDate.getMonth() !== month - 1 || renewalDate.getDate() !== day) return null;
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((renewalDate.getTime() - todayDate.getTime()) / 86_400_000);
}

export function getClientRenewalStatus(client, today = new Date()) {
  if (isCancelledClient(client)) return CLIENT_CANCELLED;
  if (isInactiveClient(client)) return "Inativo";
  if (String(client.status || "").toLocaleUpperCase("pt-BR") === CLIENT_EXPIRED) return CLIENT_EXPIRED;
  const days = daysUntilRenewal(client.renewal, today);
  if (days === null) return CLIENT_ACTIVE;
  if (days < 0) return CLIENT_EXPIRED;
  if (days <= RENEWAL_WINDOW_DAYS) return `PRAZO ${days} DIAS`;
  return CLIENT_ACTIVE;
}

export function syncClientRevenue(transactions, client, today = new Date()) {
  const contracts = getClientContracts(client);
  const foundKinds = new Set();
  let changed = false;
  const synced = transactions.flatMap((entry) => {
    const legacyUnlinked = !entry.clientId && !entry.revenueKind && isClientMonthlyRevenue(entry, client);
    if (entry.clientId !== client.id && !legacyUnlinked) return [entry];
    const contractIndex = legacyUnlinked
      ? 0
      : contracts.findIndex((contract, index) => entry.contractId === contract.id || (!entry.contractId && index === 0));
    if (contractIndex < 0) return [entry];
    const contract = contracts[contractIndex];
    const kind = ["monthly", "fixed"].includes(entry.revenueKind)
      ? entry.revenueKind
      : !entry.revenueKind && contractIndex === 0 && isClientMonthlyRevenue(entry, client)
        ? "monthly"
        : null;
    if (!kind) return [entry];
    foundKinds.add(`${contract.id}:${kind}`);
    const revenue = getContractRevenue(client, contract, kind, contracts.length > 1, today);
    if (revenue.amount <= 0) {
      changed = true;
      return [];
    }
    const updated = {
      ...entry,
      id: entry.id || createId("t"),
      clientId: client.id,
      contractId: contract.id,
      revenueKind: kind,
      description: revenue.description,
      category: revenue.category,
      type: "income",
      amount: revenue.amount,
      date: kind === "fixed" ? entry.date || localDateString(today) : contract.renewal,
      status: kind === "fixed" ? entry.status || "Recebido" : revenue.status,
    };
    if (Object.keys(updated).length !== Object.keys(entry).length
      || Object.entries(updated).some(([key, value]) => entry[key] !== value)) changed = true;
    return [changed ? updated : entry];
  });
  for (const [index, contract] of contracts.entries()) {
    for (const kind of ["monthly", "fixed"]) {
      const revenue = getContractRevenue(client, contract, kind, contracts.length > 1, today);
      if (revenue.amount <= 0 || foundKinds.has(`${contract.id}:${kind}`)) continue;
      const exclusionKey = kind === "monthly" ? `monthly:${contract.renewal}` : "fixed";
      if (contract.revenueExclusions?.includes(`${kind}:${contract.renewal}`)
        || contract.revenueExclusions?.includes(exclusionKey)
        || (index === 0 && client.revenueExclusions?.includes(exclusionKey))) continue;
      synced.push({
        id: createId("t"),
        clientId: client.id,
        contractId: contract.id,
        revenueKind: kind,
        description: revenue.description,
        category: revenue.category,
        type: "income",
        amount: revenue.amount,
        date: kind === "fixed" ? localDateString(today) : contract.renewal,
        status: revenue.status,
      });
      changed = true;
    }
  }
  return changed ? synced : transactions;
}

function getContractRevenue(client, contract, kind, multiple, today) {
  const status = getClientRenewalStatus(contract, today);
  const subject = client.company || client.name;
  const suffix = multiple && contract.plan ? ` — ${contract.plan}` : "";
  return kind === "monthly"
    ? { kind, amount: Number(contract.monthly), category: "Mensalidade", description: `Mensalidade — ${subject}${suffix}`, status }
    : { kind, amount: Number(contract.entryAmount), category: "Projeto", description: `Entrada fixa — ${subject}${suffix}`, status: "Recebido" };
}

export function updateServiceAndClients(data, service, changes, today = new Date()) {
  const updatedService = { ...service, ...changes };
  const clients = data.clients.map((client) => {
    const contracts = getClientContracts(client);
    let changed = false;
    const updatedContracts = contracts.map((contract) => {
      const belongsToService = contract.serviceId === service.id
        || (!contract.serviceId && contract.plan === service.name);
      if (!belongsToService) return contract;
      changed = true;
      return {
        ...contract,
        serviceId: service.id,
        plan: updatedService.name,
        serviceType: updatedService.type,
        monthly: Number(updatedService.monthly || 0),
        entryAmount: Number(updatedService.entryAmount || 0),
      };
    });
    return changed ? withClientContracts(client, updatedContracts) : client;
  });
  let transactions = data.transactions;
  for (const [index, client] of clients.entries()) {
    if (client !== data.clients[index]) transactions = syncClientRevenue(transactions, client, today);
  }
  const services = data.services.map((item) => item.id === service.id ? updatedService : item);
  return { ...data, services, clients, transactions };
}

export function deleteTransaction(data, transactionId) {
  const transaction = data.transactions.find((entry) => entry.id === transactionId);
  if (!transaction) return data;

  const transactions = data.transactions.filter((entry) => entry.id !== transactionId);
  const client = data.clients.find((item) => item.id === transaction.clientId
    || (!transaction.clientId && isClientMonthlyRevenue(transaction, item)));
  if (!client || (!transaction.revenueKind && !isClientMonthlyRevenue(transaction, client))) {
    return { ...data, transactions };
  }

  const kind = transaction.revenueKind || "monthly";
  if (!["monthly", "fixed"].includes(kind)) return { ...data, transactions };
  const contracts = getClientContracts(client);
  const contractIndex = contracts.findIndex((contract, index) => contract.id === transaction.contractId || (!transaction.contractId && index === 0));
  if (contractIndex < 0) return { ...data, transactions };
  const contract = contracts[contractIndex];
  const exclusionKey = kind === "monthly"
    ? `monthly:${transaction.date || contract.renewal}`
    : "fixed";
  const scopedExclusion = `${kind}:${kind === "monthly" ? transaction.date || contract.renewal : "fixed"}`;
  const hasMultipleContractModel = Array.isArray(client.contracts) && client.contracts.length > 0;
  const updatedContract = {
    ...contract,
    revenueExclusions: [...new Set([
      ...(contract.revenueExclusions || []),
      ...(hasMultipleContractModel ? [scopedExclusion] : []),
      ...(contractIndex === 0 ? [exclusionKey] : []),
    ])],
  };
  const updatedClient = withClientContracts(client, contracts.map((item, index) => index === contractIndex ? updatedContract : item));
  const clients = data.clients.map((item) => item.id === client.id ? updatedClient : item);
  if (contractIndex === 0) updatedClient.revenueExclusions = updatedContract.revenueExclusions;
  return { ...data, clients, transactions };
}

export function removeClientRevenue(transactions, client) {
  return transactions.flatMap((entry) => {
    if (entry.clientId !== client.id) return [entry];
    if (entry.revenueKind === "monthly") return [];
    if (entry.revenueKind === "fixed") {
      const { clientId, revenueKind, ...standaloneEntry } = entry;
      return [standaloneEntry];
    }
    return [entry];
  }).filter((entry) => entry.clientId || !isClientMonthlyRevenue(entry, client));
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonth(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month + 1, 0));
  const nextDay = Math.min(day, nextMonth.getUTCDate());
  const nextDate = new Date(Date.UTC(year, month, nextDay));
  return `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDate.getUTCDate()).padStart(2, "0")}`;
}

export function isRenewalDue(client, today = new Date()) {
  if (isCancelledClient(client) || isInactiveClient(client)) return false;
  if (String(client.status || "").toLocaleUpperCase("pt-BR") === CLIENT_EXPIRED) return true;
  const days = daysUntilRenewal(client.renewal, today);
  return days !== null && days <= RENEWAL_WINDOW_DAYS;
}

function isClientMonthlyRevenue(entry, client) {
  if (entry.clientId === client.id && entry.revenueKind === "monthly") return true;
  if (entry.clientId || entry.category !== "Mensalidade" || entry.type !== "income") return false;
  const company = client.company || client.name;
  return entry.description === `Plano mensal — ${company}` || entry.description === `Mensalidade — ${company}`;
}

export function syncClientRenewalStatuses(data, today = new Date()) {
  const clients = data.clients.map((client) => {
    const contracts = getClientContracts(client);
    const updatedContracts = contracts.map((contract) => {
      const status = getClientRenewalStatus(contract, today);
      return contract.status === status ? contract : { ...contract, status };
    });
    const updatedClient = withClientContracts(client, updatedContracts);
    return updatedContracts.every((contract, index) => contract === contracts[index])
      && updatedClient.monthly === client.monthly
      && updatedClient.entryAmount === client.entryAmount
      && updatedClient.renewal === client.renewal
      && updatedClient.status === client.status
      ? client
      : updatedClient;
  });
  let transactions = data.transactions;
  for (const client of clients) {
    transactions = syncClientRevenue(transactions, client, today);
  }
  if (clients.every((client, index) => client === data.clients[index]) && transactions === data.transactions) return data;
  return { ...data, clients, transactions };
}

export function markDueRenewalsPending(data, today = new Date()) {
  return syncClientRenewalStatuses(data, today);
}

export function confirmClientRenewal(data, clientId, contractId, today = new Date()) {
  if (contractId instanceof Date) {
    today = contractId;
    contractId = null;
  }
  const client = data.clients.find((item) => item.id === clientId);
  if (!client) return data;
  const contracts = getClientContracts(client);
  const contractIndex = contracts.findIndex((contract, index) => contract.id === contractId || (!contractId && index === 0));
  if (contractIndex < 0) return data;
  const contract = contracts[contractIndex];
  if (!isRenewalDue(contract, today) || Number(contract.monthly) <= 0) return data;

  let nextRenewal = contract.renewal || localDateString(today);
  do {
    nextRenewal = addMonth(nextRenewal);
  } while (nextRenewal <= localDateString(today));
  const updatedContract = {
    ...contract,
    status: CLIENT_ACTIVE,
    renewal: nextRenewal,
    revenueExclusions: (contract.revenueExclusions || []).filter((exclusion) => !exclusion.startsWith("monthly:")),
  };
  const updatedClient = withClientContracts(client, contracts.map((item, index) => index === contractIndex ? updatedContract : item));
  if (contractIndex === 0) updatedClient.revenueExclusions = updatedContract.revenueExclusions;
  const clients = data.clients.map((item) => item.id === clientId ? updatedClient : item);
  const transactions = syncClientRevenue(data.transactions, updatedClient, today);
  return { ...data, clients, transactions };
}

export function getRevenueTotal(transactions) {
  return transactions
    .filter((entry) => entry.type === "income" && (entry.status === "Recebido" || entry.status === "Pago" || (entry.revenueKind === "monthly" && entry.status === CLIENT_ACTIVE)))
    .reduce((total, entry) => total + Number(entry.amount), 0);
}

export function getFinanceAllocation(transactions, plan = {}) {
  const revenue = getRevenueTotal(transactions);
  const expenses = transactions
    .filter((entry) => entry.type === "expense")
    .reduce((total, entry) => total + Number(entry.amount), 0);
  const operatingBalance = revenue - expenses;
  return { operatingBalance, ...getPlannedAllocation(Math.max(0, operatingBalance), plan) };
}

function getPlannedAllocation(availableBalance, plan = {}) {
  const settings = plan || {};
  const saving = availableBalance * Math.min(100, Math.max(0, Number(settings.savingPercent) || 0)) / 100
    + Math.max(0, Number(settings.savingFixed) || 0);
  const investing = availableBalance * Math.min(100, Math.max(0, Number(settings.investingPercent) || 0)) / 100
    + Math.max(0, Number(settings.investingFixed) || 0);
  return { saving, investing, total: saving + investing };
}

export function getMonthlyIncome(transactions, month = getMonthKey()) {
  return transactions
    .filter((entry) => (
      entry.type === "income"
      && ((entry.revenueKind === "monthly" && entry.status === CLIENT_ACTIVE)
        || ((entry.status === "Recebido" || entry.status === "Pago") && entry.date?.startsWith(month)))
    ))
    .reduce((total, entry) => total + Number(entry.amount), 0);
}

export function getConfirmedIncome(transactions, month) {
  return transactions
    .filter((entry) => entry.type === "income"
      && (entry.status === "Recebido" || entry.status === "Pago")
      && entry.date?.startsWith(month))
    .reduce((total, entry) => total + Number(entry.amount), 0);
}

export function getMonthlyOutflow(transactions, month, plan = {}) {
  const expenses = transactions
    .filter((entry) => entry.type === "expense" && entry.date?.startsWith(month))
    .reduce((total, entry) => total + Number(entry.amount), 0);
  const income = month === getMonthKey()
    ? getMonthlyIncome(transactions, month)
    : getConfirmedIncome(transactions, month);
  const operatingBalance = income - expenses;
  const allocation = getPlannedAllocation(Math.max(0, operatingBalance), plan);
  return { expenses, ...allocation, total: expenses + allocation.total };
}

export function getReceivableTotal(transactions) {
  return transactions
    .filter((entry) => entry.type === "income" && (entry.status === "Pendente" || entry.status === CLIENT_EXPIRED || /^PRAZO \d+ DIAS$/.test(entry.status || "")))
    .reduce((total, entry) => total + Number(entry.amount), 0);
}

export function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatShortDate(value) {
  return value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    : "—";
}

export function formatActivityDate(value, now = new Date()) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) return `Hoje, ${time}`;

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.getFullYear() === yesterday.getFullYear()
    && date.getMonth() === yesterday.getMonth()
    && date.getDate() === yesterday.getDate()) return `Ontem, ${time}`;

  return `${date.toLocaleDateString("pt-BR")}, ${time}`;
}

export function getMonthKey(offset = 0) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function getDateInDays(days) {
  return dateInDays(days);
}

export function getUpcomingRenewals(clients, days = 10, today = new Date()) {
  const todayKey = localDateString(today);
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffKey = localDateString(cutoff);

  return clients.flatMap((client) => getClientContracts(client)
    .filter((contract) => {
      if (isCancelledClient(contract) || isInactiveClient(contract)) return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(contract.renewal || "")) return false;
      const [year, month, day] = contract.renewal.split("-").map(Number);
      const renewal = new Date(year, month - 1, day);
      if (renewal.getFullYear() !== year || renewal.getMonth() !== month - 1 || renewal.getDate() !== day) return false;
      return contract.renewal >= todayKey && contract.renewal <= cutoffKey;
    })
    .map((contract) => ({
      ...client,
      ...contract,
      contracts: [contract],
      contractId: contract.id,
      id: client.id,
    })))
    .sort((first, second) => first.renewal.localeCompare(second.renewal));
}
