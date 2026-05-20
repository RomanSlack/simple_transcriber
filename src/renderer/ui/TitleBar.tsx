import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { shadows } from '../styles/neumorphic';

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const platform = api.platform;
  const macStyle = platform === 'darwin';

  useEffect(() => {
    api.window.getState().then((s) => {
      setMaximized(s.maximized);
      setFocused(s.focused);
    });
    const off = api.window.onState((s) => {
      setMaximized(s.maximized);
      setFocused(s.focused);
    });
    return () => {
      off();
    };
  }, []);

  return (
    <div
      style={{
        // @ts-expect-error vendor prop
        WebkitAppRegion: 'drag',
        height: 42,
        display: 'flex',
        alignItems: 'center',
        padding: macStyle ? '0 14px 0 78px' : '0 8px 0 14px',
        gap: 12,
        flexShrink: 0,
        opacity: focused ? 1 : 0.78,
        transition: 'opacity 160ms',
      }}
    >
      <BrandDot />
      <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: '-0.01em', color: 'var(--text)' }}>
        Simple Transcriber
      </div>
      <div style={{ flex: 1 }} />
      {!macStyle && (
        <div
          style={{
            // @ts-expect-error vendor prop
            WebkitAppRegion: 'no-drag',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <WinButton kind="min" onClick={() => api.window.minimize()} />
          <WinButton kind={maximized ? 'restore' : 'max'} onClick={() => api.window.toggleMaximize()} />
          <WinButton kind="close" onClick={() => api.window.close()} />
        </div>
      )}
    </div>
  );
}

function BrandDot() {
  return (
    <div
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: 'var(--accent)',
        boxShadow:
          'inset 1.5px 1.5px 3px rgba(199,80,80,0.6), inset -1.5px -1.5px 3px rgba(255,180,180,0.7), 0 0 8px rgba(255,107,107,0.35)',
      }}
    />
  );
}

type Kind = 'min' | 'max' | 'restore' | 'close';

function WinButton({ kind, onClick }: { kind: Kind; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const color =
    kind === 'close' ? '#ff6b6b' : kind === 'min' ? '#9aa1b1' : '#6b7385';
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      aria-label={kind}
      style={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        background: 'var(--bg)',
        boxShadow: pressed ? shadows.insetSm : shadows.raisedSm,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'box-shadow 120ms ease, transform 120ms ease',
        transform: hover && !pressed ? 'translateY(-0.5px)' : 'none',
        cursor: 'pointer',
      }}
    >
      <Glyph kind={kind} color={color} />
    </button>
  );
}

function Glyph({ kind, color }: { kind: Kind; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const, fill: 'none' };
  if (kind === 'min') {
    return (
      <svg width="11" height="11" viewBox="0 0 11 11">
        <line x1="2.5" y1="6" x2="8.5" y2="6" {...stroke} />
      </svg>
    );
  }
  if (kind === 'max') {
    return (
      <svg width="11" height="11" viewBox="0 0 11 11">
        <rect x="2.3" y="2.3" width="6.4" height="6.4" rx="1.2" {...stroke} />
      </svg>
    );
  }
  if (kind === 'restore') {
    return (
      <svg width="11" height="11" viewBox="0 0 11 11">
        <rect x="3.4" y="3.4" width="5.2" height="5.2" rx="1" {...stroke} />
        <path d="M3.4 4.6 V3.4 H4.6 M8.6 6.4 V8.6 H6.4" {...stroke} />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 11 11">
      <line x1="3" y1="3" x2="8" y2="8" {...stroke} />
      <line x1="8" y1="3" x2="3" y2="8" {...stroke} />
    </svg>
  );
}
