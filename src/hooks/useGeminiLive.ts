import { useCallback, useRef, useState, useEffect } from 'react';

const GEMINI_LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
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

    console.log('[PCM] Playing chunk, size:', base64Data.length);

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
      console.error('PCM playback error:', error);
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
  private workletNode: AudioWorkletNode | null = null;
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
      // Get microphone access - browser will use native sample rate (44.1kHz or 48kHz)
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      // Create audio context at native sample rate
      this.audioContext = new AudioContext();
      const inputSampleRate = this.audioContext.sampleRate;
      console.log('[Microphone] Native sample rate:', inputSampleRate);

      this.source = this.audioContext.createMediaStreamSource(this.stream);

      // Use ScriptProcessor for raw PCM data (deprecated but widely supported)
      // Buffer size 4096 at 48kHz = ~85ms chunks
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.onAudioData) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Resample to 16kHz and convert to Int16
        const int16Data = this.resample(inputData, inputSampleRate);

        // Convert to base64
        const bytes = new Uint8Array(int16Data.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        console.log('[Microphone] Sent chunk:', base64.length);
        this.onAudioData(base64);
      };

      this.source.connect(this.processor);
      // Connect to destination to keep the processor running (but muted)
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
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
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

export function useGeminiLive(): GeminiLiveState & GeminiLiveActions {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioPlayerRef = useRef<PCMAudioPlayer | null>(null);
  const micRef = useRef<MicrophoneCapture | null>(null);
  const currentContextRef = useRef<{ fen: string; playerSide: string; childName: string } | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const connect = useCallback(async (): Promise<boolean> => {
    if (isConnected || isConnecting) return false;

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
        ws.onopen = () => {
          console.log('Gemini Live: WebSocket connected');

          // Send setup message - Gemini 2.0 Live API format
          const setupMessage = {
            setup: {
              model: 'models/gemini-2.0-flash-exp',
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: 'Puck'
                    }
                  }
                }
              },
              systemInstruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }]
              }
            }
          };

          console.log('[Gemini] Sending setup:', JSON.stringify(setupMessage));
          ws.send(JSON.stringify(setupMessage));
        };

        ws.onmessage = async (event) => {
          let messageText: string;

          // Handle both Blob and string messages
          if (event.data instanceof Blob) {
            messageText = await event.data.text();
          } else {
            messageText = event.data;
          }

          console.log('[Gemini] Raw message:', messageText.substring(0, 200));

          try {
            const data = JSON.parse(messageText);

            // Setup complete
            if (data.setupComplete) {
              console.log('Gemini Live: Setup complete');
              setIsConnected(true);
              setIsConnecting(false);
              resolve(true);
              return;
            }

            // Server content (audio response)
            if (data.serverContent) {
              const parts = data.serverContent.modelTurn?.parts || [];

              for (const part of parts) {
                // Audio data - mimeType can be 'audio/pcm' or 'audio/pcm;rate=24000'
                if (part.inlineData?.mimeType?.startsWith('audio/pcm')) {
                  setIsSpeaking(true);
                  audioPlayerRef.current?.playPCM(part.inlineData.data);
                }

                // Text transcript
                if (part.text) {
                  setLastTranscript(part.text);
                }
              }

              // Turn complete
              if (data.serverContent.turnComplete) {
                setIsSpeaking(false);
              }
            }

            // Tool call (if needed in future)
            if (data.toolCall) {
              console.log('Gemini Live: Tool call received', data.toolCall);
            }

          } catch (e) {
            console.error('Gemini Live: Message parse error', e);
          }
        };

        ws.onerror = (e) => {
          console.error('Gemini Live: WebSocket error', e);
          setError('Connection error');
          setIsConnecting(false);
          resolve(false);
        };

        ws.onclose = (event) => {
          console.log('Gemini Live: WebSocket closed', { code: event.code, reason: event.reason, wasClean: event.wasClean });
          setIsConnected(false);
          setIsConnecting(false);
          setIsSpeaking(false);
        };

        // Timeout
        setTimeout(() => {
          if (!isConnected) {
            ws.close();
            setError('Connection timeout');
            setIsConnecting(false);
            resolve(false);
          }
        }, 10000);
      });

    } catch (e) {
      console.error('Gemini Live: Connect error', e);
      setError('Failed to connect');
      setIsConnecting(false);
      return false;
    }
  }, [isConnected, isConnecting]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (micRef.current) {
      micRef.current.stop();
      micRef.current = null;
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
    }
    setIsConnected(false);
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  const sendChessContext = useCallback((fen: string, playerSide: 'white' | 'black', childName: string) => {
    currentContextRef.current = { fen, playerSide, childName };
  }, []);

  const sendGameEvent = useCallback((
    event: 'game_start' | 'child_move' | 'ai_move' | 'check' | 'game_end',
    move?: string,
    evaluation?: number
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const context = currentContextRef.current;
    let prompt = '';

    switch (event) {
      case 'game_start':
        prompt = `${context?.childName || 'Ученик'} начинает игру ${context?.playerSide === 'white' ? 'белыми' : 'чёрными'}. Поприветствуй и пожелай удачи!`;
        break;
      case 'child_move':
        prompt = `${context?.childName || 'Ученик'} сделал ход ${move}. FEN: ${context?.fen}. ${evaluation !== undefined ? `Оценка: ${evaluation > 0 ? '+' : ''}${evaluation.toFixed(1)}` : ''} Прокомментируй ход кратко.`;
        break;
      case 'ai_move':
        prompt = `Компьютер сделал ход ${move}. FEN: ${context?.fen}. Кратко объясни этот ход.`;
        break;
      case 'check':
        prompt = `Шах! Объясни, что делать при шахе.`;
        break;
      case 'game_end':
        prompt = `Игра завершена. Подведи итог и похвали за игру.`;
        break;
    }

    // Send text message - don't set turnComplete to keep session alive
    const message = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        turnComplete: true  // Must be true to get a response
      }
    };

    console.log('[Gemini] Sending event:', event);
    wsRef.current.send(JSON.stringify(message));
  }, []);

  const startListening = useCallback(async (): Promise<boolean> => {
    if (!isConnected || isListening) {
      console.log('[Microphone] Cannot start: connected=', isConnected, 'listening=', isListening);
      return false;
    }

    console.log('[Microphone] Starting listening...');
    micRef.current = new MicrophoneCapture();

    const success = await micRef.current.start((base64Audio) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const message = {
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: 'audio/pcm;rate=16000',
                data: base64Audio
              }
            ]
          }
        };
        wsRef.current.send(JSON.stringify(message));
      } else {
        console.log('[Microphone] WebSocket not open, state:', wsRef.current?.readyState);
      }
    });

    if (success) {
      setIsListening(true);
      // Interrupt any current speech
      interrupt();
      console.log('[Microphone] Listening started successfully');
    } else {
      console.log('[Microphone] Failed to start listening');
    }

    return success;
  }, [isConnected, isListening]);

  const stopListening = useCallback(() => {
    if (micRef.current) {
      micRef.current.stop();
      micRef.current = null;
    }
    setIsListening(false);
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
    connect,
    disconnect,
    sendChessContext,
    sendGameEvent,
    startListening,
    stopListening,
    interrupt,
  };
}
