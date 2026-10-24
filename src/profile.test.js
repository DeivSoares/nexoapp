import test from "node:test";
import assert from "node:assert/strict";
import { getUserProfile, validateProfilePhotoUrl } from "./profile.js";

test("uses the team name and privilege for the signed-in member", () => {
  const profile = getUserProfile(
    { uid: "uid-1", email: "maria@project.firebaseapp.com" },
    { team: [{ authUid: "uid-1", name: "Maria Silva", role: "Financeiro" }] },
    { canManageUsers: false },
  );

  assert.equal(profile.name, "Maria Silva");
  assert.equal(profile.privilege, "Financeiro");
  assert.equal(profile.initials, "MS");
});

test("falls back to membership name and administrator permission", () => {
  const profile = getUserProfile(
    { uid: "uid-admin", email: "admin@project.firebaseapp.com" },
    { team: [] },
    { usuario: "Admin da Empresa", canManageUsers: true, photoUrl: "https://img.example/avatar.jpg" },
  );

  assert.equal(profile.name, "Admin da Empresa");
  assert.equal(profile.privilege, "Administrador");
  assert.equal(profile.photoUrl, "https://img.example/avatar.jpg");
});

test("does not fail before authentication or profile data has loaded", () => {
  const profile = getUserProfile(null, null, null);

  assert.equal(profile.name, "Usuário");
  assert.equal(profile.privilege, "Membro");
  assert.equal(profile.initials, "U");
});

test("accepts an empty photo URL to clear the profile image", () => {
  assert.equal(validateProfilePhotoUrl("  "), "");
  assert.equal(validateProfilePhotoUrl("https://example.com/avatar.png"), "https://example.com/avatar.png");
});

test("rejects invalid and non-http profile photo URLs", () => {
  assert.throws(() => validateProfilePhotoUrl("not a url"), /URL válida/);
  assert.throws(() => validateProfilePhotoUrl("javascript:alert(1)"), /http:\/\/ ou https:\/\//);
});
