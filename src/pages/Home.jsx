import React, { useEffect, useState } from 'react';
import { api, getLastVisit, markVisit, getToken } from '../api.js';
import GameTable, { Price, CATEGORY_LABEL } from '../components/GameTable.jsx';
import Horde from '../components/Horde.jsx';
import XpBar from '../components/XpBar.jsx';

export default function Home({ meta }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [since] = useState(getLastVisit());
  useEffect(() => {
    const s = since || new Date(Date.now() - 7 * 864e5).toISOString();
    api(`/home?since=${encodeURIComponent(s)}`).then((x) => { setD(x); markVisit(); }).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="bar warn">{err}</p>;
  if (!d) return <p className="muted">Loading the run</p>;
  const empty = meta && meta.counts && !meta.counts.total;
  const sinceLabel = since ? `since ${since.slice(0, 10)}` : 'in the last 7 days';
  const nothingNew = !d.ending.length && !d.newSales.length && !d.newOnPsn.length && !d.releasing.length && !d.drops.length;

  return (
    <>
      <section className="hero">
        <Horde height={150} />
        <div className="hero-text">
          <h1>Survivors on the PS Store</h1>
          <p>Every bullet heaven on Steam, followed onto PlayStation. Scored against one taste: auto-fire, deep progression, a hub that grows.</p>
          {meta && meta.counts ? (
            <ul className="runstats">
              <li><b>{meta.counts.enriched || 0}</b> tracked</li>
              <li><b>{meta.counts.matched || 0}</b> on the PS Store</li>
              <li><b>{meta.counts.not_listed || 0}</b> waiting for a port</li>
              <li><b>{d.newSales.length + d.ending.length}</b> live deals worth a look</li>
            </ul>
          ) : null}
        </div>
      </section>
      {empty && <p className="bar">The catalog is empty. {getToken() ? <a href="#/queue">Run Discover in Queue</a> : <a href="#/settings">Enter the admin token</a>} to start.</p>}

      {d.drops.length > 0 && (<>
        <h2>Wanted games that dropped below the price when you added them</h2>
        <GameTable games={d.drops} columns={['score', 'price', 'sale_end']} />
      </>)}

      <h2>Sales ending in the next 3 days</h2>
      <GameTable games={d.ending} columns={['score', 'category', 'price', 'sale_end']} empty="No tracked sale ends this week." />

      <h2>New sales {sinceLabel}</h2>
      <GameTable games={d.newSales} columns={['score', 'category', 'price', 'sale_end']} empty="No new discounts on tracked games." />

      <h2>New on the PS Store {sinceLabel}</h2>
      <GameTable games={d.newOnPsn} columns={['score', 'category', 'price', 'release']} empty="No new PS Store listings found." />

      <h2>Releasing in the next 30 days</h2>
      <GameTable games={d.releasing} columns={['score', 'category', 'price', 'release']} empty="No tracked preorders with a date inside 30 days." />

      <h2>Your wanted list</h2>
      <GameTable games={d.wanted} columns={['score', 'price', 'sale_end']} empty="Nothing wanted yet. Mark games from their page." />

      <h2>Best fits you don't own</h2>
      {d.picks.length ? (
        <div className="picks">
          {d.picks.map((g) => (
            <a key={g.appid} className="pick" href={`#/game/${g.appid}`}>
              {g.header_img ? <img src={g.header_img} alt="" loading="lazy" /> : <div className="pick-blank" />}
              <div className="pick-body">
                <div className="pick-name">{g.name}</div>
                <XpBar score={g.score} size="card" />
                <div className="pick-meta">{CATEGORY_LABEL[g.category] || g.category}</div>
                <div className="pick-price"><Price g={g} /></div>
              </div>
            </a>
          ))}
        </div>
      ) : <p className="empty">Nothing scored yet.</p>}

      {nothingNew && !empty && <p className="muted">Quiet week. Nothing changed on the store side for tracked games.</p>}
    </>
  );
}
