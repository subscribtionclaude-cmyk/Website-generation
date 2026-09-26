import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, FlaskConical, MessageCircle, SearchX } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { Skeleton } from '@/components/feedback/Skeleton';
import { StateMessage } from '@/components/feedback/StateMessage';
import { ButtonLink } from '@/components/navigation/ButtonLink';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/TextField';
import { resolveLocalized } from '@/domain/localized';
import { limitsFromSettings } from '@/domain/services/media';
import type { ServiceEvent, ServiceOffer, ServiceRequestDetail } from '@/domain/services/types';
import { useSession } from '@/features/auth/context';
import { useSettings } from '@/features/settings/context';
import { usePageMeta } from '@/features/seo/usePageMeta';
import { useI18n, type CoreMessageKey } from '@/i18n/context';
import { isolate } from '@/i18n/translator';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { useRuntime } from '@/runtime/context';
import { MediaUploader } from './MediaUploader';
import { uploadsToMedia, type UploadItem } from './serviceHelpers';
import { KIND_LABEL, PROBLEM_MESSAGE, statusLabelKey } from './serviceLabels';
import { ProgressTrack, StatusPill } from './ServiceParts';
import { MediaGallery, RequestSummary } from './ServiceDetailParts';
import styles from './services.module.css';

const OFFER_TITLE: Record<ServiceOffer['kind'], CoreMessageKey> = {
  repair_estimate: 'requestDetail.offerEstimate',
  repair_final: 'requestDetail.offerFinal',
  trade_in: 'requestDetail.offerTradeIn',
  used_proposal: 'requestDetail.offerUsed',
};

export function RequestDetailPage() {
  const { number = '' } = useParams();
  const { t } = useI18n();
  const { repositories } = useRuntime();
  const session = useSession();
  const uid = session?.userId ?? null;
  usePageMeta({ title: t('requestDetail.title', { number }), noIndex: true });
  const detail = useQuery({
    queryKey: ['service-request', uid, number],
    queryFn: () => repositories.services.getMine(number),
  });
  if (detail.isPending) return <Skeleton height="420px" />;
  if (detail.isError)
    return (
      <p className={styles.note} role="alert">
        <CircleAlert aria-hidden="true" />
        {t('account.loadError')}
      </p>
    );
  if (!detail.data)
    return (
      <StateMessage
        headingLevel={1}
        icon={<SearchX />}
        title={t('requestDetail.notFound')}
        body={t('requestDetail.notFoundBody')}
        actions={
          <ButtonLink to="/account/requests" variant="secondary">
            {t('requestDetail.backToRequests')}
          </ButtonLink>
        }
      />
    );
  return <Detail request={detail.data} />;
}

