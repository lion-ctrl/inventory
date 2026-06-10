// IconButton — ported from prototype primitives.jsx.
import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  ariaLabel?: string;
}

export function IconButton({
  icon,
  onClick,
  ariaLabel,
  ...rest
}: IconButtonProps) {
  return (
    <button
      className="iconbtn"
      onClick={onClick}
      aria-label={ariaLabel}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
