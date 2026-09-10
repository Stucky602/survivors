import React, { useEffect, useState } from 'react';
import { api, daysUntil, getFilters, setFilters } from '../api.js';
import GameTable from '../components/GameTable.jsx';
import { dealVerdict } from '../../shared/score.js';

export default function OnSale() {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState('');
  const saved = getFilters('sale', { hideOwned: true, sort: 'score' });
  const [hideOwned, setHideOwnedState] = useState(saved.hideOwned);
  const [sort, setSortState] = useState(saved.sort);
  const setHideOwned = (v) => { setHideOwnedState(v); setFilters('sale', { hideOwned: v, sort }); };
  const setSort = (v) => { setSortState(v); setFilters('sale', { hideOwned, sort: v }); };
  useEffect(() => { api('/games?view=sale').then((d) => setGames(d.games)).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="bar warn">{err}</p>;
  if (!games) return <p className="muted">Loading the run</p>;
  const sorters = {
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
    ending: (a, b) => (daysUntil(a.psn.discounted_until) ?? 999) - (daysUntil(b.psn.discounted_until) ?? 999),
    discount: (a, b) => (b.psn.disc_perc || 0) - (a.psn.disc_perc || 0),
    price: (a, b) => (a.psn.sale_price ?? 1e9) - (b.psn.sale_price ?? 1e9)
  };
  const all = games.filter((g) => !(hideOwned && g.owned)).sort(sorters[sort]);
  const best = all.filter((g) => { const v = dealVerdict(g.psn); return v && v.kind === 'best'; });
  const soon = all.filter((g) => { const dd = daysUntil(g.psn.discounted_until); return dd != null && dd <= 3; });
  return (
    <>
      <h1>On sale</h1>
      <div className="filters">
        <label className="check"><input type="checkbox" checked={hideOwned} onChange={(e) => setHideOwned(e.target.checked)} /> Hide owned</label>
        <label>Sort <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="score">score</option><option value="ending">ending soonest</option><option value="discount">discount</option><option value="price">price</option></select></label>
        <span className="muted">{all.length} tracked games discounted. Prices via <a href="https://platprices.com" target="_blank" rel="noreferrer">PlatPrices</a>.</span>
      </div>
      {best.length > 0 && (<><h2>At their lowest recorded price</h2><GameTable games={best} columns={['score', 'category', 'price', 'sale_end', 'psn_rating']} /></>)}
      {soon.length > 0 && (<><h2>Ending within 3 days</h2><GameTable games={soon} columns={['score', 'category', 'price', 'sale_end', 'psn_rating']} /></>)}
      <h2>Everything on sale</h2>
      <GameTable games={all} columns={['score', 'category', 'price', 'sale_end', 'psn_rating', 'steam']} empty="Nothing in the tracked set is discounted right now." />
    </>
  );
}
