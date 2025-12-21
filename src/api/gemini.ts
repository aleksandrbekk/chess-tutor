// Gemini 2.0 Flash для текстового анализа (голос через useGeminiLive)
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const TUTOR_SYSTEM = `Ты профессиональный шахматный тренер. После каждого хода ученика дай короткий комментарий (1-2 предложения). Используй правильные термины: конь, слон, ладья, ферзь. Можешь использовать нотацию (e4, Кf3). Если ход хороший — похвали и объясни почему. Если ошибка — скажи какой ход был лучше и почему. Если есть тактика — укажи на неё. Говори кратко и по делу.`;

// Types
export interface MoveAnalysis {
  evaluation: number;
  bestMove: string | null;
  isBlunder: boolean;
  isMistake: boolean;
  tacticalMotif: string | null;
  comment: string;
}

export interface ChatMessage {
  role: 'user' | 'tutor';
  text: string;
  timestamp: number;
}

// Lichess cloud eval
export async function getPositionEval(fen: string): Promise<{ eval: number; bestMove: string | null }> {
  try {
    const response = await fetch(
      `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=1`
    );
    if (!response.ok) return { eval: 0, bestMove: null };

    const data = await response.json();
    const pv = data.pvs?.[0];
    if (!pv) return { eval: 0, bestMove: null };

    let evaluation = 0;
    if (pv.mate !== undefined) {
      evaluation = pv.mate > 0 ? 100 : -100;
    } else if (pv.cp !== undefined) {
      evaluation = pv.cp / 100;
    }

    const bestMove = pv.moves?.split(' ')?.[0] || null;
    return { eval: evaluation, bestMove };
  } catch {
    return { eval: 0, bestMove: null };
  }
}

// Gemini API для текстовых запросов
async function callGemini(prompt: string, maxTokens: number = 200): Promise<string | null> {
  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens }
      })
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch {
    return null;
  }
}

// Analyze move with Gemini (текстовый анализ)
export async function analyzeMoveWithAI(
  childName: string,
  fen: string,
  move: string,
  evalBefore: number,
  evalAfter: number,
  bestMove: string | null,
  isPlayerMove: boolean
): Promise<MoveAnalysis> {
  const evalDiff = isPlayerMove ? evalBefore - evalAfter : evalAfter - evalBefore;
  const isBlunder = evalDiff >= 2;
  const isMistake = evalDiff >= 1 && evalDiff < 2;
  let tacticalMotif: string | null = null;

  const prompt = `${TUTOR_SYSTEM}

Позиция FEN: ${fen}
${childName} сыграл: ${move}
Оценка до: ${evalBefore > 0 ? '+' : ''}${evalBefore.toFixed(1)}
Оценка после: ${evalAfter > 0 ? '+' : ''}${evalAfter.toFixed(1)}
${bestMove ? `Лучший ход был: ${bestMove}` : ''}
${isBlunder ? 'Это ЗЕВОК — серьёзная ошибка!' : isMistake ? 'Это неточность.' : 'Ход нормальный.'}

Дай голосовой комментарий для ученика (1-2 предложения).`;

  const comment = await callGemini(prompt, 100) ||
    (isBlunder ? `Ой, зевок! Лучше было ${bestMove || 'другой ход'}.` :
     isMistake ? 'Небольшая неточность, но продолжаем.' :
     'Хороший ход!');

  const lowerComment = comment.toLowerCase();
  if (lowerComment.includes('вилка')) tacticalMotif = 'вилка';
  else if (lowerComment.includes('связка')) tacticalMotif = 'связка';
  else if (lowerComment.includes('мат')) tacticalMotif = 'мат';
  else if (lowerComment.includes('двойной удар')) tacticalMotif = 'двойной удар';

  return { evaluation: evalAfter, bestMove, isBlunder, isMistake, tacticalMotif, comment };
}

// Ask tutor in chat (текстовый ответ, голос через Gemini Live)
export async function askTutor(childName: string, question: string, fen: string, moveHistory: string[]): Promise<string> {
  const historyStr = moveHistory.length > 0 ? `История ходов: ${moveHistory.slice(-10).join(' ')}` : '';
  const prompt = `${TUTOR_SYSTEM}

Позиция: ${fen}
${historyStr}

Вопрос от ${childName}: "${question}"

Ответь кратко (1-2 предложения).`;

  return await callGemini(prompt, 120) || 'Хороший вопрос! Попробуй сформулировать иначе.';
}

// Get greeting
export async function getGreeting(childName: string): Promise<string> {
  const prompt = `${TUTOR_SYSTEM}

${childName} начинает тренировку. Поприветствуй коротко (1 предложение).`;

  return await callGemini(prompt, 50) || `Привет, ${childName}! Начнём партию.`;
}

// Analyze full game
export async function analyzeGame(
  childName: string,
  moveHistory: { move: string; fen: string; eval: number; isBlunder: boolean }[],
  playerSide: 'white' | 'black',
  result: string
): Promise<string> {
  const blunders = moveHistory.filter(m => m.isBlunder).length;
  const movesStr = moveHistory.slice(0, 20).map((m, i) => `${i + 1}.${m.move}`).join(' ');

  const prompt = `${TUTOR_SYSTEM}

Анализ партии ${childName} (${playerSide === 'white' ? 'белые' : 'чёрные'}).
Результат: ${result}
Зевков: ${blunders}
Ходы: ${movesStr}

Дай краткий итог партии (2 предложения).`;

  return await callGemini(prompt, 100) || 'Хорошая партия! Продолжай тренироваться.';
}

// Голосовые функции теперь в useGeminiLive хуке
