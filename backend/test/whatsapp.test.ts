/**
 * Vitest tests for the WhatsApp bot conversation flow.
 */
// IMPORTANT: set DB_DIR before importing anything that loads the schema
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const TEST_DB_DIR = path.join(__dirname, '..', 'data-test');
const TEST_DB = path.join(TEST_DB_DIR, 'clinica-tanah.db');

import { db, initSchema } from '../src/db/schema';
import { handleMessage } from '../src/routes/whatsapp';
import { persistIncoming } from '../src/services/whatsapp';

beforeAll(() => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  initSchema();
  // Seed a test patient
  const pid = uuid();
  db.prepare(`
    INSERT INTO patients (id, full_name, birth_date, cpf, phone, lgpd_consent_at, lgpd_consent_version)
    VALUES (?, 'Maria Teste', '1990-01-01', '12345678901', '+5511900000000', datetime('now'), '1.0')
  `).run(pid);
});

afterAll(() => {
  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

async function getLastBotMessage(phone: string): Promise<string> {
  const row = db.prepare(`
    SELECT body FROM whatsapp_messages
    WHERE phone = ? AND direction = 'out'
    ORDER BY rowid DESC LIMIT 1
  `).get(phone) as any;
  return row?.body || '';
}

describe('WhatsApp bot — Portuguese flow', () => {
  it('greets with menu on first message', async () => {
    const phone = '+5511911111111';
    persistIncoming(phone, 'oi');
    await handleMessage(phone, 'oi', 'pt-BR');
    const reply = await getLastBotMessage(phone);
    expect(reply).toContain('Clínica Tanah');
    expect(reply).toContain('Flow Doctor');
    expect(reply).toMatch(/Marcar consulta|1 —/);
  });

  it('routes 1 to CPF request', async () => {
    const phone = '+5511922222222';
    persistIncoming(phone, 'oi');
    await handleMessage(phone, 'oi', 'pt-BR');
    persistIncoming(phone, '1');
    await handleMessage(phone, '1', 'pt-BR');
    const reply = await getLastBotMessage(phone);
    expect(reply.toLowerCase()).toContain('cpf');
  });

  it('Flow Doctor keyword returns Portuguese marketing menu', async () => {
    const phone = '+5511955555555';
    persistIncoming(phone, 'médico');
    await handleMessage(phone, 'médico', 'en');
    const reply = await getLastBotMessage(phone);
    expect(reply).toContain('Flow Doctor');
    expect(reply).toContain('Promoções');
    expect(reply).toContain('satisfação');
  });

  it('option 5 lists promotions in Portuguese', async () => {
    const phone = '+5511966666666';
    persistIncoming(phone, 'oi');
    await handleMessage(phone, 'oi', 'pt-BR');
    persistIncoming(phone, '5');
    await handleMessage(phone, '5', 'pt-BR');
    const reply = await getLastBotMessage(phone);
    expect(reply).toMatch(/Promoç|campanha|Check-up|SAIR/i);
  });

  it('SAIR confirms marketing opt-out without locking clinical thread', async () => {
    const phone = '+5511933333333';
    persistIncoming(phone, 'oi');
    await handleMessage(phone, 'oi', 'pt-BR');
    persistIncoming(phone, 'SAIR');
    await handleMessage(phone, 'SAIR', 'pt-BR');
    const reply = await getLastBotMessage(phone);
    expect(reply.toLowerCase()).toMatch(/removid|respeit/);
    const conv = db.prepare(`SELECT opted_out, state FROM whatsapp_conversations WHERE phone = ?`).get(phone) as any;
    // SAIR opts out of marketing campaigns but keeps the conversation usable for clinical utility
    expect(conv.state).toBe('idle');
    expect(conv.opted_out).toBe(0);
  });

  it('atendente marks conversation awaiting_human for inbound desk', async () => {
    const phone = '+5511922222211';
    persistIncoming(phone, 'oi');
    await handleMessage(phone, 'oi', 'pt-BR');
    persistIncoming(phone, 'atendente');
    await handleMessage(phone, 'atendente', 'pt-BR');
    const reply = await getLastBotMessage(phone);
    expect(reply.toLowerCase()).toMatch(/atendente|instantes|paci/);
    const conv = db.prepare(`SELECT state FROM whatsapp_conversations WHERE phone = ?`).get(phone) as any;
    expect(conv.state).toBe('awaiting_human');
  });

  it('English-speaker gets English menu', async () => {
    const phone = '+5511944444444';
    persistIncoming(phone, 'hello');
    await handleMessage(phone, 'hello', 'en');
    const reply = await getLastBotMessage(phone);
    expect(reply).toContain('Book appointment');
  });
});
