import { CalendarClock, SearchX } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { StateMessage } from '@/components/feedback/StateMessage';
import { Badge } from '@/components/ui/Badge';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../i18n/context';
import { findAdminModuleByPath } from '../modules';
import { RequireModule } from '../RequireModule';
import { useAdminPageMeta } from '../useAdminPageMeta';
import styles from '../admin.module.css';

/** Honest page for admin modules whose screens are delivered in a later phase. */
export function AdminPlannedModulePage() {
  const { moduleId = '' } = useParams();
  const module = findAdminModuleByPath(moduleId);
  if (!module || module.plannedPhase === null) return <AdminNotFound />;
  return (
    <RequireModule module={module}>
      <PlannedContent moduleId={module.id} phase={module.plannedPhase} />
    </RequireModule>
  );
}

function PlannedContent({ moduleId, phase }: { moduleId: string; phase: number }) {
  const { at } = useAdminI18n();
  const title = at(`modules.${moduleId}.title` as AdminMessageKey);
  const phaseLabel = String(phase).padStart(2, '0');
  useAdminPageMeta(title);
  return (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>{title}</h1>
        <p className={styles.pageSubtitle}>
          {at(`modules.${moduleId}.description` as AdminMessageKey)}
        </p>
      </div>
      <StateMessage
        icon={<CalendarClock />}
        title={at('planned.title', { phase: phaseLabel })}
        body={
          <>
            <Badge tone="brand">{at('shell.planned', { phase: phaseLabel })}</Badge>{' '}
            {at('planned.body')}
          </>
        }
        actions={
          <Link to="/admin" className={buttonClassName({ variant: 'primary' })}>
            {at('planned.back')}
          </Link>
        }
      />
    </>
  );
}

export function AdminNotFound() {
  const { t } = useI18n();
  const { at } = useAdminI18n();
  useAdminPageMeta(t('errors.notFoundTitle'));
  return (
    <StateMessage
      headingLevel={1}
      icon={<SearchX />}
      title={t('errors.notFoundTitle')}
      actions={
        <Link to="/admin" className={buttonClassName({ variant: 'primary' })}>
          {at('planned.back')}
        </Link>
      }
    />
  );
}
