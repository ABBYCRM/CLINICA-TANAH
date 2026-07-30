/**
 * Clínica Tanah E2E suite — production smoke test
 * Runs against https://clinica-tanah-bbqu7.ondigitalocean.app
 */
import { test, expect, request, Page } from '@playwright/test';

const BASE = 'https://clinica-tanah-bbqu7.ondigitalocean.app';
const PASSWORD = 'clinica2026';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[console.error]', m.text());
  });
});

test.describe('Clínica Tanah — production smoke', () => {
  test('1. health + login + dashboard', async ({ page }) => {
    const res = await page.request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);

    await page.goto(`${BASE}/login`);
    await page.locator('input[type=email]').fill('admin@clinica-tanah.com.br');
    await page.locator('input[type=password]').fill(PASSWORD);
    await page.locator('button[type=submit]').click();
    await page.waitForURL(/\/(dashboard|patients)?$/, { timeout: 10_000 });
    // dashboard heading
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('2. patients page + bulk import modal opens', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.locator('input[type=email]').fill('admin@clinica-tanah.com.br');
    await page.locator('input[type=password]').fill(PASSWORD);
    await page.locator('button[type=submit]').click();
    await page.waitForURL(/\/(dashboard|patients)?$/);
    await page.goto(`${BASE}/patients`);
    await expect(page.getByRole('heading', { name: /Pacientes|Patients/i })).toBeVisible();
    // Should have at least Luis Lacerda
    await expect(page.getByText('Luis Lacerda')).toBeVisible();
    // Open bulk import
    await page.getByRole('button', { name: /Bulk Import/i }).click();
    await expect(page.getByText('Bulk Patient Import')).toBeVisible();
    // Switch to FHIR tab
    await page.getByRole('button', { name: /FHIR R4/ }).click();
    await expect(page.getByPlaceholder(/Bundle/i)).toBeVisible();
  });

  test('3. FHIR R4 metadata endpoint (MedX compat)', async ({ request }) => {
    // Login
    const login = await request.post(`${BASE}/api/auth/login`, {
      data: { email: 'admin@clinica-tanah.com.br', password: PASSWORD },
    });
    const { token } = await login.json();
    expect(token).toBeTruthy();

    // FHIR metadata
    const meta = await request.get(`${BASE}/api/fhir/metadata`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meta.status()).toBe(200);
    const m = await meta.json();
    expect(m.resourceType).toBe('CapabilityStatement');
    expect(m.fhirVersion).toBe('4.0.1');
    expect(m.software.name).toBe('clinica-tanah');
    const types = m.rest[0].resource.map((r: any) => r.type);
    expect(types).toContain('Patient');
    expect(types).toContain('Encounter');
  });

  test('4. bulk FHIR R4 import — adds a new patient', async ({ request }) => {
    const login = await request.post(`${BASE}/api/auth/login`, {
      data: { email: 'admin@clinica-tanah.com.br', password: PASSWORD },
    });
    const { token } = await login.json();
    const unique = `Test${Date.now()}`;
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            name: [{ family: `${unique}Family`, given: [unique] }],
            telecom: [{ system: 'phone', value: '+5511900000001' }],
            birthDate: '1990-01-01',
            identifier: [
              { system: 'https://clinica-tanah.com.br/identifier/cpf', value: `999${Date.now().toString().slice(-8)}` },
            ],
          },
        },
      ],
    };
    const r = await request.post(`${BASE}/api/patients/bulk-fhir?policy_version=1.0`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: bundle,
    });
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.inserted).toBeGreaterThanOrEqual(1);
    expect(j.patients[0].full_name).toContain(unique);
  });

  test('5. bulk CSV import — adds 2 patients', async ({ request }) => {
    const login = await request.post(`${BASE}/api/auth/login`, {
      data: { email: 'admin@clinica-tanah.com.br', password: PASSWORD },
    });
    const { token } = await login.json();
    const stamp = Date.now();
    const cpf1 = `${stamp.toString().slice(0,9)}01`;
    const cpf2 = `${stamp.toString().slice(0,9)}02`;
    const csv = `full_name,cpf,phone,birth_date,blood_type,health_insurance\nCSV${stamp} User1,${cpf1},+5511950000001,1985-01-01,O+,Amil\nCSV${stamp} User2,${cpf2},+5511950000002,1990-05-15,A+,Particular\n`;
    const r = await request.post(`${BASE}/api/patients/bulk-csv?policy_version=1.0`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv' },
      data: csv,
    });
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.inserted).toBe(2);
    expect(j.failed).toBe(0);
  });

  test('6. WhatsApp bot — Proctologia (6) is in the menu', async ({ request }) => {
    const login = await request.post(`${BASE}/api/auth/login`, {
      data: { email: 'admin@clinica-tanah.com.br', password: PASSWORD },
    });
    const { token } = await login.json();
    // Start fresh conversation
    const phone = `+55619${Date.now().toString().slice(-7)}`;
    // 1) agendar
    let r = await request.post(`${BASE}/api/whatsapp/simulate`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { phone, body: '1', locale: 'pt-BR' },
    });
    let j = await r.json();
    expect(j.last_bot_reply.body).toContain('CPF');
    // 2) send Luis's CPF
    r = await request.post(`${BASE}/api/whatsapp/simulate`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { phone, body: '56140504780', locale: 'pt-BR' },
    });
    j = await r.json();
    const reply = j.last_bot_reply.body;
    expect(reply).toContain('Dermatologia');
    expect(reply).toContain('Proctologia');
    expect(reply).toContain('6️⃣');
  });

  test('7. FHIR R4 Patient read by id returns Luis', async ({ request }) => {
    const login = await request.post(`${BASE}/api/auth/login`, {
      data: { email: 'admin@clinica-tanah.com.br', password: PASSWORD },
    });
    const { token } = await login.json();
    // Get Luis
    const list = await request.get(`${BASE}/api/patients?q=Luis`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const lj = await list.json();
    expect(lj.patients.length).toBeGreaterThanOrEqual(1);
    const luisId = lj.patients[0].id;
    // FHIR GET
    const fhirGet = await request.get(`${BASE}/api/fhir/Patient/${luisId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(fhirGet.status()).toBe(200);
    const fp = await fhirGet.json();
    expect(fp.resourceType).toBe('Patient');
    expect(fp.id).toBe(luisId);
    expect(fp.name[0].family).toContain('Lacerda');
  });

  test('8. WhatsApp bot — full booking flow to Proctologia (DR. ANDRÉ MENDES)', async ({ request }) => {
    const login = await request.post(`${BASE}/api/auth/login`, {
      data: { email: 'admin@clinica-tanah.com.br', password: PASSWORD },
    });
    const { token } = await login.json();
    const phone = `+55619${Date.now().toString().slice(-7).slice(0, 7)}`;

    const send = async (body: string) => {
      const r = await request.post(`${BASE}/api/whatsapp/simulate`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { phone, body, locale: 'pt-BR' },
      });
      return (await r.json()).last_bot_reply.body;
    };

    const askMenu = await send('oi');
    expect(askMenu).toContain('Agendar consulta');
    expect(await send('1')).toContain('CPF');
    expect(await send('56140504780')).toContain('Proctologia');
    expect(await send('6')).toMatch(/dia|AMANH|HOJE/); // asks for date
    // AMANHÃ auto-picks the first available slot and confirms
    const confirm = await send('AMANHÃ');
    expect(confirm).toMatch(/Consulta agendada|confirmada|Dr\. André|📅/i);
    expect(confirm).toContain('André'); // Dr. André Mendes (Proctologia)
  });
});
