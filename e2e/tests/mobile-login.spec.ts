/**
 * Mobile sign-in with the clinic's canonical credentials (Juliana / 1234).
 */
import { test, expect } from '@playwright/test';

test.skip(({ isMobile }) => !isMobile, 'Mobile-only');

test('Juliana / 1234 signs in on a phone viewport', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByTestId('login-card')).toBeVisible();

  // Tap fields (not just fill) to catch overlay / pointer-events bugs on mobile chrome
  await page.getByTestId('login-email').tap();
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').tap();
  await page.getByTestId('login-password').fill('1234');
  await page.getByTestId('login-submit').tap();

  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('API accepts Juliana / 1234 from a mobile user-agent', async ({ request, baseURL }) => {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { email: 'Juliana', password: '1234' },
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.token).toBeTruthy();
  expect(body.user.full_name).toBe('Juliana');
});
