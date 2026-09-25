import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNoSeriousA11yViolations } from './helpers';

/** Phase 04 customer journeys (demo mode, in-app only, no paid services) on every viewport. */

const ADAPTER = 'demo-variant-a20w-white'; // Apple 20W USB-C Power Adapter, 1,200 EGP
const CABLE = 'demo-variant-usbc-1m-white';

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

async function seedCart(page: Page, lines: { variantId: string; quantity: number }[]) {
  await page.evaluate((items) => {
    window.localStorage.setItem(
      'malek:v1:cart',
      JSON.stringify(
        items.map((l) => ({
          variantId: l.variantId,
          productSlug: null,
          quantity: l.quantity,
          savedForLater: false,
          seenUnitPrice: null,
          addedAt: new Date().toISOString(),
        })),
      ),
    );
  }, lines);
}

async function checkPage(page: Page, include?: string) {
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page, include);
}

/** Pickup + cash on delivery order for the signed-in customer; returns the order number. */
async function placePickupOrder(page: Page, name: string) {
  await seedCart(page, [{ variantId: ADAPTER, quantity: 1 }]);
  await page.goto('/en/checkout');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel(/Mobile number/).fill('01012345678');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Store pickup/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Cash on delivery/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your order has been placed' }),
  ).toBeVisible();
  return page.url().match(/MS-\d{4}-\d{6}/)?.[0] ?? '';
}

/** Staff move a pickup order through to "completed" (cash recorded as actually received). */
async function completePickupOrder(page: Page, orderNumber: string) {
  await signInAsStaff(page);
  await page.goto('/admin/orders');
  await page.getByRole('link', { name: orderNumber }).click();
  await expect(page.getByRole('heading', { level: 1, name: orderNumber })).toBeVisible();
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
  await expect(page.getByText('المدفوعات المؤكدة')).toBeVisible();
  await next.selectOption('completed');
  await page.getByRole('button', { name: 'تحديث الحالة' }).click();
  await expect(next).toHaveCount(0);
}

