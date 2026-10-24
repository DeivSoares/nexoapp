export function createCompanyMembership(companyId, role, name) {
  return {
    companyId,
    active: true,
    canManageUsers: role === "Administrador",
    usuario: name,
  };
}
