import { type ReactNode, useEffect, useId, useRef } from 'react';

interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusFirstIn = (root: HTMLElement | null): void => {
  if (!root) return;
  const focusables = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  // Skip the close button (first focusable) so the drawer body gets attention.
  const target = focusables[1] ?? focusables[0] ?? null;
  target?.focus();
};

export const Drawer = ({ open, title, onClose, children }: DrawerProps): JSX.Element => {
  const titleId = useId();
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Manage initial focus on open + restore previous focus on close.
  useEffect(() => {
    if (open) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Wait one frame so the slide-in transition has begun and elements are interactive.
      const id = window.setTimeout(() => focusFirstIn(drawerRef.current), 60);
      return () => window.clearTimeout(id);
    }
    previousFocus.current?.focus();
    previousFocus.current = null;
    return undefined;
  }, [open]);

  // Toggle `inert` so closed-but-mounted drawer doesn't trap tab focus.
  useEffect(() => {
    const node = drawerRef.current;
    if (!node) return;
    if (open) {
      node.removeAttribute('inert');
    } else {
      node.setAttribute('inert', '');
    }
  }, [open]);

  // ESC + Tab focus trap.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = drawerRef.current;
      if (!root) return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-y-0 left-0 right-0 md:right-[36%] xl:right-[34%] bg-black/15 backdrop-blur-sm z-30 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`fixed inset-y-0 left-0 z-40 w-[88vw] md:w-[400px] bg-plate border-r border-line shadow-2xl flex flex-col transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-line flex-shrink-0">
          <h2 id={titleId} className="text-sm font-semibold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="p-1.5 rounded hover:bg-line/40 text-muted hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent/60"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" aria-hidden="true">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-3">{children}</div>
      </aside>
    </>
  );
};
