import { create } from 'zustand';
import { Chess, Move } from 'chess.js';
import { getPositionEval, analyzeMoveWithAI, analyzeGame } from '../api/gemini';
import type { MoveAnalysis } from '../api/gemini';

const LICHESS_API = 'https://lichess.org/api/cloud-eval';

export interface MoveRecord {
  moveNumber: number;
  san: string;
  fen: string;
  evaluation: number;
  isBlunder: boolean;
  isMistake: boolean;
  comment: string | null;
  isPlayerMove: boolean;
}

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
  isAnalyzing: boolean;
  selectedSquare: string | null;
  possibleMoves: string[];
  currentEval: number;
  moveHistory: MoveRecord[];
  lastAnalysis: MoveAnalysis | null;
  gameAnalysis: string | null;
  shouldUndo: boolean;
  lastCoachComment: string | null;

  setChildName: (name: string) => void;
  startGame: (side: 'white' | 'black') => void;
  makeMove: (from: string, to: string) => Promise<boolean>;
  makeAiMove: () => Promise<void>;
  handleHint: () => Promise<void>;
  selectSquare: (square: string | null) => void;
  resetGame: () => void;
  requestGameAnalysis: () => Promise<void>;
  undoMove: () => void;
  dismissUndo: () => void;
}

// Convert UCI move to SAN
function uciToSan(game: Chess, uci: string): string {
  if (!uci || uci.length < 4) return uci;
  try {
    const tempGame = new Chess(game.fen());
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const move = tempGame.move({ from, to, promotion });
    return move ? move.san : uci;
  } catch {
    return uci;
  }
}

