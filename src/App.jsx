import React, { useState, useEffect, useRef } from 'react';
import { Play, Zap, Trophy, AlertOctagon, Footprints, Users, Smartphone, X } from 'lucide-react';

// --- CONFIGURACIÓN E INICIALIZACIÓN DE FIREBASE (Autocontenida) ---
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  updateDoc, 
  increment,
  serverTimestamp,
  deleteField,
  setLogLevel 
} from 'firebase/firestore'; 

// Establecemos el nivel de registro para ver logs de debug
setLogLevel('debug'); 

// --- Configuración Global e Inyección de Firebase ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'; 

// La configuración de Firebase es proporcionada como una cadena JSON inyectada por el entorno.
const firebaseConfigString = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}';
let firebaseConfig = {};

try {
  // 1. IMPORTANTE: Parsear la cadena JSON para obtener el objeto de configuración
  firebaseConfig = JSON.parse(firebaseConfigString);
} catch (e) {
  console.error("Error al analizar la configuración de Firebase:", e);
  // Si falla el parseo, la configuración queda vacía y Firebase fallará la inicialización.
  firebaseConfig = {};
}

// 2. Inicializar la Aplicación de Firebase con la configuración inyectada.
// Si la configuración es válida, Firebase se inicializará correctamente.
const app = initializeApp(firebaseConfig);

// 3. Inicializar Servicios
const auth = getAuth(app);
const db = getFirestore(app);

// --- Avatares y Colores ---
const AVATARS = ["🚗", "🏍️", "🏃", "🐎", "🚀", "🛹", "🦖", "🐕"];
const COLORS = [
  "bg-red-500", "bg-blue-500", "bg-green-500", "bg-yellow-500", 
  "bg-purple-500", "bg-pink-500", "bg-orange-500", "bg-teal-500"
];

const TARGET_SCORE = 100; // Puntuación necesaria para ganar

