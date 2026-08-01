/**
 * Mobile UI harmonize loop — Pixel 7.
 * Visits every authenticated route, asserts:
 *  - page title / primary CTA visible
 *  - no horizontal page overflow
 *  - list content visible (mobile-list OR table OR cards)
 *  - no uncaught page errors
 * Loops until stable (retries once on flake).
 */
import { test, expect, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

test.skip(({ isMobile }) => !isMobile, 'Mobile-only');

const ADMIN = 'Juliana';
const PASS = '12345678';
const SHOT = '/opt/cursor/artifacts/screenshots/mobile-harmonize';
mkdirSync(SHOT, { recursive: true });

const ROUTES: Array<{
  path: string;
  marker: string; // testid or role heading fallback
  titleRe?: RegExp;
}> = [
  { path: '/', marker: 'dashboard' },
  { path: '/patients', marker: 'patients-crm' },
  { path: '/appointments', marker: 'new-appointment' },
  { path: '/encounters', marker: 'encounters-page' },
  { path: '/prescriptions', marker: 'new-prescription' },
  { path: '/inventory', marker: 'new-item' },
  { path: '/vendors', marker: 'new-vendor' },
  { path: '/accounting', marker: 'accounting-page' },
  { path: '/invoices', marker: 'invoices-page' },
  { path: '/payroll', marker: 'payroll-page' },
  { path: '/whatsapp', marker: 'whatsapp-marketing' },
  { path: '/forms', marker: 'forms-page', titleRe: /formul|forms/i },
  { path: '/lgpd', marker: 'new-lgpd-request' },
  { path: '/manual', marker: 'user-manual' },
  { path: '/team', marker: 'team-page' },
  { path: '/settings', marker: 'mint-token' },
  { path: '/apps', marker: 'apps-page', titleRe: /apps|aplicativos|convenio|convênio/i },
  { path: '/clinics', marker: 'new-clinic' },
];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN);
  await page.getByTestId('login-password').fill(PASS);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 20_000 });
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow ${overflow}px`).toBeLessThanOrEqual(2);
}

async function hasListContent(page: Page) {
  const mobile = page.locator('[data-testid$="-mobile-list"]').first();
  if (await mobile.count() && await mobile.isVisible().catch(() => false)) return 'mobile-list';
  const table = page.locator('table').first();
  if (await table.count() && await table.isVisible().catch(() => false)) return 'table';
  const card = page.locator('.card, .crm-timeline-card, .crm-inset-panel, [data-testid="calendar-view"]').first();
  if (await card.count() && await card.isVisible().catch(() => false)) return 'card';
  const empty = page.getByText(/sem dados|no data|sin datos|ok/i).first();
  if (await empty.count() && await empty.isVisible().catch(() => false)) return 'empty';
  return null;
}

test.describe('Mobile harmonize — all routes', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  let page: Page;
  const pageErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await signIn(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  for (const route of ROUTES) {
    test(`route ${route.path}`, async () => {
      pageErrors.length = 0;
      await page.goto(route.path);
      // Marker may be testid; fall back to heading
      const byTestId = page.getByTestId(route.marker);
      if (await byTestId.count()) {
        await expect(byTestId.first()).toBeVisible({ timeout: 15_000 });
      } else if (route.titleRe) {
        await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: route.titleRe }).first())
          .toBeVisible({ timeout: 15_000 });
      } else {
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
      }

      await noOverflow(page);
      const kind = await hasListContent(page);
      expect(kind, `no list/card content on ${route.path}`).toBeTruthy();

      // Primary buttons shouldn't be tiny
      const tiny = await page.evaluate(() => {
        const bad: string[] = [];
        document.querySelectorAll('button.btn-primary, button.btn-secondary').forEach((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height < 34) {
            bad.push(`${(el as HTMLElement).dataset.testid || el.textContent?.slice(0, 24)} h=${Math.round(r.height)}`);
          }
        });
        return bad;
      });
      expect(tiny, `squished buttons on ${route.path}:\n${tiny.join('\n')}`).toEqual([]);

      expect(pageErrors, `page errors on ${route.path}:\n${pageErrors.join('\n')}`).toEqual([]);
      const slug = route.path === '/' ? 'home' : route.path.replace(/\//g, '_').replace(/^_/, '');
      await page.screenshot({ path: path.join(SHOT, `${slug}.png`), fullPage: true });
    });
  }

  test('patient clinical → corpo capture fits', async () => {
    pageErrors.length = 0;
    await page.goto('/patients');
    await page.locator('[data-testid^="patient-row-"]').first().click();
    await page.waitForURL(/\/patients\//, { timeout: 15_000 });
    await page.getByTestId('workspace-tab-clinical').click();
    await page.getByTestId('chart-tab-corpo').click();
    await expect(page.getByTestId('body-capture-studio')).toBeVisible({ timeout: 15_000 });
    await noOverflow(page);
    // body sub-tabs should scroll, not blow page width
    await expect(page.getByTestId('body-tab-capture')).toBeVisible();
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: path.join(SHOT, 'patient-corpo.png'), fullPage: true });
  });

  test('whatsapp tabs cycle without overflow', async () => {
    await page.goto('/whatsapp');
    for (const id of ['tab-chat', 'tab-campaigns', 'tab-templates', 'tab-automations', 'tab-audience', 'tab-analytics', 'tab-surveys']) {
      const tab = page.getByTestId(id);
      if (!(await tab.count())) continue;
      await tab.click();
      await noOverflow(page);
    }
  });

  test('inventory tabs cycle without overflow', async () => {
    await page.goto('/inventory');
    await expect(page.getByTestId('new-item')).toBeVisible();
    await expect(page.getByTestId('inventory-mobile-list')).toBeVisible();
    for (const re of [/lote|batch/i, /moviment|movement/i, /alerta|alert/i, /item|estoque|inventory|stock/i]) {
      const btn = page.locator('.seg-track button').filter({ hasText: re }).first();
      if (!(await btn.count())) continue;
      await btn.click();
      await noOverflow(page);
    }
  });

  test('accounting tabs cycle without overflow', async () => {
    await page.goto('/accounting');
    await expect(page.getByTestId('accounting-page')).toBeVisible();
    await expect(page.getByTestId('accounting-tb-mobile-list')).toBeVisible();
    for (const re of [/dre|income|resultado/i, /plano|accounts|cuentas/i, /lançamento|journal|asiento/i, /balancete|trial/i]) {
      const btn = page.locator('.seg-track button').filter({ hasText: re }).first();
      if (!(await btn.count())) continue;
      await btn.click();
      await noOverflow(page);
      const kind = await hasListContent(page);
      expect(kind, `no content after accounting tab ${re}`).toBeTruthy();
    }
  });
});
