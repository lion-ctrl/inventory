// ProductsScreen — full catalog management
// Stats header · filters · paginated grid · add/edit sheet · detail/adjust sheet
// Ported from prototype products.jsx: data comes from Convex (useProducts /
// useCategories) and writes go through mutations — useQuery reactivity refreshes
// the lists, so the prototype's setProducts/setCategories plumbing is gone.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useLocation } from 'react-router';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
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
import { initialOf } from '@/lib/initials';
import {
  DEFAULT_UNIT,
  PRODUCT_UNITS,
  formatQty,
  isMeasured,
  unitLabel,
} from '@convex/units';
import { parseQty } from '@/lib/qty';
import type { ProductUnitId } from '@convex/units';
import { mutationError } from '@/lib/mutationError';
import { skuFromName } from '@convex/sku';
import { useOnline } from '@/state/useOnline';
import {
  useBsRate,
  useCategories,
  useProducts,
  useSuppliers,
} from '@/state/hooks';
import type { CategoryWithCount, Product, Supplier } from '@/types';

/** A product photo the shop can actually upload over mobile data. */
const MAX_PHOTO_MB = 5;
const MAX_PHOTO_BYTES = MAX_PHOTO_MB * 1024 * 1024;

const STOCK_LEVELS = [
  { id: 'all', label: 'Todos' },
  { id: 'in', label: 'En stock' },
  { id: 'low', label: 'Bajo stock' },
  { id: 'out', label: 'Agotados' },
  { id: 'paused', label: 'Pausados' },
];

// Shared error toast, as a hook so each component can pull the toast API. Replaces
// the old native alert() (owner directive: no browser dialogs). The message itself
// comes from the one shared helper — this screen used to carry its own copy of it.
function useAlertError() {
  const toast = useToast();
  return (e: unknown) => toast.error(mutationError(e));
}

/**
 * Fill the square the prototype already sizes and rounds, without adding a CSS
 * class to a stylesheet that is a verbatim port. `inherit` on the radius is what
 * keeps this honest: the box owns its shape, the photo just follows it.
 *
 * Declared ONCE because the catalogue and the form preview both render a photo
 * into the same kind of box, and a duplicated literal is how two identical
 * things start drifting.
 */
const PHOTO_FILL = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  borderRadius: 'inherit',
} as const;

/**
 * A product's photo, or its initial when there is none. The initial also covers
 * the cases a photo cannot: OFFLINE, where storage addresses are network-backed
 * and absent from the Dexie mirror, and a fetch that fails — `onError` falls
 * back rather than leaving a broken image. Rendered inside the prototype's
 * existing fixed-size box, so it needs no CSS of its own.
 */
