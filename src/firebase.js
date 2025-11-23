import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// --- Gestión de Configuración Global ---
// La configuración de Firebase es proporcionada como una cadena JSON.
const firebaseConfigString = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}';
let firebaseConfig = {};

try {
  // IMPORTANTE: Parsear la cadena JSON para obtener el objeto de configuración
  firebaseConfig = JSON.parse(firebaseConfigString);
} catch (e) {
  console.error("Error al analizar la configuración de Firebase:", e);
}

// 1. Inicializar la Aplicación de Firebase
const app = initializeApp(firebaseConfig);

// 2. Inicializar Servicios
const auth = getAuth(app);
const db = getFirestore(app);

// Opcional: Establecer el nivel de registro para ver logs de debug
// import { setLogLevel } from 'firebase/firestore';
// setLogLevel('debug'); 

export { auth, db, app };
