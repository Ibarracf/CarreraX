// App.jsx - VERSIÓN CORREGIDA Y FUNCIONAL
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { auth, db } from './firebase';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  doc, setDoc, getDoc, onSnapshot, updateDoc, increment,
  serverTimestamp, deleteField, runTransaction
} from 'firebase/firestore';

const AVATARES = [
  { name: "🚀", label: "Cohete" },
  { name: "⚡", label: "Rayo" },
  { name: "🔥", label: "Fuego" },
  { name: "💀", label: "Calavera" },
  { name: "👽", label: "Alien" },
  { name: "🤖", label: "Robot" },
  { name: "👻", label: "Fantasma" },
  { name: "💎", label: "Diamante" },
  { name: "🐉", label: "Dragón" },
  { name: "🥷", label: "Ninja" },
  { name: "🦾", label: "Cyborg" },
  { name: "🌟", label: "Estrella" }
];

const COLORES = [
  "from-purple-500 to-pink-500",
  "from-blue-500 to-cyan-500",
  "from-green-500 to-emerald-500",
  "from-yellow-500 to-orange-500",
  "from-red-500 to-rose-500",
  "from-indigo-500 to-purple-500",
  "from-pink-500 to-rose-500",
  "from-teal-500 to-green-500"
];

const TARGET_SCORE = 30;

