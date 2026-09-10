import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import GameTable from '../components/GameTable.jsx';

export default function Upcoming({ meta }) {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/games?view=upcoming').then((d) => setGames(d.games)).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="bar warn">{err}</p>;
  if (!games) return <p className="muted">Loading the run</p>;
  const parseDate = (x) => { const t = Date.parse(x || ''); return Number.isFinite(t) ? t : 9e15; };
  const preorders = games.filter((g) => g.psn && g.psn.is_preorder).sort((a, b) => String(a.psn.release_date).localeCompare(String(b.psn.release_date)));
  const notOut = games.filter((g) => !(g.psn && g.psn.is_preorder)).filter((g) => !g.owned).sort((a, b) => parseDate(a.steam_release) - parseDate(b.steam_release));
  return (
    <>
      <h1>Upcoming</h1>
      <p className="muted">Games not out yet. Already-released Steam games waiting on a port are under <a href="#/onsteam">On Steam</a>.</p>
      <h2>Preorder on the PS Store ({preorders.length})</h2>
      <GameTable games={preorders} columns={['score', 'category', 'price', 'ps5plan', 'steam']} empty="No preorders in the tracked set." />
      <h2>Not out anywhere yet ({notOut.length})</h2>
      <p className="muted">Sorted by Steam release date where one is given. The PlayStation column shows what the developer has said; a PS4 version counts, it plays on PS5.</p>
      <GameTable games={notOut} columns={['score', 'category', 'release', 'ps5plan']} empty="No unreleased games in the tracked set." />
    </>
  );
}
