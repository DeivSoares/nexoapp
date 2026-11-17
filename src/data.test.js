import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmClientRenewal,
  deleteTransaction,
  getClientRenewalStatus,
  getFinanceAllocation,
  formatActivityDate,
  getMonthlyOutflow,
  getMonthlyIncome,
  getConfirmedIncome,
  getReceivableTotal,
  getRevenueTotal,
  getUpcomingRenewals,
  getClientContracts,
  isRenewalDue,
  removeClientRevenue,
  syncClientRevenue,
  syncClientRenewalStatuses,
  updateServiceAndClients,
  withClientContracts,
} from "./data.js";

const client = {
  id: "client-1",
  name: "Cliente Teste",
  company: "Empresa Teste",
  monthly: 250,
  entryAmount: 500,
  renewal: "2026-11-15",
};

test("lists valid renewals from today through the next ten days in date order", () => {
  const today = new Date(2026, 9, 24, 23, 30);
  const clients = [
    { id: "outside-before", renewal: "2026-10-23" },
    { id: "last-day", renewal: "2026-11-03" },
    { id: "cancelled", renewal: "2026-10-25", status: "CANCELADO" },
    { id: "inactive", renewal: "2026-10-25", status: "Inativo" },
    { id: "today", renewal: "2026-10-24" },
    { id: "outside-after", renewal: "2026-11-04" },
    { id: "invalid", renewal: "2026-10-32" },
    { id: "missing" },
  ];

  assert.deepEqual(
    getUpcomingRenewals(clients, 10, today).map(({ id }) => id),
    ["today", "last-day"],
  );
});

test("creates an active monthly entry and a received fixed entry linked to the client", () => {
  const transactions = syncClientRevenue([], client, new Date(2026, 9, 24));

  assert.equal(transactions.length, 2);
  assert.deepEqual(transactions.map(({ category, amount, date, status, type }) => ({ category, amount, date, status, type })), [
    { category: "Mensalidade", amount: 250, date: "2026-11-15", status: "ATIVO", type: "income" },
    { category: "Projeto", amount: 500, date: "2026-10-24", status: "Recebido", type: "income" },
  ]);
  assert.ok(transactions.every((entry) => entry.clientId === client.id));
});

test("updates linked entries while preserving fixed receipt and unrelated transactions", () => {
  const initial = syncClientRevenue([], client, new Date(2026, 9, 24));
  initial[0].status = "EXPIRADO";
  const updated = syncClientRevenue([...initial, { id: "manual", description: "Manual" }], {
    ...client,
    company: "Empresa Atualizada",
    monthly: 300,
    renewal: "2026-12-01",
  }, new Date(2026, 9, 24));

  assert.equal(updated.length, 3);
  assert.equal(updated.find((entry) => entry.revenueKind === "monthly").amount, 300);
  assert.equal(updated.find((entry) => entry.revenueKind === "monthly").status, "ATIVO");
  assert.equal(updated.find((entry) => entry.revenueKind === "fixed").description, "Entrada fixa — Empresa Atualizada");
  assert.equal(updated.find((entry) => entry.revenueKind === "fixed").date, "2026-10-24");
  assert.equal(updated.find((entry) => entry.revenueKind === "fixed").status, "Recebido");
  assert.ok(updated.some((entry) => entry.id === "manual"));
});

test("removes linked income entries when their client amounts become zero", () => {
  const initial = syncClientRevenue([], client);
  const updated = syncClientRevenue(initial, { ...client, monthly: 0, entryAmount: 0 });

  assert.deepEqual(updated, []);
});

test("editing a service updates linked clients and their monthly and fixed financial entries", () => {
  const service = { id: "service-1", name: "Site antigo", type: "Site", monthly: 250, entryAmount: 500, status: "Ativo" };
  const linkedClient = { ...client, serviceId: service.id, plan: service.name, monthly: service.monthly, entryAmount: service.entryAmount };
  const legacyClient = { ...client, id: "client-legacy", plan: service.name };
  const otherClient = { ...client, id: "client-other", serviceId: "service-2", plan: "Outro" };
  const data = {
    services: [service, { id: "service-2", name: "Outro" }],
    clients: [linkedClient, legacyClient, otherClient],
    transactions: [
      ...syncClientRevenue([], linkedClient, new Date(2026, 9, 24)),
      ...syncClientRevenue([], legacyClient, new Date(2026, 9, 24)),
      { id: "unrelated", description: "Outro lançamento" },
    ],
  };

  const updated = updateServiceAndClients(data, service, {
    name: "Aplicativo novo",
    type: "Bot",
    monthly: 300,
    entryAmount: 750,
    status: "Inativo",
  }, new Date(2026, 9, 24));

  assert.deepEqual(updated.services[0], { ...service, name: "Aplicativo novo", type: "Bot", monthly: 300, entryAmount: 750, status: "Inativo" });
  assert.deepEqual(updated.clients.slice(0, 2).map(({ plan, serviceType, monthly, entryAmount }) => ({ plan, serviceType, monthly, entryAmount })), [
    { plan: "Aplicativo novo", serviceType: "Bot", monthly: 300, entryAmount: 750 },
    { plan: "Aplicativo novo", serviceType: "Bot", monthly: 300, entryAmount: 750 },
  ]);
  assert.equal(updated.clients[2], otherClient);
  assert.equal(updated.transactions.filter((entry) => entry.revenueKind === "monthly").every((entry) => entry.amount === 300 && entry.description === "Mensalidade — Empresa Teste"), true);
  assert.equal(updated.transactions.filter((entry) => entry.revenueKind === "fixed").every((entry) => entry.amount === 750 && entry.description === "Entrada fixa — Empresa Teste"), true);
  assert.ok(updated.transactions.some((entry) => entry.id === "unrelated"));
});

