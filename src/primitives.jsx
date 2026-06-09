// Primitives — buttons, icons, chips, inputs, app bar, sheet, nav layout

const NavContext = React.createContext(null);

function Icon({ name, size = 22, color, style, ...rest }) {
  // Render the lucide icon inside a stable <span> wrapper that React owns.
  const ref = React.useRef(null);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerHTML = `<i data-lucide="${name}"></i>`;
    if (window.lucide && window.lucide.createIcons) {
      try {window.lucide.createIcons({ icons: window.lucide.icons, nameAttr: 'data-lucide' });}
      catch (_) {try {window.lucide.createIcons();} catch (_) {}}
      // After lucide swaps <i> for <svg>, force the svg to fill our wrapper
      const svg = node.querySelector('svg');
      if (svg) {
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.style.display = 'block';
      }
    }
  }, [name, size]);
  return (
    <span
      ref={ref}
      style={{
        width: size, height: size,
        display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        flex: 'none',
        color,
        ...style
      }}
      {...rest} />);


}

function IconButton({ icon, onClick, ariaLabel, ...rest }) {
  return (
    <button className="iconbtn" onClick={onClick} aria-label={ariaLabel} {...rest}>
      <Icon name={icon} />
    </button>);

}

function Button({ variant = 'primary', size, children, icon, onClick, disabled, type = 'button', block, style }) {
  const cls = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : size === 'md' ? 'btn-md' : '', block ? 'btn-block' : ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} style={style}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>);

}

function Chip({ tone = 'neutral', children, style }) {
  return <span className={`chip chip-${tone}`} style={style}>{children}</span>;
}

function Input({ mono, ...rest }) {
  return <input className={`input${mono ? ' mono' : ''}`} {...rest} />;
}

function AppBar({ title, sub, left, right, brand, online = true }) {
  const nav = React.useContext(NavContext);

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
            <img src="ds/logo-mark.svg" alt="" />
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

function NavSidebar({ nav, currentRoute, user, online, onClose, collapsed, onToggleCollapse }) {
  return (
    <aside className="navside">
      <div className="navside-brand">
        <img className="navside-logo" src="ds/logo-mark.svg" alt="" />
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
            <div className="navside-urole">{(window.ROLE_LABELS && window.ROLE_LABELS[user.role]) || user.role}</div>
          </div>
        </div>
      }
    </aside>);

}

