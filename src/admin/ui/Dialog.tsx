import { AlertTriangle, HelpCircle } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { useAdminI18n } from '../i18n/context';
import styles from './adminUi.module.css';

/**
 * Modal dialog on the native <dialog>: focus trap, Escape, inert background and screen-reader
 * semantics come from the platform. Replaces window.confirm() everywhere in the admin.
 */
export function Dialog({
  open,
  onClose,
  title,
  icon,
  tone = 'default',
  wide,
  children,
  role = 'dialog',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  wide?: boolean;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const notifyClosed = useEffectEvent(() => onClose());

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handle = () => notifyClosed();
    dialog.addEventListener('close', handle);
    return () => dialog.removeEventListener('close', handle);
  }, []);

  return (
    <dialog
      ref={ref}
      role={role}
      aria-labelledby={titleId}
      aria-modal="true"
      className={[styles.dialog, wide && styles.dialogWide].filter(Boolean).join(' ')}
    >
      {open && (
        <div className={styles.dialogBody}>
          <div className={styles.dialogHead}>
            {icon !== null && (
              <span
                className={[styles.dialogIcon, tone === 'danger' && styles.dialogIconDanger]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden="true"
              >
                {icon ?? (tone === 'danger' ? <AlertTriangle /> : <HelpCircle />)}
              </span>
            )}
            <h2 id={titleId} className={styles.dialogTitle}>
              {title}
            </h2>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** Names of the rows the action affects (shown as a list with the count). */
  affected?: string[];
  confirmLabel: string;
  tone?: 'default' | 'danger';
  /** Ask for a reason (recorded in the audit log). */
  reason?: 'required' | 'optional';
  /** Require typing this word before the confirm button enables (very destructive actions). */
  typeToConfirm?: string;
  irreversible?: boolean;
}

/** Accessible confirmation for destructive / wide-impact actions (bulk, delete, price, roles…). */
export function ConfirmDialog({
  open,
  options,
  onCancel,
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  options: ConfirmOptions | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  pending?: boolean;
  error?: string | null;
}) {
  const { at } = useAdminI18n();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const reasonId = useId();
  const typedId = useId();
  const tone = options?.tone ?? 'default';
  const blocked =
    (options?.reason === 'required' && reason.trim().length === 0) ||
    (options?.typeToConfirm !== undefined && typed.trim() !== options.typeToConfirm);

  const close = () => {
    setReason('');
    setTyped('');
    onCancel();
  };

  return (
    <Dialog
      open={open && options !== null}
      onClose={close}
      title={options?.title ?? ''}
      tone={tone}
      role="alertdialog"
    >
      {options && (
        <form
          className={styles.stack}
          onSubmit={(event) => {
            event.preventDefault();
            if (!blocked) onConfirm(reason.trim());
          }}
        >
          {options.body && <div>{options.body}</div>}
          {options.affected && options.affected.length > 0 && (
            <div>
              <p className={styles.fieldLabel}>
                {at('ui.affectedTitle', { count: options.affected.length })}
              </p>
              <ul className={styles.affected}>
                {options.affected.slice(0, 50).map((name, i) => (
                  <li key={`${name}-${i}`}>{name}</li>
                ))}
                {options.affected.length > 50 && <li>…</li>}
              </ul>
            </div>
          )}
          {options.irreversible && <Alert tone="warning">{at('ui.irreversible')}</Alert>}
          {options.reason && (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={reasonId}>
                {at('ui.reason')} {options.reason === 'optional' ? `(${at('ui.optional')})` : ''}
              </label>
              <textarea
                id={reasonId}
                className={styles.control}
                value={reason}
                required={options.reason === 'required'}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby={`${reasonId}-hint`}
              />
              <span id={`${reasonId}-hint`} className={styles.hint}>
                {at('ui.reasonHint')}
              </span>
            </div>
          )}
          {options.typeToConfirm && (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={typedId}>
                {at('ui.typeToConfirm', { word: options.typeToConfirm })}
              </label>
              <input
                id={typedId}
                className={`${styles.control} ${styles.ltrInput}`}
                value={typed}
                autoComplete="off"
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
          )}
          {error && (
            <Alert tone="danger" live>
              {error}
            </Alert>
          )}
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={close} disabled={pending}>
              {at('ui.cancel')}
            </Button>
            <Button
              type="submit"
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={pending}
              disabled={blocked}
            >
              {options.confirmLabel}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
