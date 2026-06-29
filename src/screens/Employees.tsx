// Employees / Team screen — ported from prototype employees.jsx: owner-only RBAC
// management of cashiers. CRUD over employees with per-cashier permission toggles
// + active status.
// Data wiring: api.employees.list (server already excludes the logged-in actor) +
// employees.create / employees.update / employees.remove mutations — Convex
// reactivity refreshes the list. createdAt / lastActive are epoch ms.
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery } from 'convex/react';
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
} from '@/components';
import { useSession } from '@/state/SessionContext';
import { useOnline } from '@/state/useOnline';
import { PERMISSIONS, ROLE_LABELS } from '@/lib/rbac';
import type { PermissionInfo, PermissionMap } from '@/lib/rbac';
import type { Employee } from '@/types';
import { DateField } from './Stored';

function initials(name?: string) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return (
    parts
      .map((p) => p[0])
      .join('')
      .toUpperCase() || '?'
  );
}

// Prototype took ISO date strings; Convex stores epoch ms (new Date(ms) works directly).
function _fmtCreatedShort(ms?: number) {
  if (!ms) return '';
  const d = new Date(ms);
  const m = d.toLocaleDateString('es', { month: 'short' }).replace('.', '');
  return `${String(d.getDate()).padStart(2, '0')} ${m.charAt(0).toUpperCase() + m.slice(1)} ${d.getFullYear()}`;
}

