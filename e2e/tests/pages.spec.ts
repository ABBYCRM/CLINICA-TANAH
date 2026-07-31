/**
 * Full page-by-page Playwright check.
 * Visits every authenticated route (+ login), asserts the page renders,
 * key actions are present, no fatal UI error banners, and captures screenshots.
 */
import { test, expect, Page, ConsoleMessage } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const ADMIN_EMAIL = 'admin@clinica-tanah.com.br';
const PASSWORD = 'clinica2026';
const SHOT_DIR = '/opt/cursor/artifacts/screenshots/pages';

mkdirSync(SHOT_DIR, { recursive: true });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 20_000 });
}

async function shot(page: Page, name: string) {
  const project = test.info().project.name.replace(/[^a-z0-9_-]/gi, '-');
  await page.screenshot({
    path: path.join(SHOT_DIR, `${project}-${name}.png`),
    fullPage: true,
  });
}

function attachConsoleGuard(page: Page) {
  const pageErrors: string[] = [];
  const severe: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore benign network noise from optional Meta ping / favicon
      if (/favicon|Download the React DevTools|Meta|net::ERR_/i.test(text)) return;
      severe.push(text);
    }
  });
  return {
    assertClean: async () => {
      expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    },
    severe,
  };
}

async function expectLoadedListOrCards(page: Page) {
  // Prefer a table when present; otherwise accept card grid / empty state.
  const table = page.locator('table').first();
  if (await table.count()) {
    await expect(table).toBeVisible();
    return;
  }
  const empty = page.getByText(/sem dados|no data|sin datos/i).first();
  const card = page.locator('.card').first();
  await expect(empty.or(card)).toBeVisible({ timeout: 10_000 });
}

async function expectNoFatalBanner(page: Page) {
  const dashboardError = page.getByTestId('dashboard-error');
  if (await dashboardError.count()) {
    await expect(dashboardError).toHaveCount(0);
  }
}

