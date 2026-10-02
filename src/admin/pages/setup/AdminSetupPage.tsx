import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CircleCheck, CircleDashed, Rocket, Send } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { hasPermission } from '@/domain/access/access';
import type { SettingOverview } from '@/domain/admin/schemas';
import { resolveLocalized } from '@/domain/localized';
import { BASE_SETTINGS } from '@/domain/settings/defaults';
import { SETTING_SCHEMAS } from '@/domain/settings/registry';
import {
  setupSettingsSchema,
  THEME_PRESETS,
  type BrandSettings,
  type StoreSettings,
  type ThemeSettings,
} from '@/domain/settings/schemas';
import {
  canFinish,
  DEMO_CHOICES,
  demoChoicesFor,
  SETUP_STEPS,
  setupChecklist,
  setupNeeded,
  stepIssues,
  type DemoChoice,
  type SetupDraft,
  type SetupStep,
} from '@/domain/setup/wizard';
import { useAccess } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { ConfirmDialog } from '../../ui/Dialog';
import { useConfirm } from '../../ui/hooks';
import { PageHeader, Panel } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { SchemaForm } from '../../ui/SchemaForm';
import { blankFor, issuesByPath, type FieldIssue } from '../../ui/schemaIntrospect';
import { useAdminRepo } from '../../ui/useAdminAction';
import { useErrorText, useProblemText } from '../../ui/useAdminText';
import { useFieldText } from '../../ui/useFieldText';
import ui from '../../ui/adminUi.module.css';
import { THEME_PRESET_TOKENS, TOKEN_DEFAULTS } from '../siteEditor/themePresets';
import styles from './setup.module.css';

type WizardKey = 'brand' | 'store' | 'theme';
const KEYS: WizardKey[] = ['brand', 'store', 'theme'];
const STEP_KEYS: Partial<Record<SetupStep, WizardKey[]>> = {
  store: ['brand', 'store'],
  branding: ['theme'],
};

/** Working value of a setting: open draft, else published, else the shipped defaults. */
function initialValue(key: WizardKey, row: SettingOverview | undefined): unknown {
  const schema = SETTING_SCHEMAS[key];
  const raw =
    row?.draft ??
    row?.published ??
    (BASE_SETTINGS as Record<string, unknown>)[key] ??
    blankFor(schema);
  const parsed = schema.safeParse(raw);
  return structuredClone(parsed.success ? parsed.data : raw);
}

/**
 * Admin → Setup: the first-run wizard. Steps edit the existing `brand`, `store` and `theme`
 * settings as drafts (each with its own edit / publish permission); "Finish" publishes them and
 * records the demo-content choice through `admin_complete_setup` (settings.publish, demo.manage
 * to delete demo rows, audited). Nothing is stored outside the settings workflow.
 */
export function AdminSetupPage() {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const { access } = useAccess();
  const canDemo = hasPermission(access, 'demo.manage');
  const overview = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => repo.settingsOverview(),
  });
  const demo = useQuery({
    queryKey: ['admin', 'demo-summary'],
    queryFn: () => repo.demoSummary(),
    enabled: canDemo || hasPermission(access, 'dashboard.view'),
  });
  const demoRows = Object.values(demo.data ?? {}).reduce((n, v) => n + v, 0);
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <PageHeader title={at('modules.setup.title')} subtitle={at('setupWizard.subtitle')} />
      <QueryState query={overview}>
        {(rows) => (
          <SetupWizard
            key={generation}
            rows={rows}
            demoRows={demoRows}
            canDemo={canDemo}
            onFinished={() => setGeneration((g) => g + 1)}
          />
        )}
      </QueryState>
    </>
  );
}

