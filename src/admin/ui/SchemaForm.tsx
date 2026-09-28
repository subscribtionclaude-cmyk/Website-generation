import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { resolveLocalized, type LocalizedText } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import { useAdminI18n } from '../i18n/context';
import { CheckboxField, InputField, LocalizedField, SelectField } from './fields';
import { toDraft } from './hooks';
import styles from './adminUi.module.css';
import {
  arrayElement,
  arrayMax,
  blankFor,
  cleanLocalized,
  defaultFor,
  enumValues,
  humanize,
  kindOf,
  labelKey,
  numberBounds,
  objectShape,
  pathKey,
  stringInfo,
  unwrap,
  type FieldIssue,
} from './schemaIntrospect';

type Path = (string | number)[];

export interface SchemaFormContext {
  /** Label for a label-map key such as "commerce.paymentMethods.cod" (fallback: humanized key). */
  label?: (key: string) => string | undefined;
  hint?: (key: string) => string | undefined;
  /** Display text for an enum value (fallback: humanized value). */
  option?: (key: string, value: string | number) => string | undefined;
  hidden?: (key: string) => boolean;
  readOnly?: (key: string) => boolean;
  issues: Record<string, FieldIssue>;
  disabled?: boolean;
  /**
   * Reference picker: allowed values for a string field, or for each item of a string list
   * (products, brands, categories, campaigns…). The schema still validates the result.
   */
  choices?: (key: string) => { value: string; label: string }[] | undefined;
  /** Custom control for a field (media upload, safe route picker…); undefined = generated one. */
  custom?: (key: string, field: CustomFieldProps) => ReactNode | undefined;
}

export interface CustomFieldProps {
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
  hint?: string;
  error: string | null;
  readOnly: boolean;
  /** The schema allows null / undefined (an empty control clears the value). */
  blankable: boolean;
}

/**
 * Structured editor generated from a Zod schema: bilingual text, numbers with the schema's
 * bounds, toggles, choices and repeatable groups. It never adds keys the schema does not define,
 * and the same schema validates the result before anything is sent to the server.
 */
export function SchemaForm({
  schema,
  value,
  onChange,
  rootKey,
  ctx,
}: {
  schema: z.ZodType;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Prefix for label-map keys (e.g. the setting key). */
  rootKey: string;
  ctx: SchemaFormContext;
}) {
  return (
    <ObjectFields
      schema={unwrap(schema).schema}
      value={value}
      onChange={onChange}
      path={[]}
      labelPath={[rootKey]}
      ctx={ctx}
    />
  );
}

interface NodeProps {
  schema: z.ZodType;
  value: unknown;
  onChange: (value: unknown) => void;
  path: Path;
  labelPath: Path;
  ctx: SchemaFormContext;
}

function useIssueText() {
  const { at } = useAdminI18n();
  return (issue: FieldIssue | undefined): string | null => {
    if (!issue) return null;
    if (issue.code === 'too_small')
      return issue.minimum !== undefined && issue.minimum > 1
        ? at('schemaForm.tooSmall', { min: issue.minimum })
        : at('schemaForm.required');
    if (issue.code === 'too_big') return at('schemaForm.tooBig', { max: issue.maximum ?? '' });
    if (issue.code === 'invalid_format') return at('schemaForm.format');
    if (issue.code === 'invalid_type') return at('schemaForm.required');
    if (issue.code === 'invalid_value') return at('schemaForm.choice');
    if (issue.code === 'unrecognized_keys') return at('schemaForm.unknownKeys');
    return at('schemaForm.invalid');
  };
}

function useLabels(ctx: SchemaFormContext) {
  return (labelPath: Path) => {
    const key = labelKey(labelPath);
    const last = labelPath.filter((p) => typeof p === 'string').at(-1);
    return ctx.label?.(key) ?? humanize(String(last ?? key));
  };
}

