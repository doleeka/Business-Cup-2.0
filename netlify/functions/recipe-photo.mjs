// Serverless function: finds a real food photo for a recipe on Unsplash (free API), so new recipes look
// like the built-in ones, whose photos also come from Unsplash.
// Request: { name, category?, ingredients?: [names] }  →  { url, author, authorUrl }
// Needs the Netlify env var UNSPLASH_ACCESS_KEY (free: unsplash.com/developers → New Application → Access Key).
import { json } from '../lib/gemini.mjs';

const clip = (v, n) => String(v || '').trim().slice(0, n);
const UTM = 'utm_source=nourishly&utm_medium=referral';
const FILLER = /\b(easy|quick|simple|healthy|homemade|classic|cozy|creamy|crispy|fluffy|budget|family|mini|best|perfect|style|with|and|&|the|a|of)\b/gi;

// Queries from most to least specific: the full name, the name without filler words, the main ingredients.
function queries(name, category, ingredients) {
  const short = name.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  const list = [name, short, ingredients.slice(0, 2).join(' '), `${category || ''} food`.trim()];
  return [...new Set(list.map((q) => q.toLowerCase()).filter((q) => q.length > 2))];
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return json({ error: 'UNSPLASH_ACCESS_KEY is not configured on the server' }, 500);

  let input;
  try { input = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const name = clip(input.name, 80);
  if (!name) return json({ error: 'Recipe name is required' }, 400);
  const category = clip(input.category, 30);
  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : []).slice(0, 5).map((x) => clip(x, 30)).filter(Boolean);
  const headers = { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' };

  for (const q of queries(name, category, ingredients)) {
    let res;
    try {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=10&orientation=landscape&content_filter=high`;
      res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    } catch {
      return json({ error: 'Could not reach Unsplash' }, 502);
    }
    if (res.status === 401) return json({ error: 'The Unsplash key is invalid — check UNSPLASH_ACCESS_KEY in Netlify' }, 502);
    if (res.status === 403 || res.status === 429) return json({ error: 'Unsplash photo limit reached — try again in an hour' }, 429);
    if (!res.ok) return json({ error: `Unsplash error (${res.status})` }, 502);

    const data = await res.json();
    // Results come ordered by relevance; take the most relevant one that looks like food.
    const photos = (data.results || []).filter((p) => p?.urls?.raw);
    const words = name.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const looksLikeFood = (p) => {
      const text = `${p.alt_description || ''} ${p.description || ''}`.toLowerCase();
      return /food|dish|meal|plate|bowl|breakfast|lunch|dinner|snack|cook|recipe/.test(text) || words.some((w) => text.includes(w));
    };
    const photo = photos.find(looksLikeFood) || photos[0];
    if (!photo) continue;

    // Unsplash API guidelines: report the use of a photo via its download endpoint.
    if (photo.links?.download_location) fetch(photo.links.download_location, { headers }).catch(() => {});

    return json({
      url: `${photo.urls.raw}&w=700&q=85&fit=crop&auto=format`,
      author: clip(photo.user?.name, 60) || 'Unsplash',
      authorUrl: `${photo.user?.links?.html || 'https://unsplash.com'}?${UTM}`,
      query: q,
    });
  }
  return json({ error: 'No matching photo found' }, 404);
};

export const config = { path: '/api/recipe-photo' };
