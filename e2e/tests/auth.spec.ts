/**
 * Sign-in flow — runs on BOTH desktop-chrome and mobile-chrome projects.
 * This is the mobile e2e check: the whole auth journey must work on a phone.
 */
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'Juliana';
const PASSWORD = '12345678';

async function fillCredentials(page: import('@playwright/test').Page, email = ADMIN_EMAIL, password = PASSWORD) {
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
}

test.describe('Sign in', () => {
  test('renders the sign-in screen', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-card')).toBeVisible();
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByTestId('locale-switcher')).toBeVisible();
  });

  test('password visibility toggle works', async ({ page }) => {
    await page.goto('/login');
    const pwd = page.getByTestId('login-password');
    await expect(pwd).toHaveAttribute('type', 'password');
    await page.getByTestId('toggle-password').click();
    await expect(pwd).toHaveAttribute('type', 'text');
    await page.getByTestId('toggle-password').click();
    await expect(pwd).toHaveAttribute('type', 'password');
  });

  test('locale switcher translates the page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByTestId('login-submit')).toContainText(/sign in/i);
    await expect(page.getByText('Username', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Português' }).click();
    await expect(page.getByTestId('login-submit')).toContainText(/entrar/i);
    await expect(page.getByText('Senha', { exact: true })).toBeVisible();
  });

  test('rejects invalid credentials with a visible error', async ({ page }) => {
    await page.goto('/login');
    await fillCredentials(page, 'nobody@clinica-tanah.com.br', 'wrong-password');
    await page.getByTestId('login-submit').click();
    const error = page.getByTestId('login-error');
    await expect(error).toBeVisible();
    await expect(error).not.toBeEmpty();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('signs in and lands on the dashboard', async ({ page }) => {
    await page.goto('/login');
    await fillCredentials(page);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
