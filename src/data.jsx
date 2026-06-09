// Catalog and reference data for the prototype
// Multi-rubro: alimentos, bebidas, farmacia, limpieza, ferretería, hogar

const CATALOG = [
  // Alimentos / Bebidas
  { id: 'P-0001', barcode: '7591000000123', sku: 'COCA-600', name: 'Coca-Cola 600ml',         price: 1.50, stock: 24, minStock: 5, glyph: '🥤', cat: 'bebidas' },
  { id: 'P-0002', barcode: '7591000000130', sku: 'AGUA-1L',  name: 'Agua mineral 1L',         price: 0.80, stock: 56, minStock: 5, exempt: true, glyph: '💧', cat: 'bebidas' },
  { id: 'P-0003', barcode: '7591000000147', sku: 'PAN-BLA',  name: 'Pan blanco rebanado',     price: 2.25, stock: 8, minStock: 5, exempt: true,  glyph: '🍞', cat: 'alimentos' },
  { id: 'P-0004', barcode: '7591000000154', sku: 'CAF-250',  name: 'Café molido 250g',        price: 5.80, stock: 1, minStock: 5,  glyph: '☕', cat: 'alimentos' },
  { id: 'P-0005', barcode: '7591000000161', sku: 'LEC-1L',   name: 'Leche entera 1L',         price: 1.80, stock: 4, minStock: 5, exempt: true,  glyph: '🥛', cat: 'alimentos' },
  { id: 'P-0006', barcode: '7591000000178', sku: 'GAL-CHO',  name: 'Galletas chocolate 200g', price: 3.40, stock: 18, minStock: 5, glyph: '🍪', cat: 'alimentos' },
  { id: 'P-0007', barcode: '7591000000185', sku: 'ARR-1KG',  name: 'Arroz blanco 1kg',        price: 2.10, stock: 32, minStock: 5, exempt: true, glyph: '🍚', cat: 'alimentos' },
  { id: 'P-0008', barcode: '7591000000192', sku: 'ACE-1L',   name: 'Aceite vegetal 1L',       price: 4.50, stock: 2, minStock: 5, exempt: true,  glyph: '🫒', cat: 'alimentos' },

  // Farmacia OTC
  { id: 'P-0101', barcode: '7592000000110', sku: 'PARA-500', name: 'Paracetamol 500mg ×20',   price: 3.20, stock: 14, minStock: 5, exempt: true, glyph: '💊', cat: 'farmacia' },
  { id: 'P-0102', barcode: '7592000000127', sku: 'IBU-400',  name: 'Ibuprofeno 400mg ×10',    price: 4.10, stock: 9, minStock: 5, exempt: true,  glyph: '💊', cat: 'farmacia' },
  { id: 'P-0103', barcode: '7592000000134', sku: 'ALCO-70',  name: 'Alcohol etílico 70% 250ml', price: 2.30, stock: 22, minStock: 5, glyph: '🧴', cat: 'farmacia' },

  // Limpieza
  { id: 'P-0201', barcode: '7593000000115', sku: 'DET-1L',   name: 'Detergente líquido 1L',   price: 6.40, stock: 11, minStock: 5, glyph: '🧼', cat: 'limpieza' },
  { id: 'P-0202', barcode: '7593000000122', sku: 'CLO-1L',   name: 'Cloro 1L',                price: 1.90, stock: 16, minStock: 5, glyph: '🧴', cat: 'limpieza' },
  { id: 'P-0203', barcode: '7593000000139', sku: 'PAP-12U',  name: 'Papel higiénico ×12',     price: 8.90, stock: 7, minStock: 5,  glyph: '🧻', cat: 'limpieza' },

  // Ferretería
  { id: 'P-0301', barcode: '7594000000118', sku: 'TOR-1/4',  name: 'Tornillo 1/4" ×100',      price: 4.80, stock: 5, minStock: 5,  glyph: '🔩', cat: 'ferreteria' },
  { id: 'P-0302', barcode: '7594000000125', sku: 'CIN-AIS',  name: 'Cinta aislante negra',    price: 1.10, stock: 28, minStock: 5, glyph: '⚡', cat: 'ferreteria' },
  { id: 'P-0303', barcode: '7594000000132', sku: 'PIN-1GAL', name: 'Pintura blanca 1gal',     price: 22.50, stock: 3, minStock: 5, glyph: '🎨', cat: 'ferreteria' },
  { id: 'P-0304', barcode: '7594000000149', sku: 'FOC-9W',   name: 'Foco LED 9W',             price: 2.80, stock: 41, minStock: 5, glyph: '💡', cat: 'ferreteria' },

  // Hogar / cosméticos
  { id: 'P-0401', barcode: '7595000000116', sku: 'CHA-400',  name: 'Champú herbal 400ml',     price: 5.20, stock: 12, minStock: 5, glyph: '🧴', cat: 'hogar' },
  { id: 'P-0402', barcode: '7595000000123', sku: 'PIL-AAA',  name: 'Pilas AAA ×4',            price: 2.40, stock: 25, minStock: 5, glyph: '🔋', cat: 'hogar' },
];

