// Suppliers screen — structural twin of Clients.tsx: list + add/edit + per-row
// detail sheet. There is no `designs/suppliers.jsx` in the prototype and
// src/styles/ is a verbatim CSS port that must not gain classes, so every class
// here is one Clients already uses.
// Data wiring: useSuppliers() (Dexie-mirrored, offline-capable list) + Convex
// mutations (suppliers.create / update / remove). createdAt is epoch ms.
// Offline (FEATURES §18): the list and its search stay available from the mirror,
// but every admin WRITE is blocked behind an `online` check plus a visible
// "Sin conexión" banner — a supplier is never queued.
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import {
  AppBar,
  Banner,
  Button,
  Chip,
  ConfirmDialog,
  Icon,
  IconButton,
  Input,
  Sheet,
  useToast,
} from '@/components';
import { useSession } from '@/state/SessionContext';
import { useOnline } from '@/state/useOnline';
import { initialOf } from '@/lib/initials';
import { mutationError } from '@/lib/mutationError';
import { useBsRate, useProducts, useSuppliers } from '@/state/hooks';
import type { Purchase, Supplier } from '@/types';
import { fmtClientCreated, formatTaxId } from './Clients';
import { sanitizeAmount } from './Payment';

const taxDisplay = (s: Pick<Supplier, 'taxPrefix' | 'taxId'>) =>
  s.taxId ? `${s.taxPrefix}-${s.taxId}` : '';

const supplierGlyph = (s: Pick<Supplier, 'name'>) => initialOf(s.name);

