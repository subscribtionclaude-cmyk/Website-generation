import { ChevronLeft, ChevronRight, PlayCircle } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { MediaItem } from '@/domain/catalog/types';
import { resolveLocalized } from '@/domain/localized';
import { useI18n } from '@/i18n/context';
import styles from './product.module.css';

/**
 * Variant-aware gallery (images + video). Thumbnails are buttons; ←/→ move between items
 * (mirrored in RTL). Videos never autoplay and load nothing until played (preload="none").
 */
export function ProductGallery({
  media,
  productName,
}: {
  media: MediaItem[];
  productName: string;
}) {
  const { t, locale, meta, format } = useI18n();
  const [index, setIndex] = useState(0);
  const count = media.length;
  const current = media[Math.min(index, count - 1)];
  if (!current) return <div className={styles.stage} aria-hidden="true" />;

  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const forward = event.key === (meta.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    event.preventDefault();
    go(forward ? 1 : -1);
  };
  const Prev = meta.dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Next = meta.dir === 'rtl' ? ChevronLeft : ChevronRight;

  return (
    // Arrow keys work from any focused control inside the gallery (buttons handle Enter/Space).
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions
    <section
      className={styles.gallery}
      aria-label={t('product.gallery', { product: productName })}
      onKeyDown={onKeyDown}
    >
      <div className={styles.stage}>
        {current.kind === 'video' ? (
          // Captions are attached whenever the media item has a WebVTT file (captionsUrl).
          // eslint-disable-next-line jsx-a11y-x/media-has-caption
          <video
            key={current.id}
            src={current.url}
            poster={current.posterUrl ?? undefined}
            controls
            preload="none"
            playsInline
            aria-label={resolveLocalized(current.alt, locale)}
          >
            {current.captionsUrl && (
              <track kind="captions" src={current.captionsUrl} srcLang={locale} default />
            )}
          </video>
        ) : (
          <img
            key={current.id}
            src={current.url}
            alt={resolveLocalized(current.alt, locale)}
            width={current.width ?? 800}
            height={current.height ?? 800}
            fetchPriority={index === 0 ? 'high' : 'auto'}
          />
        )}
        {count > 1 && (
          <>
            <p className={styles.counter} aria-live="polite">
              <span className="visually-hidden">
                {t('product.galleryImage', {
                  index: format.number(index + 1),
                  total: format.number(count),
                })}
              </span>
              <span aria-hidden="true" dir="ltr">
                {format.number(index + 1)} / {format.number(count)}
              </span>
            </p>
            <div className={styles.stageNav}>
              <button type="button" onClick={() => go(-1)} aria-label={t('product.previousImage')}>
                <Prev aria-hidden="true" />
              </button>
              <button type="button" onClick={() => go(1)} aria-label={t('product.nextImage')}>
                <Next aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>
      {count > 1 && (
        <ul className={styles.thumbs}>
          {media.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                className={styles.thumb}
                aria-current={i === index ? 'true' : undefined}
                aria-label={t('product.galleryImage', {
                  index: format.number(i + 1),
                  total: format.number(count),
                })}
                onClick={() => setIndex(i)}
              >
                <img
                  src={item.kind === 'video' ? (item.posterUrl ?? '') : item.url}
                  alt=""
                  width={64}
                  height={64}
                  loading="lazy"
                />
                {item.kind === 'video' && (
                  <PlayCircle className={styles.thumbPlay} aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
