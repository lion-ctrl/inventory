// Payment sheet + Success screen — ported from prototype payment.jsx.
// Receipt header/IVA/rate come from real data now (settings + sale snapshots).
import { useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { AppBar, BottomBar, Button, Icon, Input, Sheet } from '@/components';
import { useSettingsDoc } from '@/state/hooks';
import type {
  CleanSplit,
  ClientSnapshot,
  MethodId,
  SaleItemSnapshot,
  SplitRow,
} from '@/types';

export interface PayMethod {
  id: MethodId;
  label: string;
  icon: string;
  currency: 'usd' | 'bs';
}

export const METHODS: PayMethod[] = [
  { id: 'cash', label: 'Efectivo dólar', icon: 'banknote', currency: 'usd' },
  { id: 'cash_bs', label: 'Efectivo Bs', icon: 'banknote', currency: 'bs' },
  { id: 'card', label: 'Tarjeta', icon: 'credit-card', currency: 'bs' },
  {
    id: 'transfer',
    label: 'Transferencia',
    icon: 'arrow-left-right',
    currency: 'bs',
  },
  { id: 'mobile', label: 'Pago móvil', icon: 'smartphone', currency: 'bs' },
  { id: 'zelle', label: 'Zelle', icon: 'dollar-sign', currency: 'usd' },
];

export const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  METHODS.map((m) => [m.id, m.label])
);
export const METHOD_CURRENCY: Record<string, string> = Object.fromEntries(
  METHODS.map((m) => [m.id, m.currency])
);

// How a payment method appears on the printed receipt (no USD wording allowed).
export const RECEIPT_METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  cash_bs: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  mobile: 'Pago móvil',
  zelle: 'Transferencia',
};
export const receiptMethod = (id: string) =>
  RECEIPT_METHOD_LABEL[id] || METHOD_LABEL[id] || id;

// Keep digits and at most one decimal point, max 2 decimals. Strips everything
// else (letters, symbols, multiple dots) so paste-and-text-input both stay clean.
export function sanitizeAmount(input: string | number): string {
  let v = String(input).replace(/[^\d.]/g, '');
  const firstDot = v.indexOf('.');
  if (firstDot !== -1) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    const [whole, dec] = v.split('.');
    v = whole + '.' + (dec || '').slice(0, 2);
  }
  return v;
}

export interface PaymentSheetProps {
  total: number;
  onClose: () => void;
  /** May return a Promise — AppShell's checkout handler is async. */
  onConfirm: (
    method: string,
    tendered: number,
    splits: CleanSplit[]
  ) => void | Promise<void>;
  splits: SplitRow[];
  setSplits: Dispatch<SetStateAction<SplitRow[]>>;
  nextIdRef: MutableRefObject<number>;
  bsRate: number;
}

