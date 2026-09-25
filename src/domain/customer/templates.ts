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

export function renderNotification(templateKey: string, vars: TemplateVars) {
  const template = NOTIFICATION_TEMPLATES[templateKey];
  if (!template) return null;
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
