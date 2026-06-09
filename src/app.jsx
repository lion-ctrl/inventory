// Top-level App — login → dashboard → sale → payment → success
// + offline/permission states + tweaks panel + responsive layout

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "roomy",
  "deviceMode": "auto",
  "salesType": "ticket",
  "startRoute": "sale",
  "demoControls": false
}/*EDITMODE-END*/;

function useViewport() {
  const [w, setW] = React.useState(() => window.innerWidth);
  React.useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [user, setUser] = React.useState({ id: 'E-0001', name: 'Carlos Méndez', role: 'owner', permissions: 'all' });
  const [route, setRoute] = React.useState('dashboard');
  const [clients, setClients] = React.useState(() => CLIENTS);
  const [employees, setEmployees] = React.useState(() => EMPLOYEES);
  const [salesHistory, setSalesHistory] = React.useState(() => SALES_HISTORY);
  const [products, setProducts] = React.useState(() => CATALOG);
  // When products change, drop any cart items that became unsellable (paused) or were removed.
  const setProductsAndSyncCart = React.useCallback((updater) => {
    setProducts(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const byId = Object.fromEntries(next.map(p => [p.id, p]));
      const keep = (i) => byId[i.id] && byId[i.id].sellable !== false;
      setActiveCart(c => c.filter(keep));
      setStoredCarts(sc => sc.map(s => ({ ...s, cart: s.cart.filter(keep) })));
      return next;
    });
  }, []);
  const [categories, setCategories] = React.useState(() => CATEGORIES);
  const [productsStock, setProductsStock] = React.useState('all');
  const [bsRate, setBsRate] = React.useState(36.50);
  const [selectedClientId, setSelectedClientId] = React.useState(null);
  const [activeCart, setActiveCart] = React.useState([]);
  const [storedCarts, setStoredCarts] = React.useState([]);
  const storedIdRef = React.useRef(1);
  const [pendingCart, setPendingCart] = React.useState([]);
  const [pendingTotal, setPendingTotal] = React.useState(0);
  const [pendingType, setPendingType] = React.useState('ticket');
  const [pendingSplits, setPendingSplits] = React.useState([{ id: 1, method: 'cash', amount: '' }]);
  const splitsIdRef = React.useRef(2);
  const invoiceSeqRef = React.useRef(43);
  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [completedSale, setCompletedSale] = React.useState(() => ({
    invoice: '00000043',
    total: CATALOG[0].price * 2 + CATALOG[5].price,
    items: [{ ...CATALOG[0], qty: 2 }, { ...CATALOG[5], qty: 1 }],
    method: 'cash',
    salesType: 'invoice',
    tendered: 30,
    splits: null,
    client: CLIENTS[0],
  }));
  const [online, setOnline] = React.useState(true);
  const [confirmLogout, setConfirmLogout] = React.useState(false);
  const [permErrorOpen, setPermErrorOpen] = React.useState(false);

  const w = useViewport();

  // Quantities reserved by paused/parked sales — reduces availability in the active sale
  const reserved = React.useMemo(() => {
    const m = {};
    for (const s of storedCarts) {
      for (const it of (s.cart || [])) {
        m[it.id] = (m[it.id] || 0) + it.qty;
      }
    }
    return m;
  }, [storedCarts]);
  const forceMobile = tweaks.deviceMode === 'mobile';
  const forceDesktop = tweaks.deviceMode === 'desktop';
  const isWide = forceDesktop || (tweaks.deviceMode === 'auto' && w >= 1000);
  const shellCls = ['shell', forceMobile ? 'force-mobile' : '', forceDesktop ? 'force-desktop' : '']
    .filter(Boolean).join(' ');

  React.useEffect(() => { if (window.lucide) window.lucide.createIcons(); });

  // RBAC route guard — if the current user can't access the current route, bounce home.
  const ROUTE_PERMS = { employees: 'manage_employees', settings: 'manage_settings', products: 'manage_products', history: 'view_reports', clients: 'manage_clients' };
  React.useEffect(() => {
    const need = ROUTE_PERMS[route];
    if (!need) return;
    const allowed = need === '__owner' ? user?.role === 'owner' : can(user, need);
    if (!allowed) setRoute('dashboard');
  }, [route, user]);

  const goLogin = () => { setUser(null); setRoute('login'); };
  const goDash  = () => setRoute('dashboard');
  const goSale  = () => setRoute('sale');
  const goScan  = () => setRoute('scan');
  const goClients = () => setRoute('clients');
  const goProducts = () => setRoute('products');
  const goProductsLow = () => { setProductsStock('low'); setRoute('products'); };
  const goHistory = () => setRoute('history');
  const goSettings = () => setRoute('settings');
  const goEmployees = () => setRoute('employees');
  const goProfile = () => setRoute('profile');
  const goStored = () => setRoute('stored');

  // Save the current sale state into the stored list and reset the active sale
  const pauseSale = (note) => {
    if (activeCart.length === 0) return;
    const id = String(1000 + storedIdRef.current++).padStart(8, '0');
    const client = clients.find(c => c.id === selectedClientId) || null;
    const total = activeCart.reduce((s, i) => s + i.price * i.qty, 0);
    setStoredCarts(prev => [...prev, {
      id,
      client,
      cart: activeCart,
      splits: pendingSplits,
      total,
      note: note || '',
      createdAt: new Date().toISOString(),
    }]);
    setActiveCart([]);
    setSelectedClientId(null);
    setPendingSplits([{ id: 1, method: 'cash', amount: '' }]);
    splitsIdRef.current = 2;
  };
  const resumeSale = (id) => {
    const snap = storedCarts.find(s => s.id === id);
    if (!snap) return;
    setActiveCart(snap.cart);
    setSelectedClientId(snap.client?.id || null);
    setPendingSplits(snap.splits || [{ id: 1, method: 'cash', amount: '' }]);
    splitsIdRef.current = (snap.splits || []).reduce((m, r) => Math.max(m, (r.id || 0) + 1), 2);
    setStoredCarts(prev => prev.filter(s => s.id !== id));
    setRoute('sale');
  };
  const discardStoredSale = (id) => setStoredCarts(prev => prev.filter(s => s.id !== id));

  const GLOBAL_NAV = [
    { id: 'dashboard', label: 'Inicio',            icon: 'home',           onClick: goDash },
    { id: 'scan',      label: 'Escanear',          icon: 'scan-barcode',   onClick: goScan },
    { id: 'sale',      label: 'Venta',             icon: 'scan-line',      onClick: goSale },
    { id: 'stored',    label: 'Ventas en espera',  icon: 'pause-circle',   onClick: goStored, badge: storedCarts.length || null },
    { id: 'history',   label: 'Historial de ventas', icon: 'receipt',      onClick: goHistory,   perm: 'view_reports' },
    { id: 'products',  label: 'Productos',         icon: 'package',        onClick: goProducts,  perm: 'manage_products' },
    { id: 'clients',   label: 'Clientes',          icon: 'users',          onClick: goClients,   perm: 'manage_clients' },
    { id: 'employees', label: 'Empleados',         icon: 'user-cog',       onClick: goEmployees, perm: 'manage_employees' },
    { id: 'settings',  label: 'Ajustes',           icon: 'settings',       onClick: goSettings,  perm: 'manage_settings' },
    { id: 'profile',   label: 'Mi perfil',         icon: 'user-round',     onClick: goProfile },
    { id: 'logout',    label: 'Cerrar sesión',     icon: 'log-out',        onClick: () => setConfirmLogout(true), tone: 'danger' },
  ].filter(item => {
    if (item.ownerOnly) return user?.role === 'owner';
    if (item.perm) return can(user, item.perm);
    return true;
  });

  let screen;
  if (route === 'login') {
    screen = <LoginScreen onLogin={u => { setUser(u); goDash(); }} online={online} />;
  } else if (route === 'dashboard') {
    screen = <Dashboard user={user} online={online}
      salesHistory={salesHistory} products={products} clients={clients}
      storedCarts={storedCarts} employees={employees} bsRate={bsRate}
      onStartSale={goSale}
      goScan={goScan} goProducts={goProducts} goClients={goClients}
      goHistory={goHistory} goStored={goStored} goEmployees={goEmployees}
      onLogout={() => setConfirmLogout(true)}
      onLowStock={goProductsLow} />;
  } else if (route === 'clients') {
    screen = <ClientsScreen clients={clients} setClients={setClients} online={online} onBack={goDash} />;
  } else if (route === 'employees') {
    screen = <EmployeesScreen employees={employees} setEmployees={setEmployees} currentUserId={user?.id} online={online} onBack={goDash} />;
  } else if (route === 'profile') {
    screen = <ProfileScreen user={user} setUser={setUser} employees={employees} setEmployees={setEmployees} online={online} onLogout={() => setConfirmLogout(true)} />;
  } else if (route === 'scan') {
    screen = <ScanScreen products={products} online={online} onBack={goDash} bsRate={bsRate} tweaks={tweaks} />;
  } else if (route === 'products') {
    screen = <ProductsScreen products={products} setProducts={setProductsAndSyncCart} categories={categories} setCategories={setCategories} online={online} onBack={goDash} initialStock={productsStock} stockKey={productsStock} bsRate={bsRate} />;
  } else if (route === 'history') {
    screen = <HistoryScreen sales={salesHistory} setSales={setSalesHistory} user={user} online={online} onBack={goDash} bsRate={bsRate}
      onRestock={(saleItems) => setProductsAndSyncCart(prev => prev.map(p => {
        const it = saleItems.find(i => i.id === p.id);
        return it ? { ...p, stock: p.stock + it.qty } : p;
      }))} />;
  } else if (route === 'settings') {
    screen = <SettingsScreen
      user={user}
      online={online}
      onBack={goDash}
      onLogout={() => setConfirmLogout(true)}
      bsRate={bsRate}
      setBsRate={setBsRate}
      tweaks={tweaks}
      setTweak={setTweak} />;
  } else if (route === 'stored') {
    screen = <StoredCartsScreen
      carts={storedCarts}
      onResume={resumeSale}
      onDiscard={discardStoredSale}
      onBack={goSale}
      bsRate={bsRate}
      online={online} />;
  } else if (route === 'sale') {
    const selectedClient = clients.find(c => c.id === selectedClientId) || null;
    screen = <SaleScreen
      tweaks={tweaks}
      isWide={isWide}
      online={online}
      bsRate={bsRate}
      cart={activeCart}
      setCart={setActiveCart}
      reserved={reserved}
      products={products}
      pendingSplits={pendingSplits}
      clients={clients}
      selectedClient={selectedClient}
      storedCartsCount={storedCarts.length}
      onSelectClient={setSelectedClientId}
      onCreateClient={(c) => {
        const id = 'C-' + String(1000 + Math.floor(Math.random() * 9000));
        const next = { id, ...c };
        setClients(prev => [next, ...prev]);
        setSelectedClientId(id);
      }}
      onResetPayment={() => {
        setPendingSplits([{ id: 1, method: 'cash', amount: '' }]);
        splitsIdRef.current = 2;
      }}
      onPauseSale={pauseSale}
      onViewStored={goStored}
      onBack={goDash}
      onConfirm={(cart, total, salesType) => {
        if (!online) { setPermErrorOpen({ kind: 'offline' }); return; }
        setPendingCart(cart); setPendingTotal(total); setPendingType(salesType); setPaymentOpen(true);
      }} />;
  } else if (route === 'success') {
    screen = (
      <SuccessScreen
        invoice={completedSale.invoice}
        total={completedSale.total}
        items={completedSale.items}
        method={completedSale.method}
        splits={completedSale.splits}
        salesType={completedSale.salesType}
        tendered={completedSale.tendered}
        client={completedSale.client}
        bsRate={bsRate}
        online={online}
        onNew={() => { setCompletedSale(null); goSale(); }}
        onDash={() => { setCompletedSale(null); goDash(); }}
        onPrint={() => alert('Imprimir ticket (demo)')} />
    );
  }

  return (
    <div className={shellCls}>
      <NavLayout
        nav={GLOBAL_NAV}
        currentRoute={route}
        user={user}
        online={online}
        hidden={route === 'login'}>
        {screen}
      </NavLayout>

      {paymentOpen && (
        <PaymentSheet
          total={pendingTotal}
          salesType={pendingType}
          bsRate={bsRate}
          splits={pendingSplits}
          setSplits={setPendingSplits}
          nextIdRef={splitsIdRef}
          onClose={() => setPaymentOpen(false)}
          onConfirm={(method, tendered, splits) => {
            setPaymentOpen(false);
            const num = String(invoiceSeqRef.current++).padStart(8, '0');
            const saleClient = clients.find(c => c.id === selectedClientId) || null;
            setCompletedSale({ invoice: num, total: pendingTotal, items: pendingCart, method, salesType: pendingType, tendered, splits, client: saleClient });
            // Reset for next sale
            setActiveCart([]);
            setSelectedClientId(null);
            setPendingSplits([{ id: 1, method: 'cash', amount: '' }]);
            splitsIdRef.current = 2;
            setRoute('success');
          }} />
      )}

      {confirmLogout && (
        <ConfirmDialog
          title="¿Cerrar sesión?"
          message="Volverás a la pantalla de inicio. Las ventas en curso se perderán."
          confirmLabel="Cerrar sesión"
          tone="danger"
          onConfirm={() => { setConfirmLogout(false); goLogin(); }}
          onCancel={() => setConfirmLogout(false)} />
      )}

      {permErrorOpen?.kind === 'offline' && (
        <ConfirmDialog
          title="Sin conexión con el servidor"
          message="No se puede registrar la venta sin conexión a ERPNext. Conéctate e intenta de nuevo."
          confirmLabel="Entendido"
          cancelLabel="Cerrar"
          onConfirm={() => setPermErrorOpen(false)}
          onCancel={() => setPermErrorOpen(false)} />
      )}
      {permErrorOpen?.kind === 'perm' && (
        <ConfirmDialog
          title="Sin permisos"
          message="Tu rol de cajero no permite esta acción. Pide a un supervisor que la autorice."
          confirmLabel="Entendido"
          cancelLabel="Cerrar"
          onConfirm={() => setPermErrorOpen(false)}
          onCancel={() => setPermErrorOpen(false)} />
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Densidad" />
        <TweakRadio label="Filas" value={tweaks.density} onChange={v => setTweak('density', v)}
          options={[{value:'roomy',label:'Cómoda'},{value:'dense',label:'Compacta'}]} />
        <TweakSection label="Modo del cajero" />
        <TweakRadio label="Layout" value={tweaks.deviceMode} onChange={v => setTweak('deviceMode', v)}
          options={[{value:'mobile',label:'Móvil'},{value:'auto',label:'Auto'},{value:'desktop',label:'Desktop'}]} />
        <TweakSection label="Tipo de venta" />
        <TweakRadio label="Documento" value={tweaks.salesType} onChange={v => setTweak('salesType', v)}
          options={[{value:'ticket',label:'Solo ticket'},{value:'invoice',label:'Con factura'}]} />
        <TweakSection label="Rol (vista previa RBAC)" />
        <TweakRadio label="Ver como" value={user?.role === 'owner' ? 'owner' : 'cajero'}
          onChange={v => {
            if (v === 'owner') setUser({ name: 'Carlos Méndez', role: 'owner', permissions: 'all' });
            else { const c = employees.find(e => e.role === 'cajero' && e.active !== false) || employees[1]; setUser({ name: c.name, role: 'cajero', permissions: c.permissions, active: c.active }); }
          }}
          options={[{value:'owner',label:'Propietario'},{value:'cajero',label:'Cajero'}]} />
        <TweakSection label="Estados demo" />
        <TweakToggle label="Sin conexión" value={!online} onChange={v => setOnline(!v)} />
        <TweakToggle label="Controles demo en el escáner" value={!!tweaks.demoControls} onChange={v => setTweak('demoControls', v)} />
        <TweakButton label="Probar “sin permisos”" onClick={() => setPermErrorOpen({ kind: 'perm' })} />
        <TweakSection label="Ir a pantalla" />
        <TweakButton label="Dashboard" onClick={() => goDash()} />
        <TweakButton label="Venta" onClick={() => goSale()} />
        <TweakButton label="Escanear" onClick={() => goScan()} />
        <TweakButton label="Ventas en espera" onClick={() => goStored()} />
        <TweakButton label="Clientes" onClick={() => goClients()} />
        <TweakButton label="Productos" onClick={() => goProducts()} />
        <TweakButton label="Empleados" onClick={() => goEmployees()} />
        <TweakButton label="Historial" onClick={() => goHistory()} />
        <TweakButton label="Ajustes" onClick={() => goSettings()} />
        <TweakButton label="Login" onClick={() => goLogin()} />
      </TweaksPanel>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
