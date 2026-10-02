import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Button } from '@/components/ui/Button';
import { integrationSpec } from '@/domain/integrations/catalog';
import { buildAiInput } from '@/domain/integrations/services';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n } from '../../i18n/context';
import { useProblemText } from '../../ui/useAdminText';
import styles from '../../ui/adminUi.module.css';
import type { ProductDraft } from './productDraft';

/**
 * Optional AI help (Phase 09): Generate → Review → Edit → Approve → Publish. The suggestion only
 * fills the SEO description fields of this unsaved draft; saving the product is the approval.
 * Shown only when the AI integration is enabled and has a usable adapter (MOCK in demo).
 */
export function AiSeoSuggestion({
  draft,
  set,
}: {
  draft: ProductDraft;
  set: (update: (d: ProductDraft) => ProductDraft) => void;
}) {
  const { at } = useAdminI18n();
  const { mode, repositories } = useRuntime();
  const problemText = useProblemText();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{
    tone: 'success' | 'danger';
    text: string;
    mock?: boolean;
  } | null>(null);
  const features = useQuery({
    queryKey: ['admin', 'integration-features'],
    queryFn: () => repositories.integrations.features(),
    staleTime: 60_000,
  });
  const provider = features.data?.ai?.provider ?? null;
  const usable =
    provider !== null &&
    (mode === 'demo' ||
      integrationSpec('ai').providers.some(
        (p) => p.key === provider && p.adapter === 'implemented',
      ));
  if (!usable) return null;

  const specs = draft.specGroups.flatMap((g) =>
    g.items.filter((i) => i.visible).map((i) => ({ label: i.label, value: i.value })),
  );

  async function suggest() {
    setPending(true);
    setNotice(null);
    try {
      const out: { ar: string; en: string } = { ar: '', en: '' };
      let mock = false;
      for (const locale of ['ar', 'en'] as const) {
        const result = await repositories.integrations.suggestContent(
          buildAiInput('seo_description', locale, {
            name: draft.name[locale] || draft.name.ar,
            subtitle: draft.subtitle[locale] || draft.subtitle.ar || null,
            specs: specs
              .map((s) => ({
                label: s.label[locale] || s.label.ar,
                value: s.value[locale] || s.value.ar,
              }))
              .filter((s) => s.label && s.value),
          }),
        );
        if (!result.ok) {
          setNotice({ tone: 'danger', text: problemText(result.code) });
          return;
        }
        out[locale] = result.draft.slice(0, 170);
        mock = mock || result.mock;
      }
      set((d) => ({ ...d, seoDescription: out }));
      setNotice({ tone: 'success', text: at('integrationsAdmin.ai.placed'), mock });
    } catch {
      setNotice({ tone: 'danger', text: problemText('provider_error') });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.stack} data-testid="ai-suggestion">
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Sparkles aria-hidden="true" width={16} height={16} />}
          loading={pending}
          disabled={!draft.name.ar}
          onClick={() => void suggest()}
        >
          {pending ? at('integrationsAdmin.ai.suggesting') : at('integrationsAdmin.ai.suggest')}
        </Button>
      </div>
      <p className={styles.hint}>{at('integrationsAdmin.ai.hint')}</p>
      {notice && (
        <Alert tone={notice.tone} live>
          {notice.text}
          {notice.mock && <> {at('integrationsAdmin.ai.mock')}</>}
        </Alert>
      )}
    </div>
  );
}
