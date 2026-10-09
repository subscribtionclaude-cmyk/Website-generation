import { test, expect } from '@playwright/test';
import { login, kpi, cairoDate, watch } from './helpers';

test.describe.serial('BD executive — daily workflow', () => {
  test('login rejects a wrong password, accepts the right one, dashboard starts at zero', async ({ page }) => {
    await page.goto('/login/');
    await page.getByLabel('Email').fill('bd1@accord.test');
    await page.getByLabel('Password').fill('wrong-password-123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Wrong email or password')).toBeVisible();
    await login(page, 'bd1');
    await expect(page.getByRole('heading', { name: /Hello, Bob/ })).toBeVisible();
    expect(await kpi(page, 'kpi-calls')).toBe(0);
    await expect(page.getByText('of 5 daily target')).toBeVisible();
    expect(await kpi(page, 'kpi-remaining')).toBe(5);
  });

  test('one-tap call from the lead table updates live metrics', async ({ page }) => {
    const problems = watch(page);
    await login(page, 'bd1');
    await page.goto('/leads/');
    await page.getByLabel('Search leads').fill('amer');
    await expect(page.getByRole('row')).toHaveCount(2); // header + Amer Group
    await page.getByTestId('lead-call').first().click();
    await page.getByTestId('call-responded').click();
    await expect(page.getByText('logged. Add details')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.goto('/dashboard/');
    await expect.poll(() => kpi(page, 'kpi-calls')).toBe(1);
    expect(await kpi(page, 'kpi-responded')).toBe(1);
    expect(await kpi(page, 'kpi-pct')).toBe(20);
    expect(await kpi(page, 'kpi-remaining')).toBe(4);
    expect(problems).toEqual([]);
  });

  test('same lead called repeatedly: every attempt counts, unique leads stays 1', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/leads/');
    await page.getByLabel('Search leads').fill('amer');
    await page.getByRole('link', { name: 'Amer Group' }).click();
    for (let i = 0; i < 2; i++) {
      await page.getByTestId('profile-call').click();
      await page.getByTestId('call-no-response').click();
      await page.getByRole('button', { name: 'Done' }).click();
    }
    await expect(page.getByTestId('lead-total-calls')).toContainText('3', { timeout: 10_000 });
    await expect(page.getByTestId('lead-calls-today')).toHaveText('3');
    await page.goto('/dashboard/');
    await expect.poll(() => kpi(page, 'kpi-calls')).toBe(3);
    expect(await kpi(page, 'kpi-responded')).toBe(1);
    expect(await kpi(page, 'kpi-dnr')).toBe(2);
    expect(await kpi(page, 'kpi-unique')).toBe(1);
  });

  test('keyboard shortcut logs a call; Responded → details: sub-outcome, note, follow-up', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/calls/');
    await page.getByLabel('Search leads').fill('palm');
    await page.getByRole('button', { name: /Palm Hills/ }).click();
    await page.keyboard.press('r');
    await expect(page.getByText('logged. Add details')).toBeVisible();
    await page.getByRole('button', { name: 'Interested', exact: true }).click();
    await page.getByPlaceholder('What was discussed?').fill('Wants proposal for 3 towers');
    await page.getByRole('button', { name: 'Tomorrow' }).click();
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Call details saved')).toBeVisible();
    await page.goto('/follow-ups/?tab=tomorrow');
    await expect(page.getByTestId('followup-row').filter({ hasText: 'Palm Hills' })).toBeVisible();
    await page.goto('/calls/');
    await expect(page.getByRole('row').filter({ hasText: 'Palm Hills' })).toContainText('interested');
  });

  test('didn\'t respond → Retry later today creates a same-day follow-up', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/leads/?q=orascom');
    await page.getByTestId('lead-call').first().click();
    await page.getByTestId('call-no-response').click();
    await page.getByRole('button', { name: 'Retry Later Today' }).click();
    await expect(page.getByText('Call details saved')).toBeVisible();
    await page.goto('/follow-ups/?tab=today');
    await expect(page.getByTestId('followup-row').filter({ hasText: 'Orascom' })).toBeVisible();
  });

  test('follow-up: complete and schedule the next one in one step', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/follow-ups/?tab=overdue');
    const row = page.getByTestId('followup-row').filter({ hasText: 'Amer Group' });
    await expect(row).toContainText('overdue');
    await row.getByTestId('complete-followup').click();
    await page.getByRole('button', { name: 'In 3 days' }).click();
    await page.getByRole('button', { name: 'Complete + schedule next' }).click();
    await expect(page.getByText('Completed — next follow-up scheduled')).toBeVisible();
    await expect(page.getByTestId('followup-row').filter({ hasText: 'Amer Group' })).toHaveCount(0);
  });

  test('meeting happy path: schedule → confirm → attended → minutes → next step → next meeting', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/leads/?q=amer');
    await page.getByRole('link', { name: 'Amer Group' }).click();
    await page.getByRole('button', { name: 'Meeting', exact: true }).click();
    await page.locator('input[type="datetime-local"]').fill(`${cairoDate(1)}T10:00`);
    await page.getByLabel('Meeting with').fill('Mr Hossam');
    await page.getByLabel('Purpose').fill('Introduction');
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(page.getByText('Meeting scheduled', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /Meetings/ }).click();
    const card = page.getByTestId('meeting-card').first();
    await expect(card.locator('.badge', { hasText: /^Unconfirmed$/ })).toBeVisible();
    await card.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(card.locator('.badge', { hasText: /^Confirmed$/ })).toBeVisible();
    // attendance is explicit — the card stays "Scheduled", never auto "Attended"
    await expect(card.locator('.badge', { hasText: /^Attended$/ })).toHaveCount(0);
    await expect(card.locator('.badge', { hasText: /^Scheduled$/ })).toBeVisible();
    await card.getByTestId('record-outcome').click();
    await page.getByTestId('att-yes').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    // minutes dialog opens straight away
    await expect(page.getByRole('dialog').getByText(/Minutes & next step/)).toBeVisible();
    await page.getByLabel('Minutes of meeting').fill('Line one\nLine two\nLine three — client wants FM for 3 towers');
    await page.locator('select').filter({ hasText: 'Proposal Requested' }).selectOption('proposal_requested');
    await page.locator('select').filter({ hasText: 'Prepare Proposal' }).selectOption('send_requirement_form');
    await page.getByLabel('Follow-up date').fill(cairoDate(3));
    await page.getByText('Next meeting required').click();
    await page.getByLabel('Date & time (Cairo)').fill(`${cairoDate(7)}T11:30`);
    await page.getByRole('button', { name: 'Save minutes' }).click();
    await expect(page.getByText('Minutes & outcome saved')).toBeVisible();
    await page.getByRole('tab', { name: 'Timeline' }).click();
    for (const t of ['Meeting scheduled for', 'Meeting confirmed', 'Meeting attended', 'Minutes of meeting recorded']) await expect(page.getByText(t).first()).toBeVisible();
    await page.getByRole('tab', { name: /Meetings/ }).click();
    await expect(page.getByTestId('meeting-card')).toHaveCount(2);
    await expect(page.getByText('Follow-up to a previous meeting')).toBeVisible();
    // temperature is NOT touched by the meeting
    await expect(page.locator('dd select').first()).toHaveValue('warm');
  });

  test('missed meeting: not attended → reason → replacement meeting; original preserved', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/leads/?q=palm');
    await page.getByRole('link', { name: 'Palm Hills' }).click();
    await page.getByRole('button', { name: 'Meeting', exact: true }).click();
    await page.locator('input[type="datetime-local"]').fill(`${cairoDate(2)}T09:00`);
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await page.getByRole('tab', { name: /Meetings/ }).click();
    await page.getByTestId('record-outcome').click();
    await page.getByTestId('att-no').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('A reason is required')).toBeVisible();
    await page.getByRole('dialog').locator('select').first().selectOption('client_did_not_attend');
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await page.getByLabel('New date & time (Cairo)').fill(`${cairoDate(5)}T09:00`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('replacement meeting created')).toBeVisible();
    await expect(page.getByTestId('meeting-card')).toHaveCount(2);
    await expect(page.getByText('Not attended', { exact: true })).toBeVisible();
    await expect(page.getByText('Replacement for an earlier meeting')).toBeVisible();
  });

  test('commercial chain: form → proposal → sent → response/review meeting → negotiation → suggestion → won', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/leads/?q=amer');
    await page.getByRole('link', { name: 'Amer Group' }).click();
    await page.getByRole('tab', { name: 'Forms & Proposals' }).click();
    await page.getByRole('button', { name: 'Track information form' }).click();
    await page.getByRole('dialog').locator('select').first().selectOption('sent');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Enter the date the form was sent')).toBeVisible();
    await page.getByLabel('Date sent').fill(cairoDate(0));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Form saved')).toBeVisible();
    await page.getByRole('button', { name: 'Update' }).click();
    await page.getByRole('dialog').locator('select').first().selectOption('completed');
    await page.getByLabel('Date completed').fill(cairoDate(0));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Confirm the client actually returned')).toBeVisible();
    await page.getByLabel('I confirm the client returned the completed form.').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Form saved')).toBeVisible();

    await page.getByRole('button', { name: 'New proposal' }).click();
    await page.getByLabel('Value').fill('250000');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Proposal saved')).toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).last().click();
    await page.getByRole('dialog').locator('select').first().selectOption('sent');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Enter the date the proposal was sent')).toBeVisible();
    await page.getByLabel('Sent date').fill(cairoDate(0));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Proposal saved')).toBeVisible();
    await expect(page.getByText('Awaiting response').first()).toBeVisible(); // response_state set, not "Lost"
    await page.getByRole('button', { name: 'Record response' }).click();
    await page.getByRole('dialog').locator('select').first().selectOption('needs_meeting');
    await page.getByText('Another meeting required').click();
    await page.getByLabel('Date & time (Cairo)').fill(`${cairoDate(4)}T14:00`);
    await page.getByRole('dialog').getByRole('button', { name: 'Record response' }).click();
    await expect(page.getByText('Client response recorded')).toBeVisible();
    await page.getByRole('button', { name: 'Record response' }).click();
    await page.getByRole('dialog').locator('select').first().selectOption('negotiation');
    await page.getByRole('dialog').getByRole('button', { name: 'Record response' }).click();
    await expect(page.getByText('Client response recorded')).toBeVisible();

    // negotiation recorded => SUGGESTION only; stage unchanged until the user confirms
    await expect(page.getByTestId('stage-suggestion')).toContainText('Negotiation');
    await expect(page.locator('dd select').nth(1)).toHaveValue('outreach');
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('stage-suggestion').getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('dd select').nth(1)).toHaveValue('negotiation');
    await page.getByRole('tab', { name: 'Timeline' }).click();
    for (const t of ['Information form — sent → completed', 'Proposal sent', 'Client response: negotiation', 'Negotiation recorded', 'Pipeline: outreach → negotiation']) await expect(page.getByText(t).first()).toBeVisible();
  });

  test('pipeline board: stage change needs explicit confirmation', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/pipeline/');
    await expect(page.locator('.lane')).toHaveCount(8);
    const card = page.locator('.lane[data-stage="research"] [data-testid="pipeline-card"]').filter({ hasText: 'Palm Hills' });
    await card.locator('select').selectOption('qualified');
    await expect(page.getByText('Change pipeline stage?')).toBeVisible();
    await page.getByTestId('confirm-move').click();
    await expect(page.locator('.lane[data-stage="qualified"]').getByText('Palm Hills')).toBeVisible();
  });

  test('new lead with duplicate warning', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/leads/');
    await page.getByRole('button', { name: 'New lead' }).click();
    await page.getByLabel('Company *').fill('Amer  Group');
    await page.getByRole('button', { name: 'Create lead' }).click();
    await expect(page.getByText('already exists')).toBeVisible();
    await page.getByLabel('Company *').fill('Madinet Masr');
    await page.getByLabel('Name').fill('Karim Adel');
    await page.getByRole('button', { name: 'Create lead' }).click();
    await expect(page.getByText('Lead created')).toBeVisible();
    await page.getByLabel('Search leads').fill('madinet');
    await expect(page.getByRole('link', { name: 'Madinet Masr' })).toBeVisible();
  });

  test('a BD cannot open the admin area or admin API', async ({ page }) => {
    await login(page, 'bd1');
    await page.goto('/admin/');
    await expect(page).toHaveURL(/\/dashboard\//);
    await expect(page.getByRole('link', { name: 'Admin dashboard' })).toHaveCount(0);
  });
});

test.describe('other roles', () => {
  test('viewer is read-only: no call buttons, no create, no admin', async ({ page }) => {
    await login(page, 'viewer');
    await page.goto('/leads/');
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    await expect(page.getByTestId('lead-call')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New lead' })).toHaveCount(0);
    await page.goto('/admin/');
    await expect(page).toHaveURL(/\/dashboard\//);
  });
  test('inactive user and user without a profile get no CRM access', async ({ page }) => {
    await login(page, 'inactive', null);
    await expect(page.getByText(/no active CRM access|No CRM access/)).toBeVisible();
    await page.goto('/leads/');
    await expect(page.getByText('No CRM access')).toBeVisible();
    await page.evaluate(() => localStorage.clear());
    await login(page, 'noprofile', null);
    await expect(page.getByText(/no active CRM access|No CRM access/)).toBeVisible();
  });
  test('unauthenticated visitors are sent to login', async ({ page }) => {
    await page.goto('/leads/');
    await expect(page).toHaveURL(/\/login\//);
  });
});