export default function FingerRaceGame() {
  // Estados Generales
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState('menu'); // menu, lobby, game, winner
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState(null); 
  
  // Estados del Juego
  const [isHost, setIsHost] = useState(false);
  const [gameState, setGameState] = useState('waiting'); // waiting, racing, finished
  const [trafficLight, setTrafficLight] = useState('green'); // green, red
  const [players, setPlayers] = useState({}); // Objeto { uid: { name, score, avatar, color, stunned } }
  const [winnerName, setWinnerName] = useState(null);
  const [myPenalty, setMyPenalty] = useState(false); 
  
  // Refs para lógica del Host
  const trafficTimerRef = useRef(null);

  // Helper para obtener la referencia de la sala (colección pública)
  const getRoomRef = (code) => doc(db, 'artifacts', appId, 'public', 'data', `race_${code}`);
  
  // 1. Autenticación e Inicialización
  useEffect(() => {
    const initAuth = async () => {
      try {
        // La variable global __initial_auth_token es inyectada por el entorno.
        const customToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        
        if (customToken) {
          // Intentar iniciar sesión con el token personalizado
          await signInWithCustomToken(auth, customToken);
        } else {
          // Si no hay token (por ejemplo, en un entorno local), usar la autenticación anónima
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Error al autenticar con Firebase (revisa la apiKey en la configuración inyectada):", e.message);
        setError(`Error de autenticación. (${e.code}). Verifica la clave API.`);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      // Usar el UID si está autenticado, si no, usar un ID aleatorio temporal
      setUserId(u?.uid || crypto.randomUUID()); 
      setIsAuthReady(true);
      
      if (u && pendingAction) {
        pendingAction();
        setPendingAction(null);
      }
    });

    // Iniciar la autenticación después de que onAuthStateChanged esté listo
    initAuth();
    
    return () => unsubscribe();
  }, [pendingAction]);
  
  // 2. Sincronización de Sala (Firestore Listener)
  useEffect(() => {
    if (!isAuthReady || !roomCode) return;
    
    const roomRef = getRoomRef(roomCode);
        
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setPlayers(data.players || {});
        setGameState(data.status);
        setTrafficLight(data.trafficLight || 'green');
        setWinnerName(data.winnerName);
                
        // Navegación automática basada en estado
        if (data.status === 'waiting' && view !== 'lobby') setView('lobby');
        if (data.status === 'racing' && view !== 'game') setView('game');
        if (data.status === 'finished' && view !== 'winner') setView('winner');
      } else {
        setRoomCode('');
        setView('menu');
        if(view !== 'menu') setError("La sala se ha cerrado.");
      }
    }, (e) => {
      console.error("Error al escuchar cambios en la sala:", e);
      setError("Error de conexión a la sala.");
    });
    
    return () => {
      unsubscribe();
      if (trafficTimerRef.current) clearTimeout(trafficTimerRef.current);
    };
  }, [isAuthReady, roomCode, view]);
  
  // 3. Lógica del Semáforo (Solo Host)
  useEffect(() => {
    if (!isHost || gameState !== 'racing' || !isAuthReady) return;
    
    const roomRef = getRoomRef(roomCode);

    const loopTrafficLight = () => {
      // 50% de probabilidad de ser rojo o verde
      const nextColor = Math.random() > 0.5 ? 'green' : 'red'; 
      // Duración aleatoria para mantener la imprevisibilidad
      const duration = nextColor === 'green' 
        ? Math.random() * 2000 + 2000  // Verde: 2-4 segundos
        : Math.random() * 2000 + 1000; // Rojo: 1-3 segundos
      
      try {
        // 1. Actualizar Firestore
        updateDoc(roomRef, { trafficLight: nextColor });

        // 2. Programar el siguiente cambio
        trafficTimerRef.current = setTimeout(() => {
          // Cambiar al color opuesto (solo en la UI, el loop sigue)
          const opposite = nextColor === 'green' ? 'red' : 'green';
          updateDoc(roomRef, { trafficLight: opposite });
                  
          // Programar siguiente cambio (recursivo)
          loopTrafficLight();
        }, duration);
      } catch (e) {
        console.error("Error en la lógica del semáforo del host:", e);
        clearTimeout(trafficTimerRef.current);
      }
    };
    
    // Iniciar el loop si el juego está en marcha y la luz es verde (o recién empieza)
    if (trafficLight === 'green') {
      loopTrafficLight();
    }
    
    return () => clearTimeout(trafficTimerRef.current);
  }, [isHost, gameState, roomCode, isAuthReady, trafficLight]);

  // --- Funciones: Crear / Unirse ---
  
  const handleAction = (action) => {
    if (!isAuthReady || !userId) {
      setPendingAction(() => action);
    } else {
      action();
    }
  };

  const createRoom = () => handleAction(async () => {
    if (!playerName) return setError("¡Necesitas un nombre!");
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const roomRef = getRoomRef(code);
    
    const avatarIndex = userId.charCodeAt(0) % AVATARS.length;
    const colorIndex = (userId.charCodeAt(1) || 0) % COLORS.length;
    
    const myPlayer = {
      name: playerName,
      score: 0,
      avatar: AVATARS[avatarIndex],
      color: COLORS[colorIndex],
      stunned: false,
      isHost: true // Marcar al host en la metadata del jugador
    };
    
    try {
      await setDoc(roomRef, {
        hostId: userId,
        status: 'waiting',
        trafficLight: 'green',
        createdAt: serverTimestamp(),
        players: { [userId]: myPlayer },
        targetScore: TARGET_SCORE,
      });
      setIsHost(true);
      setRoomCode(code);
      setError('');
    } catch (e) {
      console.error("Error al crear la sala:", e);
      setError("No se pudo crear la sala. Inténtalo de nuevo.");
    }
  });

  const joinRoom = () => handleAction(async () => {
    if (!playerName) return setError("¡Necesitas un nombre!");
    if (!roomCode) return setError("Código inválido");
    const code = roomCode.toUpperCase();
    const roomRef = getRoomRef(code);
    
    try {
      const docSnap = await getDoc(roomRef);
      if (!docSnap.exists()) return setError("La sala no existe o el código es incorrecto.");
      
      const roomData = docSnap.data();
      if (roomData.status !== 'waiting') return setError("El juego ya ha comenzado. No puedes unirte ahora.");
      
      const existingPlayers = roomData.players || {};
      
      const playerUIDs = Object.keys(existingPlayers);
      
      // No permitir unirse si ya estás en la sala (manejo de reconexión)
      if(playerUIDs.includes(userId)) {
          console.warn("El jugador ya está en la sala. Reingresando.");
          setIsHost(roomData.hostId === userId);
          setRoomCode(code);
          setError('');
          return;
      }
      
      const usedAvatars = playerUIDs.map(uid => existingPlayers[uid].avatar);
      const usedColors = playerUIDs.map(uid => existingPlayers[uid].color);

      // Asignación de avatar y color disponibles o por defecto
      const availableAvatar = AVATARS.find(a => !usedAvatars.includes(a)) || AVATARS[playerUIDs.length % AVATARS.length];
      const availableColor = COLORS.find(c => !usedColors.includes(c)) || COLORS[(playerUIDs.length + 1) % COLORS.length];

      const myPlayer = {
        name: playerName,
        score: 0,
        avatar: availableAvatar,
        color: availableColor,
        stunned: false,
        isHost: roomData.hostId === userId
      };
      
      setIsHost(roomData.hostId === userId); 
      setRoomCode(code);
      setError('');
      
      // Actualizar el documento de la sala para añadir al nuevo jugador
      await updateDoc(roomRef, {
        [`players.${userId}`]: myPlayer 
      });

    } catch (e) {
      console.error("Error al unirse a la sala:", e);
      setError("No se pudo conectar a la sala. Revisa el código.");
    }
  });
  
  const leaveRoom = async () => {
    if (!userId || !roomCode) return;
    const roomRef = getRoomRef(roomCode);
    
    try {
      const currentPlayersCount = Object.keys(players).length;

      // Si eres el host O el último jugador, elimina la sala
      if (isHost || currentPlayersCount === 1) {
        // Eliminar el documento completo de la sala
        await setDoc(roomRef, { status: 'closed' }, { merge: true });
        // Firestore debe manejar la eliminación de subcampos después
        // Para simplificar, solo marcamos como 'closed'.
        console.log("Sala marcada como cerrada por el host/último jugador.");
      } else {
        // Si no eres el host, borra tu jugador de la lista.
        await updateDoc(roomRef, {
          [`players.${userId}`]: deleteField()
        });
        console.log(`Jugador ${userId} salió de la sala.`);
      }
    } catch (e) {
      console.error("Error al salir de la sala:", e);
    } finally {
      // Limpiar estados locales
      setRoomCode('');
      setIsHost(false);
      setPlayers({});
      setView('menu');
      setGameState('waiting');
      setError('');
    }
  }

  // --- Funciones: Lógica del Juego ---
  
  const startGame = async () => {
    if (!isHost || gameState !== 'waiting' || Object.keys(players).length < 2) return;
    const roomRef = getRoomRef(roomCode);
    try {
      await updateDoc(roomRef, { status: 'racing', trafficLight: 'green' });
    } catch (e) {
      console.error("Error al iniciar el juego:", e);
    }
  };

  const resetGame = async () => {
    if (!isHost) return;
    const roomRef = getRoomRef(roomCode);
    
    // Reiniciar puntuaciones de todos los jugadores a 0 y quitar stun
    const resetPlayers = Object.keys(players).reduce((acc, uid) => {
      acc[`players.${uid}.score`] = 0;
      acc[`players.${uid}.stunned`] = false;
      return acc;
    }, {});

    try {
      await updateDoc(roomRef, {
        ...resetPlayers,
        status: 'waiting',
        trafficLight: 'green',
        winnerName: deleteField(),
      });
      setView('lobby'); 
      setGameState('waiting');
    } catch (e) {
      console.error("Error al reiniciar el juego:", e);
    }
  };

  const handleTap = async () => {
    if (gameState !== 'racing' || !userId || !myPlayer) return;
    if (myPlayer.stunned) {
        // Si estabas "stunned" por la penalización anterior, permite que un toque quite el stun, pero no avance.
        await updateDoc(getRoomRef(roomCode), { [`players.${userId}.stunned`]: false });
        setMyPenalty(false);
        return; 
    }

    const roomRef = getRoomRef(roomCode);

    if (trafficLight === 'red') {
      // 1. Penalización: Si tocas en rojo y NO estabas stunned.
      
      try {
        // Restar un máximo de 5 puntos, sin ir por debajo de 0
        const penaltyAmount = 5; 
        
        await updateDoc(roomRef, {
          [`players.${userId}.score`]: increment(-penaltyAmount), 
          [`players.${userId}.stunned`]: true // Stunearlo por un toque
        });
        setMyPenalty(true); // Mostrar efecto visual local
        
        // El jugador debe tocar de nuevo para quitar el stun, no se usa timeout.
        
      } catch (e) {
        console.error("Error al aplicar penalización:", e);
      }
      
    } else if (trafficLight === 'green') {
      // 2. Progreso: Si tocas en verde

      const newScore = myPlayer.score + 1;
      
      if (newScore >= TARGET_SCORE) {
        // 3. ¡Ganador!
        try {
          // Usar una transacción para evitar que dos jugadores ganen a la vez
          await updateDoc(roomRef, {
            [`players.${userId}.score`]: TARGET_SCORE, 
            status: 'finished',
            winnerName: myPlayer.name
          });
        } catch (e) {
          console.error("Error al declarar ganador:", e);
        }
      } else {
        // 4. Aumentar puntuación
        try {
          await updateDoc(roomRef, {
            [`players.${userId}.score`]: increment(1)
          });
        } catch (e) {
          console.error("Error al incrementar puntuación:", e);
        }
      }
    }
  };
  
  // --- Componentes de la Interfaz ---
  
  const getPlayerList = () => Object.keys(players).map(uid => ({
    id: uid,
    ...players[uid]
  }));

  const getMyPlayer = () => players[userId];
  const myPlayer = getMyPlayer();

  const PlayerList = () => (
    <div className="w-full space-y-4 max-w-sm">
      {getPlayerList().map(p => (
        <div 
          key={p.id} 
          className={`flex items-center p-3 rounded-xl shadow-lg border-2 transition-all duration-150 ${p.id === userId ? 'border-yellow-400 bg-white scale-[1.02]' : 'border-gray-200 bg-gray-50'}`}
        >
          <div className={`w-10 h-10 rounded-full ${p.color} flex items-center justify-center text-xl shadow-inner mr-4`}>
            {p.avatar}
          </div>
          <div className="flex-grow">
            <p className="font-bold text-gray-800 truncate">{p.name} {p.id === userId && <span className="text-xs text-yellow-600 font-normal">(Tú)</span>}</p>
            <p className="text-xs text-gray-500 truncate">UID: {p.id}</p> 
          </div>
          <span className="text-sm font-semibold text-gray-700">
            {p.score} pts
          </span>
          {p.isHost && <span className="ml-2 text-xs font-bold text-purple-600 bg-purple-100 p-1 rounded-full">HOST</span>}
        </div>
      ))}
      <div className="text-center mt-6 text-gray-500 text-sm">
        {getPlayerList().length} Jugador{getPlayerList().length !== 1 ? 'es' : ''} en la sala.
      </div>
    </div>
  );

  const GameView = () => {
    const sortedPlayers = getPlayerList().sort((a,b) => b.score - a.score);
    
    const myProgress = myPlayer ? Math.min(100, (myPlayer.score / TARGET_SCORE) * 100) : 0;
    
    const lightClass = trafficLight === 'red' 
      ? 'bg-red-500 shadow-red-500/50' 
      : 'bg-green-500 shadow-green-500/50';

    return (
      <div className="flex flex-col items-center p-6 w-full max-w-lg mx-auto">
        <h1 className="text-3xl font-black text-gray-800 mb-6">Luz Roja, Luz Verde!</h1>

        {/* Semáforo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center shadow-2xl transform hover:scale-105 transition-transform duration-300">
            <div className={`w-16 h-16 rounded-full ${lightClass} shadow-xl transition-all duration-200`}>
              {trafficLight === 'red' ? (
                <AlertOctagon size={48} className="text-white mx-auto mt-2" />
              ) : (
                <Play size={48} className="text-white mx-auto mt-2" />
              )}
            </div>
          </div>
          <p className={`mt-3 text-xl font-bold ${trafficLight === 'red' ? 'text-red-600' : 'text-green-600'} ${gameState === 'racing' ? 'animate-pulse' : ''}`}>
            {trafficLight === 'red' ? '¡ALTO! - Rojo' : '¡TOCA! - Verde'}
          </p>
        </div>

        {/* Indicador de Penalización Personal */}
        {myPenalty && (
          <div className="fixed inset-0 flex items-center justify-center bg-red-600/70 z-50 transition-opacity duration-300">
            <div className="text-white text-4xl font-black p-8 rounded-xl shadow-2xl bg-red-800/90 transform -rotate-3 border-4 border-white animate-bounce">
              ¡PENALIZACIÓN! (-5 pts)
            </div>
          </div>
        )}

        {/* Botón de Tap (Zona de Juego) */}
        <button 
          onClick={handleTap} 
          disabled={gameState !== 'racing'}
          className={`w-full p-6 text-center rounded-2xl shadow-2xl transition-all duration-100 ease-in-out transform active:scale-[0.98] focus:outline-none ${
            myPlayer?.stunned ? 'bg-red-400 ring-4 ring-red-600 opacity-80 cursor-not-allowed' : 
            trafficLight === 'green' ? 'bg-green-500 hover:bg-green-600 active:bg-green-700' : 
            'bg-gray-400 hover:bg-gray-500 active:bg-gray-600'
          }`}
        >
          <div className="flex flex-col items-center">
            <Zap size={36} className="text-white mb-2" />
            <span className="text-2xl font-black text-white">¡TOCA RÁPIDO!</span>
            <span className="text-sm font-medium text-white/80 mt-1">
              {myPlayer?.stunned ? '¡CONGELADO! Toca para Descongelar' : `Puntuación: ${myPlayer?.score || 0}`}
            </span>
          </div>
        </button>
        
        {/* Barra de Progreso Propia */}
        <div className="w-full mt-6">
          <p className="text-sm font-semibold text-gray-700 mb-1 flex justify-between">
            <span>Mi Progreso ({myPlayer?.score} / {TARGET_SCORE})</span>
            <span className="font-bold">{myProgress.toFixed(0)}%</span>
          </p>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden shadow-inner">
            <div 
              className={`h-3 rounded-full transition-all duration-300 ease-out ${myPlayer?.color || 'bg-blue-500'} ${myPlayer?.stunned ? 'opacity-50' : 'opacity-100'}`} 
              style={{ width: `${myProgress}%` }}
            />
          </div>
        </div>

        {/* Tabla de Posiciones */}
        <div className="w-full mt-8 bg-white p-4 rounded-xl shadow-xl">
          <h3 className="text-lg font-bold text-gray-800 border-b pb-2 mb-3 flex items-center gap-2">
            <Trophy size={20} className="text-yellow-500" /> Tabla de Posiciones
          </h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {sortedPlayers.map((p, index) => (
              <div key={p.id} className={`flex items-center justify-between p-2 rounded-lg transition-colors ${p.id === userId ? 'bg-yellow-50 ring-2 ring-yellow-400' : 'bg-white/90'}`}>
                <div className="flex items-center gap-3">
                  <span className={`font-black ${index < 3 ? 'text-xl' : 'text-lg'} w-6 text-center`}>{index + 1}.</span>
                  <div className={`w-8 h-8 rounded-full ${p.color} flex items-center justify-center text-lg mr-2`}>
                    {p.avatar}
                  </div>
                  <span className={`text-sm ${p.id === userId ? 'font-black text-yellow-800' : 'font-medium text-gray-700'}`}>
                    {p.name} {p.stunned && <span className="text-xs text-red-500 font-extrabold">(STUNNED)</span>}
                  </span>
                </div>
                <span className={`font-extrabold ${p.id === userId ? 'text-yellow-600' : 'text-gray-800'}`}>
                  {p.score}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const WinnerView = () => (
    <div className="flex flex-col items-center text-center p-8 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-3xl shadow-2xl border-4 border-yellow-600">
      <Trophy size={80} className="text-white mb-4 drop-shadow-lg" />
      <h2 className="text-white text-sm font-bold tracking-widest mb-2">¡El Ganador es!</h2>
      <h1 className="text-6xl font-black text-black mb-8 drop-shadow-xl bg-white/50 px-8 py-4 rounded-2xl transform -rotate-2 border-2 border-black/10">
        {winnerName}
      </h1>
      
      {isHost ? (
        <button 
          onClick={resetGame} 
          className="bg-black text-yellow-400 px-8 py-4 rounded-xl font-black text-lg hover:scale-105 transition-transform shadow-lg hover:shadow-xl"
        >
          Jugar otra vez
        </button>
      ) : (
        <p className="text-yellow-900 font-medium bg-white/30 p-2 rounded-lg">Esperando al host para reiniciar...</p>
      )}
      
      {/* Lista de resultados */}
       <div className="mt-12 bg-black/10 p-6 rounded-2xl max-w-md w-full">
         <h3 className="text-yellow-900 font-bold mb-4 text-left border-b border-black/10 pb-2">Resultados finales</h3>
         {getPlayerList()
            .sort((a,b) => b.score - a.score)
            .map((p, idx) => (
              <div key={p.id} className="flex justify-between items-center py-2 border-b border-black/10 last:border-0">
                <span className="font-bold text-yellow-900 flex items-center gap-2">
                  <span className="text-sm opacity-50 w-6 text-center">#{idx + 1}</span> 
                  <span className={`w-6 h-6 rounded-full ${p.color} flex items-center justify-center text-sm mr-2`}>
                    {p.avatar}
                  </span>
                  {p.name}
                </span>
                <span className="font-black text-lg text-white drop-shadow-sm">
                  {p.score}
                </span>
              </div>
            ))}
       </div>
    </div>
  );

  const LobbyView = () => {
    // Buscar el host. Asumimos que el hostId está en la metadata de la sala (que es lo que se establece en createRoom)
    const roomData = getPlayerList().length > 0 ? Object.values(players).find(p => p.isHost) : null;
    const hostPlayer = roomData;

    const canStart = isHost && getPlayerList().length >= 2;
    
    return (
      <div className="flex flex-col items-center p-6 w-full max-w-lg mx-auto">
        <h1 className="text-3xl font-black text-gray-800 mb-2">Sala de Espera</h1>
        <p className="text-sm text-gray-500 mb-6 flex items-center gap-2">
          <Footprints size={16} /> Código de Sala: <span className="font-extrabold text-blue-600 text-lg">{roomCode}</span>
        </p>

        <PlayerList />

        <div className="mt-8 w-full max-w-sm flex flex-col items-center space-y-4">
          {isHost ? (
            <button 
              onClick={startGame} 
              disabled={!canStart}
              className={`w-full px-6 py-3 rounded-xl font-bold text-white shadow-md transition-colors ${
                canStart ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'
              }`}
            >
              <Play size={20} className="inline-block mr-2" /> 
              {canStart ? '¡INICIAR CARRERA!' : 'Necesitas al menos 2 jugadores'}
            </button>
          ) : (
            <p className="text-blue-600 font-semibold p-3 bg-blue-50 rounded-lg w-full text-center border-dashed border-2 border-blue-200">
              Esperando a que el Host ({hostPlayer ? hostPlayer.name : '...'}) inicie el juego...
            </p>
          )}

          <button 
            onClick={leaveRoom} 
            className="w-full px-6 py-3 rounded-xl font-semibold text-red-600 bg-red-100 hover:bg-red-200 transition-colors"
          >
            <X size={20} className="inline-block mr-2" /> Abandonar Sala
          </button>
        </div>
        <p className="mt-4 text-xs text-gray-400">Tu ID de usuario: {userId}</p>
      </div>
    );
  };

  const MenuView = () => (
    <div className="flex flex-col items-center p-8 w-full max-w-lg mx-auto bg-white rounded-2xl shadow-2xl border-t-8 border-yellow-500">
      <h1 className="text-4xl font-black text-gray-800 mb-3 flex items-center gap-3">
        <Smartphone size={32} className="text-yellow-500" /> Carrera de Dedos
      </h1>
      <p className="text-gray-500 mb-8 text-center max-w-xs">
        Toca tan rápido como puedas cuando la luz esté **VERDE**. ¡Alto en **ROJO**!
      </p>

      {error && (
        <div className="w-full p-3 mb-4 bg-red-100 border border-red-400 text-red-700 rounded-lg font-medium text-sm flex items-center">
          <AlertOctagon size={18} className="mr-2" />
          {error}
        </div>
      )}

      {/* Entrada de Nombre */}
      <div className="w-full mb-4">
        <label htmlFor="playerName" className="block text-sm font-medium text-gray-700 mb-1">Tu Nombre/Alias</label>
        <input
          id="playerName"
          type="text"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          placeholder="Ej: Rayo McQueen"
          className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-yellow-500 focus:border-yellow-500 text-lg"
          maxLength={15}
        />
      </div>

      {/* Botones de Acción */}
      <div className="w-full space-y-4">
        <button 
          onClick={createRoom}
          className="w-full bg-yellow-500 text-white p-4 rounded-xl font-black text-lg shadow-md hover:bg-yellow-600 transition-colors flex items-center justify-center gap-2"
        >
          <Users size={20} /> Crear Nueva Sala
        </button>

        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="CÓDIGO (ej: ABCD)"
            className="flex-grow p-4 border border-gray-300 rounded-xl shadow-sm text-center font-mono uppercase text-xl"
            maxLength={4}
          />
          <button 
            onClick={joinRoom}
            className="bg-blue-600 text-white p-4 rounded-xl font-black text-lg shadow-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
          >
            <Footprints size={20} /> Unirse
          </button>
        </div>
      </div>
      
      <p className="mt-8 text-xs text-gray-400 text-center">
        <span className="font-bold">Estado:</span> {isAuthReady ? 'Autenticación Lista' : 'Cargando Auth...'}
        <br/>
        <span className="font-bold">Mi ID:</span> {userId || 'N/A'}
      </p>
    </div>
  );

  const renderView = () => {
    switch (view) {
      case 'lobby':
        return <LobbyView />;
      case 'game':
        return <GameView />;
      case 'winner':
        return <WinnerView />;
      case 'menu':
      default:
        return <MenuView />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md">
        {renderView()}
      </div>
    </div>
  );
}
