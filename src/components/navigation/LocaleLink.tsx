import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link, NavLink, type NavLinkProps } from 'react-router';
import { useI18n } from '@/i18n/context';
import { isExternalHref, localizePath } from '@/i18n/paths';

interface LocaleLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** Locale-less internal path ("/store") or an absolute external URL. */
  to: string;
  children: ReactNode;
}

/** Link that keeps the visitor in their language (`/store` → `/en/store`) and hardens external links. */
export function LocaleLink({ to, children, ...rest }: LocaleLinkProps) {
  const { locale, t } = useI18n();
  if (isExternalHref(to)) {
    const isWeb = /^https?:/i.test(to);
    return (
      <a href={to} {...(isWeb ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...rest}>
        {children}
        {isWeb && <span className="visually-hidden"> {t('common.externalLink')}</span>}
      </a>
    );
  }
  return (
    <Link to={localizePath(to, locale)} {...rest}>
      {children}
    </Link>
  );
}

type LocaleNavLinkProps = Omit<NavLinkProps, 'to'> & { to: string };

/** NavLink variant for navigation menus (sets aria-current="page" on the active item). */
export function LocaleNavLink({ to, end, ...rest }: LocaleNavLinkProps) {
  const { locale } = useI18n();
  const path = localizePath(to, locale);
  return <NavLink to={path} end={end ?? (to === '/' || to === '')} {...rest} />;
}
