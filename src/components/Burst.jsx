import React, { useEffect, useState } from 'react';

// Coin burst on a click. Eight gold pixels fly out and fade. Pure CSS animation, no canvas.
export function useBurst() {
  const [bursts, setBursts] = useState([]);
  const fire = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const id = Date.now();
    setBursts((b) => [...b, { id, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }]);
    setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 900);
  };
  const node = bursts.map((b) => <BurstNode key={b.id} x={b.x} y={b.y} />);
  return [fire, node];
}

function BurstNode({ x, y }) {
  return (
    <span className="burst" style={{ left: x, top: y }} aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--a': `${(i / 10) * 360}deg`, '--d': `${34 + (i % 3) * 14}px` }} />)}
    </span>
  );
}