const CATEGORIES = [
  { id: 'all', label: 'Todos' },
  { id: 'alimentos', label: 'Alimentos' },
  { id: 'bebidas', label: 'Bebidas' },
  { id: 'farmacia', label: 'Farmacia' },
  { id: 'limpieza', label: 'Limpieza' },
  { id: 'ferreteria', label: 'Ferretería' },
  { id: 'hogar', label: 'Hogar' },
];

const LOW_STOCK = CATALOG.filter(p => p.stock > 0 && p.stock <= (p.minStock || 5));

const RECENT_SALES = [
  { id: '00000042', total: 24.50, items: 3, time: '16:42', method: 'Efectivo' },
  { id: '00000041', total:  8.75, items: 2, time: '16:31', method: 'Tarjeta' },
  { id: '00000040', total: 47.20, items: 7, time: '16:14', method: 'Efectivo' },
  { id: '00000039', total:  3.00, items: 1, time: '16:02', method: 'Pago móvil' },
  { id: '00000038', total: 18.40, items: 4, time: '15:48', method: 'Tarjeta' },
];

const CLIENTS = [
  { id: 'C-0002', name: 'María González',          taxPrefix: 'V', taxId: '5.123.456',  email: 'maria@correo.com',          phone: '+507 6000-1122', address: 'Calle 50, Edificio Sky',    kind: 'person', createdAt: '2024-02-10' },
  { id: 'C-0003', name: 'Juan Pérez',              taxPrefix: 'V', taxId: '8.456.789',  email: 'jperez@correo.com',         phone: '+507 6000-3344', address: 'Vía España, Casa 12',       kind: 'person', createdAt: '2024-03-22' },
  { id: 'C-0004', name: 'Restaurante La Estancia', taxPrefix: 'J', taxId: '15564124-0', email: 'compras@laestancia.com',    phone: '+507 269-0000',  address: 'Av. Balboa, Local 4',       kind: 'business', createdAt: '2024-05-08' },
  { id: 'C-0005', name: 'Ferretería El Tornillo',  taxPrefix: 'J', taxId: '99231720-4', email: 'admin@tornilloferreteria.com', phone: '+507 220-7733', address: 'C. Central 123',          kind: 'business', createdAt: '2024-06-19' },
  { id: 'C-0006', name: 'Ana Castillo',            taxPrefix: 'V', taxId: '3.789.012',  email: 'ana.c@correo.com',          phone: '+507 6000-5566', address: 'San Francisco, PH Marina',  kind: 'person', createdAt: '2024-08-30' },
  { id: 'C-0007', name: 'Café del Centro',         taxPrefix: 'J', taxId: '77123223-1', email: null,                         phone: '+507 261-1144', address: 'Casco Antiguo, Calle 8',    kind: 'business', createdAt: '2024-11-14' },
  { id: 'C-0008', name: 'Luis Mendoza',            taxPrefix: 'V', taxId: '4.321.654',  email: 'luis.m@correo.com',         phone: '+507 6000-7788', address: 'Av. Central, Casa 8',       kind: 'person', createdAt: '2025-01-25' },
  { id: 'C-0009', name: 'John Smith',              taxPrefix: 'E', taxId: '82.456.103', email: 'john.smith@mail.com',       phone: '04141234567',    address: 'Av. Libertador, Torre B',  kind: 'foreign', createdAt: '2025-03-09' },
  { id: 'C-0010', name: 'Giovanni Rossi',          taxPrefix: 'E', taxId: '84.012.778', email: 'g.rossi@mail.com',          phone: '04249988776',    address: 'Calle Madrid, Res. Roma',  kind: 'foreign', createdAt: '2025-04-17' },
  { id: 'C-0011', name: 'Mei Lin',                 taxPrefix: 'E', taxId: '83.665.201', email: 'mei.lin@mail.com',          phone: '04161122334',    address: 'Av. Bolívar, Local 9',     kind: 'foreign', createdAt: '2025-06-02' },
];

