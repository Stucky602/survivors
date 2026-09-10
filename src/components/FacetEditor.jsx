import React, { useState } from 'react';
import { api } from '../api.js';
import { FACET_KEYS_INT, ENUMS, META_SYSTEMS, scoreGame, DEFAULT_SETTINGS } from '../../shared/score.js';

// Edit a game's facets by hand. Saving marks them confirmed; the tagger will not overwrite confirmed facets.
export default function FacetEditor({ game, taste, onDone }) {
  const [f, setF] = useState({ ...game.facets });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const ev = game.evidence || {};
  const prop = game.proposed?.facets || null;
  const preview = scoreGame(f, taste || DEFAULT_SETTINGS);
  const set = (k, v) => setF({ ...f, [k]: v });
  const toggleMeta = (s) => set('meta_systems', f.meta_systems.includes(s) ? f.meta_systems.filter((x) => x !== s) : [...f.meta_systems, s]);

  const save = async () => {
    setBusy('saving'); setErr('');
    try { await api('/admin/facets', { method: 'POST', admin: true, body: { appid: game.appid, facets: f, evidence: game.evidence } }); onDone && onDone(); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };
  const dismiss = async () => {
    setBusy('saving');
    try { await api('/admin/facets', { method: 'POST', admin: true, body: { appid: game.appid, reject: true } }); onDone && onDone(); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };
  const applyProposed = () => prop && setF({ ...f, ...prop });

  return (
    <div className="editor">
      <p className="sub">Score with these values: <b>{preview.score}</b>{preview.failed.length ? `, gated by ${preview.failed.join(', ')}` : ''}{preview.penalties.length ? `, ${preview.penalties.join(', ')}` : ''}</p>
      {prop && <p className="bar">A rerun proposed new values. <button onClick={applyProposed}>Load proposed values</button></p>}
      <table className="facets edit">
        <tbody>
          <tr><td>Auto-fire</td><td><label className="check"><input type="checkbox" checked={!!f.auto_fire} onChange={(e) => set('auto_fire', e.target.checked)} /></label></td><td className="ev">{ev.auto_fire}</td></tr>
          <tr><td>Idle game</td><td><label className="check"><input type="checkbox" checked={!!f.idle_game} onChange={(e) => set('idle_game', e.target.checked)} /></label></td><td className="ev">{ev.idle_game}</td></tr>
          {Object.entries(ENUMS).map(([k, vals]) => (
            <tr key={k}><td>{k.replace(/_/g, ' ')}</td><td><select value={f[k]} onChange={(e) => set(k, e.target.value)}>{vals.map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}</select></td><td className="ev">{ev[k]}{prop && prop[k] !== f[k] ? <span className="muted">, proposed {prop[k]}</span> : null}</td></tr>
          ))}
          {FACET_KEYS_INT.map((k) => (
            <tr key={k}><td>{k.replace(/_/g, ' ')}</td><td><input type="number" min="0" max="10" value={f[k]} onChange={(e) => set(k, Number(e.target.value))} /></td><td className="ev">{ev[k]}{prop && prop[k] !== f[k] ? <span className="muted">, proposed {prop[k]}</span> : null}</td></tr>
          ))}
          <tr><td>Run length (min)</td><td><input type="number" min="0" value={f.run_length_minutes || ''} onChange={(e) => set('run_length_minutes', Number(e.target.value) || null)} /></td><td></td></tr>
          <tr><td>Why not perfect</td><td colSpan="2"><input type="text" value={f.why_not_perfect || ''} onChange={(e) => set('why_not_perfect', e.target.value)} /></td></tr>
          <tr><td>Fit summary</td><td colSpan="2"><input type="text" value={f.fit_summary || ''} onChange={(e) => set('fit_summary', e.target.value)} /></td></tr>
        </tbody>
      </table>
      <div className="meta-grid">
        {META_SYSTEMS.map((s) => <label key={s} className="check"><input type="checkbox" checked={f.meta_systems.includes(s)} onChange={() => toggleMeta(s)} /> {s.replace(/_/g, ' ')}</label>)}
      </div>
      {err && <p className="bar warn">{err}</p>}
      <div className="actions">
        <button className="primary" onClick={save} disabled={!!busy}>Confirm these facets</button>
        {game.needs_review ? <button onClick={dismiss} disabled={!!busy}>Leave first pass as is</button> : null}
      </div>
    </div>
  );
}
