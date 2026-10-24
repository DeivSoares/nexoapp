import test from "node:test";
import assert from "node:assert/strict";
import { createCompanyMembership } from "./membership.js";

test("creates active company membership with user-management permission only for administrators", () => {
  assert.deepEqual(createCompanyMembership("dvs-web", "Administrador", "Maria Silva"), {
    companyId: "dvs-web",
    active: true,
    canManageUsers: true,
    usuario: "Maria Silva",
  });

  assert.deepEqual(createCompanyMembership("dvs-web", "Operações", "João Lima"), {
    companyId: "dvs-web",
    active: true,
    canManageUsers: false,
    usuario: "João Lima",
  });
});
