import { useEffect, useMemo, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { useGameStore } from './store/gameStore';

function NameInput() {
  const [name, setName] = useState('');
  const { setChildName, startGame } = useGameStore();

  const handleStart = (side: 'white' | 'black') => {
    setChildName(name || 'Друг');
    startGame(side);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 max-w-md w-full shadow-2xl border border-white/20">
        <h1 className="text-4xl font-bold text-white text-center mb-2">
          Шахматик
        </h1>
        <p className="text-white/70 text-center mb-8">Шахматный тренер для детей</p>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Как тебя зовут?"
          className="w-full px-6 py-4 rounded-2xl bg-white/20 border border-white/30 text-white placeholder-white/50 text-lg focus:outline-none focus:ring-2 focus:ring-white/50 mb-6"
        />

        <p className="text-white/80 text-center mb-4">Выбери свой цвет:</p>

        <div className="flex gap-4">
          <button
            onClick={() => handleStart('white')}
            className="flex-1 py-4 px-6 rounded-2xl bg-white text-gray-800 font-bold text-lg hover:bg-gray-100 transition-all transform hover:scale-105 shadow-lg"
          >
            Белые
          </button>
          <button
            onClick={() => handleStart('black')}
            className="flex-1 py-4 px-6 rounded-2xl bg-gray-800 text-white font-bold text-lg hover:bg-gray-700 transition-all transform hover:scale-105 shadow-lg"
          >
            Чёрные
          </button>
        </div>
      </div>
    </div>
  );
}

function ChessGame() {
  const {
    childName,
    fen,
    playerSide,
    turn,
    gameOver,
    gameResult,
    hintsRemaining,
    currentHint,
    isThinking,
    isLoadingHint,
    selectedSquare,
    possibleMoves,
    game,
    makeMove,
    makeAiMove,
    handleHint,
    selectSquare,
    resetGame,
  } = useGameStore();

  // Trigger AI move when it's AI's turn
  useEffect(() => {
    const isAiTurn =
      (playerSide === 'white' && turn === 'b') ||
      (playerSide === 'black' && turn === 'w');

    if (isAiTurn && !gameOver && !isThinking) {
      const timer = setTimeout(() => {
        makeAiMove();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [turn, gameOver, isThinking, playerSide, makeAiMove]);

  // Custom square styles
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    if (selectedSquare) {
      styles[selectedSquare] = {
        backgroundColor: 'rgba(255, 200, 0, 0.5)',
        borderRadius: '4px',
      };
    }

    possibleMoves.forEach((square) => {
      const piece = game.get(square as any);
      if (piece) {
        styles[square] = {
          background:
            'radial-gradient(circle, transparent 60%, rgba(255, 100, 100, 0.6) 60%)',
          borderRadius: '50%',
        };
      } else {
        styles[square] = {
          background:
            'radial-gradient(circle, rgba(76, 175, 80, 0.6) 25%, transparent 25%)',
          borderRadius: '50%',
        };
      }
    });

    return styles;
  }, [selectedSquare, possibleMoves, game]);

  const onPieceDrop = ({
    sourceSquare,
    targetSquare,
  }: {
    piece: { pieceType: string };
    sourceSquare: string;
    targetSquare: string | null;
  }) => {
    if (!targetSquare || gameOver) return false;

    const isPlayerTurn =
      (playerSide === 'white' && turn === 'w') ||
      (playerSide === 'black' && turn === 'b');

    if (!isPlayerTurn) return false;

    const success = makeMove(sourceSquare, targetSquare);
    if (success) {
      selectSquare(null);
    }
    return success;
  };

  const onSquareClick = ({
    square,
  }: {
    piece: { pieceType: string } | null;
    square: string;
  }) => {
    if (gameOver) return;

    const isPlayerTurn =
      (playerSide === 'white' && turn === 'w') ||
      (playerSide === 'black' && turn === 'b');

    if (!isPlayerTurn) return;

    if (selectedSquare) {
      const success = makeMove(selectedSquare, square);
      if (success) {
        selectSquare(null);
        return;
      }
    }

    const piece = game.get(square as any);
    const playerColor = playerSide === 'white' ? 'w' : 'b';

    if (piece && piece.color === playerColor) {
      selectSquare(square);
    } else {
      selectSquare(null);
    }
  };

  const canDragPiece = ({
    piece,
  }: {
    piece: { pieceType: string };
    square: string | null;
    isSparePiece: boolean;
  }): boolean => {
    if (gameOver) return false;

    const isPlayerTurn =
      (playerSide === 'white' && turn === 'w') ||
      (playerSide === 'black' && turn === 'b');

    if (!isPlayerTurn) return false;

    const pieceColor = piece.pieceType[0];
    const playerColor = playerSide === 'white' ? 'w' : 'b';

    return pieceColor === playerColor;
  };

  const isPlayerTurn =
    (playerSide === 'white' && turn === 'w') ||
    (playerSide === 'black' && turn === 'b');

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 flex flex-col items-center p-4">
      {/* Header */}
      <div className="w-full max-w-md mb-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-white">Шахматик</h1>
          <span className="text-white/80">{childName}</span>
        </div>
      </div>

      {/* Status */}
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl px-6 py-3 mb-4 border border-white/20">
        {gameOver ? (
          <span className="text-yellow-300 font-bold text-lg">{gameResult}</span>
        ) : isThinking ? (
          <span className="text-white/80">Компьютер думает...</span>
        ) : isPlayerTurn ? (
          <span className="text-green-300 font-bold">Твой ход!</span>
        ) : (
          <span className="text-white/80">Ход соперника</span>
        )}
      </div>

      {/* Chess Board */}
      <div className="rounded-2xl overflow-hidden shadow-2xl mb-4">
        <Chessboard
          options={{
            position: fen,
            onPieceDrop,
            onSquareClick,
            canDragPiece,
            boardStyle: {
              borderRadius: '16px',
              width: '350px',
              height: '350px',
            },
            lightSquareStyle: { backgroundColor: '#FFFDE7' },
            darkSquareStyle: { backgroundColor: '#81C784' },
            squareStyles,
            boardOrientation: playerSide,
            animationDurationInMs: 200,
            showNotation: true,
          }}
        />
      </div>

      {/* Hint Section */}
      {currentHint && (
        <div className="bg-yellow-400/20 backdrop-blur-lg rounded-2xl px-6 py-4 mb-4 max-w-md border border-yellow-400/30">
          <p className="text-yellow-100 text-center">{currentHint}</p>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-4">
        {!gameOver && isPlayerTurn && (
          <button
            onClick={handleHint}
            disabled={hintsRemaining <= 0 || isLoadingHint}
            className="px-6 py-3 rounded-2xl bg-yellow-500 text-white font-bold hover:bg-yellow-600 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {isLoadingHint ? '...' : `Подсказка (${hintsRemaining})`}
          </button>
        )}

        {gameOver && (
          <button
            onClick={resetGame}
            className="px-6 py-3 rounded-2xl bg-green-500 text-white font-bold hover:bg-green-600 transition-all transform hover:scale-105"
          >
            Играть снова
          </button>
        )}
      </div>
    </div>
  );
}

function App() {
  const gameState = useGameStore();
  const hasStarted = gameState.childName !== '';

  return hasStarted ? <ChessGame /> : <NameInput />;
}

export default App;
