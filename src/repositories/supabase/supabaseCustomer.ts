import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  abandonedCartsSchema,
  actionResultSchema,
  addressSchema,
  cartStatusSchema,
  notificationPageSchema,
  notificationPreferencesSchema,
  ownReviewSchema,
  publicReviewsSchema,
  recentEntriesSchema,
  reviewEligibilitySchema,
  saveAddressResultSchema,
  staffReviewsSchema,
  submitReviewResultSchema,
  wishlistViewSchema,
} from '@/domain/customer/schemas';
import type { AddressInput, NotificationChannel, ReviewInput } from '@/domain/customer/types';
import { RepositoryError } from './errors';
import { rpc } from './rpc';
import type {
  AccountRepository,
  CustomerOperationsRepository,
  NotificationsRepository,
  RecentlyViewedRepository,
  Repositories,
  ReviewsRepository,
  WishlistRepository,
} from '../types';

/**
 * Phase 04 customer ports over the SECURITY DEFINER RPCs in supabase/migrations/20260927*.
 * Ownership, eligibility and permissions are enforced by the database; the adapter only calls
 * and validates. Review photos go to the private `reviews` bucket in the customer's own folder.
 */
class Base {
  protected readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }
}

class SupabaseAccountRepository extends Base implements AccountRepository {
  listAddresses() {
    return rpc(this.client, 'list_my_addresses', {}, z.array(addressSchema));
  }
  saveAddress(input: AddressInput) {
    return rpc(this.client, 'save_my_address', { p_address: input }, saveAddressResultSchema);
  }
  deleteAddress(id: string) {
    return rpc(this.client, 'delete_my_address', { p_id: id }, actionResultSchema);
  }
  getCartStatus() {
    return rpc(this.client, 'my_cart_status', {}, cartStatusSchema);
  }
}

class SupabaseWishlistRepository extends Base implements WishlistRepository {
  get() {
    return rpc(this.client, 'wishlist_get', {}, wishlistViewSchema);
  }
  set(productId: string, variantId: string | null, saved: boolean) {
    return rpc(
      this.client,
      'wishlist_set',
      { p_product_id: productId, p_variant_id: variantId, p_saved: saved },
      actionResultSchema,
    );
  }
  merge(items: Parameters<WishlistRepository['merge']>[0]) {
    return rpc(this.client, 'wishlist_merge', { p_items: items }, wishlistViewSchema);
  }
}

class SupabaseRecentlyViewedRepository extends Base implements RecentlyViewedRepository {
  async track(productId: string, variantId: string | null) {
    await rpc(
      this.client,
      'recent_track',
      { p_product_id: productId, p_variant_id: variantId },
      actionResultSchema,
    );
  }
  async merge(items: Parameters<RecentlyViewedRepository['merge']>[0]) {
    await rpc(this.client, 'recent_merge', { p_items: items }, actionResultSchema);
  }
  list(limit = 20) {
    return rpc(this.client, 'recent_list', { p_limit: limit }, recentEntriesSchema);
  }
  async clear() {
    await rpc(this.client, 'recent_clear', {}, actionResultSchema);
  }
}

class SupabaseNotificationsRepository extends Base implements NotificationsRepository {
  list(options: Parameters<NotificationsRepository['list']>[0] = {}) {
    return rpc(
      this.client,
      'list_my_notifications',
      {
        p_limit: options.limit ?? 20,
        p_before: options.before ?? null,
        p_unread_only: options.unreadOnly ?? false,
      },
      notificationPageSchema,
    );
  }
  unreadCount() {
    return rpc(this.client, 'my_unread_notification_count', {}, z.number().int().min(0));
  }
  markRead(id: string) {
    return rpc(this.client, 'mark_notification_read', { p_id: id }, z.number().int().min(0));
  }
  markAllRead() {
    return rpc(this.client, 'mark_all_notifications_read', {}, z.number().int().min(0));
  }
  preferences() {
    return rpc(this.client, 'get_my_notification_preferences', {}, notificationPreferencesSchema);
  }
  setPreference(category: string, channel: NotificationChannel, enabled: boolean) {
    return rpc(
      this.client,
      'set_my_notification_preference',
      { p_category: category, p_channel: channel, p_enabled: enabled },
      actionResultSchema,
    );
  }
}

class SupabaseReviewsRepository extends Base implements ReviewsRepository {
  listPublic(productSlug: string, limit = 10, offset = 0) {
    return rpc(
      this.client,
      'product_reviews_public',
      { p_product_slug: productSlug, p_limit: limit, p_offset: offset },
      publicReviewsSchema.nullable(),
    );
  }
  myStatus(productSlug: string) {
    return rpc(
      this.client,
      'my_review_status',
      { p_product_slug: productSlug },
      reviewEligibilitySchema,
    );
  }
  submit(input: ReviewInput) {
    return rpc(
      this.client,
      'submit_review',
      {
        p_product_slug: input.productSlug,
        p_rating: input.rating,
        p_body: input.body,
        p_title: input.title,
        p_image_path: input.imagePath,
      },
      submitReviewResultSchema,
    );
  }
  deleteMine(id: string) {
    return rpc(this.client, 'delete_my_review', { p_id: id }, actionResultSchema);
  }
  listMine() {
    return rpc(this.client, 'list_my_reviews', {}, z.array(ownReviewSchema));
  }
  async uploadImage(file: Blob) {
    const { data } = await this.client.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) throw new RepositoryError('authentication required', null, 'forbidden');
    const extension =
      file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : 'webp';
    const path = `${userId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await this.client.storage
      .from('reviews')
      .upload(path, file, { contentType: file.type || 'image/webp', upsert: false });
    if (error) throw new RepositoryError('review image upload failed', error, 'unavailable');
    return path;
  }
  async imageUrls(paths: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(paths.filter(Boolean))];
    if (unique.length === 0) return {};
    const { data, error } = await this.client.storage
      .from('reviews')
      .createSignedUrls(unique, 3600);
    if (error || !data) return {};
    const urls: Record<string, string> = {};
    for (const entry of data) if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl;
    return urls;
  }
}

class SupabaseCustomerOperationsRepository extends Base implements CustomerOperationsRepository {
  listReviews(status: 'pending' | 'approved' | 'rejected' | null) {
    return rpc(this.client, 'staff_list_reviews', { p_status: status }, staffReviewsSchema);
  }
  moderateReview(id: string, decision: 'approved' | 'rejected', note: string | null) {
    return rpc(
      this.client,
      'staff_moderate_review',
      { p_id: id, p_decision: decision, p_note: note },
      actionResultSchema,
    );
  }
  listAbandonedCarts() {
    return rpc(this.client, 'staff_list_abandoned_carts', {}, abandonedCartsSchema);
  }
}

export function createSupabaseCustomerRepositories(
  client: SupabaseClient,
): Pick<
  Repositories,
  'account' | 'wishlist' | 'recent' | 'notifications' | 'reviews' | 'customerOps'
> {
  return {
    account: new SupabaseAccountRepository(client),
    wishlist: new SupabaseWishlistRepository(client),
    recent: new SupabaseRecentlyViewedRepository(client),
    notifications: new SupabaseNotificationsRepository(client),
    reviews: new SupabaseReviewsRepository(client),
    customerOps: new SupabaseCustomerOperationsRepository(client),
  };
}
