// ConfirmDialog — extracted from prototype sale.jsx into its own component.
import type { ReactNode } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';

export interface ConfirmDialogProps {
  title?: ReactNode;
  message?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  tone?: 'primary' | 'danger';
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancelar', tone = 'primary', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Sheet onClose={onCancel} dialog>
      <div style={{ font: '700 18px var(--font-sans)', marginBottom: 6 }}>{title}</div>
      <div style={{ font: '400 14px var(--font-sans)', color: 'var(--ink-2)', marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
      <div className="row" style={{ gap: 10 }}>
        <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Sheet>);

}