function ProductImage({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  if (!product.imageUrl || failed) return <>{initialOf(product.name)}</>;
  return (
    <img
      src={product.imageUrl}
      alt=""
      style={PHOTO_FILL}
      onError={() => setFailed(true)}
    />
  );
}

function stockTone(stock: number, minStock = 5) {
  if (stock <= 0) return 'danger';
  if (stock <= minStock) return 'warn';
  return 'ok';
}
function stockLabel(stock: number, unit?: string) {
  if (stock <= 0) return 'Agotado';
  return `${formatQty(stock, unit)} en stock`;
}

function ProductCard({
  product,
  onClick,
  bsRate,
  catMap,
}: {
  product: Product;
  onClick: (p: Product) => void;
  bsRate: number;
  catMap: Map<string, string>;
}) {
  return (
    <button className="prod-card" onClick={() => onClick(product)}>
      <div className="prod-card-head">
        <div className="prod-card-glyph">
          <ProductImage product={product} />
        </div>
        <div className="prod-card-chips">
          {product.sellable === false && <Chip tone="neutral">Pausado</Chip>}
          <Chip tone={stockTone(product.stock, product.minStock)}>
            {stockLabel(product.stock, product.unit)}
          </Chip>
          {product.exempt === true && <Chip tone="info">Exento IVA</Chip>}
        </div>
      </div>
      <div className="prod-card-name">{product.name}</div>
      <div className="prod-card-meta">
        <span className="mono">{product.sku}</span>
        <span className="dot" />
        <span className="cat">{catMap.get(product.categoryId) ?? ''}</span>
      </div>
      <div className="prod-card-foot">
        <span className="prod-card-barcode mono">{product.barcode}</span>
        <span className="prod-card-prices">
          <span className="prod-card-price tabular">
            ${product.price.toFixed(2)}
          </span>
          {bsRate > 0 && (
            <span className="prod-card-bs tabular">
              Bs {(product.price * bsRate).toFixed(2)}
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

interface ProductFormState {
  name: string;
  barcode: string;
  price: string;
  stock: string;
  minStock: string;
  exempt: boolean;
  categoryId: string;
  sellable: boolean;
  /** Empty string = no preferred supplier; the picker offers that explicitly. */
  supplierId: string;
  /** Empty string = no photo; holds a Convex storage id once one is uploaded. */
  imageId: string;
  /** Always a catalogue id; DEFAULT_UNIT stands for the absent value. */
  unit: string;
}

type ProductFormValues = Omit<
  ProductFormState,
  'price' | 'stock' | 'minStock'
> & {
  price: number;
  stock: number;
  minStock: number;
};

function ProductForm({
  initial,
  categories,
  suppliers,
  onSave,
  onCancel,
  online,
}: {
  initial: Product | null;
  categories: CategoryWithCount[];
  /** Fed by useSuppliers(): reading the base is operational, so a user who may
   *  manage products can pick one without holding manage_suppliers. */
  suppliers: Supplier[];
  onSave: (values: ProductFormValues) => void;
  onCancel: () => void;
  /** Offline blocks the write (FEATURES §18) — create/edit require connection. */
  online: boolean;
}) {
  const { token } = useSession();
  const [form, setForm] = useState<ProductFormState>(() => ({
    name: initial?.name || '',
    barcode: initial?.barcode || '',
    price: initial?.price != null ? String(initial.price) : '',
    stock: initial?.stock != null ? String(initial.stock) : '0',
    minStock: initial?.minStock != null ? String(initial.minStock) : '5',
    exempt: initial?.exempt === true,
    categoryId: initial?.categoryId || categories[0]?._id || '',
    sellable: initial?.sellable !== false,
    supplierId: initial?.supplierId ?? '',
    imageId: initial?.imageId ?? '',
    unit: initial?.unit ?? DEFAULT_UNIT,
  }));
  // The address the server resolved for an already-saved photo, or an object URL
  // for one just picked. Never persisted: it is a view of the file, not a fact
  // about the product.
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    initial?.imageUrl ?? null
  );
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const generateUploadUrl = useMutation(api.products.generateUploadUrl);
  const alertError = useAlertError();
  const toast = useToast();

  /**
   * The object URL currently on screen, if the preview is showing a locally
   * picked file rather than the server's address. Tracked separately because
   * only OUR urls may be revoked — revoking the server address would blank the
   * photo of an already-saved product.
   */
  const objectUrlRef = useRef<string | null>(null);
  /** Hand the file's memory back. Browsers hold a picked photo until told. */
  const releasePreview = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  };
  useEffect(() => releasePreview, []);

  /**
   * Upload straight to storage and keep only the returned id. The binary never
   * goes through a mutation, so a large photo cannot blow the argument limit.
   */
  const pickPhoto = async (file: File | null) => {
    if (!file || !token) return;
    // A phone camera hands back 8-12 MB per shot, and this app is used over
    // Venezuelan mobile data. Refusing here costs the user one message; not
    // refusing costs them the upload, and they find out by watching it hang.
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error(
        `La foto pesa demasiado. El máximo es ${MAX_PHOTO_MB} MB — tómala en menor resolución.`
      );
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      const url = await generateUploadUrl({ token });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error('upload failed');
      const { storageId } = (await res.json()) as { storageId: string };
      setForm((f) => ({ ...f, imageId: storageId }));
      releasePreview();
      objectUrlRef.current = URL.createObjectURL(file);
      setPhotoPreview(objectUrlRef.current);
    } catch (e) {
      alertError(e);
    } finally {
      setUploading(false);
    }
  };
  type FieldEvent = ChangeEvent<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >;
  const set = (k: keyof ProductFormState) => (e: FieldEvent) =>
    setForm({ ...form, [k]: e.target.value });
  const setNum =
    (k: keyof ProductFormState, allowDecimal?: boolean, maxDecimals = 2) =>
    (e: FieldEvent) => {
      // The comma is ACCEPTED and normalised, not stripped. A Spanish keyboard
      // gives a comma, and `inputMode="decimal"` on a phone puts it under the
      // thumb — so it is the default path here, not an edge case. Deleting it
      // turned `2,5` into `25`, which for a stock figure is inventory that never
      // existed. Normalised at the point of typing rather than at submit,
      // because `parseFloat` (price) would not understand it either.
      let v = e.target.value.replace(/[^\d.,]/g, '').replace(/,/g, '.');
      if (!allowDecimal) v = v.replace(/\./g, '');
      if (allowDecimal) {
        const first = v.indexOf('.');
        if (first !== -1) {
          v = v.slice(0, first + 1) + v.slice(first + 1).replace(/\./g, '');
          const [a, b] = v.split('.');
          v = a + '.' + (b || '').slice(0, maxDecimals);
        }
      }
      setForm({ ...form, [k]: v });
    };

  /**
   * Changing the unit changes whether a fraction is legal, so the quantities
   * ALREADY typed have to be re-read under the new rule. Without this, `2.5`
   * stays sitting in the box after switching to a counted unit and is saved
   * without a word about it.
   *
   * Counted units floor rather than round: a stock figure is inventory, and
   * rounding 2.5 up to 3 invents half a kilo of cheese that is not on the shelf.
   * The floored value is visible in the field before saving, so it can be
   * corrected — an invented one would not be noticed.
   */
  const setUnit = (e: FieldEvent) => {
    const unit = e.target.value;
    const reQty = (raw: string) => {
      const n = parseFloat(raw);
      if (!Number.isFinite(n)) return raw;
      return String(isMeasured(unit) ? n : Math.floor(n));
    };
    setForm((f) => ({
      ...f,
      unit,
      stock: reQty(f.stock),
      minStock: reQty(f.minStock),
    }));
  };

  // Editing shows the STORED code — a rename does not move it. Creating previews
  // what the name derives to, through the very function the server will run, so
  // the field never teaches a code that turns out to be a different one.
  const skuPreview = initial ? initial.sku : skuFromName(form.name);

  const valid =
    form.name.trim().length >= 2 &&
    form.barcode.trim().length >= 1 &&
    parseFloat(form.price) > 0;

  const submit = () => {
    onSave({
      ...form,
      name: form.name.trim(),
      barcode: form.barcode.trim(),
      price: parseFloat(form.price) || 0,
      stock: parseQty(form.stock, form.unit) ?? 0,
      minStock: parseQty(form.minStock, form.unit) ?? 0,
      exempt: form.exempt === true,
      sellable: form.sellable !== false,
    });
  };

  return (
    <div className="prod-form">
      {!online && (
        <Banner
          tone="warn"
          icon="wifi-off"
          title="Sin conexión"
          message="No disponible sin conexión. Guardar el producto requiere conexión."
        />
      )}
      <div className="prod-form-icon-row">
        {/* The preview box is the prototype's, unchanged: fixed size, surface
            background, centered content. A photo fills it; without one it shows
            the same initial the catalogue will show. */}
        <div className="prod-form-icon-preview" aria-hidden="true">
          {photoPreview ? (
            <img
              src={photoPreview}
              alt=""
              style={PHOTO_FILL}
              onError={() => setPhotoPreview(null)}
            />
          ) : (
            initialOf(form.name)
          )}
        </div>
        <div className="client-field" style={{ flex: 1 }}>
          <span>Foto del producto</span>
          {/* The native file input is hidden and driven from a Button: the
              browser's own control cannot be styled and shows the raw filename,
              which reads nothing like the rest of the form. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            disabled={!online || uploading}
            onChange={(e) => void pickPhoto(e.target.files?.[0] ?? null)}
            aria-label="Foto del producto"
          />
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="secondary"
              size="sm"
              icon="image"
              onClick={() => fileRef.current?.click()}
              disabled={!online || uploading}
            >
              {uploading
                ? 'Subiendo…'
                : form.imageId
                  ? 'Cambiar foto'
                  : 'Elegir foto'}
            </Button>
            {form.imageId && !uploading && (
              <IconButton
                icon="trash-2"
                ariaLabel="Quitar foto"
                onClick={() => {
                  setForm((f) => ({ ...f, imageId: '' }));
                  releasePreview();
                  setPhotoPreview(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
                disabled={!online}
              />
            )}
          </div>
        </div>
      </div>
      <label className="client-field">
        <span>
          Nombre del producto<span className="req"> *</span>
        </span>
        <Input
          value={form.name}
          onChange={set('name')}
          placeholder="Ej. Coca-Cola 600ml"
          autoFocus
        />
      </label>

      {/* Base unit — what `price` and `stock` are each PER. Absent means the
          default counted unit, which is what every product predating this is.
          Choosing a measured unit is also what lets the quantity inputs accept a
          fraction: the rule is derived from this, never configured beside it. */}
      <label className="client-field">
        <span>Unidad base</span>
        <select
          className="input cat-select"
          value={form.unit}
          onChange={setUnit}
        >
          {PRODUCT_UNITS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
              {u.measured ? ' (permite decimales)' : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="prod-form-row">
        <label className="client-field">
          <span>SKU</span>
          {/* Derived, never typed. While CREATING this previews the code the
              server is about to assign, from the same function the server uses;
              while EDITING it shows the stored code, which a rename does not
              move — it may already be on a shelf label. `readOnly` rather than
              `disabled` so it stays legible and selectable. */}
          <Input mono value={skuPreview} readOnly tabIndex={-1} />
        </label>
        <label className="client-field">
          <span>
            Código de barras<span className="req"> *</span>
          </span>
          <Input
            mono
            inputMode="numeric"
            value={form.barcode}
            onChange={set('barcode')}
            placeholder="7591000000123"
          />
        </label>
      </div>

      <label className="client-field">
        <span>Categoría</span>
        <select
          className="input cat-select"
          value={form.categoryId}
          onChange={set('categoryId')}
        >
          {categories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      {/* Preferred supplier — who to call to reorder, not sales data. Optional,
          so the empty option is a real choice and not a placeholder. An inactive
          supplier still lists, marked, because the link is historically true. */}
      <label className="client-field">
        <span>Proveedor</span>
        <select
          className="input cat-select"
          value={form.supplierId}
          onChange={set('supplierId')}
        >
          <option value="">Sin proveedor</option>
          {suppliers.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name}
              {s.active ? '' : ' (inactivo)'}
            </option>
          ))}
        </select>
      </label>

      <div className="prod-form-row">
        <label className="client-field">
          <span>
            Precio<span className="req"> *</span>
          </span>
          <Input
            mono
            inputMode="decimal"
            value={form.price}
            onChange={setNum('price', true)}
            placeholder="0.00"
          />
        </label>
        <label className="client-field">
          <span>Stock</span>
          <Input
            mono
            inputMode={isMeasured(form.unit) ? 'decimal' : 'numeric'}
            value={form.stock}
            onChange={setNum('stock', isMeasured(form.unit), 3)}
            placeholder="0"
          />
        </label>
      </div>

      <div className="prod-form-row">
        <label className="client-field">
          <span>Bajo stock</span>
          <Input
            mono
            inputMode={isMeasured(form.unit) ? 'decimal' : 'numeric'}
            value={form.minStock}
            onChange={setNum('minStock', isMeasured(form.unit), 3)}
            placeholder="5"
          />
        </label>
      </div>

      <label className="prod-sellable" onClick={(e) => e.preventDefault()}>
        <div style={{ minWidth: 0 }}>
          <div className="prod-sellable-title">Exento de IVA</div>
          <div className="prod-sellable-sub">
            Productos sin IVA (alimentos básicos, medicinas). No se le aplica el
            impuesto al vender.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.exempt === true}
          className={`prod-switch ${form.exempt === true ? 'on' : ''}`}
          onClick={() => setForm({ ...form, exempt: !form.exempt })}
        >
          <span className="prod-switch-knob" />
        </button>
      </label>

      <label className="prod-sellable" onClick={(e) => e.preventDefault()}>
        <div style={{ minWidth: 0 }}>
          <div className="prod-sellable-title">Disponible para venta</div>
          <div className="prod-sellable-sub">
            Si lo apagas, sigue en inventario pero no aparece en la pantalla de
            venta.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.sellable !== false}
          className={`prod-switch ${form.sellable !== false ? 'on' : ''}`}
          onClick={() =>
            setForm({ ...form, sellable: !(form.sellable !== false) })
          }
        >
          <span className="prod-switch-knob" />
        </button>
      </label>

      <div className="row client-actions" style={{ gap: 10, marginTop: 6 }}>
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button disabled={!valid || !online} onClick={submit}>
          {initial ? 'Guardar cambios' : 'Crear producto'}
        </Button>
      </div>
    </div>
  );
}

