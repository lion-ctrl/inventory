// Chip — ported from prototype primitives.jsx.
import type { CSSProperties, ReactNode } from 'react';

export interface ChipProps {
  tone?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Chip({ tone = 'neutral', children, style }: ChipProps) {
  return (
    <span className={`chip chip-${tone}`} style={style}>
      {children}
    </span>
  );
}
