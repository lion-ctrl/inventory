// Sale screen — the core POS workhorse. Scanner + cart + cobrar.
// Responsive: mobile-first, tablet/desktop two-pane

const SCAN_STATES = {
  AIMING: 'aiming', // pointing camera, no code yet
  READING: 'reading', // detected code, processing
  LOCKED: 'locked' // code matched
};

function BarcodeViz({ code, locked }) {
  // Deterministic bar widths driven by the code so it always looks like a real
  // EAN-13. ~58 bars to fill the frame nicely.
  const seed = (code || '7591000000000').replace(/\D/g, '').padEnd(13, '0');
  const widths = ['thin', 'med', 'thin', 'thin', 'thick', 'thin', 'med', 'thin', 'thick', 'thin'];
  const bars = [];
  for (let i = 0; i < 58; i++) {
    const ch = seed.charCodeAt(i % seed.length);
    const isBar = ch % 3 !== 0;
    bars.push(isBar ? widths[ch % widths.length] : 'spacer');
  }
  const displayCode = code || '7 591000 000000';
  return (
    <div className="barcode-viz">
      <div className="bars">
        {bars.map((w, i) => <span key={i} className={`bar ${w}`} />)}
      </div>
      <div className="digits">{displayCode}</div>
    </div>);

}

function detectBarcodeFormat(code) {
  if (!code) return null;
  const digits = code.replace(/\D/g, '');
  if (digits.length === 13) return 'EAN-13';
  if (digits.length === 12) return 'UPC-A';
  if (digits.length === 8) return 'EAN-8';
  if (/[A-Z]/i.test(code)) return 'CODE 128';
  return 'CODE 128';
}

function ScannerView({ onScanResult, mode = 'scroll', density = 'roomy', demoControls = true, catalog = CATALOG }) {
  // mode: 'scroll' (mobile inline) | 'split' (desktop top-left)
  const [state, setState] = React.useState(SCAN_STATES.AIMING);
  const [fakeCode, setFakeCode] = React.useState(null);
  const [scanIdx, setScanIdx] = React.useState(0);

  const trigger = React.useCallback((forceMiss = false) => {
    const cycle = scanIdx % 5;
    setScanIdx((s) => s + 1);
    setState(SCAN_STATES.READING);
    const code = forceMiss ?
    '7' + Math.floor(1e12 + Math.random() * 8e12) :
    catalog[cycle].barcode;
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
  }, [scanIdx, onScanResult, catalog]);

  const aspect = mode === 'split' ? 'wide' : density === 'dense' ? 'wide' : '';
  const locked = state === SCAN_STATES.LOCKED;
  const reading = state === SCAN_STATES.READING;
  const detectedFormat = reading || locked ? detectBarcodeFormat(fakeCode) : null;

  return (
    <div className={`scanner-wrap ${aspect}`} style={{ margin: "0px 4px 0px 3px" }}>
      <div className="cam-bg" style={{ margin: "0px" }} />
      {detectedFormat &&
      <div className={`scan-format ${locked ? 'locked' : ''}`}>
          <span className="led" />
          {detectedFormat}
        </div>
      }
      <div className={`scan-frame ${locked ? 'locked' : ''}`}><i /></div>
      <BarcodeViz code={fakeCode} locked={locked} />
      {!locked && <div className="scan-beam" />}
      <div className={`scan-hint ${locked ? 'locked' : ''}`}>
        {state === SCAN_STATES.AIMING && 'Apunta la cámara al código de barras'}
        {reading && 'Leyendo código…'}
        {locked && '✓ Código leído'}
      </div>
      {demoControls &&
      <div className="scan-tools">
          <button onClick={() => trigger(false)}>
            <Icon name="scan-barcode" size={14} />Simular escaneo
          </button>
          <button className="ghost" onClick={() => trigger(true)}>
            <Icon name="x" size={14} />Forzar fallo
          </button>
        </div>
      }
    </div>);

}

function CartItem({ item, onInc, onDec, onRemove, onSetQty, bsRate }) {
  const MAX_QTY = 1000000;
  const stockCap = (typeof item.stock === 'number' && item.stock > 0) ? item.stock : MAX_QTY;
  const fmt = (n) => n.toLocaleString('es');
  const [draft, setDraft] = React.useState(fmt(item.qty));
  React.useEffect(() => {setDraft(fmt(item.qty));}, [item.qty]);
  return (
    <div className="cartrow">
      <div className="thumb">{item.glyph}</div>
      <div style={{ minWidth: 0 }}>
        <p className="pname">{item.name}</p>
        <div className="pmeta">{item.cat}</div>
        <div className="pmeta">${item.price.toFixed(2)} c/u{bsRate > 0 ? ` · Bs ${(item.price * bsRate).toFixed(2)}` : ''}</div>
        {item.qty >= stockCap && stockCap < MAX_QTY && <div className="pmeta qty-max">Máx. {stockCap} en stock</div>}
      </div>
      <div className="cart-right">
        <button className="delete" onClick={onRemove} aria-label="quitar">
          <Icon name="trash-2" size={16} />
        </button>
        <div className="price">${(item.price * item.qty).toFixed(2)}</div>
        {bsRate > 0 && <div className="price-bs">Bs {(item.price * item.qty * bsRate).toFixed(2)}</div>}
      </div>
      <div className="cart-qty-row">
        <div className="qty">
          <button onClick={onDec} aria-label="quitar uno">−</button>
          <input
            type="text"
            inputMode="numeric"
            className="qty-input"
            value={draft}
            onChange={(e) => {
              let n = parseInt(e.target.value.replace(/\D/g, ''), 10);
              if (isNaN(n)) {setDraft('');return;}
              if (n > stockCap) n = stockCap;
              setDraft(fmt(n));
              if (n >= 1 && onSetQty) onSetQty(n);
            }}
            onBlur={() => {
              let n = parseInt(draft.replace(/\D/g, ''), 10);
              if (!n || n < 1) {setDraft(fmt(item.qty));} else {
              n = Math.min(stockCap, n);
              if (onSetQty) onSetQty(n);
              }
            }}
            aria-label="cantidad" />
          <button onClick={() => { if (item.qty < stockCap) onInc(); }} disabled={item.qty >= stockCap} aria-label="agregar uno">+</button>
        </div>
      </div>
    </div>);

}

