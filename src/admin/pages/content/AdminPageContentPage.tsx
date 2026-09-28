import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, ExternalLink, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import type { AdminSection } from '@/domain/admin/schemas';
import { isSectionType, SECTION_PROP_SCHEMAS } from '@/domain/content/sections';
import type { LocalizedText } from '@/domain/localized';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { Dialog } from '../../ui/Dialog';
import { CheckboxField } from '../../ui/fields';
import { PageHeader } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { SchemaForm } from '../../ui/SchemaForm';
import { issuesByPath, type FieldIssue } from '../../ui/schemaIntrospect';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import { useFieldText } from '../../ui/useFieldText';
import styles from '../../ui/adminUi.module.css';
import { useLocalized } from '../catalog/catalogHooks';

const PAGES = [
  { key: 'home', href: '/' },
  { key: 'apple', href: '/apple' },
  { key: 'offers', href: '/offers' },
] as const;
type PageKey = (typeof PAGES)[number]['key'];

/**
 * Structured homepage / Apple / offers content: section visibility and each section's own
 * fields, validated by the storefront's section schemas. Reordering and layout editing belong to
 * the Phase 07 Site Editor, so they are intentionally not offered here.
 */
export function AdminPageContentPage() {
  const { at } = useAdminI18n();
  const [page, setPage] = useState<PageKey>('home');
  return (
    <>
      <PageHeader
        title={at('modules.page-content.title')}
        subtitle={at('sectionsAdmin.subtitle')}
      />
      <div className={styles.stack}>
        <Alert tone="info">
          {at('sectionsAdmin.phase7')}{' '}
          <Link to="/admin/site-editor">{at('sectionsAdmin.openEditor')}</Link>
        </Alert>
        <Tabs
          idBase="page-content"
          label={at('sectionsAdmin.pages')}
          tabs={PAGES.map((p) => ({
            id: p.key,
            label: at(`sectionsAdmin.page.${p.key}` as AdminMessageKey),
          }))}
          active={page}
          onChange={setPage}
        />
        <TabPanel idBase="page-content" active={page}>
          <SectionList
            key={page}
            pageKey={page}
            href={PAGES.find((p) => p.key === page)?.href ?? '/'}
          />
        </TabPanel>
      </div>
    </>
  );
}

