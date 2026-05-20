import React, { ButtonHTMLAttributes, useState } from 'react';
import { shadows } from '../styles/neumorphic';

type Variant = 'default' | 'primary' | 'subtle';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
}

export function Button({ variant = 'default', size = 'md', style, children, ...rest }: Props) {
  const [pressed, setPressed] = useState(false);
  const padding = size === 'sm' ? '8px 14px' : size === 'lg' ? '16px 28px' : '11px 20px';
  const fontSize = size === 'sm' ? 12.5 : size === 'lg' ? 16 : 14;
  const color =
    variant === 'primary' ? 'var(--accent)' : variant === 'subtle' ? 'var(--text-dim)' : 'var(--text)';
  return (
    <button
      {...rest}
      onMouseDown={(e) => {
        setPressed(true);
        rest.onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        setPressed(false);
        rest.onMouseUp?.(e);
      }}
      onMouseLeave={(e) => {
        setPressed(false);
        rest.onMouseLeave?.(e);
      }}
      style={{
        background: 'var(--bg)',
        color,
        padding,
        fontSize,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        borderRadius: 14,
        boxShadow: rest.disabled ? shadows.flat : pressed ? shadows.insetSm : shadows.raisedSm,
        transition: 'box-shadow 90ms ease, transform 90ms ease',
        opacity: rest.disabled ? 0.55 : 1,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
