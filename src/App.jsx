// App.jsx - Versión completa con vistas, animaciones, selección de avatar y semáforo
import React, { useState, useEffect, useRef } from 'react';
import { Play, Zap, Trophy, AlertOctagon, Footprints, Users, Smartphone, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Firebase ya inicializado en firebase.js (archivo separado)
import { auth, db } from './firebase';
import { 
  signInAnonymously,
  onAuthStateChanged
} from 'firebase/auth';
import { 
  doc, setDoc, getDoc, onSnapshot, updateDoc, increment,
  serverTimestamp, deleteField
} from 'firebase/firestore';

// Avatares y colores
const AVATARS = ["🚗", "🏍️", "🏃", "🐎", "🚀", "🛹", "🦖", "🐕"];
const COLORS = [
  "bg-red-500", "bg-blue-500", "bg-green-500", "bg-yellow-500", 
  "bg-purple-500", "bg-pink-500", "bg-orange-500", "bg-teal-500"
];

const TARGET_SCORE = 30; // más corto para demos

export default function FingerRaceGame() {
  // --- Estados generales ---
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState('menu'); // menu, lobby, game, winner
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState('');
  const [selectedAvatarIndex, setSelectedAvatarIndex] = useState(0);

  // juego
  const [isHost, setIsHost] = useState(false);
  const [gameState, setGameState] = useState('waiting');
  const [trafficLight, setTrafficLight] = useState('green');
  const [players, setPlayers] = useState({});
  const [winnerName, setWinnerName] = useState(null);
  const trafficTimerRef = useRef(null);
  const roomListenerRef = useRef(null);

  const getRoomRef = (code) => doc(db, 'rooms', code);

  // --- Autenticación ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUserId(u.uid);
        setIsAuthReady(true);
      }
    });

    signInAnonymously(auth).catch(err => {
      setError('No se pudo autenticar con Firebase');
      console.error(err);
    });

    return () => unsub();
  }, []);

  // --- Escucha de Sala ---
  useEffect(() => {
    if (!isAuthReady || !roomCode) return;

    const ref = getRoomRef(roomCode);

    // limpiar listener previo
    if (roomListenerRef.current) roomListenerRef.current();

    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setError('La sala no existe o se cerró.');
        setView('menu');
        return;
      }

      const data = snap.data();
      setPlayers(data.players || {});
      setGameState(data.status || 'waiting');
      setTrafficLight(data.trafficLight || 'green');
      setWinnerName(data.winnerName || null);

      if (data.status === 'waiting') setView('lobby');
      if (data.status === 'racing') setView('game');
      if (data.status === 'finished') setView('winner');

      // Si soy host y el juego cambió a 'racing' y no hay loop de semáforo, iniciarlo
      if (data.hostId === userId) setIsHost(true);
    }, (e) => {
      console.error('Error en onSnapshot:', e);
      setError('Error de conexión a la sala');
    });

    roomListenerRef.current = unsub;

    return () => unsub();
  }, [roomCode, isAuthReady, userId]);

  // --- Lógica del semáforo local (host) ---
  useEffect(() => {
    if (!isHost || gameState !== 'racing' || !roomCode) return;
    const ref = getRoomRef(roomCode);

    const loop = async () => {
      try {
        const next = Math.random() > 0.5 ? 'green' : 'red';
        // Duración variable
        const duration = next === 'green' ? (Math.random() * 1200 + 1500) : (Math.random() * 1000 + 800);
        await updateDoc(ref, { trafficLight: next });
        trafficTimerRef.current = setTimeout(loop, duration);
      } catch (e) {
        console.error('Error con semáforo host:', e);
        clearTimeout(trafficTimerRef.current);
      }
    };

    // inicio inmediato
    loop();

    return () => clearTimeout(trafficTimerRef.current);
  }, [isHost, gameState, roomCode]);

  // --- Crear sala ---
  const createRoom = async () => {
    if (!playerName) return setError('Necesitas un nombre');
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const ref = getRoomRef(code);

    const avatar = AVATARS[selectedAvatarIndex % AVATARS.length];
    const color = COLORS[selectedAvatarIndex % COLORS.length];

    const myPlayer = { name: playerName, score: 0, avatar, color, stunned: false, isHost: true };

    try {
      await setDoc(ref, {
        hostId: userId,
        status: 'waiting',
        trafficLight: 'green',
        createdAt: serverTimestamp(),
        players: { [userId]: myPlayer },
        targetScore: TARGET_SCORE
      });
      setRoomCode(code);
      setIsHost(true);
      setError('');
    } catch (e) {
      console.error('Error al crear sala:', e);
      setError('No se pudo crear la sala');
    }
  };

  // --- Unirse ---
  const joinRoom = async () => {
    if (!playerName) return setError('Necesitas un nombre');
    if (!roomCode) return setError('Código inválido');
    const code = roomCode.toUpperCase();
    const ref = getRoomRef(code);

    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) return setError('La sala no existe');
      const data = snap.data();
      if (data.status !== 'waiting') return setError('El juego ya comenzó');

      const avatar = AVATARS[selectedAvatarIndex % AVATARS.length];
      const color = COLORS[selectedAvatarIndex % COLORS.length];
      const playerObj = { name: playerName, score: 0, avatar, color, stunned: false, isHost: false };

      await updateDoc(ref, { [`players.${userId}`]: playerObj });
      setRoomCode(code);
      setIsHost(data.hostId === userId);
      setError('');
    } catch (e) {
      console.error('Error al unirse:', e);
      setError('No se pudo unir a la sala');
    }
  };

  // --- Salir ---
  const leaveRoom = async () => {
    if (!roomCode) return;
    const ref = getRoomRef(roomCode);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      const playerCount = Object.keys(data.players || {}).length;

      if (data.hostId === userId || playerCount <= 1) {
        // cerrar
        await updateDoc(ref, { status: 'closed' });
      } else {
        await updateDoc(ref, { [`players.${userId}`]: deleteField() });
      }
    } catch (e) {
      console.error('Error al salir:', e);
    } finally {
      setRoomCode(''); setView('menu'); setPlayers({}); setIsHost(false); setError('');
    }
  };

  // --- Iniciar juego (host) ---
  const startGame = async () => {
    if (!isHost || !roomCode) return;
    const ref = getRoomRef(roomCode);
    try {
      await updateDoc(ref, { status: 'racing', trafficLight: 'green' });
    } catch (e) { console.error(e); }
  };

  // --- Resetear juego (host) ---
  const resetGame = async () => {
    if (!isHost || !roomCode) return;
    const ref = getRoomRef(roomCode);
    const resetObj = Object.keys(players || {}).reduce((acc, uid) => {
      acc[`players.${uid}.score`] = 0;
      acc[`players.${uid}.stunned`] = false;
      return acc;
    }, {});

    try {
      await updateDoc(ref, { ...resetObj, status: 'waiting', trafficLight: 'green', winnerName: deleteField() });
      setView('lobby');
    } catch (e) { console.error(e); }
  };

  // --- Manejar taps ---
  const handleTap = async () => {
    if (!roomCode || !players[userId] || gameState !== 'racing') return;
    const me = players[userId];
    const ref = getRoomRef(roomCode);

    if (me.stunned) {
      // toca para despejar stun
      await updateDoc(ref, { [`players.${userId}.stunned`]: false });
      return;
    }

    if (trafficLight === 'red') {
      // penalización
      await updateDoc(ref, { [`players.${userId}.score`]: increment(-3), [`players.${userId}.stunned`]: true });
      return;
    }

    const newScore = (me.score || 0) + 1;
    if (newScore >= (players?.targetScore || TARGET_SCORE)) {
      await updateDoc(ref, { [`players.${userId}.score`]: (players?.targetScore || TARGET_SCORE), status: 'finished', winnerName: me.name });
    } else {
      await updateDoc(ref, { [`players.${userId}.score`]: increment(1) });
    }
  };

  // --- Helpers UI ---
  const getPlayerList = () => Object.keys(players || {}).map(uid => ({ id: uid, ...players[uid] }));

  // --- Componentes UI ---
  const AvatarPicker = () => (
    <div className="w-full flex gap-2 flex-wrap">
      {AVATARS.map((a, idx) => (
        <button key={idx} onClick={() => setSelectedAvatarIndex(idx)} className={`p-3 rounded-lg border-2 ${selectedAvatarIndex===idx? 'border-yellow-400 scale-105':'border-transparent'} transition-transform` }>
          <div className={`w-12 h-12 flex items-center justify-center text-2xl ${COLORS[idx%COLORS.length]} rounded-full`}>{a}</div>
        </button>
      ))}
    </div>
  );

  const MenuView = () => (
    <div className="max-w-xl mx-auto p-6 bg-white rounded-2xl shadow-2xl">
      <div className="flex items-center gap-3 mb-4">
        <Smartphone size={28} className="text-yellow-500" />
        <h1 className="text-2xl font-black">Carrera de Dedos</h1>
      </div>

      <label className="block text-sm font-medium text-gray-700">Tu nombre</label>
      <input value={playerName} onChange={(e)=>setPlayerName(e.target.value)} className="w-full p-3 border rounded-lg mb-3" placeholder="Ej: Rayo" maxLength={18} />

      <label className="block text-sm font-medium text-gray-700 mb-2">Elige tu avatar</label>
      <AvatarPicker />

      {error && <div className="mt-4 p-3 rounded bg-red-100 text-red-700">{error}</div>}

      <div className="mt-4 grid grid-cols-1 gap-3">
        <button onClick={createRoom} className="bg-yellow-500 text-white p-3 rounded-xl font-bold">Crear Sala</button>
        <div className="flex gap-2">
          <input value={roomCode} onChange={(e)=>setRoomCode(e.target.value.toUpperCase())} placeholder="CÓDIGO" maxLength={4} className="flex-1 p-3 border rounded-xl text-center font-mono" />
          <button onClick={joinRoom} className="bg-blue-600 text-white p-3 rounded-xl">Unirse</button>
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-400">Autenticación: {isAuthReady? 'Lista' : 'Cargando...' } — Tu ID: {userId || 'N/A'}</p>
    </div>
  );

  const LobbyView = () => (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-black">Sala: {roomCode}</h2>
        <div className="flex gap-2">
          {isHost && <button onClick={startGame} className="bg-green-600 text-white px-4 py-2 rounded">Iniciar juego</button>}
          <button onClick={leaveRoom} className="bg-red-100 text-red-600 px-4 py-2 rounded">Salir</button>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 shadow">
        <h3 className="font-bold mb-3">Jugadores</h3>
        <div className="grid grid-cols-2 gap-3">
          {getPlayerList().map(p => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${p.color}`}>{p.avatar}</div>
              <div className="flex-1">
                <div className="font-bold">{p.name} {p.id===userId && <span className="text-xs text-yellow-600">(Tú)</span>}</div>
                <div className="text-xs text-gray-500">{p.score} pts</div>
              </div>
              {p.isHost && <div className="text-sm font-semibold text-purple-600">HOST</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 text-right">
        <button onClick={leaveRoom} className="text-sm text-gray-500 underline">Abandonar sala</button>
      </div>
    </div>
  );

  // Track visual: muestra avance en tiempo real
  const GameView = () => {
    const list = getPlayerList().sort((a,b)=> (b.score||0)-(a.score||0));

    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-black">¡Carrera en marcha!</h2>
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${trafficLight==='red'? 'bg-red-500':'bg-green-500'} text-white`}> 
              {trafficLight==='red'? <AlertOctagon/> : <Play/>}
            </div>
            {isHost && <button onClick={resetGame} className="bg-black text-yellow-400 px-4 py-2 rounded">Reiniciar</button>}
            <button onClick={leaveRoom} className="text-sm text-gray-500 underline">Salir</button>
          </div>
        </div>

        {/* Pista */}
        <div className="bg-white rounded-2xl p-6 shadow">
          <div className="relative h-40 bg-gray-100 rounded-lg overflow-hidden">
            {/* meta a la derecha */}
            <div className="absolute right-2 top-2 text-sm font-bold text-gray-700">META</div>

            {list.map((p, idx) => {
              const percent = Math.min(100, ((p.score||0) / (players?.targetScore || TARGET_SCORE)) * 100);
              return (
                <div key={p.id} className="absolute left-0 right-0" style={{ top: 12 + idx*44 }}>
                  <div className="flex items-center gap-3">
                    <div className="w-16 text-right pr-2 text-sm font-semibold">{p.name}</div>
                    <div className="flex-1 h-10 bg-white rounded-lg shadow-inner relative">
                      {/* barra de progreso */}
                      <motion.div
                        layout
                        initial={{ width: 0 }}
                        animate={{ width: `${percent}%` }}
                        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                        className={`h-10 rounded-lg flex items-center pl-3 ${p.color}`}
                      >
                        <div className="text-lg">{p.avatar}</div>
                        <div className="ml-3 text-sm font-bold text-white">{p.score || 0}</div>
                      </motion.div>
                    </div>
                  </div>
                </div>
              );
            })}

          </div>

          <div className="mt-6 grid grid-cols-1 gap-3">
            <button onClick={handleTap} className={`p-4 rounded-xl font-black text-white text-xl ${players[userId]?.stunned? 'bg-red-500 opacity-80 cursor-not-allowed' : (trafficLight==='green'? 'bg-green-600 hover:bg-green-700':'bg-gray-400 cursor-not-allowed')}`}>¡TOCA!</button>
            <div className="text-sm text-gray-500">Pista con progreso en tiempo real — Toca cuando la luz esté verde. En rojo penaliza y te stunnea.</div>
          </div>
        </div>
      </div>
    );
  };

  const WinnerView = () => (
    <div className="max-w-2xl mx-auto p-6 text-center">
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring' }} className="bg-yellow-400 rounded-2xl p-6 shadow-lg">
        <Trophy size={72} className="mx-auto text-white mb-4" />
        <h2 className="text-3xl font-black">¡Ganador!</h2>
        <p className="mt-2 text-xl font-bold text-black">{winnerName}</p>

        <div className="mt-6 flex justify-center gap-4">
          {isHost ? <button onClick={resetGame} className="bg-black text-yellow-400 px-4 py-2 rounded">Reiniciar</button> : <button onClick={() => { setView('lobby'); }} className="bg-white px-4 py-2 rounded">Volver al lobby</button>}
        </div>

        <div className="mt-6 bg-white p-4 rounded-lg">
          <h4 className="font-bold mb-2">Resultados</h4>
          {getPlayerList().sort((a,b)=> (b.score||0)-(a.score||0)).map((p, idx) => (
            <div key={p.id} className="flex justify-between py-2 border-b last:border-0">
              <div className="flex items-center gap-3"><div className={`w-8 h-8 rounded-full flex items-center justify-center ${p.color}`}>{p.avatar}</div><div>{p.name}</div></div>
              <div className="font-black">{p.score || 0}</div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );

  // --- Render principal ---
  return (
    <div className="min-h-screen bg-gray-100 p-6 font-sans">
      <AnimatePresence mode="wait">
        {view === 'menu' && <motion.div key="m" initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}><MenuView /></motion.div>}
        {view === 'lobby' && <motion.div key="l" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}><LobbyView /></motion.div>}
        {view === 'game' && <motion.div key="g" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}><GameView /></motion.div>}
        {view === 'winner' && <motion.div key="w" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}><WinnerView /></motion.div>}
      </AnimatePresence>
    </div>
  );
}
