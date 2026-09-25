import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNoSeriousA11yViolations } from './helpers';

/** Phase 03 commerce journeys on every viewport (demo mode, no paid services). */

const ADAPTER = 'demo-variant-a20w-white'; // 1,200 EGP
const AIRPODS = 'demo-variant-ap4-standard-white'; // 7,500 EGP
const CABLE = 'demo-variant-usbc-1m-white'; // 900 EGP, DEMO10 target
const SOLD_OUT = 'demo-variant-awu3-titanium';

async function seedCart(
  page: Page,
  lines: { variantId: string; quantity: number; seenUnitPrice?: number }[],
) {
  await page.evaluate((items) => {
    window.localStorage.setItem(
      'malek:v1:cart',
      JSON.stringify(
        items.map((l) => ({
          variantId: l.variantId,
          productSlug: null,
          quantity: l.quantity,
          savedForLater: false,
          seenUnitPrice: l.seenUnitPrice ?? null,
          addedAt: new Date().toISOString(),
        })),
      ),
    );
  }, lines);
}

async function signInAs(page: Page, email: string) {
  await page.evaluate((mail) => {
    window.sessionStorage.setItem(
      'malek:v1:demo-session',
      JSON.stringify({ userId: `demo-customer-${mail}`, email: mail, roleKey: null }),
    );
  }, email);
}

async function checkA11y(page: Page) {
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);
}

