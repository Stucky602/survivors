import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import GameTable from '../components/GameTable.jsx';

export default function Upcoming({ meta }) {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/games?view=upcoming').then((d) => setGames(d.games)).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="bar warn">{err}</p>;
  if (!games) return <p className="muted">Loading the run</p>;
  const preorders = games.filter((g) => g.psn && g.psn.is_preorder);
  const waiting = games.filter((g) => !g.psn || !g.psn.is_preorder).filter((g) => !g.owned);
  const parseDate = (x) => { const t = Date.parse(x || ''); return Number.isFinite(t) ? t : 0; };
  const comingSoon = waiting.filter((g) => g.coming_soon).sort((a, b) => parseDate(a.steam_release) - parseDate(b.steam_release));
  const onSteam = waiting.filter((g) => !g.coming_soon);
  return (
    <>
      <h1>Upcoming</h1>
      <h2>Preorder on the PS Store</h2>
      <GameTable games={preorders} columns={['score', 'category', 'price', 'release', 'steam']} empty="No preorders in the tracked set." />
      <h2>Not out on Steam yet either</h2>
      <GameTable games={comingSoon} columns={['score', 'category', 'release', 'steam']} empty="No unreleased games in the tracked set." />
      <h2>Out on Steam, no PS Store listing yet</h2>
      <p className="muted">{meta && meta.has_platprices_key === false ? 'These have not been checked against the PS Store yet: the Match step is waiting on the PlatPrices key. Many of them are on PS5; they move to the PS Store page as soon as matching runs. ' : 'Sorted by taste score. Unmatched games get rechecked weekly. Best fits here are the ports worth waiting for.'}</p>
      <GameTable games={onSteam} columns={['score', 'category', 'release', 'steam']} empty="Every tracked game has a PS Store listing." />
    </>
  );
}
