import { createUserWithEmailAndPassword, deleteUser, getAuth, signOut } from "firebase/auth";
import { getApps, initializeApp } from "firebase/app";
import { firebaseApp } from "./firebase.js";
import { usernameToFirebaseEmail } from "./auth.js";

const PROVISIONING_APP_NAME = "nexo-user-provisioning";
let provisioningAuth;

function getProvisioningAuth() {
  if (!firebaseApp) throw new Error("O Firebase não está configurado. Confira as variáveis do projeto.");
  if (!provisioningAuth) {
    const app = getApps().find((item) => item.name === PROVISIONING_APP_NAME)
      || initializeApp(firebaseApp.options, PROVISIONING_APP_NAME);
    provisioningAuth = getAuth(app);
  }
  return provisioningAuth;
}

export async function createProvisioningAccount(username, password) {
  const auth = getProvisioningAuth();
  const email = usernameToFirebaseEmail(username, firebaseApp.options.projectId);
  const credential = await createUserWithEmailAndPassword(auth, email, password);

  return {
    uid: credential.user.uid,
    cleanup: () => deleteUser(credential.user),
    disconnect: () => signOut(auth),
  };
}
