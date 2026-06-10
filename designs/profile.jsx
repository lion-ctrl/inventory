// ProfileScreen — the logged-in user's own profile (read + edit personal details).

function _initials(name) {
  const parts = String(name || '').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase() || '?';
}
function _createdStr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const m = d.toLocaleDateString('es', { month: 'long' });
  return `${String(d.getDate()).padStart(2, '0')} ${m.charAt(0).toUpperCase() + m.slice(1)} ${d.getFullYear()}`;
}

function ProfileEditSheet({ me, onSave, onCancel }) {
  const [form, setForm] = React.useState(() => ({
    name: me.name || '',
    email: me.email || '',
    phone: me.phone || '',
    pin: me.pin || '',
  }));
  const setPin = (e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) });
  const canSave = form.name.trim().length > 1 && /\S+@\S+\.\S+/.test(form.email) && form.pin.length === 6;
  const dirty = form.name !== (me.name || '') || form.email !== (me.email || '') || form.phone !== (me.phone || '') || form.pin !== (me.pin || '');

  return (
    <Sheet onClose={onCancel} title="Editar perfil">
      <div className="client-form emp-form">
        <label className="client-field">
          <span>Nombre y Apellido<span className="req"> *</span></span>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tu nombre" />
        </label>
        <label className="client-field">
          <span>Email<span className="req"> *</span></span>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="tu@correo.com" />
        </label>
        <label className="client-field">
          <span>Teléfono</span>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\s/g, '') })} placeholder="04140000000" inputMode="tel" />
        </label>
        <label className="client-field">
          <span>PIN de acceso (6 dígitos)<span className="req"> *</span></span>
          <Input mono value={form.pin} onChange={setPin} inputMode="numeric" placeholder="••••••" style={{ letterSpacing: '0.3em', maxWidth: 180 }} />
        </label>
        <div className="emp-actions">
          <div className="emp-actions-row">
            <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
            <Button disabled={!canSave || !dirty} onClick={() => onSave(form)}>Guardar</Button>
          </div>
        </div>
      </div>
    </Sheet>);

}

function ProfileScreen({ user, setUser, employees, setEmployees, online, onLogout }) {
  const me = employees.find((e) => e.id === user.id) || { ...user, email: '', phone: '', pin: '' };
  const [editOpen, setEditOpen] = React.useState(false);
  const [showPin, setShowPin] = React.useState(false);

  const roleLabel = (window.ROLE_LABELS && window.ROLE_LABELS[me.role]) || me.role;
  const roleTone = me.role === 'owner' ? 'ok' : me.role === 'admin' ? 'info' : 'neutral';
  const grantedPerms = me.permissions === 'all' ? PERMISSIONS : PERMISSIONS.filter((p) => me.permissions && me.permissions[p.id]);

  const save = (form) => {
    setEmployees((prev) => prev.map((e) => e.id === me.id ? { ...e, ...form } : e));
    setUser((u) => ({ ...u, name: form.name }));
    setEditOpen(false);
  };

  return (
    <>
      <AppBar
        title="Mi perfil"
        online={online}
        right={<Button size="sm" icon="edit-3" onClick={() => setEditOpen(true)}>Editar perfil</Button>} />

      <div className="content stored-content" style={{ padding: '5px' }}>
        <div className="profile-wrap">
          <div className="profile-hero">
            <div className={`profile-avatar ${me.role === 'owner' ? 'owner' : ''} ${me.role === 'admin' ? 'admin' : ''}`}>{_initials(me.name)}</div>
            <div className="profile-hero-id">
              <div className="profile-name">{me.name}</div>
              <div className="profile-chips">
                <Chip tone={roleTone}>{roleLabel}</Chip>
                <Chip tone={me.active === false ? 'danger' : 'ok'}>{me.active === false ? 'Inactivo' : 'Activo'}</Chip>
              </div>
            </div>
          </div>

          <div className="card profile-card">
            <div className="prod-detail-row"><span className="k">Email</span><span className="v">{me.email || '—'}</span></div>
            <div className="prod-detail-row"><span className="k">Teléfono</span><span className="v">{me.phone || '—'}</span></div>
            <div className="prod-detail-row"><span className="k">PIN de acceso</span><span className="v mono profile-pin">{me.pin ? (showPin ? me.pin : '••••••') : '—'}{me.pin && <button type="button" className="profile-pin-toggle" aria-label={showPin ? 'Ocultar PIN' : 'Mostrar PIN'} onClick={() => setShowPin((s) => !s)}><Icon name={showPin ? 'eye-off' : 'eye'} size={16} /></button>}</span></div>
            <div className="prod-detail-row"><span className="k">Miembro desde</span><span className="v">{_createdStr(me.createdAt)}</span></div>
          </div>

          <div className="profile-section-title">Permisos</div>
          <div className="card profile-card">
            {grantedPerms.length === 0 ?
            <div className="prod-detail-row"><span className="v" style={{ color: 'var(--ink-3)' }}>Sin permisos asignados</span></div> :
            grantedPerms.map((p) =>
            <div className="profile-perm" key={p.id}>
                <span className="perm-row-icon"><Icon name={p.icon} size={16} /></span>
                <span className="profile-perm-text">
                  <span className="profile-perm-label">{p.label}</span>
                  <span className="profile-perm-desc">{p.desc}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {editOpen &&
      <ProfileEditSheet me={me} onSave={save} onCancel={() => setEditOpen(false)} />
      }
    </>);

}

window.ProfileScreen = ProfileScreen;
