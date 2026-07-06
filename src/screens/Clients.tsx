// Clients screen — ported from prototype clients.jsx: list + add/edit + per-row details.
// Also exports a ClientPickerSheet used by SaleScreen to attach a client to a sale.
// Data wiring: useClients() (Phase 3 — Dexie-mirrored, offline-capable list) +
// Convex mutations (clients.create / clients.update / clients.remove) — no local
// setClients plumbing, reactivity refreshes the list. createdAt is epoch ms.
// Offline (FEATURES §18): the list/search stay available from the mirror, but the
// admin writes (create/edit/delete) are blocked via an `online` prop + a "Sin
// conexión" Banner — offline customer drafts (CUSTOMER_CREATE) arrive in Phase 6.
import { useEffect, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
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
  useToast,
} from '@/components';
import { useSession } from '@/state/SessionContext';
import { useOnline } from '@/state/useOnline';
import { useClients } from '@/state/hooks';
import type { Client } from '@/types';
import { DateField } from './Stored';

export function clientGlyph(c: { kind?: string; name?: string }) {
  if (c.kind === 'business') return '🏢';
  return (c.name?.[0] || '?').toUpperCase();
}

// Prototype took an ISO date string; Convex stores epoch ms (new Date(ms) works directly).
export function fmtClientCreated(ms?: number) {
  if (!ms) return '—';
  const d = new Date(ms);
  const m = d.toLocaleDateString('es', { month: 'long' });
  return `${String(d.getDate()).padStart(2, '0')} ${m.charAt(0).toUpperCase() + m.slice(1)} ${d.getFullYear()}`;
}

// Format a Venezuelan cédula as digit groups of 3 separated by dots: 12.345.678
export function formatCedula(input?: string | null) {
  const digits = String(input || '')
    .replace(/\D/g, '')
    .slice(0, 9);
  if (!digits) return '';
  // Group from the right: 12345678 → 12.345.678
  const parts: string[] = [];
  let i = digits.length;
  while (i > 0) {
    parts.unshift(digits.slice(Math.max(0, i - 3), i));
    i -= 3;
  }
  return parts.join('.');
}

// Format a Venezuelan RIF as digits with a hyphen before the last digit: 12345678-9
export function formatRif(input?: string | null) {
  const digits = String(input || '')
    .replace(/\D/g, '')
    .slice(0, 10);
  if (digits.length <= 1) return digits;
  return digits.slice(0, digits.length - 1) + '-' + digits.slice(-1);
}

export function formatTaxId(prefix: string, raw?: string | null) {
  if (prefix === 'J') return formatRif(raw);
  return formatCedula(raw);
}

// Map client kind → default tax prefix
export function defaultPrefix(kind?: string): Client['taxPrefix'] {
  if (kind === 'business') return 'J';
  if (kind === 'foreign') return 'E';
  return 'V';
}

