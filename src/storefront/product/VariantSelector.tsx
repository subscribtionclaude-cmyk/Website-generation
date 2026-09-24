import type { ProductDetail } from '@/domain/catalog/types';
import { optionValueState, selectOption, type Selection } from '@/domain/catalog/variants';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import styles from './product.module.css';

/**
 * Storage / colour selection as native radio groups (arrow-key navigation, one tab stop per
 * group, state announced). Sold-out values stay selectable (→ Notify Me); values that don't exist
 * with the current choices are marked and selecting them moves to the closest existing combination.
 * Status is always text + style, never colour alone.
 */
export function VariantSelector({
  product,
  selection,
  onChange,
}: {
  product: ProductDetail;
  selection: Selection;
  onChange: (next: Selection) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <>
      {product.options.map((option) => {
        const selected = option.values.find((v) => v.key === selection[option.key]);
        const name = resolveLocalized(option.name, locale);
        return (
          <fieldset key={option.key} className={styles.option}>
            <legend>
              {name}
              {selected && (
                <span className={styles.optionValue}>
                  : {resolveLocalized(selected.label, locale)}
                </span>
              )}
            </legend>
            <div className={styles.values}>
              {option.values.map((value) => {
                const state = optionValueState(product, selection, option.key, value.key);
                const label = resolveLocalized(value.label, locale);
                return (
                  <label
                    key={value.key}
                    className={[
                      styles.value,
                      state === 'out_of_stock' && styles.valueSoldOut,
                      state === 'unavailable' && styles.valueUnavailable,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <input
                      type="radio"
                      name={`option-${option.key}`}
                      value={value.key}
                      checked={selection[option.key] === value.key}
                      onChange={() =>
                        onChange(selectOption(product, selection, option.key, value.key))
                      }
                    />
                    <span className={styles.valueFace}>
                      {value.hex && (
                        <span
                          className={styles.dot}
                          style={{ background: value.hex }}
                          aria-hidden="true"
                        />
                      )}
                      <span>{label}</span>
                      {state === 'out_of_stock' && (
                        <span className={styles.valueTag}>{t('product.soldOutValue')}</span>
                      )}
                      {state === 'unavailable' && (
                        <span className="visually-hidden">({t('product.unavailableValue')})</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </>
  );
}
