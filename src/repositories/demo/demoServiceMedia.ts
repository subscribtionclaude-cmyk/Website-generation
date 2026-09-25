import { z } from 'zod';
import type { DemoMediaInfo } from '@/domain/services/demoServices';
import type { ServiceBucket } from '@/domain/services/types';
import { readStored, writeStored } from '@/lib/storage/localStore';

/** Demo-mode store for uploaded service media (this browser only; bounded preview size). */
const MEDIA_KEY = 'demo-service-media';
const PREVIEW_BUDGET = 1_800_000; // characters of data URLs kept in localStorage

export interface StoredMedia {
  bucket: ServiceBucket;
  path: string;
  mime: string;
  size: number;
  owner: string;
  preview: string | null;
  at: string;
}

const mediaStoreSchema = z.object({
  items: z.record(
    z.string(),
    z.object({
      bucket: z.enum(['repairs', 'trade-in', 'after-sales', 'used-requests']),
      path: z.string(),
      mime: z.string(),
      size: z.number(),
      owner: z.string(),
      preview: z.string().nullable(),
      at: z.string(),
    }),
  ),
});

export class DemoServiceMediaStore {
  private items: Record<string, StoredMedia>;

  constructor() {
    this.items = readStored(MEDIA_KEY, mediaStoreSchema)?.items ?? {};
  }

  info(bucket: ServiceBucket, path: string): DemoMediaInfo | null {
    const item = this.items[`${bucket}/${path}`];
    return item ? { bucket, path, mime: item.mime, size: item.size } : null;
  }

  get(bucket: ServiceBucket, path: string) {
    return this.items[`${bucket}/${path}`] ?? null;
  }

  put(item: StoredMedia) {
    this.items[`${item.bucket}/${item.path}`] = item;
    // Keep newest previews within budget; older ones keep metadata only.
    let total = 0;
    for (const entry of Object.values(this.items).sort((a, b) => b.at.localeCompare(a.at))) {
      total += entry.preview?.length ?? 0;
      if (total > PREVIEW_BUDGET) entry.preview = null;
    }
    this.save();
  }

  remove(bucket: ServiceBucket, path: string) {
    this.items = Object.fromEntries(
      Object.entries(this.items).filter(([key]) => key !== `${bucket}/${path}`),
    );
    this.save();
  }

  private save() {
    writeStored(MEDIA_KEY, { items: this.items });
  }
}
