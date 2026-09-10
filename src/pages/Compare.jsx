import React, { useEffect, useState } from 'react';
import { api, getLocalTaste, setCompare } from '../api.js';
import { Price, CATEGORY_LABEL } from '../components/GameTable.jsx';
import { scoreBreakdown, FACET_KEYS_INT, DEFAULT_SETTINGS } from '../../shared/score.js';
import XpBar from '../components/XpBar.jsx';
import Radar from '../components/Radar.jsx';

const ROWS = [
  ['combat_class', 'Combat class'], ['hub_type', 'Hub type'], ['perspective', 'Perspective'], ['auto_fire', 'Auto-fire'],
  ...FACET_KEYS_INT.map((k) => [k, k.replace(/_/g, ' ')]), ['quality', 'Quality'], ['prestige', 'Prestige / NG+'],
  ['run_length_minutes', 'Run length'], ['coop', 'Co-op'], ['meta_systems', 'Meta systems']
];

export default function Compare({ ids, meta }) {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    Promise.all(ids.map((id) => api(`/game/${id}`).then((d) => d.game))).then(setGames).catch((e) => setErr(e.message));
  }, [ids.join(',')]);
  if (err) return <p className="bar warn">{err}</p>;
  if (!ids.length) return <><h1>Compare</h1><p>Tick "compare" on two or three games in <a href="#/browse">Browse</a>.</p></>;
  if (!games) return <p className="muted">Loading the run</p>;
  const taste = getLocalTaste() || (meta && meta.taste) || DEFAULT_SETTINGS;
  const cell = (g, k) => {
    const f = g.facets;
    if (!f) return <span className="muted">untagged</span>;
    const v = f[k];
    if (k === 'meta_systems') return v.map((x) => x.replace(/_/g, ' ')).join(', ') || '–';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (v == null) return '–';
    return String(v).replace(/_/g, ' ');
  };
  const best = (k) => {
    if (!games.every((g) => g.facets && typeof g.facets[k] === 'number')) return null;
    return Math.max(...games.map((g) => g.facets[k]));
  };
  return (
    <>
      <h1>Compare</h1>
      <p className="muted"><a href="#/browse">Change selection</a>, <a href="#/compare" onClick={() => setCompare([])}>Clear</a>. On the stat wheels, blue is that game and red is the first game for reference.</p>
      <table className="compare">
        <thead><tr><th></th>{games.map((g) => <th key={g.appid}><a href={`#/game/${g.appid}`}>{g.name}</a></th>)}</tr></thead>
        <tbody>
          <tr><td>Cover</td>{games.map((g) => <td key={g.appid}>{g.header_img ? <img src={g.header_img} alt="" width="184" height="86" /> : null}</td>)}</tr>
          <tr><td>Stat wheel</td>{games.map((g, i) => <td key={g.appid}>{g.facets ? <Radar facets={g.facets} other={i > 0 && games[0].facets ? games[0].facets : null} size={190} /> : <span className="muted">untagged</span>}</td>)}</tr>
          <tr><td>Score</td>{games.map((g) => <td key={g.appid}><XpBar score={g.score} size="card" /> {g.category ? <span className="muted">{CATEGORY_LABEL[g.category]}</span> : null}</td>)}</tr>
          <tr><td>PS Store</td>{games.map((g) => <td key={g.appid}><Price g={g} /></td>)}</tr>
          <tr><td>PS rating</td>{games.map((g) => <td key={g.appid}>{g.psn && g.psn.star_rating ? `${Number(g.psn.star_rating).toFixed(2)} (${g.psn.star_count})` : '–'}</td>)}</tr>
          <tr><td>Steam</td>{games.map((g) => { const n = (g.steam_pos || 0) + (g.steam_neg || 0); return <td key={g.appid}>{n ? `${Math.round((100 * g.steam_pos) / n)}% of ${n}` : '–'}</td>; })}</tr>
          {ROWS.map(([k, label]) => { const b = best(k); return (
            <tr key={k}><td>{label}</td>{games.map((g) => <td key={g.appid} className={b != null && g.facets && g.facets[k] === b && games.length > 1 ? 'best' : ''}>{cell(g, k)}</td>)}</tr>
          ); })}
          <tr><td>Fit summary</td>{games.map((g) => <td key={g.appid} className="ev">{g.facets?.fit_summary}</td>)}</tr>
          <tr><td>Why not perfect</td>{games.map((g) => <td key={g.appid} className="ev">{g.facets?.why_not_perfect}</td>)}</tr>
          <tr><td>Points by facet</td>{games.map((g) => <td key={g.appid} className="ev">{g.facets ? scoreBreakdown(g.facets, taste).map((r) => `${r.facet.replace(/_/g, ' ')} ${r.points.toFixed(0)}`).join(', ') : ''}</td>)}</tr>
        </tbody>
      </table>
    </>
  );
}
