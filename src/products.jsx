// ProductsScreen — full catalog management
// Stats header · filters · paginated grid · add/edit sheet · detail/adjust sheet

const STOCK_LEVELS = [
{ id: 'all', label: 'Todos' },
{ id: 'in', label: 'En stock' },
{ id: 'low', label: 'Bajo stock' },
{ id: 'out', label: 'Agotados' },
{ id: 'paused', label: 'Pausados' }];


function stockTone(stock, minStock = 5) {
  if (stock <= 0) return 'danger';
  if (stock <= minStock) return 'warn';
  return 'ok';
}
function stockLabel(stock) {
  if (stock <= 0) return 'Agotado';
  return `${stock} en stock`;
}

function ProductCard({ product, onClick, bsRate }) {
  return (
    <button className="prod-card" onClick={() => onClick(product)}>
      <div className="prod-card-head">
        <div className="prod-card-glyph">{product.glyph}</div>
        <div className="prod-card-chips">
          {product.sellable === false && <Chip tone="neutral">Pausado</Chip>}
          <Chip tone={stockTone(product.stock, product.minStock)}>{stockLabel(product.stock)}</Chip>
          {product.exempt === true && <Chip tone="info">Exento IVA</Chip>}
        </div>
      </div>
      <div className="prod-card-name">{product.name}</div>
      <div className="prod-card-meta">
        <span className="mono">{product.sku}</span>
        <span className="dot" />
        <span className="cat">{product.cat}</span>
      </div>
      <div className="prod-card-foot">
        <span className="prod-card-barcode mono">{product.barcode}</span>
        <span className="prod-card-prices">
          <span className="prod-card-price tabular">${product.price.toFixed(2)}</span>
          {bsRate > 0 && <span className="prod-card-bs tabular">Bs {(product.price * bsRate).toFixed(2)}</span>}
        </span>
      </div>
    </button>);

}

function ProductForm({ initial, categories, onSave, onCancel }) {
  const [form, setForm] = React.useState(() => ({
    name: initial?.name || '',
    sku: initial?.sku || '',
    barcode: initial?.barcode || '',
    price: initial?.price != null ? String(initial.price) : '',
    stock: initial?.stock != null ? String(initial.stock) : '0',
    minStock: initial?.minStock != null ? String(initial.minStock) : '5',
    exempt: initial?.exempt === true,
    glyph: initial?.glyph || '📦',
    cat: initial?.cat || categories[1]?.id || 'alimentos',
    sellable: initial?.sellable !== false
  }));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setNum = (k, allowDecimal) => (e) => {
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
      sellable: form.sellable !== false
    });
  };

  return (
    <div className="prod-form">
      <div className="prod-form-icon-row">
        <div className="prod-form-icon-preview" aria-hidden="true">{form.glyph || '📦'}</div>
        <label className="client-field" style={{ flex: 1 }}>
          <span>Emoji / símbolo</span>
          <Input value={form.glyph} onChange={set('glyph')} placeholder="📦" maxLength={4} />
        </label>
      </div>

      <label className="client-field">
        <span>Nombre del producto<span className="req"> *</span></span>
        <Input value={form.name} onChange={set('name')} placeholder="Ej. Coca-Cola 600ml" autoFocus />
      </label>

      <div className="prod-form-row">
        <label className="client-field">
          <span>SKU<span className="req"> *</span></span>
          <Input mono value={form.sku} onChange={set('sku')} placeholder="COCA-600" />
        </label>
        <label className="client-field">
          <span>Código de barras<span className="req"> *</span></span>
          <Input mono inputMode="numeric" value={form.barcode} onChange={set('barcode')} placeholder="7591000000123" />
        </label>
      </div>

      <label className="client-field">
        <span>Categoría</span>
        <select className="input cat-select" value={form.cat} onChange={set('cat')}>
          {categories.filter((c) => c.id !== 'all').map((c) =>
          <option key={c.id} value={c.id}>{c.label}</option>
          )}
        </select>
      </label>

      <div className="prod-form-row">
        <label className="client-field">
          <span>Precio<span className="req"> *</span></span>
          <Input mono inputMode="decimal" value={form.price} onChange={setNum('price', true)} placeholder="0.00" />
        </label>
        <label className="client-field">
          <span>Stock</span>
          <Input mono inputMode="numeric" value={form.stock} onChange={setNum('stock', false)} placeholder="0" />
        </label>
      </div>

      <div className="prod-form-row">
        <label className="client-field">
          <span>Bajo stock</span>
          <Input mono inputMode="numeric" value={form.minStock} onChange={setNum('minStock', false)} placeholder="5" />
        </label>
      </div>

      <label className="prod-sellable" onClick={(e) => e.preventDefault()}>
        <div style={{ minWidth: 0 }}>
          <div className="prod-sellable-title">Exento de IVA</div>
          <div className="prod-sellable-sub">Productos sin IVA (alimentos básicos, medicinas). No se le aplica el impuesto al vender.</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.exempt === true}
          className={`prod-switch ${form.exempt === true ? 'on' : ''}`}
          onClick={() => setForm({ ...form, exempt: !form.exempt })}>
          <span className="prod-switch-knob" />
        </button>
      </label>

      <label className="prod-sellable" onClick={(e) => e.preventDefault()}>
        <div style={{ minWidth: 0 }}>
          <div className="prod-sellable-title">Disponible para venta</div>
          <div className="prod-sellable-sub">Si lo apagas, sigue en inventario pero no aparece en la pantalla de venta.</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.sellable !== false}
          className={`prod-switch ${form.sellable !== false ? 'on' : ''}`}
          onClick={() => setForm({ ...form, sellable: !(form.sellable !== false) })}>
          <span className="prod-switch-knob" />
        </button>
      </label>

      <div className="row client-actions" style={{ gap: 10, marginTop: 6 }}>
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button disabled={!valid} onClick={submit}>
          {initial ? 'Guardar cambios' : 'Crear producto'}
        </Button>
      </div>
    </div>);

}

