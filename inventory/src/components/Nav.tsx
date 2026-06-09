// Nav — NavContext, sidebar, drawer and layout shell ported from prototype
// primitives.jsx. Only two changes vs the prototype: ROLE_LABELS comes from
// '../lib/rbac' (was window.ROLE_LABELS) and the desktop check drops the
// force-mobile shell class (pure media query now).
import { createContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { ROLE_LABELS } from '@/lib/rbac';
import logoUrl from '@/assets/logo-mark.svg';

export interface NavContextValue {
  collapsed: boolean;
  openDrawer: () => void;
  onMenuClick?: () => void;
}

export const NavContext = createContext<NavContextValue | null>(null);

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  onClick?: () => void;
  badge?: number | null;
  tone?: 'danger';
  perm?: string;
}

export interface NavUser {
  name?: string;
  role?: string;
  [key: string]: any;
}

export interface NavSidebarProps {
  nav: NavItem[];
  currentRoute?: string;
  user?: NavUser | null;
  online?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function NavSidebar({ nav, currentRoute, user, online, onClose, collapsed, onToggleCollapse }: NavSidebarProps) {
  return (
    <aside className="navside">
      <div className="navside-brand">
        <img className="navside-logo" src={logoUrl} alt="" />
        <div className="navside-brand-text" style={{ minWidth: 0 }}>
          <div className="navside-name">Inventory POS</div>
          <div className="navside-ver">v0.1 · Demo</div>
        </div>
        {onToggleCollapse &&
        <button className="iconbtn navside-toggle" aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'} onClick={onToggleCollapse}>
            <Icon name="menu" />
          </button>
        }
        {onClose &&
        <button className="iconbtn navside-close" aria-label="Cerrar menú" onClick={onClose}>
            <Icon name="x" />
          </button>
        }
      </div>
      <nav className="navside-nav">
        {nav.map((item) =>
        <button
          key={item.id}
          title={item.label}
          className={`navside-item ${currentRoute === item.id ? 'on' : ''} ${item.tone === 'danger' ? 'danger' : ''}`}
          onClick={() => {if (onClose) onClose();item.onClick && item.onClick();}}>
            <Icon name={item.icon} size={20} />
            <span className="navside-label">{item.label}</span>
            {item.badge != null && <span className="navside-badge">{item.badge}</span>}
          </button>
        )}
      </nav>
      <div className="navside-status">
        <span className={`net ${online ? '' : 'off'}`}>
          <span className="dot" />
          {online ? 'Conectado' : 'Sin conexión'}
        </span>
      </div>
      {user &&
      <div className="navside-user">
          <div className="navside-avatar">{user.name?.[0] || 'U'}</div>
          <div className="navside-user-text" style={{ minWidth: 0, flex: 1 }}>
            <div className="navside-uname">{user.name}</div>
            <div className="navside-urole">{(user.role && ROLE_LABELS[user.role]) || user.role}</div>
          </div>
        </div>
      }
    </aside>);

}

export interface NavDrawerProps {
  nav: NavItem[];
  currentRoute?: string;
  user?: NavUser | null;
  online?: boolean;
  onClose?: () => void;
}

export function NavDrawer({ nav, currentRoute, user, online, onClose }: NavDrawerProps) {
  return (
    <div className="navdrawer-scrim" onClick={onClose}>
      <div className="navdrawer" onClick={(e) => e.stopPropagation()}>
        <NavSidebar
          nav={nav}
          currentRoute={currentRoute}
          user={user}
          online={online}
          onClose={onClose} />
      </div>
    </div>);

}

export interface NavLayoutProps {
  nav: NavItem[];
  currentRoute?: string;
  user?: NavUser | null;
  online?: boolean;
  hidden?: boolean;
  children?: ReactNode;
}

export function NavLayout({ nav, currentRoute, user, online, hidden, children }: NavLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const value = useMemo<NavContextValue>(
    () => ({
      collapsed,
      openDrawer: () => setDrawerOpen(true),
      // On desktop the hamburger toggles the persistent sidebar; on mobile it
      // opens the slide-in drawer.
      onMenuClick: () => {
        const desktop = window.matchMedia('(min-width: 768px)').matches;
        if (desktop) setCollapsed((c) => !c);
        else setDrawerOpen(true);
      },
    }),
    [collapsed]);
  // Auto-close drawer on route change
  useEffect(() => {setDrawerOpen(false);}, [currentRoute]);
  // Lock body scroll while drawer is open
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {document.body.style.overflow = prev;};
  }, [drawerOpen]);

  if (hidden) {
    return <NavContext.Provider value={null}>{children}</NavContext.Provider>;
  }

  return (
    <NavContext.Provider value={value}>
      <div className={`navlayout ${collapsed ? 'nav-collapsed' : ''}`}>
        <NavSidebar
          nav={nav}
          currentRoute={currentRoute}
          user={user}
          online={online}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)} />
        <div className="navmain">{children}</div>
      </div>
      {drawerOpen &&
      <NavDrawer
        nav={nav}
        currentRoute={currentRoute}
        user={user}
        online={online}
        onClose={() => setDrawerOpen(false)} />
      }
    </NavContext.Provider>);

}
