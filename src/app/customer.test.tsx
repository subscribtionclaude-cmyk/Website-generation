import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

/** Phase 04 customer features through the real app shell (demo runtime, jsdom). */

const T = { timeout: 5000 };

function signInAs(email: string) {
  window.sessionStorage.setItem(
    'malek:v1:demo-session',
    JSON.stringify({ userId: `demo-customer-${email}`, email, roleKey: null }),
  );
}

describe('customer features', { timeout: 30_000 }, () => {
  it('guest wishlist is kept in the browser and merged into the account at sign-in', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/en/product/airpods-4');
    const save = await screen.findByRole('button', { name: /^Save\s*: AirPods 4/ }, T);
    expect(save).toHaveAttribute('aria-pressed', 'false');
    await user.click(save);
    expect(await screen.findByRole('button', { name: /^Saved\s*: AirPods 4/ }, T)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(window.localStorage.getItem('malek:v1:wishlist')).toContain('airpods-4');

    await router.navigate('/en/wishlist');
    expect(await screen.findByText(/saved on this browser only/, {}, T)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /AirPods 4/ }, T)).toBeInTheDocument();
  });

  it('signed-in wishlist comes from the account and clears the browser copy', async () => {
    window.localStorage.setItem(
      'malek:v1:wishlist',
      JSON.stringify([
        {
          productId: 'demo-product-airpods-4',
          productSlug: 'airpods-4',
          variantId: null,
          addedAt: '2026-09-25T10:00:00.000Z',
        },
      ]),
    );
    signInAs('merge-unit@example.com');
    renderApp('/en/wishlist');
    expect(await screen.findByRole('heading', { level: 1, name: 'Wishlist' }, T)).toBeVisible();
    await waitFor(() => expect(window.localStorage.getItem('malek:v1:wishlist')).toBeNull(), T);
    expect(screen.queryByText(/saved on this browser only/)).not.toBeInTheDocument();
  });

  it('compare refuses a product from another category and explains why', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/en/category/phones');
    await user.click(
      await screen.findByRole('button', { name: 'Add iPhone 17 to compare' }, { timeout: 8000 }),
    );
    expect(await screen.findByRole('link', { name: 'Compare (1/4)' }, T)).toBeInTheDocument();
    await router.navigate('/en/category/audio');
    await user.click(await screen.findByRole('button', { name: 'Add AirPods 4 to compare' }, T));
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((s) => /can't be compared/.test(s.textContent ?? '')),
      ).toBe(true),
    );
    expect(screen.getByRole('link', { name: 'Compare (1/4)' })).toBeInTheDocument();
  });

  it('account area in Arabic: overview, honest empty states and section navigation', async () => {
    const user = userEvent.setup();
    signInAs('arabic-unit@example.com');
    const { router } = renderApp('/account');
    expect(await screen.findByRole('heading', { level: 1, name: 'حسابي' }, T)).toBeVisible();
    expect(await screen.findByText('لا توجد طلبات حتى الآن.', {}, T)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'أقسام الحساب' });
    await user.click(within(nav).getByRole('link', { name: 'الإشعارات' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'الإشعارات' }, T)).toBeVisible();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'لا توجد إشعارات' }, T),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/account/notifications');
    // External channels are never presented as working.
    expect((await screen.findAllByText('غير متاح حاليًا', {}, T)).length).toBeGreaterThan(0);
    await user.click(within(nav).getByRole('link', { name: 'طلبات التنبيه' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'طلبات التنبيه والانتظار' }, T),
    ).toBeVisible();
    expect(screen.getByText('طلبات الصيانة')).toBeInTheDocument();
  });

  it('saved address form uses the checkout address rules', async () => {
    const user = userEvent.setup();
    signInAs('address-unit@example.com');
    renderApp('/en/account/addresses');
    await user.click(await screen.findByRole('button', { name: 'Add address' }, T));
    await user.selectOptions(screen.getByLabelText('Governorate'), 'giza');
    await user.type(screen.getByLabelText('Area / city'), 'Dokki');
    await user.click(screen.getByRole('button', { name: 'Save address' }));
    expect(await screen.findByText('Enter the full address.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Full address/), '12 Tahrir St, floor 3');
    await user.click(screen.getByRole('button', { name: 'Save address' }));
    expect(await screen.findByText(/12 Tahrir St, floor 3/, {}, T)).toBeInTheDocument();
    expect(screen.getByText('Default', { exact: true })).toBeInTheDocument();
  });

  it('product page shows labelled demo reviews and explicit recommendations', async () => {
    renderApp('/en/product/iphone-18-pro');
    const reviews = await screen.findByRole('region', { name: 'Customer reviews' }, T);
    expect(await within(reviews).findAllByText('Demo review', {}, T)).not.toHaveLength(0);
    expect(within(reviews).queryByText('Verified buyer')).not.toBeInTheDocument();
    expect(
      await within(reviews).findByRole('link', { name: 'Sign in to review' }, T),
    ).toBeInTheDocument();
    const together = await screen.findByRole('region', { name: 'Frequently bought together' }, T);
    expect(within(together).getByText('Apple 20W USB-C Power Adapter')).toBeInTheDocument();
  });
});
