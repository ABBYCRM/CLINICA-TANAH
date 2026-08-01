/**
 * PHI encryption + LGPD art. 46 security posture smoke.
 */
import { test, expect } from '@playwright/test';

test('health reports PHI encryption enabled', async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/api/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.security.phi_encryption.enabled).toBe(true);
  expect(body.security.phi_encryption.algorithm).toMatch(/AES-256-GCM/);
  expect(body.security.compliance).toContain('LGPD');
});

test('security headers are present', async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/api/health`);
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['x-frame-options']).toBe('SAMEORIGIN');
  expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
});

test('admin security posture + encrypted patient CPF round-trip', async ({ request, baseURL }) => {
  const login = await request.post(`${baseURL}/api/auth/login`, {
    data: { email: 'Juliana', password: '12345678' },
  });
  expect(login.status()).toBe(200);
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };

  const posture = await request.get(`${baseURL}/api/lgpd/security-posture`, { headers });
  expect(posture.status()).toBe(200);
  const p = await posture.json();
  expect(p.encryption.enabled).toBe(true);
  expect(p.retention.clinical_hard_delete_blocked).toBe(true);

  const cpf = '52998224725'; // valid-format 11 digits
  const create = await request.post(`${baseURL}/api/patients`, {
    headers,
    data: {
      full_name: 'Paciente Criptografia E2E',
      birth_date: '1988-03-10',
      phone: `+55119${String(Date.now()).slice(-8)}`,
      cpf,
      email: 'crypto.e2e@example.com',
      allergies: ['Dipirona'],
      chronic_conditions: [],
      medications_in_use: [],
      lgpd_consent_granted: true,
      lgpd_policy_version: '1.1',
    },
  });
  expect(create.status()).toBe(201);
  const { id } = await create.json();

  const get = await request.get(`${baseURL}/api/patients/${id}`, { headers });
  expect(get.status()).toBe(200);
  const patient = (await get.json()).patient;
  expect(patient.cpf).toBe(cpf);
  expect(patient.email).toBe('crypto.e2e@example.com');
  expect(patient.allergies).toEqual(['Dipirona']);

  const search = await request.get(`${baseURL}/api/patients?q=${cpf}`, { headers });
  expect(search.status()).toBe(200);
  const found = (await search.json()).patients.some((x: any) => x.id === id);
  expect(found).toBe(true);
});
