import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

/** Phase 05 service experiences through the real app shell (demo runtime, jsdom: no WebGL). */

const T = { timeout: 8000 };

function signInAs(email: string) {
  window.sessionStorage.setItem(
    'malek:v1:demo-session',
    JSON.stringify({ userId: `demo-customer-${email}`, email, roleKey: null }),
  );
}

describe('service experiences', { timeout: 40_000 }, () => {
  it('repair wizard: device → diagnostic (2D fallback without WebGL) → symptoms, no price', async () => {
    const user = userEvent.setup();
    signInAs('repair-unit@example.com');
    renderApp('/en/repairs/request?device=smartphone');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Repair request' }, T),
    ).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Samsung' }));
    await user.type(screen.getByLabelText('Model'), 'Galaxy S23');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // jsdom has no WebGL: the accessible 2D diagram and parts list are used, honestly announced.
    expect(await screen.findByText(/3D isn.t available on this device/, {}, T)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Use 3D view' })).not.toBeInTheDocument();
    const parts = screen.getByRole('group', { name: 'Which part has the problem?' });
    await user.click(within(parts).getByRole('radio', { name: 'Screen' }));
    const symptoms = await screen.findByRole('group', { name: /What.s wrong with the Screen\?/ });
    expect(within(symptoms).getByRole('radio', { name: 'Broken glass' })).toBeInTheDocument();
    expect(within(symptoms).getByRole('radio', { name: /I.m not sure/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a consultation' })).toBeInTheDocument();
    expect(screen.queryByText(/EGP/)).not.toBeInTheDocument();
  });

  it('used-device request offers the four battery preferences with the approved wording', async () => {
    signInAs('used-unit@example.com');
    renderApp('/used/request');
    const group = await screen.findByRole('group', { name: 'صحة البطارية المفضلة' }, T);
    const options = within(group)
      .getAllByRole('radio')
      .map((r) => r.closest('label')?.textContent?.trim());
    expect(options).toEqual(['90% أو أكثر', '85–89%', '80–84%', 'بدون تفضيل محدد']);
    expect(document.body.textContent).not.toContain('مش فارقة');
  });

  it('seeded demo requests have no owner, so customers never see them', async () => {
    signInAs('hub-unit@example.com');
    renderApp('/en/account/requests');
    expect(await screen.findByRole('heading', { level: 1, name: 'My requests' }, T)).toBeVisible();
    expect(await screen.findByText('No matching service requests.', {}, T)).toBeVisible();
    expect(screen.queryByText(/RP-2026-900001/)).not.toBeInTheDocument();
    const start = screen.getByRole('link', { name: /^Trade-in/ });
    expect(start).toHaveAttribute('href', '/en/trade-in/request');
  });

  it('trade-in landing forwards the product chosen on the product page', async () => {
    renderApp('/en/trade-in?product=iphone-18-pro');
    const cta = await screen.findAllByRole('link', { name: 'Start a trade-in' }, T);
    expect(cta[0]).toHaveAttribute('href', '/en/trade-in/request?product=iphone-18-pro');
    expect(screen.getByText('Final valuation may change after physical inspection.')).toBeVisible();
  });

  it('staff queue lists the clearly marked demo requests', async () => {
    window.sessionStorage.setItem(
      'malek:v1:demo-session',
      JSON.stringify({ userId: 'demo-staff-owner', email: 'owner@demo.local', roleKey: 'owner' }),
    );
    renderApp('/admin/repairs');
    await waitFor(
      () => expect(screen.getByRole('link', { name: 'RP-2026-900001' })).toBeInTheDocument(),
      T,
    );
    expect(screen.getAllByText('تجريبي').length).toBeGreaterThan(0);
  });
});
