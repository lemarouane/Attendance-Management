import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyB8hPzFmge5GKzgjzMAGBXk4cRMWN5pPn4",
  authDomain: "ensat-checkingv2.firebaseapp.com",
  projectId: "ensat-checkingv2",
  storageBucket: "ensat-checkingv2.firebasestorage.app",
  messagingSenderId: "209977699509",
  appId: "1:209977699509:web:2d55e7f41c61446c8be2fc",
  measurementId: "G-5YLMLDV8EL"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
