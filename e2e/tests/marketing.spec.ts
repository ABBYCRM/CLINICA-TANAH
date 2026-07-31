/**
 * WhatsApp marketing hub — templates, automations, audience, analytics tabs.
 */
import { test, expect, Page } from '@playwright/test';

const ADMIN_EMAIL = 'Juliana';
const PASSWORD = '1234';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

test('marketing hub exposes templates, automations, audience and analytics', async ({ page }) => {
  await signIn(page);
  await page.goto('/whatsapp');
  await expect(page.getByTestId('whatsapp-marketing')).toBeVisible();

  await page.getByTestId('tab-templates').click();
  await expect(page.getByTestId('templates-view')).toBeVisible();
  await expect(page.getByTestId('new-template')).toBeVisible();

  await page.getByTestId('tab-automations').click();
  await expect(page.getByTestId('automations-view')).toBeVisible();
  await expect(page.getByTestId('automation-reminder_24h')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('tab-audience').click();
  await expect(page.getByTestId('audience-view')).toBeVisible();
  await expect(page.getByTestId('segment-all_consented')).toBeVisible();

  await page.getByTestId('tab-analytics').click();
  await expect(page.getByTestId('analytics-view')).toBeVisible({ timeout: 10_000 });
});

test('invalid_token surfaces a friendly session message on Painel retry path', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => localStorage.setItem('auth_token', 'totally-invalid'));
  await page.goto('/');
  // Either redirected to login or dashboard shows translated invalid_token
  await page.waitForTimeout(1500);
  const url = page.url();
  const body = await page.locator('body').innerText();
  const ok =
    url.includes('/login') ||
    /sessão expirada|session expired|sesión expirada|invalid_token/i.test(body);
  expect(ok).toBeTruthy();
});
