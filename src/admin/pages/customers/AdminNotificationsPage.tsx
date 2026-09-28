import { useQuery } from '@tanstack/react-query';
import {
  Mail,
  MessageCircle,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Send,
  Smartphone,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { NotificationTemplateRow, Recipient } from '@/domain/admin/schemas';
import { ltOrNull } from '@/domain/admin/validation';
import { TEMPLATE_PLACEHOLDERS } from '@/domain/customer/templates';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { DataTable, type Column } from '../../ui/DataTable';
import { ConfirmDialog, Dialog } from '../../ui/Dialog';
import { CheckboxField, InputField, LocalizedField } from '../../ui/fields';
import { toDraft, useConfirm, type LocalizedDraft } from '../../ui/hooks';
import { PageHeader, Panel } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { useAdminAction, useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { useLocalized } from '../catalog/catalogHooks';

type TabId = 'templates' | 'send' | 'channels';

/** Notification templates, manual in-app messages and channel status (in-app is the baseline). */
export function AdminNotificationsPage() {
  const { at } = useAdminI18n();
  const [tab, setTab] = useState<TabId>('templates');
  return (
    <>
      <PageHeader title={at('modules.notifications.title')} subtitle={at('notifyAdmin.subtitle')} />
      <Tabs
        idBase="notifications"
        label={at('modules.notifications.title')}
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'templates', label: at('notifyAdmin.tabs.templates') },
          { id: 'send', label: at('notifyAdmin.tabs.send') },
          { id: 'channels', label: at('notifyAdmin.tabs.channels') },
        ]}
      />
      <TabPanel idBase="notifications" active={tab}>
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'send' && <SendTab />}
        {tab === 'channels' && <ChannelsTab />}
      </TabPanel>
    </>
  );
}

function useNotificationAdmin() {
  const repo = useAdminRepo();
  return useQuery({
    queryKey: ['admin', 'notification-admin'],
    queryFn: () => repo.notificationAdmin(),
  });
}

