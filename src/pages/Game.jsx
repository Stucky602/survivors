import React, { useEffect, useState } from 'react';
import { api, getToken, money, fmtDate } from '../api.js';
import { CATEGORY_LABEL } from '../components/GameTable.jsx';
import { FACET_KEYS_INT } from '../../shared/score.js';

const LABEL = {
  auto_fire: 'Auto-fire', perspective: 'Perspective', idle_game: 'Idle game', horde: 'Horde', combat_purity: 'Combat purity', combat_class: 'Combat class',
  progression_depth: 'Progression depth', content_longevity: 'Content longevity', build_variety: 'Build variety', hub: 'Hub', hub_type: 'Hub type',
  session_fit: 'Session fit', originality: 'Originality', presentation: 'Presentation', quality: 'Quality (computed)'
};

export default function Game({ appid }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api(`/game/${appid}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [appid]);
  if (err) return <p className="bar warn">{err}</p>;
  if (!d) return <p className="muted">Loading</p>;
  const g = d.game, p = g.psn, f = g.facets, ev = g.evidence || {};
  const admin = !!getToken();

  const flag = async (patch) => {
    setBusy('saving');
    try { await api('/admin/kevin', { method: 'POST', admin: true, body: { appid, owned: g.owned, never: g.never, note: g.note, ...patch } }); await load(); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };

  return (
    <>
      <p className="crumb"><a href="#/browse">Browse</a></p>
      <h1>{g.name}</h1>
      <p className="sub">{[g.developer, g.publisher].filter(Boolean).join(' / ')}{g.early_access ? ' · Early Access' : ''}</p>

      <div className="two">
        <section>
          <h2>PlayStation Store</h2>
          {p ? (
            <dl>
              <dt>Listing</dt><dd><a href={p.url} rel="noreferrer">{p.product_name}</a>{p.edition ? ` (${p.edition})` : ''} · {p.is_ps5 ? 'PS5' : ''}{p.is_ps5 && p.is_ps4 ? ' + ' : ''}{p.is_ps4 ? 'PS4' : ''}</dd>
              <dt>Price</dt><dd>{p.is_on_sale ? <><b className="sale">{p.f_sale}</b> <s className="muted">{p.f_base}</s> ({p.disc_perc}% off, ends {fmtDate(p.discounted_until)})</> : p.f_base}{p.plus_price != null && p.plus_price !== p.sale_price ? <> · PS Plus {p.f_plus}</> : null}</dd>
              <dt>Lowest seen here</dt><dd>{money(p.lowest_seen) || '–'}{p.lowest_ever != null ? <span className="muted"> · PlatPrices lowest ever {money(p.lowest_ever)}</span> : null}</dd>
              <dt>Rating</dt><dd>{p.star_rating ? `${Number(p.star_rating).toFixed(2)} / 5 from ${p.star_count} ratings` : 'none yet'}</dd>
              <dt>Release</dt><dd>{fmtDate(p.release_date)}{p.is_preorder ? ' (preorder)' : ''}{p.is_delisted ? ' · delisted' : ''}</dd>
              <dt>PS Plus</dt><dd>{p.psp_extra ? 'Extra' : p.psp_premium ? 'Premium' : 'not in catalog'}</dd>
              <dt>Refreshed</dt><dd>{(p.refreshed_at || '').slice(0, 16).replace('T', ' ')} UTC · <a href={p.pp_url} rel="noreferrer">PlatPrices</a></dd>
            </dl>
          ) : <p className="muted">{g.psn_status === 'review' ? 'A candidate match is waiting in Queue.' : g.psn_status === 'not_listed' ? 'No PS Store listing found. Rechecked weekly.' : 'Not matched yet.'}</p>}
          {d.price_history && d.price_history.length > 1 && (
            <>
              <h3>Price changes seen</h3>
              <table className="plain"><tbody>{d.price_history.map((s, i) => <tr key={i}><td>{fmtDate(s.observed_at)}</td><td className="num">{money(s.sale_price)}</td><td className="num muted">{money(s.base_price)}</td></tr>)}</tbody></table>
            </>
          )}
          <h2>Steam</h2>
          <dl>
            <dt>Reviews</dt><dd>{g.steam_score_desc || '–'} · {g.steam_pos || 0} positive, {g.steam_neg || 0} negative · <a href={`https://store.steampowered.com/app/${g.appid}/`} rel="noreferrer">store page</a></dd>
            <dt>Release</dt><dd>{g.steam_release || '–'}</dd>
            {d.tags && d.tags.length ? <><dt>Tags</dt><dd>{d.tags.map((t) => `${t.name} (${t.count})`).join(', ')}</dd></> : null}
          </dl>
          {d.steam && d.steam.short_description ? <p>{d.steam.short_description}</p> : null}
        </section>

        <section>
          <h2>Fit {g.score != null ? <span className="score">{g.score}</span> : null}</h2>
          {f ? (
            <>
              <p><b>{CATEGORY_LABEL[g.category] || g.category}</b>{g.confirmed ? ' · confirmed' : ' · first pass'}{g.needs_review ? ' · waiting for review' : ''}</p>
              {f.fit_summary ? <p>{f.fit_summary}</p> : null}
              {f.why_not_perfect ? <p><b>Why not perfect:</b> {f.why_not_perfect}</p> : null}
              <table className="facets">
                <tbody>
                  <tr><td>{LABEL.auto_fire}</td><td className="num">{f.auto_fire ? 'yes' : 'no'}</td><td className="ev">{ev.auto_fire}</td></tr>
                  <tr><td>{LABEL.perspective}</td><td className="num">{f.perspective}</td><td className="ev">{ev.perspective}</td></tr>
                  <tr><td>{LABEL.combat_class}</td><td className="num">{f.combat_class.replace(/_/g, ' ')}</td><td className="ev">{ev.combat_class}</td></tr>
                  <tr><td>{LABEL.hub_type}</td><td className="num">{f.hub_type}</td><td className="ev">{ev.hub_type}</td></tr>
                  {FACET_KEYS_INT.map((k) => <tr key={k}><td>{LABEL[k]}</td><td className="num">{f[k]}</td><td className="ev">{ev[k]}</td></tr>)}
                  <tr><td>{LABEL.quality}</td><td className="num">{f.quality}</td><td className="ev muted">from Steam and PS ratings</td></tr>
                </tbody>
              </table>
              <dl>
                <dt>Meta systems</dt><dd>{f.meta_systems.length ? f.meta_systems.map((s) => s.replace(/_/g, ' ')).join(', ') : 'none recorded'}</dd>
                <dt>Run length</dt><dd>{f.run_length_minutes ? `${f.run_length_minutes} min` : 'not stated'}</dd>
                <dt>Co-op</dt><dd>{f.coop}</dd>
                <dt>Counts</dt><dd>{Object.entries(f.counts).filter(([, v]) => v != null).map(([k, v]) => `${v} ${k}`).join(', ') || 'not stated'}</dd>
                <dt>Model</dt><dd className="muted">{g.model || '–'} · {fmtDate(g.tagged_at)} · confidence {f.confidence}</dd>
              </dl>
            </>
          ) : <p className="muted">Not tagged yet.</p>}
          {admin && (
            <div className="actions">
              <button onClick={() => flag({ owned: !g.owned })} disabled={!!busy}>{g.owned ? 'Unmark owned' : 'Mark owned'}</button>
              <button onClick={() => flag({ never: !g.never })} disabled={!!busy}>{g.never ? 'Allow again' : 'Never recommend'}</button>
              {f ? <a className="button" href={`#/queue/${g.appid}`}>Edit facets</a> : null}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
