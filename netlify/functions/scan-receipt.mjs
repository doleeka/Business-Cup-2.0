// Serverless function: reads a grocery receipt photo with the Gemini API free tier.
// Request: { image: { mimeType, data } }  →  { store, date, total, currency, items }
import { json, num, filePart, askGemini } from '../lib/gemini.mjs';

const schema = {
  type: 'OBJECT',
  properties: {
    isReceipt: { type: 'BOOLEAN', description: 'false if the image is not a shop receipt' },
    store: { type: 'STRING' },
    date: { type: 'STRING', description: 'YYYY-MM-DD if visible, else empty' },
    total: { type: 'NUMBER', description: 'final amount paid' },
    currency: { type: 'STRING', description: 'ISO code, e.g. USD, KZT, EUR' },
    items: { type: 'NUMBER', description: 'number of purchased lines' },
  },
  required: ['isReceipt', 'store', 'date', 'total', 'currency', 'items'],
};

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let input;
  try { input = await req.json(); } catch { return json({ error: 'Invalid JSON or file too large' }, 400); }
  const f = filePart(input.image, ['image']);
  if (f.error) return json({ error: f.error }, 400);

  const { data: r, response } = await askGemini([
    f.part,
    { text: 'Read this shop receipt. Return the store name, date, the FINAL total actually paid (after discounts, including tax), its currency and the number of purchased lines. If this is not a receipt, set isReceipt=false.' },
  ], schema);
  if (response) return response;
  if (!r.isReceipt || !(Number(r.total) > 0)) return json({ error: 'Could not find a receipt total in this photo' }, 422);

  return json({
    store: String(r.store || '').slice(0, 80),
    date: String(r.date || '').slice(0, 10),
    total: num(r.total, 10000000),
    currency: String(r.currency || 'USD').toUpperCase().slice(0, 3),
    items: Math.round(num(r.items, 1000)),
  });
};

export const config = { path: '/api/scan-receipt' };
