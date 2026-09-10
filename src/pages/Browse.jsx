import React, { useEffect, useMemo, useState } from 'react';
import { api, getLocalTaste, getCompare, setCompare, getPsPlus, toCSV, download, getFilters, setFilters } from '../api.js';
import GameTable, { CATEGORY_LABEL } from '../components/GameTable.jsx';
import { scoreGame, categorize, DEFAULT_SETTINGS } from '../../shared/score.js';

const HUB = ['any', 'authored', 'decorative', 'freeform', 'none'];
const COMBAT = ['any', 'pure_bullet_heaven', 'survivor_hybrid', 'action_roguelite', 'traditional_roguelike', 'idle'];
const BASE = { hub: 'any', combat: 'any', prestige: false, category: 'any', minScore: 0, maxPrice: 0, onSale: false, psplus: false, hideOwned: true, hideNo: true, tagged: 'all', q: '', sort: 'score' };

// One-tap views. Plain names, no slogans.
const PRESETS = [
  ['Best fits', { minScore: 75 }],
  ['Pure survivors', { combat: 'pure_bullet_heaven' }],
  ['Authored hub', { hub: 'authored' }],
  ['Prestige or NG+', { prestige: true }],
  ['On sale now', { onSale: true, sort: 'discount' }],
  ['Under $10', { maxPrice: 1000, sort: 'price' }],
  ['Wildcards', { category: 'wildcard' }],
  ['Not tagged yet', { tagged: 'untagged' }]
];

