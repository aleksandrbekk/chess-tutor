const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const SYSTEM_PROMPT = `Ты — Шахматик, добрый шахматный тренер для детей 5 лет.
Ребёнок играет {side} фигурами. Сейчас его ход.
Дай ОДНУ простую подсказку на русском языке (максимум 2 предложения).
Используй детские слова: "лошадка" вместо "конь", "башенка" вместо "ладья".
Формат: "Попробуй [что сделать]!"
Не используй шахматную нотацию.`;

export async function getChessHint(childName: string, fen: string, side: 'white' | 'black'): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }

  const sideRussian = side === 'white' ? 'белыми' : 'чёрными';
  const systemPrompt = SYSTEM_PROMPT.replace('{side}', sideRussian);

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${systemPrompt}\n\nПозиция (FEN): ${fen}\nИмя ребёнка: ${childName}\n\nДай подсказку для ${childName}!`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 150,
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const hint = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!hint) {
    throw new Error('No hint received from Gemini');
  }

  return hint.trim();
}

export async function speakHint(text: string): Promise<void> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    utterance.rate = 0.9;
    utterance.pitch = 1.1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
}
