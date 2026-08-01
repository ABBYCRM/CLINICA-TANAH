/**
 * WhatsApp engagement features — appointment cancellation by the bot,
 * NPS satisfaction surveys, and promotional campaign blasts.
 */
import path from 'path';
import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const TEST_DB_DIR = path.join(__dirname, '..', 'data-test-engagement');
const BASE = 'http://127.0.0.1:3999';

import { db } from '../src/db/schema';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';

let token = '';
let patientId = '';
const PHONE = '+5511987654321';

async function api(method: string, p: string, body?: any) {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function simulate(phone: string, body: string) {
  const res = await api('POST', '/whatsapp/simulate', { phone, body, locale: 'pt-BR' });
  expect(res.status).toBe(200);
  return res.body.last_bot_reply?.body ?? '';
}

/** Last n bot replies, oldest first (flows often answer then re-show the menu). */
function lastBotMessages(phone: string, n: number): string[] {
  return (db.prepare(`
    SELECT body FROM whatsapp_messages WHERE phone = ? AND direction = 'out'
    ORDER BY rowid DESC LIMIT ?
  `).all(phone, n) as any[]).map((r) => r.body).reverse();
}

async function waitForServer(attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

beforeAll(async () => {
  process.env.PORT = '3999';
  process.env.DB_DIR = TEST_DB_DIR;
  delete process.env.META_WA_APP_SECRET;
  await import('../src/server');
  await waitForServer();

  const adminId = uuid();
  db.prepare(`DELETE FROM users`).run();
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, 'admin@eng.com', ?, 'Eng Admin', 'admin')`)
    .run(adminId, bcrypt.hashSync('adminpass123', 10));
  const doctorId = uuid();
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, 'doc@eng.com', ?, 'Dr. Eng', 'doctor')`)
    .run(doctorId, bcrypt.hashSync('doctorpass123', 10));
  (globalThis as any).__doctorId = doctorId;

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@eng.com', password: 'adminpass123' }),
  });
  token = ((await res.json()) as any).token;

  patientId = uuid();
  db.prepare(`
    INSERT INTO patients (id, full_name, birth_date, cpf, phone, lgpd_consent_at, lgpd_consent_version)
    VALUES (?, 'Ana Engajamento', '1992-03-15', '55544433322', ?, datetime('now'), '1.0')
  `).run(patientId, PHONE);
});

afterAll(() => {
  db.close();
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

describe('bot — real appointment cancellation', () => {
  it('lists appointments, cancels the chosen one, confirms', async () => {
    const doctorId = (globalThis as any).__doctorId;
    const apptId = uuid();
    const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO appointments (id, patient_id, practitioner_id, scheduled_at, type, status, source)
      VALUES (?, ?, ?, ?, 'consultation', 'scheduled', 'whatsapp_bot')
    `).run(apptId, patientId, doctorId, `${future} 09:00:00`);

    // menu → 3 (cancelar)
    expect(await simulate(PHONE, 'oi')).toContain('Agendar consulta');
    const ask = await simulate(PHONE, '3');
    expect(ask).toContain('cancelar');
    expect(ask).toContain('Dr. Eng');

    // pick 1 → cancelled
    await simulate(PHONE, '1');
    const doneMsgs = lastBotMessages(PHONE, 2);
    expect(doneMsgs[0]).toContain('cancelada');
    const appt = db.prepare(`SELECT status FROM appointments WHERE id = ?`).get(apptId) as any;
    expect(appt.status).toBe('cancelled');

    // second time: nothing to cancel
    await simulate(PHONE, '3');
    const noneMsgs = lastBotMessages(PHONE, 2);
    expect(noneMsgs[0]).toMatch(/não tem|no tienes|no upcoming/i);
  });
});

describe('NPS satisfaction surveys', () => {
  it('dispatches to completed appointments and records the answer', async () => {
    const doctorId = (globalThis as any).__doctorId;
    const apptId = uuid();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO appointments (id, patient_id, practitioner_id, scheduled_at, type, status, source)
      VALUES (?, ?, ?, ?, 'consultation', 'completed', 'reception')
    `).run(apptId, patientId, doctorId, `${yesterday} 14:00:00`);

    const dispatched = await api('POST', '/whatsapp/surveys/dispatch', { days: 7 });
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.dispatched).toBe(1);

    // the patient is now in awaiting_nps_score — score must be 0-10
    const invalid = await simulate(PHONE, 'abc');
    expect(invalid).toMatch(/0 a 10/);
    const commentAsk = await simulate(PHONE, '9');
    expect(commentAsk).toContain('9');
    await simulate(PHONE, 'Atendimento excelente!');
    const thanksMsgs = lastBotMessages(PHONE, 2);
    expect(thanksMsgs[0]).toMatch(/feedback|Agradecemos/i);

    const survey = db.prepare(`SELECT * FROM satisfaction_surveys WHERE appointment_id = ?`).get(apptId) as any;
    expect(survey.score).toBe(9);
    expect(survey.comment).toBe('Atendimento excelente!');

    // aggregate reflects it
    const agg = await api('GET', '/whatsapp/surveys');
    expect(agg.body.total).toBe(1);
    expect(agg.body.promoters).toBe(1);
    expect(agg.body.nps).toBe(100);

    // no double-dispatch for the same appointment
    const again = await api('POST', '/whatsapp/surveys/dispatch', { days: 7 });
    expect(again.body.dispatched).toBe(0);
  });
});

