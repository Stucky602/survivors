import React, { useEffect, useMemo, useState } from 'react';
import { api, getLocalTaste } from '../api.js';
import GameTable, { CATEGORY_LABEL } from '../components/GameTable.jsx';
import { scoreGame, categorize, DEFAULT_SETTINGS } from '../../shared/score.js';

const HUB = ['any', 'authored', 'decorative', 'freeform', 'none'];
const COMBAT = ['any', 'pure_bullet_heaven', 'survivor_hybrid', 'action_roguelite', 'traditional_roguelike', 'idle'];

export default function Browse({ meta }) {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ hub: 'any', combat: 'any', prestige: false, category: 'any', minScore: 0, hideOwned: true, hideNo: true, tagged: 'all', q: '', sort: 'score' });
  useEffect(() => { api('/games?view=catalog').then((d) => setGames(d.games)).catch((e) => setErr(e.message)); }, []);

  // Local weight overrides (Settings page) re-rank here without touching the server.
  const taste = getLocalTaste() || (meta && meta.taste) || DEFAULT_SETTINGS;
  const rescored = useMemo(() => {
    if (!games) return null;
    return games.map((g) => {
      if (!g.facets) return g;
      const { score } = scoreGame(g.facets, taste);
      const steamN = (g.steam_pos || 0) + (g.steam_neg || 0) + (g.psn?.star_count || 0);
      return { ...g, score, category: categorize(g.facets, score, steamN, { owned: g.owned, never: g.never }, taste) };
    });
  }, [games, taste]);

  if (err) return <p className="bar warn">{err}</p>;
  if (!rescored) return <p className="muted">Loading</p>;

  const q = f.q.trim().toLowerCase();
  let shown = rescored.filter((g) => {
    if (f.hideOwned && g.owned) return false;
    if (f.hideNo && g.never) return false;
    if (q && !g.name.toLowerCase().includes(q)) return false;
    if (f.tagged === 'tagged' && !g.facets) return false;
    if (f.tagged === 'untagged' && g.facets) return false;
    if (f.hub !== 'any' && (!g.facets || g.facets.hub_type !== f.hub)) return false;
    if (f.combat !== 'any' && (!g.facets || g.facets.combat_class !== f.combat)) return false;
    if (f.prestige && !(g.facets && g.facets.prestige)) return false;
    if (f.category !== 'any' && g.category !== f.category) return false;
    if (f.minScore > 0 && (g.score ?? -1) < f.minScore) return false;
    return true;
  });
  const sorters = {
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
    price: (a, b) => (a.psn?.sale_price ?? 1e9) - (b.psn?.sale_price ?? 1e9),
    rating: (a, b) => (b.psn?.star_rating ?? -1) - (a.psn?.star_rating ?? -1),
    name: (a, b) => a.name.localeCompare(b.name),
    newest: (a, b) => String(b.psn?.release_date || '').localeCompare(String(a.psn?.release_date || ''))
  };
  shown = shown.sort(sorters[f.sort] || sorters.score);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <>
      <h1>Browse</h1>
      <div className="filters">
        <input type="search" placeholder="Search names" value={f.q} onChange={set('q')} />
        <label>Hub <select value={f.hub} onChange={set('hub')}>{HUB.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <label>Combat <select value={f.combat} onChange={set('combat')}>{COMBAT.map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}</select></label>
        <label>Category <select value={f.category} onChange={set('category')}><option value="any">any</option>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Min score <input type="number" min="0" max="100" value={f.minScore} onChange={(e) => setF({ ...f, minScore: Number(e.target.value) || 0 })} /></label>
        <label>Sort <select value={f.sort} onChange={set('sort')}><option value="score">score</option><option value="price">price</option><option value="rating">PS rating</option><option value="newest">newest on PSN</option><option value="name">name</option></select></label>
        <label>Tagged <select value={f.tagged} onChange={set('tagged')}><option value="all">all</option><option value="tagged">tagged</option><option value="untagged">untagged</option></select></label>
        <label className="check"><input type="checkbox" checked={f.prestige} onChange={set('prestige')} /> Prestige or NG+</label>
        <label className="check"><input type="checkbox" checked={f.hideOwned} onChange={set('hideOwned')} /> Hide owned</label>
        <label className="check"><input type="checkbox" checked={f.hideNo} onChange={set('hideNo')} /> Hide rejected</label>
      </div>
      <p className="muted">{shown.length} of {rescored.length} on the PS Store{getLocalTaste() ? '. Scores use your local weights from Settings.' : ''}</p>
      <GameTable games={shown} empty="No games match these filters." />
    </>
  );
}
