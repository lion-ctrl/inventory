// ScanScreen — consultar producto por código de barras o catálogo (solo información).
// Réplica del panel izquierdo de la pantalla de Venta, sin carrito ni cobro.
import { useCallback, useMemo, useState } from 'react';
import { AppBar, Banner, Button, Chip, Icon, Input, Sheet } from '@/components';
import { useOnline } from '@/state/useOnline';
import { useBsRate, useCategories, useProducts, useSettingsDoc } from '@/state/hooks';
import type { Product } from '@/types';
import { ScannerView } from './Sale';
import type { ScanResult } from './Sale';

function ProductInfoSheet({ product, onClose, bsRate, catLabel, ivaPct }: {
  product: Product;
  onClose: () => void;
  bsRate: number;
  catLabel: string;
  ivaPct: number;
}) {
  const p = product;
  const stockTone = p.stock > 5 ? 'ok' : p.stock > 2 ? 'warn' : 'danger';
  return (
    <Sheet onClose={onClose} title="Información del producto">
      <div className="scan-card scan-card-insheet">
        <div className="scan-card-head">
          <div className="scan-card-glyph">{p.glyph}</div>
          <div className="scan-card-id">
            <div className="scan-card-name">{p.name}</div>
            <div className="scan-card-cat">{catLabel}</div>
          </div>
        </div>

        <div className="scan-card-chips">
          {p.sellable === false && <Chip tone="neutral">Pausado</Chip>}
          <Chip tone={stockTone}>{p.stock} en stock</Chip>
          {p.exempt === true && <Chip tone="info">Exento IVA</Chip>}
        </div>

        <div className="scan-card-price">
          <span className="scan-card-price-k">Precio</span>
          <div className="scan-card-price-v">
            <div className="tabular scan-card-usd">${p.price.toFixed(2)}</div>
            {bsRate > 0 && <div className="tabular scan-card-bs">Bs {(p.price * bsRate).toFixed(2)}</div>}
          </div>
        </div>

        <dl className="scan-card-meta">
          <div><dt>SKU</dt><dd className="mono">{p.sku}</dd></div>
          <div><dt>Código de barras</dt><dd className="mono">{p.barcode}</dd></div>
          <div><dt>Categoría</dt><dd>{catLabel}</dd></div>
          <div><dt>IVA</dt><dd>{p.exempt === true ? 'Exento' : `${ivaPct}%`}</dd></div>
        </dl>
      </div>
      <Button variant="secondary" block onClick={onClose} style={{ marginTop: 14 }}>Cerrar</Button>
    </Sheet>
  );
}

function ProductMissSheet({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <Sheet onClose={onClose} title="Producto no encontrado">
      <div style={{ textAlign: 'center', padding: '8px 4px 4px' }}>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
          <Icon name="search-x" size={28} />
        </div>
        <h3 style={{ margin: '4px 0 4px', font: '700 18px var(--font-sans)' }}>Producto no encontrado</h3>
        <p style={{ margin: 0, color: 'var(--ink-3)', font: '500 13px var(--font-sans)' }}>
          No hay coincidencias para <span className="mono">{code}</span>.
        </p>
      </div>
      <Button block onClick={onClose} style={{ marginTop: 14 }}>Escanear de nuevo</Button>
    </Sheet>
  );
}

export default function ScanScreen() {
  const online = useOnline();
  const bsRate = useBsRate();
  // Escanear is info-only: paused products stay visible here (unlike Venta).
  const catalog = useProducts();
  const categories = useCategories();
  const settings = useSettingsDoc();
  const ivaPct = settings?.ivaPct ?? 13;

  const catLabelById = useMemo(
    () => new Map(categories.map((c) => [c._id as string, c.label])),
    [categories],
  );

  const [selected, setSelected] = useState<Product | null>(null); // product to show
  const [missCode, setMissCode] = useState<string | null>(null);  // not-found code
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string>('all');
  const [sort, setSort] = useState('name-asc');

  const handleScanResult = useCallback((r: ScanResult) => {
    if (r.found && r.product) setSelected(r.product);
    else setMissCode(r.code ?? null);
  }, []);

  const filtered = (activeCat === 'all' ? catalog : catalog.filter((p) => (p.categoryId as string) === activeCat))
    .filter((p) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode.includes(q);
    })
    .slice()
    .sort((a, b) => {
      switch (sort) {
        case 'name-asc':  return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'price-asc': return a.price - b.price;
        case 'price-desc':return b.price - a.price;
        default: return 0;
      }
    });

  return (
    <>
      <AppBar title="Escanear" sub="Consulta de producto" online={online} />

      <div className="content scan-screen">
        {!online && <Banner tone="warn" icon="wifi-off" title="Sin conexión" message="Los precios mostrados pueden no estar actualizados." />}

        <div className="pos-scanner-sticky scan-scanner">
          <ScannerView
            onScanResult={handleScanResult}
            mode="split"
            density="roomy"
            catalog={catalog}
            scannerMode={settings?.scannerMode} />
        </div>

        <div className="catalog-head scan-catalog-head">
          <h2 className="catalog-title">Buscar producto</h2>
          <Input
            placeholder="Nombre, SKU o código de barras"
            value={query}
            onChange={(e) => setQuery(e.target.value)} />
          <div className="catalog-filters">
            <label className="catalog-filter">
              <span>Categoría</span>
              <select className="input cat-select" value={activeCat} onChange={(e) => setActiveCat(e.target.value)}>
                <option value="all">Todos</option>
                {categories.map((c) => <option key={c._id} value={c._id}>{c.label}</option>)}
              </select>
            </label>
            <label className="catalog-filter">
              <span>Ordenar por</span>
              <select className="input cat-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="name-asc">Nombre (A–Z)</option>
                <option value="name-desc">Nombre (Z–A)</option>
                <option value="price-asc">Precio (menor a mayor)</option>
                <option value="price-desc">Precio (mayor a menor)</option>
              </select>
            </label>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty" style={{ padding: '36px 20px' }}>
            <p>Sin resultados{query ? ` para “${query}”` : ''}</p>
          </div>
        ) : (
          <div className="quick-grid scan-grid">
            {filtered.map((p) =>
              <button className="quick-tile" key={p._id} onClick={() => setSelected(p)}>
                <div className="glyph">{p.glyph}</div>
                <div className="name">{p.name}</div>
                <div className="meta">{p.sku}</div>
                <div className="price">${p.price.toFixed(2)}</div>
                {bsRate > 0 && <div className="price-bs">Bs {(p.price * bsRate).toFixed(2)}</div>}
                {p.sellable === false && <div className="quick-stock-paused">Pausado</div>}
                {p.sellable !== false && p.stock > 0 && p.stock <= (p.minStock ?? 5) && <div className="quick-stock-max">Máx. {p.stock} en stock</div>}
                {p.sellable !== false && p.stock <= 0 && <div className="quick-stock-out">Agotado</div>}
              </button>
            )}
          </div>
        )}
      </div>

      {selected && (
        <ProductInfoSheet
          product={selected}
          bsRate={bsRate}
          catLabel={catLabelById.get(selected.categoryId) || ''}
          ivaPct={ivaPct}
          onClose={() => setSelected(null)} />
      )}
      {missCode && <ProductMissSheet code={missCode} onClose={() => setMissCode(null)} />}
    </>
  );
}