function TemplatesTab() {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const loc = useLocalized();
  const data = useNotificationAdmin();
  const [editing, setEditing] = useState<NotificationTemplateRow | null>(null);
  const columns: Column<NotificationTemplateRow>[] = [
    {
      id: 'key',
      header: at('notifyAdmin.col.template'),
      rowHeader: true,
      cell: (t) => (
        <span className={styles.cellTitle}>
          <span>{loc(t.title)}</span>
          <span className={`${styles.mono} ${styles.muted}`}>{t.key}</span>
        </span>
      ),
    },
    {
      id: 'category',
      header: at('notifyAdmin.col.category'),
      cell: (t) => <Badge>{t.category}</Badge>,
    },
    {
      id: 'body',
      header: at('notifyAdmin.col.body'),
      cell: (t) => <span className={styles.small}>{loc(t.body)}</span>,
    },
    {
      id: 'active',
      header: at('notifyAdmin.col.status'),
      cell: (t) =>
        t.isActive ? (
          <Badge tone="success">{at('notifyAdmin.active')}</Badge>
        ) : (
          <Badge>{at('notifyAdmin.inactive')}</Badge>
        ),
    },
    {
      id: 'sent',
      header: at('notifyAdmin.col.sent30d'),
      className: styles.num,
      cell: (t) => format.number(t.sent30d),
    },
    {
      id: 'actions',
      header: <span className="visually-hidden">{at('ui.actions')}</span>,
      cell: (t) => (
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`${at('ui.edit')}: ${t.key}`}
          onClick={() => setEditing(t)}
        >
          <Pencil aria-hidden="true" />
        </button>
      ),
    },
  ];
  return (
    <div className={styles.stack}>
      <p className={styles.muted}>
        {at('notifyAdmin.templatesHint', {
          list: TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(' '),
        })}
      </p>
      <QueryState query={data}>
        {(d) => (
          <DataTable
            caption={at('notifyAdmin.tabs.templates')}
            rows={d.templates}
            rowKey={(t) => t.key}
            columns={columns}
          />
        )}
      </QueryState>
      {editing && <TemplateDialog template={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateDialog({
  template,
  onClose,
}: {
  template: NotificationTemplateRow;
  onClose: () => void;
}) {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const [title, setTitle] = useState<LocalizedDraft>(toDraft(template.title));
  const [body, setBody] = useState<LocalizedDraft>(toDraft(template.body));
  const [active, setActive] = useState(template.isActive);
  const save = useAdminAction(
    () =>
      repo.saveNotificationTemplate(
        template.key,
        ltOrNull(title.ar, title.en) ?? { ar: '' },
        ltOrNull(body.ar, body.en) ?? { ar: '' },
        active,
        template.updatedAt,
      ),
    { onSuccess: onClose },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={at('notifyAdmin.editTemplate', { key: template.key })}
      wide
      icon={null}
    >
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          void save.run();
        }}
      >
        <LocalizedField
          legend={at('notifyAdmin.title')}
          required
          value={title}
          maxLength={120}
          onChange={setTitle}
        />
        <LocalizedField
          legend={at('notifyAdmin.message')}
          required
          multiline
          rows={4}
          value={body}
          maxLength={1000}
          onChange={setBody}
        />
        <p className={`${styles.small} ${styles.muted}`}>
          {at('notifyAdmin.placeholders')}{' '}
          <bdi className={styles.mono}>
            {TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(' ')}
          </bdi>
        </p>
        <CheckboxField
          label={at('notifyAdmin.active')}
          hint={at('notifyAdmin.inactiveHint')}
          checked={active}
          onChange={setActive}
        />
        {save.error && (
          <Alert tone="danger" live>
            {save.error}
          </Alert>
        )}
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {at('ui.cancel')}
          </Button>
          <Button type="submit" loading={save.pending}>
            {at('ui.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SendTab() {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [title, setTitle] = useState<LocalizedDraft>({ ar: '', en: '' });
  const [body, setBody] = useState<LocalizedDraft>({ ar: '', en: '' });
  const [path, setPath] = useState('');
  const [sent, setSent] = useState<number | null>(null);
  const confirm = useConfirm();
  const results = useQuery({
    queryKey: ['admin', 'recipients', term],
    queryFn: () => repo.searchRecipients(term),
    enabled: term.length >= 2,
  });
  const send = useAdminAction(
    () =>
      repo.sendNotifications(
        recipients.map((r) => r.id),
        ltOrNull(title.ar, title.en) ?? { ar: '' },
        ltOrNull(body.ar, body.en) ?? { ar: '' },
        path.trim() || null,
      ),
    {
      onSuccess: (r) => {
        if (!r.ok) return;
        setSent(r.sent);
        setRecipients([]);
        setTitle({ ar: '', en: '' });
        setBody({ ar: '', en: '' });
        setPath('');
      },
    },
  );
  const ready = recipients.length > 0 && title.ar.trim() !== '' && body.ar.trim() !== '';
  return (
    <div className={styles.split}>
      <Panel title={at('notifyAdmin.compose')} icon={<Send aria-hidden="true" />}>
        <form
          className={styles.stack}
          onSubmit={(e) => {
            e.preventDefault();
            setSent(null);
            confirm.ask(
              {
                title: at('notifyAdmin.confirmTitle', { count: recipients.length }),
                body: at('notifyAdmin.confirmBody'),
                affected: recipients.map((r) => r.name ?? r.email ?? r.id),
                confirmLabel: at('notifyAdmin.send'),
              },
              undefined,
            );
          }}
        >
          <LocalizedField
            legend={at('notifyAdmin.title')}
            required
            value={title}
            maxLength={120}
            onChange={setTitle}
          />
          <LocalizedField
            legend={at('notifyAdmin.message')}
            required
            multiline
            rows={4}
            value={body}
            maxLength={1000}
            onChange={setBody}
          />
          <InputField
            label={at('notifyAdmin.link')}
            hint={at('notifyAdmin.linkHint')}
            value={path}
            ltr
            placeholder="/offers"
            onChange={(e) => setPath(e.target.value)}
          />
          <Alert tone="info">{at('notifyAdmin.inAppOnly')}</Alert>
          {send.error && (
            <Alert tone="danger" live>
              {send.error}
            </Alert>
          )}
          {sent !== null && (
            <Alert tone="success" live>
              {at('notifyAdmin.sent', { count: sent })}
            </Alert>
          )}
          <div className={styles.actions}>
            <Button
              type="submit"
              icon={<Send aria-hidden="true" />}
              disabled={!ready}
              loading={send.pending}
            >
              {at('notifyAdmin.sendTo', { count: recipients.length })}
            </Button>
          </div>
        </form>
      </Panel>
      <Panel title={at('notifyAdmin.recipients', { count: recipients.length })}>
        <form
          className={styles.filters}
          role="search"
          aria-label={at('notifyAdmin.findRecipients')}
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q.trim());
          }}
        >
          <InputField
            label={at('notifyAdmin.findRecipients')}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className={styles.filterActions}>
            <Button type="submit" variant="secondary" icon={<Search aria-hidden="true" />}>
              {at('ui.search')}
            </Button>
          </div>
        </form>
        {results.data && (
          <ul
            className={styles.stack}
            style={{
              listStyle: 'none',
              margin: 'var(--space-3) 0',
              padding: 0,
              gap: 'var(--space-1)',
            }}
          >
            {results.data.length === 0 && <li className={styles.muted}>{at('ui.empty')}</li>}
            {results.data.map((r) => (
              <li key={r.id}>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus aria-hidden="true" />}
                  disabled={recipients.some((x) => x.id === r.id) || recipients.length >= 200}
                  onClick={() => setRecipients([...recipients, r])}
                >
                  {r.name ?? r.email ?? r.id}
                </Button>{' '}
                {r.email && (
                  <bdi dir="ltr" className={styles.small}>
                    {r.email}
                  </bdi>
                )}
              </li>
            ))}
          </ul>
        )}
        {recipients.length > 0 && (
          <ul className={styles.chips} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recipients.map((r) => (
              <li key={r.id}>
                <Badge>
                  {r.name ?? r.email ?? r.id}
                  <button
                    type="button"
                    className={styles.iconButton}
                    style={{ width: 22, height: 22, border: 0, background: 'none' }}
                    aria-label={`${at('ui.remove')}: ${r.name ?? r.email ?? r.id}`}
                    onClick={() => setRecipients(recipients.filter((x) => x.id !== r.id))}
                  >
                    <X aria-hidden="true" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={send.pending}
        error={send.error}
        onCancel={confirm.close}
        onConfirm={async () => {
          const result = await send.run();
          if (result?.ok) confirm.close();
        }}
      />
    </div>
  );
}

const CHANNEL_ICON = {
  in_app: Smartphone,
  email: Mail,
  whatsapp: MessageCircle,
  sms: MessageSquare,
} as const;

function ChannelsTab() {
  const { at } = useAdminI18n();
  const { can } = useAccess();
  const data = useNotificationAdmin();
  return (
    <QueryState query={data}>
      {(d) => (
        <div className={styles.stack}>
          <div className={styles.tiles}>
            {(['in_app', 'email', 'whatsapp', 'sms'] as const).map((key) => {
              const Icon = CHANNEL_ICON[key];
              const enabled = d.channels[key]?.enabled ?? false;
              return (
                <div key={key} className={styles.tile}>
                  <span className={styles.tileLabel}>
                    <Icon aria-hidden="true" />
                    {at(`notifyAdmin.channel.${key}` as AdminMessageKey)}
                  </span>
                  <span>
                    {key === 'in_app' ? (
                      <Badge tone="success">{at('notifyAdmin.channelActive')}</Badge>
                    ) : enabled ? (
                      <Badge tone="warning">{at('notifyAdmin.channelFlagOnly')}</Badge>
                    ) : (
                      <Badge>{at('notifyAdmin.channelUnavailable')}</Badge>
                    )}
                  </span>
                  <span className={styles.tileHint}>
                    {at(`notifyAdmin.channelHint.${key}` as AdminMessageKey)}
                  </span>
                </div>
              );
            })}
          </div>
          <Alert tone="info">
            {at('notifyAdmin.channelsNote')}
            {can('settings.view') && (
              <>
                {' '}
                <Link to="/admin/settings/notifications">{at('notifyAdmin.openSettings')}</Link>
              </>
            )}
          </Alert>
        </div>
      )}
    </QueryState>
  );
}
