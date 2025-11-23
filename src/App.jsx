import React, { useState, useEffect, useRef } from 'react';
// Importamos nuestras instancias configuradas desde el archivo local
import { auth, db } from './firebase'; 
import { 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  updateDoc, 
  increment,
  serverTimestamp,
  deleteField
} from 'firebase/firestore';
import { Play, Zap, Trophy, AlertOctagon, Footprints, Users, Smartphone } from 'lucide-react';

// --- Configuración Global ---
// Usa un ID de aplicación fijo para la colección de Firestore
const appId = 'carrera-dedos-produccion'; 

// --- Avatares y Colores ---
const AVATARS = ["🚗", "🏍️", "🏃", "🐎", "🚀", "🛹", "🦖", "🐕"];
const COLORS = [
  "bg-red-500", "bg-blue-500", "bg-green-500", "bg-yellow-500", 
  "bg-purple-500", "bg-pink-500", "bg-orange-500", "bg-teal-500"
];

export default function FingerRaceGame() {
  // Estados Generales
  const [user, setUser] = useState(null);
  const [view, setView] = useState('menu'); // menu, lobby, game, winner
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState('');
  
  // Estados del Juego
  const [isHost, setIsHost] = useState(false);
  const [gameState, setGameState] = useState('waiting'); // waiting, racing, finished
  const [trafficLight, setTrafficLight] = useState('green'); // green, red
  const [players, setPlayers] = useState({}); // Objeto { uid: { name, score, avatar, color, stunned } }
  const [winnerName, setWinnerName] = useState(null);
  const [myPenalty, setMyPenalty] = useState(false); // Estado local visual de penalización

  // Refs para lógica del Host
  const trafficTimerRef = useRef(null);

  // 1. Autenticación
  useEffect(() => {
    const initAuth = async () => {
      // En una app real, si no hay token, iniciamos sesión anónimamente.
      await signInAnonymously(auth);
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  // 2. Sincronización de Sala (Firestore Listener)
  useEffect(() => {
    if (!user || !roomCode) return;

    // La referencia apunta a una colección pública usando el appId fijo
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', `race_${roomCode}`);
    
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setPlayers(data.players || {});
        setGameState(data.status);
        setTrafficLight(data.trafficLight || 'green');
        setWinnerName(data.winnerName);
        
        // Navegación automática basada en estado
        if (data.status === 'waiting') setView('lobby');
        if (data.status === 'racing') setView('game');
        if (data.status === 'finished') setView('winner');

      } else {
        // Si la sala se borra o no existe
        setRoomCode('');
        setView('menu');
        if(gameState !== 'waiting') setError("La sala se ha cerrado.");
      }
    });

    return () => {
      unsubscribe();
      if (trafficTimerRef.current) clearTimeout(trafficTimerRef.current);
    };
  }, [user, roomCode]);

  // 3. Lógica del Semáforo (Solo Host)
  useEffect(() => {
    if (!isHost || gameState !== 'racing') return;

    const loopTrafficLight = () => {
      const nextColor = Math.random() > 0.5 ? 'green' : 'red';
      const duration = nextColor === 'green' 
        ? Math.random() * 2000 + 2000  // Verde: 2-4 segundos
        : Math.random() * 2000 + 1000; // Rojo: 1-3 segundos

      // Actualizar Firestore
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', `race_${roomCode}`);
      updateDoc(roomRef, { trafficLight: nextColor });

      trafficTimerRef.current = setTimeout(() => {
        // Cambiar al color opuesto
        const opposite = nextColor === 'green' ? 'red' : 'green';
        updateDoc(roomRef, { trafficLight: opposite });
        
        // Programar siguiente cambio (recursivo)
        loopTrafficLight(); 
      }, duration);
    };

    loopTrafficLight();

    return () => clearTimeout(trafficTimerRef.current);
  }, [isHost, gameState, roomCode]);

  // --- Funciones: Crear / Unirse ---

  const createRoom = async () => {
    if (!playerName) return setError("¡Necesitas un nombre!");
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', `race_${code}`);
    
    const myPlayer = {
      name: playerName,
      score: 0,
      avatar: AVATARS[0],
      color: COLORS[0],
      stunned: false
    };

    await setDoc(roomRef, {
      hostId: user.uid,
      status: 'waiting',
      trafficLight: 'green',
      createdAt: serverTimestamp(),
      players: { [user.uid]: myPlayer }
    });

    setIsHost(true);
    setRoomCode(code);
    setError('');
  };

  const joinRoom = async () => {
    if (!playerName) return setError("¡Necesitas un nombre!");
    if (!roomCode) return setError("Código inválido");
    const code = roomCode.toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', `race_${code}`);
    
    const snap = await getDoc(roomRef);
    if (!snap.exists()) return setError("Sala no encontrada");
    if (snap.data().status !== 'waiting') return setError("La carrera ya empezó");

    // Asignar avatar/color aleatorio
    const randomAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];

    await updateDoc(roomRef, {
      [`players.${user.uid}`]: {
        name: playerName,
        score: 0,
        avatar: randomAvatar,
        color: randomColor,
        stunned: false
      }
    });

    setIsHost(false);
    setRoomCode(code);
    setError('');
  };

  // --- Funciones: Juego ---

  const startGame = async () => {
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', `race_${roomCode}`);
    // Resetear scores por si acaso
    const resetPlayers = {};
    Object.keys(players).forEach(uid => {
      resetPlayers[uid] = { ...players[uid], score: 0 };
    });
    
    await updateDoc(roomRef, {
      status: 'racing',
      players: resetPlayers,
      winnerName: null,
      trafficLight: 'green'
    });
  };

  const handleRunClick = async () => {
    if (myPenalty) return; // Bloqueo local por penalización

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', `race_${roomCode}`);
    
    if (trafficLight === 'red') {
      // PENALIZACIÓN
      setMyPenalty(true);
      setTimeout(() => setMyPenalty(false), 1500); // 1.5s congelado localmente
      
      // Enviar a DB (Retrocede 5 pasos)
      await updateDoc(roomRef, {
        [`players.${user.uid}.score`]: increment(-5)
      });
    } else {
      // AVANCE
      // Verificar localmente si ganamos para evitar llamadas extra
      const currentScore = players[user.uid]?.score || 0;
      if (currentScore >= 100) {
        // Hemos ganado
        await updateDoc(roomRef, {
          status: 'finished',
          winnerName: playerName,
          [`players.${user.uid}.score`]: 100
        });
      } else {
        await updateDoc(roomRef, {
          [`players.${user.uid}.score`]: increment(2) // +2 por click para que sea rápido
        });
      }
    }
  };

  const resetGame = async () => {
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', `race_${roomCode}`);
    // Reset scores
    const resetPlayers = {};
    Object.keys(players).forEach(uid => {
      resetPlayers[uid] = { ...players[uid], score: 0 };
    });
    await updateDoc(roomRef, {
      status: 'waiting',
      players: resetPlayers,
      winnerName: null
    });
  };

  // --- Render Helpers ---
  const getPlayerList = () => Object.entries(players).map(([id, data]) => ({ id, ...data }));

  // --- Renderizado ---
  if (!user) return <div className="h-screen w-full flex items-center justify-center bg-slate-900 text-white">Cargando motores...</div>;

  return (
    <div className={`min-h-screen font-sans transition-colors duration-300 ease-in-out overflow-hidden flex flex-col ${
      gameState === 'racing' 
        ? (trafficLight === 'red' ? 'bg-red-900' : 'bg-emerald-900') 
        : 'bg-slate-900'
    }`}>
      
      {/* --- HEADER --- */}
      <div className="p-4 flex justify-between items-center bg-black/20 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <Footprints className="text-yellow-400" />
          <h1 className="font-black text-white tracking-tighter text-xl italic">CARRERA DE DEDOS</h1>
        </div>
        {roomCode && (
          <div className="bg-white/10 px-3 py-1 rounded-full text-xs font-mono text-white">
            SALA: {roomCode}
          </div>
        )}
      </div>

      {/* --- MENÚ --- */}
      {view === 'menu' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 max-w-md mx-auto w-full gap-6">
          <div className="text-center space-y-2 mb-8">
            <h2 className="text-4xl font-bold text-white">¡A correr!</h2>
            <p className="text-slate-400">Usa tu móvil como mando. <br/>¡Cuidado con la luz roja!</p>
          </div>

          <input
            type="text"
            placeholder="Tu Nombre"
            maxLength={10}
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-white p-4 rounded-xl text-center text-lg focus:border-yellow-500 focus:outline-none"
          />

          <button onClick={createRoom} className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-bold p-4 rounded-xl text-lg shadow-lg shadow-yellow-500/20 transition-transform active:scale-95 flex items-center justify-center gap-2">
            <Zap size={20} /> Crear Carrera (Host)
          </button>

          <div className="w-full flex gap-2">
            <input
              type="text"
              placeholder="CÓDIGO"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase())}
              maxLength={4}
              className="flex-1 bg-slate-800 border border-slate-700 text-white p-4 rounded-xl text-center font-mono uppercase focus:border-blue-500 focus:outline-none"
            />
            <button onClick={joinRoom} className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 rounded-xl shadow-lg transition-transform active:scale-95">
              Unirse
            </button>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
      )}

      {/* --- LOBBY --- */}
      {view === 'lobby' && (
        <div className="flex-1 flex flex-col p-6 max-w-2xl mx-auto w-full">
          <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700 flex-1 flex flex-col">
            <h3 className="text-white text-lg font-bold flex items-center gap-2 mb-4">
              <Users className="text-blue-400" /> Corredores ({getPlayerList().length})
            </h3>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 overflow-y-auto flex-1 content-start">
              {getPlayerList().map((p) => (
                <div key={p.id} className={`${p.color} p-3 rounded-xl flex flex-col items-center justify-center text-white shadow-lg animate-in zoom-in duration-300`}>
                  <span className="text-3xl mb-1">{p.avatar}</span>
                  <span className="font-bold text-sm truncate max-w-full">{p.name}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-700">
              {isHost ? (
                <button 
                  onClick={startGame}
                  className="w-full bg-green-500 hover:bg-green-400 text-black font-black text-xl p-4 rounded-xl shadow-lg shadow-green-500/20 transition-transform active:scale-95 flex items-center justify-center gap-2"
                >
                  <Play fill="currentColor" /> EMPEZAR CARRERA
                </button>
              ) : (
                <div className="text-center text-slate-400 animate-pulse flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  Esperando al anfitrión...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- JUEGO (HOST VIEW) --- */}
      {view === 'game' && isHost && (
        <div className="flex-1 flex flex-col p-2 sm:p-6 max-w-4xl mx-auto w-full overflow-hidden">
          {/* Semáforo gigante */}
          <div className="flex justify-center mb-6">
            <div className="bg-black p-4 rounded-3xl border-4 border-slate-800 shadow-2xl flex items-center gap-4">
               <div className={`w-16 h-16 rounded-full border-4 border-black transition-all duration-100 ${trafficLight === 'red' ? 'bg-red-600 shadow-[0_0_50px_rgba(220,38,38,0.8)] scale-110' : 'bg-red-900/30'}`}></div>
               <div className={`w-16 h-16 rounded-full border-4 border-black transition-all duration-100 ${trafficLight === 'green' ? 'bg-green-500 shadow-[0_0_50px_rgba(34,197,94,0.8)] scale-110' : 'bg-green-900/30'}`}></div>
            </div>
          </div>

          {/* Pista de Carreras */}
          <div className="flex-1 bg-slate-800/80 rounded-xl border border-slate-700 p-4 relative overflow-y-auto space-y-2">
            {/* Línea de meta */}
            <div className="absolute right-[5%] top-0 bottom-0 w-2 bg-white/20 border-r-2 border-dashed border-white/50 z-0 flex items-center justify-center">
                <span className="absolute -bottom-6 text-xs text-white font-mono">META</span>
            </div>

            {getPlayerList().map((p) => (
              <div key={p.id} className="relative h-12 w-full bg-black/20 rounded-full flex items-center px-2 z-10">
                {/* Nombre flotante */}
                <span className="absolute left-2 text-xs text-white/50 font-mono pointer-events-none z-0">{p.name}</span>
                
                {/* Avatar en movimiento */}
                <div 
                  className="absolute transition-all duration-300 ease-linear flex flex-col items-center"
                  style={{ left: `${Math.min(Math.max(p.score, 0), 92)}%` }}
                >
                  <div className={`${p.color} w-10 h-10 rounded-full flex items-center justify-center shadow-lg text-xl border-2 border-white`}>
                    {p.avatar}
                  </div>
                  {p.score < 0 && <span className="text-xs text-red-500 font-bold">¡CAÍDA!</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- JUEGO (CLIENT VIEW) --- */}
      {view === 'game' && !isHost && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 pb-12">
          
          <div className="absolute top-20 text-center">
            <h3 className="text-white font-bold text-2xl drop-shadow-md">
              {trafficLight === 'green' ? '¡CORRE!' : '¡QUIETO!'}
            </h3>
            <p className="text-white/70 text-sm">
              {trafficLight === 'green' ? 'Pulsa rápido' : 'Si pulsas ahora, retrocedes'}
            </p>
          </div>

          <button
            onClick={handleRunClick}
            disabled={myPenalty}
            className={`
              relative w-64 h-64 rounded-full shadow-2xl border-8 border-white/20 transition-all duration-75
              flex flex-col items-center justify-center gap-2
              ${myPenalty ? 'bg-gray-600 scale-90 opacity-50 cursor-not-allowed' : 'active:scale-95 active:shadow-inner'}
              ${!myPenalty && trafficLight === 'green' ? 'bg-green-500 hover:bg-green-400 shadow-green-500/50' : ''}
              ${!myPenalty && trafficLight === 'red' ? 'bg-red-600 hover:bg-red-500 shadow-red-600/50' : ''}
            `}
          >
             {myPenalty ? (
               <>
                <AlertOctagon size={64} className="text-white mb-2" />
                <span className="text-white font-black text-xl">¡STUN!</span>
               </>
             ) : (
               <>
                <Footprints size={64} className="text-white/90" />
                <span className="text-white font-black text-3xl tracking-wider">
                  {trafficLight === 'green' ? 'RUN!' : 'STOP'}
                </span>
               </>
             )}
          </button>
          
          {/* Progreso propio mini */}
          <div className="mt-12 w-full max-w-xs bg-slate-800 rounded-full h-4 overflow-hidden border border-slate-600">
            <div 
              className={`h-full transition-all duration-300 ${players[user.uid]?.color}`} 
              style={{ width: `${Math.min(players[user.uid]?.score || 0, 100)}%` }}
            ></div>
          </div>
          <p className="text-white/50 text-xs mt-2 font-mono text-center">Tu progreso</p>

        </div>
      )}

      {/* --- GANADOR --- */}
      {view === 'winner' && (
        <div className="flex-1 flex flex-col items-center justify-center bg-yellow-500 p-6 text-center animate-in fade-in duration-1000">
          <Trophy size={80} className="text-black mb-6 drop-shadow-lg animate-bounce" />
          <h2 className="text-2xl font-bold text-yellow-900 uppercase tracking-widest mb-2">El Ganador es</h2>
          <h1 className="text-6xl font-black text-black mb-8 drop-shadow-xl bg-white/20 px-8 py-4 rounded-2xl transform -rotate-2">
            {winnerName}
          </h1>
          
          {isHost ? (
            <button 
              onClick={resetGame} 
              className="bg-black text-yellow-500 px-8 py-4 rounded-xl font-bold text-lg hover:scale-105 transition-transform"
            >
              Jugar otra vez
            </button>
          ) : (
            <p className="text-yellow-900 font-medium">Esperando al host para reiniciar...</p>
          )}
          
          {/* Lista de resultados */}
           <div className="mt-12 bg-black/10 p-6 rounded-2xl max-w-md w-full">
             <h3 className="text-yellow-900 font-bold mb-4 text-left">Resultados finales</h3>
             {getPlayerList()
                .sort((a,b) => b.score - a.score)
                .map((p, idx) => (
                  <div key={p.id} className="flex justify-between items-center py-2 border-b border-black/10 last:border-0">
                    <span className="font-bold text-yellow-900 flex items-center gap-2">
                      <span className="text-sm opacity-50">#{idx + 1}</span> {p.name}
                    </span>
                    <span className="font-mono bg-white/30 px-2 rounded text-black">{Math.floor(p.score)}m</span>
                  </div>
             ))}
           </div>
        </div>
      )}

    </div>
  );
}

