// Seed data ported 1:1 from the prototype's src/data.jsx.
// Run with: npx convex run seed:run
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { hashPin, verifyPin } from './sessions';

// `+n.toFixed(2)` — the EXACT rounding the prototype's _mkSale used.
const fix2 = (n: number) => +n.toFixed(2);

// ---------------------------------------------------------------------------
// Mock data (verbatim from src/data.jsx)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Array<{ slug: string; label: string }> = [
  { slug: 'alimentos', label: 'Alimentos' },
  { slug: 'bebidas', label: 'Bebidas' },
  { slug: 'farmacia', label: 'Farmacia' },
  { slug: 'limpieza', label: 'Limpieza' },
  { slug: 'ferreteria', label: 'Ferretería' },
  { slug: 'hogar', label: 'Hogar' },
];

type MockProduct = {
  id: string;
  barcode: string;
  sku: string;
  name: string;
  price: number;
  stock: number;
  minStock: number;
  exempt?: boolean;
  glyph: string;
  cat: string;
};

const CATALOG: MockProduct[] = [
  // Alimentos / Bebidas
  {
    id: 'P-0001',
    barcode: '7591000000123',
    sku: 'COCA-600',
    name: 'Coca-Cola 600ml',
    price: 1.5,
    stock: 24,
    minStock: 5,
    glyph: '🥤',
    cat: 'bebidas',
  },
  {
    id: 'P-0002',
    barcode: '7591000000130',
    sku: 'AGUA-1L',
    name: 'Agua mineral 1L',
    price: 0.8,
    stock: 56,
    minStock: 5,
    exempt: true,
    glyph: '💧',
    cat: 'bebidas',
  },
  {
    id: 'P-0003',
    barcode: '7591000000147',
    sku: 'PAN-BLA',
    name: 'Pan blanco rebanado',
    price: 2.25,
    stock: 8,
    minStock: 5,
    exempt: true,
    glyph: '🍞',
    cat: 'alimentos',
  },
  {
    id: 'P-0004',
    barcode: '7591000000154',
    sku: 'CAF-250',
    name: 'Café molido 250g',
    price: 5.8,
    stock: 1,
    minStock: 5,
    glyph: '☕',
    cat: 'alimentos',
  },
  {
    id: 'P-0005',
    barcode: '7591000000161',
    sku: 'LEC-1L',
    name: 'Leche entera 1L',
    price: 1.8,
    stock: 4,
    minStock: 5,
    exempt: true,
    glyph: '🥛',
    cat: 'alimentos',
  },
  {
    id: 'P-0006',
    barcode: '7591000000178',
    sku: 'GAL-CHO',
    name: 'Galletas chocolate 200g',
    price: 3.4,
    stock: 18,
    minStock: 5,
    glyph: '🍪',
    cat: 'alimentos',
  },
  {
    id: 'P-0007',
    barcode: '7591000000185',
    sku: 'ARR-1KG',
    name: 'Arroz blanco 1kg',
    price: 2.1,
    stock: 32,
    minStock: 5,
    exempt: true,
    glyph: '🍚',
    cat: 'alimentos',
  },
  {
    id: 'P-0008',
    barcode: '7591000000192',
    sku: 'ACE-1L',
    name: 'Aceite vegetal 1L',
    price: 4.5,
    stock: 2,
    minStock: 5,
    exempt: true,
    glyph: '🫒',
    cat: 'alimentos',
  },
  // Farmacia OTC
  {
    id: 'P-0101',
    barcode: '7592000000110',
    sku: 'PARA-500',
    name: 'Paracetamol 500mg ×20',
    price: 3.2,
    stock: 14,
    minStock: 5,
    exempt: true,
    glyph: '💊',
    cat: 'farmacia',
  },
  {
    id: 'P-0102',
    barcode: '7592000000127',
    sku: 'IBU-400',
    name: 'Ibuprofeno 400mg ×10',
    price: 4.1,
    stock: 9,
    minStock: 5,
    exempt: true,
    glyph: '💊',
    cat: 'farmacia',
  },
  {
    id: 'P-0103',
    barcode: '7592000000134',
    sku: 'ALCO-70',
    name: 'Alcohol etílico 70% 250ml',
    price: 2.3,
    stock: 22,
    minStock: 5,
    glyph: '🧴',
    cat: 'farmacia',
  },
  // Limpieza
  {
    id: 'P-0201',
    barcode: '7593000000115',
    sku: 'DET-1L',
    name: 'Detergente líquido 1L',
    price: 6.4,
    stock: 11,
    minStock: 5,
    glyph: '🧼',
    cat: 'limpieza',
  },
  {
    id: 'P-0202',
    barcode: '7593000000122',
    sku: 'CLO-1L',
    name: 'Cloro 1L',
    price: 1.9,
    stock: 16,
    minStock: 5,
    glyph: '🧴',
    cat: 'limpieza',
  },
  {
    id: 'P-0203',
    barcode: '7593000000139',
    sku: 'PAP-12U',
    name: 'Papel higiénico ×12',
    price: 8.9,
    stock: 7,
    minStock: 5,
    glyph: '🧻',
    cat: 'limpieza',
  },
  // Ferretería
  {
    id: 'P-0301',
    barcode: '7594000000118',
    sku: 'TOR-1/4',
    name: 'Tornillo 1/4" ×100',
    price: 4.8,
    stock: 5,
    minStock: 5,
    glyph: '🔩',
    cat: 'ferreteria',
  },
  {
    id: 'P-0302',
    barcode: '7594000000125',
    sku: 'CIN-AIS',
    name: 'Cinta aislante negra',
    price: 1.1,
    stock: 28,
    minStock: 5,
    glyph: '⚡',
    cat: 'ferreteria',
  },
  {
    id: 'P-0303',
    barcode: '7594000000132',
    sku: 'PIN-1GAL',
    name: 'Pintura blanca 1gal',
    price: 22.5,
    stock: 3,
    minStock: 5,
    glyph: '🎨',
    cat: 'ferreteria',
  },
  {
    id: 'P-0304',
    barcode: '7594000000149',
    sku: 'FOC-9W',
    name: 'Foco LED 9W',
    price: 2.8,
    stock: 41,
    minStock: 5,
    glyph: '💡',
    cat: 'ferreteria',
  },
  // Hogar / cosméticos
  {
    id: 'P-0401',
    barcode: '7595000000116',
    sku: 'CHA-400',
    name: 'Champú herbal 400ml',
    price: 5.2,
    stock: 12,
    minStock: 5,
    glyph: '🧴',
    cat: 'hogar',
  },
  {
    id: 'P-0402',
    barcode: '7595000000123',
    sku: 'PIL-AAA',
    name: 'Pilas AAA ×4',
    price: 2.4,
    stock: 25,
    minStock: 5,
    glyph: '🔋',
    cat: 'hogar',
  },
];

