import React, { useEffect, useMemo, useState } from 'react';
import { api, getLocalTaste } from '../api.js';
import { scoreGame, DEFAULT_SETTINGS } from '../../shared/score.js';

// The tier list. S through D by score, F for anything a hard gate rejected. Cover tiles, hover for the number.
const TIERS = [
  ['S', 85, 101, 'Buy it'], ['A', 70, 85, 'Very likely'], ['B', 55, 70, 'Decent'], ['C', 40, 55, 'Meh'], ['D', 1, 40, 'No'], ['F', -1, 1, 'Gated out']
];

export default function Tiers({ meta }) {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState('');
  const [hideOwned, setHideOwned] = useState(false);
  const [source, setSource] = useState('catalog');
  useEffect(() => { setGames(null); api(`/games?view=${source === 'catalog' ? 'catalog' : 'steamonly'}`).then((d) => setGames(d.games)).catch((e) => setErr(e.message)); }, [source]);
  const taste = getLocalTaste() || (meta && meta.taste) || DEFAULT_SETTINGS;
  const scored = useMemo(() => (games || []).filter((g) => g.facets).map((g) => ({ ...g, score: scoreGame(g.facets, taste).score })), [games, taste]);
  if (err) return <p className="bar warn">{err}</p>;
  if (!games) return <p className="muted">Loading the run</p>;
  const shown = scored.filter((g) => !(hideOwned && g.owned));
  return (
    <>
      <h1>Tier list</h1>
      <div className="filters">
        <label>Set <select value={source} onChange={(e) => setSource(e.target.value)}><option value="catalog">On the PS Store</option><option value="steam">On Steam, waiting</option></select></label>
        <label className="check"><input type="checkbox" checked={hideOwned} onChange={(e) => setHideOwned(e.target.checked)} /> Hide owned</label>
        <span className="muted">{shown.length} scored games. Hover or tap a tile for the number.</span>
      </div>
      {TIERS.map(([t, lo, hi, hint]) => {
        const list = shown.filter((g) => g.score >= lo && g.score < hi).sort((a, b) => b.score - a.score);
        return (
          <div key={t} className={`tier tier-${t}`}>
            <div className="tier-label"><span className="tier-letter">{t}</span><span className="tier-hint">{hint}</span></div>
            <div className="tier-tiles">
              {list.length ? list.map((g) => (
                <a key={g.appid} href={`#/game/${g.appid}`} className={`tile${g.owned ? ' owned' : ''}${g.want ? ' want' : ''}`} title={`${g.name}: ${g.score}`}>
                  {g.header_img ? <img src={g.header_img} alt={g.name} loading="lazy" /> : <span className="tile-blank">{g.name}</span>}
                  <span className="tile-score">{g.score}</span>
                </a>
              )) : <span className="muted tier-empty">nothing here</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}
