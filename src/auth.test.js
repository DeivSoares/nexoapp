import test from "node:test";
import assert from "node:assert/strict";
import { usernameToFirebaseEmail } from "./auth.js";

test("maps normalized usernames to the Firebase project email", () => {
  assert.equal(
    usernameToFirebaseEmail(" Maria.Silva ", "nexoapp-b090f"),
    "maria.silva@nexoapp-b090f.firebaseapp.com",
  );
});

test("rejects usernames outside the supported format", () => {
  for (const username of ["ab", "with space", "maria@company.com", "usuário"]) {
    assert.throws(() => usernameToFirebaseEmail(username, "nexoapp-b090f"));
  }
});

test("rejects an invalid Firebase project ID", () => {
  assert.throws(() => usernameToFirebaseEmail("maria", "invalid/project"));
});