type MockClient = {
  id: string;
  name: string;
  taxPrefix: 'V' | 'J' | 'E';
  taxId: string;
  email: string | null;
  phone: string;
  address: string;
  kind: 'person' | 'business' | 'foreign';
  createdAt: string;
};

const CLIENTS: MockClient[] = [
  {
    id: 'C-0002',
    name: 'María González',
    taxPrefix: 'V',
    taxId: '5.123.456',
    email: 'maria@correo.com',
    phone: '+507 6000-1122',
    address: 'Calle 50, Edificio Sky',
    kind: 'person',
    createdAt: '2024-02-10',
  },
  {
    id: 'C-0003',
    name: 'Juan Pérez',
    taxPrefix: 'V',
    taxId: '8.456.789',
    email: 'jperez@correo.com',
    phone: '+507 6000-3344',
    address: 'Vía España, Casa 12',
    kind: 'person',
    createdAt: '2024-03-22',
  },
  {
    id: 'C-0004',
    name: 'Restaurante La Estancia',
    taxPrefix: 'J',
    taxId: '15564124-0',
    email: 'compras@laestancia.com',
    phone: '+507 269-0000',
    address: 'Av. Balboa, Local 4',
    kind: 'business',
    createdAt: '2024-05-08',
  },
  {
    id: 'C-0005',
    name: 'Ferretería El Tornillo',
    taxPrefix: 'J',
    taxId: '99231720-4',
    email: 'admin@tornilloferreteria.com',
    phone: '+507 220-7733',
    address: 'C. Central 123',
    kind: 'business',
    createdAt: '2024-06-19',
  },
  {
    id: 'C-0006',
    name: 'Ana Castillo',
    taxPrefix: 'V',
    taxId: '3.789.012',
    email: 'ana.c@correo.com',
    phone: '+507 6000-5566',
    address: 'San Francisco, PH Marina',
    kind: 'person',
    createdAt: '2024-08-30',
  },
  {
    id: 'C-0007',
    name: 'Café del Centro',
    taxPrefix: 'J',
    taxId: '77123223-1',
    email: null,
    phone: '+507 261-1144',
    address: 'Casco Antiguo, Calle 8',
    kind: 'business',
    createdAt: '2024-11-14',
  },
  {
    id: 'C-0008',
    name: 'Luis Mendoza',
    taxPrefix: 'V',
    taxId: '4.321.654',
    email: 'luis.m@correo.com',
    phone: '+507 6000-7788',
    address: 'Av. Central, Casa 8',
    kind: 'person',
    createdAt: '2025-01-25',
  },
  {
    id: 'C-0009',
    name: 'John Smith',
    taxPrefix: 'E',
    taxId: '82.456.103',
    email: 'john.smith@mail.com',
    phone: '04141234567',
    address: 'Av. Libertador, Torre B',
    kind: 'foreign',
    createdAt: '2025-03-09',
  },
  {
    id: 'C-0010',
    name: 'Giovanni Rossi',
    taxPrefix: 'E',
    taxId: '84.012.778',
    email: 'g.rossi@mail.com',
    phone: '04249988776',
    address: 'Calle Madrid, Res. Roma',
    kind: 'foreign',
    createdAt: '2025-04-17',
  },
  {
    id: 'C-0011',
    name: 'Mei Lin',
    taxPrefix: 'E',
    taxId: '83.665.201',
    email: 'mei.lin@mail.com',
    phone: '04161122334',
    address: 'Av. Bolívar, Local 9',
    kind: 'foreign',
    createdAt: '2025-06-02',
  },
];

