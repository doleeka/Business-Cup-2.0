import React, { useEffect, useState } from 'react';
import { X, AlertCircle, Sparkles, Upload, Link, Camera, Video, Receipt, ArrowRight } from 'lucide-react';

// The server accepts at most ~4 MB per file (Netlify request limit); images are shrunk in the browser first.
const MAX_BYTES = 4 * 1024 * 1024;

const readBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(blob);
  });

// Resizes a photo/screenshot to max 1600 px JPEG (keeps text readable, keeps uploads small).
async function prepareImage(file) {
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    return { mimeType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] };
  } catch {
    // The browser cannot decode it (e.g. HEIC in Chrome) — send the original if it is small enough.
    if (file.size > MAX_BYTES) throw new Error('Image is too large (max 4 MB)');
    return { mimeType: file.type || 'image/jpeg', data: await readBase64(file) };
  }
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: res.status === 413 ? 'File is too large' : 'Unexpected server response' }));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const TEXT = {
  screenshot: {
    icon: Camera,
    eyebrow: 'SCREENSHOT TO RECIPE',
    title: 'Turn a screenshot into a recipe',
    hint: 'Upload a screenshot of a recipe post, website or cookbook page — or a photo of a dish. AI fills in the recipe form; you review it before saving.',
  },
  video: {
    icon: Video,
    eyebrow: 'VIDEO TO RECIPE',
    title: 'Turn a cooking video into a recipe',
    hint: 'Paste a YouTube or Shorts link, or upload a short video file (TikTok / Reels, up to 4 MB ≈ 15–30 s). AI watches it and drafts the recipe.',
  },
  receipt: {
    icon: Receipt,
    eyebrow: 'RECEIPT SCANNER',
    title: 'Scan your grocery receipt',
    hint: 'Upload a clear photo of the receipt. AI reads the total; you confirm it before it is added to your expenses.',
  },
};

export default function MediaImport({ kind, onClose, onRecipe, onReceipt }) {
  const t = TEXT[kind];
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const isVideo = f.type.startsWith('video/');
    if (kind === 'video' ? !isVideo : !f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name))
      return setError(kind === 'video' ? 'Choose a video file' : 'Choose an image file');
    if (isVideo && f.size > MAX_BYTES)
      return setError(`Video is ${(f.size / 1048576).toFixed(1)} MB — max 4 MB. Trim it, or use a YouTube link.`);
    setError('');
    setLink('');
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const run = async () => {
    if (!file && !link.trim()) return setError(kind === 'video' ? 'Paste a YouTube link or choose a video file' : 'Choose a photo first');
    setLoading(true);
    setError('');
    try {
      if (kind === 'receipt') {
        const r = await post('/api/scan-receipt', { image: await prepareImage(file) });
        setReceipt({ ...r, amount: String(r.total) });
      } else if (kind === 'screenshot') {
        onRecipe(await post('/api/generate-recipe', { image: await prepareImage(file) }));
      } else if (file) {
        onRecipe(await post('/api/generate-recipe', { video: { mimeType: file.type || 'video/mp4', data: await readBase64(file) } }));
      } else {
        onRecipe(await post('/api/generate-recipe', { youtube: link.trim() }));
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const saveReceipt = () => {
    const n = Number(receipt.amount);
    if (!(n > 0)) return setError('Enter an amount above zero');
    onReceipt(Math.round(n * 100) / 100);
  };

  const Icon = t.icon;
  const busyText = kind === 'video' ? 'Watching the video… (up to a minute)' : kind === 'receipt' ? 'Reading the receipt…' : 'Reading the screenshot…';

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="modal form-modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">{t.eyebrow}</span>
            <h2>{t.title}</h2>
            <p>{t.hint}</p>
          </div>
          <button className="close" disabled={loading} onClick={onClose}><X size={22} /></button>
        </div>
        <div className="form-fields">
          {receipt ? (
            <div className="media-result">
              <p><b>{receipt.store || 'Receipt'}</b>{receipt.date && ` · ${receipt.date}`}{receipt.items > 0 && ` · ${receipt.items} items`}</p>
              <p>Total found: <b>{receipt.total} {receipt.currency}</b></p>
              {receipt.currency !== 'USD' && (
                <div className="allergy-warning"><AlertCircle size={16} /> Expenses in this app are tracked in $. Convert the amount below if needed.</div>
              )}
              <label>Amount to add ($)<input type="number" min="0" step="0.01" value={receipt.amount} onChange={(e) => setReceipt((r) => ({ ...r, amount: e.target.value }))} /></label>
            </div>
          ) : (
            <>
              {kind === 'video' && (
                <label>YouTube link
                  <input value={link} disabled={loading} placeholder="https://youtube.com/shorts/…" onChange={(e) => { setLink(e.target.value); if (e.target.value) { setFile(null); setPreview(''); } }} />
                </label>
              )}
              <label className="media-drop">
                <input type="file" hidden disabled={loading} accept={kind === 'video' ? 'video/*' : 'image/*,.heic,.heif'} onChange={pick} />
                {preview && file?.type.startsWith('video/') ? (
                  <video src={preview} muted playsInline controls className="media-preview" />
                ) : preview && file?.type.startsWith('image/') && !/hei[cf]/i.test(file.type) ? (
                  <img src={preview} alt="" className="media-preview" />
                ) : (
                  <span className="media-placeholder"><Icon size={26} /></span>
                )}
                <span><Upload size={15} /> {file ? `${file.name} — choose another` : kind === 'video' ? 'or upload a video file (max 4 MB)' : 'Choose a photo'}</span>
              </label>
              {kind === 'video' && <p className="media-note"><Link size={13} /> TikTok and Instagram links can't be read directly — save the video and upload the file.</p>}
            </>
          )}
          {error && <div className="allergy-warning"><AlertCircle size={16} /> {error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn secondary" disabled={loading} onClick={receipt ? () => setReceipt(null) : onClose}>{receipt ? 'Back' : 'Cancel'}</button>
          {receipt ? (
            <button className="btn primary" onClick={saveReceipt}>Add expense <ArrowRight size={16} /></button>
          ) : (
            <button className="btn primary" disabled={loading} onClick={run}>{loading ? busyText : <><Sparkles size={16} /> {kind === 'receipt' ? 'Scan receipt' : 'Create recipe'}</>}</button>
          )}
        </div>
      </div>
    </div>
  );
}
