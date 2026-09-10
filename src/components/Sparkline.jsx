import React from 'react';

// Price line from snapshots. Plain SVG, one path, no library.
export default function Sparkline({ points, width = 260, height = 56 }) {
  const ys = points.map((p) => p.sale_price ?? p.base_price).filter((v) => v != null);
  if (ys.length < 2) return null;
  const xs = points.map((p) => new Date(p.observed_at).getTime());
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 4;
  const sx = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - pad * 2);
  const sy = (y) => height - pad - ((y - y0) / (y1 - y0 || 1)) * (height - pad * 2);
  // step line: price holds until the next observation
  let d = '';
  points.forEach((p, i) => {
    const y = p.sale_price ?? p.base_price;
    if (y == null) return;
    const X = sx(xs[i]), Y = sy(y);
    if (!d) d = `M${X},${Y}`;
    else d += ` H${X} V${Y}`;
  });
  d += ` H${width - pad}`;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price history">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text x={pad} y={height - 1} fontSize="10" fill="#6b6b6b">${(y0 / 100).toFixed(2)}</text>
      <text x={width - pad} y={10} fontSize="10" fill="#6b6b6b" textAnchor="end">${(y1 / 100).toFixed(2)}</text>
    </svg>
  );
}
