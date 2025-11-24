// App.jsx - VERSIÓN MEJORADA CON FIREBASE
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
  const [roomCode, setRoomCode] = useState('');
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

// === ESCUCHA DE SALA MEJORADA ===
  useEffect(() => {
    if (!roomCode || !userId || !isAuthReady) return;

    const roomRef = getRoomRef(roomCode);
    
    console.log('Montando listener para sala:', roomCode, 'userId:', userId);

    const unsub = onSnapshot(roomRef, (snap) => {
      if (!snap.exists()) {
        setError('La sala fue eliminada o no existe');
        setView('menu');
        setRoomCode('');
        return;
      }

      const data = snap.data();

      setPlayers(data.players || {});
      setGameState(data.status || 'waiting');
      setTrafficLight(data.trafficLight || 'green');
      setWinnerName(data.winnerName || null);
      setIsHost(data.hostId === userId);

      // Forzar vista correcta incluso si te unes tarde
      if (data.status === 'racing') {
        setView('game');
      } else if (data.status === 'finished') {
        setView('winner');
      } else if (data.status === 'waiting') {
        setView('lobby');
      }
    }, (err) => {
      console.error('Error en listener de sala:', err);
      setError('Perdiste conexión con la sala');
    });

    roomListenerRef.current = unsub;

    return () => {
      console.log('Desmontando listener de sala');
      unsub();
    };
  }, [roomCode, userId, isAuthReady]); // Solo depende de estos 3

  // === CREAR / UNIRSE / SALIR ===
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
            avatar: AVATARES[avatarIdx].name || '🚀',
            color: COLORES[colorIdx] || 'from-purple-500 to-pink-500',
            stunned: false,
            isHost: true
          }
        }
      });
      setRoomCode(code);
      setError('');
    } catch (err) {
      setError('Error al crear sala: ' + err.message);
    }
  };

