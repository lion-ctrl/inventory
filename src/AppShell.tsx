// App shell — ported from prototype app.jsx: nav layout + RBAC route guard +
// payment overlay + logout/offline dialogs. Routing via react-router (see
// PORTING_CONVENTIONS.md for the route table).
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { ConfirmDialog, NavLayout } from './components';
import { useSession } from '@/state/SessionContext';
import { useCart } from '@/state/CartContext';
import { useOnline } from '@/state/useOnline';
import { useBsRate } from '@/state/hooks';
import type { PermissionId } from '@/lib/rbac';
import type { CartItem, CleanSplit } from './types';

import LoginScreen from '@/screens/Login';
import Dashboard from '@/screens/Dashboard';
import ScanScreen from '@/screens/Scan';
import SaleScreen from '@/screens/Sale';
import StoredCartsScreen from '@/screens/Stored';
import HistoryScreen from '@/screens/History';
import ProductsScreen from '@/screens/Products';
import ClientsScreen from '@/screens/Clients';
import EmployeesScreen from '@/screens/Employees';
import ProfileScreen from '@/screens/Profile';
import SettingsScreen from '@/screens/Settings';
import { PaymentSheet, SuccessScreen } from '@/screens/Payment';

const ROUTE_IDS: Array<[string, string]> = [
  ['/login', 'login'],
  ['/escanear', 'scan'],
  ['/venta/exito', 'success'],
  ['/venta', 'sale'],
  ['/ventas-en-espera', 'stored'],
  ['/historial', 'history'],
  ['/productos', 'products'],
  ['/clientes', 'clients'],
  ['/empleados', 'employees'],
  ['/perfil', 'profile'],
  ['/ajustes', 'settings'],
];

function routeIdFor(pathname: string): string {
  if (pathname === '/') return 'dashboard';
  for (const [path, id] of ROUTE_IDS) {
    if (pathname === path || pathname.startsWith(path + '/')) return id;
  }
  return 'dashboard';
}

