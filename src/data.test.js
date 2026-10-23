import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmClientRenewal,
  isRenewalDue,
  markDueRenewalsPending,
  syncClientRevenue,
} from "./data.js";

const client = {
  id: "client-1",
  name: "Cliente Teste",
  company: "Empresa Teste",
  monthly: 250,
  entryAmount: 500,
  renewal: "2026-11-01",
};

test("creates pending monthly and fixed income entries linked to the client", () => {
  const transactions = syncClientRevenue([], client);

  assert.equal(transactions.length, 2);
  assert.deepEqual(transactions.map(({ category, amount, date, status, type }) => ({ category, amount, date, status, type })), [
    { category: "Mensalidade", amount: 250, date: "2026-11-01", status: "Pendente", type: "income" },
    { category: "Projeto", amount: 500, date: "2026-11-01", status: "Pendente", type: "income" },
  ]);
  assert.ok(transactions.every((entry) => entry.clientId === client.id));
});

test("updates linked entries while preserving their payment status and unrelated transactions", () => {
  const initial = syncClientRevenue([], client);
  initial[0].status = "Recebido";
  const updated = syncClientRevenue([...initial, { id: "manual", description: "Manual" }], {
    ...client,
    company: "Empresa Atualizada",
    monthly: 300,
    renewal: "2026-12-01",
  });

  assert.equal(updated.length, 3);
  assert.equal(updated.find((entry) => entry.revenueKind === "monthly").amount, 300);
  assert.equal(updated.find((entry) => entry.revenueKind === "monthly").status, "Recebido");
  assert.equal(updated.find((entry) => entry.revenueKind === "fixed").description, "Entrada fixa — Empresa Atualizada");
  assert.equal(updated.find((entry) => entry.revenueKind === "fixed").date, "2026-12-01");
  assert.ok(updated.some((entry) => entry.id === "manual"));
});

test("removes linked income entries when their client amounts become zero", () => {
  const initial = syncClientRevenue([], client);
  const updated = syncClientRevenue(initial, { ...client, monthly: 0, entryAmount: 0 });

  assert.deepEqual(updated, []);
});

test("marks active clients and their monthly revenue pending two days before renewal", () => {
  const dueClient = { ...client, status: "Ativo", renewal: "2026-10-25" };
  const data = { clients: [dueClient], transactions: [] };
  const today = new Date(2026, 9, 23, 12);

  assert.equal(isRenewalDue(dueClient, today), true);
  const updated = markDueRenewalsPending(data, today);

  assert.equal(updated.clients[0].status, "Pendente");
  assert.equal(updated.transactions.length, 1);
  assert.equal(updated.transactions[0].status, "Pendente");
  assert.equal(updated.transactions[0].date, dueClient.renewal);
  assert.equal(updated.transactions[0].amount, dueClient.monthly);
});

test("does not mark inactive clients or clients more than two days from renewal", () => {
  const today = new Date(2026, 9, 23, 12);
  const data = {
    clients: [
      { ...client, id: "inactive", status: "Inativo", renewal: "2026-10-24" },
      { ...client, id: "not-due", status: "Ativo", renewal: "2026-10-26" },
    ],
    transactions: [],
  };

  assert.equal(markDueRenewalsPending(data, today), data);
});

test("confirming a renewal reactivates the client, advances its date, and receives the monthly revenue", () => {
  const dueClient = { ...client, status: "Pendente", renewal: "2026-10-25" };
  const data = { clients: [dueClient], transactions: syncClientRevenue([], dueClient) };
  const updated = confirmClientRenewal(data, dueClient.id);
  const monthly = updated.transactions.find((entry) => entry.revenueKind === "monthly");

  assert.equal(updated.clients[0].status, "Ativo");
  assert.equal(updated.clients[0].renewal, "2026-11-25");
  assert.equal(monthly.status, "Recebido");
  assert.equal(monthly.date, "2026-11-25");
  assert.equal(updated.transactions.find((entry) => entry.revenueKind === "fixed").status, "Pendente");
});

test("renewal dates at month end advance to the last valid day", () => {
  const dueClient = { ...client, status: "Pendente", renewal: "2026-01-31" };
  const updated = confirmClientRenewal({ clients: [dueClient], transactions: [] }, dueClient.id);

  assert.equal(updated.clients[0].renewal, "2026-02-28");
});
