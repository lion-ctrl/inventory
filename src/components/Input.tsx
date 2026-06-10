// Input — ported from prototype primitives.jsx.
import type { InputHTMLAttributes } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  mono?: boolean;
};

export function Input({ mono, ...rest }: InputProps) {
  return <input className={`input${mono ? ' mono' : ''}`} {...rest} />;
}
