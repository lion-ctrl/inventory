// ErrorBoundary — the app's last line of defense. React surfaces an uncaught
// render error to the nearest boundary; with NONE, the whole tree unmounts to a
// blank white page (exactly what a stale session / any thrown gated query did
// before). This catches it and shows a recover affordance instead. Must be a
// class component — getDerivedStateFromError/componentDidCatch have no hook form.
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for debugging; the UI shows a recover affordance, not the stack.
    console.error('Uncaught render error:', error, info.componentStack);
  }

  private reload = () => {
    // A full reload re-runs boot (session revalidation + cart-draft hydration)
    // from a clean slate — the safest recovery for an unattended POS terminal.
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: 'var(--paper)',
        }}
      >
        <div
          style={{
            maxWidth: 380,
            width: '100%',
            textAlign: 'center',
            background: 'var(--surface)',
            borderRadius: 'var(--r-xl)',
            boxShadow: 'var(--shadow-3)',
            padding: '28px 24px',
          }}
        >
          <span
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 52,
              height: 52,
              margin: '0 auto 14px',
              borderRadius: 'var(--r-pill)',
              background: 'var(--danger-soft)',
            }}
          >
            <Icon name="alert-triangle" size={26} color="var(--danger)" />
          </span>
          <div
            style={{
              font: '700 20px var(--font-sans)',
              color: 'var(--ink)',
              marginBottom: 8,
            }}
          >
            Algo salió mal
          </div>
          <div
            style={{
              font: '400 14px var(--font-sans)',
              color: 'var(--ink-2)',
              lineHeight: 1.5,
              marginBottom: 20,
            }}
          >
            Ocurrió un error inesperado. Recargá la página para continuar — tu
            venta en curso se restaura si estaba guardada.
          </div>
          <button
            onClick={this.reload}
            style={{
              width: '100%',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 'var(--r-md)',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              font: '600 15px var(--font-sans)',
              padding: '12px 16px',
            }}
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
