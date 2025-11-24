
// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// TU CONFIGURACIÓN DE FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyAT4JmFe64rHe23Rsv0heE37IqVhf95AVI",
  authDomain: "carrerasx-7fec8.firebaseapp.com",
  projectId: "carrerasx-7fec8",
  storageBucket: "carrerasx-7fec8.firebasestorage.app",
  messagingSenderId: "80002686454",
  appId: "1:80002686454:web:1b154a10cf63b5d071fbd7",
  measurementId: "G-6F3DP6SBDD"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };

