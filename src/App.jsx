import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { auth, db } from './firebase';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  doc, setDoc, getDoc, onSnapshot, updateDoc, increment,
  serverTimestamp, deleteField, runTransaction
} from 'firebase/firestore';

// ==========================================
// CONSTANTES Y UTILIDADES
// ==========================================
const AVATARES = [
  { name: "🚀", label: "Cohete" }, { name: "⚡", label: "Rayo" },
  { name: "🔥", label: "Fuego" }, { name: "💀", label: "Calavera" },
  { name: "👽", label: "Alien" }, { name: "🤖", label: "Robot" },
  { name: "👻", label: "Fantasma" }, { name: "💎", label: "Diamante" },
  { name: "🐉", label: "Dragón" }, { name: "🥷", label: "Ninja" },
  { name: "🦾", label: "Cyborg" }, { name: "🌟", label: "Estrella" }
];

const COLORES = [
  "from-purple-500 to-pink-500", "from-blue-500 to-cyan-500",
  "from-green-500 to-emerald-500", "from-yellow-500 to-orange-500",
  "from-red-500 to-rose-500", "from-indigo-500 to-purple-500",
  "from-pink-500 to-rose-500", "from-teal-500 to-green-500"
];

const TARGET_SCORE = 50; 

const getRoomRef = (code) => doc(db, 'rooms', code.toUpperCase());

// ==========================================
// COMPONENTES VISUALES
// ==========================================

