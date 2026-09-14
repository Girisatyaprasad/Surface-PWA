import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const required = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

export function firebaseConfigError(): string | null {
  const missing = Object.entries(required)
    .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
    .map(([key]) => key);
  if (required.projectId !== 'adms-by-giri') missing.push('projectId must be adms-by-giri');
  if (required.storageBucket !== 'adms-by-giri.firebasestorage.app') missing.push('storageBucket must be adms-by-giri.firebasestorage.app');
  return missing.length ? `Firebase configuration is incomplete: ${missing.join(', ')}` : null;
}

export function getSurfaceAuth() {
  const error = firebaseConfigError();
  if (error) throw new Error(error);
  const app = getApps().length ? getApp() : initializeApp(required);
  const auth = getAuth(app);
  void setPersistence(auth, browserLocalPersistence);
  return auth;
}

export function getSurfaceFirebase() {
  const error = firebaseConfigError();
  if (error) throw new Error(error);
  const app = getApps().length ? getApp() : initializeApp(required);
  const auth = getAuth(app);
  void setPersistence(auth, browserLocalPersistence);
  return { app, auth, firestore: getFirestore(app) };
}
