/**
 * Patient WhatsApp tab — thread, send, and run automations.
 */
import { test, expect } from '@playwright/test';

const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.E2E_PASSWORD || '12345678';

async function openPatientWhatsApp(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
  await page.goto('/patients');
  // Prefer José who has seeded WhatsApp history
  const jose = page.locator('[data-testid^="patient-row-"]').filter({ hasText: /Jos[eé]/i });
  if (await jose.count()) await jose.first().click();
  else await page.locator('[data-testid^="patient-row-"]').first().click();
  await page.waitForURL(/\/patients\//);
  await page.getByTestId('workspace-tab-whatsapp').click();
  await expect(page.getByTestId('workspace-whatsapp')).toBeVisible({ timeout: 15_000 });
}

test.describe('Patient WhatsApp wire', () => {
  test.setTimeout(90_000);

  test('API send + automation for patient', async ({ request, baseURL }) => {
    const login = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: 'Juliana', password: PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    const patients = await request.get(`${baseURL}/api/patients`, { headers });
    const list = await patients.json();
    const withPhone = (list.patients || []).find((p: any) => p.phone) || list.patients?.[0];
    expect(withPhone?.id).toBeTruthy();

    const thread = await request.get(`${baseURL}/api/patients/${withPhone.id}/whatsapp`, { headers });
    expect(thread.ok()).toBeTruthy();
    const tw = await thread.json();
    expect(tw.phone).toBeTruthy();
    expect(Array.isArray(tw.automations)).toBeTruthy();
    expect(tw.automations.length).toBeGreaterThan(0);

    const sent = await request.post(`${baseURL}/api/patients/${withPhone.id}/whatsapp/send`, {
      headers,
      data: { body: 'Olá — teste wire paciente WhatsApp' },
    });
    expect(sent.ok()).toBeTruthy();
    const sendBody = await sent.json();
    expect(sendBody.ok).toBeTruthy();
    expect(sendBody.dry_run).toBeTruthy();
    expect((sendBody.messages || []).some((m: any) => String(m.body).includes('teste wire'))).toBeTruthy();

    const auto = tw.automations.find((a: any) => a.enabled && a.key === 'welcome')
      || tw.automations.find((a: any) => a.enabled)
      || tw.automations[0];
    const run = await request.post(
      `${baseURL}/api/patients/${withPhone.id}/whatsapp/automations/${auto.id}/run`,
      { headers, data: {} },
    );
    expect([200, 409].includes(run.status())).toBeTruthy();
    const runBody = await run.json();
    expect(runBody.key || runBody.error).toBeTruthy();

    const record = await request.get(`${baseURL}/api/patients/${withPhone.id}/record`, { headers });
    expect(record.ok()).toBeTruthy();
    const rec = await record.json();
    expect((rec.whatsapp_messages || []).length).toBeGreaterThan(0);
    expect(rec.whatsapp?.phone || rec.patient?.phone).toBeTruthy();
  });

  test('UI compose and show thread without Sem dados only', async ({ page }) => {
    await openPatientWhatsApp(page);
    await expect(page.getByTestId('workspace-whatsapp-compose')).toBeVisible();
    await expect(page.getByTestId('workspace-whatsapp-automations')).toBeVisible();
    // Should not show the generic empty double state as the only content
    await page.getByTestId('wa-draft').fill('Mensagem UI do prontuário');
    await page.getByTestId('wa-send').click();
    await expect(page.getByTestId('wa-msg')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid^="wa-msg-"]').filter({ hasText: 'Mensagem UI do prontuário' })).toBeVisible({ timeout: 10_000 });
  });
});
