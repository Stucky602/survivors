import React, { useEffect, useState } from 'react';
import { api, getToken } from '../api.js';
import FacetEditor from '../components/FacetEditor.jsx';

const STAGES = ['discover', 'enrich', 'match', 'refresh', 'tag', 'rescore'];

export default function Queue({ meta, onChange }) {
  const [q, setQ] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState([]);
  const [open, setOpen] = useState(null);
  const [single, setSingle] = useState(null);
  const hashArg = location.hash.split('/')[2];

  const load = () => api('/admin/queue', { admin: true }).then(setQ).catch((e) => setErr(e.message));
  useEffect(() => { if (getToken()) load(); }, []);
  useEffect(() => { if (hashArg) api(`/game/${hashArg}`).then((d) => setSingle(d.game)).catch((e) => setErr(e.message)); }, [hashArg]);

  if (!getToken()) return <><h1>Queue</h1><p>Enter the admin token in <a href="#/settings">Settings</a> first.</p></>;

  const run = async (stage, loop = false) => {
    setBusy(stage);
    let total = 0, rounds = 0;
    try {
      do {
        const r = await api(`/admin/run/${stage}`, { method: 'POST', admin: true, body: {} });
        rounds++;
        total += r.count || 0;
        setLog((l) => [`${stage}: ${r.ok ? 'ok' : 'failed'} ${r.count ?? ''} ${r.note || r.error || ''}`, ...l].slice(0, 30));
        const morePages = stage === 'discover' && r.ok && /more pages queued/.test(r.note || '');
        if (!r.ok || !loop || rounds >= 40) break;
        if (!morePages && (r.count || 0) === 0) break;
      } while (true);
    } catch (e) { setLog((l) => [`${stage}: ${e.message}`, ...l]); }
    setBusy('');
    load(); onChange && onChange();
  };

  const confirmMatch = async (appid, ppid) => {
    setBusy('match');
    try { await api('/admin/match', { method: 'POST', admin: true, body: { appid, ppid } }); await load(); } catch (e) { setErr(e.message); }
    setBusy('');
  };

  return (
    <>
      <h1>Queue</h1>
      {err && <p className="bar warn">{err}</p>}

      <h2>Run a stage</h2>
      <p className="muted">Each click runs one batch of {meta ? 25 : 25}. "Run until empty" keeps going while a stage still has work, up to 40 batches. Cron does this on its own daily.</p>
      <div className="actions wrap">
        {STAGES.map((s) => <span key={s} className="pair"><button onClick={() => run(s)} disabled={!!busy}>{busy === s ? `${s}…` : s}</button><button onClick={() => run(s, true)} disabled={!!busy || s === 'refresh' || s === 'rescore'} title="Run until empty">↻</button></span>)}
      </div>
      {log.length > 0 && <pre className="log">{log.join('\n')}</pre>}

      {meta && meta.runs && meta.runs.length > 0 && (
        <table className="plain runs">
          <thead><tr><th>Stage</th><th>Last run</th><th>Result</th><th className="num">Count</th><th>Note</th></tr></thead>
          <tbody>{meta.runs.map((r) => <tr key={r.stage} className={r.ok === 0 ? 'bad' : ''}><td>{r.stage}</td><td>{(r.started_at || '').slice(0, 16).replace('T', ' ')}</td><td>{r.ok == null ? 'running' : r.ok ? 'ok' : 'failed'}</td><td className="num">{r.count}</td><td className="ev">{r.error}</td></tr>)}</tbody>
        </table>
      )}

      {single && (
        <>
          <h2>Edit facets: {single.name}</h2>
          {single.facets ? <FacetEditor game={single} taste={meta && meta.taste} onDone={() => { location.hash = `#/game/${single.appid}`; }} /> : <p className="muted">This game has no facets yet. Run the tag stage first.</p>}
        </>
      )}

      {q && (
        <>
          <h2>PS Store matches to confirm ({q.matches.length})</h2>
          {q.matches.length === 0 && <p className="empty">No matches waiting.</p>}
          {q.matches.map((mrow) => (
            <div key={mrow.appid} className="queue-item">
              <p><b>{mrow.name}</b> <span className="muted">{mrow.developer}, Steam {mrow.steam_release}</span></p>
              <p className="muted">Model picked {mrow.ai.ppid ?? 'nothing'} at {mrow.ai.confidence ?? '?'}: {mrow.ai.reason}</p>
              <table className="plain">
                <tbody>
                  {mrow.candidates.slice(0, 12).map((c) => (
                    <tr key={c.PPID} className={Number(c.PPID) === Number(mrow.ai.ppid) ? 'pick' : ''}>
                      <td>{c.ProductName}{c.EditionName ? ` (${c.EditionName})` : ''}</td>
                      <td className="muted">{c.Publisher}, {c.ReleaseDate}, {c.StoreClass}</td>
                      <td className="num">{c.formattedBasePrice}</td>
                      <td><button onClick={() => confirmMatch(mrow.appid, c.PPID)} disabled={!!busy}>This one</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => confirmMatch(mrow.appid, null)} disabled={!!busy}>Not on PSN</button>
            </div>
          ))}

          <h2>Facets to confirm ({q.facets.length})</h2>
          {q.facets.length === 0 && <p className="empty">No first-pass tags waiting. The tagger sends games scoring {meta?.taste?.queue_threshold ?? 70} or higher here.</p>}
          {q.facets.map((g) => (
            <div key={g.appid} className="queue-item">
              <p><b><a href={`#/game/${g.appid}`}>{g.name}</a></b> <span className="score">{g.score}</span> <span className="muted">{g.category}</span> {g.proposed ? <span className="flag">rerun proposed changes</span> : null}</p>
              <p>{g.facets.fit_summary}</p>
              <p className="muted">Why not perfect: {g.facets.why_not_perfect}</p>
              {open === g.appid ? <FacetEditor game={g} taste={meta && meta.taste} onDone={() => { setOpen(null); load(); }} /> : <button onClick={() => setOpen(g.appid)}>Review</button>}
            </div>
          ))}

          <h2>Errors ({q.errors.length})</h2>
          {q.errors.length === 0 ? <p className="empty">No errors recorded.</p> : (
            <table className="plain"><tbody>{q.errors.map((e) => <tr key={e.appid}><td><a href={`#/game/${e.appid}`}>{e.name}</a></td><td className="muted">{e.status} / {e.psn_status}</td><td className="ev">{e.last_error}</td></tr>)}</tbody></table>
          )}
        </>
      )}
    </>
  );
}
