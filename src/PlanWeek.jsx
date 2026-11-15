import React, { useState } from 'react';
import { X, AlertCircle, Sparkles, Wallet, BookOpen } from 'lucide-react';
import { DAYS, MEALS } from './data';

const money = (n) => '$' + (Number(n) || 0).toFixed(2);

async function post(body) {
  const res = await fetch('/api/plan-week', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: 'Unexpected server response' }));
  if (!res.ok) throw new Error(data.error || 'Planning failed');
  return data;
}

// Modal: the AI plans the week from the family's recipe library (optionally adding a few new recipes first).
export default function PlanWeek({ family, recipes, weeklyLimit, onClose, onDone }) {
  const [wishes, setWishes] = useState('');
  const [addNew, setAddNew] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const loading = !!step;
  const people = family.length || 1;
  const perPersonWeek = weeklyLimit / people;
  const join = (f) => family.map((p) => p[f]).filter(Boolean).join(', ');
  const prefs = {
    people,
    avoid: [join('allergies'), join('dislikes')].filter(Boolean).join(', '),
    likes: join('likes'),
    notes: join('conditions'),
    wishes,
  };

  const run = async () => {
    if (!(perPersonWeek > 0)) return setError('Set a weekly budget in Profile first');
    setError('');
    try {
      let created = [];
      if (addNew) {
        setStep('Creating new budget recipes…');
        const { recipes: made } = await post({ mode: 'create', perServing: perPersonWeek / 35, count: 5, existing: recipes.map((r) => r.name), ...prefs });
        const stamp = Date.now();
        created = made.map((r, i) => ({ ...r, id: `ai${stamp}-${i}`, image: '', source: 'ai' }));
      }
      const pool = [...recipes, ...created];
      setStep(`Choosing from your ${pool.length} recipes…`);
      const { days, note } = await post({
        mode: 'library',
        perPersonWeek,
        recipes: pool.map((r) => ({ id: r.id, name: r.name, category: r.category, cost: r.cost, cal: r.cal, protein: r.protein, tags: r.tags, ingredients: r.ingredients.map((x) => x[0]) })),
        ...prefs,
      });
      const plan = {};
      days.slice(0, DAYS.length).forEach((d, i) => MEALS.forEach((m, j) => { if (d[m]) plan[`${i}-${j}`] = d[m]; }));
      onDone({ plan, created, note });
    } catch (e) {
      setError(e.message);
      setStep('');
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="modal form-modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">AI BUDGET WEEK</span>
            <h2>Plan a week you can afford</h2>
            <p>AI builds all 35 meals from your recipe library so the week fits your budget. Allergies, dislikes and likes from Profile are taken into account.</p>
          </div>
          <button className="close" disabled={loading} onClick={onClose}><X size={22} /></button>
        </div>
        <div className="form-fields">
          <div className="plan-budget">
            <span className="ai-tile-icon"><Wallet size={20} /></span>
            <div>
              <b>{money(weeklyLimit)} / week for {people} {people === 1 ? 'person' : 'people'}</b>
              <small>{recipes.length} recipes in your library · change the budget in Profile</small>
            </div>
          </div>
          <label>Any wishes? (optional)
            <input value={wishes} maxLength={200} disabled={loading} placeholder="e.g. more soups, quick dinners, fish twice a week" onChange={(e) => setWishes(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !loading) run(); }} />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={addNew} disabled={loading} onChange={(e) => setAddNew(e.target.checked)} />
            <span><b>Also add 5 new budget recipes</b><small>For more variety. They are saved to Recipes in the same style as the rest.</small></span>
          </label>
          {loading && <div className="plan-progress"><span /> {step}</div>}
          {error && <div className="allergy-warning"><AlertCircle size={16} /> {error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn secondary" disabled={loading} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={loading} onClick={run}>{loading ? 'Planning…' : <>{addNew ? <Sparkles size={16} /> : <BookOpen size={16} />} Plan my week</>}</button>
        </div>
      </div>
    </div>
  );
}
