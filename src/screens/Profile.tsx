// ProfileScreen — the logged-in user's own profile (read + edit personal details).
import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { AppBar, Button, Chip, Icon, Input, Sheet, useToast } from '@/components';
import { useOnline } from '@/state/useOnline';
import { useSession } from '@/state/SessionContext';
import { PERMISSIONS, ROLE_LABELS } from '@/lib/rbac';
import type { Employee } from '@/types';

function _initials(name?: string) {
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
function _createdStr(value?: number) {
  if (!value) return '—';
  const d = new Date(value);
  const m = d.toLocaleDateString('es', { month: 'long' });
  return `${String(d.getDate()).padStart(2, '0')} ${m.charAt(0).toUpperCase() + m.slice(1)} ${d.getFullYear()}`;
}

interface ProfileForm {
  name: string;
  email: string;
  phone: string;
  pin: string;
}

function ProfileEditSheet({
  me,
  onSave,
  onCancel,
}: {
  me: Employee;
  onSave: (form: ProfileForm) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ProfileForm>(() => ({
    name: me.name || '',
    email: me.email || '',
    phone: me.phone || '',
    // AUTH-4: the stored PIN is hashed at rest and never reaches the client, so
    // the field starts BLANK. Leaving it blank keeps the current PIN; only a
    // freshly typed 6-digit value is sent to the server.
    pin: '',
  }));
  const setPin = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) });
  const canSave =
    form.name.trim().length > 1 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    // Blank keeps the current PIN; otherwise it must be a full 6 digits.
    (form.pin === '' || form.pin.length === 6);
  const dirty =
    form.name !== (me.name || '') ||
    form.email !== (me.email || '') ||
    form.phone !== (me.phone || '') ||
    // The stored PIN is unreadable; a typed 6-digit value is the only PIN change.
    form.pin.length === 6;

  return (
    <Sheet onClose={onCancel} title="Editar perfil">
      <div className="client-form emp-form">
        <label className="client-field">
          <span>
            Nombre y Apellido<span className="req"> *</span>
          </span>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Tu nombre"
          />
        </label>
        <label className="client-field">
          <span>
            Email<span className="req"> *</span>
          </span>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="tu@correo.com"
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
        <div className="emp-actions">
          <div className="emp-actions-row">
            <Button variant="secondary" onClick={onCancel}>
              Cancelar
            </Button>
            <Button disabled={!canSave || !dirty} onClick={() => onSave(form)}>
              Guardar
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

export default function ProfileScreen() {
  const toast = useToast();
  const online = useOnline();
  const { user: me, token } = useSession();
  const updateSelf = useMutation(api.employees.updateSelf);
  const [editOpen, setEditOpen] = useState(false);

  if (!me) return null;

  const roleLabel = ROLE_LABELS[me.role] || me.role;
  const roleTone =
    me.role === 'owner' ? 'ok' : me.role === 'admin' ? 'info' : 'neutral';
  const grantedPerms =
    me.permissions === 'all'
      ? PERMISSIONS
      : PERMISSIONS.filter(
          (p) =>
            me.permissions && (me.permissions as Record<string, boolean>)[p.id]
        );

  const save = async (form: ProfileForm) => {
    try {
      await updateSelf({
        token: token!,
        patch: {
          name: form.name,
          email: form.email,
          phone: form.phone,
          // Only send a PIN when the user typed a new one (blank = keep current).
          ...(form.pin ? { pin: form.pin } : {}),
        },
      });
      setEditOpen(false);
    } catch (e: any) {
      toast.error(
        typeof e?.data === 'string'
          ? e.data
          : 'Ocurrió un error. Intenta de nuevo.'
      );
    }
  };

  return (
    <>
      <AppBar
        title="Mi perfil"
        online={online}
        right={
          <Button size="sm" icon="edit-3" onClick={() => setEditOpen(true)}>
            Editar perfil
          </Button>
        }
      />

      <div className="content stored-content" style={{ padding: '5px' }}>
        <div className="profile-wrap">
          <div className="profile-hero">
            <div
              className={`profile-avatar ${me.role === 'owner' ? 'owner' : ''} ${me.role === 'admin' ? 'admin' : ''}`}
            >
              {_initials(me.name)}
            </div>
            <div className="profile-hero-id">
              <div className="profile-name">{me.name}</div>
              <div className="profile-chips">
                <Chip tone={roleTone}>{roleLabel}</Chip>
                <Chip tone={me.active === false ? 'danger' : 'ok'}>
                  {me.active === false ? 'Inactivo' : 'Activo'}
                </Chip>
              </div>
            </div>
          </div>

          <div className="card profile-card">
            <div className="prod-detail-row">
              <span className="k">Email</span>
              <span className="v">{me.email || '—'}</span>
            </div>
            <div className="prod-detail-row">
              <span className="k">Teléfono</span>
              <span className="v">{me.phone || '—'}</span>
            </div>
            <div className="prod-detail-row">
              <span className="k">PIN de acceso</span>
              {/* AUTH-4: the PIN is hashed at rest and never leaves the server,
                  so it can no longer be revealed — only shown as set. */}
              <span className="v mono profile-pin">••••••</span>
            </div>
            <div className="prod-detail-row">
              <span className="k">Miembro desde</span>
              <span className="v">{_createdStr(me.createdAt)}</span>
            </div>
          </div>

          <div className="profile-section-title">Permisos</div>
          <div className="card profile-card">
            {grantedPerms.length === 0 ? (
              <div className="prod-detail-row">
                <span className="v" style={{ color: 'var(--ink-3)' }}>
                  Sin permisos asignados
                </span>
              </div>
            ) : (
              grantedPerms.map((p) => (
                <div className="profile-perm" key={p.id}>
                  <span className="perm-row-icon">
                    <Icon name={p.icon} size={16} />
                  </span>
                  <span className="profile-perm-text">
                    <span className="profile-perm-label">{p.label}</span>
                    <span className="profile-perm-desc">{p.desc}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {editOpen && (
        <ProfileEditSheet
          me={me}
          onSave={(...args: Parameters<typeof save>) => {
            void save(...args);
          }}
          onCancel={() => setEditOpen(false)}
        />
      )}
    </>
  );
}
