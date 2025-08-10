import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// El componente principal de la aplicación.
const App = () => {
  // --- Estados de la aplicación
  const [tracks, setTracks] = useState([
    { id: 'melody', name: 'Melodía', instrumentType: 'synth', notes: [], volume: 0.8, delaySend: 0.3 },
    { id: 'drums', name: 'Batería', instrumentType: 'drums', notes: [], volume: 1.0, delaySend: 0.1 }
  ]);
  const [activeTrackId, setActiveTrackId] = useState('melody');
  const [prompt, setPrompt] = useState('generar una melodía pegadiza');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState(null);
  const [bpm, setBpm] = useState(120);
  const [projectId, setProjectId] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  
  // --- Referencias para el Web Audio API
  const audioContextRef = useRef(null);
  const playLoopRef = useRef(null);
  const playIndexRef = useRef(0);
  const gainNodeRef = useRef(null);
  const delayNodeRef = useRef(null);
  const feedbackGainRef = useRef(null);

  // --- Estados y referencias de Firebase
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // --- Constantes para la cuadrícula y sonidos
  const synthNotes = ['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4'];
  const drumNotes = ['Kick', 'Snare', 'Hi-Hat'];
  const noteNames = {
      synth: synthNotes,
      drums: drumNotes
  };
  const gridLength = 16;
  const frequencies = {
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
    G4: 392.00, A4: 440.00, B4: 493.88, C5: 523.25
  };

  // Drum sounds - Usamos generadores de ruido y envolventes simples para simular.
  const drumSounds = {
      'Kick': (context) => {
          const osc = context.createOscillator();
          osc.frequency.setValueAtTime(100, context.currentTime);
          osc.frequency.exponentialRampToValueAtTime(0.01, context.currentTime + 0.5);
          const gain = context.createGain();
          gain.gain.setValueAtTime(1, context.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.5);
          return { source: osc, gain: gain };
      },
      'Snare': (context) => {
          const noise = context.createBufferSource();
          const bufferSize = context.sampleRate * 0.5;
          const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
          const output = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
              output[i] = Math.random() * 2 - 1;
          }
          noise.buffer = buffer;
          const gain = context.createGain();
          gain.gain.setValueAtTime(1, context.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.1);
          return { source: noise, gain: gain };
      },
      'Hi-Hat': (context) => {
          const osc = context.createOscillator();
          osc.type = 'sawtooth';
          const gain = context.createGain();
          gain.gain.setValueAtTime(0.5, context.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.05);
          return { source: osc, gain: gain };
      }
  };

  // Inicializa el Web Audio API y Firebase.
  useEffect(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        gainNodeRef.current = audioContextRef.current.createGain();
        delayNodeRef.current = audioContextRef.current.createDelay(1.0);
        feedbackGainRef.current = audioContextRef.current.createGain();

        // Conecta los nodos de audio
        delayNodeRef.current.connect(feedbackGainRef.current);
        feedbackGainRef.current.connect(delayNodeRef.current);
        delayNodeRef.current.connect(gainNodeRef.current);
        gainNodeRef.current.connect(audioContextRef.current.destination);

        // Establece el tiempo de delay
        delayNodeRef.current.delayTime.value = 0.25;
        feedbackGainRef.current.gain.value = 0.4;
      }
    } catch (e) {
      setError('El Web Audio API no es compatible con este navegador.');
    }

    // Inicializa Firebase
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

    if (Object.keys(firebaseConfig).length > 0) {
      const app = initializeApp(firebaseConfig);
      setDb(getFirestore(app));
      const authInstance = getAuth(app);
      const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
        if (user) {
          setUserId(user.uid);
        } else if (initialAuthToken) {
          try {
            await signInWithCustomToken(authInstance, initialAuthToken);
          } catch (e) {
            console.error('Error signing in with custom token:', e);
          }
        } else {
          try {
            await signInAnonymously(authInstance);
          } catch (e) {
            console.error('Error signing in anonymously:', e);
          }
        }
        setIsAuthReady(true);
      });
      return () => unsubscribe();
    }
  }, []);

  /**
   * Reproduce una nota musical o un sonido de batería.
   * @param {string} instrumentType - 'synth' o 'drums'.
   * @param {string} noteName - Nombre de la nota o del sonido.
   * @param {number} volume - Volumen de la nota (0-1).
   * @param {number} delaySend - Cantidad de señal enviada al delay (0-1).
   * @param {number} duration - Duración de la nota en segundos.
   */
  const playSound = (instrumentType, noteName, volume, delaySend, duration) => {
    if (!audioContextRef.current) return;

    let sourceNode;
    let gainNode = audioContextRef.current.createGain();
    gainNode.gain.value = volume;

    if (instrumentType === 'synth') {
      const frequency = frequencies[noteName];
      const oscillator = audioContextRef.current.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, audioContextRef.current.currentTime);
      sourceNode = oscillator;
    } else if (instrumentType === 'drums') {
      const { source, gain } = drumSounds[noteName](audioContextRef.current);
      sourceNode = source;
      gainNode.connect(gain);
    }
    
    sourceNode.connect(gainNode);

    // Conexión al delay y al master gain
    gainNode.connect(gainNodeRef.current); // Conexión a la salida principal
    const delayGain = audioContextRef.current.createGain();
    delayGain.gain.value = delaySend;
    gainNode.connect(delayGain);
    delayGain.connect(delayNodeRef.current);
    
    sourceNode.start(audioContextRef.current.currentTime);
    sourceNode.stop(audioContextRef.current.currentTime + duration);
  };

  /**
   * Inicia la reproducción del secuenciador en un bucle.
   */
  const startPlayback = () => {
    stopPlayback(); // Asegura que no haya otro bucle corriendo.
    
    let index = 0;
    const intervalTime = 60000 / bpm / 4; // Notas de 16avos.
    const noteDuration = intervalTime * 0.9;
    const activeTrack = tracks.find(t => t.id === activeTrackId);
    
    gainNodeRef.current.gain.value = activeTrack.volume;
    delayNodeRef.current.delayTime.value = 60 / bpm * 0.5; // Ajusta el delay al BPM
    feedbackGainRef.current.gain.value = activeTrack.delaySend;

    playLoopRef.current = setInterval(() => {
      tracks.forEach(track => {
        // Ajusta el volumen y el delay para la pista actual
        const trackVolume = track.volume;
        const trackDelay = track.delaySend;

        track.notes.forEach(note => {
          if (note.x === index) {
            playSound(track.instrumentType, note.y, trackVolume, trackDelay, noteDuration / 1000);
          }
        });
      });

      playIndexRef.current = index;
      index = (index + 1) % gridLength;
    }, intervalTime);
  };

  /**
   * Detiene la reproducción.
   */
  const stopPlayback = () => {
    clearInterval(playLoopRef.current);
    playLoopRef.current = null;
    playIndexRef.current = 0;
  };

  /**
   * Maneja el clic en la cuadrícula para añadir o eliminar notas en la pista activa.
   */
  const handleGridClick = (x, y) => {
    const newTracks = tracks.map(track => {
      if (track.id === activeTrackId) {
        const existingNoteIndex = track.notes.findIndex(note => note.x === x && note.y === y);
        if (existingNoteIndex > -1) {
          const newNotes = [...track.notes];
          newNotes.splice(existingNoteIndex, 1);
          return { ...track, notes: newNotes };
        } else {
          return { ...track, notes: [...track.notes, { x, y }] };
        }
      }
      return track;
    });
    setTracks(newTracks);
  };

  /**
   * Llama a la API de Gemini para generar una nueva secuencia musical para la pista activa.
   */
  const generateMusic = async () => {
    setStatusMessage('Generando música con IA...');
    setError(null);
    stopPlayback();

    try {
      const activeTrack = tracks.find(t => t.id === activeTrackId);
      const currentNotesString = activeTrack.notes.map(note => `${note.y} en la posición ${note.x}`).join(', ');
      const userPrompt = `Dada la siguiente secuencia musical: "${currentNotesString}". ${prompt}. Responde con una nueva secuencia de notas musicales en formato JSON.`;

      const chatHistory = [{ role: "user", parts: [{ text: userPrompt }] }];
      const payload = {
        contents: chatHistory,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                x: { type: "INTEGER" },
                y: { type: "STRING" }
              },
              required: ["x", "y"]
            }
          }
        }
      };

      // Carga la clave de la variable de entorno
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`Error en la API: ${response.statusText}`);

      const result = await response.json();
      
      const json = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!json) throw new Error('La respuesta de la IA está vacía o es inválida.');

      const parsedJson = JSON.parse(json);
      if (!Array.isArray(parsedJson)) throw new Error('La respuesta de la IA no es un array válido.');

      const newTracks = tracks.map(track => track.id === activeTrackId ? { ...track, notes: parsedJson } : track);
      setTracks(newTracks);
      setStatusMessage('¡Música generada con éxito!');
    } catch (e) {
      console.error(e);
      setStatusMessage('');
      setError(`Ocurrió un error: ${e.message}`);
    }
  };

  // --- Funciones de Firestore
  const saveProject = async () => {
    if (!isAuthReady || !userId || !projectId) {
      setStatusMessage('Por favor, ingresa un ID de proyecto válido.');
      return;
    }
    setStatusMessage('Guardando proyecto...');
    setError(null);
    try {
      const docRef = doc(db, `artifacts/${__app_id}/users/${userId}/projects/${projectId}`);
      await setDoc(docRef, { tracks, bpm });
      setStatusMessage(`Proyecto "${projectId}" guardado con éxito.`);
    } catch (e) {
      console.error(e);
      setStatusMessage('');
      setError(`Error al guardar el proyecto: ${e.message}`);
    }
  };

  const loadProject = async () => {
    if (!isAuthReady || !userId || !projectId) {
      setStatusMessage('Por favor, ingresa un ID de proyecto válido.');
      return;
    }
    setStatusMessage('Cargando proyecto...');
    setError(null);
    try {
      const docRef = doc(db, `artifacts/${__app_id}/users/${userId}/projects/${projectId}`);
      onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setTracks(data.tracks || []);
          setBpm(data.bpm || 120);
          setStatusMessage(`Proyecto "${projectId}" cargado con éxito.`);
        } else {
          setStatusMessage('');
          setError(`El proyecto con ID "${projectId}" no existe.`);
        }
      });
    } catch (e) {
      console.error(e);
      setStatusMessage('');
      setError(`Error al cargar el proyecto: ${e.message}`);
    }
  };

  // --- Funciones para exportar a .WAV
  const exportToWAV = async () => {
    setIsExporting(true);
    setStatusMessage('Exportando a WAV...');
    stopPlayback();

    try {
      const duration = (60 / bpm * gridLength * 4);
      const offlineContext = new OfflineAudioContext(2, audioContextRef.current.sampleRate * duration, audioContextRef.current.sampleRate);
      
      tracks.forEach(track => {
        const trackNotes = track.notes;
        const instrumentType = track.instrumentType;
        const trackVolume = track.volume;
        const trackDelay = track.delaySend;

        trackNotes.forEach(note => {
          const time = (60 / bpm / 4) * note.x;
          playSound(instrumentType, note.y, trackVolume, trackDelay, (60 / bpm / 4) * 0.9, offlineContext, time);
        });
      });

      offlineContext.startRendering().then(buffer => {
        const wavBlob = audioBufferToWav(buffer);
        const url = URL.createObjectURL(wavBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${projectId || 'music_gemini_export'}.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setStatusMessage('Archivo .WAV exportado con éxito.');
        setIsExporting(false);
      });

    } catch (e) {
      console.error(e);
      setStatusMessage('');
      setError(`Error al exportar: ${e.message}`);
      setIsExporting(false);
    }
  };

  // Función auxiliar para convertir AudioBuffer a WAV
  const audioBufferToWav = (buffer) => {
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const bufferLength = buffer.length;
      
      let interleaved = new Float32Array(bufferLength * numChannels);
      let offset = 0;
      for (let i = 0; i < bufferLength; i++) {
          for (let channel = 0; channel < numChannels; channel++) {
              interleaved[offset++] = buffer.getChannelData(channel)[i];
          }
      }

      let dataView = new DataView(new ArrayBuffer(44 + interleaved.length * 2));
      let pos = 0;

      dataView.setUint32(pos, 0x46464952, true); pos += 4; // "RIFF"
      dataView.setUint32(pos, 36 + interleaved.length * 2, true); pos += 4; // file length
      dataView.setUint32(pos, 0x45564157, true); pos += 4; // "WAVE"
      dataView.setUint32(pos, 0x20746d66, true); pos += 4; // "fmt " chunk
      dataView.setUint32(pos, 16, true); pos += 4; // chunk length
      dataView.setUint16(pos, 1, true); pos += 2; // PCM format
      dataView.setUint16(pos, numChannels, true); pos += 2; // num channels
      dataView.setUint32(pos, sampleRate, true); pos += 4; // sample rate
      dataView.setUint32(pos, sampleRate * numChannels * 2, true); pos += 4; // byte rate
      dataView.setUint16(pos, numChannels * 2, true); pos += 2; // block align
      dataView.setUint16(pos, 16, true); pos += 2; // bits per sample
      dataView.setUint32(pos, 0x61746164, true); pos += 4; // "data" chunk
      dataView.setUint32(pos, interleaved.length * 2, true); pos += 4; // chunk length

      for (let i = 0; i < interleaved.length; i++) {
          let s = Math.max(-1, Math.min(1, interleaved[i]));
          dataView.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          pos += 2;
      }
      return new Blob([dataView], { type: 'audio/wav' });
  };
  
  // Renderiza la interfaz de usuario.
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-900 to-gray-700 text-white p-4 font-sans">
      <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl w-full max-w-4xl">
        <h1 className="text-4xl font-bold text-center text-teal-400 mb-6 tracking-wide">
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-600">
            Music
          </span>
          IDE
          <span className="text-xl"> powered by </span>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-600">
            Gemini AI
          </span>
        </h1>
        {userId && (
          <p className="text-xs text-gray-500 text-center mb-4 truncate">
            ID de Usuario: {userId}
          </p>
        )}

        {/* Controles de BPM y Pistas */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6 items-center">
            <div className="flex items-center gap-2">
                <label className="text-gray-400">BPM:</label>
                <input
                    type="number"
                    value={bpm}
                    onChange={(e) => setBpm(Number(e.target.value))}
                    className="w-20 bg-gray-900 text-white border border-gray-600 rounded-xl px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
            </div>
            {/* Pestañas de las pistas */}
            <div className="flex flex-1 justify-center gap-2">
                {tracks.map(track => (
                    <button
                        key={track.id}
                        onClick={() => setActiveTrackId(track.id)}
                        className={`px-4 py-2 rounded-xl font-bold transition-all duration-300 ease-in-out transform hover:scale-105 ${
                            activeTrackId === track.id
                                ? 'bg-purple-600 text-white'
                                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                        }`}
                    >
                        {track.name}
                    </button>
                ))}
            </div>
        </div>

        {/* Controles de la pista activa */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4 items-center">
            <div className="flex items-center gap-2">
                <label className="text-gray-400">Volumen:</label>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={tracks.find(t => t.id === activeTrackId)?.volume || 0}
                    onChange={(e) => {
                        const newVolume = parseFloat(e.target.value);
                        setTracks(tracks.map(t => t.id === activeTrackId ? { ...t, volume: newVolume } : t));
                    }}
                    className="w-full"
                />
            </div>
            <div className="flex items-center gap-2">
                <label className="text-gray-400">Delay:</label>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={tracks.find(t => t.id === activeTrackId)?.delaySend || 0}
                    onChange={(e) => {
                        const newDelaySend = parseFloat(e.target.value);
                        setTracks(tracks.map(t => t.id === activeTrackId ? { ...t, delaySend: newDelaySend } : t));
                    }}
                    className="w-full"
                />
            </div>
        </div>

        {/* Cuadrícula de notas */}
        <div className="flex flex-col gap-1 mb-6 p-2 rounded-xl bg-gray-900 shadow-inner">
          {noteNames[tracks.find(t => t.id === activeTrackId)?.instrumentType].map((noteName, y) => (
            <div key={noteName} className="flex gap-1 h-8">
              <div className="flex items-center justify-start text-sm text-gray-400 w-16">{noteName}</div>
              {Array.from({ length: gridLength }).map((_, x) => (
                <div
                  key={x}
                  onClick={() => handleGridClick(x, noteName)}
                  className={`flex-1 rounded-md transition-all duration-150 ease-in-out cursor-pointer ${
                    tracks.find(t => t.id === activeTrackId)?.notes.some(note => note.x === x && note.y === noteName)
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 transform scale-110 shadow-lg'
                      : 'bg-gray-700 hover:bg-gray-600'
                  } ${playLoopRef.current && playIndexRef.current === x ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900' : ''}`}
                ></div>
              ))}
            </div>
          ))}
        </div>

        {/* Controles y prompt */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 bg-gray-900 text-white border border-gray-600 rounded-xl px-4 py-3 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-400 transition-colors"
            placeholder="Describe la música que quieres generar..."
          />
          <div className="flex gap-4">
            <button
              onClick={playLoopRef.current ? stopPlayback : startPlayback}
              className={`flex-1 sm:flex-initial w-full sm:w-auto px-6 py-3 rounded-xl font-bold transition-all duration-300 ease-in-out ${
                playLoopRef.current
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/50'
                  : 'bg-green-600 hover:bg-green-700 text-white shadow-green-500/50'
              } transform hover:scale-105`}
            >
              {playLoopRef.current ? 'Detener' : 'Reproducir'}
            </button>
            <button
              onClick={generateMusic}
              className="flex-1 sm:flex-initial w-full sm:w-auto px-6 py-3 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/50 transition-all duration-300 ease-in-out transform hover:scale-105"
            >
              Generar con IA
            </button>
          </div>
        </div>

        {/* Controles de Guardar/Cargar y Exportar */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4 items-center">
            <input
                type="text"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="flex-1 bg-gray-900 text-white border border-gray-600 rounded-xl px-4 py-3 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 transition-colors"
                placeholder="ID del Proyecto (Ej: mi-cancion-1)"
            />
            <button
                onClick={saveProject}
                className="flex-1 sm:flex-initial w-full sm:w-auto px-6 py-3 rounded-xl font-bold bg-yellow-600 hover:bg-yellow-700 text-white shadow-yellow-500/50 transition-all duration-300 ease-in-out transform hover:scale-105"
            >
                Guardar
            </button>
            <button
                onClick={loadProject}
                className="flex-1 sm:flex-initial w-full sm:w-auto px-6 py-3 rounded-xl font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-purple-500/50 transition-all duration-300 ease-in-out transform hover:scale-105"
            >
                Cargar
            </button>
            <button
                onClick={exportToWAV}
                disabled={isExporting}
                className={`flex-1 sm:flex-initial w-full sm:w-auto px-6 py-3 rounded-xl font-bold transition-all duration-300 ease-in-out ${
                    isExporting
                        ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                        : 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-500/50 transform hover:scale-105'
                }`}
            >
                {isExporting ? 'Exportando...' : 'Exportar WAV'}
            </button>
        </div>

        {/* Mensajes de estado */}
        {statusMessage && (
          <div className="mt-4 p-3 bg-green-500/20 text-green-200 rounded-xl">
            {statusMessage}
          </div>
        )}
        {error && (
          <div className="mt-4 p-3 bg-red-500/20 text-red-200 rounded-xl">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
