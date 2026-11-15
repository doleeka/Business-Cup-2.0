// Serverless function: the AI invents a week of affordable recipes for the family's budget.
// Request: { perServing, people, avoid?, likes?, notes?, wishes? }  →  { recipes: [...] }
// The browser then arranges them into the 7-day plan so the week fits the budget.
import { MEALS, json, num, askGemini, recipeProps, recipeRequired, cleanRecipe, UNITS_RULES } from '../lib/gemini.mjs';

// How many different dishes per meal type (rotated over 7 days).
const COUNTS = { Breakfast: 3, 'Morning snack': 2, Lunch: 3, 'Afternoon snack': 2, Dinner: 4 };

const schema = {
  type: 'OBJECT',
  properties: { recipes: { type: 'ARRAY', items: { type: 'OBJECT', properties: recipeProps, required: recipeRequired } } },
  required: ['recipes'],
};

const clip = (v, n) => String(v || '').trim().slice(0, n);

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let input;
  try { input = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const perServing = num(input.perServing, 100);
  const people = Math.max(1, Math.min(20, Math.round(Number(input.people) || 1)));
  if (!(perServing > 0)) return json({ error: 'Set a weekly budget first' }, 400);
  const avoid = clip(input.avoid, 300);
  const likes = clip(input.likes, 300);
  const notes = clip(input.notes, 300);
  const wishes = clip(input.wishes, 200);

  const plan = MEALS.map((m) => `${COUNTS[m]} × ${m}`).join(', ');
  const prompt = [
    `Plan a week of affordable family home cooking for ${people} people. Create exactly these different recipes: ${plan}.`,
    `BUDGET: the average cost per serving across a day of 5 meals must be at most $${perServing.toFixed(2)}; snacks and breakfasts should be cheaper, dinners may cost more. Never exceed $${(perServing * 2).toFixed(2)} for one serving.`,
    'Prefer cheap filling staples (grains, legumes, eggs, seasonal vegetables, frozen vegetables, chicken thighs) and reuse ingredients across recipes to reduce waste. Keep meals balanced and varied.',
    avoid ? `Do NOT use these ingredients (allergies/dislikes): ${avoid}.` : '',
    likes ? `The family likes: ${likes}.` : '',
    notes ? `Health notes to respect: ${notes}.` : '',
    wishes ? `Extra wishes: ${wishes}.` : '',
    ...UNITS_RULES,
    'Cost estimates must be realistic, not optimistic.',
  ].filter(Boolean).join('\n');

  const { data, response } = await askGemini([{ text: prompt }], schema, { fast: true });
  if (response) return response;

  const recipes = (Array.isArray(data.recipes) ? data.recipes : []).map((r) => cleanRecipe(r)).filter(Boolean).slice(0, 20);
  const missing = MEALS.filter((m) => !recipes.some((r) => r.category === m));
  if (recipes.length < 5 || missing.length) return json({ error: 'AI returned an incomplete week, please retry' }, 502);
  return json({ recipes });
};

export const config = { path: '/api/plan-week' };
