/**
 * Invoice document upload + NVIDIA OCR wiring (mocked NVIDIA HTTP).
 */
import path from 'path';
import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db } from '../src/db/schema';

const TEST_DB_DIR = path.join(__dirname, '..', 'data-test-invoice-ocr');
const BASE = 'http://127.0.0.1:4013';

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

async function waitForServer(attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

beforeAll(async () => {
  process.env.PORT = '4013';
  process.env.DB_DIR = TEST_DB_DIR;
  process.env.UPLOADS_DIR = path.join(TEST_DB_DIR, 'uploads');
  process.env.NVIDIA_API_KEYS = 'nvapi-test-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  process.env.NVIDIA_OCR_MODEL = 'nvidia/nemotron-nano-12b-v2-vl';

  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes('integrate.api.nvidia.com')) {
      const content = JSON.stringify({
        invoice_number: 'NF-OCR-1',
        issue_date: '2026-07-15',
        due_date: '2026-07-30',
        patient_name: 'Maria OCR',
        total: 180,
        lines: [{ description: 'Consulta OCR', quantity: 1, unit_price: 180, tax_rate: 0 }],
        raw_text: 'FATURA NF-OCR-1 Total 180',
        confidence: 'high',
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  await import('../src/server');
  await waitForServer();
  const email = `admin-ocr-${Date.now()}@test.com`;
  const id = uuid();
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role)
    VALUES (?, ?, ?, 'Test Admin', 'admin')
  `).run(id, email, bcrypt.hashSync('adminpass123', 10));
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'adminpass123' }),
  });
  token = ((await login.json()) as any).token;
}, 30_000);

afterAll(() => {
  try { db.close(); } catch { /* */ }
});

describe('invoice OCR', () => {
  it('reports OCR status and extracts fields from image upload', async () => {
    const status = await api('GET', '/accounting/invoices/ocr/status');
    expect(status.status).toBe(200);
    expect(status.body.ready).toBe(true);

    const jpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
      'base64',
    );

    const ocr = await api('POST', '/accounting/invoices/ocr', {
      filename: 'nf.jpg',
      mime: 'image/jpeg',
      data_base64: jpeg.toString('base64'),
    });
    expect(ocr.status).toBe(200);
    expect(ocr.body.extraction.invoice_number).toBe('NF-OCR-1');
    expect(ocr.body.extraction.total).toBe(180);
    expect(ocr.body.extraction.lines[0].description).toContain('Consulta');

    const created = await api('POST', '/accounting/invoices', {
      issue_date: ocr.body.extraction.issue_date,
      due_date: ocr.body.extraction.due_date,
      total: ocr.body.extraction.total,
      status: 'issued',
      invoice_number_override: ocr.body.extraction.invoice_number,
      lines: ocr.body.extraction.lines,
    });
    expect(created.status).toBe(201);

    const attached = await api('POST', `/accounting/invoices/${created.body.id}/documents`, {
      filename: 'nf.jpg',
      mime: 'image/jpeg',
      data_base64: jpeg.toString('base64'),
      run_ocr: true,
      apply_ocr_fields: true,
    });
    expect(attached.status).toBe(201);
    expect(attached.body.ocr_status).toBe('done');

    const detail = await api('GET', `/accounting/invoices/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.documents.length).toBe(1);
    expect(fs.existsSync(path.join(TEST_DB_DIR, 'uploads'))).toBe(true);
  });

  it('requires password 1234 to delete an unpaid invoice', async () => {
    process.env.INVOICE_DELETE_PASSWORD = '1234';
    const created = await api('POST', '/accounting/invoices', {
      issue_date: '2026-08-01',
      total: 50,
      status: 'issued',
      invoice_number_override: 'NF-DEL-1',
      lines: [{ description: 'Consulta', quantity: 1, unit_price: 50, tax_rate: 0 }],
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const denied = await api('DELETE', `/accounting/invoices/${id}`, { password: 'wrong' });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('invalid_delete_password');

    const missing = await api('DELETE', `/accounting/invoices/${id}`, {});
    expect(missing.status).toBe(403);

    const ok = await api('DELETE', `/accounting/invoices/${id}`, { password: '1234' });
    expect(ok.status).toBe(200);
    expect(ok.body.deleted_id).toBe(id);

    const gone = await api('GET', `/accounting/invoices/${id}`);
    expect(gone.status).toBe(404);
  });
});
