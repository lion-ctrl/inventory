// Sale screen — the core POS workhorse. Scanner + cart + cobrar.
// Responsive: mobile-first, tablet/desktop two-pane
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import {
  AppBar,
  Banner,
  BottomBar,
  Button,
  Chip,
  ConfirmDialog,
  Icon,
  Input,
  Sheet,
} from '@/components';
import { useCart } from '@/state/CartContext';
import {
  useBsRate,
  useCategories,
  useClients,
  useProducts,
  useSettingsDoc,
} from '@/state/hooks';
import { useOnline } from '@/state/useOnline';
import type { CartItem, Client, Product, SalesType, SplitRow } from '@/types';
import { splitUsd } from './Payment';
import { ClientForm, ClientPickerSheet, formatTaxId } from './Clients';
import { CameraScanner } from './CameraScanner';

// Ported from prototype app.jsx — drives the >= 1000px two-pane layout.
function useViewport() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}

export const SCAN_STATES = {
  AIMING: 'aiming', // pointing camera, no code yet
  READING: 'reading', // detected code, processing
  LOCKED: 'locked', // code matched
} as const;

type ScanState = (typeof SCAN_STATES)[keyof typeof SCAN_STATES];

export interface ScanResult {
  found: boolean;
  product?: Product;
  code?: string;
}

export function BarcodeViz({
  code,
  locked: _locked,
}: {
  code: string | null;
  locked?: boolean;
}) {
  // Deterministic bar widths driven by the code so it always looks like a real
  // EAN-13. ~58 bars to fill the frame nicely.
  const seed = (code || '7591000000000').replace(/\D/g, '').padEnd(13, '0');
  const widths = [
    'thin',
    'med',
    'thin',
    'thin',
    'thick',
    'thin',
    'med',
    'thin',
    'thick',
    'thin',
  ];
  const bars: string[] = [];
  for (let i = 0; i < 58; i++) {
    const ch = seed.charCodeAt(i % seed.length);
    const isBar = ch % 3 !== 0;
    bars.push(isBar ? widths[ch % widths.length] : 'spacer');
  }
  const displayCode = code || '7 591000 000000';
  return (
    <div className="barcode-viz">
      <div className="bars">
        {bars.map((w, i) => (
          <span key={i} className={`bar ${w}`} />
        ))}
      </div>
      <div className="digits">{displayCode}</div>
    </div>
  );
}

export function detectBarcodeFormat(code: string | null): string | null {
  if (!code) return null;
  const digits = code.replace(/\D/g, '');
  if (digits.length === 13) return 'EAN-13';
  if (digits.length === 12) return 'UPC-A';
  if (digits.length === 8) return 'EAN-8';
  if (/[A-Z]/i.test(code)) return 'CODE 128';
  return 'CODE 128';
}

export interface ScannerViewProps {
  onScanResult: (r: ScanResult) => void;
  mode?: 'scroll' | 'split';
  density?: string;
  catalog: Product[];
  /** Owner-configured input (Ajustes → "Modo de escaneo"); absent = physical. */
  scannerMode?: 'physical' | 'camera';
  /**
   * Desktop-only (mode="split") height knob. Overrides the CSS aspect-ratio of
   * `.scanner-wrap.wide` (16/9 ≈ 1.78). HIGHER value = SHORTER scanner; lower it
   * back toward 1.78 to grow taller. Unset → CSS default. Mobile (mode="scroll")
   * never applies it.
   */
  wideAspectRatio?: number;
}

// Dispatcher (hook-free on purpose): swapping the mode swaps the child component,
// so React remounts cleanly when the owner changes the setting mid-session.
export function ScannerView({
  scannerMode = 'physical',
  ...props
}: ScannerViewProps) {
  if (scannerMode === 'camera') return <CameraScanner {...props} />;
  return <PhysicalScannerView {...props} />;
}

