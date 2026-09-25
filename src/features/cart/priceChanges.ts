import type { CartLine, QuoteLine } from '@/domain/commerce/types';

/** Quote lines whose current price differs from the price the customer saw when adding them. */
export function changedPrices(lines: CartLine[], quoteLines: QuoteLine[]): QuoteLine[] {
  return quoteLines.filter((q) => {
    const line = lines.find((l) => l.variantId === q.variantId);
    return (
      !q.isGift &&
      q.status === 'ok' &&
      line?.seenUnitPrice != null &&
      q.unitPrice !== line.seenUnitPrice
    );
  });
}
