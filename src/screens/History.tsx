// HistoryScreen — list of completed sales with stats, filters, detail sheet.
// Ported from prototype history.jsx: sales come from Convex (api.sales.history,
// already sorted soldAt desc); refunds go through api.sales.refund (the server
// restores stock and flags the sale — reactivity updates the list).
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import {
  AppBar,
  Banner,
  Button,
  Chip,
  Icon,
  IconButton,
  Input,
  Sheet,
  useToast,
} from '@/components';
import { useSession } from '@/state/SessionContext';
import { useOnline } from '@/state/useOnline';
import { mutationError } from '@/lib/mutationError';
import { initialOf } from '@/lib/initials';
import { useBsRate } from '@/state/hooks';
import { usePendingSales } from '@/state/usePendingSales';
import { DateField } from './Stored';
import type { Sale } from '@/types';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo dólar',
  cash_bs: 'Efectivo Bs',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  mobile: 'Pago móvil',
  zelle: 'Zelle',
};
const METHOD_ICONS: Record<string, string> = {
  cash: 'banknote',
  cash_bs: 'banknote',
  card: 'credit-card',
  transfer: 'arrow-left-right',
  mobile: 'smartphone',
  zelle: 'dollar-sign',
};
const METHOD_TONES: Record<string, string> = {
  cash: 'ok',
  cash_bs: 'ok',
  card: 'info',
  transfer: 'neutral',
  mobile: 'purple',
  zelle: 'ok',
};

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * The SAME window `inRange` applies below, expressed as epoch ms so the server
 * can resolve it through the `by_soldAt` index. The screen always knew which
 * window it wanted; it just never told the query, so the whole sales table was
 * downloaded and then thrown away client-side. `inRange` stays as the exact
 * client-side filter (it also handles a half-filled custom range).
 */
export function rangeBounds(
  range: string,
  fromDate: string,
  toDate: string
): { from?: number; to?: number } {
  const now = new Date();
  const today = { from: startOfDay(now), to: startOfDay(now) + DAY_MS - 1 };
  if (range === 'custom') {
    if (fromDate && toDate) {
      return {
        from: new Date(fromDate + 'T00:00:00').getTime(),
        to: new Date(toDate + 'T23:59:59').getTime(),
      };
    }
    return today; // matches inRange: an incomplete custom range shows today
  }
  switch (range) {
    case 'today':
      return today;
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(now.getDate() - 1);
      return { from: startOfDay(y), to: startOfDay(y) + DAY_MS - 1 };
    }
    case 'week':
      return { from: now.getTime() - 7 * DAY_MS };
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime() };
    default:
      return {}; // "Todas" — unbounded by intent; the server cap still applies
  }
}

function inRange(sale: Sale, range: string, fromDate: string, toDate: string) {
  const d = new Date(sale.soldAt);
  const now = new Date();
  if (range === 'custom') {
    // Only apply the custom range when BOTH dates are selected; otherwise show today.
    if (fromDate && toDate) {
      const f = new Date(fromDate + 'T00:00:00');
      const t = new Date(toDate + 'T23:59:59');
      return d >= f && d <= t;
    }
    return isSameDay(d, now);
  }
  switch (range) {
    case 'today':
      return isSameDay(d, now);
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(now.getDate() - 1);
      return isSameDay(d, y);
    }
    case 'week':
      return now.getTime() - d.getTime() <= 7 * 86400000;
    case 'month':
      return isSameMonth(d, now);
    default:
      return true;
  }
}

