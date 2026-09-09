import React from 'react';
import { money, fmtDate } from '../api.js';

export const CATEGORY_LABEL = {
  perfect_fit: 'Perfect fit', progression_monster: 'Progression monster', pure_survivor: 'Pure survivor', survivor_hybrid: 'Hybrid',
  hub_gem: 'Hub gem', wildcard: 'Wildcard', conditional_action_roguelite: 'Action roguelite', do_not_recommend: 'No', other: 'Other'
};

function Price({ g }) {
  const p = g.psn;
  if (!p) return <span className="muted">{g.psn_status === 'review' ? 'match pending' : 'not on PSN'}</span>;
  if (p.is_delisted) return <span className="muted">delisted</span>;
  if (p.is_preorder) return <span>{p.f_base} <span className="muted">preorder</span></span>;
  if (p.is_on_sale) {
    const low = p.lowest_seen != null && p.sale_price != null && p.sale_price <= p.lowest_seen;
    return <span><b className="sale">{p.f_sale}</b> <s className="muted">{p.f_base}</s> {low ? <span className="sale">lowest seen</span> : null}</span>;
  }
  return <span>{p.f_base}</span>;
}

export default function GameTable({ games, columns = ['score', 'category', 'price', 'sale_end', 'psn_rating', 'steam'], empty = 'Nothing here yet.' }) {
  if (!games || !games.length) return <p className="empty">{empty}</p>;
  const has = (c) => columns.includes(c);
  return (
    <table className="games">
      <thead>
        <tr>
          <th className="num">{has('score') ? 'Score' : ''}</th>
          <th>Game</th>
          {has('category') && <th>Category</th>}
          {has('price') && <th>PS Store</th>}
          {has('sale_end') && <th>Sale ends</th>}
          {has('release') && <th>Release</th>}
          {has('psn_rating') && <th className="num">PS rating</th>}
          {has('steam') && <th className="num">Steam</th>}
        </tr>
      </thead>
      <tbody>
        {games.map((g) => {
          const steamN = (g.steam_pos || 0) + (g.steam_neg || 0);
          const steamPct = steamN ? Math.round((100 * (g.steam_pos || 0)) / steamN) : null;
          return (
            <tr key={g.appid} className={g.owned ? 'owned' : g.never ? 'never' : ''}>
              <td className="num">{has('score') ? (g.score != null ? g.score : <span className="muted">–</span>) : ''}</td>
              <td>
                <a href={`#/game/${g.appid}`}>{g.name}</a>
                {g.owned ? <span className="flag">owned</span> : null}
                {g.never ? <span className="flag">no</span> : null}
                {g.needs_review ? <span className="flag">review</span> : null}
                <div className="sub">
                  {g.developer || ''}
                  {g.facets ? <> · {g.facets.combat_class.replace(/_/g, ' ')}{g.facets.hub_type === 'authored' ? ' · authored hub' : ''}{g.facets.prestige ? ' · prestige' : ''}</> : null}
                </div>
              </td>
              {has('category') && <td>{g.category ? CATEGORY_LABEL[g.category] || g.category : <span className="muted">untagged</span>}</td>}
              {has('price') && <td><Price g={g} /></td>}
              {has('sale_end') && <td>{g.psn && g.psn.is_on_sale ? fmtDate(g.psn.discounted_until) : ''}</td>}
              {has('release') && <td>{g.psn && g.psn.release_date ? fmtDate(g.psn.release_date) : (g.steam_release ? <span className="muted">Steam {g.steam_release}</span> : '')}</td>}
              {has('psn_rating') && <td className="num">{g.psn && g.psn.star_rating ? `${Number(g.psn.star_rating).toFixed(1)} (${g.psn.star_count})` : ''}</td>}
              {has('steam') && <td className="num">{steamPct != null ? `${steamPct}% (${steamN})` : ''}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
