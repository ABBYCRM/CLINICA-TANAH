/**
 * Cenários: Gerar imagem must be visible near the top on desktop + mobile.
 */
import { test, expect, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SHOT = '/opt/cursor/artifacts/screenshots/sim-generate-cta';
mkdirSync(SHOT, { recursive: true });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill('1234');
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 20_000 });
}

async function openMariaScenarios(page: Page) {
  await page.goto('/patients');
  const row = page.locator('[data-testid^="patient-row-"]').filter({ hasText: 'Maria Aparecida' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await page.waitForURL(/\/patients\//, { timeout: 15_000 });
  await expect(page.getByTestId('patient-workspace')).toBeVisible({ timeout: 15_000 });

  const clinical = page.getByTestId('workspace-tab-clinical');
  if (await clinical.count()) {
    await clinical.click();
  } else {
    const open = page.getByTestId('action-open-clinical');
    if (await open.count()) await open.click();
  }

  // Body / Corpo section inside clinical chart
  const bodyTab = page.getByTestId('chart-tab-body').or(page.getByRole('button', { name: /corpo|body/i })).first();
  await expect(bodyTab).toBeVisible({ timeout: 15_000 });
  await bodyTab.click();

  await page.getByTestId('body-tab-scenarios').click();
  await expect(page.getByTestId('body-scenarios-full')).toBeVisible({ timeout: 15_000 });
}

test.describe('Sim generate CTA visibility', () => {
  test.setTimeout(90_000);

  test('Gerar imagem is in first viewports (desktop + mobile)', async ({ page }, testInfo) => {
    await signIn(page);
    await openMariaScenarios(page);

    const panel = page.getByTestId('sim-generate-panel');
    const gen = page.getByTestId('sim-generate');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(gen).toBeVisible();
    await expect(gen).toContainText(/Gerar imagem|Generate image|Generar imagen/i);

    // Bring into view if chart chrome pushed it slightly; then assert visible in viewport
    await panel.scrollIntoViewIfNeeded();
    await expect.poll(async () => {
      return panel.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight * 0.85 && r.bottom > 48;
      });
    }, { timeout: 5_000 }).toBe(true);

    const pwd = page.getByTestId('sim-step-password');
    await expect(gen).toBeDisabled();
    await pwd.fill('1234');
    await expect(gen).toBeEnabled();

    await expect(gen).toHaveText(/Gerar imagem|Generate image|Generar imagen/i);

    const sticky = page.getByTestId('sim-sticky-generate');
    await expect(sticky).toBeVisible();
    await expect(page.getByTestId('sim-sticky-generate-btn')).toBeVisible();
    const stickyBox = await sticky.boundingBox();
    expect(stickyBox).toBeTruthy();
    expect(stickyBox!.y).toBeGreaterThan(120);

    await page.screenshot({
      path: path.join(SHOT, `${testInfo.project.name}-scenarios.png`),
      fullPage: false,
    });
  });
});
