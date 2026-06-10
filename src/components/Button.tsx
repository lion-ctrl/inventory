// Button — ported from prototype primitives.jsx.
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { Icon } from './Icon';

export interface ButtonProps {
  variant?: string;
  size?: 'sm' | 'md';
  children?: ReactNode;
  icon?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  block?: boolean;
  style?: CSSProperties;
}

export function Button({
  variant = 'primary',
  size,
  children,
  icon,
  onClick,
  disabled,
  type = 'button',
  block,
  style,
}: ButtonProps) {
  const cls = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : size === 'md' ? 'btn-md' : '',
    block ? 'btn-block' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={cls}
      onClick={onClick}
      disabled={disabled}
      style={style}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}
