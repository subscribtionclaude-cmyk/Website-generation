import { useState } from 'react';
import { customRange, presetRange, storeDay, type DateRange } from '@/domain/admin/dateRange';
import { Button } from '@/components/ui/Button';
import { useAdminI18n } from '../i18n/context';
import styles from './adminUi.module.css';
import { CheckboxField, InputField, SelectField } from './fields';

/** Today / 7 days / 30 days / custom (Cairo days) + "include demo data" switch. */
export function DateRangePicker({
  value,
  onChange,
  includeDemo,
  onIncludeDemoChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  includeDemo: boolean;
  onIncludeDemoChange: (value: boolean) => void;
}) {
  const { at } = useAdminI18n();
  const [preset, setPreset] = useState(value.preset);
  const [from, setFrom] = useState(storeDay(new Date(value.from)));
  const [to, setTo] = useState(storeDay(new Date(new Date(value.to).getTime() - 1)));
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className={styles.filters}
      onSubmit={(e) => {
        e.preventDefault();
        if (preset !== 'custom') return onChange(presetRange(preset));
        const range = customRange(from, to);
        setInvalid(range === null);
        if (range) onChange(range);
      }}
    >
      <SelectField
        label={at('ui.dateRange')}
        value={preset}
        onChange={(e) => {
          const next = e.target.value as DateRange['preset'];
          setPreset(next);
          if (next !== 'custom') onChange(presetRange(next));
        }}
        options={[
          { value: 'today', label: at('ui.today') },
          { value: '7d', label: at('ui.last7') },
          { value: '30d', label: at('ui.last30') },
          { value: 'custom', label: at('ui.custom') },
        ]}
      />
      {preset === 'custom' && (
        <>
          <InputField
            type="date"
            label={at('ui.from')}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            error={invalid ? at('problems.invalid_dates') : null}
          />
          <InputField
            type="date"
            label={at('ui.to')}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <div className={styles.filterActions}>
            <Button type="submit" variant="primary">
              {at('ui.apply')}
            </Button>
          </div>
        </>
      )}
      <CheckboxField
        label={at('ui.includeDemo')}
        checked={includeDemo}
        onChange={onIncludeDemoChange}
      />
    </form>
  );
}
