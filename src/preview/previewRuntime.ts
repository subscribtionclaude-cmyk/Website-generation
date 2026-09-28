import type { QueryClient } from '@tanstack/react-query';
import type { AppConfig } from '@/config/env';
import type { PageSection } from '@/domain/content/types';
import { SETTINGS_QUERY_KEY } from '@/features/settings/context';
import { setStorageNamespace } from '@/lib/storage/localStore';
import type { AppRuntime } from '@/runtime/types';
import type { ContentRepository, SettingsRepository } from '@/repositories/types';
import {
  PREVIEW_READY,
  previewFocusSchema,
  previewStateSchema,
  type PreviewReadyMessage,
  type PreviewState,
} from './protocol';

/**
 * Site Editor preview frame. Renders the REAL storefront (same routes, section registry and
 * components) with two read overrides fed by the admin editor over same-origin postMessage:
 *  - content.listPageSections(page) → the editor's working layout for Home / Apple / Offers
 *  - settings.listPublishedSettings() → the editor's working design settings
 * Everything else (catalog, offers, cart…) is the normal runtime. Nothing here reads drafts from
 * the server: the frame only shows what an authorised editor sends it.
 *
 * kind 'sample': the demo engine in an isolated storage namespace, marked DEMO CONTENT. In live mode
 * it is refused unless the live `features.showDemoCatalog` setting is enabled.
 */
type Kind = 'draft' | 'sample';

function openerWindow(): Window | null {
  if (window.parent !== window) return window.parent;
  return window.opener instanceof Window ? window.opener : null;
}

function sameOrigin(target: Window | null) {
  if (!target) return false;
  try {
    return target.location.origin === window.location.origin;
  } catch {
    return false;
  }
}

function toPageSections(pageKey: string, layout: NonNullable<PreviewState['layouts']['home']>) {
  return layout
    .filter((s) => s.isVisible)
    .map((s, index): PageSection => ({
      id: s.key,
      pageKey,
      type: s.type,
      sortOrder: (index + 1) * 10,
      isVisible: true,
      props: s.props,
      design: s.design ?? {},
    }));
}

/** Wrap a repository instance, overriding one method (methods live on class prototypes). */
function override<T extends object, K extends keyof T>(target: T, key: K, fn: T[K]): T {
  return new Proxy(target, {
    get(obj, prop) {
      if (prop === key) return fn;
      const value = Reflect.get(obj, prop, obj) as unknown;
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(obj)
        : value;
    },
  });
}

function mountBanner(kind: Kind, sampleBlocked: boolean) {
  const banner = document.createElement('aside');
  banner.setAttribute('aria-label', 'Preview / معاينة');
  banner.dataset.previewBanner = kind;
  const parts =
    kind === 'sample' && !sampleBlocked
      ? [
          'DEMO CONTENT · محتوى تجريبي',
          'Sample store preview — not your live data · متجر تجريبي للمعاينة',
        ]
      : sampleBlocked
        ? ['Sample store is disabled in Live mode · المتجر التجريبي غير مفعّل في الوضع الفعلي']
        : ['Preview — not published · معاينة — غير منشورة'];
  const style = banner.style;
  style.display = 'flex';
  style.flexWrap = 'wrap';
  style.gap = '0.25rem 1rem';
  style.justifyContent = 'center';
  style.padding = '0.375rem 1rem';
  style.font = '600 0.8125rem/1.4 system-ui, sans-serif';
  style.background = kind === 'sample' ? '#8a5000' : '#1a4fb2';
  style.color = '#ffffff';
  style.textAlign = 'center';
  for (const text of parts) {
    const span = document.createElement('span');
    span.textContent = text;
    span.dir = 'auto';
    banner.appendChild(span);
  }
  document.body.prepend(banner);
}