// --- Sales history -----------------------------------------------------------

const _now = Date.now();
const _hour = 3600_000;
const _day  = 86400_000;

// Build a mock sale. items is a list of [catalogId, qty]; the rest is auto-computed.
function _mkSale(invoiceNum, hoursAgo, clientId, itemTuples, method, type = 'invoice', splits = null, cashier = 'Juan P.') {
  const client = CLIENTS.find(c => c.id === clientId) || null;
  const items = itemTuples.map(([id, qty]) => {
    const p = CATALOG.find(x => x.id === id);
    return { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, cat: p.cat, price: p.price, glyph: p.glyph, qty };
  });
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = type === 'invoice' ? subtotal * 0.13 : 0;
  const total = +(subtotal + tax).toFixed(2);
  return {
    id: invoiceNum,
    date: new Date(_now - hoursAgo * _hour).toISOString(),
    client,
    items,
    subtotal: +subtotal.toFixed(2),
    tax: +tax.toFixed(2),
    total,
    method,
    splits,
    cashier: cashier || 'Juan P.',
    type,
  };
}

const SALES_HISTORY = [
  // Today (hours ago)
  _mkSale('00000042',  0.5, 'C-0002', [['P-0001', 2], ['P-0006', 1], ['P-0008', 1]], 'cash',     'invoice', null, 'Juan P.'),
  _mkSale('00000041',  1.2, 'C-0003', [['P-0005', 1], ['P-0103', 1]],                'card',     'invoice', null, 'María L.'),
  _mkSale('00000040',   1.8, 'C-0006', [['P-0301', 1], ['P-0302', 3]],                'cash',     'ticket', null, 'Carlos R.'),
  _mkSale('00000039',  2.4, 'C-0004', [['P-0007', 4], ['P-0202', 2], ['P-0203', 1]], 'transfer', 'invoice', null, 'Ana T.'),
  _mkSale('00000038',  3.1, 'C-0007', [['P-0004', 2]],                               'mobile',   'invoice', null, 'Juan P.'),
  _mkSale('00000037',   3.9, 'C-0008', [['P-0402', 2], ['P-0304', 4]],                'cash',     'ticket', null, 'María L.'),
  _mkSale('00000036',  4.5, 'C-0002', [['P-0101', 1], ['P-0102', 1]],                'card',     'invoice', null, 'Carlos R.'),
  _mkSale('00000035',  5.2, 'C-0005', [['P-0303', 2], ['P-0301', 2]],                'transfer', 'invoice', null, 'Ana T.'),
  _mkSale('00000034',   6.0, 'C-0003', [['P-0001', 6]],                               'cash',     'ticket', null, 'Juan P.'),
  _mkSale('00000033',  6.8, 'C-0004', [['P-0201', 3], ['P-0203', 2]],                'card',     'invoice', [{method:'card', amount: 12.00}, {method:'cash', amount: 14.50}], 'María L.'),
  _mkSale('00000032',  7.5, 'C-0007', [['P-0006', 4], ['P-0007', 2]],                'mobile',   'invoice', null, 'Carlos R.'),
  _mkSale('00000031',   8.3, 'C-0008', [['P-0002', 12]],                              'cash',     'ticket', null, 'Ana T.'),

  // Yesterday
  _mkSale('00000030', 25.0, 'C-0002', [['P-0001', 3], ['P-0005', 2]],                'card',     'invoice', null, 'Juan P.'),
  _mkSale('00000029', 26.5, 'C-0003', [['P-0401', 2]],                               'cash',     'invoice', null, 'María L.'),
  _mkSale('00000028',  28.0, 'C-0006', [['P-0302', 5], ['P-0304', 2]],                'card',     'ticket', null, 'Carlos R.'),
  _mkSale('00000027', 29.2, 'C-0004', [['P-0007', 6], ['P-0008', 3]],                'transfer', 'invoice', null, 'Ana T.'),
  _mkSale('00000026', 31.0, 'C-0005', [['P-0301', 4], ['P-0303', 1]],                'transfer', 'invoice', null, 'Juan P.'),
  _mkSale('00000025',  33.5, 'C-0008', [['P-0103', 2], ['P-0102', 1]],                'mobile',   'ticket', null, 'María L.'),
  _mkSale('00000024', 36.0, 'C-0007', [['P-0004', 3], ['P-0006', 5]],                'card',     'invoice', null, 'Carlos R.'),
  _mkSale('00000023', 38.7, 'C-0002', [['P-0202', 1], ['P-0201', 1]],                'cash',     'invoice', null, 'Ana T.'),

  // 2-3 days ago
  _mkSale('00000022', 52.0, 'C-0003', [['P-0001', 4], ['P-0002', 6]],                'cash',     'invoice', null, 'Juan P.'),
  _mkSale('00000021',  54.5, 'C-0006', [['P-0402', 4]],                               'mobile',   'ticket', null, 'María L.'),
  _mkSale('00000020', 60.0, 'C-0004', [['P-0007', 8], ['P-0008', 4]],                'transfer', 'invoice', null, 'Carlos R.'),
  _mkSale('00000019', 72.0, 'C-0005', [['P-0303', 3]],                               'transfer', 'invoice', null, 'Ana T.'),
  _mkSale('00000018',  78.0, 'C-0008', [['P-0005', 4], ['P-0006', 2]],                'cash',     'ticket', null, 'Juan P.'),
  _mkSale('00000017', 84.0, 'C-0002', [['P-0103', 3], ['P-0101', 2]],                'card',     'invoice', null, 'María L.'),

  // This week
  _mkSale('00000016', 100.0, 'C-0007', [['P-0004', 5], ['P-0006', 8]],               'mobile',   'invoice', null, 'Carlos R.'),
  _mkSale('00000015', 108.0, 'C-0003', [['P-0001', 12]],                             'card',     'invoice', null, 'Ana T.'),
  _mkSale('00000014',  120.0, 'C-0008', [['P-0203', 2]],                              'cash',     'ticket', null, 'Juan P.'),
  _mkSale('00000013', 132.0, 'C-0004', [['P-0007', 10], ['P-0008', 5]],              'transfer', 'invoice', null, 'María L.'),
  _mkSale('00000012', 144.0, 'C-0005', [['P-0301', 6], ['P-0302', 4]],               'card',     'invoice', null, 'Carlos R.'),
  _mkSale('00000011',  156.0, 'C-0002', [['P-0401', 1]],                              'cash',     'ticket', null, 'Ana T.'),

  // Last week
  _mkSale('00000010', 192.0, 'C-0006', [['P-0103', 2], ['P-0102', 2]],               'mobile',   'invoice', null, 'Juan P.'),
  _mkSale('00000009', 216.0, 'C-0003', [['P-0005', 6]],                              'cash',     'invoice', null, 'María L.'),
  _mkSale('00000008',  240.0, 'C-0007', [['P-0004', 4]],                              'card',     'ticket', null, 'Carlos R.'),
  _mkSale('00000007', 264.0, 'C-0004', [['P-0007', 12]],                             'transfer', 'invoice', null, 'Ana T.'),
];

