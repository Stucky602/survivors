import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import GameTable from '../components/GameTable.jsx';
import { PLAN_LABEL } from '../components/Ps5Plan.jsx';

const GROUPS = [
  ['announced_date', 'PS5 date announced'],
  ['announced_window', 'PS5 window announced'],
  ['announced', 'PS5 version announced, no date'],
  ['planned', 'Consoles planned, PlayStation not confirmed'],
  ['unknown', 'Nothing announced'],
  ['not_planned', 'Not currently planned']
];

export default function OnSteam({ meta }) {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState('');
  const [hideOwned, setHideOwned] = useState(true);
  useEffect(() => { api('/games?view=steamonly').then((d) => setGames(d.games)).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="bar warn">{err}</p>;
  if (!games) return <p className="muted">Loading the run</p>;
  const shown = games.filter((g) => !(hideOwned && g.owned));
  const noKey = meta && meta.has_platprices_key === false;
  const unchecked = shown.filter((g) => !g.ps5_plan);
  const byStatus = (st) => shown.filter((g) => g.ps5_plan && g.ps5_plan.status === st).sort((a, b) => st === 'announced_date' ? String(a.ps5_plan.date).localeCompare(String(b.ps5_plan.date)) : (b.score ?? -1) - (a.score ?? -1));
  const cols = ['score', 'category', 'release', 'ps5plan', 'steam'];
  return (
    <>
      <h1>On Steam, not on the PS Store</h1>
      <p className="muted">{shown.length} games, sorted by taste score inside each group. What each developer has said about a PlayStation release, read from their Steam news posts and store page.{noKey ? ' These have not been checked against the PS Store yet because the PlatPrices key is not on the worker; some are already on PS5 and will move to the PS Store page once matching runs.' : ' Rechecked against the PS Store weekly.'}</p>
      <label className="check"><input type="checkbox" checked={hideOwned} onChange={(e) => setHideOwned(e.target.checked)} /> Hide owned</label>
      {GROUPS.map(([st, label]) => {
        const list = byStatus(st);
        if (!list.length) return null;
        return (<React.Fragment key={st}><h2>{label} ({list.length})</h2><GameTable games={list} columns={cols} /></React.Fragment>);
      })}
      {unchecked.length > 0 && (<><h2>Not checked for plans yet ({unchecked.length})</h2><p className="muted">The plans step reads each game's news feed; the Runner gets to these after tagging.</p><GameTable games={unchecked} columns={cols} /></>)}
      {shown.length === 0 && <p className="empty">Nothing here. Every tracked game is either on the PS Store or not released on Steam yet.</p>}
    </>
  );
}
