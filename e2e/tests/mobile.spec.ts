/**
 * Mobile-only e2e check — runs exclusively on the mobile-chrome project.
 * Guards the phone experience: no horizontal overflow, drawer navigation.
 */
import { test, expect } from '@playwright/test';

test.skip(({ isMobile }) => !isMobile, 'Mobile-only checks');

const ADMIN_EMAIL = 'admin@clinica-tanah.com.br';
const PASSWORD = 'clinica2026';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `page overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
}

test('login page fits the mobile viewport without horizontal scroll', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByTestId('login-card')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('dashboard fits the mobile viewport', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('drawer opens, navigates, and auto-closes', async ({ page }) => {
  await signIn(page);

  const drawer = page.getByTestId('mobile-drawer');
  await expect(drawer).not.toBeInViewport();

  await page.getByTestId('mobile-menu-button').click();
  await expect(drawer).toBeInViewport();

  await drawer.getByRole('link', { name: /pacientes|patients|pacientes/i }).click();
  await page.waitForURL(/\/patients$/, { timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /pacientes|patients/i })).toBeVisible();
  await expect(drawer).not.toBeInViewport();
  await expectNoHorizontalOverflow(page);
});

test('drawer closes via the backdrop', async ({ page }) => {
  await signIn(page);
  const drawer = page.getByTestId('mobile-drawer');
  await page.getByTestId('mobile-menu-button').click();
  await expect(drawer).toBeInViewport();
  // tap outside the drawer (right edge of the screen)
  await page.getByTestId('drawer-backdrop').click({ position: { x: 10, y: 200 }, force: true });
  await expect(drawer).not.toBeInViewport();
});