window.CLIENTS = CLIENTS;
window.SALES_HISTORY = SALES_HISTORY;

// --- Team / RBAC -------------------------------------------------------------
// Two roles: 'owner' (dueño — full access, implicit all permissions) and
// 'cajero' (employee — granular permissions the owner assigns).

const PERMISSIONS = [
  { id: 'view_reports',     label: 'Historial de ventas', desc: 'Ver ventas, cierres e informes',          icon: 'receipt' },
  { id: 'void_sales',       label: 'Reembolsar ventas',   desc: 'Reembolsar una venta',                    icon: 'rotate-ccw' },
  { id: 'manage_products',  label: 'Productos',           desc: 'Crear, editar y ajustar stock y precios', icon: 'package' },
  { id: 'manage_clients',   label: 'Clientes',            desc: 'Crear y editar la base de clientes',      icon: 'users' },
  { id: 'manage_employees', label: 'Empleados',           desc: 'Gestionar el equipo y sus permisos',      icon: 'user-cog' },
  { id: 'manage_settings',  label: 'Ajustes',             desc: 'Configurar la tienda y el sistema',       icon: 'settings' },
];

// Helper to build a permission map from a list of granted ids
const _perms = (...granted) => Object.fromEntries(PERMISSIONS.map(p => [p.id, granted.includes(p.id)]));