function SectionList({ pageKey, href }: { pageKey: PageKey; href: string }) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { can } = useAccess();
  const repo = useAdminRepo();
  const loc = useLocalized();
  const [editing, setEditing] = useState<AdminSection | null>(null);
  const canEdit = can('content.manage') && can('content.publish');
  const list = useQuery({
    queryKey: ['admin', 'sections', pageKey],
    queryFn: () => repo.listPageSections(pageKey),
  });
  const toggle = useAdminAction(
    (s: AdminSection) => repo.savePageSection(s.id, !s.isVisible, s.props, s.updatedAt),
    {},
  );
  const titleOf = (s: AdminSection) => {
    const t = s.props.title as LocalizedText | null | undefined;
    return (t && loc(t)) || at(`sectionsAdmin.type.${s.type}` as AdminMessageKey);
  };

  return (
    <div className={styles.stack}>
      <div className={styles.actions}>
        <Link
          to={href}
          target="_blank"
          rel="noreferrer"
          className={buttonClassName({ variant: 'secondary' })}
        >
          <ExternalLink aria-hidden="true" />
          {at('sectionsAdmin.viewPage')}
        </Link>
      </div>
      {!canEdit && <Alert tone="info">{at('sectionsAdmin.readOnly')}</Alert>}
      {pageKey === 'apple' && (
        <Alert tone="info">
          {at('sectionsAdmin.appleStatement')}{' '}
          <Link to="/admin/settings/trust">{at('sectionsAdmin.editTrust')}</Link>
        </Alert>
      )}
      {toggle.error && (
        <Alert tone="danger" live>
          {toggle.error}
        </Alert>
      )}
      <QueryState query={list} isEmpty={(d) => d.length === 0}>
        {(sections) => (
          <ol
            className={styles.pickList}
            aria-label={at(`sectionsAdmin.page.${pageKey}` as AdminMessageKey)}
          >
            {sections.map((s) => (
              <li key={s.id}>
                <span className={styles.cellTitle}>
                  <span>{titleOf(s)}</span>
                  <span className={styles.small}>
                    {at(`sectionsAdmin.type.${s.type}` as AdminMessageKey)} ·{' '}
                    <span className={styles.mono}>{s.key}</span>
                  </span>
                  {s.updatedBy && (
                    <span className={`${styles.small} ${styles.muted}`}>
                      {at('ui.lastUpdated', { date: format.dateTime(s.updatedAt) })} ·{' '}
                      {at('ui.by', { name: s.updatedBy })}
                    </span>
                  )}
                </span>
                {s.isVisible ? (
                  <Badge tone="success">{at('sectionsAdmin.visible')}</Badge>
                ) : (
                  <Badge>{at('sectionsAdmin.hidden')}</Badge>
                )}
                {canEdit && (
                  <span className={styles.rowActions}>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={
                        s.isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />
                      }
                      loading={toggle.pending}
                      onClick={() => void toggle.run(s)}
                    >
                      <span>
                        {s.isVisible ? at('sectionsAdmin.hide') : at('sectionsAdmin.show')}
                        <span className="visually-hidden">: {titleOf(s)}</span>
                      </span>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Pencil aria-hidden="true" />}
                      onClick={() => setEditing(s)}
                    >
                      <span>
                        {at('ui.edit')}
                        <span className="visually-hidden">: {titleOf(s)}</span>
                      </span>
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </QueryState>
      {editing && (
        <SectionDialog
          key={editing.id + editing.updatedAt}
          section={editing}
          title={titleOf(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SectionDialog({
  section,
  title,
  onClose,
}: {
  section: AdminSection;
  title: string;
  onClose: () => void;
}) {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const fieldText = useFieldText();
  const [props, setProps] = useState<unknown>(section.props);
  const [visible, setVisible] = useState(section.isVisible);
  const [issues, setIssues] = useState<Record<string, FieldIssue>>({});
  const schema = isSectionType(section.type) ? SECTION_PROP_SCHEMAS[section.type] : null;
  const save = useAdminAction(
    (value: Record<string, unknown>) =>
      repo.savePageSection(section.id, visible, value, section.updatedAt),
    { onSuccess: onClose },
  );
  return (
    <Dialog open onClose={onClose} title={`${at('ui.edit')}: ${title}`} wide icon={null}>
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          if (!schema) return;
          const parsed = schema.safeParse(props);
          if (!parsed.success) {
            setIssues(issuesByPath(parsed.error));
            return;
          }
          setIssues({});
          void save.run(parsed.data as Record<string, unknown>);
        }}
      >
        <CheckboxField
          label={at('sectionsAdmin.visibleLabel')}
          hint={at('sectionsAdmin.visibleHint')}
          checked={visible}
          onChange={setVisible}
        />
        {schema ? (
          <div className={styles.formGrid}>
            <SchemaForm
              schema={schema}
              value={props}
              onChange={setProps}
              rootKey="section"
              ctx={{ ...fieldText, issues }}
            />
          </div>
        ) : (
          <Alert tone="warning">{at('sectionsAdmin.unknownType')}</Alert>
        )}
        {Object.keys(issues).length > 0 && (
          <Alert tone="danger" live>
            {at('schemaForm.fixErrors', { count: Object.keys(issues).length })}
          </Alert>
        )}
        {save.error && (
          <Alert tone="danger" live>
            {save.error}
          </Alert>
        )}
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {at('ui.cancel')}
          </Button>
          <Button type="submit" loading={save.pending} disabled={!schema}>
            {at('sectionsAdmin.savePublish')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
