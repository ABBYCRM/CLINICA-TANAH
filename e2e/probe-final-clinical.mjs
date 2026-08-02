/** Final FE-accurate clinical + invoice path after fixing probe payloads. */
import fs from 'node:fs';
const BASE = 'https://clinica-tanah-bbqu7.ondigitalocean.app';
const out = { results: [], fails: [] };
async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  const data = await res.json().catch(() => ({}));
  return { method, path, status: res.status, data };
}
function ok(r) { return r.status >= 200 && r.status < 300; }
function log(label, r, expectOk = true) {
  const entry = { label, status: r.status, ok: expectOk ? ok(r) : true, path: r.path, snippet: JSON.stringify(r.data).slice(0, 220) };
  out.results.push(entry);
  if (expectOk && !ok(r)) out.fails.push(entry);
  console.log((expectOk ? ok(r) : true) ? '✓' : '✗', r.status, label);
  return r;
}
function arr(d) {
  if (Array.isArray(d)) return d;
  if (!d) return [];
  for (const k of Object.keys(d)) if (Array.isArray(d[k])) return d[k];
  return [];
}

const login = await req('POST', '/api/auth/login', { email: 'Juliana', password: '1234' });
const token = login.data.token;
const me = login.data.user;
const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);

const patient = log('patient+lgpd', await req('POST', '/api/patients', {
  full_name: `Audit Final ${stamp}`,
  birth_date: '1988-03-22',
  phone: `+5511966${String(stamp).slice(-6)}`,
  email: `final.${stamp}@example.com`,
  gender: 'F',
  lgpd_consent_granted: true,
  lgpd_policy_version: '1.0',
}, token));
const patientId = patient.data?.id;

const scheduled = `${today} 17:00:00`;
const appt = log('appointment', await req('POST', '/api/appointments', {
  patient_id: patientId, practitioner_id: me.id, scheduled_at: scheduled,
  duration_minutes: 30, type: 'consultation', status: 'scheduled',
}, token));
const apptId = appt.data?.id;

const enc = log('encounter', await req('POST', '/api/clinical/encounters', {
  patient_id: patientId, practitioner_id: me.id, appointment_id: apptId || null,
  started_at: scheduled, chief_complaint: 'Audit final', assessment: 'ok', plan: 'retorno',
  icd10_codes: ['Z00.0'],
}, token));
const encId = enc.data?.id;

const rx = log('prescription', await req('POST', '/api/clinical/prescriptions', {
  encounter_id: encId, patient_id: patientId, practitioner_id: me.id,
  items: [{ medication: 'Dipirona', dosage: '500mg', frequency: '6/6h', duration: '2d' }],
}, token));
const rxId = rx.data?.id;

log('rx cancel', await req('POST', `/api/clinical/prescriptions/${rxId}/cancel`, { reason: 'audit' }, token));
log('rx restore', await req('POST', `/api/clinical/prescriptions/${rxId}/restore`, {}, token));
log('enc cancel', await req('POST', `/api/clinical/encounters/${encId}/cancel`, { reason: 'audit' }, token));
log('enc restore', await req('POST', `/api/clinical/encounters/${encId}/restore`, {}, token));

const inv = log('invoice issued', await req('POST', '/api/accounting/invoices', {
  patient_id: patientId, issue_date: today, due_date: today, status: 'issued', total: 200,
  lines: [{ description: 'Consulta', quantity: 1, unit_price: 200, tax_rate: 0 }],
}, token));
if (inv.data?.id) log('mark paid', await req('PUT', `/api/accounting/invoices/${inv.data.id}/mark-paid`, {}, token));

log('body plan', await req('POST', `/api/clinical/body/${patientId}/plans`, {
  title: 'Dieta audit', summary: 'test', plan_type: 'nutrition',
}, token));

log('lgpd request', await req('POST', '/api/lgpd/data-requests', {
  request_type: 'access', subject_type: 'patient', subject_id: patientId, notes: 'audit',
}, token));

// Prove retention lists
const encCancelled = log('list enc cancelled after cancel+restore (should be active)', await req('GET', '/api/clinical/encounters?status=active', undefined, token));
const rxActive = log('list rx active', await req('GET', '/api/clinical/prescriptions?status=active', undefined, token));

// Soft cancel again and verify in cancelled tab
log('enc soft DELETE', await req('DELETE', `/api/clinical/encounters/${encId}`, undefined, token));
log('rx soft DELETE', await req('DELETE', `/api/clinical/prescriptions/${rxId}`, undefined, token));
const encC = await req('GET', '/api/clinical/encounters?status=cancelled', undefined, token);
const rxC = await req('GET', '/api/clinical/prescriptions?status=cancelled', undefined, token);
const encIn = arr(encC.data).some(e => e.id === encId) || (encC.data?.encounters || []).some?.(e => e.id === encId);
const rxIn = arr(rxC.data).some(e => e.id === rxId) || (rxC.data?.prescriptions || []).some?.(e => e.id === rxId);
console.log('enc in cancelled list?', encIn, 'rx in cancelled list?', rxIn);
if (!encIn) out.fails.push({ label: 'encounter not in cancelled list', data: encC.data });
if (!rxIn) out.fails.push({ label: 'rx not in cancelled list', data: rxC.data });

// Patient delete blocked
const delP = await req('DELETE', `/api/patients/${patientId}`, undefined, token);
log('patient delete blocked', delP, false);
if (delP.status !== 409) out.fails.push({ label: 'patient delete should 409', status: delP.status, data: delP.data });

// Bundle string proof
const html = await fetch(BASE + '/').then(r => r.text());
const jsMatch = html.match(/assets\/index-[^"]+\.js/);
let bundleHas = {};
if (jsMatch) {
  const js = await fetch(BASE + '/' + jsMatch[0]).then(r => r.text());
  bundleHas = {
    vigentes: js.includes('Vigentes'),
    canceladas_retencao: js.includes('Canceladas (reten') || js.includes('Canceladas (retenção)'),
    anulados_retencao: js.includes('Anulados (reten') || js.includes('Anulados (retenção)'),
    restore_enc: /encounters\.restore|restaurar|Restore/i.test(js),
  };
  console.log('bundle strings', bundleHas, 'asset', jsMatch[0]);
}
out.bundle = bundleHas;

// Deploy health
const health = await req('GET', '/api/health', undefined, null);
out.health = health.data;

out.summary = { total: out.results.length, ok: out.results.filter(r => r.ok).length, fails: out.fails.length };
fs.writeFileSync('/opt/cursor/artifacts/live-final-clinical.json', JSON.stringify(out, null, 2));
console.log('SUMMARY', out.summary);
if (out.fails.length) { console.log(out.fails); process.exit(2); }