const fmtPurchaseDate = (ms: number) =>
  new Date(ms).toLocaleDateString('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

/**
 * A supplier's purchase history. Not Dexie-mirrored: purchases are online-only
 * (they move stock), so offline this says so instead of rendering an empty list
 * that would read as "nunca le compraste nada".
 */
function SupplierPurchases({
  supplierId,
  online,
  bsRate,
  onNew,
  onDelete,
}: {
  supplierId: Supplier['_id'];
  online: boolean;
  bsRate: number;
  onNew: () => void;
  onDelete: (p: Purchase) => void;
}) {
  const { token } = useSession();
  const purchases = useQuery(
    api.purchases.bySupplier,
    token && online ? { token, supplierId } : 'skip'
  );

  const empty = !online
    ? 'El historial de compras requiere conexión.'
    : purchases === undefined
      ? 'Cargando…'
      : purchases.length === 0
        ? 'Sin compras registradas.'
        : null;

  return (
    <>
      {/* Header + empty state stay on the grey detail panel; the rows move to a
          `.card` so they sit on a surface, like every other list in the app —
          nesting `.cartrow` (which brings its own padding and dividers) inside
          `.prod-detail-rows` doubled the padding and buried the rows in grey. */}
      <div className="prod-detail-rows">
        <div className="prod-detail-row">
          <span className="k">Compras</span>
          <Button size="sm" icon="plus" onClick={onNew} disabled={!online}>
            Registrar compra
          </Button>
        </div>
        {empty && (
          <div className="prod-detail-row">
            <span className="v">{empty}</span>
          </div>
        )}
      </div>

      {!empty && (
        <div className="card">
          {(purchases ?? []).map((p) => (
            <div className="cartrow" key={p._id}>
              {/* The thumb is REQUIRED: `.cartrow` is a grid whose areas are
                "thumb info right", and only .thumb and .cart-right are placed
                explicitly. Without it the info block auto-places into the 40px
                thumb column and every line wraps one word per row. */}
              <div className="thumb" aria-hidden="true">
                <Icon name="package" size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p className="pname">{fmtPurchaseDate(p.createdAt)}</p>
                <div className="pmeta">
                  {p.items.length}{' '}
                  {p.items.length === 1 ? 'producto' : 'productos'} ·{' '}
                  {p.items.reduce((n, i) => n + i.qty, 0)} unidades
                </div>
                <div className="pmeta">{p.createdByName}</div>
                {p.note && <div className="pmeta">{p.note}</div>}
              </div>
              <div className="cart-right">
                <button
                  className="delete"
                  onClick={() => onDelete(p)}
                  aria-label={`Eliminar compra del ${fmtPurchaseDate(p.createdAt)}`}
                >
                  <Icon name="trash-2" size={16} />
                </button>
                <div className="price">${p.total.toFixed(2)}</div>
                {bsRate > 0 && (
                  <div className="price-bs">
                    Bs {(p.total * bsRate).toFixed(2)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function SupplierDetailSheet({
  supplier,
  onClose,
  onEdit,
  onDelete,
  online,
  bsRate,
  onNewPurchase,
  onDeletePurchase,
}: {
  supplier: Supplier;
  onClose: () => void;
  onEdit: (s: Supplier) => void;
  onDelete: (s: Supplier) => void;
  /** Offline blocks the writes (FEATURES §18): edit / delete. */
  online: boolean;
  bsRate: number;
  onNewPurchase: (s: Supplier) => void;
  onDeletePurchase: (p: Purchase) => void;
}) {
  return (
    <Sheet onClose={onClose} title="Detalle del proveedor">
      <div className="prod-detail">
        {!online && (
          <Banner
            tone="warn"
            icon="wifi-off"
            title="Sin conexión"
            message="No disponible sin conexión. Editar y eliminar requieren conexión."
          />
        )}
        <div className="prod-detail-head">
          <div className="prod-detail-glyph">{supplierGlyph(supplier)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="prod-detail-name">{supplier.name}</div>
            <Chip
              tone={supplier.active ? 'ok' : 'neutral'}
              style={{ marginTop: 6 }}
            >
              {supplier.active ? 'Activo' : 'Inactivo'}
            </Chip>
          </div>
        </div>

        <div className="prod-detail-rows">
          <div className="prod-detail-row">
            <span className="k">RIF</span>
            <span className="v mono">{taxDisplay(supplier) || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Contacto</span>
            <span className="v">{supplier.contactName || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Teléfono</span>
            <span className="v">{supplier.phone || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Celular</span>
            <span className="v">{supplier.mobile || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Email</span>
            <span className="v">{supplier.email || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Condiciones de pago</span>
            <span className="v">{supplier.paymentTerms || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Sitio web</span>
            <span className="v">{supplier.website || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Dirección</span>
            <span className="v" style={{ textAlign: 'right', maxWidth: '60%' }}>
              {supplier.address || '—'}
            </span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Notas</span>
            <span className="v" style={{ textAlign: 'right', maxWidth: '60%' }}>
              {supplier.notes || '—'}
            </span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Proveedor desde</span>
            <span className="v">{fmtClientCreated(supplier.createdAt)}</span>
          </div>
        </div>

        <SupplierPurchases
          supplierId={supplier._id}
          online={online}
          bsRate={bsRate}
          onNew={() => onNewPurchase(supplier)}
          onDelete={onDeletePurchase}
        />
      </div>

      <div className="prod-detail-actions">
        <Button
          icon="edit-3"
          onClick={() => onEdit(supplier)}
          block
          disabled={!online}
        >
          Editar
        </Button>
        <div className="row" style={{ gap: 10 }}>
          <Button
            variant="danger"
            icon="trash-2"
            onClick={() => onDelete(supplier)}
            disabled={!online}
          >
            Eliminar
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** What SupplierForm hands to onSave. */
interface SupplierFormValues {
  name: string;
  taxPrefix: Supplier['taxPrefix'];
  taxId: string;
  contactName: string;
  email: string;
  phone: string;
  mobile: string;
  address: string;
  paymentTerms: string;
  website: string;
  notes: string;
  active: boolean;
}

function SupplierForm({
  initial,
  onSave,
  onCancel,
  online,
}: {
  initial?: Supplier | null;
  onSave: (form: SupplierFormValues) => void;
  onCancel: () => void;
  /** Offline blocks the write (FEATURES §18) — create/edit require connection. */
  online: boolean;
}) {
  const [form, setForm] = useState<SupplierFormValues>(() => ({
    name: initial?.name || '',
    // Suppliers are companies far more often than not — J is the sane default.
    taxPrefix: initial?.taxPrefix || 'J',
    taxId: initial?.taxId || '',
    contactName: initial?.contactName || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    mobile: initial?.mobile || '',
    address: initial?.address || '',
    paymentTerms: initial?.paymentTerms || '',
    website: initial?.website || '',
    notes: initial?.notes || '',
    active: initial?.active ?? true,
  }));

  const update =
    (k: keyof SupplierFormValues) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  const updateTaxId = (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, taxId: formatTaxId(f.taxPrefix, e.target.value) }));
  const setPrefix = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Supplier['taxPrefix'];
    setForm((f) => ({
      ...f,
      taxPrefix: next,
      taxId: formatTaxId(next, f.taxId),
    }));
  };

  // Only name + RIF are mandatory, matching suppliers.create's required args.
  const canSave = form.name.trim().length > 1 && form.taxId.trim().length > 0;

  // Editing an existing supplier: Save stays off until something actually moved.
  const dirty = !initial
    ? true
    : form.name !== (initial.name || '') ||
      form.taxPrefix !== initial.taxPrefix ||
      form.taxId !== (initial.taxId || '') ||
      form.contactName !== (initial.contactName || '') ||
      form.email !== (initial.email || '') ||
      form.phone !== (initial.phone || '') ||
      form.mobile !== (initial.mobile || '') ||
      form.address !== (initial.address || '') ||
      form.paymentTerms !== (initial.paymentTerms || '') ||
      form.website !== (initial.website || '') ||
      form.notes !== (initial.notes || '') ||
      form.active !== initial.active;

  return (
    <div className="client-form">
      {!online && (
        <Banner
          tone="warn"
          icon="wifi-off"
          title="Sin conexión"
          message="No disponible sin conexión. Guardar el proveedor requiere conexión."
        />
      )}
      <label className="client-field">
        <span>
          Nombre o razón social<span className="req"> *</span>
        </span>
        <Input
          value={form.name}
          onChange={update('name')}
          placeholder="Distribuidora El Sol, C.A."
        />
      </label>
      <div className="client-field">
        <span>
          RIF<span className="req"> *</span>
        </span>
        <div className="taxid-row">
          <select
            className="input cat-select taxid-prefix"
            value={form.taxPrefix}
            onChange={setPrefix}
            aria-label="Tipo de identificación"
            style={{ height: '48px', textAlign: 'left' }}
          >
            <option value="J">J</option>
            <option value="V">V</option>
            <option value="E">E</option>
          </select>
          <Input
            mono
            value={form.taxId}
            onChange={updateTaxId}
            inputMode="numeric"
            placeholder={form.taxPrefix === 'J' ? '12345678-9' : '12.345.678'}
          />
        </div>
      </div>
      <label className="client-field">
        <span>Persona de contacto</span>
        <Input
          value={form.contactName}
          onChange={update('contactName')}
          placeholder="Nombre y apellido"
        />
      </label>
      <label className="client-field">
        <span>Teléfono</span>
        <Input
          value={form.phone}
          onChange={(e) =>
            setForm((f) => ({ ...f, phone: e.target.value.replace(/\s/g, '') }))
          }
          placeholder="02125550101"
          inputMode="tel"
        />
      </label>
      <label className="client-field">
        <span>Celular / WhatsApp</span>
        <Input
          value={form.mobile}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              mobile: e.target.value.replace(/\s/g, ''),
            }))
          }
          placeholder="04140000000"
          inputMode="tel"
        />
      </label>
      <label className="client-field">
        <span>Email</span>
        <Input
          type="email"
          value={form.email}
          onChange={update('email')}
          placeholder="ventas@proveedor.com"
        />
      </label>
      <label className="client-field">
        <span>Condiciones de pago</span>
        <Input
          value={form.paymentTerms}
          onChange={update('paymentTerms')}
          placeholder="15 días neto"
        />
      </label>
      <label className="client-field">
        <span>Sitio web</span>
        <Input
          value={form.website}
          onChange={update('website')}
          placeholder="https://proveedor.com"
        />
      </label>
      <label className="client-field">
        <span>Dirección</span>
        <textarea
          className="input client-textarea"
          rows={2}
          value={form.address}
          onChange={update('address')}
          placeholder="Calle / galpón / ciudad"
        />
      </label>
      <label className="client-field">
        <span>Notas</span>
        <textarea
          className="input client-textarea"
          rows={2}
          value={form.notes}
          onChange={update('notes')}
          placeholder="Días de entrega, mínimos de compra…"
        />
      </label>
      {initial && (
        <div className="client-field">
          <span>Estado</span>
          <select
            className="input cat-select"
            value={form.active ? 'active' : 'inactive'}
            onChange={(e) =>
              setForm((f) => ({ ...f, active: e.target.value === 'active' }))
            }
            aria-label="Estado del proveedor"
          >
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
          </select>
        </div>
      )}
      <div className="row client-actions" style={{ gap: 10, marginTop: 6 }}>
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          disabled={!canSave || !dirty || !online}
          onClick={() => onSave(form)}
        >
          {initial ? 'Guardar cambios' : 'Crear proveedor'}
        </Button>
      </div>
    </div>
  );
}

interface PurchaseLine {
  productId: string;
  name: string;
  qty: number;
}

/**
 * Register a purchase: pick products with quantities, then ONE global amount for
 * the whole order. The amount can be typed in Bs or in $ — whichever field the
 * owner touches becomes the source of truth and the other shows the conversion
 * live. Only the typed value and its currency travel to the server; the USD total
 * is derived there, against the rate it also freezes.
 */
function PurchaseForm({
  supplier,
  bsRate,
  onSave,
  onCancel,
  saving,
}: {
  supplier: Supplier;
  bsRate: number;
  onSave: (input: {
    items: { productId: string; qty: number }[];
    entered: number;
    currency: 'usd' | 'bs';
    note?: string;
  }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const products = useProducts();
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [currency, setCurrency] = useState<'usd' | 'bs'>('bs');
  const [entered, setEntered] = useState('');
  const [note, setNote] = useState('');

  const norm = (s?: string) => (s || '').toLowerCase();
  const matches = !q.trim()
    ? []
    : products
        .filter((p) => {
          const term = norm(q);
          return (
            norm(p.name).includes(term) ||
            norm(p.sku).includes(term) ||
            norm(p.barcode).includes(term)
          );
        })
        .slice(0, 8);

  const addLine = (productId: string, name: string) => {
    setLines((prev) =>
      prev.some((l) => l.productId === productId)
        ? prev.map((l) =>
            l.productId === productId ? { ...l, qty: l.qty + 1 } : l
          )
        : [...prev, { productId, name, qty: 1 }]
    );
    setQ('');
  };
  const setQty = (productId: string, qty: number) =>
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, qty } : l))
    );
  const removeLine = (productId: string) =>
    setLines((prev) => prev.filter((l) => l.productId !== productId));

  // The typed field keeps the raw string; the other renders the conversion.
  const enteredNum = parseFloat(entered) || 0;
  const usdField =
    currency === 'usd'
      ? entered
      : enteredNum && bsRate > 0
        ? (enteredNum / bsRate).toFixed(2)
        : '';
  const bsField =
    currency === 'bs'
      ? entered
      : enteredNum
        ? (enteredNum * bsRate).toFixed(2)
        : '';

  const rateMissing = bsRate <= 0;
  const canSave = lines.length > 0 && enteredNum > 0 && !saving;

  return (
    <div className="client-form">
      <div className="prod-detail-row">
        <span className="k">Proveedor</span>
        <span className="v">{supplier.name}</span>
      </div>

      <label className="client-field">
        <span>
          Productos comprados<span className="req"> *</span>
        </span>
        <Input
          placeholder="Buscar por nombre, SKU o código de barras"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      {matches.length > 0 && (
        // `.card`, NOT `.search-results`: under 700px that class becomes
        // `flex: 1` (flex-basis 0), and inside `.client-form` — a scrolling
        // column flex container — it collapses to zero height, hiding the rows.
        // `.card` + `.lrow` is the same pairing the supplier list itself uses.
        <div className="card">
          {matches.map((p) => (
            <div
              className="lrow"
              key={p._id}
              onClick={() => addLine(p._id, p.name)}
              style={{ cursor: 'pointer' }}
            >
              <div className="thumb" aria-hidden="true">
                {initialOf(p.name)}
              </div>
              <div>
                <p className="pname">{p.name}</p>
                <div className="pmeta">
                  {p.sku} · {p.stock} en stock
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {lines.length === 0 ? (
        <div className="empty" style={{ padding: '20px 16px' }}>
          <p>Busca un producto para agregarlo a la compra</p>
        </div>
      ) : (
        lines.map((l) => (
          <div className="cartrow" key={l.productId}>
            <div className="thumb" aria-hidden="true">
              {initialOf(l.name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <p className="pname">{l.name}</p>
            </div>
            <div className="cart-right">
              <button
                className="delete"
                onClick={() => removeLine(l.productId)}
                aria-label={`Quitar ${l.name}`}
              >
                <Icon name="trash-2" size={16} />
              </button>
            </div>
            <div className="cart-qty-row">
              <div className="qty">
                <button
                  onClick={() => setQty(l.productId, Math.max(1, l.qty - 1))}
                  aria-label="quitar uno"
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  className="qty-input"
                  value={String(l.qty)}
                  onChange={(e) => {
                    const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
                    setQty(l.productId, Number.isNaN(n) || n < 1 ? 1 : n);
                  }}
                  aria-label={`Cantidad de ${l.name}`}
                />
                <button
                  onClick={() => setQty(l.productId, l.qty + 1)}
                  aria-label="agregar uno"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        ))
      )}

      {rateMissing && (
        <Banner
          tone="warn"
          icon="alert-triangle"
          title="Sin tasa de cambio"
          message="No hay tasa configurada en Ajustes. Registra el monto en dólares."
        />
      )}

      <label className="client-field">
        <span>Monto total en Bs</span>
        <Input
          mono
          inputMode="decimal"
          value={bsField}
          disabled={rateMissing}
          onChange={(e) => {
            setCurrency('bs');
            setEntered(sanitizeAmount(e.target.value));
          }}
          placeholder="0,00"
        />
      </label>
      <label className="client-field">
        <span>
          Monto total en $<span className="req"> *</span>
        </span>
        <Input
          mono
          inputMode="decimal"
          value={usdField}
          onChange={(e) => {
            setCurrency('usd');
            setEntered(sanitizeAmount(e.target.value));
          }}
          placeholder="0.00"
        />
      </label>

      <label className="client-field">
        <span>Nota</span>
        <textarea
          className="input client-textarea"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Número de factura, condiciones…"
        />
      </label>

      <div className="row client-actions" style={{ gap: 10, marginTop: 6 }}>
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          disabled={!canSave}
          onClick={() =>
            onSave({
              items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
              entered: enteredNum,
              currency,
              note: note.trim() || undefined,
            })
          }
        >
          Registrar compra
        </Button>
      </div>
    </div>
  );
}

export default function SuppliersScreen() {
  const toast = useToast();
  const suppliers = useSuppliers();
  const { token } = useSession();
  const online = useOnline();
  const bsRate = useBsRate();
  const createSupplier = useMutation(api.suppliers.create);
  const updateSupplier = useMutation(api.suppliers.update);
  const removeSupplier = useMutation(api.suppliers.remove);
  const createPurchase = useMutation(api.purchases.create);
  const removePurchase = useMutation(api.purchases.remove);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('name-asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null); // null = new
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [confirmDel, setConfirmDel] = useState<Supplier | null>(null);
  const [purchaseFor, setPurchaseFor] = useState<Supplier | null>(null);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [confirmDelPurchase, setConfirmDelPurchase] = useState<Purchase | null>(
    null
  );

  const norm = (s?: string) => (s || '').toLowerCase();
  const list = suppliers
    .filter((s) =>
      status === 'all' ? true : status === 'active' ? s.active : !s.active
    )
    .filter((s) => {
      if (!q.trim()) return true;
      const term = norm(q);
      return (
        norm(s.name).includes(term) ||
        norm(taxDisplay(s)).includes(term) ||
        norm(s.taxId).includes(term) ||
        norm(s.contactName).includes(term) ||
        norm(s.phone).includes(term) ||
        norm(s.mobile).includes(term) ||
        norm(s.email).includes(term)
      );
    })
    .slice()
    .sort((a, b) => {
      switch (sort) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        default:
          return 0;
      }
    });

  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.min(page, totalPages);
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [safePage, page]);
  const start = (safePage - 1) * pageSize;
  const visible = list.slice(start, start + pageSize);
  const showingFrom = list.length === 0 ? 0 : start + 1;
  const showingTo = Math.min(start + pageSize, list.length);

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (s: Supplier) => {
    setDetail(null);
    setEditing(s);
    setEditorOpen(true);
  };

  const save = async (form: SupplierFormValues) => {
    if (!token) return;
    try {
      if (editing) {
        await updateSupplier({
          token,
          supplierId: editing._id,
          patch: { ...form },
        });
      } else {
        // `active` is server-side on create (always true); the rest go as typed —
        // suppliers.create drops the empty strings.
        const { active: _active, ...rest } = form;
        await createSupplier({ token, ...rest });
      }
      setEditorOpen(false);
    } catch (e) {
      toast.error(mutationError(e));
    }
  };

  const savePurchase = async (input: {
    items: { productId: string; qty: number }[];
    entered: number;
    currency: 'usd' | 'bs';
    note?: string;
  }) => {
    if (!token || !purchaseFor) return;
    setSavingPurchase(true);
    try {
      await createPurchase({
        token,
        supplierId: purchaseFor._id,
        items: input.items as Parameters<typeof createPurchase>[0]['items'],
        entered: input.entered,
        currency: input.currency,
        ...(input.note ? { note: input.note } : {}),
      });
      setPurchaseFor(null);
      toast.success('Compra registrada. El stock fue actualizado.');
    } catch (e) {
      toast.error(mutationError(e));
    } finally {
      setSavingPurchase(false);
    }
  };

  const deletePurchase = async (purchase: Purchase) => {
    if (!token) return;
    try {
      await removePurchase({ token, purchaseId: purchase._id });
      toast.success('Compra eliminada. El stock fue revertido.');
    } catch (e) {
      toast.error(mutationError(e));
    }
    setConfirmDelPurchase(null);
  };

  const remove = async (supplier: Supplier) => {
    if (!token) return;
    try {
      await removeSupplier({ token, supplierId: supplier._id });
    } catch (e) {
      toast.error(mutationError(e));
    }
    setConfirmDel(null);
    setDetail(null);
    setEditorOpen(false);
  };

  return (
    <>
      <AppBar
        title="Proveedores"
        sub={`${suppliers.length} registrados`}
        online={online}
        right={
          <Button size="sm" icon="plus" onClick={openNew} disabled={!online}>
            Nuevo proveedor
          </Button>
        }
      />

      <div className="content stored-content" style={{ padding: '5px' }}>
        {!online && (
          <Banner
            tone="warn"
            icon="wifi-off"
            title="Sin conexión"
            message="Solo lectura. No puedes crear, editar o eliminar proveedores hasta reconectar."
          />
        )}
        <div className="catalog-head" style={{ margin: '0 0 14px' }}>
          <Input
            placeholder="Buscar proveedor por nombre, RIF, contacto, teléfono o email"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />

          <div className="catalog-filters">
            <label className="catalog-filter">
              <span>Estado</span>
              <select
                className="input cat-select"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Todos</option>
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
              </select>
            </label>
            <label className="catalog-filter">
              <span>Ordenar por</span>
              <select
                className="input cat-select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="name-asc">Nombre (A–Z)</option>
                <option value="name-desc">Nombre (Z–A)</option>
              </select>
            </label>
          </div>
        </div>

        <div className="card">
          {visible.length === 0 ? (
            <div className="empty" style={{ padding: '32px 16px' }}>
              <h4>Sin proveedores</h4>
              <p>
                {q ? `Sin resultados para "${q}"` : 'Crea tu primer proveedor'}
              </p>
            </div>
          ) : (
            visible.map((s) => (
              <div
                className="lrow"
                key={s._id}
                onClick={() => setDetail(s)}
                style={{ cursor: 'pointer' }}
              >
                <div className="thumb" aria-hidden="true">
                  {supplierGlyph(s)}
                </div>
                <div>
                  <p className="pname">{s.name}</p>
                  <div className="pmeta client-pmeta">
                    <span>{taxDisplay(s) || 'Sin RIF'}</span>
                    {s.contactName && <span>{s.contactName}</span>}
                    {s.phone && <span>{s.phone}</span>}
                  </div>
                </div>
                <div className="pright">
                  <Chip tone={s.active ? 'ok' : 'neutral'}>
                    {s.active ? 'Activo' : 'Inactivo'}
                  </Chip>
                </div>
                <div className="lrow-chevron">
                  <Icon name="chevron-right" size={18} />
                </div>
              </div>
            ))
          )}
        </div>

        {list.length > 0 && (
          <div className="pager pager-sticky">
            <div className="pager-info">
              {list.length <= pageSize ? (
                <>
                  {list.length}{' '}
                  {list.length === 1 ? 'proveedor' : 'proveedores'}
                </>
              ) : (
                <>
                  Proveedores{' '}
                  <strong>
                    {showingFrom}–{showingTo}
                  </strong>{' '}
                  de <strong>{list.length}</strong>
                </>
              )}
            </div>
            <div className="pager-size">
              <label htmlFor="suppliers-pager-size">Por página</label>
              <select
                id="suppliers-pager-size"
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
        <SupplierDetailSheet
          supplier={detail}
          online={online}
          bsRate={bsRate}
          onClose={() => setDetail(null)}
          onEdit={openEdit}
          onDelete={(s) => setConfirmDel(s)}
          onNewPurchase={(s) => {
            // Same pattern as openEdit: close the detail before opening the next
            // sheet instead of stacking them.
            setDetail(null);
            setPurchaseFor(s);
          }}
          onDeletePurchase={(p) => setConfirmDelPurchase(p)}
        />
      )}

      {purchaseFor && (
        <Sheet
          onClose={() => setPurchaseFor(null)}
          title={`Registrar compra · ${purchaseFor.name}`}
        >
          <PurchaseForm
            supplier={purchaseFor}
            bsRate={bsRate}
            saving={savingPurchase}
            onSave={(input) => void savePurchase(input)}
            onCancel={() => setPurchaseFor(null)}
          />
        </Sheet>
      )}

      {confirmDelPurchase && (
        <ConfirmDialog
          title="¿Eliminar compra?"
          message={`Se descontarán ${confirmDelPurchase.items.reduce(
            (n, i) => n + i.qty,
            0
          )} unidades del inventario. Esta acción no se puede deshacer.`}
          confirmLabel="Sí, eliminar"
          cancelLabel="Cancelar"
          tone="danger"
          onConfirm={() => void deletePurchase(confirmDelPurchase)}
          onCancel={() => setConfirmDelPurchase(null)}
        />
      )}

      {editorOpen && (
        <Sheet
          onClose={() => setEditorOpen(false)}
          title={editing ? 'Editar proveedor' : 'Nuevo proveedor'}
        >
          <SupplierForm
            initial={editing}
            online={online}
            onSave={(form) => void save(form)}
            onCancel={() => setEditorOpen(false)}
          />
        </Sheet>
      )}

      {confirmDel && (
        <ConfirmDialog
          title="¿Eliminar proveedor?"
          message={`Se eliminará a ${confirmDel.name}. Esta acción no se puede deshacer.`}
          confirmLabel="Sí, eliminar"
          cancelLabel="Cancelar"
          tone="danger"
          onConfirm={() => void remove(confirmDel)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </>
  );
}
