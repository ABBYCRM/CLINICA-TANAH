/**
 * Patient Consultas — create appointment wired to clinic scheduler.
 */
import { test, expect } from '@playwright/test';

const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.E2E_PASSWORD || '12345678';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

test.describe('Patient create consultas', () => {
  test.setTimeout(120_000);

  test('API creates appointment visible on scheduler range', async ({ request, baseURL }) => {
    const loginRes = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: 'Juliana', password: PASSWORD },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { token, user } = await loginRes.json();
    const headers = { Authorization: `Bearer ${token}` };

    const patients = await request.get(`${baseURL}/api/patients`, { headers });
    const patientId = (await patients.json()).patients?.[0]?.id;
    expect(patientId).toBeTruthy();

    const users = await request.get(`${baseURL}/api/users`, { headers });
    const staff = (await users.json()).users || (await users.json());
    const practitioner = (Array.isArray(staff) ? staff : []).find((u: any) =>
      ['doctor', 'admin', 'nurse'].includes(u.role),
    ) || { id: user?.id };
    expect(practitioner?.id).toBeTruthy();

    // Pick a far-future weekday morning slot unlikely to collide with seed
    const day = new Date();
    day.setDate(day.getDate() + 21);
    while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
    const yyyy = day.getFullYear();
    const mm = String(day.getMonth() + 1).padStart(2, '0');
    const dd = String(day.getDate()).padStart(2, '0');
    const scheduled_at = `${yyyy}-${mm}-${dd} 11:00:00`;

    const created = await request.post(`${baseURL}/api/appointments`, {
      headers,
      data: {
        patient_id: patientId,
        practitioner_id: practitioner.id,
        scheduled_at,
        duration_minutes: 30,
        type: 'consultation',
        status: 'confirmed',
        notes: 'E2E patient workspace booking',
        source: 'reception',
      },
    });
    expect(created.ok()).toBeTruthy();
    const body = await created.json();
    expect(body.id).toBeTruthy();

    const from = `${yyyy}-${mm}-${dd}`;
    const list = await request.get(`${baseURL}/api/appointments?from=${from}&to=${from}`, { headers });
    expect(list.ok()).toBeTruthy();
    const appts = (await list.json()).appointments || [];
    expect(appts.some((a: any) => a.id === body.id && a.patient_id === patientId)).toBeTruthy();

    const record = await request.get(`${baseURL}/api/patients/${patientId}/record`, { headers });
    const rec = await record.json();
    expect((rec.associations?.appointments?.items || []).some((a: any) => a.id === body.id)
      || (rec.timeline || []).some((t: any) => t.id === `appt-${body.id}`)).toBeTruthy();
  });

  test('UI books from Consultas tab and opens scheduler deep link', async ({ page }) => {
    await login(page);
    await page.goto('/patients');
    await page.locator('[data-testid^="patient-row-"]').first().click();
    await page.waitForURL(/\/patients\//);
    await page.getByTestId('workspace-tab-appointments').click();
    await expect(page.getByTestId('workspace-appointments')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('workspace-appointment-form')).toBeVisible();

    // Staff picker
    await page.getByTestId('staff-picker-input').click();
    await page.getByTestId('staff-picker-input').fill('Juli');
    const staffOpt = page.locator('[data-testid="staff-picker-results"] button, [data-testid="staff-picker-results"] li').first();
    await expect(staffOpt).toBeVisible({ timeout: 10_000 });
    await staffOpt.click();

    const day = new Date();
    day.setDate(day.getDate() + 18);
    while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
    const yyyy = day.getFullYear();
    const mm = String(day.getMonth() + 1).padStart(2, '0');
    const dd = String(day.getDate()).padStart(2, '0');
    await page.getByTestId('appointment-datetime').fill(`${yyyy}-${mm}-${dd}T15:30`);
    await page.getByTestId('appointment-type').selectOption('consultation');
    await page.getByTestId('appointment-submit').click();

    await expect(page.getByTestId('appt-msg')).toBeVisible({ timeout: 15_000 });
    const link = page.getByTestId('appt-goto-scheduler');
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/appointments/, { timeout: 15_000 });
    await expect(page.getByTestId('calendar-view')).toBeVisible({ timeout: 15_000 });
  });
});
