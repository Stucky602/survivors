import React, { useEffect, useState } from 'react';
import { api, getToken } from '../api.js';
import FacetEditor from '../components/FacetEditor.jsx';

const SCOPES = [['all', 'Everything', 'every tracked game'], ['available', 'Available now', 'released on Steam or the PS Store'], ['upcoming', 'Upcoming', 'not out anywhere yet']];

const STAGES = ['discover', 'enrich', 'match', 'refresh', 'tag', 'plans', 'rescore'];
const LABEL = { discover: 'Discover', enrich: 'Enrich', match: 'Match', refresh: 'Refresh', tag: 'Tag', plans: 'PS Store plans', rescore: 'Rescore' };

export default function Queue({ meta, onChange }) {
  const [q, setQ] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState([]);
  const [open, setOpen] = useState(null);
  const [single, setSingle] = useState(null);
  const [runner, setRunner] = useState(null);
  const [scope, setScopeState] = useState(localStorage.getItem('survivors.scope') || 'all');
  const [planStats, setPlanStats] = useState(null);
  const [dbgId, setDbgId] = useState('');
  const [dbg, setDbg] = useState(null);
  const loadPlanStats = () => api('/admin/plan-stats', { admin: true }).then(setPlanStats).catch((e) => setErr(e.message));
  const runDebug = async () => { if (!dbgId) return; setBusy('dbg'); setDbg(null); try { setDbg(await api(`/admin/plan-debug?appid=${Number(dbgId)}`, { admin: true })); } catch (e) { setErr(e.message); } setBusy(''); };
  const setScope = (v) => { setScopeState(v); localStorage.setItem('survivors.scope', v); };
  const hashArg = location.hash.split('/')[2];
  const runnerStatus = () => api('/admin/runner/status', { admin: true }).then(setRunner).catch(() => setRunner({ unavailable: true }));
  useEffect(() => {
    if (!getToken()) return;
    runnerStatus();
    const t = setInterval(() => { runnerStatus(); }, 6000);
    const t2 = setInterval(() => { load(); onChange && onChange(); }, 30000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, []);
  const fmtEta = (sec) => sec == null ? '' : sec < 90 ? 'about a minute' : sec < 3600 ? `about ${Math.round(sec / 60)} minutes` : `about ${(sec / 3600).toFixed(1)} hours`;
  const runnerCmd = async (cmd) => { setBusy('runner'); try { await api(`/admin/runner/${cmd}`, { method: 'POST', admin: true, body: { scope } }); await runnerStatus(); } catch (e) { setErr(e.message); } setBusy(''); };

  const load = () => api('/admin/queue', { admin: true }).then(setQ).catch((e) => setErr(e.message));
  useEffect(() => { if (getToken()) load(); }, []);
  useEffect(() => { if (hashArg) api(`/game/${hashArg}`).then((d) => setSingle(d.game)).catch((e) => setErr(e.message)); }, [hashArg]);

  if (!getToken()) return <><h1>Queue</h1><p>Enter the admin token in <a href="#/settings">Settings</a> first.</p></>;

  const run = async (stage, loop = false) => {
    setBusy(stage);
    let total = 0, rounds = 0;
    try {
      do {
        const r = await api(`/admin/run/${stage}`, { method: 'POST', admin: true, body: { scope } });
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

      <h2>Scope</h2>
      <div className="scope" role="tablist">
        {SCOPES.map(([k, label, hint]) => <button key={k} role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)} title={hint}>{label}</button>)}
      </div>
      <p className="muted">Applies to the run button and to every stage button below. {SCOPES.find(([k]) => k === scope)[2]}.{runner && runner.running && runner.scope !== scope ? ` The Runner is currently going with "${SCOPES.find(([k]) => k === runner.scope)?.[1] || runner.scope}"; stop and start it to switch.` : ''}</p>

      <h2>Auto-run</h2>
      {meta && meta.plan ? <p className="muted">Cloudflare plan: <b>{meta.plan}</b>{meta.plan === 'free' ? ' (small batches, 50-fetch cap). If the account is on Workers Paid, set the worker variable PLAN to paid; the upgrade does not reach the code until then.' : ' (large batches).'} Tagging with {meta.tagger}.{meta.counts ? ` ${meta.counts.tagged || 0} games scored, ${meta.counts.tagged_claude || 0} of them by Claude${meta.counts.retag_pending ? `, ${meta.counts.retag_pending} waiting for a re-score` : ''}.` : ''}</p> : null}
      {runner && runner.unavailable ? <p className="bar warn">The Runner isn't deployed yet. Push the latest repo; the deploy creates it.</p> : (
        <>
          <p className="muted">One button. The Runner works through Discover, Enrich, Match, Tag, and PS Store plans for the selected scope in the background, one batch at a time, and stops on its own when that scope is done. Cron restarts it every day; you only press this for the first backfill or after a change.</p>
          <div className="actions">
            {runner && runner.running
              ? <button onClick={() => runnerCmd('stop')} disabled={!!busy}>Stop</button>
              : <button className="primary" onClick={() => runnerCmd('start')} disabled={!!busy}>{scope === 'all' ? 'Run everything' : `Run ${SCOPES.find(([k]) => k === scope)[1].toLowerCase()}`}</button>}
            {runner && <span className="muted">
              {runner.running ? `Running ${SCOPES.find(([k]) => k === runner.scope)?.[1]?.toLowerCase() || runner.scope}, batch ${runner.ticks}.` : 'Idle.'}
              {runner.ai_capped_until ? ` Today's free AI allocation is used up; tagging and plans resume after ${runner.ai_capped_until.slice(11, 16)} UTC${runner.running ? ' (the Runner wakes itself then)' : ''}.` : runner.pending ? ` Next up: ${runner.pending}.` : runner.running ? '' : ' Nothing pending.'}
              {runner.last && runner.last.stage !== 'idle' ? ` Last: ${runner.last.stage} ${runner.last.ok ? 'ok' : 'failed'} ${runner.last.count}${runner.last.note ? `, ${runner.last.note}` : ''}.` : ''}
            </span>}
          </div>
          {runner && runner.pending_counts && (runner.running || runner.pending_counts.total > 0) && (
            <div className="progress">
              <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round((runner.progress || 0) * 100)}%` }} /></div>
              <div className="progress-text">
                <span>{Math.round((runner.progress || 0) * 100)}%{runner.start_total ? `, ${runner.done} of ${runner.start_total} items` : ''}{runner.eta_seconds != null && runner.running ? `, ${fmtEta(runner.eta_seconds)} left` : ''}</span>
                <span className="muted">
                  {[['discover', 'pages'], ['enrich', 'to enrich'], ['match', 'to match'], ['tag', 'to tag'], ['plans', 'plans to read']].filter(([k]) => runner.pending_counts[k] > 0).map(([k, label]) => `${runner.pending_counts[k]} ${label}`).join(', ') || 'nothing left'}
                  {runner.pending_counts.tag_blocked || runner.pending_counts.plans_blocked ? ` (${runner.pending_counts.tag_blocked + runner.pending_counts.plans_blocked} waiting on the AI allocation)` : ''}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      <h3>Run one stage by hand</h3>
      <p className="muted">For poking at a single step. The plain button runs one batch; ↻ repeats until that stage is empty.</p>
      <div className="actions wrap">
        {STAGES.map((s) => <span key={s} className="pair"><button onClick={() => run(s)} disabled={!!busy}>{busy === s ? `${LABEL[s]}…` : LABEL[s]}</button><button onClick={() => run(s, true)} disabled={!!busy || s === 'refresh' || s === 'rescore'} title="Run until empty">↻</button></span>)}
        <button onClick={() => run('retry-errors')} disabled={!!busy}>Retry errored games</button>
        <button onClick={() => { if (confirm('Re-score games tagged by an older model with the current one? Games already on the current model and anything you confirmed by hand are skipped. Old scores stay until replaced.')) run('retag'); }} disabled={!!busy}>Re-score with current model</button>
        <button onClick={() => run('rematch')} disabled={!!busy} title="Re-check not-listed games whose title has a subtitle or edition word. Matched games are never touched.">Re-match not listed</button>
        <button onClick={() => run('replan')} disabled={!!busy} title="Re-read PS Store plans for games not yet read with the current method. Dated announcements are kept.">Re-read plans</button>
      </div>
      {log.length > 0 && <pre className="log">{log.join('\n')}</pre>}

      {meta && meta.runs && meta.runs.length > 0 && (
        <table className="plain runs">
          <thead><tr><th>Stage</th><th>Last run</th><th>Result</th><th className="num">Count</th><th>Note</th></tr></thead>
          <tbody>{meta.runs.map((r) => <tr key={r.stage} className={r.ok === 0 ? 'bad' : ''}><td>{r.stage}</td><td>{(r.started_at || '').slice(0, 16).replace('T', ' ')}</td><td>{r.ok == null ? 'running' : r.ok ? 'ok' : 'failed'}</td><td className="num">{r.count}</td><td className="ev">{r.error}</td></tr>)}</tbody>
        </table>
      )}

      <h2>PS Store plans, under the hood</h2>
      <p className="muted">Method now: <b>{meta && meta.plan_method === 'web' ? 'Claude with web search' : 'Steam news feed, small model'}</b>.{meta && meta.plan_method !== 'web' ? ' To switch on web search, set the PLANS_WEB_SEARCH variable to 1 on the worker (needs the Anthropic key), then press Re-read plans.' : ''}</p>
      <div className="actions">
        <button onClick={loadPlanStats} disabled={!!busy}>Show plan stats</button>
        <input type="number" placeholder="appid" value={dbgId} onChange={(e) => setDbgId(e.target.value)} />
        <button onClick={runDebug} disabled={!!busy || !dbgId}>{busy === 'dbg' ? 'Reading…' : 'Read one game live'}</button>
      </div>
      {planStats && (
        <>
          <p className="muted">Steam news feeds: {planStats.news.has_news} games with posts, {planStats.news.empty} with an empty feed, {planStats.news.missing} not fetched yet, of {planStats.news.total}.{planStats.news.empty > planStats.news.has_news ? ' Mostly empty means Steam is refusing the news calls; the web method does not depend on it.' : ''}</p>
          <table className="plain"><thead><tr><th>Status</th><th>Method</th><th className="num">Games</th></tr></thead><tbody>{planStats.by_status.map((r, i) => <tr key={i}><td>{r.status}</td><td className="muted">{r.method || '–'}</td><td className="num">{r.n}</td></tr>)}</tbody></table>
        </>
      )}
      {dbg && (dbg.error ? <p className="bar warn">{dbg.error}</p> : (
        <div className="editor">
          <p><b>{dbg.name}</b> <span className="muted">via {dbg.method}, model {dbg.model}{dbg.searches != null ? `, ${dbg.searches} searches` : ''}</span></p>
          {dbg.news_count != null && <p className="muted">Steam news posts cached: {dbg.news_count}. Mentioning consoles: {dbg.console_mentions.length ? dbg.console_mentions.map((m) => `${m.date} "${m.title}"`).join('; ') : 'none'}.</p>}
          <p>Parsed: <b>{dbg.parsed.status}</b> {dbg.parsed.date || dbg.parsed.window || ''} {dbg.parsed.platform !== 'unspecified' ? `(${dbg.parsed.platform})` : ''}{dbg.parsed.note ? <> — “{dbg.parsed.note}”</> : null}{dbg.parsed.url ? <> <a href={dbg.parsed.url} target="_blank" rel="noreferrer">source</a></> : null}</p>
          <pre className="log">{dbg.raw_text}</pre>
        </div>
      ))}

      {single && (
        <>
          <h2>Edit facets: {single.name}</h2>
          {single.facets ? <FacetEditor game={single} taste={meta && meta.taste} onDone={() => { location.hash = `#/game/${single.appid}`; }} /> : <p className="muted">This game has no facets yet. Run the tag stage first.</p>}
        </>
      )}

      {q && (
        <>
          <h2>PS Store matches parked for a decision ({q.matches.length})</h2>
          {q.matches.length === 0 && <p className="empty">None. In automatic mode the model's pick is accepted at 70% confidence or better and anything weaker is treated as not on PSN and rechecked weekly. A wrong match can be fixed from the game's page with "Attach this listing".</p>}
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

          <h2>Tags flagged for a look ({q.facets.length})</h2>
          {q.facets.length === 0 && <p className="empty">Nothing flagged. In automatic mode the model's tags stand on their own; you can still edit any game's facets from its page. Switch to hybrid mode in Settings if you want high scorers parked here for a check first.</p>}
          {q.facets.map((g) => (
            <div key={g.appid} className="queue-item">
              <p><b><a href={`#/game/${g.appid}`}>{g.name}</a></b> <span className="score">{g.score}</span> <span className="muted">{g.category}</span> {g.proposed ? <span className="flag">rerun proposed changes</span> : null}</p>
              <p>{g.facets.fit_summary}</p>
              <p className="muted">Why not perfect: {g.facets.why_not_perfect}</p>
              {open === g.appid ? <FacetEditor game={g} taste={meta && meta.taste} onDone={() => { setOpen(null); load(); }} /> : <button onClick={() => setOpen(g.appid)}>Review</button>}
            </div>
          ))}

          <h2>Errors ({q.errors.length})</h2>
          {q.errors.length > 0 && <p className="muted">These retry on their own within the hour. "Retry errored games" above does it now.</p>}
          {q.errors.length === 0 ? <p className="empty">No errors recorded.</p> : (
            <table className="plain"><tbody>{q.errors.map((e) => <tr key={e.appid}><td><a href={`#/game/${e.appid}`}>{e.name}</a></td><td className="muted">{e.status} / {e.psn_status}</td><td className="ev">{e.last_error}</td></tr>)}</tbody></table>
          )}
        </>
      )}
    </>
  );
}
