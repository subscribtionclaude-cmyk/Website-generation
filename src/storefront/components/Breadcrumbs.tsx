import { ChevronRight } from 'lucide-react';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { useI18n } from '@/i18n/context';
import styles from './catalog.module.css';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const { t } = useI18n();
  return (
    <nav className={styles.breadcrumbs} aria-label={t('catalog.breadcrumb')}>
      <ol>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`}>
              {item.href && !last ? (
                <LocaleLink to={item.href}>{item.label}</LocaleLink>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{item.label}</span>
              )}
              {!last && <ChevronRight className="flip-rtl" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
