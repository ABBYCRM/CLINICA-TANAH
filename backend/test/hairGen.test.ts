/**
 * Unit tests for TANAH-HAIR-GEN port (presets, sanitize, parametric, watermark, safety).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { initSchema, db, DEFAULT_TENANT_ID } from '../src/db/schema';
import { presetsCatalog } from '../src/services/hairGen/presets';
import {
  assertSafe,
  buildEditPrompt,
  sanitizeParams,
  resolveHairGeminiFromEnv,
} from '../src/services/hairGen/gemini';
import { renderParametricSvg } from '../src/services/hairGen/parametric';
import { watermarkedImageDataUrl } from '../src/services/hairGen/watermark';
import { v4 as uuid } from 'uuid';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('hairGen (TANAH-HAIR-GEN port)', () => {
  beforeAll(() => {
    initSchema();
  });

  it('exposes full preset catalog', () => {
    const c = presetsCatalog();
    expect(c.hairlines).toHaveLength(4);
    expect(c.zones).toHaveLength(5);
    expect(c.lengths).toHaveLength(4);
    expect(c.colors).toHaveLength(6);
    expect(c.curls).toHaveLength(4);
    expect(c.fullnesses).toHaveLength(3);
    expect(c.techniques).toHaveLength(3);
    expect(c.sessions).toHaveLength(2);
    expect(c.graftScenarios).toHaveLength(4);
    expect(c.views).toHaveLength(6);
  });

  it('sanitizes params and honors view (no shadowing bug)', () => {
    const p = sanitizeParams({ hairline: 'nope', view: 'left', density: 0.9 });
    expect(p.hairline).toBe('balanced');
    expect(p.view).toBe('left');
    expect(p.density).toBe(0.9);
  });

  it('builds a safe identity-preserving prompt', () => {
    const prompt = buildEditPrompt(sanitizeParams({}));
    expect(prompt).toMatch(/PRESERVE the person's identity/i);
    expect(() => assertSafe(prompt)).not.toThrow();
    expect(() => assertSafe(prompt + ' guaranteed result')).toThrow();
  });

  it('renders parametric SVG over a photo without Gemini', () => {
    const svg = renderParametricSvg({
      params: { hairline: 'balanced', length: 'short', color: 'darkBrown', density: 0.7 },
      photoBase64: TINY_PNG,
      photoMime: 'image/png',
      seed: 42,
    });
    expect(svg).toMatch(/<image /);
    expect(svg).toMatch(/clip-path="url\(#zoneClip\)"/);
    const again = renderParametricSvg({
      params: { hairline: 'balanced', length: 'short', color: 'darkBrown', density: 0.7 },
      photoBase64: TINY_PNG,
      photoMime: 'image/png',
      seed: 42,
    });
    expect(again).toBe(svg);
  });

  it('watermarks AI outputs with mandated disclaimer', () => {
    const url = watermarkedImageDataUrl({
      image: { data: TINY_PNG, mimeType: 'image/png' },
      view: 'front',
    });
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(url.split(',')[1], 'base64').toString('utf8');
    expect(svg).toMatch(/HYPOTHETICAL VISUALIZATION/);
    expect(svg).toMatch(/NOT A PREDICTION OR GUARANTEE OF RESULTS/);
    expect(svg).toMatch(/FRONTAL/);
  });

  it('resolves gemini config from env without inventing a key', () => {
    const off = resolveHairGeminiFromEnv({ ...process.env, GEMINI_API_KEY: '', GOOGLE_API_KEY: '' });
    expect(off.configured).toBe(false);
    const on = resolveHairGeminiFromEnv({ ...process.env, GEMINI_API_KEY: 'test-key' });
    expect(on.configured).toBe(true);
    expect(on.apiKey).toBe('test-key');
  });

  it('persists a parametric generation row for a patient', () => {
    const patientId = uuid();
    db.prepare(`
      INSERT INTO patients (id, tenant_id, full_name, birth_date, phone, blood_type, allergies, chronic_conditions, health_insurance, lgpd_consent_at, lgpd_consent_version)
      VALUES (?, ?, 'Hair Patient', '1990-01-01', '+5511999990000', 'O+', '[]', '[]', 'Particular', datetime('now'), '1.0')
    `).run(patientId, DEFAULT_TENANT_ID);

    const svg = renderParametricSvg({
      params: sanitizeParams({}),
      photoBase64: TINY_PNG,
      photoMime: 'image/png',
      seed: 1,
    });
    const output = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const id = uuid();
    db.prepare(`
      INSERT INTO hair_generations (id, tenant_id, patient_id, mode, model, view, params_json, output_data_url)
      VALUES (?, ?, ?, 'parametric', 'parametric-svg', 'front', ?, ?)
    `).run(id, DEFAULT_TENANT_ID, patientId, JSON.stringify(sanitizeParams({})), output);

    const row = db.prepare(`SELECT * FROM hair_generations WHERE id = ?`).get(id) as any;
    expect(row.patient_id).toBe(patientId);
    expect(row.mode).toBe('parametric');
    expect(row.output_data_url).toMatch(/^data:image\/svg\+xml/);
  });
});