function SetupWizard({
  rows,
  demoRows,
  canDemo,
  onFinished,
}: {
  rows: SettingOverview[];
  demoRows: number;
  canDemo: boolean;
  onFinished: () => void;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { mode } = useRuntime();
  const repo = useAdminRepo();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const errorText = useErrorText();
  const confirm = useConfirm();
  const row = (key: string) => rows.find((r) => r.key === key);
  const setupRow = row('setup');
  const setup = setupSettingsSchema.safeParse(setupRow?.published);
  const completed = setup.success && !setupNeeded(setup.data);

  const [reviewAgain, setReviewAgain] = useState(false);
  const [draft, setDraft] = useState<SetupDraft>(() => ({
    brand: initialValue('brand', row('brand')) as BrandSettings,
    store: initialValue('store', row('store')) as StoreSettings,
    theme: initialValue('theme', row('theme')) as ThemeSettings,
    demoChoice: null,
  }));
  const [saved, setSaved] = useState<Record<WizardKey, string>>(() => ({
    brand: JSON.stringify(row('brand')?.draft ?? row('brand')?.published ?? null),
    store: JSON.stringify(row('store')?.draft ?? row('store')?.published ?? null),
    theme: JSON.stringify(row('theme')?.draft ?? row('theme')?.published ?? null),
  }));
  const [draftAt, setDraftAt] = useState<Record<WizardKey, string | null>>(() => ({
    brand: row('brand')?.draftUpdatedAt ?? null,
    store: row('store')?.draftUpdatedAt ?? null,
    theme: row('theme')?.draftUpdatedAt ?? null,
  }));
  const [stepIndex, setStepIndex] = useState(0);
  const [reached, setReached] = useState(0);
  const [issues, setIssues] = useState<Partial<Record<WizardKey, Record<string, FieldIssue>>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const step = SETUP_STEPS[stepIndex] ?? 'store';

  useEffect(() => {
    // Move focus to the new step's heading (not on first render) so keyboard and screen-reader
    // users land at the start of the step.
    if (!moved.current) return;
    headingRef.current?.focus();
  }, [stepIndex]);

  if (!row('brand') || !row('store') || !row('theme') || !setupRow) {
    return <Alert tone="info">{at('setupWizard.readOnly')}</Alert>;
  }

  const choices = demoChoicesFor(canDemo);
  const checklist = setupChecklist(draft, { mode, demoRows });
  const finishable = canFinish(checklist);
  const canComplete = setupRow.canPublish;
  const missingRequired = checklist.filter((i) => i.required && !i.done).length;

  if (completed && !reviewAgain && setup.success) {
    return (
      <Panel title={at('setupWizard.completedTitle')} icon={<CircleCheck aria-hidden="true" />}>
        <div className={ui.stack}>
          <p>
            {at('setupWizard.completedBody', {
              date: setup.data.completedAt ? format.dateTime(setup.data.completedAt) : '—',
              choice: setup.data.demoChoice
                ? at(`setupWizard.choice.${setup.data.demoChoice}`)
                : '—',
            })}
          </p>
          {notice && (
            <Alert tone="success" live>
              {notice}
            </Alert>
          )}
          <div className={styles.footer}>
            <Button variant="secondary" onClick={() => setReviewAgain(true)}>
              {at('setupWizard.runAgain')}
            </Button>
            <Link to="/admin/settings" className={buttonClassName({ variant: 'ghost' })}>
              {at('modules.store-settings.title')}
            </Link>
          </div>
        </div>
      </Panel>
    );
  }

  const goTo = (index: number) => {
    moved.current = true;
    setError(null);
    setStepIndex(index);
    setReached((r) => Math.max(r, index));
  };

  /** Save the given settings as drafts when they changed (and the account may edit them). */
  const saveDrafts = async (keys: WizardKey[]): Promise<boolean> => {
    for (const key of keys) {
      const current = row(key);
      const value = draft[key];
      if (!current?.canEdit || JSON.stringify(value) === saved[key]) continue;
      const result = await repo.saveSettingDraft(
        key,
        value as Record<string, unknown>,
        draftAt[key],
      );
      if (!result.ok) {
        setError(problemText(result.code));
        return false;
      }
      setDraftAt((d) => ({ ...d, [key]: result.draftUpdatedAt }));
      setSaved((s) => ({ ...s, [key]: JSON.stringify(value) }));
    }
    return true;
  };

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e, true));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    const found = stepIssues(step, draft);
    const mapped = Object.fromEntries(
      Object.entries(found).map(([k, e]) => [k, issuesByPath(e)]),
    ) as Partial<Record<WizardKey, Record<string, FieldIssue>>>;
    setIssues(mapped);
    if (Object.keys(mapped).length > 0) return;
    const ok = await run(() => saveDrafts(STEP_KEYS[step] ?? []));
    if (ok) goTo(stepIndex + 1);
  };

  const finish = async () => {
    const choice = draft.demoChoice;
    if (!choice) return;
    const note = at('setupWizard.note');
    let deleted = 0;
    const ok = await run(async () => {
      if (!(await saveDrafts(KEYS))) return false;
      for (const key of KEYS) {
        const current = row(key);
        const hasDraft = draftAt[key] !== null || JSON.stringify(draft[key]) !== saved[key];
        if (!current?.canPublish || !hasDraft) continue;
        const published = await repo.publishSetting(key, note, false);
        if (!published.ok) {
          setError(problemText(published.code));
          return false;
        }
      }
      const result = await repo.completeSetup(choice, note);
      if (!result.ok) {
        setError(problemText(result.code));
        return false;
      }
      deleted = Object.values(result.deleted ?? {}).reduce((n, v) => n + v, 0);
      return true;
    });
    confirm.close();
    if (!ok) return;
    // The browser preview keeps demo data in memory: start again from the emptied catalog.
    if (mode === 'demo' && choice !== 'keep') {
      window.location.reload();
      return;
    }
    setNotice(
      deleted > 0
        ? at('setupWizard.finishedDeleted', { count: format.number(deleted) })
        : at('setupWizard.finished'),
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin'] }),
      queryClient.invalidateQueries({ queryKey: ['public'] }),
    ]);
    onFinished();
  };

  const stepTitle = at(`setupWizard.step.${step}`);
  return (
    <div className={ui.stack}>
      <nav className={styles.stepper} aria-label={at('setupWizard.steps')}>
        <ol>
          {SETUP_STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                className={styles.stepButton}
                aria-current={i === stepIndex ? 'step' : undefined}
                disabled={i > reached || busy}
                onClick={() => goTo(i)}
              >
                <span className={styles.stepNumber} aria-hidden="true">
                  {format.number(i + 1)}
                </span>
                {at(`setupWizard.step.${s}`)}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {!canComplete && <Alert tone="info">{at('setupWizard.noPublish')}</Alert>}
      {error && (
        <Alert tone="danger" live>
          {error}
        </Alert>
      )}
      {Object.keys(issues).length > 0 && (
        <Alert tone="danger" live>
          {at('schemaForm.fixErrors', {
            count: Object.values(issues).reduce((n, v) => n + Object.keys(v ?? {}).length, 0),
          })}
        </Alert>
      )}

      <section className={ui.panel} aria-labelledby="setup-step-heading">
        <div className={ui.stack}>
          <p className={ui.small}>
            {at('setupWizard.stepOf', {
              current: format.number(stepIndex + 1),
              total: format.number(SETUP_STEPS.length),
            })}
          </p>
          <h2
            id="setup-step-heading"
            ref={headingRef}
            tabIndex={-1}
            className={`${ui.panelTitle} ${styles.stepHeading}`}
          >
            {stepTitle}
          </h2>
          {step === 'store' && (
            <StoreStep draft={draft} setDraft={setDraft} rows={rows} issues={issues} />
          )}
          {step === 'branding' && (
            <BrandingStep
              theme={draft.theme}
              editable={row('theme')?.canEdit ?? false}
              onChange={(theme) => setDraft((d) => ({ ...d, theme }))}
            />
          )}
          {step === 'demo' && (
            <DemoStep
              value={draft.demoChoice}
              choices={choices}
              canDemo={canDemo}
              demoRows={demoRows}
              onChange={(demoChoice) => setDraft((d) => ({ ...d, demoChoice }))}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              draft={draft}
              checklist={checklist}
              onFix={(s) => goTo(SETUP_STEPS.indexOf(s))}
            />
          )}
          {step === 'review' && !finishable && (
            <Alert tone="warning">
              {at('setupWizard.missingRequired', { count: format.number(missingRequired) })}
            </Alert>
          )}
          <div className={styles.footer}>
            {stepIndex > 0 ? (
              <Button
                variant="secondary"
                icon={<ArrowLeft aria-hidden="true" className="flip-rtl" />}
                disabled={busy}
                onClick={() => goTo(stepIndex - 1)}
              >
                {at('setupWizard.back')}
              </Button>
            ) : (
              <span />
            )}
            {step !== 'review' ? (
              <Button
                icon={<ArrowRight aria-hidden="true" className="flip-rtl" />}
                loading={busy}
                disabled={step === 'demo' && draft.demoChoice === null}
                onClick={() => void next()}
              >
                {at('setupWizard.next')}
              </Button>
            ) : (
              <Button
                icon={<Send aria-hidden="true" />}
                disabled={!finishable || !canComplete}
                loading={busy}
                onClick={() =>
                  confirm.ask(
                    {
                      title: at('setupWizard.finishTitle'),
                      body: (
                        <>
                          <p>{at('setupWizard.finishBody')}</p>
                          {draft.demoChoice !== 'keep' && demoRows > 0 && (
                            <p>
                              <strong>
                                {at('setupWizard.finishDelete', {
                                  count: format.number(demoRows),
                                })}
                              </strong>
                            </p>
                          )}
                        </>
                      ),
                      confirmLabel: at('setupWizard.finish'),
                      tone: draft.demoChoice === 'keep' ? 'default' : 'danger',
                      irreversible: draft.demoChoice !== 'keep',
                    },
                    undefined,
                  )
                }
              >
                {at('setupWizard.finish')}
              </Button>
            )}
          </div>
        </div>
      </section>
      <ConfirmDialog
        open={confirm.open}
        options={confirm.options}
        pending={busy}
        onCancel={confirm.close}
        onConfirm={() => void finish()}
      />
    </div>
  );
}