test("keeps multiple client services and their recurring and fixed charges independent", () => {
  const primary = {
    id: "contract-primary",
    serviceId: "service-primary",
    plan: "Site",
    serviceType: "Site",
    monthly: 250,
    entryAmount: 500,
    renewal: "2026-11-15",
    status: "ATIVO",
  };
  const additional = {
    id: "contract-additional",
    serviceId: "service-additional",
    plan: "Hospedagem de bot",
    serviceType: "Bot",
    monthly: 80,
    entryAmount: 25,
    renewal: "2026-10-24",
    status: "PRAZO 0 DIAS",
  };
  const customer = withClientContracts(client, [primary, additional]);
  const transactions = syncClientRevenue([], customer, new Date(2026, 9, 24));

  assert.deepEqual(getClientContracts(customer).map(({ id }) => id), [primary.id, additional.id]);
  assert.equal(customer.monthly, 330);
  assert.equal(transactions.filter((entry) => entry.revenueKind === "monthly").length, 2);
  assert.equal(transactions.filter((entry) => entry.revenueKind === "fixed").length, 2);
  assert.equal(new Set(transactions.map((entry) => entry.contractId)).size, 2);
  assert.equal(getUpcomingRenewals([customer], 10, new Date(2026, 9, 24))[0].contractId, additional.id);

  const renewed = confirmClientRenewal({
    clients: [customer],
    transactions,
  }, customer.id, additional.id, new Date(2026, 9, 24));
  const renewedContracts = getClientContracts(renewed.clients[0]);
  assert.equal(renewedContracts[0].renewal, primary.renewal);
  assert.equal(renewedContracts[1].renewal, "2026-11-24");
  assert.equal(renewed.transactions.find((entry) => entry.contractId === primary.id && entry.revenueKind === "monthly").date, primary.renewal);
  assert.equal(renewed.transactions.find((entry) => entry.contractId === additional.id && entry.revenueKind === "monthly").date, "2026-11-24");
});

test("updates only the matching service in a client's multiple contracts", () => {
  const site = { id: "site-service", name: "Site", type: "Site", monthly: 100, entryAmount: 0 };
  const bot = { id: "bot-service", name: "Bot", type: "Bot", monthly: 50, entryAmount: 10 };
  const customer = withClientContracts(client, [
    { id: "site-contract", serviceId: site.id, plan: site.name, monthly: site.monthly, entryAmount: 0, renewal: "2026-12-01", status: "ATIVO" },
    { id: "bot-contract", serviceId: bot.id, plan: bot.name, monthly: bot.monthly, entryAmount: bot.entryAmount, renewal: "2026-12-15", status: "ATIVO" },
  ]);
  const updated = updateServiceAndClients({
    services: [site, bot],
    clients: [customer],
    transactions: syncClientRevenue([], customer, new Date(2026, 9, 24)),
  }, bot, { name: "Hospedagem de bot", monthly: 75, entryAmount: 20 }, new Date(2026, 9, 24));
  const contracts = getClientContracts(updated.clients[0]);

  assert.equal(contracts[0].plan, "Site");
  assert.equal(contracts[0].monthly, 100);
  assert.equal(contracts[1].plan, "Hospedagem de bot");
  assert.equal(contracts[1].monthly, 75);
  assert.equal(updated.clients[0].monthly, 175);
  assert.equal(updated.transactions.find((entry) => entry.contractId === "site-contract" && entry.revenueKind === "monthly").amount, 100);
  assert.equal(updated.transactions.find((entry) => entry.contractId === "bot-contract" && entry.revenueKind === "monthly").amount, 75);
});

test("deleting a client removes its recurring revenue but keeps received fixed income", () => {
  const transactions = syncClientRevenue([], client, new Date(2026, 9, 24));
  const remaining = removeClientRevenue(transactions, client);

  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].revenueKind, undefined);
  assert.equal(remaining[0].clientId, undefined);
  assert.equal(remaining[0].status, "Recebido");
});

