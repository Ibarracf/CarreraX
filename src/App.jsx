// App.jsx corregido
import React, { useState, useEffect, useRef } from 'react';
import { Play, Zap, Trophy, AlertOctagon, Footprints, Users, Smartphone, X } from 'lucide-react';

// Firebase ya inicializado en firebase.js
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

const TARGET_SCORE = 100;

export default function FingerRaceGame() {
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState('menu');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState('');

  const [isHost, setIsHost] = useState(false);
  const [gameState, setGameState] = useState('waiting');
  const [trafficLight, setTrafficLight] = useState('green');
  const [players, setPlayers] = useState({});
  const [winnerName, setWinnerName] = useState(null);
  const [myPenalty, setMyPenalty] = useState(false);

  const trafficTimerRef = useRef(null);

  const getRoomRef = (code) => doc(db, 'rooms', code);

  // Autenticación
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUserId(u.uid);
        setIsAuthReady(true);
      }
    });

    signInAnonymously(auth).catch(err => {
      setError("No se pudo autenticar con Firebase");
      console.error(err);
    });

    return () => unsub();
  }, []);

  // Listener de sala
  useEffect(() => {
    if (!roomCode || !isAuthReady) return;
    const ref = getRoomRef(roomCode);

    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setError("La sala no existe o se cerró.");
        setView('menu');
        return;
      }

      const data = snap.data();
      setPlayers(data.players || {});
      setGameState(data.status);
      setTrafficLight(data.trafficLight || 'green');
      setWinnerName(data.winnerName || null);

      if (data.status === 'waiting') setView('lobby');
      if (data.status === 'racing') setView('game');
      if (data.status === 'finished') setView('winner');
    });

    return () => unsub();
  }, [roomCode, isAuthReady]);

  const createRoom = async () => {
    if (!playerName) return setError("Necesitas un nombre.");
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const ref = getRoomRef(code);

    const avatar = AVATARS[userId?.charCodeAt(0) % AVATARS.length];
    const color = COLORS[userId?.charCodeAt(1) % COLORS.length];

    await setDoc(ref, {
      hostId: userId,
      status: 'waiting',
      trafficLight: 'green',
      createdAt: serverTimestamp(),
      players: {
        [userId]: { name: playerName, score: 0, avatar, color, stunned: false, isHost: true }
      }
    });

    setRoomCode(code);
    setIsHost(true);
    setError('');
  };

  const joinRoom = async () => {
    if (!playerName || !roomCode) return setError("Datos incompletos.");
    const code = roomCode.toUpperCase();
    const ref = getRoomRef(code);

    const snap = await getDoc(ref);
    if (!snap.exists()) return setError("Sala inexistente.");
    const data = snap.data();

    if (data.status !== 'waiting') return setError("El juego ya inició.");

    const list = data.players || {};
    const avatar = AVATARS[(Object.keys(list).length) % AVATARS.length];
    const color = COLORS[(Object.keys(list).length) % COLORS.length];

    await updateDoc(ref, {
      [`players.${userId}`]: { name: playerName, score: 0, avatar, color, stunned: false, isHost: false }
    });

    setRoomCode(code);
    setIsHost(false);
    setError('');
  };

  const startGame = async () => {
    if (!isHost) return;
    await updateDoc(getRoomRef(roomCode), { status: 'racing', trafficLight: 'green' });
  };

  const handleTap = async () => {
    const me = players[userId];
    if (!me || gameState !== 'racing') return;

    const ref = getRoomRef(roomCode);

    if (trafficLight === 'red') {
      await updateDoc(ref, {
        [`players.${userId}.score`]: increment(-5),
        [`players.${userId}.stunned`]: true
      });
      setMyPenalty(true);
      return;
    }

    const newScore = me.score + 1;

    if (newScore >= TARGET_SCORE) {
      await updateDoc(ref, {
        [`players.${userId}.score`]: TARGET_SCORE,
        status: 'finished',
        winnerName: me.name
      });
    } else {
      await updateDoc(ref, {
        [`players.${userId}.score`]: increment(1)
      });
    }
  };

  // UI --- SOLO PARA ACORTAR LO MOSTRAMOS COMO MENÚ SIMPLE ---

  return (
    <div className="p-6 text-center">
      {view === 'menu' && (
        <>
          <h1 className="text-2xl font-bold mb-4">Carrera de Dedos</h1>

          <input className="p-2 border w-full mb-3" placeholder="Tu nombre" onChange={(e) => setPlayerName(e.target.value)} />

          <button className="bg-yellow-500 w-full p-3 text-white rounded mb-3" onClick={createRoom}>Crear Sala</button>

          <div className="flex gap-2">
            <input className="p-2 border flex-1" placeholder="Código" maxLength={4} onChange={(e)=>setRoomCode(e.target.value.toUpperCase())} />
            <button className="bg-blue-600 text-white p-3 rounded" onClick={joinRoom}>Unirse</button>
          </div>

          {error && <p className="text-red-500 mt-3">{error}</p>}
        </>
      )}

      {view === 'lobby' && (
        <>
          <h2 className="text-xl font-bold">Sala: {roomCode}</h2>
          <button className="bg-green-600 text-white p-3 rounded mt-4" onClick={startGame}>Iniciar</button>
        </>
      )}

      {view === 'game' && (
        <>
          <h2 className="text-xl font-bold mb-4">¡Toca rápido!</h2>
          <button className="bg-orange-500 text-white p-6 rounded-full text-xl" onClick={handleTap}>TOCAR</button>
        </>
      )}

      {view === 'winner' && (
        <h1 className="text-3xl font-bold">Ganó: {winnerName}</h1>
      )}
    </div>
  );
}
