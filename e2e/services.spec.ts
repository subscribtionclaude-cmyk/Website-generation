import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNoSeriousA11yViolations } from './helpers';

/**
 * Phase 05 service experiences (demo mode, in-app only, no paid services) on every viewport:
 * repairs with the diagnostic, trade-in, used-device requests, after-sales, the requests hub,
 * staff actions, drafts, media validation, privacy and the lazy 3D bundle.
 *
 * Choices are made by tapping their labels (how people use them); reduced motion keeps the
 * site's smooth scrolling from racing Playwright's clicks.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });

const PHOTO = 'e2e/fixtures/device.png';

async function signInAs(page: Page, email: string) {
  await page.evaluate((mail) => {
    window.sessionStorage.setItem(
      'malek:v1:demo-session',
      JSON.stringify({ userId: `demo-customer-${mail}`, email: mail, roleKey: null }),
    );
  }, email);
}

async function signInAsStaff(page: Page) {
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto('/admin');
  await page.getByLabel('الدور').selectOption('owner');
  await page.getByRole('button', { name: 'معاينة بهذا الدور' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function tap(page: Page, text: string | RegExp) {
  await page.locator('label').filter({ hasText: text }).first().click();
}

async function checkPage(page: Page, include?: string) {
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page, include);
}

async function fillContact(page: Page, name: string) {
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel(/Mobile number/).fill('01012345678');
}

async function requestNumber(page: Page, prefix: string) {
  const text = await page
    .getByText(new RegExp(`${prefix}-\\d{4}-\\d{6}`))
    .first()
    .textContent();
  return text?.match(new RegExp(`${prefix}-\\d{4}-\\d{6}`))?.[0] ?? '';
}

/** Repair request through the diagnostic (3D or its 2D fallback); returns the request number. */
async function submitRepair(page: Page, name: string) {
  await page.goto('/en/repairs/request');
  await tap(page, 'Smartphone');
  await tap(page, 'Apple');
  await page.getByLabel('Model').fill('iPhone 13 Pro');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Problem' })).toBeVisible();
  await tap(page, 'Battery');
  await expect(page.getByText(/What.s wrong with the Battery\?/)).toBeVisible();
  await tap(page, 'Drains quickly');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByLabel('Describe the problem')
    .fill('Battery drains in two hours since last week.');
  await page.locator('input[type=file]:not([capture])').first().setInputFiles(PHOTO);
  await expect(page.getByRole('status').filter({ hasText: 'uploaded' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Continue' }).click();
  await fillContact(page, name);
  await page.getByRole('button', { name: 'Submit repair request' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: /We.ve received your request/ }),
  ).toBeVisible();
  return requestNumber(page, 'RP');
}

async function openStaffRequest(page: Page, modulePath: string, number: string) {
  await signInAsStaff(page);
  await page.goto(`/admin/${modulePath}`);
  await page.getByRole('link', { name: number }).click();
  await expect(page.getByRole('heading', { level: 1, name: number })).toBeVisible();
}

async function backToCustomer(page: Page, email: string) {
  await page.evaluate(() => window.sessionStorage.clear());
  await signInAs(page, email);
}

test.describe('service experiences', () => {
  test.describe.configure({ timeout: 150_000 });

  test('A. services hub, landing pages and home promos lead to the real flows', async ({
    page,
  }) => {
    await page.goto('/en/services');
    await expect(page.getByRole('heading', { level: 1, name: 'Services' })).toBeVisible();
    for (const name of ['Repairs', 'Trade-In', 'Used device request', 'After-sales']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    await checkPage(page);

    await page.goto('/en/repairs');
    await expect(page.getByRole('heading', { level: 1, name: 'Device repairs' })).toBeVisible();
    await expect(page.getByText(/We never show automatic prices/)).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Start a repair request' }).first(),
    ).toHaveAttribute('href', '/en/repairs/request');
    await checkPage(page);

    await page.goto('/en/trade-in');
    await expect(
      page.getByText('Final valuation may change after physical inspection.'),
    ).toBeVisible();
    await checkPage(page);

    await page.goto('/en/used');
    await expect(page.getByText(/Availability isn't guaranteed/)).toBeVisible();
    await page.goto('/after-sales');
    await expect(
      page.getByRole('heading', { level: 1, name: 'الاستبدال والاسترجاع والضمان' }),
    ).toBeVisible();
    await checkPage(page);

    await page.goto('/en');
    await expect(page.getByRole('link', { name: 'Start a trade-in' }).first()).toHaveAttribute(
      'href',
      '/en/trade-in/request',
    );
    await expect(page.getByRole('link', { name: 'Request a repair' }).first()).toHaveAttribute(
      'href',
      '/en/repairs/request',
    );
  });

  test('B. repair request: diagnostic, photo, contact, number and account tracking', async ({
    page,
  }) => {
    await page.goto('/en');
    await signInAs(page, 'repair-b@example.com');
    await page.goto('/en/repairs/request');
    await expect(page.getByRole('heading', { level: 1, name: 'Repair request' })).toBeVisible();
    await checkPage(page);
    // Validation before moving on.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Choose the device type.')).toBeVisible();

    const number = await submitRepair(page, 'Repair Customer');
    expect(number).toMatch(/^RP-\d{4}-\d{6}$/);
    await page.getByRole('link', { name: 'Track request' }).click();
    await expect(page.getByRole('heading', { level: 1, name: number })).toBeVisible();
    await expect(page.getByText('Battery — Drains quickly')).toBeVisible();
    await expect(page.getByRole('img', { name: /^File 1/ })).toBeVisible();
    await expect(page.getByText('Request created')).toBeVisible();
    // No price exists until staff send one.
    await expect(page.getByText(/EGP|ج\.م/)).toHaveCount(0);
    await checkPage(page);

    await page.goto('/en/account/requests');
    await expect(page.getByRole('link', { name: new RegExp(number) })).toBeVisible();
    await page.getByLabel('Type').selectOption('trade_in');
    await expect(page.getByRole('link', { name: new RegExp(number) })).toHaveCount(0);
    await page.getByLabel('Type').selectOption('repair');
    await expect(page.getByRole('link', { name: new RegExp(number) })).toBeVisible();
    await checkPage(page);
  });

  test('C. "I’m not sure" and "Start a consultation" never need a part', async ({ page }) => {
    await page.goto('/en');
    await signInAs(page, 'repair-c@example.com');
    await page.goto('/en/repairs/request?device=laptop');
    await tap(page, 'Other brand');
    await page.getByLabel('Brand name').fill('Framework');
    await page.getByLabel('Model').fill('Laptop 13');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Start a consultation' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Details' })).toBeVisible();
    await page.getByLabel('Describe the problem').fill('It restarts randomly when charging.');
    await page.getByRole('button', { name: 'Continue' }).click();
    await fillContact(page, 'Consult Customer');
    await expect(page.getByText('Consultation', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Submit repair request' }).click();
    const number = await requestNumber(page, 'RP');
    await page.goto(`/en/account/requests/${number}`);
    await expect(page.getByRole('definition').filter({ hasText: 'Consultation' })).toBeVisible();
  });

  test('D. staff quote → customer approves; audited timeline and notification', async ({
    page,
  }) => {
    await page.goto('/en');
    await signInAs(page, 'repair-d@example.com');
    const number = await submitRepair(page, 'Quote Customer');

    await openStaffRequest(page, 'repairs', number);
    await checkPage(page);
    await page.getByLabel('المسؤول', { exact: true }).last().selectOption({ index: 1 });
    await page.getByRole('button', { name: 'حفظ التعيين' }).click();
    await expect(page.getByText('تم الحفظ.').first()).toBeVisible();
    await page.getByLabel('الحالة الجديدة').selectOption('diagnosing');
    await page.getByRole('button', { name: 'تحديث الحالة' }).click();
    await expect(
      page.getByLabel('الحالة الجديدة').locator('option[value="diagnosing"]'),
    ).toHaveCount(0);
    await page.getByLabel('النص').fill('Battery health 71% — replacement recommended.');
    await page.getByRole('button', { name: 'إضافة ملاحظة داخلية' }).click();
    await page.getByLabel('المبلغ (ج.م)').fill('1850');
    await page.getByRole('button', { name: 'إرسال العرض' }).click();
    await expect(page.getByText('عرض سعر مبدئي للصيانة · بانتظار الرد')).toBeVisible();

    await backToCustomer(page, 'repair-d@example.com');
    await page.goto(`/en/account/requests/${number}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Repair estimate' })).toBeVisible();
    await expect(page.getByText(/1,850/).first()).toBeVisible();
    // Internal notes never reach the customer.
    await expect(page.getByText('replacement recommended')).toHaveCount(0);
    await checkPage(page);
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText('Offer accepted')).toBeVisible();
    await expect(page.getByText('Customer approved').first()).toBeVisible();

    await page.goto('/en/account/notifications');
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Your repair quote is ready' }),
    ).toHaveCount(1);
  });

  test('E. trade-in: live target variant, staff valuation, difference, accept', async ({
    page,
  }) => {
    await page.goto('/en');
    await signInAs(page, 'trade-e@example.com');
    await page.goto('/en/trade-in?product=iphone-18-pro');
    await page.getByRole('link', { name: 'Start a trade-in' }).first().click();
    await expect(page).toHaveURL(/trade-in\/request\?product=iphone-18-pro/);
    await page.getByLabel('Brand').fill('Apple');
    await page.getByLabel('Model').fill('iPhone 13');
    await page.getByLabel('Storage').selectOption('128GB');
    await page.getByLabel('Battery health (%)').fill('86');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByText('Choose at least one condition, or “No known issue”.'),
    ).toBeVisible();
    await tap(page, 'Scratches');
    await tap(page, 'Original box');
    await page.locator('input[type=file]:not([capture])').first().setInputFiles(PHOTO);
    await expect(page.getByRole('status').filter({ hasText: 'uploaded' })).toHaveCount(1);
    await checkPage(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('button', { name: /iPhone 18 Pro\b/ }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await tap(page, '256GB');
    await tap(page, 'Orange');
    await expect(page.getByText(/Current store price/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await fillContact(page, 'Trade Customer');
    await page.getByRole('button', { name: 'Submit trade-in' }).click();
    const number = await requestNumber(page, 'TI');
    expect(number).toMatch(/^TI-/);

    await openStaffRequest(page, 'trade-in', number);
    await page.getByLabel('قيمة جهاز العميل (ج.م)').fill('15000');
    await page.getByLabel('ملاحظة الفحص (اختياري)').fill('Battery check in store');
    await expect(page.getByText(/الفرق: /)).toBeVisible();
    await page.getByRole('button', { name: 'إرسال العرض' }).click();
    await expect(page.getByText('عرض الاستبدال · بانتظار الرد')).toBeVisible();

    await backToCustomer(page, 'trade-e@example.com');
    await page.goto(`/en/account/requests/${number}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Trade-in offer' })).toBeVisible();
    await expect(page.getByText('Current device value')).toBeVisible();
    await expect(page.getByText('Difference you pay')).toBeVisible();
    await expect(
      page.getByText('Final valuation may change after physical inspection.'),
    ).toBeVisible();
    await expect(page.getByText(/Offer valid until/)).toBeVisible();
    await checkPage(page);
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText('Customer accepted').first()).toBeVisible();
    // Accepting never creates an order automatically.
    await page.goto('/en/account/orders');
    await expect(page.getByText('No orders yet.')).toBeVisible();
  });

  test('F. used-device request: preferences, staff proposal, customer decides', async ({
    page,
  }) => {
    await page.goto('/en');
    await signInAs(page, 'used-f@example.com');
    await page.goto('/en/used/request');
    for (const option of ['90% or more', '85–89%', '80–84%', 'No specific preference']) {
      await expect(page.locator('label').filter({ hasText: option }).first()).toBeVisible();
    }
    await page.getByLabel('Brand').fill('Apple');
    await page.getByLabel('Model').fill('iPhone 15');
    await tap(page, '90% or more');
    await page.getByLabel(/Budget/).fill('30000');
    await fillContact(page, 'Used Customer');
    await checkPage(page);
    await page.getByRole('button', { name: 'Submit request' }).click();
    const number = await requestNumber(page, 'UD');

    await openStaffRequest(page, 'used-requests', number);
    await page.getByLabel('السعر (ج.م)').fill('28500');
    await page.getByLabel('صحة البطارية (%)').fill('92');
    await page.locator('input[type=file]:not([capture])').last().setInputFiles(PHOTO);
    await expect(page.getByRole('status').filter({ hasText: 'تم رفع' })).toHaveCount(1);
    await page.getByRole('button', { name: 'إرسال الاقتراح' }).click();
    await expect(page.getByText('جهاز متاح لك · بانتظار الرد')).toBeVisible();

    await backToCustomer(page, 'used-f@example.com');
    await page.goto(`/en/account/requests/${number}`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Device we found for you' }),
    ).toBeVisible();
    await expect(page.getByText(/28,500/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Not interested' }).click();
    await expect(page.getByText('Offer declined')).toBeVisible();
  });

  test('G. after-sales: owned delivered items only, policy version, staff decision', async ({
    page,
  }) => {
    // Guests are sent to sign in (requests live in the customer's account).
    await page.goto('/en/after-sales/request');
    await expect(page).toHaveURL(/sign-in/);

    await signInAs(page, 'after-g@example.com');
    await page.goto('/en/after-sales/request');
    await expect(page.getByRole('heading', { name: 'No eligible items' })).toBeVisible();

    // Place and complete a pickup order, then request a return for it.
    await page.evaluate(() => {
      window.localStorage.setItem(
        'malek:v1:cart',
        JSON.stringify([
          {
            variantId: 'demo-variant-a20w-white',
            productSlug: null,
            quantity: 1,
            savedForLater: false,
            seenUnitPrice: null,
            addedAt: new Date().toISOString(),
          },
        ]),
      );
    });
    await page.goto('/en/checkout');
    await fillContact(page, 'After Customer');
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
    await signInAsStaff(page);
    await page.goto('/admin/orders');
    await page.getByRole('link', { name: orderNumber }).click();
    const next = page.getByLabel('الحالة التالية');
    for (const status of ['confirmed', 'preparing', 'ready_for_pickup']) {
      await next.selectOption(status);
      await page.getByRole('button', { name: 'تحديث الحالة' }).click();
      await expect(next.locator(`option[value="${status}"]`)).toHaveCount(0);
    }
    await page.getByRole('radio', { name: 'نقدي' }).check();
    await page.getByLabel('المبلغ (جنيه)').fill('1200');
    await page.getByRole('checkbox', { name: 'أؤكد أن المبلغ وصل فعليًا' }).check();
    await page.getByRole('button', { name: 'تسجيل الدفعة' }).click();
    await next.selectOption('completed');
    await page.getByRole('button', { name: 'تحديث الحالة' }).click();
    await expect(next).toHaveCount(0);

    await backToCustomer(page, 'after-g@example.com');
    await page.goto('/en/after-sales/request');
    await tap(page, /Apple 20W/);
    await tap(page, 'Return');
    await page.getByLabel('Reason').selectOption('defective');
    await page.getByLabel('Details').fill('The adapter stopped charging after two days.');
    await expect(page.getByText(/Policy version: /)).toBeVisible();
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByText('You need to accept the policy to continue.')).toBeVisible();
    await tap(page, /I.ve read and accept the policy/);
    await checkPage(page);
    await page.getByRole('button', { name: 'Submit request' }).click();
    const number = await requestNumber(page, 'AS');

    await openStaffRequest(page, 'after-sales', number);
    await page.getByRole('button', { name: 'رفض' }).click();
    await expect(page.getByText('اكتب سبب الرفض.')).toBeVisible();
    await page.getByRole('button', { name: 'موافقة' }).click();
    await expect(page.getByText('تمت الموافقة').first()).toBeVisible();

    await backToCustomer(page, 'after-g@example.com');
    await page.goto(`/en/account/requests/${number}`);
    await expect(page.getByText('Approved').first()).toBeVisible();
    await expect(page.getByText(orderNumber)).toBeVisible();
    await page.goto('/en/account/notifications');
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Your request was approved' }),
    ).toHaveCount(1);
  });

  test('H. drafts restore without media; invalid files never lose the form', async ({ page }) => {
    await page.goto('/en');
    await signInAs(page, 'draft-h@example.com');
    await page.goto('/en/repairs/request');
    await tap(page, 'Tablet');
    await page.getByLabel('Model').fill('iPad Air');
    await page.waitForTimeout(900); // draft save is debounced
    await page.reload();
    await expect(page.getByRole('region', { name: 'Saved draft' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByLabel('Model')).toHaveValue('iPad Air');

    await tap(page, 'Apple');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Start a consultation' }).click();
    await page.getByLabel('Describe the problem').fill('Screen flickers at low brightness.');
    await page
      .locator('input[type=file]:not([capture])')
      .first()
      .setInputFiles({
        name: 'fake.png',
        mimeType: 'image/png',
        buffer: Buffer.from('this is not really an image'),
      });
    await expect(page.getByText(/This file type isn.t supported/)).toBeVisible();
    await expect(page.getByLabel('Describe the problem')).toHaveValue(
      'Screen flickers at low brightness.',
    );
    await page.getByRole('button', { name: /^Remove/ }).click();

    await page.reload();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('region', { name: 'Saved draft' })).toHaveCount(0);
    await expect(page.getByLabel('Model')).toHaveCount(0);
  });

  test('I. privacy, 2D fallback without WebGL and a lazy 3D bundle', async ({ page }) => {
    const chunks: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('Diagnostic3D')) chunks.push(r.url());
    });
    await page.goto('/en');
    await signInAs(page, 'owner-i@example.com');
    for (const path of [
      '/en',
      '/en/store',
      '/en/product/iphone-18-pro',
      '/en/cart',
      '/en/account',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    }
    expect(chunks).toEqual([]);

    const number = await submitRepair(page, 'Owner Customer');
    // Another customer cannot open it; the seeded demo requests have no owner either.
    await backToCustomer(page, 'other-i@example.com');
    await page.goto(`/en/account/requests/${number}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Request not found' })).toBeVisible();
    await page.goto('/en/account/requests/RP-2026-900001');
    await expect(page.getByRole('heading', { level: 1, name: 'Request not found' })).toBeVisible();
    // Guests are sent to sign in.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto(`/en/account/requests/${number}`);
    await expect(page).toHaveURL(/sign-in/);
  });

  test('I2. without WebGL the diagnostic falls back to the accessible 2D diagram', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        if (type.startsWith('webgl')) return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...args);
      } as typeof original;
    });
    await page.goto('/en');
    await signInAs(page, 'fallback-i@example.com');
    await page.goto('/en/repairs/request?device=smartphone');
    await tap(page, 'Samsung');
    await page.getByLabel('Model').fill('Galaxy S23');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/3D isn.t available on this device/)).toBeVisible();
    await expect(page.locator('[role=application]')).toHaveCount(0);
    await tap(page, 'Screen');
    await expect(page.getByText(/What.s wrong with the Screen\?/)).toBeVisible();
    await checkPage(page);
  });
});