function ClientChip({ client, onClick, compact }) {
  const label = client ? client.name : 'Asociar cliente';
  return (
    <button
      className={`client-chip ${compact ? 'compact' : ''} ${client ? '' : 'empty'}`}
      onClick={onClick}
      title={client ? 'Ver cliente' : 'Asociar cliente a la venta'}>
      <Icon name={client ? 'user' : 'user-plus'} size={16} />
      <span className="client-chip-name">{label}</span>
    </button>);

}

function ClientInfoSheet({ client, onClose, onChange }) {
  if (!client) return null;
  const taxDisplay = client.taxId ?
  client.taxPrefix ? `${client.taxPrefix}-${client.taxId}` : client.taxId :
  null;
  const kindLabel = client.kind === 'business' ? 'Empresa / Negocio' : 'Persona natural';
  return (
    <Sheet onClose={onClose} title="Cliente de esta venta">
      <div className="client-info-card">
        <div className="client-info-head">
          <div className="client-info-avatar">{(client.name?.[0] || '?').toUpperCase()}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="client-info-name">{client.name}</div>
            <Chip tone={client.kind === 'business' ? 'info' : 'ok'} style={{ marginTop: 6 }}>{kindLabel}</Chip>
          </div>
        </div>
        <div className="client-info-rows">
          {taxDisplay &&
          <div className="client-info-row">
              <span className="k">Identificación</span>
              <span className="v mono">{taxDisplay}</span>
            </div>
          }
          {client.phone &&
          <div className="client-info-row">
              <span className="k">Teléfono</span>
              <span className="v">{client.phone}</span>
            </div>
          }
          {client.email &&
          <div className="client-info-row">
              <span className="k">Email</span>
              <span className="v">{client.email}</span>
            </div>
          }
          {client.address &&
          <div className="client-info-row">
              <span className="k">Dirección</span>
              <span className="v">{client.address}</span>
            </div>
          }
        </div>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        <Button icon="repeat" onClick={onChange}>Cambiar</Button>
      </div>
    </Sheet>);

}

function ProductFoundSheet({ product, onAdd, onCancel, onBack, currentCartQty = 0, bsRate }) {
  const maxAddable = Math.max(0, product.stock - currentCartQty);
  const [qty, setQty] = React.useState(Math.min(1, maxAddable) || 1);
  const fmt = (n) => n.toLocaleString('es');
  const [draft, setDraft] = React.useState(fmt(Math.min(1, maxAddable) || 1));
  React.useEffect(() => { setDraft(fmt(qty)); }, [qty]);
  const totalQty = currentCartQty + qty;
  const insufficientStock = totalQty > product.stock;
  const setQtyClamped = (n) => setQty(Math.max(1, Math.min(maxAddable || 1, n)));

  return (
    <Sheet onClose={onCancel}>
      {onBack &&
      <button className="sheet-back" onClick={onBack} aria-label="Volver a la búsqueda">
          <Icon name="chevron-left" size={18} />
          <span>Volver a la búsqueda</span>
        </button>
      }
      <div className="row" style={{ marginBottom: 12, gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flex: 'none' }}>{product.glyph}</div>
        <div style={{ minWidth: 0, flex: 1 }} className="found-product-info">
          <div className="found-product-name" style={{ textAlign: "left" }}>{product.name}</div>
          <div className="found-product-meta">
            <span className="mono">{product.sku}</span>
            <span className="mono">{product.barcode}</span>
          </div>
        </div>
        <div className="found-stock-chips">
          <Chip tone={product.stock > 5 ? 'ok' : product.stock > 2 ? 'warn' : 'danger'} style={{ flex: 'none' }}>{product.stock} en stock</Chip>
          {product.exempt === true && <Chip tone="info" style={{ flex: 'none' }}>Exento IVA</Chip>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '14px 0', borderTop: '1px dashed var(--line-strong)', borderBottom: '1px dashed var(--line-strong)', margin: '8px 0' }}>
        <div style={{ font: '500 12px var(--font-sans)', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Precio</div>
        <div className="spacer" />
        <div style={{ textAlign: 'right' }}>
          <div className="tabular" style={{ font: '700 28px var(--font-sans)', letterSpacing: '-0.01em' }}>${product.price.toFixed(2)}</div>
          {bsRate > 0 && <div className="tabular" style={{ font: '600 14px var(--font-sans)', color: 'var(--accent-2)' }}>Bs {(product.price * bsRate).toFixed(2)}</div>}
        </div>
      </div>

      <div className="row" style={{ gap: 16, marginTop: 12, marginBottom: 14, justifyContent: 'space-between' }}>
        <div style={{ font: '600 14px var(--font-sans)' }}>Cantidad</div>
        <div className="qty">
          <button onClick={() => setQtyClamped(qty - 1)} aria-label="quitar uno">−</button>
          <input
            type="text"
            inputMode="numeric"
            className="qty-input"
            value={draft}
            onChange={(e) => {
              let n = parseInt(e.target.value.replace(/\D/g, ''), 10);
              if (isNaN(n)) { setDraft(''); return; }
              const cap = maxAddable || 1;
              if (n > cap) n = cap;
              setDraft(fmt(n));
              if (n >= 1) setQty(n);
            }}
            onBlur={() => {
              const n = parseInt(draft.replace(/\D/g, ''), 10);
              if (!n || n < 1) { setDraft(fmt(qty)); }
              else { const v = Math.min(maxAddable || 1, n); setQty(v); setDraft(fmt(v)); }
            }}
            aria-label="cantidad" />
          <button onClick={() => setQtyClamped(qty + 1)} disabled={qty >= maxAddable} aria-label="agregar uno">+</button>
        </div>
      </div>

      {(insufficientStock || qty >= maxAddable) &&
      <Banner tone="warn" icon="alert-triangle" title="Stock limitado"
      message={currentCartQty > 0
        ? `Solo puedes agregar ${maxAddable} más (ya tienes ${currentCartQty} en el carrito de ${product.stock} disponibles).`
        : `Solo quedan ${product.stock} unidades disponibles.`} />
      }

      <div className="row" style={{ gap: 10, marginTop: 12 }}>
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onAdd(product, qty)} disabled={insufficientStock || maxAddable < 1}>Agregar al carrito</Button>
      </div>
    </Sheet>);

}