describe('campaigns (customer appreciation day)', () => {
  it('creates, blasts with opt-out footer, and counts deliveries', async () => {
    const created = await api('POST', '/whatsapp/campaigns', {
      name: 'Dia do Cliente',
      message: 'Olá {{name}}! Semana do Cliente: 20% off em consultas. 💙',
    });
    expect(created.status).toBe(201);

    const dispatched = await api('POST', `/whatsapp/campaigns/${created.body.id}/dispatch`, {});
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.sent).toBeGreaterThanOrEqual(1);

    const msg = db.prepare(`
      SELECT body FROM whatsapp_messages WHERE phone = ? AND direction = 'out' ORDER BY rowid DESC LIMIT 1
    `).get(PHONE) as any;
    expect(msg.body).toContain('Ana');               // {{name}} replaced
    expect(msg.body).toContain('SAIR');              // LGPD opt-out footer

    const campaign = (await api('GET', '/whatsapp/campaigns')).body.campaigns.find((c: any) => c.id === created.body.id);
    expect(campaign.status).toBe('sent');
    expect(campaign.sent_count).toBe(dispatched.body.sent);

    // sent campaigns can't be re-sent or deleted
    expect((await api('POST', `/whatsapp/campaigns/${created.body.id}/dispatch`, {})).status).toBe(409);
    expect((await api('DELETE', `/whatsapp/campaigns/${created.body.id}`)).status).toBe(409);

    // drafts can be deleted
    const draft = await api('POST', '/whatsapp/campaigns', { name: 'Rascunho', message: 'teste' });
    expect((await api('DELETE', `/whatsapp/campaigns/${draft.body.id}`)).status).toBe(200);
  });

  it('opted-out patients are skipped from blasts', async () => {
    db.prepare(`UPDATE whatsapp_conversations SET opted_out = 1 WHERE phone = ?`).run(PHONE);
    const c = await api('POST', '/whatsapp/campaigns', { name: 'Optout test', message: 'Oi {{name}}' });
    const d = await api('POST', `/whatsapp/campaigns/${c.body.id}/dispatch`, {});
    const sentToPhone = db.prepare(`
      SELECT COUNT(*) AS c FROM whatsapp_messages WHERE phone = ? AND direction = 'out' AND body LIKE '%Optout%'
    `).get(PHONE) as any;
    expect(sentToPhone.c).toBe(0);
    db.prepare(`UPDATE whatsapp_conversations SET opted_out = 0 WHERE phone = ?`).run(PHONE);
  });
});