test("manually deleting a monthly client charge does not recreate it before the next renewal", () => {
  const dueClient = { ...client, status: "PRAZO 0 DIAS", renewal: "2026-10-24" };
  const data = { clients: [dueClient], transactions: syncClientRevenue([], dueClient, new Date(2026, 9, 24)) };
  const monthly = data.transactions.find((entry) => entry.revenueKind === "monthly");
  const deleted = deleteTransaction(data, monthly.id);

  assert.equal(deleted.transactions.some((entry) => entry.id === monthly.id), false);
  assert.deepEqual(deleted.clients[0].revenueExclusions, ["monthly:2026-10-24"]);
  const synchronized = syncClientRenewalStatuses(deleted, new Date(2026, 9, 24));
  assert.equal(synchronized.transactions.some((entry) => entry.revenueKind === "monthly"), false);

  const renewed = confirmClientRenewal(synchronized, dueClient.id, new Date(2026, 9, 24));
  assert.equal(renewed.clients[0].renewal, "2026-11-24");
  assert.equal(renewed.transactions.find((entry) => entry.revenueKind === "monthly").date, "2026-11-24");
  assert.equal(renewed.clients[0].revenueExclusions.length, 0);
});

test("manually deleting a fixed client charge keeps it deleted on synchronization", () => {
  const data = { clients: [client], transactions: syncClientRevenue([], client, new Date(2026, 9, 24)) };
  const fixed = data.transactions.find((entry) => entry.revenueKind === "fixed");
  const deleted = deleteTransaction(data, fixed.id);

  assert.deepEqual(deleted.clients[0].revenueExclusions, ["fixed"]);
  assert.equal(syncClientRenewalStatuses(deleted, new Date(2026, 9, 24)).transactions.some((entry) => entry.revenueKind === "fixed"), false);
});

test("changes client and finance status through the ten-day countdown and expiration", () => {
  const dueClient = { ...client, status: "ATIVO", renewal: "2026-11-03" };
  const data = { clients: [dueClient], transactions: [] };
  const today = new Date(2026, 9, 24, 12);

  assert.equal(getClientRenewalStatus(dueClient, today), "PRAZO 10 DIAS");
  assert.equal(isRenewalDue(dueClient, today), true);
  const countdown = syncClientRenewalStatuses(data, today);

  assert.equal(countdown.clients[0].status, "PRAZO 10 DIAS");
  assert.equal(countdown.transactions.find((entry) => entry.revenueKind === "monthly").status, "PRAZO 10 DIAS");
  assert.equal(countdown.transactions.find((entry) => entry.revenueKind === "monthly").amount, dueClient.monthly);
  const expired = syncClientRenewalStatuses(countdown, new Date(2026, 10, 4));
  assert.equal(expired.clients[0].status, "EXPIRADO");
  assert.equal(expired.transactions.find((entry) => entry.revenueKind === "monthly").status, "EXPIRADO");
  assert.equal(syncClientRenewalStatuses(expired, new Date(2026, 10, 4)), expired);
});

test("does not change cancelled clients or active clients more than ten days from renewal", () => {
  const today = new Date(2026, 9, 23, 12);
  const data = {
    clients: [
      { ...client, id: "cancelled", status: "CANCELADO", renewal: "2026-10-24" },
      { ...client, id: "not-due", status: "ATIVO", renewal: "2026-11-03" },
    ],
    transactions: [],
  };

  const updated = syncClientRenewalStatuses(data, today);
  assert.equal(updated.clients[0].status, "CANCELADO");
  assert.equal(isRenewalDue(updated.clients[0], today), false);
  assert.equal(updated.clients[1].status, "ATIVO");
  assert.equal(updated.transactions.find((entry) => entry.clientId === "cancelled" && entry.revenueKind === "monthly").status, "CANCELADO");
  assert.equal(getRevenueTotal(updated.transactions), 1250);
  assert.equal(getReceivableTotal(updated.transactions), 0);
});

test("confirming an expired renewal reactivates the client and moves its next date into the future", () => {
  const dueClient = { ...client, status: "EXPIRADO", renewal: "2026-10-25" };
  const data = { clients: [dueClient], transactions: syncClientRevenue([], dueClient, new Date(2026, 9, 28)) };
  const updated = confirmClientRenewal(data, dueClient.id, new Date(2026, 9, 28));
  const monthly = updated.transactions.find((entry) => entry.revenueKind === "monthly");

  assert.equal(updated.clients[0].status, "ATIVO");
  assert.equal(updated.clients[0].renewal, "2026-11-25");
  assert.equal(monthly.status, "ATIVO");
  assert.equal(monthly.date, "2026-11-25");
  assert.equal(updated.transactions.find((entry) => entry.revenueKind === "fixed").status, "Recebido");
});