type PermMap = {
  view_reports: boolean;
  void_sales: boolean;
  manage_products: boolean;
  manage_clients: boolean;
  manage_employees: boolean;
  manage_settings: boolean;
};

// Replicates the prototype's `_perms(...granted)` helper exactly.
const perms = (...granted: Array<keyof PermMap>): PermMap => ({
  view_reports: granted.includes('view_reports'),
  void_sales: granted.includes('void_sales'),
  manage_products: granted.includes('manage_products'),
  manage_clients: granted.includes('manage_clients'),
  manage_employees: granted.includes('manage_employees'),
  manage_settings: granted.includes('manage_settings'),
});

type MockEmployee = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'owner' | 'admin' | 'cajero';
  active: boolean;
  pin: string;
  createdAt: string;
  lastActive: string;
  permissions: 'all' | PermMap;
};

const EMPLOYEES: MockEmployee[] = [
  {
    id: 'E-0001',
    name: 'Carlos Méndez',
    email: 'carlos@mitienda.com',
    phone: '04141112233',
    role: 'owner',
    active: true,
    pin: '482106',
    createdAt: '2024-01-15',
    lastActive: '2026-06-05T18:42:00',
    permissions: 'all',
  },
  {
    id: 'E-0002',
    name: 'Lucía Fernández',
    email: 'lucia.fernandez@mitienda.com',
    phone: '04148887766',
    role: 'admin',
    active: true,
    pin: '741022',
    createdAt: '2024-02-01',
    lastActive: '2026-06-05T19:02:00',
    permissions: 'all',
  },
  {
    id: 'E-0003',
    name: 'Roberto Salazar',
    email: 'roberto.salazar@mitienda.com',
    phone: '04263334455',
    role: 'admin',
    active: true,
    pin: '369014',
    createdAt: '2024-07-12',
    lastActive: '2026-06-05T16:20:00',
    permissions: perms(
      'view_reports',
      'void_sales',
      'manage_products',
      'manage_clients'
    ),
  },
  {
    id: 'E-0004',
    name: 'Juan Pérez',
    email: 'juan.perez@mitienda.com',
    phone: '04149876543',
    role: 'cajero',
    active: true,
    pin: '135708',
    createdAt: '2024-03-02',
    lastActive: '2026-06-05T17:10:00',
    permissions: perms('view_reports', 'manage_clients'),
  },
  {
    id: 'E-0005',
    name: 'María López',
    email: 'maria.lopez@mitienda.com',
    phone: '04265544332',
    role: 'cajero',
    active: true,
    pin: '246819',
    createdAt: '2024-05-19',
    lastActive: '2026-06-04T20:05:00',
    permissions: perms('view_reports', 'manage_clients'),
  },
  {
    id: 'E-0006',
    name: 'Ana Torres',
    email: 'ana.torres@mitienda.com',
    phone: '04167788990',
    role: 'cajero',
    active: true,
    pin: '975330',
    createdAt: '2025-01-08',
    lastActive: '2026-06-05T12:30:00',
    permissions: perms('manage_clients'),
  },
  {
    id: 'E-0007',
    name: 'Pedro Ramírez',
    email: 'pedro.ramirez@mitienda.com',
    phone: '04141239988',
    role: 'cajero',
    active: true,
    pin: '582441',
    createdAt: '2025-03-21',
    lastActive: '2026-06-05T14:48:00',
    permissions: perms('view_reports', 'void_sales', 'manage_clients'),
  },
  {
    id: 'E-0008',
    name: 'Gabriela Ruiz',
    email: 'gabriela.ruiz@mitienda.com',
    phone: '04249871122',
    role: 'cajero',
    active: true,
    pin: '613527',
    createdAt: '2025-06-10',
    lastActive: '2026-06-05T11:05:00',
    permissions: perms('manage_clients', 'manage_products'),
  },
  {
    id: 'E-0009',
    name: 'Carlos Rivas',
    email: 'carlos.rivas@mitienda.com',
    phone: '04122233445',
    role: 'cajero',
    active: false,
    pin: '864253',
    createdAt: '2024-09-23',
    lastActive: '2026-04-28T19:15:00',
    permissions: perms('view_reports'),
  },
  {
    id: 'E-0010',
    name: 'Daniela Mora',
    email: 'daniela.mora@mitienda.com',
    phone: '04161122334',
    role: 'cajero',
    active: false,
    pin: '207961',
    createdAt: '2025-02-14',
    lastActive: '2026-03-30T10:40:00',
    permissions: perms('manage_clients'),
  },
];

