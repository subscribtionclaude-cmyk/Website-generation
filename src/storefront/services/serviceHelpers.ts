import { useQuery } from '@tanstack/react-query';
import type { MediaRef } from '@/domain/services/types';
import { useSession } from '@/features/auth/context';
import type { CoreMessageKey } from '@/i18n/context';
import type { ServiceUpload } from '@/repositories/types';
import { useRuntime } from '@/runtime/context';

/** One file in the shared service media uploader (see MediaUploader). */
export interface UploadItem {
  localId: string;
  status: 'processing' | 'uploading' | 'done' | 'error';
  mediaType: 'image' | 'video';
  name: string;
  label: string | null;
  previewUrl: string | null;
  upload: ServiceUpload | null;
  error: CoreMessageKey | null;
  /** The original file is still in memory, so a failed upload can be retried. */
  retryable?: boolean;
}

export const uploadsToMedia = (items: UploadItem[]): MediaRef[] =>
  items.flatMap((i) =>
    i.status === 'done' && i.upload ? [{ path: i.upload.path, label: i.label }] : [],
  );

/** Serializable form of finished uploads (for draft recovery). */
export const uploadsForDraft = (items: UploadItem[]) =>
  items.filter((i) => i.status === 'done' && i.upload).map((i) => ({ ...i, previewUrl: null }));

/** Prefill contact from the customer's profile once it loads. */
export function useProfileContact() {
  const { repositories } = useRuntime();
  const session = useSession();
  return useQuery({
    queryKey: ['profile', session?.userId ?? null],
    queryFn: () => repositories.profiles.getMyProfile(),
    enabled: Boolean(session),
  });
}
