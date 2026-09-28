import type { useBlocker } from 'react-router';
import { Button } from '@/components/ui/Button';
import { useAdminI18n } from '../i18n/context';
import { Dialog } from './Dialog';
import styles from './adminUi.module.css';

export function UnsavedChangesDialog({ blocker }: { blocker: ReturnType<typeof useBlocker> }) {
  const { at } = useAdminI18n();
  const open = blocker.state === 'blocked';
  return (
    <Dialog
      open={open}
      onClose={() => blocker.reset?.()}
      title={at('ui.unsavedTitle')}
      tone="danger"
      role="alertdialog"
    >
      <p>{at('ui.unsavedBody')}</p>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => blocker.reset?.()}>
          {at('ui.keepEditing')}
        </Button>
        <Button variant="danger" onClick={() => blocker.proceed?.()}>
          {at('ui.leave')}
        </Button>
      </div>
    </Dialog>
  );
}

/** Sticky save / discard bar for long editors. */
export function DirtyBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  saveLabel,
  disabled,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
  disabled?: boolean;
}) {
  const { at } = useAdminI18n();
  if (!dirty) return null;
  return (
    <div className={styles.dirtyBar} role="region" aria-label={at('ui.dirty')}>
      <span className={styles.dirtyText}>{at('ui.dirty')}</span>
      <Button variant="inverse" onClick={onDiscard} disabled={saving}>
        {at('ui.discard')}
      </Button>
      <Button variant="accent" onClick={onSave} loading={saving} disabled={disabled}>
        {saveLabel ?? at('ui.save')}
      </Button>
    </div>
  );
}
