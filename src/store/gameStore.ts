import { create } from 'zustand';
import { Chess } from 'chess.js';
import { getChessHint, speakHint } from '../api/gemini';

const LICHESS_API = 'https://lichess.org/api/cloud-eval';

interface GameState {
  childName: string;
  game: Chess;
  fen: string;
  playerSide: 'white' | 'black';
  turn: 'w' | 'b';
  gameOver: boolean;
  gameResult: string | null;
  hintsRemaining: number;
  currentHint: string | null;
  isThinking: boolean;
  isLoadingHint: boolean;
  selectedSquare: string | null;
  possibleMoves: string[];

  setChildName: (name: string) => void;
  startGame: (side: 'white' | 'black') => void;
  makeMove: (from: string, to: string) => boolean;
  makeAiMove: () => Promise<void>;
  handleHint: () => Promise<void>;
  selectSquare: (square: string | null) => void;
  resetGame: () => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  childName: '',
  game: new Chess(),
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  playerSide: 'white',
  turn: 'w',
  gameOver: false,
  gameResult: null,
  hintsRemaining: 3,
  currentHint: null,
  isThinking: false,
  isLoadingHint: false,
  selectedSquare: null,
  possibleMoves: [],

  setChildName: (name: string) => set({ childName: name }),

  startGame: (side: 'white' | 'black') => {
    const game = new Chess();
    set({
      game,
      fen: game.fen(),
      playerSide: side,
      turn: 'w',
      gameOver: false,
      gameResult: null,
      hintsRemaining: 3,
      currentHint: null,
      selectedSquare: null,
      possibleMoves: [],
    });
  },

  makeMove: (from: string, to: string) => {
    const { game, playerSide, turn } = get();

    // Check if it's player's turn
    const isPlayerTurn =
      (playerSide === 'white' && turn === 'w') ||
      (playerSide === 'black' && turn === 'b');

    if (!isPlayerTurn) return false;

    try {
      const move = game.move({ from, to, promotion: 'q' });
      if (!move) return false;

      const newFen = game.fen();
      const isGameOver = game.isGameOver();
      let gameResult: string | null = null;

      if (isGameOver) {
        if (game.isCheckmate()) {
          gameResult = game.turn() === 'w' ? 'Чёрные победили!' : 'Белые победили!';
        } else if (game.isDraw()) {
          gameResult = 'Ничья!';
        } else if (game.isStalemate()) {
          gameResult = 'Пат!';
        }
      }

      set({
        fen: newFen,
        turn: game.turn(),
        gameOver: isGameOver,
        gameResult,
        currentHint: null,
        selectedSquare: null,
        possibleMoves: [],
      });

      return true;
    } catch {
      return false;
    }
  },

  makeAiMove: async () => {
    const { game, gameOver, isThinking } = get();
    if (gameOver || isThinking) return;

    set({ isThinking: true });

    try {
      const fen = game.fen();
      const response = await fetch(
        `${LICHESS_API}?fen=${encodeURIComponent(fen)}&multiPv=1`
      );

      if (!response.ok) {
        // Fallback to random move
        const moves = game.moves({ verbose: true });
        if (moves.length > 0) {
          const randomMove = moves[Math.floor(Math.random() * moves.length)];
          game.move(randomMove);
        }
      } else {
        const data = await response.json();
        const bestMove = data.pvs?.[0]?.moves?.split(' ')?.[0];

        if (bestMove && bestMove.length >= 4) {
          const from = bestMove.slice(0, 2);
          const to = bestMove.slice(2, 4);
          const promotion = bestMove.length > 4 ? bestMove[4] : undefined;
          game.move({ from, to, promotion });
        } else {
          // Fallback to random move
          const moves = game.moves({ verbose: true });
          if (moves.length > 0) {
            const randomMove = moves[Math.floor(Math.random() * moves.length)];
            game.move(randomMove);
          }
        }
      }

      const newFen = game.fen();
      const isGameOver = game.isGameOver();
      let gameResult: string | null = null;

      if (isGameOver) {
        if (game.isCheckmate()) {
          gameResult = game.turn() === 'w' ? 'Чёрные победили!' : 'Белые победили!';
        } else if (game.isDraw()) {
          gameResult = 'Ничья!';
        } else if (game.isStalemate()) {
          gameResult = 'Пат!';
        }
      }

      set({
        fen: newFen,
        turn: game.turn(),
        gameOver: isGameOver,
        gameResult,
        isThinking: false,
      });
    } catch (error) {
      console.error('AI move error:', error);
      set({ isThinking: false });
    }
  },

  handleHint: async () => {
    const { hintsRemaining, childName, fen, playerSide, isLoadingHint } = get();

    if (hintsRemaining <= 0 || isLoadingHint) return;

    set({ isLoadingHint: true, currentHint: null });

    try {
      const hint = await getChessHint(childName || 'Друг', fen, playerSide);
      set({
        currentHint: hint,
        hintsRemaining: hintsRemaining - 1,
        isLoadingHint: false,
      });

      // Speak the hint
      await speakHint(hint);
    } catch (error) {
      console.error('Hint error:', error);
      set({
        currentHint: 'Попробуй защитить свои фигуры!',
        isLoadingHint: false,
      });
    }
  },

  selectSquare: (square: string | null) => {
    const { game, playerSide, turn, gameOver } = get();

    if (gameOver) {
      set({ selectedSquare: null, possibleMoves: [] });
      return;
    }

    const isPlayerTurn =
      (playerSide === 'white' && turn === 'w') ||
      (playerSide === 'black' && turn === 'b');

    if (!isPlayerTurn) {
      set({ selectedSquare: null, possibleMoves: [] });
      return;
    }

    if (!square) {
      set({ selectedSquare: null, possibleMoves: [] });
      return;
    }

    const piece = game.get(square as any);
    const playerColor = playerSide === 'white' ? 'w' : 'b';

    if (piece && piece.color === playerColor) {
      const moves = game.moves({ square: square as any, verbose: true });
      set({
        selectedSquare: square,
        possibleMoves: moves.map((m) => m.to),
      });
    } else {
      set({ selectedSquare: null, possibleMoves: [] });
    }
  },

  resetGame: () => {
    const game = new Chess();
    set({
      game,
      fen: game.fen(),
      turn: 'w',
      gameOver: false,
      gameResult: null,
      hintsRemaining: 3,
      currentHint: null,
      isThinking: false,
      isLoadingHint: false,
      selectedSquare: null,
      possibleMoves: [],
    });
  },
}));
