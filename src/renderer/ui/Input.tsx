import React, { forwardRef, InputHTMLAttributes } from 'react';
import { shadows } from '../styles/neumorphic';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, style, ...rest },
  ref,
) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      {label && (
        <span style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
          {label}
        </span>
      )}
      <input
        ref={ref}
        {...rest}
        style={{
          background: 'var(--bg)',
          borderRadius: 12,
          boxShadow: shadows.insetSm,
          padding: '13px 16px',
          fontSize: 14,
          color: 'var(--text)',
          width: '100%',
          ...style,
        }}
      />
    </label>
  );
});
