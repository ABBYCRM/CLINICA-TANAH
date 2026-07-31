/**
 * Professional patient picker — no 500-row selects.
 * Covers Novo Atendimento search + today's appointment shortcut.
 */
import { test, expect, Page } from '@playwright/test';

const ADMIN_EMAIL = 'Juliana'; // doctor can create encounters
const PASSWORD = '1234';

async function signIn(page: Page, email = ADMIN_EMAIL) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

test('Novo Atendimento uses searchable patient picker', async ({ page }) => {
  await signIn(page);
  await page.goto('/encounters');
  await page.getByTestId('new-encounter').click();
  await expect(page.getByTestId('encounter-form')).toBeVisible();

  // Typeahead — not a raw <select> of the whole database
  await expect(page.locator('select').filter({ hasText: '—' })).toHaveCount(0);
  const input = page.getByTestId('patient-picker-input');
  await input.click();
  await expect(page.getByTestId('patient-picker-results')).toBeVisible();
  await input.fill('a');
  // need 2 chars for search; still shows recent list when empty/short
  await input.fill('an');
  await expect(page.getByTestId('patient-picker-results').locator('button').first()).toBeVisible({ timeout: 8_000 });
  await page.getByTestId('patient-picker-results').locator('button').first().click();
  await expect(page.getByTestId('patient-picker-value')).not.toHaveValue('');
  await expect(page.getByTestId('patient-picker-change')).toBeVisible();
});

test('appointment form patient picker searches by name', async ({ page }) => {
  await signIn(page, 'Juliana');
  await page.goto('/appointments');
  await page.getByTestId('new-appointment').click();
  const input = page.getByTestId('appointment-patient-input');
  await input.fill('Costa');
  const results = page.getByTestId('appointment-patient-results');
  await expect(results).toBeVisible();
  await expect(results.locator('button').first()).toContainText(/Costa|costa/i);
  await results.locator('button').first().click();
  await expect(page.getByTestId('appointment-patient-change')).toBeVisible();
});