test.describe('Page-by-page tour', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  let page: Page;
  let guard: ReturnType<typeof attachConsoleGuard>;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    guard = attachConsoleGuard(page);
    await signIn(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('Login page (signed-out check via API redirect path already covered)', async () => {
    // Already signed in — verify shell chrome from dashboard landing
    await page.goto('/');
    await expect(page.getByTestId('active-clinic')).toBeVisible();
    await shot(page, '00-shell');
  });

  test('Painel (Dashboard)', async () => {
    await page.goto('/');
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.card').first()).toBeVisible();
    await expectNoFatalBanner(page);
    await shot(page, '01-dashboard');
    await guard.assertClean();
  });

  test('Pacientes', async () => {
    await page.goto('/patients');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-patient')).toBeVisible();
    await expectLoadedListOrCards(page);
    await shot(page, '02-patients');
    await guard.assertClean();
  });

  test('Consultas', async () => {
    await page.goto('/appointments');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-appointment')).toBeVisible();
    await expect(page.getByTestId('view-calendar')).toBeVisible();
    await expect(page.getByTestId('view-list')).toBeVisible();
    await page.getByTestId('view-list').click();
    await page.getByTestId('view-calendar').click();
    await expect(page.getByTestId('calendar-view')).toBeVisible();
    await shot(page, '03-appointments');
    await guard.assertClean();
  });

  test('Atendimentos', async () => {
    await page.goto('/encounters');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-encounter')).toBeVisible();
    await expectLoadedListOrCards(page);
    await shot(page, '04-encounters');
    await guard.assertClean();
  });

  test('Receitas', async () => {
    await page.goto('/prescriptions');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-prescription')).toBeVisible();
    await expectLoadedListOrCards(page);
    await shot(page, '05-prescriptions');
    await guard.assertClean();
  });

  test('Estoque (items / batches / movements)', async () => {
    await page.goto('/inventory');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-item')).toBeVisible();
    // Cycle inventory sub-tabs by visible labels (PT/ES/EN)
    const tabLabels = [
      /itens|items|ítems/i,
      /lotes|batches|lotes/i,
      /moviment|movement|movimient/i,
      /alerta|alert/i,
    ];
    for (const re of tabLabels) {
      const btn = page.locator('button').filter({ hasText: re }).first();
      if (await btn.count()) await btn.click();
    }
    await shot(page, '06-inventory');
    await guard.assertClean();
  });

  test('Fornecedores', async () => {
    await page.goto('/vendors');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-vendor')).toBeVisible();
    await expectLoadedListOrCards(page);
    await shot(page, '07-vendors');
    await guard.assertClean();
  });

  test('Contabilidade (tabs)', async () => {
    await page.goto('/accounting');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('table').first()).toBeVisible({ timeout: 10_000 });
    for (const re of [
      /balancete|trial balance|balancete/i,
      /dre|income|resultado/i,
      /plano|accounts|cuentas/i,
      /lançamento|journal|asiento/i,
    ]) {
      const btn = page.locator('button').filter({ hasText: re }).first();
      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(200);
      }
    }
    await page.locator('button').filter({ hasText: /plano|accounts|cuentas/i }).first().click();
    await expect(page.getByTestId('new-account')).toBeVisible();
    await shot(page, '08-accounting');
    await guard.assertClean();
  });

  test('Faturas', async () => {
    await page.goto('/invoices');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-invoice')).toBeVisible();
    await expectLoadedListOrCards(page);
    await shot(page, '09-invoices');
    await guard.assertClean();
  });

  test('Folha', async () => {
    await page.goto('/payroll');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-employee')).toBeVisible();
    await expectLoadedListOrCards(page);
    await shot(page, '10-payroll');
    await guard.assertClean();
  });

  test('Marketing WhatsApp — all tabs', async () => {
    await page.goto('/whatsapp');
    await expect(page.getByTestId('whatsapp-marketing')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const tabs = [
      ['tab-chat', null],
      ['tab-campaigns', 'new-campaign'],
      ['tab-templates', 'templates-view'],
      ['tab-automations', 'automations-view'],
      ['tab-audience', 'audience-view'],
      ['tab-analytics', 'analytics-view'],
      ['tab-surveys', 'dispatch-surveys'],
    ] as const;

    for (const [tabId, marker] of tabs) {
      await page.getByTestId(tabId).click();
      if (marker) await expect(page.getByTestId(marker)).toBeVisible({ timeout: 10_000 });
      await shot(page, `11-whatsapp-${tabId}`);
    }
    await guard.assertClean();
  });

  test('LGPD', async () => {
    await page.goto('/lgpd');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-lgpd-request')).toBeVisible();
    await shot(page, '12-lgpd');
    await guard.assertClean();
  });

  test('Manual do usuário', async () => {
    await page.goto('/manual');
    await expect(page.getByTestId('user-manual')).toBeVisible();
    await expect(page.getByTestId('manual-toc')).toBeVisible();
    await expect(page.getByTestId('manual-modules-table')).toBeVisible();
    await expect(page.getByTestId('manual-roles-table')).toBeVisible();
    await page.getByTestId('manual-toc-marketing').click();
    await expect(page.getByTestId('manual-section-marketing')).toBeVisible();
    await shot(page, '13-manual');
    await guard.assertClean();
  });

  test('Equipe', async () => {
    await page.goto('/team');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-user')).toBeVisible();
    await expectLoadedListOrCards(page);
    await shot(page, '14-team');
    await guard.assertClean();
  });

  test('Configurações', async () => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('mint-token')).toBeVisible();
    await shot(page, '15-settings');
    await guard.assertClean();
  });

  test('Clínicas (superadmin)', async () => {
    await page.goto('/clinics');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-clinic')).toBeVisible();
    await shot(page, '16-clinics');
    await guard.assertClean();
  });

  test('Login page still works when signed out', async () => {
    await page.evaluate(() => {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    });
    await page.goto('/login');
    await expect(page.getByTestId('login-card')).toBeVisible();
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await shot(page, '17-login');
    await guard.assertClean();
  });
});
