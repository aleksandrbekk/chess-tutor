import { useCallback, useRef, useState, useEffect } from 'react';

// Gemini 2.0 Live API WebSocket endpoint
const GEMINI_LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const SYSTEM_INSTRUCTION = `Ты добрый шахматный тренер для детей 5-7 лет. Говори просто и коротко.
- Хвали за хорошие ходы
- Мягко объясняй ошибки
- Используй простые слова
- Говори кратко (1-2 предложения)
- Называй фигуры: пешка, конь, слон, ладья, ферзь, король`;

// PCM Audio Player - plays raw PCM audio from Gemini Live
class PCMAudioPlayer {
  private audioContext: AudioContext | null = null;
  private scheduledTime = 0;
  private sampleRate = 24000;
  private isPlaying = false;

  async init() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    this.scheduledTime = this.audioContext.currentTime;
    this.isPlaying = true;
  }

  playPCM(base64Data: string) {
    if (!this.audioContext || !this.isPlaying) return;

    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert to Int16 array
      const int16Array = new Int16Array(bytes.buffer);

      // Convert to Float32 for Web Audio API
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, this.sampleRate);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      const startTime = Math.max(this.scheduledTime, this.audioContext.currentTime);
      source.start(startTime);
      this.scheduledTime = startTime + audioBuffer.duration;
    } catch (error) {
      console.error('[PCM] Playback error:', error);
    }
  }

  stop() {
    this.isPlaying = false;
    if (this.audioContext) {
      this.scheduledTime = this.audioContext.currentTime;
    }
  }

  async resume() {
    if (this.audioContext) {
      await this.audioContext.resume();
      this.scheduledTime = this.audioContext.currentTime;
      this.isPlaying = true;
    }
  }
}

// Microphone capture for voice input with resampling to 16kHz
class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private onAudioData: ((base64: string) => void) | null = null;
  private processor: ScriptProcessorNode | null = null;

  // Resample from source rate to 16kHz
  private resample(inputData: Float32Array, inputSampleRate: number): Int16Array {
    const targetSampleRate = 16000;
    const ratio = inputSampleRate / targetSampleRate;
    const outputLength = Math.floor(inputData.length / ratio);
    const output = new Int16Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = Math.floor(i * ratio);
      const s = Math.max(-1, Math.min(1, inputData[srcIndex]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    return output;
  }

  async start(onAudioData: (base64: string) => void): Promise<boolean> {
    this.onAudioData = onAudioData;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      this.audioContext = new AudioContext();
      const inputSampleRate = this.audioContext.sampleRate;
      console.log('[Microphone] Native sample rate:', inputSampleRate);

      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.onAudioData) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const int16Data = this.resample(inputData, inputSampleRate);

        const bytes = new Uint8Array(int16Data.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        this.onAudioData(base64);
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      console.log('[Microphone] Started capturing audio');
      return true;
    } catch (error) {
      console.error('[Microphone] Access error:', error);
      return false;
    }
  }

  stop() {
    console.log('[Microphone] Stopping capture');
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.onAudioData = null;
  }
}

export interface GeminiLiveState {
  isConnected: boolean;
  isConnecting: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  lastTranscript: string;
  error: string | null;
  fatalError: boolean; // NEW: prevents reconnect loop
}

export interface GeminiLiveActions {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  sendChessContext: (fen: string, playerSide: 'white' | 'black', childName: string) => void;
  sendGameEvent: (event: 'game_start' | 'child_move' | 'ai_move' | 'check' | 'game_end', move?: string, evaluation?: number) => void;
  startListening: () => Promise<boolean>;
  stopListening: () => void;
  interrupt: () => void;
}

// Fatal error codes that should NOT trigger reconnect
const FATAL_CLOSE_CODES = [
  1002, // Protocol error
  1003, // Unsupported data
  1007, // Invalid payload
  1008, // Policy violation
  1009, // Message too big
  1010, // Missing extension
  1011, // Internal error
  1015, // TLS handshake
  4000, 4001, 4002, 4003, 4004, 4005, // Custom API errors
];

