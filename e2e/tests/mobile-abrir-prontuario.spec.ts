/**
 * Mobile: "Abrir prontuário" must actually reveal the clinical chart.
 * Regression: rail CTA scrolled chart off-screen; inspector goto kept drawer open.
 */
import { test, expect, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

test.skip(({ isMobile }) => !isMobile, 'Mobile-only');

const SHOT = '/opt/cursor/artifacts/screenshots/abrir-prontuario';
mkdirSync(SHOT, { recursive: true });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill('12345678');
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 20_000 });
}

async function openFirstPatient(page: Page) {
  await page.goto('/patients');
  await page.locator('[data-testid^="patient-row-"]').first().click();
  await page.waitForURL(/\/patients\//, { timeout: 15_000 });
  await expect(page.getByTestId('patient-workspace')).toBeVisible({ timeout: 15_000 });
}

async function chartInViewport(page: Page) {
  const chart = page.getByTestId('prontuario-chart');
  await expect(chart).toBeVisible({ timeout: 10_000 });
  const info = await chart.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      vh: window.innerHeight,
      partiallyVisible: r.bottom > 80 && r.top < window.innerHeight - 40,
    };
  });
  expect(info.partiallyVisible, `chart off-screen: ${JSON.stringify(info)}`).toBe(true);
  return info;
}

test.describe('Mobile Abrir prontuário', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signIn(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('rail CTA scrolls clinical chart into view', async () => {
    await openFirstPatient(page);
    await page.getByTestId('workspace-tab-overview').click();
    const btn = page.getByTestId('action-open-clinical');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await expect(page.getByTestId('workspace-tab-clinical')).toHaveClass(/is-active/);
    // allow smooth scroll settle
    await page.waitForTimeout(500);
    await chartInViewport(page);
    await page.screenshot({ path: path.join(SHOT, 'rail-open-clinical.png'), fullPage: true });
  });

  test('inspector Abrir prontuário closes drawer and shows chart', async () => {
    await openFirstPatient(page);
    await page.getByTestId('workspace-tab-overview').click();
    // Prefer clinical timeline cards (encounter/prescription) — they always expose goto_clinical
    const clinicalCard = page.locator(
      '[data-testid="timeline-encounter"], [data-testid="timeline-prescription"], [data-testid="timeline-appointment"]',
    ).first();
    await expect(clinicalCard).toBeVisible({ timeout: 10_000 });
    await clinicalCard.click();
    await expect(page.getByTestId('timeline-inspector')).toBeVisible({ timeout: 10_000 });
    const goto = page.getByTestId('inspector-action-goto_clinical');
    await expect(goto).toBeVisible({ timeout: 10_000 });
    await goto.click();
    await expect(page.getByTestId('timeline-inspector')).toHaveCount(0);
    await expect(page.getByTestId('workspace-tab-clinical')).toHaveClass(/is-active/);
    // wait for layout reorder + main scroll
    await expect.poll(async () => {
      return page.getByTestId('prontuario-chart').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 80 && r.top < window.innerHeight - 40;
      });
    }, { timeout: 5_000 }).toBe(true);
    await page.screenshot({ path: path.join(SHOT, 'inspector-open-clinical.png'), fullPage: true });
  });
});
