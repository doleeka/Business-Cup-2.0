import React, { useState } from 'react';
import { X, AlertCircle, Sparkles, Wallet } from 'lucide-react';

const money = (n) => '$' + (Number(n) || 0).toFixed(2);

// Modal: the AI invents a week of affordable recipes for the family's budget.
export default function PlanWeek({ family, weeklyLimit, onClose, onDone }) {
  const [wishes, setWishes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const people = family.length || 1;
  const perServing = weeklyLimit / people / 35; // 7 days × 5 meals
  const join = (f) => family.map((p) => p[f]).filter(Boolean).join(', ');

  const run = async () => {
    if (!(perServing > 0)) return setError('Set a weekly budget in Profile first');
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/plan-week', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          perServing: Math.round(perServing * 100) / 100,
          people,
          avoid: [join('allergies'), join('dislikes')].filter(Boolean).join(', '),
          likes: join('likes'),
          notes: join('conditions'),
          wishes,
        }),
      });
      const data = await res.json().catch(() => ({ error: 'Unexpected server response' }));
      if (!res.ok) throw new Error(data.error || 'Planning failed');
      onDone(data.recipes);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="modal form-modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">AI BUDGET WEEK</span>
            <h2>Plan a week you can afford</h2>
            <p>AI creates 14 new budget-friendly recipes for your family and fills all 35 meals so the week fits your budget. Allergies, dislikes and likes from Profile are taken into account.</p>
          </div>
          <button className="close" disabled={loading} onClick={onClose}><X size={22} /></button>
        </div>
        <div className="form-fields">
          <div className="plan-budget">
            <span className="ai-tile-icon"><Wallet size={20} /></span>
            <div>
              <b>{money(weeklyLimit)} / week for {people} {people === 1 ? 'person' : 'people'}</b>
              <small>≈ {money(perServing)} per serving · change it in Profile</small>
            </div>
          </div>
          <label>Any wishes? (optional)
            <input value={wishes} maxLength={200} disabled={loading} placeholder="e.g. more soups, quick dinners, Kazakh cuisine, halal" onChange={(e) => setWishes(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !loading) run(); }} />
          </label>
          {loading && <div className="plan-progress"><span /> AI is planning your week — this takes about 20–40 seconds…</div>}
          {error && <div className="allergy-warning"><AlertCircle size={16} /> {error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn secondary" disabled={loading} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={loading} onClick={run}>{loading ? 'Planning…' : <><Sparkles size={16} /> Create my week</>}</button>
        </div>
      </div>
    </div>
  );
}
