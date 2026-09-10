import React from 'react';
import { fmtDate } from '../api.js';

export const PLAN_LABEL = {
  announced_date: 'PS5 date announced',
  announced_window: 'PS5 window announced',
  announced: 'PS5 version announced',
  planned: 'Consoles planned',
  not_planned: 'Not currently planned',
  unknown: 'Nothing announced'
};

// One line: what is known about a PlayStation release for a game without a listing.
export default function Ps5Plan({ g, long = false }) {
  if (g.psn) {
    if (g.psn.is_preorder) return <span>PS Store {fmtDate(g.psn.release_date)} <span className="muted">(preorder)</span></span>;
    return <span>On the PS Store{g.psn.release_date ? ` since ${fmtDate(g.psn.release_date)}` : ''}</span>;
  }
  const p = g.ps5_plan;
  if (!p) return <span className="muted">Not checked yet</span>;
  let main;
  if (p.status === 'announced_date') main = <b className="sale">{fmtDate(p.date)}</b>;
  else if (p.status === 'announced_window') main = <b className="sale">{p.window}</b>;
  else if (p.status === 'announced') main = <span className="sale">{PLAN_LABEL.announced}</span>;
  else if (p.status === 'planned') main = <span>{PLAN_LABEL.planned}</span>;
  else if (p.status === 'not_planned') main = <span className="warn-text">{PLAN_LABEL.not_planned}</span>;
  else main = <span className="muted">{PLAN_LABEL.unknown}</span>;
  return <span>{main}{long && p.note ? <span className="muted"> — “{p.note}”</span> : null}</span>;
}