function ProductNotFoundSheet({ code, onRetry, onSearch, onClose }) {
  return (
    <Sheet onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '8px 4px 4px' }}>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
          <Icon name="search-x" size={28} />
        </div>
        <h3 style={{ margin: '4px 0 4px', font: '700 18px var(--font-sans)' }}>Producto no encontrado</h3>
        <div className="mono" style={{ fontSize: 13, color: 'var(--ink-3)' }}>Código: {code}</div>
        <p style={{ font: '400 14px var(--font-sans)', color: 'var(--ink-2)', marginTop: 10 }}>
          Búscalo manualmente o escanea de nuevo.
        </p>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 12 }}>
        <Button variant="secondary" onClick={onSearch}>Buscar manual</Button>
        <Button onClick={onRetry}>Escanear de nuevo</Button>
      </div>
    </Sheet>);

}

function ManualSearchSheet({ onPick, onClose, catalog = CATALOG }) {
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState('all');
  const [sort, setSort] = React.useState('name-asc');

  const byCat = cat === 'all' ? catalog : catalog.filter((p) => p.cat === cat);
  const filtered = q.trim() ?
  byCat.filter((p) =>
  p.name.toLowerCase().includes(q.toLowerCase()) ||
  p.sku.toLowerCase().includes(q.toLowerCase()) ||
  p.barcode.includes(q)) :
  byCat;

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'name-asc':return a.name.localeCompare(b.name);
      case 'name-desc':return b.name.localeCompare(a.name);
      case 'price-asc':return a.price - b.price;
      case 'price-desc':return b.price - a.price;
      default:return 0;
    }
  });

  const results = q.trim() ? sorted : sorted.slice(0, 12);

  return (
    <Sheet onClose={onClose} title="Buscar producto">
      <Input
        autoFocus
        placeholder="Nombre, SKU o código de barras"
        value={q}
        onChange={(e) => setQ(e.target.value)} />
      
      <div className="search-filters">
        <div className="search-filter">
          <label>Categoría</label>
          <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
            {CATEGORIES.map((c) =>
            <option key={c.id} value={c.id}>{c.label}</option>
            )}
          </select>
        </div>
        <div className="search-filter">
          <label>Ordenar por</label>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name-asc">Nombre (A–Z)</option>
            <option value="name-desc">Nombre (Z–A)</option>
            <option value="price-asc">Precio (menor a mayor)</option>
            <option value="price-desc">Precio (mayor a menor)</option>
          </select>
        </div>
      </div>
      <div className="search-results" style={{ marginTop: 12 }}>
        {results.length === 0 ?
        <div className="empty"><p>Sin resultados{q ? ` para “${q}”` : ''}</p></div> :
        results.map((p) =>
        <div className="lrow" key={p.id} onClick={() => onPick(p)} style={{ cursor: 'pointer' }}>
            <div className="thumb">{p.glyph}</div>
            <div>
              <p className="pname" style={{ textAlign: "left" }}>{p.name}</p>
              <div className="pmeta search-pmeta">
                <span>{p.cat}</span>
                <span className="mono">{p.sku}</span>
                <span className="mono">{p.barcode}</span>
              </div>
            </div>
            <div className="pright">
              <div>${p.price.toFixed(2)}</div>
              {p.stock > 0 && p.stock <= (p.minStock ?? 5) && <div className="search-stock-max">Máx. {p.stock} en stock</div>}
              {p.stock <= 0 && <div className="search-stock-out">Agotado</div>}
            </div>
          </div>
        )}
      </div>
    </Sheet>);

}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancelar', tone = 'primary', onConfirm, onCancel }) {
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

