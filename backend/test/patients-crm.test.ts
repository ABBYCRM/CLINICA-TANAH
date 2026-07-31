/**
 * Patients CRM list + HubSpot-style record endpoint.
 */
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db } from '../src/db/schema';

const TEST_DB_DIR = path.join(__dirname, '..', 'data-test-patients-crm');
const BASE = 'http://127.0.0.1:4012';

let token = '';

async function api(method: string, p: string, body?: any) {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function waitForServer(attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

beforeAll(async () => {
  process.env.PORT = '4012';
  process.env.DB_DIR = TEST_DB_DIR;
  await import('../src/server');
  await waitForServer();
  db.prepare(`DELETE FROM users`).run();
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role)
    VALUES (?, 'admin@test.com', ?, 'Test Admin', 'admin')
  `).run(uuid(), bcrypt.hashSync('adminpass123', 10));
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.com', password: 'adminpass123' }),
  });
  token = ((await login.json()) as any).token;
});

afterAll(() => {
  db.close();
});

describe('patients CRM', () => {
  it('lists with views, filters metadata and enriched rows', async () => {
    const created = await api('POST', '/patients', {
      full_name: 'CRM Paciente Teste',
      birth_date: '1990-05-15',
      phone: '+5511999887766',
      email: 'crm.paciente@example.com',
      gender: 'female',
      health_insurance: 'Unimed',
      lgpd_consent_granted: true,
      lgpd_policy_version: '1.0',
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const list = await api('GET', '/patients?view=insurance&q=CRM&limit=25');
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    expect(list.body.view_counts.all).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(list.body.insurers)).toBe(true);
    const row = list.body.patients.find((p: any) => p.id === id);
    expect(row).toBeTruthy();
    expect(row.health_insurance).toBe('Unimed');
    expect(row).toHaveProperty('last_activity');
    expect(row).toHaveProperty('owner_name');

    const record = await api('GET', `/patients/${id}/record`);
    expect(record.status).toBe(200);
    expect(record.body.patient.full_name).toBe('CRM Paciente Teste');
    expect(Array.isArray(record.body.timeline)).toBe(true);
    expect(record.body.timeline.some((t: any) => t.kind === 'created')).toBe(true);
    expect(record.body.associations).toHaveProperty('appointments');
    expect(record.body.associations).toHaveProperty('invoices');
    expect(record.body.associations).toHaveProperty('consents');
    expect(record.body.associations.consents.count).toBeGreaterThanOrEqual(1);

    await api('DELETE', `/patients/${id}`);
  });
});
