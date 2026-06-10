// SettingsScreen — store/account/billing/sync preferences
// Organized as sections with rows; uses Sheet editors for grouped fields.

function SettingRow({ icon, label, value, onClick, last, danger }) {
  return (
    <button className={`set-row ${onClick ? 'tappable' : ''} ${last ? 'last' : ''} ${danger ? 'danger' : ''}`} onClick={onClick} disabled={!onClick}>
      {icon && <span className="set-row-icon"><Icon name={icon} size={18} /></span>}
      <span className="set-row-label">{label}</span>
      {value != null && <span className="set-row-value">{value}</span>}
      {onClick && <Icon name="chevron-right" size={16} style={{ color: 'var(--ink-4)', flex: 'none' }} />}
    </button>
  );
}

function SettingToggleRow({ icon, label, sub, value, onChange, last }) {
  return (
    <div className={`set-row toggle ${last ? 'last' : ''}`}>
      {icon && <span className="set-row-icon"><Icon name={icon} size={18} /></span>}
      <span className="set-row-text">
        <span className="set-row-label">{label}</span>
        {sub && <span className="set-row-sub">{sub}</span>}
      </span>
      <button
        className={`set-switch ${value ? 'on' : ''}`}
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}>
        <span className="set-switch-knob" />
      </button>
    </div>
  );
}

function SettingsSection({ title, hint, children }) {
  return (
    <section className="set-section">
      <div className="set-section-head">
        <h2 className="set-section-title">{title}</h2>
        {hint && <span className="set-section-hint">{hint}</span>}
      </div>
      <div className="card set-card">{children}</div>
    </section>
  );
}

