// Serverless function: AI meal planning for the family's budget.
//
// mode "library" (default): the AI builds the 7-day plan ONLY from the recipes the app already has.
//   Request:  { mode: 'library', recipes: [{ id, name, category, cost, cal, protein, tags, ingredients }], perPersonWeek, people, avoid?, likes?, notes?, wishes? }
//   Response: { days: [{ Breakfast: id, 'Morning snack': id, Lunch: id, 'Afternoon snack': id, Dinner: id } × 7], note }
//
// mode "create": the AI invents a few new budget recipes in the same format and tags as the library.
//   Request:  { mode: 'create', perServing, people, count?, existing?: [names], avoid?, likes?, notes?, wishes? }
//   Response: { recipes: [...] }
import { MEALS, json, num, askGemini, recipeProps, recipeRequired, cleanRecipe, UNITS_RULES } from '../lib/gemini.mjs';

// Same tags the built-in recipes use, so new recipes look and filter like the rest of the library.
const TAGS = ['Vegetarian', 'Meal prep', 'Quick', 'High protein', 'Budget friendly', 'Family favorite'];

const clip = (v, n) => String(v || '').trim().slice(0, n);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function familyLines(input) {
  const avoid = clip(input.avoid, 300);
  const likes = clip(input.likes, 300);
  const notes = clip(input.notes, 300);
  const wishes = clip(input.wishes, 200);
  return [
    avoid ? `NEVER use recipes/ingredients the family must avoid (allergies/dislikes): ${avoid}.` : '',
    likes ? `The family likes: ${likes}.` : '',
    notes ? `Health notes to respect: ${notes}.` : '',
    wishes ? `Extra wishes: ${wishes}.` : '',
  ].filter(Boolean);
}

async function planFromLibrary(input) {
  const people = Math.max(1, Math.min(20, Math.round(Number(input.people) || 1)));
  const perPersonWeek = num(input.perPersonWeek, 10000);
  if (!(perPersonWeek > 0)) return json({ error: 'Set a weekly budget first' }, 400);

  const recipes = (Array.isArray(input.recipes) ? input.recipes : [])
    .slice(0, 150)
    .map((r) => ({
      id: clip(r.id, 60),
      name: clip(r.name, 80),
      category: MEALS.includes(r.category) ? r.category : '',
      cost: num(r.cost, 100),
      cal: Math.round(num(r.cal, 5000)),
      protein: Math.round(num(r.protein, 500)),
      tags: (Array.isArray(r.tags) ? r.tags : []).slice(0, 4).map((t) => clip(t, 20)),
      ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).slice(0, 12).map((x) => clip(x, 30)),
    }))
    .filter((r) => r.id && r.name && r.category);

  const byMeal = Object.fromEntries(MEALS.map((m) => [m, recipes.filter((r) => r.category === m)]));
  const missing = MEALS.filter((m) => !byMeal[m].length);
  if (missing.length) return json({ error: `No recipes for: ${missing.join(', ')}. Add some first.` }, 400);

  // Each meal slot may only contain ids of that meal type — the schema enforces valid choices.
  const day = { type: 'OBJECT', properties: Object.fromEntries(MEALS.map((m) => [m, { type: 'STRING', enum: byMeal[m].map((r) => r.id) }])), required: MEALS };
  const schema = {
    type: 'OBJECT',
    properties: {
      days: { type: 'ARRAY', items: day, description: '7 days, Monday to Sunday' },
      note: { type: 'STRING', description: 'One short friendly sentence about the plan' },
    },
    required: ['days', 'note'],
  };

  const list = recipes
    .map((r) => `- ${r.id} | ${r.category} | ${r.name} | $${r.cost.toFixed(2)}/serving | ${r.cal} kcal, ${r.protein} g protein | ${r.tags.join(', ')} | ${r.ingredients.join(', ')}`)
    .join('\n');
  const prompt = [
    `Build a 7-day meal plan (${DAYS.join(', ')}) for a family of ${people}, using ONLY recipes from this list (refer to them by id):`,
    list,
    '',
    `BUDGET: the sum of the per-serving costs of all 35 meals must be at most $${perPersonWeek.toFixed(2)} (this is the weekly budget per person). Stay under it; if it is impossible, get as close as possible.`,
    'Make the week varied and balanced: avoid the same dish two days in a row where possible, mix cheaper and more filling meals, and prefer dishes the family likes.',
    ...familyLines(input),
  ].join('\n');

  const { data, response } = await askGemini([{ text: prompt }], schema);
  if (response) return response;

  const days = (Array.isArray(data.days) ? data.days : []).slice(0, 7).map((d) =>
    Object.fromEntries(MEALS.map((m) => [m, byMeal[m].some((r) => r.id === d?.[m]) ? d[m] : null])),
  );
  if (days.length < 7) return json({ error: 'AI returned an incomplete week, please retry' }, 502);
  return json({ days, note: clip(data.note, 240) });
}

async function createRecipes(input) {
  const perServing = num(input.perServing, 100);
  const people = Math.max(1, Math.min(20, Math.round(Number(input.people) || 1)));
  if (!(perServing > 0)) return json({ error: 'Set a weekly budget first' }, 400);
  const count = Math.max(3, Math.min(10, Math.round(Number(input.count) || 5)));
  const existing = (Array.isArray(input.existing) ? input.existing : []).slice(0, 150).map((n) => clip(n, 60)).filter(Boolean);

  const schema = {
    type: 'OBJECT',
    properties: {
      recipes: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { ...recipeProps, tags: { type: 'ARRAY', items: { type: 'STRING', enum: TAGS }, description: '1-2 tags' } },
          required: [...recipeRequired, 'tags'],
        },
      },
    },
    required: ['recipes'],
  };
  const prompt = [
    `Create ${count} NEW affordable home-cooking recipes for a family of ${people}, spread across these meal types: ${MEALS.join(', ')} (at least one Dinner and one Breakfast).`,
    existing.length ? `They must be different from the recipes the family already has: ${existing.join('; ')}.` : '',
    `BUDGET: about $${perServing.toFixed(2)} per serving on average; snacks and breakfasts cheaper, dinners may cost up to $${(perServing * 2).toFixed(2)}.`,
    'Match the style of a modern family recipe app: short appetizing English names (2-5 words, like "Lemon chicken rice bowls" or "Cozy lentil veggie soup"), one fitting food emoji, 3-8 common ingredients, 2-4 short steps, 1-2 tags.',
    'Prefer cheap filling staples (grains, legumes, eggs, seasonal and frozen vegetables, chicken thighs).',
    ...familyLines(input),
    ...UNITS_RULES,
    'Cost estimates must be realistic, not optimistic.',
  ].filter(Boolean).join('\n');

  const { data, response } = await askGemini([{ text: prompt }], schema);
  if (response) return response;
  const recipes = (Array.isArray(data.recipes) ? data.recipes : [])
    .map((r) => {
      const c = cleanRecipe(r);
      if (!c) return null;
      const tags = [...new Set((Array.isArray(r.tags) ? r.tags : []).filter((t) => TAGS.includes(t)))].slice(0, 2);
      return { ...c, tags: tags.length ? tags : ['Budget friendly'] };
    })
    .filter(Boolean)
    .slice(0, count);
  if (!recipes.length) return json({ error: 'AI could not create recipes, please retry' }, 502);
  return json({ recipes });
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let input;
  try { input = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  return input.mode === 'create' ? createRecipes(input) : planFromLibrary(input);
};

export const config = { path: '/api/plan-week' };
