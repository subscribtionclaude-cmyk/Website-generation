import { useQuery } from '@tanstack/react-query';
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  FileSearch,
  FlaskConical,
  Globe,
  ListChecks,
  TriangleAlert,
} from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { resolveLocalized } from '@/domain/localized';
import { seoChecks, type SeoCheck, type SeoOverview } from '@/domain/seo/overview';
import { EDITABLE_PAGES, type EditablePage } from '@/domain/siteEditor/schemas';
import { useSettings } from '@/features/settings/context';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { DataTable } from '../../ui/DataTable';
import { PageHeader, Panel } from '../../ui/PageHeader';
import { QueryState } from '../../ui/QueryState';
import { useAdminRepo } from '../../ui/useAdminAction';
import styles from '../../ui/adminUi.module.css';
import seoStyles from './seo.module.css';
import { STOREFRONT_PATH } from '../siteEditor/editorState';
import { SeoPreview } from '../siteEditor/SeoPreview';

const LEVEL_ICON = {
  ok: <CircleCheck aria-hidden="true" />,
  warning: <TriangleAlert aria-hidden="true" />,
  error: <CircleAlert aria-hidden="true" />,
};
const LEVEL_TONE = { ok: 'success', warning: 'warning', error: 'danger' } as const;

/**
 * Admin → SEO: indexing status, per-page SEO, metadata gaps and demo/live separation. It reads
 * the existing `seo` / `page_seo` settings and the Phase 07 SEO preview — editing happens in
 * Settings → Search engines and in the Site Editor, so there is one SEO source of truth.
 */
export function AdminSeoPage() {
  const { at } = useAdminI18n();
  const repo = useAdminRepo();
  const overview = useQuery({
    queryKey: ['admin', 'seo-overview'],
    queryFn: () => repo.seoOverview(),
  });
  return (
    <>
      <PageHeader
        title={at('modules.seo.title')}
        subtitle={at('seoAdmin.subtitle')}
        actions={
          <>
            <Link
              to="/admin/settings/seo"
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            >
              {at('seoAdmin.editSettings')}
            </Link>
            <Link
              to="/admin/site-editor"
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            >
              {at('seoAdmin.openEditor')}
            </Link>
          </>
        }
      />
      <QueryState query={overview}>{(data) => <SeoOverviewPanels data={data} />}</QueryState>
    </>
  );
}

function checkText(at: ReturnType<typeof useAdminI18n>['at'], check: SeoCheck) {
  if (check.id === 'siteUrl' && check.level !== 'ok') return at('seoAdmin.check.siteUrlMissing');
  if (check.id === 'indexing' && check.level !== 'ok') return at('seoAdmin.check.indexingOff');
  return at(`seoAdmin.check.${check.id}` as AdminMessageKey, { count: check.count ?? 0 });
}

function NewTabLink({ to, children }: { to: string; children: string }) {
  const { at } = useAdminI18n();
  return (
    <Link to={to} target="_blank" rel="noopener" reloadDocument className={seoStyles.newTab}>
      {children}
      <ExternalLink aria-hidden="true" width={14} height={14} />
      <span className="visually-hidden"> {at('seoAdmin.opensNewTab')}</span>
    </Link>
  );
}