function CartContent({ cart, inc, dec, remove, setQty, density, salesType, onConfirm, onCancel, pendingSplits, selectedClient, onPickClient, itemCount, onClear, onPause, bsRate }) {
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const taxableBase = cart.reduce((s, i) => s + (i.exempt === true ? 0 : i.price * i.qty), 0);
  const tax = salesType === 'invoice' ? taxableBase * 0.13 : 0;
  const total = subtotal + tax;
  const paidSoFar = (pendingSplits || []).reduce((s, r) => s + (window.splitUsd ? window.splitUsd(r, bsRate) : parseFloat(r.amount) || 0), 0);
  const remaining = Math.max(0, total - paidSoFar);
  const showRemaining = paidSoFar > 0 && paidSoFar < total - 0.005;

  const header =
  <div className="cart-card-head">
      <div className="cart-card-head-top">
        <div className="cart-head-title">Carrito</div>
        <Chip tone="neutral">{itemCount}</Chip>
      </div>
      {cart.length > 0 &&
    <div className="cart-card-head-actions">
          {onPause && <Button variant="secondary" size="sm" icon="pause" onClick={onPause}>Pausar</Button>}
          <Button variant="danger" size="sm" icon="trash-2" onClick={onClear}>Limpiar</Button>
        </div>
    }
    </div>;


  if (cart.length === 0) {
    return (
      <div className="card">
        {header}
        <div className="empty" style={{ padding: '36px 20px' }}>
          <img src="ds/empty-cart.svg" alt="" />
          <h4>Carrito vacío</h4>
          <p>Escanea un producto para empezar</p>
        </div>
      </div>);
  }

  return (
    <div className="card">
      {header}
      {cart.map((i) =>
      <CartItem key={i.id} item={i}
      onInc={() => inc(i.id)}
      onDec={() => dec(i.id)}
      onRemove={() => remove(i.id)}
      onSetQty={setQty ? (n) => setQty(i.id, n) : null} bsRate={bsRate} />
      )}
      <div className="totals">
        <div className="line"><span>Subtotal</span><span className="tabular">${subtotal.toFixed(2)}</span></div>
        {salesType === 'invoice' && (subtotal - taxableBase) > 0.005 &&
        <div className="line"><span>Exento (E)</span><span className="tabular">${(subtotal - taxableBase).toFixed(2)}</span></div>
        }
        {salesType === 'invoice' &&
        <div className="line"><span>IVA (13%)</span><span className="tabular">${tax.toFixed(2)}</span></div>
        }
        <div className="line total"><span>Total</span><span>${total.toFixed(2)}</span></div>
        {bsRate > 0 &&
        <div className="line total-bs"><span>Total en Bs</span><span className="tabular">Bs {(total * bsRate).toFixed(2)}</span></div>
        }
        {showRemaining &&
        <div className="cart-paid">
            <span>Pagado</span>
            <span className="cart-remaining-amts">
              <span className="tabular">${paidSoFar.toFixed(2)}</span>
              {bsRate > 0 && <span className="tabular">Bs {(paidSoFar * bsRate).toFixed(2)}</span>}
            </span>
          </div>
        }
        {showRemaining &&
        <div className="cart-remaining">
            <span>Falta por cobrar</span>
            <span className="cart-remaining-amts">
              <span className="tabular">${remaining.toFixed(2)}</span>
              {bsRate > 0 && <span className="tabular">Bs {(remaining * bsRate).toFixed(2)}</span>}
            </span>
          </div>
        }
      </div>
      <div className="cart-actions">
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => {
          if (!selectedClient) {onPickClient && onPickClient();return;}
          onConfirm(cart, total, salesType);
        }}>
          <span className="btn-stack">
            <span>{!selectedClient ? 'Elegir cliente' : showRemaining ? 'Continuar pago' : 'Cobrar'}</span>
            {selectedClient &&
            <span className="btn-amount">${(showRemaining ? remaining : total).toFixed(2)}</span>
            }
          </span>
        </Button>
      </div>
    </div>);

}

function ClientGate({ clients, online, onClientFound, onCreateClient, tweaks }) {
  const [prefix, setPrefix] = React.useState('V');
  const [taxId, setTaxId] = React.useState('');
  const [error, setError] = React.useState(null);
  const [showCreatePrompt, setShowCreatePrompt] = React.useState(false);

  const search = (e) => {
    if (e) e.preventDefault();
    const term = taxId.trim();
    if (!term) {
      setError('Ingresa la identificación del cliente.');
      return;
    }
    const found = clients.find((c) =>
    c.taxPrefix === prefix && (c.taxId || '').toLowerCase() === term.toLowerCase()
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
    <div className="content client-gate-content" style={{ padding: "5px" }}>
      {!online && <Banner tone="warn" icon="wifi-off" title="Sin conexión" message="No se pueden registrar ventas hasta reconectar." />}
      <div className="client-gate">
        <div className="client-gate-head">
          <div className="client-gate-icon"><Icon name="user-check" size={28} /></div>
          <h2 className="client-gate-title">Identificar al cliente</h2>
          <p className="client-gate-sub">
            Toda venta debe registrarse con un cliente. Ingresa la cédula (V) o RIF (J).
          </p>
        </div>

        <form className="client-gate-form" onSubmit={search}>
          <label className="client-field">
            <span>Identificación fiscal<span className="req"> *</span></span>
            <div className="taxid-row">
              <select
                className="input cat-select taxid-prefix"
                value={prefix}
                onChange={(e) => {
                  const next = e.target.value;
                  setPrefix(next);
                  setTaxId((t) => typeof formatTaxId === 'function' ? formatTaxId(next, t) : t);
                  setError(null);setShowCreatePrompt(false);
                }}
                aria-label="Tipo de identificación" style={{ height: "48px", textAlign: "left", padding: "0px 28px 0px 12px" }}>
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
                  const v = typeof formatTaxId === 'function' ? formatTaxId(prefix, e.target.value) : e.target.value;
                  setTaxId(v);
                  setError(null);setShowCreatePrompt(false);
                }}
                placeholder={prefix === 'J' ? '12345678-9' : '12.345.678'} />
            </div>
          </label>

          {error && <Banner tone="danger" icon="x" message={error} />}

          {showCreatePrompt &&
          <Banner
            tone="warn"
            icon="user-x"
            title="Cliente no encontrado"
            message={`No hay ningún cliente registrado con ${prefix}-${taxId}. ¿Quieres crearlo?`} />
          }

          <div className="row" style={{ gap: 10 }}>
            {showCreatePrompt ?
            <>
                <Button variant="secondary" type="button" onClick={() => setShowCreatePrompt(false)}>Reintentar</Button>
                <Button type="button" icon="user-plus" onClick={() => onCreateClient({ prefix, taxId })}>
                  Crear cliente
                </Button>
              </> :

            <Button type="submit" icon="search" block>Buscar cliente</Button>
            }
          </div>
        </form>
      </div>
    </div>);

}