// Cashier short names used in SALES → mock employee ids.
const CASHIER_TO_EMPLOYEE: Record<string, string> = {
  'Juan P.': 'E-0004', // Juan Pérez
  'María L.': 'E-0005', // María López
  'Carlos R.': 'E-0009', // Carlos Rivas
  'Ana T.': 'E-0006', // Ana Torres
};

type MockSale = {
  invoice: string;
  hoursAgo: number;
  clientId: string;
  items: Array<[string, number]>;
  method: string;
  splits: Array<{ method: string; amount: number }> | null;
  cashier: string;
};

const mk = (
  invoice: string,
  hoursAgo: number,
  clientId: string,
  items: Array<[string, number]>,
  method: string,
  splits: Array<{ method: string; amount: number }> | null,
  cashier: string
): MockSale => ({
  invoice,
  hoursAgo,
  clientId,
  items,
  method,
  splits,
  cashier,
});

// The 36 _mkSale calls, replicated EXACTLY (invoices 00000007–00000042).
const SALES_HISTORY: MockSale[] = [
  // Today (hours ago)
  mk(
    '00000042',
    0.5,
    'C-0002',
    [
      ['P-0001', 2],
      ['P-0006', 1],
      ['P-0008', 1],
    ],
    'cash',
    null,
    'Juan P.'
  ),
  mk(
    '00000041',
    1.2,
    'C-0003',
    [
      ['P-0005', 1],
      ['P-0103', 1],
    ],
    'card',
    null,
    'María L.'
  ),
  mk(
    '00000040',
    1.8,
    'C-0006',
    [
      ['P-0301', 1],
      ['P-0302', 3],
    ],
    'cash',
    null,
    'Carlos R.'
  ),
  mk(
    '00000039',
    2.4,
    'C-0004',
    [
      ['P-0007', 4],
      ['P-0202', 2],
      ['P-0203', 1],
    ],
    'transfer',
    null,
    'Ana T.'
  ),
  mk('00000038', 3.1, 'C-0007', [['P-0004', 2]], 'mobile', null, 'Juan P.'),
  mk(
    '00000037',
    3.9,
    'C-0008',
    [
      ['P-0402', 2],
      ['P-0304', 4],
    ],
    'cash',
    null,
    'María L.'
  ),
  mk(
    '00000036',
    4.5,
    'C-0002',
    [
      ['P-0101', 1],
      ['P-0102', 1],
    ],
    'card',
    null,
    'Carlos R.'
  ),
  mk(
    '00000035',
    5.2,
    'C-0005',
    [
      ['P-0303', 2],
      ['P-0301', 2],
    ],
    'transfer',
    null,
    'Ana T.'
  ),
  mk('00000034', 6.0, 'C-0003', [['P-0001', 6]], 'cash', null, 'Juan P.'),
  mk(
    '00000033',
    6.8,
    'C-0004',
    [
      ['P-0201', 3],
      ['P-0203', 2],
    ],
    'card',
    [
      { method: 'card', amount: 12.0 },
      { method: 'cash', amount: 14.5 },
    ],
    'María L.'
  ),
  mk(
    '00000032',
    7.5,
    'C-0007',
    [
      ['P-0006', 4],
      ['P-0007', 2],
    ],
    'mobile',
    null,
    'Carlos R.'
  ),
  mk('00000031', 8.3, 'C-0008', [['P-0002', 12]], 'cash', null, 'Ana T.'),
  // Yesterday
  mk(
    '00000030',
    25.0,
    'C-0002',
    [
      ['P-0001', 3],
      ['P-0005', 2],
    ],
    'card',
    null,
    'Juan P.'
  ),
  mk('00000029', 26.5, 'C-0003', [['P-0401', 2]], 'cash', null, 'María L.'),
  mk(
    '00000028',
    28.0,
    'C-0006',
    [
      ['P-0302', 5],
      ['P-0304', 2],
    ],
    'card',
    null,
    'Carlos R.'
  ),
  mk(
    '00000027',
    29.2,
    'C-0004',
    [
      ['P-0007', 6],
      ['P-0008', 3],
    ],
    'transfer',
    null,
    'Ana T.'
  ),
  mk(
    '00000026',
    31.0,
    'C-0005',
    [
      ['P-0301', 4],
      ['P-0303', 1],
    ],
    'transfer',
    null,
    'Juan P.'
  ),
  mk(
    '00000025',
    33.5,
    'C-0008',
    [
      ['P-0103', 2],
      ['P-0102', 1],
    ],
    'mobile',
    null,
    'María L.'
  ),
  mk(
    '00000024',
    36.0,
    'C-0007',
    [
      ['P-0004', 3],
      ['P-0006', 5],
    ],
    'card',
    null,
    'Carlos R.'
  ),
  mk(
    '00000023',
    38.7,
    'C-0002',
    [
      ['P-0202', 1],
      ['P-0201', 1],
    ],
    'cash',
    null,
    'Ana T.'
  ),
  // 2-3 days ago
  mk(
    '00000022',
    52.0,
    'C-0003',
    [
      ['P-0001', 4],
      ['P-0002', 6],
    ],
    'cash',
    null,
    'Juan P.'
  ),
  mk('00000021', 54.5, 'C-0006', [['P-0402', 4]], 'mobile', null, 'María L.'),
  mk(
    '00000020',
    60.0,
    'C-0004',
    [
      ['P-0007', 8],
      ['P-0008', 4],
    ],
    'transfer',
    null,
    'Carlos R.'
  ),
  mk('00000019', 72.0, 'C-0005', [['P-0303', 3]], 'transfer', null, 'Ana T.'),
  mk(
    '00000018',
    78.0,
    'C-0008',
    [
      ['P-0005', 4],
      ['P-0006', 2],
    ],
    'cash',
    null,
    'Juan P.'
  ),
  mk(
    '00000017',
    84.0,
    'C-0002',
    [
      ['P-0103', 3],
      ['P-0101', 2],
    ],
    'card',
    null,
    'María L.'
  ),
  // This week
  mk(
    '00000016',
    100.0,
    'C-0007',
    [
      ['P-0004', 5],
      ['P-0006', 8],
    ],
    'mobile',
    null,
    'Carlos R.'
  ),
  mk('00000015', 108.0, 'C-0003', [['P-0001', 12]], 'card', null, 'Ana T.'),
  mk('00000014', 120.0, 'C-0008', [['P-0203', 2]], 'cash', null, 'Juan P.'),
  mk(
    '00000013',
    132.0,
    'C-0004',
    [
      ['P-0007', 10],
      ['P-0008', 5],
    ],
    'transfer',
    null,
    'María L.'
  ),
  mk(
    '00000012',
    144.0,
    'C-0005',
    [
      ['P-0301', 6],
      ['P-0302', 4],
    ],
    'card',
    null,
    'Carlos R.'
  ),
  mk('00000011', 156.0, 'C-0002', [['P-0401', 1]], 'cash', null, 'Ana T.'),
  // Last week
  mk(
    '00000010',
    192.0,
    'C-0006',
    [
      ['P-0103', 2],
      ['P-0102', 2],
    ],
    'mobile',
    null,
    'Juan P.'
  ),
  mk('00000009', 216.0, 'C-0003', [['P-0005', 6]], 'cash', null, 'María L.'),
  mk('00000008', 240.0, 'C-0007', [['P-0004', 4]], 'card', null, 'Carlos R.'),
  mk('00000007', 264.0, 'C-0004', [['P-0007', 12]], 'transfer', null, 'Ana T.'),
];

