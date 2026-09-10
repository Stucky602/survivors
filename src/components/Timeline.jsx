import React from 'react';

// Games per quarter by Steam release date. Blue = now on the PS Store, dim = Steam only.
export default function Timeline({ releases, years = 3 }) {
  const parse = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? new Date(t) : null; };
  const now = new Date();
  const start = new Date(now.getFullYear() - years, Math.floor(now.getMonth() / 3) * 3, 1);
  const buckets = [];
  for (let d = new Date(start); d <= now; d.setMonth(d.getMonth() + 3)) buckets.push({ key: `${d.getFullYear()}Q${Math.floor(d.getMonth() / 3) + 1}`, y: d.getFullYear(), q: Math.floor(d.getMonth() / 3) + 1, psn: 0, steam: 0 });
  for (const r of releases || []) {
    const d = parse(r.steam_release); if (!d || d < start) continue;
    const b = buckets.find((x) => x.y === d.getFullYear() && x.q === Math.floor(d.getMonth() / 3) + 1);
    if (b) { if (r.psn_status === 'matched') b.psn++; else b.steam++; }
  }
  const max = Math.max(1, ...buckets.map((b) => b.psn + b.steam));
  const W = 640, H = 120, pad = 18, bw = (W - pad * 2) / buckets.length;
  if (!buckets.some((b) => b.psn + b.steam)) return null;
  return (
    <svg className="timeline" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Releases per quarter">
      {buckets.map((b, i) => {
        const total = b.psn + b.steam, hT = (total / max) * (H - pad * 2), hP = (b.psn / max) * (H - pad * 2);
        const x = pad + i * bw + 2, y = H - pad - hT;
        return (
          <g key={b.key}>
            <rect x={x} y={y} width={bw - 4} height={hT} fill="#3a3452" />
            <rect x={x} y={H - pad - hP} width={bw - 4} height={hP} fill="#4fc3ff" />
            {total ? <text x={x + (bw - 4) / 2} y={y - 3} fontSize="9" fontFamily="Silkscreen, monospace" fill="#9b95ad" textAnchor="middle">{total}</text> : null}
            {b.q === 1 ? <text x={x + (bw - 4) / 2} y={H - 4} fontSize="9" fontFamily="Silkscreen, monospace" fill="#9b95ad" textAnchor="middle">{b.y}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}
