// Banner — ported from prototype primitives.jsx.
import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface BannerProps {
  tone?: string;
  icon?: string;
  title?: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
}

export function Banner({
  tone = 'info',
  icon,
  title,
  message,
  action,
}: BannerProps) {
  return (
    <div className={`banner ${tone}`}>
      <span className="ic">
        <Icon name={icon || 'info'} size={18} />
      </span>
      <div className="body">
        {title && <div className="ttl">{title}</div>}
        <div className="msg">{message}</div>
      </div>
      {action}
    </div>
  );
}
