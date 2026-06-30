// ProductsScreen — full catalog management
// Stats header · filters · paginated grid · add/edit sheet · detail/adjust sheet
// Ported from prototype products.jsx: data comes from Convex (useProducts /
// useCategories) and writes go through mutations — useQuery reactivity refreshes
// the lists, so the prototype's setProducts/setCategories plumbing is gone.
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
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
} from '@/components';
import { useCart } from '@/state/CartContext';
import { useSession } from '@/state/SessionContext';
import { useOnline } from '@/state/useOnline';
import { useBsRate, useCategories, useProducts } from '@/state/hooks';
import type { CategoryWithCount, Product } from '@/types';

const STOCK_LEVELS = [
  { id: 'all', label: 'Todos' },
  { id: 'in', label: 'En stock' },
  { id: 'low', label: 'Bajo stock' },
  { id: 'out', label: 'Agotados' },
  { id: 'paused', label: 'Pausados' },
];

const alertError = (e: any) =>
  alert(
    typeof e?.data === 'string' ? e.data : 'Ocurrió un error. Intenta de nuevo.'
  );

function stockTone(stock: number, minStock = 5) {
  if (stock <= 0) return 'danger';
  if (stock <= minStock) return 'warn';
  return 'ok';
}
function stockLabel(stock: number) {
  if (stock <= 0) return 'Agotado';
  return `${stock} en stock`;
}