function ObjectFields({ schema, value, onChange, path, labelPath, ctx }: NodeProps) {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const shape = objectShape(schema);
  const issueText = useIssueText();
  const own = issueText(ctx.issues[pathKey(path)]);
  return (
    <>
      {own && (
        <span className={`${styles.error} ${styles.full}`} role="alert">
          {own}
        </span>
      )}
      {Object.entries(shape).map(([key, child]) => {
        const childLabelPath = [...labelPath, key];
        if (ctx.hidden?.(labelKey(childLabelPath))) return null;
        return (
          <Field
            key={key}
            schema={child}
            value={record[key]}
            onChange={(v) => {
              const next = { ...record };
              if (v === undefined) {
                const { [key]: _removed, ...rest } = next;
                void _removed;
                onChange(rest);
              } else onChange({ ...next, [key]: v });
            }}
            path={[...path, key]}
            labelPath={childLabelPath}
            ctx={ctx}
          />
        );
      })}
    </>
  );
}

function Field(props: NodeProps) {
  const { schema, value, onChange, path, labelPath, ctx } = props;
  const { at } = useAdminI18n();
  const labelFor = useLabels(ctx);
  const issueText = useIssueText();
  const u = unwrap(schema);
  const inner = u.schema;
  const kind = kindOf(inner);
  const key = labelKey(labelPath);
  const label = labelFor(labelPath);
  const hint = ctx.hint?.(key);
  const error = issueText(ctx.issues[pathKey(path)]);
  const readOnly = ctx.disabled || ctx.readOnly?.(key);
  const blankable = u.nullable || u.optional;
  const empty = u.nullable ? null : undefined;
  const custom = ctx.custom?.(key, {
    value,
    onChange,
    label,
    hint,
    error,
    readOnly: Boolean(readOnly),
    blankable,
  });
  if (custom !== undefined) return <>{custom}</>;
  const choices = kind === 'string' ? ctx.choices?.(key) : undefined;
  if (choices) {
    const current = typeof value === 'string' ? value : '';
    const known = current === '' || choices.some((c) => c.value === current);
    return (
      <SelectField
        label={label}
        hint={hint}
        error={error}
        value={current}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value === '' ? empty : e.target.value)}
        options={[
          ...(blankable || current === '' ? [{ value: '', label: at('ui.none') }] : []),
          ...(known ? [] : [{ value: current, label: current }]),
          ...choices,
        ]}
      />
    );
  }

  switch (kind) {
    case 'localized': {
      const lt = (value ?? null) as LocalizedText | null;
      const arIssue = issueText(ctx.issues[pathKey([...path, 'ar'])]);
      return (
        <LocalizedField
          className={styles.full}
          legend={label}
          required={!blankable}
          hint={hint}
          error={error ?? arIssue}
          value={toDraft(lt)}
          multiline={/body|instructions|terms|note|message|description|policy|exchange|return|warranty/i.test(
            String(labelPath.at(-1)),
          )}
          rows={3}
          onChange={(d) => {
            if (readOnly) return;
            if (blankable && !d.ar.trim() && !d.en.trim()) onChange(empty);
            else onChange(cleanLocalized(d));
          }}
        />
      );
    }
    case 'object': {
      if (blankable) {
        const on = value !== null && value !== undefined;
        return (
          <fieldset className={`${styles.group} ${styles.full}`} disabled={readOnly}>
            <legend>{label}</legend>
            <CheckboxField
              label={at('schemaForm.enable', { name: label })}
              hint={hint}
              checked={on}
              onChange={(next) => onChange(next ? blankFor(inner) : empty)}
            />
            {on && (
              <div className={styles.formGrid}>
                <ObjectFields {...props} schema={inner} />
              </div>
            )}
          </fieldset>
        );
      }
      return (
        <fieldset className={`${styles.group} ${styles.full}`} disabled={readOnly}>
          <legend>{label}</legend>
          {hint && <span className={styles.hint}>{hint}</span>}
          <div className={styles.formGrid}>
            <ObjectFields {...props} schema={inner} />
          </div>
        </fieldset>
      );
    }
    case 'array': {
      const element = arrayElement(inner);
      if (!element) return null;
      if (blankable) {
        const on = Array.isArray(value);
        return (
          <fieldset className={`${styles.group} ${styles.full}`} disabled={readOnly}>
            <legend>{label}</legend>
            <CheckboxField
              label={at('schemaForm.enable', { name: label })}
              hint={hint}
              checked={on}
              onChange={(next) => onChange(next ? [] : empty)}
            />
            {on && <ArrayField {...props} schema={inner} element={element} />}
          </fieldset>
        );
      }
      return <ArrayField {...props} schema={inner} element={element} hint={hint} />;
    }
    case 'enum': {
      const values = enumValues(inner);
      const current = value === null || value === undefined ? '' : String(value);
      return (
        <SelectField
          label={label}
          hint={hint}
          error={error}
          value={current}
          disabled={readOnly}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(empty);
            const match = values.find((v) => String(v) === raw);
            onChange(match ?? raw);
          }}
          options={[
            ...(blankable ? [{ value: '', label: at('ui.none') }] : []),
            ...values.map((v) => ({
              value: String(v),
              label: ctx.option?.(key, v) ?? humanize(String(v)),
            })),
          ]}
        />
      );
    }
    case 'literal':
      // Fixed values: a schema version is internal; a fixed flag is shown as a locked checkbox.
      if (String(labelPath.at(-1)) === 'version') return null;
      if (typeof value === 'boolean')
        return (
          <CheckboxField
            label={label}
            hint={hint}
            checked={value}
            disabled
            onChange={() => onChange(value)}
          />
        );
      return (
        <InputField label={label} hint={hint} value={String(value ?? '')} readOnly disabled ltr />
      );
    case 'boolean':
      return (
        <CheckboxField
          label={label}
          hint={hint}
          checked={value === true}
          disabled={readOnly}
          onChange={(v) => onChange(v)}
        />
      );
    case 'number': {
      const { min, max, int } = numberBounds(inner);
      return (
        <InputField
          type="number"
          inputMode={int ? 'numeric' : 'decimal'}
          label={label}
          hint={hint ?? (blankable ? at('schemaForm.blankHint') : undefined)}
          error={error}
          min={min ?? undefined}
          max={max ?? undefined}
          step={int ? 1 : 'any'}
          disabled={readOnly}
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw.trim() === '') onChange(blankable ? empty : Number.NaN);
            else onChange(Number(raw));
          }}
        />
      );
    }
    case 'string': {
      const { maxLength, format } = stringInfo(inner);
      return (
        <InputField
          label={label}
          hint={hint}
          error={error}
          type={format === 'email' ? 'email' : format === 'date' ? 'date' : 'text'}
          maxLength={maxLength ?? undefined}
          disabled={readOnly}
          ltr
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(blankable && raw.trim() === '' ? empty : raw);
          }}
        />
      );
    }
    default:
      return (
        <div className={`${styles.field} ${styles.full}`}>
          <span className={styles.fieldLabel}>{label}</span>
          <span className={styles.hint}>{at('schemaForm.unsupported')}</span>
        </div>
      );
  }
}

