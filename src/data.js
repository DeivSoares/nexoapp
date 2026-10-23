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
    console.error("Não foi possível carregar os dados salvos do Nexo.", error);
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

export async function subscribeData(uid, onData, onError) {
  try {
    const { subscribeCloudData } = await import("./cloudData.js");
    return subscribeCloudData(uid, onData, (error) => onError(getCloudDataError(error)), validateData);
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
      "O Firestore negou o acesso. Confirme que as regras atuais de firestore.rules foram publicadas no mesmo projeto e que seu vínculo companyMemberships tem active=true e canManageUsers=true.",
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

export function syncClientRevenue(transactions, client) {
  const revenueKinds = [
    { kind: "monthly", amount: Number(client.monthly), category: "Mensalidade", description: `Mensalidade — ${client.company || client.name}` },
    { kind: "fixed", amount: Number(client.entryAmount), category: "Projeto", description: `Entrada fixa — ${client.company || client.name}` },
  ];
  const managedKinds = new Set(revenueKinds.map(({ kind }) => kind));
  const existingEntries = transactions.filter((entry) => entry.clientId === client.id && managedKinds.has(entry.revenueKind));
  const remaining = transactions.filter((entry) => entry.clientId !== client.id || !managedKinds.has(entry.revenueKind));

  return [
    ...remaining,
    ...revenueKinds.flatMap(({ kind, amount, category, description }) => {
      if (amount <= 0) return [];
      const existing = existingEntries.find((entry) => entry.revenueKind === kind);
      return [{
        id: existing?.id || createId("t"),
        clientId: client.id,
        revenueKind: kind,
        description,
        category,
        type: "income",
        amount,
        date: client.renewal,
        status: existing?.status || "Pendente",
      }];
    }),
  ];
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
  if (!client.renewal || !/^\d{4}-\d{2}-\d{2}$/.test(client.renewal)) return false;
  const cutoff = new Date(`${localDateString(today)}T12:00:00`);
  cutoff.setDate(cutoff.getDate() + 2);
  return client.renewal <= localDateString(cutoff);
}

function isClientMonthlyRevenue(entry, client) {
  if (entry.clientId === client.id && entry.revenueKind === "monthly") return true;
  if (entry.clientId || entry.category !== "Mensalidade" || entry.type !== "income") return false;
  const company = client.company || client.name;
  return entry.description === `Plano mensal — ${company}` || entry.description === `Mensalidade — ${company}`;
}

export function markDueRenewalsPending(data, today = new Date()) {
  const dueClients = data.clients.filter((client) =>
    client.status === "Ativo" && Number(client.monthly) > 0 && isRenewalDue(client, today),
  );
  if (!dueClients.length) return data;

  const dueClientIds = new Set(dueClients.map((client) => client.id));
  const clients = data.clients.map((client) => dueClientIds.has(client.id) ? { ...client, status: "Pendente" } : client);
  const matchedClientIds = new Set();
  const transactions = data.transactions.map((entry) => {
    const client = dueClients.find((item) => isClientMonthlyRevenue(entry, item));
    if (!client) return entry;
    matchedClientIds.add(client.id);
    if (entry.status === "Pendente" && entry.date === client.renewal && entry.clientId === client.id) return entry;
    return { ...entry, clientId: client.id, revenueKind: "monthly", date: client.renewal, status: "Pendente" };
  });
  for (const client of dueClients) {
    if (matchedClientIds.has(client.id)) continue;
    transactions.push({
      id: createId("t"),
      clientId: client.id,
      revenueKind: "monthly",
      description: `Mensalidade — ${client.company || client.name}`,
      category: "Mensalidade",
      type: "income",
      amount: Number(client.monthly),
      date: client.renewal,
      status: "Pendente",
    });
  }

  return { ...data, clients, transactions };
}

export function confirmClientRenewal(data, clientId) {
  const client = data.clients.find((item) => item.id === clientId);
  if (!client || client.status !== "Pendente" || Number(client.monthly) <= 0) return data;

  const nextRenewal = addMonth(client.renewal || localDateString());
  const updatedClient = { ...client, status: "Ativo", renewal: nextRenewal };
  const clients = data.clients.map((item) => item.id === clientId ? updatedClient : item);
  let matchedRevenue = false;
  const transactions = data.transactions.map((entry) => {
    if (!isClientMonthlyRevenue(entry, client)) return entry;
    matchedRevenue = true;
    return { ...entry, clientId, revenueKind: "monthly", date: nextRenewal, status: "Recebido" };
  });

  if (!matchedRevenue) {
    transactions.push({
      id: createId("t"),
      clientId,
      revenueKind: "monthly",
      description: `Mensalidade — ${client.company || client.name}`,
      category: "Mensalidade",
      type: "income",
      amount: Number(client.monthly),
      date: nextRenewal,
      status: "Recebido",
    });
  }

  return { ...data, clients, transactions };
}

export function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatShortDate(value) {
  return value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    : "—";
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
