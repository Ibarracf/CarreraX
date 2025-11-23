import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Credenciales proporcionadas por el usuario.
const firebaseConfig = {
  apiKey: "AIzaSyAT4JmFe64rHe23Rsv0heE37IqVhf95AVI",
    authDomain: "carrerasx-7fec8.firebaseapp.com",
      projectId: "carrerasx-7fec8",
        storageBucket: "carrerasx-7fec8.firebasestorage.app",
          messagingSenderId: "80002686454",
            appId: "1:80002686454:web:1b154a10cf63b5d071fbd7",
              measurementId: "G-6F3DP6SBDD"
              };

              // Inicializa la aplicación de Firebase
              const app = initializeApp(firebaseConfig);

              // Exporta los servicios que usará la aplicación
              export const auth = getAuth(app);
              export const db = getFirestore(app);