function SeoOverviewPanels({ data }: { data: SeoOverview }) {
  const { at } = useAdminI18n();
  const { locale, format } = useI18n();
  const { mode, config } = useRuntime();
  const checks = seoChecks(data, { mode, siteUrl: config.siteUrl });
  const kinds = [
    ['products', data.products.published, data.products],
    ['entries', data.entries.published, data.entries],
    ['offers', data.offers.published, data.offers],
    ['categories', data.categories.visible, data.categories],
    ['brands', data.brands.visible, data.brands],
  ] as const;
  const n = (v: number | undefined) => (v === undefined ? '—' : format.number(v));

  return (
    <div className={styles.stack}>
      <Panel title={at('seoAdmin.status')} icon={<Globe aria-hidden="true" />}>
        <ul className={seoStyles.list} data-testid="seo-checks">
          {checks.map((c) => (
            <li key={c.id}>
              <Badge tone={LEVEL_TONE[c.level]}>
                {LEVEL_ICON[c.level]} {at(`seoAdmin.level.${c.level}`)}
              </Badge>
              <span className={seoStyles.grow}>{checkText(at, c)}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={at('seoAdmin.files')} icon={<FileSearch aria-hidden="true" />}>
        <p className={styles.small}>{at('seoAdmin.filesHint')}</p>
        <ul className={seoStyles.list}>
          <li>
            <NewTabLink to="/sitemap.xml">{at('seoAdmin.sitemap')}</NewTabLink>
          </li>
          <li>
            <NewTabLink to="/robots.txt">{at('seoAdmin.robots')}</NewTabLink>
          </li>
        </ul>
      </Panel>

      <PageSeoPanel pageSeo={data.pageSeo} />

      <Panel title={at('seoAdmin.content')} icon={<ListChecks aria-hidden="true" />}>
        <p className={styles.small}>{at('seoAdmin.contentHint')}</p>
        <DataTable
          caption={at('seoAdmin.content')}
          rows={[...kinds]}
          rowKey={([k]) => k}
          columns={[
            {
              id: 'kind',
              header: at('seoAdmin.kind'),
              rowHeader: true,
              cell: ([k]) => at(`seoAdmin.kinds.${k}`),
            },
            {
              id: 'published',
              header: at('seoAdmin.published'),
              className: styles.num,
              cell: ([, total]) => n(total),
            },
            {
              id: 'title',
              header: at('seoAdmin.missingTitle'),
              className: styles.num,
              cell: ([, , s]) => n('missingTitle' in s ? s.missingTitle : undefined),
            },
            {
              id: 'description',
              header: at('seoAdmin.missingDescription'),
              className: styles.num,
              cell: ([, , s]) => n(s.missingDescription),
            },
            {
              id: 'image',
              header: at('seoAdmin.missingImage'),
              className: styles.num,
              cell: ([, , s]) => n('missingImage' in s ? s.missingImage : undefined),
            },
          ]}
        />
        <h3 className={styles.panelTitle}>{at('seoAdmin.missingList')}</h3>
        {data.missing.length === 0 ? (
          <p className={styles.muted}>{at('seoAdmin.missingNone')}</p>
        ) : (
          <ul className={seoStyles.list} data-testid="seo-missing">
            {data.missing.map((m) => (
              <li key={`${m.kind}-${m.id}`}>
                <Badge tone="neutral">{at(`seoAdmin.${m.kind}`)}</Badge>
                <Link
                  className={seoStyles.grow}
                  to={m.kind === 'product' ? `/admin/products/${m.id}` : `/admin/news/${m.id}`}
                >
                  {resolveLocalized(m.name, locale)}
                </Link>
                <NewTabLink to={m.kind === 'product' ? `/product/${m.slug}` : `/news/${m.slug}`}>
                  {at('seoAdmin.view')}
                </NewTabLink>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={at('seoAdmin.demo')} icon={<FlaskConical aria-hidden="true" />}>
        <Alert tone="info">{at('seoAdmin.demoHint')}</Alert>
        <p className={styles.small}>
          {at('seoAdmin.demoCounts', {
            products: format.number(data.demoPublished.products),
            offers: format.number(data.demoPublished.offers),
            entries: format.number(data.demoPublished.entries),
          })}
        </p>
      </Panel>
    </div>
  );
}

interface PageOverride {
  title?: unknown;
  description?: unknown;
  ogImage?: unknown;
}

/** Home / Apple / Offers: what the Site Editor overrides, plus the shared SEO preview. */
function PageSeoPanel({ pageSeo }: { pageSeo: SeoOverview['pageSeo'] }) {
  const { at } = useAdminI18n();
  const { seo, page_seo: publishedPageSeo } = useSettings();
  const { repositories } = useRuntime();
  const name = useId();
  const [page, setPage] = useState<EditablePage>('home');
  const sections = useQuery({
    queryKey: ['seo-preview-sections', page],
    queryFn: () => repositories.content.listPageSections(page),
  });
  const layout = (sections.data ?? []).map((s) => ({
    key: s.id,
    type: s.type,
    isVisible: s.isVisible,
    props: s.props as Record<string, unknown>,
  }));
  const pages = pageSeo ?? publishedPageSeo.pages;
  const set = (v: unknown) =>
    v ? <Badge tone="brand">{at('seoAdmin.yes')}</Badge> : <Badge>{at('seoAdmin.no')}</Badge>;
  const settings = { seo, page_seo: publishedPageSeo };
  return (
    <Panel title={at('seoAdmin.pages')} icon={<Globe aria-hidden="true" />}>
      <p className={styles.small}>{at('seoAdmin.pagesHint')}</p>
      <DataTable
        caption={at('seoAdmin.pages')}
        rows={[...EDITABLE_PAGES]}
        rowKey={(p) => p}
        columns={[
          {
            id: 'page',
            header: at('seoAdmin.page'),
            rowHeader: true,
            cell: (p) => at(`sectionsAdmin.page.${p}` as AdminMessageKey),
          },
          {
            id: 'title',
            header: at('seoAdmin.customTitle'),
            cell: (p) => set((pages[p] as PageOverride | undefined)?.title),
          },
          {
            id: 'description',
            header: at('seoAdmin.customDescription'),
            cell: (p) => set((pages[p] as PageOverride | undefined)?.description),
          },
          {
            id: 'image',
            header: at('seoAdmin.shareImage'),
            cell: (p) => set((pages[p] as PageOverride | undefined)?.ogImage),
          },
          {
            id: 'actions',
            header: <span className="visually-hidden">{at('seoAdmin.view')}</span>,
            cell: (p) => <NewTabLink to={STOREFRONT_PATH[p]}>{at('seoAdmin.view')}</NewTabLink>,
          },
        ]}
      />
      <fieldset className={styles.group}>
        <legend>{at('seoAdmin.previewFor')}</legend>
        <div className={styles.chips}>
          {EDITABLE_PAGES.map((p) => (
            <label key={p} className={styles.check}>
              <input
                type="radio"
                name={`${name}-page`}
                checked={page === p}
                onChange={() => setPage(p)}
              />
              {at(`sectionsAdmin.page.${p}` as AdminMessageKey)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className={seoStyles.preview}>
        <SeoPreview
          page={page}
          working={settings}
          workingLayout={layout}
          published={settings}
          publishedLayout={layout}
        />
      </div>
    </Panel>
  );
}
