import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { buttonClassName, type ButtonStyleProps } from '@/components/ui/buttonStyles';
import { LocaleLink } from './LocaleLink';

interface ButtonLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className'>, ButtonStyleProps {
  to: string;
  icon?: ReactNode;
  children: ReactNode;
}

/** A navigation link styled as a button (navigation stays a link for accessibility). */
export function ButtonLink({
  to,
  variant,
  size,
  block,
  className,
  icon,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <LocaleLink to={to} className={buttonClassName({ variant, size, block, className })} {...rest}>
      {icon}
      {children}
    </LocaleLink>
  );
}
