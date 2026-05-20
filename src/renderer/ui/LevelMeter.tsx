import React from 'react';
import { shadows } from '../styles/neumorphic';

interface Props {
  level: number; // 0..1
  peak: number; // 0..1
  label: string;
  orientation?: 'vertical' | 'horizontal';
  height?: number;
  width?: number;
}

const SEGMENTS = 24;

export function LevelMeter({
  level,
  peak,
  label,
  orientation = 'vertical',
  height = 220,
  width = 36,
}: Props) {
  const vertical = orientation === 'vertical';
  const lit = Math.round(level * SEGMENTS);
  const peakSeg = Math.round(peak * SEGMENTS);

  const segments = Array.from({ length: SEGMENTS }, (_, i) => {
    // i=0 is bottom (vertical) or left (horizontal)
    const isLit = i < lit;
    const isPeak = i === peakSeg - 1 && peakSeg > 0;
    const color = colorFor(i);
    const opacity = isLit ? 1 : isPeak ? 0.85 : 0.12;
    return (
      <div
        key={i}
        style={{
          flex: 1,
          background: color,
          opacity,
          borderRadius: 2,
          boxShadow: isLit ? `0 0 6px ${color}88` : 'none',
        }}
      />
    );
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div
        style={{
          background: 'var(--bg)',
          borderRadius: 14,
          boxShadow: shadows.insetSm,
          padding: 8,
          width: vertical ? width : height,
          height: vertical ? height : width,
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: vertical ? 'column-reverse' : 'row',
            gap: 2,
          }}
        >
          {segments}
        </div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </span>
    </div>
  );
}

function colorFor(i: number): string {
  // bottom = green, middle = yellow, top = red
  if (i < SEGMENTS * 0.6) return '#4ecdc4';
  if (i < SEGMENTS * 0.85) return '#ffd166';
  return '#ff6b6b';
}
