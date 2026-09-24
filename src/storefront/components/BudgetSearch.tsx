import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { parseAmount } from '@/domain/catalog/amount';
import { TextField } from '@/components/ui/TextField';
import { LocaleLink } from '@/components/navigation/LocaleLink';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { localizePath } from '@/i18n/paths';
import catalogStyles from './catalog.module.css';
import styles from './content.module.css';
import { budgetHref } from './links';

/** "ميزانيتي من X إلى Y" — quick presets (settings-driven) + a validated min/max form. */
export function BudgetSearch({
  title,
  subtitle,
  headingId,
  current,
  headingLevel = 2,
}: {
  title: string;
  subtitle?: string | null;
  headingId: string;
  current?: { min: number | null; max: number | null };
  headingLevel?: 1 | 2;
}) {
  const { t, format, locale } = useI18n();
  const { catalog } = useSettings();
  const navigate = useNavigate();
  const errorId = useId();
  const [min, setMin] = useState(current?.min ? String(current.min) : '');
  const [max, setMax] = useState(current?.max ? String(current.max) : '');
  const [error, setError] = useState<string | null>(null);
  const Heading = `h${headingLevel}` as const;

  const presetLabel = (p: { min: number; max: number | null }) =>
    p.max === null
      ? t('budget.presetOver', { min: format.money(p.min) })
      : p.min === 0
        ? t('budget.presetUnder', { max: format.money(p.max) })
        : t('budget.presetRange', { min: format.number(p.min), max: format.money(p.max) });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const minValue = parseAmount(min);
    const maxValue = parseAmount(max);
    if (
      Number.isNaN(minValue) ||
      Number.isNaN(maxValue) ||
      (minValue === null && maxValue === null) ||
      (minValue !== null && maxValue !== null && minValue >= maxValue)
    ) {
      setError(t('budget.invalid'));
      return;
    }
    setError(null);
    void navigate(localizePath(budgetHref(minValue, maxValue), locale));
  };

  return (
    <div className={styles.budget}>
      <div>
        <Heading id={headingId} className={catalogStyles.sectionTitle}>
          {title}
        </Heading>
        {subtitle && <p className={catalogStyles.sectionSubtitle}>{subtitle}</p>}
        <p className="visually-hidden" id={`${headingId}-presets`}>
          {t('budget.presets')}
        </p>
        <ul className={styles.presets} aria-labelledby={`${headingId}-presets`}>
          {catalog.budgetPresets.map((preset) => {
            const active = current?.min === (preset.min || null) && current?.max === preset.max;
            return (
              <li key={`${preset.min}-${preset.max ?? 'up'}`}>
                <LocaleLink
                  to={budgetHref(preset.min, preset.max)}
                  className={styles.chip}
                  aria-current={active ? 'true' : undefined}
                >
                  {presetLabel(preset)}
                </LocaleLink>
              </li>
            );
          })}
        </ul>
      </div>
      <form
        className={styles.budgetForm}
        onSubmit={submit}
        noValidate
        aria-describedby={error ? errorId : undefined}
      >
        <div className={styles.budgetInputs}>
          <TextField
            label={t('budget.from')}
            inputMode="numeric"
            autoComplete="off"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            placeholder={format.number(10000)}
            step={catalog.budgetStep}
          />
          <TextField
            label={t('budget.to')}
            inputMode="numeric"
            autoComplete="off"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            placeholder={format.number(30000)}
          />
        </div>
        {error && (
          <p id={errorId} role="alert" className={styles.formError}>
            {error}
          </p>
        )}
        <div className={styles.budgetSubmit}>
          <Button type="submit" variant="primary" size="lg">
            {t('budget.show')}
          </Button>
        </div>
      </form>
    </div>
  );
}
