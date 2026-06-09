// Segmented — ported from prototype primitives.jsx.
import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string = string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
}

export function Segmented<T extends string = string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="seg">
      {options.map((o) =>
      <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      )}
    </div>);

}