function ProductCard({
  product,
  onClick,
  bsRate,
  catMap,
  reservedUnits = 0,
}: {
  product: Product;
  onClick: (p: Product) => void;
  bsRate: number;
  catMap: Map<string, string>;
  /** Units reserved by held ("en espera") carts — informational chip only. */
  reservedUnits?: number;
}) {
  return (
    <button className="prod-card" onClick={() => onClick(product)}>
      <div className="prod-card-head">
        <div className="prod-card-glyph">{product.glyph}</div>
        <div className="prod-card-chips">
          {product.sellable === false && <Chip tone="neutral">Pausado</Chip>}
          <Chip tone={stockTone(product.stock, product.minStock)}>
            {stockLabel(product.stock)}
          </Chip>
          {reservedUnits > 0 && (
            <Chip tone="warn">{reservedUnits} en espera</Chip>
          )}
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
  sku: string;
  barcode: string;
  price: string;
  stock: string;
  minStock: string;
  exempt: boolean;
  glyph: string;
  categoryId: string;
  sellable: boolean;
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
  onSave,
  onCancel,
  online,
}: {
  initial: Product | null;
  categories: CategoryWithCount[];
  onSave: (values: ProductFormValues) => void;
  onCancel: () => void;
  /** Offline blocks the write (FEATURES §18) — create/edit require connection. */
  online: boolean;
}) {
  const [form, setForm] = useState<ProductFormState>(() => ({
    name: initial?.name || '',
    sku: initial?.sku || '',
    barcode: initial?.barcode || '',
    price: initial?.price != null ? String(initial.price) : '',
    stock: initial?.stock != null ? String(initial.stock) : '0',
    minStock: initial?.minStock != null ? String(initial.minStock) : '5',
    exempt: initial?.exempt === true,
    glyph: initial?.glyph || '📦',
    categoryId: initial?.categoryId || categories[0]?._id || '',
    sellable: initial?.sellable !== false,
  }));
  const set = (k: keyof ProductFormState) => (e: any) =>
    setForm({ ...form, [k]: e.target.value });
  const setNum =
    (k: keyof ProductFormState, allowDecimal?: boolean) => (e: any) => {
      let v = e.target.value.replace(/[^\d.]/g, '');
      if (!allowDecimal) v = v.replace(/\./g, '');
      if (allowDecimal) {
        const first = v.indexOf('.');
        if (first !== -1) {
          v = v.slice(0, first + 1) + v.slice(first + 1).replace(/\./g, '');
          const [a, b] = v.split('.');
          v = a + '.' + (b || '').slice(0, 2);
        }
      }
      setForm({ ...form, [k]: v });
    };

  const valid =
    form.name.trim().length >= 2 &&
    form.sku.trim().length >= 1 &&
    form.barcode.trim().length >= 1 &&
    parseFloat(form.price) > 0;

  const submit = () => {
    onSave({
      ...form,
      name: form.name.trim(),
      sku: form.sku.trim().toUpperCase(),
      barcode: form.barcode.trim(),
      price: parseFloat(form.price) || 0,
      stock: parseInt(form.stock, 10) || 0,
      minStock: parseInt(form.minStock, 10) || 0,
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
        <div className="prod-form-icon-preview" aria-hidden="true">
          {form.glyph || '📦'}
        </div>
        <label className="client-field" style={{ flex: 1 }}>
          <span>Emoji / símbolo</span>
          <Input
            value={form.glyph}
            onChange={set('glyph')}
            placeholder="📦"
            maxLength={4}
          />
        </label>
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

      <div className="prod-form-row">
        <label className="client-field">
          <span>
            SKU<span className="req"> *</span>
          </span>
          <Input
            mono
            value={form.sku}
            onChange={set('sku')}
            placeholder="COCA-600"
          />
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
            inputMode="numeric"
            value={form.stock}
            onChange={setNum('stock', false)}
            placeholder="0"
          />
        </label>
      </div>

      <div className="prod-form-row">
        <label className="client-field">
          <span>Bajo stock</span>
          <Input
            mono
            inputMode="numeric"
            value={form.minStock}
            onChange={setNum('minStock', false)}
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
  reservedUnits = 0,
  online,
}: {
  product: Product;
  onClose: () => void;
  onEdit: (p: Product) => void;
  onAdjustStock: (id: Id<'products'>, stock: number) => void;
  onDelete: (p: Product) => void;
  bsRate: number;
  catMap: Map<string, string>;
  /** Units reserved by held ("en espera") carts — informational chip only. */
  reservedUnits?: number;
  /** Offline blocks the writes (FEATURES §18): edit / adjust stock / delete. */
  online: boolean;
}) {
  const [adjust, setAdjust] = useState('');
  if (!product) return null;
  const newStock = adjust !== '' ? parseInt(adjust, 10) : null;
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
          <div className="prod-detail-glyph">{product.glyph}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="prod-detail-name">{product.name}</div>
            <Chip
              tone={stockTone(product.stock, product.minStock)}
              style={{ marginTop: 6 }}
            >
              {stockLabel(product.stock)}
            </Chip>
            {reservedUnits > 0 && (
              <Chip tone="warn" style={{ marginTop: 6, marginLeft: 6 }}>
                {reservedUnits} en espera
              </Chip>
            )}
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
            <span className="v tabular">{product.stock} unidades</span>
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
              inputMode="numeric"
              placeholder={`${product.stock}`}
              value={adjust}
              onChange={(e) => setAdjust(e.target.value.replace(/\D/g, ''))}
            />

            <Button
              size="md"
              icon="check"
              disabled={
                delta === null || delta === 0 || isNaN(delta) || !online
              }
              onClick={() => {
                onAdjustStock(product._id, newStock!);
                setAdjust('');
              }}
            >
              Guardar
            </Button>
          </div>
          {delta !== null && !isNaN(delta) && delta !== 0 && (
            <div className={`prod-detail-delta ${delta > 0 ? 'pos' : 'neg'}`}>
              {delta > 0 ? `+${delta}` : delta} unidad
              {Math.abs(delta) === 1 ? '' : 'es'}
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
    } catch (e: any) {
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
    } catch (e: any) {
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
    } catch (e: any) {
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
  // productId → units held in "en espera" carts; drives the informational chip.
  const { reserved } = useCart();
  const categories = useCategories();
  const { token } = useSession();
  const online = useOnline();
  const bsRate = useBsRate();
  const _navigate = useNavigate();
  const location = useLocation();
  // Dashboard navigates here with router state (e.g. { stock: 'low' }) — the
  // prototype's initialStock/stockKey props.
  const initialStock = (location.state?.stock as string | undefined) ?? 'all';

  const createProduct = useMutation(api.products.create);
  const updateProduct = useMutation(api.products.update);
  const setSellableMut = useMutation(api.products.setSellable);
  const adjustStockMut = useMutation(api.products.adjustStock);
  const removeProduct = useMutation(api.products.remove);

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [stockFilter, setStockFilter] = useState(initialStock);
  const [taxFilter, setTaxFilter] = useState('all');
  // Re-sync only when navigation happens (location.key) — initialStock is derived
  // from the same navigation state, so listing it would be redundant.
  useEffect(() => {
    setStockFilter(initialStock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
  const [sort, setSort] = useState('name-asc');
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
            sku: form.sku,
            name: form.name,
            price: form.price,
            stock: form.stock,
            minStock: form.minStock,
            categoryId: form.categoryId as Id<'categories'>,
            exempt: form.exempt,
            glyph: form.glyph,
            sellable: form.sellable,
          },
        });
      } else {
        const id = await createProduct({
          token: token!,
          barcode: form.barcode,
          sku: form.sku,
          name: form.name,
          price: form.price,
          stock: form.stock,
          minStock: form.minStock,
          categoryId: form.categoryId as Id<'categories'>,
          exempt: form.exempt,
          glyph: form.glyph,
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
    } catch (e: any) {
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
    } catch (e: any) {
      alertError(e);
    }
  };

  const remove = async (p: Product) => {
    try {
      await removeProduct({ token: token!, productId: p._id });
    } catch (e: any) {
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
            <Button
              size="sm"
              icon="plus"
              onClick={openNew}
              disabled={!online}
            >
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
                reservedUnits={reserved[p._id] || 0}
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
          reservedUnits={reserved[detail._id] || 0}
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