const MenuView = ({ 
  playerName, setPlayerName, inputCode, setInputCode, 
  createRoom, joinRoom, error, 
  selectedAvatarIndex, setSelectedAvatarIndex, 
  setSelectedColorIndex 
}) => {
  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4"
    >
      <div className="max-w-md w-full">
        <motion.div className="text-center mb-6" initial={{ y: -50 }} animate={{ y: 0 }}>
          <div className="text-7xl mb-2">🏁</div>
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
            FINGER RACE
          </h1>
        </motion.div>

        <motion.div className="bg-slate-800/80 backdrop-blur-xl rounded-3xl p-6 border border-purple-500/20 shadow-2xl space-y-5">
          <div>
            <label className="text-purple-300 text-xs font-bold uppercase tracking-wider mb-2 block">Tu Nombre</label>
            <input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Ej: Sonic"
              className="w-full px-5 py-3 bg-slate-900/80 border border-purple-500/30 rounded-xl text-white focus:border-purple-500 outline-none font-bold text-lg placeholder-slate-600 transition-colors"
              maxLength={12}
            />
          </div>

          <div>
            <p className="text-purple-300 text-xs font-bold uppercase tracking-wider mb-2">Avatar</p>
            <div className="grid grid-cols-6 gap-2">
              {AVATARES.map((a, i) => (
                <button
                  key={i}
                  onClick={() => { setSelectedAvatarIndex(i); setSelectedColorIndex(i % COLORES.length); }}
                  className={`aspect-square rounded-lg flex items-center justify-center text-xl transition-all ${selectedAvatarIndex === i ? 'bg-purple-600 ring-2 ring-white scale-110 z-10' : 'bg-slate-700/50 hover:bg-slate-600'}`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-500/20 text-red-200 p-3 rounded-lg text-center text-sm font-bold border border-red-500/50">
              ⚠️ {error}
            </div>
          )}

          <div className="pt-2 space-y-4">
            <button
              onClick={createRoom}
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-black text-lg py-4 rounded-xl shadow-lg transform active:scale-95 transition-all"
            >
              🚀 CREAR SALA
            </button>

            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-slate-600"></div>
              <span className="flex-shrink-0 mx-4 text-slate-500 text-sm">O ÚNETE A UNA</span>
              <div className="flex-grow border-t border-slate-600"></div>
            </div>

            <div className="flex flex-col gap-3">
              <input
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.replace(/[^A-Z0-9]/gi, '').slice(0, 4))}
                placeholder="CÓDIGO DE SALA"
                className="w-full px-5 py-4 text-center text-2xl font-black uppercase tracking-[0.5em] bg-slate-900 border border-slate-600 rounded-xl text-white focus:border-purple-500 outline-none transition-colors"
              />
              <button
                onClick={joinRoom}
                className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black rounded-xl shadow-lg transform active:scale-95 transition-all"
              >
                ENTRAR AHORA
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

const LobbyView = ({ roomCode, players, userId, isHost, startGame, leaveRoom }) => {
  const playerList = Object.entries(players).map(([id, p]) => ({ id, ...p }));
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen bg-slate-900 p-6 flex flex-col items-center">
      <div className="w-full max-w-4xl">
        <div className="flex justify-between items-center mb-8">
          <div className="bg-purple-900/50 px-6 py-2 rounded-full border border-purple-500/30">
            <span className="text-purple-300 text-sm font-bold uppercase mr-2">Código de Sala</span>
            <span className="text-white font-black text-2xl tracking-widest">{roomCode}</span>
          </div>
          <button onClick={leaveRoom} className="text-red-400 font-bold hover:text-red-300">Salir</button>
        </div>

        <div className="text-center mb-10">
          <h2 className="text-3xl text-white font-black mb-2">Preparando Motores...</h2>
          <p className="text-slate-400">{playerList.length} Corredores listos</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-12">
          {playerList.map((p) => (
            <motion.div 
              key={p.id}
              initial={{ scale: 0.5, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }}
              className="bg-slate-800 rounded-2xl p-4 flex flex-col items-center border border-slate-700 relative"
            >
              {p.isHost && <span className="absolute top-2 right-2 text-xs bg-yellow-500 text-black px-2 rounded font-bold">👑</span>}
              <div className={`w-16 h-16 rounded-xl bg-gradient-to-r ${p.color} flex items-center justify-center text-3xl mb-3 shadow-lg`}>
                {p.avatar}
              </div>
              <p className="text-white font-bold truncate w-full text-center">{p.name}</p>
            </motion.div>
          ))}
        </div>

        {isHost ? (
          <button 
            onClick={startGame} 
            className="w-full bg-green-500 hover:bg-green-400 text-black font-black text-2xl py-6 rounded-2xl shadow-xl hover:shadow-green-500/20 transition-all transform active:scale-95"
          >
            🚥 INICIAR CARRERA
          </button>
        ) : (
          <div className="text-center p-6 bg-slate-800/50 rounded-xl animate-pulse">
            <p className="text-slate-300 font-bold">Esperando al anfitrión...</p>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const GameView = ({ players, userId, trafficLight, handleTap, targetScore }) => {
  const sorted = Object.entries(players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const currentPlayer = players[userId];
  const isRed = trafficLight === 'red';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="bg-slate-900 p-4 shadow-lg border-b border-slate-800 z-10 sticky top-0">
        <div className="flex justify-center items-center gap-4">
          <div className={`text-6xl transition-transform duration-100 ${isRed ? 'scale-110 drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]' : 'scale-90 opacity-50'}`}>🔴</div>
          <div className={`text-6xl transition-transform duration-100 ${!isRed ? 'scale-110 drop-shadow-[0_0_15px_rgba(34,197,94,0.8)]' : 'scale-90 opacity-50'}`}>🟢</div>
        </div>
        <p className={`text-center font-black mt-2 text-xl ${isRed ? 'text-red-500' : 'text-green-500'}`}>
          {isRed ? "¡ALTO!" : "¡CORRE!"}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-40 space-y-3">
        {sorted.map((p) => {
          const percent = Math.min(100, ((p.score || 0) / targetScore) * 100);
          const isMe = p.id === userId;
          
          return (
            <div key={p.id} className={`relative rounded-xl p-3 border ${isMe ? 'bg-slate-800 border-purple-500 ring-1 ring-purple-500' : 'bg-slate-900 border-slate-800'}`}>
              <div className="flex items-center gap-3 relative z-10 mb-2">
                <span className="text-2xl">{p.avatar}</span>
                <span className={`font-bold flex-1 ${isMe ? 'text-white' : 'text-slate-400'}`}>
                  {p.name} {isMe && '(Tú)'}
                </span>
                <span className="font-mono text-sm text-slate-500">{p.score}m</span>
              </div>
              
              <div className="h-3 bg-slate-950 rounded-full overflow-hidden relative">
                <motion.div 
                  className={`h-full bg-gradient-to-r ${p.color}`}
                  initial={false}
                  animate={{ width: `${percent}%` }}
                  transition={{ type: "spring", stiffness: 50, damping: 15 }}
                />
              </div>

              {p.stunned && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] rounded-xl flex items-center justify-center z-20">
                  <span className="text-4xl animate-bounce">😵</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="fixed bottom-0 left-0 w-full p-6 bg-gradient-to-t from-black via-black/90 to-transparent flex justify-center pb-8">
        <button
          onPointerDown={handleTap} 
          disabled={!currentPlayer}
          className={`w-32 h-32 rounded-full border-4 border-black/20 shadow-2xl flex items-center justify-center text-5xl transition-all transform active:scale-90 ${
            currentPlayer?.stunned 
              ? 'bg-gray-600 cursor-not-allowed opacity-80' 
              : isRed 
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-green-500 hover:bg-green-400 active:bg-green-600'
          }`}
        >
          {currentPlayer?.stunned ? '🕒' : '👆'}
        </button>
      </div>
    </div>
  );
};

const WinnerView = ({ winnerName, isHost, resetGame, leaveRoom }) => (
  <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
    <motion.div 
      initial={{ scale: 0.8, opacity: 0 }} 
      animate={{ scale: 1, opacity: 1 }}
      className="bg-slate-800 w-full max-w-md p-8 rounded-3xl border border-yellow-500/30 text-center shadow-2xl"
    >
      <div className="text-8xl mb-6 animate-pulse">🏆</div>
      <h2 className="text-3xl font-black text-white mb-2">¡TENEMOS CAMPEÓN!</h2>
      <div className="bg-gradient-to-r from-yellow-400 to-orange-500 text-transparent bg-clip-text text-5xl font-black mb-8 break-words">
        {winnerName}
      </div>

      <div className="space-y-3">
        {isHost ? (
          <button onClick={resetGame} className="w-full bg-white text-black py-4 rounded-xl font-bold text-lg hover:bg-gray-200 transition">
            🔄 Jugar otra vez
          </button>
        ) : (
          <p className="text-slate-500 text-sm mb-4">Esperando que el host reinicie...</p>
        )}
        <button onClick={leaveRoom} className="w-full text-red-400 py-3 font-bold hover:text-red-300">
          Salir al Menú
        </button>
      </div>
    </motion.div>
  </div>
);

// ==========================================
// LOGICA PRINCIPAL (CONTROLADOR)
// ==========================================
export default function FingerRaceGame() {
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState('menu');
  
  const [roomCode, setRoomCode] = useState('');   
  const [inputCode, setInputCode] = useState(''); 
  const [playerName, setPlayerName] = useState('');
  const [selectedAvatarIndex, setSelectedAvatarIndex] = useState(0);
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);

  const [error, setError] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [gameState, setGameState] = useState('waiting');
  const [trafficLight, setTrafficLight] = useState('green');
  const [players, setPlayers] = useState({});
  const [winnerName, setWinnerName] = useState(null);

  const trafficTimerRef = useRef(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) { setUserId(u.uid); setIsAuthReady(true); }
    });
    if (!auth.currentUser) signInAnonymously(auth);
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!roomCode || !userId || !isAuthReady) return;

    const unsub = onSnapshot(getRoomRef(roomCode), (snap) => {
      if (!snap.exists()) {
        leaveRoom(true); 
        return;
      }

      const data = snap.data();
      setPlayers(data.players || {});
      setGameState(data.status || 'waiting');
      setTrafficLight(data.trafficLight || 'green');
      setWinnerName(data.winnerName || null);
      setIsHost(data.hostId === userId);

      // --- DETECTAR GANADOR ---
      if (data.status === 'racing' && !data.winnerName && data.hostId === userId) {
        const playerList = Object.values(data.players || {});
        const winner = playerList.find(p => (p.score || 0) >= TARGET_SCORE);
        
        if (winner) {
          updateDoc(getRoomRef(roomCode), {
            status: 'finished',
            winnerName: winner.name
          });
        }
      }

      if (data.status === 'racing' && view !== 'game') setView('game');
      if (data.status === 'finished' && view !== 'winner') setView('winner');
      if (data.status === 'waiting' && view !== 'lobby') setView('lobby');

    }, (err) => {
      console.error(err);
      setError('Conexión inestable');
    });

    return () => unsub();
  }, [roomCode, userId, isAuthReady, view]);

  const createRoom = async () => {
    if (!playerName.trim()) return setError('Ingresa tu nombre');
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    try {
      await setDoc(getRoomRef(code), {
        hostId: userId,
        status: 'waiting',
        trafficLight: 'green',
        createdAt: serverTimestamp(),
        targetScore: TARGET_SCORE,
        players: {
          [userId]: {
            name: playerName.trim(),
            score: 0,
            avatar: AVATARES[selectedAvatarIndex].name,
            color: COLORES[selectedColorIndex],
            stunned: false,
            isHost: true
          }
        }
      });
      setRoomCode(code);
      setError('');
    } catch (err) { setError('Error: ' + err.message); }
  };

  const joinRoom = async () => {
    if (!playerName.trim()) return setError('Ingresa tu nombre');
    if (inputCode.length !== 4) return setError('Código inválido');

    const code = inputCode.toUpperCase();
    try {
      await runTransaction(db, async (txn) => {
        const ref = getRoomRef(code);
        const snap = await txn.get(ref);
        if (!snap.exists()) throw new Error('Sala no existe');
        if (snap.data().status !== 'waiting') throw new Error('Ya empezó');
        
        txn.update(ref, {
          [`players.${userId}`]: {
            name: playerName.trim(),
            score: 0,
            avatar: AVATARES[selectedAvatarIndex].name,
            color: COLORES[selectedColorIndex],
            stunned: false,
            isHost: false
          }
        });
      });
      setRoomCode(code);
      setError('');
    } catch (err) { setError(err.message); }
  };

  const leaveRoom = async (forceLocal = false) => {
    if (forceLocal) {
      setRoomCode(''); setInputCode(''); setView('menu');
      setPlayers({}); setWinnerName(null);
      return;
    }

    if (roomCode && userId) {
      try {
        const ref = getRoomRef(roomCode);
        await runTransaction(db, async (txn) => {
          const snap = await txn.get(ref);
          if (!snap.exists()) return;
          
          const data = snap.data();
          const p = { ...data.players };
          
          if (Object.keys(p).length <= 1) {
            txn.delete(ref); 
          } else {
            delete p[userId]; 
            let updates = { players: p };
            if (data.hostId === userId) {
              const nextId = Object.keys(p)[0];
              updates.hostId = nextId;
              p[nextId].isHost = true;
            }
            txn.update(ref, updates);
          }
        });
      } catch (e) { console.error(e); }
    }
    setRoomCode(''); setInputCode(''); setView('menu');
    setPlayers({});
  };

  const startGame = async () => {
    try {
      await updateDoc(getRoomRef(roomCode), { status: 'racing', trafficLight: 'green' });
      startTrafficLoop();
    } catch (e) { console.error(e); }
  };

  const resetGame = async () => {
    try {
      const ref = getRoomRef(roomCode);
      await runTransaction(db, async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists()) return;
        const p = snap.data().players;
        Object.keys(p).forEach(k => { p[k].score = 0; p[k].stunned = false; });
        txn.update(ref, { status: 'waiting', players: p, trafficLight: 'green', winnerName: deleteField() });
      });
    } catch (e) { console.error(e); }
  };

  const startTrafficLoop = () => {
    if (trafficTimerRef.current) clearInterval(trafficTimerRef.current);
    trafficTimerRef.current = setInterval(async () => {
      try {
        const ref = getRoomRef(roomCode);
        const snap = await getDoc(ref);
        if (!snap.exists() || snap.data().status !== 'racing') {
          clearInterval(trafficTimerRef.current);
          return;
        }
        const currentLight = snap.data().trafficLight;
        const nextLight = currentLight === 'green' ? 'red' : 'green';
        await updateDoc(ref, { trafficLight: nextLight });
      } catch (e) { console.error(e); }
    }, 2000 + Math.random() * 2500);
  };

  const handleTap = useCallback(async () => {
    if (gameState !== 'racing' || !userId) return;

    const myPlayer = players[userId];
    if (myPlayer?.stunned) {
      const ref = getRoomRef(roomCode);
      updateDoc(ref, { [`players.${userId}.stunned`]: false }).catch(console.error);
      return;
    }

    const ref = getRoomRef(roomCode);
    
    if (trafficLight === 'red') {
      updateDoc(ref, {
        [`players.${userId}.score`]: increment(-5),
        [`players.${userId}.stunned`]: true
      }).catch(console.error);
    } else {
      updateDoc(ref, {
        [`players.${userId}.score`]: increment(1)
      }).catch(console.error);
    }
  }, [gameState, userId, players, roomCode, trafficLight]);

  if (!isAuthReady) return <div className="h-screen bg-slate-900 flex items-center justify-center text-white">Cargando...</div>;

  return (
    <AnimatePresence mode="wait">
      {view === 'menu' && (
        <MenuView 
          key="menu"
          playerName={playerName} setPlayerName={setPlayerName}
          inputCode={inputCode} setInputCode={setInputCode}
          createRoom={createRoom} joinRoom={joinRoom} error={error}
          selectedAvatarIndex={selectedAvatarIndex} setSelectedAvatarIndex={setSelectedAvatarIndex}
          setSelectedColorIndex={setSelectedColorIndex}
        />
      )}
      {view === 'lobby' && (
        <LobbyView 
          key="lobby"
          roomCode={roomCode} players={players} userId={userId} 
          isHost={isHost} startGame={startGame} leaveRoom={() => leaveRoom(false)}
        />
      )}
      {view === 'game' && (
        <GameView 
          key="game"
          players={players} userId={userId} trafficLight={trafficLight}
          handleTap={handleTap} targetScore={TARGET_SCORE}
        />
      )}
      {view === 'winner' && (
        <WinnerView 
          key="winner"
          winnerName={winnerName} isHost={isHost} 
          resetGame={resetGame} leaveRoom={() => leaveRoom(false)}
        />
      )}
    </AnimatePresence>
  );
}
