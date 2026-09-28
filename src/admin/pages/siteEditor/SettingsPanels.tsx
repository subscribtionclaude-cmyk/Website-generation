import { RotateCcw } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import {
  brandSettingsSchema,
  navigationSettingsSchema,
  pageSeoSettingsSchema,
  seoSettingsSchema,
  THEME_PRESETS,
} from '@/domain/settings/schemas';
import { SETTING_SCHEMAS } from '@/domain/settings/registry';
import { useAccess } from '@/features/auth/context';
import type { EditableColorToken } from '@/features/theme/editableTokens';
import { contrastRatio, isHexColor } from '@/lib/color';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { SelectField } from '../../ui/fields';
import { SchemaForm } from '../../ui/SchemaForm';
import { issuesByPath } from '../../ui/schemaIntrospect';
import { useFieldText } from '../../ui/useFieldText';
import ui from '../../ui/adminUi.module.css';
import type { PreviewSettingKey } from './editorState';
import { editorCustomFields } from './customFields';
import {
  CONTRAST_PAIRS,
  THEME_PRESET_TOKENS,
  TOKEN_DEFAULTS,
  type ThemePreset,
} from './themePresets';
import styles from './siteEditor.module.css';

type Value = Record<string, unknown>;

interface PanelProps {
  values: Partial<Record<PreviewSettingKey, Value>>;
  canEdit: (key: PreviewSettingKey) => boolean;
  onChange: (key: PreviewSettingKey, value: Value, tag: string) => void;
}

function useIssues(key: PreviewSettingKey, value: unknown) {
  const parsed = SETTING_SCHEMAS[key].safeParse(value);
  return parsed.success ? {} : issuesByPath(parsed.error);
}

function HistoryLink({ settingKey }: { settingKey: PreviewSettingKey }) {
  const { at } = useAdminI18n();
  const { can } = useAccess();
  if (!can('settings.view')) return null;
  return (
    <Link className={ui.small} to={`/admin/settings/${settingKey}`}>
      {at('siteEditor.settings.history')}
    </Link>
  );
}

function NoPermission({ show }: { show: boolean }) {
  const { at } = useAdminI18n();
  return show ? <Alert tone="info">{at('siteEditor.settings.readOnly')}</Alert> : null;
}

const SCALES = {
  typeScale: ['compact', 'default', 'large'],
  headingWeight: ['semibold', 'bold', 'extrabold'],
  spacing: ['compact', 'default', 'relaxed'],
  radius: ['sharp', 'default', 'round'],
} as const;

const TOKEN_GROUPS: { id: string; tokens: EditableColorToken[] }[] = [
  {
    id: 'brand',
    tokens: [
      'brandPrimary',
      'brandPrimaryHover',
      'brandPrimarySubtle',
      'onBrandPrimary',
      'brandText',
      'brandInk',
      'onBrandInk',
    ],
  },
  {
    id: 'surfaces',
    tokens: ['background', 'surface', 'surfaceElevated', 'surfaceInverse', 'border'],
  },
  { id: 'text', tokens: ['textPrimary', 'textSecondary'] },
  { id: 'status', tokens: ['success', 'warning', 'danger', 'info'] },
];

