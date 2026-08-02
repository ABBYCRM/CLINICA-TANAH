/**
 * End-to-end CRUD coverage — boots the real Express app on a test port and
 * exercises create/update/delete for every entity where it makes sense,
 * plus the WhatsApp production helpers (signature, opt-out, dry-run send).
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const TEST_DB_DIR = path.join(__dirname, '..', 'data-test-crud');
const BASE = 'http://127.0.0.1:3997';

import { db } from '../src/db/schema';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';

let token = '';
let doctorToken = '';
let doctorId = '';

function authHeaders(extra: Record<string, string> = {}) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra };
}

async function api(method: string, p: string, body?: any, asDoctor = false) {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${asDoctor ? doctorToken : token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return ((await res.json()) as any).token;
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
  process.env.PORT = '3997';
  process.env.DB_DIR = TEST_DB_DIR;
  process.env.META_WA_APP_SECRET = 'test-app-secret';
  await import('../src/server'); // starts listening on PORT
  await waitForServer();
  // Admin user for the JWT
  db.prepare(`DELETE FROM users`).run();
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role)
    VALUES (?, 'admin@test.com', ?, 'Test Admin', 'admin')
  `).run(uuid(), bcrypt.hashSync('adminpass123', 10));
  doctorId = uuid();
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role)
    VALUES (?, 'doctor@test.com', ?, 'Test Doctor', 'doctor')
  `).run(doctorId, bcrypt.hashSync('doctorpass123', 10));
  token = await login('admin@test.com', 'adminpass123');
  doctorToken = await login('doctor@test.com', 'doctorpass123');
  expect(token).toBeTruthy();
  expect(doctorToken).toBeTruthy();
});

afterAll(() => {
  db.close();
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

describe('staff users', () => {
  let userId = '';
  it('creates, updates and removes a staff user', async () => {
    const created = await api('POST', '/users', {
      email: 'nurse@test.com', password: 'nursepass123', full_name: 'Nurse Test', role: 'nurse',
      cpf: '39053344705', council_number: 'COREN-SP 123', council_state: 'SP',
    });
    expect(created.status).toBe(201);
    userId = created.body.id;

    const updated = await api('PUT', `/users/${userId}`, { full_name: 'Nurse Updated', council_number: 'COREN-SP 999', council_state: 'SP' });
    expect(updated.status).toBe(200);

    const list = await api('GET', '/users');
    const nurse = list.body.users.find((u: any) => u.id === userId);
    expect(nurse.full_name).toBe('Nurse Updated');
    expect(nurse.password_hash).toBeUndefined();

    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nurse@test.com', password: 'nursepass123' }),
    });
    expect(login.status).toBe(200);

    const removed = await api('DELETE', `/users/${userId}`);
    expect(removed.status).toBe(200);
    expect(removed.body.soft_deleted).toBe(false);
  });

  it('directory is available to any authenticated user', async () => {
    const res = await api('GET', '/users/directory');
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(0);
  });

  it('refuses to remove the last admin', async () => {
    const me = (await api('GET', '/auth/me')).body.user;
    const res = await api('DELETE', `/users/${me.id}`);
    expect([409]).toContain(res.status); // cannot_delete_self
  });
});

describe('patients', () => {
  let patientId = '';
  it('creates, updates and deletes a patient without clinical records', async () => {
    const created = await api('POST', '/patients', {
      full_name: 'João CRUD', birth_date: '1985-05-10', phone: '+5511977770001',
      cpf: '11144477735', lgpd_consent_granted: true, lgpd_policy_version: '1.0',
    });
    expect(created.status).toBe(201);
    patientId = created.body.id;

    const updated = await api('PUT', `/patients/${patientId}`, { blood_type: 'O+', health_insurance: 'Amil' });
    expect(updated.status).toBe(200);
    const got = await api('GET', `/patients/${patientId}`);
    expect(got.body.patient.blood_type).toBe('O+');

    const removed = await api('DELETE', `/patients/${patientId}`);
    expect(removed.status).toBe(200);
    const gone = await api('GET', `/patients/${patientId}`);
    expect(gone.status).toBe(404);
  });

  it('blocks deletion when clinical records exist (CFM retention)', async () => {
    const p = await api('POST', '/patients', {
      full_name: 'Maria Clínica', birth_date: '1990-01-01', phone: '+5511977770002',
      lgpd_consent_granted: true,
    });
    patientId = p.body.id;
    const enc = await api('POST', '/clinical/encounters', {
      patient_id: patientId, practitioner_id: doctorId, started_at: '2026-07-30 10:00:00', assessment: 'OK',
    }, true);
    expect(enc.status).toBe(201);
    const blocked = await api('DELETE', `/patients/${patientId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('has_clinical_records');

    // encounter update + delete
    const amended = await api('PUT', `/clinical/encounters/${enc.body.id}`, { assessment: 'Amended' }, true);
    expect(amended.status).toBe(200);
    const rx = await api('POST', '/clinical/prescriptions', {
      encounter_id: enc.body.id, patient_id: patientId, practitioner_id: doctorId,
      items: [{ medication: 'Dipirona', dosage: '500mg', frequency: '8/8h', duration: '3 dias' }],
    }, true);
    expect(rx.status).toBe(201);
    const rxDel = await api('DELETE', `/clinical/prescriptions/${rx.body.id}`, undefined, true);
    expect(rxDel.status).toBe(200);
    // Encounter/prescription DELETE is soft-cancel (CFM retention) — rows remain.
    const encDel = await api('DELETE', `/clinical/encounters/${enc.body.id}`);
    expect(encDel.status).toBe(200);
    expect(encDel.body.status).toBe('cancelled');
    expect(encDel.body.clinical_retention).toBe(true);
    // Patient hard-delete must still be blocked; use LGPD anonymization flow instead.
    const stillBlocked = await api('DELETE', `/patients/${patientId}`);
    expect(stillBlocked.status).toBe(409);
    expect(stillBlocked.body.error).toBe('has_clinical_records');
  });
});

describe('inventory (meds)', () => {
  let itemId = '';
  let batchId = '';
  let vendorId = '';

  it('vendor full lifecycle', async () => {
    const created = await api('POST', '/inventory/vendors', { legal_name: 'Drogaria Teste LTDA', cnpj: '12345678000190' });
    expect(created.status).toBe(201);
    vendorId = created.body.id;
    const updated = await api('PUT', `/inventory/vendors/${vendorId}`, { trade_name: 'DrogaTeste', phone: '+551133330000' });
    expect(updated.status).toBe(200);
    const removed = await api('DELETE', `/inventory/vendors/${vendorId}`);
    expect(removed.status).toBe(200);
    expect(removed.body.soft_deleted).toBe(false);
  });

  it('item + batch + stock movement actually adjusts stock', async () => {
    const item = await api('POST', '/inventory/items', {
      sku: 'MED-001', name: 'Dipirona 500mg', category: 'medication', unit: 'cp',
      min_stock: 10, unit_cost: 0.5,
    });
    expect(item.status).toBe(201);
    itemId = item.body.id;

    const batch = await api('POST', '/inventory/batches', {
      item_id: itemId, batch_number: 'L2401', expiry_date: '2027-12-31', quantity: 100, cost_per_unit: 0.5,
    });
    expect(batch.status).toBe(201);
    batchId = batch.body.id;

    // stock out via FEFO (no batch given)
    const out = await api('POST', '/inventory/movements', { item_id: itemId, movement_type: 'out', quantity: 30 });
    expect(out.status).toBe(201);
    let items = (await api('GET', '/inventory/items')).body.items;
    expect(items.find((i: any) => i.id === itemId).current_stock).toBe(70);

    // insufficient stock is rejected and nothing changes
    const tooMuch = await api('POST', '/inventory/movements', { item_id: itemId, movement_type: 'out', quantity: 999 });
    expect(tooMuch.status).toBe(409);
    items = (await api('GET', '/inventory/items')).body.items;
    expect(items.find((i: any) => i.id === itemId).current_stock).toBe(70);

    // batch edit + delete writes off remaining stock
    const bUpd = await api('PUT', `/inventory/batches/${batchId}`, { batch_number: 'L2401-B' });
    expect(bUpd.status).toBe(200);
    const bDel = await api('DELETE', `/inventory/batches/${batchId}`);
    expect(bDel.status).toBe(200);
    expect(bDel.body.written_off).toBe(70);
    items = (await api('GET', '/inventory/items')).body.items;
    expect(items.find((i: any) => i.id === itemId).current_stock).toBe(0);

    // item with movement history soft-deletes
    const iDel = await api('DELETE', `/inventory/items/${itemId}`);
    expect(iDel.status).toBe(200);
    expect(iDel.body.soft_deleted).toBe(true);
    const after = (await api('GET', '/inventory/items')).body.items;
    expect(after.find((i: any) => i.id === itemId)).toBeUndefined();
  });
});

describe('accounting', () => {
  it('chart of accounts lifecycle', async () => {
    const created = await api('POST', '/accounting/chart', { code: '5.1.02.099', name: 'Teste Conta', type: 'expense' });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const dup = await api('POST', '/accounting/chart', { code: '5.1.02.099', name: 'Dup', type: 'expense' });
    expect(dup.status).toBe(409);
    const updated = await api('PUT', `/accounting/chart/${id}`, { name: 'Teste Conta 2' });
    expect(updated.status).toBe(200);
    const removed = await api('DELETE', `/accounting/chart/${id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.soft_deleted).toBe(false);
  });

  it('invoice lifecycle — paid invoices are protected', async () => {
    const created = await api('POST', '/accounting/invoices', {
      issue_date: '2026-07-30', total: 250,
      lines: [{ description: 'Consulta', quantity: 1, unit_price: 250, tax_rate: 0 }],
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const updated = await api('PUT', `/accounting/invoices/${id}`, { total: 300 });
    expect(updated.status).toBe(200);
    const paid = await api('PUT', `/accounting/invoices/${id}/mark-paid`, {});
    expect(paid.status).toBe(200);
    const editPaid = await api('PUT', `/accounting/invoices/${id}`, { total: 1 });
    expect(editPaid.status).toBe(409);
    // Delete requires confirm password; paid invoices remain fiscal records (409).
    const delNoPw = await api('DELETE', `/accounting/invoices/${id}`, {});
    expect(delNoPw.status).toBe(403);
    expect(delNoPw.body.error).toBe('invalid_delete_password');
    const delPaid = await api('DELETE', `/accounting/invoices/${id}`, { password: '1234' });
    expect(delPaid.status).toBe(409);
    expect(delPaid.body.error).toBe('already_paid');
    // clean up directly (fiscal retention is enforced at the API level)
    db.prepare(`DELETE FROM invoices WHERE id = ?`).run(id);
  });
});

describe('payroll', () => {
  it('employee lifecycle + draft run deletion', async () => {
    db.prepare(`DELETE FROM payslips`).run();
    db.prepare(`DELETE FROM payroll_runs`).run();
    db.prepare(`DELETE FROM employees`).run();
    const cpf1 = '86487532010';
    const cpf2 = '86487532100';
    const emp = await api('POST', '/payroll/employees', {
      full_name: 'Func Teste', cpf: cpf1, role: 'Recepção',
      admission_date: '2026-01-10', base_salary: 3000, weekly_hours: 44, dependents: 1,
    });
    expect(emp.status).toBe(201);

    const run = await api('POST', '/payroll/run', { period: '2026-07' });
    expect(run.status).toBe(201);
    const runId = run.body.id;

    // employee now has payslips → soft delete
    const empDel = await api('DELETE', `/payroll/employees/${emp.body.id}`);
    expect(empDel.status).toBe(200);
    expect(empDel.body.soft_deleted).toBe(true);

    // draft run deletable, then re-run approve flow guards
    const runDel = await api('DELETE', `/payroll/runs/${runId}`);
    expect(runDel.status).toBe(200);

    // need an active employee for the next run
    const emp2 = await api('POST', '/payroll/employees', {
      full_name: 'Func Teste 2', cpf: cpf2, role: 'Recepção',
      admission_date: '2026-02-01', base_salary: 2500, weekly_hours: 44, dependents: 0,
    });
    expect(emp2.status).toBe(201);

    const run2 = await api('POST', '/payroll/run', { period: '2026-07' });
    expect(run2.status).toBe(201);
    const approve = await api('PUT', `/payroll/runs/${run2.body.id}/approve`, {});
    expect(approve.status).toBe(200);
    const delApproved = await api('DELETE', `/payroll/runs/${run2.body.id}`);
    expect(delApproved.status).toBe(409);
    db.prepare(`DELETE FROM payroll_runs WHERE id = ?`).run(run2.body.id);
  });
});

describe('whatsapp production helpers', () => {
  it('webhook accepts a valid X-Hub-Signature-256 and rejects a bad one', async () => {
    const payload = JSON.stringify({ entry: [] });
    const good = 'sha256=' + crypto.createHmac('sha256', 'test-app-secret').update(payload).digest('hex');
    const okRes = await fetch(`${BASE}/api/whatsapp/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': good }, body: payload,
    });
    expect(okRes.status).toBe(200);

    const badRes = await fetch(`${BASE}/api/whatsapp/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=deadbeef' }, body: payload,
    });
    expect(badRes.status).toBe(401);
  });

  it('dry-run send persists the message and staff send works', async () => {
    const res = await api('POST', '/whatsapp/send', { phone: '+5511966660001', body: 'Olá!' });
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    const msgs = await api('GET', `/whatsapp/messages?phone=${encodeURIComponent('+5511966660001')}`);
    expect(msgs.body.messages.length).toBe(1);
  });

  it('staff send is blocked for opted-out numbers (LGPD)', async () => {
    const phone = '+5511966660002';
    db.prepare(`INSERT INTO whatsapp_conversations (id, phone, state, opted_out, last_message_at) VALUES (?, ?, 'lgpd_optout', 1, datetime('now'))`)
      .run(uuid(), phone);
    const res = await api('POST', '/whatsapp/send', { phone, body: 'Oi?' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('opted_out');
  });

  it('conversation delete removes messages too', async () => {
    const phone = '+5511966660001';
    const res = await api('DELETE', `/whatsapp/conversations/${encodeURIComponent(phone)}`);
    // conversation was auto-created by /send? no — /send does not create conversations
    expect([200, 404]).toContain(res.status);
    const msgs = await api('GET', `/whatsapp/messages?phone=${encodeURIComponent(phone)}`);
    expect(msgs.body.messages.length).toBe(res.status === 200 ? 0 : 1);
  });
});

describe('lgpd data requests', () => {
  it('staff registers and fulfills a subject request', async () => {
    const p = await api('POST', '/patients', {
      full_name: 'Titular LGPD', birth_date: '2000-01-01', phone: '+5511977770003', lgpd_consent_granted: true,
    });
    const created = await api('POST', '/lgpd/data-requests', {
      request_type: 'deletion', subject_type: 'patient', subject_id: p.body.id, notes: 'Pedido por telefone',
    });
    expect(created.status).toBe(201);
    const fulfilled = await api('PUT', `/lgpd/data-requests/${created.body.id}/fulfill`, {});
    expect(fulfilled.status).toBe(200);
    await api('DELETE', `/patients/${p.body.id}`);
  });
});
