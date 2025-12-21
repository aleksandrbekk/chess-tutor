import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import WebApp from '@twa-dev/sdk';
import { useGameStore } from './store/gameStore';
import type { MoveRecord } from './store/gameStore';
import { askTutor } from './api/gemini';
import type { ChatMessage } from './api/gemini';
import { useGeminiLive } from './hooks/useGeminiLive';

// Detect mobile for performance optimization (no blur)
const isMobile = () => window.innerWidth <= 768;

// Glass morphism design - simplified on mobile for FPS
const getGlassPanel = (mobile: boolean) => mobile ? {
  background: 'rgba(30, 30, 50, 0.95)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: '24px',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
} : {
  background: 'rgba(255, 255, 255, 0.08)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: '24px',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
};

const GLASS = {
  bgGradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  panel: getGlassPanel(isMobile()),
  text: '#ffffff',
  textMuted: 'rgba(255, 255, 255, 0.6)',
  accent: '#00d4ff',
  success: '#00ff88',
  danger: '#ff4466',
};

function initTelegram() {
  try {
    WebApp.ready();
    WebApp.expand();
    WebApp.enableClosingConfirmation();
  } catch (e) {
    console.log('Not in Telegram:', e);
  }
}

// Name Input Screen
function NameInput() {
  const [name, setName] = useState('');
  const { setChildName, startGame } = useGameStore();

  useEffect(() => { initTelegram(); }, []);

  const handleStart = async (side: 'white' | 'black') => {
    const childName = name || 'Ученик';
    setChildName(childName);
    // startGame will call notifyCoach with 'game_start' event
    startGame(side);
  };

  return (
    <div style={{
      height: '100dvh',
      background: GLASS.bgGradient,
      padding: '100px 20px 40px',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: '380px', padding: '40px 28px', ...GLASS.panel }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px', filter: 'drop-shadow(0 0 20px rgba(0, 212, 255, 0.5))' }}>♟</div>
          <h1 style={{ fontSize: '28px', fontWeight: '700', color: GLASS.text, margin: 0 }}>Шахматный тренер</h1>
          <p style={{ fontSize: '16px', color: GLASS.textMuted, marginTop: '8px' }}>AI комментирует каждый ход</p>
        </div>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Как тебя зовут?"
          style={{
            width: '100%', padding: '18px 22px', fontSize: '18px',
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '16px', color: GLASS.text, boxSizing: 'border-box',
            marginBottom: '24px', outline: 'none',
          }}
        />

        <p style={{ textAlign: 'center', fontSize: '18px', fontWeight: '500', color: GLASS.text, marginBottom: '16px' }}>
          Выбери цвет:
        </p>

        <div style={{ display: 'flex', gap: '16px' }}>
          <button onClick={() => handleStart('white')} style={{
            flex: 1, height: '60px', fontSize: '18px', fontWeight: '600', borderRadius: '16px',
            border: '2px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.15)',
            color: GLASS.text, cursor: 'pointer',
          }}>♔ Белые</button>
          <button onClick={() => handleStart('black')} style={{
            flex: 1, height: '60px', fontSize: '18px', fontWeight: '600', borderRadius: '16px',
            border: 'none', background: 'linear-gradient(135deg, #2d2d2d 0%, #1a1a1a 100%)',
            color: GLASS.text, cursor: 'pointer',
          }}>♚ Чёрные</button>
        </div>
      </div>
    </div>
  );
}

// Bottom Sheet Modal
function BottomSheet({ isOpen, onClose, title, children }: {
  isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  if (!isOpen) return null;

  // No blur on mobile for performance
  const overlayStyle = isMobile()
    ? { background: 'rgba(0,0,0,0.7)' }
    : { background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(5px)' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      ...overlayStyle,
    }} onClick={onClose}>
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          maxHeight: '70vh', overflowY: 'auto',
          background: 'rgba(26, 26, 46, 0.98)',
          borderRadius: '24px 24px 0 0',
          padding: '20px',
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ color: GLASS.text, fontSize: '20px', fontWeight: '600', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{
            width: '36px', height: '36px', borderRadius: '18px',
            background: 'rgba(255,255,255,0.1)', border: 'none',
            color: GLASS.text, fontSize: '18px', cursor: 'pointer',
          }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Move History Modal Content
function MoveHistoryContent({ moves, playerSide }: { moves: MoveRecord[]; playerSide: 'white' | 'black' }) {
  const groupedMoves: { num: number; white?: MoveRecord; black?: MoveRecord }[] = [];

  moves.forEach((move, index) => {
    const isWhiteMove = (playerSide === 'white' && move.isPlayerMove) || (playerSide === 'black' && !move.isPlayerMove);
    const moveNum = Math.floor(index / 2) + 1;
    let group = groupedMoves.find(g => g.num === moveNum);
    if (!group) { group = { num: moveNum }; groupedMoves.push(group); }
    if (isWhiteMove) group.white = move; else group.black = move;
  });

  if (groupedMoves.length === 0) {
    return <p style={{ color: GLASS.textMuted, textAlign: 'center' }}>Ходов пока нет</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {groupedMoves.map((group) => (
        <div key={group.num} style={{
          display: 'flex', alignItems: 'center', padding: '10px 14px',
          background: 'rgba(255,255,255,0.05)', borderRadius: '12px', fontSize: '16px',
        }}>
          <span style={{ width: '32px', fontWeight: '600', color: GLASS.textMuted }}>{group.num}.</span>
          <span style={{
            width: '80px', fontFamily: 'monospace', color: GLASS.text,
            backgroundColor: group.white?.isBlunder ? 'rgba(255,68,102,0.3)' : group.white?.isMistake ? 'rgba(255,170,0,0.3)' : 'transparent',
            borderRadius: '6px', padding: '4px 8px',
          }}>
            {group.white?.san || ''}{group.white?.isBlunder && ' ??'}{group.white?.isMistake && !group.white?.isBlunder && ' ?'}
          </span>
          <span style={{
            width: '80px', fontFamily: 'monospace', color: GLASS.text,
            backgroundColor: group.black?.isBlunder ? 'rgba(255,68,102,0.3)' : group.black?.isMistake ? 'rgba(255,170,0,0.3)' : 'transparent',
            borderRadius: '6px', padding: '4px 8px',
          }}>
            {group.black?.san || ''}{group.black?.isBlunder && ' ??'}{group.black?.isMistake && !group.black?.isBlunder && ' ?'}
          </span>
        </div>
      ))}
    </div>
  );
}

// Chat Modal Content (текстовый чат, голос через Gemini Live)
function ChatContent({ childName, fen, moveHistory }: { childName: string; fen: string; moveHistory: string[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const handleAsk = async (text: string) => {
    if (!text.trim()) return;
    setMessages(prev => [...prev, { role: 'user', text, timestamp: Date.now() }]);
    setInputText('');
    setIsAsking(true);
    try {
      const response = await askTutor(childName, text, fen, moveHistory);
      setMessages(prev => [...prev, { role: 'tutor', text: response, timestamp: Date.now() }]);
    } catch {
      setMessages(prev => [...prev, { role: 'tutor', text: 'Попробуй ещё раз.', timestamp: Date.now() }]);
    }
    setIsAsking(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '300px' }}>
      <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', marginBottom: '12px' }}>
        {messages.length === 0 ? (
          <p style={{ color: GLASS.textMuted, textAlign: 'center' }}>Задай вопрос тренеру (или используй голос 🎤)</p>
        ) : messages.map((msg, i) => (
          <div key={i} style={{
            padding: '12px 16px', borderRadius: '14px', marginBottom: '8px',
            marginLeft: msg.role === 'user' ? '30px' : '0',
            marginRight: msg.role === 'tutor' ? '30px' : '0',
            background: msg.role === 'user' ? 'rgba(0,212,255,0.2)' : 'rgba(255,255,255,0.1)',
            border: msg.role === 'user' ? '1px solid rgba(0,212,255,0.3)' : '1px solid rgba(255,255,255,0.1)',
            color: GLASS.text, fontSize: '15px',
          }}>{msg.text}</div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); handleAsk(inputText); }} style={{ display: 'flex', gap: '10px' }}>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Напиши вопрос..."
          disabled={isAsking}
          style={{
            flex: 1, padding: '14px 18px', fontSize: '16px',
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '14px', color: GLASS.text, outline: 'none',
          }}
        />
        <button type="submit" disabled={isAsking || !inputText.trim()} style={{
          width: '50px', height: '50px', borderRadius: '14px', border: 'none',
          background: 'linear-gradient(135deg, #00d4ff 0%, #0088cc 100%)',
          color: '#FFF', fontSize: '22px', cursor: 'pointer',
          opacity: isAsking || !inputText.trim() ? 0.5 : 1,
        }}>➤</button>
      </form>
    </div>
  );
}

// Main Game Screen
function ChessGame() {
  const {
    childName, fen, playerSide, turn, gameOver, gameResult,
    isThinking, isAnalyzing, selectedSquare, possibleMoves,
    game, currentEval, moveHistory, lastAnalysis, gameAnalysis,
    shouldUndo, lastCoachComment,
    makeMove, makeAiMove, selectSquare, resetGame, requestGameAnalysis,
    undoMove, dismissUndo,
  } = useGameStore();

  const [boardSize, setBoardSize] = useState(300);
  const [showHistory, setShowHistory] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // Gemini Live голосовой тренер
  const geminiLive = useGeminiLive();
  const prevMoveCountRef = useRef(0);

  useEffect(() => {
    initTelegram();
    const updateBoardSize = () => {
      const maxSize = Math.min(window.innerWidth - 40, window.innerHeight - 300, 400);
      setBoardSize(maxSize);
    };
    updateBoardSize();
    window.addEventListener('resize', updateBoardSize);
    return () => window.removeEventListener('resize', updateBoardSize);
  }, []);

  // Подключение к Gemini Live при старте игры (только один раз)
  useEffect(() => {
    // BLOCK if fatal error
    if (geminiLive.fatalError) return;

    if (childName && !geminiLive.isConnected && !geminiLive.isConnecting) {
      geminiLive.connect().then(success => {
        if (success) {
          geminiLive.sendChessContext(fen, playerSide, childName);
          geminiLive.sendGameEvent('game_start');
        }
      });
    }
  }, [childName, geminiLive.fatalError]);

  // Обновляем контекст при изменении позиции
  useEffect(() => {
    if (geminiLive.isConnected) {
      geminiLive.sendChessContext(fen, playerSide, childName);
    }
  }, [fen, playerSide, childName, geminiLive.isConnected]);

  // Отправляем события о ходах (БЕЗ авто-переподключения - fatalError блокирует)
  useEffect(() => {
    const currentMoveCount = moveHistory.length;
    if (currentMoveCount <= prevMoveCountRef.current || currentMoveCount === 0) {
      return;
    }

    const lastMove = moveHistory[currentMoveCount - 1];
    prevMoveCountRef.current = currentMoveCount;

    // Only send if connected - NO reconnect here (causes loop)
    if (geminiLive.isConnected) {
      if (lastMove.isPlayerMove) {
        geminiLive.sendGameEvent('child_move', lastMove.san, lastMove.evaluation);
      } else {
        geminiLive.sendGameEvent('ai_move', lastMove.san, lastMove.evaluation);
      }
    }
  }, [moveHistory, geminiLive.isConnected]);

  // Событие конца игры
  useEffect(() => {
    if (gameOver && geminiLive.isConnected) {
      geminiLive.sendGameEvent('game_end');
    }
  }, [gameOver, geminiLive.isConnected]);

  // AI move
  useEffect(() => {
    const isAiTurn = (playerSide === 'white' && turn === 'b') || (playerSide === 'black' && turn === 'w');
    if (isAiTurn && !gameOver && !isThinking) {
      const timer = setTimeout(() => makeAiMove(), 500);
      return () => clearTimeout(timer);
    }
  }, [turn, gameOver, isThinking, playerSide, makeAiMove]);

  // Голосовая кнопка - используем Gemini Live
  const handleVoiceButton = useCallback(async () => {
    if (!geminiLive.isConnected) {
      // Попробуем подключиться
      const success = await geminiLive.connect();
      if (!success) return;
      geminiLive.sendChessContext(fen, playerSide, childName);
    }

    if (geminiLive.isListening) {
      geminiLive.stopListening();
    } else {
      // Прерываем текущую речь и начинаем слушать
      geminiLive.interrupt();
      await geminiLive.startListening();
    }
  }, [geminiLive, fen, playerSide, childName]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (selectedSquare) styles[selectedSquare] = { backgroundColor: 'rgba(0, 212, 255, 0.5)' };
    possibleMoves.forEach((sq) => {
      const piece = game.get(sq as any);
      styles[sq] = piece
        ? { background: 'radial-gradient(circle, transparent 60%, rgba(255, 68, 102, 0.6) 60%)' }
        : { background: 'radial-gradient(circle, rgba(0, 255, 136, 0.6) 25%, transparent 25%)' };
    });
    return styles;
  }, [selectedSquare, possibleMoves, game]);

  const onPieceDrop = ({ sourceSquare, targetSquare }: { piece: { pieceType: string }; sourceSquare: string; targetSquare: string | null }) => {
    if (!targetSquare || gameOver) return false;
    const isPlayerTurn = (playerSide === 'white' && turn === 'w') || (playerSide === 'black' && turn === 'b');
    if (!isPlayerTurn) return false;
    makeMove(sourceSquare, targetSquare).then(success => { if (success) selectSquare(null); });
    return true;
  };

  const onSquareClick = async ({ square }: { piece: { pieceType: string } | null; square: string }) => {
    if (gameOver) return;
    const isPlayerTurn = (playerSide === 'white' && turn === 'w') || (playerSide === 'black' && turn === 'b');
    if (!isPlayerTurn) return;
    if (selectedSquare) {
      const success = await makeMove(selectedSquare, square);
      if (success) { selectSquare(null); return; }
    }
    const piece = game.get(square as any);
    const playerColor = playerSide === 'white' ? 'w' : 'b';
    if (piece && piece.color === playerColor) selectSquare(square);
    else selectSquare(null);
  };

  const canDragPiece = ({ piece }: { piece: { pieceType: string }; square: string | null; isSparePiece: boolean }): boolean => {
    if (gameOver) return false;
    const isPlayerTurn = (playerSide === 'white' && turn === 'w') || (playerSide === 'black' && turn === 'b');
    if (!isPlayerTurn) return false;
    const pieceColor = piece.pieceType[0];
    const playerColor = playerSide === 'white' ? 'w' : 'b';
    return pieceColor === playerColor;
  };

  const isPlayerTurn = (playerSide === 'white' && turn === 'w') || (playerSide === 'black' && turn === 'b');

  return (
    <div style={{ height: '100dvh', background: GLASS.bgGradient, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header - компактный */}
      <div style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        paddingLeft: '16px', paddingRight: '16px', paddingBottom: '8px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '24px' }}>♟️</span>
            <span style={{ fontSize: '16px', fontWeight: '600', color: GLASS.text }}>{childName}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Индикатор Gemini Live */}
            <div style={{
              width: '10px', height: '10px', borderRadius: '50%',
              background: geminiLive.isConnected ? '#00ff88' : geminiLive.isConnecting ? '#ffaa00' : '#666',
              boxShadow: geminiLive.isConnected ? '0 0 8px #00ff88' : 'none',
            }} title={geminiLive.isConnected ? 'Тренер подключён' : 'Отключён'} />
            <div style={{
              padding: '6px 12px', borderRadius: '12px', fontSize: '14px', fontWeight: '600',
              background: currentEval >= 0 ? 'rgba(0,255,136,0.2)' : 'rgba(255,68,102,0.2)',
              border: currentEval >= 0 ? '1px solid rgba(0,255,136,0.4)' : '1px solid rgba(255,68,102,0.4)',
              color: currentEval >= 0 ? GLASS.success : GLASS.danger,
            }}>
              {currentEval > 0 ? '+' : ''}{currentEval.toFixed(1)}
            </div>
            <div style={{
              padding: '6px 12px', borderRadius: '12px', fontSize: '14px', fontWeight: '600',
              background: gameOver ? 'rgba(255,170,0,0.3)' : isPlayerTurn ? 'rgba(0,255,136,0.3)' : 'rgba(255,255,255,0.1)',
              border: gameOver ? '1px solid rgba(255,170,0,0.5)' : isPlayerTurn ? '1px solid rgba(0,255,136,0.5)' : '1px solid rgba(255,255,255,0.2)',
              color: GLASS.text,
            }}>
              {gameOver ? 'Конец' : isThinking || isAnalyzing ? '...' : isPlayerTurn ? 'Твой ход' : 'Ход ИИ'}
            </div>
          </div>
        </div>
      </div>

      {/* Board - центрированная */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 16px', minHeight: 0 }}>
        <div style={{ width: boardSize + 12, height: boardSize + 12, padding: '6px', ...GLASS.panel, borderRadius: '24px' }}>
          <div style={{ width: boardSize, height: boardSize, borderRadius: '18px', overflow: 'hidden' }}>
            <Chessboard
              options={{
                position: fen,
                onPieceDrop,
                onSquareClick,
                canDragPiece,
                boardStyle: { borderRadius: '18px', width: '100%', height: '100%' },
                lightSquareStyle: { backgroundColor: '#e8eaed' },
                darkSquareStyle: { backgroundColor: '#6b7280' },
                squareStyles,
                boardOrientation: playerSide,
                animationDurationInMs: 200,
                showNotation: true,
              }}
            />
          </div>
        </div>

        {/* Last comment - под доской (приоритет: Gemini Live транскрипт > coach comment > analysis) */}
        {(geminiLive.lastTranscript || lastAnalysis || lastCoachComment) && (
          <div style={{
            marginTop: '12px', padding: '10px 16px', maxWidth: boardSize + 12,
            ...GLASS.panel, borderRadius: '14px',
            background: geminiLive.isSpeaking
              ? 'rgba(0,255,136,0.15)'
              : lastAnalysis?.isBlunder ? 'rgba(255,68,102,0.2)' : lastAnalysis?.isMistake ? 'rgba(255,170,0,0.2)' : 'rgba(0,212,255,0.15)',
          }}>
            <p style={{ margin: 0, fontSize: '14px', color: GLASS.text, textAlign: 'center', lineHeight: 1.4 }}>
              {geminiLive.lastTranscript || lastCoachComment || lastAnalysis?.comment}
            </p>
          </div>
        )}

        {/* Undo Button - показывать если тренер рекомендует отменить ход */}
        {shouldUndo && (
          <div style={{
            marginTop: '12px', display: 'flex', gap: '10px', justifyContent: 'center',
          }}>
            <button onClick={undoMove} style={{
              padding: '12px 24px', fontSize: '16px', fontWeight: '600',
              borderRadius: '14px', border: 'none',
              background: 'linear-gradient(135deg, #ffaa00 0%, #ff8800 100%)',
              color: '#FFF', cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(255, 170, 0, 0.4)',
            }}>↩️ Отменить ход</button>
            <button onClick={dismissUndo} style={{
              padding: '12px 20px', fontSize: '16px', fontWeight: '600',
              borderRadius: '14px', border: '1px solid rgba(255,255,255,0.3)',
              background: 'rgba(255,255,255,0.1)',
              color: GLASS.text, cursor: 'pointer',
            }}>Продолжить</button>
          </div>
        )}
      </div>

      {/* Game Over Panel */}
      {gameOver && (
        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ ...GLASS.panel, padding: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: '22px', fontWeight: '700', color: GLASS.text, margin: '0 0 12px 0' }}>{gameResult}</p>
            {gameAnalysis && <p style={{ fontSize: '14px', color: GLASS.textMuted, margin: '0 0 12px 0' }}>{gameAnalysis}</p>}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              {!gameAnalysis && (
                <button onClick={requestGameAnalysis} disabled={isAnalyzing} style={{
                  height: '50px', padding: '0 24px', fontSize: '16px', fontWeight: '600',
                  borderRadius: '14px', border: 'none',
                  background: 'linear-gradient(135deg, #ffaa00 0%, #ff8800 100%)',
                  color: '#FFF', cursor: 'pointer', opacity: isAnalyzing ? 0.5 : 1,
                }}>{isAnalyzing ? '...' : 'Анализ'}</button>
              )}
              <button onClick={resetGame} style={{
                height: '50px', padding: '0 24px', fontSize: '16px', fontWeight: '600',
                borderRadius: '14px', border: 'none',
                background: 'linear-gradient(135deg, #00ff88 0%, #00cc66 100%)',
                color: '#1a1a2e', cursor: 'pointer',
              }}>Новая партия</button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Buttons - компактные */}
      {!gameOver && (
        <div style={{
          padding: '12px 16px',
          paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 8px))',
          display: 'flex', gap: '10px', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <button onClick={() => setShowHistory(true)} style={{
            ...GLASS.panel,
            width: '56px', height: '56px', borderRadius: '18px', border: 'none',
            cursor: 'pointer', fontSize: '22px',
          }}>📋</button>
          <button onClick={() => setShowChat(true)} style={{
            ...GLASS.panel,
            width: '56px', height: '56px', borderRadius: '18px', border: 'none',
            cursor: 'pointer', fontSize: '22px',
          }}>💬</button>
          <button onClick={handleVoiceButton} style={{
            width: '72px', height: '56px', borderRadius: '18px', border: 'none',
            background: geminiLive.isListening
              ? 'linear-gradient(135deg, #ff4466 0%, #cc2244 100%)'
              : geminiLive.isSpeaking
              ? 'linear-gradient(135deg, #00ff88 0%, #00cc66 100%)'
              : geminiLive.isConnecting
              ? 'linear-gradient(135deg, #ffaa00 0%, #ff8800 100%)'
              : 'linear-gradient(135deg, #00d4ff 0%, #0088cc 100%)',
            cursor: 'pointer', fontSize: '26px',
            boxShadow: geminiLive.isListening
              ? '0 0 20px rgba(255,68,102,0.5)'
              : geminiLive.isSpeaking
              ? '0 0 20px rgba(0,255,136,0.5)'
              : '0 0 20px rgba(0,212,255,0.4)',
            opacity: geminiLive.isConnecting ? 0.7 : 1,
          }}>{geminiLive.isListening ? '🎙️' : geminiLive.isSpeaking ? '🔊' : '🎤'}</button>
        </div>
      )}

      {/* Modals */}
      <BottomSheet isOpen={showHistory} onClose={() => setShowHistory(false)} title="История ходов">
        <MoveHistoryContent moves={moveHistory} playerSide={playerSide} />
      </BottomSheet>

      <BottomSheet isOpen={showChat} onClose={() => setShowChat(false)} title="Чат с тренером">
        <ChatContent childName={childName} fen={fen} moveHistory={moveHistory.map(m => m.san)} />
      </BottomSheet>
    </div>
  );
}

function App() {
  const gameState = useGameStore();
  const hasStarted = gameState.childName !== '';
  return hasStarted ? <ChessGame /> : <NameInput />;
}

export default App;
