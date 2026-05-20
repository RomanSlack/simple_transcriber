import React from 'react';
import { shadows } from '../styles/neumorphic';

interface Props {
  state: 'idle' | 'recording' | 'stopping';
  onClick: () => void;
}

export function RecordButton({ state, onClick }: Props) {
  const recording = state === 'recording';
  const stopping = state === 'stopping';
  return (
    <button
      onClick={onClick}
      disabled={stopping}
      style={{
        width: 168,
        height: 168,
        borderRadius: '50%',
        background: 'var(--bg)',
        boxShadow: recording ? shadows.insetDeep : shadows.raisedLg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'box-shadow 200ms ease',
        cursor: stopping ? 'wait' : 'pointer',
      }}
    >
      <span
        style={{
          width: recording ? 56 : 92,
          height: recording ? 56 : 92,
          borderRadius: recording ? 14 : '50%',
          background: 'var(--accent)',
          boxShadow: recording
            ? '0 0 24px rgba(255,107,107,0.6), inset 0 0 12px rgba(255,255,255,0.25)'
            : '4px 4px 10px var(--shadow-dark), -4px -4px 10px var(--shadow-light)',
          transition: 'all 220ms cubic-bezier(.3,1.4,.6,1)',
          animation: recording ? 'pulse 1.6s ease-in-out infinite' : 'none',
        }}
      />
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
      `}</style>
    </button>
  );
}