// ---------------------------------------------------------------------------
// Seed mutation (idempotent)
// ---------------------------------------------------------------------------

export const run = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const existing = await ctx.db.query('settings').first();
    if (existing) return 'already seeded';

    // 1. Categories (the mock 'all' entry is UI-only — not inserted).
    const catIdBySlug = new Map<string, Id<'categories'>>();
    for (const { slug, label } of CATEGORY_LABELS) {
      catIdBySlug.set(slug, await ctx.db.insert('categories', { label }));
    }

    // 2. Products.
    const productIdByMock = new Map<string, Id<'products'>>();
    for (const p of CATALOG) {
      const id = await ctx.db.insert('products', {
        barcode: p.barcode,
        sku: p.sku,
        name: p.name,
        price: p.price,
        stock: p.stock,
        minStock: p.minStock,
        categoryId: catIdBySlug.get(p.cat)!,
        ...(p.exempt === true ? { exempt: true } : {}),
        glyph: p.glyph,
      });
      productIdByMock.set(p.id, id);
    }

    // 3. Clients (omit null emails).
    const clientIdByMock = new Map<string, Id<'clients'>>();
    for (const c of CLIENTS) {
      const id = await ctx.db.insert('clients', {
        name: c.name,
        taxPrefix: c.taxPrefix,
        taxId: c.taxId,
        kind: c.kind,
        ...(c.email !== null ? { email: c.email } : {}),
        phone: c.phone,
        address: c.address,
        createdAt: Date.parse(c.createdAt),
      });
      clientIdByMock.set(c.id, id);
    }

    // 4. Employees — AUTH-4: hash each PIN fresh; never store plaintext.
    const employeeIdByMock = new Map<string, Id<'employees'>>();
    for (const e of EMPLOYEES) {
      const { pinHash, pinSalt } = await hashPin(e.pin);
      const id = await ctx.db.insert('employees', {
        name: e.name,
        email: e.email,
        phone: e.phone,
        role: e.role,
        permissions: e.permissions,
        pinHash,
        pinSalt,
        active: e.active,
        createdAt: Date.parse(e.createdAt),
        lastActive: Date.parse(e.lastActive),
      });
      employeeIdByMock.set(e.id, id);
    }

    // 5. Settings singleton.
    await ctx.db.insert('settings', {
      storeName: 'Tienda Ejemplo, C.A',
      storeRif: 'J-31234567-8',
      phone: '+507 269-0000',
      address: 'Av. Principal 123, Urb. Centro, Caracas',
      currency: 'USD',
      taxName: 'IVA',
      ivaPct: 13,
      bsRate: 36.5,
      nextInvoiceNumber: 43,
      nextHeldCode: 1001,
      printAuto: true,
      emailReceipt: false,
      lowStockAlerts: true,
      soundScan: true,
      scannerMode: 'physical',
    });

    // 6. Sales — MOCK math on purpose (subtotal·0.13, NOT exempt-aware) and
    //    item `cat` is the mock SLUG, with no exempt flag, to mirror _mkSale.
    const now = Date.now();
    for (const s of SALES_HISTORY) {
      const mockClient = CLIENTS.find((c) => c.id === s.clientId)!;
      const items = s.items.map(([mockId, qty]) => {
        const p = CATALOG.find((x) => x.id === mockId)!;
        return {
          productId: productIdByMock.get(mockId)!,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          cat: p.cat,
          price: p.price,
          glyph: p.glyph,
          qty,
        };
      });
      const subtotalRaw = items.reduce((sum, i) => sum + i.price * i.qty, 0);
      // Every seeded sale is an invoice — IVA always applies (mock 13%, the same
      // non-exempt-aware math the prototype's _mkSale used).
      const taxRaw = subtotalRaw * 0.13;
      await ctx.db.insert('sales', {
        invoiceNumber: s.invoice,
        clientId: clientIdByMock.get(s.clientId)!,
        client: {
          name: mockClient.name,
          taxPrefix: mockClient.taxPrefix,
          taxId: mockClient.taxId,
          kind: mockClient.kind,
          ...(mockClient.email !== null ? { email: mockClient.email } : {}),
          phone: mockClient.phone,
          address: mockClient.address,
        },
        cashierId: employeeIdByMock.get(CASHIER_TO_EMPLOYEE[s.cashier])!,
        cashierName: s.cashier,
        items,
        subtotal: fix2(subtotalRaw),
        tax: fix2(taxRaw),
        total: fix2(subtotalRaw + taxRaw),
        method: s.method,
        ...(s.splits !== null ? { splits: s.splits } : {}),
        ivaPct: 13,
        exchangeRate: 36.5,
        soldAt: now - s.hoursAgo * 3600000,
      });
    }

    // 7. No heldCarts seeds.
    return 'seeded';
  },
});