function fmtDMY(iso: string) {
  if (!iso) return '…';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
const TODAY_ISO = new Date().toISOString().slice(0, 10);

interface DateInputDMYProps {
  value: string;
  min?: string;
  max?: string;
  onChange: (iso: string) => void;
  placeholder?: string;
}

// Masked date input that DISPLAYS dd/mm/yyyy but stores ISO (yyyy-mm-dd).
export function DateInputDMY({
  value,
  min,
  max,
  onChange,
  placeholder = 'dd/mm/aaaa',
}: DateInputDMYProps) {
  const [text, setText] = useState(value ? fmtDMY(value) : '');
  useEffect(() => {
    setText(value ? fmtDMY(value) : '');
  }, [value]);

  const commit = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    let out = digits;
    if (digits.length > 4)
      out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2)
      out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setText(out);
    if (digits.length === 8) {
      const dd = digits.slice(0, 2),
        mm = digits.slice(2, 4),
        yyyy = digits.slice(4);
      const iso = `${yyyy}-${mm}-${dd}`;
      const d = new Date(iso + 'T00:00:00');
      const valid =
        d.getFullYear() === +yyyy &&
        d.getMonth() + 1 === +mm &&
        d.getDate() === +dd;
      if (valid && (!min || iso >= min) && (!max || iso <= max)) {
        onChange(iso);
      }
    } else if (digits.length === 0) {
      onChange('');
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      className="input mono"
      value={text}
      placeholder={placeholder}
      onChange={(e) => commit(e.target.value)}
    />
  );
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = isSameDay(d, now);
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const sameYest = isSameDay(d, yest);
  const t = d.toLocaleTimeString('es', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  if (sameDay) return `Hoy · ${t}`;
  if (sameYest) return `Ayer · ${t}`;
  return d.toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

interface SaleRowProps {
  sale: Sale;
  onClick: (sale: Sale) => void;
  bsRate: number;
}

function SaleTableRow({ sale, onClick, bsRate }: SaleRowProps) {
  const clientGlyph =
    sale.client?.kind === 'business'
      ? '🏢'
      : (sale.client?.name?.[0] || '?').toUpperCase();
  const itemCount = sale.items.reduce((s, i) => s + i.qty, 0);
  const isSplitPayment = sale.splits && sale.splits.length > 1;
  const isRefunded = !!sale.refund;
  return (
    <div
      className={`hist-row ${isRefunded ? 'is-refunded' : ''}`}
      onClick={() => onClick(sale)}
    >
      <div className="hist-col-id">
        <div className="hist-cell-id mono">
          N° {sale.invoiceNumber}
          {isRefunded && <span className="hist-refund-tag">Reembolsada</span>}
        </div>
        <div className="hist-cell-time">{formatDateTime(sale.soldAt)}</div>
        {isRefunded && sale.refund && (
          <div className="hist-cell-refund">
            Reemb. {formatDateTime(sale.refund.date)}
          </div>
        )}
      </div>
      <div className="hist-col-client">
        <div className="hist-avatar">{clientGlyph}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="hist-client-name">
            {sale.client?.name || 'Sin cliente'}
          </div>
          <div className="hist-client-tax mono">
            {sale.client?.taxId
              ? `${sale.client.taxPrefix || ''}-${sale.client.taxId}`
              : '—'}
          </div>
        </div>
      </div>
      <div className="hist-col-items">{itemCount}</div>
      <div className="hist-col-method">
        <Chip
          tone={
            isSplitPayment ? 'info' : METHOD_TONES[sale.method] || 'neutral'
          }
        >
          <Icon
            name={
              isSplitPayment ? 'shuffle' : METHOD_ICONS[sale.method] || 'tag'
            }
            size={12}
          />
          {isSplitPayment ? 'Mixto' : METHOD_LABELS[sale.method]}
        </Chip>
      </div>
      <div className="hist-col-total">
        <span className="cur">$</span>
        <span className="amt tabular">{sale.total.toFixed(2)}</span>
        {bsRate > 0 && (
          <span className="hist-total-bs tabular">
            Bs {(sale.total * bsRate).toFixed(2)}
          </span>
        )}
      </div>
      <div className="hist-col-chevron">
        <Icon name="chevron-right" size={18} />
      </div>
    </div>
  );
}

function SaleRow({ sale, onClick, bsRate }: SaleRowProps) {
  const clientGlyph =
    sale.client?.kind === 'business'
      ? '🏢'
      : (sale.client?.name?.[0] || '?').toUpperCase();
  const itemCount = sale.items.reduce((s, i) => s + i.qty, 0);
  const isSplitPayment = sale.splits && sale.splits.length > 1;
  const isRefunded = !!sale.refund;
  return (
    <div
      className={`stored-card hist-card ${isRefunded ? 'is-refunded' : ''}`}
      onClick={() => onClick(sale)}
    >
      <div className="stored-card-head">
        <div className="stored-card-id mono">N° {sale.invoiceNumber}</div>
        {isRefunded ? (
          <span className="hist-refund-tag">Reembolsada</span>
        ) : (
          <div className="stored-card-time">{formatDateTime(sale.soldAt)}</div>
        )}
      </div>
      {isRefunded && (
        <div className="hist-card-dates">
          <span>Venta: {formatDateTime(sale.soldAt)}</span>
          {sale.refund && (
            <span>Reemb.: {formatDateTime(sale.refund.date)}</span>
          )}
        </div>
      )}
      <div className="stored-card-client">
        <div className="stored-card-avatar">{clientGlyph}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="stored-card-name">
            {sale.client?.name || 'Sin cliente'}
          </div>
          {sale.client?.taxId && (
            <div className="stored-card-tax mono">{`${sale.client.taxPrefix || ''}-${sale.client.taxId}`}</div>
          )}
        </div>
      </div>
      <div className="stored-card-summary">
        <div className="stored-card-cell">
          <span className="k">Productos</span>
          <span className="v">{itemCount}</span>
        </div>
        <div className="stored-card-cell">
          <span className="k">Total</span>
          <span className="v tabular">${sale.total.toFixed(2)}</span>
          {bsRate > 0 && (
            <span className="v-bs tabular">
              Bs ${(sale.total * bsRate).toFixed(2)}
            </span>
          )}
        </div>
        <div className="stored-card-cell">
          <span className="k">Método</span>
          <span className="v">
            <Chip
              tone={
                isSplitPayment ? 'info' : METHOD_TONES[sale.method] || 'neutral'
              }
            >
              <Icon
                name={
                  isSplitPayment
                    ? 'shuffle'
                    : METHOD_ICONS[sale.method] || 'tag'
                }
                size={12}
              />
              {isSplitPayment ? 'Mixto' : METHOD_LABELS[sale.method]}
            </Chip>
          </span>
        </div>
      </div>
    </div>
  );
}

interface SaleDetailSheetProps {
  sale: Sale | null;
  onClose: () => void;
  onReprint?: (sale: Sale) => void;
  onRefund: (sale: Sale) => void;
  canRefund: boolean;
  online: boolean;
  bsRate: number;
}

function SaleDetailSheet({
  sale,
  onClose,
  onReprint,
  onRefund,
  canRefund,
  online,
  bsRate,
}: SaleDetailSheetProps) {
  if (!sale) return null;
  const taxDisplay = sale.client?.taxId
    ? `${sale.client.taxPrefix || ''}-${sale.client.taxId}`
    : null;
  const docPrefix = 'Recibo';
  const isRefunded = !!sale.refund;
  const refundedStr = sale.refund ? formatDateTime(sale.refund.date) : '';
  return (
    <Sheet onClose={onClose} title={`${docPrefix} N° ${sale.invoiceNumber}`}>
      <div className="hist-detail">
        {isRefunded && (
          <div className="hist-refunded-banner">
            <Icon name="rotate-ccw" size={18} />
            <div>
              <div className="hist-refunded-title">Venta reembolsada</div>
              <div className="hist-refunded-sub">
                {refundedStr}
                {sale.refund?.reason ? ` · ${sale.refund.reason}` : ''}
              </div>
            </div>
          </div>
        )}
        <div className="hist-detail-meta">
          <span>{formatDateTime(sale.soldAt)}</span>
        </div>

        <div className="hist-detail-client">
          <div className="hist-avatar lg">
            {sale.client?.kind === 'business'
              ? '🏢'
              : (sale.client?.name?.[0] || '?').toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="hist-detail-cname">
              {sale.client?.name || 'Sin cliente'}
            </div>
            {taxDisplay && (
              <div className="hist-detail-ctax mono">{taxDisplay}</div>
            )}
          </div>
        </div>

        <div className="hist-detail-cashier">
          <Icon name="user-round" size={16} />
          <span className="k">Atendido por</span>
          <span className="v">{sale.cashierName}</span>
        </div>

        <div className="hist-detail-section-title">
          Productos ({sale.items.reduce((s, i) => s + i.qty, 0)})
        </div>
        <div className="hist-detail-items">
          {sale.items.map((it, i) => (
            <div className="hist-item-row" key={i}>
              <div className="hist-item-glyph">{initialOf(it.name)}</div>
              <div className="hist-item-info">
                <div className="hist-item-name">{it.name}</div>
                <div className="hist-item-sku mono">
                  {it.sku} · {it.barcode}
                </div>
                <div className="hist-item-sku mono">
                  ${it.price.toFixed(2)} c/u × {it.qty}
                </div>
              </div>
              <div className="hist-item-right">
                {it.cat && (
                  <Chip tone="neutral" style={{ textTransform: 'capitalize' }}>
                    {it.cat}
                  </Chip>
                )}
                <div className="hist-item-total tabular">
                  ${(it.price * it.qty).toFixed(2)}
                </div>
                {bsRate > 0 && (
                  <div className="hist-item-total-bs tabular">
                    Bs ${(it.price * it.qty * bsRate).toFixed(2)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="hist-detail-totals">
          <div className="line">
            <span>Subtotal</span>
            <span className="hist-line-amt">
              <span className="tabular">${sale.subtotal.toFixed(2)}</span>
              {bsRate > 0 && (
                <span className="hist-line-bs tabular">
                  Bs {(sale.subtotal * bsRate).toFixed(2)}
                </span>
              )}
            </span>
          </div>
          {sale.tax > 0 && (
            <div className="line">
              <span>IVA (13%)</span>
              <span className="hist-line-amt">
                <span className="tabular">${sale.tax.toFixed(2)}</span>
                {bsRate > 0 && (
                  <span className="hist-line-bs tabular">
                    Bs {(sale.tax * bsRate).toFixed(2)}
                  </span>
                )}
              </span>
            </div>
          )}
          <div className="line total">
            <span>Total</span>
            <span>${sale.total.toFixed(2)}</span>
          </div>
          {bsRate > 0 && (
            <div className="line total-bs">
              <span>Total Bs</span>
              <span className="tabular">
                Bs ${(sale.total * bsRate).toFixed(2)}
              </span>
            </div>
          )}
        </div>

        <div className="hist-detail-payment">
          <div className="hist-detail-section-title">Método de pago</div>
          {sale.splits && sale.splits.length > 0 ? (
            <div className="hist-pay-list">
              {sale.splits.map((s, i) => (
                <div className="hist-pay-row" key={i}>
                  <Chip tone={METHOD_TONES[s.method] || 'neutral'}>
                    <Icon name={METHOD_ICONS[s.method] || 'tag'} size={12} />
                    {METHOD_LABELS[s.method] || s.method}
                  </Chip>
                  <span className="hist-pay-amt">
                    <span className="tabular">${s.amount.toFixed(2)}</span>
                    {bsRate > 0 && (
                      <span className="hist-pay-bs tabular">
                        Bs ${(s.amount * bsRate).toFixed(2)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="hist-pay-row">
              <Chip tone={METHOD_TONES[sale.method] || 'neutral'}>
                <Icon name={METHOD_ICONS[sale.method] || 'tag'} size={12} />
                {METHOD_LABELS[sale.method] || sale.method}
              </Chip>
              <span className="hist-pay-amt">
                <span className="tabular">${sale.total.toFixed(2)}</span>
                {bsRate > 0 && (
                  <span className="hist-pay-bs tabular">
                    Bs ${(sale.total * bsRate).toFixed(2)}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="hist-detail-actions hist-detail-actions-col">
        {canRefund && !isRefunded && (
          <Button
            variant="danger"
            icon="rotate-ccw"
            block
            disabled={!online}
            onClick={() => onRefund(sale)}
          >
            Reembolsar
          </Button>
        )}
        {canRefund && !isRefunded && !online && (
          <div className="t-body-sm">Reembolsar requiere conexión.</div>
        )}
        <div className="row" style={{ gap: 10 }}>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button icon="printer" onClick={() => onReprint && onReprint(sale)}>
            Reimprimir
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

interface RefundSheetProps {
  sale: Sale;
  onConfirm: (sale: Sale, reason: string) => void;
  onCancel: () => void;
  bsRate: number;
}

function RefundSheet({ sale, onConfirm, onCancel, bsRate }: RefundSheetProps) {
  const REASONS = [
    'Producto defectuoso',
    'Error en el cobro',
    'Cliente desistió',
    'Producto equivocado',
    'Otro',
  ];
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const finalReason = reason === 'Otro' ? note.trim() : reason;
  const canConfirm = !!finalReason;

  return (
    <Sheet onClose={onCancel} title="Reembolsar venta">
      <div className="refund-sheet">
        <div className="refund-summary">
          <div className="refund-summary-row">
            <span className="k">Recibo</span>
            <span className="v mono">N° {sale.invoiceNumber}</span>
          </div>
          <div className="refund-summary-row">
            <span className="k">Cliente</span>
            <span className="v">{sale.client?.name || 'Sin cliente'}</span>
          </div>
          <div className="refund-summary-row total">
            <span className="k">Monto a reembolsar</span>
            <span className="v tabular">
              ${sale.total.toFixed(2)}
              {bsRate > 0 ? ` · Bs ${(sale.total * bsRate).toFixed(2)}` : ''}
            </span>
          </div>
        </div>

        <div className="refund-field">
          <span className="refund-label">
            Motivo del reembolso<span className="req"> *</span>
          </span>
          <div className="refund-reasons">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className={`refund-reason-chip ${reason === r ? 'active' : ''}`}
                onClick={() => setReason(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {reason === 'Otro' && (
          <label className="refund-field">
            <span className="refund-label">
              Especifica el motivo<span className="req"> *</span>
            </span>
            <textarea
              className="input client-textarea"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe el motivo del reembolso"
              style={{ padding: '5px 14px' }}
            />
          </label>
        )}

        <Banner
          tone="warn"
          icon="alert-triangle"
          message="El reembolso devuelve las unidades al inventario y marca la venta como reembolsada. Esta acción no se puede deshacer."
        />
      </div>

      <div className="hist-detail-actions">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          icon="rotate-ccw"
          disabled={!canConfirm}
          onClick={() => onConfirm(sale, finalReason)}
        >
          Confirmar reembolso
        </Button>
      </div>
    </Sheet>
  );
}

export default function HistoryScreen() {
  const toast = useToast();
  // useSession() first so the token is in scope for the gated history query.
  const { token, can } = useSession();
  const online = useOnline();
  const pendingSales = usePendingSales();
  const bsRate = useBsRate();
  const refund = useMutation(api.sales.refund);
  const [q, setQ] = useState('');
  const [range, setRange] = useState('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('date-desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [detail, setDetail] = useState<Sale | null>(null);
  const [refunding, setRefunding] = useState<Sale | null>(null);
  const canRefund = can('void_sales');

  // The selected window travels to the server (index-resolved) instead of being
  // applied after downloading every sale ever made. Memoized on the filter state
  // so the query args keep their identity between renders — a fresh object with a
  // fresh `Date.now()` on each render would resubscribe in a loop.
  const salesWindow = useMemo(
    () => rangeBounds(range, fromDate, toDate),
    [range, fromDate, toDate]
  );
  const salesRaw = useQuery(
    api.sales.history,
    token ? { token, ...salesWindow } : 'skip'
  );
  const sales = salesRaw?.sales ?? [];
  // The totals below are computed over `sales`. If the server capped the window,
  // saying so is mandatory: a smaller revenue figure presented as the period's
  // truth is a wrong financial number, not a slow screen.
  const salesTruncated = salesRaw?.truncated === true;
  // Phase 10 — official history is NOT mirrored (server-only). Offline with no
  // cached result it is unavailable; the locally-queued offline sales are shown
  // separately as PENDING_SYNC (usePendingSales), enriched from the mirror.
  const salesUnavailable = !online && salesRaw === undefined;

  const doRefund = async (sale: Sale, reason: string) => {
    if (!online) {
      toast.error('Reembolsar requiere conexión.');
      return;
    }
    // The server returns the sold units back to inventory and flags the sale;
    // useQuery reactivity refreshes the list.
    try {
      await refund({ token: token!, saleId: sale._id, reason });
    } catch (e) {
      toast.error(mutationError(e));
      return;
    }
    setRefunding(null);
    setDetail(null);
  };

  // Filters
  const norm = (s?: string) => (s || '').toLowerCase();
  const filtered = sales
    .filter((s) => inRange(s, range, fromDate, toDate))
    .filter((s) => {
      if (methodFilter === 'all') return true;
      if (methodFilter === 'split') return s.splits && s.splits.length > 1;
      return s.method === methodFilter && !(s.splits && s.splits.length > 1);
    })
    .filter((s) => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'refunded') return !!s.refund;
      return !s.refund; // 'completed'
    })
    .filter((s) => {
      const term = norm(q);
      if (!term) return true;
      return (
        norm(s.invoiceNumber).includes(term) ||
        norm(s.client?.name).includes(term) ||
        norm(s.client?.taxId).includes(term)
      );
    });

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'date-desc':
        return b.soldAt - a.soldAt;
      case 'date-asc':
        return a.soldAt - b.soldAt;
      case 'total-desc':
        return b.total - a.total;
      case 'total-asc':
        return a.total - b.total;
      default:
        return 0;
    }
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [safePage, page]);
  const start = (safePage - 1) * pageSize;
  const visible = sorted.slice(start, start + pageSize);
  const showingFrom = sorted.length === 0 ? 0 : start + 1;
  const showingTo = Math.min(start + pageSize, sorted.length);

  // Stats — based on filtered set (not paginated)
  const stats = useMemo(() => {
    const active = filtered.filter((x) => !x.refund);
    const count = active.length;
    const revenue = active.reduce((s, x) => s + x.total, 0);
    const avg = count > 0 ? revenue / count : 0;
    const units = active.reduce(
      (s, x) => s + x.items.reduce((u, i) => u + i.qty, 0),
      0
    );
    return { count, revenue, avg, units };
  }, [filtered]);

  const resetPage = () => setPage(1);

  return (
    <>
      <AppBar
        title="Historial de ventas"
        online={online}
        /* left={<IconButton icon="chevron-left" onClick={() => void navigate('/')} ariaLabel="Volver" />} */
        right={
          <Button size="sm" icon="download">
            Exportar
          </Button>
        }
      />

      <div className="content hist-content">
        {salesUnavailable && (
          <Banner
            tone="warn"
            icon="wifi-off"
            title="Sin conexión"
            message="El historial oficial requiere conexión. Abajo están tus ventas pendientes de sincronizar."
          />
        )}
        {salesTruncated && (
          <Banner
            tone="warn"
            icon="alert-triangle"
            title="Periodo incompleto"
            message="Hay más ventas de las que se pueden mostrar. Los totales de abajo son parciales: acota el rango de fechas para verlos completos."
          />
        )}
        {pendingSales.length > 0 && (
          <div className="card">
            <div className="sec-head">
              <h2>Pendientes de sincronización</h2>
              <Chip tone="warn">{pendingSales.length}</Chip>
            </div>
            {pendingSales.map((ps) => (
              <div className="lrow" key={ps.localId}>
                <div className="thumb">
                  <Icon name="wifi-off" size={18} />
                </div>
                <div>
                  <p className="pname">
                    Venta offline · {ps.itemCount}{' '}
                    {ps.itemCount === 1 ? 'producto' : 'productos'}
                  </p>
                  <div className="pmeta">
                    {ps.clientName} · {METHOD_LABELS[ps.method] ?? ps.method} ·{' '}
                    {new Date(ps.soldAt).toLocaleTimeString('es', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                <div className="pright">
                  <Chip tone="warn">Pendiente</Chip>
                  <div className="tabular">${ps.total.toFixed(2)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="prod-stats hist-stats">
          <div className="prod-stat">
            <span className="k">Ventas</span>
            <span className="v tabular">{stats.count}</span>
            <span className="meta">en el periodo</span>
          </div>
          <div className="prod-stat">
            <span className="k">Ingresos</span>
            <span className="v tabular">${stats.revenue.toFixed(2)}</span>
            <span className="meta">
              {bsRate > 0
                ? `Bs ${(stats.revenue * bsRate).toFixed(2)}`
                : 'total facturado'}
            </span>
          </div>
          <div className="prod-stat">
            <span className="k">Productos</span>
            <span className="v tabular">{stats.units}</span>
            <span className="meta">unidades vendidas</span>
          </div>
        </div>

        {/* Date range */}
        <div className="hist-daterange-inline">
          <label className="catalog-filter">
            <span>Desde</span>
            <DateField
              value={fromDate}
              max={toDate || TODAY_ISO}
              onChange={(v) => {
                setFromDate(v);
                setRange('custom');
                resetPage();
              }}
            />
          </label>
          <label className="catalog-filter">
            <span>Hasta</span>
            <DateField
              value={toDate}
              min={fromDate || undefined}
              max={TODAY_ISO}
              onChange={(v) => {
                setToDate(v);
                setRange('custom');
                resetPage();
              }}
            />
          </label>
        </div>

        {/* Filters */}
        <div className="catalog-head" style={{ margin: '0 0 12px' }}>
          <Input
            placeholder="Buscar por factura, cliente o identificación"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPage();
            }}
          />

          <div className="catalog-filters hist-filters">
            <label className="catalog-filter">
              <span>Método</span>
              <select
                className="input cat-select"
                value={methodFilter}
                onChange={(e) => {
                  setMethodFilter(e.target.value);
                  resetPage();
                }}
              >
                <option value="all">Todos</option>
                <option value="cash">Efectivo dólar</option>
                <option value="cash_bs">Efectivo Bs</option>
                <option value="card">Tarjeta</option>
                <option value="transfer">Transferencia</option>
                <option value="mobile">Pago móvil</option>
                <option value="zelle">Zelle</option>
                <option value="split">Mixto</option>
              </select>
            </label>
            <label className="catalog-filter">
              <span>Estado</span>
              <select
                className="input cat-select"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  resetPage();
                }}
              >
                <option value="all">Todas</option>
                <option value="completed">Completadas</option>
                <option value="refunded">Reembolsadas</option>
              </select>
            </label>
            <label className="catalog-filter">
              <span>Ordenar por</span>
              <select
                className="input cat-select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="date-desc">Fecha (más reciente)</option>
                <option value="date-asc">Fecha (más antigua)</option>
                <option value="total-desc">Total (mayor)</option>
                <option value="total-asc">Total (menor)</option>
              </select>
            </label>
          </div>
        </div>

        {/* List */}
        {sorted.length === 0 ? (
          <div className="card empty" style={{ padding: '40px 20px' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 999,
                background: 'var(--paper-2)',
                color: 'var(--ink-3)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 10,
              }}
            >
              <Icon name="receipt" size={28} />
            </div>
            <h4>Sin ventas en este periodo</h4>
            <p>Ajusta los filtros para ver más resultados.</p>
          </div>
        ) : (
          <div className="hist-table">
            <div className="hist-row hist-head">
              <div className="hist-col-id">Venta</div>
              <div className="hist-col-client">Cliente</div>
              <div className="hist-col-items">Productos</div>
              <div className="hist-col-method">Método</div>
              <div className="hist-col-total">Total</div>
              <div className="hist-col-chevron" aria-hidden="true" />
            </div>
            {visible.map((s) => (
              <SaleTableRow
                key={s._id}
                sale={s}
                onClick={setDetail}
                bsRate={bsRate}
              />
            ))}
          </div>
        )}
        {sorted.length > 0 && (
          <div className="stored-grid hist-cards">
            {visible.map((s) => (
              <SaleRow
                key={s._id}
                sale={s}
                onClick={setDetail}
                bsRate={bsRate}
              />
            ))}
          </div>
        )}

        {/* Pager */}
        {sorted.length > 0 && (
          <div className="pager pager-sticky">
            <div className="pager-info">
              {sorted.length <= pageSize ? (
                <>
                  {sorted.length} {sorted.length === 1 ? 'venta' : 'ventas'}
                </>
              ) : (
                <>
                  Ventas{' '}
                  <strong>
                    {showingFrom}–{showingTo}
                  </strong>{' '}
                  de <strong>{sorted.length}</strong>
                </>
              )}
            </div>
            <div className="pager-size">
              <label htmlFor="hist-pager-size">Por página</label>
              <select
                id="hist-pager-size"
                className="input cat-select pager-size-select"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(parseInt(e.target.value, 10));
                  setPage(1);
                }}
              >
                <option value="6">6</option>
                <option value="12">12</option>
                <option value="24">24</option>
                <option value="48">48</option>
              </select>
            </div>
            <div className="pager-nav">
              <IconButton
                icon="chevrons-left"
                ariaLabel="Primera página"
                onClick={() => setPage(1)}
                disabled={safePage === 1}
              />
              <IconButton
                icon="chevron-left"
                ariaLabel="Anterior"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
              />
              <div className="pager-current">
                Página {safePage} de {totalPages}
              </div>
              <IconButton
                icon="chevron-right"
                ariaLabel="Siguiente"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
              />
              <IconButton
                icon="chevrons-right"
                ariaLabel="Última página"
                onClick={() => setPage(totalPages)}
                disabled={safePage === totalPages}
              />
            </div>
          </div>
        )}
      </div>

      {detail && (
        <SaleDetailSheet
          sale={detail}
          online={online}
          bsRate={bsRate}
          canRefund={canRefund}
          onRefund={(s) => setRefunding(s)}
          onClose={() => setDetail(null)}
          onReprint={(s) => toast.info(`Reimprimir ${s.invoiceNumber} (demo)`)}
        />
      )}

      {refunding && (
        <RefundSheet
          sale={refunding}
          bsRate={bsRate}
          onConfirm={(...args: Parameters<typeof doRefund>) => {
            void doRefund(...args);
          }}
          onCancel={() => setRefunding(null)}
        />
      )}
    </>
  );
}
