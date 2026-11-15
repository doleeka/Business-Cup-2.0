// Budget planner: fills the 7×5 weekly plan from a pool of recipes so the week fits the budget.
// Pure function, no AI — runs instantly in the browser.
import { DAYS, MEALS } from './data.js';

const words = (s) => String(s || '').toLowerCase().split(/[,;\n]/).map((x) => x.trim()).filter((x) => x.length >= 3);
const text = (r) => (r.name + ' ' + r.ingredients.map((x) => x[0]).join(' ')).toLowerCase();

/**
 * @param recipes   all recipes the plan may use
 * @param family    family members (allergies, dislikes, likes are respected)
 * @param limitPerPerson  weekly budget per person in $
 * @param current   current plan { 'day-meal': recipeId } — kept where it already fits
 * @returns { plan, cost, fits, missing }  cost = per-person weekly cost
 */
export function fitPlanToBudget(recipes, family, limitPerPerson, current = {}) {
  const banned = family.flatMap((p) => [...words(p.allergies), ...words(p.dislikes)]);
  const liked = family.flatMap((p) => words(p.likes));
  const ok = recipes.filter((r) => !banned.some((b) => text(r).includes(b)));
  const score = (r) => liked.filter((l) => text(r).includes(l)).length;

  // Candidates per meal type: liked first, then cheaper.
  const pools = MEALS.map((m) =>
    ok.filter((r) => r.category === m).sort((a, b) => score(b) - score(a) || a.cost - b.cost),
  );
  const missing = MEALS.filter((_, j) => !pools[j].length);

  // Start from maximum variety: rotate through the candidates of each meal type.
  const plan = {};
  DAYS.forEach((_, i) =>
    MEALS.forEach((__, j) => {
      const pool = pools[j];
      if (!pool.length) return;
      const keep = pool.find((r) => r.id === current[`${i}-${j}`]);
      plan[`${i}-${j}`] = (keep || pool[i % pool.length]).id;
    }),
  );

  const byId = Object.fromEntries(ok.map((r) => [r.id, r]));
  const total = () => Object.values(plan).reduce((s, id) => s + byId[id].cost, 0);
  const uses = (id) => Object.values(plan).filter((x) => x === id).length;
  let relaxed = false;
  let varied = null; // plan at the end of the variety-respecting pass
  const maxRepeat = (j) => (relaxed ? DAYS.length : Math.max(3, Math.ceil(DAYS.length / Math.max(1, pools[j].length)) + 1));

  // Greedy: repeatedly make the swap that saves the most money, limiting repeats of one dish.
  // If variety rules make the budget impossible, a second pass allows repeating cheap dishes.
  let cost = total();
  for (let guard = 0; cost > limitPerPerson && guard < 400; guard++) {
    let best = null;
    for (const k of Object.keys(plan)) {
      const j = Number(k.split('-')[1]);
      const cur = byId[plan[k]];
      for (const r of pools[j]) {
        const saving = cur.cost - r.cost;
        if (saving <= 0.001 || uses(r.id) >= maxRepeat(j)) continue;
        if (!best || saving > best.saving) best = { k, id: r.id, saving };
      }
    }
    if (!best) {
      if (relaxed) break;
      relaxed = true;
      varied = { ...plan };
      continue;
    }
    plan[best.k] = best.id;
    cost -= best.saving;
  }
  // Even repeating the cheapest dishes doesn't fit: keep the varied plan instead of a monotonous one.
  if (varied && total() > limitPerPerson) Object.assign(plan, varied);
  cost = Math.round(total() * 100) / 100;
  return { plan, cost, fits: cost <= limitPerPerson + 0.005, missing };
}
