// AppBar — ported from prototype primitives.jsx. Consumes NavContext for the
// hamburger (desktop sidebar toggle / mobile drawer opener). Brand logo comes
// from the bundled asset instead of the prototype's ds/ path.
import { useContext } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { NavContext } from './Nav';
import logoUrl from '@/assets/logo-mark.svg';

export interface AppBarProps {
  title?: ReactNode;
  sub?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  brand?: boolean;
  online?: boolean;
}

export function AppBar({ title, sub, left, right, brand, online = true }: AppBarProps) {
  const nav = useContext(NavContext);

  return (
    <header className="appbar">
      <div className="row" style={{ gap: 8, flex: '1 1 auto', minWidth: 0 }}>
        {nav &&
        <button
          className={`iconbtn appbar-hamburger ${nav.collapsed === false ? 'is-open' : 'is-collapsed'}`}
          aria-label={nav.collapsed === false ? 'Cerrar menú' : 'Abrir menú'}
          onClick={nav.onMenuClick || nav.openDrawer}>
            <span className="hamburger-desktop"><Icon name={nav.collapsed === false ? 'chevron-left' : 'chevron-right'} /></span>
            <span className="hamburger-mobile"><Icon name="menu" /></span>
          </button>
        }
        {left}
        {brand ?
        <div className="brand">
            <img src={logoUrl} alt="" />
            <div>
              <div className="title">{title}</div>
              {sub && <div className="sub">{sub}</div>}
            </div>
          </div> :

        <div style={{ minWidth: 0 }}>
            <div className="title">{title}</div>
            {sub && <div className="sub">{sub}</div>}
          </div>
        }
      </div>
      <div className="row appbar-actions" style={{ gap: 4 }}>
        {right}
      </div>
    </header>);

}