const ROLE_LABELS = { owner: 'Propietario', admin: 'Administrador', cajero: 'Cajero' };

const EMPLOYEES = [
  { id: 'E-0001', name: 'Carlos Méndez',  email: 'carlos@mitienda.com',       phone: '04141112233', role: 'owner',  active: true,  pin: '482106', createdAt: '2024-01-15', lastActive: '2026-06-05T18:42:00', permissions: 'all' },
  { id: 'E-0002', name: 'Lucía Fernández',email: 'lucia.fernandez@mitienda.com', phone: '04148887766', role: 'admin',  active: true,  pin: '741022', createdAt: '2024-02-01', lastActive: '2026-06-05T19:02:00', permissions: 'all' },
  { id: 'E-0003', name: 'Roberto Salazar',email: 'roberto.salazar@mitienda.com', phone: '04263334455', role: 'admin',  active: true,  pin: '369014', createdAt: '2024-07-12', lastActive: '2026-06-05T16:20:00', permissions: _perms('view_reports', 'void_sales', 'manage_products', 'manage_clients') },
  { id: 'E-0004', name: 'Juan Pérez',     email: 'juan.perez@mitienda.com',   phone: '04149876543', role: 'cajero', active: true,  pin: '135708', createdAt: '2024-03-02', lastActive: '2026-06-05T17:10:00', permissions: _perms('view_reports', 'manage_clients') },
  { id: 'E-0005', name: 'María López',    email: 'maria.lopez@mitienda.com',  phone: '04265544332', role: 'cajero', active: true,  pin: '246819', createdAt: '2024-05-19', lastActive: '2026-06-04T20:05:00', permissions: _perms('view_reports', 'manage_clients') },
  { id: 'E-0006', name: 'Ana Torres',     email: 'ana.torres@mitienda.com',   phone: '04167788990', role: 'cajero', active: true,  pin: '975330', createdAt: '2025-01-08', lastActive: '2026-06-05T12:30:00', permissions: _perms('manage_clients') },
  { id: 'E-0007', name: 'Pedro Ramírez',  email: 'pedro.ramirez@mitienda.com',phone: '04141239988', role: 'cajero', active: true,  pin: '582441', createdAt: '2025-03-21', lastActive: '2026-06-05T14:48:00', permissions: _perms('view_reports', 'void_sales', 'manage_clients') },
  { id: 'E-0008', name: 'Gabriela Ruiz',  email: 'gabriela.ruiz@mitienda.com',phone: '04249871122', role: 'cajero', active: true,  pin: '613527', createdAt: '2025-06-10', lastActive: '2026-06-05T11:05:00', permissions: _perms('manage_clients', 'manage_products') },
  { id: 'E-0009', name: 'Carlos Rivas',   email: 'carlos.rivas@mitienda.com', phone: '04122233445', role: 'cajero', active: false, pin: '864253', createdAt: '2024-09-23', lastActive: '2026-04-28T19:15:00', permissions: _perms('view_reports') },
  { id: 'E-0010', name: 'Daniela Mora',   email: 'daniela.mora@mitienda.com', phone: '04161122334', role: 'cajero', active: false, pin: '207961', createdAt: '2025-02-14', lastActive: '2026-03-30T10:40:00', permissions: _perms('manage_clients') },
];

// Central RBAC check. Permissions are authoritative; 'all' is the owner-session sentinel.
function can(user, perm) {
  if (!user) return false;
  if (user.permissions === 'all') return true;
  if (user.active === false) return false;
  return !!(user.permissions && user.permissions[perm]);
}

window.PERMISSIONS = PERMISSIONS;
window.ROLE_LABELS = ROLE_LABELS;
window.EMPLOYEES = EMPLOYEES;
window.can = can;