function PhysicalScannerView({
  onScanResult,
  mode = 'scroll',
  density = 'roomy',
  catalog,
  wideAspectRatio,
}: Omit<ScannerViewProps, 'scannerMode'>) {
  // mode: 'scroll' (mobile inline) | 'split' (desktop top-left)
  const [state, setState] = useState<ScanState>(SCAN_STATES.AIMING);
  const [fakeCode, setFakeCode] = useState<string | null>(null);
  const [scanIdx, setScanIdx] = useState(0);

  // Prototype scan simulation, kept for future camera wiring. The demo
  // "Simular escaneo / Forzar fallo" buttons that invoked it were stripped
  // (no demo controls in production).
  const _trigger = useCallback(
    (forceMiss = false) => {
      const cycle = scanIdx % 5;
      setScanIdx((s) => s + 1);
      setState(SCAN_STATES.READING);
      const code = forceMiss
        ? '7' + Math.floor(1e12 + Math.random() * 8e12)
        : catalog[cycle].barcode;
      setFakeCode(code);
      setTimeout(() => {
        const isMiss = forceMiss || cycle === 4;
        if (isMiss) {
          setState(SCAN_STATES.AIMING);
          setFakeCode(null);
          onScanResult({ found: false, code });
        } else {
          setState(SCAN_STATES.LOCKED);
          setTimeout(() => {
            setState(SCAN_STATES.AIMING);
            setFakeCode(null);
            onScanResult({ found: true, product: catalog[cycle] });
          }, 350);
        }
      }, 450);
    },
    [scanIdx, onScanResult, catalog]
  );

  // Hardware (HID keyboard-wedge) barcode scanners type the code as rapid
  // keystrokes ending with Enter. Buffer fast global keystrokes and resolve
  // against the catalog with the same visual flow as a camera read.
  const busyRef = useRef(false);
  useEffect(() => {
    let buffer = '';
    let lastTs = 0;
    const isFormField = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      if (!t || !t.tagName) return false;
      return (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isFormField(e.target)) return;
      const now = Date.now();
      if (now - lastTs > 80) buffer = '';
      lastTs = now;
      if (e.key === 'Enter') {
        const code = buffer;
        buffer = '';
        if (code.length < 6 || busyRef.current) return;
        e.preventDefault();
        busyRef.current = true;
        setState(SCAN_STATES.READING);
        setFakeCode(code);
        window.setTimeout(() => {
          const product = catalog.find((p) => p.barcode === code);
          if (!product) {
            setState(SCAN_STATES.AIMING);
            setFakeCode(null);
            busyRef.current = false;
            onScanResult({ found: false, code });
          } else {
            setState(SCAN_STATES.LOCKED);
            window.setTimeout(() => {
              setState(SCAN_STATES.AIMING);
              setFakeCode(null);
              busyRef.current = false;
              onScanResult({ found: true, product });
            }, 350);
          }
        }, 450);
        return;
      }
      if (e.key.length === 1 && /[\w-]/.test(e.key)) buffer += e.key;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [catalog, onScanResult]);

  const aspect = mode === 'split' ? 'wide' : density === 'dense' ? 'wide' : '';
  const locked = state === SCAN_STATES.LOCKED;
  const reading = state === SCAN_STATES.READING;
  const detectedFormat =
    reading || locked ? detectBarcodeFormat(fakeCode) : null;

  return (
    <div
      className={`scanner-wrap ${aspect}`}
      style={{
        margin: '0px 4px 0px 3px',
        // Desktop (mode="split") height knob: overrides .scanner-wrap.wide (16/9).
        // Higher ratio = shorter scanner. Mobile (mode="scroll") never sets this.
        ...(mode === 'split' && wideAspectRatio
          ? { aspectRatio: wideAspectRatio }
          : {}),
      }}
    >
      <div className="cam-bg" style={{ margin: '0px' }} />
      {detectedFormat && (
        <div className={`scan-format ${locked ? 'locked' : ''}`}>
          <span className="led" />
          {detectedFormat}
        </div>
      )}
      <div className={`scan-frame ${locked ? 'locked' : ''}`}>
        <i />
      </div>
      <BarcodeViz code={fakeCode} locked={locked} />
      {!locked && <div className="scan-beam" />}
      <div className={`scan-hint ${locked ? 'locked' : ''}`}>
        {state === SCAN_STATES.AIMING && 'Apunta la cámara al código de barras'}
        {reading && 'Leyendo código…'}
        {locked && '✓ Código leído'}
      </div>
    </div>
  );
}

// Prototype's `CartItem` row — renamed CartItemRow so it doesn't clash with the
// CartItem type from ../types.
function CartItemRow({
  item,
  onInc,
  onDec,
  onRemove,
  onSetQty,
  bsRate,
}: {
  item: CartItem;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
  onSetQty?: ((n: number) => void) | null;
  bsRate: number;
}) {
  const MAX_QTY = 1000000;
  const stockCap =
    typeof item.stock === 'number' && item.stock > 0 ? item.stock : MAX_QTY;
  const fmt = (n: number) => n.toLocaleString('es');
  const [draft, setDraft] = useState(fmt(item.qty));
  useEffect(() => {
    setDraft(fmt(item.qty));
  }, [item.qty]);
  const categories = useCategories();
  const catLabel =
    categories.find((c) => c._id === item.categoryId)?.label ?? '';
  return (
    <div className="cartrow">
      <div className="thumb">{item.glyph}</div>
      <div style={{ minWidth: 0 }}>
        <p className="pname">{item.name}</p>
        <div className="pmeta">{catLabel}</div>
        <div className="pmeta">
          ${item.price.toFixed(2)} c/u
          {bsRate > 0 ? ` · Bs ${(item.price * bsRate).toFixed(2)}` : ''}
        </div>
        {item.qty >= stockCap && stockCap < MAX_QTY && (
          <div className="pmeta qty-max">Máx. {stockCap} en stock</div>
        )}
      </div>
      <div className="cart-right">
        <button className="delete" onClick={onRemove} aria-label="quitar">
          <Icon name="trash-2" size={16} />
        </button>
        <div className="price">${(item.price * item.qty).toFixed(2)}</div>
        {bsRate > 0 && (
          <div className="price-bs">
            Bs {(item.price * item.qty * bsRate).toFixed(2)}
          </div>
        )}
      </div>
      <div className="cart-qty-row">
        <div className="qty">
          <button onClick={onDec} aria-label="quitar uno">
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            className="qty-input"
            value={draft}
            onChange={(e) => {
              let n = parseInt(e.target.value.replace(/\D/g, ''), 10);
              if (isNaN(n)) {
                setDraft('');
                return;
              }
              if (n > stockCap) n = stockCap;
              setDraft(fmt(n));
              if (n >= 1 && onSetQty) onSetQty(n);
            }}
            onBlur={() => {
              let n = parseInt(draft.replace(/\D/g, ''), 10);
              if (!n || n < 1) {
                setDraft(fmt(item.qty));
              } else {
                n = Math.min(stockCap, n);
                if (onSetQty) onSetQty(n);
              }
            }}
            aria-label="cantidad"
          />
          <button
            onClick={() => {
              if (item.qty < stockCap) onInc();
            }}
            disabled={item.qty >= stockCap}
            aria-label="agregar uno"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientChip({
  client,
  onClick,
  compact,
}: {
  client: Client | null;
  onClick: () => void;
  compact?: boolean;
}) {
  const label = client ? client.name : 'Asociar cliente';
  return (
    <button
      className={`client-chip ${compact ? 'compact' : ''} ${client ? '' : 'empty'}`}
      onClick={onClick}
      title={client ? 'Ver cliente' : 'Asociar cliente a la venta'}
    >
      <Icon name={client ? 'user' : 'user-plus'} size={16} />
      <span className="client-chip-name">{label}</span>
    </button>
  );
}

function ClientInfoSheet({
  client,
  onClose,
  onChange,
}: {
  client: Client | null;
  onClose: () => void;
  onChange: () => void;
}) {
  if (!client) return null;
  const taxDisplay = client.taxId
    ? client.taxPrefix
      ? `${client.taxPrefix}-${client.taxId}`
      : client.taxId
    : null;
  const kindLabel =
    client.kind === 'business' ? 'Empresa / Negocio' : 'Persona natural';
  return (
    <Sheet onClose={onClose} title="Cliente de esta venta">
      <div className="client-info-card">
        <div className="client-info-head">
          <div className="client-info-avatar">
            {(client.name?.[0] || '?').toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="client-info-name">{client.name}</div>
            <Chip
              tone={client.kind === 'business' ? 'info' : 'ok'}
              style={{ marginTop: 6 }}
            >
              {kindLabel}
            </Chip>
          </div>
        </div>
        <div className="client-info-rows">
          {taxDisplay && (
            <div className="client-info-row">
              <span className="k">Identificación</span>
              <span className="v mono">{taxDisplay}</span>
            </div>
          )}
          {client.phone && (
            <div className="client-info-row">
              <span className="k">Teléfono</span>
              <span className="v">{client.phone}</span>
            </div>
          )}
          {client.email && (
            <div className="client-info-row">
              <span className="k">Email</span>
              <span className="v">{client.email}</span>
            </div>
          )}
          {client.address && (
            <div className="client-info-row">
              <span className="k">Dirección</span>
              <span className="v">{client.address}</span>
            </div>
          )}
        </div>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
        <Button icon="repeat" onClick={onChange}>
          Cambiar
        </Button>
      </div>
    </Sheet>
  );
}

export function ProductFoundSheet({
  product,
  onAdd,
  onCancel,
  onBack,
  currentCartQty = 0,
  reservedUnits = 0,
  bsRate,
}: {
  product: Product;
  onAdd: (product: Product, qty: number) => void;
  onCancel: () => void;
  onBack?: (() => void) | null;
  currentCartQty?: number;
  /** Units of this product reserved by held ("en espera") carts — soft-locked. */
  reservedUnits?: number;
  bsRate: number;
}) {
  // Display stays PHYSICAL (product.stock); availability nets out en-espera plus
  // what's already in this cart. You can add while this stays > 0.
  const maxAddable = Math.max(
    0,
    product.stock - reservedUnits - currentCartQty
  );
  const [qty, setQty] = useState(Math.min(1, maxAddable) || 1);
  const fmt = (n: number) => n.toLocaleString('es');
  const [draft, setDraft] = useState(fmt(Math.min(1, maxAddable) || 1));
  useEffect(() => {
    setDraft(fmt(qty));
  }, [qty]);
  const totalQty = currentCartQty + qty;
  const insufficientStock = totalQty > product.stock;
  const setQtyClamped = (n: number) =>
    setQty(Math.max(1, Math.min(maxAddable || 1, n)));

  return (
    <Sheet onClose={onCancel}>
      {onBack && (
        <button
          className="sheet-back"
          onClick={onBack}
          aria-label="Volver a la búsqueda"
        >
          <Icon name="chevron-left" size={18} />
          <span>Volver a la búsqueda</span>
        </button>
      )}
      <div
        className="row"
        style={{ marginBottom: 12, gap: 12, alignItems: 'flex-start' }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: 'var(--paper-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            flex: 'none',
          }}
        >
          {product.glyph}
        </div>
        <div style={{ minWidth: 0, flex: 1 }} className="found-product-info">
          <div className="found-product-name" style={{ textAlign: 'left' }}>
            {product.name}
          </div>
          <div className="found-product-meta">
            <span className="mono">{product.sku}</span>
            <span className="mono">{product.barcode}</span>
          </div>
        </div>
        <div className="found-stock-chips">
          <Chip
            tone={
              product.stock > 5 ? 'ok' : product.stock > 2 ? 'warn' : 'danger'
            }
            style={{ flex: 'none' }}
          >
            {product.stock} en stock
          </Chip>
          {reservedUnits > 0 && (
            <Chip tone="warn" style={{ flex: 'none' }}>
              {reservedUnits} en espera
            </Chip>
          )}
          {product.exempt === true && (
            <Chip tone="info" style={{ flex: 'none' }}>
              Exento IVA
            </Chip>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          padding: '14px 0',
          borderTop: '1px dashed var(--line-strong)',
          borderBottom: '1px dashed var(--line-strong)',
          margin: '8px 0',
        }}
      >
        <div
          style={{
            font: '500 12px var(--font-sans)',
            color: 'var(--ink-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Precio
        </div>
        <div className="spacer" />
        <div style={{ textAlign: 'right' }}>
          <div
            className="tabular"
            style={{
              font: '700 28px var(--font-sans)',
              letterSpacing: '-0.01em',
            }}
          >
            ${product.price.toFixed(2)}
          </div>
          {bsRate > 0 && (
            <div
              className="tabular"
              style={{
                font: '600 14px var(--font-sans)',
                color: 'var(--accent-2)',
              }}
            >
              Bs {(product.price * bsRate).toFixed(2)}
            </div>
          )}
        </div>
      </div>

      <div
        className="row"
        style={{
          gap: 16,
          marginTop: 12,
          marginBottom: 14,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ font: '600 14px var(--font-sans)' }}>Cantidad</div>
        <div className="qty">
          <button
            onClick={() => setQtyClamped(qty - 1)}
            aria-label="quitar uno"
          >
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            className="qty-input"
            value={draft}
            onChange={(e) => {
              let n = parseInt(e.target.value.replace(/\D/g, ''), 10);
              if (isNaN(n)) {
                setDraft('');
                return;
              }
              const cap = maxAddable || 1;
              if (n > cap) n = cap;
              setDraft(fmt(n));
              if (n >= 1) setQty(n);
            }}
            onBlur={() => {
              const n = parseInt(draft.replace(/\D/g, ''), 10);
              if (!n || n < 1) {
                setDraft(fmt(qty));
              } else {
                const v = Math.min(maxAddable || 1, n);
                setQty(v);
                setDraft(fmt(v));
              }
            }}
            aria-label="cantidad"
          />
          <button
            onClick={() => setQtyClamped(qty + 1)}
            disabled={qty >= maxAddable}
            aria-label="agregar uno"
          >
            +
          </button>
        </div>
      </div>

      {(insufficientStock || qty >= maxAddable) && (
        <Banner
          tone="warn"
          icon="alert-triangle"
          title={
            reservedUnits > 0
              ? 'Unidades en espera'
              : currentCartQty > 0
                ? 'Stock limitado'
                : 'Producto no disponible'
          }
          message={
            reservedUnits > 0
              ? `${reservedUnits} unidad(es) en espera — no disponibles para esta venta.`
              : currentCartQty > 0
                ? `Solo puedes agregar ${maxAddable} más (ya tienes ${currentCartQty} en el carrito de ${product.stock} disponibles).`
                : `Este producto se encuentra agotado`
          }
        />
      )}

      <div className="row" style={{ gap: 10, marginTop: 12 }}>
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          onClick={() => onAdd(product, qty)}
          disabled={insufficientStock || maxAddable < 1}
        >
          Agregar al carrito
        </Button>
      </div>
    </Sheet>
  );
}

function ProductNotFoundSheet({
  code,
  onRetry,
  onSearch,
  onClose,
}: {
  code: string;
  onRetry: () => void;
  onSearch: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '8px 4px 4px' }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 10,
          }}
        >
          <Icon name="search-x" size={28} />
        </div>
        <h3 style={{ margin: '4px 0 4px', font: '700 18px var(--font-sans)' }}>
          Producto no encontrado
        </h3>
        <div className="mono" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          Código: {code}
        </div>
        <p
          style={{
            font: '400 14px var(--font-sans)',
            color: 'var(--ink-2)',
            marginTop: 10,
          }}
        >
          Búscalo manualmente o escanea de nuevo.
        </p>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 12 }}>
        <Button variant="secondary" onClick={onSearch}>
          Buscar manual
        </Button>
        <Button onClick={onRetry}>Escanear de nuevo</Button>
      </div>
    </Sheet>
  );
}