function ArrayField({
  schema,
  element,
  value,
  onChange,
  path,
  labelPath,
  ctx,
  hint,
}: NodeProps & { element: z.ZodType; hint?: string }) {
  const { at } = useAdminI18n();
  const { locale } = useI18n();
  const labelFor = useLabels(ctx);
  const issueText = useIssueText();
  const list = Array.isArray(value) ? (value as unknown[]) : [];
  const elementInner = unwrap(element).schema;
  const elementKind = kindOf(elementInner);
  const max = arrayMax(schema);
  const label = labelFor(labelPath);
  const key = labelKey(labelPath);
  const error = issueText(ctx.issues[pathKey(path)]);
  const readOnly = ctx.disabled || ctx.readOnly?.(key);

  // Reference multi-choice (brands, categories, offers…): checkboxes over the allowed values.
  const refChoices = elementKind === 'string' ? ctx.choices?.(key) : undefined;
  if (refChoices) {
    const extra = list.filter(
      (v): v is string => typeof v === 'string' && !refChoices.some((c) => c.value === v),
    );
    return (
      <fieldset className={`${styles.group} ${styles.full}`} disabled={readOnly}>
        <legend>{label}</legend>
        {hint && <span className={styles.hint}>{hint}</span>}
        <div className={styles.chips}>
          {[...refChoices, ...extra.map((v) => ({ value: v, label: v }))].map((c) => (
            <CheckboxField
              key={c.value}
              label={c.label}
              checked={list.includes(c.value)}
              onChange={(on) =>
                onChange(on ? [...list, c.value] : list.filter((x) => x !== c.value))
              }
            />
          ))}
        </div>
        {error && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
      </fieldset>
    );
  }

  // Multi-choice: an array of enum values renders as checkboxes.
  if (elementKind === 'enum') {
    const values = enumValues(elementInner);
    return (
      <fieldset className={`${styles.group} ${styles.full}`} disabled={readOnly}>
        <legend>{label}</legend>
        {hint && <span className={styles.hint}>{hint}</span>}
        <div className={styles.chips}>
          {values.map((v) => (
            <CheckboxField
              key={String(v)}
              label={ctx.option?.(key, v) ?? humanize(String(v))}
              checked={list.includes(v)}
              onChange={(on) =>
                onChange(
                  on
                    ? values.filter((x) => x === v || list.includes(x))
                    : list.filter((x) => x !== v),
                )
              }
            />
          ))}
        </div>
        {error && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
      </fieldset>
    );
  }

  const set = (next: unknown[]) => onChange(next);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    set(next);
  };
  const itemTitle = (item: unknown, index: number): ReactNode => {
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      for (const k of ['label', 'name', 'title']) {
        const v = rec[k];
        if (v && typeof v === 'object' && 'ar' in v)
          return (
            resolveLocalized(v as LocalizedText, locale) || at('schemaForm.item', { n: index + 1 })
          );
      }
      for (const k of ['id', 'key'])
        if (typeof rec[k] === 'string' && rec[k]) return String(rec[k]);
    }
    return at('schemaForm.item', { n: index + 1 });
  };

  return (
    <fieldset className={`${styles.group} ${styles.full}`} disabled={readOnly}>
      <legend>
        {label} ({list.length}
        {max !== null ? ` / ${max}` : ''})
      </legend>
      {hint && <span className={styles.hint}>{hint}</span>}
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
      {list.map((item, index) => {
        const itemPath = [...path, index];
        const title = itemTitle(item, index);
        const controls = (
          <span className={styles.rowActions}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`${at('ui.moveUp')}: ${typeof title === 'string' ? title : index + 1}`}
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
            >
              <ArrowUp aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`${at('ui.moveDown')}: ${typeof title === 'string' ? title : index + 1}`}
              disabled={index === list.length - 1}
              onClick={() => move(index, index + 1)}
            >
              <ArrowDown aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`${at('ui.remove')}: ${typeof title === 'string' ? title : index + 1}`}
              onClick={() => set(list.filter((_, i) => i !== index))}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </span>
        );
        const update = (v: unknown) => set(list.map((x, i) => (i === index ? v : x)));
        if (elementKind === 'object')
          return (
            <div key={index} className={styles.repeat}>
              <div className={styles.repeatHead}>
                <strong>{title}</strong>
                {controls}
              </div>
              <div className={styles.formGrid}>
                <ObjectFields
                  schema={elementInner}
                  value={item}
                  onChange={update}
                  path={itemPath}
                  labelPath={labelPath}
                  ctx={ctx}
                />
              </div>
            </div>
          );
        return (
          <div key={index} className={styles.repeat}>
            <div className={styles.repeatHead}>
              <strong>{at('schemaForm.item', { n: index + 1 })}</strong>
              {controls}
            </div>
            <Field
              schema={element}
              value={item}
              onChange={update}
              path={itemPath}
              labelPath={labelPath}
              ctx={{ ...ctx, label: () => label }}
            />
          </div>
        );
      })}
      <div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus aria-hidden="true" />}
          disabled={readOnly || (max !== null && list.length >= max)}
          onClick={() => set([...list, defaultFor(element) ?? blankFor(elementInner)])}
        >
          {at('schemaForm.addItem', { name: label })}
        </Button>
      </div>
    </fieldset>
  );
}
