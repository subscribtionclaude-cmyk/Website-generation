import {
  Apple,
  BadgeCheck,
  Gamepad2,
  Headphones,
  Laptop,
  LayoutGrid,
  Plug,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Store,
  Tablet,
  Truck,
  Watch,
  Wrench,
  Bike,
  type LucideIcon,
} from 'lucide-react';

/** Whitelisted icon keys for data-driven categories, lines and trust items (no arbitrary markup). */
const ICONS: Record<string, LucideIcon> = {
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  watch: Watch,
  headphones: Headphones,
  gamepad: Gamepad2,
  scooter: Bike,
  plug: Plug,
  apple: Apple,
  shield: ShieldCheck,
  truck: Truck,
  store: Store,
  refresh: RefreshCcw,
  wrench: Wrench,
  badge: BadgeCheck,
};

export function DataIcon({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const Icon = (name && ICONS[name]) || LayoutGrid;
  return <Icon className={className} aria-hidden="true" />;
}
