import { doc, getDoc, getFirestore, onSnapshot, runTransaction } from "firebase/firestore";
import { firebaseApp } from "./firebase.js";

const MEMBERSHIPS_COLLECTION = "companyMemberships";
const COMPANIES_COLLECTION = "companies";
const LEGACY_COLLECTION = "nexoUsers";

function getDatabase() {
  if (!firebaseApp) throw new Error("O Firebase não está configurado. Confira as variáveis do projeto.");
  return getFirestore(firebaseApp);
}

function getCompanyId(membership) {
  const companyId = membership?.companyId;
  if (typeof companyId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(companyId)) {
    throw new Error("Esta conta ainda não está vinculada a uma empresa. Peça ao administrador para criar o vínculo em companyMemberships no Firestore.");
  }
  return companyId;
}

function getCompanyDocument(database, companyId) {
  return doc(database, COMPANIES_COLLECTION, companyId, "data", "main");
}

export async function loadCloudData(uid, loadFallback, afterMigration, validateData) {
  if (!uid) throw new Error("Não há uma sessão autenticada para carregar os dados.");
  const database = getDatabase();
  const membershipDocument = doc(database, MEMBERSHIPS_COLLECTION, uid);
  const legacyDocument = doc(database, LEGACY_COLLECTION, uid);
  let createdCompanyData = false;

  const data = await runTransaction(database, async (transaction) => {
    createdCompanyData = false;
    const membershipSnapshot = await transaction.get(membershipDocument);
    if (!membershipSnapshot.exists()) {
      throw new Error("Esta conta ainda não está vinculada a uma empresa. Peça ao administrador para criar o vínculo em companyMemberships no Firestore.");
    }

    const companyDocument = getCompanyDocument(database, getCompanyId(membershipSnapshot.data()));
    const companySnapshot = await transaction.get(companyDocument);
    if (companySnapshot.exists()) return validateData(companySnapshot.data());

    const legacySnapshot = await transaction.get(legacyDocument);
    const initialData = legacySnapshot.exists()
      ? validateData(legacySnapshot.data())
      : loadFallback();
    transaction.set(companyDocument, initialData);
    createdCompanyData = true;
    return initialData;
  });

  if (createdCompanyData) afterMigration(uid);
  return data;
}

export async function updateCloudData(uid, update, validateData) {
  if (!uid) throw new Error("Não há uma sessão autenticada para salvar os dados.");
  const database = getDatabase();
  const membershipDocument = doc(database, MEMBERSHIPS_COLLECTION, uid);

  return runTransaction(database, async (transaction) => {
    const membershipSnapshot = await transaction.get(membershipDocument);
    if (!membershipSnapshot.exists()) {
      throw new Error("Esta conta não está vinculada a uma empresa. Peça ao administrador para configurar companyMemberships no Firestore.");
    }
    const companyDocument = getCompanyDocument(database, getCompanyId(membershipSnapshot.data()));
    const companySnapshot = await transaction.get(companyDocument);
    if (!companySnapshot.exists()) throw new Error("Os dados da empresa ainda não foram inicializados no Firestore.");

    const current = validateData(companySnapshot.data());
    const next = update(current);
    if (next === current) return { data: current, changed: false };
    transaction.set(companyDocument, next);
    return { data: next, changed: true };
  });
}

export async function createCloudTeamMember(currentUid, username, password, member, update, validateData) {
  if (!currentUid) throw new Error("Não há uma sessão autenticada para gerenciar a equipe.");
  const database = getDatabase();
  const managerMembership = doc(database, MEMBERSHIPS_COLLECTION, currentUid);
  const managerSnapshot = await getDoc(managerMembership);
  if (!managerSnapshot.exists()) throw new Error("Seu usuário não possui uma associação de empresa.");
  const managerData = managerSnapshot.data();
  if (managerData.active !== true || managerData.canManageUsers !== true) {
    throw new Error("Sua conta não tem permissão para criar usuários. Peça ao administrador para habilitar canManageUsers no vínculo do seu UID.");
  }
  const companyId = getCompanyId(managerData);
  const { createProvisioningAccount } = await import("./teamAuth.js");
  const account = await createProvisioningAccount(username, password);

  try {
    const newUid = account.uid;
    const newMembership = doc(database, MEMBERSHIPS_COLLECTION, newUid);
    const { data } = await runTransaction(database, async (transaction) => {
      const managerSnapshot = await transaction.get(managerMembership);
      if (!managerSnapshot.exists()) throw new Error("Seu usuário não possui uma associação de empresa.");
      const managerData = managerSnapshot.data();
      if (managerData.active !== true || managerData.canManageUsers !== true) {
        throw new Error("Sua conta não tem permissão para criar usuários. Peça ao administrador para habilitar canManageUsers no vínculo do seu UID.");
      }
      if (getCompanyId(managerData) !== companyId) throw new Error("A empresa vinculada à sua conta foi alterada durante o cadastro.");
      const companyDocument = getCompanyDocument(database, companyId);
      const companySnapshot = await transaction.get(companyDocument);
      if (!companySnapshot.exists()) throw new Error("Os dados compartilhados da empresa não foram inicializados.");

      const current = validateData(companySnapshot.data());
      const next = update(current, { ...member, authUid: newUid });
      transaction.set(newMembership, {
        companyId,
        active: true,
        canManageUsers: false,
      });
      transaction.set(companyDocument, next);
      return { data: next };
    });
    return { data, uid: newUid, username: username.trim().toLocaleLowerCase("en-US") };
  } catch (error) {
    try {
      await account.cleanup();
    } catch (cleanupError) {
      console.error("Não foi possível remover a conta Firebase criada sem vínculo de empresa.", cleanupError);
      throw new Error(`A conta Firebase foi criada, mas não foi vinculada à empresa e não pôde ser removida automaticamente. Erro do vínculo: ${error.message} Remova a conta órfã em Authentication > Users antes de tentar novamente.`, { cause: error });
    }
    throw error;
  } finally {
    try {
      await account.disconnect();
    } catch (error) {
      console.error("A conta secundária de provisionamento não pôde ser desconectada.", error);
    }
  }
}

export function subscribeCloudData(uid, onData, onError, validateData) {
  if (!uid) throw new Error("Não há uma sessão autenticada para acompanhar os dados.");
  const database = getDatabase();
  const membershipDocument = doc(database, MEMBERSHIPS_COLLECTION, uid);
  let unsubscribeCompany = () => {};
  let active = true;

  const unsubscribeMembership = onSnapshot(membershipDocument, (membershipSnapshot) => {
    if (!active) return;
    if (!membershipSnapshot.exists()) {
      onError(new Error("Esta conta não está vinculada a uma empresa. Peça ao administrador para configurar companyMemberships no Firestore."));
      return;
    }
    let companyDocument;
    try {
      companyDocument = getCompanyDocument(database, getCompanyId(membershipSnapshot.data()));
    } catch (error) {
      onError(error);
      return;
    }

    unsubscribeCompany();
    unsubscribeCompany = onSnapshot(companyDocument, (companySnapshot) => {
      if (!active) return;
      if (!companySnapshot.exists()) {
        onError(new Error("Os dados compartilhados da empresa não foram encontrados no Firestore."));
        return;
      }
      try {
        onData(validateData(companySnapshot.data()));
      } catch (error) {
        onError(error);
      }
    }, onError);
  }, onError);

  return () => {
    active = false;
    unsubscribeMembership();
    unsubscribeCompany();
  };
}
