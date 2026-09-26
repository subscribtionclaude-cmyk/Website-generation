import '@/i18n/messages/services';
import { Box, CircleHelp, Layers, MessagesSquare, RotateCcw, Scan } from 'lucide-react';
import { lazy, Suspense, useId, useState } from 'react';
import { Skeleton } from '@/components/feedback/Skeleton';
import { resolveLocalized } from '@/domain/localized';
import type { DiagnosticViewer } from '@/domain/services/types';
import type { RepairCategory } from '@/domain/settings/schemas';
import { useI18n } from '@/i18n/context';
import { track } from '@/lib/analytics/track';
import { deviceModel, type DeviceModel } from './deviceModels';
import styles from './diagnostic.module.css';

// three.js lives only in this lazily loaded chunk (never on Home / Shop / Product / Checkout).
const Diagnostic3D = lazy(() => import('./Diagnostic3D'));

export interface Diagnosis {
  component: string | null;
  symptom: string | null;
  unsure: boolean;
  viewer: DiagnosticViewer;
}

type Quality = 'auto' | 'low' | 'high';

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Weaker devices (few cores / little memory / data saver) get the low-quality renderer. */
function autoQuality(): 'low' | 'high' {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  if (nav.connection?.saveData) return 'low';
  if ((nav.hardwareConcurrency ?? 4) < 6) return 'low';
  if ((nav.deviceMemory ?? 4) < 4) return 'low';
  return 'high';
}

/**
 * Diagnostic step: interactive 3D model (lazy), equivalent 2D diagram fallback, and an accessible
 * parts list + symptom panel that always work — the request never depends on WebGL.
 */
