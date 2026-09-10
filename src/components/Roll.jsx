import React, { useEffect, useRef, useState } from 'react';
import XpBar from './XpBar.jsx';
import { Price } from './GameTable.jsx';

// Can't decide? Roll. Cycles cover art like a slot reel, slows, lands on one. Weighted toward higher scores.
export default function Roll({ pool }) {
  const [shown, setShown] = useState(null);
  const [rolling, setRolling] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!pool || pool.length < 3) return null;
  const pickWeighted = () => {
    const w = pool.map((g) => Math.max(1, (g.score || 50) - 40));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  };
  const roll = () => {
    if (rolling) return;
    setRolling(true);
    const target = pickWeighted();
    let delay = 60, steps = 0;
    const tick = () => {
      steps++;
      if (delay > 420) { setShown(target); setRolling(false); return; }
      setShown(pool[Math.floor(Math.random() * pool.length)]);
      delay = steps < 12 ? 60 : delay * 1.22;
      timer.current = setTimeout(tick, delay);
    };
    tick();
  };
  return (
    <div className="roll">
      <div className="roll-reel">
        {shown ? (
          <a href={rolling ? undefined : `#/game/${shown.appid}`} className={`roll-card${rolling ? ' spinning' : ''}`}>
            {shown.header_img ? <img src={shown.header_img} alt="" /> : <div className="pick-blank" />}
            <div className="roll-name">{shown.name}</div>
            {!rolling && <><XpBar score={shown.score} size="card" /><div className="pick-price"><Price g={shown} /></div></>}
          </a>
        ) : <div className="roll-card empty"><div className="pick-blank" /><div className="roll-name muted">Press roll</div></div>}
      </div>
      <button className="primary" onClick={roll} disabled={rolling}>{rolling ? 'Rolling' : shown ? 'Roll again' : 'Roll a pick'}</button>
      <p className="muted">From games on the PS Store scoring 55 or better that you don't own. Higher scores come up more often.</p>
    </div>
  );
}
