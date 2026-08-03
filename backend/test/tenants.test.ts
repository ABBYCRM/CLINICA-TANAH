/**
 * Multi-tenant isolation — two clinics must never see each other's patients.
 */
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';

const TEST_DB_DIR = path.join(__dirname, '..', 'data-test-tenants');
const BASE = 'http://127.0.0.1:3994';

import { db, DEFAULT_TENANT_ID } from '../src/db/schema';

let tokenA = '';
let tokenB = '';
let superToken = '';
const TENANT_B = 't_clinica_beta';

async function login(email: string, password: string): Promise<any> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

async function api(token: string, method: string, p: string, body?: any, tenantHeader?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (tenantHeader) headers['X-Tenant-Id'] = tenantHeader;
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers,
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
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

beforeAll(async () => {
  process.env.PORT = '3994';
  process.env.DB_DIR = TEST_DB_DIR;
  process.env.NODE_ENV = 'test';
  await import('../src/server');
  await waitForServer();

  db.prepare(`DELETE FROM patients`).run();
  db.prepare(`DELETE FROM users`).run();
  db.prepare(`DELETE FROM tenants WHERE id != ?`).run(DEFAULT_TENANT_ID);
  db.prepare(`INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (?, 'clinica-tanah', 'Clínica Tanah')`).run(DEFAULT_TENANT_ID);
  db.prepare(`INSERT OR REPLACE INTO tenants (id, slug, name) VALUES (?, 'clinica-beta', 'Clínica Beta')`).run(TENANT_B);

  const hash = bcrypt.hashSync('pass12345', 10);
  db.prepare(`
    INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_superadmin)
    VALUES (?, ?, 'admin-a@test.com', ?, 'Admin A', 'admin', 1)
  `).run(uuid(), DEFAULT_TENANT_ID, hash);
  db.prepare(`
    INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_superadmin)
    VALUES (?, ?, 'admin-b@test.com', ?, 'Admin B', 'admin', 0)
  `).run(uuid(), TENANT_B, hash);

  const a = await login('admin-a@test.com', 'pass12345');
  const b = await login('admin-b@test.com', 'pass12345');
  tokenA = a.token;
  tokenB = b.token;
  superToken = a.token;
  expect(a.user.tenant_id).toBe(DEFAULT_TENANT_ID);
  expect(b.user.tenant_id).toBe(TENANT_B);
  expect(a.user.is_superadmin).toBe(true);
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
});

describe('tenant isolation', () => {
  it('keeps patients private to each clinic', async () => {
    const createA = await api(tokenA, 'POST', '/patients', {
      full_name: 'Patient Alpha', birth_date: '1990-01-01', phone: '+5511999000001', gender: 'F',
      lgpd_consent_granted: true,
    });
    if (createA.status !== 201) {
      throw new Error(`createA failed: ${createA.status} ${JSON.stringify(createA.body)}`);
    }

    const createB = await api(tokenB, 'POST', '/patients', {
      full_name: 'Patient Beta', birth_date: '1991-02-02', phone: '+5511999000002', gender: 'M',
      lgpd_consent_granted: true,
    });
    expect(createB.status).toBe(201);

    const listA = await api(tokenA, 'GET', '/patients');
    const listB = await api(tokenB, 'GET', '/patients');
    const namesA = listA.body.patients.map((p: any) => p.full_name);
    const namesB = listB.body.patients.map((p: any) => p.full_name);
    expect(namesA).toContain('Patient Alpha');
    expect(namesA).not.toContain('Patient Beta');
    expect(namesB).toContain('Patient Beta');
    expect(namesB).not.toContain('Patient Alpha');

    // B cannot fetch A's patient by id
    const sneak = await api(tokenB, 'GET', `/patients/${createA.body.id}`);
    expect(sneak.status).toBe(404);
  });

  it('lets superadmin switch tenant via X-Tenant-Id', async () => {
    const asB = await api(superToken, 'GET', '/patients', undefined, TENANT_B);
    expect(asB.status).toBe(200);
    const names = asB.body.patients.map((p: any) => p.full_name);
    expect(names).toContain('Patient Beta');
    expect(names).not.toContain('Patient Alpha');
  });

  it('creates a new tenant with bootstrap admin', async () => {
    const res = await api(superToken, 'POST', '/tenants', {
      name: 'Clínica Gamma',
      slug: 'clinica-gamma',
      admin_email: 'admin-gamma@test.com',
      admin_name: 'Admin Gamma',
      admin_password: 'pass12345',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();

    const loginG = await login('admin-gamma@test.com', 'pass12345');
    expect(loginG.token).toBeTruthy();
    expect(loginG.user.tenant_id).toBe(res.body.id);

    const denied = await api(tokenB, 'POST', '/tenants', {
      name: 'Nope', slug: 'nope', admin_email: 'x@y.com', admin_name: 'X', admin_password: 'pass12345',
    });
    expect(denied.status).toBe(403);
  });
});
