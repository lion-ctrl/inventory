// BottomBar — ported from prototype primitives.jsx.
import type { ReactNode } from 'react';

export interface BottomBarProps {
  children?: ReactNode;
  className?: string;
}

export function BottomBar({ children, className = '' }: BottomBarProps) {
  return <div className={`bottombar ${className}`}>{children}</div>;
}
