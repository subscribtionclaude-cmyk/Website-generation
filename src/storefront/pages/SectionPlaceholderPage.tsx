import { Construction, House, Phone } from 'lucide-react';
import { useMatches } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { Badge } from '@/components/ui/Badge';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { resolveLocalized } from '@/domain/localized';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { toTelHref } from '@/lib/phone';
import { useIsDemoMode } from '@/runtime/context';
import type { SectionHandle } from '../routeHandles';
import styles from './pages.module.css';

/**
 * Honest placeholder for storefront sections scheduled for later phases.
 * Offers real next actions (home, call the branch) instead of fake, non-functional UI.
 */
export function SectionPlaceholderPage() {
  const matches = useMatches();
  const handle = matches.at(-1)?.handle as SectionHandle | undefined;
  const { navigation, store } = useSettings();
  const { t, locale } = useI18n();
  const isDemo = useIsDemoMode();

  const navItem =
    navigation.primary.find((item) => item.id === handle?.section) ??
    navigation.mobileTabBar.find((item) => item.id === `tab-${handle?.section}`);
  const title = navItem ? resolveLocalized(navItem.label, locale) : t('placeholder.title');
  usePageMeta({ title, noIndex: true });

  const phone = store.branches[0]?.phones[0];
  const tel = phone ? toTelHref(phone) : null;

  return (
    <div className={`container ${styles.page}`}>
      <StateMessage
        headingLevel={1}
        icon={<Construction />}
        title={title}
        body={
          <>
            <strong>{t('placeholder.title')}.</strong> {t('placeholder.body')}
            {isDemo && handle && (
              <span className={styles.demoNote} style={{ display: 'block' }}>
                <Badge tone="brand">
                  {t('common.phaseBadge', { phase: String(handle.phase).padStart(2, '0') })}
                </Badge>{' '}
                {t('placeholder.demoNote', { phase: String(handle.phase).padStart(2, '0') })}
              </span>
            )}
          </>
        }
        actions={
          <>
            <ButtonLink to="/" variant="primary" icon={<House aria-hidden="true" />}>
              {t('common.backHome')}
            </ButtonLink>
            {tel && (
              <a className={buttonClassName({ variant: 'secondary' })} href={tel}>
                <Phone aria-hidden="true" />
                {t('common.contactUs')}
              </a>
            )}
          </>
        }
      />
    </div>
  );
}