test.describe('customer features', () => {
  test.describe.configure({ timeout: 120_000 });

  test('A. guest wishlist: save on the product page, survives a refresh', async ({ page }) => {
    await page.goto('/en/product/iphone-18-pro');
    const save = page.getByRole('button', { name: /^Save\s*: iPhone 18 Pro/ });
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    const saved = page.getByRole('button', { name: /^Saved\s*: iPhone 18 Pro/ });
    await expect(saved).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('status').filter({ hasText: 'saved to your wishlist' }),
    ).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('button', { name: /^Saved\s*: iPhone 18 Pro/ })).toBeVisible();

    await page.goto('/en/wishlist');
    await expect(page.getByRole('heading', { level: 1, name: 'Wishlist' })).toBeVisible();
    await expect(page.getByText('saved on this browser only')).toBeVisible();
    await expect(page.getByRole('link', { name: /iPhone 18 Pro/ }).first()).toBeVisible();
    await checkPage(page);

    // Card toggle: accessible name + pressed state, never colour alone.
    await page.goto('/en/category/phones');
    const cardToggle = page.getByRole('button', {
      name: 'Remove iPhone 18 Pro from wishlist',
      exact: true,
    });
    await expect(cardToggle).toHaveAttribute('aria-pressed', 'true');
    await cardToggle.click();
    await expect(
      page.getByRole('button', { name: 'Save iPhone 18 Pro to wishlist', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('B. sign-in merges the guest wishlist and cart into the account', async ({ page }) => {
    await page.goto('/en/product/airpods-4');
    await page.getByRole('button', { name: /^Save\s*: AirPods 4/ }).click();
    await expect(page.getByRole('button', { name: /^Saved\s*: AirPods 4/ })).toBeVisible();
    await seedCart(page, [{ variantId: CABLE, quantity: 2 }]);

    await signInAs(page, 'merge-b@example.com');
    await page.goto('/en/wishlist');
    await expect(page.getByRole('link', { name: /AirPods 4/ }).first()).toBeVisible();
    await expect(page.getByText('saved on this browser only')).toHaveCount(0);
    // The browser copy is cleared only after the account merge succeeded.
    expect(await page.evaluate(() => window.localStorage.getItem('malek:v1:wishlist'))).toBeNull();

    await page.goto('/en/cart');
    await expect(page.getByText('USB-C').first()).toBeVisible();

    // Another customer on the same device never sees it.
    await signInAs(page, 'other-b2@example.com');
    await page.goto('/en/wishlist');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Your wishlist is empty' }),
    ).toBeVisible();
  });

  test('C. account: profile, saved addresses reused at checkout, order access', async ({
    page,
  }) => {
    await page.goto('/en');
    await signInAs(page, 'account-c@example.com');
    await page.goto('/en/account/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
    await page.getByLabel('Full name').fill('Salma Hassan');
    await page.getByLabel(/Mobile number/).fill('0101234567');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Egyptian mobile').first()).toBeVisible();
    await page.getByLabel(/Mobile number/).fill('01012345678');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Your profile was saved.' }),
    ).toBeVisible();
    await checkPage(page);

    await page.getByRole('link', { name: 'Addresses' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Saved addresses' })).toBeVisible();
    await page.getByRole('button', { name: 'Add address' }).first().click();
    await page.getByLabel('Governorate').selectOption('giza');
    await page.getByLabel('Area / city').fill('Dokki');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('Enter the full address.')).toBeVisible();
    await page.getByLabel(/Full address/).fill('12 Tahrir St, floor 3');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('12 Tahrir St, floor 3')).toBeVisible();
    await expect(page.getByText('Default', { exact: true })).toBeVisible();
    await checkPage(page);

    // Checkout preselects the default saved address.
    await seedCart(page, [{ variantId: ADAPTER, quantity: 1 }]);
    await page.goto('/en/checkout');
    await expect(page.getByLabel('Full name')).toHaveValue('Salma Hassan');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: /^Delivery/ }).check();
    await expect(page.getByRole('radio', { name: /Home · Default/ })).toBeChecked();
    await expect(page.getByLabel('Area / city')).toHaveValue('Dokki');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: /Cash on delivery/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your order has been placed' }),
    ).toBeVisible();
    const orderNumber = page.url().match(/MS-\d{4}-\d{6}/)?.[0] ?? '';

    await page.goto('/en/account/orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
    await expect(page.getByText(orderNumber)).toBeVisible();
    await page.getByRole('button', { name: 'Cancelled' }).click();
    await expect(page.getByText('No orders in this section.')).toBeVisible();
    await page.getByRole('button', { name: 'Current' }).click();
    await expect(page.getByText(orderNumber)).toBeVisible();
    await checkPage(page);

    // Signed out, the account area asks to sign in.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto('/en/account/addresses');
    await expect(page).toHaveURL(/\/en\/account\/sign-in/);
  });

  test('D. compare: same-category products side by side, incompatible explained', async ({
    page,
  }) => {
    await page.goto('/en/category/phones');
    await page.getByRole('button', { name: 'Add iPhone 18 Pro to compare', exact: true }).click();
    await page.getByRole('button', { name: 'Add iPhone 17 to compare', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Compare (2/4)' })).toBeVisible();

    await page.goto('/en/category/audio');
    await page.getByRole('button', { name: 'Add AirPods 4 to compare', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: "can't be compared" }).first(),
    ).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Compare (2/4)' })).toBeVisible();

    await page.getByRole('link', { name: 'Compare (2/4)' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Compare products' })).toBeVisible();
    const region = page.getByRole('region', { name: 'Comparison of 2 products' });
    await expect(region).toBeVisible();
    await expect(region.getByRole('rowheader', { name: 'Price' })).toBeVisible();
    await expect(region.getByRole('columnheader', { name: /iPhone 17/ })).toBeVisible();
    // The table scrolls inside its own keyboard-focusable region; the page never does.
    await region.focus();
    await expect(region).toBeFocused();
    await checkPage(page);

    await page.getByRole('checkbox', { name: 'Show differences only' }).check();
    await region.getByRole('button', { name: /Remove\s*: iPhone 17/ }).click();
    await expect(page.getByText('Add at least one more product to compare.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear comparison' }).click();
    await expect(page.getByRole('heading', { name: 'Nothing to compare yet' })).toBeVisible();
  });

  test('E. verified review: eligible buyer → pending → staff approval → public', async ({
    page,
  }) => {
    await page.goto('/en/product/apple-20w-usb-c-adapter');
    await expect(page.getByRole('heading', { level: 2, name: 'Customer reviews' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in to review' })).toBeVisible();

    // A signed-in customer without a completed purchase cannot review.
    await signInAs(page, 'reviewer-e@example.com');
    await page.reload();
    await expect(page.getByText('Only customers who bought this product').first()).toBeVisible();

    const orderNumber = await placePickupOrder(page, 'Hany Adel');
    await page.goto('/en/product/apple-20w-usb-c-adapter');
    await expect(page.getByText('once your order has been delivered')).toBeVisible();

    await completePickupOrder(page, orderNumber);

    await signInAs(page, 'reviewer-e@example.com');
    await page.goto('/en/product/apple-20w-usb-c-adapter');
    const form = page.getByRole('form', { name: /Review Apple 20W USB-C Power Adapter/ });
    await expect(form).toBeVisible();
    await form.getByRole('button', { name: 'Submit review' }).click();
    await expect(form.getByText('Please choose a rating.')).toBeVisible();
    await form.getByRole('radio', { name: '5 out of 5 stars' }).check({ force: true });
    await form.getByLabel('Your review').fill('Charges my phone quickly and stays cool.');
    await checkPage(page, 'form');
    await form.getByRole('button', { name: 'Submit review' }).click();
    await expect(page.getByText('Awaiting review')).toBeVisible();
    // Pending reviews are never public.
    await expect(page.getByText('Charges my phone quickly')).toHaveCount(0);
    await page.goto('/en/account/reviews');
    await expect(page.getByText('Charges my phone quickly')).toBeVisible();
    await expect(page.getByText('Awaiting review')).toBeVisible();

    await signInAsStaff(page);
    await page.goto('/admin/reviews');
    await expect(page.getByRole('heading', { level: 1, name: 'مراجعة التقييمات' })).toBeVisible();
    const card = page.getByRole('listitem').filter({ hasText: 'Charges my phone quickly' });
    await expect(card.getByText('مشتري موثّق')).toBeVisible();
    await checkPage(page);
    await card.getByRole('button', { name: 'موافقة ونشر' }).click();
    await expect(page.getByText('لا توجد تقييمات بهذه الحالة.')).toBeVisible();

    await signInAs(page, 'reviewer-e@example.com');
    await page.goto('/en/product/apple-20w-usb-c-adapter');
    await expect(page.getByText('Charges my phone quickly and stays cool.')).toBeVisible();
    await expect(page.getByText('Verified buyer').first()).toBeVisible();
    await expect(page.getByText('Hany A.')).toBeVisible();
    await page.goto('/en/account/notifications');
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Your review is published' }),
    ).toHaveCount(1);
  });

  test('F. notifications: order status → inbox → mark read', async ({ page }) => {
    await page.goto('/en');
    await signInAs(page, 'inbox-f@example.com');
    const orderNumber = await placePickupOrder(page, 'Nour Ali');
    await page.goto('/en/account/notifications');
    await expect(page.getByRole('heading', { level: 2, name: 'No notifications' })).toBeVisible();

    await signInAsStaff(page);
    await page.goto('/admin/orders');
    await page.getByRole('link', { name: orderNumber }).click();
    await page.getByLabel('الحالة التالية').selectOption('confirmed');
    await page.getByRole('button', { name: 'تحديث الحالة' }).click();
    await expect(page.getByText('المخزون مخصوم').first()).toBeVisible();

    await signInAs(page, 'inbox-f@example.com');
    await page.goto('/en/account/notifications');
    const list = page.getByRole('list', { name: 'Notification list' });
    await expect(
      list.getByRole('listitem').filter({ hasText: 'Your order is confirmed' }),
    ).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '1 unread' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Notifications\s*1 unread/ })).toBeVisible();
    await checkPage(page);
    await list.getByRole('button', { name: /^Mark as read/ }).click();
    await expect(page.getByRole('status').filter({ hasText: '0 unread' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark all as read' })).toHaveCount(0);

    // Preferences: in-app only; order notifications are mandatory; other channels are not offered.
    const prefs = page.getByRole('table', { name: 'Notification preferences' });
    await expect(
      prefs.getByRole('checkbox', { name: /In-app Orders notifications/ }),
    ).toBeDisabled();
    await expect(prefs.getByText('Not available yet').first()).toBeVisible();
    const priceDrops = prefs.getByRole('checkbox', { name: /In-app Price drops notifications/ });
    await priceDrops.uncheck();
    await expect(priceDrops).not.toBeChecked();

    // Opening the same inbox again never duplicates the status notification.
    await page.reload();
    await expect(
      list.getByRole('listitem').filter({ hasText: 'Your order is confirmed' }),
    ).toHaveCount(1);
  });

  test('G. notify me and waitlist show up in the account requests area', async ({ page }) => {
    await page.goto('/en');
    await signInAs(page, 'requests-g@example.com');
    await page.goto('/en/product/iphone-18-pro?storage=1tb&color=orange');
    await page.getByRole('button', { name: 'Notify me when available' }).click();
    const dialog = page.getByRole('dialog', { name: 'Notify me when available' });
    await dialog.getByLabel('Name').fill('Mona');
    await dialog.getByLabel('Mobile number').fill('01012345678');
    await dialog.getByRole('button', { name: 'Register' }).click();
    await expect(dialog.getByText('You’re registered')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/en/product/iphone-duo');
    await page.getByRole('button', { name: 'Join the waitlist' }).first().click();
    const waitlist = page.getByRole('dialog');
    await waitlist.getByLabel('Name').fill('Mona');
    await waitlist.getByLabel('Mobile number').fill('01012345678');
    await waitlist.getByRole('button', { name: /Register|Join/ }).click();
    await expect(waitlist.getByText('You’re registered')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/en/account/requests');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Alerts and waitlists' }),
    ).toBeVisible();
    const notify = page.getByRole('region', { name: 'Notify me' });
    await expect(notify.getByRole('link', { name: 'iPhone 18 Pro', exact: true })).toBeVisible();
    await expect(notify.getByText('Waiting')).toBeVisible();
    const waitlists = page.getByRole('region', { name: 'Waitlists' });
    await expect(waitlists.getByRole('link', { name: 'iPhone Duo', exact: true })).toBeVisible();
    // Phase 05 services are placeholders only.
    await expect(page.getByText('Repair requests')).toBeVisible();
    await checkPage(page);

    await notify.getByRole('button', { name: /Cancel request\s*: iPhone 18 Pro/ }).click();
    await expect(notify.getByText('Cancelled')).toBeVisible();
  });

  test('H. abandoned cart: continuation card, one reminder, staff view', async ({ page }) => {
    await page.goto('/en');
    await signInAs(page, 'cart-h@example.com');
    await seedCart(page, [{ variantId: CABLE, quantity: 1 }]);
    await page.goto('/en/cart');
    await expect(page.getByText('USB-C').first()).toBeVisible();
    await page.goto('/en/account');
    await expect(page.getByRole('heading', { level: 2, name: 'Your cart' })).toBeVisible();

    // Simulate three idle days (the threshold is 48h by default).
    await page.evaluate(() => {
      const key = 'malek:v1:demo-commerce';
      const state = JSON.parse(window.localStorage.getItem(key) ?? '{}');
      state.cartActivity = {
        ...state.cartActivity,
        'demo-customer-cart-h@example.com': new Date(Date.now() - 72 * 3600_000).toISOString(),
      };
      window.localStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Your cart is waiting' }),
    ).toBeVisible();
    await checkPage(page);
    await page.goto('/en/account/notifications');
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Your cart is waiting' }),
    ).toHaveCount(1);
    await page.reload();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Your cart is waiting' }),
    ).toHaveCount(1);
    await page.goto('/en/account');
    await page.getByRole('link', { name: 'Continue your cart' }).click();
    await expect(page).toHaveURL(/\/en\/cart$/);

    await signInAsStaff(page);
    await page.goto('/admin/abandoned-carts');
    await expect(page.getByRole('heading', { level: 1, name: 'السلات المتروكة' })).toBeVisible();
    await expect(page.getByText('cart-h@example.com')).toBeVisible();
    await expect(page.getByText('تم إرسال تذكير')).toBeVisible();
    await checkPage(page);
  });

  test('recommendations and recently viewed on the product page', async ({ page }) => {
    await page.goto('/en/product/airpods-4');
    await expect(page.getByRole('heading', { level: 1, name: 'AirPods 4' })).toBeVisible();
    await page.goto('/en/product/iphone-18-pro');
    const together = page.getByRole('region', { name: 'Frequently bought together' });
    await expect(together.getByText('Apple 20W USB-C Power Adapter')).toBeVisible();
    // The case is an explicit accessory/compatible relation (never guessed from its name); rails
    // are de-duplicated, so it appears once, under Accessories.
    const accessories = page.getByRole('region', { name: 'Accessories' });
    await expect(accessories.getByText('Clear Case with MagSafe for iPhone 18 Pro')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Compatible with this product' })).toHaveCount(0);
    const recent = page.getByRole('region', { name: 'Recently viewed' });
    await expect(recent.getByText('AirPods 4')).toBeVisible();
    // Demo reviews are labelled as demo, never presented as verified buyers.
    const reviews = page.getByRole('region', { name: 'Customer reviews' });
    await expect(reviews.getByText('Demo review').first()).toBeVisible();
    await expect(reviews.getByText('Verified buyer')).toHaveCount(0);
    await checkPage(page);
  });

  test('I. Arabic: account area, wishlist and compare are RTL and accessible', async ({ page }) => {
    await page.goto('/');
    await signInAs(page, 'arabic-i@example.com');
    await page.goto('/account');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'حسابي' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'أقسام الحساب' })).toBeVisible();
    await expect(page.getByText('لا توجد طلبات حتى الآن.')).toBeVisible();
    await checkPage(page);
    for (const [link, heading] of [
      ['الإشعارات', 'الإشعارات'],
      ['طلبات التنبيه', 'طلبات التنبيه والانتظار'],
      ['تقييماتي', 'تقييماتي'],
      ['العناوين', 'العناوين المحفوظة'],
      ['الملف الشخصي', 'الملف الشخصي'],
    ]) {
      await page
        .getByRole('navigation', { name: 'أقسام الحساب' })
        .getByRole('link', { name: link, exact: true })
        .click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await checkPage(page);
    }
    await page.goto('/wishlist');
    await expect(page.getByRole('heading', { level: 1, name: 'المفضلة' })).toBeVisible();
    await checkPage(page);
    await page.goto('/compare');
    await expect(page.getByRole('heading', { level: 1, name: 'مقارنة المنتجات' })).toBeVisible();
    await checkPage(page);
  });

  test('J. English: account navigation works from the keyboard', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard navigation is checked on desktop viewports');
    await page.goto('/en');
    await signInAs(page, 'english-j@example.com');
    await page.goto('/en/account');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Account sections' });
    const orders = nav.getByRole('link', { name: 'Orders', exact: true });
    await orders.focus();
    await expect(orders).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
    await expect(orders).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name: 'Wishlist', exact: true })).toBeFocused();
    await checkPage(page);
  });
});
