import React, { useEffect, useState } from 'react';

// A score is a level. 0-100 becomes a bar with the number set in the pixel face.
export default function XpBar({ score, size = 'row' }) {
  if (score == null) return <span className="xp none">untagged</span>;
  const tier = score >= 85 ? 'gold' : score >= 70 ? 'gem' : score >= 50 ? 'dim' : 'low';
  const [w, setW] = useState(0);
  useEffect(() => { const id = requestAnimationFrame(() => setW(score)); return () => cancelAnimationFrame(id); }, [score]);
  return (
    <span className={`xp ${size} ${tier}`} title={`Score ${score} of 100`}>
      <span className="xp-track"><span className="xp-fill" style={{ width: `${w}%` }} /></span>
      <span className="xp-num">{score}</span>
    </span>
  );
}
