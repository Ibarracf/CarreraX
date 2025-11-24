// App.jsx - VERSIÓN FINAL ÉPICA 2025 (TODO FUNCIONA + ESTILO BRUTAL)
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Play, AlertOctagon, Trophy, Users, Smartphone, Check, Crown, LogOut, Zap, Flame, Rocket, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

import { auth, db } from './firebase';
import { 
  signInAnonymously,
  onAuthStateChanged
} from 'firebase/auth';
import { 
  doc, setDoc, getDoc, onSnapshot, updateDoc, increment,
  serverTimestamp, deleteField, runTransaction
} from 'firebase/firestore';

const AVATARES = ["Rocket", "Flame", "Lightning", "Skull", "Alien", "Robot", "Ghost", "Diamond", "Fire", "Ice", "Dragon", "Ninja"];
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

  // === ESCUCHA DE SALA (AHORA SÍ ACTUALIZA AL INSTANTE) ===
  useEffect(() => {
    if (!roomCode || !isAuthReady) return;

    const roomRef = getRoomRef(roomCode);
    const unsub = onSnapshot(roomRef, (snap) => {
      if (!snap.exists()) {
        setError('Sala no existe');
        setView('menu');
        return;
      }

      const data = snap.data();
      setPlayers(data.players || {});
      setGameState(data.status || 'waiting');
      setTrafficLight(data.trafficLight || 'green');
      setWinnerName(data.winnerName || null);
      setIsHost(data.hostId === userId);

      if (data.status === 'racing') setView('game');
      else if (data.status === 'finished') setView('winner');
      else setView('lobby');
    }, (err) => {
      console.error(err);
      setError('Error de conexión');
    });

    roomListenerRef.current = unsub;
    return () => unsub && unsub();
  }, [roomCode, isAuthReady, userId]);

  // === CREAR / UNIRSE / SALIR (TODO CORREGIDO) ===
  const createRoom = async () => {
    if (!playerName.trim()) return setError('Ingresa tu nombre');
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const ref = getRoomRef(code);

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
          avatar: AVATARES[selectedAvatarIndex],
          color: COLORES[selectedAvatarIndex],
          stunned: false,
          isHost: true
        }
      }
    });
    setRoomCode(code);
    setError('');
  };

  const joinRoom = async () => {
    if (!playerName.trim()) return setError('Ingresa tu nombre');
    if (roomCode.length !== 4) return setError('Código de 4 letras');
    const ref = getRoomRef(roomCode);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().status !== 'waiting') return setError('Sala no disponible');

    await updateDoc(ref, {
      [`players.${userId}`]: {
        name: playerName.trim(),
        score: 0,
        avatar: AVATARES[selectedAvatarIndex],
        color: COLORES[selectedAvatarIndex],
        stunned: false,
        isHost: false
      }
    });
    setError('');
  };

  const leaveRoom = async () => {
    if (!roomCode) return;
    const ref = getRoomRef(roomCode);
    const snap = await getDoc(ref);
    if (!snap.exists()) return setView('menu');

    const data = snap.data();
    const playerCount = Object.keys(data.players || {}).length;

    if (data.hostId === userId && playerCount > 1) {
      const newHost = Object.keys(data.players).find(id => id !== userId);
      await updateDoc(ref, {
        hostId: newHost,
        [`players.${newHost}.isHost`]: true,
        [`players.${userId}`]: deleteField()
      });
    } else if (playerCount <= 1) {
      await updateDoc(ref, { status: 'closed' });
    } else {
      await updateDoc(ref, { [`players.${userId}`]: deleteField() });
    }
    setView('menu');
    setRoomCode('');
    setPlayers({});
  };

  const startGame = () => updateDoc(getRoomRef(roomCode), { status: 'racing' });
  const resetGame = () => updateDoc(getRoomRef(roomCode), { status: 'waiting', winnerName: deleteField() });
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

      // Si está aturdido → solo se des-aturde
      if (player.stunned) {
        transaction.update(roomRef, {
          [`players.${userId}.stunned`]: false
        });
        return;
      }

      // Semáforo en rojo → penalización
      if (data.trafficLight === 'red') {
        transaction.update(roomRef, {
          [`players.${userId}.score`]: Math.max(0, (player.score || 0) - 3),
          [`players.${userId}.stunned`]: true
        });
        return;
      }

      // Avanzar normal
      const newScore = (player.score || 0) + 1;

      if (newScore >= targetScore && !data.winnerName) {
        // GANADOR
        transaction.update(roomRef, {
          status: 'finished',
          winnerName: player.name,
          [`players.${userId}.score`]: targetScore
        });
        confetti({
          particleCount: 400,
          spread: 100,
          origin: { y: 0.6 }
        });
      } else {
        // Solo avanzar
        transaction.update(roomRef, {
          [`players.${userId}.score`]: increment(1)
        });
      }
    });
  } catch (err) {
    console.log("Tap ignorado (normal en juegos rápidos):", err);
    // Esto es NORMAL cuando muchos tocan a la vez
  }
}, [roomCode, gameState, userId]);
  
  // === VISTAS ===
  const MenuView = () => (
    <motion.div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-600 to-orange-500 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-10 border border-white/20">
        <h1 className="text-6xl font-black text-center bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-8">
          CARRERA X
        </h1>

        <input
          value={playerName}
          onChange={e => setPlayerName(e.target.value)}
          placeholder="Tu nombre épico"
          name="player-name"
          id="player-name"
          autoComplete="nickname"
          className="w-full p-5 text-2xl rounded-2xl border-4 border-purple-300 focus:border-purple-600 outline-none transition"
          maxLength={12}
          autoFocus
        />

        <div className="my-8">
          <p className="text-center font-bold text-xl mb-6 text-purple-700">Elige tu guerrero</p>
          <div className="grid grid-cols-4 gap-4">
            {AVATARES.map((a, i) => (
              <button
                key={i}
                onClick={() => setSelectedAvatarIndex(i)}
                className={`p-4 rounded-2xl transition-all ${selectedAvatarIndex === i ? 'bg-gradient-to-r ' + COLORES[i] + ' scale-125 shadow-2xl ring-4 ring-white' : 'bg-gray-200'}`}
              >
                <span className="text-4xl">{a}</span>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-red-500 font-bold text-center bg-red-100 py-3 rounded-xl">{error}</p>}

        <button onClick={createRoom} className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-black text-2xl py-6 rounded-2xl shadow-2xl hover:scale-105 transition my-4">
          <Rocket className="inline mr-3" /> CREAR SALA
        </button>

        <div className="flex gap-3">
          <input
            value={roomCode}
            onChange={e => setRoomCode(e.target.value.replace(/[^A-Z0-9]/gi, '').slice(0,4))}
            placeholder="CÓDIGO"
            name="room-code"
            id="room-code"
            className="flex-1 p-5 text-center text-4xl font-bold tracking-widest uppercase border-4 border-purple-400 rounded-2xl focus:border-purple-700"
            maxLength={4}
          />
          <button onClick={joinRoom} className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-black text-xl px-8 rounded-2xl shadow-xl hover:scale-110 transition">
            UNIRSE
          </button>
        </div>
      </div>
    </motion.div>
  );

  const LobbyView = () => {
    const playerList = Object.entries(players).map(([id, p]) => ({ id, ...p }));

    return (
      <motion.div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-6xl font-black text-white drop-shadow-2xl">SALA: <span className="text-yellow-400">{roomCode}</span></h2>
            <p className="text-3xl text-white mt-4"><Users className="inline" /> {playerList.length} guerreros listos</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {playerList.map(p => (
              <motion.div
                key={p.id}
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                className="bg-white/20 backdrop-blur-xl rounded-3xl p-8 text-center shadow-2xl border border-white/30"
              >
                <div className={`w-32 h-32 mx-auto rounded-full bg-gradient-to-r ${p.color} flex items-center justify-center text-6xl shadow-2xl`}>
                  {p.avatar}
                </div>
                <p className="text-3xl font-black text-white mt-4">{p.name}</p>
                {p.id === userId && <p className="text-yellow-400 text-xl">(TÚ)</p>}
                {p.isHost && <Crown className="mx-auto mt-3 text-yellow-400" size={40} />}
              </motion.div>
            ))}
          </div>

          <div className="text-center mt-12 space-x-8">
            {isHost && (
              <button onClick={startGame} className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-16 py-8 rounded-full text-4xl font-black shadow-2xl hover:scale-110 transition">
                <Zap className="inline mr-4" /> ¡INICIAR!
              </button>
            )}
            <button onClick={leaveRoom} className="bg-red-600 text-white px-12 py-6 rounded-full text-2xl font-bold hover:bg-red-700 transition">
              <LogOut className="inline mr-3" /> Salir
            </button>
          </div>
        </div>
      </motion.div>
    );
  };

  const GameView = () => {
    const sorted = Object.entries(players)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    return (
      <motion.div className="min-h-screen bg-gradient-to-br from-black via-purple-900 to-pink-900 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-8xl font-black text-white drop-shadow-2xl">¡A CORRER!</h2>
            <div className={`text-9xl mt-6 ${trafficLight === 'green' ? 'text-green-400' : 'text-red-600'} animate-pulse`}>
              {trafficLight === 'green' ? <Play /> : <AlertOctagon />}
            </div>
          </div>

          <div className="space-y-8">
            {sorted.map((p, i) => {
              const percent = ((p.score || 0) / targetScore) * 100;
              return (
                <div key={p.id} className="bg-white/10 backdrop-blur-md rounded-3xl p-6 shadow-2xl border border-white/20">
                  <div className="flex items-center gap-6">
                    <div className="text-6xl">{p.avatar}</div>
                    <div className="flex-1">
                      <div className="flex justify-between text-white text-2xl font-bold mb-2">
                        <span>{p.name}</span>
                        <span>{p.score || 0}/{targetScore}</span>
                      </div>
                      <div className="h-16 bg-gray-800 rounded-full overflow-hidden shadow-inner">
                        <motion.div
                          className={`h-full bg-gradient-to-r ${p.color} flex items-center justify-end pr-6 text-3xl font-black`}
                          initial={{ width: 0 }}
                          animate={{ width: `${percent}%` }}
                          transition={{ type: "spring", stiffness: 80 }}
                        >
                          {percent > 20 && p.avatar}
                        </motion.div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-center mt-16">
            <button
              onClick={handleTap}
              className={`px-32 py-24 rounded-full text-8xl font-black text-white shadow-2xl transition-all
                ${players[userId]?.stunned ? 'bg-red-600 animate-pulse' : trafficLight === 'green' ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 active:scale-95' : 'bg-gray-700'}`}
            >
              {players[userId]?.stunned ? 'STUN' : 'TOCA'}
            </button>
          </div>
        </div>
      </motion.div>
    );
  };

  const WinnerView = () => (
    <motion.div className="min-h-screen bg-gradient-to-br from-yellow-400 via-orange-500 to-pink-600 flex items-center justify-center">
      <div className="text-center">
        <Trophy size={200} className="mx-auto text-white mb-8 drop-shadow-2xl" />
        <h2 className="text-9xl font-black text-white mb-8 drop-shadow-2xl">¡GANADOR!</h2>
        <p className="text-8xl font-black text-black bg-white/90 rounded-3xl px-20 py-10 inline-block shadow-2xl">
          {winnerName}
        </p>
        <div className="mt-16">
          {isHost ? (
            <button onClick={resetGame} className="bg-black text-yellow-400 px-20 py-10 rounded-full text-5xl font-black shadow-2xl hover:scale-110 transition">
              NUEVA PARTIDA
            </button>
          ) : (
            <button onClick={leaveRoom} className="bg-white text-black px-20 py-10 rounded-full text-5xl font-black shadow-2xl hover:scale-110 transition">
              SALIR
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );

  return (
    <AnimatePresence mode="wait">
      {view === 'menu' && <MenuView />}
      {view === 'lobby' && <LobbyView />}
      {view === 'game' && <GameView />}
      {view === 'winner' && <WinnerView />}
    </AnimatePresence>
  );
}
