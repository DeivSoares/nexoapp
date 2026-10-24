export function getUserProfile(user, data, membership) {
  const teamMember = data?.team?.find((member) => member.authUid === user?.uid);
  const accountUsername = user?.email?.split("@")[0];
  const name = [teamMember?.name, membership?.usuario, user?.displayName, accountUsername]
    .find((candidate) => typeof candidate === "string" && candidate.trim()) || "Usuário";
  const label = name.trim();

  return {
    name: label,
    privilege: teamMember?.role?.trim() || (membership?.canManageUsers ? "Administrador" : "Membro"),
    photoUrl: membership?.photoUrl || "",
    initials: label.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "U",
  };
}

export function validateProfilePhotoUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Informe uma URL válida para a foto.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("A URL da foto deve começar com http:// ou https://.");
  }
  if (trimmed.length > 2048) throw new Error("A URL da foto deve ter no máximo 2048 caracteres.");
  return url.toString();
}