export function PaymentSheet({
  total,
  onClose,
  onConfirm,
  splits,
  setSplits,
  nextIdRef,
  bsRate,
}: PaymentSheetProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const rate = bsRate > 0 ? bsRate : 0;

  // Convert a row's typed amount into USD. Bs-currency methods are typed in Bs.
  const rowUsd = (r: SplitRow) => {
    const v = parseFloat(r.amount) || 0;
    if (METHOD_CURRENCY[r.method] === 'bs') return rate > 0 ? v / rate : 0;
    return v;
  };

  const splitTotal = splits.reduce((s, r) => s + rowUsd(r), 0);
  const splitRemaining = total - splitTotal;
  const splitComplete = Math.abs(splitRemaining) < 0.01;

  const addSplit = (methodId: string) => {
    setSplits((prev) => [
      ...prev,
      { id: nextIdRef.current++, method: methodId, amount: '' },
    ]);
    setPickerOpen(false);
  };
  const updateSplit = (id: number, patch: Partial<SplitRow>) =>
    setSplits((s) => s.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeSplit = (id: number) =>
    setSplits((s) => s.filter((r) => r.id !== id));

  const confirm = () => {
    const cleanSplits: CleanSplit[] = splits
      .filter((r) => parseFloat(r.amount) > 0)
      .map((r) => ({
        method: r.method,
        amount: rowUsd(r),
        entered: parseFloat(r.amount),
        currency: METHOD_CURRENCY[r.method],
      }));
    void onConfirm(cleanSplits[0].method, total, cleanSplits);
  };

  const canConfirm =
    splitComplete && splits.every((r) => parseFloat(r.amount) > 0);

  return (
    <Sheet onClose={onClose}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div
          style={{
            font: '500 12px var(--font-sans)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--ink-3)',
          }}
        >
          Total a cobrar
        </div>
        <div
          className="tabular"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            fontSize: 56,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            marginTop: 6,
          }}
        >
          ${total.toFixed(2)}
        </div>
        {rate > 0 && (
          <div
            className="tabular"
            style={{
              font: '700 18px var(--font-sans)',
              color: 'var(--accent-2)',
              marginTop: 4,
            }}
          >
            Bs {(total * rate).toFixed(2)}
          </div>
        )}
      </div>

      <div
        style={{
          font: '600 11px var(--font-sans)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--ink-3)',
          marginBottom: 8,
        }}
      >
        Métodos de pago
      </div>

      <div className="pay-split">
        <div className="pay-split-list">
          {splits.map((row) => (
            <div
              className="pay-split-row"
              key={row.id}
              style={{ margin: '4px 0px 0px' }}
            >
              <select
                className="input"
                value={row.method}
                onChange={(e) =>
                  updateSplit(row.id, { method: e.target.value })
                }
              >
                {METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="pay-split-amount">
                <Input
                  mono
                  type="text"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) =>
                    updateSplit(row.id, {
                      amount: sanitizeAmount(e.target.value),
                    })
                  }
                  placeholder={
                    METHOD_CURRENCY[row.method] === 'bs' ? 'Bs 0.00' : '$ 0.00'
                  }
                />
                {rate > 0 && parseFloat(row.amount) > 0 && (
                  <div className="pay-split-bs">
                    {METHOD_CURRENCY[row.method] === 'bs'
                      ? `= $${(parseFloat(row.amount) / rate).toFixed(2)}`
                      : `= Bs ${(parseFloat(row.amount) * rate).toFixed(2)}`}
                  </div>
                )}
              </div>

              {splits.length > 1 && (
                <button
                  type="button"
                  className="iconbtn pay-split-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSplit(row.id);
                  }}
                  aria-label="Quitar método"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
        <button className="pay-split-add" onClick={() => setPickerOpen(true)}>
          <Icon name="plus" size={16} />
          Agregar método
        </button>
        {splitTotal > 0.005 && (
          <div className="pay-split-summary paid">
            <span>Pagado</span>
            <span className="tabular">
              ${splitTotal.toFixed(2)}
              {rate > 0 ? ` · Bs ${(splitTotal * rate).toFixed(2)}` : ''}
            </span>
          </div>
        )}
        <div
          className={`pay-split-summary ${splitComplete ? 'ok' : splitRemaining > 0 ? 'warn' : 'danger'}`}
        >
          {splitComplete ? (
            <>
              <span className="row" style={{ gap: 6 }}>
                <Icon name="check-circle-2" size={16} />
                <span>Total cubierto</span>
              </span>
              <span className="tabular">${total.toFixed(2)}</span>
            </>
          ) : splitRemaining > 0 ? (
            <>
              <span>Falta</span>
              <span className="tabular">
                ${splitRemaining.toFixed(2)}
                {rate > 0 ? ` · Bs ${(splitRemaining * rate).toFixed(2)}` : ''}
              </span>
            </>
          ) : (
            <>
              <span>Excedido en</span>
              <span className="tabular">
                ${Math.abs(splitRemaining).toFixed(2)}
                {rate > 0
                  ? ` · Bs ${(Math.abs(splitRemaining) * rate).toFixed(2)}`
                  : ''}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        <Button variant="secondary" onClick={onClose}>
          Atrás
        </Button>
        <Button disabled={!canConfirm} onClick={confirm}>
          Confirmar venta
        </Button>
      </div>

      {pickerOpen && (
        <div className="picker-scrim" onClick={() => setPickerOpen(false)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <div className="picker-title">Elige un método</div>
              <button
                className="iconbtn"
                aria-label="Cerrar"
                onClick={() => setPickerOpen(false)}
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="picker-list">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  className="picker-item"
                  onClick={() => addSplit(m.id)}
                >
                  <Icon name={m.icon} size={20} />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export interface SuccessScreenProps {
  invoice: string | null;
  /** true when the sale was queued offline — the receipt shows PENDING_SYNC (§6.5). */
  pendingSync?: boolean;
  total: number;
  items: SaleItemSnapshot[];
  method: string;
  splits: CleanSplit[] | null;
  tendered?: number;
  client: ClientSnapshot | null;
  /** The sale's snapshotted IVA percentage (e.g. 13 → "IVA (13%)"). */
  ivaPct: number;
  /** The sale's snapshotted exchangeRate (Bs/$), NOT the live rate. */
  bsRate: number;
  online: boolean;
  onNew: () => void;
  onPrint: () => void;
  onDash: () => void;
}

export function SuccessScreen({
  invoice,
  pendingSync,
  total,
  items,
  method,
  splits,
  tendered,
  client,
  ivaPct,
  bsRate,
  onNew,
  onPrint,
  onDash: _onDash,
  online,
}: SuccessScreenProps) {
  const settings = useSettingsDoc();
  const _methodLabel = METHOD_LABEL[method] || 'Efectivo';
  // Splits is always an array now — single-method sales arrive as length-1 arrays,
  // so "no splits" (prototype `!splits`) means "not a real multi-method split".
  const _change =
    !(splits && splits.length > 1) &&
    method === 'cash' &&
    (tendered ?? 0) > total
      ? (tendered ?? 0) - total
      : 0;
  // Every sale is an invoice now — IVA always applies to the taxable base.
  const docPrefix = 'Factura';
  // An offline sale has no server invoice # yet (§6.5) — show a PENDING_SYNC label
  // everywhere the number would go; the sync engine replaces it once confirmed.
  const invoiceText = pendingSync
    ? 'Pendiente de sincronización'
    : `N° ${invoice}`;
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const exemptBase = items.reduce(
    (s, i) => s + (i.exempt === true ? i.price * i.qty : 0),
    0
  );
  const taxableBase = subtotal - exemptBase;
  const tax = (taxableBase * ivaPct) / 100;
  const grandTotal = subtotal + tax;
  const rate = bsRate > 0 ? bsRate : 1;
  // Venezuelan number format: thousands "." and decimals ","
  const bsNum = (usd: number) =>
    (usd * rate).toLocaleString('es-VE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const bs = (usd: number) => 'Bs ' + bsNum(usd);
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const clientTax = client?.taxId
    ? `${client.taxPrefix || ''}-${client.taxId}`
    : null;

  return (
    <>
      <AppBar title="Venta registrada" sub={invoiceText} online={online} />
      <div className="content">
        <div className="success" style={{ padding: '0px' }}>
          <div className="check">
            <Icon name="check" size={40} />
          </div>
          <div
            style={{
              font: '600 12px var(--font-sans)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--ink-3)',
            }}
          >
            Total cobrado
          </div>
          <div className="total tabular">{bs(grandTotal)}</div>
          <div className="invoice">
            {pendingSync
              ? 'Pendiente de sincronización'
              : `${docPrefix} N° ${invoice}`}{' '}
            ·{' '}
            {now.toLocaleString('es', {
              day: '2-digit',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          </div>

          <div className="card receipt">
            <div className="rcpt-fiscal">
              <div className="rcpt-fiscal-org">SENIAT</div>
              <div className="rcpt-fiscal-rif">{settings?.storeRif ?? ''}</div>
            </div>
            <div className="rcpt-store">{settings?.storeName ?? ''}</div>
            <div className="rcpt-storelines">
              <div>{settings?.address ?? ''}</div>
            </div>
            <hr />
            <div className="rcpt-section">Información del Cliente</div>
            <div className="rcpt-kv">
              <span>Nombre del Cliente</span>
              <span>{client?.name || 'Consumidor Final'}</span>
            </div>
            <div className="rcpt-kv">
              <span>RIF/CI</span>
              <span>{clientTax || 'N/A'}</span>
            </div>
            <div className="rcpt-kv-full">
              Método de Autorización del Medio de Pago
            </div>
            <div className="rcpt-kv-full">{receiptMethod(method)}</div>
            <hr />
            <div className="rcpt-doctitle">FACTURA</div>
            <div className="rcpt-kv">
              <span>FACTURA</span>
              <span>{invoiceText}</span>
            </div>
            <div className="rcpt-kv">
              <span>FECHA: {dateStr}</span>
              <span>HORA: {timeStr}</span>
            </div>
            <hr />
            {items.map((i, idx) => (
              <div className="rcpt-item" key={i.productId ?? idx}>
                <div className="rcpt-item-code mono">
                  {(i.barcode || i.sku || String(idx + 1)).slice(0, 18)}
                </div>
                <div className="rcpt-item-line">
                  <span>
                    {i.name} {i.qty > 1 ? `x${i.qty}` : ''}
                    {i.exempt === true ? ' (E)' : ''}
                  </span>
                  <span>Bs {bsNum(i.price * i.qty)}</span>
                </div>
              </div>
            ))}
            <hr />
            {exemptBase > 0 && (
              <div className="rcpt-kv">
                <span>Exento (E)</span>
                <span>Bs {bsNum(exemptBase)}</span>
              </div>
            )}
            <div className="rcpt-kv">
              <span>Subtotal</span>
              <span>Bs {bsNum(taxableBase)}</span>
            </div>
            <div className="rcpt-kv">
              <span>IVA ({ivaPct}%)</span>
              <span>Bs {bsNum(tax)}</span>
            </div>
            <div className="rcpt-total">
              <span>TOTAL</span>
              <span>{bs(grandTotal)}</span>
            </div>
            {/* No per-method payment breakdown on the invoice: how the sale was
                settled is internal bookkeeping (stored on the sale, shown in
                Historial), not a fiscal field. The invoice ends at TOTAL — the
                authorization method above is the only payment data it carries. */}
            <hr />
            <div className="rcpt-thanks">Gracias por su visita.</div>
          </div>
        </div>
      </div>
      <BottomBar>
        <Button variant="secondary" icon="printer" onClick={onPrint}>
          Imprimir
        </Button>
        <Button onClick={onNew} icon="scan-line">
          Nueva venta
        </Button>
      </BottomBar>
    </>
  );
}

// Normalize a split row's typed amount to USD (Bs methods are typed in Bs).
// `r` stays loose on purpose: it accepts live SplitRow rows (amount: string)
// and held-cart split snapshots (amount: number) alike, exactly like the prototype.
export const splitUsd = (r: any, rate: number): number => {
  const v = parseFloat(r.amount) || 0;
  if (METHOD_CURRENCY[r.method] === 'bs') return rate > 0 ? v / rate : 0;
  return v;
};
