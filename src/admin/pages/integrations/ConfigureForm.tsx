import { KeyRound, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { NOTIFICATION_TEMPLATES } from '@/domain/customer/templates';
import { resolveLocalized } from '@/domain/localized';
import {
  validateSettings,
  type IntegrationKey,
  type SettingsProblem,
  type SettingsValue,
} from '@/domain/integrations/catalog';
import { MOCK_SCENARIOS } from '@/domain/integrations/mock';
import type { IntegrationOverviewItem } from '@/domain/integrations/schemas';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { ConfirmDialog } from '../../ui/Dialog';
import { CheckboxField, InputField, SelectField } from '../../ui/fields';
import { useConfirm } from '../../ui/hooks';
import { Panel } from '../../ui/PageHeader';
import { useAdminAction } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import { SecretsList } from './AdminIntegrationsPage';
import { specOf, useIntegrationsRepo } from './integrationsUtils';
import local from './integrations.module.css';

type Draft = Record<string, string | boolean>;

function toDraft(settings: SettingsValue): Draft {
  const out: Draft = {};
  for (const [k, v] of Object.entries(settings))
    out[k] = typeof v === 'boolean' ? v : v === null ? '' : String(v);
  return out;
}

/** Draft → typed settings (numbers parsed, empty strings dropped). */
function fromDraft(key: IntegrationKey, draft: Draft): SettingsValue {
  const out: SettingsValue = {};
  for (const field of specOf(key).settings) {
    const value = draft[field.key];
    if (field.type === 'boolean') out[field.key] = value === true;
    else if (typeof value === 'string' && value.trim() !== '')
      out[field.key] = field.type === 'number' ? Number(value) : value.trim();
  }
  return out;
}

/**
 * Public configuration only. Secrets are never typed in the browser: the form lists the server
 * environment variable NAMES the owner sets on the server runtime.
 */
export function ConfigureForm({
  item,
  canManage,
}: {
  item: IntegrationOverviewItem;
  canManage: boolean;
}) {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const { mode } = useRuntime();
  const repo = useIntegrationsRepo();
  const key = item.key as IntegrationKey;
  const spec = specOf(key);
  const [provider, setProvider] = useState(
    item.provider ?? (spec.providers.length === 1 ? (spec.providers[0]?.key ?? '') : ''),
  );
  const [draft, setDraft] = useState<Draft>(() => toDraft(item.settings));
  const [ownership, setOwnership] = useState<Record<string, string>>({ ...item.ownership });
  const [templates, setTemplates] = useState<Record<string, string>>({ ...item.templateMap });
  const [scenario, setScenario] = useState(item.mockScenario ?? 'success');
  const [problems, setProblems] = useState<SettingsProblem[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const confirmRemove = useConfirm();

  const save = useAdminAction(
    () =>
      repo.save({
        key,
        provider: provider || null,
        settings: fromDraft(key, draft),
        ownership,
        direction: 'import',
        templateMap: Object.fromEntries(
          Object.entries(templates)
            .filter(([, v]) => v.trim() !== '')
            .map(([k, v]) => [k, v.trim()]),
        ),
        expectedUpdatedAt: item.updatedAt,
        mockScenario: mode === 'demo' ? scenario : undefined,
      }),
    { onSuccess: () => setSaved(at('integrationsAdmin.configure.saved')) },
  );
  const remove = useAdminAction(() => repo.remove(key), {
    onSuccess: () => setSaved(at('integrationsAdmin.configure.removed')),
  });

  const fieldError = (field: string) => {
    const problem = problems.find((p) => p.field === field);
    return problem ? at(`integrationsAdmin.settingError.${problem.code}`) : null;
  };
  const owned = spec.syncDomains.filter((d) => d === 'prices' || d === 'stock');
  const readOnly = !canManage;

  return (
    <form
      className={styles.stack}
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setSaved(null);
        const found = validateSettings(key, fromDraft(key, draft));
        setProblems(found);
        if (found.length > 0 || !provider) return;
        await save.run();
      }}
    >
      {readOnly && <Alert tone="info">{at('integrationsAdmin.configure.readOnly')}</Alert>}
      <Panel
        title={at('integrationsAdmin.provider.title')}
        icon={<Settings2 aria-hidden="true" />}
        headingLevel={3}
      >
        <SelectField
          label={at('integrationsAdmin.provider.title')}
          value={provider}
          disabled={readOnly}
          required
          onChange={(e) => setProvider(e.target.value)}
          options={[
            { value: '', label: at('integrationsAdmin.provider.choose') },
            ...spec.providers.map((p) => ({
              value: p.key,
              label: `${at(`integrationsAdmin.provider.${p.key}` as AdminMessageKey)} — ${at(`integrationsAdmin.badge.${p.adapter}`)}`,
            })),
          ]}
          hint={
            item.provider && provider !== item.provider
              ? at('integrationsAdmin.configure.providerChanged')
              : undefined
          }
        />
        {mode === 'demo' && (
          <SelectField
            label={at('integrationsAdmin.configure.mockScenario')}
            hint={at('integrationsAdmin.configure.mockHint')}
            value={scenario}
            disabled={readOnly}
            onChange={(e) => setScenario(e.target.value)}
            options={MOCK_SCENARIOS.map((s) => ({
              value: s,
              label: at(`integrationsAdmin.configure.scenario.${s}`),
            }))}
          />
        )}
      </Panel>

      {spec.settings.length > 0 && (
        <Panel title={at('integrationsAdmin.configure.settings')} headingLevel={3}>
          <p className={styles.small}>{at('integrationsAdmin.configure.settingsHint')}</p>
          <div className={styles.formGrid}>
            {spec.settings.map((field) => {
              const label = at(`integrationsAdmin.setting.${field.key}` as AdminMessageKey);
              if (field.type === 'boolean')
                return (
                  <CheckboxField
                    key={field.key}
                    label={label}
                    checked={draft[field.key] === true}
                    disabled={readOnly}
                    onChange={(checked) => setDraft((d) => ({ ...d, [field.key]: checked }))}
                  />
                );
              return (
                <InputField
                  key={field.key}
                  label={label}
                  ltr
                  type={
                    field.type === 'number'
                      ? 'number'
                      : field.type === 'email'
                        ? 'email'
                        : field.type === 'url'
                          ? 'url'
                          : 'text'
                  }
                  inputMode={field.type === 'number' ? 'numeric' : undefined}
                  required={field.required}
                  aria-required={field.required || undefined}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={readOnly}
                  value={typeof draft[field.key] === 'string' ? (draft[field.key] as string) : ''}
                  error={fieldError(field.key)}
                  onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                />
              );
            })}
          </div>
        </Panel>
      )}

      <Panel
        title={at('integrationsAdmin.configure.secrets')}
        icon={<KeyRound aria-hidden="true" />}
        headingLevel={3}
      >
        <SecretsList secrets={spec.secrets} social={key === 'social_auth'} />
      </Panel>

      {owned.length > 0 && (
        <Panel title={at('integrationsAdmin.configure.ownership')} headingLevel={3}>
          <p className={styles.small}>{at('integrationsAdmin.configure.ownershipHint')}</p>
          <div className={styles.formGrid}>
            {owned.map((domain) => (
              <SelectField
                key={domain}
                label={at(`integrationsAdmin.configure.domain.${domain}`)}
                value={ownership[domain] ?? 'malek'}
                disabled={readOnly}
                onChange={(e) => setOwnership((o) => ({ ...o, [domain]: e.target.value }))}
                options={(['malek', 'external', 'external_wins'] as const).map((o) => ({
                  value: o,
                  label: at(`integrationsAdmin.configure.owner.${o}`),
                }))}
              />
            ))}
          </div>
          <p className={styles.small}>
            <strong>{at('integrationsAdmin.configure.direction')}:</strong>{' '}
            {at('integrationsAdmin.configure.directionImport')} —{' '}
            {at('integrationsAdmin.configure.directionHint')}
          </p>
        </Panel>
      )}

      {spec.channel && (
        <Panel title={at('integrationsAdmin.configure.templates')} headingLevel={3}>
          <p className={styles.small}>{at('integrationsAdmin.configure.templatesHint')}</p>
          <details className={local.details}>
            <summary>
              {at('integrationsAdmin.configure.templatesCount', {
                count: Object.values(templates).filter((v) => v.trim() !== '').length,
              })}
            </summary>
            <div className={styles.formGrid}>
              {Object.entries(NOTIFICATION_TEMPLATES).map(([templateKey, template]) => (
                <InputField
                  key={templateKey}
                  label={resolveLocalized(template.title, locale)}
                  hint={<code dir="ltr">{templateKey}</code>}
                  ltr
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={100}
                  disabled={readOnly}
                  value={templates[templateKey] ?? ''}
                  onChange={(e) => setTemplates((t) => ({ ...t, [templateKey]: e.target.value }))}
                />
              ))}
            </div>
          </details>
        </Panel>
      )}

      {saved && (
        <Alert tone="success" live>
          {saved}
        </Alert>
      )}
      {(save.error || remove.error) && (
        <Alert tone="danger" live>
          {save.error ?? remove.error}
        </Alert>
      )}
      {canManage && (
        <div className={local.cardActions}>
          <Button type="submit" variant="primary" loading={save.pending} disabled={!provider}>
            {at('integrationsAdmin.configure.save')}
          </Button>
          {item.provider && (
            <Button
              variant="ghost"
              icon={<Trash2 aria-hidden="true" width={16} height={16} />}
              onClick={() =>
                confirmRemove.ask(
                  {
                    title: at('integrationsAdmin.configure.removeTitle'),
                    body: at('integrationsAdmin.configure.removeBody'),
                    confirmLabel: at('integrationsAdmin.configure.remove'),
                    tone: 'danger',
                  },
                  undefined,
                )
              }
            >
              {at('integrationsAdmin.configure.remove')}
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmRemove.open}
        options={confirmRemove.options}
        pending={remove.pending}
        error={remove.error}
        onCancel={confirmRemove.close}
        onConfirm={async () => {
          const result = await remove.run();
          if (result?.ok) {
            confirmRemove.close();
            setProvider('');
            setDraft({});
            setTemplates({});
            setOwnership({});
          }
        }}
      />
    </form>
  );
}
