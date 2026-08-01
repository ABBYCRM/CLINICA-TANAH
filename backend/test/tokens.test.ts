/**
 * API tokens — mint, scope enforcement, revoke, expiry, secrecy.
 */
import path from 'path';
import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const TEST_DB_DIR = path.join(__dirname, '..', 'data-test-tokens');
const BASE = 'http://127.0.0.1:3996';

import { db } from '../src/db/schema';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';

let jwt = '';

async function api(method: string, p: string, opts: { token?: string; body?: any } = {}) {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token ?? jwt}`,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
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
  process.env.PORT = '3996';
  process.env.DB_DIR = TEST_DB_DIR; // unique dir per file — parallel workers share nothing
  await import('../src/server');
  await waitForServer();
  db.prepare(`DELETE FROM users`).run();
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, 'admin@tok.com', ?, 'Tok Admin', 'admin')`)
    .run(uuid(), bcrypt.hashSync('adminpass123', 10));
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@tok.com', password: 'adminpass123' }),
  });
  jwt = ((await res.json()) as any).token;
});

afterAll(() => {
  db.close();
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

describe('API token minter', () => {
  let rwToken = '';
  let rwId = '';

  it('mints a read_write token — plaintext shown once, hash never exposed', async () => {
    const minted = await api('POST', '/tokens', { body: { name: 'BI Integration', scope: 'read_write' } });
    expect(minted.status).toBe(201);
    rwToken = minted.body.token;
    rwId = minted.body.id;
    expect(rwToken).toMatch(/^ct_[0-9a-f]{48}$/);

    const list = await api('GET', '/tokens');
    const row = list.body.tokens.find((t: any) => t.id === rwId);
    expect(row.prefix).toBe(rwToken.slice(0, 10));
    expect(row.token_hash).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain(rwToken);
  });

  it('read_write token controls the entire CRM — reads AND writes', async () => {
    const read = await api('GET', '/patients', { token: rwToken });
    expect(read.status).toBe(200);

    const write = await api('POST', '/patients', {
      token: rwToken,
      body: { full_name: 'Token Patient', birth_date: '1999-09-09', phone: '+5511955550001', lgpd_consent_granted: true },
    });
    expect(write.status).toBe(201);
    await api('DELETE', `/patients/${write.body.id}`, { token: rwToken });

    // last_used_at tracked
    const list = await api('GET', '/tokens');
    expect(list.body.tokens.find((t: any) => t.id === rwId).last_used_at).toBeTruthy();
  });

  it('read-only token reads everything but cannot write', async () => {
    const minted = await api('POST', '/tokens', { body: { name: 'Readonly', scope: 'read' } });
    const roToken = minted.body.token;
    expect((await api('GET', '/patients', { token: roToken })).status).toBe(200);
    expect((await api('GET', '/dashboard', { token: roToken })).status).toBe(200);
    const write = await api('POST', '/patients', {
      token: roToken,
      body: { full_name: 'Nope', birth_date: '1990-01-01', phone: '+5511955550002', lgpd_consent_granted: true },
    });
    expect(write.status).toBe(403);
    expect(write.body.error).toBe('scope_read_only');
    await api('DELETE', `/tokens/${minted.body.id}`);
  });

  it('revoked token is rejected immediately', async () => {
    const minted = await api('POST', '/tokens', { body: { name: 'Temp', scope: 'read_write' } });
    const tmp = minted.body.token;
    expect((await api('GET', '/patients', { token: tmp })).status).toBe(200);
    expect((await api('DELETE', `/tokens/${minted.body.id}`)).status).toBe(200);
    expect((await api('GET', '/patients', { token: tmp })).status).toBe(401);
  });

  it('garbage tokens are rejected', async () => {
    expect((await api('GET', '/patients', { token: 'ct_' + '0'.repeat(48) })).status).toBe(401);
    expect((await api('GET', '/patients', { token: 'ct_short' })).status).toBe(401);
  });

  it('expired tokens are rejected', async () => {
    const minted = await api('POST', '/tokens', { body: { name: 'Expiring', scope: 'read_write', expires_in_days: 1 } });
    const id = minted.body.id;
    db.prepare(`UPDATE api_tokens SET expires_at = datetime('now', '-1 hour') WHERE id = ?`).run(id);
    expect((await api('GET', '/patients', { token: minted.body.token })).status).toBe(401);
  });

  it('non-admin roles cannot mint tokens', async () => {
    db.prepare(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, 'rec@tok.com', ?, 'Rec', 'receptionist')`)
      .run(uuid(), bcrypt.hashSync('recpass123', 10));
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rec@tok.com', password: 'recpass123' }),
    });
    const recJwt = ((await res.json()) as any).token;
    expect((await api('POST', '/tokens', { token: recJwt, body: { name: 'Nope' } })).status).toBe(403);
    expect((await api('GET', '/tokens', { token: recJwt })).status).toBe(403);
  });

  it('mint and revoke are audit-logged', () => {
    const mint = db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'api_token_minted'`).get() as any;
    const revoke = db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'api_token_revoked'`).get() as any;
    expect(mint.c).toBeGreaterThan(0);
    expect(revoke.c).toBeGreaterThan(0);
  });
});