function NavDrawer({ nav, currentRoute, user, online, onClose }) {
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

function NavLayout({ nav, currentRoute, user, online, hidden, children }) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const value = React.useMemo(
    () => ({
      collapsed,
      openDrawer: () => setDrawerOpen(true),
      // On desktop the hamburger toggles the persistent sidebar; on mobile it
      // opens the slide-in drawer.
      onMenuClick: () => {
        const desktop = window.matchMedia('(min-width: 768px)').matches
          && !document.querySelector('.shell.force-mobile');
        if (desktop) setCollapsed((c) => !c);
        else setDrawerOpen(true);
      },
    }),
    [collapsed]);
  // Auto-close drawer on route change
  React.useEffect(() => {setDrawerOpen(false);}, [currentRoute]);
  // Lock body scroll while drawer is open
  React.useEffect(() => {
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

function BottomBar({ children, className = '' }) {
  return <div className={`bottombar ${className}`}>{children}</div>;
}

function Sheet({ onClose, children, dialog, title }) {
  // Draggable bottom sheet — only meaningful on mobile (where the grip shows).
  const sheetRef = React.useRef(null);
  const gripRef = React.useRef(null);
  const startY = React.useRef(0);
  const dragging = React.useRef(false);
  const [drag, setDrag] = React.useState(0);

  // Detect whether we're in "mobile sheet" mode — drives drag/tap-to-close logic
  // and the grip rendering. Anything wider than 700px (or force-desktop) is a
  // centered modal with no drag affordance.
  const [isMobileSheet, setIsMobileSheet] = React.useState(() => {
    if (typeof window === 'undefined') return true;
    const shell = document.querySelector('.shell');
    if (shell?.classList.contains('force-desktop')) return false;
    if (shell?.classList.contains('force-mobile')) return true;
    return window.innerWidth < 700;
  });
  React.useEffect(() => {
    const update = () => {
      const shell = document.querySelector('.shell');
      if (shell?.classList.contains('force-desktop')) return setIsMobileSheet(false);
      if (shell?.classList.contains('force-mobile')) return setIsMobileSheet(true);
      setIsMobileSheet(window.innerWidth < 700);
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const isDraggable = !dialog && isMobileSheet;

  const beginDrag = (clientY, fromGrip) => {
    dragging.current = { fromGrip, startY: clientY, moved: false };
    startY.current = clientY;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  };

  const moveDrag = (clientY) => {
    if (!dragging.current) return;
    const dy = clientY - startY.current;
    if (Math.abs(dy) > 4) dragging.current.moved = true;
    setDrag(dy > 0 ? dy : 0);
  };

  const endDrag = () => {
    if (!dragging.current) return;
    const wasMoved = dragging.current.moved;
    const fromGrip = dragging.current.fromGrip;
    dragging.current = false;
    if (sheetRef.current) sheetRef.current.style.transition = '';
    // Tap on grip (no movement) → close
    if (fromGrip && !wasMoved) {
      onClose && onClose();
      return;
    }
    if (drag > 120) {
      onClose && onClose();
    } else {
      setDrag(0);
    }
  };

  // Native touch handlers on the grip — preventDefault works here because we
  // don't pass passive event listeners. Pointer events on iOS Safari can still
  // get hijacked by the browser as scroll, so the grip handles touch directly.
  React.useEffect(() => {
    if (!isDraggable) return;
    const grip = gripRef.current;
    if (!grip) return;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      beginDrag(e.touches[0].clientY, true);
      e.preventDefault();
    };
    const onTouchMove = (e) => {
      if (!dragging.current) return;
      moveDrag(e.touches[0].clientY);
      e.preventDefault();
    };
    const onTouchEnd = (e) => {
      if (!dragging.current) return;
      endDrag();
      e.preventDefault();
    };

    grip.addEventListener('touchstart', onTouchStart, { passive: false });
    grip.addEventListener('touchmove', onTouchMove, { passive: false });
    grip.addEventListener('touchend', onTouchEnd, { passive: false });
    grip.addEventListener('touchcancel', onTouchEnd, { passive: false });
    return () => {
      grip.removeEventListener('touchstart', onTouchStart);
      grip.removeEventListener('touchmove', onTouchMove);
      grip.removeEventListener('touchend', onTouchEnd);
      grip.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isDraggable, drag]);

  // Body drag (mouse) — only from grip/title header area
  const onPointerDown = (e) => {
    if (!isDraggable || !sheetRef.current) return;
    if (e.pointerType === 'touch') return; // touch handled via touch events on grip
    const target = e.target;
    const fromGrip = !!(gripRef.current && gripRef.current.contains(target));
    if (!fromGrip) return; // only drag from the header zone
    beginDrag(e.clientY, true);
    try {sheetRef.current.setPointerCapture(e.pointerId);} catch (_) {}
  };
  const onPointerMove = (e) => {
    if (!dragging.current || e.pointerType === 'touch') return;
    moveDrag(e.clientY);
  };
  const onPointerFinish = (e) => {
    if (!dragging.current || e.pointerType === 'touch') return;
    try {sheetRef.current && sheetRef.current.releasePointerCapture(e.pointerId);} catch (_) {}
    endDrag();
  };

  const style = drag > 0 ? { transform: `translateY(${drag}px)` } : undefined;

  return (
    <div className="scrim" onClick={onClose}>
      <div
        ref={sheetRef}
        className={dialog ? 'dialog' : 'sheet'}
        style={{ ...style, textAlign: "center" }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerFinish}
        onPointerCancel={onPointerFinish}>
        {!dialog && isMobileSheet &&
        <div className="sheet-head" ref={gripRef}>
            <div className="grip-bar" />
            {title && <div className="sheet-title">{title}</div>}
          </div>
        }
        {!dialog && !isMobileSheet && title &&
        <div className="sheet-title sheet-title-desktop">{title}</div>
        }
        {children}
      </div>
    </div>);

}

function Banner({ tone = 'info', icon, title, message, action }) {
  return (
    <div className={`banner ${tone}`}>
      <span className="ic"><Icon name={icon || 'info'} size={18} /></span>
      <div className="body">
        {title && <div className="ttl">{title}</div>}
        <div className="msg">{message}</div>
      </div>
      {action}
    </div>);

}

function Segmented({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) =>
      <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      )}
    </div>);

}

Object.assign(window, {
  Icon, IconButton, Button, Chip, Input, AppBar,
  NavContext, NavLayout, NavSidebar, NavDrawer,
  BottomBar, Sheet, Banner, Segmented
});