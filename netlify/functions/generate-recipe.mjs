// Serverless function: generates a recipe from a dish name using the Gemini API free tier.
// The API key lives only on the server (Netlify env var GEMINI_API_KEY), never in the browser.

const MEALS = ['Breakfast', 'Morning snack', 'Lunch', 'Afternoon snack', 'Dinner'];
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const schema = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    category: { type: 'STRING', enum: MEALS },
    emoji: { type: 'STRING', description: 'One food emoji' },
    cal: { type: 'NUMBER', description: 'kcal per serving' },
    protein: { type: 'NUMBER', description: 'grams per serving' },
    carbs: { type: 'NUMBER', description: 'grams per serving' },
    fat: { type: 'NUMBER', description: 'grams per serving' },
    cost: { type: 'NUMBER', description: 'estimated USD per serving' },
    minutes: { type: 'NUMBER', description: 'total cooking time' },
    ingredients: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, grams: { type: 'NUMBER', description: 'grams per serving' } },
        required: ['name', 'grams'],
      },
    },
    steps: { type: 'STRING', description: 'Short cooking instructions, 2-6 sentences' },
  },
  required: ['name', 'category', 'emoji', 'cal', 'protein', 'carbs', 'fat', 'cost', 'minutes', 'ingredients', 'steps'],
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const num = (v, max) => Math.min(max, Math.max(0, Math.round((Number(v) || 0) * 100) / 100));

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json({ error: 'GEMINI_API_KEY is not configured on the server' }, 500);

  let input;
  try { input = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const dish = String(input.dish || '').trim().slice(0, 120);
  const category = MEALS.includes(input.category) ? input.category : '';
  const avoid = String(input.avoid || '').trim().slice(0, 300);
  if (!dish) return json({ error: 'Enter a dish name' }, 400);

  const prompt = [
    `Create a realistic home-cooking recipe for: "${dish}".`,
    category ? `Meal category: ${category}.` : 'Pick the most fitting meal category.',
    avoid ? `Do NOT use these ingredients (family allergies/dislikes): ${avoid}.` : '',
    'All quantities, calories and macros are for ONE serving. Ingredient amounts in grams (liquids: 1 ml = 1 g).',
    'Use common supermarket ingredient names. Cost is an estimated average US grocery price per serving.',
    'Write the recipe in English, even if the dish name is in another language.',
  ].filter(Boolean).join('\n');

  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.7 },
      }),
    });
  } catch {
    return json({ error: 'Could not reach the AI service' }, 502);
  }

  if (res.status === 429) return json({ error: 'Free AI limit reached — try again in a minute' }, 429);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Gemini error', res.status, detail);
    return json({ error: `AI service error (${res.status})` }, 502);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let r;
  try { r = JSON.parse(text); } catch { return json({ error: 'AI returned an unreadable answer, please retry' }, 502); }

  const ingredients = (Array.isArray(r.ingredients) ? r.ingredients : [])
    .map((i) => [String(i?.name || '').trim(), num(i?.grams, 5000)])
    .filter(([n]) => n)
    .slice(0, 30);
  if (!r.name || !ingredients.length) return json({ error: 'AI could not build this recipe, try another name' }, 502);

  return json({
    name: String(r.name).slice(0, 120),
    category: MEALS.includes(r.category) ? r.category : category || 'Dinner',
    emoji: String(r.emoji || '🍽️').slice(0, 8),
    cal: Math.round(num(r.cal, 5000)),
    protein: Math.round(num(r.protein, 500)),
    carbs: Math.round(num(r.carbs, 1000)),
    fat: Math.round(num(r.fat, 500)),
    cost: num(r.cost, 100),
    minutes: Math.round(num(r.minutes, 1440)),
    ingredients,
    steps: String(r.steps || '').slice(0, 3000),
  });
};

export const config = { path: '/api/generate-recipe' };
