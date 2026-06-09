// Login screen

function LoginScreen({ onLogin, online }) {
  const [email, setEmail] = React.useState('carlos@mitienda.com');
  const [pw, setPw] = React.useState('••••••••');
  const [err, setErr] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const submit = (e) => {
    e.preventDefault();
    if (!online) { setErr('Sin conexión con el servidor. Intenta de nuevo.'); return; }
    setLoading(true);
    setTimeout(() => { setLoading(false); onLogin({ id: 'E-0001', name: 'Carlos Méndez', role: 'owner', permissions: 'all' }); }, 350);
  };

  return (
    <>
      <AppBar brand title="Smart Inventory POS" sub="v0.1 · Demo" online={online} />
      <div className="content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="login">
          <img src="ds/logo-mark.svg" className="logo" alt="" />
          <div className="title-block">
            <h1 className="h">Inicia sesión</h1>
          </div>
          {err && <Banner tone="danger" icon="wifi-off" message={err} />}
          {!online && !err && <Banner tone="warn" icon="wifi-off" title="Sin conexión" message="Conéctate a internet para iniciar sesión." />}
          <form onSubmit={submit}>
            <div>
              <label>Email o usuario</label>
              <Input value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label>Contraseña</label>
              <Input type="password" value={pw} onChange={e => setPw(e.target.value)} />
            </div>
            <div style={{ height: 4 }} />
            <Button type="submit" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</Button>
            <Button variant="secondary" type="button">¿Olvidaste tu contraseña?</Button>
          </form>
        </div>
      </div>
    </>
  );
}

window.LoginScreen = LoginScreen;
