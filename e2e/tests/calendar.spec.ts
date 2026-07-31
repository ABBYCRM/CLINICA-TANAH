/**
 * Calendar scheduler e2e — week grid, API slot picker, decision drawer
 * with clinical snapshot, status workflow. Desktop + mobile.
 */
import { test, expect, Page } from '@playwright/test';

const ADMIN_EMAIL = 'admin@clinica-tanah.com.br';
const PASSWORD = 'clinica2026';

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

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('scheduler: API slot picker books into the calendar grid', async ({ page, isMobile }) => {
  const stamp = Date.now().toString().slice(-6);
  await signIn(page);
  await page.goto('/appointments');

  // calendar is the default view
  await expect(page.getByTestId('calendar-view')).toBeVisible();

  await page.getByTestId('new-appointment').click();
  const selects = page.locator('select');
  await selects.nth(0).selectOption({ index: 1 }); // first patient
  // first practitioner
  const practitionerValue = await selects.nth(1).evaluate((s: HTMLSelectElement) => s.options[1]?.value ?? '');
  await selects.nth(1).selectOption(practitionerValue);
  await page.getByTestId('appointment-datetime').fill(`${todayISO()}T08:00`);

  // the slot picker responds to the availability API
  const picker = page.getByTestId('slot-picker');
  await expect(picker).toBeVisible({ timeout: 10_000 });
  const freeSlots = picker.locator('button:not([disabled])');
  expect(await freeSlots.count()).toBeGreaterThan(0);
  await freeSlots.nth(2).click();

  await page.getByTestId('form-submit').click();
  await expect(page.getByTestId('slot-picker')).toHaveCount(0, { timeout: 10_000 }); // modal closed

  // the appointment shows up — desktop grid chip or mobile agenda (pick today)
  if (isMobile) {
    const dayIdx = (new Date().getDay() + 6) % 7;
    await page.locator('.md\\:hidden button').nth(dayIdx).click();
    await expect(page.locator('[data-testid^="agenda-item-"]').first()).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(page.locator('[data-testid^="appt-chip-"]').first()).toBeVisible({ timeout: 10_000 });
  }
});

test('decision drawer: clinical snapshot + status workflow', async ({ page, request, baseURL, isMobile }) => {
  const token = await apiToken(request, baseURL!);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const stamp = Date.now().toString().slice(-6);

  // patient with decision-critical data
  const p = await request.post(`${baseURL}/api/patients`, {
    headers,
    data: {
      full_name: `Clara Calendário ${stamp}`, birth_date: '1980-02-14',
      phone: `+5511933${stamp}`, allergies: ['Dipirona', 'Penicilina'],
      chronic_conditions: ['Asma'], blood_type: 'O-', health_insurance: 'Unimed',
      lgpd_consent_granted: true,
    },
  });
  expect(p.status()).toBe(201);
  const patientId = (await p.json()).id;

  // first doctor and a genuinely free slot today via the availability API
  const dir = await request.get(`${baseURL}/api/users/directory`, { headers });
  const doctor = (await dir.json()).users.find((u: any) => u.role === 'doctor');
  const avail = await request.get(`${baseURL}/api/appointments/availability?practitioner_id=${doctor.id}&date=${todayISO()}`, { headers });
  const free = (await avail.json()).available_slots;
  expect(free.length).toBeGreaterThan(0);
  const slot = free[Math.min(3, free.length - 1)];

  const appt = await request.post(`${baseURL}/api/appointments`, {
    headers,
    data: { patient_id: patientId, practitioner_id: doctor.id, scheduled_at: slot, type: 'consultation' },
  });
  expect(appt.status()).toBe(201);

  await signIn(page);
  await page.goto('/appointments');
  if (isMobile) {
    const dayIdx = (new Date().getDay() + 6) % 7;
    await page.locator('.md\\:hidden button').nth(dayIdx).click();
    await page.locator(`[data-testid^="agenda-item-"]`, { hasText: `Clara Calendário ${stamp}` }).first().click();
  } else {
    await page.locator(`[data-testid^="appt-chip-"]`, { hasText: `Clara Calendário ${stamp}` }).first().click();
  }

  // the drawer has everything the medical team needs
  const drawer = page.getByTestId('appointment-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Unimed')).toBeVisible();
  await expect(drawer.getByText('O-')).toBeVisible();
  const allergies = page.getByTestId('drawer-allergies');
  await expect(allergies).toBeVisible();
  await expect(allergies).toContainText('Dipirona');
  await expect(allergies).toContainText('Penicilina');
  await expect(drawer.getByText('Asma')).toBeVisible();

  // status workflow: scheduled → confirmed
  await drawer.getByRole('button', { name: /confirm/i }).click();
  await expect(drawer.getByText('confirmed')).toBeVisible({ timeout: 10_000 });

  // double-booking the same slot through the API is rejected
  const dup = await request.post(`${baseURL}/api/appointments`, {
    headers,
    data: { patient_id: patientId, practitioner_id: doctor.id, scheduled_at: slot, type: 'return' },
  });
  expect(dup.status()).toBe(409);

  // cleanup
  await request.delete(`${baseURL}/api/appointments/${(await appt.json()).id}`, { headers });
  await request.delete(`${baseURL}/api/patients/${patientId}`, { headers });
});
