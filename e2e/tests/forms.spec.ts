/**
 * Intake forms + Brazilian LGPD/TCPA-style consent pixel proof.
 * Pré-consulta: link/iframe delivery + exhaustive CFM/LGPD fields.
 */
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'Juliana';
const PASSWORD = '12345678';

async function login(request: import('@playwright/test').APIRequestContext, baseURL: string) {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: PASSWORD },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.token as string;
}

test('public intake session → pixel → submit creates patient with consent proof', async ({ request, baseURL }) => {
  const slug = 'cadastro-paciente';
  const meta = await request.get(`${baseURL}/api/public/forms/${slug}`);
  expect(meta.status()).toBe(200);
  const metaBody = await meta.json();
  expect(metaBody.form.slug).toBe(slug);
  expect(metaBody.form.consent_text).toBeTruthy();
  expect(Array.isArray(metaBody.form.fields)).toBe(true);
  expect(metaBody.form.fields.length).toBeGreaterThan(10);

  const sess = await request.post(`${baseURL}/api/public/forms/${slug}/session`, { data: {} });
  expect(sess.status()).toBe(201);
  const sessBody = await sess.json();
  expect(sessBody.pixel_token).toBeTruthy();
  expect(sessBody.pixel_url).toContain('pixel.gif');

  const pixel = await request.get(`/api/public/forms/pixel.gif?t=${sessBody.pixel_token}`);
  expect(pixel.status()).toBe(200);
  expect(pixel.headers()['content-type']).toMatch(/image\/gif/);

  const phone = `+55119${String(Date.now()).slice(-8)}`;
  const submit = await request.post(`${baseURL}/api/public/forms/${slug}/submit`, {
    data: {
      pixel_token: sessBody.pixel_token,
      full_name: 'Paciente Formulário E2E',
      birth_date: '1990-05-15',
      phone,
      email: 'paciente.form@example.com',
      city: 'São Paulo',
      state: 'SP',
      consent_lgpd: true,
      consent_whatsapp: true,
      consent_marketing: false,
      consent_calls: true,
      self_attested: true,
    },
  });
  expect(submit.status()).toBe(201);
  const submitBody = await submit.json();
  expect(submitBody.ok).toBe(true);
  expect(submitBody.submission_id).toBeTruthy();
  expect(submitBody.patient_id).toBeUndefined();

  const token = await login(request, baseURL!);
  const forms = await request.get(`${baseURL}/api/forms`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(forms.status()).toBe(200);
  const formsBody = await forms.json();
  const form = formsBody.forms.find((f: any) => f.slug === slug);
  expect(form).toBeTruthy();
  expect(form.urls.link).toContain(`/f/${slug}`);
  expect(form.urls.embed).toContain('<iframe');
  expect(form.urls.embed).toContain('embed=1');

  const subs = await request.get(`${baseURL}/api/forms/${form.id}/submissions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(subs.status()).toBe(200);
  const rows = (await subs.json()).submissions;
  const mine = rows.find((r: any) => r.phone === phone || r.full_name.includes('Formulário E2E'));
  expect(mine).toBeTruthy();
  expect(mine.pixel_viewed_at).toBeTruthy();
  expect(mine.self_attested).toBeTruthy();
});

test('pre-triagem public API returns exhaustive CFM+LGPD schema and accepts full submit', async ({ request, baseURL }) => {
  const slug = 'pre-triagem-paciente';
  const meta = await request.get(`${baseURL}/api/public/forms/${slug}`, {
    headers: { 'Accept-Language': 'pt-BR' },
  });
  expect(meta.status()).toBe(200);
  const body = await meta.json();
  expect(body.form.kind).toBe('pre_triage');
  expect(body.form.policy_version).toBe('2.0');
  expect(body.form.fields.length).toBeGreaterThan(40);

  const keys = new Set(body.form.fields.map((f: any) => f.key));
  for (const required of [
    'full_name', 'mother_name', 'cpf', 'address_street', 'emergency_contact_name',
    'chief_complaint', 'hpi', 'allergies', 'current_medications', 'chronic_conditions',
    'family_history', 'ros', 'smoking', 'alcohol', 'red_flags', 'urgency_self',
  ]) {
    expect(keys.has(required)).toBe(true);
  }

  const consentKeys = new Set(body.form.consent_boxes.map((c: any) => c.key));
  expect(consentKeys.has('consent_lgpd')).toBe(true);
  expect(consentKeys.has('consent_privacy_ack')).toBe(true);
  expect(consentKeys.has('consent_telehealth_image')).toBe(true);
  expect(body.form.section_titles?.clinical).toBeTruthy();

  const sess = await request.post(`${baseURL}/api/public/forms/${slug}/session`, { data: {} });
  expect(sess.status()).toBe(201);
  const sessBody = await sess.json();
  await request.get(`/api/public/forms/pixel.gif?t=${sessBody.pixel_token}`);

  const phone = `+55118${String(Date.now()).slice(-8)}`;
  const submit = await request.post(`${baseURL}/api/public/forms/${slug}/submit`, {
    data: {
      pixel_token: sessBody.pixel_token,
      full_name: 'Paciente Pré-consulta E2E',
      birth_date: '1985-01-20',
      sex_at_birth: 'F',
      mother_name: 'Maria Mãe E2E',
      cpf: '52998224725',
      phone,
      email: 'preconsulta.e2e@example.com',
      address_zip: '01310-100',
      address_street: 'Av Paulista',
      address_number: '1000',
      address_neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      emergency_contact_name: 'Contato E2E',
      emergency_contact_phone: '+5511999990000',
      is_minor: 'no',
      chief_complaint: 'Dor de cabeça há 3 dias',
      hpi: 'Início gradual, piora à tarde, sem trauma. Já usou dipirona sem alívio.',
      symptom_duration: 'd1_7',
      allergies: 'Nega alergias',
      current_medications: 'Nega',
      chronic_conditions: ['none'],
      family_history: 'Mãe hipertensão',
      ros: ['none'],
      smoking: 'never',
      alcohol: 'social',
      red_flags: ['none'],
      urgency_self: 'soon',
      consent_lgpd: true,
      consent_privacy_ack: true,
      consent_whatsapp: true,
      consent_calls: false,
      consent_marketing: false,
      consent_telehealth_image: true,
      self_attested: true,
    },
  });
  expect(submit.status()).toBe(201);
  const submitBody = await submit.json();
  expect(submitBody.ok).toBe(true);
});

test('Forms admin page shows link and embed code as primary share', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill('12345678');
  await page.getByTestId('login-submit').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/forms');
  await expect(page.getByTestId('forms-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('form-share-primary')).toBeVisible();
  await expect(page.getByTestId('form-public-link')).toHaveValue(/\/f\//);
  await expect(page.getByTestId('form-embed-code')).toHaveValue(/iframe/);
  await expect(page.getByTestId('form-embed-code')).toHaveValue(/embed=1/);
});

test('public /f/pre-triagem-paciente renders exhaustive sections and embed mode', async ({ page }) => {
  const pixelPromise = page.waitForResponse(
    (r) => r.url().includes('/api/public/forms/pixel.gif') && r.status() === 200,
    { timeout: 20_000 },
  );
  await page.goto('/f/pre-triagem-paciente');
  await expect(page.getByTestId('public-intake')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('public-intake')).toHaveAttribute('data-kind', 'pre_triage');
  await expect(page.getByTestId('public-intake-form')).toBeVisible();
  await expect(page.getByTestId('pf-section-identity')).toBeVisible();
  await expect(page.getByTestId('pf-section-clinical')).toBeVisible();
  await expect(page.getByTestId('pf-section-history')).toBeVisible();
  await expect(page.getByTestId('pf-section-ros')).toBeVisible();
  await expect(page.getByTestId('pf-section-safety')).toBeVisible();
  await expect(page.getByTestId('pf-mother_name')).toBeVisible();
  await expect(page.getByTestId('pf-chief_complaint')).toBeVisible();
  await expect(page.getByTestId('pf-hpi')).toBeVisible();
  await expect(page.getByTestId('pf-consent_privacy_ack')).toBeVisible();
  await pixelPromise;

  await page.goto('/f/pre-triagem-paciente?embed=1');
  await expect(page.getByTestId('public-intake')).toHaveAttribute('data-embed', '1');
});

test('public /f/cadastro-paciente renders and fires consent pixel', async ({ page }) => {
  const pixelPromise = page.waitForResponse((r) => r.url().includes('/api/public/forms/pixel.gif') && r.status() === 200, { timeout: 20_000 });
  await page.goto('/f/cadastro-paciente');
  await expect(page.getByTestId('public-intake')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('public-intake-form')).toBeVisible();
  await pixelPromise;
  await expect(page.getByTestId('consent-pixel')).toHaveAttribute('src', /pixel\.gif/);
});