// Verification helpers (internal — not part of the app's API).
export const verify = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    // Same code path auth.me uses for stale localStorage ids.
    const staleNormalized = ctx.db.normalizeId(
      'employees',
      'stale-id-from-old-deployment'
    );
    const employees = await ctx.db.query('employees').collect();
    const owner =
      employees.find((e) => e.email === 'carlos@mitienda.com') ?? null;
    const byInvoice = async (n: string) =>
      await ctx.db
        .query('sales')
        .withIndex('by_invoice', (q) => q.eq('invoiceNumber', n))
        .first();
    const sale42 = await byInvoice('00000042');
    const sale33 = await byInvoice('00000033');
    const sale40 = await byInvoice('00000040');
    const settings = await ctx.db.query('settings').first();
    return {
      staleIdNormalizesToNull: staleNormalized === null,
      // AUTH-4: pin field is gone; verify via PBKDF2 round-trip instead.
      owner: owner && {
        active: owner.active,
        role: owner.role,
        permissions: owner.permissions,
        pinHashValid: await verifyPin('482106', owner.pinSalt, owner.pinHash),
      },
      sale42: sale42 && {
        subtotal: sale42.subtotal,
        tax: sale42.tax,
        total: sale42.total,
        cashierName: sale42.cashierName,
        itemCats: sale42.items.map((i) => i.cat),
      },
      sale33splits: sale33?.splits ?? null,
      sale40tax: sale40?.tax,
      settings: settings && {
        nextInvoiceNumber: settings.nextInvoiceNumber,
        nextHeldCode: settings.nextHeldCode,
        ivaPct: settings.ivaPct,
        bsRate: settings.bsRate,
      },
    };
  },
});

export const counts = internalQuery({
  args: {},
  returns: v.object({
    categories: v.number(),
    products: v.number(),
    clients: v.number(),
    employees: v.number(),
    sales: v.number(),
    settings: v.number(),
    heldCarts: v.number(),
  }),
  handler: async (ctx) => {
    return {
      categories: (await ctx.db.query('categories').collect()).length,
      products: (await ctx.db.query('products').collect()).length,
      clients: (await ctx.db.query('clients').collect()).length,
      employees: (await ctx.db.query('employees').collect()).length,
      sales: (await ctx.db.query('sales').collect()).length,
      settings: (await ctx.db.query('settings').collect()).length,
      heldCarts: (await ctx.db.query('heldCarts').collect()).length,
    };
  },
});

/**
 * Dev reset: wipe every table so `seed:run` can repopulate from scratch.
 * Internal-only — never callable from clients. Destructive by design.
 */
export const clearAll = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const tables = [
      'sales',
      'heldCarts',
      'products',
      'categories',
      'clients',
      'employees',
      'settings',
    ] as const;
    for (const table of tables) {
      const docs = await ctx.db.query(table).collect();
      for (const doc of docs) {
        await ctx.db.delete(table, doc._id);
      }
    }
    return null;
  },
});
