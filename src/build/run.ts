import { resolveAppConfig, type RawEnv } from '@/config/env';
import { generateSite, type GeneratedFile, type SiteReport } from './generateSite';
import { loadDemoSite, loadLiveSite } from './siteData';

/** Entry point for scripts/generate-site.mjs: resolve the deployment's config, load, generate. */
export async function run(
  env: RawEnv,
  template: string,
): Promise<{ files: GeneratedFile[]; report: SiteReport }> {
  const result = resolveAppConfig(env);
  if (!result.ok)
    throw new Error(
      `generate-site: invalid configuration\n  ${result.issues.map((i) => i.message).join('\n  ')}`,
    );
  const { config } = result;
  const site = config.dataMode === 'live' ? await loadLiveSite(config) : await loadDemoSite();
  return generateSite({ template, config, site });
}
