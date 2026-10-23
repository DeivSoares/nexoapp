const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export function usernameToFirebaseEmail(username, projectId) {
  const normalizedUsername = username.trim().toLocaleLowerCase("en-US");
  if (!USERNAME_PATTERN.test(normalizedUsername)) {
    throw new Error("Use de 3 a 64 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.");
  }
  if (!/^[a-z0-9-]+$/.test(projectId)) {
    throw new Error("O ID do projeto Firebase está inválido.");
  }
  return `${normalizedUsername}@${projectId}.firebaseapp.com`;
}