export default function Browse({ meta }) {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState('');
  const [f, setFState] = useState(() => getFilters('browse', BASE));
  const setF = (next) => { setFState(next); setFilters('browse', next); };
  const [cmp, setCmp] = useState(getCompare());
  useEffect(() => { api('/games?view=catalog').then((d) => setGames(d.games)).catch((e) => setErr(e.message)); }, []);

  const taste = getLocalTaste() || (meta && meta.taste) || DEFAULT_SETTINGS;
  const rescored = useMemo(() => {
    if (!games) return null;
    return games.map((g) => {
      if (!g.facets) return g;
      const { score } = scoreGame(g.facets, taste);
      const n = (g.steam_pos || 0) + (g.steam_neg || 0) + (g.psn?.star_count || 0);
      return { ...g, score, category: categorize(g.facets, score, n, { owned: g.owned, never: g.never }, taste) };
    });
  }, [games, taste]);

  if (err) return <p className="bar warn">{err}</p>;
  if (!rescored) return <p className="muted">Loading the run</p>;

  // Nothing matched yet: say why, rather than "no games match these filters".
  if (rescored.length === 0) {
    const c = (meta && meta.counts) || {};
    const noKey = meta && meta.has_platprices_key === false;
    return (
      <>
        <h1>PS Store catalog</h1>
        <p className="muted">Every tracked game that has a PlayStation Store listing, with its price and score.</p>
        <div className="bar">
          <p>No games have been matched to the PS Store yet.</p>
          {noKey
            ? <p>The Match step needs the PlatPrices key, which is not on the worker. {c.enriched || 0} Steam games are loaded and waiting under <a href="#/upcoming">Upcoming</a>; the moment the key is added under Variables and Secrets, the Runner matches them and this page fills in.</p>
            : <p>The key is set, so Match just has not run yet. Press Run everything on <a href="#/queue">Queue</a>, or wait for tonight's cron.</p>}
        </div>
      </>
    );
  }

  const tier = getPsPlus();
  const q = f.q.trim().toLowerCase();
  let shown = rescored.filter((g) => {
    const p = g.psn || {};
    if (f.hideOwned && g.owned) return false;
    if (f.hideNo && g.never) return false;
    if (q && !g.name.toLowerCase().includes(q) && !(g.developer || '').toLowerCase().includes(q)) return false;
    if (f.tagged === 'tagged' && !g.facets) return false;
    if (f.tagged === 'untagged' && g.facets) return false;
    if (f.hub !== 'any' && (!g.facets || g.facets.hub_type !== f.hub)) return false;
    if (f.combat !== 'any' && (!g.facets || g.facets.combat_class !== f.combat)) return false;
    if (f.prestige && !(g.facets && g.facets.prestige)) return false;
    if (f.category !== 'any' && g.category !== f.category) return false;
    if (f.minScore > 0 && (g.score ?? -1) < f.minScore) return false;
    if (f.onSale && !p.is_on_sale) return false;
    if (f.maxPrice > 0 && !((p.sale_price ?? p.base_price ?? 1e9) <= f.maxPrice)) return false;
    if (f.psplus && !((tier === 'extra' && p.psp_extra) || (tier === 'premium' && (p.psp_extra || p.psp_premium)))) return false;
    return true;
  });
  const sorters = {
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
    price: (a, b) => (a.psn?.sale_price ?? 1e9) - (b.psn?.sale_price ?? 1e9),
    discount: (a, b) => (b.psn?.disc_perc ?? 0) - (a.psn?.disc_perc ?? 0),
    rating: (a, b) => (b.psn?.star_rating ?? -1) - (a.psn?.star_rating ?? -1),
    reviews: (a, b) => ((b.steam_pos || 0) + (b.steam_neg || 0)) - ((a.steam_pos || 0) + (a.steam_neg || 0)),
    name: (a, b) => a.name.localeCompare(b.name),
    newest: (a, b) => String(b.psn?.release_date || '').localeCompare(String(a.psn?.release_date || ''))
  };
  shown = shown.sort(sorters[f.sort] || sorters.score);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const toggleCompare = (id) => { const next = cmp.includes(id) ? cmp.filter((x) => x !== id) : [...cmp, id].slice(-3); setCmp(next); setCompare(next); };
  const isPreset = (patch) => Object.entries(patch).every(([k, v]) => f[k] === v);

  return (
    <>
      <h1>PS Store catalog</h1>
      <p className="muted">Every tracked game that has a PlayStation Store listing, with its price and score. Steam games not yet found on PSN are under Upcoming.</p>
      <div className="presets">
        {PRESETS.map(([label, patch]) => <button key={label} className={isPreset(patch) ? 'on' : ''} onClick={() => setF({ ...BASE, ...patch })}>{label}</button>)}
        <button onClick={() => setF(BASE)}>Reset</button>
      </div>
      <div className="filters">
        <input type="search" placeholder="Name or developer" value={f.q} onChange={set('q')} />
        <label>Hub <select value={f.hub} onChange={set('hub')}>{HUB.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <label>Combat <select value={f.combat} onChange={set('combat')}>{COMBAT.map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}</select></label>
        <label>Category <select value={f.category} onChange={set('category')}><option value="any">any</option>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Min score <input type="number" min="0" max="100" value={f.minScore} onChange={(e) => setF({ ...f, minScore: Number(e.target.value) || 0 })} /></label>
        <label>Max $ <input type="number" min="0" step="1" value={f.maxPrice ? f.maxPrice / 100 : ''} onChange={(e) => setF({ ...f, maxPrice: Math.round(Number(e.target.value) * 100) || 0 })} /></label>
        <label>Sort <select value={f.sort} onChange={set('sort')}><option value="score">score</option><option value="price">price</option><option value="discount">discount</option><option value="rating">PS rating</option><option value="reviews">Steam review count</option><option value="newest">newest on PSN</option><option value="name">name</option></select></label>
        <label>Tagged <select value={f.tagged} onChange={set('tagged')}><option value="all">all</option><option value="tagged">tagged</option><option value="untagged">untagged</option></select></label>
        <label className="check"><input type="checkbox" checked={f.onSale} onChange={set('onSale')} /> On sale</label>
        <label className="check"><input type="checkbox" checked={f.prestige} onChange={set('prestige')} /> Prestige or NG+</label>
        {tier !== 'none' && <label className="check"><input type="checkbox" checked={f.psplus} onChange={set('psplus')} /> In my PS Plus</label>}
        <label className="check"><input type="checkbox" checked={f.hideOwned} onChange={set('hideOwned')} /> Hide owned</label>
        <label className="check"><input type="checkbox" checked={f.hideNo} onChange={set('hideNo')} /> Hide rejected</label>
      </div>
      <p className="muted">
        {shown.length} of {rescored.length} PS Store games{getLocalTaste() ? '. Scores use your local weights from Settings' : ''}.
        {' '}<a href="#" onClick={(e) => { e.preventDefault(); download('survivors.csv', toCSV(shown), 'text/csv'); }}>CSV</a>, <a href="#" onClick={(e) => { e.preventDefault(); download('survivors.json', JSON.stringify(shown, null, 2), 'application/json'); }}>JSON</a>
        {cmp.length > 1 ? <>, <a href={`#/compare/${cmp.join(',')}`}>Compare {cmp.length}</a></> : null}
      </p>
      <GameTable games={shown} empty="No games match these filters." compare={cmp} onCompare={toggleCompare} />
    </>
  );
}
