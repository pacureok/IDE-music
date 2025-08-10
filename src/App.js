import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// El componente principal de la aplicación.
const App = () => {
  // Estado para la cuadrícula de notas.
  const [notes, setNotes] = useState([]);
  // Estado para el prompt (instrucción) del usuario.
  const [prompt, setPrompt] = useState('generar un ritmo de batería funky');
  // Estado para el mensaje de carga o error.
  const [statusMessage, setStatusMessage] = useState('');
  // Estado para el mensaje de error.
  const [error, setError] = useState(null);
  // Estado para el BPM (ritmo por minuto).
  const [bpm, setBpm] = useState(120);
  // Estado para el ID del proyecto a guardar/cargar.
  const [projectId, setProjectId] = useState('');
  
  // Referencias para el Web Audio API para una reproducción eficiente.
  const audioContextRef = useRef(null);
  const playLoopRef = useRef(null);
  const playIndexRef = useRef(0);

  // Estados de Firebase
  const [firebaseApp, setFirebaseApp] = useState(null);
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Frecuencias en Hz para un conjunto simple de notas musicales.
  const frequencies = {
    C4: 261.63,
    D4: 293.66,
    E4: 329.63,
    F4: 349.23,
    G4: 392.00,
    A4: 440.00,
    B4: 493.88,
    C5: 523.25
  };
  const noteNames = ['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4'];
  const gridLength = 16; // Número de pasos en el secuenciador.

  // Inicializa el Web Audio API y Firebase.
  useEffect(() => {
    // Inicializa Web Audio API
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
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
      setFirebaseApp(app);
      setDb(getFirestore(app));
      setAuth(getAuth(app));

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
   * Reproduce una nota musical a una frecuencia y duración dadas.
   * Utiliza un oscilador y un nodo de ganancia para controlar el sonido.
   * @param {number} frequency - La frecuencia de la nota en Hz.
   * @param {number} duration - La duración de la nota en segundos.
   */
  const playNote = (frequency, duration) => {
    if (!audioContextRef.current) return;

    const oscillator = audioContextRef.current.createOscillator();
    const gainNode = audioContextRef.current.createGain();

    oscillator.type = 'sine'; // Tipo de onda.
    oscillator.frequency.setValueAtTime(frequency, audioContextRef.current.currentTime);
    
    // Configura la ganancia para evitar clics (ataque/decaimiento).
    gainNode.gain.setValueAtTime(0, audioContextRef.current.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioContextRef.current.currentTime + 0.01);
    gainNode.gain.linearRampToValueAtTime(0, audioContextRef.current.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);

    oscillator.start(audioContextRef.current.currentTime);
    oscillator.stop(audioContextRef.current.currentTime + duration);
  };

  /**
   * Inicia la reproducción del secuenciador en un bucle.
   */
  const startPlayback = () => {
    // Si la autenticación no está lista, no iniciar
    if (!isAuthReady) {
      setStatusMessage('Iniciando sesión... por favor, espera.');
      return;
    }

    let index = 0;
    // Calcula el intervalo en base al BPM
    const intervalTime = 60000 / bpm / 4; // Notas de 16avos.
    const noteDuration = intervalTime * 0.9;

    playLoopRef.current = setInterval(() => {
      // Reproduce las notas que están en el índice (paso) actual.
      notes.forEach(note => {
        if (note.x === index) {
          playNote(frequencies[note.y], noteDuration / 1000);
        }
      });
      playIndexRef.current = index;

      index = (index + 1) % gridLength;
      if (index === 0) {
        // Reiniciar el bucle de reproducción.
      }
    }, intervalTime);
  };

  /**
   * Detiene la reproducción del secuenciador.
   */
  const stopPlayback = () => {
    clearInterval(playLoopRef.current);
    playIndexRef.current = 0;
  };

  /**
   * Alterna el estado de reproducción (iniciar/detener).
   */
  const handlePlay = () => {
    if (playLoopRef.current) {
      stopPlayback();
    } else {
      startPlayback();
    }
  };

  /**
   * Maneja el clic en la cuadrícula para añadir o eliminar notas.
   * @param {number} x - La posición horizontal de la nota.
   * @param {string} y - El nombre de la nota (e.g., 'C4').
   */
  const handleGridClick = (x, y) => {
    const existingNoteIndex = notes.findIndex(note => note.x === x && note.y === y);
    if (existingNoteIndex > -1) {
      // Elimina la nota si ya existe.
      const newNotes = [...notes];
      newNotes.splice(existingNoteIndex, 1);
      setNotes(newNotes);
    } else {
      // Añade una nueva nota si no existe.
      setNotes([...notes, { x, y }]);
    }
  };

  // Lógica de Firestore
  const saveProject = async () => {
    if (!isAuthReady || !userId || !projectId) {
      setStatusMessage('Por favor, ingresa un ID de proyecto válido y asegúrate de que la autenticación está lista.');
      return;
    }
    setStatusMessage('Guardando proyecto...');
    setError(null);
    try {
      const docRef = doc(db, `artifacts/${__app_id}/users/${userId}/projects/${projectId}`);
      await setDoc(docRef, { notes, bpm });
      setStatusMessage(`Proyecto "${projectId}" guardado con éxito.`);
    } catch (e) {
      console.error(e);
      setStatusMessage('');
      setError(`Error al guardar el proyecto: ${e.message}`);
    }
  };

  const loadProject = async () => {
    if (!isAuthReady || !userId || !projectId) {
      setStatusMessage('Por favor, ingresa un ID de proyecto válido y asegúrate de que la autenticación está lista.');
      return;
    }
    setStatusMessage('Cargando proyecto...');
    setError(null);
    try {
      const docRef = doc(db, `artifacts/${__app_id}/users/${userId}/projects/${projectId}`);
      // Escuchar cambios en tiempo real
      onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setNotes(data.notes || []);
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

  /**
   * Llama a la API de Gemini para generar una nueva secuencia musical.
   */
  const generateMusic = async () => {
    setStatusMessage('Generando música con IA...');
    setError(null);
    stopPlayback(); // Detiene la reproducción antes de generar.

    try {
      // Formato del prompt para la IA.
      const currentNotesString = notes.map(note => `${note.y} en la posición ${note.x}`).join(', ');
      const userPrompt = `Dada la siguiente secuencia musical: "${currentNotesString}". ${prompt}. Responde con una nueva secuencia de notas musicales en formato JSON.`;

      // Prepara el payload para la llamada a la API de Gemini.
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

      const apiKey = ""; // La clave de API se inyecta automáticamente.
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Error en la API: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const json = result.candidates[0].content.parts[0].text;
        const parsedJson = JSON.parse(json);
        if (Array.isArray(parsedJson)) {
          setNotes(parsedJson);
          setStatusMessage('¡Música generada con éxito!');
        } else {
          throw new Error('La respuesta de la IA no es un array válido.');
        }
      } else {
        throw new Error('La respuesta de la IA está vacía o es inválida.');
      }
    } catch (e) {
      console.error(e);
      setStatusMessage('');
      setError(`Ocurrió un error: ${e.message}`);
    }
  };

  // Renderiza la interfaz de usuario del IDE de música.
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
        {/* Cuadrícula de notas */}
        <div className="flex flex-col gap-1 mb-6 p-2 rounded-xl bg-gray-900 shadow-inner">
          {noteNames.map((noteName, y) => (
            <div key={noteName} className="flex gap-1 h-8">
              <div className="flex items-center justify-start text-sm text-gray-400 w-12">{noteName}</div>
              {Array.from({ length: gridLength }).map((_, x) => (
                <div
                  key={x}
                  onClick={() => handleGridClick(x, noteName)}
                  className={`flex-1 rounded-md transition-all duration-150 ease-in-out cursor-pointer ${
                    notes.some(note => note.x === x && note.y === noteName)
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 transform scale-110 shadow-lg'
                      : 'bg-gray-700 hover:bg-gray-600'
                  } ${playIndexRef.current === x ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900' : ''}`}
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
              onClick={handlePlay}
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

        {/* Controles de BPM y Guardar/Cargar */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4 items-center">
            <div className="flex items-center gap-2">
                <label className="text-gray-400">BPM:</label>
                <input
                    type="number"
                    value={bpm}
                    onChange={(e) => setBpm(Number(e.target.value))}
                    className="w-20 bg-gray-900 text-white border border-gray-600 rounded-xl px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
            </div>
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