test.describe('commerce', () => {
  // Full journeys with several axe passes per page; mobile emulation is the slowest.
  test.describe.configure({ timeout: 90_000 });

  test('Arabic: guest cart survives refresh, sign-in only at checkout, pickup + COD order', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/product/apple-20w-usb-c-adapter');
    await page.getByRole('button', { name: 'أضف للسلة' }).click();
    await expect(page.getByText('في السلة: 1')).toBeVisible();
    await page.reload();
    await page.goto('/cart');
    await expect(page.getByRole('heading', { level: 1, name: 'سلة التسوق' })).toBeVisible();
    await expect(page.getByText('عدد القطع: 1', { exact: true })).toBeVisible();
    const summary = page.getByRole('complementary', { name: 'ملخص الطلب' });
    await expect(summary.getByText(/1,200/).first()).toBeVisible();
    await checkA11y(page);

    await summary.getByRole('link', { name: 'إتمام الطلب' }).click();
    await expect(page).toHaveURL(/\/account\/sign-in\?next=%2Fcheckout$/);
    await page.getByLabel('البريد الإلكتروني').fill('mona@example.com');
    await page.getByRole('button', { name: 'ابعت كود الدخول' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'راجع بريدك الإلكتروني' }),
    ).toBeVisible();
    await page.getByLabel('كود التأكيد').fill('123456');
    await page.getByRole('button', { name: 'تأكيد ودخول' }).click();
    await expect(page).toHaveURL(/\/checkout$/);

    await expect(page.getByRole('heading', { level: 2, name: 'بيانات التواصل' })).toBeVisible();
    await checkA11y(page);
    await page.getByLabel('الاسم بالكامل').fill('منى عادل');
    await page.getByLabel(/رقم الموبايل/).fill('01012345678');
    await page.getByRole('button', { name: 'متابعة' }).click();
    await page.getByRole('radio', { name: /استلام من الفرع/ }).check();
    await checkA11y(page);
    await page.getByRole('button', { name: 'متابعة' }).click();
    await page.getByRole('radio', { name: /الدفع عند الاستلام/ }).check();
    await page.getByRole('button', { name: 'متابعة' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'المراجعة' })).toBeVisible();
    await checkA11y(page);
    await page.getByRole('button', { name: 'إنشاء الطلب' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'تم إنشاء طلبك' })).toBeVisible();
    await expect(page).toHaveURL(/\/order\/MS-\d{4}-\d{6}\?placed=1$/);
    const orderNumber = page.url().match(/MS-\d{4}-\d{6}/)?.[0] ?? '';
    await expect(page.getByText(orderNumber, { exact: true })).toBeVisible();
    await expect(page.getByText('طلب تجريبي').first()).toBeVisible();
    // No WhatsApp number is configured in the demo settings: honest notice, never a broken link.
    await expect(page.getByText(/التواصل عبر واتساب غير متاح حاليًا/)).toBeVisible();
    expect(await page.locator('a[href*="wa.me"]').count()).toBe(0);
    await checkA11y(page);

    await page.goto('/account');
    await expect(page.getByRole('link', { name: new RegExp(orderNumber) })).toBeVisible();

    await page.goto(`/order/${orderNumber}/invoice`);
    await expect(page.getByRole('heading', { level: 1, name: 'فاتورة الطلب' })).toBeVisible();
    await checkA11y(page);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('header.print-hidden')).toBeHidden();
    await expect(page.getByRole('button', { name: /طباعة/ })).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'فاتورة الطلب' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('English: delivery + InstaPay + DEMO10; shipping stays to be confirmed', async ({
    page,
  }) => {
    await page.goto('/en');
    await signInAs(page, 'promo@example.com');
    await seedCart(page, [
      { variantId: AIRPODS, quantity: 1 },
      { variantId: CABLE, quantity: 2 },
    ]);
    await page.goto('/en/checkout');
    await page.getByLabel('Full name').fill('Mona Adel');
    await page.getByLabel(/Mobile number/).fill('+20 101 234 5678');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: /Delivery/ }).check();
    await page.getByLabel('Governorate').selectOption('giza');
    await page.getByLabel('Area / city').fill('Dokki');
    await page.getByLabel(/Full address/).fill('12 Tahrir St, floor 3');
    await checkA11y(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: /^InstaPay ?Transfer the full amount/ }).check();
    await expect(page.getByText(/A transfer screenshot alone/)).toBeVisible();
    await checkA11y(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Promo code').fill('DEMO10');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText(/DEMO10 applied/)).toBeVisible();
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Your order has been placed' }),
    ).toBeVisible();
    await expect(page.getByText('Total before shipping').first()).toBeVisible();
    await expect(page.getByText('Awaiting transfer').first()).toBeVisible();
    await expect(page.getByText(/9,120/).first()).toBeVisible();
    await checkA11y(page);
  });

  test('English: split payment (InstaPay deposit + rest on delivery)', async ({ page }) => {
    await page.goto('/en');
    await signInAs(page, 'split@example.com');
    await seedCart(page, [{ variantId: AIRPODS, quantity: 1 }]);
    await page.goto('/en/checkout');
    await page.getByLabel('Full name').fill('Karim');
    await page.getByLabel(/Mobile number/).fill('01112223334');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: /Store pickup/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: /InstaPay deposit/ }).check();
    await page.getByLabel('Deposit amount (EGP)').fill('9000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/deposit above zero and below the order total/)).toBeVisible();
    await page.getByLabel('Deposit amount (EGP)').fill('2000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/deposit EGP\s?2,000|deposit 2,000/)).toBeVisible();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your order has been placed' }),
    ).toBeVisible();
    await expect(page.getByText('Awaiting deposit').first()).toBeVisible();
    await expect(
      page.getByText('Our team needs to review this order before confirming it.'),
    ).toBeVisible();
  });

  test('price changed and sold-out lines block checkout until resolved', async ({ page }) => {
    await page.goto('/en');
    await seedCart(page, [
      { variantId: AIRPODS, quantity: 1, seenUnitPrice: 7000 },
      { variantId: SOLD_OUT, quantity: 1 },
    ]);
    await page.goto('/en/cart');
    await expect(page.getByText('Price updated.')).toBeVisible();
    await expect(page.getByText('Sold out.')).toBeVisible();
    const checkout = page.getByRole('link', { name: 'Checkout' });
    await expect(checkout).toHaveAttribute('aria-disabled', 'true');
    await checkA11y(page);
    await page.getByRole('button', { name: 'Accept the new prices' }).click();
    await expect(page.getByText('Price updated.')).toBeHidden();
    await page.getByRole('button', { name: /Remove.*Apple Watch Ultra 3/ }).click();
    await expect(checkout).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('orders are private and staff confirm them in the admin', async ({ page }) => {
    await page.goto('/en');
    await signInAs(page, 'owner-a@example.com');
    await seedCart(page, [{ variantId: ADAPTER, quantity: 1 }]);
    await page.goto('/en/checkout');
    await page.getByLabel('Full name').fill('Hany');
    await page.getByLabel(/Mobile number/).fill('01212345678');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: /Store pickup/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: /Cash on delivery/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your order has been placed' }),
    ).toBeVisible();
    const orderNumber = page.url().match(/MS-\d{4}-\d{6}/)?.[0] ?? '';

    // Another customer on the same device cannot open it.
    await signInAs(page, 'other-b@example.com');
    await page.goto(`/en/order/${orderNumber}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Order not found' })).toBeVisible();
    await expect(page.getByText('Hany')).toHaveCount(0);

    // Staff (demo role preview) confirm the pickup order.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto('/admin/orders');
    await page.getByLabel('الدور').selectOption('owner');
    await page.getByRole('button', { name: 'معاينة بهذا الدور' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'الطلبات' })).toBeVisible();
    await checkA11y(page);
    await page.getByRole('link', { name: orderNumber }).click();
    await expect(page.getByRole('heading', { level: 1, name: orderNumber })).toBeVisible();
    await checkA11y(page);
    await page.getByLabel('الحالة التالية').selectOption('confirmed');
    await page.getByRole('button', { name: 'تحديث الحالة' }).click();
    await expect(page.getByText('المخزون مخصوم').first()).toBeVisible();
  });
});
