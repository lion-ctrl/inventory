// Login screen — ported from prototype login.jsx. Auth is email + 6-digit PIN
// (the PIN acts as the password; the visual design is unchanged).
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { AppBar, Banner, Button, Input } from '@/components';
import { useOnline } from '@/state/useOnline';
import { useSession } from '@/state/SessionContext';
import logoUrl from '@/assets/logo-mark.svg';

export default function LoginScreen() {
  const online = useOnline();
  const { login } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!online) {
      setErr('Sin conexión con el servidor. Intenta de nuevo.');
      return;
    }
    setLoading(true);
    const res = await login(email.trim(), pw.trim());
    setLoading(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    void navigate('/');
  };

  return (
    <>
      <AppBar
        brand
        title="Smart Inventory POS"
        sub="v0.1 · Demo"
        online={online}
      />
      <div
        className="content"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="login">
          <img src={logoUrl} className="logo" alt="" />
          <div className="title-block">
            <h1 className="h">Inicia sesión</h1>
          </div>
          {err && (
            <Banner
              tone="danger"
              icon={err.includes('conexión') ? 'wifi-off' : 'alert-triangle'}
              message={err}
            />
          )}
          {!online && !err && (
            <Banner
              tone="warn"
              icon="wifi-off"
              title="Sin conexión"
              message="Conéctate a internet para iniciar sesión."
            />
          )}
          <form onSubmit={(e) => void submit(e)}>
            <div>
              <label>Email o usuario</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label>Contraseña</label>
              <Input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </div>
            <div style={{ height: 4 }} />
            <Button type="submit" disabled={loading}>
              {loading ? 'Entrando…' : 'Entrar'}
            </Button>
            <Button variant="secondary" type="button">
              ¿Olvidaste tu contraseña?
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
