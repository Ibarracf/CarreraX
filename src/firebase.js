// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// --- TU CONFIGURACIÓN REAL DE FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyAT4JmFe64rHe23Rsv0heE37IqVhf95AVI",
  authDomain: "carrerasx-7fec8.firebaseapp.com",
  projectId: "carrerasx-7fec8",
  storageBucket: "carrerasx-7fec8.firebasestorage.app",
  messagingSenderId: "80002686454",
  appId: "1:80002686454:web:1b154a10cf63b5d071fbd7",
  measurementId: "G-6F3DP6SBDD"
};

// --- Inicializar App y Servicios ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Login anónimo automático (para que App.jsx funcione sin tokens externos) ---
signInAnonymously(auth).catch(err => {
  console.error("Error al iniciar sesión anónima:", err);
});

export { app, auth, db };
