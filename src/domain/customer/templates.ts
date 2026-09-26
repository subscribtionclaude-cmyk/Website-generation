import type { LocalizedText } from '@/domain/localized';
import type { Locale } from '@/i18n/config';
import type { NotificationCategory } from './types';

/**
 * Mirror of public.notification_templates (seeded in 20260927100100_notifications.sql) for demo
 * mode. `templates.test.ts` checks every key and text here matches the migration.
 */
export interface NotificationTemplate {
  category: NotificationCategory;
  title: LocalizedText;
  body: LocalizedText;
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  'order.confirmed': {
    category: 'order',
    title: { ar: 'تم تأكيد طلبك', en: 'Your order is confirmed' },
    body: {
      ar: 'الطلب {{order_number}} اتأكد. هنجهزه ونبلغك بكل خطوة.',
      en: 'Order {{order_number}} is confirmed. We will prepare it and keep you posted.',
    },
  },
  'order.preparing': {
    category: 'order',
    title: { ar: 'جاري تجهيز طلبك', en: 'We are preparing your order' },
    body: {
      ar: 'بدأنا نجهز الطلب {{order_number}}.',
      en: 'We have started preparing order {{order_number}}.',
    },
  },
  'order.ready_for_pickup': {
    category: 'order',
    title: { ar: 'طلبك جاهز للاستلام', en: 'Your order is ready for pickup' },
    body: {
      ar: 'الطلب {{order_number}} جاهز في الفرع.',
      en: 'Order {{order_number}} is ready at the store.',
    },
  },
  'order.out_for_delivery': {
    category: 'order',
    title: { ar: 'طلبك خرج للتوصيل', en: 'Your order is out for delivery' },
    body: {
      ar: 'الطلب {{order_number}} في الطريق إليك.',
      en: 'Order {{order_number}} is on its way.',
    },
  },
  'order.delivered': {
    category: 'order',
    title: { ar: 'تم توصيل طلبك', en: 'Your order was delivered' },
    body: {
      ar: 'تم توصيل الطلب {{order_number}}. نتمنى يعجبك!',
      en: 'Order {{order_number}} was delivered. We hope you enjoy it!',
    },
  },
  'order.completed': {
    category: 'order',
    title: { ar: 'اكتمل طلبك', en: 'Your order is complete' },
    body: {
      ar: 'الطلب {{order_number}} اكتمل. تقدر تقيّم منتجاتك من حسابك.',
      en: 'Order {{order_number}} is complete. You can review your products from your account.',
    },
  },
  'order.cancelled': {
    category: 'order',
    title: { ar: 'تم إلغاء طلبك', en: 'Your order was cancelled' },
    body: {
      ar: 'تم إلغاء الطلب {{order_number}}. تواصل معانا لو محتاج مساعدة.',
      en: 'Order {{order_number}} was cancelled. Contact us if you need help.',
    },
  },
  'stock.back_in_stock': {
    category: 'back_in_stock',
    title: { ar: 'رجع للمخزون', en: 'Back in stock' },
    body: {
      ar: '{{product_name}} متاح دلوقتي. الكمية محدودة.',
      en: '{{product_name}} is available again. Quantities are limited.',
    },
  },
  'waitlist.available': {
    category: 'waitlist',
    title: { ar: 'المنتج متاح', en: 'Now available' },
    body: {
      ar: '{{product_name}} اللي سجلت اهتمامك بيه متاح دلوقتي.',
      en: '{{product_name}}, which you joined the waitlist for, is now available.',
    },
  },
  'waitlist.pre_order': {
    category: 'waitlist',
    title: { ar: 'الحجز المسبق متاح', en: 'Pre-orders are open' },
    body: {
      ar: 'الحجز المسبق لـ {{product_name}} بدأ.',
      en: 'Pre-orders for {{product_name}} are open.',
    },
  },
  'price.drop': {
    category: 'price_drop',
    title: { ar: 'السعر نزل', en: 'Price dropped' },
    body: {
      ar: 'سعر {{product_name}} في المفضلة بقى {{amount}}.',
      en: '{{product_name}} in your wishlist is now {{amount}}.',
    },
  },
  'review.approved': {
    category: 'review',
    title: { ar: 'تم نشر تقييمك', en: 'Your review is published' },
    body: {
      ar: 'شكرًا! تقييمك لـ {{product_name}} اتنشر.',
      en: 'Thank you! Your review of {{product_name}} is now published.',
    },
  },
  'review.rejected': {
    category: 'review',
    title: { ar: 'لم يتم نشر تقييمك', en: 'Your review was not published' },
    body: {
      ar: 'تقييمك لـ {{product_name}} مااتنشرش لأنه لا يتوافق مع سياسة التقييمات. تقدر تعدّله.',
      en: 'Your review of {{product_name}} was not published because it does not meet our review policy. You can edit it.',
    },
  },
  'cart.abandoned': {
    category: 'cart',
    title: { ar: 'سلتك مستنياك', en: 'Your cart is waiting' },
    body: {
      ar: 'لسه عندك منتجات في السلة. كمّل طلبك وقت ما يناسبك.',
      en: 'You still have items in your cart. Continue whenever it suits you.',
    },
  },
  // Phase 05 service requests (20260928100000_services.sql)
  'service.updated': {
    category: 'service',
    title: { ar: 'تحديث على طلبك', en: 'Update on your request' },
    body: {
      ar: 'في تحديث جديد على الطلب {{code}}. افتح الطلب لتشوف التفاصيل.',
      en: 'There is a new update on request {{code}}. Open it to see the details.',
    },
  },
  'service.info_needed': {
    category: 'service',
    title: { ar: 'محتاجين معلومات إضافية', en: 'We need a bit more information' },
    body: {
      ar: 'فريقنا محتاج تفاصيل أو صور إضافية للطلب {{code}}.',
      en: 'Our team needs more details or photos for request {{code}}.',
    },
  },
  'service.cancelled': {
    category: 'service',
    title: { ar: 'تم إلغاء الطلب', en: 'Request cancelled' },
    body: {
      ar: 'تم إلغاء الطلب {{code}}. لو محتاج مساعدة تواصل معانا.',
      en: 'Request {{code}} was cancelled. Contact us if you need help.',
    },
  },
  'service.repair.quote_ready': {
    category: 'service',
    title: { ar: 'عرض سعر الصيانة جاهز', en: 'Your repair quote is ready' },
    body: {
      ar: 'أرسلنا عرض سعر للطلب {{code}} بقيمة {{amount}}. راجعه من حسابك.',
      en: 'We sent a quote of {{amount}} for request {{code}}. Review it in your account.',
    },
  },
  'service.repair.ready': {
    category: 'service',
    title: { ar: 'جهازك جاهز', en: 'Your device is ready' },
    body: {
      ar: 'الطلب {{code}}: جهازك جاهز للاستلام أو التوصيل.',
      en: 'Request {{code}}: your device is ready for pickup or delivery.',
    },
  },
  'service.trade_in.inspection': {
    category: 'service',
    title: { ar: 'مطلوب فحص الجهاز', en: 'Device inspection required' },
    body: {
      ar: 'الطلب {{code}}: محتاجين نفحص الجهاز في الفرع قبل التقييم النهائي.',
      en: 'Request {{code}}: we need to inspect the device in store before the final valuation.',
    },
  },
  'service.trade_in.offer_ready': {
    category: 'service',
    title: { ar: 'عرض الاستبدال جاهز', en: 'Your trade-in offer is ready' },
    body: {
      ar: 'الطلب {{code}}: قيمة جهازك الحالي {{amount}}. راجع العرض من حسابك.',
      en: 'Request {{code}}: your current device is valued at {{amount}}. Review the offer in your account.',
    },
  },
  'service.trade_in.rejected': {
    category: 'service',
    title: { ar: 'تعذر إتمام الاستبدال', en: 'Trade-in not possible' },
    body: {
      ar: 'للأسف مش هنقدر نكمل طلب الاستبدال {{code}}. تفاصيل أكتر في حسابك.',
      en: 'Unfortunately we cannot continue trade-in request {{code}}. More details are in your account.',
    },
  },
  'service.used.option_found': {
    category: 'service',
    title: { ar: 'لقينا جهاز مناسب', en: 'We found a device for you' },
    body: {
      ar: 'الطلب {{code}}: لقينا جهاز مستعمل مناسب بسعر {{amount}}. شوف التفاصيل والصور.',
      en: 'Request {{code}}: we found a matching used device for {{amount}}. See the details and photos.',
    },
  },
  'service.used.offer_sent': {
    category: 'service',
    title: { ar: 'العرض جاهز', en: 'Your offer is ready' },
    body: {
      ar: 'الطلب {{code}}: العرض النهائي جاهز في حسابك.',
      en: 'Request {{code}}: the final offer is ready in your account.',
    },
  },
  'service.used.not_available': {
    category: 'service',
    title: { ar: 'الجهاز غير متاح حاليًا', en: 'Device not available right now' },
    body: {
      ar: 'للأسف ملقيناش جهاز مناسب للطلب {{code}} حاليًا.',
      en: 'Unfortunately we could not find a matching device for request {{code}} right now.',
    },
  },
  'service.after_sales.approved': {
    category: 'service',
    title: { ar: 'تمت الموافقة على طلبك', en: 'Your request was approved' },
    body: {
      ar: 'الطلب {{code}} اتقبل. هنتواصل معاك بالخطوات الجاية.',
      en: 'Request {{code}} was approved. We will contact you with the next steps.',
    },
  },
  'service.after_sales.rejected': {
    category: 'service',
    title: { ar: 'لم تتم الموافقة على طلبك', en: 'Your request was not approved' },
    body: {
      ar: 'الطلب {{code}} اترفض. السبب موجود في تفاصيل الطلب.',
      en: 'Request {{code}} was not approved. The reason is in the request details.',
    },
  },
  'service.after_sales.inspection': {
    category: 'service',
    title: { ar: 'جاري فحص المنتج', en: 'Your item is being inspected' },
    body: {
      ar: 'الطلب {{code}}: استلمنا المنتج وبدأنا الفحص.',
      en: 'Request {{code}}: we received the item and started the inspection.',
    },
  },
  'service.after_sales.completed': {
    category: 'service',
    title: { ar: 'تم إنهاء طلبك', en: 'Your request is complete' },
    body: {
      ar: 'الطلب {{code}} خلص. شكرًا لثقتك في ملك ستور.',
      en: 'Request {{code}} is complete. Thank you for choosing Malek Store.',
    },
  },
};

