import type { SupabaseClient } from '@supabase/supabase-js';
import { EXT_FOR_MIME, type ServiceMime } from '@/domain/services/media';
import {
  actionResultSchema,
  afterSalesItemsSchema,
  assigneesSchema,
  createResultSchema,
  detailSchema,
  listSchema,
  staffActionResultSchema,
  staffDetailSchema,
  staffListSchema,
} from '@/domain/services/schemas';
import { SERVICE_BUCKET } from '@/domain/services/status';
import type {
  MediaRef,
  ProposedDevice,
  ServiceBucket,
  ServiceInputs,
  ServiceKind,
  ServiceListFilter,
  StaffServiceFilter,
  TradeInOfferInput,
} from '@/domain/services/types';
import { RepositoryError } from './errors';
import { rpc } from './rpc';
import type {
  ServiceOperationsRepository,
  ServiceRequestsRepository,
  ServiceUpload,
} from '../types';

/**
 * Phase 05 service ports over the SECURITY DEFINER RPCs in supabase/migrations/20260928*.
 * Uploads go to the kind's private bucket inside the caller's own "<uid>/" folder (storage
 * policies enforce it); the database validates each file again when it is attached.
 */
async function uploadTo(
  client: SupabaseClient,
  bucket: ServiceBucket,
  file: Blob,
  mime: ServiceMime,
): Promise<ServiceUpload> {
  const { data } = await client.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new RepositoryError('authentication required', null, 'forbidden');
  const path = `${userId}/${crypto.randomUUID()}.${EXT_FOR_MIME[mime]}`;
  const { error } = await client.storage
    .from(bucket)
    .upload(path, file, { contentType: mime, upsert: false, cacheControl: '3600' });
  if (error) throw new RepositoryError('upload failed', error, 'unavailable');
  return { bucket, path, mime, size: file.size };
}

class SupabaseServiceRequestsRepository implements ServiceRequestsRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  create<K extends ServiceKind>(kind: K, input: ServiceInputs[K]) {
    return rpc(
      this.client,
      'create_service_request',
      { p_kind: kind, p_payload: input },
      createResultSchema,
    );
  }
  listMine(filter: ServiceListFilter = {}) {
    return rpc(
      this.client,
      'list_my_service_requests',
      {
        p_kind: filter.kind ?? null,
        p_status: filter.status ?? null,
        p_limit: filter.limit ?? 50,
        p_offset: filter.offset ?? 0,
      },
      listSchema,
    );
  }
  getMine(number: string) {
    return rpc(
      this.client,
      'get_my_service_request',
      { p_number: number },
      detailSchema.nullable(),
    );
  }
  cancel(number: string, reason: string | null = null) {
    return rpc(
      this.client,
      'cancel_my_service_request',
      { p_number: number, p_reason: reason },
      actionResultSchema,
    );
  }
  respond(number: string, message: string | null, media: MediaRef[] = []) {
    return rpc(
      this.client,
      'respond_my_service_request',
      { p_number: number, p_message: message, p_media: media },
      actionResultSchema,
    );
  }
  respondOffer(offerId: string, decision: 'accept' | 'decline', note: string | null = null) {
    return rpc(
      this.client,
      'respond_my_service_offer',
      { p_offer_id: offerId, p_decision: decision, p_note: note },
      actionResultSchema,
    );
  }
  afterSalesItems() {
    return rpc(this.client, 'list_my_after_sales_items', {}, afterSalesItemsSchema);
  }
  upload(kind: ServiceKind, file: Blob, mime: ServiceMime) {
    return uploadTo(this.client, SERVICE_BUCKET[kind], file, mime);
  }
  async discardUpload(upload: { bucket: ServiceBucket; path: string }) {
    // Best effort: an orphaned file stays private and is removed by storage housekeeping.
    await this.client.storage.from(upload.bucket).remove([upload.path]);
  }
  async mediaUrls(items: { bucket: ServiceBucket; path: string }[]) {
    const urls: Record<string, string> = {};
    const byBucket = new Map<ServiceBucket, string[]>();
    for (const item of items)
      byBucket.set(item.bucket, [...(byBucket.get(item.bucket) ?? []), item.path]);
    for (const [bucket, paths] of byBucket) {
      const { data, error } = await this.client.storage
        .from(bucket)
        .createSignedUrls([...new Set(paths)], 900);
      if (error || !data) continue;
      for (const entry of data)
        if (entry.path && entry.signedUrl) urls[`${bucket}/${entry.path}`] = entry.signedUrl;
    }
    return urls;
  }
}

