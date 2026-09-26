import type {
  AddressInput,
  NotificationChannel,
  RequestClaim,
  ReviewInput,
} from '@/domain/customer/types';
import type { DemoAuthService } from '@/services/auth/demoAuthService';
import { RepositoryError } from '../supabase/errors';
import type {
  AccountRepository,
  CustomerOperationsRepository,
  CustomerRequestsRepository,
  NotificationsRepository,
  RecentlyViewedRepository,
  ReviewsRepository,
  StockAlertRequest,
  WaitlistRequest,
  WishlistRepository,
} from '../types';
import { actorOf, guard, type DemoCommerceStore } from './demoCommerce';

/**
 * DEMO MODE adapters for the Phase 04 customer ports. They delegate to the in-browser DemoCustomer
 * engine (same rules as the SQL RPCs); nothing leaves this browser.
 */
const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

async function requireUser(auth: DemoAuthService): Promise<string> {
  const session = await auth.getSession();
  if (!session) throw new RepositoryError('authentication required', null, 'forbidden');
  return session.userId;
}

abstract class DemoCustomerBase {
  protected readonly store: DemoCommerceStore;
  protected readonly auth: DemoAuthService;

  constructor(store: DemoCommerceStore, auth: DemoAuthService) {
    this.store = store;
    this.auth = auth;
  }

  protected get customer() {
    return this.store.customer;
  }

  protected async user(ms = 120) {
    await delay(ms);
    return requireUser(this.auth);
  }
}

export class DemoAccountRepository extends DemoCustomerBase implements AccountRepository {
  async listAddresses() {
    return this.customer.listAddresses(await this.user());
  }
  async saveAddress(input: AddressInput) {
    return this.customer.saveAddress(await this.user(200), input);
  }
  async deleteAddress(id: string) {
    return this.customer.deleteAddress(await this.user(200), id);
  }
  async getCartStatus() {
    return this.customer.cartStatus(await this.user(80));
  }
}

export class DemoWishlistRepository extends DemoCustomerBase implements WishlistRepository {
  async get() {
    return this.customer.wishlist(await this.user());
  }
  async set(productId: string, variantId: string | null, saved: boolean) {
    return this.customer.setWishlist(await this.user(80), productId, variantId, saved);
  }
  async merge(items: Parameters<WishlistRepository['merge']>[0]) {
    return this.customer.mergeWishlist(await this.user(150), items);
  }
}

export class DemoRecentlyViewedRepository
  extends DemoCustomerBase
  implements RecentlyViewedRepository
{
  async track(productId: string, variantId: string | null) {
    this.customer.trackRecent(await this.user(40), productId, variantId);
  }
  async merge(items: Parameters<RecentlyViewedRepository['merge']>[0]) {
    this.customer.mergeRecent(await this.user(80), items);
  }
  async list(limit = 20) {
    return this.customer.listRecent(await this.user(), limit);
  }
  async clear() {
    this.customer.clearRecent(await this.user(80));
  }
}

export class DemoNotificationsRepository
  extends DemoCustomerBase
  implements NotificationsRepository
{
  async list(options: Parameters<NotificationsRepository['list']>[0] = {}) {
    return this.customer.listNotifications(await this.user(), options);
  }
  async unreadCount() {
    const session = await this.auth.getSession();
    return session ? this.customer.unreadCount(session.userId) : 0;
  }
  async markRead(id: string) {
    return this.customer.markRead(await this.user(60), id);
  }
  async markAllRead() {
    return this.customer.markAllRead(await this.user(60));
  }
  async preferences() {
    return this.customer.preferences(await this.user());
  }
  async setPreference(category: string, channel: NotificationChannel, enabled: boolean) {
    return this.customer.setPreference(await this.user(80), category, channel, enabled);
  }
}

export class DemoCustomerRequestsRepository
  extends DemoCustomerBase
  implements CustomerRequestsRepository
{
  private async create(input: Parameters<DemoCommerceStore['customer']['createRequest']>[1]) {
    await delay(300);
    const actor = await actorOf(this.auth, this.store);
    try {
      return this.customer.createRequest(actor, input);
    } catch (error) {
      throw new RepositoryError('request failed', error, 'invalid_response');
    }
  }

  requestStockAlert(request: StockAlertRequest) {
    return this.create({
      kind: 'notify',
      productSlug: request.productSlug,
      variantSku: request.variantSku,
      name: request.name,
      phone: request.phone,
      email: request.email,
    });
  }

  joinWaitlist(request: WaitlistRequest) {
    return this.create({
      kind: 'waitlist',
      productSlug: request.productSlug,
      variantSku: null,
      name: request.name,
      phone: request.phone,
      email: request.email,
      desiredStorage: request.desiredStorage,
      desiredColor: request.desiredColor,
    });
  }

  async listMine() {
    return this.customer.listRequests(await this.user());
  }

  async cancel(kind: 'notify' | 'waitlist', id: string) {
    return this.customer.cancelRequest(await this.user(150), kind, id);
  }

  async claim(claims: RequestClaim[]) {
    await delay(80);
    const actor = await actorOf(this.auth, this.store);
    return guard(() => this.customer.claimRequests(actor, claims));
  }
}

const MAX_DEMO_IMAGE_BYTES = 400_000;

export class DemoReviewsRepository extends DemoCustomerBase implements ReviewsRepository {
  async listPublic(productSlug: string, limit = 10, offset = 0) {
    await delay();
    return this.customer.publicReviews(productSlug, limit, offset);
  }
  async myStatus(productSlug: string) {
    await delay();
    const session = await this.auth.getSession();
    return this.customer.reviewStatus(session?.userId ?? null, productSlug);
  }
  async submit(input: ReviewInput) {
    return this.customer.submitReview(await this.user(300), input);
  }
  async deleteMine(id: string) {
    return this.customer.deleteReview(await this.user(200), id);
  }
  async listMine() {
    return this.customer.myReviews(await this.user());
  }
  /** Demo: the compressed photo stays in this browser as a data URL (nothing is uploaded). */
  async uploadImage(file: Blob) {
    await this.user(200);
    if (file.size > MAX_DEMO_IMAGE_BYTES)
      throw new RepositoryError('image too large for the demo preview', null, 'invalid_response');
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () =>
        reject(new RepositoryError('image read failed', reader.error, 'invalid_response'));
      reader.readAsDataURL(file);
    });
  }
  async imageUrls(paths: string[]) {
    return Object.fromEntries(paths.filter((p) => p.startsWith('data:image/')).map((p) => [p, p]));
  }
}

export class DemoCustomerOperationsRepository
  extends DemoCustomerBase
  implements CustomerOperationsRepository
{
  async listReviews(status: 'pending' | 'approved' | 'rejected' | null) {
    await delay();
    const actor = await actorOf(this.auth, this.store);
    return guard(() => this.customer.staffReviews(actor, status));
  }
  async moderateReview(id: string, decision: 'approved' | 'rejected', note: string | null) {
    await delay(200);
    const actor = await actorOf(this.auth, this.store);
    return guard(() => this.customer.moderateReview(actor, id, decision, note));
  }
  async listAbandonedCarts() {
    await delay();
    const actor = await actorOf(this.auth, this.store);
    return guard(() => this.customer.abandonedCarts(actor));
  }
}
