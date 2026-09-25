import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/features/auth/context';
import { useRuntime } from '@/runtime/context';

/** The signed-in customer's own order by its human number (ownership enforced by the backend). */
export function useMyOrder(orderNumber: string) {
  const { repositories } = useRuntime();
  const session = useSession();
  return useQuery({
    queryKey: ['order', session?.userId ?? null, orderNumber],
    queryFn: () => repositories.commerce.getMyOrder(orderNumber),
    enabled: Boolean(session),
  });
}