class SupabaseServiceOperationsRepository implements ServiceOperationsRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  list(kind: ServiceKind, filter: StaffServiceFilter = {}) {
    return rpc(
      this.client,
      'staff_list_service_requests',
      {
        p_kind: kind,
        p_status: filter.status ?? null,
        p_q: filter.q ?? null,
        p_assigned: filter.assigned ?? null,
        p_limit: filter.limit ?? 50,
        p_offset: filter.offset ?? 0,
      },
      staffListSchema,
    );
  }
  get(id: string) {
    return rpc(
      this.client,
      'staff_get_service_request',
      { p_id: id },
      staffDetailSchema.nullable(),
    );
  }
  assignees(kind: ServiceKind) {
    return rpc(this.client, 'staff_service_assignees', { p_kind: kind }, assigneesSchema);
  }
  assign(id: string, staffId: string | null) {
    return rpc(
      this.client,
      'staff_assign_service_request',
      { p_id: id, p_staff_id: staffId },
      staffActionResultSchema,
    );
  }
  setStatus(id: string, status: string, note: string | null = null) {
    return rpc(
      this.client,
      'staff_set_service_status',
      { p_id: id, p_status: status, p_note: note },
      staffActionResultSchema,
    );
  }
  addNote(id: string, message: string, visible: boolean) {
    return rpc(
      this.client,
      'staff_add_service_note',
      { p_id: id, p_message: message, p_visible: visible },
      staffActionResultSchema,
    );
  }
  requestInfo(id: string, message: string) {
    return rpc(
      this.client,
      'staff_request_service_info',
      { p_id: id, p_message: message },
      staffActionResultSchema,
    );
  }
  sendRepairQuote(
    id: string,
    kind: 'estimate' | 'final',
    amount: number,
    note: string | null = null,
  ) {
    return rpc(
      this.client,
      'staff_send_repair_quote',
      { p_id: id, p_kind: kind, p_amount: amount, p_note: note },
      staffActionResultSchema,
    );
  }
  sendTradeInOffer(id: string, input: TradeInOfferInput) {
    return rpc(
      this.client,
      'staff_send_trade_in_offer',
      {
        p_id: id,
        p_device_value: input.deviceValue,
        p_target_price: input.targetPrice,
        p_note: input.note,
        p_inspection_note: input.inspectionNote,
        p_valid_days: input.validDays,
      },
      staffActionResultSchema,
    );
  }
  sendUsedProposal(
    id: string,
    device: ProposedDevice,
    price: number,
    note: string | null = null,
    media: MediaRef[] = [],
  ) {
    return rpc(
      this.client,
      'staff_send_used_proposal',
      { p_id: id, p_device: device, p_price: price, p_note: note, p_media: media },
      staffActionResultSchema,
    );
  }
  decideAfterSales(id: string, decision: 'approved' | 'rejected', note: string | null = null) {
    return rpc(
      this.client,
      'staff_decide_after_sales',
      { p_id: id, p_decision: decision, p_note: note },
      staffActionResultSchema,
    );
  }
  uploadProposalPhoto(file: Blob, mime: ServiceMime) {
    return uploadTo(this.client, 'used-requests', file, mime);
  }
}

export function createSupabaseServiceRepositories(client: SupabaseClient) {
  return {
    services: new SupabaseServiceRequestsRepository(client),
    serviceOps: new SupabaseServiceOperationsRepository(client),
  };
}
