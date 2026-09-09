import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import GameTable from '../components/GameTable.jsx';

export default function Upcoming() {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/games?view=upcoming').then((d) => setGames(d.games)).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="bar warn">{err}</p>;
  if (!games) return <p className="muted">Loading</p>;
  const preorders = games.filter((g) => g.psn && g.psn.is_preorder);
  const waiting = games.filter((g) => !g.psn || !g.psn.is_preorder).filter((g) => !g.owned);
  return (
    <>
      <h1>Upcoming</h1>
      <h2>Preorder on the PS Store</h2>
      <GameTable games={preorders} columns={['score', 'category', 'price', 'release', 'steam']} empty="No preorders in the tracked set." />
      <h2>On Steam, no PS Store listing yet</h2>
      <p className="muted">Sorted by taste score. Unmatched games get rechecked weekly.</p>
      <GameTable games={waiting} columns={['score', 'category', 'release', 'steam']} empty="Every tracked game has a PS Store listing." />
    </>
  );
}
