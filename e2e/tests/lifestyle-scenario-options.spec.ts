/**
 * Lifestyle + scenario catalogs — searchable libraries and expanded options.
 */
import { test, expect } from '@playwright/test';

const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.E2E_PASSWORD || '12345678';

async function openLifestyle(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
  await page.goto('/patients');
  await page.locator('[data-testid^="patient-row-"]').first().click();
  await page.waitForURL(/\/patients\//);
  await page.getByTestId('workspace-tab-clinical').click();
  await page.getByTestId('chart-tab-corpo').click();
  await page.getByTestId('body-tab-lifestyle').click();
  await expect(page.getByTestId('body-lifestyle-full')).toBeVisible({ timeout: 15_000 });
}

test.describe('Lifestyle & scenario option libraries', () => {
  test.setTimeout(90_000);

  test('nutrition library search + submit plan', async ({ page }) => {
    await openLifestyle(page);
    await expect(page.getByTestId('life-nut-library-count')).toBeVisible();
    await expect.poll(async () => {
      const text = await page.getByTestId('life-nut-library-count').innerText();
      const nums = text.match(/\d+/g)?.map(Number) || [];
      return Math.max(0, ...nums);
    }).toBeGreaterThanOrEqual(10);

    await page.getByTestId('life-nut-library-search').click();
    await page.getByTestId('life-nut-library-search').fill('GLP-1');
    await expect(page.getByTestId('life-nut-library-results')).toBeVisible();
    await expect(page.getByTestId('life-nut-library-results')).toContainText(/GLP-1|incretin|incretina/i);
    await page.getByTestId('life-nut-library-option-nut_glp1_companion').click();
    await expect(page.getByTestId('life-title')).not.toHaveValue('');
    await expect(page.getByTestId('life-calories')).not.toHaveValue('');

    await page.getByTestId('life-submit').click();
    await expect(page.getByTestId('life-msg')).toContainText(/registrado|saved|registrado/i, { timeout: 10_000 });
  });

  test('exercise library + scenario expanded options', async ({ page }) => {
    await openLifestyle(page);
    await page.getByTestId('life-plan-type').selectOption('exercise');
    await expect(page.getByTestId('life-ex-library')).toBeVisible();
    await page.getByTestId('life-ex-library-search').fill('GLP-1');
    await expect(page.getByTestId('life-ex-library-results')).toContainText(/FFM|GLP-1/i);
    await page.getByTestId('life-ex-library-option-ex_glp1_preserve').click();
    await expect(page.getByTestId('life-training-style')).toHaveValue('glp1_ffm');

    await page.getByTestId('body-tab-scenarios').click();
    await expect(page.getByTestId('sim-horizon-habits')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('sim-horizon-16')).toBeVisible();
    await expect(page.getByTestId('sim-nut-override')).toBeVisible();
    await expect(page.getByTestId('sim-ex-override')).toBeVisible();
    await expect(page.getByTestId('sim-training-style')).toBeVisible();
    await expect(page.getByTestId('sim-cardio-modality')).toBeVisible();
    await expect(page.getByTestId('sim-sleep-hours')).toBeVisible();
    await expect(page.getByTestId('sim-stress')).toBeVisible();
    await expect(page.getByTestId('sim-alcohol')).toBeVisible();

    await page.getByTestId('sim-nut-override-search').fill('déficit moderado');
    await expect(page.getByTestId('sim-nut-override-results')).toBeVisible();
  });
});