function SaleScreen({ onBack, onConfirm, online, tweaks, isWide, bsRate, pendingSplits, onResetPayment, clients, selectedClient, onSelectClient, onCreateClient, cart, setCart, storedCartsCount, reserved = {}, products, onPauseSale, onViewStored }) {
  const catalog = React.useMemo(
    () => (products || CATALOG).map((p) => ({ ...p, stock: Math.max(0, p.stock - (reserved[p.id] || 0)) })).filter((p) => p.sellable !== false),
    [reserved, products]);
  const [foundProduct, setFoundProduct] = React.useState(null);
  const [foundFromSearch, setFoundFromSearch] = React.useState(false);
  const [notFoundCode, setNotFoundCode] = React.useState(null);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [insufficientStockProduct, setInsufficientStockProduct] = React.useState(null);
  const [activeCat, setActiveCat] = React.useState('all');
  const [catalogSort, setCatalogSort] = React.useState('name-asc');
  const [catalogQuery, setCatalogQuery] = React.useState('');
  const [clientPickerOpen, setClientPickerOpen] = React.useState(false);
  const [clientFormOpen, setClientFormOpen] = React.useState(false);
  const [clientInfoOpen, setClientInfoOpen] = React.useState(false);
  const [prefillCreate, setPrefillCreate] = React.useState(null);

  const density = tweaks.density; // 'roomy' | 'dense'
  const salesType = tweaks.salesType; // 'ticket' | 'invoice'

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const taxableBase = cart.reduce((s, i) => s + (i.exempt === true ? 0 : i.price * i.qty), 0);
  const tax = salesType === 'invoice' ? taxableBase * 0.13 : 0;
  const total = subtotal + tax;
  const itemCount = cart.reduce((s, i) => s + i.qty, 0);

  const handleScanResult = ({ found, product, code }) => {
    if (found) {
      const inCart = cart.find((i) => i.id === product.id)?.qty || 0;
      if (inCart >= product.stock) {
        setInsufficientStockProduct(product);
      } else {
        setFoundProduct(product);
      }
    } else {
      setNotFoundCode(code);
    }
  };

  const addToCart = (product, qty) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) return prev.map((i) => i.id === product.id ? { ...i, qty: i.qty + qty } : i);
      return [...prev, { ...product, qty }];
    });
    setFoundProduct(null);
    setSearchOpen(false);
  };

  const inc = (id) => setCart((c) => c.map((i) => i.id === id ? { ...i, qty: Math.min(1000000, i.qty + 1) } : i));
  const dec = (id) => setCart((c) => c.map((i) => i.id === id ? { ...i, qty: Math.max(1, i.qty - 1) } : i));
  const setQty = (id, n) => setCart((c) => c.map((i) => i.id === id ? { ...i, qty: Math.max(1, n) } : i));
  const remove = (id) => setCart((c) => c.filter((i) => i.id !== id));

  const tryClose = () => {
    if (cart.length > 0) setConfirmCancel(true);else
    onBack();
  };

  const filteredCatalog = (activeCat === 'all' ? catalog : catalog.filter((p) => p.cat === activeCat)).
  filter((p) => {
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) ||
    p.sku.toLowerCase().includes(q) ||
    p.barcode.includes(q);
  }).
  slice().
  sort((a, b) => {
    switch (catalogSort) {
      case 'name-asc':return a.name.localeCompare(b.name);
      case 'name-desc':return b.name.localeCompare(a.name);
      case 'price-asc':return a.price - b.price;
      case 'price-desc':return b.price - a.price;
      default:return 0;
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
            /* left={<IconButton icon="chevron-left" onClick={tryClose} ariaLabel="Volver" />} */ />
          <ClientGate
            clients={clients}
            online={online}
            tweaks={tweaks}
            onClientFound={(c) => onSelectClient(c.id)}
            onCreateClient={(prefill) => {setPrefillCreate(prefill);setClientFormOpen(true);}} />
          {clientFormOpen &&
          <Sheet onClose={() => {setClientFormOpen(false);setPrefillCreate(null);}} title="Nuevo cliente">
              <ClientForm
              initial={prefillCreate ? { taxPrefix: prefillCreate.prefix, taxId: prefillCreate.taxId } : null}
              onSave={(form) => {onCreateClient(form);setClientFormOpen(false);setPrefillCreate(null);}}
              onCancel={() => {setClientFormOpen(false);setPrefillCreate(null);}} />
            </Sheet>
          }
        </>);

    }
    return (
      <>
        <AppBar
          title="Nueva venta"
          online={online}
          /* left={<IconButton icon="chevron-left" onClick={tryClose} ariaLabel="Volver" />} */
          right={
          <ClientChip client={selectedClient} onClick={() => setClientInfoOpen(true)} />
          } />

        <div className={`pos-layout ${density === 'dense' ? 'dense' : ''}`} style={{ padding: "5px" }}>
          <div className="pos-main" style={{ padding: "0px" }}>
            <div className="pos-main-scroll">
              {!online && <Banner tone="warn" icon="wifi-off" title="Sin conexión" message="Las ventas se sincronizarán al reconectarse a ERPNext." />}
              <div className="pos-scanner-sticky" style={{ margin: "0px" }}>
                <ScannerView onScanResult={handleScanResult} mode="split" density={density} demoControls={tweaks.demoControls} catalog={catalog} />
              </div>

            <div className="catalog-head" style={{ margin: "14px 4px 14px" }}>
              <h2 className="catalog-title" style={{ margin: "0px" }}>Buscar producto</h2>
              <Input
                  placeholder="Nombre, SKU o código de barras"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)} />
                
              <div className="catalog-filters">
                <label className="catalog-filter">
                  <span>Categoría</span>
                  <select className="input cat-select" value={activeCat} onChange={(e) => setActiveCat(e.target.value)}>
                    {CATEGORIES.map((c) =>
                      <option key={c.id} value={c.id}>{c.label}</option>
                      )}
                  </select>
                </label>
                <label className="catalog-filter">
                  <span>Ordenar por</span>
                  <select className="input cat-select" value={catalogSort} onChange={(e) => setCatalogSort(e.target.value)}>
                    <option value="name-asc">Nombre (A–Z)</option>
                    <option value="name-desc">Nombre (Z–A)</option>
                    <option value="price-asc">Precio (menor a mayor)</option>
                    <option value="price-desc">Precio (mayor a menor)</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="quick-grid" style={{ margin: "0px 4px" }}>
              {filteredCatalog.map((p) =>
                <button className="quick-tile" key={p.id} onClick={() => setFoundProduct(p)}>
                  <div className="glyph">{p.glyph}</div>
                  <div className="name">{p.name}</div>
                  <div className="meta">{p.sku}</div>
                  <div className="price">${p.price.toFixed(2)}</div>
                  {bsRate > 0 && <div className="price-bs">Bs {(p.price * bsRate).toFixed(2)}</div>}
                  {p.stock > 0 && p.stock <= (p.minStock ?? 5) && <div className="quick-stock-max">Máx. {p.stock} en stock</div>}
                  {p.stock <= 0 && <div className="quick-stock-out">Agotado</div>}
                </button>
                )}
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
                {cart.length > 0 &&
                <div className="cart-card-head-actions">
                    {onPauseSale && <Button variant="secondary" size="sm" icon="pause" onClick={() => onPauseSale()}>Pausar</Button>}
                    <Button variant="danger" size="sm" icon="trash-2" onClick={() => setConfirmClear(true)}>Limpiar</Button>
                  </div>
                }
              </div>
              <div className="cart-scroll">
                {cart.length === 0 ?
                <div className="empty" style={{ padding: '36px 20px' }}>
                    <img src="ds/empty-cart.svg" alt="" style={{ width: 140 }} />
                    <h4>Carrito vacío</h4>
                    <p>Escanea o toca un producto del catálogo</p>
                  </div> :
                <>
                  {cart.map((i) =>
                  <CartItem key={i.id} item={i}
                  onInc={() => inc(i.id)}
                  onDec={() => dec(i.id)}
                  onRemove={() => remove(i.id)}
                  onSetQty={(n) => setQty(i.id, n)} bsRate={bsRate} />
                  )}
                  {(() => {
                    const paidSoFar = (pendingSplits || []).reduce((s, r) => s + (window.splitUsd ? window.splitUsd(r, bsRate) : parseFloat(r.amount) || 0), 0);
                    const remaining = Math.max(0, total - paidSoFar);
                    const showRemaining = paidSoFar > 0 && paidSoFar < total - 0.005;
                    return (
                      <>
                        <div className="totals">
                          <div className="line"><span>Subtotal</span><span className="tabular">${subtotal.toFixed(2)}</span></div>
                          {salesType === 'invoice' && (subtotal - taxableBase) > 0.005 &&
                          <div className="line"><span>Exento (E)</span><span className="tabular">${(subtotal - taxableBase).toFixed(2)}</span></div>
                          }
                          {salesType === 'invoice' &&
                          <div className="line"><span>IVA (13%)</span><span className="tabular">${tax.toFixed(2)}</span></div>
                          }
                          <div className="line total"><span>Total</span><span>${total.toFixed(2)}</span></div>
                          {bsRate > 0 &&
                          <div className="line total-bs"><span>Total en Bs</span><span className="tabular">Bs {(total * bsRate).toFixed(2)}</span></div>
                          }
                          {showRemaining &&
                          <div className="cart-paid" style={{ padding: "10px" }}>
                              <span>Pagado</span>
                              <span className="cart-remaining-amts">
                                <span className="tabular">${paidSoFar.toFixed(2)}</span>
                                {bsRate > 0 && <span className="tabular">Bs {(paidSoFar * bsRate).toFixed(2)}</span>}
                              </span>
                            </div>
                          }
                          {showRemaining &&
                          <div className="cart-remaining" style={{ padding: "10px" }}>
                              <span>Falta por cobrar</span>
                              <span className="cart-remaining-amts">
                                <span className="tabular">${remaining.toFixed(2)}</span>
                                {bsRate > 0 && <span className="tabular">Bs {(remaining * bsRate).toFixed(2)}</span>}
                              </span>
                            </div>
                          }
                        </div>
                        <div className="cart-actions">
                          <Button variant="secondary" onClick={tryClose}>Cancelar</Button>
                          <Button onClick={() => {
                            if (!selectedClient) {setClientPickerOpen(true);return;}
                            onConfirm(cart, total, salesType);
                          }}>
                            <span className="btn-stack">
                              <span>{!selectedClient ? 'Elegir cliente' : showRemaining ? 'Continuar pago' : 'Cobrar'}</span>
                              {selectedClient &&
                              <span className="btn-amount">${(showRemaining ? remaining : total).toFixed(2)}</span>
                              }
                            </span>
                          </Button>
                        </div>
                      </>);

                  })()}
                </>
                }
              </div>
              {cart.length === 0 &&
              <div className="cart-foot">
                <BottomBar>
                  <Button variant="secondary" onClick={onBack}>Cerrar</Button>
                  <Button disabled>Cobrar $0.00</Button>
                </BottomBar>
              </div>
              }
            </div>
          </div>
        </div>

        {foundProduct &&
        <ProductFoundSheet product={foundProduct}
        bsRate={bsRate}
        currentCartQty={cart.find((i) => i.id === foundProduct.id)?.qty || 0}
        onAdd={(prod, qty) => {addToCart(prod, qty);setFoundFromSearch(false);}}
        onCancel={() => {setFoundProduct(null);setFoundFromSearch(false);}}
        onBack={foundFromSearch ? () => {setFoundProduct(null);setFoundFromSearch(false);setSearchOpen(true);} : null} />
        }
        {notFoundCode &&
        <ProductNotFoundSheet code={notFoundCode}
        onRetry={() => setNotFoundCode(null)}
        onSearch={() => {setNotFoundCode(null);setSearchOpen(true);}}
        onClose={() => setNotFoundCode(null)} />
        }
        {searchOpen &&
        <ManualSearchSheet catalog={catalog} onPick={(p) => {setSearchOpen(false);setFoundFromSearch(true);setFoundProduct(p);}} onClose={() => setSearchOpen(false)} />
        }
        {confirmClear &&
        <ConfirmDialog
          title="¿Vaciar el carrito?"
          message="Se eliminarán todos los productos y los pagos parciales registrados."
          confirmLabel="Sí, vaciar"
          tone="danger"
          onConfirm={() => {setConfirmClear(false);setCart([]);onResetPayment && onResetPayment();}}
          onCancel={() => setConfirmClear(false)} />
        }

        {confirmCancel &&
        <ConfirmDialog
          title="¿Cancelar la venta?"
          message="Se perderán los productos del carrito."
          confirmLabel="Sí"
          cancelLabel="No"
          tone="danger"
          onConfirm={() => {setConfirmCancel(false);setCart([]);onResetPayment && onResetPayment();onBack();}}
          onCancel={() => setConfirmCancel(false)} />
        }
        {insufficientStockProduct &&
        <ConfirmDialog
          title="Stock insuficiente"
          message={`Ya tienes ${insufficientStockProduct.stock} ${insufficientStockProduct.name} en el carrito. No hay más unidades disponibles.`}
          confirmLabel="Entendido"
          cancelLabel="Cerrar"
          onConfirm={() => setInsufficientStockProduct(null)}
          onCancel={() => setInsufficientStockProduct(null)} />
        }
        {clientPickerOpen &&
        <ClientPickerSheet
          clients={clients}
          currentId={selectedClient?.id}
          onPick={(c) => {onSelectClient(c.id);setClientPickerOpen(false);}}
          onCreate={() => {setClientPickerOpen(false);setClientFormOpen(true);}}
          onClose={() => setClientPickerOpen(false)} />
        }
        {clientInfoOpen && selectedClient &&
        <ClientInfoSheet
          client={selectedClient}
          onClose={() => setClientInfoOpen(false)}
          onChange={() => {setClientInfoOpen(false);setClientPickerOpen(true);}} />
        }
        {clientFormOpen &&
        <Sheet onClose={() => {setClientFormOpen(false);setPrefillCreate(null);}} title="Nuevo cliente">
            <ClientForm
            initial={prefillCreate ? { taxPrefix: prefillCreate.prefix, taxId: prefillCreate.taxId } : null}
            onSave={(form) => {onCreateClient(form);setClientFormOpen(false);setPrefillCreate(null);}}
            onCancel={() => {setClientFormOpen(false);setPrefillCreate(null);}} />
          </Sheet>
        }
      </>);

  }

  // ============ MOBILE LAYOUT ============
  if (!selectedClient) {
    return (
      <>
        <AppBar
          title="Nueva venta"
          online={online}
          /* left={<IconButton icon="chevron-left" onClick={tryClose} ariaLabel="Volver" />} */ />
        <ClientGate
          clients={clients}
          online={online}
          tweaks={tweaks}
          onClientFound={(c) => onSelectClient(c.id)}
          onCreateClient={(prefill) => {setPrefillCreate(prefill);setClientFormOpen(true);}} />
        {clientFormOpen &&
        <Sheet onClose={() => {setClientFormOpen(false);setPrefillCreate(null);}} title="Nuevo cliente">
            <ClientForm
            initial={prefillCreate ? { taxPrefix: prefillCreate.prefix, taxId: prefillCreate.taxId } : null}
            onSave={(form) => {onCreateClient(form);setClientFormOpen(false);setPrefillCreate(null);}}
            onCancel={() => {setClientFormOpen(false);setPrefillCreate(null);}} />
          </Sheet>
        }
      </>);

  }
  return (
    <>
      <AppBar
        title="Nueva venta"
        online={online}
        /* left={<IconButton icon="chevron-left" onClick={tryClose} ariaLabel="Volver" />} */
        right={
        <ClientChip client={selectedClient} onClick={() => setClientInfoOpen(true)} compact />
        } />
      
      <div className={`content content-pos ${density === 'dense' ? 'dense' : ''}`}>
        <div className="pos-mobile-scroll" style={{ padding: "0px" }}>
          {!online && <Banner tone="warn" icon="wifi-off" title="Sin conexión" message="Las ventas se sincronizarán al reconectarse." />}
          <div className="pos-scanner-sticky">
            <ScannerView onScanResult={handleScanResult} mode="scroll" density={density} demoControls={tweaks.demoControls} catalog={catalog} />
          </div>

          <Button variant="secondary" icon="search" onClick={() => setSearchOpen(true)} style={{ marginTop: 10 }} block>
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
            bsRate={bsRate}
            pendingSplits={pendingSplits}
            selectedClient={selectedClient}
            onPickClient={() => setClientPickerOpen(true)}
            itemCount={itemCount}
            onClear={() => setConfirmClear(true)}
            onPause={onPauseSale ? () => onPauseSale() : null}
            onCancel={tryClose}
            onConfirm={onConfirm} />
        </div>
      </div>

      {foundProduct &&
      <ProductFoundSheet product={foundProduct}
      bsRate={bsRate}
      currentCartQty={cart.find((i) => i.id === foundProduct.id)?.qty || 0}
      onAdd={(prod, qty) => {addToCart(prod, qty);setFoundFromSearch(false);}}
      onCancel={() => {setFoundProduct(null);setFoundFromSearch(false);}}
      onBack={foundFromSearch ? () => {setFoundProduct(null);setFoundFromSearch(false);setSearchOpen(true);} : null} />
      }
      {notFoundCode &&
      <ProductNotFoundSheet code={notFoundCode}
      onRetry={() => setNotFoundCode(null)}
      onSearch={() => {setNotFoundCode(null);setSearchOpen(true);}}
      onClose={() => setNotFoundCode(null)} />
      }
      {searchOpen &&
      <ManualSearchSheet catalog={catalog} onPick={(p) => {setSearchOpen(false);setFoundFromSearch(true);setFoundProduct(p);}} onClose={() => setSearchOpen(false)} />
      }
      {confirmClear &&
      <ConfirmDialog
        title="¿Vaciar el carrito?"
        message="Se eliminarán todos los productos y los pagos parciales registrados."
        confirmLabel="Sí, vaciar"
        tone="danger"
        onConfirm={() => {setConfirmClear(false);setCart([]);onResetPayment && onResetPayment();}}
        onCancel={() => setConfirmClear(false)} />
      }

      {confirmCancel &&
      <ConfirmDialog
        title="¿Cancelar la venta?"
        message="Se perderán los productos del carrito."
        confirmLabel="Sí"
        cancelLabel="No"
        tone="danger"
        onConfirm={() => {setConfirmCancel(false);setCart([]);onResetPayment && onResetPayment();onBack();}}
        onCancel={() => setConfirmCancel(false)} />
      }
      {insufficientStockProduct &&
      <ConfirmDialog
        title="Stock insuficiente"
        message={`Ya tienes el máximo de ${insufficientStockProduct.name} disponibles en el carrito.`}
        confirmLabel="Entendido"
        cancelLabel="Cerrar"
        onConfirm={() => setInsufficientStockProduct(null)}
        onCancel={() => setInsufficientStockProduct(null)} />
      }
      {clientPickerOpen &&
      <ClientPickerSheet
        clients={clients}
        currentId={selectedClient?.id}
        onPick={(c) => {onSelectClient(c.id);setClientPickerOpen(false);}}
        onCreate={() => {setClientPickerOpen(false);setClientFormOpen(true);}}
        onClose={() => setClientPickerOpen(false)} />
      }
      {clientInfoOpen && selectedClient &&
      <ClientInfoSheet
        client={selectedClient}
        onClose={() => setClientInfoOpen(false)}
        onChange={() => {setClientInfoOpen(false);setClientPickerOpen(true);}} />
      }
      {clientFormOpen &&
      <Sheet onClose={() => setClientFormOpen(false)} title="Nuevo cliente">
          <ClientForm
          onSave={(form) => {onCreateClient(form);setClientFormOpen(false);}}
          onCancel={() => setClientFormOpen(false)} />
        </Sheet>
      }
    </>);

}

window.SaleScreen = SaleScreen;
window.ScannerView = ScannerView;
window.ManualSearchSheet = ManualSearchSheet;
window.detectBarcodeFormat = detectBarcodeFormat;
window.ConfirmDialog = ConfirmDialog;