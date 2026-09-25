import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  CircleAlert,
  FlaskConical,
  ImagePlus,
  MessageSquareText,
  Star,
  X,
} from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/TextField';
import type { ProductDetail } from '@/domain/catalog/types';
import type { OwnReview, Review } from '@/domain/customer/types';
import { resolveLocalized } from '@/domain/localized';
import { useSession } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { localizePath } from '@/i18n/paths';
import { compressImage } from '@/lib/images/compressImage';
import { useRuntime } from '@/runtime/context';
import styles from './reviews.module.css';

const PAGE = 5;

/** Visual stars (decorative); the rating is always also given as text. */
export function Stars({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`${styles.stars} ${styles[size]}`} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} fill={n <= Math.round(value) ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}

/** Product page reviews: approved reviews only, verified-buyer badge from the server, form for eligible buyers. */
export function ProductReviews({ product }: { product: ProductDetail }) {
  const { t, format, locale } = useI18n();
  const { repositories } = useRuntime();
  const [limit, setLimit] = useState(PAGE);
  const reviews = useQuery({
    queryKey: ['public', 'reviews', product.slug, limit],
    queryFn: () => repositories.reviews.listPublic(product.slug, limit, 0),
  });
  const paths = (reviews.data?.items ?? [])
    .map((r) => r.imagePath)
    .filter((p): p is string => Boolean(p));
  const images = useQuery({
    queryKey: ['public', 'review-images', paths],
    queryFn: () => repositories.reviews.imageUrls(paths),
    enabled: paths.length > 0,
  });
  const summary = reviews.data?.summary;
  const name = resolveLocalized(product.name, locale);

  return (
    <section className={styles.section} aria-labelledby="product-reviews">
      <h2 id="product-reviews" className={styles.title}>
        {t('reviews.title')}
      </h2>
      {reviews.isPending ? (
        <Skeleton height="120px" />
      ) : reviews.isError || !summary ? (
        <p className={styles.notice} role="alert">
          <CircleAlert aria-hidden="true" />
          {t('reviews.loadError')}
        </p>
      ) : (
        <div className={styles.layout}>
          <div className={styles.summary}>
            {summary.count > 0 && summary.average !== null ? (
              <>
                <p className={styles.average}>
                  <span className={styles.averageValue}>{format.number(summary.average)}</span>
                  <Stars value={summary.average} size="lg" />
                </p>
                <p className={styles.muted}>
                  {t('reviews.averageText', {
                    average: format.number(summary.average),
                    count: format.number(summary.count),
                  })}
                </p>
                <ul className={styles.distribution} aria-label={t('reviews.distribution')}>
                  {(['5', '4', '3', '2', '1'] as const).map((star) => {
                    const n = summary.distribution[star];
                    return (
                      <li key={star}>
                        <span>
                          {t('reviews.starsCount', { stars: format.number(Number(star)) })}
                        </span>
                        <span className={styles.bar} aria-hidden="true">
                          <span
                            style={{ width: `${summary.count ? (n / summary.count) * 100 : 0}%` }}
                          />
                        </span>
                        <span className={styles.barCount}>{format.number(n)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className={styles.muted}>{t('reviews.empty')}</p>
            )}
            <WriteReview product={product} productName={name} />
          </div>
          {reviews.data && reviews.data.items.length > 0 && (
            <div>
              <ul className={styles.list}>
                {reviews.data.items.map((review) => (
                  <ReviewItem
                    key={review.id}
                    review={review}
                    imageUrl={review.imagePath ? images.data?.[review.imagePath] : undefined}
                  />
                ))}
              </ul>
              {summary.count > limit && (
                <Button
                  variant="secondary"
                  onClick={() => setLimit((l) => l + PAGE)}
                  loading={reviews.isFetching}
                >
                  {t('reviews.more')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ReviewItem({ review, imageUrl }: { review: Review; imageUrl?: string }) {
  const { t, format, locale } = useI18n();
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <Stars value={review.rating} size="sm" />
        <span className="visually-hidden">{t('reviews.ratedText', { rating: review.rating })}</span>
        {review.title && <strong className={styles.itemTitle}>{review.title}</strong>}
      </div>
      <p className={styles.body} dir="auto">
        {review.body}
      </p>
      {imageUrl && (
        <img
          className={styles.photo}
          src={imageUrl}
          alt={t('reviews.photoAlt', { author: review.authorName })}
          loading="lazy"
        />
      )}
      <p className={styles.meta}>
        <bdi>{review.authorName}</bdi> ·{' '}
        <time dateTime={review.createdAt}>{format.date(review.createdAt)}</time>
        {review.verifiedBuyer && (
          <span className={styles.verified}>
            <BadgeCheck aria-hidden="true" />
            {t('reviews.verifiedBuyer')}
          </span>
        )}
        {review.isDemo && !review.verifiedBuyer && (
          <span className={styles.demo}>
            <FlaskConical aria-hidden="true" />
            {t('reviews.demoReview')}
          </span>
        )}
      </p>
      {locale === 'en' && /[؀-ۿ]/.test(review.body) && (
        <p className={styles.muted}>{t('reviews.originalLanguage')}</p>
      )}
    </li>
  );
}

function WriteReview({ product, productName }: { product: ProductDetail; productName: string }) {
  const { t, locale } = useI18n();
  const session = useSession();
  const { repositories } = useRuntime();
  const { pathname, search } = useLocation();
  const status = useQuery({
    queryKey: ['review-status', session?.userId ?? null, product.slug],
    queryFn: () => repositories.reviews.myStatus(product.slug),
  });
  if (status.isPending) return <Skeleton height="44px" />;
  if (status.isError || !status.data) return null;
  const { reason, eligible, review } = status.data;
  if (reason === 'disabled' || reason === 'not_found') return null;
  if (reason === 'sign_in')
    return (
      <p className={styles.gate}>
        <MessageSquareText aria-hidden="true" />
        <span>
          {t('reviews.onlyBuyers')}{' '}
          <Link
            to={`${localizePath('/account/sign-in', locale)}?next=${encodeURIComponent(pathname + search)}`}
          >
            {t('reviews.signInToReview')}
          </Link>
        </span>
      </p>
    );
  if (!eligible)
    return (
      <p className={styles.gate}>
        <MessageSquareText aria-hidden="true" />
        <span>
          {reason === 'not_delivered' ? t('reviews.afterDelivery') : t('reviews.onlyBuyers')}
        </span>
      </p>
    );
  return (
    <ReviewForm
      productSlug={product.slug}
      productName={productName}
      existing={review}
      allowImages={status.data.allowImages ?? true}
    />
  );
}

const MESSAGE: Record<
  string,
  | 'reviews.errorRating'
  | 'reviews.errorBody'
  | 'reviews.errorTitle'
  | 'reviews.errorImage'
  | 'reviews.errorNotEligible'
  | 'reviews.errorGeneric'
> = {
  rating: 'reviews.errorRating',
  body: 'reviews.errorBody',
  title: 'reviews.errorTitle',
  image: 'reviews.errorImage',
  not_eligible: 'reviews.errorNotEligible',
};

function ReviewForm({
  productSlug,
  productName,
  existing,
  allowImages,
}: {
  productSlug: string;
  productName: string;
  existing: OwnReview | null;
  allowImages: boolean;
}) {
  const { t } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const queryClient = useQueryClient();
  const legendId = useId();
  const [open, setOpen] = useState(existing === null);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [keepPhoto, setKeepPhoto] = useState(Boolean(existing?.imagePath));
  const [error, setError] = useState<{ field: string; message: string } | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      let imagePath = keepPhoto ? (existing?.imagePath ?? null) : null;
      if (photo) imagePath = await repositories.reviews.uploadImage(await compressImage(photo));
      return repositories.reviews.submit({
        productSlug,
        rating,
        title: title.trim() || null,
        body,
        imagePath,
      });
    },
    onSuccess: (result) => {
      if (!result.ok) {
        const key = MESSAGE[result.field ?? result.code ?? ''] ?? 'reviews.errorGeneric';
        setError({ field: result.field ?? 'form', message: t(key) });
        return;
      }
      setError(null);
      setOpen(false);
      setPhoto(null);
      void queryClient.invalidateQueries({
        queryKey: ['review-status', session?.userId ?? null, productSlug],
      });
      void queryClient.invalidateQueries({ queryKey: ['my-reviews', session?.userId ?? null] });
    },
    onError: () => setError({ field: 'form', message: t('reviews.errorGeneric') }),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (rating < 1) return setError({ field: 'rating', message: t('reviews.errorRating') });
    if (body.trim().length < 10)
      return setError({ field: 'body', message: t('reviews.errorBody') });
    submit.mutate();
  };

  if (!open && existing)
    return (
      <div className={styles.own} role="status">
        <p>
          <strong>{t('reviews.yourReview')}</strong> ·{' '}
          {existing.status === 'pending'
            ? t('reviews.statusPending')
            : existing.status === 'approved'
              ? t('reviews.statusApproved')
              : t('reviews.statusRejected')}
        </p>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          {t('reviews.edit')}
        </Button>
      </div>
    );

  return (
    <form
      className={styles.form}
      onSubmit={onSubmit}
      noValidate
      aria-label={t('reviews.formLabel', { product: productName })}
    >
      <h3 className={styles.formTitle}>
        {existing ? t('reviews.editTitle') : t('reviews.writeTitle')}
      </h3>
      <p className={styles.muted}>{t('reviews.moderationNote')}</p>
      <fieldset
        className={styles.rating}
        aria-describedby={error?.field === 'rating' ? `${legendId}-error` : undefined}
      >
        <legend id={legendId}>{t('reviews.yourRating')}</legend>
        <div className={styles.ratingOptions}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={styles.ratingOption}>
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
              />
              <Star aria-hidden="true" fill={n <= rating ? 'currentColor' : 'none'} />
              <span className="visually-hidden">{t('reviews.starsOption', { count: n })}</span>
            </label>
          ))}
        </div>
        <p className={styles.muted} aria-live="polite">
          {rating > 0 ? t('reviews.ratedText', { rating }) : t('reviews.chooseRating')}
        </p>
        {error?.field === 'rating' && (
          <p id={`${legendId}-error`} className={styles.error} role="alert">
            {error.message}
          </p>
        )}
      </fieldset>
      <TextField
        label={t('reviews.titleLabel')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        error={error?.field === 'title' ? error.message : null}
      />
      <TextAreaField
        label={t('reviews.bodyLabel')}
        hint={t('reviews.bodyHint')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        required
        error={error?.field === 'body' ? error.message : null}
      />
      {allowImages && (
        <div className={styles.photoField}>
          <label className={styles.photoButton}>
            <ImagePlus aria-hidden="true" />
            {t('reviews.addPhoto')}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="visually-hidden"
              onChange={(e) => {
                setPhoto(e.target.files?.[0] ?? null);
                setKeepPhoto(false);
              }}
            />
          </label>
          {(photo || keepPhoto) && (
            <span className={styles.photoName}>
              {photo?.name ?? t('reviews.currentPhoto')}
              <button
                type="button"
                className={styles.photoRemove}
                onClick={() => {
                  setPhoto(null);
                  setKeepPhoto(false);
                }}
              >
                <X aria-hidden="true" />
                <span className="visually-hidden">{t('reviews.removePhoto')}</span>
              </button>
            </span>
          )}
          <p className={styles.muted}>{t('reviews.photoHint')}</p>
          {error?.field === 'image' && (
            <p className={styles.error} role="alert">
              {error.message}
            </p>
          )}
        </div>
      )}
      {error?.field === 'form' && (
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={submit.isPending}>
          {existing ? t('reviews.update') : t('reviews.submit')}
        </Button>
        {existing && (
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
