import { collection, deleteDoc, doc, getDoc, getFirestore, onSnapshot, query, runTransaction, setDoc, updateDoc } from "firebase/firestore";
import { firebaseApp } from "./firebase.js";
import { createCompanyMembership } from "./membership.js";

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

function getCompanyServicesCollection(database, companyId) {
  return collection(database, COMPANIES_COLLECTION, companyId, "services");
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
    if (companySnapshot.exists()) {
      const data = validateData(companySnapshot.data());
      if (data.services.length) {
        const servicesCollection = getCompanyServicesCollection(database, getCompanyId(membershipSnapshot.data()));
        const servicesSnapshot = await transaction.get(query(servicesCollection));
        const existingIds = new Set(servicesSnapshot.docs.map((serviceSnapshot) => serviceSnapshot.id));
        for (const service of data.services) {
          const serviceId = typeof service.id === "string" && service.id ? service.id : `service-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
          if (!existingIds.has(serviceId)) {
            transaction.set(doc(servicesCollection, serviceId), { ...service, id: serviceId });
          }
        }
        const migratedData = { ...data, services: [] };
        transaction.set(companyDocument, migratedData);
        return migratedData;
      }
      return data;
    }

    const legacySnapshot = await transaction.get(legacyDocument);
    const initialData = legacySnapshot.exists()
      ? validateData(legacySnapshot.data())
      : loadFallback();
    const { services = [], ...companyData } = initialData;
    transaction.set(companyDocument, { ...companyData, services: [] });
    for (const service of services) {
      const serviceId = typeof service.id === "string" && service.id ? service.id : `service-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
      transaction.set(doc(getCompanyServicesCollection(database, getCompanyId(membershipSnapshot.data())), serviceId), { ...service, id: serviceId });
    }
    createdCompanyData = true;
    return initialData;
  });

  if (createdCompanyData) afterMigration(uid);
  return data;
}

export async function createCloudService(uid, service) {
  if (!uid) throw new Error("Não há uma sessão autenticada para cadastrar o serviço.");
  const database = getDatabase();
  const membershipSnapshot = await getDoc(doc(database, MEMBERSHIPS_COLLECTION, uid));
  if (!membershipSnapshot.exists()) throw new Error("Esta conta não está vinculada a uma empresa.");
  const servicesCollection = getCompanyServicesCollection(database, getCompanyId(membershipSnapshot.data()));
  await setDoc(doc(servicesCollection, service.id), service);
}

export async function updateCloudService(uid, serviceId, changes) {
  if (!uid) throw new Error("Não há uma sessão autenticada para atualizar o serviço.");
  const database = getDatabase();
  const membershipSnapshot = await getDoc(doc(database, MEMBERSHIPS_COLLECTION, uid));
  if (!membershipSnapshot.exists()) throw new Error("Esta conta não está vinculada a uma empresa.");
  const serviceDocument = doc(getCompanyServicesCollection(database, getCompanyId(membershipSnapshot.data())), serviceId);
  await updateDoc(serviceDocument, changes);
}

