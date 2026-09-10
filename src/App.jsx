import React, { useEffect, useState } from 'react';
import Home from './pages/Home.jsx';
import Compare from './pages/Compare.jsx';
import Upcoming from './pages/Upcoming.jsx';
import OnSteam from './pages/OnSteam.jsx';
import Tiers from './pages/Tiers.jsx';
import OnSale from './pages/OnSale.jsx';
import Browse from './pages/Browse.jsx';
import Game from './pages/Game.jsx';
import Queue from './pages/Queue.jsx';
import Settings from './pages/Settings.jsx';
import { api, getToken } from './api.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

const ROUTES = [
  ['home', 'Home'],
  ['browse', 'PS Store'],
  ['sale', 'On sale'],
  ['upcoming', 'Upcoming'],
  ['onsteam', 'On Steam'],
  ['tiers', 'Tiers'],
  ['queue', 'Queue'],
  ['settings', 'Settings']
];

function useHash() {
  const [hash, setHash] = useState(location.hash.replace(/^#\/?/, '') || 'home');
  useEffect(() => {
    const on = () => setHash(location.hash.replace(/^#\/?/, '') || 'home');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHash();
  const [meta, setMeta] = useState(null);
  const [metaErr, setMetaErr] = useState('');
  const reloadMeta = () => api('/meta').then(setMeta).catch((e) => setMetaErr(e.message));
  useEffect(() => { reloadMeta(); }, [hash]);

  const [page, arg] = hash.split('/');
  let body;
  if (page === 'home') body = <Home meta={meta} />;
  else if (page === 'compare') body = <Compare ids={(arg || '').split(',').map(Number).filter(Boolean)} meta={meta} />;
  else if (page === 'upcoming') body = <Upcoming meta={meta} />;
  else if (page === 'onsteam') body = <OnSteam meta={meta} />;
  else if (page === 'tiers') body = <Tiers meta={meta} />;
  else if (page === 'sale') body = <OnSale meta={meta} />;
  else if (page === 'game') body = <Game appid={Number(arg)} meta={meta} />;
  else if (page === 'queue') body = <Queue meta={meta} onChange={reloadMeta} />;
  else if (page === 'settings') body = <Settings meta={meta} onChange={reloadMeta} />;
  else if (page === 'browse') body = <Browse meta={meta} />;
  else body = <Home meta={meta} />;

  const failed = meta && meta.runs ? meta.runs.filter((r) => r.ok === 0).map((r) => r.stage) : [];
  const noRuns = meta && (!meta.runs || meta.runs.length === 0);
  const admin = !!getToken();
  const queueCount = meta && meta.counts ? (meta.counts.review || 0) + (meta.counts.facets_review || 0) : 0;

  return (
    <div className="app">
      <header className="top">
        <div className="xpline" aria-hidden="true"><span style={{ width: `${meta && meta.counts && meta.counts.total ? Math.min(100, Math.round((100 * (meta.counts.matched || 0)) / meta.counts.total)) : 0}%` }} /></div>
        <a className="brand" href="#/home">Survivors</a>
        <nav>
          {ROUTES.map(([k, label]) => (
            <a key={k} href={`#/${k}`} className={page === k ? 'on' : ''}>{label}{k === 'queue' && admin && queueCount ? <span className="navcount">{queueCount}</span> : null}{k === 'sale' && meta && meta.counts && meta.counts.on_sale ? <span className="navcount">{meta.counts.on_sale}</span> : null}</a>
          ))}
        </nav>
      </header>
      {metaErr && <p className="bar warn">Can't reach the worker: {metaErr}</p>}
      {failed.length > 0 && admin && <p className="bar warn">Last run failed for: {failed.join(', ')}. <a href="#/queue">See Queue</a>.</p>}
      {meta && meta.prices_stale && <p className="bar warn">Prices are more than two days old. The refresh stage has not run; check Queue.</p>}
      {meta && admin && meta.has_platprices_key === false && <p className="bar">No PlatPrices key on the worker yet. Matching and prices wait until it is added under Variables and Secrets.</p>}
      {noRuns && !admin && <p className="bar">Nothing has run yet. Enter the admin token in Settings and run Discover.</p>}
      <main><ErrorBoundary resetKey={hash}>{body}</ErrorBoundary></main>
      <footer className="foot">
        {meta && meta.counts ? <span>{meta.counts.matched || 0} games on the PS Store, {meta.counts.not_listed || 0} Steam-only, {meta.counts.enriched || 0} tracked. </span> : null}
        {meta && meta.last_refresh ? <span>Prices refreshed {meta.last_refresh.slice(0, 16).replace('T', ' ')} UTC. </span> : <span>No price data yet. </span>}
        <span>Powered by <a href="https://platprices.com" target="_blank" rel="noreferrer">PlatPrices</a> for PlayStation Store prices. Steam data via Steam. Not affiliated with Sony, Valve, or PlatPrices.</span>
      </footer>
    </div>
  );
}
