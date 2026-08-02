/**
 * WhatsApp marketing hub — templates, automations, audience, analytics.
 */
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const TEST_DB_DIR = path.join(__dirname, '..', 'data-test-marketing');
const BASE = 'http://127.0.0.1:3998';

import { db, seedMarketingDefaults, DEFAULT_TENANT_ID } from '../src/db/schema';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';

let token = '';

async function api(method: string, p: string, body?: any) {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function waitForServer(attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

beforeAll(async () => {
  process.env.PORT = '3998';
  process.env.DB_DIR = TEST_DB_DIR;
  delete process.env.META_WA_APP_SECRET;
  await import('../src/server');
  await waitForServer();

  seedMarketingDefaults(DEFAULT_TENANT_ID);

  const adminId = uuid();
  db.prepare(`DELETE FROM users`).run();
  db.prepare(`
    INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_superadmin)
    VALUES (?, ?, 'admin@mkt.com', ?, 'Mkt Admin', 'admin', 1)
  `).run(adminId, DEFAULT_TENANT_ID, bcrypt.hashSync('adminpass123', 10));

  const patientId = uuid();
  db.prepare(`
    INSERT INTO patients (id, tenant_id, full_name, birth_date, cpf, phone, lgpd_consent_at, lgpd_consent_version)
    VALUES (?, ?, 'Paciente Marketing', '1990-07-31', '11122233344', '+5511911112222', datetime('now'), '1.0')
  `).run(patientId, DEFAULT_TENANT_ID);

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@mkt.com', password: 'adminpass123' }),
  });
  token = ((await res.json()) as any).token;
});

afterAll(() => {
  try { require('fs').rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch {}
});

describe('auth session', () => {
  it('rejects garbage tokens as invalid_token', async () => {
    const res = await fetch(`${BASE}/api/dashboard`, {
      headers: { Authorization: 'Bearer not-a-jwt' },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('invalid_token');
  });

  it('/me returns clean user without jwt iat/exp pollution', async () => {
    const res = await api('GET', '/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@mkt.com');
    expect(res.body.user.tenant_id).toBe(DEFAULT_TENANT_ID);
    expect(res.body.user.iat).toBeUndefined();
    expect(res.body.user.exp).toBeUndefined();
  });
});

describe('marketing hub', () => {
  it('lists seeded templates and automations', async () => {
    const tpl = await api('GET', '/whatsapp/templates');
    expect(tpl.status).toBe(200);
    expect(tpl.body.templates.length).toBeGreaterThanOrEqual(5);
    expect(tpl.body.templates.some((t: any) => t.category === 'marketing')).toBe(true);

    const autos = await api('GET', '/whatsapp/automations');
    expect(autos.status).toBe(200);
    expect(autos.body.automations.some((a: any) => a.key === 'reminder_24h')).toBe(true);
  });

  it('creates a template and campaign with audience segment', async () => {
    const created = await api('POST', '/whatsapp/templates', {
      name: 'Promo Teste', category: 'marketing', body: 'Oi {{name}}! Promo teste', status: 'approved',
    });
    expect(created.status).toBe(201);

    const camp = await api('POST', '/whatsapp/campaigns', {
      name: 'Blast teste',
      message: 'Olá {{name}} oferta',
      audience: 'all_consented',
      category: 'marketing',
      template_id: created.body.id,
    });
    expect(camp.status).toBe(201);

    const list = await api('GET', '/whatsapp/campaigns');
    const row = list.body.campaigns.find((c: any) => c.id === camp.body.id);
    expect(row.audience).toBe('all_consented');
  });

  it('audience + analytics endpoints respond', async () => {
    const aud = await api('GET', '/whatsapp/audience?segment=all_consented');
    expect(aud.status).toBe(200);
    expect(aud.body.segments.all_consented).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(aud.body.preview)).toBe(true);

    const an = await api('GET', '/whatsapp/analytics');
    expect(an.status).toBe(200);
    expect(an.body.period_days).toBe(30);
    expect(an.body.templates_approved).toBeGreaterThanOrEqual(1);
  });

  it('runs an enabled automation', async () => {
    const autos = await api('GET', '/whatsapp/automations');
    const welcome = autos.body.automations.find((a: any) => a.key === 'welcome');
    expect(welcome).toBeTruthy();
    await api('PUT', `/whatsapp/automations/${welcome.id}`, { enabled: true });
    const run = await api('POST', `/whatsapp/automations/${welcome.id}/run`, {});
    expect(run.status).toBe(200);
    expect(run.body.ok).toBe(true);
    expect(typeof run.body.sent).toBe('number');
  });
});
