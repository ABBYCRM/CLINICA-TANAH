import { test, expect, Page } from '@playwright/test';

const ADMIN_EMAIL = 'Juliana';
const PASSWORD = '12345678';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

test('user manual page shows TOC and module/role tables', async ({ page }) => {
  await signIn(page);
  await page.goto('/manual');
  await expect(page.getByTestId('user-manual')).toBeVisible();
  await expect(page.getByTestId('manual-toc')).toBeVisible();
  await expect(page.getByTestId('manual-modules-table')).toBeVisible();
  await expect(page.getByTestId('manual-roles-table')).toBeVisible();
  await page.getByTestId('manual-toc-marketing').click();
  await expect(page.getByTestId('manual-section-marketing')).toBeVisible();
});