export default function FingerRaceGame() {
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState('menu');
  
  // === CORRECCIÓN 1: SEPARAR EL INPUT DEL CÓDIGO DE CONEXIÓN ===
  const [roomCode, setRoomCode] = useState('');   // Código de la sala conectada
  const [inputCode, setInputCode] = useState(''); // Lo que escribe el usuario en el menú
  
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState('');
  const [selectedAvatarIndex, setSelectedAvatarIndex] = useState(0);
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);

  const [isHost, setIsHost] = useState(false);
  const [gameState, setGameState] = useState('waiting');
  const [trafficLight, setTrafficLight] = useState('green');
  const [players, setPlayers] = useState({});
  const [winnerName, setWinnerName] = useState(null);
  const [targetScore] = useState(TARGET_SCORE);

  const trafficTimerRef = useRef(null);
  const roomListenerRef = useRef(null);

  const getRoomRef = (code) => doc(db, 'rooms', code.toUpperCase());

  // === AUTENTICACIÓN ===
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUserId(u.uid);
        setIsAuthReady(true);
      }
    });
    if (!auth.currentUser) signInAnonymously(auth);
    return () => unsub();
  }, []);

  // === ESCUCHA DE SALA ===
  useEffect(() => {
    // Si no hay roomCode (el usuario no ha dado click a unirse/crear), no escuchamos nada.
    if (!roomCode || !userId || !isAuthReady) return;

    const roomRef = getRoomRef(roomCode);
    console.log('Montando listener para sala:', roomCode);

    const unsub = onSnapshot(roomRef, (snap) => {
      if (!snap.exists()) {
        setError('La sala fue eliminada o no existe');
        setRoomCode(''); // Desconectar
        setView('menu');
        return;
      }

      const data = snap.data();
      setPlayers(data.players || {});
      setGameState(data.status || 'waiting');
      setTrafficLight(data.trafficLight || 'green');
      setWinnerName(data.winnerName || null);
      setIsHost(data.hostId === userId);

      // Sincronizar vista con el estado real de la sala
      if (data.status === 'racing') {
        setView('game');
      } else if (data.status === 'finished') {
        setView('winner');
      } else if (data.status === 'waiting') {
        setView('lobby');
      }
    }, (err) => {
      console.error('Error en listener:', err);
      setError('Error de conexión con la sala');
    });

    roomListenerRef.current = unsub;
    return () => unsub();
  }, [roomCode, userId, isAuthReady]); // Solo escucha cuando 'roomCode' tiene valor real

  // === CREAR SALA ===
  const createRoom = async () => {
    if (!playerName.trim()) return setError('Ingresa tu nombre');
    
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const ref = getRoomRef(code);
    const avatarIdx = selectedAvatarIndex >= 0 ? selectedAvatarIndex : 0;
    const colorIdx = selectedColorIndex >= 0 ? selectedColorIndex : 0;

    try {
      await setDoc(ref, {
        hostId: userId,
        status: 'waiting',
        trafficLight: 'green',
        createdAt: serverTimestamp(),
        targetScore: TARGET_SCORE,
        players: {
          [userId]: {
            name: playerName.trim(),
            score: 0,
            avatar: AVATARES[avatarIdx].name,
            color: COLORES[colorIdx],
            stunned: false,
            isHost: true
          }
        }
      });
      
      // === CORRECCIÓN 2: Establecer roomCode solo tras éxito ===
      setRoomCode(code); 
      setError('');
    } catch (err) {
      setError('Error al crear sala: ' + err.message);
    }
  };

  // === UNIRSE A SALA ===
  const joinRoom = async () => {
    if (!playerName.trim()) return setError('Ingresa tu nombre');
    
    // Usamos inputCode para validar, no roomCode
    if (inputCode.length !== 4) return setError('Código de 4 letras');

    const codeToJoin = inputCode.toUpperCase();
    const ref = getRoomRef(codeToJoin);
    const avatarIdx = selectedAvatarIndex >= 0 ? selectedAvatarIndex : 0;
    const colorIdx = selectedColorIndex >= 0 ? selectedColorIndex : 0;

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists()) throw new Error('La sala no existe');
        if (snap.data().status !== 'waiting') throw new Error('Partida ya iniciada');

        transaction.update(ref, {
          [`players.${userId}`]: {
            name: playerName.trim(),
            score: 0,
            avatar: AVATARES[avatarIdx].name,
            color: COLORES[colorIdx],
            stunned: false,
            isHost: false
          }
        });
      });

      // === CORRECCIÓN 3: SOLO AQUI conectamos el listener ===
      // Al establecer roomCode, el useEffect se disparará y nos llevará al Lobby
      setRoomCode(codeToJoin);
      setError('');
      
    } catch (err) {
      setError('Error al unirse: ' + err.message);
    }
  };
   
  const leaveRoom = async () => {
    if (!roomCode || !userId) return;
    const ref = getRoomRef(roomCode);
    
    // Lógica optimista para salir rápido de la UI
    setRoomCode('');
    setInputCode('');
    setView('menu');
    setPlayers({});
    setError('');

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists()) return;

        const data = snap.data();
        const newPlayers = { ...data.players };
        const playerCount = Object.keys(newPlayers).length;

        // Si soy host y hay más gente, paso el liderazgo
        if (data.hostId === userId && playerCount > 1) {
          delete newPlayers[userId];
          const nextPlayerId = Object.keys(newPlayers)[0];
          newPlayers[nextPlayerId].isHost = true; // Actualizar flag en player
          
          transaction.update(ref, {
            hostId: nextPlayerId,
            players: newPlayers
          });
        } 
        // Si soy el último, borro la sala
        else if (playerCount <= 1) {
          transaction.delete(ref);
        } 
        // Si soy un jugador normal
        else {
          delete newPlayers[userId];
          transaction.update(ref, { players: newPlayers });
        }
      });
    } catch (err) {
      console.error(err);
    }
  };

  const startGame = async () => {
    try {
      await updateDoc(getRoomRef(roomCode), { 
        status: 'racing',
        trafficLight: 'green'
      });
      startTrafficLight();
    } catch (err) {
      console.error(err);
    }
  };

  const resetGame = async () => {
    try {
      const ref = getRoomRef(roomCode);
      // Usamos una transacción para leer los jugadores actuales y resetearlos
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if(!snap.exists()) return;
        
        const currentPlayers = snap.data().players;
        const resetPlayers = {};
        
        // Mantenemos a los jugadores pero reseteamos scores
        Object.keys(currentPlayers).forEach(pid => {
          resetPlayers[pid] = {
            ...currentPlayers[pid],
            score: 0,
            stunned: false
          };
        });

        transaction.update(ref, { 
          status: 'waiting', 
          players: resetPlayers,
          trafficLight: 'green',
          winnerName: deleteField() // Borrar campo ganador
        });
      });
    } catch (err) {
      console.error(err);
    }
  };

  // === CAMBIOS DE SEMÁFORO ===
  const startTrafficLight = () => {
    if (trafficTimerRef.current) clearInterval(trafficTimerRef.current);
    
    trafficTimerRef.current = setInterval(async () => {
      try {
        const ref = getRoomRef(roomCode);
        const snap = await getDoc(ref);
        
        // Verificación de seguridad
        if (!snap.exists() || snap.data().status !== 'racing') {
          clearInterval(trafficTimerRef.current);
          return;
        }

        const newLight = snap.data().trafficLight === 'green' ? 'red' : 'green';
        await updateDoc(ref, { trafficLight: newLight });
      } catch (err) {
        console.error("Error semáforo", err);
      }
    }, 2000 + Math.random() * 2000);
  };

  useEffect(() => {
    return () => {
      if (trafficTimerRef.current) clearInterval(trafficTimerRef.current);
    };
  }, []);

  // === TAP DE JUEGO ===
  const handleTap = useCallback(async () => {
    if (gameState !== 'racing' || !roomCode || !userId) return;

    // Optimistic UI update check (opcional, pero buena práctica)
    const myPlayer = players[userId];
    if (myPlayer?.stunned) return; 

    const roomRef = getRoomRef(roomCode);

    try {
      await runTransaction(db, async (transaction) => {
        const roomSnap = await transaction.get(roomRef);
        if (!roomSnap.exists()) throw "Sala no existe";
        
        const data = roomSnap.data();
        if (data.status !== 'racing') return;

        const player = data.players?.[userId];
        if (!player) return;

        // Lógica de juego
        if (player.stunned) {
          transaction.update(roomRef, { [`players.${userId}.stunned`]: false });
          return;
        }

        if (data.trafficLight === 'red') {
          const penalizedScore = Math.max(0, (player.score || 0) - 3);
          transaction.update(roomRef, {
            [`players.${userId}.score`]: penalizedScore,
            [`players.${userId}.stunned`]: true
          });
          return;
        }

        const newScore = (player.score || 0) + 1;
        if (newScore >= targetScore && !data.winnerName) {
          transaction.update(roomRef, {
            status: 'finished',
            winnerName: player.name,
            [`players.${userId}.score`]: targetScore
          });
        } else {
          transaction.update(roomRef, {
            [`players.${userId}.score`]: increment(1)
          });
        }
      });
    } catch (err) {
      console.log("Tap error:", err);
    }
  }, [roomCode, gameState, userId, players]); // Añadido players a dependencias para check local

  // === VISTAS ===
  const MenuView = () => (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4"
    >
      <div className="max-w-md w-full">
        <motion.div className="text-center mb-8" initial={{ y: -50 }} animate={{ y: 0 }}>
          <div className="text-7xl mb-4">🏁</div>
          <h1 className="text-6xl font-black bg-gradient-to-r from-purple-400 via-pink-400 to-red-400 bg-clip-text text-transparent mb-2">
            CARRERA X
          </h1>
        </motion.div>

        <motion.div className="bg-slate-800/50 backdrop-blur-2xl rounded-3xl p-8 border border-purple-500/20 space-y-6">
          <div>
            <label className="text-purple-300 text-sm font-bold mb-2 block">Tu Nombre</label>
            <input
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder="Ej: Ninja Pro"
              className="w-full px-6 py-4 bg-slate-900/50 border-2 border-purple-500/30 rounded-2xl text-white focus:border-purple-500 outline-none text-lg font-bold"
              maxLength={12}
            />
          </div>

          <div>
            <p className="text-purple-300 text-sm font-bold mb-4">Elige tu Avatar</p>
            <div className="grid grid-cols-4 gap-2">
              {AVATARES.map((a, i) => (
                <button
                  key={i}
                  onClick={() => { setSelectedAvatarIndex(i); setSelectedColorIndex(i % COLORES.length); }}
                  className={`p-3 rounded-xl transition-all ${selectedAvatarIndex === i ? 'bg-purple-600 ring-2 ring-white scale-110' : 'bg-slate-700/50 hover:bg-slate-600'}`}
                >
                  <span className="text-2xl">{a.name}</span>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-500/20 text-red-200 p-3 rounded-xl text-center text-sm font-bold">
              ⚠️ {error}
            </div>
          )}

          <div className="space-y-4 pt-4">
            <button
              onClick={createRoom}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white font-black text-xl py-4 rounded-2xl shadow-lg hover:scale-105 transition"
            >
              🚀 CREAR SALA
            </button>

            <div className="flex gap-3">
              <input
                value={inputCode} // <--- CAMBIO: Usamos inputCode
                onChange={e => setInputCode(e.target.value.replace(/[^A-Z0-9]/gi, '').slice(0, 4))}
                placeholder="CÓDIGO"
                className="flex-1 px-4 py-4 text-center text-2xl font-bold uppercase bg-slate-900/50 border-2 border-purple-500/30 rounded-xl text-white focus:border-purple-500 outline-none"
              />
              <button
                onClick={joinRoom}
                className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-black rounded-xl shadow-lg hover:scale-105 transition"
              >
                ENTRAR
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );

  const LobbyView = () => {
    // Convertir objeto players a array
    const playerList = Object.entries(players).map(([id, p]) => ({ id, ...p }));
    
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen bg-slate-900 p-8">
        <div className="max-w-6xl mx-auto text-center">
          <div className="inline-block bg-purple-600 px-6 py-2 rounded-full mb-8">
            <span className="text-white font-bold text-xl">SALA: {roomCode}</span>
          </div>
          
          <h2 className="text-4xl text-white font-black mb-12">Esperando jugadores...</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
            {playerList.map((p) => (
              <motion.div 
                key={p.id}
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                className="bg-slate-800 rounded-3xl p-6 border border-purple-500/30 flex flex-col items-center"
              >
                <div className={`w-20 h-20 rounded-2xl bg-gradient-to-r ${p.color} flex items-center justify-center text-4xl mb-4 shadow-lg`}>
                  {p.avatar}
                </div>
                <p className="text-white font-bold text-lg">{p.name}</p>
                {p.isHost && <span className="text-xs bg-yellow-500 text-black px-2 py-1 rounded mt-2 font-bold">HOST</span>}
              </motion.div>
            ))}
          </div>

          <div className="flex justify-center gap-4">
            {isHost && (
              <button onClick={startGame} className="bg-green-500 hover:bg-green-600 text-white px-8 py-4 rounded-full text-xl font-black shadow-xl hover:scale-105 transition">
                ⚡ INICIAR CARRERA
              </button>
            )}
            <button onClick={leaveRoom} className="bg-red-500/20 hover:bg-red-500/40 text-red-200 px-8 py-4 rounded-full font-bold transition">
              Salir
            </button>
          </div>
        </div>
      </motion.div>
    );
  };

  // Reutilizamos GameView y WinnerView del código original (simplificado aquí por brevedad, el original funcionaba bien en render)
  // Asegúrate de que GameView usa 'players' y 'userId' del scope actual.
  
  const GameView = () => {
     // Ordenar por puntaje
     const sorted = Object.entries(players)
       .map(([id, p]) => ({ id, ...p }))
       .sort((a, b) => (b.score || 0) - (a.score || 0));
 
     const currentPlayer = players[userId];
 
     return (
       <div className="min-h-screen bg-slate-900 p-4 pb-20 overflow-y-auto">
         <div className="max-w-3xl mx-auto pt-10">
           {/* Semáforo */}
           <div className="text-center mb-10">
             <div className={`text-8xl transition-all duration-200 ${trafficLight === 'green' ? 'scale-110' : 'scale-90'}`}>
               {trafficLight === 'green' ? '🟢' : '🔴'}
             </div>
           </div>
 
           {/* Lista de corredores */}
           <div className="space-y-3 mb-32">
             {sorted.map((p) => {
               const percent = Math.min(100, ((p.score || 0) / TARGET_SCORE) * 100);
               return (
                 <div key={p.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700 relative overflow-hidden">
                   <div className="flex items-center gap-4 relative z-10">
                     <span className="text-3xl">{p.avatar}</span>
                     <div className="flex-1">
                       <div className="flex justify-between text-white font-bold mb-1">
                         <span>{p.name}</span>
                         <span>{p.score}/{TARGET_SCORE}</span>
                       </div>
                       <div className="h-4 bg-slate-900 rounded-full overflow-hidden">
                         <motion.div 
                           className={`h-full bg-gradient-to-r ${p.color}`}
                           animate={{ width: `${percent}%` }}
                         />
                       </div>
                     </div>
                     {p.stunned && <span className="text-2xl animate-spin">💫</span>}
                   </div>
                 </div>
               );
             })}
           </div>
 
           {/* Botón de TAP Flotante */}
           <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-slate-900 via-slate-900 to-transparent flex justify-center">
             <button
               onPointerDown={handleTap} // Mejor respuesta en móviles que onClick
               disabled={!currentPlayer}
               className={`w-32 h-32 rounded-full text-5xl shadow-2xl transition-transform active:scale-90 flex items-center justify-center ${
                 currentPlayer?.stunned 
                   ? 'bg-red-500 opacity-50 cursor-not-allowed' 
                   : trafficLight === 'green' 
                     ? 'bg-green-500 hover:bg-green-400 text-white' 
                     : 'bg-slate-700 text-slate-500'
               }`}
             >
               {currentPlayer?.stunned ? '😵' : '👆'}
             </button>
           </div>
         </div>
       </div>
     );
   };

   const WinnerView = () => (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="text-center bg-slate-800 p-10 rounded-3xl border border-yellow-500/50 shadow-2xl">
        <div className="text-8xl mb-6">🏆</div>
        <h2 className="text-4xl font-black text-white mb-4">¡GANADOR!</h2>
        <p className="text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 mb-8">
          {winnerName}
        </p>
        
        {isHost ? (
          <button onClick={resetGame} className="bg-white text-black px-8 py-3 rounded-full font-bold text-xl hover:scale-105 transition">
            🔄 Nueva Partida
          </button>
        ) : (
          <p className="text-slate-400">Esperando al host...</p>
        )}
        
        <button onClick={leaveRoom} className="block w-full mt-6 text-red-400 hover:text-red-300">
          Salir de la sala
        </button>
      </div>
    </div>
  );

  if (!isAuthReady) return <div className="h-screen bg-slate-900 flex items-center justify-center text-white">Cargando...</div>;

  return (
    <AnimatePresence mode="wait">
      {view === 'menu' && <MenuView key="menu" />}
      {view === 'lobby' && <LobbyView key="lobby" />}
      {view === 'game' && <GameView key="game" />}
      {view === 'winner' && <WinnerView key="winner" />}
    </AnimatePresence>
  );
}
