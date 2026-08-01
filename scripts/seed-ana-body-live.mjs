#!/usr/bin/env node
/**
 * Upload Ana Beatriz Lima's 4-view body capture set to a running Clínica Tanah instance.
 * Usage:
 *   BASE_URL=https://clinica-tanah-bbqu7.ondigitalocean.app node scripts/seed-ana-body-live.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = path.join(root, 'backend/src/data/seed-body-ana');
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
  const patients = await api('/api/patients?q=Ana%20Beatriz&limit=20', { token });
  const ana = (patients.patients || patients || []).find((p) =>
    /ana\s+beatriz\s+lima/i.test(p.full_name || ''),
  );
  if (!ana) throw new Error('Ana Beatriz Lima not found');
  console.log(`▸ Patient ${ana.full_name} (${ana.id})`);

  await api(`/api/clinical/body/${ana.id}/consents`, {
    method: 'POST',
    token,
    body: { purposes: ['clinical_record', 'image_processing', 'generative_ai'] },
  });
  console.log('▸ Consents granted');

  const session = await api(`/api/clinical/body/${ana.id}/capture-sessions`, {
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
      body: { idempotency_key: `seed-ana-${Date.now()}` },
    });
    console.log('▸ Validated 4/4');
  } catch (e) {
    console.warn('▸ Validate skipped:', e.message);
  }

  try {
    await api(`/api/clinical/body/${ana.id}/measurements`, {
      method: 'POST',
      token,
      body: {
        height_cm: 165,
        weight_kg: 98.0,
        waist_cm: 112,
        hip_cm: 122,
        body_fat_pct: 44,
        notes: 'Live seed Ana — composição corporal (teste multi-vista, sobrepeso)',
      },
    });
    console.log('▸ Measurement saved');
  } catch (e) {
    console.warn('▸ Measurement skipped:', e.message);
  }

  // Lifestyle plans so Cenários generate is unblocked
  for (const plan of [
    {
      title: 'Déficit calórico Ana',
      description: 'Plano nutricional seed — proteína elevada',
      summary: 'Proteína elevada, déficit ~500 kcal',
      plan_type: 'nutrition',
      weeks: 12,
      daily_calories: 1700,
      deficit_kcal: 500,
      protein_g: 120,
    },
    {
      title: 'Força + caminhada',
      description: 'Plano de treino seed',
      summary: '3x força, 3x cardio leve',
      plan_type: 'exercise',
      weeks: 12,
    },
  ]) {
    try {
      await api(`/api/clinical/body/${ana.id}/plans`, {
        method: 'POST',
        token,
        body: plan,
      });
      console.log(`▸ Plan: ${plan.title}`);
    } catch (e) {
      console.warn(`▸ Plan skipped (${plan.title}):`, e.message);
    }
  }

  const overview = await api(`/api/clinical/body/${ana.id}`, { token });
  const active = overview.active_capture_session;
  const count = active ? Object.keys(active.assets || {}).length : 0;
  console.log(`✅ Done — active session ${active?.id || 'none'} with ${count}/4 views`);
  console.log(`   simulations_allowed=${overview.simulations_allowed}`);
  console.log(`   Open: ${BASE}/patients/${ana.id} → Clínico → Corpo → Cenários`);
}

main().catch((e) => {
  console.error('✗', e.message, e.body || '');
  process.exit(1);
});
