import React, { useEffect, useState } from 'react';
import Upcoming from './pages/Upcoming.jsx';
import OnSale from './pages/OnSale.jsx';
import Browse from './pages/Browse.jsx';
import Game from './pages/Game.jsx';
import Queue from './pages/Queue.jsx';
import Settings from './pages/Settings.jsx';
import { api, getToken } from './api.js';

const ROUTES = [
  ['upcoming', 'Upcoming'],
  ['sale', 'On sale'],
  ['browse', 'Browse'],
  ['queue', 'Queue'],
  ['settings', 'Settings']
];

function useHash() {
  const [hash, setHash] = useState(location.hash.replace(/^#\/?/, '') || 'browse');
  useEffect(() => {
    const on = () => setHash(location.hash.replace(/^#\/?/, '') || 'browse');
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
  if (page === 'upcoming') body = <Upcoming meta={meta} />;
  else if (page === 'sale') body = <OnSale meta={meta} />;
  else if (page === 'game') body = <Game appid={Number(arg)} meta={meta} />;
  else if (page === 'queue') body = <Queue meta={meta} onChange={reloadMeta} />;
  else if (page === 'settings') body = <Settings meta={meta} onChange={reloadMeta} />;
  else body = <Browse meta={meta} />;

  const stale = meta && meta.runs && meta.runs.some((r) => r.ok === 0);
  const noRuns = meta && (!meta.runs || meta.runs.length === 0);

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#/browse">Survivors</a>
        <nav>
          {ROUTES.map(([k, label]) => (
            <a key={k} href={`#/${k}`} className={page === k ? 'on' : ''}>{label}</a>
          ))}
        </nav>
      </header>
      {metaErr && <p className="bar warn">Can't reach the worker: {metaErr}</p>}
      {stale && <p className="bar warn">A pipeline stage failed on its last run. See Queue.</p>}
      {noRuns && !getToken() && <p className="bar">Nothing has run yet. Enter the admin token in Settings and run Discover.</p>}
      <main>{body}</main>
      <footer className="foot">
        {meta && meta.last_refresh ? <span>Prices refreshed {meta.last_refresh.slice(0, 16).replace('T', ' ')} UTC. </span> : <span>No price data yet. </span>}
        <span>Prices via <a href="https://platprices.com" rel="noreferrer">PlatPrices</a>. Steam data via Steam. Not affiliated with Sony or Valve.</span>
      </footer>
    </div>
  );
}
