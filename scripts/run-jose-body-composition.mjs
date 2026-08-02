#!/usr/bin/env node
/**
 * API body-composition run for José Carlos Pereira.
 * Uploads 4-view captures, measurements, lifestyle plans, generates a scenario + clinical report.
 *
 *   BASE_URL=https://clinica-tanah-bbqu7.ondigitalocean.app \
 *   IMAGE_DIR=/tmp/jose-body \
 *   node scripts/run-jose-body-composition.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.BASE_URL || 'https://clinica-tanah-bbqu7.ondigitalocean.app').replace(/\/$/, '');
const USER = process.env.ADMIN_USER || 'Juliana';
const PASS = process.env.ADMIN_PASSWORD || '12345678';
const IMAGE_DIR = process.env.IMAGE_DIR || '/tmp/jose-body';
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
  const file = path.join(IMAGE_DIR, `${view}.jpg`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  return fs.readFileSync(file).toString('base64');
}

async function main() {
  console.log(`▸ Login ${BASE} as ${USER}`);
  const login = await api('/api/auth/login', { method: 'POST', body: { email: USER, password: PASS } });
  const token = login.token;

  const patients = await api(`/api/patients?q=${encodeURIComponent('José Carlos')}&limit=20`, { token });
  const jose = (patients.patients || []).find((p) => /jos[eé]\s+carlos\s+pereira/i.test(p.full_name || ''));
  if (!jose) throw new Error('José Carlos Pereira not found');
  console.log(`▸ Patient ${jose.full_name} (${jose.id}) DOB=${jose.birth_date} phone=${jose.phone}`);

  await api(`/api/clinical/body/${jose.id}/consents`, {
    method: 'POST',
    token,
    body: { purposes: ['clinical_record', 'image_processing', 'generative_ai'] },
  });
  console.log('▸ Consents OK');

  const session = await api(`/api/clinical/body/${jose.id}/capture-sessions`, {
    method: 'POST', token, body: {},
  });
  console.log(`▸ Capture session ${session.id || session.session?.id}`);
  const sessionId = session.id || session.session?.id;

  for (const view of VIEWS) {
    const up = await api(`/api/clinical/body/capture-sessions/${sessionId}/assets`, {
      method: 'POST',
      token,
      body: { view, content_type: 'image/jpeg', data_base64: jpgB64(view) },
    });
    console.log(`  ✓ ${view} asset=${up.asset?.id || up.id || 'ok'}`);
  }

  const validated = await api(`/api/clinical/body/capture-sessions/${sessionId}/validate`, {
    method: 'POST',
    token,
    body: { idempotency_key: `jose-body-${Date.now()}` },
  });
  console.log(`▸ Validated status=${validated.status || validated.session?.status || 'ok'}`);

  const measurement = await api(`/api/clinical/body/${jose.id}/measurements`, {
    method: 'POST',
    token,
    body: {
      height_cm: 178,
      weight_kg: 98.5,
      waist_cm: 108,
      hip_cm: 112,
      neck_cm: 42,
      chest_cm: 112,
      abdomen_cm: 110,
      body_fat_pct: 28,
      muscle_mass_kg: 62,
      notes: 'Teste automatizado composição corporal — José Carlos (4 vistas)',
      clothing_note: 'camiseta preta + calça bege',
      posture_note: 'em pé, vista clínica',
      fasting_state: 'unknown',
      verified: true,
    },
  });
  const m = measurement.measurement || measurement;
  console.log(`▸ Measurement BMI=${m.bmi} WHtR=${m.whtr}`);

  for (const plan of [
    {
      title: 'Déficit calórico José',
      description: 'Plano nutricional — proteína elevada, déficit moderado',
      summary: 'Proteína elevada · déficit ~500 kcal',
      plan_type: 'nutrition',
      weeks: 12,
      daily_calories: 2000,
      deficit_kcal: 500,
      protein_g: 150,
    },
    {
      title: 'Treino força + caminhada',
      description: 'Resistência 3×/semana + cardio leve',
      summary: 'Força 3× · cardio 2×',
      plan_type: 'exercise',
      weeks: 12,
      params: {
        resistance_days_per_week: 3,
        cardio_days_per_week: 2,
        training_style: 'hypertrophy',
      },
    },
  ]) {
    try {
      await api(`/api/clinical/body/${jose.id}/plans`, { method: 'POST', token, body: plan });
      console.log(`▸ Plan: ${plan.title}`);
    } catch (e) {
      console.warn(`▸ Plan skipped (${plan.title}):`, e.message, e.body || '');
    }
  }

  const step = await api('/api/auth/step-up', {
    method: 'POST', token, body: { password: PASS },
  });
  const stepUp = step.step_up_token;
  console.log('▸ Step-up OK');

  const scenario = await api(`/api/clinical/body/${jose.id}/scenarios`, {
    method: 'POST',
    token,
    headers: { 'x-step-up': stepUp },
    body: {
      title: 'Cenário 12 semanas — composição José',
      goal: 'Redução de adiposidade abdominal com preservação muscular (ilustrativo)',
      weeks: 12,
      horizon_weeks: 12,
      capture_session_id: sessionId,
      generate: true,
      photorealism: true,
      change_magnitude: 'moderate',
      sleep_adequate: true,
      hydration_adequate: true,
      recovery_adequate: true,
      comorbidity_stable: true,
    },
  });
  const sid = scenario.id || scenario.scenario?.id;
  console.log(`▸ Scenario ${sid} status=${scenario.status || scenario.scenario?.status}`);

  let final = scenario.scenario || scenario;
  for (let i = 0; i < 36 && sid; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const polled = await api(`/api/clinical/body/${jose.id}/scenarios/${sid}`, { token });
    final = polled.scenario || polled;
    const st = final.status;
    console.log(`  … poll ${i + 1}: ${st}`);
    if (st && !['generating', 'queued', 'pending'].includes(st)) break;
  }

  let report = null;
  try {
    report = await api(`/api/clinical/body/${jose.id}/clinical-reports`, {
      method: 'POST',
      token,
      body: {
        signature_name: 'Dra. Juliana — Clínica Tanah',
        next_follow_up_date: '2026-10-15',
        title: 'Relatório composição corporal — José Carlos Pereira',
        include: {
          images: true,
          captures: true,
          scenarios: true,
          measurements: true,
          lifestyle: true,
          consents: true,
          demographics: true,
        },
      },
    });
    console.log(`▸ Clinical report ${report.id} images=${JSON.stringify(report.image_policy)}`);
  } catch (e) {
    console.warn('▸ Report skipped:', e.message, e.body || '');
  }

  const overview = await api(`/api/clinical/body/${jose.id}`, { token });
  const active = overview.active_capture_session;
  const assetCount = active ? Object.keys(active.assets || {}).length : (overview.counts?.captures || 0);
  const deltas = final.execution_plan?.deltas || final.deltas;
  console.log('———');
  console.log(JSON.stringify({
    patient: jose.full_name,
    patient_id: jose.id,
    session_id: sessionId,
    assets: assetCount,
    measurements: overview.counts?.measurements ?? overview.clinical_summary ? 1 : 0,
    plans: overview.counts?.plans,
    scenarios: overview.counts?.scenarios,
    simulations_allowed: overview.simulations_allowed,
    latest_bmi: overview.clinical_summary?.bmi ?? overview.latest_measurement?.bmi,
    scenario_id: sid,
    scenario_status: final.status,
    has_image: !!(final.has_image),
    deltas,
    report_id: report?.id || null,
    document_id: report?.document_id || null,
    ui: `${BASE}/patients/${jose.id}`,
  }, null, 2));
  console.log('✅ José Carlos body composition run complete');
}

main().catch((e) => {
  console.error('✗', e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
