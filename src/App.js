import React, { useState, useEffect, useRef } from 'react';

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
  
  // Referencias para el Web Audio API para una reproducción eficiente.
  const audioContextRef = useRef(null);
  const playLoopRef = useRef(null);
  const playIndexRef = useRef(0);

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

  // Inicializa el AudioContext al montar el componente para asegurar la funcionalidad de audio.
  useEffect(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
    } catch (e) {
      setError('El Web Audio API no es compatible con este navegador.');
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
    setIsPlaying(true);
    let index = 0;
    const intervalTime = 60000 / 120 / 4; // Calcula el intervalo para 120 BPM, notas de 16avos.
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
    setIsPlaying(false);
    clearInterval(playLoopRef.current);
    playIndexRef.current = 0;
  };

  /**
   * Alterna el estado de reproducción (iniciar/detener).
   */
  const handlePlay = () => {
    if (isPlaying) {
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
        <div className="flex flex-col sm:flex-row gap-4">
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
                isPlaying
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/50'
                  : 'bg-green-600 hover:bg-green-700 text-white shadow-green-500/50'
              } transform hover:scale-105`}
            >
              {isPlaying ? 'Detener' : 'Reproducir'}
            </button>
            <button
              onClick={generateMusic}
              className="flex-1 sm:flex-initial w-full sm:w-auto px-6 py-3 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/50 transition-all duration-300 ease-in-out transform hover:scale-105"
            >
              Generar con IA
            </button>
          </div>
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
