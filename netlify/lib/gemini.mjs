// Shared helpers for the AI Netlify Functions (Gemini API free tier).
// The API key lives only on the server (Netlify env var GEMINI_API_KEY), never in the browser.

export const MEALS = ['Breakfast', 'Morning snack', 'Lunch', 'Afternoon snack', 'Dinner'];

// Netlify buffers at most 6 MB per request; base64 adds ~33%, so raw files must stay under ~4 MB.
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/mpeg', 'video/x-m4v'];

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const num = (v, max) => Math.min(max, Math.max(0, Math.round((Number(v) || 0) * 100) / 100));

// One recipe as Gemini must return it (all values per ONE serving).
export const recipeProps = {
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
};
export const recipeRequired = ['name', 'category', 'emoji', 'cal', 'protein', 'carbs', 'fat', 'cost', 'minutes', 'ingredients', 'steps'];

export const UNITS_RULES = [
  'All quantities, calories and macros are for ONE serving. If the source states several servings, divide accordingly.',
  'Ingredient amounts in grams (liquids: 1 ml = 1 g); convert cups, spoons and pieces to grams.',
  'Use common supermarket ingredient names. Cost is an estimated average US grocery price per serving.',
  'Write the recipe in English, even if the source is in another language.',
];

// Cleans a recipe returned by Gemini; returns null if it is unusable.
export function cleanRecipe(r, fallbackCategory = 'Dinner') {
  const ingredients = (Array.isArray(r?.ingredients) ? r.ingredients : [])
    .map((i) => [String(i?.name || '').trim(), num(i?.grams, 5000)])
    .filter(([n]) => n)
    .slice(0, 30);
  if (!r?.name || !ingredients.length) return null;
  return {
    name: String(r.name).slice(0, 120),
    category: MEALS.includes(r.category) ? r.category : fallbackCategory,
    emoji: String(r.emoji || '🍽️').slice(0, 8),
    cal: Math.round(num(r.cal, 5000)),
    protein: Math.round(num(r.protein, 500)),
    carbs: Math.round(num(r.carbs, 1000)),
    fat: Math.round(num(r.fat, 500)),
    cost: num(r.cost, 100),
    minutes: Math.round(num(r.minutes, 1440)),
    ingredients,
    steps: String(r.steps || '').slice(0, 3000),
  };
}

// Turns any YouTube link (watch, youtu.be, shorts, embed, live) into the canonical watch URL.
export function youtubeUrl(raw) {
  const m = String(raw || '').trim().match(
    /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i,
  );
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : '';
}

// Validates an uploaded file sent as { mimeType, data: base64 } and returns a Gemini part, or an error string.
export function filePart(file, kinds) {
  const mimeType = String(file?.mimeType || '').toLowerCase();
  const data = String(file?.data || '').replace(/^data:[^,]*,/, '');
  const allowed = [...(kinds.includes('image') ? IMAGE_TYPES : []), ...(kinds.includes('video') ? VIDEO_TYPES : [])];
  if (!allowed.includes(mimeType)) return { error: 'Unsupported file type' };
  if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) return { error: 'File is empty or damaged' };
  if (Math.floor((data.length * 3) / 4) > MAX_FILE_BYTES) return { error: 'File is too large (max 4 MB)' };
  return { part: { inlineData: { mimeType, data } }, kind: mimeType.startsWith('video/') ? 'video' : 'image' };
}

// Models tried in order. "gemini-flash-latest" is Google's alias for the current Flash model, so the app
// keeps working when an older model is retired (a retired model answers 404 Not Found).
function modelList() {
  const list = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'];
  return [...new Set(list.map((m) => String(m || '').trim().replace(/^models\//, '')).filter(Boolean))];
}

// mode.thinkingOff: skip "thinking" so big answers (a whole week) stay within Netlify's time limit.
// mode.plain: no responseSchema (some models reject parts of it) — the schema is described in the prompt instead.
async function callModel(model, key, parts, schema, mode) {
  const contents = mode.plain
    ? [{ role: 'user', parts: [...parts, { text: `Answer ONLY with a JSON object that follows this JSON schema (no markdown, no comments):\n${JSON.stringify(schema)}` }] }]
    : [{ role: 'user', parts }];
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents,
      generationConfig: {
        responseMimeType: 'application/json',
        ...(mode.plain ? {} : { responseSchema: schema, temperature: 0.4 }),
        ...(mode.thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    }),
  });
}

// Google's own error text, e.g. {"error":{"message":"..."}} → "...".
const googleMessage = (detail) => {
  try { return String(JSON.parse(detail)?.error?.message || '').slice(0, 220); } catch { return String(detail || '').slice(0, 220); }
};

// Calls Gemini with structured JSON output. Returns { data } or { response } (an error Response to return as is).
export async function askGemini(parts, schema, { youtube = false, fast = false } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { response: json({ error: 'GEMINI_API_KEY is not configured on the server' }, 500) };

  let status = 0;
  let detail = '';
  let out = null;
  models: for (const model of modelList()) {
    // Request variants for this model, from the preferred one to the most compatible one.
    const modes = [
      ...(fast && /flash/.test(model) ? [{ thinkingOff: true }] : []),
      {},
      { plain: true },
    ];
    for (const mode of modes) {
      let res;
      try {
        res = await callModel(model, key, parts, schema, mode);
      } catch {
        return { response: json({ error: 'Could not reach the AI service' }, 502) };
      }
      status = res.status;
      if (res.ok) { out = await res.json(); break models; }
      detail = await res.text().catch(() => '');
      console.error(`Gemini ${model} ${JSON.stringify(mode)} → ${status}`, detail.slice(0, 500));
      if (status === 429 || status === 403 || (status === 400 && /API key/i.test(detail))) break models;
      if (status === 400 && youtube && /youtube|video|file|uri|url/i.test(detail)) break models;
      if (status !== 400) break; // 404 retired model, 500/503 overloaded → next model; 400 → next variant
    }
    if (status === 500 || status === 503) await new Promise((r) => setTimeout(r, 800));
  }

  if (!out) {
    const msg = googleMessage(detail);
    if (status === 429) return { response: json({ error: 'Free AI limit reached — try again in a minute' }, 429) };
    if (youtube && status === 400)
      return { response: json({ error: 'Could not open this YouTube video — it must be public' }, 400) };
    if (status === 400 && /API key/i.test(detail))
      return { response: json({ error: 'The Gemini API key is invalid — check GEMINI_API_KEY in Netlify' }, 502) };
    if (status === 403)
      return { response: json({ error: 'The Gemini API key has no access — create a new key in Google AI Studio' }, 502) };
    if (status === 404)
      return { response: json({ error: 'No available Gemini model found — set GEMINI_MODEL in Netlify (e.g. gemini-flash-latest)' }, 502) };
    if (status === 500 || status === 503)
      return { response: json({ error: 'Google AI is overloaded right now — please try again in a minute' }, 503) };
    return { response: json({ error: `AI service error (${status})${msg ? ': ' + msg : ''}` }, 502) };
  }

  const text = (out?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return { data: JSON.parse(jsonText) };
  } catch {
    const reason = out?.candidates?.[0]?.finishReason;
    console.error('Unreadable Gemini answer', reason, text.slice(0, 300));
    return { response: json({ error: reason === 'MAX_TOKENS' ? 'AI answer was cut off, please retry' : 'AI returned an unreadable answer, please retry' }, 502) };
  }
}
