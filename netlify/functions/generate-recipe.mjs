// Serverless function: builds a recipe with the Gemini API free tier from
//  - a dish name                         { dish, category?, avoid? }
//  - a screenshot / photo                { image: { mimeType, data } }
//  - a YouTube link                      { youtube: "https://..." }
//  - a short uploaded video (TikTok/Reel) { video: { mimeType, data } }
import { MEALS, json, num, youtubeUrl, filePart, askGemini } from '../lib/gemini.mjs';

const schema = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN', description: 'false if the media shows no food, dish or recipe' },
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
  required: ['found', 'name', 'category', 'emoji', 'cal', 'protein', 'carbs', 'fat', 'cost', 'minutes', 'ingredients', 'steps'],
};

const COMMON = [
  'All quantities, calories and macros are for ONE serving. If the source states several servings, divide accordingly.',
  'Ingredient amounts in grams (liquids: 1 ml = 1 g); convert cups, spoons and pieces to grams.',
  'Use common supermarket ingredient names. Cost is an estimated average US grocery price per serving.',
  'Write the recipe in English, even if the source is in another language.',
];

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let input;
  try { input = await req.json(); } catch { return json({ error: 'Invalid JSON or file too large' }, 400); }
  const category = MEALS.includes(input.category) ? input.category : '';
  const categoryLine = category ? `Meal category: ${category}.` : 'Pick the most fitting meal category.';

  let parts;
  let source = 'dish';
  if (input.image || input.video) {
    const f = filePart(input.image || input.video, input.image ? ['image'] : ['video']);
    if (f.error) return json({ error: f.error }, 400);
    source = f.kind;
    const task = f.kind === 'image'
      ? 'This image is a screenshot of a recipe (social post, website, cookbook page) or a photo of a dish. Extract the recipe exactly as written; if only the dish is shown, recreate a realistic recipe for it.'
      : 'This is a cooking video (e.g. a TikTok or Instagram Reel). Watch it, read any on-screen text and listen to the narration, and write down the recipe it shows.';
    parts = [f.part, { text: [task, 'If there is no food or recipe at all, set found=false.', categoryLine, ...COMMON].join('\n') }];
  } else if (input.youtube) {
    const url = youtubeUrl(input.youtube);
    if (!url) return json({ error: 'Paste a YouTube link (youtube.com or youtu.be)' }, 400);
    source = 'youtube';
    parts = [
      { fileData: { fileUri: url } },
      { text: ['This is a cooking video. Watch it, read on-screen text and the narration, and write down the recipe it shows.', 'If the video is not about cooking, set found=false.', categoryLine, ...COMMON].join('\n') },
    ];
  } else {
    const dish = String(input.dish || '').trim().slice(0, 120);
    const avoid = String(input.avoid || '').trim().slice(0, 300);
    if (!dish) return json({ error: 'Enter a dish name' }, 400);
    parts = [{
      text: [
        `Create a realistic home-cooking recipe for: "${dish}". Set found=true.`,
        categoryLine,
        avoid ? `Do NOT use these ingredients (family allergies/dislikes): ${avoid}.` : '',
        ...COMMON,
      ].filter(Boolean).join('\n'),
    }];
  }

  const { data: r, response } = await askGemini(parts, schema, { youtube: source === 'youtube' });
  if (response) return response;

  if (r.found === false) {
    return json({ error: source === 'dish' ? 'AI could not build this recipe, try another name' : 'No recipe or dish found here — try another file or link' }, 422);
  }
  const ingredients = (Array.isArray(r.ingredients) ? r.ingredients : [])
    .map((i) => [String(i?.name || '').trim(), num(i?.grams, 5000)])
    .filter(([n]) => n)
    .slice(0, 30);
  if (!r.name || !ingredients.length) return json({ error: 'AI could not build this recipe, please retry' }, 502);

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
