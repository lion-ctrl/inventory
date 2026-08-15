// Dashboard — greeting, today's performance, quick actions, low stock & recent sales.
// Pulls live data from Convex (sales history, products, clients, stored carts).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { AppBar, Banner, Chip, Icon, Segmented } from '@/components';
import { useSession } from '@/state/SessionContext';
import { useOnline } from '@/state/useOnline';
import { initialOf } from '@/lib/initials';
import { periodBounds } from '@/lib/period';
import type { Period } from '@/lib/period';
import {
  useBsRate,
  useCategories,
  useClients,
  useProducts,
} from '@/state/hooks';
import { useCart } from '@/state/CartContext';
import type { Sale } from '@/types';

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: 'mes', label: 'Mes' },
  { value: 'semana', label: 'Semana' },
  { value: 'dia', label: 'Día' },
];

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
  // The tiles chart today and yesterday and list the 5 most recent sales, so a
  // 7-day window covers everything this screen reads. Sending it keeps the
  // subscription bounded: `sales` grows forever, and an unwindowed live query
  // re-pushed the whole table to every cashier on every sale.
  // Quantized to the start of the day and memoized — a raw `Date.now()` in the
  // args would change identity on every render and resubscribe in a loop.
  const salesFrom = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() - 6 * 24 * 60 * 60 * 1000;
  }, []);
  const salesHistoryRaw = useQuery(
    api.sales.history,
    token ? { token, from: salesFrom } : 'skip'
  );
  const salesHistory = salesHistoryRaw?.sales ?? [];
  const salesUnavailable = !online && salesHistoryRaw === undefined;
  // Same rule the History banner enforces: revenue and the trend are totalled
  // over this array, so a capped window must say so rather than present a
  // smaller figure as today's takings. Today's sales are the newest and survive
  // the cap first, but the yesterday comparison breaks as soon as the two days
  // together exceed it.
  const salesPartial = salesHistoryRaw?.truncated === true;

  // Cash-flow tiles: server-aggregated money in/out, gated server-side too
  // (`requirePerm(employee, 'view_reports')`).
  //
  // NOT memoised on `[period]` alone, unlike `salesFrom` above: that one is an
  // open-ended LOWER bound on a rolling window, where waking up late only widens
  // the range. This window is CLOSED on the right, so a clock captured at mount
  // rots — a POS tablet parked on this screen across midnight would put every
  // later sale outside `[cashFrom, cashTo]`, and Ingresos and Diferencia would
  // stop moving while the selector still read "Mes". Wrong money, no symptom.
  const [period, setPeriod] = useState<Period>('mes');
  const [cashNow, setCashNow] = useState(() => Date.now());
  const { from: cashFrom, to: cashTo } = useMemo(
    () => periodBounds(period, new Date(cashNow)),
    [period, cashNow]
  );
  // Wakes when the window EXPIRES rather than polling. `setTimeout` saturates
  // past ~24.8 days and a month is longer, so the wait is taken in bounded hops
  // and each wake re-reads the clock instead of assuming it arrived on time.
  useEffect(() => {
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const delay = Math.min(Math.max(cashTo - cashNow + 1, 0), SIX_HOURS);
    const timer = setTimeout(() => setCashNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [cashTo, cashNow]);
  /**
   * Changing the period re-reads the clock as well. The hop above can leave
   * `cashNow` up to six hours stale, so switching to `Día` at 01:00 after a
   * wake at 20:00 would compute yesterday's day — the same rot the timer
   * closes, coming in through the selector instead.
   */
  const selectPeriod = (next: Period) => {
    setPeriod(next);
    setCashNow(Date.now());
  };
  const cashFlow = useQuery(
    api.reports.cashFlow,
    token && can('view_reports')
      ? { token, from: cashFrom, to: cashTo }
      : 'skip'
  );
  const cashOfflineMsg = !online && cashFlow === undefined;
  const cashTruncated = cashFlow?.truncated === true;
  // `Diferencia` is the number the owner acts on, so a truncated window blanks
  // all three tiles rather than showing a suspect-but-numeric figure.
  const cashBlank = cashFlow === undefined || cashTruncated;
  const cashCaption = cashOfflineMsg
    ? 'No disponible sin conexión'
    : cashTruncated
      ? 'No disponible: el período tiene más movimientos de los que se pueden sumar.'
      : 'Egresos = solo compras a proveedores. No incluye alquiler, sueldos ni servicios.';

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
  // The tile is labelled "Productos", so it counts LINES sold today. Summing
  // quantities would add 1.5 kg of cheese to 2 sodas and report 3.5.
  const units = todaySales.reduce((a, s) => a + s.items.length, 0);
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
      sub: salesUnavailable
        ? 'Ver historial'
        : `${todaySales.length} ventas hoy`,
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
            {!salesUnavailable && salesPartial && (
              <div className="t-body-sm">
                Cifra parcial: hay más ventas de las que se pueden mostrar
              </div>
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
              <div className="v">
                {salesUnavailable ? '—' : todaySales.length}
              </div>
            </div>
            <div>
              <div className="k">Productos</div>
              <div className="v">{salesUnavailable ? '—' : units}</div>
            </div>
            {can('view_reports') && (
              <>
                <div>
                  {/* .seg must stay a GRANDCHILD of .dash-hero-stats: as a
                      direct child, `.dash-hero-stats > div` (0,1,1) would
                      overwrite `.seg` (0,1,0)'s display/padding/border. */}
                  <Segmented
                    options={PERIOD_OPTIONS}
                    value={period}
                    onChange={selectPeriod}
                  />
                </div>
                <div>
                  <div className="k">Ingresos</div>
                  <div className="v">
                    {cashBlank ? '—' : `$${cashFlow.income.toFixed(2)}`}
                  </div>
                </div>
                <div>
                  <div className="k">Egresos</div>
                  <div className="v">
                    {cashBlank ? '—' : `$${cashFlow.expenses.toFixed(2)}`}
                  </div>
                </div>
                <div>
                  <div className="k">Diferencia</div>
                  <div className="v">
                    {cashBlank ? '—' : `$${cashFlow.net.toFixed(2)}`}
                  </div>
                </div>
                <div className="t-body-sm">{cashCaption}</div>
              </>
            )}
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
                      {initialOf(p.name)}
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
