import { z } from 'zod';
import { localizedTextSchema, type LocalizedText } from '@/domain/localized';

/**
 * Invoice / receipt template contract. Phase 03 renders the default; the Admin template editor
 * (Phase 06/07) will store an edited copy as a setting with the same schema — logo, visible fields,
 * labels, footer and terms — so Malek Store's own receipt style can be reproduced.
 */
export const invoiceTemplateSchema = z.strictObject({
  version: z.literal(1),
  showLogo: z.boolean(),
  title: localizedTextSchema,
  fields: z.strictObject({
    customerPhone: z.boolean(),
    customerEmail: z.boolean(),
    sku: z.boolean(),
    warranty: z.boolean(),
    paymentStatus: z.boolean(),
    storeAddress: z.boolean(),
    storePhones: z.boolean(),
  }),
  footer: localizedTextSchema.nullable(),
  terms: localizedTextSchema.nullable(),
});

export type InvoiceTemplate = z.infer<typeof invoiceTemplateSchema>;

const THANKS: LocalizedText = {
  ar: 'شكرًا لتسوقك من MALEK STORE.',
  en: 'Thank you for shopping at MALEK STORE.',
};

export const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplate = {
  version: 1,
  showLogo: true,
  title: { ar: 'فاتورة الطلب', en: 'Order invoice' },
  fields: {
    customerPhone: true,
    customerEmail: false,
    sku: true,
    warranty: true,
    paymentStatus: true,
    storeAddress: true,
    storePhones: true,
  },
  footer: THANKS,
  // No invented policies: the owner adds real terms from Admin.
  terms: null,
};
