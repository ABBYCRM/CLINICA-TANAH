/**
 * Full clinical report — Relatórios tab generates dossier HTML.
 */
import { test, expect } from '@playwright/test';

const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.E2E_PASSWORD || '12345678';

test.describe('Full clinical report', () => {
  test.setTimeout(90_000);

  test('API creates dossier with patient history sections', async ({ request, baseURL }) => {
    const login = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: 'Juliana', password: PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    const patients = await request.get(`${baseURL}/api/patients`, { headers });
    expect(patients.ok()).toBeTruthy();
    const list = await patients.json();
    const patientId = list.patients?.[0]?.id || list[0]?.id;
    expect(patientId).toBeTruthy();

    const created = await request.post(`${baseURL}/api/clinical/body/${patientId}/clinical-reports`, {
      headers,
      data: {
        signature_name: 'Dra. Juliana — CRM-SP',
        include: {
          demographics: true,
          consents: true,
          alerts: true,
          measurements: true,
          medications: true,
          lifestyle: true,
          captures: true,
          scenarios: true,
          chart: true,
          appointments: true,
        },
      },
    });
    expect(created.ok()).toBeTruthy();
    const body = await created.json();
    expect(body.html_url).toContain('/clinical-reports/');
    expect(body.counts).toBeTruthy();

    const html = await request.get(`${baseURL}${body.html_url}`, { headers });
    expect(html.ok()).toBeTruthy();
    const text = await html.text();
    expect(text).toContain('Relatório clínico completo');
    expect(text).toMatch(/Identificação|Demografia|Antropometria|Consentimentos/i);
  });

  test('UI generate button on Relatórios tab', async ({ page }) => {
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
    await page.getByTestId('body-tab-reports').click();
    await expect(page.getByTestId('body-reports')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('body-full-report-form')).toBeVisible();
    await page.getByTestId('body-full-report-signature').fill('Dra. Juliana — CRM-SP');
    await page.getByTestId('body-full-report-generate').click();
    await expect(page.getByTestId('body-full-report-msg')).toContainText(/gerado|generated|generado/i, { timeout: 15_000 });
    await expect.poll(async () => page.getByTestId('body-reports-list').locator('li').count(), { timeout: 10_000 }).toBeGreaterThan(0);
  });
});
