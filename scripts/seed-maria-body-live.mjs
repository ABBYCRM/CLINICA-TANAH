#!/usr/bin/env node
/**
 * Upload Maria Aparecida's 4-view body capture set to a running Clínica Tanah instance.
 * Usage:
 *   BASE_URL=https://clinica-tanah-bbqu7.ondigitalocean.app node scripts/seed-maria-body-live.mjs
 *   BASE_URL=http://127.0.0.1:3120 node scripts/seed-maria-body-live.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = path.join(root, 'backend/src/data/seed-body-maria');
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3120').replace(/\/$/, '');
const USER = process.env.ADMIN_USER || 'Juliana';
const PASS = process.env.ADMIN_PASSWORD || '12345678';
const VIEWS = ['front', 'left', 'right', 'back'];

async function api(pathname, { method = 'GET', token, body, headers } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(json?.message || json?.error || res.statusText);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function jpgB64(view) {
  const file = path.join(SEED_DIR, `${view}.jpg`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  return fs.readFileSync(file).toString('base64');
}

async function main() {
  console.log(`▸ Login ${BASE} as ${USER}`);
  const login = await api('/api/auth/login', { method: 'POST', body: { email: USER, password: PASS } });
  const token = login.token;
  const patients = await api('/api/patients?q=Maria%20Aparecida&limit=20', { token });
  const maria = (patients.patients || patients || []).find((p) =>
    /maria\s+aparecida/i.test(p.full_name || ''),
  );
  if (!maria) throw new Error('Maria Aparecida Silva not found');
  console.log(`▸ Patient ${maria.full_name} (${maria.id})`);

  await api(`/api/clinical/body/${maria.id}/consents`, {
    method: 'POST',
    token,
    body: { purposes: ['clinical_record', 'image_processing', 'generative_ai'] },
  });
  console.log('▸ Consents granted');

  const session = await api(`/api/clinical/body/${maria.id}/capture-sessions`, {
    method: 'POST',
    token,
    body: {},
  });
  console.log(`▸ Session ${session.id}`);

  for (const view of VIEWS) {
    const data_base64 = jpgB64(view);
    await api(`/api/clinical/body/capture-sessions/${session.id}/assets`, {
      method: 'POST',
      token,
      body: { view, content_type: 'image/jpeg', data_base64 },
    });
    console.log(`  ✓ ${view}`);
  }

  try {
    await api(`/api/clinical/body/capture-sessions/${session.id}/validate`, {
      method: 'POST',
      token,
      body: { idempotency_key: `seed-maria-${Date.now()}` },
    });
    console.log('▸ Validated 4/4');
  } catch (e) {
    console.warn('▸ Validate skipped:', e.message);
  }

  // Optional measurement
  try {
    await api(`/api/clinical/body/${maria.id}/measurements`, {
      method: 'POST',
      token,
      body: {
        height_cm: 158,
        weight_kg: 92.5,
        waist_cm: 108,
        hip_cm: 118,
        body_fat_pct: 42,
        notes: 'Live seed — composição corporal (teste multi-vista)',
      },
    });
    console.log('▸ Measurement saved');
  } catch (e) {
    console.warn('▸ Measurement skipped:', e.message);
  }

  const overview = await api(`/api/clinical/body/${maria.id}`, { token });
  const active = overview.active_capture_session;
  const count = active ? Object.keys(active.assets || {}).length : 0;
  console.log(`✅ Done — active session ${active?.id || 'none'} with ${count}/4 views`);
  console.log(`   simulations_allowed=${overview.simulations_allowed}`);
}

main().catch((e) => {
  console.error('✗', e.message, e.body || '');
  process.exit(1);
});
