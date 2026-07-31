/**
 * Intake forms + Brazilian LGPD/TCPA-style consent pixel proof.
 */
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'Juliana';
const PASSWORD = '1234';

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

  const sess = await request.post(`${baseURL}/api/public/forms/${slug}/session`, { data: {} });
  expect(sess.status()).toBe(201);
  const sessBody = await sess.json();
  expect(sessBody.pixel_token).toBeTruthy();
  expect(sessBody.pixel_url).toContain('pixel.gif');

  const pixel = await request.get(sessBody.pixel_url.replace(baseURL!, '') || `/api/public/forms/pixel.gif?t=${sessBody.pixel_token}`);
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
  expect(submitBody.patient_id).toBeTruthy();

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

test('Forms admin page shows link and embed code', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill('1234');
  await page.getByTestId('login-submit').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto('/forms');
  await expect(page.getByTestId('forms-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('form-public-link')).toHaveValue(/\/f\/cadastro-paciente/);
  await expect(page.getByTestId('form-embed-code')).toHaveValue(/iframe/);
});

test('public /f/cadastro-paciente renders and fires consent pixel', async ({ page }) => {
  const pixelPromise = page.waitForResponse((r) => r.url().includes('/api/public/forms/pixel.gif') && r.status() === 200, { timeout: 20_000 });
  await page.goto('/f/cadastro-paciente');
  await expect(page.getByTestId('public-intake')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('public-intake-form')).toBeVisible();
  await pixelPromise;
  await expect(page.getByTestId('consent-pixel')).toHaveAttribute('src', /pixel\.gif/);
});
