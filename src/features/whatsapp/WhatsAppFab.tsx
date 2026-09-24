import { MessageCircle, MessageCircleWarning } from 'lucide-react';
import { useId, useState } from 'react';
import { useAccess } from '@/features/auth/context';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { useIsDemoMode } from '@/runtime/context';
import { useCurrentWhatsAppMessage } from './context';
import styles from './WhatsAppFab.module.css';

/**
 * Floating WhatsApp entry point. Never renders a broken link:
 *  - configured + valid number → click-to-chat link;
 *  - not configured → hidden from customers; staff (and demo previews) see setup guidance instead.
 * Context-aware messages: pages register one with useWhatsAppMessage() (e.g. product + variant).
 */
export function WhatsAppFab({ message }: { message?: string }) {
  const { store } = useSettings();
  const { t } = useI18n();
  const isDemo = useIsDemoMode();
  const { isStaff } = useAccess();
  const [showGuidance, setShowGuidance] = useState(false);
  const panelId = useId();
  const pageMessage = useCurrentWhatsAppMessage();

  const link = buildWhatsAppLink(
    store.whatsappNumber,
    message ?? pageMessage ?? t('whatsapp.generalMessage'),
  );

  if (link.status === 'ok') {
    return (
      <div className={styles.root}>
        <a
          className={styles.fab}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${t('whatsapp.fabLabel')} ${t('common.externalLink')}`}
        >
          <MessageCircle aria-hidden="true" />
        </a>
      </div>
    );
  }

  if (!isDemo && !isStaff) return null;

  return (
    <div className={styles.root}>
      {showGuidance && (
        <div id={panelId} className={styles.panel} role="status">
          <p className={styles.panelTitle}>{t('whatsapp.notConfiguredTitle')}</p>
          <p className={styles.panelBody}>{t('whatsapp.notConfiguredBody')}</p>
        </div>
      )}
      <button
        type="button"
        className={[styles.fab, styles.fabUnconfigured].join(' ')}
        aria-expanded={showGuidance}
        aria-controls={panelId}
        aria-label={t('whatsapp.notConfiguredTitle')}
        onClick={() => setShowGuidance((value) => !value)}
      >
        <MessageCircleWarning aria-hidden="true" />
      </button>
    </div>
  );
}