function StoreStep({
  draft,
  setDraft,
  rows,
  issues,
}: {
  draft: SetupDraft;
  setDraft: (fn: (d: SetupDraft) => SetupDraft) => void;
  rows: SettingOverview[];
  issues: Partial<Record<WizardKey, Record<string, FieldIssue>>>;
}) {
  const { at } = useAdminI18n();
  const fieldText = useFieldText();
  const titleKey = (k: WizardKey) => `settingsAdmin.key.${k}` as AdminMessageKey;
  return (
    <>
      <p>{at('setupWizard.storeIntro')}</p>
      {(['brand', 'store'] as const).map((key) => {
        const editable = rows.find((r) => r.key === key)?.canEdit ?? false;
        return (
          <fieldset
            key={key}
            className={ui.formGrid}
            disabled={!editable}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <legend className={ui.panelTitle}>{at(titleKey(key))}</legend>
            {!editable && <p className={ui.small}>{at('settingsAdmin.readOnly')}</p>}
            <SchemaForm
              schema={SETTING_SCHEMAS[key]}
              value={draft[key]}
              onChange={(value) =>
                setDraft((d) => ({ ...d, [key]: value as SetupDraft[typeof key] }))
              }
              rootKey={key}
              ctx={{ ...fieldText, issues: issues[key] ?? {}, disabled: !editable }}
            />
          </fieldset>
        );
      })}
    </>
  );
}

