// Serverless function: builds a recipe with the Gemini API free tier from
//  - a dish name                         { dish, category?, avoid? }
//  - a screenshot / photo                { image: { mimeType, data } }
//  - a YouTube link                      { youtube: "https://..." }
//  - a short uploaded video (TikTok/Reel) { video: { mimeType, data } }
import { MEALS, json, youtubeUrl, filePart, askGemini, recipeProps, recipeRequired, cleanRecipe, UNITS_RULES as COMMON } from '../lib/gemini.mjs';

const schema = {
  type: 'OBJECT',
  properties: { found: { type: 'BOOLEAN', description: 'false if the media shows no food, dish or recipe' }, ...recipeProps },
  required: ['found', ...recipeRequired],
};

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
  const recipe = cleanRecipe(r, category || 'Dinner');
  if (!recipe) return json({ error: 'AI could not build this recipe, please retry' }, 502);
  return json(recipe);
};

export const config = { path: '/api/generate-recipe' };