function ProductDetailSheet({
  product,
  onClose,
  onEdit,
  onAdjustStock,
  onDelete,
  bsRate,
  catMap,
  supplierLabel,
  online,
}: {
  product: Product;
  onClose: () => void;
  onEdit: (p: Product) => void;
  onAdjustStock: (id: Id<'products'>, stock: number) => void;
  onDelete: (p: Product) => void;
  bsRate: number;
  catMap: Map<string, string>;
  /** Preferred supplier's display name, "(inactivo)"-marked, or null when unset. */
  supplierLabel: string | null;
  /** Offline blocks the writes (FEATURES §18): edit / adjust stock / delete. */
  online: boolean;
}) {
  const [adjust, setAdjust] = useState('');
  // The adjustment is a quantity of THIS product, so it obeys the same unit the
  // rest of the form does. It used to strip the separator and parseInt, which
  // did not merely truncate: adjusting a 2.5 kg product to 3.75 typed as 375.
  const measured = isMeasured(product.unit);
  const newStock = adjust !== '' ? parseQty(adjust, product.unit) : null;
  const delta =
    newStock != null && !isNaN(newStock) ? newStock - product.stock : null;

  return (
    <Sheet onClose={onClose} title="Detalle del producto">
      <div className="prod-detail">
        {!online && (
          <Banner
            tone="warn"
            icon="wifi-off"
            title="Sin conexión"
            message="No disponible sin conexión. Editar, ajustar stock y eliminar requieren conexión."
          />
        )}
        <div className="prod-detail-head">
          <div className="prod-detail-glyph">
            <ProductImage product={product} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="prod-detail-name">{product.name}</div>
            <Chip
              tone={stockTone(product.stock, product.minStock)}
              style={{ marginTop: 6 }}
            >
              {stockLabel(product.stock, product.unit)}
            </Chip>
          </div>
        </div>

        <div className="prod-detail-rows">
          <div className="prod-detail-row">
            <span className="k">SKU</span>
            <span className="v mono">{product.sku}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Código de barras</span>
            <span className="v mono">{product.barcode}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Categoría</span>
            <span className="v">{catMap.get(product.categoryId) ?? ''}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Unidad base</span>
            <span className="v">{unitLabel(product.unit)}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Proveedor</span>
            <span className="v">{supplierLabel ?? '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Precio</span>
            <span className="v tabular">${product.price.toFixed(2)}</span>
          </div>
          {bsRate > 0 && (
            <div className="prod-detail-row">
              <span className="k">Precio en Bs</span>
              <span className="v tabular">
                Bs {(product.price * bsRate).toFixed(2)}
              </span>
            </div>
          )}
          <div className="prod-detail-row">
            <span className="k">Stock actual</span>
            <span className="v tabular">
              {formatQty(product.stock, product.unit)}
            </span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Disponible para venta</span>
            <span className="v">
              {product.sellable === false ? 'No' : 'Sí'}
            </span>
          </div>
          <div className="prod-detail-row">
            <span className="k">IVA</span>
            <span className="v">
              {product.exempt === true ? 'Exento' : 'No exento'}
            </span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Bajo stock cuando</span>
            <span className="v tabular">≤ {product.minStock ?? 5}</span>
          </div>
        </div>

        <div className="prod-detail-adjust">
          <div className="prod-detail-adjust-title">Ajustar stock</div>
          <div className="prod-detail-adjust-row">
            <Input
              mono
              // A numeric keypad has no decimal point, so a weighed product
              // could not be adjusted at all from a phone.
              inputMode={measured ? 'decimal' : 'numeric'}
              placeholder={`${product.stock}`}
              value={adjust}
              onChange={(e) =>
                setAdjust(
                  measured
                    ? e.target.value.replace(/[^\d.,]/g, '')
                    : e.target.value.replace(/\D/g, '')
                )
              }
            />

            <Button
              size="md"
              icon="check"
              disabled={
                delta === null || delta === 0 || isNaN(delta) || !online
              }
              onClick={() => {
                if (newStock !== null) onAdjustStock(product._id, newStock);
                setAdjust('');
              }}
            >
              Guardar
            </Button>
          </div>
          {delta !== null && !isNaN(delta) && delta !== 0 && (
            <div className={`prod-detail-delta ${delta > 0 ? 'pos' : 'neg'}`}>
              {delta > 0 ? '+' : '−'}
              {formatQty(Math.abs(delta), product.unit)}
              {delta > 0 ? ' (entrada)' : ' (salida)'}
            </div>
          )}
        </div>
      </div>

      <div className="prod-detail-actions">
        <Button
          icon="edit-3"
          onClick={() => onEdit(product)}
          block
          disabled={!online}
        >
          Editar
        </Button>
        <div className="row" style={{ gap: 10 }}>
          <Button
            variant="danger"
            icon="trash-2"
            onClick={() => onDelete(product)}
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

function CategoriesSheet({
  categories,
  onClose,
  online,
}: {
  categories: CategoryWithCount[];
  onClose: () => void;
  /** Offline blocks the writes (FEATURES §18): create / rename / delete. */
  online: boolean;
}) {
  // Convex categories.list returns only real categories ('all' is a UI-only
  // sentinel in the parent filter row); `count` is the live product count.
  const { token } = useSession();
  const alertError = useAlertError();
  const createCat = useMutation(api.categories.create);
  const updateCat = useMutation(api.categories.update);
  const removeCat = useMutation(api.categories.removeWithReassign);

  const real = categories;
  const countFor = (id: string) => real.find((c) => c._id === id)?.count ?? 0;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<CategoryWithCount | null>(null); // category being deleted
  const [reassignTo, setReassignTo] = useState('');

  const addCategory = async () => {
    const name = newName.trim();
    if (name.length < 2) return;
    try {
      await createCat({ token: token!, label: name });
      setNewName('');
    } catch (e) {
      alertError(e);
    }
  };

  const saveRename = async (cat: CategoryWithCount) => {
    const name = draft.trim();
    if (name.length < 2) {
      setEditingId(null);
      return;
    }
    try {
      await updateCat({ token: token!, categoryId: cat._id, label: name });
    } catch (e) {
      alertError(e);
    }
    setEditingId(null);
  };

  const startDelete = (cat: CategoryWithCount) => {
    setDeleting(cat);
    const firstOther = real.find((c) => c._id !== cat._id);
    setReassignTo(firstOther ? firstOther._id : '');
  };

  const confirmDelete = async () => {
    const cat = deleting!;
    try {
      // removeWithReassign always requires a target; for empty categories any
      // other category works (nothing gets reassigned).
      await removeCat({
        token: token!,
        categoryId: cat._id,
        reassignToId: (reassignTo || cat._id) as Id<'categories'>,
      });
      setDeleting(null);
    } catch (e) {
      alertError(e);
    }
  };

  // Delete confirmation view
  if (deleting) {
    const count = countFor(deleting._id);
    const targets = real.filter((c) => c._id !== deleting._id);
    return (
      <Sheet onClose={() => setDeleting(null)} title="Eliminar categoría">
        {!online && (
          <Banner
            tone="warn"
            icon="wifi-off"
            title="Sin conexión"
            message="No disponible sin conexión. Eliminar categorías requiere conexión."
          />
        )}
        <div className="cat-del">
          <div className="cat-del-head">
            <div className="cat-del-icon">
              <Icon name="alert-triangle" size={26} />
            </div>
            <div>
              <div className="cat-del-name">{deleting.label}</div>
              <div className="cat-del-count">
                {count === 0
                  ? 'Sin productos asignados'
                  : `${count} producto${count === 1 ? '' : 's'} asignado${count === 1 ? '' : 's'}`}
              </div>
            </div>
          </div>

          {count > 0 ? (
            targets.length === 0 ? (
              <Banner
                tone="danger"
                icon="alert-triangle"
                message="No hay otra categoría a la que reasignar. Crea una categoría primero."
              />
            ) : (
              <>
                <Banner
                  tone="warn"
                  icon="repeat"
                  message="Esta categoría tiene productos. Reasígnalos a otra categoría antes de eliminarla."
                />
                <label className="client-field" style={{ marginTop: 12 }}>
                  <span>Reasignar productos a</span>
                  <select
                    className="input cat-select"
                    value={reassignTo}
                    onChange={(e) => setReassignTo(e.target.value)}
                  >
                    {targets.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )
          ) : (
            <Banner
              tone="info"
              icon="info"
              message="Esta categoría no tiene productos. Puedes eliminarla directamente."
            />
          )}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14 }}>
          <Button variant="secondary" onClick={() => setDeleting(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            icon="trash-2"
            disabled={
              !online || (count > 0 && (targets.length === 0 || !reassignTo))
            }
            onClick={() => void confirmDelete()}
          >
            {count > 0 ? 'Reasignar y eliminar' : 'Eliminar'}
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} title="Categorías">
      {!online && (
        <Banner
          tone="warn"
          icon="wifi-off"
          title="Sin conexión"
          message="No disponible sin conexión. Crear, renombrar y eliminar categorías requieren conexión."
        />
      )}
      <div className="cat-add-row">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nueva categoría"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addCategory();
          }}
        />
        <Button
          icon="plus"
          onClick={() => void addCategory()}
          disabled={newName.trim().length < 2 || !online}
        >
          Crear
        </Button>
      </div>

      <div className="cat-list">
        {real.length === 0 ? (
          <div className="empty" style={{ padding: '24px 16px' }}>
            <p>Sin categorías. Crea la primera.</p>
          </div>
        ) : (
          real.map((cat) => (
            <div className="cat-item" key={cat._id}>
              {editingId === cat._id ? (
                <>
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename(cat);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <div className="cat-item-actions">
                    <IconButton
                      icon="check"
                      ariaLabel="Guardar"
                      onClick={() => void saveRename(cat)}
                      disabled={!online}
                    />
                    <IconButton
                      icon="x"
                      ariaLabel="Cancelar"
                      onClick={() => setEditingId(null)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="cat-item-info">
                    <div
                      className="cat-item-name"
                      style={{ textAlign: 'left' }}
                    >
                      {cat.label}
                    </div>
                    <div
                      className="cat-item-count"
                      style={{ textAlign: 'left' }}
                    >
                      {cat.count} producto{cat.count === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="cat-item-actions">
                    <IconButton
                      icon="edit-3"
                      ariaLabel="Renombrar"
                      onClick={() => {
                        setEditingId(cat._id);
                        setDraft(cat.label);
                      }}
                      disabled={!online}
                    />
                    <IconButton
                      icon="trash-2"
                      ariaLabel="Eliminar"
                      onClick={() => startDelete(cat)}
                      disabled={!online}
                    />
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        <Button variant="secondary" block onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </Sheet>
  );
}

export default function ProductsScreen() {
  const products = useProducts();
  const categories = useCategories();
  const suppliers = useSuppliers();
  const { token } = useSession();
  const online = useOnline();
  const bsRate = useBsRate();
  const location = useLocation();
  // Dashboard navigates here with router state (e.g. { stock: 'low' }) — the
  // prototype's initialStock/stockKey props.
  const initialStock = (location.state?.stock as string | undefined) ?? 'all';

  const createProduct = useMutation(api.products.create);
  const updateProduct = useMutation(api.products.update);
  const setSellableMut = useMutation(api.products.setSellable);
  const adjustStockMut = useMutation(api.products.adjustStock);
  const removeProduct = useMutation(api.products.remove);
  const alertError = useAlertError();

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [stockFilter, setStockFilter] = useState(initialStock);
  const [taxFilter, setTaxFilter] = useState('all');
  // Re-sync only when navigation happens (location.key) — initialStock is derived
  // from the same navigation state, so listing it would be redundant.
  useEffect(() => {
    setStockFilter(initialStock);
    // initialStock comes from the same navigation state as location.key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
  const [sort, setSort] = useState('created-desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [detail, setDetail] = useState<Product | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [catManagerOpen, setCatManagerOpen] = useState(false);

  const catMap = useMemo(
    () => new Map(categories.map((c) => [c._id, c.label] as [string, string])),
    [categories]
  );
  // A retired supplier still labels the products that name it — the link is
  // historically true, and hiding it would make the detail look unset.
  const supplierMap = useMemo(
    () =>
      new Map(
        suppliers.map(
          (s) =>
            [s._id, s.active ? s.name : `${s.name} (inactivo)`] as [
              string,
              string,
            ]
        )
      ),
    [suppliers]
  );

  // ---- Stats -------------------------------------------------------------
  const stats = useMemo(() => {
    const total = products.length;
    const totalUnits = products.reduce((s, p) => s + p.stock, 0);
    const inventoryValue = products.reduce((s, p) => s + p.stock * p.price, 0);
    const lowStock = products.filter(
      (p) => p.stock > 0 && p.stock <= (p.minStock ?? 5)
    ).length;
    const outOfStock = products.filter((p) => p.stock <= 0).length;
    return { total, totalUnits, inventoryValue, lowStock, outOfStock };
  }, [products]);

  // ---- Filter + sort -----------------------------------------------------
  const norm = (s: string) => (s || '').toLowerCase();
  const filtered = products
    .filter((p) => cat === 'all' || p.categoryId === cat)
    .filter((p) => {
      if (stockFilter === 'in') return p.stock > (p.minStock ?? 5);
      if (stockFilter === 'low')
        return p.stock > 0 && p.stock <= (p.minStock ?? 5);
      if (stockFilter === 'out') return p.stock <= 0;
      if (stockFilter === 'paused') return p.sellable === false;
      return true;
    })
    .filter((p) => {
      if (taxFilter === 'exempt') return p.exempt === true;
      if (taxFilter === 'taxable') return p.exempt !== true;
      return true;
    })
    .filter((p) => {
      const term = norm(q);
      if (!term) return true;
      return (
        norm(p.name).includes(term) ||
        norm(p.sku).includes(term) ||
        norm(p.barcode).includes(term)
      );
    });

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
      case 'stock-asc':
        return a.stock - b.stock;
      case 'stock-desc':
        return b.stock - a.stock;
      case 'created-asc':
        return a._creationTime - b._creationTime;
      default:
        // 'created-desc' — newest first. The default: after adding a product you
        // expect to see it, and hunting for it alphabetically is the wrong job.
        return b._creationTime - a._creationTime;
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

  // ---- Actions ------------------------------------------------------------
  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (p: Product) => {
    setDetail(null);
    setEditing(p);
    setEditorOpen(true);
  };

  const save = async (form: ProductFormValues) => {
    try {
      if (editing) {
        await updateProduct({
          token: token!,
          productId: editing._id,
          patch: {
            barcode: form.barcode,
            name: form.name,
            price: form.price,
            stock: form.stock,
            minStock: form.minStock,
            categoryId: form.categoryId as Id<'categories'>,
            exempt: form.exempt,
            sellable: form.sellable,
            unit: form.unit as ProductUnitId,
            // null CLEARS the link; an id sets it. The empty option in the
            // picker is a real choice, so it has to reach the server as one.
            supplierId: form.supplierId
              ? (form.supplierId as Id<'suppliers'>)
              : null,
            // null CLEARS and lets the server delete the previous file.
            imageId: form.imageId ? (form.imageId as Id<'_storage'>) : null,
          },
        });
      } else {
        const id = await createProduct({
          token: token!,
          barcode: form.barcode,
          name: form.name,
          price: form.price,
          stock: form.stock,
          minStock: form.minStock,
          categoryId: form.categoryId as Id<'categories'>,
          exempt: form.exempt,
          // Omitted at the DEFAULT rather than stored: an absent unit is what
          // every product predating this capability has, and writing the default
          // explicitly would make new products look different for no reason.
          ...(form.unit !== DEFAULT_UNIT
            ? { unit: form.unit as ProductUnitId }
            : {}),
          // Omitted entirely when unset — create has no "clear" case.
          ...(form.supplierId
            ? { supplierId: form.supplierId as Id<'suppliers'> }
            : {}),
          ...(form.imageId ? { imageId: form.imageId as Id<'_storage'> } : {}),
        });
        // create() has no `sellable` arg — pause right after when the toggle was off
        if (form.sellable === false) {
          await setSellableMut({
            token: token!,
            productId: id,
            sellable: false,
          });
        }
      }
      setEditorOpen(false);
      setEditing(null);
    } catch (e) {
      alertError(e);
    }
  };

  const adjustStock = async (id: Id<'products'>, newStock: number) => {
    try {
      await adjustStockMut({
        token: token!,
        productId: id,
        stock: newStock,
      });
      // keep the open detail sheet in sync (it holds a snapshot, not the live doc)
      setDetail((prev) => (prev ? { ...prev, stock: newStock } : null));
    } catch (e) {
      alertError(e);
    }
  };

  const remove = async (p: Product) => {
    try {
      await removeProduct({ token: token!, productId: p._id });
    } catch (e) {
      alertError(e);
    }
    setConfirmDelete(null);
    setDetail(null);
  };

  // ---- Render -------------------------------------------------------------
  return (
    <>
      <AppBar
        title="Productos"
        online={online}
        /* left={<IconButton icon="chevron-left" onClick={() => void navigate('/')} ariaLabel="Volver" />} */
        right={
          <>
            <Button
              size="sm"
              variant="secondary"
              icon="folder-cog"
              onClick={() => setCatManagerOpen(true)}
            >
              Categorías
            </Button>
            <Button size="sm" icon="plus" onClick={openNew} disabled={!online}>
              Nuevo producto
            </Button>
          </>
        }
      />

      <div className="content prod-content">
        {!online && (
          <Banner
            tone="warn"
            icon="wifi-off"
            title="Sin conexión"
            message="Solo lectura. No puedes crear, editar o eliminar productos ni categorías hasta reconectar."
          />
        )}

        {/* Stats */}
        <div className="prod-stats">
          <div className="prod-stat">
            <span className="k">Productos</span>
            <span className="v tabular">{stats.total}</span>
            <span className="meta">
              {stats.totalUnits.toLocaleString()} unidades
            </span>
          </div>
          <div className="prod-stat">
            <span className="k">Valor de inventario</span>
            <span className="v tabular">
              ${stats.inventoryValue.toFixed(2)}
            </span>
            <span className="meta">a precio de venta</span>
          </div>
          <div className="prod-stat warn">
            <span className="k">Bajo stock</span>
            <span className="v tabular">{stats.lowStock}</span>
            <span className="meta">por reponer pronto</span>
          </div>
          <div className="prod-stat danger">
            <span className="k">Agotados</span>
            <span className="v tabular">{stats.outOfStock}</span>
            <span className="meta">sin existencias</span>
          </div>
        </div>

        {/* Filters */}
        <div className="catalog-head" style={{ margin: '0 0 14px' }}>
          <Input
            placeholder="Buscar por nombre, SKU o código de barras"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />

          <div className="catalog-filters prod-filters">
            <label className="catalog-filter">
              <span>Categoría</span>
              <select
                className="input cat-select"
                value={cat}
                onChange={(e) => {
                  setCat(e.target.value);
                  setPage(1);
                }}
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
              <span>Stock</span>
              <select
                className="input cat-select"
                value={stockFilter}
                onChange={(e) => {
                  setStockFilter(e.target.value);
                  setPage(1);
                }}
              >
                {STOCK_LEVELS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="catalog-filter">
              <span>IVA</span>
              <select
                className="input cat-select"
                value={taxFilter}
                onChange={(e) => {
                  setTaxFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Todos</option>
                <option value="taxable">No exento</option>
                <option value="exempt">Exento</option>
              </select>
            </label>
            <label className="catalog-filter">
              <span>Ordenar por</span>
              <select
                className="input cat-select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="created-desc">Más recientes primero</option>
                <option value="created-asc">Más antiguos primero</option>
                <option value="name-asc">Nombre (A–Z)</option>
                <option value="name-desc">Nombre (Z–A)</option>
                <option value="price-asc">Precio (menor a mayor)</option>
                <option value="price-desc">Precio (mayor a menor)</option>
                <option value="stock-asc">Stock (menor a mayor)</option>
                <option value="stock-desc">Stock (mayor a menor)</option>
              </select>
            </label>
          </div>
        </div>

        {/* Grid */}
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
              <Icon name="package" size={28} />
            </div>
            <h4>Sin productos</h4>
            <p>
              {q
                ? `Sin resultados para "${q}"`
                : 'Aún no hay productos que coincidan con los filtros.'}
            </p>
          </div>
        ) : (
          <div className="prod-grid">
            {visible.map((p) => (
              <ProductCard
                key={p._id}
                product={p}
                onClick={setDetail}
                bsRate={bsRate}
                catMap={catMap}
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
                  {sorted.length}{' '}
                  {sorted.length === 1 ? 'producto' : 'productos'}
                </>
              ) : (
                <>
                  Productos{' '}
                  <strong>
                    {showingFrom}–{showingTo}
                  </strong>{' '}
                  de <strong>{sorted.length}</strong>
                </>
              )}
            </div>
            <div className="pager-size">
              <label htmlFor="prod-pager-size">Por página</label>
              <select
                id="prod-pager-size"
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
        <ProductDetailSheet
          product={detail}
          onClose={() => setDetail(null)}
          bsRate={bsRate}
          catMap={catMap}
          supplierLabel={
            detail.supplierId
              ? (supplierMap.get(detail.supplierId) ?? null)
              : null
          }
          online={online}
          onEdit={openEdit}
          onAdjustStock={(...args: Parameters<typeof adjustStock>) => {
            void adjustStock(...args);
          }}
          onDelete={(p) => setConfirmDelete(p)}
        />
      )}

      {catManagerOpen && (
        <CategoriesSheet
          categories={categories}
          online={online}
          onClose={() => setCatManagerOpen(false)}
        />
      )}

      {editorOpen && (
        <Sheet
          onClose={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
          title={editing ? 'Editar producto' : 'Nuevo producto'}
        >
          <ProductForm
            initial={editing}
            categories={categories}
            suppliers={suppliers}
            online={online}
            onSave={(...args: Parameters<typeof save>) => {
              void save(...args);
            }}
            onCancel={() => {
              setEditorOpen(false);
              setEditing(null);
            }}
          />
        </Sheet>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="¿Eliminar producto?"
          message={`Se eliminará "${confirmDelete.name}" del catálogo. Esta acción no se puede deshacer.`}
          confirmLabel="Sí, eliminar"
          cancelLabel="Cancelar"
          tone="danger"
          onConfirm={() => void remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}