export function useGeminiLive(): GeminiLiveState & GeminiLiveActions {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioPlayerRef = useRef<PCMAudioPlayer | null>(null);
  const micRef = useRef<MicrophoneCapture | null>(null);
  const currentContextRef = useRef<{ fen: string; playerSide: string; childName: string } | null>(null);
  const connectAttempts = useRef(0);

  // Full cleanup helper
  const fullCleanup = useCallback(() => {
    console.log('[Gemini] 🧹 Full cleanup');

    // Stop microphone
    if (micRef.current) {
      micRef.current.stop();
      micRef.current = null;
    }

    // Stop audio
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Reset ALL states
    setIsConnected(false);
    setIsConnecting(false);
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      fullCleanup();
    };
  }, [fullCleanup]);

  const connect = useCallback(async (): Promise<boolean> => {
    // BLOCK if fatal error occurred
    if (fatalError) {
      console.error('[Gemini] ❌ BLOCKED: Fatal error occurred, refresh page to retry');
      return false;
    }

    if (isConnected || isConnecting) {
      console.log('[Gemini] Already connected/connecting, skipping');
      return false;
    }

    // Limit reconnect attempts
    connectAttempts.current++;
    if (connectAttempts.current > 5) {
      console.error('[Gemini] ❌ Too many connect attempts, stopping');
      setFatalError(true);
      setError('Too many connection attempts');
      return false;
    }

    console.log(`[Gemini] 🔌 Connecting (attempt ${connectAttempts.current})...`);
    setIsConnecting(true);
    setError(null);

    try {
      // Initialize audio player
      audioPlayerRef.current = new PCMAudioPlayer();
      await audioPlayerRef.current.init();

      // Connect to Gemini Live
      const url = `${GEMINI_LIVE_URL}?key=${API_KEY}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      return new Promise((resolve) => {
        let resolved = false;

        ws.onopen = () => {
          console.log('[Gemini] ✅ WebSocket connected');

          // Setup message - v1alpha uses snake_case format
          const setupMessage = {
            setup: {
              model: 'models/gemini-2.0-flash-exp',
              generation_config: {
                response_modalities: ['AUDIO'],
                speech_config: {
                  voice_config: {
                    prebuilt_voice_config: {
                      voice_name: 'Puck'
                    }
                  }
                }
              },
              system_instruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }]
              }
            }
          };

          console.log('[Gemini] 📤 Sending setup:', JSON.stringify(setupMessage));
          ws.send(JSON.stringify(setupMessage));
        };

        ws.onmessage = async (event) => {
          let messageText: string;

          if (event.data instanceof Blob) {
            messageText = await event.data.text();
          } else {
            messageText = event.data;
          }

          try {
            const data = JSON.parse(messageText);

            // Setup complete - handle both formats
            if (data.setupComplete || data.setup_complete) {
              console.log('[Gemini] ✅ Setup complete');
              connectAttempts.current = 0; // Reset on success
              setIsConnected(true);
              setIsConnecting(false);
              if (!resolved) {
                resolved = true;
                resolve(true);
              }
              return;
            }

            // Error from server
            if (data.error) {
              console.error('[Gemini] ❌ Server error:', data.error);
              setError(data.error.message || 'Server error');
              setFatalError(true);
              fullCleanup();
              if (!resolved) {
                resolved = true;
                resolve(false);
              }
              return;
            }

            // Server content (audio response) - handle both camelCase and snake_case
            const serverContent = data.serverContent || data.server_content;
            if (serverContent) {
              const modelTurn = serverContent.modelTurn || serverContent.model_turn;
              const parts = modelTurn?.parts || [];

              for (const part of parts) {
                const inlineData = part.inlineData || part.inline_data;
                const mimeType = inlineData?.mimeType || inlineData?.mime_type;

                if (mimeType?.startsWith('audio/pcm')) {
                  setIsSpeaking(true);
                  audioPlayerRef.current?.playPCM(inlineData.data);
                }

                if (part.text) {
                  setLastTranscript(part.text);
                }
              }

              const turnComplete = serverContent.turnComplete || serverContent.turn_complete;
              if (turnComplete) {
                setIsSpeaking(false);
              }
            }

          } catch (e) {
            console.error('[Gemini] Parse error:', e);
          }
        };

        ws.onerror = (e) => {
          console.error('[Gemini] ❌ WebSocket error:', e);
          setError('Connection error');
          setIsConnecting(false);
          if (!resolved) {
            resolved = true;
            resolve(false);
          }
        };

        ws.onclose = (event) => {
          // 🚨 CRITICAL: Detailed close logging
          console.error(`[Gemini] 🔴 SOCKET CLOSED | code: ${event.code} | reason: "${event.reason}" | clean: ${event.wasClean}`);

          // Check for fatal errors
          if (FATAL_CLOSE_CODES.includes(event.code) || event.code >= 4000) {
            console.error('[Gemini] ❌ FATAL ERROR - reconnect BLOCKED');
            setFatalError(true);
            setError(`Fatal error: ${event.code} - ${event.reason || 'Unknown'}`);
          }

          // 🚨 CRITICAL: Reset ALL UI state
          fullCleanup();

          if (!resolved) {
            resolved = true;
            resolve(false);
          }
        };

        // Timeout
        setTimeout(() => {
          if (!resolved) {
            console.error('[Gemini] ⏱️ Connection timeout');
            ws.close();
            setError('Connection timeout');
            setIsConnecting(false);
            resolved = true;
            resolve(false);
          }
        }, 10000);
      });

    } catch (e) {
      console.error('[Gemini] Connect error:', e);
      setError('Failed to connect');
      setIsConnecting(false);
      return false;
    }
  }, [isConnected, isConnecting, fatalError, fullCleanup]);

  const disconnect = useCallback(() => {
    fullCleanup();
  }, [fullCleanup]);

  const sendChessContext = useCallback((fen: string, playerSide: 'white' | 'black', childName: string) => {
    currentContextRef.current = { fen, playerSide, childName };
  }, []);

  const sendGameEvent = useCallback((
    event: 'game_start' | 'child_move' | 'ai_move' | 'check' | 'game_end',
    move?: string,
    evaluation?: number
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('[Gemini] Cannot send event - socket not open');
      return;
    }

    const context = currentContextRef.current;
    let prompt = '';

    switch (event) {
      case 'game_start':
        prompt = `${context?.childName || 'Ученик'} начинает игру ${context?.playerSide === 'white' ? 'белыми' : 'чёрными'}. Поприветствуй и пожелай удачи!`;
        break;
      case 'child_move':
        prompt = `${context?.childName || 'Ученик'} сделал ход ${move}. ${evaluation !== undefined ? `Оценка: ${evaluation > 0 ? '+' : ''}${evaluation.toFixed(1)}` : ''} Прокомментируй ход кратко.`;
        break;
      case 'ai_move':
        prompt = `Компьютер сделал ход ${move}. Кратко объясни этот ход.`;
        break;
      case 'check':
        prompt = `Шах! Объясни, что делать при шахе.`;
        break;
      case 'game_end':
        prompt = `Игра завершена. Подведи итог и похвали за игру.`;
        break;
    }

    // v1alpha format with snake_case
    const message = {
      client_content: {
        turns: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        turn_complete: true
      }
    };

    console.log('[Gemini] 📤 Sending event:', event);
    wsRef.current.send(JSON.stringify(message));
  }, []);

  const startListening = useCallback(async (): Promise<boolean> => {
    if (!isConnected || isListening) {
      console.log('[Microphone] Cannot start - connected:', isConnected, 'listening:', isListening);
      return false;
    }

    console.log('[Microphone] 🎙️ Starting...');
    micRef.current = new MicrophoneCapture();

    const success = await micRef.current.start((base64Audio) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // v1alpha format with snake_case
        const message = {
          realtime_input: {
            media_chunks: [
              {
                mime_type: 'audio/pcm;rate=16000',
                data: base64Audio
              }
            ]
          }
        };
        wsRef.current.send(JSON.stringify(message));
      }
    });

    if (success) {
      setIsListening(true);
      interrupt();
      console.log('[Microphone] ✅ Listening');
    } else {
      console.log('[Microphone] ❌ Failed to start');
    }

    return success;
  }, [isConnected, isListening]);

  const stopListening = useCallback(() => {
    if (micRef.current) {
      micRef.current.stop();
      micRef.current = null;
    }
    setIsListening(false);
    console.log('[Microphone] 🛑 Stopped');
  }, []);

  const interrupt = useCallback(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
      audioPlayerRef.current.resume();
    }
    setIsSpeaking(false);
  }, []);

  return {
    isConnected,
    isConnecting,
    isListening,
    isSpeaking,
    lastTranscript,
    error,
    fatalError,
    connect,
    disconnect,
    sendChessContext,
    sendGameEvent,
    startListening,
    stopListening,
    interrupt,
  };
}
