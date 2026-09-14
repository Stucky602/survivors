import React, { useEffect, useState } from 'react';
import { api, getToken, setToken, getLocalTaste, setLocalTaste, getPsPlus, setPsPlus } from '../api.js';
import { DEFAULT_SETTINGS, DEFAULT_WEIGHTS } from '../../shared/score.js';

export default function Settings({ meta, onChange }) {
  const [token, setTok] = useState(getToken());
  const [ok, setOk] = useState(null);
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [tagName, setTagName] = useState('Bullet Heaven');
  const [budget, setBudget] = useState(null);
  const [psplus, setPs] = useState(getPsPlus());
  const [cal, setCal] = useState(null);

  const load = () => api('/admin/settings', { admin: true }).then((d) => { setS(d); setOk(true); }).catch((e) => { setOk(false); setErr(e.message); });
  useEffect(() => { if (getToken()) load(); }, []);

  const saveToken = () => { setToken(token.trim()); setErr(''); load(); };
  const setW = (k, v) => setS({ ...s, taste: { ...s.taste, weights: { ...s.taste.weights, [k]: Number(v) } } });
  const wsum = s ? Object.values(s.taste.weights).reduce((a, b) => a + Number(b || 0), 0) : 0;

  const saveTaste = async (rescore) => {
    setMsg('');
    try {
      await api('/admin/settings', { method: 'PUT', admin: true, body: { taste: s.taste, steam_tags: s.steam_tags, extra_appids: s.extra_appids, review_mode: s.review_mode || 'auto' } });
      setLocalTaste(null);
      if (rescore) { const r = await api('/admin/run/rescore', { method: 'POST', admin: true, body: {} }); setMsg(`Saved. Rescored ${r.count} games.`); } else setMsg('Saved.');
      onChange && onChange();
    } catch (e) { setErr(e.message); }
  };
  const previewLocally = () => { setLocalTaste(s.taste); setMsg('Browse now uses these weights on this device only. Save to make them the site\'s weights.'); };
  const resolveTag = async () => {
    setMsg('');
    try {
      const r = await api('/admin/resolve-tag', { method: 'POST', admin: true, body: { name: tagName } });
      if (r.id) setS({ ...s, steam_tags: [...s.steam_tags.filter((t) => t.name !== tagName), { name: tagName, id: r.id }] });
      else setMsg(r.note);
    } catch (e) { setErr(e.message); }
  };
  const checkBudget = () => api('/admin/budget', { admin: true }).then(setBudget).catch((e) => setErr(e.message));
  const loadCal = () => api('/admin/calibration', { admin: true }).then(setCal).catch((e) => setErr(e.message));

  return (
    <>
      <h1>Settings</h1>
      <h2>Admin token</h2>
      <p className="muted">The ADMIN_TOKEN secret on the worker, at least 24 characters. Stored in this browser only; sent as a bearer header to admin endpoints and nowhere else.</p>
      <div className="actions">
        <input type="password" value={token} onChange={(e) => setTok(e.target.value)} placeholder="token" />
        <button onClick={saveToken}>Use this token</button>
        {ok === true && <span className="sale">accepted</span>}
        {ok === false && <span className="warn-text">{err || 'rejected'}</span>}
        {ok === true && <button onClick={() => { setToken(''); setTok(''); setOk(null); setS(null); onChange && onChange(); }}>Sign out</button>}
      </div>

      {s && (
        <>
          <h2>Weights</h2>
          <p className="muted">Sum is {wsum}. 100 keeps scores on a 0 to 100 scale; anything else still works, it just shifts the range.</p>
          <table className="plain weights">
            <tbody>
              {Object.keys(DEFAULT_WEIGHTS).map((k) => (
                <tr key={k}>
                  <td>{k.replace(/_/g, ' ')}</td>
                  <td><input type="range" min="0" max="40" value={s.taste.weights[k] ?? 0} onChange={(e) => setW(k, e.target.value)} /></td>
                  <td className="num"><input type="number" min="0" max="100" value={s.taste.weights[k] ?? 0} onChange={(e) => setW(k, e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Gates and penalties</h3>
          <div className="filters">
            <label className="check"><input type="checkbox" checked={!!s.taste.gates.auto_fire} onChange={(e) => setS({ ...s, taste: { ...s.taste, gates: { ...s.taste.gates, auto_fire: e.target.checked } } })} /> Require auto-fire</label>
            <label className="check"><input type="checkbox" checked={!!s.taste.gates.reject_first_person} onChange={(e) => setS({ ...s, taste: { ...s.taste, gates: { ...s.taste.gates, reject_first_person: e.target.checked } } })} /> Reject first-person</label>
            <label className="check"><input type="checkbox" checked={!!s.taste.gates.reject_idle} onChange={(e) => setS({ ...s, taste: { ...s.taste, gates: { ...s.taste.gates, reject_idle: e.target.checked } } })} /> Reject idle games</label>
            <label>Horde minimum <input type="number" min="0" max="10" value={s.taste.gates.horde_min} onChange={(e) => setS({ ...s, taste: { ...s.taste, gates: { ...s.taste.gates, horde_min: Number(e.target.value) } } })} /></label>
            <label>Freeform hub penalty <input type="number" max="0" value={s.taste.penalties.hub_freeform} onChange={(e) => setS({ ...s, taste: { ...s.taste, penalties: { ...s.taste.penalties, hub_freeform: Number(e.target.value) } } })} /></label>
            <label>Shallow progression penalty <input type="number" max="0" value={s.taste.penalties.shallow_progression} onChange={(e) => setS({ ...s, taste: { ...s.taste, penalties: { ...s.taste.penalties, shallow_progression: Number(e.target.value) } } })} /></label>
            <label>Queue threshold <input type="number" min="0" max="100" value={s.taste.queue_threshold} onChange={(e) => setS({ ...s, taste: { ...s.taste, queue_threshold: Number(e.target.value) } })} /></label>
            <label>Wildcard below reviews <input type="number" min="0" value={s.taste.wildcard_max_reviews} onChange={(e) => setS({ ...s, taste: { ...s.taste, wildcard_max_reviews: Number(e.target.value) } })} /></label>
          </div>
          <div className="actions">
            <button onClick={previewLocally}>Preview in Browse</button>
            <button className="primary" onClick={() => saveTaste(true)}>Save and rescore</button>
            <button onClick={() => setS({ ...s, taste: DEFAULT_SETTINGS })}>Reset to defaults</button>
          </div>

          <h2>Steam tags to track</h2>
          <p className="muted">Discover walks the store search for each tag. Bullet Heaven is Valve's official tag for the genre since May 2026.</p>
          <ul className="list">
            {s.steam_tags.map((t) => <li key={t.name}>{t.name} <span className="muted">id {t.id}</span> <button onClick={() => setS({ ...s, steam_tags: s.steam_tags.filter((x) => x.name !== t.name) })}>Remove</button></li>)}
            {s.steam_tags.length === 0 && <li className="muted">None yet. Resolve Bullet Heaven below.</li>}
          </ul>
          <div className="actions">
            <input type="text" value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="Tag name as shown on Steam" />
            <button onClick={resolveTag}>Look up id</button>
            <input type="number" placeholder="or paste id" onBlur={(e) => { const id = Number(e.target.value); if (id) { setS({ ...s, steam_tags: [...s.steam_tags.filter((t) => t.name !== tagName), { name: tagName, id }] }); e.target.value = ''; } }} />
          </div>
          <h3>Extra Steam appids</h3>
          <p className="muted">Games the tag search misses. One appid per line.</p>
          <textarea rows="3" value={s.extra_appids.join('\n')} onChange={(e) => setS({ ...s, extra_appids: e.target.value.split(/\s+/).filter(Boolean) })} />
          <div className="actions"><button className="primary" onClick={() => saveTaste(false)}>Save tags and appids</button></div>

          <h2>Worth bothering with</h2>
          <p className="muted">Below this score, a game is not matched to the PS Store (saves PlatPrices' monthly quota) and not given a paid web search for its PlayStation plans (saves Claude spend). A game you mark "want" always bypasses this. Takes effect immediately, no push needed.</p>
          <div className="actions">
            {[70, 60, 0].map((v) => (
              <button key={v} className={(s.taste.match_min_score ?? 70) === v ? 'on' : ''} onClick={() => setS({ ...s, taste: { ...s.taste, match_min_score: v } })}>{v === 0 ? 'No minimum' : v}</button>
            ))}
            <input type="number" min="0" max="100" value={s.taste.match_min_score ?? 70} onChange={(e) => setS({ ...s, taste: { ...s.taste, match_min_score: Number(e.target.value) || 0 } })} />
            <button className="primary" onClick={() => saveTaste(false)}>Save</button>
          </div>

          <h2>Review mode</h2>
          <p className="muted">Automatic: the model's tags and PS Store matches stand, nothing waits on you. Hybrid: games scoring at or above the queue threshold, and matches between 50% and 90% confidence, park in Queue for a look first.</p>
          <div className="actions">
            <button className={(s.review_mode || 'auto') === 'auto' ? 'on' : ''} onClick={() => setS({ ...s, review_mode: 'auto' })}>Automatic</button>
            <button className={s.review_mode === 'hybrid' ? 'on' : ''} onClick={() => setS({ ...s, review_mode: 'hybrid' })}>Hybrid</button>
            <button className="primary" onClick={() => saveTaste(false)}>Save</button>
          </div>

          <h2>PS Plus</h2>
          <p className="muted">Which catalog you pay for. Games in it get a PS Plus mark and a filter in Browse. Stored in this browser only.</p>
          <div className="actions">
            {['none', 'extra', 'premium'].map((t) => <button key={t} className={psplus === t ? 'on' : ''} onClick={() => { setPsPlus(t); setPs(t); }}>{t === 'none' ? 'No PS Plus catalog' : t === 'extra' ? 'Extra' : 'Premium'}</button>)}
          </div>

          <h2>Calibration</h2>
          <p className="muted">Does the score predict what you actually liked? Mark owned games loved, fine, or bounced on their page, then check here. A loved game under 60 or a bounced game over 80 means a weight or a facet is wrong.</p>
          <div className="actions"><button onClick={loadCal}>Check calibration</button></div>
          {cal && (cal.rows.length === 0 ? <p className="empty">No verdicts yet.</p> : (
            <>
              <p>{['loved', 'fine', 'bounced'].map((v) => { const rs = cal.rows.filter((r) => r.verdict === v && r.score != null); return rs.length ? `${v}: avg ${Math.round(rs.reduce((a, r) => a + r.score, 0) / rs.length)} over ${rs.length}` : `${v}: none`; }).join(', ')}</p>
              <table className="plain">
                <tbody>{cal.rows.map((r) => { const miss = (r.verdict === 'loved' && r.score != null && r.score < 60) || (r.verdict === 'bounced' && r.score != null && r.score >= 80); return <tr key={r.appid} className={miss ? 'bad' : ''}><td><a href={`#/game/${r.appid}`}>{r.name}</a></td><td>{r.verdict}</td><td className="num">{r.score ?? '–'}</td><td className="muted">{miss ? 'misfire' : ''}</td></tr>; })}</tbody>
              </table>
            </>
          ))}

          <h2>PlatPrices budget</h2>
          <p className="muted">Free plan: 1,000 requests a month. The worker keeps 150 in reserve and stops refreshing prices when it would dip below that.</p>
          {meta && meta.budget && <p>Seen from headers: used {meta.budget.used}, remaining {meta.budget.remaining ?? 'unknown'}, reserve {meta.budget.reserve}. Month {meta.budget.month}.</p>}
          <div className="actions"><button onClick={checkBudget}>Check live and fix the tracker</button></div>
          {budget && <pre className="log">{JSON.stringify(budget.remote, null, 2)}</pre>}
        </>
      )}
      {msg && <p className="bar">{msg}</p>}
      {err && ok !== false && <p className="bar warn">{err}</p>}
    </>
  );
}
