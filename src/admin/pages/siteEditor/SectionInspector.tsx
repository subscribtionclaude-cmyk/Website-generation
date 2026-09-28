import { useMemo } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { isSectionType, SECTION_PROP_SCHEMAS, type SectionDesign } from '@/domain/content/sections';
import { trustItemSchema, type TrustItem } from '@/domain/settings/schemas';
import type { LayoutIssue } from '@/domain/siteEditor/layout';
import type { LayoutSection } from '@/domain/siteEditor/schemas';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { CheckboxField, SelectField } from '../../ui/fields';
import { SchemaForm, type SchemaFormContext } from '../../ui/SchemaForm';
import { issuesByPath } from '../../ui/schemaIntrospect';
import { useFieldText } from '../../ui/useFieldText';
import ui from '../../ui/adminUi.module.css';
import { editorCustomFields } from './customFields';
import styles from './siteEditor.module.css';

const BACKGROUNDS = ['default', 'muted', 'dark', 'brand'] as const;
const SPACINGS = ['compact', 'default', 'relaxed'] as const;
const trustEditSchema = trustItemSchema.omit({ id: true, icon: true });

/**
 * Editor for the selected section: visibility, structured design (background / spacing — no free
 * CSS) and the section's own fields generated from SECTION_PROP_SCHEMAS, with reference pickers.
 * For the Apple authorized-reseller badge it also edits the trust statement itself (the `trust`
 * setting, draft → publish like everything else).
 */
export function SectionInspector({
  section,
  title,
  issues,
  readOnly,
  choices,
  onChange,
  trust,
}: {
  section: LayoutSection;
  title: string;
  issues: LayoutIssue[];
  readOnly: boolean;
  choices: SchemaFormContext['choices'];
  onChange: (patch: Partial<LayoutSection>, tag: string) => void;
  trust: {
    items: TrustItem[];
    canEdit: boolean;
    onChange: (items: TrustItem[], tag: string) => void;
  };
}) {
  const { at } = useAdminI18n();
  const fieldText = useFieldText();
  const schema = isSectionType(section.type) ? SECTION_PROP_SCHEMAS[section.type] : null;
  const fieldIssues = useMemo(() => {
    const own = issues.find((i) => i.key === section.key && i.code === 'invalid_props');
    return own?.issues?.length ? issuesByPath({ issues: own.issues } as never) : {};
  }, [issues, section.key]);
  const design: SectionDesign = section.design ?? {};
  const setDesign = (patch: SectionDesign) => {
    const next = { ...design, ...patch };
    if (next.background === 'default') delete next.background;
    if (next.spacing === 'default') delete next.spacing;
    onChange({ design: next }, `design:${section.key}`);
  };
  const trustIndex =
    section.type === 'trust_feature'
      ? trust.items.findIndex((t) => t.id === section.props.itemId)
      : -1;
  const trustItem = trustIndex >= 0 ? trust.items[trustIndex] : undefined;

  return (
    <div className={styles.inspector}>
      <div className={styles.inspectorHead}>
        <h3 className={styles.inspectorTitle}>{title}</h3>
        <p className={ui.small}>
          {at(`sectionsAdmin.type.${section.type}` as AdminMessageKey)} ·{' '}
          <span className={ui.mono}>{section.key}</span>
        </p>
      </div>
      {readOnly && <Alert tone="info">{at('siteEditor.readOnly')}</Alert>}
      <CheckboxField
        label={at('sectionsAdmin.visibleLabel')}
        hint={at('sectionsAdmin.visibleHint')}
        checked={section.isVisible}
        disabled={readOnly}
        onChange={(v) => onChange({ isVisible: v }, `visible:${section.key}`)}
      />

      {section.type === 'trust_feature' && (
        <fieldset className={ui.group}>
          <legend>{at('siteEditor.trust.title')}</legend>
          <p className={ui.hint}>{at('siteEditor.trust.hint')}</p>
          {trustItem ? (
            <>
              <CheckboxField
                label={at('siteEditor.trust.enabled')}
                hint={at('siteEditor.trust.enabledHint')}
                checked={trustItem.visible}
                disabled={readOnly || !trust.canEdit}
                onChange={(v) =>
                  trust.onChange(
                    trust.items.map((t, i) => (i === trustIndex ? { ...t, visible: v } : t)),
                    `trust:${trustItem.id}`,
                  )
                }
              />
              <div className={ui.formGrid}>
                <SchemaForm
                  schema={trustEditSchema}
                  value={trustItem}
                  rootKey="trust.items"
                  onChange={(v) =>
                    trust.onChange(
                      trust.items.map((t, i) =>
                        i === trustIndex ? { ...t, ...(v as Partial<TrustItem>) } : t,
                      ),
                      `trust:${trustItem.id}`,
                    )
                  }
                  ctx={{
                    ...fieldText,
                    issues: {},
                    disabled: readOnly || !trust.canEdit,
                    hidden: (k) => k === 'trust.items.visible',
                  }}
                />
              </div>
              {!trust.canEdit && <Alert tone="info">{at('siteEditor.trust.noPermission')}</Alert>}
            </>
          ) : (
            <Alert tone="warning">{at('siteEditor.trust.missing')}</Alert>
          )}
        </fieldset>
      )}

      <fieldset className={ui.group}>
        <legend>{at('siteEditor.design.section')}</legend>
        <div className={ui.formGrid}>
          <SelectField
            label={at('siteEditor.design.background')}
            value={design.background ?? 'default'}
            disabled={readOnly}
            onChange={(e) =>
              setDesign({ background: e.target.value as SectionDesign['background'] })
            }
            options={BACKGROUNDS.map((b) => ({
              value: b,
              label: at(`siteEditor.design.bg.${b}` as AdminMessageKey),
            }))}
          />
          <SelectField
            label={at('siteEditor.design.spacing')}
            value={design.spacing ?? 'default'}
            disabled={readOnly}
            onChange={(e) => setDesign({ spacing: e.target.value as SectionDesign['spacing'] })}
            options={SPACINGS.map((s) => ({
              value: s,
              label: at(`siteEditor.design.space.${s}` as AdminMessageKey),
            }))}
          />
        </div>
      </fieldset>

      {schema ? (
        <fieldset className={ui.group}>
          <legend>{at('siteEditor.inspector.content')}</legend>
          <div className={ui.formGrid}>
            <SchemaForm
              schema={schema}
              value={section.props}
              rootKey="section"
              onChange={(v) =>
                onChange({ props: v as Record<string, unknown> }, `props:${section.key}`)
              }
              ctx={{
                ...fieldText,
                issues: fieldIssues,
                disabled: readOnly,
                choices,
                custom: editorCustomFields,
              }}
            />
          </div>
        </fieldset>
      ) : (
        <Alert tone="warning">{at('sectionsAdmin.unknownType')}</Alert>
      )}
    </div>
  );
}
