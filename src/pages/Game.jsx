import React, { useEffect, useState } from 'react';
import { api, getToken, money, fmtDate, getLocalTaste, getCompare, setCompare, daysUntil } from '../api.js';
import { CATEGORY_LABEL, Price } from '../components/GameTable.jsx';
import Sparkline from '../components/Sparkline.jsx';
import XpBar from '../components/XpBar.jsx';
import Ps5Plan, { PLAN_LABEL } from '../components/Ps5Plan.jsx';
import { FACET_KEYS_INT, scoreBreakdown, dealVerdict, VERDICTS, DEFAULT_SETTINGS } from '../../shared/score.js';

const LABEL = {
  auto_fire: 'Auto-fire', perspective: 'Perspective', idle_game: 'Idle game', horde: 'Horde', combat_purity: 'Combat purity', combat_class: 'Combat class',
  progression_depth: 'Progression depth', content_longevity: 'Content longevity', build_variety: 'Build variety', hub: 'Hub', hub_type: 'Hub type',
  session_fit: 'Session fit', originality: 'Originality', presentation: 'Presentation', quality: 'Quality (computed)'
};

export default function Game({ appid, meta }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [ppidIn, setPpidIn] = useState('');
  const [planEdit, setPlanEdit] = useState(null);
  const load = () => api(`/game/${appid}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [appid]);
  if (err) return <p className="bar warn">{err}</p>;
  if (!d) return <p className="muted">Loading the run</p>;
  const g = d.game, p = g.psn, f = g.facets, ev = g.evidence || {};
  const admin = !!getToken();
  const taste = getLocalTaste() || (meta && meta.taste) || DEFAULT_SETTINGS;
  const verdict = dealVerdict(p);
  const cmp = getCompare();
  const inCmp = cmp.includes(g.appid);

  const flag = async (patch) => {
    setBusy('saving');
    try { await api('/admin/kevin', { method: 'POST', admin: true, body: { appid, ...patch } }); await load(); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };
  const attach = async () => {
    const ppid = Number(ppidIn);
    if (!ppid) return;
    setBusy('attach');
    try { await api('/admin/attach', { method: 'POST', admin: true, body: { appid, ppid } }); setPpidIn(''); await load(); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };
  const savePlan = async () => {
    setBusy('plan');
    try { await api('/admin/plan', { method: 'POST', admin: true, body: { appid, ...planEdit } }); setPlanEdit(null); await load(); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };
  const toggleCompare = () => { const next = inCmp ? cmp.filter((x) => x !== g.appid) : [...cmp, g.appid].slice(-3); setCompare(next); setD({ ...d }); };

  return (
    <>
      <p className="crumb"><a href="#/browse">Browse</a></p>
      <div className="game-head">
        {g.header_img ? <img className="cover" src={g.header_img} alt="" width="230" height="107" /> : null}
        <div>
          <h1>{g.name}</h1>
          <p className="sub">{[g.developer, g.publisher].filter(Boolean).join(' / ')}{g.early_access ? ', Early Access' : ''}{g.steam_release ? `, on Steam since ${g.steam_release}` : ''}</p>
          <p className="headline">
            {g.score != null ? <><XpBar score={g.score} size="big" /> <b>{CATEGORY_LABEL[g.category] || g.category}</b></> : <span className="muted">Not scored yet</span>}
          </p>
          <p className="headline">
            {p ? <Price g={g} /> : null}
            {verdict ? <span className={`deal ${verdict.kind}`}>{verdict.text}</span> : null}
          </p>
          {f && f.fit_summary ? <p>{f.fit_summary}</p> : null}
          {f && f.why_not_perfect ? <p><b>Why not perfect:</b> {f.why_not_perfect}</p> : null}
          <div className="actions">
            {admin && <button onClick={() => flag({ want: !g.want })} disabled={!!busy}>{g.want ? 'Stop wanting' : 'Want this'}</button>}
            {admin && <button onClick={() => flag({ owned: !g.owned })} disabled={!!busy}>{g.owned ? 'Unmark owned' : 'Mark owned'}</button>}
            {admin && <button onClick={() => flag({ never: !g.never })} disabled={!!busy}>{g.never ? 'Allow again' : 'Never recommend'}</button>}
            <button onClick={toggleCompare}>{inCmp ? 'Remove from compare' : 'Add to compare'}</button>
            {cmp.length > 1 ? <a className="button" href={`#/compare/${cmp.join(',')}`}>Compare {cmp.length}</a> : null}
            {admin && f ? <a className="button" href={`#/queue/${g.appid}`}>Edit facets</a> : null}
          </div>
          {admin && g.owned && (
            <p className="sub">Your verdict: {VERDICTS.map((v) => <button key={v} className={g.verdict === v ? 'on' : ''} onClick={() => flag({ verdict: g.verdict === v ? null : v })} disabled={!!busy}>{v}</button>)} <span className="muted">Feeds the calibration check in Settings.</span></p>
          )}
        </div>
      </div>

      <div className="two">
        <section>
          <h2>PlayStation Store</h2>
          {p ? (
            <dl>
              <dt>Listing</dt><dd><a href={p.url} target="_blank" rel="noreferrer">{p.product_name}</a>{p.edition ? ` (${p.edition})` : ''}, {p.is_ps5 ? 'PS5' : ''}{p.is_ps5 && p.is_ps4 ? ' + ' : ''}{p.is_ps4 ? 'PS4' : ''}</dd>
              <dt>Price</dt><dd>{p.sale_expired ? <span className="muted">Sale ended, price refreshes tonight. </span> : null}{p.is_on_sale ? <><b className="sale">{p.f_sale}</b> <s className="muted">{p.f_base}</s> ({p.disc_perc}% off, ends {fmtDate(p.discounted_until)}{daysUntil(p.discounted_until) != null ? `, ${daysUntil(p.discounted_until)} days` : ''})</> : p.f_base}{p.plus_price != null && p.plus_price !== p.sale_price ? <>, PS Plus {p.f_plus}</> : null}</dd>
              <dt>Lowest</dt><dd>{money(p.lowest_seen) ? `${money(p.lowest_seen)} seen by this site` : 'no sale seen yet'}{p.lowest_ever != null ? <>, {money(p.lowest_ever)} lowest ever per PlatPrices</> : null}</dd>
              <dt>Rating</dt><dd>{p.star_rating ? `${Number(p.star_rating).toFixed(2)} / 5 from ${p.star_count} ratings` : 'none yet'}</dd>
              <dt>Release</dt><dd>{fmtDate(p.release_date)}{p.is_preorder ? ' (preorder)' : ''}{p.is_delisted ? ', delisted' : ''}</dd>
              <dt>PS Plus</dt><dd>{p.psp_extra ? 'In the Extra catalog' : p.psp_premium ? 'In the Premium catalog' : 'not in a catalog'}</dd>
              <dt>Data</dt><dd className="muted">Powered by <a href={p.pp_url} target="_blank" rel="noreferrer">PlatPrices</a>, refreshed {(p.refreshed_at || '').slice(0, 16).replace('T', ' ')} UTC</dd>
            </dl>
          ) : (
            <>
              <p className="muted">{g.psn_status === 'review' ? 'A candidate match is waiting in Queue.' : g.psn_status === 'not_listed' ? 'No PS Store listing found. Rechecked weekly.' : 'Not matched yet.'} <a href={`https://store.playstation.com/en-us/search/${encodeURIComponent(g.name)}`} target="_blank" rel="noreferrer">Search the PS Store</a></p>
              <dl>
                <dt>PlayStation plans</dt><dd><Ps5Plan g={g} long />{g.ps5_plan ? <span className="muted"> (read {fmtDate(g.ps5_plan.at)})</span> : null}</dd>
              </dl>
              {admin && !planEdit && <div className="actions"><button onClick={() => setPlanEdit({ status: g.ps5_plan?.status || 'unknown', platform: g.ps5_plan?.platform || 'unspecified', date: g.ps5_plan?.date || '', window: g.ps5_plan?.window || '', note: g.ps5_plan?.note || '' })}>Set plan by hand</button></div>}
              {admin && planEdit && (
                <div className="actions">
                  <select value={planEdit.status} onChange={(e) => setPlanEdit({ ...planEdit, status: e.target.value })}>{Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  <select value={planEdit.platform || 'unspecified'} onChange={(e) => setPlanEdit({ ...planEdit, platform: e.target.value })}><option value="unspecified">platform not named</option><option value="ps5">PS5</option><option value="ps4">PS4</option><option value="both">PS5 and PS4</option></select>
                  <input type="date" value={planEdit.date} onChange={(e) => setPlanEdit({ ...planEdit, date: e.target.value })} />
                  <input type="text" placeholder="window, e.g. Q1 2027" value={planEdit.window} onChange={(e) => setPlanEdit({ ...planEdit, window: e.target.value })} />
                  <input type="text" placeholder="source note" value={planEdit.note} onChange={(e) => setPlanEdit({ ...planEdit, note: e.target.value })} />
                  <button className="primary" onClick={savePlan} disabled={!!busy}>Save</button>
                  <button onClick={() => setPlanEdit(null)}>Cancel</button>
                </div>
              )}
              {admin && (
                <div className="actions">
                  <input type="number" placeholder="PlatPrices ppid" value={ppidIn} onChange={(e) => setPpidIn(e.target.value)} />
                  <button onClick={attach} disabled={!!busy}>Attach this listing</button>
                  <span className="muted">The number in a platprices.com game URL.</span>
                </div>
              )}
            </>
          )}
          {d.price_history && d.price_history.length > 1 && (
            <>
              <h3>Price seen by this site</h3>
              <Sparkline points={d.price_history} />
              <table className="plain"><tbody>{d.price_history.slice(-8).reverse().map((s, i) => <tr key={i}><td>{fmtDate(s.observed_at)}</td><td className="num">{money(s.sale_price)}</td><td className="num muted">{money(s.base_price)}</td></tr>)}</tbody></table>
            </>
          )}
          <h2>Steam</h2>
          <dl>
            <dt>Reviews</dt><dd>{g.steam_score_desc || '–'}, {g.steam_pos || 0} positive, {g.steam_neg || 0} negative, <a href={`https://store.steampowered.com/app/${g.appid}/`} target="_blank" rel="noreferrer">store page</a></dd>
            {d.steam && d.steam.metacritic ? <><dt>Metacritic</dt><dd>{d.steam.metacritic.score}</dd></> : null}
            {d.steam && d.steam.categories ? <><dt>Features</dt><dd>{d.steam.categories.filter((c) => /co-op|controller|cloud|achieve|remote play/i.test(c)).join(', ') || '–'}</dd></> : null}
            {d.tags && d.tags.length ? <><dt>Tags</dt><dd>{d.tags.map((t) => `${t.name} (${t.count})`).join(', ')}</dd></> : null}
          </dl>
          {d.steam && d.steam.short_description ? <p>{d.steam.short_description}</p> : null}
          {d.reviews && d.reviews.length ? (
            <>
              <h3>Most helpful Steam reviews</h3>
              {d.reviews.map((r, i) => <blockquote key={i} className={r.voted_up ? '' : 'neg'}><span className="muted">{r.voted_up ? 'Recommended' : 'Not recommended'}, {r.hours} hours played</span><br />{r.text}</blockquote>)}
            </>
          ) : null}
        </section>

        <section>
          <h2>Fit</h2>
          {f ? (
            <>
              <p className="muted">{g.confirmed ? 'Confirmed by Kevin' : 'First pass by the model'}{g.needs_review ? ', waiting for review' : ''}, tagged {fmtDate(g.tagged_at)}, confidence {f.confidence}</p>
              <h3>Where the {g.score} comes from</h3>
              <table className="plain breakdown">
                <tbody>
                  {scoreBreakdown(f, taste).map((r) => (
                    <tr key={r.facet}><td>{r.facet.replace(/_/g, ' ')}</td><td className="num">{r.value}/10</td><td className="num muted">× {r.weight}</td><td className="num"><b>{r.points.toFixed(1)}</b></td><td className="barcell"><span className="barfill" style={{ width: `${(r.points / r.weight) * 100}%` }} /></td></tr>
                  ))}
                </tbody>
              </table>
              <h3>Facets and evidence</h3>
              <table className="facets">
                <tbody>
                  <tr><td>{LABEL.auto_fire}</td><td className="num">{f.auto_fire ? 'yes' : 'no'}</td><td className="ev">{ev.auto_fire}</td></tr>
                  <tr><td>{LABEL.perspective}</td><td className="num">{f.perspective}</td><td className="ev">{ev.perspective}</td></tr>
                  <tr><td>{LABEL.combat_class}</td><td className="num">{f.combat_class.replace(/_/g, ' ')}</td><td className="ev">{ev.combat_class}</td></tr>
                  <tr><td>{LABEL.hub_type}</td><td className="num">{f.hub_type}</td><td className="ev">{ev.hub_type}</td></tr>
                  {FACET_KEYS_INT.map((k) => <tr key={k}><td>{LABEL[k]}</td><td className="num">{f[k]}</td><td className="ev">{ev[k]}</td></tr>)}
                </tbody>
              </table>
              <dl>
                <dt>Meta systems</dt><dd>{f.meta_systems.length ? f.meta_systems.map((s) => s.replace(/_/g, ' ')).join(', ') : 'none recorded'}</dd>
                <dt>Run length</dt><dd>{f.run_length_minutes ? `${f.run_length_minutes} min` : 'not stated'}</dd>
                <dt>Co-op</dt><dd>{f.coop}</dd>
                <dt>Counts</dt><dd>{Object.entries(f.counts).filter(([, v]) => v != null).map(([k, v]) => `${v} ${k}`).join(', ') || 'not stated'}</dd>
                <dt>Model</dt><dd className="muted">{g.model || '–'}</dd>
              </dl>
            </>
          ) : <p className="muted">Not tagged yet. The tag stage runs daily; an admin can run it from Queue.</p>}
        </section>
      </div>
    </>
  );
}