/** Scroll to a section by its key (sections label themselves with `s-<key>-title`). */
function focusSection(key: string) {
  const heading = document.getElementById(`s-${key}-title`);
  const target = heading?.closest('section') ?? heading;
  if (!target) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  target.style.outline = '3px dashed #1a4fb2';
  target.style.outlineOffset = '4px';
  window.setTimeout(() => {
    target.style.outline = '';
    target.style.outlineOffset = '';
  }, 1600);
}

async function liveSampleAllowed(live: AppRuntime): Promise<boolean> {
  try {
    const records = await live.repositories.settings.listPublishedSettings();
    const features = records.find((r) => r.key === 'features')?.value as
      { showDemoCatalog?: unknown } | undefined;
    return features?.showDemoCatalog === true;
  } catch {
    return false;
  }
}

export async function createPreviewRuntime(config: AppConfig, kind: Kind): Promise<AppRuntime> {
  const parent = openerWindow();
  const trusted = sameOrigin(parent);
  let sampleBlocked = false;
  let base: AppRuntime | undefined;

  if (kind === 'sample' && config.dataMode === 'live') {
    base = await createBase(config);
    sampleBlocked = !(trusted && (await liveSampleAllowed(base)));
  }
  if (kind === 'sample' && !sampleBlocked && trusted) {
    // Demo engine, isolated from this browser's own demo / cart state.
    setStorageNamespace('sample');
    const { createDemoRuntime } = await import('@/runtime/demoRuntime');
    base = createDemoRuntime({ ...config, dataMode: 'demo' });
  } else if (kind === 'sample') {
    sampleBlocked = true;
    base ??= await createBase(config);
  } else {
    base = await createBase(config);
  }

  const state: PreviewState = { layouts: {}, settings: {} };
  let queryClient: QueryClient | null = null;

  const content: ContentRepository = override(
    base.repositories.content,
    'listPageSections',
    async (pageKey: string) => {
      const layout = state.layouts[pageKey as keyof PreviewState['layouts']];
      return layout
        ? toPageSections(pageKey, layout)
        : base.repositories.content.listPageSections(pageKey);
    },
  );
  const settings: SettingsRepository = override(
    base.repositories.settings,
    'listPublishedSettings',
    async () => {
      const records = await base.repositories.settings.listPublishedSettings();
      const merged = records.map((r) => {
        const draft = state.settings[r.key as keyof PreviewState['settings']];
        return draft ? { ...r, value: draft, version: r.version + 1 } : r;
      });
      for (const [key, value] of Object.entries(state.settings))
        if (value && !merged.some((r) => r.key === key))
          merged.push({ key, value, version: 1, updatedAt: null });
      return merged;
    },
  );

  if (trusted && parent) {
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== parent) return;
      const focus = previewFocusSchema.safeParse(event.data);
      if (focus.success) {
        focusSection(focus.data.key);
        return;
      }
      const parsed = previewStateSchema.safeParse(event.data);
      if (!parsed.success) return;
      state.layouts = parsed.data.layouts;
      state.settings = parsed.data.settings;
      if (!queryClient) return;
      void queryClient.invalidateQueries({ queryKey: ['public', 'sections'] });
      void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    });
    const ready: PreviewReadyMessage = {
      type: PREVIEW_READY,
      sample: kind === 'sample' && !sampleBlocked,
      sampleBlocked,
    };
    parent.postMessage(ready, window.location.origin);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => mountBanner(kind, sampleBlocked), {
      once: true,
    });
  else mountBanner(kind, sampleBlocked);

  return {
    ...base,
    repositories: { ...base.repositories, content, settings },
    attachQueryClient: (client) => {
      queryClient = client;
    },
  };
}

async function createBase(config: AppConfig): Promise<AppRuntime> {
  if (config.dataMode === 'demo') {
    const { createDemoRuntime } = await import('@/runtime/demoRuntime');
    return createDemoRuntime(config);
  }
  const { createLiveRuntime } = await import('@/runtime/liveRuntime');
  return createLiveRuntime(config);
}
