import {
  BadgePercent,
  House,
  Newspaper,
  Phone,
  RefreshCcw,
  Recycle,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { NavIconKey } from '@/domain/settings/schemas';

/** Icon registry for admin-configurable navigation items (no arbitrary icon/HTML injection). */
const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  home: House,
  apple: Smartphone,
  store: ShoppingBag,
  offers: BadgePercent,
  new: Sparkles,
  'trade-in': RefreshCcw,
  repairs: Wrench,
  used: Recycle,
  news: Newspaper,
  contact: Phone,
  cart: ShoppingCart,
  account: UserRound,
};

export function NavIcon({ icon, className }: { icon: NavIconKey | undefined; className?: string }) {
  if (!icon) return null;
  const Icon = NAV_ICONS[icon];
  return <Icon className={className} aria-hidden="true" />;
}
