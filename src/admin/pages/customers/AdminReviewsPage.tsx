import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CircleCheck, CircleX, FlaskConical } from 'lucide-react';
import { useId, useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { ReviewStatus, StaffReview } from '@/domain/customer/types';
import { resolveLocalized } from '@/domain/localized';
import { useSession } from '@/features/auth/context';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { useAdminPageMeta } from '../../useAdminPageMeta';
import adminStyles from '../../admin.module.css';
import orderStyles from '../orders/orders.module.css';
import styles from './customers.module.css';

const STATUS_LABEL: Record<ReviewStatus, AdminMessageKey> = {
  pending: 'reviewsAdmin.pending',
  approved: 'reviewsAdmin.approved',
  rejected: 'reviewsAdmin.rejected',
};

/** Verified-buyer review moderation. Decisions are permission-checked, audited and never self-applied. */
export function AdminReviewsPage() {
  const { at } = useAdminI18n();
  const { t } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  useAdminPageMeta(at('reviewsAdmin.title'));
  const [status, setStatus] = useState<ReviewStatus | ''>('pending');

  const list = useQuery({
    queryKey: ['admin-reviews', session?.userId ?? null, status],
    queryFn: () => repositories.customerOps.listReviews(status || null),
  });
  const paths = (list.data?.items ?? []).flatMap((r) => (r.imagePath ? [r.imagePath] : []));
  const images = useQuery({
    queryKey: ['admin-review-images', session?.userId ?? null, paths],
    queryFn: () => repositories.reviews.imageUrls(paths),
    enabled: paths.length > 0,
  });

  return (
    <>
      <div className={adminStyles.pageHead}>
        <h1 className={adminStyles.pageTitle}>{at('reviewsAdmin.title')}</h1>
        <p className={adminStyles.pageSubtitle}>{at('reviewsAdmin.subtitle')}</p>
      </div>
      <div className={adminStyles.stack}>
        <div className={orderStyles.filters}>
          <div className={orderStyles.field}>
            <label className={adminStyles.label} htmlFor="reviews-status">
              {at('reviewsAdmin.filter')}
            </label>
            <select
              id="reviews-status"
              className={adminStyles.select}
              value={status}
              onChange={(e) => setStatus(e.target.value as ReviewStatus | '')}
            >
              <option value="">{at('reviewsAdmin.all')}</option>
              {(['pending', 'approved', 'rejected'] as const).map((s) => (
                <option key={s} value={s}>
                  {at(STATUS_LABEL[s])}
                </option>
              ))}
            </select>
          </div>
        </div>

        {list.isPending && <Skeleton height="16rem" radius="var(--radius-lg)" />}
        {list.isError && (
          <Alert
            tone="danger"
            live
            action={
              <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
                {t('common.retry')}
              </Button>
            }
          >
            {at('errors.loadFailed')}
          </Alert>
        )}
        {list.data && list.data.items.length === 0 && (
          <Alert tone="info">{at('reviewsAdmin.empty')}</Alert>
        )}
        {list.data && list.data.items.length > 0 && (
          <>
            <p className={adminStyles.muted}>
              {at('reviewsAdmin.count', { count: list.data.total })}
            </p>
            <ul className={styles.list}>
              {list.data.items.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  imageUrl={review.imagePath ? images.data?.[review.imagePath] : undefined}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function ReviewCard({ review, imageUrl }: { review: StaffReview; imageUrl: string | undefined }) {
  const { at } = useAdminI18n();
  const { format, locale } = useI18n();
  const { repositories } = useRuntime();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [note, setNote] = useState(review.moderationNote ?? '');
  const [message, setMessage] = useState<{
    tone: 'success' | 'danger';
    key: AdminMessageKey;
  } | null>(null);
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      repositories.customerOps.moderateReview(review.id, decision, note.trim() || null),
    onSuccess: (result, decision) => {
      if (!result.ok) {
        setMessage({
          tone: 'danger',
          key: result.code === 'own_review' ? 'reviewsAdmin.ownReview' : 'reviewsAdmin.failed',
        });
        return;
      }
      setMessage({
        tone: 'success',
        key: decision === 'approved' ? 'reviewsAdmin.approvedDone' : 'reviewsAdmin.rejectedDone',
      });
      void queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
    },
    onError: () => setMessage({ tone: 'danger', key: 'reviewsAdmin.failed' }),
  });
  const productName = resolveLocalized(review.product.name, locale);
  const tone =
    review.status === 'approved' ? 'success' : review.status === 'pending' ? 'warning' : 'neutral';

  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.productName}>
          <bdi>{productName}</bdi>
        </span>
        <Badge tone={tone}>{at(STATUS_LABEL[review.status])}</Badge>
        {review.verifiedBuyer && (
          <Badge tone="success" icon={<BadgeCheck aria-hidden="true" />}>
            {at('reviewsAdmin.verified')}
          </Badge>
        )}
        {review.isDemo && (
          <Badge icon={<FlaskConical aria-hidden="true" />}>{at('reviewsAdmin.demo')}</Badge>
        )}
      </div>
      <div className={styles.meta}>
        <span>
          {at('reviewsAdmin.rating')}: {at('reviewsAdmin.ratingValue', { rating: review.rating })}
        </span>
        <span>{review.authorName}</span>
        {review.orderNumber && (
          <span>
            {at('reviewsAdmin.order')}: <bdi dir="ltr">{review.orderNumber}</bdi>
          </span>
        )}
        <time dateTime={review.updatedAt}>{format.dateTime(review.updatedAt)}</time>
        {review.moderatedAt && (
          <span>{at('reviewsAdmin.moderated', { date: format.dateTime(review.moderatedAt) })}</span>
        )}
      </div>
      {review.title && <strong dir="auto">{review.title}</strong>}
      <p className={styles.body} dir="auto">
        {review.body}
      </p>
      {imageUrl && (
        <img
          className={styles.photo}
          src={imageUrl}
          alt={at('reviewsAdmin.photo')}
          loading="lazy"
        />
      )}
      <div className={orderStyles.field}>
        <label className={adminStyles.label} htmlFor={noteId}>
          {at('reviewsAdmin.note')}
        </label>
        <input
          id={noteId}
          className={styles.noteInput}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className={orderStyles.buttons}>
        {review.status !== 'approved' && (
          <Button
            variant="primary"
            size="sm"
            icon={<CircleCheck aria-hidden="true" />}
            loading={decide.isPending && decide.variables === 'approved'}
            disabled={decide.isPending}
            onClick={() => decide.mutate('approved')}
          >
            {at('reviewsAdmin.approve')}
          </Button>
        )}
        {review.status !== 'rejected' && (
          <Button
            variant="secondary"
            size="sm"
            icon={<CircleX aria-hidden="true" />}
            loading={decide.isPending && decide.variables === 'rejected'}
            disabled={decide.isPending}
            onClick={() => decide.mutate('rejected')}
          >
            {at('reviewsAdmin.reject')}
          </Button>
        )}
      </div>
      {message && (
        <Alert tone={message.tone} live>
          {at(message.key)}
        </Alert>
      )}
    </li>
  );
}
