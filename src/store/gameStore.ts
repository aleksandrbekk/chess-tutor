import { create } from 'zustand';
import { Chess, Move } from 'chess.js';
import { getPositionEval, analyzeMoveWithAI, analyzeGame } from '../api/gemini';
import type { MoveAnalysis } from '../api/gemini';

const LICHESS_API = 'https://lichess.org/api/cloud-eval';

// Уровни сложности
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

export interface LevelConfig {
  name: string;
  description: string;
  hintsCount: number;
  aiStrength: 'random' | 'weak' | 'strong';
  emoji: string;
}

export const LEVELS: Record<DifficultyLevel, LevelConfig> = {
  easy: {
    name: 'Новичок',
    description: 'Компьютер делает случайные ходы',
    hintsCount: 10,
    aiStrength: 'random',
    emoji: '🌟',
  },
  medium: {
    name: 'Ученик',
    description: 'Компьютер иногда ошибается',
    hintsCount: 5,
    aiStrength: 'weak',
    emoji: '⚡',
  },
  hard: {
    name: 'Мастер',
    description: 'Компьютер играет сильно',
    hintsCount: 3,
    aiStrength: 'strong',
    emoji: '🏆',
  },
};

// Статистика игр
export interface GameStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
}

const STATS_KEY = 'chess-tutor-stats';

function loadStats(): GameStats {
  try {
    const saved = localStorage.getItem(STATS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
  return {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    currentStreak: 0,
    bestStreak: 0,
  };
}

function saveStats(stats: GameStats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    console.error('Failed to save stats:', e);
  }
}

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
  // Экран (start, playing, gameOver)
  screen: 'start' | 'playing' | 'gameOver';

  // Уровень и статистика
  difficulty: DifficultyLevel;
  stats: GameStats;

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

  // Actions
  setChildName: (name: string) => void;
  setDifficulty: (level: DifficultyLevel) => void;
  startGame: (side: 'white' | 'black') => void;
  makeMove: (from: string, to: string) => Promise<boolean>;
  makeAiMove: () => Promise<void>;
  handleHint: () => Promise<void>;
  selectSquare: (square: string | null) => void;
  resetGame: () => void;
  goToStart: () => void;
  requestGameAnalysis: () => Promise<void>;
  undoMove: () => void;
  dismissUndo: () => void;
  recordGameResult: (result: 'win' | 'loss' | 'draw') => void;
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
  screen: 'start',
  difficulty: 'easy',
  stats: loadStats(),

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

  setDifficulty: (level: DifficultyLevel) => set({ difficulty: level }),

  startGame: (side: 'white' | 'black') => {
    const { difficulty } = get();
    const levelConfig = LEVELS[difficulty];
    const game = new Chess();
    set({
      screen: 'playing',
      game,
      fen: game.fen(),
      playerSide: side,
      turn: 'w',
      gameOver: false,
      gameResult: null,
      hintsRemaining: levelConfig.hintsCount,
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

  goToStart: () => {
    const game = new Chess();
    set({
      screen: 'start',
      game,
      fen: game.fen(),
      turn: 'w',
      gameOver: false,
      gameResult: null,
      currentHint: null,
      isThinking: false,
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

  recordGameResult: (result: 'win' | 'loss' | 'draw') => {
    const { stats } = get();
    const newStats = { ...stats, gamesPlayed: stats.gamesPlayed + 1 };

    if (result === 'win') {
      newStats.wins = stats.wins + 1;
      newStats.currentStreak = stats.currentStreak + 1;
      if (newStats.currentStreak > newStats.bestStreak) {
        newStats.bestStreak = newStats.currentStreak;
      }
    } else if (result === 'loss') {
      newStats.losses = stats.losses + 1;
      newStats.currentStreak = 0;
    } else {
      newStats.draws = stats.draws + 1;
    }

    saveStats(newStats);
    set({ stats: newStats, screen: 'gameOver' });
  },

  makeMove: async (from: string, to: string): Promise<boolean> => {
    const { game, playerSide, turn, childName, currentEval, moveHistory, difficulty } = get();

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
        isAnalyzing: difficulty === 'hard', // Анализ только для Мастера
      });

      // Детальный анализ только для уровня Мастер (hard)
      // На других уровнях - мгновенный отклик без Lichess API
      if (difficulty === 'hard') {
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
      }

      return true;
    } catch {
      return false;
    }
  },

  makeAiMove: async () => {
    const { game, gameOver, isThinking, moveHistory, difficulty, currentEval } = get();
    if (gameOver || isThinking) return;

    set({ isThinking: true });

    const fenBefore = game.fen();
    const levelConfig = LEVELS[difficulty];

    try {
      let move: Move | null = null;
      const moves = game.moves({ verbose: true });

      if (moves.length === 0) {
        set({ isThinking: false });
        return;
      }

      // В зависимости от уровня выбираем стратегию
      if (levelConfig.aiStrength === 'random') {
        // Новичок: случайный ход (без Lichess API - мгновенно)
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        move = game.move(randomMove);
      } else if (levelConfig.aiStrength === 'weak') {
        // Ученик: улучшенный случайный (без Lichess API - мгновенно)
        // Приоритет: взятия > шахи > развитие > случайный
        const captures = moves.filter(m => m.captured);
        const checks = moves.filter(m => {
          const temp = new Chess(fenBefore);
          temp.move(m);
          return temp.inCheck();
        });
        const development = moves.filter(m =>
          (m.piece === 'n' || m.piece === 'b') &&
          (m.from[1] === '1' || m.from[1] === '8')
        );

        let candidates = captures.length > 0 ? captures :
                        checks.length > 0 ? checks :
                        development.length > 0 ? development : moves;

        // 30% шанс сделать случайный ход вместо "умного"
        if (Math.random() < 0.3) {
          candidates = moves;
        }

        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        move = game.move(chosen);
      } else {
        // Мастер: всегда лучший ход через Lichess API
        const response = await fetch(
          `${LICHESS_API}?fen=${encodeURIComponent(fenBefore)}&multiPv=1`
        );
        if (response.ok) {
          const data = await response.json();
          const bestMoveUci = data.pvs?.[0]?.moves?.split(' ')?.[0];
          if (bestMoveUci && bestMoveUci.length >= 4) {
            const from = bestMoveUci.slice(0, 2);
            const to = bestMoveUci.slice(2, 4);
            const promotion = bestMoveUci.length > 4 ? bestMoveUci[4] : undefined;
            move = game.move({ from, to, promotion });
          }
        }
        if (!move) {
          const randomMove = moves[Math.floor(Math.random() * moves.length)];
          move = game.move(randomMove);
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

      // Оценка позиции: только для Мастера (hard) - остальные уровни без задержки
      let evalAfter = currentEval;
      if (difficulty === 'hard') {
        const evalData = await getPositionEval(newFen);
        evalAfter = evalData.eval;
      }

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
