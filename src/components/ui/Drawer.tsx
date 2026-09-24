import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import styles from './ui.module.css';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** id of the element that labels the drawer (usually its heading). */
  labelledBy: string;
  side?: 'start' | 'end';
  children: ReactNode;
}

/**
 * Side drawer built on the native modal <dialog>: focus containment, Escape-to-close, inert page
 * behind it and correct screen-reader semantics come from the platform.
 */
export function Drawer({ open, onClose, labelledBy, side = 'end', children }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const notifyClosed = useEffectEvent(() => onClose());

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      document.documentElement.style.overflow = '';
      notifyClosed();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  return (
    // Backdrop clicks land on the <dialog> element itself; keyboard users close with Escape (native).
    // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      className={[styles.drawer, side === 'start' && styles.drawerStart].filter(Boolean).join(' ')}
      aria-labelledby={labelledBy}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.drawerPanel}>{children}</div>
    </dialog>
  );
}
