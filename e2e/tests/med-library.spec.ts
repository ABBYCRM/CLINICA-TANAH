/**
 * Medication library — searchable dropdown must list a full catalog.
 */
import { test, expect } from '@playwright/test';

const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.E2E_PASSWORD || '12345678';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

test.describe('Body medication library', () => {
  test.setTimeout(90_000);

  test('API returns full library and search hits', async ({ request, baseURL }) => {
    const login = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: 'Juliana', password: PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    const all = await request.get(`${baseURL}/api/clinical/body/library/medications?limit=500`, { headers });
    expect(all.ok()).toBeTruthy();
    const body = await all.json();
    expect(body.total).toBeGreaterThanOrEqual(180);
    expect(body.items.length).toBeGreaterThanOrEqual(180);

    const search = await request.get(`${baseURL}/api/clinical/body/library/medications?q=ozempic`, { headers });
    const hits = await search.json();
    expect(hits.items.some((i: any) => /ozempic/i.test(i.brand_name || ''))).toBe(true);
  });

  test('UI search + dropdown show library options', async ({ page }) => {
    await signIn(page);
    await page.goto('/patients');
    await page.locator('[data-testid^="patient-row-"]').first().click();
    await page.waitForURL(/\/patients\//);
    await page.getByTestId('workspace-tab-clinical').click();
    await page.getByTestId('chart-tab-corpo').click();
    await page.getByTestId('body-tab-medications').click();
    await expect(page.getByTestId('body-medications')).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId('body-med-library-count')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => {
      const text = await page.getByTestId('body-med-library-count').innerText();
      const nums = text.match(/\d+/g)?.map(Number) || [];
      return Math.max(0, ...nums);
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(180);

    await page.getByTestId('body-med-library-search').click();
    await page.getByTestId('body-med-library-search').fill('Ozempic');
    await expect(page.getByTestId('body-med-library-results')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('body-med-library-results')).toContainText(/Ozempic/i);

    const select = page.getByTestId('body-med-library-select');
    await expect.poll(async () => select.locator('option').count(), { timeout: 10_000 }).toBeGreaterThan(1);
  });
});
