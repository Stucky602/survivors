// Scoring, quality, and category. Pure functions; imported by both the worker and the browser.
// Single implementation on purpose: the queue threshold and the page ranking must agree.

export const DEFAULT_WEIGHTS = {
  combat_purity: 25,
  progression_depth: 20,
  quality: 15,
  content_longevity: 10,
  build_variety: 10,
  hub: 8,
  session_fit: 5,
  originality: 4,
  presentation: 3
};

export const DEFAULT_SETTINGS = {
  weights: DEFAULT_WEIGHTS,
  penalties: { hub_freeform: -25, shallow_progression: -20, shallow_progression_threshold: 3 },
  gates: { auto_fire: true, reject_first_person: true, reject_idle: true, horde_min: 4 },
  queue_threshold: 70,
  wildcard_max_reviews: 50
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// Returns a list of gate names that failed. Empty list = passes.
export function failedGates(facets, gates = DEFAULT_SETTINGS.gates) {
  const f = facets || {};
  const out = [];
  if (gates.auto_fire && f.auto_fire !== true) out.push('auto_fire');
  if (gates.reject_first_person && f.perspective === 'first_person') out.push('first_person');
  if (gates.reject_idle && f.idle_game === true) out.push('idle_game');
  if (num(f.horde, 0) < num(gates.horde_min, 4)) out.push('horde');
  return out;
}

// Quality from store numbers only. 0-10 integer.
// Small samples get pulled toward 7 so a 100% game with 6 reviews does not outrank a 92% game with 4,000.
export function computeQuality({ steamPos = 0, steamNeg = 0, psnRating = null, psnCount = 0, abandonedEA = false }) {
  const sp = num(steamPos), sn = num(steamNeg), pc = num(psnCount);
  const steamN = sp + sn;
  const parts = [];
  if (steamN > 0) parts.push({ v: sp / steamN, n: steamN });
  if (psnRating != null && pc > 0) parts.push({ v: num(psnRating) / 5, n: pc });
  const n = parts.reduce((a, p) => a + p.n, 0);
  if (n === 0) return { quality: 7, reviews: 0, blend: null };
  const blend = parts.reduce((a, p) => a + p.v * p.n, 0) / n;
  const shrink = n / (n + 100);
  let q = 0.7 + (blend - 0.7) * shrink;
  q = clamp(Math.round(q * 10), 0, 10);
  if (abandonedEA) q = Math.min(q, 5);
  return { quality: q, reviews: n, blend };
}

// Weighted score. `facets.quality` must already be filled in by computeQuality.
export function scoreGame(facets, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const weights = { ...DEFAULT_WEIGHTS, ...(s.weights || {}) };
  const pen = { ...DEFAULT_SETTINGS.penalties, ...(s.penalties || {}) };
  const gates = { ...DEFAULT_SETTINGS.gates, ...(s.gates || {}) };
  const f = facets || {};
  const failed = failedGates(f, gates);
  if (failed.length) return { score: 0, failed, penalties: [] };
  let total = 0;
  for (const [k, w] of Object.entries(weights)) total += (clamp(num(f[k], 0), 0, 10) * num(w)) / 10;
  const penalties = [];
  if (f.hub_type === 'freeform') { total += pen.hub_freeform; penalties.push('hub_freeform'); }
  if (num(f.progression_depth, 0) <= num(pen.shallow_progression_threshold, 3)) {
    total += pen.shallow_progression; penalties.push('shallow_progression');
  }
  return { score: Math.round(clamp(total, 0, 100)), failed: [], penalties };
}

// One category per game, first rule wins. See docs/TASTE_SCHEMA.md.
export function categorize(facets, score, reviews, kevin = {}, settings = DEFAULT_SETTINGS) {
  const f = facets || {};
  const maxWild = num(settings.wildcard_max_reviews, 50);
  if (kevin.never || failedGates(f, { ...DEFAULT_SETTINGS.gates, ...(settings.gates || {}) }).length) return 'do_not_recommend';
  if (num(reviews, 0) < maxWild) return 'wildcard';
  if (f.hub_type === 'authored' && num(f.hub) >= 8) return 'hub_gem';
  if (num(f.progression_depth) >= 9 && f.combat_class !== 'pure_bullet_heaven') return 'progression_monster';
  if (f.combat_class === 'pure_bullet_heaven' && num(f.progression_depth) >= 8 && score >= 80) return 'perfect_fit';
  if (f.combat_class === 'pure_bullet_heaven') return 'pure_survivor';
  if (f.combat_class === 'survivor_hybrid') return 'survivor_hybrid';
  if (f.combat_class === 'action_roguelite' && score >= 65) return 'conditional_action_roguelite';
  return 'other';
}

// True when the first pass should go to Kevin. High scorers, and anything sitting on a gate edge.
export function needsReview(facets, score, settings = DEFAULT_SETTINGS) {
  const f = facets || {};
  const th = num(settings.queue_threshold, 70);
  if (score >= th) return true;
  const hordeMin = num((settings.gates || {}).horde_min, 4);
  if (Math.abs(num(f.horde, 0) - hordeMin) <= 1) return true;
  if (num(f.confidence, 1) < 0.6) return true;
  return false;
}

// Normalise a model's raw facet output into the stored shape. Coerces types, drops unknown keys, never throws.
export const FACET_KEYS_INT = ['horde', 'combat_purity', 'progression_depth', 'content_longevity', 'build_variety', 'hub', 'session_fit', 'originality', 'presentation'];
export const ENUMS = {
  perspective: ['top_down', 'isometric', 'side_2d', 'third_person', 'first_person'],
  hub_type: ['none', 'decorative', 'authored', 'freeform'],
  combat_class: ['pure_bullet_heaven', 'survivor_hybrid', 'action_roguelite', 'traditional_roguelike', 'idle'],
  coop: ['none', 'local', 'online', 'both']
};
export const META_SYSTEMS = ['characters', 'classes', 'weapons', 'weapon_evolutions', 'abilities', 'skill_trees', 'equipment', 'loot', 'relics', 'crafting', 'research', 'meta_currencies', 'permanent_upgrades', 'npc_unlocks', 'hub_upgrades', 'difficulty_tiers', 'challenges', 'rewarded_achievements', 'prestige', 'ng_plus', 'endgame', 'secrets'];

export function normalizeFacets(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  out.auto_fire = r.auto_fire === true || r.auto_fire === 'true';
  out.idle_game = r.idle_game === true || r.idle_game === 'true';
  for (const k of FACET_KEYS_INT) out[k] = clamp(Math.round(num(Number(r[k]), 0)), 0, 10);
  for (const [k, vals] of Object.entries(ENUMS)) out[k] = vals.includes(r[k]) ? r[k] : (k === 'coop' ? 'none' : vals[0]);
  out.meta_systems = Array.isArray(r.meta_systems) ? r.meta_systems.filter((x) => META_SYSTEMS.includes(x)) : [];
  out.prestige = out.meta_systems.includes('prestige') || out.meta_systems.includes('ng_plus');
  const rl = Number(r.run_length_minutes);
  out.run_length_minutes = Number.isFinite(rl) && rl > 0 ? Math.round(rl) : null;
  const c = r.counts && typeof r.counts === 'object' ? r.counts : {};
  out.counts = {};
  for (const k of ['characters', 'weapons', 'maps', 'bosses']) {
    const v = Number(c[k]);
    out.counts[k] = Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  }
  out.fit_summary = typeof r.fit_summary === 'string' ? r.fit_summary.slice(0, 300) : '';
  out.why_not_perfect = typeof r.why_not_perfect === 'string' ? r.why_not_perfect.slice(0, 300) : '';
  const conf = Number(r.confidence);
  out.confidence = Number.isFinite(conf) ? clamp(conf, 0, 1) : 0.5;
  return out;
}

export function normalizeEvidence(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [k, v] of Object.entries(r)) if (typeof v === 'string') out[k] = v.slice(0, 400);
  return out;
}

