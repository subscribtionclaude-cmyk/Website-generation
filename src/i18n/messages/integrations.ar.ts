/**
 * Phase 09 storefront strings (analytics consent, social sign-in). Registered lazily by the
 * chunks that use them (see integrations.ts), so they stay out of the storefront entry chunk.
 */
export const integrationsAr = {
  integrations: {
    consent: {
      title: 'ملفات تعريف الارتباط للتحليلات',
      body: 'نستخدم Google Analytics لقياس زيارات صفحات المتجر العامة فقط بعد موافقتك، بدون أي بيانات شخصية (لا اسم ولا هاتف ولا بريد ولا عنوان). لا يتم تحميله أبدًا في حسابك أو صفحات الدفع والطلبات.',
      accept: 'السماح بالتحليلات',
      reject: 'رفض',
      manage: 'إعدادات ملفات الارتباط',
      current: 'اختيارك الحالي: {choice}',
      granted: 'مسموح',
      denied: 'مرفوض',
      demo: 'وضع العرض: لن يتم إرسال أي بيانات تحليلية.',
    },
    socialAuth: {
      divider: 'أو',
      google: 'الدخول بحساب Google',
      apple: 'الدخول بحساب Apple',
      demo: 'وضع العرض: الدخول بحساب Google أو Apple غير متاح في العرض. استخدم رمز البريد الإلكتروني.',
      error: 'تعذر بدء الدخول. حاول مرة أخرى أو استخدم رمز البريد الإلكتروني.',
      privacy: 'بعد موافقتك نستلم اسمك وبريدك من الحساب فقط.',
    },
  },
};
