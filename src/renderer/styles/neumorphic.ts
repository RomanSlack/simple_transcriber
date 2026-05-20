import { CSSProperties } from 'react';

const D = 'var(--shadow-dark)';
const L = 'var(--shadow-light)';

export const shadows = {
  raised: `8px 8px 16px ${D}, -8px -8px 16px ${L}`,
  raisedSm: `5px 5px 10px ${D}, -5px -5px 10px ${L}`,
  raisedLg: `12px 12px 24px ${D}, -12px -12px 24px ${L}`,
  inset: `inset 4px 4px 8px ${D}, inset -4px -4px 8px ${L}`,
  insetSm: `inset 3px 3px 6px ${D}, inset -3px -3px 6px ${L}`,
  insetDeep: `inset 6px 6px 12px ${D}, inset -6px -6px 12px ${L}`,
  flat: `2px 2px 4px ${D}, -2px -2px 4px ${L}`,
};

export const surfaceRaised = (radius: number | string = 18): CSSProperties => ({
  background: 'var(--bg)',
  borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
  boxShadow: shadows.raised,
});

export const surfaceInset = (radius: number | string = 18): CSSProperties => ({
  background: 'var(--bg)',
  borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
  boxShadow: shadows.inset,
});
