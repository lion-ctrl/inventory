// Dashboard — greeting, today's performance, quick actions, low stock & recent sales.
// Pulls live data from Convex (sales history, products, clients, stored carts).
import { useNavigate } from 'react-router';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { AppBar, Banner, Chip, Icon } from '@/components';
import { useSession } from '@/state/SessionContext';
import { useOnline } from '@/state/useOnline';
import {
  useBsRate,
  useCategories,
  useClients,
  useProducts,
} from '@/state/hooks';
import { useCart } from '@/state/CartContext';
import type { Sale } from '@/types';

function greetingFor(d: Date) {
  const h = d.getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}
function firstName(name?: string | null) {
  return (
    String(name || '')
      .trim()
      .split(/\s+/)[0] || 'Usuario'
  );
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function money(n: number) {
  return n.toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function Dashboard() {
  const { user, token, can } = useSession();
  const online = useOnline();
  const bsRate = useBsRate();
  const navigate = useNavigate();
  // Phase 9 — `sales.history` is NOT mirrored (official history is server-only,
  // §Phase 10). Convex keeps the last-fetched result while offline WITHIN a session
  // (that shows the cached figure), but a FRESH offline load has none — show
  // "No disponible sin conexión" instead of a misleading $0. `salesUnavailable` is
  // true ONLY offline with no data (never during an online first-load).
  const salesHistoryRaw = useQuery(api.sales.history, token ? { token } : 'skip');
  const salesHistory = salesHistoryRaw ?? [];
  const salesUnavailable = !online && salesHistoryRaw === undefined;
  const products = useProducts();
  const clients = useClients();
  const categories = useCategories();
  const { heldCarts: storedCarts } = useCart();

  const catById = new Map(categories.map((c) => [c._id, c.label]));
  const onStartSale = () => void navigate('/venta');

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const notRefunded = (s: Sale) => !s.refund;
  const todaySales = salesHistory.filter(
    (s) => sameDay(new Date(s.soldAt), now) && notRefunded(s)
  );
  const yesterSales = salesHistory.filter(
    (s) => sameDay(new Date(s.soldAt), yesterday) && notRefunded(s)
  );

  const revenue = todaySales.reduce((a, s) => a + s.total, 0);
  const yRevenue = yesterSales.reduce((a, s) => a + s.total, 0);
  const units = todaySales.reduce(
    (a, s) => a + s.items.reduce((u, i) => u + i.qty, 0),
    0
  );
  const _avg = todaySales.length ? revenue / todaySales.length : 0;
  const trend =
    yRevenue > 0 ? Math.round(((revenue - yRevenue) / yRevenue) * 100) : null;

  const dollars = Math.floor(revenue);
  const cents = (revenue - dollars).toFixed(2).slice(1); // ".50"

  const lowStock = products
    .filter((p) => p.sellable !== false && p.stock <= (p.minStock ?? 5))
    .sort((a, b) => a.stock - b.stock);

  const recent = [...salesHistory]
    .sort((a, b) => b.soldAt - a.soldAt)
    .slice(0, 5);

  const METHOD_LABEL: Record<string, string> = {
    cash: 'Efectivo',
    cash_bs: 'Efectivo Bs',
    card: 'Tarjeta',
    transfer: 'Transferencia',
    mobile: 'Pago móvil',
    zelle: 'Zelle',
  };
  const timeOf = (ms: number) =>
    new Date(ms).toLocaleTimeString('es', {
      hour: '2-digit',
      minute: '2-digit',
    });

  const dateLabel = now.toLocaleDateString('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const dateCap = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);

  const actions = [
    {
      show: true,
      cls: 'scan',
      icon: 'scan-barcode',
      title: 'Escanear',
      sub: 'Consultar producto',
      onClick: () => void navigate('/escanear'),
    },
    {
      show: true,
      cls: '',
      icon: 'pause-circle',
      title: 'En espera',
      sub: `${storedCarts.length} ventas`,
      onClick: () => void navigate('/ventas-en-espera'),
    },
    {
      show: can('view_reports'),
      cls: '',
      icon: 'receipt',
      title: 'Historial',
      sub: salesUnavailable ? 'Ver historial' : `${todaySales.length} ventas hoy`,
      onClick: () => void navigate('/historial'),
    },
    {
      show: can('manage_products'),
      cls: '',
      icon: 'package',
      title: 'Productos',
      sub: `${products.length} en catálogo`,
      onClick: () => void navigate('/productos'),
    },
    {
      show: can('manage_clients'),
      cls: '',
      icon: 'users',
      title: 'Clientes',
      sub: `${clients.length} registrados`,
      onClick: () => void navigate('/clientes'),
    },
  ].filter((a) => a.show);

  return (
    <>
      <AppBar title="Inicio" online={online} />

      <div className="content dash">
        {!online && (
          <Banner
            tone="warn"
            icon="wifi-off"
            title="Sin conexión"
            message="Trabajando en modo limitado. Las ventas se sincronizarán al reconectarse."
          />
        )}

        <div className="dash-greet">
          <div className="dash-greet-text">
            <h1 className="dash-hello">
              {greetingFor(now)}, {firstName(user?.name)}
            </h1>
            <p className="dash-date">{dateCap}</p>
          </div>
          <button
            className="dash-new-sale hide-mobile"
            onClick={onStartSale}
            style={{ textAlign: 'center' }}
          >
            <Icon name="scan-line" size={20} />
            <span className="dash-new-sale-label">Nueva venta</span>
          </button>
        </div>

        <div className="dash-hero">
          <div className="dash-hero-main">
            <div className="label">Vendido hoy</div>
            <div className="num">
              {salesUnavailable ? (
                '—'
              ) : (
                <>
                  ${money(dollars).replace(/,00$/, '')}
                  <span>{cents}</span>
                </>
              )}
            </div>
            {salesUnavailable && (
              <div className="t-body-sm">No disponible sin conexión</div>
            )}
            {!salesUnavailable && bsRate > 0 && (
              <div className="dash-hero-bs">Bs {money(revenue * bsRate)}</div>
            )}
            {trend !== null && (
              <div className={`dash-trend ${trend >= 0 ? 'up' : 'down'}`}>
                <Icon
                  name={trend >= 0 ? 'trending-up' : 'trending-down'}
                  size={14}
                />
                {trend >= 0 ? '+' : ''}
                {trend}% vs ayer
              </div>
            )}
          </div>
          <div className="dash-hero-stats">
            <div>
              <div className="k">Ventas</div>
              <div className="v">{salesUnavailable ? '—' : todaySales.length}</div>
            </div>
            <div>
              <div className="k">Productos</div>
              <div className="v">{salesUnavailable ? '—' : units}</div>
            </div>
          </div>
        </div>

        <button className="dash-cta" onClick={onStartSale}>
          <Icon name="scan-line" size={24} />
          <span>
            <span className="dash-cta-title">Nueva venta</span>
            <span className="dash-cta-sub">Escanear · cobrar</span>
          </span>
        </button>

        <div className="dash-actions">
          {actions.map((a) => (
            <button
              className={`dash-act ${a.cls}`}
              key={a.title}
              onClick={a.onClick}
            >
              <span className="dash-act-ic">
                <Icon name={a.icon} size={22} />
              </span>
              <span className="dash-act-title">{a.title}</span>
              <span className="dash-act-sub">{a.sub}</span>
            </button>
          ))}
        </div>

        <div className="dash-cols">
          <section className="dash-col">
            <div className="sec-head">
              <h2>Productos con bajo stock</h2>
              {can('manage_products') && (
                <button
                  className="link"
                  onClick={() =>
                    void navigate('/productos', { state: { stock: 'low' } })
                  }
                >
                  Ver todos
                </button>
              )}
            </div>
            <div className="card">
              {lowStock.length === 0 ? (
                <div className="dash-empty">
                  <Icon name="check-circle" size={20} /> Todo en niveles
                  saludables
                </div>
              ) : (
                lowStock.slice(0, 5).map((p) => (
                  <div className="lrow" key={p._id}>
                    <div className="thumb dash-low-thumb">
                      {p.glyph || '📦'}
                    </div>
                    <div>
                      <p className="pname">{p.name}</p>
                      <div className="pmeta mono">
                        {p.sku} · {catById.get(p.categoryId) || ''}
                      </div>
                    </div>
                    <div className="pright">
                      <Chip tone={p.stock <= 2 ? 'danger' : 'warn'}>
                        {p.stock} / {p.minStock ?? 5}
                      </Chip>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="dash-col">
            <div className="sec-head">
              <h2>Últimas ventas</h2>
              {can('view_reports') && (
                <button
                  className="link"
                  onClick={() => void navigate('/historial')}
                >
                  Ver todas
                </button>
              )}
            </div>
            <div className="card">
              {salesUnavailable ? (
                <div className="dash-empty">
                  <Icon name="wifi-off" size={20} /> No disponible sin conexión
                </div>
              ) : recent.length === 0 ? (
                <div className="dash-empty">
                  <Icon name="receipt" size={20} /> Aún no hay ventas
                </div>
              ) : (
                recent.map((s) => (
                  <div className="lrow" key={s._id}>
                    <div
                      className={`thumb dash-sale-thumb ${s.refund ? 'refunded' : ''}`}
                    >
                      <Icon
                        name={s.refund ? 'rotate-ccw' : 'receipt'}
                        size={18}
                      />
                    </div>
                    <div>
                      <p className="pname mono" style={{ fontWeight: 600 }}>
                        N° {s.invoiceNumber}
                      </p>
                      <div className="pmeta">
                        {s.client?.name || 'Sin cliente'} ·{' '}
                        {METHOD_LABEL[s.method] || s.method} ·{' '}
                        {timeOf(s.soldAt)}
                      </div>
                    </div>
                    <div className="pright">
                      <div
                        className={`dash-sale-amt ${s.refund ? 'refunded' : ''}`}
                      >
                        ${s.total.toFixed(2)}
                      </div>
                      {s.refund && (
                        <div className="dash-sale-tag">Reembolsada</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
