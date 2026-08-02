/**
 * Patient tasks — create with fields + optional WhatsApp automation link.
 */
import { test, expect } from '@playwright/test';

const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.E2E_PASSWORD || '12345678';

async function openPatientTasks(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
  await page.goto('/patients');
  await page.locator('[data-testid^="patient-row-"]').first().click();
  await page.waitForURL(/\/patients\//);
  await page.getByTestId('workspace-tab-tasks').click();
  await expect(page.getByTestId('workspace-tasks')).toBeVisible({ timeout: 15_000 });
}

test.describe('Patient tasks + automations', () => {
  test.setTimeout(90_000);

  test('API creates task linked to automation', async ({ request, baseURL }) => {
    const login = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: 'Juliana', password: PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    const patients = await request.get(`${baseURL}/api/patients`, { headers });
    const list = await patients.json();
    const patientId = list.patients?.[0]?.id;
    expect(patientId).toBeTruthy();

    const autos = await request.get(`${baseURL}/api/whatsapp/automations`, { headers });
    expect(autos.ok()).toBeTruthy();
    const { automations } = await autos.json();
    expect(automations.length).toBeGreaterThan(0);
    const auto = automations.find((a: any) => a.key === 'no_show') || automations[0];

    const created = await request.post(`${baseURL}/api/patients/${patientId}/tasks`, {
      headers,
      data: {
        title: 'Remarcar no-show',
        description: 'Ligar e oferecer horários',
        category: 'no_show',
        priority: 'high',
        due_at: '2026-08-05T15:00:00',
        related_automation_id: auto.id,
        automation_link_mode: 'reference',
      },
    });
    expect(created.ok()).toBeTruthy();
    const body = await created.json();
    expect(body.id).toBeTruthy();
    expect(body.task?.related_automation_id).toBe(auto.id);
    expect(body.task?.automation_key).toBe(auto.key);

    const record = await request.get(`${baseURL}/api/patients/${patientId}/record`, { headers });
    const rec = await record.json();
    const task = (rec.tasks || []).find((t: any) => t.id === body.id);
    expect(task).toBeTruthy();
    expect(task.automation_key || task.automation_key_resolved).toBeTruthy();
  });

  test('UI create task on Tarefas tab', async ({ page }) => {
    await openPatientTasks(page);
    await expect(page.getByTestId('workspace-task-form')).toBeVisible();
    await page.getByTestId('task-title').fill('Follow-up pós consulta');
    await page.getByTestId('task-description').fill('Confirmar adesão ao plano');
    await page.getByTestId('task-category').selectOption('follow_up');
    await page.getByTestId('task-priority').selectOption('normal');
    await page.getByTestId('task-automation').selectOption({ index: 1 }).catch(() => {});
    await page.getByTestId('task-submit').click();
    await expect(page.getByTestId('task-msg')).toContainText(/criada|created|creada/i, { timeout: 10_000 });
    await expect(page.locator('[data-testid^="task-"]').filter({ hasText: 'Follow-up pós consulta' })).toBeVisible({ timeout: 10_000 });
  });
});