function fmtLastActive(ms?: number) {
  if (!ms) return 'Nunca';
  const d = new Date(ms);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return d.toLocaleDateString('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function permCount(emp: Employee) {
  if (emp.permissions === 'all') return PERMISSIONS.length;
  const granted = emp.permissions;
  return PERMISSIONS.filter((p) => granted && granted[p.id]).length;
}

// Epoch ms → local YYYY-MM-DD (replaces the prototype's `iso.slice(0, 10)` in
// the date-range filter; same convention stored.jsx used with DateField).
const localDay = (ms?: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// --- A single permission toggle row -----------------------------------------
function PermToggleRow({
  perm,
  value,
  disabled,
  onChange,
}: {
  perm: PermissionInfo;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={`perm-row ${disabled ? 'is-disabled' : ''}`}>
      <span className="perm-row-icon">
        <Icon name={perm.icon} size={18} />
      </span>
      <span className="perm-row-text">
        <span className="perm-row-label">{perm.label}</span>
        <span className="perm-row-desc">{perm.desc}</span>
      </span>
      <button
        type="button"
        className={`set-switch ${value ? 'on' : ''}`}
        role="switch"
        aria-checked={value}
        aria-label={perm.label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!value)}
      >
        <span className="set-switch-knob" />
      </button>
    </div>
  );
}

/** What EmployeeForm hands to onSave — matches employees.create / update.patch fields. */
interface EmployeeFormValues {
  name: string;
  role: Employee['role'];
  email: string;
  phone: string;
  pin: string;
  active: boolean;
  permissions: PermissionMap;
}

// --- Add / edit form ---------------------------------------------------------
function EmployeeForm({
  initial,
  onSave,
  onDelete: _onDelete,
  onCancel,
}: {
  initial?: Employee | null;
  onSave: (form: EmployeeFormValues) => void;
  onDelete?: (emp: Employee) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EmployeeFormValues>(() => ({
    name: initial?.name || '',
    role: initial?.role || 'cajero',
    email: initial?.email || '',
    phone: initial?.phone || '',
    // AUTH-4: the stored PIN never reaches the client (it's hashed at rest), so
    // the field starts BLANK. On a new employee a PIN is required; when editing,
    // blank means "keep the current PIN" and only a freshly typed 6-digit value
    // is sent to the server.
    pin: '',
    active: initial?.active ?? true,
    permissions:
      initial?.permissions === 'all'
        ? (Object.fromEntries(
            PERMISSIONS.map((p) => [p.id, true])
          ) as PermissionMap)
        : typeof initial?.permissions === 'object' && initial?.permissions
          ? { ...initial.permissions }
          : (Object.fromEntries(
              PERMISSIONS.map((p) => [p.id, false])
            ) as PermissionMap),
  }));

  const update = (k: 'name' | 'email') => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const setPin = (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) });
  const togglePerm = (id: PermissionInfo['id'], v: boolean) =>
    setForm((f) => ({ ...f, permissions: { ...f.permissions, [id]: v } }));
  const grantedCount = PERMISSIONS.filter((p) => form.permissions[p.id]).length;

  const canSave =
    form.name.trim().length > 1 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    // New employee: a 6-digit PIN is mandatory. Editing: blank keeps the current
    // PIN, otherwise it must be a full 6 digits.
    (initial ? form.pin === '' || form.pin.length === 6 : form.pin.length === 6);

  // Dirty check — for an existing employee, only enable Save when something changed.
  const initialPerms: Partial<PermissionMap> =
    initial?.permissions === 'all'
      ? Object.fromEntries(PERMISSIONS.map((p) => [p.id, true]))
      : initial?.permissions || {};
  const dirty = !initial
    ? true
    : form.name !== (initial.name || '') ||
      form.role !== (initial.role || 'cajero') ||
      form.email !== (initial.email || '') ||
      form.phone !== (initial.phone || '') ||
      // The stored PIN is unreadable; a typed 6-digit value is the only PIN change.
      form.pin.length === 6 ||
      form.active !== (initial.active ?? true) ||
      PERMISSIONS.some(
        (p) => !!form.permissions[p.id] !== !!initialPerms[p.id]
      );

  const ROLE_OPTIONS: Array<{ id: Employee['role']; label: string }> = [
    { id: 'cajero', label: 'Cajero' },
    { id: 'admin', label: 'Administrador' },
    { id: 'owner', label: 'Propietario' },
  ];

  return (
    <div className="client-form emp-form">
      <label className="client-field">
        <span>
          Nombre y Apellido<span className="req"> *</span>
        </span>
        <Input
          value={form.name}
          onChange={update('name')}
          placeholder="Nombre del empleado"
        />
      </label>

      <div className="client-field">
        <span>
          Rol<span className="req"> *</span>
        </span>
        <div className="emp-role-seg">
          {ROLE_OPTIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`emp-role-opt ${form.role === r.id ? 'active' : ''}`}
              onClick={() => setForm({ ...form, role: r.id })}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <label className="client-field">
        <span>
          Email<span className="req"> *</span>
        </span>
        <Input
          type="email"
          value={form.email}
          onChange={update('email')}
          placeholder="empleado@correo.com"
        />
      </label>
      <label className="client-field">
        <span>Teléfono</span>
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
        <span>
          PIN de acceso (6 dígitos)<span className="req"> *</span>
        </span>
        <Input
          mono
          value={form.pin}
          onChange={setPin}
          inputMode="numeric"
          placeholder="••••••"
          style={{ letterSpacing: '0.3em', maxWidth: 180 }}
        />
      </label>

      <label className="emp-active-row">
        <span className="emp-active-text">
          <span className="emp-active-label">Cuenta activa</span>
          <span className="emp-active-desc">
            {form.active ? 'Puede iniciar sesión' : 'No puede iniciar sesión'}
          </span>
        </span>
        <button
          type="button"
          className={`set-switch ${form.active ? 'on' : ''}`}
          role="switch"
          aria-checked={form.active}
          aria-label="Cuenta activa"
          onClick={() => setForm({ ...form, active: !form.active })}
        >
          <span className="set-switch-knob" />
        </button>
      </label>

      <div className="emp-perms">
        <div className="emp-perms-head">
          <span className="emp-perms-title">Permisos</span>
          <Chip tone={grantedCount === PERMISSIONS.length ? 'ok' : 'neutral'}>
            {grantedCount}/{PERMISSIONS.length}
          </Chip>
        </div>
        <div className="perm-list">
          {PERMISSIONS.map((p) => (
            <PermToggleRow
              key={p.id}
              perm={p}
              value={!!form.permissions[p.id]}
              onChange={(v) => togglePerm(p.id, v)}
            />
          ))}
        </div>
      </div>

      {initial && (
        <div className="emp-meta">
          <div className="emp-meta-item">
            <span className="emp-meta-k">Última actividad</span>
            <span className="emp-meta-v">
              {fmtLastActive(initial.lastActive)}
            </span>
          </div>
          <div className="emp-meta-item">
            <span className="emp-meta-k">Creado</span>
            <span className="emp-meta-v">
              {initial.createdAt
                ? (() => {
                    const d = new Date(initial.createdAt);
                    const m = d.toLocaleDateString('es', { month: 'long' });
                    return `${String(d.getDate()).padStart(2, '0')} ${m.charAt(0).toUpperCase() + m.slice(1)} ${d.getFullYear()}`;
                  })()
                : '—'}
            </span>
          </div>
        </div>
      )}

      <div className="emp-actions">
        <div className="emp-actions-row">
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            disabled={!canSave || !dirty}
            onClick={() => onSave({ ...form })}
          >
            {initial ? 'Guardar' : 'Agregar empleado'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Read-only detail sheet (Products/Clients pattern) -----------------------
function EmployeeDetailSheet({
  emp,
  onClose,
  onEdit,
  onDelete,
}: {
  emp: Employee | null;
  onClose: () => void;
  onEdit: (emp: Employee) => void;
  onDelete: (emp: Employee) => void;
}) {
  if (!emp) return null;
  const isOwner = emp.role === 'owner';
  const fullAccess =
    emp.permissions === 'all' || permCount(emp) === PERMISSIONS.length;
  const roleLabel = ROLE_LABELS[emp.role] || emp.role;
  const perms = emp.permissions;
  const grantedPerms =
    perms === 'all'
      ? PERMISSIONS
      : PERMISSIONS.filter((p) => perms && perms[p.id]);
  const createdStr = emp.createdAt
    ? (() => {
        const d = new Date(emp.createdAt);
        const m = d.toLocaleDateString('es', { month: 'long' });
        return `${String(d.getDate()).padStart(2, '0')} ${m.charAt(0).toUpperCase() + m.slice(1)} ${d.getFullYear()}`;
      })()
    : '—';

  return (
    <Sheet onClose={onClose} title="Detalle del empleado">
      <div className="prod-detail">
        <div className="prod-detail-head">
          <div
            className={`thumb emp-avatar ${isOwner ? 'owner' : ''} ${emp.role === 'admin' ? 'admin' : ''} ${emp.active === false ? 'inactive' : ''}`}
            style={{ width: 56, height: 56, fontSize: 18 }}
            aria-hidden="true"
          >
            {initials(emp.name)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="prod-detail-name">{emp.name}</div>
            <div
              style={{
                display: 'flex',
                gap: 6,
                marginTop: 6,
                flexWrap: 'wrap',
              }}
            >
              <Chip
                tone={
                  isOwner ? 'ok' : emp.role === 'admin' ? 'info' : 'neutral'
                }
              >
                {roleLabel}
              </Chip>
              {!isOwner &&
                (emp.active === false ? (
                  <Chip tone="danger">Inactivo</Chip>
                ) : (
                  <Chip tone="ok">Activo</Chip>
                ))}
            </div>
          </div>
        </div>

        <div className="prod-detail-rows">
          <div className="prod-detail-row">
            <span className="k">Email</span>
            <span className="v">{emp.email || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Teléfono</span>
            <span className="v">{emp.phone || '—'}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">PIN de acceso</span>
            <span className="v mono">••••••</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Última actividad</span>
            <span className="v">{fmtLastActive(emp.lastActive)}</span>
          </div>
          <div className="prod-detail-row">
            <span className="k">Creado</span>
            <span className="v">{createdStr}</span>
          </div>
        </div>

        <div className="emp-perms" style={{ marginTop: 4 }}>
          <div className="emp-perms-head">
            <span className="emp-perms-title">Permisos</span>
            <Chip tone={fullAccess ? 'ok' : 'neutral'}>
              {fullAccess
                ? 'Acceso total'
                : `${grantedPerms.length}/${PERMISSIONS.length}`}
            </Chip>
          </div>
          {grantedPerms.length === 0 ? (
            <Banner
              tone="neutral"
              icon="lock"
              message="Este empleado no tiene permisos asignados."
            />
          ) : (
            <div className="emp-detail-perms">
              {grantedPerms.map((p) => (
                <div className="emp-detail-perm" key={p.id}>
                  <span className="perm-row-icon">
                    <Icon name={p.icon} size={16} />
                  </span>
                  <span className="emp-detail-perm-label">{p.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="prod-detail-actions">
        <Button icon="edit-3" onClick={() => onEdit(emp)} block>
          Editar
        </Button>
        <div className="row" style={{ gap: 10 }}>
          {!isOwner && (
            <Button
              variant="danger"
              icon="trash-2"
              onClick={() => onDelete(emp)}
            >
              Eliminar
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

// --- List row ----------------------------------------------------------------
function EmployeeRow({
  emp,
  onEdit,
}: {
  emp: Employee;
  onEdit: (emp: Employee) => void;
}) {
  const roleLabel = ROLE_LABELS[emp.role] || emp.role;
  return (
    <div
      className="lrow emp-row"
      onClick={() => onEdit(emp)}
      style={{ cursor: 'pointer' }}
    >
      <div
        className={`thumb emp-avatar ${emp.role === 'owner' ? 'owner' : ''} ${emp.role === 'admin' ? 'admin' : ''} ${emp.active === false ? 'inactive' : ''}`}
        aria-hidden="true"
      >
        {initials(emp.name)}
      </div>
      <div>
        <p className="pname">{emp.name}</p>
        <div className="pmeta emp-pmeta">
          <Chip
            tone={
              emp.role === 'owner'
                ? 'ok'
                : emp.role === 'admin'
                  ? 'info'
                  : 'neutral'
            }
          >
            {roleLabel}
          </Chip>
        </div>
      </div>
      <div className="pright emp-row-right">
        {emp.role !== 'owner' &&
          (emp.active === false ? (
            <Chip tone="danger">Inactivo</Chip>
          ) : (
            <span className="emp-permsum">
              {permCount(emp)} {permCount(emp) === 1 ? 'permiso' : 'permisos'}
            </span>
          ))}
      </div>
      <div className="lrow-chevron">
        <Icon name="chevron-right" size={18} />
      </div>
    </div>
  );
}

// --- Main screen -------------------------------------------------------------
export default function EmployeesScreen() {
  const { token } = useSession();
  const online = useOnline();
  // Server already excludes the logged-in actor from the list (resolved from token).
  const employees =
    useQuery(api.employees.list, token ? { token } : 'skip') ?? [];
  const createEmployee = useMutation(api.employees.create);
  const updateEmployee = useMutation(api.employees.update);
  const removeEmployee = useMutation(api.employees.remove);

  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState('name-asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null); // null = new
  const [detail, setDetail] = useState<Employee | null>(null);
  const [confirmDel, setConfirmDel] = useState<Employee | null>(null);

  const norm = (s?: string) => (s || '').toLowerCase();
  const team = employees;
  const list = team
    .filter((e) => (role === 'all' ? true : e.role === role))
    .filter((e) =>
      status === 'all'
        ? true
        : status === 'active'
          ? e.active !== false
          : e.active === false
    )
    .filter((e) => {
      if (!fromDate || !toDate) return true;
      const c = localDay(e.createdAt);
      return c && c >= fromDate && c <= toDate;
    })
    .filter((e) => {
      if (!q.trim()) return true;
      const t = norm(q);
      return (
        norm(e.name).includes(t) ||
        norm(e.email).includes(t) ||
        norm(e.phone).includes(t)
      );
    })
    // owner always first, then by chosen sort
    .slice()
    .sort((a, b) => {
      if (a.role === 'owner') return -1;
      if (b.role === 'owner') return 1;
      return sort === 'name-desc'
        ? b.name.localeCompare(a.name)
        : a.name.localeCompare(b.name);
    });

  const activeCount = team.filter((e) => e.active !== false).length;
  const adminCount = team.filter((e) => e.role === 'admin').length;
  const cashierCount = team.filter((e) => e.role === 'cajero').length;

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
  const openEdit = (e: Employee) => {
    setDetail(null);
    setEditing(e);
    setEditorOpen(true);
  };
  const openDetail = (e: Employee) => setDetail(e);

  const save = async (form: EmployeeFormValues) => {
    if (!token) return;
    try {
      if (editing) {
        // Omit the PIN from the patch unless a new one was typed — sending an
        // empty PIN would fail the server's assertPin; an absent PIN is kept.
        const { pin, ...rest } = form;
        await updateEmployee({
          token,
          employeeId: editing._id,
          patch: pin ? { ...rest, pin } : rest,
        });
      } else {
        await createEmployee({ token, ...form });
      }
      setEditorOpen(false);
    } catch (e: any) {
      alert(
        typeof e?.data === 'string'
          ? e.data
          : 'Ocurrió un error. Intenta de nuevo.'
      );
    }
  };

  const remove = async (emp: Employee) => {
    if (!token) return;
    try {
      await removeEmployee({ token, employeeId: emp._id });
    } catch (e: any) {
      alert(
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
        title="Empleados"
        sub={`${team.length} en el equipo`}
        online={online}
        right={
          <Button size="sm" icon="user-plus" onClick={openNew}>
            Agregar empleado
          </Button>
        }
      />

      <div className="content stored-content" style={{ padding: '5px' }}>
        <div className="prod-stats emp-stats">
          <div className="prod-stat">
            <span className="k">Equipo</span>
            <span className="v tabular">{team.length}</span>
            <span className="meta">personas</span>
          </div>
          <div className="prod-stat">
            <span className="k">Activos</span>
            <span className="v tabular">{activeCount}</span>
            <span className="meta">con acceso</span>
          </div>
          <div className="prod-stat">
            <span className="k">Administradores</span>
            <span className="v tabular">{adminCount}</span>
            <span className="meta">con gestión</span>
          </div>
          <div className="prod-stat">
            <span className="k">Cajeros</span>
            <span className="v tabular">{cashierCount}</span>
            <span className="meta">empleados</span>
          </div>
        </div>

        <div className="catalog-head" style={{ margin: '0 0 14px' }}>
          <Input
            placeholder="Buscar por nombre, email o teléfono"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <div className="catalog-filters emp-filters">
            <label className="catalog-filter">
              <span>Rol</span>
              <select
                className="input cat-select"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Todos</option>
                <option value="owner">Propietario</option>
                <option value="admin">Administrador</option>
                <option value="cajero">Cajero</option>
              </select>
            </label>
            <label className="catalog-filter">
              <span>Estado</span>
              <select
                className="input cat-select"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Todos</option>
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
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
          {list.length === 0 ? (
            <div className="empty" style={{ padding: '32px 16px' }}>
              <h4>Sin empleados</h4>
              <p>
                {q ? `Sin resultados para "${q}"` : 'Agrega tu primer cajero'}
              </p>
            </div>
          ) : (
            visible.map((e) => (
              <EmployeeRow key={e._id} emp={e} onEdit={openDetail} />
            ))
          )}
        </div>

        {list.length > 0 && (
          <div className="pager pager-sticky">
            <div className="pager-info">
              {list.length <= pageSize ? (
                <>
                  {list.length} {list.length === 1 ? 'empleado' : 'empleados'}
                </>
              ) : (
                <>
                  Empleados{' '}
                  <strong>
                    {showingFrom}–{showingTo}
                  </strong>{' '}
                  de <strong>{list.length}</strong>
                </>
              )}
            </div>
            <div className="pager-size">
              <label htmlFor="emp-pager-size">Por página</label>
              <select
                id="emp-pager-size"
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
        <EmployeeDetailSheet
          emp={detail}
          onClose={() => setDetail(null)}
          onEdit={openEdit}
          onDelete={(emp) => setConfirmDel(emp)}
        />
      )}

      {editorOpen && (
        <Sheet
          onClose={() => setEditorOpen(false)}
          title={
            editing
              ? editing.role === 'owner'
                ? 'Propietario'
                : 'Editar empleado'
              : 'Nuevo empleado'
          }
        >
          <EmployeeForm
            initial={editing}
            onSave={(...args: Parameters<typeof save>) => {
              void save(...args);
            }}
            onDelete={(emp) => setConfirmDel(emp)}
            onCancel={() => setEditorOpen(false)}
          />
        </Sheet>
      )}

      {confirmDel && (
        <ConfirmDialog
          title="¿Eliminar empleado?"
          message={`Se eliminará la cuenta de ${confirmDel.name}. Ya no podrá iniciar sesión en la caja.`}
          confirmLabel="Eliminar"
          tone="danger"
          onConfirm={() => void remove(confirmDel)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </>
  );
}
