import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

/* eslint-disable no-undef */

/**
 * Main application component.
 * Allows users to create music with a sequencer, generate melodies with AI, and manipulate audio files.
 * Also includes functionalities to save and load projects using Firestore.
 */
const App = () => {
  // --- Application state
  const [trackDefinitions, setTrackDefinitions] = useState(
    'v=8 [synth=sol,sol,mi,fa,fa,mi,re,do,re,re,re,mi,mi,mi,fa,fa,fa,sol,sol,fa,mi,re,do], ' +
    'v=6 [piano=do4-mi4-sol4,-,do4-mi4-sol4,-,re4-fa4-la4,-,re4-fa4-la4,-,mi4-sol4-si4,-,mi4-sol4-si4,-,fa4-la4-do5,-,fa4-la4-do5,-], ' +
    'v=7 [8bit=do,-,do,-,mi,-,mi,-,fa,-,fa,-,sol,-,sol,-,la,-,la,-,si,-,si,-,do5,-,do5,-], ' +
    'v=10 [drums=kick,-,snare,-,kick,-,snare,-,kick,-,snare,-,kick,-,snare,-,kick,hihat,hihat,hihat,snare,hihat,hihat,hihat]'
  );
  const [prompt, setPrompt] = useState('crear una melodía alegre y optimista');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState(null);
  const [bpm, setBpm] = useState(120);
  const [projectId, setProjectId] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [loadedAudioBuffer, setLoadedAudioBuffer] = useState(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [projectNotes, setProjectNotes] = useState('Notas de la canción "Zombies on Your Lawn" pre-cargadas.');

  // --- Web Audio API references
  const audioContextRef = useRef(null);
  const playLoopRef = useRef(null);
  const playIndexRef = useRef(0);
  const masterGainNodeRef = useRef(null);
  const delayNodeRef = useRef(null);
  const feedbackGainRef = useRef(null);

  // --- Firebase state and references
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // --- Grid and sound constants
  const noteMapping = {
    'do': 'C4', 'do4': 'C4', 're': 'D4', 'mi': 'E4', 'fa': 'F4',
    'sol': 'G4', 'la': 'A4', 'si': 'B4', 'do5': 'C5',
    're4': 'D4', 'mi4': 'E4', 'fa4': 'F4', 'sol4': 'G4', 'la4': 'A4', 'si4': 'B4',
    'kick': 'Kick', 'snare': 'Snare', 'hihat': 'Hi-Hat', '-': null,
  };
  const gridLength = 16;
  const frequencies = {
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
    G4: 392.00, A4: 440.00, B4: 493.88, C5: 523.25
  };

  // Drum sounds - Using noise generators and simple envelopes
  const drumSounds = {
      'Kick': (context) => {
          const osc = context.createOscillator();
          osc.type = 'sine';

          const gain = context.createGain();

          gain.gain.setValueAtTime(1, context.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.3);

          osc.frequency.setValueAtTime(150, context.currentTime);
          osc.frequency.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);

          osc.connect(gain);
          gain.connect(context.destination);

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
          noise.connect(gain);
          gain.connect(context.destination);
          return { source: noise, gain: gain };
      },
      'Hi-Hat': (context) => {
          const noise = context.createBufferSource();
          const bufferSize = context.sampleRate;
          const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
          const output = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
              output[i] = Math.random() * 2 - 1;
          }
          noise.buffer = buffer;
          noise.loop = true;

          const highPassFilter = context.createBiquadFilter();
          highPassFilter.type = 'highpass';
          highPassFilter.frequency.setValueAtTime(8000, context.currentTime);

          const gain = context.createGain();
          gain.gain.setValueAtTime(1, context.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.05);

          noise.connect(highPassFilter);
          highPassFilter.connect(gain);
          gain.connect(context.destination);

          return { source: noise, gain: gain };
      }
  };

  /**
   * Generates a piano sound.
   */
  const playPianoNote = (context, frequency, time, duration) => {
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, time);

    const gain = context.createGain();

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(1, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gain);
    gain.connect(context.destination);

    return { source: osc, gain: gain };
  };

  /**
   * Generates a guitar sound.
   */
  const playGuitarNote = (context, frequency, time, duration) => {
    const bufferSize = context.sampleRate;
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }

    const delay = context.createDelay(1.0);
    delay.delayTime.setValueAtTime(1 / frequency, time);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency * 2, time);

    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const gain = context.createGain();
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    noise.connect(delay);
    delay.connect(filter);
    filter.connect(delay);
    filter.connect(gain);
    gain.connect(context.destination);

    return { source: noise, gain: gain };
  };

  /**
   * Generates an 8-bit sound (square wave).
   */
  const play8BitNote = (context, frequency, time, duration) => {
    const osc = context.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(frequency, time);

    const gain = context.createGain();
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gain);
    gain.connect(context.destination);

    return { source: osc, gain: gain };
  };

  /**
   * Generates a 16-bit sound (triangle wave).
   */
  const play16BitNote = (context, frequency, time, duration) => {
    const osc = context.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, time);

    const gain = context.createGain();
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gain);
    gain.connect(context.destination);

    return { source: osc, gain: gain };
  };

  /**
   * Initializes the Web Audio API and Firebase on component mount.
   */
  useEffect(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        masterGainNodeRef.current = audioContextRef.current.createGain();
        delayNodeRef.current = audioContextRef.current.createDelay(1.0);
        feedbackGainRef.current = audioContextRef.current.createGain();

        delayNodeRef.current.connect(feedbackGainRef.current);
        feedbackGainRef.current.connect(delayNodeRef.current);
        delayNodeRef.current.connect(masterGainNodeRef.current);
        masterGainNodeRef.current.connect(audioContextRef.current.destination);

        delayNodeRef.current.delayTime.value = 0.25;
        feedbackGainRef.current.gain.value = 0.4;
      }
    } catch (e) {
      setError('El Web Audio API no es compatible con este navegador.');
    }

    // Initialize Firebase
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
   * Parses a single track definition string.
   * Expected format: "v=[volume] [instrument]=[notes]"
   */
  const parseSingleTrackDefinition = (definition) => {
    const parts = definition.split(' ');
    let volume = 0.5;
    let instrumentType = 'synth';
    let noteSequence = '';

    parts.forEach(part => {
      if (part.startsWith('v=')) {
        const vol = parseInt(part.substring(2), 10);
        if (!isNaN(vol)) {
          volume = vol / 10;
        }
      } else if (part.includes('=')) {
        const [inst, notes] = part.split('=');
        instrumentType = inst.trim();
        noteSequence = notes.replace(/[[\]]/g, '').trim();
      }
    });

    return { volume, instrumentType, noteSequence };
  };

  /**
   * Parses a string with multiple track definitions separated by commas.
   */
  const parseAllTrackDefinitions = (definitionsString) => {
    return definitionsString
      .split(',')
      .map(def => def.trim())
      .filter(def => def.length > 0);
  };

  /**
   * Plays a musical note or a drum sound.
   */
  const playSound = (instrumentType, noteName, volume, duration, context = audioContextRef.current, time = context.currentTime) => {
    if (!context || !noteName) return;

    let finalOutputNode;
    const frequency = frequencies[noteName];

    if (instrumentType === 'synth' || instrumentType === 'piano' || instrumentType === 'guitar' || instrumentType === '8bit' || instrumentType === '16bit') {
      if (!frequency) return;

      const gain = context.createGain();
      gain.gain.value = volume;

      let source;
      if (instrumentType === 'synth') {
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, time);
        source = oscillator;
      } else if (instrumentType === 'piano') {
        const { source: pianoSource, gain: pianoGain } = playPianoNote(context, frequency, time, duration);
        source = pianoSource;
        pianoSource.connect(pianoGain);
        pianoGain.connect(gain);
      } else if (instrumentType === 'guitar') {
        const { source: guitarSource, gain: guitarGain } = playGuitarNote(context, frequency, time, duration);
        source = guitarSource;
        guitarSource.connect(guitarGain);
        guitarGain.connect(gain);
      } else if (instrumentType === '8bit') {
        const { source: bit8Source, gain: bit8Gain } = play8BitNote(context, frequency, time, duration);
        source = bit8Source;
        bit8Source.connect(bit8Gain);
        bit8Gain.connect(gain);
      } else if (instrumentType === '16bit') {
        const { source: bit16Source, gain: bit16Gain } = play16BitNote(context, frequency, time, duration);
        source = bit16Source;
        bit16Source.connect(bit16Gain);
        bit16Gain.connect(gain);
      }

      if (source) {
        source.start(time);
        source.stop(time + duration);
        source.connect(gain);
        finalOutputNode = gain;
      }
    } else if (instrumentType === 'drums') {
      const { source, gain } = drumSounds[noteName](context);
      source.connect(gain);
      source.start(time);
      source.stop(time + 0.5);
      finalOutputNode = gain;
    } else {
        return;
    }

    if (finalOutputNode) {
      if (context === audioContextRef.current) {
        finalOutputNode.connect(masterGainNodeRef.current);
      } else {
        finalOutputNode.connect(context.destination);
      }
    }
  };


  /**
   * Starts the sequencer playback loop.
   */
  const startPlayback = () => {
    stopPlayback();

    const parsedTracks = parseAllTrackDefinitions(trackDefinitions);
    if (parsedTracks.length === 0) {
      setStatusMessage('No hay pistas para reproducir.');
      return;
    }

    // Ensure audio context is in 'running' state
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    const intervalTime = 60000 / bpm / 4;
    const noteDuration = intervalTime / 1000 * 0.9;

    delayNodeRef.current.delayTime.value = 60 / bpm * 0.5;

    playLoopRef.current = setInterval(() => {
      parsedTracks.forEach(trackDef => {
        const { volume, instrumentType, noteSequence } = parseSingleTrackDefinition(trackDef);

        const parsedSequence = noteSequence
          .toLowerCase()
          .split(/[\s,]+/)
          .map(note => note.trim())
          .filter(note => note !== '');

        if (parsedSequence.length > 0) {
          const currentNote = parsedSequence[playIndexRef.current % parsedSequence.length];
          const mappedNote = noteMapping[currentNote];
          if (mappedNote) {
            playSound(instrumentType, mappedNote, volume, noteDuration);
          } else if (currentNote === '-') {
            // Silence, do nothing
          } else {
            console.warn(`Nota no reconocida o inválida: ${currentNote}`);
          }
        }
      });

      const maxLength = parsedTracks.reduce((max, def) => {
        const { noteSequence } = parseSingleTrackDefinition(def);
        const sequenceLength = noteSequence.toLowerCase().split(/[\s,]+/).filter(s => s !== '').length;
        return Math.max(max, sequenceLength);
      }, gridLength);

      playIndexRef.current = (playIndexRef.current + 1) % maxLength;

    }, intervalTime);
  };


  /**
   * Stops playback.
   */
  const stopPlayback = () => {
    clearInterval(playLoopRef.current);
    playLoopRef.current = null;
    playIndexRef.current = 0;
  };

  /**
   * Calls the Gemini API to generate a new musical sequence.
   */
  const generateMusic = async () => {
    setStatusMessage('Generando música con IA...');
    setError(null);
    stopPlayback();

    try {
      const userPrompt = `${prompt}. Responde con una sola línea de texto que contenga todas las pistas. Cada pista debe tener el formato 'v=[volumen 0-10] [instrumento]=[notas separadas por comas]' y estar separada de las demás por una coma. Por ejemplo: v=8 [synth=sol,sol,mi,fa],v=6 [piano=C4,D4,E4],v=10 [drums=kick,snare]`;

      const chatHistory = [{ role: "user", parts: [{ text: userPrompt }] }];
      const payload = {
        contents: chatHistory,
      };

      const apiKey = typeof __api_key !== 'undefined' ? __api_key : "";

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Error en la API: ${response.statusText} (${response.status}) - ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();

      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('La respuesta de la IA está vacía o es inválida.');
      }

      setTrackDefinitions(text.trim());
      setStatusMessage('¡Música generada con éxito!');
    } catch (e) {
      console.error(e);
      setStatusMessage('');
      setError(`Ocurrió un error: ${e.message}`);
    }
  };

  // --- Firestore functions
  const saveProject = async () => {
    if (!isAuthReady || !userId || !projectId) {
      setStatusMessage('Por favor, ingresa un ID de proyecto válido.');
      return;
    }
    setStatusMessage('Guardando proyecto...');
    setError(null);
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const docRef = doc(db, `artifacts/${appId}/users/${userId}/projects/${projectId}`);
      await setDoc(docRef, { trackDefinitions, bpm, projectNotes });
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
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const docRef = doc(db, `artifacts/${appId}/users/${userId}/projects/${projectId}`);
      onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setTrackDefinitions(data.trackDefinitions || '');
          setBpm(data.bpm || 120);
          setProjectNotes(data.projectNotes || '');
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

  // --- Functions to export to .WAV
  const exportToWAV = async () => {
    setIsExporting(true);
    setStatusMessage('Exportando a WAV...');
    stopPlayback();

    try {
      const parsedTracks = parseAllTrackDefinitions(trackDefinitions);
      if (parsedTracks.length === 0) {
        throw new Error('No hay pistas para exportar.');
      }

      const maxLength = parsedTracks.reduce((max, def) => {
        const { noteSequence } = parseSingleTrackDefinition(def);
        const sequenceLength = noteSequence.toLowerCase().split(/[\s,]+/).filter(s => s !== '').length;
        return Math.max(max, sequenceLength);
      }, gridLength);
      const duration = (60 / bpm * maxLength);

      const offlineContext = new OfflineAudioContext(2, audioContextRef.current.sampleRate * duration, audioContextRef.current.sampleRate);

      parsedTracks.forEach(trackDef => {
        const { volume, instrumentType, noteSequence } = parseSingleTrackDefinition(trackDef);
        const parsedSequence = noteSequence
          .toLowerCase()
          .split(/[\s,]+/)
          .map(note => note.trim())
          .filter(note => note !== '');

        const noteDuration = (60 / bpm / 4) * 0.9;

        if (parsedSequence.length > 0) {
            parsedSequence.forEach((val, index) => {
                const mappedNote = noteMapping[val];
                if (mappedNote) {
                    const time = (60 / bpm / 4) * index;
                    playSound(instrumentType, mappedNote, volume, noteDuration, offlineContext, time);
                }
            });
        }
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

  // Helper function to convert AudioBuffer to WAV
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

      dataView.setUint32(pos, 0x46464952, true); pos += 4;
      dataView.setUint32(pos, 36 + interleaved.length * 2, true); pos += 4;
      dataView.setUint32(pos, 0x45564157, true); pos += 4;
      dataView.setUint32(pos, 0x20746d66, true); pos += 4;
      dataView.setUint32(pos, 16, true); pos += 4;
      dataView.setUint16(pos, 1, true); pos += 2;
      dataView.setUint16(pos, numChannels, true); pos += 2;
      dataView.setUint32(pos, sampleRate, true); pos += 4;
      dataView.setUint32(pos, sampleRate * numChannels * 2, true); pos += 4;
      dataView.setUint16(pos, numChannels * 2, true); pos += 2;
      dataView.setUint16(pos, 16, true); pos += 2;
      dataView.setUint32(pos, 0x61746164, true); pos += 4;
      dataView.setUint32(pos, interleaved.length * 2, true); pos += 4;

      for (let i = 0; i < interleaved.length; i++) {
          let s = Math.max(-1, Math.min(1, interleaved[i]));
          dataView.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          pos += 2;
      }
      return new Blob([dataView], { type: 'audio/wav' });
  };

  // --- Audio editor functions
  const handleAudioFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file || !audioContextRef.current) return;

    setStatusMessage('Cargando y decodificando audio...');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
      setLoadedAudioBuffer(audioBuffer);
      setTrimEnd(audioBuffer.duration);
      setStatusMessage('Audio cargado con éxito.');
    } catch (e) {
      console.error(e);
      setStatusMessage('');
      setError(`Error al cargar el audio: ${e.message}`);
    }
  };

  const playTrimmedAudio = () => {
    if (!loadedAudioBuffer || !audioContextRef.current) return;

    stopPlayback();
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = loadedAudioBuffer;

    const startOffset = trimStart;
    const duration = trimEnd - trimStart;

    const gainNode = audioContextRef.current.createGain();
    gainNode.connect(audioContextRef.current.destination);

    source.connect(gainNode);
    source.start(0, startOffset, duration);
  };

  // Render the user interface
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
        </div>

        <h2 className="text-2xl font-bold text-center text-teal-400 mb-4">Definiciones de Pista (Formato de Cadena Única)</h2>
        <textarea
            value={trackDefinitions}
            onChange={(e) => setTrackDefinitions(e.target.value)}
            className="w-full h-40 p-4 bg-gray-900 text-white border border-gray-600 rounded-xl placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-400 transition-colors"
            placeholder="Ej: v=8 [synth=sol,sol,mi,fa], v=6 [piano=C4,D4,E4]"
        />

        {/* Controles de reproducción y prompt */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4 mt-8">
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

        {/* Editor de Audio */}
        <div className="mt-8">
            <h2 className="text-2xl font-bold text-center text-yellow-400 mb-4">Editor de Audio</h2>
            <label className="block text-gray-400 mb-2">Cargar archivo de audio (.wav, .mp3)</label>
            <input
                type="file"
                accept="audio/*"
                onChange={handleAudioFileUpload}
                className="block w-full text-sm text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-white hover:file:bg-gray-600"
            />
            {loadedAudioBuffer && (
                <div className="mt-4 p-4 bg-gray-900 rounded-xl">
                    <p className="text-gray-400 mb-2">Archivo cargado: Duración total: {loadedAudioBuffer.duration.toFixed(2)}s</p>
                    <div className="flex items-center gap-4">
                        <label className="text-gray-400">Inicio (s):</label>
                        <input
                            type="range"
                            min="0"
                            max={loadedAudioBuffer.duration}
                            step="0.01"
                            value={trimStart}
                            onChange={(e) => setTrimStart(parseFloat(e.target.value))}
                            className="flex-1"
                        />
                        <span className="text-white">{trimStart.toFixed(2)}s</span>
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                        <label className="text-gray-400">Fin (s):</label>
                        <input
                            type="range"
                            min="0"
                            max={loadedAudioBuffer.duration}
                            step="0.01"
                            value={trimEnd}
                            onChange={(e) => setTrimEnd(parseFloat(e.target.value))}
                            className="flex-1"
                        />
                        <span className="text-white">{trimEnd.toFixed(2)}s</span>
                    </div>
                    <div className="mt-4 flex justify-center">
                        <button
                            onClick={playTrimmedAudio}
                            className="px-6 py-3 rounded-xl font-bold bg-pink-600 hover:bg-pink-700 text-white shadow-pink-500/50 transition-all duration-300 ease-in-out transform hover:scale-105"
                        >
                            Reproducir Recorte
                        </button>
                    </div>
                </div>
            )}
        </div>

        {/* Sección de Notas del Proyecto */}
        <div className="mt-8">
            <h2 className="text-2xl font-bold text-center text-teal-400 mb-4">Notas del Proyecto</h2>
            <textarea
                id="projectNotes"
                value={projectNotes}
                onChange={(e) => setProjectNotes(e.target.value)}
                className="w-full h-32 p-4 bg-gray-900 text-white border border-gray-600 rounded-xl placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-400 transition-colors"
                placeholder="Escribe aquí tus ideas, progresiones de acordes o cualquier otra nota sobre tu proyecto..."
            />
        </div>

        {/* Controles de Guardar/Cargar y Exportar */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4 mt-8 items-center">
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