test("expired clients stay expired until renewal is explicitly confirmed", () => {
  const expired = { ...client, status: "EXPIRADO", renewal: "2026-11-25" };
  assert.equal(getClientRenewalStatus(expired, new Date(2026, 9, 24)), "EXPIRADO");
  assert.equal(isRenewalDue(expired, new Date(2026, 9, 24)), true);
});

test("renewal dates at month end advance to the last valid day", () => {
  const dueClient = { ...client, status: "PRAZO 0 DIAS", renewal: "2026-01-31" };
  const updated = confirmClientRenewal({ clients: [dueClient], transactions: [] }, dueClient.id, new Date(2026, 0, 31));

  assert.equal(updated.clients[0].renewal, "2026-02-28");
  assert.equal(updated.clients[0].status, "ATIVO");
});

test("overview totals include active recurring revenue and exclude canceled revenue", () => {
  const transactions = [
    { amount: 250, type: "income", status: "ATIVO", revenueKind: "monthly" },
    { amount: 100, type: "income", status: "PRAZO 3 DIAS", revenueKind: "monthly" },
    { amount: 80, type: "income", status: "EXPIRADO", revenueKind: "monthly" },
    { amount: 40, type: "income", status: "CANCELADO", revenueKind: "monthly" },
    { amount: 50, type: "income", status: "Recebido", date: "2026-10-10" },
    { amount: 25, type: "income", status: "Pendente", date: "2026-10-10" },
    { amount: 90, type: "expense", status: "Pendente", date: "2026-10-10" },
  ];

  assert.equal(getRevenueTotal(transactions), 300);
  assert.equal(getMonthlyIncome(transactions, "2026-10"), 300);
  assert.equal(getReceivableTotal(transactions), 205);
});

test("calculates saving and investing from the positive operating balance plus fixed values", () => {
  const transactions = [
    { type: "income", status: "Recebido", amount: 1000 },
    { type: "expense", status: "Pendente", amount: 250 },
  ];

  assert.deepEqual(getFinanceAllocation(transactions, {
    savingPercent: 10,
    savingFixed: 50,
    investingPercent: 20,
    investingFixed: 25,
  }), {
    operatingBalance: 750,
    saving: 125,
    investing: 175,
    total: 300,
  });
});

test("formats activity timestamps as today, yesterday, or their actual date", () => {
  const now = new Date(2026, 10, 16, 15, 0);

  assert.equal(formatActivityDate(new Date(2026, 10, 16, 9, 30), now), "Hoje, 09:30");
  assert.equal(formatActivityDate(new Date(2026, 10, 15, 9, 30), now), "Ontem, 09:30");
  assert.equal(formatActivityDate(new Date(2026, 10, 14, 9, 30), now), "14/11/2026, 09:30");
  assert.equal(formatActivityDate("invalid", now), "");
});

test("monthly outflow includes expenses and calculated saving and investment values", () => {
  const transactions = [
    { type: "income", status: "Recebido", amount: 1000, date: "2026-10-10" },
    { type: "income", status: "Pendente", amount: 500, date: "2026-10-12" },
    { type: "income", revenueKind: "monthly", status: "ATIVO", amount: 400, date: "2026-10-20" },
    { type: "expense", status: "Pago", amount: 200, date: "2026-10-15" },
    { type: "expense", status: "Pendente", amount: 50, date: "2026-11-02" },
  ];

  assert.deepEqual(getMonthlyOutflow(transactions, "2026-10", {
    savingPercent: 10,
    savingFixed: 20,
    investingPercent: 20,
    investingFixed: 30,
  }), {
    expenses: 200,
    saving: 100,
    investing: 190,
    total: 490,
  });
});

test("does not apply percentages to a negative balance and ignores invalid negative plan values", () => {
  const transactions = [
    { type: "income", status: "Recebido", amount: 100 },
    { type: "expense", amount: 200 },
  ];

  assert.deepEqual(getFinanceAllocation(transactions, {
    savingPercent: 30,
    savingFixed: 20,
    investingPercent: 150,
    investingFixed: -5,
  }), {
    operatingBalance: -100,
    saving: 20,
    investing: 0,
    total: 20,
  });
});

test("monthly income includes active recurring revenue while history uses confirmed transactions", () => {
  const transactions = [
    { amount: 250, type: "income", status: "ATIVO", revenueKind: "monthly", date: "2026-10-24" },
    { amount: 100, type: "income", status: "Recebido", date: "2026-10-10" },
  ];

  assert.equal(getMonthlyIncome(transactions, "2026-10"), 350);
  assert.equal(getConfirmedIncome(transactions, "2026-10"), 100);
  assert.equal(getConfirmedIncome(transactions, "2026-11"), 0);
});