// Epoch ms → local YYYY-MM-DD (replaces the prototype's `iso.slice(0, 10)` in
// the date-range filter; same convention stored.jsx used with DateField).
const localDay = (ms?: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface ClientRowProps {
  client: Client;
  onPick?: (c: Client) => void;
  action?: ReactNode;
}

export function ClientRow({ client, onPick, action }: ClientRowProps) {
  const taxDisplay = client.taxId
    ? client.taxPrefix
      ? `${client.taxPrefix}-${client.taxId}`
      : client.taxId
    : null;
  return (
    <div
      className="lrow"
      onClick={onPick ? () => onPick(client) : undefined}
      style={onPick ? { cursor: 'pointer' } : undefined}
    >
      <div className="thumb" aria-hidden="true">
        {clientGlyph(client)}
      </div>
      <div>
        <p className="pname">{client.name}</p>
        <div className="pmeta client-pmeta">
          {taxDisplay ? (
            <span>{taxDisplay}</span>
          ) : (
            <span className="muted">Sin identificación</span>
          )}
          {client.phone && <span>{client.phone}</span>}
        </div>
      </div>
      {action && <div className="pright">{action}</div>}
      <div className="lrow-chevron">
        <Icon name="chevron-right" size={18} />
      </div>
    </div>
  );
}

function ClientDetailSheet({
  client,
  onClose,
  onEdit,
  onDelete,
  online,
}: {
  client: Client | null;
  onClose: () => void;
  onEdit: (c: Client) => void;
  onDelete: (c: Client) => void;
  /** Offline blocks the writes (FEATURES §18): edit / delete. */
  online: boolean;
}) {
  if (!client) return null;
  const taxDisplay = client.taxId
    ? client.taxPrefix
      ? `${client.taxPrefix}-${client.taxId}`
      : client.taxId
    : null;
  const kindLabel =
    client.kind === 'business'
      ? 'Empresa / Negocio'
      : client.kind === 'foreign'
        ? 'Extranjero'
        : 'Persona natural';
  const kindTone =
    client.kind === 'business'
      ? 'info'
      : client.kind === 'foreign'
        ? 'warn'
        : 'ok';
  const kindChip =
    client.kind === 'business'
      ? 'Empresa'
      : client.kind === 'foreign'
        ? 'Extranjero'
        : 'Persona';

  return (
    <Sheet onClose={onClose} title="Detalle del cliente">
      <div className="prod-detail">
        {!online && (
          <Banner
            tone="warn"
            icon="wifi-off"
            title="Sin conexión"
            message="No disponible sin conexión. Editar y eliminar requieren conexión."
          />
        )}
        <div className="prod-detail-head">
          <div className="prod-detail-glyph">{clientGlyph(client)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="prod-detail-name">{client.name}</div>
            <Chip tone={kindTone} style={{ marginTop: 6 }}>
              {kindChip}
            </Chip>
          </div>
        </div>

        <div className="prod-detail-rows">
          <div className="prod-detail-row">
            <span className="k">Identificación fiscal</span>
            <span className="v mono">{taxDisplay || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Tipo</span>
            <span className="v">{kindLabel}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Teléfono</span>
            <span className="v">{client.phone || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Email</span>
            <span className="v">{client.email || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Dirección</span>
            <span className="v" style={{ textAlign: 'right', maxWidth: '60%' }}>
              {client.address || '—'}
            </span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Cliente desde</span>
            <span className="v">{fmtClientCreated(client.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="prod-detail-actions">
        <Button
          icon="edit-3"
          onClick={() => onEdit(client)}
          block
          disabled={!online}
        >
          Editar
        </Button>
        <div className="row" style={{ gap: 10 }}>
          <Button
            variant="danger"
            icon="trash-2"
            onClick={() => onDelete(client)}
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

/** What ClientForm hands to onSave (form fields + kind derived from the prefix). */
interface ClientFormValues {
  name: string;
  taxPrefix: Client['taxPrefix'];
  taxId: string;
  email: string;
  phone: string;
  address: string;
  kind: Client['kind'];
}

export interface ClientFormProps {
  // Partial: the Venta client gate prefils only { taxPrefix, taxId } for inline creation.
  initial?: Partial<Client> | null;
  onSave: (form: ClientFormValues) => void;
  onCancel: () => void;
  /** Offline blocks the write (FEATURES §18) — create/edit require connection. */
  online: boolean;
  /**
   * Phase 6.2 — Venta only. When true the offline write is QUEUED (CUSTOMER_CREATE)
   * instead of blocked, so Save stays enabled offline and the notice explains the
   * client will sync on reconnect. Clients.tsx admin create/edit leaves it false
   * (stays blocked offline).
   */
  queueOffline?: boolean;
}

export function ClientForm({
  initial,
  onSave,
  onCancel,
  online,
  queueOffline = false,
}: ClientFormProps) {
  const kindFromPrefix = (p: string): Client['kind'] =>
    p === 'J' ? 'business' : p === 'E' ? 'foreign' : 'person';
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    taxPrefix: initial?.taxPrefix || defaultPrefix(initial?.kind),
    taxId: initial?.taxId || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    address: initial?.address || '',
  }));
  const kind = kindFromPrefix(form.taxPrefix);
  const update =
    (k: 'name' | 'email' | 'address') =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [k]: e.target.value });
  const updateTaxId = (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, taxId: formatTaxId(f.taxPrefix, e.target.value) }));
  const setPrefix = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Client['taxPrefix'];
    setForm((f) => ({
      ...f,
      taxPrefix: next,
      taxId: formatTaxId(next, f.taxId),
    }));
  };
  const canSave =
    form.name.trim().length > 1 &&
    !!form.taxPrefix &&
    form.taxId.trim().length > 0 &&
    form.phone.trim().length > 0 &&
    form.address.trim().length > 0;

  // For an existing client, only enable Save when something actually changed.
  const dirty = !initial
    ? true
    : form.name !== (initial.name || '') ||
      form.taxPrefix !== (initial.taxPrefix || defaultPrefix(initial.kind)) ||
      form.taxId !== (initial.taxId || '') ||
      form.email !== (initial.email || '') ||
      form.phone !== (initial.phone || '') ||
      form.address !== (initial.address || '');

  return (
    <div className="client-form">
      {!online && (
        <Banner
          tone="warn"
          icon="wifi-off"
          title="Sin conexión"
          message={
            queueOffline
              ? 'El cliente se guardará y se sincronizará al reconectar.'
              : 'No disponible sin conexión. Guardar el cliente requiere conexión.'
          }
        />
      )}
      <label className="client-field">
        <span>
          {kind === 'business' ? 'Nombre comercial' : 'Nombre y Apellido'}
          <span className="req"> *</span>
        </span>
        <Input
          value={form.name}
          onChange={update('name')}
          placeholder={
            kind === 'business'
              ? 'Razón social o nombre comercial'
              : 'Nombre y apellido'
          }
        />
      </label>
      <div className="client-field">
        <span>
          Identificación fiscal<span className="req"> *</span>
        </span>
        <div className="taxid-row">
          <select
            className="input cat-select taxid-prefix"
            value={form.taxPrefix}
            onChange={setPrefix}
            aria-label="Tipo de identificación"
            style={{ height: '48px', textAlign: 'left' }}
          >
            <option value="V">V</option>
            <option value="E">E</option>
            <option value="J">J</option>
          </select>
          <Input
            mono
            value={form.taxId}
            onChange={updateTaxId}
            inputMode="numeric"
            placeholder={form.taxPrefix === 'J' ? '12345678-9' : '12.345.678'}
          />
        </div>
      </div>
      <label className="client-field">
        <span>
          Teléfono<span className="req"> *</span>
        </span>
        <Input
          value={form.phone}
          onChange={(e) =>
            setForm({ ...form, phone: e.target.value.replace(/\s/g, '') })
          }
          placeholder="04140000000"
          inputMode="tel"
        />
      </label>
      <label className="client-field">
        <span>Email</span>
        <Input
          type="email"
          value={form.email}
          onChange={update('email')}
          placeholder="cliente@correo.com"
        />
      </label>
      <label className="client-field">
        <span>
          Dirección<span className="req"> *</span>
        </span>
        <textarea
          className="input client-textarea"
          rows={3}
          value={form.address}
          onChange={update('address')}
          placeholder="Calle / edificio / número"
        />
      </label>
      <div className="row client-actions" style={{ gap: 10, marginTop: 6 }}>
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          disabled={!canSave || !dirty || (!online && !queueOffline)}
          onClick={() => onSave({ ...form, kind })}
        >
          {initial ? 'Guardar cambios' : 'Crear cliente'}
        </Button>
      </div>
    </div>
  );
}

// --- Sheet that picks a client during a sale ----------------------------------

export interface ClientPickerSheetProps {
  clients: Client[];
  currentId?: string | null;
  onPick: (c: Client) => void;
  onClose: () => void;
  onCreate?: () => void;
  /** Offline blocks creating a client (FEATURES §18); search/pick stay available. */
  online: boolean;
  /**
   * Phase 6.2 — Venta only. When true, "Crear nuevo cliente" stays enabled offline
   * (the create is QUEUED, not blocked). Clients.tsx leaves it false.
   */
  queueOffline?: boolean;
}

export function ClientPickerSheet({
  clients,
  currentId,
  onPick,
  onClose,
  onCreate,
  online,
  queueOffline = false,
}: ClientPickerSheetProps) {
  const [q, setQ] = useState('');
  const norm = (s?: string) => (s || '').toLowerCase();
  const taxDisplay = (c: Client) =>
    c.taxId ? (c.taxPrefix ? `${c.taxPrefix}-${c.taxId}` : c.taxId) : '';
  const list = clients.filter((c) => {
    if (!q.trim()) return true;
    const term = norm(q);
    return (
      norm(c.name).includes(term) ||
      norm(taxDisplay(c)).includes(term) ||
      norm(c.phone).includes(term) ||
      norm(c.email).includes(term)
    );
  });

  return (
    <Sheet onClose={onClose} title="Asociar cliente">
      {!online && (
        <Banner
          tone="warn"
          icon="wifi-off"
          title="Sin conexión"
          message={
            queueOffline
              ? 'Puedes buscar, seleccionar o crear un cliente; el nuevo cliente se sincronizará al reconectar.'
              : 'Puedes buscar y seleccionar un cliente existente. Crear un cliente requiere conexión.'
          }
        />
      )}
      <Input
        autoFocus
        placeholder="Nombre, identificación, teléfono o email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div style={{ marginTop: 10 }}>
        <Button
          variant="secondary"
          icon="user-plus"
          onClick={() => onCreate && onCreate()}
          block
          disabled={!online && !queueOffline}
        >
          Crear nuevo cliente
        </Button>
      </div>
      <div
        className="search-results"
        style={{ marginTop: 12, textAlign: 'left' }}
      >
        {list.length === 0 ? (
          <div className="empty">
            <p>Sin resultados{q ? ` para “${q}”` : ''}</p>
          </div>
        ) : (
          list.map((c) => (
            <div
              className="lrow"
              key={c._id}
              onClick={() => onPick(c)}
              style={{ cursor: 'pointer' }}
            >
              <div className="thumb" aria-hidden="true">
                {clientGlyph(c)}
              </div>
              <div>
                <p className="pname">{c.name}</p>
                <div className="pmeta client-pmeta">
                  <span>
                    {taxDisplay(c) ? taxDisplay(c) : 'Sin identificación'}
                  </span>
                  {c.phone && <span>{c.phone}</span>}
                </div>
              </div>
              <div className="pright">
                {currentId === c._id && (
                  <Chip tone="ok">
                    <span className="hide-mobile">Seleccionado</span>
                    <span className="hide-desktop">
                      <Icon name="check" size={14} />
                    </span>
                  </Chip>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}

// --- Main full-screen clients list -------------------------------------------

export default function ClientsScreen() {
  const toast = useToast();
  const clients = useClients();
  const { token } = useSession();
  const online = useOnline();
  const createClient = useMutation(api.clients.create);
  const updateClient = useMutation(api.clients.update);
  const removeClient = useMutation(api.clients.remove);

  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState('name-asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null); // null = new
  const [detail, setDetail] = useState<Client | null>(null);
  const [confirmDel, setConfirmDel] = useState<Client | null>(null);

  const norm = (s?: string) => (s || '').toLowerCase();
  const list = clients
    .filter((c) => (kind === 'all' ? true : c.kind === kind))
    .filter((c) => {
      if (!fromDate || !toDate) return true;
      const cr = localDay(c.createdAt);
      return cr && cr >= fromDate && cr <= toDate;
    })
    .filter((c) => {
      if (!q.trim()) return true;
      const term = norm(q);
      const taxFull = c.taxPrefix ? `${c.taxPrefix}-${c.taxId}` : c.taxId || '';
      return (
        norm(c.name).includes(term) ||
        norm(taxFull).includes(term) ||
        norm(c.taxId).includes(term) ||
        norm(c.phone).includes(term) ||
        norm(c.email).includes(term)
      );
    })
    .slice()
    .sort((a, b) => {
      switch (sort) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        default:
          return 0;
      }
    });

  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.min(page, totalPages);
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [safePage, page]);
  const start = (safePage - 1) * pageSize;
  const visible = list.slice(start, start + pageSize);
  const showingFrom = list.length === 0 ? 0 : start + 1;
  const showingTo = Math.min(start + pageSize, list.length);

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (c: Client) => {
    setDetail(null);
    setEditing(c);
    setEditorOpen(true);
  };
  const openDetail = (c: Client) => setDetail(c);

  const save = async (form: ClientFormValues) => {
    if (!token) return;
    try {
      if (editing) {
        await updateClient({
          token,
          clientId: editing._id,
          patch: { ...form },
        });
      } else {
        await createClient({
          token,
          name: form.name,
          taxPrefix: form.taxPrefix,
          taxId: form.taxId,
          kind: form.kind,
          email: form.email || undefined,
          phone: form.phone || undefined,
          address: form.address || undefined,
        });
      }
      setEditorOpen(false);
    } catch (e: any) {
      toast.error(
        typeof e?.data === 'string'
          ? e.data
          : 'Ocurrió un error. Intenta de nuevo.'
      );
    }
  };

  const remove = async (client: Client) => {
    if (!token) return;
    try {
      await removeClient({ token, clientId: client._id });
    } catch (e: any) {
      toast.error(
        typeof e?.data === 'string'
          ? e.data
          : 'Ocurrió un error. Intenta de nuevo.'
      );
    }
    setConfirmDel(null);
    setDetail(null);
    setEditorOpen(false);
  };

  return (
    <>
      <AppBar
        title="Clientes"
        sub={`${clients.length} registrados`}
        online={online}
        /* left={onBack && <IconButton icon="chevron-left" onClick={onBack} ariaLabel="Volver" />} */
        right={
          <Button
            size="sm"
            icon="user-plus"
            onClick={openNew}
            disabled={!online}
          >
            Nuevo cliente
          </Button>
        }
      />

      <div className="content stored-content" style={{ padding: '5px' }}>
        {!online && (
          <Banner
            tone="warn"
            icon="wifi-off"
            title="Sin conexión"
            message="Solo lectura. No puedes crear, editar o eliminar clientes hasta reconectar."
          />
        )}
        <div className="catalog-head" style={{ margin: '0 0 14px' }}>
          <Input
            placeholder="Buscar cliente por nombre, identificación, teléfono o email"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />

          <div className="catalog-filters">
            <label className="catalog-filter">
              <span>Tipo</span>
              <select
                className="input cat-select"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Todos</option>
                <option value="person">Persona natural</option>
                <option value="business">Empresa / Negocio</option>
                <option value="foreign">Extranjero</option>
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
              </select>
            </label>
          </div>
        </div>

        <div className="hist-daterange-inline">
          <label className="catalog-filter">
            <span>Creado desde</span>
            <DateField
              value={fromDate}
              max={toDate || new Date().toISOString().slice(0, 10)}
              onChange={(v) => {
                setFromDate(v);
                setPage(1);
              }}
            />
          </label>
          <label className="catalog-filter">
            <span>Creado hasta</span>
            <DateField
              value={toDate}
              min={fromDate || undefined}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(v) => {
                setToDate(v);
                setPage(1);
              }}
            />
          </label>
        </div>

        <div className="card">
          {visible.length === 0 ? (
            <div className="empty" style={{ padding: '32px 16px' }}>
              <h4>Sin clientes</h4>
              <p>
                {q ? `Sin resultados para "${q}"` : 'Crea tu primer cliente'}
              </p>
            </div>
          ) : (
            visible.map((c) => (
              <ClientRow
                key={c._id}
                client={c}
                onPick={() => openDetail(c)}
                action={
                  <Chip
                    tone={
                      c.kind === 'business'
                        ? 'info'
                        : c.kind === 'foreign'
                          ? 'warn'
                          : 'ok'
                    }
                  >
                    {c.kind === 'business'
                      ? 'Empresa'
                      : c.kind === 'foreign'
                        ? 'Extranjero'
                        : 'Persona'}
                  </Chip>
                }
              />
            ))
          )}
        </div>

        {list.length > 0 && (
          <div className="pager pager-sticky">
            <div className="pager-info">
              {list.length <= pageSize ? (
                <>
                  {list.length} {list.length === 1 ? 'cliente' : 'clientes'}
                </>
              ) : (
                <>
                  Clientes{' '}
                  <strong>
                    {showingFrom}–{showingTo}
                  </strong>{' '}
                  de <strong>{list.length}</strong>
                </>
              )}
            </div>
            <div className="pager-size">
              <label htmlFor="clients-pager-size">Por página</label>
              <select
                id="clients-pager-size"
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
        <ClientDetailSheet
          client={detail}
          online={online}
          onClose={() => setDetail(null)}
          onEdit={openEdit}
          onDelete={(c) => setConfirmDel(c)}
        />
      )}

      {editorOpen && (
        <Sheet
          onClose={() => setEditorOpen(false)}
          title={editing ? 'Editar cliente' : 'Nuevo cliente'}
        >
          <ClientForm
            initial={editing}
            online={online}
            onSave={(...args: Parameters<typeof save>) => {
              void save(...args);
            }}
            onCancel={() => setEditorOpen(false)}
          />
        </Sheet>
      )}

      {confirmDel && (
        <ConfirmDialog
          title="¿Eliminar cliente?"
          message={`Se eliminará a ${confirmDel.name}. Esta acción no se puede deshacer.`}
          confirmLabel="Sí, eliminar"
          cancelLabel="Cancelar"
          tone="danger"
          onConfirm={() => void remove(confirmDel)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </>
  );
}
