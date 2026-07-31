/**
 * Mobile visual QA — Pixel 7 viewport.
 * Asserts no horizontal overflow, primary actions stay tappable (min size),
 * and key updated screens (Login, Equipe, Folha, WhatsApp, Dashboard) render
 * without squished chrome. Captures screenshots for review.
 */
import { test, expect, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

test.skip(({ isMobile }) => !isMobile, 'Mobile-only visual checks');

const ADMIN_EMAIL = 'admin@clinica-tanah.com.br';
const PASSWORD = 'clinica2026';
const SHOT_DIR = '/opt/cursor/artifacts/screenshots/mobile-visual';

mkdirSync(SHOT_DIR, { recursive: true });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 20_000 });
}

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow ${overflow}px`).toBeLessThanOrEqual(2);
}

/** Buttons/links that look compressed (< 36px tall or < 36px wide when labeled). */
async function expectButtonsNotSquished(page: Page, selector = 'button.btn-primary, button.btn-secondary, [data-testid="login-submit"], [data-testid="new-user"], [data-testid="new-employee"], [data-testid="run-payroll"], [data-testid="mobile-menu-button"]') {
  const issues = await page.evaluate((sel) => {
    const bad: string[] = [];
    document.querySelectorAll(sel).forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return; // hidden
      if (r.height < 36) bad.push(`${(el as HTMLElement).dataset.testid || el.className}: h=${Math.round(r.height)}`);
      // Full-width mobile CTAs should not be a thin strip
      if (r.width < 44 && r.height >= 36) bad.push(`${(el as HTMLElement).dataset.testid || el.className}: w=${Math.round(r.width)}`);
    });
    return bad;
  }, selector);
  expect(issues, `squished controls:\n${issues.join('\n')}`).toEqual([]);
}

async function expectTextNotClipped(page: Page, testId: string) {
  const clipped = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    if (!el) return `missing:${id}`;
    const style = getComputedStyle(el);
    // Allow intentional truncate on titles; flag extreme height collapse
    const r = el.getBoundingClientRect();
    if (r.height < 20 && (el.textContent || '').trim().length > 0) return `collapsed:${id}`;
    if (style.visibility === 'hidden') return `hidden:${id}`;
    return null;
  }, testId);
  expect(clipped).toBeNull();
}

test.describe('Mobile visual — updated surfaces', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('Login — brand + form fit viewport', async () => {
    await page.goto('/login');
    await expect(page.getByTestId('login-card')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectButtonsNotSquished(page, '[data-testid="login-submit"], [data-testid="toggle-password"]');
    const submitBox = await page.getByTestId('login-submit').boundingBox();
    expect(submitBox?.height ?? 0).toBeGreaterThanOrEqual(40);
    expect(submitBox?.width ?? 0).toBeGreaterThanOrEqual(200);
    await shot(page, '01-login');
  });

  test('Dashboard after sign-in', async () => {
    await signIn(page);
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('mobile-menu-button')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectButtonsNotSquished(page);
    await shot(page, '02-dashboard');
  });

  test('Equipe — list + new user modal', async () => {
    await page.goto('/team');
    await expect(page.getByTestId('team-page')).toBeVisible();
    await expect(page.getByTestId('new-user')).toBeVisible();
    await expect(page.getByTestId('show-inactive')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectButtonsNotSquished(page);
    await shot(page, '03-team');

    await page.getByTestId('new-user').click();
    await expect(page.getByTestId('user-name')).toBeVisible();
    await expect(page.getByTestId('user-cpf')).toBeVisible();
    // Modal fields should stack, not force tiny two-column cells
    const cpfBox = await page.getByTestId('user-cpf').boundingBox();
    expect(cpfBox?.width ?? 0).toBeGreaterThanOrEqual(240);
    await expectNoHorizontalOverflow(page);
    await shot(page, '04-team-modal');
    await page.keyboard.press('Escape');
  });

  test('Folha — run controls + employee modal', async () => {
    await page.goto('/payroll');
    await expect(page.getByTestId('payroll-page')).toBeVisible();
    await expect(page.getByTestId('new-employee')).toBeVisible();
    await expect(page.getByTestId('run-payroll')).toBeVisible();
    await expect(page.getByTestId('run-type')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectButtonsNotSquished(page);
    const runBox = await page.getByTestId('run-payroll').boundingBox();
    expect(runBox?.height ?? 0).toBeGreaterThanOrEqual(40);
    await shot(page, '05-payroll');

    await page.getByTestId('new-employee').click();
    await expect(page.locator('form').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, '06-payroll-modal');
    await page.keyboard.press('Escape');
  });

  test('WhatsApp — tabs scroll, not squish', async () => {
    await page.goto('/whatsapp');
    await expect(page.getByTestId('whatsapp-marketing')).toBeVisible();
    const tabs = page.getByTestId('whatsapp-tabs');
    await expect(tabs).toBeVisible();
    // Each tab keeps readable width
    const tabSizes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-testid^="tab-"]')).map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { id: (el as HTMLElement).dataset.testid, w: Math.round(r.width), h: Math.round(r.height) };
      });
    });
    for (const t of tabSizes) {
      expect(t.h, `${t.id} height`).toBeGreaterThanOrEqual(32);
      expect(t.w, `${t.id} width`).toBeGreaterThanOrEqual(48);
    }
    await expectNoHorizontalOverflow(page);
    await shot(page, '07-whatsapp');
  });

  test('Patients + drawer navigation still roomy', async () => {
    await page.goto('/patients');
    await expect(page.getByTestId('patients-crm')).toBeVisible();
    await expect(page.getByTestId('new-patient')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectButtonsNotSquished(page, 'button.btn-primary, button.btn-secondary, [data-testid="new-patient"], [data-testid="mobile-menu-button"]');
    await shot(page, '08-patients');

    await page.getByTestId('mobile-menu-button').click();
    const drawer = page.getByTestId('mobile-drawer');
    await expect(drawer).toBeInViewport();
    await shot(page, '09-drawer');
    await drawer.getByRole('link', { name: /folha|payroll|nómina/i }).click();
    await page.waitForURL(/\/payroll/, { timeout: 10_000 });
    await expect(page.getByTestId('payroll-page')).toBeVisible();
  });

  test('Invoices + Settings headers', async () => {
    for (const [route, marker] of [
      ['/invoices', 'new-invoice'],
      ['/settings', 'mint-token'],
      ['/lgpd', 'new-lgpd-request'],
    ] as const) {
      await page.goto(route);
      await expect(page.getByTestId(marker)).toBeVisible({ timeout: 10_000 });
      await expectNoHorizontalOverflow(page);
      await expectButtonsNotSquished(page, `button.btn-primary, button.btn-secondary, [data-testid="${marker}"]`);
      await shot(page, `10-${route.replace('/', '')}`);
    }
  });
});