export function DiagnosticStep({
  category,
  value,
  onChange,
  onConsultation,
}: {
  category: RepairCategory;
  value: Diagnosis;
  onChange: (next: Diagnosis) => void;
  onConsultation: () => void;
}) {
  const { t, locale } = useI18n();
  const model = deviceModel(category.model);
  // No WebGL (or a lost context later) = 2D only, with an honest notice and no 3D toggle.
  const [failed, setFailed] = useState(() => !webglAvailable());
  const [mode, setMode] = useState<'3d' | '2d'>(() => (failed ? '2d' : '3d'));
  const [quality, setQuality] = useState<Quality>('auto');
  const [exploded, setExploded] = useState(false);
  const [reset, setReset] = useState(0);
  const [reducedMotion] = useState(prefersReducedMotion);
  const partsId = useId();
  const symptomsId = useId();
  const panelId = useId();

  const components = category.components;
  const selectable = components.map((c) => c.key);
  const selected = components.find((c) => c.key === value.component) ?? null;
  const viewer: DiagnosticViewer = !model ? 'list' : mode;

  const choose = (key: string) => {
    track('diagnostic_part_selected', { category: category.key, component: key, viewer });
    onChange({ component: key, symptom: null, unsure: false, viewer });
  };
  const unsure = () => onChange({ component: null, symptom: null, unsure: true, viewer });

  return (
    <div className={styles.step}>
      {model && (
        <div className={styles.viewer}>
          <div className={styles.toolbar} role="toolbar" aria-label={t('repairs.viewerControls')}>
            <button
              type="button"
              className={styles.tool}
              aria-pressed={exploded}
              onClick={() => setExploded((v) => !v)}
            >
              <Layers aria-hidden="true" />
              {t('repairs.explode')}
            </button>
            {mode === '3d' && (
              <button type="button" className={styles.tool} onClick={() => setReset((n) => n + 1)}>
                <RotateCcw aria-hidden="true" />
                {t('repairs.resetView')}
              </button>
            )}
            {!failed && (
              <button
                type="button"
                className={styles.tool}
                onClick={() => setMode((m) => (m === '3d' ? '2d' : '3d'))}
              >
                {mode === '3d' ? <Scan aria-hidden="true" /> : <Box aria-hidden="true" />}
                {mode === '3d' ? t('repairs.use2d') : t('repairs.use3d')}
              </button>
            )}
            {mode === '3d' && (
              <label className={styles.qualityLabel}>
                <span>{t('repairs.quality')}</span>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as Quality)}
                  className={styles.qualitySelect}
                >
                  <option value="auto">{t('repairs.qualityAuto')}</option>
                  <option value="low">{t('repairs.qualityLow')}</option>
                  <option value="high">{t('repairs.qualityHigh')}</option>
                </select>
              </label>
            )}
          </div>
          <div className={styles.stage}>
            {mode === '3d' ? (
              <Suspense fallback={<Skeleton height="100%" radius="0" />}>
                <Diagnostic3D
                  key={`${category.key}-${quality}`}
                  model={model}
                  selectable={selectable}
                  selected={value.component}
                  exploded={exploded}
                  quality={quality === 'auto' ? autoQuality() : quality}
                  reducedMotion={reducedMotion}
                  resetSignal={reset}
                  label={t('repairs.canvasLabel', {
                    device: resolveLocalized(category.label, locale),
                  })}
                  onSelect={choose}
                  onFailure={() => {
                    setFailed(true);
                    setMode('2d');
                  }}
                />
              </Suspense>
            ) : (
              <Diagram2D
                model={model}
                selected={value.component}
                exploded={exploded}
                labels={Object.fromEntries(
                  components.map((c) => [c.key, resolveLocalized(c.label, locale)]),
                )}
                onSelect={choose}
              />
            )}
            <p className={styles.disclaimer}>{t('repairs.genericModel')}</p>
          </div>
          {failed && (
            <p className={styles.notice} role="status">
              {t('repairs.fallbackNotice')}
            </p>
          )}
          {mode === '3d' && <p className={styles.hint}>{t('repairs.viewerHint')}</p>}
        </div>
      )}

      <div className={styles.panel}>
        <fieldset className={styles.parts}>
          <legend id={partsId}>{t('repairs.whichPart')}</legend>
          <div className={styles.partList}>
            {components.map((c) => (
              <label key={c.key} className={styles.partOption}>
                <input
                  type="radio"
                  name="repair-component"
                  checked={value.component === c.key}
                  onChange={() => choose(c.key)}
                  aria-controls={panelId}
                />
                <span>{resolveLocalized(c.label, locale)}</span>
              </label>
            ))}
            <label className={`${styles.partOption} ${styles.partUnsure}`}>
              <input
                type="radio"
                name="repair-component"
                checked={value.unsure && value.component === null}
                onChange={unsure}
              />
              <span>
                <CircleHelp aria-hidden="true" />
                {t('repairs.notSure')}
              </span>
            </label>
          </div>
        </fieldset>

        <div id={panelId} className={styles.symptoms} aria-live="polite">
          {selected ? (
            <fieldset>
              <legend id={symptomsId}>
                {t('repairs.symptomsFor', { part: resolveLocalized(selected.label, locale) })}
              </legend>
              <div className={styles.chips}>
                {selected.symptoms.map((s) => (
                  <label key={s.key} className={styles.chip}>
                    <input
                      type="radio"
                      name="repair-symptom"
                      checked={value.symptom === s.key}
                      onChange={() => onChange({ ...value, symptom: s.key, viewer })}
                    />
                    <span>{resolveLocalized(s.label, locale)}</span>
                  </label>
                ))}
                <label className={styles.chip}>
                  <input
                    type="radio"
                    name="repair-symptom"
                    checked={value.symptom === null}
                    onChange={() => onChange({ ...value, symptom: null, viewer })}
                  />
                  <span>{t('repairs.notSure')}</span>
                </label>
              </div>
            </fieldset>
          ) : (
            <p className={styles.muted}>
              {value.unsure ? t('repairs.unsureChosen') : t('repairs.pickPartHint')}
            </p>
          )}
          <button type="button" className={styles.consult} onClick={onConsultation}>
            <MessagesSquare aria-hidden="true" />
            {t('repairs.startConsultation')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Equivalent 2D diagram (SVG). Pointer shortcut only — the parts list is the accessible path. */
function Diagram2D({
  model,
  selected,
  exploded,
  labels,
  onSelect,
}: {
  model: DeviceModel;
  selected: string | null;
  exploded: boolean;
  labels: Record<string, string>;
  onSelect: (key: string) => void;
}) {
  // Largest first so smaller parts stay on top and remain tappable.
  const parts = model.parts
    .flatMap((p) => (p.key && p.flat && labels[p.key] ? [{ ...p, key: p.key, flat: p.flat }] : []))
    .sort((a, b) => b.flat[2] * b.flat[3] - a.flat[2] * a.flat[3]);
  // A part that encloses others (e.g. the back glass) gets its label near its lower edge so it
  // never collides with the labels of the parts drawn inside it.
  const encloses = (outer: (typeof parts)[number]) =>
    parts.some((inner) => {
      if (inner === outer) return false;
      const [ox, oy, ow, oh] = outer.flat;
      const [ix, iy, iw, ih] = inner.flat;
      return ix >= ox && iy >= oy && ix + iw <= ox + ow && iy + ih <= oy + oh;
    });
  return (
    <svg
      className={styles.diagram}
      viewBox="0 0 100 100"
      role="img"
      aria-label={Object.values(labels).join(' · ')}
    >
      {model.outlines.map(([x, y, w, h, r], index) => (
        <rect key={index} x={x} y={y} width={w} height={h} rx={r} className={styles.outline} />
      ))}
      {parts.map((p) => {
        const [x, y, w, h, r] = p.flat;
        const spread = exploded ? 1 : 0;
        const dx = Math.sign(p.explode[0]) * 2 * spread;
        const dy = -Math.sign(p.explode[1]) * 2 * spread;
        const active = selected === p.key;
        const classes = [
          styles.part2d,
          p.inside && styles.part2dInside,
          active && styles.part2dActive,
          selected && !active && styles.part2dDim,
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <g
            key={p.key}
            className={classes}
            transform={`translate(${dx} ${dy})`}
            onClick={() => onSelect(p.key)}
            aria-hidden="true"
          >
            <rect x={x} y={y} width={w} height={h} rx={r} />
            {w >= 14 && h >= 7 && (
              <text
                x={x + w / 2}
                y={encloses(p) ? y + h - 4 : y + h / 2}
                dominantBaseline="middle"
                textAnchor="middle"
              >
                {labels[p.key]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
