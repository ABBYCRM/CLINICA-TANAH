import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'Juliana';
const ADMIN_PASS = '1234';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(ADMIN_PASS);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/);
}

test.describe('Clinics (multi-tenant)', () => {
  test('superadmin can open new-clinic form without pattern console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await signIn(page);
    await page.goto('/clinics');
    await expect(page.getByTestId('new-clinic')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('new-clinic').click();
    await expect(page.getByText(/nova cl[ií]nica/i)).toBeVisible();

    const slug = page.locator('input[pattern]');
    await slug.fill('clinica-demo-pw');
    const valid = await slug.evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(valid).toBe(true);

    const patternNoise = consoleErrors.filter((e) => /Invalid character class|pattern attribute/i.test(e));
    expect(patternNoise, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
