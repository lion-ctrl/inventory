// Sheet — draggable bottom sheet ported from prototype primitives.jsx.
// Single change vs the prototype: isMobileSheet is a pure window.innerWidth
// check (force-mobile/desktop shell classes don't exist in production).
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

export interface SheetProps {
  onClose?: () => void;
  children?: ReactNode;
  dialog?: boolean;
  title?: ReactNode;
}

type DragState = false | { fromGrip: boolean; startY: number; moved: boolean };

export function Sheet({ onClose, children, dialog, title }: SheetProps) {
  // Draggable bottom sheet — only meaningful on mobile (where the grip shows).
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const gripRef = useRef<HTMLDivElement | null>(null);
  const startY = useRef(0);
  const dragging = useRef<DragState>(false);
  const [drag, setDrag] = useState(0);

  // Detect whether we're in "mobile sheet" mode — drives drag/tap-to-close logic
  // and the grip rendering. Anything wider than 700px is a centered modal with
  // no drag affordance.
  const [isMobileSheet, setIsMobileSheet] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth < 700;
  });
  useEffect(() => {
    const update = () => {
      setIsMobileSheet(window.innerWidth < 700);
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const isDraggable = !dialog && isMobileSheet;

  const beginDrag = (clientY: number, fromGrip: boolean) => {
    dragging.current = { fromGrip, startY: clientY, moved: false };
    startY.current = clientY;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  };

  const moveDrag = (clientY: number) => {
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
      onClose?.();
      return;
    }
    if (drag > 120) {
      onClose?.();
    } else {
      setDrag(0);
    }
  };

  // Native touch handlers on the grip — preventDefault works here because we
  // don't pass passive event listeners. Pointer events on iOS Safari can still
  // get hijacked by the browser as scroll, so the grip handles touch directly.
  useEffect(() => {
    if (!isDraggable) return;
    const grip = gripRef.current;
    if (!grip) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      beginDrag(e.touches[0].clientY, true);
      e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      moveDrag(e.touches[0].clientY);
      e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
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
    // Ported prototype deps: endDrag is recreated per render but re-binding the
    // listeners on [isDraggable, drag] matches the original behavior exactly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggable, drag]);

  // Body drag (mouse) — only from grip/title header area
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggable || !sheetRef.current) return;
    if (e.pointerType === 'touch') return; // touch handled via touch events on grip
    const target = e.target;
    const fromGrip = !!(gripRef.current && gripRef.current.contains(target as Node));
    if (!fromGrip) return; // only drag from the header zone
    beginDrag(e.clientY, true);
    try {sheetRef.current.setPointerCapture(e.pointerId);} catch { /* capture is best-effort */ }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || e.pointerType === 'touch') return;
    moveDrag(e.clientY);
  };
  const onPointerFinish = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || e.pointerType === 'touch') return;
    try {sheetRef.current?.releasePointerCapture(e.pointerId);} catch { /* release is best-effort */ }
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