// --- Field editor sheet -------------------------------------------------------
function SettingsEditSheet({ title, fields, values, onSave, onClose }) {
  const [form, setForm] = React.useState(values);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const dirty = fields.some((f) => String(form[f.key] ?? '') !== String(values[f.key] ?? ''));
  return (
    <Sheet onClose={onClose} title={title}>
      <div className="set-form">
        {fields.map(f => (
          <label className="client-field" key={f.key}>
            <span>{f.label}</span>
            {f.type === 'select' ? (
              <select className="input cat-select" value={form[f.key]} onChange={set(f.key)}>
                {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea className="input set-textarea" rows={3} value={form[f.key]} onChange={set(f.key)} placeholder={f.placeholder} />
            ) : f.type === 'number' ? (
              <Input type="number" value={form[f.key]} onChange={set(f.key)} placeholder={f.placeholder} inputMode={f.inputMode || 'decimal'} step={f.step || 'any'} min={f.min} />
            ) : (
              <Input value={form[f.key]} onChange={set(f.key)} placeholder={f.placeholder} inputMode={f.inputMode} />
            )}
          </label>
        ))}
        <div className="row client-actions" style={{ gap: 10, marginTop: 6 }}>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={!dirty} onClick={() => onSave(form)}>Guardar</Button>
        </div>
      </div>
    </Sheet>
  );
}

function SettingsScreen({ user, online, onBack, onLogout, bsRate, setBsRate, tweaks, setTweak }) {
  const [store, setStore] = React.useState({
    name: 'Tienda Ejemplo',
    branch: 'Sucursal Centro',
    taxId: 'J-31234567-8',
    phone: '+507 269-0000',
    address: 'Av. Principal 123, Ciudad',
    currency: 'USD',
  });
  const [billing, setBilling] = React.useState({
    taxRate: '13',
    taxName: 'IVA',
    nextInvoice: '00000001',
    printAuto: true,
    emailReceipt: false,
  });
  const [prefs, setPrefs] = React.useState({
    lowStockAlerts: true,
    soundScan: true,
  });
  const [editor, setEditor] = React.useState(null); // {kind}

  const CURRENCY_LABEL = { USD: 'US$ Dólar', PAB: 'B/. Balboa', EUR: '€ Euro', MXN: '$ Peso MX', COP: '$ Peso CO' };

  return (
    <>
      <AppBar
        title="Ajustes"
        online={online}
        /* left={onBack && <IconButton icon="chevron-left" onClick={onBack} ariaLabel="Volver" />} */ />

      <div className="content set-content">
        {/* Account header card */}
        <div className="set-account">
          <div className="set-account-avatar">{(user?.name?.[0] || 'U').toUpperCase()}</div>
          <div className="set-account-info">
            <div className="set-account-name">{user?.name || 'Usuario'}</div>
            <div className="set-account-role">
              <Chip tone="ok">{(window.ROLE_LABELS && window.ROLE_LABELS[user?.role]) || user?.role || 'Cajero'}</Chip>
              <span className="set-account-store">{store.name}</span>
            </div>
          </div>
          <Button size="sm" variant="secondary" icon="user" onClick={() => setEditor({ kind: 'account' })}>
            <span className="hide-mobile">Editar perfil</span>
          </Button>
        </div>

        {/* Store */}
        <SettingsSection title="Tienda" hint="Datos para facturas y recibos">
          <SettingRow icon="store" label="Nombre" value={store.name} onClick={() => setEditor({ kind: 'store' })} />
          <SettingRow icon="hash" label="RIF" value={store.taxId} onClick={() => setEditor({ kind: 'store' })} />
          <SettingRow icon="phone" label="Teléfono" value={store.phone} onClick={() => setEditor({ kind: 'store' })} />
          <SettingRow icon="map-pin" label="Dirección" value={store.address} onClick={() => setEditor({ kind: 'store' })} last />
        </SettingsSection>

        {/* Billing & taxes */}
        <SettingsSection title="Facturación e impuestos">
          <SettingRow icon="percent" label={`Impuesto (${billing.taxName})`} value={`${billing.taxRate}%`} onClick={() => setEditor({ kind: 'billing' })} />
          <SettingRow icon="dollar-sign" label="Valor del dólar" value={`Bs ${Number(bsRate).toFixed(2)}`} onClick={() => setEditor({ kind: 'bsrate' })} />
          <SettingRow icon="coins" label="Moneda" value={CURRENCY_LABEL[store.currency] || store.currency} onClick={() => setEditor({ kind: 'currency' })} />
          <SettingRow icon="file-text" label="Próxima factura" value={billing.nextInvoice} />
          <SettingToggleRow icon="printer" label="Imprimir automáticamente" sub="Imprime el recibo al cobrar" value={billing.printAuto} onChange={(v) => setBilling({ ...billing, printAuto: v })} />
          <SettingToggleRow icon="mail" label="Enviar recibo por email" sub="Si el cliente tiene email registrado" value={billing.emailReceipt} onChange={(v) => setBilling({ ...billing, emailReceipt: v })} last />
        </SettingsSection>

        {/* Preferences */}
        <SettingsSection title="Preferencias">
          <SettingToggleRow icon="bell" label="Alertas de bajo stock" sub="Avisar cuando un producto baje del mínimo" value={prefs.lowStockAlerts} onChange={(v) => setPrefs({ ...prefs, lowStockAlerts: v })} />
          <SettingToggleRow icon="volume-2" label="Sonido al escanear" sub="Bip de confirmación de lectura" value={prefs.soundScan} onChange={(v) => setPrefs({ ...prefs, soundScan: v })} />
          <SettingRow icon="globe" label="Idioma" value="Español" last />
        </SettingsSection>

        {/* Sync / ERPNext */}
        <SettingsSection title="Sincronización" hint="Conexión con ERPNext">
          <div className="set-sync-row">
            <span className="set-row-icon"><Icon name="refresh-cw" size={18} /></span>
            <span className="set-row-text">
              <span className="set-row-label">Estado del servidor</span>
              <span className="set-row-sub">{online ? 'Última sincronización: hace 2 min' : 'Trabajando sin conexión'}</span>
            </span>
            <Chip tone={online ? 'ok' : 'warn'}>
              <span className="net-dot-inline" />{online ? 'Conectado' : 'Sin conexión'}
            </Chip>
          </div>
          <SettingRow icon="link" label="Servidor ERPNext" value="erp.tienda.com" />
          <SettingRow icon="database" label="Sincronizar ahora" onClick={online ? () => alert('Sincronizando… (demo)') : undefined} value={online ? undefined : 'Sin conexión'} last />
        </SettingsSection>

        {/* About */}
        <SettingsSection title="Acerca de">
          <SettingRow icon="info" label="Versión" value="v0.1 · Demo" />
          <SettingRow icon="file-text" label="Términos y condiciones" onClick={() => alert('Términos (demo)')} />
          <SettingRow icon="shield" label="Política de privacidad" onClick={() => alert('Privacidad (demo)')} last />
        </SettingsSection>

      </div>

      {editor?.kind === 'account' && (
        <SettingsEditSheet
          title="Editar perfil"
          values={{ name: user?.name || '', role: user?.role || 'cajero' }}
          fields={[
            { key: 'name', label: 'Nombre', placeholder: 'Nombre del cajero' },
            { key: 'role', label: 'Rol', type: 'select', options: [
              { value: 'cajero', label: 'Cajero' },
              { value: 'supervisor', label: 'Supervisor' },
              { value: 'admin', label: 'Administrador' },
            ] },
          ]}
          onSave={() => setEditor(null)}
          onClose={() => setEditor(null)} />
      )}

      {editor?.kind === 'store' && (
        <SettingsEditSheet
          title="Datos de la tienda"
          values={store}
          fields={[
            { key: 'name', label: 'Nombre', placeholder: 'Nombre comercial' },
            { key: 'taxId', label: 'RIF', placeholder: 'J-12345678-9' },
            { key: 'phone', label: 'Teléfono', placeholder: '+507 0000-0000' },
            { key: 'address', label: 'Dirección', type: 'textarea', placeholder: 'Calle / edificio / ciudad' },
          ]}
          onSave={(v) => { setStore({ ...store, ...v }); setEditor(null); }}
          onClose={() => setEditor(null)} />
      )}

      {editor?.kind === 'billing' && (
        <SettingsEditSheet
          title="Impuestos"
          values={{ taxName: billing.taxName, taxRate: billing.taxRate }}
          fields={[
            { key: 'taxName', label: 'Nombre del impuesto', placeholder: 'IVA' },
            { key: 'taxRate', label: 'Tasa (%)', placeholder: '13', type: 'number', inputMode: 'decimal', min: '0' },
          ]}
          onSave={(v) => { setBilling({ ...billing, ...v }); setEditor(null); }}
          onClose={() => setEditor(null)} />
      )}

      {editor?.kind === 'bsrate' && (
        <SettingsEditSheet
          title="Valor del dólar"
          values={{ bsRate: String(bsRate) }}
          fields={[
            { key: 'bsRate', label: 'Bolívares por dólar (Bs/$)', placeholder: '36.50', type: 'number', inputMode: 'decimal', min: '0' },
          ]}
          onSave={(v) => { const n = parseFloat(v.bsRate); if (!isNaN(n) && n > 0) setBsRate(n); setEditor(null); }}
          onClose={() => setEditor(null)} />
      )}

      {editor?.kind === 'currency' && (
        <SettingsEditSheet
          title="Moneda"
          values={{ currency: store.currency }}
          fields={[
            { key: 'currency', label: 'Moneda del sistema', type: 'select', options: [
              { value: 'USD', label: 'US$ Dólar estadounidense' },
            ] },
          ]}
          onSave={(v) => { setStore({ ...store, ...v }); setEditor(null); }}
          onClose={() => setEditor(null)} />
      )}
    </>
  );
}

window.SettingsScreen = SettingsScreen;
