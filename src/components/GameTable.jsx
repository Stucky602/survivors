import React from 'react';
import { money, fmtDate, daysUntil, getPsPlus } from '../api.js';
import { dealVerdict } from '../../shared/score.js';
import XpBar from './XpBar.jsx';
import Ps5Plan from './Ps5Plan.jsx';

export const CATEGORY_LABEL = {
  perfect_fit: 'Perfect fit', progression_monster: 'Progression monster', pure_survivor: 'Pure survivor', survivor_hybrid: 'Hybrid',
  hub_gem: 'Hub gem', wildcard: 'Wildcard', conditional_action_roguelite: 'Action roguelite', do_not_recommend: 'No', other: 'Other'
};

export function Price({ g }) {
  const p = g.psn;
  if (!p) return <span className="muted">{g.psn_status === 'review' ? 'match pending' : 'not on PSN'}</span>;
  if (p.is_delisted) return <span className="muted">delisted</span>;
  const tier = getPsPlus();
  const inCatalog = (tier === 'extra' && p.psp_extra) || (tier === 'premium' && (p.psp_extra || p.psp_premium));
  if (p.is_preorder) return <span>{p.f_base} <span className="muted">preorder</span></span>;
  const v = dealVerdict(p);
  if (p.is_on_sale) {
    return <span><b className="sale">{p.f_sale}</b> <s className="muted">{p.f_base}</s>{v && v.kind === 'best' ? <span className="sale"> {v.text.toLowerCase()}</span> : v && v.kind === 'wait' ? <span className="muted"> {v.text.toLowerCase()}</span> : null}{inCatalog ? <span className="flag">PS Plus</span> : null}</span>;
  }
  return <span>{p.f_base}{inCatalog ? <span className="flag">PS Plus</span> : null}</span>;
}

export default function GameTable({ games, columns = ['score', 'category', 'price', 'sale_end', 'psn_rating', 'steam'], empty = 'Nothing here yet.', compare, onCompare }) {
  if (!games || !games.length) return <p className="empty">{empty}</p>;
  const has = (c) => columns.includes(c);
  return (
    <table className="games">
      <thead>
        <tr>
          <th className="num">{has('score') ? 'Score' : ''}</th>
          <th className="thumb"></th>
          <th>Game</th>
          {has('category') && <th>Category</th>}
          {has('price') && <th>PS Store</th>}
          {has('sale_end') && <th>Sale ends</th>}
          {has('release') && <th>Release</th>}
          {has('ps5plan') && <th>PlayStation</th>}
          {has('psn_rating') && <th className="num">PS rating</th>}
          {has('steam') && <th className="num">Steam</th>}
          {compare && <th></th>}
        </tr>
      </thead>
      <tbody>
        {games.map((g) => {
          const steamN = (g.steam_pos || 0) + (g.steam_neg || 0);
          const steamPct = steamN ? Math.round((100 * (g.steam_pos || 0)) / steamN) : null;
          const days = g.psn && g.psn.is_on_sale ? daysUntil(g.psn.discounted_until) : null;
          return (
            <tr key={g.appid} className={g.owned ? 'owned' : g.never ? 'never' : ''}>
              <td className="scorecell">{has('score') ? <XpBar score={g.score} /> : ''}</td>
              <td className="thumb">{g.header_img ? <a href={`#/game/${g.appid}`}><img src={g.header_img} alt="" loading="lazy" width="92" height="43" /></a> : null}</td>
              <td>
                <a href={`#/game/${g.appid}`}>{g.name}</a>
                {g.want ? <span className="flag want">want</span> : null}
                {g.owned ? <span className="flag">owned</span> : null}
                {g.never ? <span className="flag">no</span> : null}
                {g.needs_review ? <span className="flag">review</span> : null}
                <div className="sub">
                  {g.developer || ''}
                  {g.facets ? <>{g.developer ? ', ' : ''}{g.facets.combat_class.replace(/_/g, ' ')}{g.facets.hub_type === 'authored' ? ', authored hub' : ''}{g.facets.prestige ? ', prestige' : ''}{g.facets.run_length_minutes ? `, ${g.facets.run_length_minutes} min runs` : ''}</> : null}
                  {g.hours_median != null ? <span className="muted">{g.developer || g.facets ? ', ' : ''}~{g.hours_median}h per reviewer</span> : null}
                </div>
              </td>
              {has('category') && <td>{g.category ? CATEGORY_LABEL[g.category] || g.category : <span className="muted">untagged</span>}</td>}
              {has('price') && <td><Price g={g} /></td>}
              {has('sale_end') && <td>{days != null ? (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days`) : ''}</td>}
              {has('release') && <td>{g.psn && g.psn.release_date ? fmtDate(g.psn.release_date) : (g.steam_release ? <span className="muted">Steam {g.steam_release}</span> : '')}</td>}
              {has('ps5plan') && <td><Ps5Plan g={g} /></td>}
              {has('psn_rating') && <td className="num">{g.psn && g.psn.star_rating ? `${Number(g.psn.star_rating).toFixed(1)} (${g.psn.star_count})` : ''}</td>}
              {has('steam') && <td className="num">{steamPct != null ? `${steamPct}% (${steamN})` : ''}</td>}
              {compare && <td><label className="check"><input type="checkbox" checked={compare.includes(g.appid)} onChange={() => onCompare(g.appid)} /> compare</label></td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
