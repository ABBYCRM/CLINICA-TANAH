/**
 * Patient documents vault — upload, list, remove, and auto-include intake/sources.
 */
import { test, expect } from '@playwright/test';

const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.E2E_PASSWORD || '12345678';

async function openPatientDocuments(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
  await page.goto('/patients');
  await page.locator('[data-testid^="patient-row-"]').first().click();
  await page.waitForURL(/\/patients\//);
  await page.getByTestId('workspace-tab-documents').click();
  await expect(page.getByTestId('workspace-documents')).toBeVisible({ timeout: 15_000 });
}

test.describe('Patient documents vault', () => {
  test.setTimeout(90_000);

  test('API upload + list + delete + intake appears in vault', async ({ request, baseURL }) => {
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

    const tinyTxt = Buffer.from('documento de teste vault', 'utf8').toString('base64');

    const created = await request.post(`${baseURL}/api/patients/${patientId}/documents`, {
      headers,
      data: {
        title: 'Termo teste vault',
        filename: 'termo-teste.txt',
        mime: 'text/plain',
        data_base64: tinyTxt,
        doc_type: 'upload',
      },
    });
    expect(created.ok()).toBeTruthy();
    const body = await created.json();
    expect(body.id).toBeTruthy();

    const listed = await request.get(`${baseURL}/api/patients/${patientId}/documents`, { headers });
    expect(listed.ok()).toBeTruthy();
    const { documents } = await listed.json();
    expect(Array.isArray(documents)).toBeTruthy();
    const uploaded = documents.find((d: any) => d.id === body.id);
    expect(uploaded).toBeTruthy();
    expect(uploaded.can_download).toBeTruthy();
    expect(uploaded.can_delete).toBeTruthy();

    const file = await request.get(`${baseURL}/api/patients/${patientId}/documents/${body.id}/file`, { headers });
    expect(file.ok()).toBeTruthy();
    expect((await file.text())).toContain('documento de teste vault');

    // Seed a clinical attachment so it shows in the unified list
    const att = await request.post(`${baseURL}/api/clinical/chart/${patientId}/attachments`, {
      headers,
      data: {
        title: 'Anexo clinico vault',
        doc_type: 'lab',
        filename: 'lab.txt',
        data_base64: Buffer.from('resultado lab', 'utf8').toString('base64'),
      },
    });
    expect(att.ok()).toBeTruthy();
    const attId = (await att.json()).id;
    expect(attId).toBeTruthy();

    const record = await request.get(`${baseURL}/api/patients/${patientId}/record`, { headers });
    expect(record.ok()).toBeTruthy();
    const rec = await record.json();
    expect((rec.documents || []).some((d: any) => d.id === body.id)).toBeTruthy();
    expect((rec.documents || []).some((d: any) => d.source === 'clinical_attachment' && d.source_id === attId)).toBeTruthy();

    const deleted = await request.delete(`${baseURL}/api/patients/${patientId}/documents/${body.id}`, { headers });
    expect(deleted.ok()).toBeTruthy();

    const after = await request.get(`${baseURL}/api/patients/${patientId}/documents`, { headers });
    const afterDocs = (await after.json()).documents || [];
    expect(afterDocs.some((d: any) => d.id === body.id)).toBeFalsy();
  });

  test('UI add and remove document on Documentos tab', async ({ page }) => {
    await openPatientDocuments(page);
    await expect(page.getByTestId('workspace-document-form')).toBeVisible();
    const title = `Consentimento UI ${Date.now()}`;
    await page.getByTestId('doc-title').fill(title);
    await page.getByTestId('doc-submit').click();
    await expect(page.getByTestId('doc-msg')).toContainText(/salvo|saved|guardado/i, { timeout: 10_000 });
    const row = page.locator('[data-testid^="doc-row-"]').filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.locator('[data-testid^="doc-remove-"]').click();
    await expect(row).toHaveCount(0, { timeout: 10_000 });
  });
});
