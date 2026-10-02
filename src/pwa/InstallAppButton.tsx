import { Download } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/context';
import { canInstall, promptInstall, subscribeInstall } from './install';

/** "Install the app" — only rendered when the browser offers installation. */
export function InstallAppButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const available = useSyncExternalStore(subscribeInstall, canInstall, () => false);
  if (!available) return null;
  return (
    <Button
      variant="inverse"
      size="sm"
      className={className}
      icon={<Download aria-hidden="true" />}
      onClick={() => void promptInstall()}
    >
      {t('pwa.install')}
    </Button>
  );
}
