import { useQuery } from '@tanstack/react-query';
import { Camera, CircleAlert, Film, ImagePlus, RefreshCw, Replace, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import {
  ACCEPT_ATTRIBUTE,
  ACCEPT_IMAGES,
  formatBytes,
  mediaProblem,
  sniffMime,
  type MediaLimits,
  type ServiceMime,
} from '@/domain/services/media';
import type { ServiceBucket } from '@/domain/services/types';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { compressImage } from '@/lib/images/compressImage';
import type { ServiceUpload } from '@/repositories/types';
import type { UploadItem } from './serviceHelpers';
import styles from './services.module.css';

/**
 * Shared private-media uploader for service requests. Files are checked (type sniffed from their
 * bytes), images are compressed in the browser (keeping enough detail for diagnosis), then
 * uploaded immediately to the customer's own private folder. Failed uploads keep the file in
 * memory for Retry; the rest of the form is never lost. Draft recovery stores only the uploaded
 * paths, never the files.
 */
const ERRORS: Record<string, CoreMessageKey> = {
  invalid_media_type: 'media.errorType',
  media_too_large: 'media.errorSize',
  too_many_files: 'media.errorCount',
  too_many_videos: 'media.errorVideos',
  video_not_allowed: 'media.errorVideoNotAllowed',
  upload: 'media.errorUpload',
};

export function MediaUploader({
  value,
  onChange,
  limits,
  imageMaxDimension,
  imageQuality,
  allowVideo,
  labels,
  disabled,
  upload,
  discard,
  resolveUrls,
}: {
  value: UploadItem[];
  onChange: (next: (current: UploadItem[]) => UploadItem[]) => void;
  limits: MediaLimits;
  imageMaxDimension: number;
  imageQuality: number;
  allowVideo: boolean;
  /** Photo guidance labels (front, back, damage…) offered per file. */
  labels?: readonly string[];
  disabled?: boolean;
  upload: (file: Blob, mime: ServiceMime) => Promise<ServiceUpload>;
  discard?: (upload: { bucket: ServiceBucket; path: string }) => Promise<void>;
  /** Preview URLs for restored uploads (draft recovery). */
  resolveUrls?: (
    items: { bucket: ServiceBucket; path: string }[],
  ) => Promise<Record<string, string>>;
}) {
  const { t } = useI18n();
  const files = useRef(new Map<string, File>());
  const [announce, setAnnounce] = useState('');
  const hintId = useId();
  const cameraId = useId();
  const pickId = useId();

  // Revoke object URLs when items go away.
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const tracked = urls.current;
    return () => {
      for (const url of tracked) URL.revokeObjectURL(url);
    };
  }, []);

  const restored = value.filter((i) => i.status === 'done' && i.upload && !i.previewUrl);
  const remote = useQuery<Record<string, string>>({
    queryKey: ['service-media-preview', restored.map((i) => i.upload?.path)],
    queryFn: () =>
      resolveUrls?.(
        restored.flatMap((i) =>
          i.upload ? [{ bucket: i.upload.bucket, path: i.upload.path }] : [],
        ),
      ) ?? Promise.resolve<Record<string, string>>({}),
    enabled: restored.length > 0 && Boolean(resolveUrls),
    staleTime: 5 * 60_000,
  });

  const patch = (localId: string, changes: Partial<UploadItem>) =>
    onChange((items) => items.map((i) => (i.localId === localId ? { ...i, ...changes } : i)));

  const counts = (items: UploadItem[], except?: string) => {
    const active = items.filter((i) => i.localId !== except && i.status !== 'error');
    return {
      images: active.filter((i) => i.mediaType === 'image').length,
      videos: active.filter((i) => i.mediaType === 'video').length,
    };
  };

  const process = async (localId: string, file: File) => {
    files.current.set(localId, file);
    patch(localId, { status: 'processing', error: null, retryable: false });
    try {
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      let mime = sniffMime(head);
      let blob: Blob = file;
      if (mime && mime.startsWith('image/') && mime !== 'image/heic' && mime !== 'image/heif') {
        try {
          blob = await compressImage(
            new File([file], file.name, { type: mime }),
            imageMaxDimension,
            imageQuality,
          );
          mime = blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
        } catch {
          blob = file; // keep the original (already a validated image type)
        }
      }
      const problem = mediaProblem(
        { mime, size: blob.size },
        { images: 0, videos: 0 },
        limits,
        allowVideo,
      );
      if (problem || !mime) {
        files.current.delete(localId);
        patch(localId, { status: 'error', error: ERRORS[problem ?? 'invalid_media_type'] ?? null });
        return;
      }
      patch(localId, {
        status: 'uploading',
        mediaType: mime.startsWith('video/') ? 'video' : 'image',
      });
      const result = await upload(blob, mime);
      patch(localId, { status: 'done', upload: result, error: null });
      files.current.delete(localId);
      setAnnounce(t('media.uploaded', { name: file.name }));
    } catch {
      patch(localId, { status: 'error', error: 'media.errorUpload', retryable: true });
      setAnnounce(t('media.uploadFailed', { name: file.name }));
    }
  };

  const add = (event: ChangeEvent<HTMLInputElement>, replaceId?: string) => {
    const picked = [...(event.target.files ?? [])];
    event.target.value = '';
    if (picked.length === 0) return;
    const current = value;
    let images = counts(current, replaceId).images;
    let videos = counts(current, replaceId).videos;
    const accepted: { item: UploadItem; file: File }[] = [];
    let rejected: CoreMessageKey | null = null;
    for (const file of picked) {
      const isVideo = file.type.startsWith('video/');
      const problem = mediaProblem(
        { mime: isVideo ? 'video/mp4' : 'image/jpeg', size: 1 },
        { images, videos },
        limits,
        allowVideo,
      );
      if (problem) {
        rejected = ERRORS[problem] ?? null;
        continue;
      }
      if (isVideo) videos += 1;
      else images += 1;
      const previewUrl = URL.createObjectURL(file);
      urls.current.add(previewUrl);
      accepted.push({
        file,
        item: {
          localId: crypto.randomUUID(),
          status: 'processing',
          mediaType: isVideo ? 'video' : 'image',
          name: file.name,
          label: null,
          previewUrl: isVideo ? null : previewUrl,
          upload: null,
          error: null,
        },
      });
    }
    if (rejected) setAnnounce(t(rejected, limitVars));
    if (accepted.length === 0) return;
    if (replaceId) {
      const old = current.find((i) => i.localId === replaceId);
      if (old?.upload && discard) void discard(old.upload).catch(() => undefined);
      const first = accepted[0];
      if (!first) return;
      onChange((items) =>
        items.map((i) =>
          i.localId === replaceId ? { ...first.item, label: old?.label ?? null } : i,
        ),
      );
      void process(first.item.localId, first.file);
      return;
    }
    onChange((items) => [...items, ...accepted.map((a) => a.item)]);
    for (const a of accepted) void process(a.item.localId, a.file);
  };

  const remove = (item: UploadItem) => {
    if (item.upload && discard) void discard(item.upload).catch(() => undefined);
    files.current.delete(item.localId);
    onChange((items) => items.filter((i) => i.localId !== item.localId));
    setAnnounce(t('media.removed', { name: item.name }));
  };

  const retry = (item: UploadItem) => {
    const file = files.current.get(item.localId);
    if (file) void process(item.localId, file);
  };

  const limitVars = {
    files: limits.maxFiles,
    image: formatBytes(limits.maxImageBytes),
    video: formatBytes(limits.maxVideoBytes),
  };
  const full = counts(value).images + counts(value).videos >= limits.maxFiles;

  return (
    <div className={styles.uploader}>
      <p id={hintId} className={styles.hint}>
        {allowVideo && limits.allowVideo && limits.maxVideos > 0
          ? t('media.limitsWithVideo', { ...limitVars, videos: limits.maxVideos })
          : t('media.limits', limitVars)}
      </p>
      <div className={styles.uploadButtons}>
        <label
          className={styles.uploadButton}
          htmlFor={cameraId}
          aria-disabled={disabled || full || undefined}
        >
          <Camera aria-hidden="true" />
          {t('media.takePhoto')}
          <input
            id={cameraId}
            type="file"
            accept={ACCEPT_IMAGES}
            capture="environment"
            disabled={disabled || full}
            onChange={(e) => add(e)}
            aria-describedby={hintId}
          />
        </label>
        <label
          className={styles.uploadButton}
          htmlFor={pickId}
          aria-disabled={disabled || full || undefined}
        >
          <ImagePlus aria-hidden="true" />
          {allowVideo && limits.allowVideo ? t('media.choose') : t('media.choosePhotos')}
          <input
            id={pickId}
            type="file"
            multiple
            accept={allowVideo && limits.allowVideo ? ACCEPT_ATTRIBUTE : ACCEPT_IMAGES}
            disabled={disabled || full}
            onChange={(e) => add(e)}
            aria-describedby={hintId}
          />
        </label>
      </div>
      <p className="visually-hidden" role="status">
        {announce}
      </p>
      {value.length > 0 && (
        <ul className={styles.thumbs} aria-label={t('media.listLabel')}>
          {value.map((item, index) => {
            const src =
              item.previewUrl ??
              (item.upload
                ? remote.data?.[`${item.upload.bucket}/${item.upload.path}`]
                : undefined);
            const statusText =
              item.status === 'processing'
                ? t('media.processing')
                : item.status === 'uploading'
                  ? t('media.uploading')
                  : item.status === 'error'
                    ? t(item.error ?? 'media.errorUpload', limitVars)
                    : null;
            const name = t('media.fileName', { index: index + 1 });
            return (
              <li key={item.localId} className={styles.thumb}>
                <div className={styles.thumbMedia}>
                  {item.mediaType === 'video' ? (
                    <Film aria-hidden="true" />
                  ) : src ? (
                    <img src={src} alt={name} />
                  ) : (
                    <ImagePlus aria-hidden="true" />
                  )}
                  {statusText && (
                    <span
                      className={`${styles.thumbStatus} ${item.status === 'error' ? styles.thumbError : ''}`}
                    >
                      {item.status === 'error' && <CircleAlert aria-hidden="true" />} {statusText}
                    </span>
                  )}
                </div>
                {labels && item.mediaType === 'image' && (
                  <select
                    className={styles.labelSelect}
                    value={item.label ?? ''}
                    aria-label={t('media.labelFor', { name })}
                    onChange={(e) => patch(item.localId, { label: e.target.value || null })}
                  >
                    <option value="">{t('media.labelNone')}</option>
                    {labels.map((l) => (
                      <option key={l} value={l}>
                        {t(`media.label_${l}` as CoreMessageKey)}
                      </option>
                    ))}
                  </select>
                )}
                <div className={styles.thumbActions}>
                  {item.status === 'error' && item.retryable && (
                    <button type="button" className={styles.miniButton} onClick={() => retry(item)}>
                      <RefreshCw aria-hidden="true" />
                      {t('media.retry')}
                      <span className="visually-hidden">: {name}</span>
                    </button>
                  )}
                  <label className={styles.miniButton}>
                    <Replace aria-hidden="true" />
                    {t('media.replace')}
                    <span className="visually-hidden">: {name}</span>
                    <input
                      type="file"
                      accept={allowVideo && limits.allowVideo ? ACCEPT_ATTRIBUTE : ACCEPT_IMAGES}
                      disabled={disabled || item.status === 'uploading'}
                      onChange={(e) => add(e, item.localId)}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.miniButton}
                    onClick={() => remove(item)}
                    disabled={item.status === 'uploading'}
                  >
                    <Trash2 aria-hidden="true" />
                    {t('media.remove')}
                    <span className="visually-hidden">: {name}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