function BrandingStep({
  theme,
  editable,
  onChange,
}: {
  theme: ThemeSettings;
  editable: boolean;
  onChange: (theme: ThemeSettings) => void;
}) {
  const { at } = useAdminI18n();
  const name = useId();
  return (
    <>
      <p>{at('setupWizard.brandingIntro')}</p>
      {!editable && <p className={ui.small}>{at('settingsAdmin.readOnly')}</p>}
      <fieldset className={styles.choices} disabled={!editable}>
        <legend>{at('siteEditor.design.preset')}</legend>
        {THEME_PRESETS.map((p) => (
          <label key={p} className={styles.choice}>
            <input
              type="radio"
              name={name}
              checked={theme.preset === p}
              onChange={() =>
                onChange({ ...theme, preset: p, tokens: { ...THEME_PRESET_TOKENS[p] } })
              }
            />
            <span className={styles.choiceText}>
              <strong>{at(`siteEditor.preset.${p}` as AdminMessageKey)}</strong>
              <span className={ui.hint}>{at(`siteEditor.preset.${p}Hint` as AdminMessageKey)}</span>
              <span
                className={styles.swatches}
                role="img"
                aria-label={at('setupWizard.previewSwatches')}
              >
                {(['brandPrimary', 'brandInk', 'surface', 'textPrimary'] as const).map((t) => (
                  <span
                    key={t}
                    style={{ background: THEME_PRESET_TOKENS[p][t] ?? TOKEN_DEFAULTS[t] }}
                  />
                ))}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </>
  );
}

function DemoStep({
  value,
  choices,
  canDemo,
  demoRows,
  onChange,
}: {
  value: DemoChoice | null;
  choices: DemoChoice[];
  canDemo: boolean;
  demoRows: number;
  onChange: (choice: DemoChoice) => void;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const name = useId();
  return (
    <>
      <p>{at('setupWizard.demoIntro')}</p>
      <p className={ui.small}>{at('setupWizard.demoRows', { count: format.number(demoRows) })}</p>
      {!canDemo && <Alert tone="info">{at('setupWizard.demoNoPermission')}</Alert>}
      <fieldset className={styles.choices}>
        <legend>{at('setupWizard.demoChoice')}</legend>
        {DEMO_CHOICES.map((c) => (
          <label key={c} className={styles.choice}>
            <input
              type="radio"
              name={name}
              value={c}
              checked={value === c}
              disabled={!choices.includes(c)}
              onChange={() => onChange(c)}
            />
            <span className={styles.choiceText}>
              <strong>{at(`setupWizard.choice.${c}`)}</strong>
              <span className={ui.hint}>
                {at(`setupWizard.choice.${c}Hint` as AdminMessageKey)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {value !== null && value !== 'keep' && (
        <Alert tone="warning">{at('setupWizard.deleteWarning')}</Alert>
      )}
    </>
  );
}

function ReviewStep({
  draft,
  checklist,
  onFix,
}: {
  draft: SetupDraft;
  checklist: ReturnType<typeof setupChecklist>;
  onFix: (step: SetupStep) => void;
}) {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const branches = draft.store.branches;
  return (
    <>
      <p>{at('setupWizard.reviewIntro')}</p>
      <h3 className={ui.panelTitle}>{at('setupWizard.summary')}</h3>
      <dl className={styles.summary}>
        <dt>{at('setupWizard.labels.storeName')}</dt>
        <dd>{draft.brand.name || '—'}</dd>
        <dt>{at('setupWizard.labels.branches')}</dt>
        <dd>{branches.map((b) => resolveLocalized(b.name, locale)).join('، ') || '—'}</dd>
        <dt>{at('setupWizard.labels.phones')}</dt>
        <dd>
          <bdi dir="ltr">{branches.flatMap((b) => b.phones).join(' · ') || '—'}</bdi>
        </dd>
        <dt>{at('setupWizard.labels.theme')}</dt>
        <dd>
          {draft.theme.preset
            ? at(`siteEditor.preset.${draft.theme.preset}` as AdminMessageKey)
            : at('setupWizard.labels.notChosen')}
        </dd>
        <dt>{at('setupWizard.labels.demo')}</dt>
        <dd>
          {draft.demoChoice
            ? at(`setupWizard.choice.${draft.demoChoice}`)
            : at('setupWizard.labels.notChosen')}
        </dd>
      </dl>
      <h3 className={ui.panelTitle}>{at('setupWizard.checklist')}</h3>
      <ul className={styles.checklist} data-testid="setup-checklist">
        {checklist.map((item) => (
          <li key={item.id} className={styles.checkRow}>
            {item.done ? (
              <CircleCheck aria-hidden="true" className={styles.done} />
            ) : (
              <CircleDashed aria-hidden="true" className={styles.todo} />
            )}
            <span className={styles.checkLabel}>
              {at(`setupWizard.check.${item.id}`)}
              <span className="visually-hidden">
                {' — '}
                {item.done ? at('setupWizard.done') : at('setupWizard.missing')}
              </span>
            </span>
            <Badge tone={item.required ? 'brand' : 'neutral'}>
              {item.required ? at('setupWizard.required') : at('setupWizard.recommended')}
            </Badge>
            {!item.done && (
              <Button size="sm" variant="ghost" onClick={() => onFix(item.step)}>
                {at('setupWizard.fixInStep')}
                <span className="visually-hidden">: {at(`setupWizard.check.${item.id}`)}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className={ui.small}>
        <Rocket aria-hidden="true" width={14} height={14} /> {at('setupWizard.finishBody')}
      </p>
    </>
  );
}