function Detail({ request }: { request: ServiceRequestDetail }) {
  const { t, locale, format } = useI18n();
  const settings = useSettings();
  const { repositories } = useRuntime();
  const session = useSession();
  const queryClient = useQueryClient();
  const uid = session?.userId ?? null;
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = (next?: ServiceRequestDetail) => {
    if (next) queryClient.setQueryData(['service-request', uid, request.number], next);
    void queryClient.invalidateQueries({ queryKey: ['service-requests', uid] });
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread', uid] });
  };
  const handle = (
    result: { ok: true; request: ServiceRequestDetail } | { ok: false; code: string },
    done: CoreMessageKey,
  ) => {
    if (!result.ok) {
      setError(t(PROBLEM_MESSAGE[result.code] ?? 'services.errorGeneric'));
      return;
    }
    setError(null);
    setMessage(t(done));
    refresh(result.request);
  };
  const cancel = useMutation({
    mutationFn: () => repositories.services.cancel(request.number, null),
    onSuccess: (r) => handle(r, 'requestDetail.cancelled'),
    onError: () => setError(t('services.errorNetwork')),
  });
  const respondOffer = useMutation({
    mutationFn: (v: { offerId: string; decision: 'accept' | 'decline' }) =>
      repositories.services.respondOffer(v.offerId, v.decision, null),
    onSuccess: (r, v) =>
      handle(r, v.decision === 'accept' ? 'requestDetail.accepted' : 'requestDetail.declined'),
    onError: () => setError(t('services.errorNetwork')),
  });

  const title = resolveLocalized(request.title, locale);
  const kind = t(KIND_LABEL[request.kind]);
  const whatsapp = buildWhatsAppLink(
    settings.store.whatsappNumber,
    t('requestDetail.whatsappMessage', { kind, number: request.number, device: title }),
  );
  const openOffer = request.offers.find((o) => o.status === 'sent') ?? null;
  const pastOffers = request.offers.filter((o) => o.status !== 'sent');

  return (
    <div className={styles.fields}>
      <header className={styles.formHead}>
        <p className={styles.eyebrow} style={{ color: 'var(--color-brand-text)' }}>
          {kind}
        </p>
        <h1 className={styles.formTitle}>
          <bdi dir="ltr">{request.number}</bdi>
        </h1>
        <p className={styles.lead}>{title}</p>
        <div className={styles.heroActions}>
          <StatusPill status={request.status} awaiting={request.awaitingCustomer} />
          <span className={styles.muted}>
            {t('requests.requestedOn', { date: format.date(request.createdAt) })}
          </span>
          {request.isDemo && (
            <span className={styles.pill}>
              <FlaskConical aria-hidden="true" />
              {t('catalog.demo')}
            </span>
          )}
        </div>
        <ProgressTrack kind={request.kind} status={request.status} />
      </header>

      <p className="visually-hidden" role="status">
        {message}
      </p>
      {error && (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      )}

      {openOffer && (
        <OfferCard
          offer={openOffer}
          request={request}
          busy={respondOffer.isPending}
          onRespond={(decision) => respondOffer.mutate({ offerId: openOffer.id, decision })}
        />
      )}
      {request.awaitingCustomer && (
        <RespondForm
          request={request}
          onDone={(r) => handle({ ok: true, request: r }, 'requestDetail.replied')}
        />
      )}

      <section className={styles.panel} aria-labelledby="req-summary">
        <h2 id="req-summary" className={styles.panelTitle}>
          {t('requestDetail.summary')}
        </h2>
        <RequestSummary request={request} />
        <MediaGallery items={request.media} />
      </section>

      {pastOffers.length > 0 && (
        <section className={styles.panel} aria-labelledby="req-offers">
          <h2 id="req-offers" className={styles.panelTitle}>
            {t('requestDetail.pastOffers')}
          </h2>
          <ul className={styles.timeline}>
            {pastOffers.map((o) => (
              <li key={o.id}>
                <strong>{t(OFFER_TITLE[o.kind])}</strong>
                <span className={styles.money}>
                  {o.kind === 'trade_in'
                    ? t('requestDetail.valuationShort', { value: format.money(o.deviceValue ?? 0) })
                    : format.money(o.amount ?? 0)}
                </span>
                <span className={styles.timelineMeta}>
                  {t(`requestDetail.offer_${o.status}` as CoreMessageKey)} ·{' '}
                  {format.date(o.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.panel} aria-labelledby="req-timeline">
        <h2 id="req-timeline" className={styles.panelTitle}>
          {t('requestDetail.timeline')}
        </h2>
        <ol className={styles.timeline}>
          {[...request.events].reverse().map((event) => (
            <TimelineItem key={event.id} event={event} />
          ))}
        </ol>
      </section>

      <div className={styles.actions}>
        {whatsapp.status === 'ok' ? (
          <a
            className={styles.linkButton}
            href={whatsapp.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle aria-hidden="true" width={18} />
            {t('requestDetail.whatsapp')}
          </a>
        ) : (
          <p className={styles.hint}>{t('requestDetail.whatsappUnavailable')}</p>
        )}
        {request.canCancel && (
          <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('requestDetail.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}

function OfferCard({
  offer,
  request,
  busy,
  onRespond,
}: {
  offer: ServiceOffer;
  request: ServiceRequestDetail;
  busy: boolean;
  onRespond: (decision: 'accept' | 'decline') => void;
}) {
  const { t, locale, format } = useI18n();
  const target = offer.target;
  const targetName = target?.name
    ? resolveLocalized(target.name, locale)
    : [target?.brand, target?.model].filter((x) => typeof x === 'string').join(' ');
  return (
    <section className={styles.offerCard} aria-labelledby="offer-title">
      <h2 id="offer-title" className={styles.offerTitle}>
        {t(OFFER_TITLE[offer.kind])}
      </h2>
      {offer.kind === 'trade_in' ? (
        <dl className={styles.summary}>
          <div>
            <dt>{t('requestDetail.currentDeviceValue')}</dt>
            <dd className={styles.money}>{format.money(offer.deviceValue ?? 0)}</dd>
          </div>
          <div>
            <dt>{t('requestDetail.targetDevice')}</dt>
            <dd>
              {[
                targetName,
                target?.variantLabel ? resolveLocalized(target.variantLabel, locale) : '',
              ]
                .filter(Boolean)
                .map((x) => isolate(x))
                .join(' · ')}
            </dd>
          </div>
          <div>
            <dt>{t('requestDetail.targetPrice')}</dt>
            <dd className={styles.money}>{format.money(offer.targetPrice ?? 0)}</dd>
          </div>
          <div>
            <dt>
              {(offer.difference ?? 0) >= 0
                ? t('requestDetail.differenceToPay')
                : t('requestDetail.differenceToYou')}
            </dt>
            <dd className={styles.bigMoney}>{format.money(Math.abs(offer.difference ?? 0))}</dd>
          </div>
        </dl>
      ) : offer.kind === 'used_proposal' && offer.device ? (
        <>
          <dl className={styles.summary}>
            <div>
              <dt>{t('services.device')}</dt>
              <dd>
                {[offer.device.brand, offer.device.model, offer.device.storage, offer.device.color]
                  .filter(Boolean)
                  .map((x) => isolate(String(x)))
                  .join(' · ')}
              </dd>
            </div>
            {offer.device.batteryHealth !== null && (
              <div>
                <dt>{t('tradeIn.batteryHealth')}</dt>
                <dd>{format.number(offer.device.batteryHealth)}%</dd>
              </div>
            )}
            {offer.device.condition && (
              <div>
                <dt>{t('requestDetail.condition')}</dt>
                <dd>{offer.device.condition}</dd>
              </div>
            )}
            <div>
              <dt>{t('requestDetail.taxStatus')}</dt>
              <dd>{t(`requestDetail.tax_${offer.device.taxStatus}` as CoreMessageKey)}</dd>
            </div>
            <div>
              <dt>{t('requestDetail.price')}</dt>
              <dd className={styles.bigMoney}>{format.money(offer.amount ?? 0)}</dd>
            </div>
          </dl>
          <MediaGallery items={offer.media} />
        </>
      ) : (
        <p className={styles.bigMoney}>{format.money(offer.amount ?? 0)}</p>
      )}
      {offer.note && <p>{offer.note}</p>}
      {offer.inspectionNote && (
        <p className={styles.hint}>
          {t('requestDetail.inspection')}: {offer.inspectionNote}
        </p>
      )}
      {offer.kind === 'trade_in' && <p className={styles.hint}>{t('tradeIn.valuationNote')}</p>}
      {offer.kind.startsWith('repair') && (
        <p className={styles.hint}>{t('requestDetail.repairQuoteNote')}</p>
      )}
      {offer.expiresAt && (
        <p className={styles.hint}>
          {offer.expired
            ? t('requestDetail.offerExpired')
            : t('requestDetail.offerValidUntil', { date: format.dateTime(offer.expiresAt) })}
        </p>
      )}
      {!offer.expired && request.status !== 'cancelled' && (
        <div className={styles.heroActions}>
          <Button variant="accent" loading={busy} onClick={() => onRespond('accept')}>
            {offer.kind === 'used_proposal'
              ? t('requestDetail.interested')
              : t('requestDetail.accept')}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => onRespond('decline')}>
            {offer.kind === 'used_proposal'
              ? t('requestDetail.notInterested')
              : t('requestDetail.decline')}
          </Button>
        </div>
      )}
    </section>
  );
}

function RespondForm({
  request,
  onDone,
}: {
  request: ServiceRequestDetail;
  onDone: (request: ServiceRequestDetail) => void;
}) {
  const { t } = useI18n();
  const settings = useSettings();
  const { repositories } = useRuntime();
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const media = settings.services.media;
  const lastAsk = [...request.events].reverse().find((e) => e.type === 'info_requested');
  const send = useMutation({
    mutationFn: () =>
      repositories.services.respond(request.number, text.trim() || null, uploadsToMedia(uploads)),
    onSuccess: (result) => {
      if (!result.ok) {
        setError(t(PROBLEM_MESSAGE[result.code] ?? 'services.errorGeneric'));
        return;
      }
      setText('');
      setUploads([]);
      onDone(result.request);
    },
    onError: () => setError(t('services.errorNetwork')),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() && uploadsToMedia(uploads).length === 0) {
      setError(t('services.errorMessage'));
      return;
    }
    send.mutate();
  };
  return (
    <form className={styles.offerCard} onSubmit={submit} noValidate aria-labelledby="respond-title">
      <h2 id="respond-title" className={styles.offerTitle}>
        {t('requestDetail.infoNeeded')}
      </h2>
      {lastAsk?.message && <p>{lastAsk.message}</p>}
      <TextAreaField
        label={t('requestDetail.yourReply')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        error={error}
      />
      {request.kind !== 'used' && (
        <MediaUploader
          value={uploads}
          onChange={(fn) => setUploads(fn)}
          limits={limitsFromSettings({
            ...media,
            maxFiles: Math.max(1, media.maxFiles - request.media.length),
          })}
          imageMaxDimension={media.imageMaxDimension}
          imageQuality={media.imageQuality}
          allowVideo
          upload={(file, mime) => repositories.services.upload(request.kind, file, mime)}
          discard={(u) => repositories.services.discardUpload(u)}
        />
      )}
      <div>
        <Button type="submit" variant="primary" loading={send.isPending}>
          {t('requestDetail.sendReply')}
        </Button>
      </div>
    </form>
  );
}

function TimelineItem({ event }: { event: ServiceEvent }) {
  const { t, format } = useI18n();
  const decision = event.data.decision as string | undefined;
  const text: string =
    event.type === 'created'
      ? t('requestDetail.evCreated')
      : event.type === 'status'
        ? t('requestDetail.evStatus', { status: t(statusLabelKey(event.status ?? '')) })
        : event.type === 'update'
          ? t('requestDetail.evUpdate')
          : event.type === 'info_requested'
            ? t('requestDetail.evInfo')
            : event.type === 'customer_response'
              ? t('requestDetail.evReply')
              : event.type === 'offer'
                ? t('requestDetail.evOffer')
                : event.type === 'offer_response'
                  ? decision === 'accept'
                    ? t('requestDetail.evAccepted')
                    : t('requestDetail.evDeclined')
                  : t('requestDetail.evUpdate');
  return (
    <li>
      <strong>{text}</strong>
      {event.message && <p dir="auto">{event.message}</p>}
      <time dateTime={event.createdAt}>{format.dateTime(event.createdAt)}</time>
    </li>
  );
}
