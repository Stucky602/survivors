import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import GameTable from '../components/GameTable.jsx';

export default function OnSale() {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState('');
  const [hideOwned, setHideOwned] = useState(true);
  useEffect(() => { api('/games?view=sale').then((d) => setGames(d.games)).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="bar warn">{err}</p>;
  if (!games) return <p className="muted">Loading</p>;
  const shown = games.filter((g) => !(hideOwned && g.owned)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return (
    <>
      <h1>On sale</h1>
      <label className="check"><input type="checkbox" checked={hideOwned} onChange={(e) => setHideOwned(e.target.checked)} /> Hide owned</label>
      <GameTable games={shown} columns={['score', 'category', 'price', 'sale_end', 'psn_rating', 'steam']} empty="Nothing in the tracked set is discounted right now." />
    </>
  );
}
