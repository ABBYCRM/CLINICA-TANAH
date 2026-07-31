/**
 * API smoke checks against the e2e server seeded with demo data.
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
  expect(body.token).toBeTruthy();
  return body.token as string;
}

test('health endpoint is ok', async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/api/health`);
  expect(res.status()).toBe(200);
  expect((await res.json()).ok).toBe(true);
});

test('login API issues a token and /me resolves the user', async ({ request, baseURL }) => {
  const token = await login(request, baseURL!);
  const me = await request.get(`${baseURL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(me.status()).toBe(200);
  const meBody = await me.json();
  expect(meBody.user.full_name).toBe('Juliana');
  expect(meBody.user.email).toBe('juliana@clinica-tanah.com.br');
});

test('patients API enforces auth and lists seeded patients', async ({ request, baseURL }) => {
  const unauthenticated = await request.get(`${baseURL}/api/patients`);
  expect(unauthenticated.status()).toBe(401);

  const token = await login(request, baseURL!);
  const res = await request.get(`${baseURL}/api/patients`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.patients;
  expect(list.length).toBeGreaterThan(0);
});
