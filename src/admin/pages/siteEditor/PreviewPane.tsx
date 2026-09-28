import { ExternalLink, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import type { Locale } from '@/i18n/config';
import { localizePath } from '@/i18n/paths';
import {
  PREVIEW_FOCUS,
  PREVIEW_FRAME_NAME,
  PREVIEW_STATE,
  previewReadySchema,
  SAMPLE_FRAME_NAME,
  type PreviewState,
  type PreviewStateMessage,
} from '@/preview/protocol';
import { useAdminI18n } from '../../i18n/context';
import ui from '../../ui/adminUi.module.css';
import { DEVICES, type Device } from './editorState';
import styles from './siteEditor.module.css';

const EMPTY: PreviewState = { layouts: {}, settings: {} };

/**
 * Live preview: the REAL storefront in a same-origin frame (its own lazy "preview" runtime), fed
 * the editor's unsaved document over postMessage. Device sizes are true CSS widths scaled to fit;
 * Arabic / English switch the storefront locale (RTL / LTR). Nothing is published by previewing.
 */
export function PreviewPane({
  path,
  state,
  focusKey,
  device,
  locale,
  sample,
  sampleAllowed,
  applyToSample,
  onDevice,
  onLocale,
  onSample,
  onApplyToSample,
}: {
  path: string;
  state: PreviewState;
  /** Section selected in the editor: the preview scrolls to it. */
  focusKey: string | null;
  device: Device;
  locale: Locale;
  sample: boolean;
  sampleAllowed: boolean;
  applyToSample: boolean;
  onDevice: (d: Device) => void;
  onLocale: (l: Locale) => void;
  onSample: (on: boolean) => void;
  onApplyToSample: (on: boolean) => void;
}) {
  const { at } = useAdminI18n();
  const groupName = useId();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<Window | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const [sampleBlocked, setSampleBlocked] = useState(false);
  const [reloads, setReloads] = useState(0);
  const pushed = sample && !applyToSample ? EMPTY : state;
  const src = localizePath(path, locale);
  const frameName = sample ? SAMPLE_FRAME_NAME : PREVIEW_FRAME_NAME;

  const post = useEffectEvent((target: Window | null | undefined) => {
    if (!target) return;
    const message: PreviewStateMessage = { type: PREVIEW_STATE, ...pushed };
    target.postMessage(message, window.location.origin);
  });

  const onFrameMessage = useEffectEvent((event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const fromFrame = event.source === frameRef.current?.contentWindow;
    const fromPopup = popupRef.current !== null && event.source === popupRef.current;
    if (!fromFrame && !fromPopup) return;
    const parsed = previewReadySchema.safeParse(event.data);
    if (!parsed.success) return;
    if (fromFrame) {
      setReady(true);
      setSampleBlocked(parsed.data.sampleBlocked);
    }
    post(event.source as Window);
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => onFrameMessage(event);
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Push every change (debounced) to the frame and to an open preview tab.
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => {
      post(frameRef.current?.contentWindow);
      if (popupRef.current && !popupRef.current.closed) post(popupRef.current);
    }, 120);
    return () => window.clearTimeout(t);
  }, [pushed, ready]);

  // Follow the selection (after the state push above has landed).
  useEffect(() => {
    if (!ready || !focusKey) return;
    const t = window.setTimeout(() => {
      frameRef.current?.contentWindow?.postMessage(
        { type: PREVIEW_FOCUS, key: focusKey },
        window.location.origin,
      );
    }, 450);
    return () => window.clearTimeout(t);
  }, [focusKey, ready]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const size = DEVICES[device];
  const scale = box.width > 0 ? Math.min(1, box.width / size.width) : 1;
  const frameHeight = box.height > 0 ? Math.max(box.height / scale, 480) : size.height;

  return (
    <div className={styles.preview}>
      <div className={styles.previewBar}>
        <fieldset className={styles.segmented}>
          <legend className="visually-hidden">{at('siteEditor.preview.device')}</legend>
          {(Object.keys(DEVICES) as Device[]).map((d) => (
            <label key={d} className={styles.segment}>
              <input
                type="radio"
                name={`${groupName}-device`}
                checked={device === d}
                onChange={() => onDevice(d)}
              />
              {d === 'mobile' ? (
                <Smartphone aria-hidden="true" />
              ) : d === 'tablet' ? (
                <Tablet aria-hidden="true" />
              ) : (
                <Monitor aria-hidden="true" />
              )}
              <span>{at(`siteEditor.preview.${d}`)}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className={styles.segmented}>
          <legend className="visually-hidden">{at('siteEditor.preview.language')}</legend>
          {(['ar', 'en'] as const).map((l) => (
            <label key={l} className={styles.segment}>
              <input
                type="radio"
                name={`${groupName}-lang`}
                checked={locale === l}
                onChange={() => onLocale(l)}
              />
              <span lang={l}>{l === 'ar' ? 'العربية' : 'English'}</span>
            </label>
          ))}
        </fieldset>
        <span className={styles.previewTools}>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw aria-hidden="true" />}
            onClick={() => {
              setReady(false);
              setReloads((n) => n + 1);
            }}
          >
            {at('siteEditor.preview.reload')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<ExternalLink aria-hidden="true" />}
            onClick={() => {
              popupRef.current = window.open(src, frameName);
            }}
          >
            {at('siteEditor.preview.newTab')}
          </Button>
        </span>
      </div>
      {sampleAllowed && (
        <div className={styles.sampleBar}>
          <label className={ui.check}>
            <input type="checkbox" checked={sample} onChange={(e) => onSample(e.target.checked)} />
            {at('siteEditor.sample.toggle')}
          </label>
          {sample && (
            <label className={ui.check}>
              <input
                type="checkbox"
                checked={applyToSample}
                onChange={(e) => onApplyToSample(e.target.checked)}
              />
              {at('siteEditor.sample.apply')}
            </label>
          )}
        </div>
      )}
      {sample && (
        <Alert tone={sampleBlocked ? 'warning' : 'info'}>
          {sampleBlocked ? at('siteEditor.sample.blocked') : at('siteEditor.sample.note')}
        </Alert>
      )}
      <div ref={boxRef} className={styles.previewBox}>
        <div
          className={styles.frameWrap}
          style={{ width: size.width * scale, height: frameHeight * scale }}
        >
          <iframe
            key={`${frameName}-${reloads}`}
            ref={frameRef}
            name={frameName}
            title={at('siteEditor.preview.frameTitle', {
              device: at(`siteEditor.preview.${device}`),
            })}
            src={src}
            className={styles.frame}
            style={{
              width: size.width,
              height: frameHeight,
              transform: `scale(${scale})`,
            }}
          />
        </div>
      </div>
      <p className={`${ui.small} ${ui.muted}`}>
        {at('siteEditor.preview.scale', {
          width: size.width,
          percent: Math.round(scale * 100),
        })}
      </p>
    </div>
  );
}