export async function deleteCloudService(uid, serviceId) {
  if (!uid) throw new Error("Não há uma sessão autenticada para excluir o serviço.");
  const database = getDatabase();
  const membershipSnapshot = await getDoc(doc(database, MEMBERSHIPS_COLLECTION, uid));
  if (!membershipSnapshot.exists()) throw new Error("Esta conta não está vinculada a uma empresa.");
  await deleteDoc(doc(getCompanyServicesCollection(database, getCompanyId(membershipSnapshot.data())), serviceId));
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
      transaction.set(newMembership, createCompanyMembership(companyId, member.role, member.name));
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

export async function deleteCloudTeamMember(currentUid, memberUid, update, validateData) {
  if (!currentUid) throw new Error("Não há uma sessão autenticada para gerenciar a equipe.");
  if (!memberUid) throw new Error("Este membro não possui um UID Firebase associado. Remova a conta antiga pelo Firebase Console.");

  const database = getDatabase();
  const managerMembership = doc(database, MEMBERSHIPS_COLLECTION, currentUid);
  const memberMembership = doc(database, MEMBERSHIPS_COLLECTION, memberUid);

  return runTransaction(database, async (transaction) => {
    const managerSnapshot = await transaction.get(managerMembership);
    const memberSnapshot = await transaction.get(memberMembership);
    if (!managerSnapshot.exists()) throw new Error("Seu usuário não possui uma associação de empresa.");
    const managerData = managerSnapshot.data();
    if (managerData.active !== true || managerData.canManageUsers !== true) {
      throw new Error("Sua conta não tem permissão para remover usuários da equipe.");
    }

    const companyId = getCompanyId(managerData);
    if (!memberSnapshot.exists()) throw new Error("O vínculo Firebase deste membro não foi encontrado.");
    if (getCompanyId(memberSnapshot.data()) !== companyId) {
      throw new Error("Este membro não pertence à empresa vinculada à sua conta.");
    }

    const companyDocument = getCompanyDocument(database, companyId);
    const companySnapshot = await transaction.get(companyDocument);
    if (!companySnapshot.exists()) throw new Error("Os dados compartilhados da empresa não foram encontrados.");

    const current = validateData(companySnapshot.data());
    const next = update(current);
    if (next === current) throw new Error("O membro não foi encontrado na equipe da empresa.");

    transaction.set(companyDocument, next);
    transaction.delete(memberMembership);
    return next;
  });
}

export async function updateCloudProfilePhoto(uid, photoUrl) {
  if (!uid) throw new Error("Não há uma sessão autenticada para atualizar o perfil.");
  const database = getDatabase();
  const membershipDocument = doc(database, MEMBERSHIPS_COLLECTION, uid);
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(membershipDocument);
    if (!snapshot.exists()) throw new Error("O vínculo de empresa desta conta não foi encontrado.");
    transaction.update(membershipDocument, { photoUrl });
  });
}

export function subscribeCloudData(uid, onData, onError, validateData, onMembership = () => {}) {
  if (!uid) throw new Error("Não há uma sessão autenticada para acompanhar os dados.");
  const database = getDatabase();
  const membershipDocument = doc(database, MEMBERSHIPS_COLLECTION, uid);
  let unsubscribeCompany = () => {};
  let unsubscribeServices = () => {};
  let active = true;
  let companyData = null;
  let companyServices = null;

  function publishData() {
    if (!companyData || companyServices === null) return;
    onData(validateData({ ...companyData, services: companyServices }));
  }

  const unsubscribeMembership = onSnapshot(membershipDocument, (membershipSnapshot) => {
    if (!active) return;
    if (!membershipSnapshot.exists()) {
      const error = new Error("O vínculo desta conta com a empresa foi removido.");
      error.code = "membership/not-found";
      onError(error);
      return;
    }
    onMembership(membershipSnapshot.data());
    let companyDocument;
    try {
      companyDocument = getCompanyDocument(database, getCompanyId(membershipSnapshot.data()));
    } catch (error) {
      onError(error);
      return;
    }

    unsubscribeCompany();
    unsubscribeServices();
    companyData = null;
    companyServices = null;
    unsubscribeCompany = onSnapshot(companyDocument, (companySnapshot) => {
      if (!active) return;
      if (!companySnapshot.exists()) {
        onError(new Error("Os dados compartilhados da empresa não foram encontrados no Firestore."));
        return;
      }
      try {
        companyData = validateData(companySnapshot.data());
        if (companyServices === null && companyData.services.length) companyServices = companyData.services;
        publishData();
      } catch (error) {
        onError(error);
      }
    }, onError);
    const servicesCollection = getCompanyServicesCollection(database, getCompanyId(membershipSnapshot.data()));
    unsubscribeServices = onSnapshot(servicesCollection, (servicesSnapshot) => {
      if (!active) return;
      companyServices = servicesSnapshot.docs.map((serviceSnapshot) => ({ ...serviceSnapshot.data(), id: serviceSnapshot.id }));
      publishData();
    }, onError);
  }, onError);

  return () => {
    active = false;
    unsubscribeMembership();
    unsubscribeCompany();
    unsubscribeServices();
  };
}
