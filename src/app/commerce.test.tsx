import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import baseSeed from '@seed/base/site-settings.json';
import { renderApp } from '@/test/renderApp';

const T = { timeout: 5000 };
const ADAPTER = 'demo-variant-a20w-white'; // Apple 20W adapter, 1,200 EGP
const AIRPODS = 'demo-variant-ap4-standard-white'; // AirPods 4, 7,500 EGP
const CABLE = 'demo-variant-usbc-1m-white'; // USB-C cable, 900 EGP (DEMO10 target)

function seedCart(lines: { variantId: string; quantity: number; seenUnitPrice?: number | null }[]) {
  window.localStorage.setItem(
    'malek:v1:cart',
    JSON.stringify(
      lines.map((l) => ({
        variantId: l.variantId,
        productSlug: null,
        quantity: l.quantity,
        savedForLater: false,
        seenUnitPrice: l.seenUnitPrice ?? null,
        addedAt: '2026-09-25T10:00:00.000Z',
      })),
    ),
  );
}

function signInAs(email: string) {
  window.sessionStorage.setItem(
    'malek:v1:demo-session',
    JSON.stringify({ userId: `demo-customer-${email}`, email, roleKey: null }),
  );
}

async function fillContact(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { level: 2, name: 'Contact' }, T);
  await user.clear(screen.getByLabelText('Full name'));
  await user.type(screen.getByLabelText('Full name'), 'Mona Adel');
  await user.clear(screen.getByLabelText(/Mobile number/));
  await user.type(screen.getByLabelText(/Mobile number/), '+20 101 234 5678');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('guest cart → checkout → order', { timeout: 30_000 }, () => {
  it('keeps a guest cart, requires sign-in only at checkout, and creates a pickup order', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/en/product/apple-20w-usb-c-adapter', {
      settings: { store: { ...baseSeed.settings.store, whatsappNumber: '01000000001' } },
    });
    await user.click(await screen.findByRole('button', { name: /Add to cart/ }, T));
    expect(await screen.findByText('In cart: 1')).toBeInTheDocument();

    await router.navigate('/en/cart');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Shopping cart' }),
    ).toBeInTheDocument();
    const summary = await screen.findByRole('complementary', { name: 'Order summary' });
    await waitFor(() => expect(within(summary).getAllByText(/1,200/).length).toBeGreaterThan(0));
    // Quantity changes are re-quoted by the pricing engine.
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await waitFor(() => expect(within(summary).getAllByText(/2,400/).length).toBeGreaterThan(0));

    await user.click(within(summary).getByRole('link', { name: 'Checkout' }));
    // Browsing and the cart are anonymous; checkout asks for sign-in and comes back.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in' }, T),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe('?next=%2Fen%2Fcheckout');
    await user.type(screen.getByLabelText('Email address'), 'mona@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/en/checkout'), T);

    await fillContact(user);
    await screen.findByRole('heading', { level: 2, name: 'Fulfillment' }, T);
    await user.click(screen.getByRole('radio', { name: /Store pickup/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 2, name: 'Payment' }, T);
    await user.click(screen.getByRole('radio', { name: /Cash on delivery/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 2, name: 'Review' }, T);
    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your order has been placed' }, T),
    ).toBeInTheDocument();
    const number = router.state.location.pathname.split('/').pop() ?? '';
    expect(number).toMatch(/^MS-\d{4}-\d{6}$/);
    expect(screen.getByText(number)).toBeInTheDocument();
    expect(screen.getByText('Demo order')).toBeInTheDocument();
    // WhatsApp hand-off only after the order exists, prefilled with the order number.
    const wa = screen.getByRole('link', { name: /Continue on WhatsApp/ });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/20\d+\?text=/);
    expect(decodeURIComponent(wa.getAttribute('href') ?? '')).toContain(number);
    expect(screen.getByRole('link', { name: /Print invoice/ })).toHaveAttribute(
      'href',
      `/en/order/${number}/invoice`,
    );
    // The ordered lines left the cart.
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'Cart' }).length).toBeGreaterThan(0),
    );
    await router.navigate('/en/account');
    expect(await screen.findByRole('link', { name: new RegExp(number) }, T)).toBeInTheDocument();

    await router.navigate(`/en/order/${number}/invoice`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Order invoice' }, T),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print / save as PDF' })).toBeInTheDocument();
    expect(screen.getByText('Order receipt — not a tax invoice.')).toBeInTheDocument();
    expect(screen.queryByText(/VAT/)).not.toBeInTheDocument();
  }, 30_000);

  it('flags a price change and blocks checkout until the customer accepts it', async () => {
    const user = userEvent.setup();
    seedCart([{ variantId: AIRPODS, quantity: 1, seenUnitPrice: 7000 }]);
    renderApp('/en/cart');
    const alert = await screen.findByText('Price updated.', undefined, T);
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/Price changed from/)).toBeInTheDocument();
    const checkout = screen.getByRole('link', { name: 'Checkout' });
    expect(checkout).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Accept the new prices' }));
    await waitFor(() => expect(screen.queryByText('Price updated.')).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Checkout' })).not.toHaveAttribute('aria-disabled');
  });

  it('reports sold-out and over-stock lines instead of silently changing them', async () => {
    seedCart([
      { variantId: 'demo-variant-awu3-titanium', quantity: 1 },
      { variantId: AIRPODS, quantity: 5 },
    ]);
    renderApp('/en/cart');
    expect(await screen.findByText('Sold out.', undefined, T)).toBeInTheDocument();
    expect(screen.getByText('Fix the marked items before checking out.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Checkout' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('applies DEMO10 on a delivery + InstaPay order; shipping stays "to be confirmed"', async () => {
    const user = userEvent.setup();
    signInAs('promo@example.com');
    seedCart([
      { variantId: AIRPODS, quantity: 1 },
      { variantId: CABLE, quantity: 2 },
    ]);
    const { router } = renderApp('/en/checkout', {
      // The demo data source switches promo codes on; the shipped base settings keep them off.
      settings: { features: { ...baseSeed.settings.features, promoCodes: true } },
    });
    await fillContact(user);
    await screen.findByRole('heading', { level: 2, name: 'Fulfillment' }, T);
    await user.click(screen.getByRole('radio', { name: /Delivery/ }));
    await user.selectOptions(screen.getByLabelText('Governorate'), 'giza');
    await user.type(screen.getByLabelText('Area / city'), 'Dokki');
    await user.type(screen.getByLabelText(/Full address/), '12 Tahrir St, floor 3');
    expect(
      screen.getByText(/confirms the shipping fee before the order is confirmed/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 2, name: 'Payment' }, T);
    await user.click(screen.getByRole('radio', { name: /^InstaPay ?Transfer the full amount/ }));
    expect(
      screen.getByText(/A transfer screenshot alone doesn't mean the order is paid/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 2, name: 'Review' }, T);

    await user.type(screen.getByLabelText('Promo code'), 'NOPE');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText("This code isn't valid.", undefined, T)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Promo code'));
    await user.type(screen.getByLabelText('Promo code'), 'demo10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/DEMO10 applied/, undefined, T)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your order has been placed' }, T),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/^\/en\/order\/MS-/);
    expect(screen.getAllByText('To be confirmed').length).toBeGreaterThan(0);
    expect(screen.getByText('Total before shipping')).toBeInTheDocument();
    expect(screen.getAllByText('Awaiting transfer').length).toBeGreaterThan(0);
    expect(screen.getByText('Promo code used: DEMO10')).toBeInTheDocument();
    // The street address is shown once (not repeated after governorate/area).
    expect(screen.getAllByText(/12 Tahrir St, floor 3/)).toHaveLength(1);
    expect(screen.getByText(/Giza, Dokki/)).toBeInTheDocument();
    // DEMO10 only targets accessories: 7,500 + 2 × 900 − 10% × 1,800 = 9,120.
    expect(screen.getAllByText(/9,120/).length).toBeGreaterThan(0);
  }, 30_000);

  it('offers exactly the three V1 payment methods (COD, InstaPay, split) — never pay-at-store', async () => {
    const user = userEvent.setup();
    signInAs('methods@example.com');
    seedCart([{ variantId: ADAPTER, quantity: 1 }]);
    renderApp('/en/checkout', {
      // Even a stray legacy flag must not surface pay-at-store.
      settings: { features: { ...baseSeed.settings.features, payAtStore: true } },
    });
    await fillContact(user);
    await screen.findByRole('heading', { level: 2, name: 'Fulfillment' }, T);
    await user.click(screen.getByRole('radio', { name: /Store pickup/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 2, name: 'Payment' }, T);
    const group = screen.getByRole('group', { name: 'Choose a payment method' });
    const names = within(group)
      .getAllByRole('radio')
      .map(
        (radio) => radio.getAttribute('aria-label') ?? radio.closest('label')?.textContent ?? '',
      );
    expect(names).toHaveLength(3);
    expect(names[0]).toMatch(/^Cash on delivery/);
    expect(names[1]).toMatch(/^InstaPay/);
    expect(names[2]).toMatch(/^InstaPay deposit/);
    expect(screen.queryByText(/Pay at the store/)).not.toBeInTheDocument();
  });

  it('validates the Egyptian phone number without any SMS step', async () => {
    const user = userEvent.setup();
    signInAs('phone@example.com');
    seedCart([{ variantId: ADAPTER, quantity: 1 }]);
    renderApp('/en/checkout');
    await screen.findByRole('heading', { level: 2, name: 'Contact' }, T);
    expect(screen.getByText(/No SMS verification/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Full name'), 'Omar');
    await user.type(screen.getByLabelText(/Mobile number/), '0123');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/Enter a valid Egyptian mobile number/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Mobile number/)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('order privacy and staff operations (demo adapter)', { timeout: 30_000 }, () => {
  async function placeOrder(email: string, fulfillment: 'pickup' | 'delivery') {
    signInAs(email);
    const { runtime, unmount } = renderApp('/en');
    const quote = await runtime.repositories.commerce.quote([{ variantId: ADAPTER, quantity: 1 }], {
      fulfillment,
    });
    const result = await runtime.repositories.commerce.createOrder({
      items: [{ variantId: ADAPTER, quantity: 1, expectedUnitPrice: 1200 }],
      expectedTotal: quote.totals.total,
      promoCode: null,
      contact: { name: 'Hany', phone: '01112223334' },
      fulfillment:
        fulfillment === 'pickup'
          ? { method: 'pickup', branchId: 'abbasseya' }
          : {
              method: 'delivery',
              governorate: 'cairo',
              area: 'Nasr City',
              address: '5 Abbas El Akkad',
              notes: null,
            },
      payment: { method: 'cod', depositAmount: null },
      note: null,
      locale: 'en',
      idempotencyKey: `test-${email}`,
    });
    unmount();
    if (!result.ok) throw new Error(result.code);
    return result.order;
  }

  it('another customer cannot open an order by guessing its number', async () => {
    const order = await placeOrder('owner-a@example.com', 'pickup');
    signInAs('other-b@example.com');
    renderApp(`/en/order/${order.orderNumber}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Order not found' }, T),
    ).toBeInTheDocument();
    expect(screen.queryByText('Hany')).not.toBeInTheDocument();
  });

  it('staff set the shipping fee, confirm (stock committed once) and record verified cash', async () => {
    const order = await placeOrder('staffflow@example.com', 'delivery');
    window.sessionStorage.clear();
    const user = userEvent.setup();
    renderApp('/admin/orders');
    await user.selectOptions(await screen.findByLabelText('الدور', undefined, T), 'owner');
    await user.click(screen.getByRole('button', { name: 'معاينة بهذا الدور' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'الطلبات' }, T),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('link', { name: order.orderNumber }, T));
    expect(
      await screen.findByRole('heading', { level: 1, name: order.orderNumber }, T),
    ).toBeInTheDocument();

    // Confirming a delivery order before the fee is set is refused by the backend rules.
    await user.selectOptions(screen.getByLabelText('الحالة التالية'), 'confirmed');
    await user.click(screen.getByRole('button', { name: 'تحديث الحالة' }));
    expect(
      await screen.findByText('حدد مصاريف الشحن قبل التأكيد.', undefined, T),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('مصاريف الشحن (جنيه)'), '75');
    await user.click(screen.getByRole('button', { name: 'حفظ الشحن' }));
    await waitFor(() => expect(screen.getAllByText(/1,275/).length).toBeGreaterThan(0), T);

    await user.selectOptions(screen.getByLabelText('الحالة التالية'), 'confirmed');
    await user.click(screen.getByRole('button', { name: 'تحديث الحالة' }));
    expect(await screen.findByText('المخزون مخصوم', undefined, T)).toBeInTheDocument();

    // Recording money needs the explicit "actually received" confirmation.
    const record = screen.getByRole('button', { name: 'تسجيل الدفعة' });
    expect(record).toBeDisabled();
    await user.type(screen.getByLabelText('المبلغ (جنيه)'), '5000');
    await user.click(screen.getByLabelText('أؤكد أن المبلغ وصل فعليًا'));
    await user.click(record);
    expect(await screen.findByText('المبلغ أكبر من المتبقي.', undefined, T)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('المبلغ (جنيه)'));
    await user.type(screen.getByLabelText('المبلغ (جنيه)'), '1275');
    await user.click(screen.getByRole('button', { name: 'تسجيل الدفعة' }));
    expect(await screen.findAllByText('مدفوع', undefined, T)).not.toHaveLength(0);
    // Every step is in the order history.
    const history = screen
      .getByRole('heading', { name: 'سجل الطلب' })
      .closest('div') as HTMLElement;
    expect(within(history).getAllByText(/الموظف/).length).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it('a role without payments.verify cannot record payments', async () => {
    const order = await placeOrder('sales@example.com', 'pickup');
    window.sessionStorage.clear();
    const user = userEvent.setup();
    renderApp(`/admin/orders/${order.id}`);
    await user.selectOptions(await screen.findByLabelText('الدور', undefined, T), 'sales');
    await user.click(screen.getByRole('button', { name: 'معاينة بهذا الدور' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: order.orderNumber }, T),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تسجيل الدفعة' })).not.toBeInTheDocument();
  }, 20_000);
});