function Guard({
  perm,
  children,
}: {
  perm?: PermissionId;
  children: ReactNode;
}) {
  const { user, loading, can } = useSession();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (perm && !can(perm)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** /venta/exito — renders the receipt for the just-completed sale (snapshot rate). */
function SuccessRoute({ online }: { online: boolean }) {
  const { completedSale, setCompletedSale } = useCart();
  const navigate = useNavigate();
  if (!completedSale) return <Navigate to="/venta" replace />;
  return (
    <SuccessScreen
      invoice={completedSale.invoice}
      total={completedSale.total}
      items={completedSale.items}
      method={completedSale.method}
      splits={completedSale.splits}
      tendered={completedSale.tendered}
      client={completedSale.client}
      ivaPct={completedSale.ivaPct}
      bsRate={completedSale.exchangeRate}
      online={online}
      onNew={() => {
        setCompletedSale(null);
        void navigate('/venta');
      }}
      onDash={() => {
        setCompletedSale(null);
        void navigate('/');
      }}
      onPrint={() => window.print()}
    />
  );
}

export default function AppShell() {
  const { user, loading, can, logout } = useSession();
  const cart = useCart();
  const online = useOnline();
  const bsRate = useBsRate();
  const navigate = useNavigate();
  const location = useLocation();
  const checkout = useMutation(api.sales.checkout);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [pendingCart, setPendingCart] = useState<CartItem[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [offlineError, setOfflineError] = useState(false);

  const currentRoute = routeIdFor(location.pathname);

  // Menu order is final (see README §Domain Rules); items gated by can() exactly
  // like the prototype GLOBAL_NAV filter.
  const nav = useMemo(() => {
    const items: Array<{
      id: string;
      label: string;
      icon: string;
      onClick: () => void;
      badge?: number | null;
      tone?: 'danger';
      perm?: PermissionId;
    }> = [
      {
        id: 'dashboard',
        label: 'Inicio',
        icon: 'home',
        onClick: () => void navigate('/'),
      },
      {
        id: 'scan',
        label: 'Escanear',
        icon: 'scan-barcode',
        onClick: () => void navigate('/escanear'),
      },
      {
        id: 'sale',
        label: 'Venta',
        icon: 'scan-line',
        onClick: () => void navigate('/venta'),
      },
      {
        id: 'stored',
        label: 'Ventas en espera',
        icon: 'pause-circle',
        onClick: () => void navigate('/ventas-en-espera'),
        badge: cart.heldCarts.length || null,
      },
      {
        id: 'history',
        label: 'Historial de ventas',
        icon: 'receipt',
        onClick: () => void navigate('/historial'),
        perm: 'view_reports',
      },
      {
        id: 'products',
        label: 'Productos',
        icon: 'package',
        onClick: () => void navigate('/productos'),
        perm: 'manage_products',
      },
      {
        id: 'clients',
        label: 'Clientes',
        icon: 'users',
        onClick: () => void navigate('/clientes'),
        perm: 'manage_clients',
      },
      {
        id: 'employees',
        label: 'Empleados',
        icon: 'user-cog',
        onClick: () => void navigate('/empleados'),
        perm: 'manage_employees',
      },
      {
        id: 'settings',
        label: 'Ajustes',
        icon: 'settings',
        onClick: () => void navigate('/ajustes'),
        perm: 'manage_settings',
      },
      {
        id: 'profile',
        label: 'Mi perfil',
        icon: 'user-round',
        onClick: () => void navigate('/perfil'),
      },
      {
        id: 'logout',
        label: 'Cerrar sesión',
        icon: 'log-out',
        onClick: () => setConfirmLogout(true),
        tone: 'danger',
      },
    ];
    return items.filter((i) => (i.perm ? can(i.perm) : true));
  }, [navigate, can, cart.heldCarts.length]);

  // Venta → "Confirmar": block offline (matches prototype), otherwise open payment.
  const handleSaleConfirm = (items: CartItem[], total: number) => {
    if (!online) {
      setOfflineError(true);
      return;
    }
    setPendingCart(items);
    setPendingTotal(total);
    setPaymentOpen(true);
  };

  const handlePaymentConfirm = async (
    method: string,
    tendered: number,
    splits: CleanSplit[]
  ) => {
    if (!user || !cart.selectedClient) {
      setPaymentOpen(false);
      return;
    }
    try {
      const sale = await checkout({
        actorId: user._id,
        clientId: cart.selectedClient._id,
        items: pendingCart.map((i) => ({ productId: i._id, qty: i.qty })),
        method,
        splits,
        tendered,
      });
      setPaymentOpen(false);
      cart.setCompletedSale({
        invoice: sale.invoiceNumber,
        total: sale.total,
        items: sale.items,
        method: sale.method,
        tendered,
        splits: sale.splits ?? splits,
        client: sale.client,
        ivaPct: sale.ivaPct,
        exchangeRate: sale.exchangeRate,
      });
      cart.setCart([]);
      cart.setSelectedClientId(null);
      cart.resetPayment();
      void navigate('/venta/exito');
    } catch (e: any) {
      alert(
        typeof e?.data === 'string'
          ? e.data
          : 'No se pudo registrar la venta. Intenta de nuevo.'
      );
    }
  };

  if (loading) return null;

  return (
    <div className="shell">
      <NavLayout
        nav={nav}
        currentRoute={currentRoute}
        user={user}
        online={online}
        hidden={!user || currentRoute === 'login'}
      >
        <Routes>
          <Route
            path="/login"
            element={user ? <Navigate to="/" replace /> : <LoginScreen />}
          />
          <Route
            path="/"
            element={
              <Guard>
                <Dashboard />
              </Guard>
            }
          />
          <Route
            path="/escanear"
            element={
              <Guard>
                <ScanScreen />
              </Guard>
            }
          />
          <Route
            path="/venta"
            element={
              <Guard>
                <SaleScreen onConfirm={handleSaleConfirm} />
              </Guard>
            }
          />
          <Route
            path="/venta/exito"
            element={
              <Guard>
                <SuccessRoute online={online} />
              </Guard>
            }
          />
          <Route
            path="/ventas-en-espera"
            element={
              <Guard>
                <StoredCartsScreen />
              </Guard>
            }
          />
          <Route
            path="/historial"
            element={
              <Guard perm="view_reports">
                <HistoryScreen />
              </Guard>
            }
          />
          <Route
            path="/productos"
            element={
              <Guard perm="manage_products">
                <ProductsScreen />
              </Guard>
            }
          />
          <Route
            path="/clientes"
            element={
              <Guard perm="manage_clients">
                <ClientsScreen />
              </Guard>
            }
          />
          <Route
            path="/empleados"
            element={
              <Guard perm="manage_employees">
                <EmployeesScreen />
              </Guard>
            }
          />
          <Route
            path="/perfil"
            element={
              <Guard>
                <ProfileScreen />
              </Guard>
            }
          />
          <Route
            path="/ajustes"
            element={
              <Guard perm="manage_settings">
                <SettingsScreen />
              </Guard>
            }
          />
          <Route
            path="*"
            element={<Navigate to={user ? '/' : '/login'} replace />}
          />
        </Routes>
      </NavLayout>

      {paymentOpen && user && (
        <PaymentSheet
          total={pendingTotal}
          bsRate={bsRate}
          splits={cart.splits}
          setSplits={cart.setSplits}
          nextIdRef={cart.splitsIdRef}
          onClose={() => setPaymentOpen(false)}
          onConfirm={handlePaymentConfirm}
        />
      )}

      {confirmLogout && (
        <ConfirmDialog
          title="¿Cerrar sesión?"
          message="Volverás a la pantalla de inicio. Las ventas en curso se perderán."
          confirmLabel="Cerrar sesión"
          tone="danger"
          onConfirm={() => {
            setConfirmLogout(false);
            logout();
            void navigate('/login');
          }}
          onCancel={() => setConfirmLogout(false)}
        />
      )}

      {offlineError && (
        <ConfirmDialog
          title="Sin conexión con el servidor"
          message="No se puede registrar la venta sin conexión con el servidor. Conéctate e intenta de nuevo."
          confirmLabel="Entendido"
          cancelLabel="Cerrar"
          onConfirm={() => setOfflineError(false)}
          onCancel={() => setOfflineError(false)}
        />
      )}
    </div>
  );
}
