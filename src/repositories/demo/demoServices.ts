import { EXT_FOR_MIME, type ServiceMime } from '@/domain/services/media';
import { SERVICE_BUCKET } from '@/domain/services/status';
import { DemoServicePermissionError, type DemoServices } from '@/domain/services/demoServices';
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
import { compressImage } from '@/lib/images/compressImage';
import type { DemoAuthService } from '@/services/auth/demoAuthService';
import { RepositoryError } from '../supabase/errors';
import type {
  ServiceOperationsRepository,
  ServiceRequestsRepository,
  ServiceUpload,
} from '../types';
import { actorOf, type DemoCommerceStore } from './demoCommerce';

/**
 * DEMO MODE adapters for the Phase 05 service ports. Requests run through the in-browser
 * DemoServices engine (same rules as the SQL). Uploaded files never leave this browser: images keep
 * a small preview (bounded total size), videos keep only their metadata (see demoServiceMedia.ts).
 */
async function preview(file: Blob, mime: ServiceMime): Promise<string | null> {
  if (!mime.startsWith('image/') || typeof createImageBitmap !== 'function') return null;
  try {
    const small = await compressImage(new File([file], 'preview', { type: mime }), 720, 0.72);
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(small);
    });
  } catch {
    return null;
  }
}

const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof DemoServicePermissionError)
      throw new RepositoryError(error.message, error, 'forbidden');
    throw error;
  }
}

abstract class DemoServiceBase {
  protected readonly store: DemoCommerceStore;
  protected readonly auth: DemoAuthService;

  constructor(store: DemoCommerceStore, auth: DemoAuthService) {
    this.store = store;
    this.auth = auth;
  }

  protected get services(): DemoServices {
    return this.store.services;
  }

  protected async actor(ms = 150) {
    await delay(ms);
    return actorOf(this.auth);
  }

  protected async uploadInto(bucket: ServiceBucket, file: Blob, mime: ServiceMime) {
    const actor = await this.actor(250);
    if (!actor.userId) throw new RepositoryError('authentication required', null, 'forbidden');
    const path = `${actor.userId}/${crypto.randomUUID()}.${EXT_FOR_MIME[mime]}`;
    this.store.media.put({
      bucket,
      path,
      mime,
      size: file.size,
      owner: actor.userId,
      preview: await preview(file, mime),
      at: new Date().toISOString(),
    });
    return { bucket, path, mime, size: file.size } satisfies ServiceUpload;
  }
}

export class DemoServiceRequestsRepository
  extends DemoServiceBase
  implements ServiceRequestsRepository
{
  async create<K extends ServiceKind>(kind: K, input: ServiceInputs[K]) {
    const actor = await this.actor(350);
    return guard(() => this.services.create(actor, kind, input));
  }
  async listMine(filter: ServiceListFilter = {}) {
    const actor = await this.actor();
    return guard(() => this.services.listMine(actor, filter));
  }
  async getMine(number: string) {
    const actor = await this.actor();
    return guard(() => this.services.getMine(actor, number));
  }
  async cancel(number: string, reason: string | null = null) {
    const actor = await this.actor(200);
    return guard(() => this.services.cancel(actor, number, reason));
  }
  async respond(number: string, message: string | null, media: MediaRef[] = []) {
    const actor = await this.actor(200);
    return guard(() => this.services.respond(actor, number, message, media));
  }
  async respondOffer(offerId: string, decision: 'accept' | 'decline', note: string | null = null) {
    const actor = await this.actor(200);
    return guard(() => this.services.respondOffer(actor, offerId, decision, note));
  }
  async afterSalesItems() {
    const actor = await this.actor();
    return guard(() => this.services.afterSalesItems(actor));
  }
  upload(kind: ServiceKind, file: Blob, mime: ServiceMime) {
    return this.uploadInto(SERVICE_BUCKET[kind], file, mime);
  }
  async discardUpload(upload: { bucket: ServiceBucket; path: string }) {
    const actor = await this.actor(50);
    const item = this.store.media.get(upload.bucket, upload.path);
    if (item && item.owner === actor.userId) this.store.media.remove(upload.bucket, upload.path);
  }
  async mediaUrls(items: { bucket: ServiceBucket; path: string }[]) {
    const actor = await this.actor(50);
    const urls: Record<string, string> = {};
    for (const { bucket, path } of items) {
      const item = this.store.media.get(bucket, path);
      if (item?.preview && this.services.canReadMedia(actor, bucket, path))
        urls[`${bucket}/${path}`] = item.preview;
    }
    return urls;
  }
}

export class DemoServiceOperationsRepository
  extends DemoServiceBase
  implements ServiceOperationsRepository
{
  async list(kind: ServiceKind, filter: StaffServiceFilter = {}) {
    const actor = await this.actor();
    return guard(() => this.services.staffList(actor, kind, filter));
  }
  async get(id: string) {
    const actor = await this.actor();
    return guard(() => this.services.staffGet(actor, id));
  }
  async assignees(kind: ServiceKind) {
    const actor = await this.actor(80);
    return guard(() => this.services.assignees(actor, kind));
  }
  async assign(id: string, staffId: string | null) {
    const actor = await this.actor(200);
    return guard(() => this.services.assign(actor, id, staffId));
  }
  async setStatus(id: string, status: string, note: string | null = null) {
    const actor = await this.actor(200);
    return guard(() => this.services.setStatusStaff(actor, id, status, note));
  }
  async addNote(id: string, message: string, visible: boolean) {
    const actor = await this.actor(200);
    return guard(() => this.services.addNote(actor, id, message, visible));
  }
  async requestInfo(id: string, message: string) {
    const actor = await this.actor(200);
    return guard(() => this.services.requestInfo(actor, id, message));
  }
  async sendRepairQuote(
    id: string,
    kind: 'estimate' | 'final',
    amount: number,
    note: string | null = null,
  ) {
    const actor = await this.actor(200);
    return guard(() => this.services.sendRepairQuote(actor, id, kind, amount, note));
  }
  async sendTradeInOffer(id: string, input: TradeInOfferInput) {
    const actor = await this.actor(200);
    return guard(() => this.services.sendTradeInOffer(actor, id, input));
  }
  async sendUsedProposal(
    id: string,
    device: ProposedDevice,
    price: number,
    note: string | null = null,
    media: MediaRef[] = [],
  ) {
    const actor = await this.actor(200);
    return guard(() => this.services.sendUsedProposal(actor, id, device, price, note, media));
  }
  async decideAfterSales(
    id: string,
    decision: 'approved' | 'rejected',
    note: string | null = null,
  ) {
    const actor = await this.actor(200);
    return guard(() => this.services.decideAfterSales(actor, id, decision, note));
  }
  uploadProposalPhoto(file: Blob, mime: ServiceMime) {
    return this.uploadInto('used-requests', file, mime);
  }
}