const joinRoom = async () => {
  if (!playerName.trim()) return setError('Ingresa tu nombre');
  if (roomCode.length !== 4) return setError('Código de 4 letras');

  const ref = getRoomRef(roomCode);
  const avatarIdx = selectedAvatarIndex >= 0 ? selectedAvatarIndex : 0;
  const colorIdx = selectedColorIndex >= 0 ? selectedColorIndex : 0;

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) {
        throw new Error('La sala no existe');
      }
      if (snap.data().status !== 'waiting') {
        throw new Error('La partida ya comenzó o terminó');
      }

      transaction.update(ref, {
        [`players.${userId}`]: {
          name: playerName.trim(),
          score: 0,
          avatar: AVATARES[avatarIdx].name || '🚀',
          color: COLORES[colorIdx] || 'from-purple-500 to-pink-500',
          stunned: false,
          isHost: false
        }
      });
    });

    // ¡AQUÍ VAN LAS LÍNEAS IMPORTANTES! (después del éxito)
    setRoomCode(roomCode.toUpperCase());  // Asegura que se guarde en mayúsculas
    setError('');                         // Limpia cualquier error previo
    setView('lobby');                     // Fuerza la vista lobby (el listener cambiará a 'game' si ya empezó)

  } catch (err) {
    setError('Error al unirse: ' + err.message);
  }
};
  
  const leaveRoom = async () => {
    if (!roomCode || !userId) return;
    const ref = getRoomRef(roomCode);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists()) return;

        const data = snap.data();
        const playerCount = Object.keys(data.players || {}).length;
        const newPlayers = { ...data.players };

        if (data.hostId === userId && playerCount > 1) {
          const newHostId = Object.keys(newPlayers).find(id => id !== userId);
          delete newPlayers[userId];
          transaction.update(ref, {
            hostId: newHostId,
            [`players.${newHostId}.isHost`]: true,
            players: newPlayers
          });
        } else if (playerCount <= 1) {
          transaction.delete(ref);
        } else {
          delete newPlayers[userId];
          transaction.update(ref, { players: newPlayers });
        }
      });
      
      setView('menu');
      setRoomCode('');
      setPlayers({});
      setError('');
    } catch (err) {
      console.error(err);
    }
  };

  const startGame = async () => {
    try {
      await runTransaction(db, async (transaction) => {
        const ref = getRoomRef(roomCode);
        const snap = await transaction.get(ref);
        if (!snap.exists()) throw new Error('Sala no existe');

        transaction.update(ref, { 
          status: 'racing',
          trafficLight: 'green'
        });
      });
      startTrafficLight();
    } catch (err) {
      console.error(err);
      setError('Error al iniciar juego');
    }
  };

  const resetGame = async () => {
    try {
      await runTransaction(db, async (transaction) => {
        const ref = getRoomRef(roomCode);
        const snap = await transaction.get(ref);
        if (!snap.exists()) throw new Error('Sala no existe');

        const newPlayers = { ...snap.data().players };
        Object.keys(newPlayers).forEach(id => {
          newPlayers[id].score = 0;
          newPlayers[id].stunned = false;
        });

        transaction.update(ref, { 
          status: 'waiting', 
          players: newPlayers,
          trafficLight: 'green'
        });
      });
    } catch (err) {
      console.error(err);
      setError('Error al reiniciar juego');
    }
  };

  // === CAMBIOS DE SEMÁFORO ===
  const startTrafficLight = () => {
    if (trafficTimerRef.current) clearInterval(trafficTimerRef.current);
    
    trafficTimerRef.current = setInterval(async () => {
      try {
        const ref = getRoomRef(roomCode);
        const snap = await getDoc(ref);
        if (!snap.exists() || snap.data().status !== 'racing') {
          clearInterval(trafficTimerRef.current);
          return;
        }

        const newLight = snap.data().trafficLight === 'green' ? 'red' : 'green';
        await updateDoc(ref, { trafficLight: newLight });
      } catch (err) {
        console.error(err);
      }
    }, 2000 + Math.random() * 2000);
  };

  useEffect(() => {
    return () => {
      if (trafficTimerRef.current) clearInterval(trafficTimerRef.current);
    };
  }, []);

  // === TAP ÉPICO ===
  const handleTap = useCallback(async () => {
    if (gameState !== 'racing' || !roomCode || !userId) return;

    const roomRef = getRoomRef(roomCode);

    try {
      await runTransaction(db, async (transaction) => {
        const roomSnap = await transaction.get(roomRef);
        if (!roomSnap.exists()) throw "Sala no existe";
        
        const data = roomSnap.data();
        if (data.status !== 'racing') return;

        const player = data.players?.[userId];
        if (!player) return;

        if (player.stunned) {
          transaction.update(roomRef, {
            [`players.${userId}.stunned`]: false
          });
          return;
        }

        if (data.trafficLight === 'red') {
          transaction.update(roomRef, {
            [`players.${userId}.score`]: Math.max(0, (player.score || 0) - 3),
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
          clearInterval(trafficTimerRef.current);
        } else {
          transaction.update(roomRef, {
            [`players.${userId}.score`]: increment(1)
          });
        }
      });
    } catch (err) {
      console.log("Tap procesado:", err);
    }
  }, [roomCode, gameState, userId, targetScore]);

  // === VISTAS ===
  const MenuView = () => (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4"
    >
      <div className="max-w-md w-full">
        <motion.div
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-center mb-8"
        >
          <div className="text-7xl mb-4">🏁</div>
          <h1 className="text-6xl font-black bg-gradient-to-r from-purple-400 via-pink-400 to-red-400 bg-clip-text text-transparent mb-2">
            CARRERA X
          </h1>
          <p className="text-xl text-purple-300">Juego de Reflejos Épico</p>
        </motion.div>

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-gradient-to-br from-purple-900/50 to-slate-800/50 backdrop-blur-2xl rounded-3xl shadow-2xl p-8 border border-purple-500/20 space-y-6"
        >
          <div>
            <label className="text-purple-300 text-sm font-bold mb-2 block">Tu Nombre</label>
            <input
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder="Ej: Ninja Pro"
              className="w-full px-6 py-4 bg-slate-800/50 border-2 border-purple-500/30 rounded-2xl text-white placeholder-slate-400 focus:border-purple-500 focus:outline-none transition text-lg font-semibold"
              maxLength={16}
              autoFocus
            />
          </div>

          <div>
            <p className="text-purple-300 text-sm font-bold mb-4">Elige tu Avatar</p>
            <div className="grid grid-cols-4 gap-3">
              {AVATARES.map((a, i) => (
                <motion.button
                  key={i}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setSelectedAvatarIndex(i);
                    setSelectedColorIndex(i % COLORES.length);
                  }}
                  className={`p-4 rounded-xl transition-all ${
                    selectedAvatarIndex === i 
                      ? `bg-gradient-to-r ${COLORES[i % COLORES.length]} ring-4 ring-white shadow-lg` 
                      : 'bg-slate-700/50 hover:bg-slate-600/50'
                  }`}
                  title={a.label}
                >
                  <span className="text-4xl block">{a.name}</span>
                </motion.button>
              ))}
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ y: -10 }}
              animate={{ y: 0 }}
              className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-xl text-sm font-semibold text-center"
            >
              ⚠️ {error}
            </motion.div>
          )}

          <div className="space-y-4">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={createRoom}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-black text-xl py-5 rounded-2xl shadow-xl transition"
            >
              🚀 CREAR SALA
            </motion.button>

            <div className="flex gap-3">
              <input
                value={roomCode}
                onChange={e => setRoomCode(e.target.value.replace(/[^A-Z0-9]/gi, '').slice(0, 4))}
                placeholder="CÓDIGO"
                className="flex-1 px-4 py-4 text-center text-3xl font-bold tracking-widest uppercase bg-slate-800/50 border-2 border-purple-500/30 rounded-xl focus:border-purple-500 focus:outline-none text-white"
                maxLength={4}
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={joinRoom}
                className="px-6 py-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-black rounded-xl shadow-xl transition"
              >
                UNIRSE
              </motion.button>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );

  const LobbyView = () => {
    const playerList = Object.entries(players).map(([id, p]) => ({ id, ...p }));

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 p-8"
      >
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-center mb-12"
          >
            <div className="inline-block bg-gradient-to-r from-purple-500 to-pink-500 px-8 py-4 rounded-full mb-6">
              <p className="text-white font-black text-2xl">Código: <span className="text-yellow-300 text-3xl">{roomCode}</span></p>
            </div>
            <h2 className="text-5xl font-black text-white mb-2">¡Sala Lista!</h2>
            <p className="text-xl text-purple-300">👥 {playerList.length} {playerList.length === 1 ? 'guerrero' : 'guerreros'} conectados</p>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-12">
            {playerList.map((p, idx) => (
              <motion.div
                key={p.id}
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="bg-gradient-to-br from-purple-800/50 to-slate-800/50 backdrop-blur-xl rounded-3xl p-6 border border-purple-500/30 shadow-xl hover:shadow-2xl hover:border-purple-500/50 transition"
              >
                <div className={`w-24 h-24 mx-auto rounded-2xl bg-gradient-to-r ${p.color} flex items-center justify-center text-5xl shadow-lg mb-4`}>
                  {p.avatar}
                </div>
                <p className="text-xl font-black text-white text-center mb-2">{p.name}</p>
                <div className="flex justify-center gap-2">
                  {p.id === userId && <span className="bg-yellow-500 text-black px-3 py-1 rounded-full text-xs font-bold">TÚ</span>}
                  {p.isHost && <span className="bg-purple-500 text-white px-3 py-1 rounded-full text-xs font-bold">👑 HOST</span>}
                </div>
              </motion.div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row justify-center gap-6">
            {isHost && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={startGame}
                className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-12 py-6 rounded-full text-2xl font-black shadow-xl transition"
              >
                ⚡ ¡COMENZAR!
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={leaveRoom}
              className="bg-red-600 hover:bg-red-700 text-white px-12 py-6 rounded-full text-xl font-bold shadow-xl transition"
            >
              ❌ Salir
            </motion.button>
          </div>
        </div>
      </motion.div>
    );
  };

  const GameView = () => {
    const sorted = Object.entries(players)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    const currentPlayer = players[userId];

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="min-h-screen bg-gradient-to-br from-black via-purple-950 to-slate-900 p-6"
      >
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="text-center mb-10"
          >
            <h2 className="text-5xl font-black text-white mb-6">🏁 ¡A CORRER!</h2>
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 0.8 }}
              className={`text-9xl ${trafficLight === 'green' ? 'text-green-400' : 'text-red-500'}`}
            >
              {trafficLight === 'green' ? '🟢' : '🔴'}
            </motion.div>
            <p className="text-2xl font-bold text-white mt-4">
              {trafficLight === 'green' ? '¡CORRE!' : '¡ALTO!'}
            </p>
          </motion.div>

          <div className="space-y-4 mb-12">
            {sorted.map((p, idx) => {
              const percent = ((p.score || 0) / TARGET_SCORE) * 100;
              const isCurrentPlayer = p.id === userId;

              return (
                <motion.div
                  key={p.id}
                  initial={{ x: -50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`bg-gradient-to-r ${p.color}/20 backdrop-blur-lg rounded-2xl p-6 border-2 ${
                    isCurrentPlayer ? 'border-yellow-400 shadow-lg shadow-yellow-400/50' : 'border-purple-500/30'
                  }`}
                >
                  <div className="flex items-center gap-6">
                    <div className="text-5xl flex-shrink-0">{p.avatar}</div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-3">
                        <div>
                          <p className="text-xl font-black text-white">{p.name}</p>
                          {isCurrentPlayer && <p className="text-sm text-yellow-300">📍 TÚ</p>}
                        </div>
                        <p className="text-2xl font-black text-white bg-black/40 px-4 py-2 rounded-lg whitespace-nowrap">
                          {p.score || 0}/{TARGET_SCORE}
                        </p>
                      </div>
                      
                      <div className="h-10 bg-black/50 rounded-full overflow-hidden border border-purple-500/30">
                        <motion.div
                          className={`h-full bg-gradient-to-r ${p.color} flex items-center justify-end pr-3 text-2xl font-black text-white`}
                          animate={{ width: `${percent}%` }}
                          transition={{ type: 'spring', stiffness: 100 }}
                        >
                          {percent > 10 && p.avatar}
                        </motion.div>
                      </div>
                    </div>

                    {p.stunned && (
                      <motion.div
                        animate={{ rotate: [0, -5, 5, -5, 0] }}
                        transition={{ repeat: Infinity, duration: 0.5 }}
                        className="text-4xl flex-shrink-0"
                      >
                        😵
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="flex justify-center">
            <motion.button
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              onClick={handleTap}
              disabled={!currentPlayer}
              className={`w-48 h-48 rounded-full font-black text-6xl shadow-2xl transition-all ${
                currentPlayer?.stunned
                  ? 'bg-red-600 animate-pulse text-white'
                  : trafficLight === 'green'
                  ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white active:scale-95'
                  : 'bg-slate-700 text-slate-400'
              }`}
            >
              {currentPlayer?.stunned ? '😵' : '👆'}
            </motion.button>
          </div>
        </div>
      </motion.div>
    );
  };

  const WinnerView = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-gradient-to-br from-yellow-400 via-orange-500 to-pink-600 flex items-center justify-center p-4"
    >
      <motion.div className="text-center">
        <motion.div
          animate={{ rotate: [0, -10, 10, -10, 0], y: [0, -20, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="text-9xl mb-8"
        >
          🏆
        </motion.div>
        
        <motion.h2
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-8xl font-black text-white drop-shadow-2xl mb-8"
        >
          ¡GANADOR!
        </motion.h2>
        
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.4, type: 'spring' }}
          className="bg-white/95 rounded-3xl px-12 py-8 mb-12 inline-block shadow-2xl"
        >
          <p className="text-7xl font-black text-transparent bg-gradient-to-r from-yellow-500 to-orange-600 bg-clip-text">
            {winnerName}
          </p>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          {isHost ? (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={resetGame}
              className="bg-black text-yellow-400 px-12 py-6 rounded-full text-4xl font-black shadow-2xl hover:bg-slate-900 transition"
            >
              🔄 NUEVA PARTIDA
            </motion.button>
          ) : (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={leaveRoom}
              className="bg-white text-black px-12 py-6 rounded-full text-3xl font-black shadow-2xl hover:bg-gray-200 transition"
            >
              ❌ SALIR
            </motion.button>
          )}
        </motion.div>
      </motion.div>
    </motion.div>
  );

  if (!isAuthReady) {
    return <div className="flex items-center justify-center h-screen bg-slate-900 text-white text-2xl">Cargando...</div>;
  }

  return (
    <AnimatePresence mode="wait">
      {view === 'menu' && <MenuView key="menu" />}
      {view === 'lobby' && <LobbyView key="lobby" />}
      {view === 'game' && <GameView key="game" />}
      {view === 'winner' && <WinnerView key="winner" />}
    </AnimatePresence>
  );
}
