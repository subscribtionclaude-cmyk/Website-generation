import type { PublicContentInput } from '@/domain/integrations/adapters';
import {
  DemoIntegrationsForbidden,
  type DemoIntegrationsActor,
  type SaveIntegrationInput,
} from '@/domain/integrations/demoIntegrations';
import type { DemoAuthService } from '@/services/auth/demoAuthService';
import type { IntegrationsRepository } from '../integrationsTypes';
import { RepositoryError } from '../supabase/errors';
import { actorOf, type DemoCommerceStore } from './demoCommerce';

const delay = (ms = 140) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * DEMO MODE ONLY — IntegrationsRepository over the in-browser engine. Every provider is a MOCK:
 * nothing leaves this browser, and results are labelled DEMO / MOCK in the admin.
 */
export class DemoIntegrationsRepository implements IntegrationsRepository {
  readonly mode = 'demo' as const;
  private readonly store: DemoCommerceStore;
  private readonly auth: DemoAuthService;

  constructor(store: DemoCommerceStore, auth: DemoAuthService) {
    this.store = store;
    this.auth = auth;
  }

  private get engine() {
    return this.store.integrations;
  }

  private async run<T>(fn: (actor: DemoIntegrationsActor) => T | Promise<T>, ms = 140): Promise<T> {
    await delay(ms);
    const actor = await actorOf(this.auth, this.store);
    try {
      return await fn(actor);
    } catch (error) {
      if (error instanceof DemoIntegrationsForbidden)
        throw new RepositoryError('forbidden', error, 'forbidden');
      throw error;
    }
  }

  overview() {
    return this.run((a) => this.engine.overview(a));
  }
  save(input: SaveIntegrationInput) {
    return this.run((a) => this.engine.save(a, input), 220);
  }
  setEnabled(key: string, enabled: boolean, reason: string | null) {
    return this.run((a) => this.engine.setEnabled(a, key, enabled, reason));
  }
  remove(key: string) {
    return this.run((a) => this.engine.remove(a, key));
  }
  testConnection(key: string) {
    return this.run((a) => this.engine.test(a, key), 420);
  }
  checks(key: string, limit = 20) {
    return this.run((a) => this.engine.checks(a, key, limit), 80);
  }
  async startSync(key: string, domain: string, dryRun: boolean, idempotencyKey: string) {
    const result = await this.run(
      (a) => this.engine.startSync(a, key, domain, dryRun, idempotencyKey),
      480,
    );
    return result.ok ? { ok: true as const, jobId: result.jobId, job: result.job } : result;
  }
  cancelSync(jobId: string) {
    return this.run((a) => this.engine.cancelSync(a, jobId));
  }
  syncJobs(key: string, limit = 20) {
    return this.run((a) => this.engine.jobs(a, key, limit), 80);
  }
  syncJob(jobId: string) {
    return this.run((a) => this.engine.job(a, jobId), 80);
  }
  deliveries() {
    return this.run((a) => this.engine.deliveries(a), 80);
  }
  retryDelivery() {
    return this.run((a) => this.engine.retryDelivery(a));
  }
  dispatch(channel: string) {
    return this.run((a) => this.engine.dispatch(a, channel));
  }
  webhookEvents() {
    return this.run((a) => this.engine.webhookEvents(a), 80);
  }
  features() {
    return this.run((a) => this.engine.features(a), 60);
  }
  async storefront() {
    return this.engine.storefront();
  }
  suggestContent(input: PublicContentInput) {
    return this.run((a) => this.engine.suggest(a, input), 600);
  }
}