export function ManualSearchSheet({
  onPick,
  onClose,
  catalog,
  reserved = {},
}: {
  onPick: (p: Product) => void;
  onClose: () => void;
  catalog: Product[];
  /** productId → units reserved by held ("en espera") carts. */
  reserved?: Record<string, number>;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('name-asc');
  const categories = useCategories();
  const catLabel = (p: Product) =>
    categories.find((c) => c._id === p.categoryId)?.label ?? '';

  const byCat =
    cat === 'all' ? catalog : catalog.filter((p) => p.categoryId === cat);
  const filtered = q.trim()
    ? byCat.filter(
        (p) =>
          p.name.toLowerCase().includes(q.toLowerCase()) ||
          p.sku.toLowerCase().includes(q.toLowerCase()) ||
          p.barcode.includes(q)
      )
    : byCat;

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'price-asc':
        return a.price - b.price;
      case 'price-desc':
        return b.price - a.price;
      default:
        return 0;
    }
  });

  const results = q.trim() ? sorted : sorted.slice(0, 12);

  return (
    <Sheet onClose={onClose} title="Buscar producto">
      <Input
        autoFocus
        placeholder="Nombre, SKU o código de barras"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="search-filters">
        <div className="search-filter">
          <label>Categoría</label>
          <select
            className="input"
            value={cat}
            onChange={(e) => setCat(e.target.value)}
          >
            <option value="all">Todos</option>
            {categories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="search-filter">
          <label>Ordenar por</label>
          <select
            className="input"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="name-asc">Nombre (A–Z)</option>
            <option value="name-desc">Nombre (Z–A)</option>
            <option value="price-asc">Precio (menor a mayor)</option>
            <option value="price-desc">Precio (mayor a menor)</option>
          </select>
        </div>
      </div>
      <div className="search-results" style={{ marginTop: 12 }}>
        {results.length === 0 ? (
          <div className="empty">
            <p>Sin resultados{q ? ` para “${q}”` : ''}</p>
          </div>
        ) : (
          results.map((p) => (
            <div
              className="lrow"
              key={p._id}
              onClick={() => onPick(p)}
              style={{ cursor: 'pointer' }}
            >
              <div className="thumb">{p.glyph}</div>
              <div>
                <p className="pname" style={{ textAlign: 'left' }}>
                  {p.name}
                </p>
                <div className="pmeta search-pmeta">
                  <span>{catLabel(p)}</span>
                  <span className="mono">{p.sku}</span>
                  <span className="mono">{p.barcode}</span>
                </div>
              </div>
              <div className="pright">
                <div>${p.price.toFixed(2)}</div>
                {(reserved[p._id] || 0) > 0 && (
                  <Chip tone="warn">{reserved[p._id]} en espera</Chip>
                )}
                {p.stock > 0 && p.stock <= (p.minStock ?? 5) && (
                  <div className="search-stock-max">
                    Máx. {p.stock} en stock
                  </div>
                )}
                {p.stock <= 0 && (
                  <div className="search-stock-out">Agotado</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}

function CartContent({
  cart,
  inc,
  dec,
  remove,
  setQty,
  density: _density,
  salesType,
  onConfirm,
  onCancel,
  pendingSplits,
  selectedClient,
  onPickClient,
  itemCount,
  onClear,
  onPause,
  bsRate,
  ivaPct,
}: {
  cart: CartItem[];
  inc: (id: Id<'products'>) => void;
  dec: (id: Id<'products'>) => void;
  remove: (id: Id<'products'>) => void;
  setQty?: ((id: Id<'products'>, n: number) => void) | null;
  density: string;
  salesType: SalesType;
  onConfirm: (cart: CartItem[], total: number, salesType: SalesType) => void;
  onCancel: () => void;
  pendingSplits: SplitRow[];
  selectedClient: Client | null;
  onPickClient?: (() => void) | null;
  itemCount: number;
  onClear: () => void;
  onPause?: (() => void) | null;
  bsRate: number;
  ivaPct: number;
}) {
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const taxableBase = cart.reduce(
    (s, i) => s + (i.exempt === true ? 0 : i.price * i.qty),
    0
  );
  const tax = salesType === 'invoice' ? taxableBase * (ivaPct / 100) : 0;
  const total = subtotal + tax;
  const paidSoFar = (pendingSplits || []).reduce(
    (s, r) => s + splitUsd(r, bsRate),
    0
  );
  const remaining = Math.max(0, total - paidSoFar);
  const showRemaining = paidSoFar > 0 && paidSoFar < total - 0.005;

  const header = (
    <div className="cart-card-head">
      <div className="cart-card-head-top">
        <div className="cart-head-title">Carrito</div>
        <Chip tone="neutral">{itemCount}</Chip>
      </div>
      {cart.length > 0 && (
        <div className="cart-card-head-actions">
          {onPause && (
            <Button
              variant="secondary"
              size="sm"
              icon="pause"
              onClick={onPause}
            >
              Pausar
            </Button>
          )}
          <Button variant="danger" size="sm" icon="trash-2" onClick={onClear}>
            Limpiar
          </Button>
        </div>
      )}
    </div>
  );

  if (cart.length === 0) {
    return (
      <div className="card">
        {header}
        <div className="empty" style={{ padding: '36px 20px' }}>
          <img src="/ds/empty-cart.svg" alt="" />
          <h4>Carrito vacío</h4>
          <p>Escanea un producto para empezar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {header}
      {cart.map((i) => (
        <CartItemRow
          key={i._id}
          item={i}
          onInc={() => inc(i._id)}
          onDec={() => dec(i._id)}
          onRemove={() => remove(i._id)}
          onSetQty={setQty ? (n) => setQty(i._id, n) : null}
          bsRate={bsRate}
        />
      ))}
      <div className="totals">
        <div className="line">
          <span>Subtotal</span>
          <span className="tabular">${subtotal.toFixed(2)}</span>
        </div>
        {salesType === 'invoice' && subtotal - taxableBase > 0.005 && (
          <div className="line">
            <span>Exento (E)</span>
            <span className="tabular">
              ${(subtotal - taxableBase).toFixed(2)}
            </span>
          </div>
        )}
        {salesType === 'invoice' && (
          <div className="line">
            <span>IVA ({ivaPct}%)</span>
            <span className="tabular">${tax.toFixed(2)}</span>
          </div>
        )}
        <div className="line total">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>
        {bsRate > 0 && (
          <div className="line total-bs">
            <span>Total en Bs</span>
            <span className="tabular">Bs {(total * bsRate).toFixed(2)}</span>
          </div>
        )}
        {showRemaining && (
          <div className="cart-paid">
            <span>Pagado</span>
            <span className="cart-remaining-amts">
              <span className="tabular">${paidSoFar.toFixed(2)}</span>
              {bsRate > 0 && (
                <span className="tabular">
                  Bs {(paidSoFar * bsRate).toFixed(2)}
                </span>
              )}
            </span>
          </div>
        )}
        {showRemaining && (
          <div className="cart-remaining">
            <span>Falta por cobrar</span>
            <span className="cart-remaining-amts">
              <span className="tabular">${remaining.toFixed(2)}</span>
              {bsRate > 0 && (
                <span className="tabular">
                  Bs {(remaining * bsRate).toFixed(2)}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
      <div className="cart-actions">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          onClick={() => {
            if (!selectedClient) {
              onPickClient?.();
              return;
            }
            onConfirm(cart, total, salesType);
          }}
        >
          <span className="btn-stack">
            <span>
              {!selectedClient
                ? 'Elegir cliente'
                : showRemaining
                  ? 'Continuar pago'
                  : 'Cobrar'}
            </span>
            {selectedClient && (
              <span className="btn-amount">
                ${(showRemaining ? remaining : total).toFixed(2)}
              </span>
            )}
          </span>
        </Button>
      </div>
    </div>
  );
}

// Exported for the component test suite (tests/components/client-gate.test.tsx).
export function ClientGate({
  clients,
  online,
  onClientFound,
  onCreateClient,
}: {
  clients: Client[];
  online: boolean;
  onClientFound: (c: Client) => void;
  onCreateClient: (prefill: {
    prefix: Client['taxPrefix'];
    taxId: string;
  }) => void;
}) {
  const [prefix, setPrefix] = useState<Client['taxPrefix']>('V');
  const [taxId, setTaxId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showCreatePrompt, setShowCreatePrompt] = useState(false);

  const search = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const term = taxId.trim();
    if (!term) {
      setError('Ingresa la identificación del cliente.');
      return;
    }
    const found = clients.find(
      (c) =>
        c.taxPrefix === prefix &&
        (c.taxId || '').toLowerCase() === term.toLowerCase()
    );
    if (found) {
      setError(null);
      onClientFound(found);
    } else {
      setError(null);
      setShowCreatePrompt(true);
    }
  };

  return (
    <div className="content client-gate-content" style={{ padding: '5px' }}>
      {!online && (
        <Banner
          tone="warn"
          icon="wifi-off"
          title="Sin conexión"
          message="No se pueden registrar ventas hasta reconectar."
        />
      )}
      <div className="client-gate">
        <div className="client-gate-head">
          <div className="client-gate-icon">
            <Icon name="user-check" size={28} />
          </div>
          <h2 className="client-gate-title">Identificar al cliente</h2>
          <p className="client-gate-sub">
            Toda venta debe registrarse con un cliente. Ingresa la cédula (V) o
            RIF (J).
          </p>
        </div>

        <form className="client-gate-form" onSubmit={search}>
          <label className="client-field">
            <span>
              Identificación fiscal<span className="req"> *</span>
            </span>
            <div className="taxid-row">
              <select
                className="input cat-select taxid-prefix"
                value={prefix}
                onChange={(e) => {
                  const next = e.target.value as Client['taxPrefix'];
                  setPrefix(next);
                  setTaxId((t) => formatTaxId(next, t));
                  setError(null);
                  setShowCreatePrompt(false);
                }}
                aria-label="Tipo de identificación"
                style={{
                  height: '48px',
                  textAlign: 'left',
                  padding: '0px 28px 0px 12px',
                }}
              >
                <option value="V">V</option>
                <option value="E">E</option>
                <option value="J">J</option>
              </select>
              <Input
                mono
                autoFocus
                inputMode="numeric"
                value={taxId}
                onChange={(e) => {
                  const v = formatTaxId(prefix, e.target.value);
                  setTaxId(v);
                  setError(null);
                  setShowCreatePrompt(false);
                }}
                placeholder={prefix === 'J' ? '12345678-9' : '12.345.678'}
              />
            </div>
          </label>

          {error && <Banner tone="danger" icon="x" message={error} />}

          {showCreatePrompt && (
            <Banner
              tone="warn"
              icon="user-x"
              title="Cliente no encontrado"
              message={`No hay ningún cliente registrado con ${prefix}-${taxId}. ¿Quieres crearlo?`}
            />
          )}

          <div className="row" style={{ gap: 10 }}>
            {showCreatePrompt ? (
              <>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setShowCreatePrompt(false)}
                >
                  Reintentar
                </Button>
                <Button
                  type="button"
                  icon="user-plus"
                  onClick={() => onCreateClient({ prefix, taxId })}
                >
                  Crear cliente
                </Button>
              </>
            ) : (
              <Button type="submit" icon="search" block>
                Buscar cliente
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SaleScreen({
  onConfirm,
}: {
  onConfirm: (cart: CartItem[], total: number, salesType: SalesType) => void;
}) {
  const navigate = useNavigate();
  const online = useOnline();
  const bsRate = useBsRate();
  const products = useProducts();
  const clients = useClients();
  const categories = useCategories();
  const settings = useSettingsDoc();
  const {
    cart,
    setCart,
    selectedClient,
    setSelectedClientId,
    splits: pendingSplits,
    resetPayment,
    discardSale,
    reserved,
    pauseSale,
    pausedRemovals,
    dismissPausedRemovals,
  } = useCart();
  const createClient = useMutation(api.clients.create);
  const w = useViewport();
  const isWide = w >= 1000;

  // Wirings that replaced the prototype's props
  const onBack = () => void navigate('/');
  const onResetPayment = resetPayment;
  const onSelectClient = (id: Id<'clients'>) => setSelectedClientId(id);
  const onCreateClient = async (form: {
    name: string;
    taxPrefix: string;
    taxId: string;
    kind: string;
    email?: string;
    phone?: string;
    address?: string;
  }) => {
    try {
      const created = await createClient({
        name: form.name,
        taxPrefix: form.taxPrefix as 'V' | 'E' | 'J',
        taxId: form.taxId,
        kind: form.kind as 'person' | 'business' | 'foreign',
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
      });
      setSelectedClientId(created._id);
    } catch (e: any) {
      alert(
        typeof e?.data === 'string'
          ? e.data
          : 'Ocurrió un error. Intenta de nuevo.'
      );
    }
  };
  const onPauseSale = async () => {
    try {
      await pauseSale();
    } catch (e: any) {
      alert(
        typeof e?.data === 'string'
          ? e.data
          : 'Ocurrió un error. Intenta de nuevo.'
      );
    }
  };

  // Catalog shows PHYSICAL stock. Availability (en-espera + already-in-cart) is
  // enforced only at add-to-cart time — never by subtracting from what's shown.
  const catalog = useMemo(
    () => products.filter((p) => p.sellable !== false),
    [products]
  );
  const [foundProduct, setFoundProduct] = useState<Product | null>(null);
  const [foundFromSearch, setFoundFromSearch] = useState(false);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [insufficientStockProduct, setInsufficientStockProduct] =
    useState<Product | null>(null);
  const [activeCat, setActiveCat] = useState('all');
  const [catalogSort, setCatalogSort] = useState('name-asc');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [clientInfoOpen, setClientInfoOpen] = useState(false);
  const [prefillCreate, setPrefillCreate] = useState<{
    prefix: Client['taxPrefix'];
    taxId: string;
  } | null>(null);

  const density = 'roomy' as string; // tweaks.density → fixed 'roomy' (CSS branches kept)
  const salesType: SalesType = settings?.salesType ?? 'invoice'; // tweaks.salesType → settings
  const ivaPct = settings?.ivaPct ?? 13;

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const taxableBase = cart.reduce(
    (s, i) => s + (i.exempt === true ? 0 : i.price * i.qty),
    0
  );
  const tax = salesType === 'invoice' ? taxableBase * (ivaPct / 100) : 0;
  const total = subtotal + tax;
  const itemCount = cart.reduce((s, i) => s + i.qty, 0);

  // Notice for lines auto-removed because their product was paused (live, or
  // dropped while resuming a held cart). An external event (acknowledge only, no
  // confirm). Rendered as a top-level MODAL in EVERY layout/branch — including
  // the ClientGate and an empty cart — so it always shows (the old inline banner
  // failed because it sat inside a body that didn't always mount).
  const pausedModal =
    pausedRemovals.length > 0 ? (
      <Sheet onClose={dismissPausedRemovals} dialog>
        <div style={{ font: '700 18px var(--font-sans)', marginBottom: 6 }}>
          Productos pausados
        </div>
        <div
          style={{
            font: '400 14px var(--font-sans)',
            color: 'var(--ink-2)',
            marginBottom: 18,
            lineHeight: 1.5,
          }}
        >
          <div>
            {pausedRemovals.length === 1
              ? 'Este producto fue quitado de la venta porque está pausado:'
              : 'Estos productos fueron quitados de la venta porque están pausados:'}
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 22 }}>
            {pausedRemovals.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button block size="sm" onClick={dismissPausedRemovals}>
            Entendido
          </Button>
        </div>
      </Sheet>
    ) : null;

  const handleScanResult = ({ found, product, code }: ScanResult) => {
    if (found && product) {
      const inCart = cart.find((i) => i._id === product._id)?.qty || 0;
      // Block only when no sellable unit remains: physical − en-espera − in-cart.
      if (product.stock - (reserved[product._id] || 0) - inCart <= 0) {
        setInsufficientStockProduct(product);
      } else {
        setFoundProduct(product);
      }
    } else {
      setNotFoundCode(code ?? null);
    }
  };

  const addToCart = (product: Product, qty: number) => {
    setCart((prev) => {
      const existing = prev.find((i) => i._id === product._id);
      if (existing)
        return prev.map((i) =>
          i._id === product._id ? { ...i, qty: i.qty + qty } : i
        );
      return [...prev, { ...product, qty }];
    });
    setFoundProduct(null);
    setSearchOpen(false);
  };

  const inc = (id: Id<'products'>) =>
    setCart((c) =>
      c.map((i) =>
        i._id === id ? { ...i, qty: Math.min(1000000, i.qty + 1) } : i
      )
    );
  const dec = (id: Id<'products'>) =>
    setCart((c) =>
      c.map((i) => (i._id === id ? { ...i, qty: Math.max(1, i.qty - 1) } : i))
    );
  const setQty = (id: Id<'products'>, n: number) =>
    setCart((c) =>
      c.map((i) => (i._id === id ? { ...i, qty: Math.max(1, n) } : i))
    );
  const remove = (id: Id<'products'>) =>
    setCart((c) => c.filter((i) => i._id !== id));

  const tryClose = () => {
    if (cart.length > 0) setConfirmCancel(true);
    else {
      // Empty cart but a client may still be attached — discard so the gate re-shows.
      discardSale();
      onBack();
    }
  };

  const filteredCatalog = (
    activeCat === 'all'
      ? catalog
      : catalog.filter((p) => p.categoryId === activeCat)
  )
    .filter((p) => {
      const q = catalogQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.includes(q)
      );
    })
    .slice()
    .sort((a, b) => {
      switch (catalogSort) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'price-asc':
          return a.price - b.price;
        case 'price-desc':
          return b.price - a.price;
        default:
          return 0;
      }
    });

  // ============ DESKTOP / TABLET LAYOUT ============
  if (isWide) {
    if (!selectedClient) {
      return (
        <>
          <AppBar
            title="Nueva venta"
            online={online}
            /* left={<IconButton icon="chevron-left" onClick={tryClose} ariaLabel="Volver" />} */
          />
          <ClientGate
            clients={clients}
            online={online}
            onClientFound={(c) => onSelectClient(c._id)}
            onCreateClient={(prefill) => {
              setPrefillCreate(prefill);
              setClientFormOpen(true);
            }}
          />
          {clientFormOpen && (
            <Sheet
              onClose={() => {
                setClientFormOpen(false);
                setPrefillCreate(null);
              }}
              title="Nuevo cliente"
            >
              <ClientForm
                initial={
                  prefillCreate
                    ? {
                        taxPrefix: prefillCreate.prefix,
                        taxId: prefillCreate.taxId,
                      }
                    : null
                }
                onSave={(form: any) => {
                  void onCreateClient(form);
                  setClientFormOpen(false);
                  setPrefillCreate(null);
                }}
                onCancel={() => {
                  setClientFormOpen(false);
                  setPrefillCreate(null);
                }}
              />
            </Sheet>
          )}
          {pausedModal}
        </>
      );
    }
    return (
      <>
        <AppBar
          title="Nueva venta"
          online={online}
          /* left={<IconButton icon="chevron-left" onClick={tryClose} ariaLabel="Volver" />} */
          right={
            <ClientChip
              client={selectedClient}
              onClick={() => setClientInfoOpen(true)}
            />
          }
        />

        <div
          className={`pos-layout ${density === 'dense' ? 'dense' : ''}`}
          style={{ padding: '5px' }}
        >
          <div className="pos-main" style={{ padding: '0px' }}>
            <div className="pos-main-scroll">
              {!online && (
                <Banner
                  tone="warn"
                  icon="wifi-off"
                  title="Sin conexión"
                  message="Las ventas se sincronizarán al reconectarse al servidor."
                />
              )}
              <div className="pos-scanner-sticky" style={{ margin: '0px' }}>
                <ScannerView
                  onScanResult={handleScanResult}
                  mode="split"
                  density={density}
                  catalog={catalog}
                  scannerMode={settings?.scannerMode}
                  // === DESKTOP SCANNER HEIGHT KNOB ===
                  // Original was 16/9 (1.78). 2.74 ≈ 35% shorter.
                  // Raise to shrink further; lower toward 1.78 to grow taller.
                  wideAspectRatio={2.74}
                />
              </div>

              <div className="catalog-head" style={{ margin: '14px 4px 14px' }}>
                <h2 className="catalog-title" style={{ margin: '0px' }}>
                  Buscar producto
                </h2>
                <Input
                  placeholder="Nombre, SKU o código de barras"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                />

                <div className="catalog-filters">
                  <label className="catalog-filter">
                    <span>Categoría</span>
                    <select
                      className="input cat-select"
                      value={activeCat}
                      onChange={(e) => setActiveCat(e.target.value)}
                    >
                      <option value="all">Todos</option>
                      {categories.map((c) => (
                        <option key={c._id} value={c._id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="catalog-filter">
                    <span>Ordenar por</span>
                    <select
                      className="input cat-select"
                      value={catalogSort}
                      onChange={(e) => setCatalogSort(e.target.value)}
                    >
                      <option value="name-asc">Nombre (A–Z)</option>
                      <option value="name-desc">Nombre (Z–A)</option>
                      <option value="price-asc">Precio (menor a mayor)</option>
                      <option value="price-desc">Precio (mayor a menor)</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="quick-grid" style={{ margin: '0px 4px' }}>
                {filteredCatalog.map((p) => (
                  <button
                    className="quick-tile"
                    key={p._id}
                    onClick={() => setFoundProduct(p)}
                  >
                    <div className="glyph">{p.glyph}</div>
                    <div className="name">{p.name}</div>
                    <div className="meta">{p.sku}</div>
                    <div className="price">${p.price.toFixed(2)}</div>
                    {bsRate > 0 && (
                      <div className="price-bs">
                        Bs {(p.price * bsRate).toFixed(2)}
                      </div>
                    )}
                    {(reserved[p._id] || 0) > 0 && (
                      <Chip tone="warn">{reserved[p._id]} en espera</Chip>
                    )}
                    {p.stock > 0 && p.stock <= (p.minStock ?? 5) && (
                      <div className="quick-stock-max">
                        Máx. {p.stock} en stock
                      </div>
                    )}
                    {p.stock <= 0 && (
                      <div className="quick-stock-out">Agotado</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="pos-side">
            <div className="card card-cart">
              <div className="cart-card-head">
                <div className="cart-card-head-top">
                  <div className="cart-head-title">Carrito</div>
                  <Chip tone="neutral">{itemCount}</Chip>
                </div>
                {cart.length > 0 && (
                  <div className="cart-card-head-actions">
                    {onPauseSale && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="pause"
                        onClick={() => void onPauseSale()}
                      >
                        Pausar
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      size="sm"
                      icon="trash-2"
                      onClick={() => setConfirmClear(true)}
                    >
                      Limpiar
                    </Button>
                  </div>
                )}
              </div>
              <div className="cart-scroll">
                {cart.length === 0 ? (
                  <div className="empty" style={{ padding: '36px 20px' }}>
                    <img
                      src="/ds/empty-cart.svg"
                      alt=""
                      style={{ width: 140 }}
                    />
                    <h4>Carrito vacío</h4>
                    <p>Escanea o toca un producto del catálogo</p>
                  </div>
                ) : (
                  <>
                    {cart.map((i) => (
                      <CartItemRow
                        key={i._id}
                        item={i}
                        onInc={() => inc(i._id)}
                        onDec={() => dec(i._id)}
                        onRemove={() => remove(i._id)}
                        onSetQty={(n) => setQty(i._id, n)}
                        bsRate={bsRate}
                      />
                    ))}
                    {(() => {
                      const paidSoFar = (pendingSplits || []).reduce(
                        (s, r) => s + splitUsd(r, bsRate),
                        0
                      );
                      const remaining = Math.max(0, total - paidSoFar);
                      const showRemaining =
                        paidSoFar > 0 && paidSoFar < total - 0.005;
                      return (
                        <>
                          <div className="totals">
                            <div className="line">
                              <span>Subtotal</span>
                              <span className="tabular">
                                ${subtotal.toFixed(2)}
                              </span>
                            </div>
                            {salesType === 'invoice' &&
                              subtotal - taxableBase > 0.005 && (
                                <div className="line">
                                  <span>Exento (E)</span>
                                  <span className="tabular">
                                    ${(subtotal - taxableBase).toFixed(2)}
                                  </span>
                                </div>
                              )}
                            {salesType === 'invoice' && (
                              <div className="line">
                                <span>IVA ({ivaPct}%)</span>
                                <span className="tabular">
                                  ${tax.toFixed(2)}
                                </span>
                              </div>
                            )}
                            <div className="line total">
                              <span>Total</span>
                              <span>${total.toFixed(2)}</span>
                            </div>
                            {bsRate > 0 && (
                              <div className="line total-bs">
                                <span>Total en Bs</span>
                                <span className="tabular">
                                  Bs {(total * bsRate).toFixed(2)}
                                </span>
                              </div>
                            )}
                            {showRemaining && (
                              <div
                                className="cart-paid"
                                style={{ padding: '10px' }}
                              >
                                <span>Pagado</span>
                                <span className="cart-remaining-amts">
                                  <span className="tabular">
                                    ${paidSoFar.toFixed(2)}
                                  </span>
                                  {bsRate > 0 && (
                                    <span className="tabular">
                                      Bs {(paidSoFar * bsRate).toFixed(2)}
                                    </span>
                                  )}
                                </span>
                              </div>
                            )}
                            {showRemaining && (
                              <div
                                className="cart-remaining"
                                style={{ padding: '10px' }}
                              >
                                <span>Falta por cobrar</span>
                                <span className="cart-remaining-amts">
                                  <span className="tabular">
                                    ${remaining.toFixed(2)}
                                  </span>
                                  {bsRate > 0 && (
                                    <span className="tabular">
                                      Bs {(remaining * bsRate).toFixed(2)}
                                    </span>
                                  )}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="cart-actions">
                            <Button variant="secondary" onClick={tryClose}>
                              Cancelar
                            </Button>
                            <Button
                              onClick={() => {
                                if (!selectedClient) {
                                  setClientPickerOpen(true);
                                  return;
                                }
                                onConfirm(cart, total, salesType);
                              }}
                            >
                              <span className="btn-stack">
                                <span>
                                  {!selectedClient
                                    ? 'Elegir cliente'
                                    : showRemaining
                                      ? 'Continuar pago'
                                      : 'Cobrar'}
                                </span>
                                {selectedClient && (
                                  <span className="btn-amount">
                                    $
                                    {(showRemaining
                                      ? remaining
                                      : total
                                    ).toFixed(2)}
                                  </span>
                                )}
                              </span>
                            </Button>
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
              {cart.length === 0 && (
                <div className="cart-foot">
                  <BottomBar>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        discardSale();
                        onBack();
                      }}
                    >
                      Cerrar
                    </Button>
                    <Button disabled>Cobrar $0.00</Button>
                  </BottomBar>
                </div>
              )}
            </div>
          </div>
        </div>

        {foundProduct && (
          <ProductFoundSheet
            product={foundProduct}
            bsRate={bsRate}
            currentCartQty={
              cart.find((i) => i._id === foundProduct._id)?.qty || 0
            }
            reservedUnits={reserved[foundProduct._id] || 0}
            onAdd={(prod, qty) => {
              addToCart(prod, qty);
              setFoundFromSearch(false);
            }}
            onCancel={() => {
              setFoundProduct(null);
              setFoundFromSearch(false);
            }}
            onBack={
              foundFromSearch
                ? () => {
                    setFoundProduct(null);
                    setFoundFromSearch(false);
                    setSearchOpen(true);
                  }
                : null
            }
          />
        )}
        {notFoundCode && (
          <ProductNotFoundSheet
            code={notFoundCode}
            onRetry={() => setNotFoundCode(null)}
            onSearch={() => {
              setNotFoundCode(null);
              setSearchOpen(true);
            }}
            onClose={() => setNotFoundCode(null)}
          />
        )}
        {searchOpen && (
          <ManualSearchSheet
            catalog={catalog}
            reserved={reserved}
            onPick={(p) => {
              setSearchOpen(false);
              setFoundFromSearch(true);
              setFoundProduct(p);
            }}
            onClose={() => setSearchOpen(false)}
          />
        )}
        {confirmClear && (
          <ConfirmDialog
            title="¿Vaciar el carrito?"
            message="Se eliminarán todos los productos y los pagos parciales registrados."
            confirmLabel="Sí, vaciar"
            tone="danger"
            onConfirm={() => {
              setConfirmClear(false);
              setCart([]);
              onResetPayment?.();
            }}
            onCancel={() => setConfirmClear(false)}
          />
        )}

        {confirmCancel && (
          <ConfirmDialog
            title="¿Cancelar la venta?"
            message="Se perderán los productos del carrito."
            confirmLabel="Sí"
            cancelLabel="No"
            tone="danger"
            onConfirm={() => {
              setConfirmCancel(false);
              discardSale();
              onBack();
            }}
            onCancel={() => setConfirmCancel(false)}
          />
        )}
        {insufficientStockProduct &&
          (() => {
            const isp = insufficientStockProduct;
            const inCart = cart.find((i) => i._id === isp._id)?.qty || 0;
            const n = reserved[isp._id] || 0;
            // Held units block the sale even though stock is physically present.
            const blockedByReserved = n > 0 && isp.stock - inCart > 0;
            return (
              <ConfirmDialog
                title={
                  blockedByReserved
                    ? 'Unidades en espera'
                    : 'Stock insuficiente'
                }
                message={
                  blockedByReserved
                    ? `${n} unidad(es) en espera — no disponibles para esta venta.`
                    : `Ya tienes ${isp.stock} ${isp.name} en el carrito. No hay más unidades disponibles.`
                }
                confirmLabel="Entendido"
                cancelLabel="Cerrar"
                onConfirm={() => setInsufficientStockProduct(null)}
                onCancel={() => setInsufficientStockProduct(null)}
              />
            );
          })()}
        {clientPickerOpen && (
          <ClientPickerSheet
            clients={clients}
            currentId={selectedClient?._id}
            onPick={(c: Client) => {
              onSelectClient(c._id);
              setClientPickerOpen(false);
            }}
            onCreate={() => {
              setClientPickerOpen(false);
              setClientFormOpen(true);
            }}
            onClose={() => setClientPickerOpen(false)}
          />
        )}
        {clientInfoOpen && selectedClient && (
          <ClientInfoSheet
            client={selectedClient}
            onClose={() => setClientInfoOpen(false)}
            onChange={() => {
              setClientInfoOpen(false);
              setClientPickerOpen(true);
            }}
          />
        )}
        {clientFormOpen && (
          <Sheet
            onClose={() => {
              setClientFormOpen(false);
              setPrefillCreate(null);
            }}
            title="Nuevo cliente"
          >
            <ClientForm
              initial={
                prefillCreate
                  ? {
                      taxPrefix: prefillCreate.prefix,
                      taxId: prefillCreate.taxId,
                    }
                  : null
              }
              onSave={(form: any) => {
                void onCreateClient(form);
                setClientFormOpen(false);
                setPrefillCreate(null);
              }}
              onCancel={() => {
                setClientFormOpen(false);
                setPrefillCreate(null);
              }}
            />
          </Sheet>
        )}
        {pausedModal}
      </>
    );
  }

  // ============ MOBILE LAYOUT ============
  if (!selectedClient) {
    return (
      <>
        <AppBar
          title="Nueva venta"
          online={online}
          /* left={<IconButton icon="chevron-left" onClick={tryClose} ariaLabel="Volver" />} */
        />
        <ClientGate
          clients={clients}
          online={online}
          onClientFound={(c) => onSelectClient(c._id)}
          onCreateClient={(prefill) => {
            setPrefillCreate(prefill);
            setClientFormOpen(true);
          }}
        />
        {clientFormOpen && (
          <Sheet
            onClose={() => {
              setClientFormOpen(false);
              setPrefillCreate(null);
            }}
            title="Nuevo cliente"
          >
            <ClientForm
              initial={
                prefillCreate
                  ? {
                      taxPrefix: prefillCreate.prefix,
                      taxId: prefillCreate.taxId,
                    }
                  : null
              }
              onSave={(form: any) => {
                void onCreateClient(form);
                setClientFormOpen(false);
                setPrefillCreate(null);
              }}
              onCancel={() => {
                setClientFormOpen(false);
                setPrefillCreate(null);
              }}
            />
          </Sheet>
        )}
        {pausedModal}
      </>
    );
  }
  return (
    <>
      <AppBar
        title="Nueva venta"
        online={online}
        /* left={<IconButton icon="chevron-left" onClick={tryClose} ariaLabel="Volver" />} */
        right={
          <ClientChip
            client={selectedClient}
            onClick={() => setClientInfoOpen(true)}
            compact
          />
        }
      />

      <div
        className={`content content-pos ${density === 'dense' ? 'dense' : ''}`}
      >
        <div className="pos-mobile-scroll" style={{ padding: '0px' }}>
          {!online && (
            <Banner
              tone="warn"
              icon="wifi-off"
              title="Sin conexión"
              message="Las ventas se sincronizarán al reconectarse."
            />
          )}
          <div className="pos-scanner-sticky">
            <ScannerView
              onScanResult={handleScanResult}
              mode="scroll"
              density={density}
              catalog={catalog}
              scannerMode={settings?.scannerMode}
            />
          </div>

          <Button
            variant="secondary"
            icon="search"
            onClick={() => setSearchOpen(true)}
            style={{ marginTop: 10 }}
            block
          >
            Buscar producto
          </Button>

          <CartContent
            cart={cart}
            inc={inc}
            dec={dec}
            remove={remove}
            setQty={setQty}
            density={density}
            salesType={salesType}
            ivaPct={ivaPct}
            bsRate={bsRate}
            pendingSplits={pendingSplits}
            selectedClient={selectedClient}
            onPickClient={() => setClientPickerOpen(true)}
            itemCount={itemCount}
            onClear={() => setConfirmClear(true)}
            onPause={onPauseSale ? () => void onPauseSale() : null}
            onCancel={tryClose}
            onConfirm={onConfirm}
          />
        </div>
      </div>

      {foundProduct && (
        <ProductFoundSheet
          product={foundProduct}
          bsRate={bsRate}
          currentCartQty={
            cart.find((i) => i._id === foundProduct._id)?.qty || 0
          }
          reservedUnits={reserved[foundProduct._id] || 0}
          onAdd={(prod, qty) => {
            addToCart(prod, qty);
            setFoundFromSearch(false);
          }}
          onCancel={() => {
            setFoundProduct(null);
            setFoundFromSearch(false);
          }}
          onBack={
            foundFromSearch
              ? () => {
                  setFoundProduct(null);
                  setFoundFromSearch(false);
                  setSearchOpen(true);
                }
              : null
          }
        />
      )}
      {notFoundCode && (
        <ProductNotFoundSheet
          code={notFoundCode}
          onRetry={() => setNotFoundCode(null)}
          onSearch={() => {
            setNotFoundCode(null);
            setSearchOpen(true);
          }}
          onClose={() => setNotFoundCode(null)}
        />
      )}
      {searchOpen && (
        <ManualSearchSheet
          catalog={catalog}
          reserved={reserved}
          onPick={(p) => {
            setSearchOpen(false);
            setFoundFromSearch(true);
            setFoundProduct(p);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {confirmClear && (
        <ConfirmDialog
          title="¿Vaciar el carrito?"
          message="Se eliminarán todos los productos y los pagos parciales registrados."
          confirmLabel="Sí, vaciar"
          tone="danger"
          onConfirm={() => {
            setConfirmClear(false);
            setCart([]);
            onResetPayment?.();
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="¿Cancelar la venta?"
          message="Se perderán los productos del carrito."
          confirmLabel="Sí"
          cancelLabel="No"
          tone="danger"
          onConfirm={() => {
            setConfirmCancel(false);
            discardSale();
            onBack();
          }}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
      {insufficientStockProduct &&
        (() => {
          const isp = insufficientStockProduct;
          const inCart = cart.find((i) => i._id === isp._id)?.qty || 0;
          const n = reserved[isp._id] || 0;
          const blockedByReserved = n > 0 && isp.stock - inCart > 0;
          return (
            <ConfirmDialog
              title={
                blockedByReserved ? 'Unidades en espera' : 'Stock insuficiente'
              }
              message={
                blockedByReserved
                  ? `${n} unidad(es) en espera — no disponibles para esta venta.`
                  : `Ya tienes el máximo de ${isp.name} disponibles en el carrito.`
              }
              confirmLabel="Entendido"
              cancelLabel="Cerrar"
              onConfirm={() => setInsufficientStockProduct(null)}
              onCancel={() => setInsufficientStockProduct(null)}
            />
          );
        })()}
      {clientPickerOpen && (
        <ClientPickerSheet
          clients={clients}
          currentId={selectedClient?._id}
          onPick={(c: Client) => {
            onSelectClient(c._id);
            setClientPickerOpen(false);
          }}
          onCreate={() => {
            setClientPickerOpen(false);
            setClientFormOpen(true);
          }}
          onClose={() => setClientPickerOpen(false)}
        />
      )}
      {clientInfoOpen && selectedClient && (
        <ClientInfoSheet
          client={selectedClient}
          onClose={() => setClientInfoOpen(false)}
          onChange={() => {
            setClientInfoOpen(false);
            setClientPickerOpen(true);
          }}
        />
      )}
      {clientFormOpen && (
        <Sheet onClose={() => setClientFormOpen(false)} title="Nuevo cliente">
          <ClientForm
            onSave={(form: any) => {
              void onCreateClient(form);
              setClientFormOpen(false);
            }}
            onCancel={() => setClientFormOpen(false)}
          />
        </Sheet>
      )}
      {pausedModal}
    </>
  );
}