export const useGameStore = create<GameState>((set, get) => ({
  childName: '',
  game: new Chess(),
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  playerSide: 'white',
  turn: 'w',
  gameOver: false,
  gameResult: null,
  hintsRemaining: 5,
  currentHint: null,
  isThinking: false,
  isLoadingHint: false,
  isAnalyzing: false,
  selectedSquare: null,
  possibleMoves: [],
  currentEval: 0,
  moveHistory: [],
  lastAnalysis: null,
  gameAnalysis: null,
  shouldUndo: false,
  lastCoachComment: null,

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
      hintsRemaining: 5,
      currentHint: null,
      selectedSquare: null,
      possibleMoves: [],
      currentEval: 0,
      moveHistory: [],
      lastAnalysis: null,
      gameAnalysis: null,
      shouldUndo: false,
      lastCoachComment: null,
    });
    // Gemini Live подключение и game_start событие обрабатываются в App.tsx
  },

  makeMove: async (from: string, to: string): Promise<boolean> => {
    const { game, playerSide, turn, childName, currentEval, moveHistory } = get();

    // Check if it's player's turn
    const isPlayerTurn =
      (playerSide === 'white' && turn === 'w') ||
      (playerSide === 'black' && turn === 'b');

    if (!isPlayerTurn) return false;

    const evalBefore = currentEval;
    const fenBefore = game.fen();

    try {
      const move = game.move({ from, to, promotion: 'q' });
      if (!move) return false;

      const newFen = game.fen();
      const isGameOver = game.isGameOver();
      let gameResult: string | null = null;

      if (isGameOver) {
        if (game.isCheckmate()) {
          gameResult = game.turn() === 'w' ? 'Мат! Чёрные победили.' : 'Мат! Белые победили.';
        } else if (game.isDraw()) {
          gameResult = 'Ничья!';
        } else if (game.isStalemate()) {
          gameResult = 'Пат!';
        }
      }

      // OPTIMISTIC UI: Update board immediately
      const tempMoveRecord: MoveRecord = {
        moveNumber: Math.ceil((moveHistory.length + 1) / 2),
        san: move.san,
        fen: newFen,
        evaluation: currentEval, // Use previous eval temporarily
        isBlunder: false,
        isMistake: false,
        comment: null,
        isPlayerMove: true,
      };

      set({
        fen: newFen,
        turn: game.turn(),
        gameOver: isGameOver,
        gameResult,
        currentHint: null,
        selectedSquare: null,
        possibleMoves: [],
        moveHistory: [...moveHistory, tempMoveRecord],
        isAnalyzing: true,
      });

      // Background: Get evaluation and analysis (non-blocking)
      getPositionEval(newFen).then(async (evalData) => {
        const evalAfter = evalData.eval;

        const analysis = await analyzeMoveWithAI(
          childName || 'Ученик',
          fenBefore,
          move.san,
          evalBefore,
          evalAfter,
          evalData.bestMove ? uciToSan(new Chess(fenBefore), evalData.bestMove) : null,
          true
        );

        // Update with real analysis data
        const currentHistory = get().moveHistory;
        const updatedHistory = currentHistory.map((record, idx) => {
          if (idx === currentHistory.length - 1 && record.san === move.san) {
            return {
              ...record,
              evaluation: evalAfter,
              isBlunder: analysis.isBlunder,
              isMistake: analysis.isMistake,
              comment: analysis.comment,
            };
          }
          return record;
        });

        set({
          currentEval: evalAfter,
          moveHistory: updatedHistory,
          lastAnalysis: analysis,
          isAnalyzing: false,
        });
      }).catch(() => {
        set({ isAnalyzing: false });
      });

      return true;
    } catch {
      return false;
    }
  },

  makeAiMove: async () => {
    const { game, gameOver, isThinking, moveHistory } = get();
    if (gameOver || isThinking) return;

    set({ isThinking: true });

    const fenBefore = game.fen();

    try {
      const response = await fetch(
        `${LICHESS_API}?fen=${encodeURIComponent(fenBefore)}&multiPv=1`
      );

      let move: Move | null = null;

      if (!response.ok) {
        // Fallback to random move
        const moves = game.moves({ verbose: true });
        if (moves.length > 0) {
          const randomMove = moves[Math.floor(Math.random() * moves.length)];
          move = game.move(randomMove);
        }
      } else {
        const data = await response.json();
        const bestMoveUci = data.pvs?.[0]?.moves?.split(' ')?.[0];

        if (bestMoveUci && bestMoveUci.length >= 4) {
          const from = bestMoveUci.slice(0, 2);
          const to = bestMoveUci.slice(2, 4);
          const promotion = bestMoveUci.length > 4 ? bestMoveUci[4] : undefined;
          move = game.move({ from, to, promotion });
        } else {
          // Fallback to random move
          const moves = game.moves({ verbose: true });
          if (moves.length > 0) {
            const randomMove = moves[Math.floor(Math.random() * moves.length)];
            move = game.move(randomMove);
          }
        }
      }

      if (!move) {
        set({ isThinking: false });
        return;
      }

      const newFen = game.fen();
      const isGameOver = game.isGameOver();
      let gameResult: string | null = null;

      if (isGameOver) {
        if (game.isCheckmate()) {
          gameResult = game.turn() === 'w' ? 'Мат! Чёрные победили.' : 'Мат! Белые победили.';
        } else if (game.isDraw()) {
          gameResult = 'Ничья!';
        } else if (game.isStalemate()) {
          gameResult = 'Пат!';
        }
      }

      // Get evaluation after AI move
      const evalData = await getPositionEval(newFen);
      const evalAfter = evalData.eval;

      const newMoveRecord: MoveRecord = {
        moveNumber: Math.ceil((moveHistory.length + 1) / 2),
        san: move.san,
        fen: newFen,
        evaluation: evalAfter,
        isBlunder: false,
        isMistake: false,
        comment: null,
        isPlayerMove: false,
      };

      set({
        fen: newFen,
        turn: game.turn(),
        gameOver: isGameOver,
        gameResult,
        isThinking: false,
        currentEval: evalAfter,
        moveHistory: [...moveHistory, newMoveRecord],
      });

      // События тренера теперь обрабатываются через Gemini Live в App.tsx
    } catch (error) {
      console.error('AI move error:', error);
      set({ isThinking: false });
    }
  },

  handleHint: async () => {
    // Подсказки теперь через Gemini Live голосовой интерфейс
    // Просто показываем базовую подсказку
    const { hintsRemaining } = get();
    if (hintsRemaining <= 0) return;

    set({
      currentHint: 'Нажми на кнопку микрофона и попроси подсказку голосом!',
      hintsRemaining: hintsRemaining - 1,
    });
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
      hintsRemaining: 5,
      currentHint: null,
      isThinking: false,
      isLoadingHint: false,
      isAnalyzing: false,
      selectedSquare: null,
      possibleMoves: [],
      currentEval: 0,
      moveHistory: [],
      lastAnalysis: null,
      gameAnalysis: null,
      shouldUndo: false,
      lastCoachComment: null,
    });
  },

  undoMove: () => {
    const { game, moveHistory } = get();
    if (moveHistory.length < 2) return; // Need at least player move + AI move to undo

    // Undo AI move and player move
    game.undo();
    game.undo();

    const newHistory = moveHistory.slice(0, -2);
    const lastRecord = newHistory[newHistory.length - 1];

    set({
      fen: game.fen(),
      turn: game.turn(),
      moveHistory: newHistory,
      currentEval: lastRecord?.evaluation || 0,
      lastAnalysis: null,
      shouldUndo: false,
      lastCoachComment: 'Хорошо, давай попробуем другой ход!',
    });
  },

  dismissUndo: () => {
    set({ shouldUndo: false });
  },

  requestGameAnalysis: async () => {
    const { childName, moveHistory, playerSide, gameResult } = get();

    if (moveHistory.length === 0) return;

    set({ isAnalyzing: true });

    try {
      const analysis = await analyzeGame(
        childName || 'Ученик',
        moveHistory.map(m => ({
          move: m.san,
          fen: m.fen,
          eval: m.evaluation,
          isBlunder: m.isBlunder,
        })),
        playerSide,
        gameResult || 'Партия завершена'
      );

      set({ gameAnalysis: analysis, isAnalyzing: false });
    } catch {
      set({
        gameAnalysis: 'Не удалось проанализировать партию.',
        isAnalyzing: false,
      });
    }
  },
}));
