// StoredCartsScreen — list of paused/parked sales the cashier can resume
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AppBar,
  Button,
  ConfirmDialog,
  Icon,
  IconButton,
  Input,
  Sheet,
} from '@/components';
import { useCart } from '@/state/CartContext';
import { useOnline } from '@/state/useOnline';
import { useBsRate } from '@/state/hooks';
import type { HeldCart } from '@/types';
import { splitUsd } from './Payment';

function relativeTime(value?: number) {
  if (!value) return '';
  const d = new Date(value);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return d.toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// Date field that shows DD/MM/YYYY but stores YYYY-MM-DD, backed by the native picker.
export function DateField({
  value,
  min,
  max,
  onChange,
}: {
  value: string;
  min?: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const display = value
    ? value.split('-').reverse().join('/') // YYYY-MM-DD → DD/MM/YYYY
    : '';
  const openPicker = () => {
    const el = ref.current;
    if (!el) return;
    if (el.showPicker) {
      try {
        el.showPicker();
        return;
      } catch {
        /* fall through */
      }
    }
    el.focus();
    el.click();
  };
  return (
    <div className="datefield" onClick={openPicker}>
      <input
        className="input datefield-display"
        type="text"
        readOnly
        placeholder="dd/mm/aaaa"
        value={display}
      />
      {value ? (
        <button
          type="button"
          className="datefield-clear"
          aria-label="Limpiar fecha"
          onClick={(e) => {
            e.stopPropagation();
            onChange('');
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      ) : (
        <svg
          className="datefield-cal"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )}
      <input
        ref={ref}
        className="datefield-native"
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function StoredCartsScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const bsRate = useBsRate();
  const {
    heldCarts: carts,
    resumeSale,
    discardStored,
    cart,
    selectedClient,
    pauseSale,
    discardSale,
  } = useCart();

  const [confirmDiscard, setConfirmDiscard] = useState<HeldCart | null>(null);
  // When set, a sale is already in progress and the cashier must choose what to
  // do with it before resuming `id`. `canPause` is false for a client-only
  // sale (empty cart can't be parked).
  const [resumeGuard, setResumeGuard] = useState<{
    id: HeldCart['_id'];
    canPause: boolean;
  } | null>(null);
  const [detailCart, setDetailCart] = useState<HeldCart | null>(null);
  const [q, setQ] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState('date-desc');
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  const handleResume = async (id: HeldCart['_id']) => {
    try {
      await resumeSale(id);
      void navigate('/venta');
    } catch (e: any) {
      alert(
        typeof e?.data === 'string'
          ? e.data
          : 'Ocurrió un error. Intenta de nuevo.'
      );
    }
  };
  const handleDiscard = async (id: HeldCart['_id']) => {
    try {
      await discardStored(id);
    } catch (e: any) {
      alert(
        typeof e?.data === 'string'
          ? e.data
          : 'Ocurrió un error. Intenta de nuevo.'
      );
    }
  };

  // Resume guard: never silently overwrite an in-progress sale. Resume directly
  // only when nothing is in progress; otherwise ask the cashier what to do.
  const requestResume = (id: HeldCart['_id']) => {
    const hasItems = cart.length > 0;
    const saleInProgress = hasItems || selectedClient != null;
    if (!saleInProgress) {
      void handleResume(id);
      return;
    }
    setResumeGuard({ id, canPause: hasItems });
  };

  // "Pausar y reanudar": park the current sale, THEN resume the held one.
  // CRITICAL: if parking fails we ABORT — resumeSale must NOT run, or the
  // in-progress sale would be lost. Surface the error and keep the dialog open.
  const handlePauseAndResume = async () => {
    if (!resumeGuard) return;
    const { id } = resumeGuard;
    try {
      await pauseSale();
    } catch (e: any) {
      alert(
        typeof e?.data === 'string'
          ? e.data
          : 'No se pudo pausar la venta en curso. Intenta de nuevo.'
      );
      return; // abort — the current sale stays intact
    }
    try {
      await resumeSale(id);
      setResumeGuard(null);
      void navigate('/venta');
    } catch (e: any) {
      alert(
        typeof e?.data === 'string'
          ? e.data
          : 'Ocurrió un error. Intenta de nuevo.'
      );
    }
  };

  // "Descartar y reanudar": throw the current sale away, THEN resume the held one.
  const handleDiscardAndResume = async () => {
    if (!resumeGuard) return;
    const { id } = resumeGuard;
    discardSale();
    try {
      await resumeSale(id);
      setResumeGuard(null);
      void navigate('/venta');
    } catch (e: any) {
      alert(
        typeof e?.data === 'string'
          ? e.data
          : 'Ocurrió un error. Intenta de nuevo.'
      );
    }
  };

  const norm = (s?: string) => (s || '').toLowerCase();
  const taxOf = (c?: HeldCart['client']) =>
    c?.taxId ? (c.taxPrefix ? `${c.taxPrefix}-${c.taxId}` : c.taxId) : '';
  const localDay = (value?: number) => {
    if (!value) return '';
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const filtered = carts.filter((s) => {
    const term = norm(q);
    if (term) {
      const hit =
        norm(s.code).includes(term) ||
        norm(s.client?.name).includes(term) ||
        norm(taxOf(s.client)).includes(term);
      if (!hit) return false;
    }
    const created = localDay(s.createdAt);
    // Only apply the date range when BOTH dates are selected.
    if (fromDate && toDate && created) {
      if (created < fromDate || created > toDate) return false;
    }
    return true;
  });
  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'date-asc':
        return a.createdAt < b.createdAt ? -1 : 1;
      case 'total-desc':
        return b.total - a.total;
      case 'total-asc':
        return a.total - b.total;
      default:
        return a.createdAt < b.createdAt ? 1 : -1; // date-desc
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

  return (
    <>
      <AppBar
        title="Ventas en espera"
        sub={
          carts.length === 0
            ? 'Sin ventas pausadas'
            : `${carts.length} en espera`
        }
        online={online}
        /* left={<IconButton icon="chevron-left" onClick={() => void navigate('/venta')} ariaLabel="Volver" />} */
      />

      <div
        className="content stored-content"
        style={{ padding: '5px', textAlign: 'left' }}
      >
        {carts.length === 0 ? (
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
              <Icon name="pause-circle" size={28} />
            </div>
            <h4>Ninguna venta pausada</h4>
            <p>
              Cuando un cliente se retire un momento, toca "Pausar" en la venta
              para guardarla aquí y atender al siguiente.
            </p>
          </div>
        ) : (
          <>
            <div className="catalog-head" style={{ margin: '0 0 14px' }}>
              <Input
                placeholder="Buscar por recibo, cliente o identificación"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
              <div className="catalog-filters">
                <label className="catalog-filter">
                  <span>Desde</span>
                  <DateField
                    value={fromDate}
                    max={toDate || todayStr}
                    onChange={(v) => {
                      setFromDate(v);
                      setPage(1);
                    }}
                  />
                </label>
                <label className="catalog-filter">
                  <span>Hasta</span>
                  <DateField
                    value={toDate}
                    min={fromDate || undefined}
                    max={todayStr}
                    onChange={(v) => {
                      setToDate(v);
                      setPage(1);
                    }}
                  />
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
                    <option value="total-desc">Total (mayor a menor)</option>
                    <option value="total-asc">Total (menor a mayor)</option>
                  </select>
                </label>
              </div>
            </div>
            {sorted.length === 0 ? (
              <div className="card empty" style={{ padding: '32px 16px' }}>
                <h4>Sin resultados</h4>
                <p>Ninguna venta en espera coincide con los filtros.</p>
              </div>
            ) : (
              <div className="stored-grid">
                {visible.map((s) => {
                  const itemCount = s.items.reduce((acc, i) => acc + i.qty, 0);
                  const paidSoFar = (s.splits || []).reduce(
                    (acc, r) => acc + splitUsd(r, bsRate),
                    0
                  );
                  const remaining = Math.max(0, s.total - paidSoFar);
                  return (
                    <div className="stored-card" key={s._id}>
                      <div className="stored-card-head">
                        <div className="stored-card-id mono">N° {s.code}</div>
                        <div className="stored-card-time">
                          {relativeTime(s.createdAt)}
                        </div>
                      </div>
                      <div className="stored-card-client">
                        <div className="stored-card-avatar">
                          {(s.client?.name?.[0] || '?').toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="stored-card-name">
                            {s.client?.name || 'Sin cliente'}
                          </div>
                          {s.client?.taxId && (
                            <div className="stored-card-tax mono">
                              {s.client.taxPrefix
                                ? `${s.client.taxPrefix}-${s.client.taxId}`
                                : s.client.taxId}
                            </div>
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
                          <span className="v tabular">
                            ${s.total.toFixed(2)}
                          </span>
                          {bsRate > 0 && (
                            <span className="v-bs tabular">
                              Bs {(s.total * bsRate).toFixed(2)}
                            </span>
                          )}
                        </div>
                        {paidSoFar > 0.005 && (
                          <div className="stored-card-cell">
                            <span className="k">Pagado</span>
                            <span className="v tabular ok">
                              ${paidSoFar.toFixed(2)}
                            </span>
                            {bsRate > 0 && (
                              <span className="v-bs tabular ok">
                                Bs {(paidSoFar * bsRate).toFixed(2)}
                              </span>
                            )}
                          </div>
                        )}
                        {paidSoFar > 0.005 && (
                          <div className="stored-card-cell">
                            <span className="k">Falta por cobrar</span>
                            <span className="v tabular warn">
                              ${remaining.toFixed(2)}
                            </span>
                            {bsRate > 0 && (
                              <span className="v-bs tabular warn">
                                Bs {(remaining * bsRate).toFixed(2)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        className="stored-card-products"
                        onClick={() => setDetailCart(s)}
                      >
                        <Icon name="package" size={16} />
                        Ver productos ({itemCount})
                      </button>
                      <div className="stored-card-actions">
                        <Button
                          size="sm"
                          icon="play"
                          onClick={() => requestResume(s._id)}
                        >
                          Reanudar
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon="trash-2"
                          onClick={() => setConfirmDiscard(s)}
                        >
                          Descartar
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        {carts.length > 0 && sorted.length > 0 && (
          <div className="pager pager-sticky">
            <div className="pager-info">
              {sorted.length <= pageSize ? (
                <>
                  {sorted.length}{' '}
                  {sorted.length === 1 ? 'venta en espera' : 'ventas en espera'}
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
              <label htmlFor="pager-size">Por página</label>
              <select
                id="pager-size"
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

      {confirmDiscard && (
        <ConfirmDialog
          title="¿Descartar venta en espera?"
          message={`Se eliminará ${confirmDiscard.code} con ${confirmDiscard.items.length} producto${confirmDiscard.items.length === 1 ? '' : 's'}. Esta acción no se puede deshacer.`}
          confirmLabel="Sí, descartar"
          tone="danger"
          onConfirm={() => {
            void handleDiscard(confirmDiscard._id);
            setConfirmDiscard(null);
          }}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}
      {resumeGuard && (
        <Sheet onClose={() => setResumeGuard(null)} dialog>
          <div style={{ font: '700 18px var(--font-sans)', marginBottom: 6 }}>
            Tienes una venta en curso
          </div>
          <div
            style={{
              font: '400 14px var(--font-sans)',
              color: 'var(--ink-2)',
              marginBottom: 18,
              lineHeight: 1.5,
            }}
          >
            Si reanudas esta venta, ¿qué quieres hacer con la venta que tienes
            en curso?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {resumeGuard.canPause && (
              <Button
                block
                size="sm"
                onClick={() => void handlePauseAndResume()}
              >
                Pausar y reanudar
              </Button>
            )}
            <Button
              block
              size="sm"
              variant="danger"
              onClick={() => void handleDiscardAndResume()}
            >
              Descartar y reanudar
            </Button>
            <Button
              block
              size="sm"
              variant="secondary"
              onClick={() => setResumeGuard(null)}
            >
              Cancelar
            </Button>
          </div>
        </Sheet>
      )}
      {detailCart && (
        <Sheet
          onClose={() => setDetailCart(null)}
          title={`Productos · ${detailCart.code}`}
        >
          <div className="stored-products-list">
            {detailCart.items.map((i) => (
              <div className="stored-product-row" key={i.productId}>
                <div className="thumb" aria-hidden="true">
                  {i.glyph}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="stored-product-name">{i.name}</div>
                  <div className="stored-product-meta mono">
                    {i.sku} · {i.qty} × ${i.price.toFixed(2)}
                  </div>
                </div>
                <div className="stored-product-amt">
                  <div className="tabular">${(i.price * i.qty).toFixed(2)}</div>
                  {bsRate > 0 && (
                    <div className="tabular stored-product-bs">
                      Bs {(i.price * i.qty * bsRate).toFixed(2)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="stored-products-total">
            <span>Total</span>
            <span className="tabular">
              ${detailCart.total.toFixed(2)}
              {bsRate > 0
                ? ` · Bs ${(detailCart.total * bsRate).toFixed(2)}`
                : ''}
            </span>
          </div>
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <Button variant="secondary" onClick={() => setDetailCart(null)}>
              Cerrar
            </Button>
            <Button
              icon="play"
              onClick={() => {
                const id = detailCart._id;
                setDetailCart(null);
                requestResume(id);
              }}
            >
              Reanudar
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}