function ProductDetailSheet({ product, onClose, onEdit, onAdjustStock, onDelete, bsRate }) {
  if (!product) return null;
  const [adjust, setAdjust] = React.useState('');
  const newStock = adjust !== '' ? parseInt(adjust, 10) : null;
  const delta = newStock != null && !isNaN(newStock) ? newStock - product.stock : null;

  return (
    <Sheet onClose={onClose} title="Detalle del producto">
      <div className="prod-detail">
        <div className="prod-detail-head">
          <div className="prod-detail-glyph">{product.glyph}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="prod-detail-name">{product.name}</div>
            <Chip tone={stockTone(product.stock, product.minStock)} style={{ marginTop: 6 }}>{stockLabel(product.stock)}</Chip>
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
            <span className="v">{product.cat}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Precio</span>
            <span className="v tabular">${product.price.toFixed(2)}</span>
          </div>
          {bsRate > 0 &&
          <div className="prod-detail-row">
              <span className="k">Precio en Bs</span>
              <span className="v tabular">Bs {(product.price * bsRate).toFixed(2)}</span>
            </div>
          }
          <div className="prod-detail-row">
            <span className="k">Stock actual</span>
            <span className="v tabular">{product.stock} unidades</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Disponible para venta</span>
            <span className="v">{product.sellable === false ? 'No' : 'Sí'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">IVA</span>
            <span className="v">{product.exempt === true ? 'Exento' : 'No exento'}</span>
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
              onChange={(e) => setAdjust(e.target.value.replace(/\D/g, ''))} />
            
            <Button
              size="md"
              icon="check"
              disabled={delta === null || delta === 0 || isNaN(delta)}
              onClick={() => {onAdjustStock(product.id, newStock);setAdjust('');}}>
              Guardar
            </Button>
          </div>
          {delta !== null && !isNaN(delta) && delta !== 0 &&
          <div className={`prod-detail-delta ${delta > 0 ? 'pos' : 'neg'}`}>
              {delta > 0 ? `+${delta}` : delta} unidad{Math.abs(delta) === 1 ? '' : 'es'}
              {delta > 0 ? ' (entrada)' : ' (salida)'}
            </div>
          }
        </div>
      </div>

      <div className="prod-detail-actions">
        <Button icon="edit-3" onClick={() => onEdit(product)} block>Editar</Button>
        <div className="row" style={{ gap: 10 }}>
          <Button variant="danger" icon="trash-2" onClick={() => onDelete(product)}>Eliminar</Button>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Sheet>);

}

function slugify(s) {
  return (s || '').toString().toLowerCase().trim().
  normalize('NFD').replace(/[\u0300-\u036f]/g, '').
  replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cat-' + Math.random().toString(36).slice(2, 7);
}

function CategoriesSheet({ categories, products, setCategories, setProducts, onClose }) {
  // categories includes the 'all' pseudo-item; we manage only real ones
  const real = categories.filter((c) => c.id !== 'all');
  const countFor = (id) => products.filter((p) => p.cat === id).length;

  const [editingId, setEditingId] = React.useState(null);
  const [draft, setDraft] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [deleting, setDeleting] = React.useState(null); // category being deleted
  const [reassignTo, setReassignTo] = React.useState('');

  const addCategory = () => {
    const name = newName.trim();
    if (name.length < 2) return;
    let id = slugify(name);
    while (categories.some((c) => c.id === id)) id = id + '-1';
    setCategories((prev) => [...prev, { id, label: name }]);
    setNewName('');
  };

  const saveRename = (cat) => {
    const name = draft.trim();
    if (name.length < 2) {setEditingId(null);return;}
    setCategories((prev) => prev.map((c) => c.id === cat.id ? { ...c, label: name } : c));
    setEditingId(null);
  };

  const startDelete = (cat) => {
    setDeleting(cat);
    const firstOther = real.find((c) => c.id !== cat.id);
    setReassignTo(firstOther ? firstOther.id : '');
  };

  const confirmDelete = () => {
    const cat = deleting;
    const count = countFor(cat.id);
    if (count > 0 && reassignTo) {
      setProducts((prev) => prev.map((p) => p.cat === cat.id ? { ...p, cat: reassignTo } : p));
    }
    setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    setDeleting(null);
  };

  // Delete confirmation view
  if (deleting) {
    const count = countFor(deleting.id);
    const targets = real.filter((c) => c.id !== deleting.id);
    return (
      <Sheet onClose={() => setDeleting(null)} title="Eliminar categoría">
        <div className="cat-del">
          <div className="cat-del-head">
            <div className="cat-del-icon"><Icon name="alert-triangle" size={26} /></div>
            <div>
              <div className="cat-del-name">{deleting.label}</div>
              <div className="cat-del-count">
                {count === 0 ? 'Sin productos asignados' : `${count} producto${count === 1 ? '' : 's'} asignado${count === 1 ? '' : 's'}`}
              </div>
            </div>
          </div>

          {count > 0 ?
          targets.length === 0 ?
          <Banner tone="danger" icon="alert-triangle"
          message="No hay otra categoría a la que reasignar. Crea una categoría primero." /> :

          <>
                <Banner tone="warn" icon="repeat"
            message="Esta categoría tiene productos. Reasígnalos a otra categoría antes de eliminarla." />
                <label className="client-field" style={{ marginTop: 12 }}>
                  <span>Reasignar productos a</span>
                  <select className="input cat-select" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                    {targets.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
              </> :


          <Banner tone="info" icon="info" message="Esta categoría no tiene productos. Puedes eliminarla directamente." />
          }
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14 }}>
          <Button variant="secondary" onClick={() => setDeleting(null)}>Cancelar</Button>
          <Button variant="danger" icon="trash-2"
          disabled={count > 0 && (targets.length === 0 || !reassignTo)}
          onClick={confirmDelete}>
            {count > 0 ? 'Reasignar y eliminar' : 'Eliminar'}
          </Button>
        </div>
      </Sheet>);

  }

  return (
    <Sheet onClose={onClose} title="Categorías">
      <div className="cat-add-row">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)}
        placeholder="Nueva categoría"
        onKeyDown={(e) => {if (e.key === 'Enter') addCategory();}} />
        <Button icon="plus" onClick={addCategory} disabled={newName.trim().length < 2}>Crear</Button>
      </div>

      <div className="cat-list">
        {real.length === 0 ?
        <div className="empty" style={{ padding: '24px 16px' }}><p>Sin categorías. Crea la primera.</p></div> :
        real.map((cat) =>
        <div className="cat-item" key={cat.id}>
            {editingId === cat.id ?
          <>
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
            onKeyDown={(e) => {if (e.key === 'Enter') saveRename(cat);if (e.key === 'Escape') setEditingId(null);}} />
                <div className="cat-item-actions">
                  <IconButton icon="check" ariaLabel="Guardar" onClick={() => saveRename(cat)} />
                  <IconButton icon="x" ariaLabel="Cancelar" onClick={() => setEditingId(null)} />
                </div>
              </> :

          <>
                <div className="cat-item-info">
                  <div className="cat-item-name" style={{ textAlign: "left" }}>{cat.label}</div>
                  <div className="cat-item-count" style={{ textAlign: "left" }}>{countFor(cat.id)} producto{countFor(cat.id) === 1 ? '' : 's'}</div>
                </div>
                <div className="cat-item-actions">
                  <IconButton icon="edit-3" ariaLabel="Renombrar" onClick={() => {setEditingId(cat.id);setDraft(cat.label);}} />
                  <IconButton icon="trash-2" ariaLabel="Eliminar" onClick={() => startDelete(cat)} />
                </div>
              </>
          }
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        <Button variant="secondary" block onClick={onClose}>Cerrar</Button>
      </div>
    </Sheet>);

}

