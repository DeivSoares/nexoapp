import { getAuth } from "firebase/auth";
import { initializeApp } from "firebase/app";

const env = import.meta.env || {};
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const requiredConfig = ["apiKey", "authDomain", "projectId", "appId"];
const missingConfig = requiredConfig.filter((key) => !firebaseConfig[key]);

export const firebaseConfigured = missingConfig.length === 0;
export const firebaseApp = firebaseConfigured
  ? initializeApp(firebaseConfig)
  : null;
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