// Per-facet contribution to the score, for the "why this number" view. Same math as scoreGame.
export function scoreBreakdown(facets, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const weights = { ...DEFAULT_WEIGHTS, ...(s.weights || {}) };
  const f = facets || {};
  const rows = Object.entries(weights).map(([k, w]) => ({ facet: k, value: clamp(num(f[k], 0), 0, 10), weight: num(w), points: (clamp(num(f[k], 0), 0, 10) * num(w)) / 10 }));
  return rows.sort((a, b) => b.weight - a.weight);
}

// Deal verdict from what the site and PlatPrices have seen. Plain words, no scores.
export function dealVerdict(p) {
  if (!p || p.is_delisted) return null;
  if (p.is_preorder) return { kind: 'preorder', text: 'Preorder' };
  if (!p.is_on_sale) return { kind: 'full', text: 'Full price' };
  const cur = p.sale_price;
  const seen = p.lowest_seen, ever = p.lowest_ever;
  if (ever != null && cur <= ever) return { kind: 'best', text: 'Lowest ever recorded' };
  if (seen != null && cur <= seen) return { kind: 'best', text: 'Lowest this site has seen' };
  if (ever != null && cur > ever) {
    const gap = Math.round(((cur - ever) / cur) * 100);
    return { kind: gap >= 20 ? 'wait' : 'near', text: gap >= 20 ? `Has been ${gap}% cheaper` : `Within ${gap}% of the lowest ever` };
  }
  return { kind: 'sale', text: `${p.disc_perc}% off` };
}

export const VERDICTS = ['loved', 'fine', 'bounced'];