function ProductsScreen({ products, setProducts, categories, setCategories, online, onBack, initialStock, stockKey, bsRate }) {
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState('all');
  const [stockFilter, setStockFilter] = React.useState(initialStock || 'all');
  const [taxFilter, setTaxFilter] = React.useState('all');
  React.useEffect(() => {setStockFilter(initialStock || 'all');}, [stockKey]);
  const [sort, setSort] = React.useState('name-asc');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(12);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [confirmDelete, setConfirmDelete] = React.useState(null);
  const [catManagerOpen, setCatManagerOpen] = React.useState(false);

  // ---- Stats -------------------------------------------------------------
  const stats = React.useMemo(() => {
    const total = products.length;
    const totalUnits = products.reduce((s, p) => s + p.stock, 0);
    const inventoryValue = products.reduce((s, p) => s + p.stock * p.price, 0);
    const lowStock = products.filter((p) => p.stock > 0 && p.stock <= (p.minStock ?? 5)).length;
    const outOfStock = products.filter((p) => p.stock <= 0).length;
    return { total, totalUnits, inventoryValue, lowStock, outOfStock };
  }, [products]);

  // ---- Filter + sort -----------------------------------------------------
  const norm = (s) => (s || '').toLowerCase();
  const filtered = products.
  filter((p) => cat === 'all' || p.cat === cat).
  filter((p) => {
    if (stockFilter === 'in') return p.stock > (p.minStock ?? 5);
    if (stockFilter === 'low') return p.stock > 0 && p.stock <= (p.minStock ?? 5);
    if (stockFilter === 'out') return p.stock <= 0;
    if (stockFilter === 'paused') return p.sellable === false;
    return true;
  }).
  filter((p) => {
    if (taxFilter === 'exempt') return p.exempt === true;
    if (taxFilter === 'taxable') return p.exempt !== true;
    return true;
  }).
  filter((p) => {
    const term = norm(q);
    if (!term) return true;
    return norm(p.name).includes(term) || norm(p.sku).includes(term) || norm(p.barcode).includes(term);
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'name-asc':return a.name.localeCompare(b.name);
      case 'name-desc':return b.name.localeCompare(a.name);
      case 'price-asc':return a.price - b.price;
      case 'price-desc':return b.price - a.price;
      case 'stock-asc':return a.stock - b.stock;
      case 'stock-desc':return b.stock - a.stock;
      default:return 0;
    }
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  React.useEffect(() => {if (page !== safePage) setPage(safePage);}, [safePage, page]);
  const start = (safePage - 1) * pageSize;
  const visible = sorted.slice(start, start + pageSize);
  const showingFrom = sorted.length === 0 ? 0 : start + 1;
  const showingTo = Math.min(start + pageSize, sorted.length);

  // ---- Actions ------------------------------------------------------------
  const openNew = () => {setEditing(null);setEditorOpen(true);};
  const openEdit = (p) => {setDetail(null);setEditing(p);setEditorOpen(true);};

  const save = (form) => {
    if (editing) {
      setProducts((prev) => prev.map((p) => p.id === editing.id ? { ...p, ...form } : p));
    } else {
      const id = 'P-' + String(2000 + Math.floor(Math.random() * 8000));
      setProducts((prev) => [{ id, ...form }, ...prev]);
    }
    setEditorOpen(false);
    setEditing(null);
  };

  const adjustStock = (id, newStock) => {
    setProducts((prev) => prev.map((p) => p.id === id ? { ...p, stock: newStock } : p));
    setDetail((prev) => prev ? { ...prev, stock: newStock } : null);
  };

  const remove = (p) => {
    setProducts((prev) => prev.filter((x) => x.id !== p.id));
    setConfirmDelete(null);
    setDetail(null);
  };

  // ---- Render -------------------------------------------------------------
  return (
    <>
      <AppBar
        title="Productos"
        online={online}
        /* left={onBack && <IconButton icon="chevron-left" onClick={onBack} ariaLabel="Volver" />} */
        right={<>
          <Button size="sm" variant="secondary" icon="folder-cog" onClick={() => setCatManagerOpen(true)}>Categorías</Button>
          <Button size="sm" icon="plus" onClick={openNew}>Nuevo producto</Button>
        </>} />

      <div className="content prod-content">
        {/* Stats */}
        <div className="prod-stats">
          <div className="prod-stat">
            <span className="k">Productos</span>
            <span className="v tabular">{stats.total}</span>
            <span className="meta">{stats.totalUnits.toLocaleString()} unidades</span>
          </div>
          <div className="prod-stat">
            <span className="k">Valor de inventario</span>
            <span className="v tabular">${stats.inventoryValue.toFixed(2)}</span>
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
            onChange={(e) => {setQ(e.target.value);setPage(1);}} />

          <div className="catalog-filters prod-filters">
            <label className="catalog-filter">
              <span>Categoría</span>
              <select className="input cat-select" value={cat} onChange={(e) => {setCat(e.target.value);setPage(1);}}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="catalog-filter">
              <span>Stock</span>
              <select className="input cat-select" value={stockFilter} onChange={(e) => {setStockFilter(e.target.value);setPage(1);}}>
                {STOCK_LEVELS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label className="catalog-filter">
              <span>IVA</span>
              <select className="input cat-select" value={taxFilter} onChange={(e) => {setTaxFilter(e.target.value);setPage(1);}}>
                <option value="all">Todos</option>
                <option value="taxable">No exento</option>
                <option value="exempt">Exento</option>
              </select>
            </label>
            <label className="catalog-filter">
              <span>Ordenar por</span>
              <select className="input cat-select" value={sort} onChange={(e) => setSort(e.target.value)}>
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
        {sorted.length === 0 ?
        <div className="card empty" style={{ padding: '40px 20px' }}>
            <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--paper-2)', color: 'var(--ink-3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <Icon name="package" size={28} />
            </div>
            <h4>Sin productos</h4>
            <p>{q ? `Sin resultados para "${q}"` : 'Aún no hay productos que coincidan con los filtros.'}</p>
          </div> :

        <div className="prod-grid">
            {visible.map((p) =>
          <ProductCard key={p.id} product={p} onClick={setDetail} bsRate={bsRate} />
          )}
          </div>
        }

        {/* Pager */}
        {sorted.length > 0 &&
        <div className="pager pager-sticky">
            <div className="pager-info">
              {sorted.length <= pageSize ?
            <>{sorted.length} {sorted.length === 1 ? 'producto' : 'productos'}</> :

            <>Productos <strong>{showingFrom}–{showingTo}</strong> de <strong>{sorted.length}</strong></>
            }
            </div>
            <div className="pager-size">
              <label htmlFor="prod-pager-size">Por página</label>
              <select
              id="prod-pager-size"
              className="input cat-select pager-size-select"
              value={pageSize}
              onChange={(e) => {setPageSize(parseInt(e.target.value, 10));setPage(1);}}>
                <option value="6">6</option>
                <option value="12">12</option>
                <option value="24">24</option>
                <option value="48">48</option>
              </select>
            </div>
            <div className="pager-nav">
              <IconButton icon="chevrons-left" ariaLabel="Primera página" onClick={() => setPage(1)} disabled={safePage === 1} />
              <IconButton icon="chevron-left" ariaLabel="Anterior" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} />
              <div className="pager-current">Página {safePage} de {totalPages}</div>
              <IconButton icon="chevron-right" ariaLabel="Siguiente" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} />
              <IconButton icon="chevrons-right" ariaLabel="Última página" onClick={() => setPage(totalPages)} disabled={safePage === totalPages} />
            </div>
          </div>
        }
      </div>

      {detail &&
      <ProductDetailSheet
        product={detail}
        onClose={() => setDetail(null)}
        bsRate={bsRate}
        onEdit={openEdit}
        onAdjustStock={adjustStock}
        onDelete={(p) => setConfirmDelete(p)} />
      }

      {catManagerOpen &&
      <CategoriesSheet
        categories={categories}
        products={products}
        setCategories={setCategories}
        setProducts={setProducts}
        onClose={() => setCatManagerOpen(false)} />
      }

      {editorOpen &&
      <Sheet onClose={() => {setEditorOpen(false);setEditing(null);}} title={editing ? 'Editar producto' : 'Nuevo producto'}>
          <ProductForm
          initial={editing}
          categories={categories}
          onSave={save}
          onCancel={() => {setEditorOpen(false);setEditing(null);}} />
        </Sheet>
      }

      {confirmDelete &&
      <ConfirmDialog
        title="¿Eliminar producto?"
        message={`Se eliminará "${confirmDelete.name}" del catálogo. Esta acción no se puede deshacer.`}
        confirmLabel="Sí, eliminar"
        cancelLabel="Cancelar"
        tone="danger"
        onConfirm={() => remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)} />
      }
    </>);

}

window.ProductsScreen = ProductsScreen;