export const TEMPLATE_PLACEHOLDERS = [
  'customer_name',
  'order_number',
  'product_name',
  'status',
  'amount',
  'code',
] as const;
export type TemplateVars = Partial<
  Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string | number | LocalizedText>
>;

/**
 * Same semantics as app.render_template: a closed placeholder set, values are plain text (their
 * braces are stripped so they cannot inject placeholders), unknown placeholders are dropped.
 */
export function renderTemplate(template: string, vars: TemplateVars, locale: Locale): string {
  let out = template;
  for (const key of TEMPLATE_PLACEHOLDERS) {
    const raw = vars[key];
    const value =
      raw === undefined ? '' : typeof raw === 'object' ? (raw[locale] ?? raw.ar) : String(raw);
    out = out.split(`{{${key}}}`).join(value.replace(/[{}]/g, '').slice(0, 200));
  }
  return out.replace(/\{\{[^}]*\}\}/g, '').trim();
}

/**
 * DEMO MODE ONLY: staff edits of templates made in the demo admin (live mode reads
 * public.notification_templates). Inactive templates send nothing, like app.notify.
 */
let demoOverrides: Record<
  string,
  { title: LocalizedText; body: LocalizedText; isActive: boolean }
> = {};
export function setDemoTemplateOverrides(overrides: typeof demoOverrides) {
  demoOverrides = overrides;
}

export function unknownPlaceholder(...texts: (string | undefined)[]): string | null {
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(/\{\{([^}]*)\}\}/g)) {
      const name = match[1] ?? '';
      if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name)) return name;
    }
  }
  return null;
}

export function renderNotification(templateKey: string, vars: TemplateVars) {
  const base = NOTIFICATION_TEMPLATES[templateKey];
  if (!base) return null;
  const override = demoOverrides[templateKey];
  if (override && !override.isActive) return null;
  const template = override ? { ...base, title: override.title, body: override.body } : base;
  return {
    category: template.category,
    title: {
      ar: renderTemplate(template.title.ar, vars, 'ar'),
      en: renderTemplate(template.title.en ?? template.title.ar, vars, 'en'),
    },
    body: {
      ar: renderTemplate(template.body.ar, vars, 'ar'),
      en: renderTemplate(template.body.en ?? template.body.ar, vars, 'en'),
    },
  };
}
