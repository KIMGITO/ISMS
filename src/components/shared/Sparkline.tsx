// src/components/shared/Sparkline.tsx
// A tiny trend line for a figure (Home key figures, StatTile).

import React from 'react';

export function Sparkline({ values, color, className = 'h-8' }: { values: number[]; color: string; className?: string }) {
  if (values.length < 2) return <div className={className} />;
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - lo) / (hi - lo || 1)) * 26 - 2}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`${className} w-full`} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default Sparkline;
