import React, { CSSProperties, ReactNode } from 'react';
import { shadows } from '../styles/neumorphic';

type Variant = 'raised' | 'inset' | 'flat';

interface Props {
  variant?: Variant;
  radius?: number | string;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

export function Surface({
  variant = 'raised',
  radius = 18,
  style,
  className,
  children,
  onClick,
  size = 'md',
}: Props) {
  const shadow =
    variant === 'inset'
      ? size === 'sm'
        ? shadows.insetSm
        : shadows.inset
      : variant === 'flat'
        ? shadows.flat
        : size === 'sm'
          ? shadows.raisedSm
          : size === 'lg'
            ? shadows.raisedLg
            : shadows.raised;
  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        background: 'var(--bg)',
        borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
        boxShadow: shadow,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
