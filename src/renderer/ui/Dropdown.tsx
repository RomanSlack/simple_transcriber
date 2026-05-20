import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { shadows } from '../styles/neumorphic';

export interface DropdownOption {
  value: string;
  label: string;
  detail?: string;
}

interface Props {
  label?: string;
  value: string;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  width?: number | string;
  emptyText?: string;
}

interface Pos {
  left: number;
  top: number;
  width: number;
}

export function Dropdown({
  label,
  value,
  options,
  placeholder = 'Select...',
  disabled,
  onChange,
  width = '100%',
  emptyText = 'No options',
}: Props) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number>(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const selected = options.find((o) => o.value === value);

  const computePos = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 6, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (open) {
      computePos();
      // Focus the trigger area so keyboard nav works.
      const idx = options.findIndex((o) => o.value === value);
      setHover(idx >= 0 ? idx : 0);
    }
  }, [open, computePos, options, value]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => computePos();
    const onResize = () => computePos();
    const onDocDown = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHover((h) => Math.min(options.length - 1, h + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHover((h) => Math.max(0, h - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const o = options[hover];
        if (o) {
          onChange(o.value);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, options, hover, onChange, computePos]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width }}>
      {label && (
        <span
          style={{
            fontSize: 12,
            color: 'var(--text-dim)',
            fontWeight: 500,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          background: 'var(--bg)',
          borderRadius: 12,
          boxShadow: open ? shadows.insetSm : shadows.insetSm,
          padding: '13px 14px 13px 16px',
          width: '100%',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          fontSize: 14,
          color: selected ? 'var(--text)' : 'var(--text-faint)',
          transition: 'box-shadow 120ms ease',
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {selected ? selected.label : placeholder}
        </span>
        <Chevron open={open} />
      </button>
      {open &&
        pos &&
        createPortal(
          <Popup
            ref={popupRef}
            pos={pos}
            options={options}
            value={value}
            hover={hover}
            setHover={setHover}
            onPick={(v) => {
              onChange(v);
              setOpen(false);
              triggerRef.current?.focus();
            }}
            emptyText={emptyText}
          />,
          document.body,
        )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      style={{
        transform: `rotate(${open ? 180 : 0}deg)`,
        transition: 'transform 180ms ease',
        color: 'var(--text-faint)',
      }}
    >
      <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface PopupProps {
  pos: Pos;
  options: DropdownOption[];
  value: string;
  hover: number;
  setHover: (i: number) => void;
  onPick: (v: string) => void;
  emptyText: string;
}

const Popup = React.forwardRef<HTMLDivElement, PopupProps>(function Popup(
  { pos, options, value, hover, setHover, onPick, emptyText },
  ref,
) {
  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: pos.width,
        zIndex: 9999,
        background: 'var(--bg)',
        borderRadius: 14,
        boxShadow: shadows.raisedLg,
        padding: 6,
        maxHeight: 320,
        overflowY: 'auto',
        animation: 'st-dd-in 140ms cubic-bezier(.2,.9,.4,1) both',
      }}
    >
      <style>{`
        @keyframes st-dd-in {
          from { opacity: 0; transform: translateY(-6px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
      `}</style>
      {options.length === 0 && (
        <div style={{ padding: '14px 14px', color: 'var(--text-faint)', fontSize: 13 }}>
          {emptyText}
        </div>
      )}
      {options.map((o, i) => {
        const isSelected = o.value === value;
        const isHover = i === hover;
        return (
          <button
            key={o.value}
            type="button"
            onMouseEnter={() => setHover(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(o.value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              borderRadius: 10,
              background: isHover ? 'var(--row-hover)' : 'transparent',
              color: 'var(--text)',
              boxShadow: isHover ? 'var(--row-hover-inset)' : 'none',
              cursor: 'pointer',
              transition: 'background 100ms ease',
            }}
          >
            <Check show={isSelected} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 14,
                  fontWeight: isSelected ? 600 : 500,
                  letterSpacing: '-0.005em',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                }}
              >
                {o.label}
              </span>
              {o.detail && (
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                  {o.detail}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
});

function Check({ show }: { show: boolean }) {
  return (
    <span
      style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: show ? 'var(--accent)' : 'transparent',
        boxShadow: show
          ? '0 0 6px rgba(255,107,107,0.45)'
          : 'inset 1px 1px 2px var(--shadow-dark), inset -1px -1px 2px var(--shadow-light)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background 120ms ease, box-shadow 120ms ease',
      }}
    >
      {show && (
        <svg width="8" height="8" viewBox="0 0 8 8">
          <path d="M1.5 4.3 L3.2 6 L6.5 2.5" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}
