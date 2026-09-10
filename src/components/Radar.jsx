import React from 'react';

// The RPG stat wheel. Eight axes, 0-10, drawn as SVG. Pass two facet sets to overlay a comparison.
const AXES = [
  ['combat_purity', 'Combat'], ['progression_depth', 'Progression'], ['content_longevity', 'Content'], ['build_variety', 'Builds'],
  ['hub', 'Hub'], ['session_fit', 'Sessions'], ['presentation', 'Polish'], ['quality', 'Quality']
];

export default function Radar({ facets, other = null, size = 240, labels = true }) {
  const c = size / 2, r = size / 2 - (labels ? 34 : 8);
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i / AXES.length) * Math.PI * 2;
    return [c + Math.cos(a) * r * (v / 10), c + Math.sin(a) * r * (v / 10)];
  };
  const poly = (f) => AXES.map(([k], i) => pt(i, Math.max(0, Math.min(10, Number(f?.[k]) || 0))).join(',')).join(' ');
  const rings = [2.5, 5, 7.5, 10];
  return (
    <svg className="radar" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Stat wheel">
      {rings.map((v) => <polygon key={v} points={AXES.map((_, i) => pt(i, v).join(',')).join(' ')} fill="none" stroke="#2c2740" strokeWidth="1" />)}
      {AXES.map((_, i) => { const [x, y] = pt(i, 10); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="#2c2740" strokeWidth="1" />; })}
      {other ? <polygon points={poly(other)} fill="rgba(217,70,62,0.18)" stroke="#d9463e" strokeWidth="1.5" /> : null}
      <polygon points={poly(facets)} fill="rgba(79,195,255,0.22)" stroke="#4fc3ff" strokeWidth="2" />
      {AXES.map(([k], i) => { const [x, y] = pt(i, Math.max(0, Math.min(10, Number(facets?.[k]) || 0))); return <rect key={k} x={x - 2} y={y - 2} width="4" height="4" fill="#f5c542" />; })}
      {labels && AXES.map(([k, label], i) => { const [x, y] = pt(i, 12.6); return <text key={k} x={x} y={y} fontSize="9" fontFamily="Silkscreen, monospace" fill="#9b95ad" textAnchor="middle" dominantBaseline="middle">{label}</text>; })}
    </svg>
  );
}
