import React, { useEffect, useRef } from 'react';

// The Home hero: a slow pixel horde drifting toward the middle, the way a run looks at minute 12.
// Canvas, no library. Static frame when the user prefers reduced motion. Capped at 140 sprites.
export default function Horde({ height = 150 }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, raf = 0, sprites = [], gems = [];
    let px_ = null, py_ = null, cxL = 0, cyL = 0;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const resize = () => { w = c.width = c.clientWidth; h = c.height = height; seed(); };
    const seed = () => {
      const n = Math.min(140, Math.floor(w / 7));
      sprites = Array.from({ length: n }, () => spawn(true));
      gems = Array.from({ length: Math.floor(n / 6) }, () => ({ x: rnd(0, w), y: rnd(0, h), t: rnd(0, 6.28) }));
    };
    const spawn = (anywhere) => {
      const edge = Math.floor(rnd(0, 4));
      const x = anywhere ? rnd(0, w) : edge === 0 ? -8 : edge === 1 ? w + 8 : rnd(0, w);
      const y = anywhere ? rnd(0, h) : edge === 2 ? -8 : edge === 3 ? h + 8 : rnd(0, h);
      const kind = Math.random();
      return { x, y, s: rnd(0.12, 0.42), size: kind < 0.15 ? 6 : 4, wob: rnd(0, 6.28), kind };
    };
    const px = (x, y, size, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), size, size); };
    const draw = (t) => {
      ctx.clearRect(0, 0, w, h);
      const cx = cxL || w * 0.5, cy = cyL || h * 0.55;
      // gems
      for (const g of gems) { const p = 0.6 + 0.4 * Math.sin(t / 400 + g.t); ctx.globalAlpha = p; px(g.x, g.y, 3, '#4fc3ff'); }
      ctx.globalAlpha = 1;
      // enemies: bats (dark), skeletons (bone), one or two big reds
      for (const e of sprites) {
        const col = e.kind < 0.15 ? '#d9463e' : e.kind < 0.55 ? '#6f6a8a' : '#b9b3a3';
        px(e.x, e.y, e.size, col);
        if (e.size === 6) { px(e.x + 1, e.y + 1, 1, '#12101a'); px(e.x + 4, e.y + 1, 1, '#12101a'); }
        else { px(e.x + 1, e.y + 1, 1, '#12101a'); }
      }
      // the player: a lit square with a whip arc
      px(cx - 3, cy - 3, 6, '#f5c542');
      ctx.strokeStyle = 'rgba(245,197,66,0.55)'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.arc(cx, cy, 26 + 4 * Math.sin(t / 250), -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 26 + 4 * Math.cos(t / 250), Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
    };
    const step = (t) => {
      // the player drifts toward the pointer when there is one, otherwise sits mid-field
      const tx = px_ ?? w * 0.5, ty = py_ ?? h * 0.55;
      cxL = (cxL || tx) + (tx - (cxL || tx)) * 0.08; cyL = (cyL || ty) + (ty - (cyL || ty)) * 0.08;
      const cx = cxL, cy = cyL;
      for (let i = 0; i < sprites.length; i++) {
        const e = sprites[i];
        const dx = cx - e.x, dy = cy - e.y, d = Math.hypot(dx, dy) || 1;
        e.x += (dx / d) * e.s + Math.sin(t / 300 + e.wob) * 0.25;
        e.y += (dy / d) * e.s * 0.7;
        if (d < 30) sprites[i] = spawn(false);
      }
      draw(t);
      raf = requestAnimationFrame(step);
    };
    let paused = reduce || localStorage.getItem('survivors.horde') === 'off';
    const start = () => { if (!paused && !raf) raf = requestAnimationFrame(step); };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const onVis = () => (document.hidden ? stop() : start());
    const onMove = (e) => { const r = c.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; px_ = p.clientX - r.left; py_ = p.clientY - r.top; };
    const onLeave = () => { px_ = null; py_ = null; };
    const onClick = () => { paused = !paused; localStorage.setItem('survivors.horde', paused ? 'off' : 'on'); if (paused) { stop(); draw(0); } else start(); };
    resize();
    addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVis);
    c.addEventListener('click', onClick);
    c.addEventListener('mousemove', onMove); c.addEventListener('touchmove', onMove, { passive: true }); c.addEventListener('mouseleave', onLeave); c.addEventListener('touchend', onLeave);
    if (paused) draw(0); else start();
    return () => { stop(); removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis); c.removeEventListener('click', onClick); c.removeEventListener('mousemove', onMove); c.removeEventListener('touchmove', onMove); c.removeEventListener('mouseleave', onLeave); c.removeEventListener('touchend', onLeave); };
  }, [height]);
  return <canvas ref={ref} className="horde" style={{ height }} title="Move to steer, click to pause" aria-hidden="true" />;
}
