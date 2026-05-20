import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { shadows } from '../styles/neumorphic';

export type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

interface ToastCtx {
  push: (text: string, kind?: ToastKind) => void;
}

const Ctx = createContext<ToastCtx | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = nextId++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3200);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 22,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 8,
          zIndex: 9999,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const color =
    toast.kind === 'success'
      ? 'var(--good)'
      : toast.kind === 'error'
        ? 'var(--bad)'
        : 'var(--text-dim)';
  return (
    <div
      style={{
        background: 'var(--bg)',
        borderRadius: 12,
        boxShadow: shadows.raisedSm,
        padding: '10px 16px 10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
        color: 'var(--text)',
        minWidth: 220,
        maxWidth: 420,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity 180ms ease, transform 180ms cubic-bezier(.2,.9,.4,1)',
        pointerEvents: 'auto',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 6px ${color}88`,
          flexShrink: 0,
        }}
      />
      <span>{toast.text}</span>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
