/**
 * Settings e2e — API token minter (full CRM read+write control) and
 * staff management lifecycle, desktop + mobile.
 */
import { test, expect, Page } from '@playwright/test';

const ADMIN_EMAIL = 'Juliana';
const PASSWORD = '1234';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

test('API token minter: mint → token controls the CRM → revoke → dead', async ({ page, request, baseURL }) => {
  const stamp = Date.now().toString().slice(-6);
  await signIn(page);
  await page.goto('/settings');

  // mint a read+write token through the UI
  await page.getByTestId('mint-token').click();
  await page.getByTestId('token-name').fill(`E2E Token ${stamp}`);
  await page.getByTestId('token-scope').selectOption('read_write');
  await page.getByTestId('form-submit').click();

  // the plaintext token is shown once
  const tokenEl = page.getByTestId('minted-token');
  await expect(tokenEl).toBeVisible({ timeout: 10_000 });
  const apiToken = (await tokenEl.textContent())!.trim();
  expect(apiToken).toMatch(/^ct_[0-9a-f]{48}$/);

  // it controls the entire CRM — read…
  const headers = { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' };
  const read = await request.get(`${baseURL}/api/patients`, { headers });
  expect(read.status()).toBe(200);

  // …and write (create + delete a patient)
  const created = await request.post(`${baseURL}/api/patients`, {
    headers,
    data: { full_name: `Token E2E ${stamp}`, birth_date: '1995-05-05', phone: `+5511944${stamp}`, lgpd_consent_granted: true },
  });
  expect(created.status()).toBe(201);
  await request.delete(`${baseURL}/api/patients/${(await created.json()).id}`, { headers });

  // token row is listed with its prefix
  await page.getByRole('button', { name: /confirm/i }).click();
  await expect(page.getByRole('cell', { name: `E2E Token ${stamp}` })).toBeVisible();

  // revoke via JWT → token dies immediately
  const login = await request.post(`${baseURL}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: PASSWORD },
  });
  const jwt = (await login.json()).token;
  const list = await request.get(`${baseURL}/api/tokens`, { headers: { Authorization: `Bearer ${jwt}` } });
  const row = (await list.json()).tokens.find((t: any) => t.name === `E2E Token ${stamp}`);
  await request.delete(`${baseURL}/api/tokens/${row.id}`, { headers: { Authorization: `Bearer ${jwt}` } });
  const after = await request.get(`${baseURL}/api/patients`, { headers });
  expect(after.status()).toBe(401);
});

test('staff management: add doctor → edit → deactivate', async ({ page }) => {
  const stamp = Date.now().toString().slice(-6);
  const name = `Dra. E2E ${stamp}`;
  await signIn(page);
  await page.goto('/team');

  // add a doctor
  await page.getByTestId('new-user').click();
  await page.getByTestId('user-name').fill(name);
  await page.locator('input[type="email"]').fill(`e2e${stamp}@clinica-tanah.com.br`);
  await page.locator('select').first().selectOption('doctor');
  await page.locator('input[type="password"]').fill('1234x');
  await page.getByTestId('form-submit').click();
  await expect(page.getByRole('cell', { name })).toBeVisible({ timeout: 10_000 });

  // edit: council number
  const row = page.getByRole('row', { name: new RegExp(stamp) });
  await row.getByRole('button', { name: /editar|edit/i }).click();
  await page.locator('input[placeholder="CRM-SP 123456"]').fill('CRM-SP 777777');
  await page.getByTestId('form-submit').click();
  await expect(page.getByRole('cell', { name: /CRM-SP 777777/ })).toBeVisible({ timeout: 10_000 });

  // deactivate (has no history → hard delete; disappears either way)
  const row2 = page.getByRole('row', { name: new RegExp(stamp) });
  await row2.getByRole('button', { name: /excluir|eliminar|delete/i }).click();
  await page.getByTestId('confirm-delete').click();
  await expect(page.getByRole('cell', { name })).toHaveCount(0, { timeout: 10_000 });
});
