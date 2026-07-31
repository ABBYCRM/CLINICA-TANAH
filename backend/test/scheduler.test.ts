/**
 * Scheduler unity — one availability service drives the REST API,
 * the calendar UI, and the WhatsApp bot. No double-booking anywhere.
 */
import path from 'path';
import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const TEST_DB_DIR = path.join(__dirname, '..', 'data-test-scheduler');
const BASE = 'http://127.0.0.1:3995';

import { db } from '../src/db/schema';
import { getAvailableSlots, getPractitionerLoads } from '../src/services/availability';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';

let token = '';
let doctorA = '';
let doctorB = '';
let patientId = '';
const PHONE = '+5511960607070';
const DATE = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

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
  process.env.PORT = '3995';
  process.env.DB_DIR = TEST_DB_DIR;
  delete process.env.META_WA_APP_SECRET;
  await import('../src/server');
  await waitForServer();

  db.prepare(`DELETE FROM users`).run();
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, 'admin@sched.com', ?, 'Sched Admin', 'admin')`)
    .run(uuid(), bcrypt.hashSync('adminpass123', 10));
  doctorA = uuid();
  doctorB = uuid();
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, 'doca@sched.com', ?, 'Dr. Alpha', 'doctor')`)
    .run(doctorA, bcrypt.hashSync('x'.repeat(9), 10));
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, 'docb@sched.com', ?, 'Dr. Beta', 'doctor')`)
    .run(doctorB, bcrypt.hashSync('x'.repeat(9), 10));

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@sched.com', password: 'adminpass123' }),
  });
  token = ((await res.json()) as any).token;

  patientId = uuid();
  db.prepare(`
    INSERT INTO patients (id, full_name, birth_date, phone, blood_type, allergies, chronic_conditions, health_insurance, lgpd_consent_at, lgpd_consent_version)
    VALUES (?, 'Paulo Agenda', '1975-11-30', ?, 'A-', '["Penicilina"]', '["Hipertensão"]', 'Bradesco Saúde', datetime('now'), '1.0')
  `).run(patientId, PHONE);
});

afterAll(() => {
  db.close();
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

describe('availability service', () => {
  it('flags taken slots and ranks doctors by remaining room', async () => {
    // book doctor A 08:00 via API
    const created = await api('POST', '/appointments', {
      patient_id: patientId, practitioner_id: doctorA, scheduled_at: `${DATE} 08:00:00`, type: 'consultation',
    });
    expect(created.status).toBe(201);

    expect(getAvailableSlots(doctorA, DATE)).not.toContain(`${DATE} 08:00:00`);
    expect(getAvailableSlots(doctorA, DATE)).toContain(`${DATE} 08:30:00`);

    const loads = getPractitionerLoads(DATE);
    expect(loads[0].id).toBe(doctorB); // more free slots than A now
    expect(loads.find((l) => l.id === doctorA)!.booked).toBe(1);

    // API view matches the service
    const avail = await api('GET', `/appointments/availability?practitioner_id=${doctorA}&date=${DATE}`);
    const slot800 = avail.body.slots.find((s: any) => s.scheduled_at.endsWith('08:00:00'));
    expect(slot800.available).toBe(false);
    expect(avail.body.practitioner_loads.length).toBe(2);
  });

  it('API rejects double-booking (409) and allows after cancellation', async () => {
    const dup = await api('POST', '/appointments', {
      patient_id: patientId, practitioner_id: doctorA, scheduled_at: `${DATE} 08:00:00`, type: 'return',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('slot_taken');

    // cancel the original, then the slot frees up
    const list = await api('GET', `/appointments?from=${DATE}&to=${DATE}`);
    const first = list.body.appointments.find((a: any) => a.practitioner_id === doctorA);
    await api('PUT', `/appointments/${first.id}`, { status: 'cancelled' });
    const rebook = await api('POST', '/appointments', {
      patient_id: patientId, practitioner_id: doctorA, scheduled_at: `${DATE} 08:00:00`, type: 'consultation',
    });
    expect(rebook.status).toBe(201);
  });

  it('the WhatsApp bot books through the same service', async () => {
    // bot booking flow: menu → 1 → CPF → specialty → AMANHÃ is tricky (date depends);
    // drive the date state directly by picking DATE via a DD/MM message instead.
    const send = async (body: string) =>
      (await api('POST', '/whatsapp/simulate', { phone: PHONE, body, locale: 'pt-BR' })).body.last_bot_reply?.body ?? '';

    await send('oi');
    expect(await send('1')).toContain('CPF');
    // find the patient's CPF — none seeded, so set one
    db.prepare(`UPDATE patients SET cpf = '99988877766' WHERE id = ?`).run(patientId);
    expect(await send('99988877766')).toContain('Clínica Geral');
    expect(await send('1')).toMatch(/dia|date/i);
    const [y, m, d] = DATE.split('-');
    const confirm = await send(`${d}/${m}/${y}`);
    expect(confirm).toMatch(/agendada|confirmada|📅/i);

    // the bot wrote a real appointment through the availability service
    const appt = db.prepare(`
      SELECT * FROM appointments WHERE patient_id = ? AND source = 'whatsapp_bot' AND date(scheduled_at) = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(patientId, DATE) as any;
    expect(appt).toBeTruthy();
    // and that exact slot is now taken in the shared service
    expect(getAvailableSlots(appt.practitioner_id, DATE)).not.toContain(appt.scheduled_at);
  });
});

describe('clinical summary (decision panel)', () => {
  it('returns allergies, chronic conditions, insurance and history', async () => {
    const res = await api('GET', `/patients/${patientId}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.patient.allergies).toContain('Penicilina');
    expect(res.body.patient.chronic_conditions).toContain('Hipertensão');
    expect(res.body.patient.health_insurance).toBe('Bradesco Saúde');
    expect(res.body.patient.blood_type).toBe('A-');
    expect(Array.isArray(res.body.upcoming_appointments)).toBe(true);
  });
});
