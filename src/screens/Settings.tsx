// SettingsScreen — store/account/billing/sync preferences
// Organized as sections with rows; uses Sheet editors for grouped fields.
// Backed by the Convex settings singleton (settings.get / settings.update).
import { useState } from 'react';
import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { AppBar, Button, Chip, Icon, Input, Sheet } from '@/components';
import { useSession } from '@/state/SessionContext';
import { useOnline } from '@/state/useOnline';
import { useSettingsDoc } from '@/state/hooks';
import { ROLE_LABELS } from '@/lib/rbac';
import type { Settings } from '@/types';

type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'storeName'
    | 'storeRif'
    | 'phone'
    | 'address'
    | 'currency'
    | 'taxName'
    | 'ivaPct'
    | 'bsRate'
    | 'printAuto'
    | 'emailReceipt'
    | 'lowStockAlerts'
    | 'soundScan'
    | 'scannerMode'
  >
>;

interface SettingRowProps {
  icon?: string;
  label: string;
  value?: ReactNode;
  onClick?: () => void;
  last?: boolean;
  danger?: boolean;
}

function SettingRow({
  icon,
  label,
  value,
  onClick,
  last,
  danger,
}: SettingRowProps) {
  return (
    <button
      className={`set-row ${onClick ? 'tappable' : ''} ${last ? 'last' : ''} ${danger ? 'danger' : ''}`}
      onClick={onClick}
      disabled={!onClick}
    >
      {icon && (
        <span className="set-row-icon">
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="set-row-label">{label}</span>
      {value != null && <span className="set-row-value">{value}</span>}
      {onClick && (
        <Icon
          name="chevron-right"
          size={16}
          style={{ color: 'var(--ink-4)', flex: 'none' }}
        />
      )}
    </button>
  );
}

interface SettingToggleRowProps {
  icon?: string;
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}

function SettingToggleRow({
  icon,
  label,
  sub,
  value,
  onChange,
  last,
}: SettingToggleRowProps) {
  return (
    <div className={`set-row toggle ${last ? 'last' : ''}`}>
      {icon && (
        <span className="set-row-icon">
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="set-row-text">
        <span className="set-row-label">{label}</span>
        {sub && <span className="set-row-sub">{sub}</span>}
      </span>
      <button
        className={`set-switch ${value ? 'on' : ''}`}
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
      >
        <span className="set-switch-knob" />
      </button>
    </div>
  );
}

function SettingsSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
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
interface EditField {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'select' | 'textarea' | 'number';
  options?: { value: string; label: string }[];
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  step?: string;
  min?: string;
}

interface SettingsEditSheetProps {
  title: string;
  fields: EditField[];
  values: Record<string, string>;
  onSave: (form: Record<string, string>) => void;
  onClose: () => void;
}

function SettingsEditSheet({
  title,
  fields,
  values,
  onSave,
  onClose,
}: SettingsEditSheetProps) {
  const [form, setForm] = useState(values);
  const set =
    (k: string) =>
    (
      e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
    ) =>
      setForm({ ...form, [k]: e.target.value });
  const dirty = fields.some(
    (f) => String(form[f.key] ?? '') !== String(values[f.key] ?? '')
  );
  return (
    <Sheet onClose={onClose} title={title}>
      <div className="set-form">
        {fields.map((f) => (
          <label className="client-field" key={f.key}>
            <span>{f.label}</span>
            {f.type === 'select' ? (
              <select
                className="input cat-select"
                value={form[f.key]}
                onChange={set(f.key)}
              >
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea
                className="input set-textarea"
                rows={3}
                value={form[f.key]}
                onChange={set(f.key)}
                placeholder={f.placeholder}
              />
            ) : f.type === 'number' ? (
              <Input
                type="number"
                value={form[f.key]}
                onChange={set(f.key)}
                placeholder={f.placeholder}
                inputMode={f.inputMode || 'decimal'}
                step={f.step || 'any'}
                min={f.min}
              />
            ) : (
              <Input
                value={form[f.key]}
                onChange={set(f.key)}
                placeholder={f.placeholder}
                inputMode={f.inputMode}
              />
            )}
          </label>
        ))}
        <div className="row client-actions" style={{ gap: 10, marginTop: 6 }}>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!dirty} onClick={() => onSave(form)}>
            Guardar
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export default function SettingsScreen() {
  const { user, token } = useSession();
  const online = useOnline();
  const settings = useSettingsDoc();
  const update = useMutation(api.settings.update);

  // Safe fallbacks while the singleton loads (data arrives in ms — no spinners).
  const storeName = settings?.storeName ?? '';
  const storeRif = settings?.storeRif ?? '';
  const phone = settings?.phone ?? '';
  const address = settings?.address ?? '';
  const currency = settings?.currency ?? '';
  const taxName = settings?.taxName ?? '';
  const ivaPct = settings?.ivaPct ?? 0;
  const bsRate = settings?.bsRate ?? 0;
  const printAuto = settings?.printAuto ?? false;
  const emailReceipt = settings?.emailReceipt ?? false;
  const lowStockAlerts = settings?.lowStockAlerts ?? false;
  const soundScan = settings?.soundScan ?? false;
  // Absent on legacy rows → physical scanner (today's behavior).
  const scannerMode = settings?.scannerMode ?? 'physical';
  const nextInvoice = String(settings?.nextInvoiceNumber ?? 0).padStart(8, '0');

  const [editor, setEditor] = useState<{ kind: string } | null>(null); // {kind}

  const save = async (patch: SettingsPatch) => {
    try {
      await update({ token: token!, patch });
    } catch (e: any) {
      alert(
        typeof e?.data === 'string'
          ? e.data
          : 'Ocurrió un error. Intenta de nuevo.'
      );
    }
  };

  const CURRENCY_LABEL: Record<string, string> = {
    USD: 'US$ Dólar',
    PAB: 'B/. Balboa',
    EUR: '€ Euro',
    MXN: '$ Peso MX',
    COP: '$ Peso CO',
  };

  return (
    <>
      <AppBar title="Ajustes" online={online} />

      <div className="content set-content">
        {/* Account header card */}
        <div className="set-account">
          <div className="set-account-avatar">
            {(user?.name?.[0] || 'U').toUpperCase()}
          </div>
          <div className="set-account-info">
            <div className="set-account-name">{user?.name || 'Usuario'}</div>
            <div className="set-account-role">
              <Chip tone="ok">
                {(user?.role && ROLE_LABELS[user.role]) ||
                  user?.role ||
                  'Cajero'}
              </Chip>
              <span className="set-account-store">{storeName}</span>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon="user"
            onClick={() => setEditor({ kind: 'account' })}
          >
            <span className="hide-mobile">Editar perfil</span>
          </Button>
        </div>

        {/* Store */}
        <SettingsSection title="Tienda" hint="Datos para facturas y recibos">
          <SettingRow
            icon="store"
            label="Nombre"
            value={storeName}
            onClick={() => setEditor({ kind: 'store' })}
          />
          <SettingRow
            icon="hash"
            label="RIF"
            value={storeRif}
            onClick={() => setEditor({ kind: 'store' })}
          />
          <SettingRow
            icon="phone"
            label="Teléfono"
            value={phone}
            onClick={() => setEditor({ kind: 'store' })}
          />
          <SettingRow
            icon="map-pin"
            label="Dirección"
            value={address}
            onClick={() => setEditor({ kind: 'store' })}
            last
          />
        </SettingsSection>

        {/* Billing & taxes */}
        <SettingsSection title="Facturación e impuestos">
          <SettingRow
            icon="percent"
            label={`Impuesto (${taxName})`}
            value={`${ivaPct}%`}
            onClick={() => setEditor({ kind: 'billing' })}
          />
          <SettingRow
            icon="dollar-sign"
            label="Valor del dólar"
            value={`Bs ${Number(bsRate).toFixed(2)}`}
            onClick={() => setEditor({ kind: 'bsrate' })}
          />
          <SettingRow
            icon="coins"
            label="Moneda"
            value={CURRENCY_LABEL[currency] || currency}
            onClick={() => setEditor({ kind: 'currency' })}
          />
          <SettingRow
            icon="file-text"
            label="Próxima factura"
            value={nextInvoice}
          />
          <SettingToggleRow
            icon="printer"
            label="Imprimir automáticamente"
            sub="Imprime el recibo al cobrar"
            value={printAuto}
            onChange={(v) => void save({ printAuto: v })}
          />
          <SettingToggleRow
            icon="mail"
            label="Enviar recibo por email"
            sub="Si el cliente tiene email registrado"
            value={emailReceipt}
            onChange={(v) => void save({ emailReceipt: v })}
            last
          />
        </SettingsSection>

        {/* Preferences */}
        <SettingsSection title="Preferencias">
          <SettingToggleRow
            icon="bell"
            label="Alertas de bajo stock"
            sub="Avisar cuando un producto baje del mínimo"
            value={lowStockAlerts}
            onChange={(v) => void save({ lowStockAlerts: v })}
          />
          <SettingToggleRow
            icon="volume-2"
            label="Sonido al escanear"
            sub="Bip de confirmación de lectura"
            value={soundScan}
            onChange={(v) => void save({ soundScan: v })}
          />
          <SettingRow
            icon="scan-line"
            label="Modo de escaneo"
            value={
              scannerMode === 'camera'
                ? 'Cámara del dispositivo'
                : 'Escáner físico'
            }
            onClick={() => setEditor({ kind: 'scanner' })}
          />
          <SettingRow icon="globe" label="Idioma" value="Español" last />
        </SettingsSection>

        {/* Sync */}
        <SettingsSection title="Sincronización" hint="Conexión con el servidor">
          <div className="set-sync-row">
            <span className="set-row-icon">
              <Icon name="refresh-cw" size={18} />
            </span>
            <span className="set-row-text">
              <span className="set-row-label">Estado del servidor</span>
              <span className="set-row-sub">
                {online
                  ? 'Sincronización en tiempo real'
                  : 'Trabajando sin conexión'}
              </span>
            </span>
            <Chip tone={online ? 'ok' : 'warn'}>
              <span className="net-dot-inline" />
              {online ? 'Conectado' : 'Sin conexión'}
            </Chip>
          </div>
          <SettingRow icon="link" label="Servidor" value="Convex" />
          <SettingRow
            icon="database"
            label="Sincronizar ahora"
            onClick={online ? () => alert('Sincronizando… (demo)') : undefined}
            value={online ? undefined : 'Sin conexión'}
            last
          />
        </SettingsSection>

        {/* About */}
        <SettingsSection title="Acerca de">
          <SettingRow icon="info" label="Versión" value="v0.1 · Demo" />
          <SettingRow
            icon="file-text"
            label="Términos y condiciones"
            onClick={() => alert('Términos (demo)')}
          />
          <SettingRow
            icon="shield"
            label="Política de privacidad"
            onClick={() => alert('Privacidad (demo)')}
            last
          />
        </SettingsSection>
      </div>

      {editor?.kind === 'account' && (
        <SettingsEditSheet
          title="Editar perfil"
          values={{ name: user?.name || '', role: user?.role || 'cajero' }}
          fields={[
            { key: 'name', label: 'Nombre', placeholder: 'Nombre del cajero' },
            {
              key: 'role',
              label: 'Rol',
              type: 'select',
              options: [
                { value: 'cajero', label: 'Cajero' },
                { value: 'supervisor', label: 'Supervisor' },
                { value: 'admin', label: 'Administrador' },
              ],
            },
          ]}
          onSave={() => setEditor(null)}
          onClose={() => setEditor(null)}
        />
      )}

      {editor?.kind === 'store' && (
        <SettingsEditSheet
          title="Datos de la tienda"
          values={{ name: storeName, taxId: storeRif, phone, address }}
          fields={[
            { key: 'name', label: 'Nombre', placeholder: 'Nombre comercial' },
            { key: 'taxId', label: 'RIF', placeholder: 'J-12345678-9' },
            { key: 'phone', label: 'Teléfono', placeholder: '+507 0000-0000' },
            {
              key: 'address',
              label: 'Dirección',
              type: 'textarea',
              placeholder: 'Calle / edificio / ciudad',
            },
          ]}
          onSave={(v) => {
            void save({
              storeName: v.name,
              storeRif: v.taxId,
              phone: v.phone,
              address: v.address,
            });
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}

      {editor?.kind === 'billing' && (
        <SettingsEditSheet
          title="Impuestos"
          values={{ taxName: taxName, taxRate: String(ivaPct) }}
          fields={[
            {
              key: 'taxName',
              label: 'Nombre del impuesto',
              placeholder: 'IVA',
            },
            {
              key: 'taxRate',
              label: 'Tasa (%)',
              placeholder: '13',
              type: 'number',
              inputMode: 'decimal',
              min: '0',
            },
          ]}
          onSave={(v) => {
            const n = parseFloat(v.taxRate);
            const patch: SettingsPatch = { taxName: v.taxName };
            if (!isNaN(n)) patch.ivaPct = n;
            void save(patch);
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}

      {editor?.kind === 'bsrate' && (
        <SettingsEditSheet
          title="Valor del dólar"
          values={{ bsRate: String(bsRate) }}
          fields={[
            {
              key: 'bsRate',
              label: 'Bolívares por dólar (Bs/$)',
              placeholder: '36.50',
              type: 'number',
              inputMode: 'decimal',
              min: '0',
            },
          ]}
          onSave={(v) => {
            const n = parseFloat(v.bsRate);
            if (!isNaN(n) && n > 0) void save({ bsRate: n });
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}

      {editor?.kind === 'currency' && (
        <SettingsEditSheet
          title="Moneda"
          values={{ currency: currency }}
          fields={[
            {
              key: 'currency',
              label: 'Moneda del sistema',
              type: 'select',
              options: [{ value: 'USD', label: 'US$ Dólar estadounidense' }],
            },
          ]}
          onSave={(v) => {
            void save({ currency: v.currency });
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}

      {editor?.kind === 'scanner' && (
        <SettingsEditSheet
          title="Modo de escaneo"
          values={{ scanner: scannerMode }}
          fields={[
            {
              key: 'scanner',
              label: 'Escáner',
              type: 'select',
              options: [
                { value: 'physical', label: 'Escáner físico' },
                { value: 'camera', label: 'Cámara del dispositivo' },
              ],
            },
          ]}
          onSave={(v) => {
            void save({ scannerMode: v.scanner as 'physical' | 'camera' });
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
