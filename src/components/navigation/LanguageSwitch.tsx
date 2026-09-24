import { Languages } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { LOCALE_META, otherLocale } from '@/i18n/config';
import { useI18n } from '@/i18n/context';
import { switchLocalePath } from '@/i18n/paths';

/** Storefront language switch: a real link to the same page in the other language (crawlable, shareable). */
export function LanguageSwitch({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  const { locale, t } = useI18n();
  const location = useLocation();
  const target = otherLocale(locale);
  return (
    <Link
      className={className}
      to={switchLocalePath(location, target)}
      hrefLang={LOCALE_META[target].htmlLang}
      lang={LOCALE_META[target].htmlLang}
      aria-label={t('common.switchToOtherLabel')}
    >
      <Languages className={iconClassName} aria-hidden="true" />
      <span>{t('common.switchToOther')}</span>
    </Link>
  );
}
