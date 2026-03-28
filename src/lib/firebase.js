import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAXEDh3wb2qZ9qO5VrbV4VhStlqMUf7vmg",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "newproject-fbb7e.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://newproject-fbb7e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "newproject-fbb7e",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "newproject-fbb7e.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "726576406795",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:726576406795:web:a083e42e09e91a4505020e"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);
