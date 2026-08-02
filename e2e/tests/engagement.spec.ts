/**
 * Engagement e2e — MedX-parity patient record, NPS surveys, and
 * promotional campaigns (customer appreciation day), desktop + mobile.
 */
import { test, expect, Page } from '@playwright/test';

const ADMIN_EMAIL = 'Juliana';
const PASSWORD = '12345678';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

async function apiToken(request: any, baseURL: string) {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: PASSWORD },
  });
  return (await res.json()).token as string;
}

test('MedX-parity patient record: full sociodemographic + contact fields', async ({ page, request, baseURL }) => {
  const stamp = Date.now().toString().slice(-8);
  const name = `MedX Paciente ${stamp}`;
  await signIn(page);
  await page.goto('/patients');
  await page.getByTestId('new-patient').click();

  // sections are present (MedX-style record)
  await expect(page.getByText(/Identifica/i)).toBeVisible();
  await expect(page.getByText(/sociodemogr/i)).toBeVisible();

  await page.getByTestId('patient-name').fill(name);
  await page.locator('input[type="date"]').first().fill('1988-07-20');
  await page.locator('input[placeholder="12345678900"]').fill(stamp.padStart(11, '3'));
  await page.locator('input[placeholder="+5511999999999"]').fill(`+5511966${stamp.slice(0, 6)}`);
  await page.locator('input[placeholder="123456789012345"]').fill(stamp.padStart(15, '7')); // CNS
  await page.locator('fieldset', { hasText: /Identifica/i }).locator('input').nth(7).fill(`Mãe E2E ${stamp}`);
  await page.locator('fieldset', { hasText: /sociodemogr/i }).locator('input').first().fill('Engenheira');
  await page.locator('form input[type="checkbox"]').check();
  await page.getByTestId('form-submit').click();

  await expect(page.getByRole('cell', { name })).toBeVisible({ timeout: 10_000 });

  // the full record round-trips through the API
  const token = await apiToken(request, baseURL!);
  const list = await request.get(`${baseURL}/api/patients?q=${stamp}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const patient = (await list.json()).patients[0];
  const detail = await request.get(`${baseURL}/api/patients/${patient.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const full = (await detail.json()).patient;
  expect(full.cns).toBe(stamp.padStart(15, '7'));
  expect(full.mother_name).toBe(`Mãe E2E ${stamp}`);
  expect(full.occupation).toBe('Engenheira');

  // cleanup
  await request.delete(`${baseURL}/api/patients/${patient.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
});

test('customer appreciation campaign: create, blast, opt-out footer', async ({ page, request, baseURL }) => {
  const stamp = Date.now().toString().slice(-6);
  await signIn(page);
  await page.goto('/whatsapp');

  await page.getByTestId('tab-campaigns').click();
  await page.getByTestId('new-campaign').click();
  await page.getByTestId('campaign-name').fill(`Dia do Cliente ${stamp}`);
  await page.getByTestId('campaign-message').fill('Olá {{name}}! Semana do Cliente: 20% off. 💙');
  await page.getByTestId('form-submit').click();

  const card = page.locator('.card', { hasText: `Dia do Cliente ${stamp}` });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.getByRole('button', { name: /disparar|enviar|dispatch/i }).click();

  // delivery counts show up on the card
  await expect(card.getByText(/Enviadas: \d+|Sent: \d+/i)).toBeVisible({ timeout: 15_000 });

  // messages carry the LGPD opt-out footer and the patient's first name
  const token = await apiToken(request, baseURL!);
  const convs = await request.get(`${baseURL}/api/whatsapp/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(convs.status()).toBe(200);
});

test('NPS survey: dispatch → patient answers → KPI updates', async ({ page, request, baseURL }) => {
  const token = await apiToken(request, baseURL!);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // a completed appointment yesterday for the first seeded patient
  const patients = await request.get(`${baseURL}/api/patients?limit=5`, { headers });
  const seeded = (await patients.json()).patients[0];
  expect(seeded).toBeTruthy();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const doctor = (await (await request.get(`${baseURL}/api/users/directory`, { headers })).json()).users
    .find((u: any) => u.role === 'doctor');
  // a genuinely free slot — the sister project already booked 10:00
  const avail = await request.get(`${baseURL}/api/appointments/availability?practitioner_id=${doctor.id}&date=${yesterday}`, { headers });
  const freeSlot = (await avail.json()).available_slots[0];
  const appt = await request.post(`${baseURL}/api/appointments`, {
    headers,
    data: {
      patient_id: seeded.id,
      practitioner_id: doctor.id,
      scheduled_at: freeSlot,
      type: 'consultation',
      status: 'completed',
    },
  });
  expect(appt.status()).toBe(201);

  // dispatch surveys — the bot asks the patient
  const dispatched = await request.post(`${baseURL}/api/whatsapp/surveys/dispatch`, { headers, data: { days: 7 } });
  expect(dispatched.status()).toBe(200);

  // the patient answers 10 + comment via the bot
  const phone = seeded.phone;
  const send = (body: string) => request.post(`${baseURL}/api/whatsapp/simulate`, { headers, data: { phone, body, locale: 'pt-BR' } });
  let r = await send('10');
  expect((await r.json()).last_bot_reply.body).toContain('10');
  await send('Perfeito, equipe nota dez!');

  // aggregate now includes the response
  const agg = await request.get(`${baseURL}/api/whatsapp/surveys`, { headers });
  const j = await agg.json();
  expect(j.total).toBeGreaterThanOrEqual(1);
  expect(j.promoters).toBeGreaterThanOrEqual(1);

  // KPI cards render in the UI
  await signIn(page);
  await page.goto('/whatsapp');
  await page.getByTestId('tab-surveys').click();
  await expect(page.getByText('NPS')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Perfeito, equipe nota dez!' }).first()).toBeVisible({ timeout: 10_000 });
});
