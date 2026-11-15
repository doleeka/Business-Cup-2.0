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

// Calls Gemini with structured JSON output. Returns { data } or { response } (an error Response to return as is).
export async function askGemini(parts, schema, { youtube = false } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { response: json({ error: 'GEMINI_API_KEY is not configured on the server' }, 500) };
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.4 },
      }),
    });
  } catch {
    return { response: json({ error: 'Could not reach the AI service' }, 502) };
  }

  if (res.status === 429) return { response: json({ error: 'Free AI limit reached — try again in a minute' }, 429) };
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Gemini error', res.status, detail);
    if (youtube && res.status === 400)
      return { response: json({ error: 'Could not open this YouTube video — it must be public' }, 400) };
    return { response: json({ error: `AI service error (${res.status})` }, 502) };
  }

  const out = await res.json();
  const text = out?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { response: json({ error: 'AI returned an unreadable answer, please retry' }, 502) };
  }
}
