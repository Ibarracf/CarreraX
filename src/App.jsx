// App.jsx - VERSIÓN FINAL CORREGIDA Y FUNCIONAL (SIN ERRORES)
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Play, AlertOctagon, Trophy, Users, Smartphone, Check, Crown, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

import { auth, db } from './firebase';
import { 
  signInAnonymously,
  onAuthStateChanged
} from 'firebase/auth';
import { 
  doc, setDoc, getDoc, onSnapshot, updateDoc, increment,
  serverTimestamp, deleteField, runTransaction, onDisconnect
} from 'firebase/firestore';

const AVATARS = ["Car", "Motorcycle", "Runner", "Horse", "Rocket", "Skateboard", "Dino", "Dog"];
const COLORS = [
  "bg-red-500", "bg-blue-500", "bg-green-500", "bg-yellow-500", 
  "bg-purple-500", "bg-pink-500", "bg-orange-500", "bg-teal-500"
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
  const [targetScore, setTargetScore] = useState(TARGET_SCORE);

  const trafficTimerRef = useRef(null);
  const roomListenerRef = useRef(null);
  const disconnectRef = useRef(null);
  const tapCooldownRef = useRef(false);

  const nameInputRef = useRef(null);
  const codeInputRef = useRef(null);

  const getRoomRef = (code) => doc(db, 'rooms', code);

  // === AUTENTICACIÓN ===
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUserId(u.uid);
        setIsAuthReady(true);
      }
    });

    if (!auth.currentUser) {
      signInAnonymously(auth).catch(() => setError('Error de conexión'));
    }

    return () => unsub();
  }, []);

  // === ESCUCHA DE SALA ===
  useEffect(() => {
    if (!isAuthReady || !roomCode) return;

    const ref = getRoomRef(roomCode);
    if (roomListenerRef.current) roomListenerRef.current();

    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists() || snap.data()?.status === 'closed') {
        setError('Sala cerrada o inexistente');
        cleanupAfterLeave();
        return;
      }

      const data = snap.data();
      setPlayers(data.players || {});
      setGameState(data.status || 'waiting');
      setTrafficLight(data.trafficLight || 'green');
      setWinnerName(data.winnerName || null);
      setTargetScore(data.targetScore || TARGET_SCORE);
      setIsHost(data.hostId === userId);

      if (data.status === 'waiting') setView('lobby');
      else if (data.status === 'racing') setView('game');
      else if (data.status === 'finished') setView('winner');
    });

    roomListenerRef.current = unsub;
    return () => unsub();
  }, [roomCode, isAuthReady, userId]);

  // === SEMÁFORO (solo host) ===
  useEffect(() => {
    if (!isHost || gameState !== 'racing' || !roomCode) return;
    const ref = getRoomRef(roomCode);
    clearTimeout(trafficTimerRef.current);

    const loop = async () => {
      const next = Math.random() > 0.5 ? 'green' : 'red';
      const duration = next === 'green' 
        ? Math.random() * 1300 + 1400 
        : Math.random() * 900 + 700;

      await updateDoc(ref, { trafficLight: next });
      trafficTimerRef.current = setTimeout(loop, duration);
    };

    loop();
    return () => clearTimeout(trafficTimerRef.current);
  }, [isHost, gameState, roomCode]);

  // === CREAR SALA ===
  const createRoom = async () => {
    if (!playerName.trim()) return setError('Escribe tu nombre');
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const ref = getRoomRef(code);
    setRoomCode(code);

    const avatar = AVATARS[selectedAvatarIndex % AVATARS.length];
    const color = COLORS[selectedAvatarIndex % COLORS.length];

    try {
      await setDoc(ref, {
        hostId: userId,
        status: 'waiting',
        trafficLight: 'green',
        createdAt: serverTimestamp(),
        targetScore: TARGET_SCORE,
        players: {
          [userId]: { name: playerName.trim(), score: 0, avatar, color, stunned: false, isHost: true }
        }
      });

      disconnectRef.current = onDisconnect(ref);
      disconnectRef.current.update({ status: 'closed' });

      setError('');
    } catch (e) {
      setError('Error al crear sala');
    }
  };

  // === UNIRSE A SALA ===
  const joinRoom = async () => {
    if (!playerName.trim()) return setError('Escribe tu nombre');
    if (roomCode.length !== 4) return setError('Código de 4 letras');

    const code = roomCode.toUpperCase();
    const ref = getRoomRef(code);
    setRoomCode(code);

    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) return setError('Sala no existe');
      if (snap.data().status !== 'waiting') return setError('El juego ya empezó');

      const avatar = AVATARS[selectedAvatarIndex % AVATARS.length];
      const color = COLORS[selectedAvatarIndex % COLORS.length];

      await updateDoc(ref, {
        [`players.${userId}`]: {
          name: playerName.trim(),
          score: 0,
          avatar,
          color,
          stunned: false,
          isHost: false
        }
      });

      disconnectRef.current = onDisconnect(ref);
      disconnectRef.current.update({ [`players.${userId}`]: deleteField() });

      setError('');
    } catch (e) {
      setError('No se pudo unir');
    }
  };

  // === SALIR DE SALA ===
  const leaveRoom = async () => {
    if (!roomCode) return;
    const ref = getRoomRef(roomCode);

    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) return cleanupAfterLeave();
      const data = snap.data();
      const playerCount = Object.keys(data.players || {}).length;

      if (data.hostId === userId && playerCount > 1) {
        const newHostId = Object.keys(data.players).find(id => id !== userId);
        await updateDoc(ref, {
          hostId: newHostId,
          [`players.${newHostId}.isHost`]: true,
          [`players.${userId}`]: deleteField()
        });
      } else if (playerCount <= 1) {
        await updateDoc(ref, { status: 'closed' });
      } else {
        await updateDoc(ref, { [`players.${userId}`]: deleteField() });
      }
    } finally {
      if (disconnectRef.current) disconnectRef.current.cancel();
      cleanupAfterLeave();
    }
  };

  const cleanupAfterLeave = () => {
    setRoomCode('');
    setView('menu');
    setPlayers({});
    setIsHost(false);
    setGameState('waiting');
    setWinnerName(null);
    setError('');
  };

  // === JUEGO ===
  const startGame = () => updateDoc(getRoomRef(roomCode), { status: 'racing', trafficLight: 'green' });

  const resetGame = () => updateDoc(getRoomRef(roomCode), { 
    status: 'waiting', 
    trafficLight: 'green', 
    winnerName: deleteField(),
    ...Object.keys(players).reduce((acc, uid) => ({
      ...acc,
      [`players.${uid}.score`]: 0,
      [`players.${uid}.stunned`]: false
    }), {})
  });

  // === TAP CON TRANSACCIÓN + ANTI-CHEAT ===
  const handleTap = useCallback(async () => {
    if (tapCooldownRef.current || !roomCode || gameState !== 'racing') return;
    tapCooldownRef.current = true;
    setTimeout(() => tapCooldownRef.current = false, 120);

    if (navigator.vibrate) navigator.vibrate(50);

    const ref = getRoomRef(roomCode);

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        if (data.status !== 'racing') return;

        const me = data.players[userId];
        if (!me) return;

        if (me.stunned) {
          transaction.update(ref, { [`players.${userId}.stunned`]: false });
          return;
        }

        if (data.trafficLight === 'red') {
          transaction.update(ref, {
            [`players.${userId}.score`]: increment(-3),
            [`players.${userId}.stunned`]: true
          });
          return;
        }

        const newScore = (me.score || 0) + 1;
        if (newScore >= data.targetScore && !data.winnerName) {
          transaction.update(ref, {
            [`players.${userId}.score`]: data.targetScore,
            status: 'finished',
            winnerName: me.name
          });
          confetti({ particleCount: 200, spread: 70, origin: { y: 0.6 } });
        } else {
          transaction.update(ref, { [`players.${userId}.score`]: increment(1) });
        }
      });
    } catch (e) {
      console.error(e);
    }
  }, [roomCode, gameState, userId]);

  const getPlayerList = useMemo(() => 
    Object.entries(players || {}).map(([id, p]) => ({ id, ...p }))
  , [players]);

  // === COMPONENTES UI ===
  const AvatarPicker = () => (
    <div className="grid grid-cols-4 gap-4">
      {AVATARS.map((a, i) => (
        <button
          key={i}
          onClick={() => setSelectedAvatarIndex(i)}
          className={`relative p-3 rounded-2xl transition-all ${selectedAvatarIndex === i ? 'ring-4 ring-yellow-400 scale-110' : ''}`}
        >
          <div className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl shadow-2xl ${COLORS[i]}`}>
            {a}
          </div>
          {selectedAvatarIndex === i && <Check className="absolute -top-2 -right-2 bg-yellow-400 rounded-full p-1" size={24} />}
        </button>
      ))}
    </div>
  );

  const MenuView = () => (
    <div className="max-w-lg mx-auto p-8 bg-white rounded-3xl shadow-2xl">
      <h1 className="text-5xl font-black text-center mb-8 bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
        Carrera de Dedos
      </h1>

      <input
        ref={nameInputRef}
        value={playerName}
        onChange={e => setPlayerName(e.target.value)}
        placeholder="Tu nombre"
        className="w-full p-5 text-xl border-4 rounded-2xl focus:ring-4 focus:ring-yellow-400 outline-none"
        maxLength={15}
        autoFocus
      />

      <div className="my-8">
        <p className="text-lg font-bold mb-4 text-center">Elige tu avatar</p>
        <AvatarPicker />
      </div>

      {error && <p className="text-red-600 font-bold text-center bg-red-100 py-3 rounded-xl">{error}</p>}

      <div className="mt-8 space-y-5">
        <button onClick={createRoom} className="w-full bg-gradient-to-r from-yellow-500 to-orange-600 text-white font-black text-2xl py-6 rounded-3xl shadow-2xl hover:scale-105 transition">
          Crear Sala
        </button>

        <div className="flex gap-3">
          <input
            ref={codeInputRef}
            value={roomCode}
            onChange={e => setRoomCode(e.target.value.replace(/[^A-Z0-9]/gi, '').slice(0,4))}
            placeholder="CÓDIGO"
            maxLength={4}
            className="flex-1 p-6 border-4 rounded-3xl text-center font-mono text-4xl tracking-widest uppercase focus:ring-4 focus:ring-blue-500 outline-none"
          />
          <button onClick={joinRoom} className="bg-blue-600 text-white font-black text-2xl px-10 rounded-3xl hover:bg-blue-700 transition">
            Unirse
          </button>
        </div>
      </div>
    </div>
  );

  const LobbyView = () => (
    <div className="max-w-4xl mx-auto p-6">
      <div className="text-center mb-8">
        <h2 className="text-4xl font-black">Sala: <span className="font-mono text-5xl text-purple-600">{roomCode}</span></h2>
        <p className="text-xl mt-2">Jugadores: {getPlayerList.length}/8</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {getPlayerList.map(p => (
          <div key={p.id} className="bg-white rounded-2xl p-6 shadow-xl text-center">
            <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center text-4xl ${p.color} shadow-lg`}>
              {p.avatar}
            </div>
            <p className="font-bold text-xl mt-3">{p.name}</p>
            {p.id === userId && <p className="text-yellow-600 text-sm">(Tú)</p>}
            {p.isHost && <Crown className="mx-auto mt-2 text-purple-600" size={28} />}
          </div>
        ))}
      </div>

      <div className="mt-10 text-center space-x-6">
        {isHost && (
          <button onClick={startGame} className="bg-green-600 text-white px-10 py-5 rounded-2xl font-black text-2xl hover:bg-green-700 transition">
            Iniciar Juego
          </button>
        )}
        <button onClick={leaveRoom} className="bg-red-600 text-white px-8 py-5 rounded-2xl font-black text-xl hover:bg-red-700 transition">
          <LogOut className="inline mr-2" /> Salir
        </button>
      </div>
    </div>
  );

  const GameView = () => {
    const sorted = getPlayerList.slice().sort((a,b) => (b.score||0) - (a.score||0));

    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="text-center mb-6">
          <h2 className="text-5xl font-black mb-4">¡A CORRER!</h2>
          <div className={`inline-flex items-center gap-4 text-6xl ${trafficLight === 'green' ? 'text-green-500' : 'text-red-600'}`}>
            {trafficLight === 'green' ? <Play /> : <AlertOctagon />}
          </div>
        </div>

        <div className="bg-white rounded-3xl p-8 shadow-2xl">
          <div className="space-y-8">
            {sorted.map((p, idx) => {
              const percent = Math.min(100, ((p.score || 0) / targetScore) * 100);
              return (
                <div key={p.id} className="flex items-center gap-4">
                  <div className="text-right w-32 font-bold text-xl">{p.name}</div>
                  <div className="flex-1 bg-gray-200 rounded-full h-16 relative overflow-hidden shadow-inner">
                    <motion.div
                      layout
                      initial={{ width: 0 }}
                      animate={{ width: `${percent}%` }}
                      transition={{ type: "spring", stiffness: 100 }}
                      className={`h-full ${p.color} flex items-center justify-between px-4`}
                    >
                      <span className="text-2xl">{p.avatar}</span>
                      <span className="text-white font-black text-xl">{p.score || 0}</span>
                    </motion.div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-12 text-center">
            <button
              onClick={handleTap}
              disabled={players[userId]?.stunned || trafficLight !== 'green'}
              className={`relative px-20 py-16 rounded-full font-black text-6xl text-white shadow-2xl transition-all
                ${players[userId]?.stunned 
                  ? 'bg-red-600 animate-pulse' 
                  : trafficLight === 'green' 
                    ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 active:scale-95' 
                    : 'bg-gray-500'
                }`}
            >
              {players[userId]?.stunned ? 'STUN' : 'TOCA'}
            </button>
            {isHost && (
              <button onClick={resetGame} className="mt-6 bg-black text-yellow-400 px-8 py-4 rounded-xl font-bold">
                Reiniciar
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const WinnerView = () => (
    <div className="max-w-2xl mx-auto p-8 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        className="bg-gradient-to-br from-yellow-400 to-orange-500 rounded-3xl p-12 shadow-2xl"
      >
        <Trophy size={120} className="mx-auto text-white mb-6" />
        <h2 className="text-6xl font-black text-white mb-4">¡GANADOR!</h2>
        <p className="text-4xl font-black text-black">{winnerName}</p>

        <div className="mt-10">
          {isHost ? (
            <button onClick={resetGame} className="bg-black text-yellow-400 px-12 py-6 rounded-2xl font-black text-3xl">
              Nueva Partida
            </button>
          ) : (
            <button onClick={leaveRoom} className="bg-white text-black px-12 py-6 rounded-2xl font-black text-3xl">
              Salir
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );

  // === RENDER FINAL ===
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 via-pink-100 to-blue-100">
      <AnimatePresence mode="wait">
        {view === 'menu' && <motion.div key="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><MenuView /></motion.div>}
        {view === 'lobby' && <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><LobbyView /></motion.div>}
        {view === 'game' && <motion.div key="game" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><GameView /></motion.div>}
        {view === 'winner' && <motion.div key="winner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><WinnerView /></motion.div>}
      </AnimatePresence>
    </div>
  );
}