/** Theme (preset, structured scales, whitelisted colour tokens) and brand identity. */
export function DesignPanel({ values, canEdit, onChange }: PanelProps) {
  const { at } = useAdminI18n();
  const fieldText = useFieldText();
  const presetName = useId();
  const theme = (values.theme ?? { tokens: {} }) as Value & {
    tokens?: Partial<Record<EditableColorToken, string>>;
    preset?: ThemePreset;
  };
  const tokens = theme.tokens ?? {};
  const themeEditable = canEdit('theme');
  const setTheme = (patch: Value, tag: string) => onChange('theme', { ...theme, ...patch }, tag);
  const colour = (t: EditableColorToken) => tokens[t] ?? TOKEN_DEFAULTS[t];
  const warnings = CONTRAST_PAIRS.flatMap(([fg, bg, min]) => {
    const a = colour(fg);
    const b = colour(bg);
    if (!isHexColor(a) || !isHexColor(b)) return [];
    const ratio = contrastRatio(a, b);
    return ratio < min ? [{ fg, bg, ratio }] : [];
  });
  const brand = values.brand;
  const brandIssues = useIssues('brand', brand);

  return (
    <div className={styles.panelStack}>
      <section className={ui.group} aria-labelledby={`${presetName}-h`}>
        <h3 id={`${presetName}-h`} className={styles.panelTitle}>
          {at('siteEditor.design.theme')}
        </h3>
        <NoPermission show={!themeEditable} />
        <fieldset className={styles.presets} disabled={!themeEditable}>
          <legend>{at('siteEditor.design.preset')}</legend>
          {THEME_PRESETS.map((p) => (
            <label key={p} className={styles.preset}>
              <input
                type="radio"
                name={presetName}
                checked={(theme.preset ?? 'malek') === p}
                onChange={() =>
                  setTheme({ preset: p, tokens: { ...THEME_PRESET_TOKENS[p] } }, 'preset')
                }
              />
              <span className={styles.presetSwatches} aria-hidden="true">
                {(['brandPrimary', 'brandInk', 'surface'] as const).map((t) => (
                  <span
                    key={t}
                    style={{ background: THEME_PRESET_TOKENS[p][t] ?? TOKEN_DEFAULTS[t] }}
                  />
                ))}
              </span>
              <span>
                <strong>{at(`siteEditor.preset.${p}` as AdminMessageKey)}</strong>
                <span className={ui.hint}>
                  {at(`siteEditor.preset.${p}Hint` as AdminMessageKey)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className={ui.formGrid}>
          {(Object.keys(SCALES) as (keyof typeof SCALES)[]).map((scale) => (
            <SelectField
              key={scale}
              label={at(`siteEditor.scale.${scale}` as AdminMessageKey)}
              disabled={!themeEditable}
              value={String(theme[scale] ?? (scale === 'headingWeight' ? 'bold' : 'default'))}
              onChange={(e) => setTheme({ [scale]: e.target.value }, scale)}
              options={SCALES[scale].map((v) => ({
                value: v,
                label: at(`siteEditor.scaleValue.${v}` as AdminMessageKey),
              }))}
            />
          ))}
        </div>
        {TOKEN_GROUPS.map((group) => (
          <fieldset key={group.id} className={ui.group} disabled={!themeEditable}>
            <legend>{at(`siteEditor.colors.${group.id}` as AdminMessageKey)}</legend>
            <div className={styles.colors}>
              {group.tokens.map((t) => (
                <ColorRow
                  key={t}
                  token={t}
                  value={colour(t)}
                  overridden={tokens[t] !== undefined}
                  onChange={(v) => setTheme({ tokens: { ...tokens, [t]: v } }, `color:${t}`)}
                  onReset={() =>
                    setTheme(
                      {
                        tokens: Object.fromEntries(Object.entries(tokens).filter(([k]) => k !== t)),
                      },
                      `color:${t}`,
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
        ))}
        {warnings.length > 0 && (
          <Alert tone="warning" live>
            {at('siteEditor.colors.contrast')}
            <ul>
              {warnings.map((w) => (
                <li key={`${w.fg}-${w.bg}`}>
                  {at(`siteEditor.token.${w.fg}` as AdminMessageKey)} /{' '}
                  {at(`siteEditor.token.${w.bg}` as AdminMessageKey)}:{' '}
                  <bdi className="num">{w.ratio.toFixed(2)}:1</bdi>
                </li>
              ))}
            </ul>
          </Alert>
        )}
        <p className={ui.hint}>{at('siteEditor.design.noCss')}</p>
        <HistoryLink settingKey="theme" />
      </section>

      <section className={ui.group} aria-labelledby={`${presetName}-brand`}>
        <h3 id={`${presetName}-brand`} className={styles.panelTitle}>
          {at('siteEditor.design.brand')}
        </h3>
        <NoPermission show={!canEdit('brand')} />
        {brand && (
          <div className={ui.formGrid}>
            <SchemaForm
              schema={brandSettingsSchema}
              value={brand}
              rootKey="brand"
              onChange={(v) => onChange('brand', v as Value, 'brand')}
              ctx={{
                ...fieldText,
                issues: brandIssues,
                disabled: !canEdit('brand'),
                custom: editorCustomFields,
              }}
            />
          </div>
        )}
        <HistoryLink settingKey="brand" />
      </section>
    </div>
  );
}

function ColorRow({
  token,
  value,
  overridden,
  onChange,
  onReset,
}: {
  token: EditableColorToken;
  value: string;
  overridden: boolean;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  const { at } = useAdminI18n();
  const id = useId();
  const label = at(`siteEditor.token.${token}` as AdminMessageKey);
  return (
    <div className={styles.colorRow}>
      <label htmlFor={id} className={styles.colorLabel}>
        {label}
      </label>
      <input
        id={id}
        type="color"
        className={styles.colorInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        dir="ltr"
        className={`${ui.control} ${styles.colorHex}`}
        aria-label={`${label} (HEX)`}
        value={value}
        maxLength={7}
        pattern="#[0-9a-fA-F]{6}"
        onChange={(e) => {
          if (isHexColor(e.target.value)) onChange(e.target.value.toLowerCase());
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<RotateCcw aria-hidden="true" />}
        disabled={!overridden}
        onClick={onReset}
      >
        {at('siteEditor.colors.reset')}
        <span className="visually-hidden">: {label}</span>
      </Button>
    </div>
  );
}

/** Header, mobile tab bar and footer links (safe routes only) plus footer blocks. */
export function NavigationPanel({ values, canEdit, onChange }: PanelProps) {
  const { at } = useAdminI18n();
  const fieldText = useFieldText();
  const value = values.navigation;
  const issues = useIssues('navigation', value);
  return (
    <div className={styles.panelStack}>
      <h3 className={styles.panelTitle}>{at('siteEditor.nav.title')}</h3>
      <p className={ui.hint}>{at('siteEditor.nav.hint')}</p>
      <NoPermission show={!canEdit('navigation')} />
      {value && (
        <div className={ui.formGrid}>
          <SchemaForm
            schema={navigationSettingsSchema}
            value={value}
            rootKey="navigation"
            onChange={(v) => onChange('navigation', v as Value, 'navigation')}
            ctx={{
              ...fieldText,
              issues,
              disabled: !canEdit('navigation'),
              custom: editorCustomFields,
            }}
          />
        </div>
      )}
      <HistoryLink settingKey="navigation" />
    </div>
  );
}

/** Site-wide SEO defaults and per-page titles, descriptions and share images (Arabic + English). */
export function SeoPanel({
  values,
  canEdit,
  onChange,
  preview,
}: PanelProps & { preview: ReactNode }) {
  const { at } = useAdminI18n();
  const fieldText = useFieldText();
  const seoIssues = useIssues('seo', values.seo);
  const pageIssues = useIssues('page_seo', values.page_seo);
  return (
    <div className={styles.panelStack}>
      {preview}
      <section className={ui.group}>
        <h3 className={styles.panelTitle}>{at('siteEditor.seo.pages')}</h3>
        <p className={ui.hint}>{at('siteEditor.seo.pagesHint')}</p>
        <NoPermission show={!canEdit('page_seo')} />
        {values.page_seo && (
          <div className={ui.formGrid}>
            <SchemaForm
              schema={pageSeoSettingsSchema}
              value={values.page_seo}
              rootKey="page_seo"
              onChange={(v) => onChange('page_seo', v as Value, 'page_seo')}
              ctx={{
                ...fieldText,
                issues: pageIssues,
                disabled: !canEdit('page_seo'),
                custom: editorCustomFields,
              }}
            />
          </div>
        )}
        <HistoryLink settingKey="page_seo" />
      </section>
      <section className={ui.group}>
        <h3 className={styles.panelTitle}>{at('siteEditor.seo.site')}</h3>
        <NoPermission show={!canEdit('seo')} />
        {values.seo && (
          <div className={ui.formGrid}>
            <SchemaForm
              schema={seoSettingsSchema}
              value={values.seo}
              rootKey="seo"
              onChange={(v) => onChange('seo', v as Value, 'seo')}
              ctx={{
                ...fieldText,
                issues: seoIssues,
                disabled: !canEdit('seo'),
                custom: editorCustomFields,
              }}
            />
          </div>
        )}
        <HistoryLink settingKey="seo" />
      </section>
    </div>
  );
}
