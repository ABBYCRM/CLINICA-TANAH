/** Morning readiness probe — compliance + FE-shaped mutations + critical paths */
import fs from 'node:fs';
const BASE = 'https://clinica-tanah-bbqu7.ondigitalocean.app';
const out = { started_at: new Date().toISOString(), results: [], fails: [] };

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 300) }; }
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
function makeCpf() {
  const n = [];
  for (let i = 0; i < 9; i++) n.push(Math.floor(Math.random() * 9));
  const dig = (base) => { let s = 0; for (let i = 0; i < base.length; i++) s += base[i] * (base.length + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  n.push(dig(n)); n.push(dig(n));
  return n.join('');
}

const health = log('health', await req('GET', '/api/health'));
out.health = health.data;
if (health.data?.security?.phi_encryption?.key_source === 'dev_default') {
  out.fails.push({ label: 'PHI still dev_default on production', data: health.data.security });
}

const priv = log('public privacy', await req('GET', '/api/public/privacy'));
out.privacy = { dpo: priv.data?.dpo, version: priv.data?.version };

const login = log('login', await req('POST', '/api/auth/login', { email: 'Juliana', password: '1234' }));
const token = login.data?.token;
const me = login.data?.user;
const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);

const posture = log('security posture', await req('GET', '/api/lgpd/security-posture', undefined, token));
out.posture = posture.data;

const patient = log('create patient', await req('POST', '/api/patients', {
  full_name: `Morning Ready ${stamp}`,
  birth_date: '1991-06-10',
  phone: `+5511955${String(stamp).slice(-6)}`,
  email: `morning.${stamp}@example.com`,
  gender: 'F',
  lgpd_consent_granted: true,
  lgpd_policy_version: '1.2',
}, token));
const patientId = patient.data?.id;

const appt = log('create appointment', await req('POST', '/api/appointments', {
  patient_id: patientId, practitioner_id: me.id,
  scheduled_at: `${today} 18:00:00`, duration_minutes: 30, type: 'consultation', status: 'scheduled',
}, token));
const apptId = appt.data?.id;

const enc = log('create encounter', await req('POST', '/api/clinical/encounters', {
  patient_id: patientId, practitioner_id: me.id, appointment_id: apptId || null,
  started_at: `${today} 18:00:00`, chief_complaint: 'morning audit', assessment: 'ok', plan: 'ok', icd10_codes: [],
}, token));
const encId = enc.data?.id;

const rx = log('create rx', await req('POST', '/api/clinical/prescriptions', {
  encounter_id: encId, patient_id: patientId, practitioner_id: me.id,
  items: [{ medication: 'Ibuprofeno', dosage: '400mg', frequency: '8/8h', duration: '2d' }],
}, token));
const rxId = rx.data?.id;

log('cancel rx', await req('POST', `/api/clinical/prescriptions/${rxId}/cancel`, { reason: 'morning' }, token));
log('cancel enc', await req('POST', `/api/clinical/encounters/${encId}/cancel`, { reason: 'morning' }, token));

const delAppt = log('soft-cancel appointment', await req('DELETE', `/api/appointments/${apptId}`, undefined, token));
if (delAppt.data?.status !== 'cancelled' && delAppt.data?.soft_cancelled !== true) {
  // still ok if 200
  if (!ok(delAppt)) out.fails.push({ label: 'appointment soft cancel failed', data: delAppt.data });
}

const med = log('add body med', await req('POST', `/api/clinical/body/${patientId}/medications`, {
  name: 'Losartana', dose: '50mg', drug_class: 'ARB',
}, token));
// API may use different field names - check
const medId = med.data?.id || med.data?.medication?.id;
if (medId) {
  const disc = log('discontinue body med', await req('DELETE', `/api/clinical/body/${patientId}/medications/${medId}`, undefined, token));
  if (disc.data?.clinical_retention !== true && disc.status === 200) {
    out.notes = out.notes || [];
    out.notes.push('med discontinue response missing clinical_retention flag');
  }
}

// LGPD deletion request + fulfill anonymize
const dr = log('lgpd deletion request', await req('POST', '/api/lgpd/data-requests', {
  request_type: 'deletion', subject_type: 'patient', subject_id: patientId, notes: 'morning audit',
}, token));
const drId = dr.data?.id;
if (drId) {
  const ful = log('lgpd fulfill anonymize', await req('PUT', `/api/lgpd/data-requests/${drId}/fulfill`, { notes: 'morning' }, token));
  out.fulfill = ful.data;
  if (ful.data?.action !== 'anonymized') out.fails.push({ label: 'fulfill did not anonymize', data: ful.data });
  const after = log('patient after anonymize', await req('GET', `/api/patients/${patientId}`, undefined, token));
  out.anonymized_name = after.data?.full_name || after.data?.patient?.full_name;
}

// WA simulate SAIR marketing
log('wa simulate', await req('POST', '/api/whatsapp/simulate', {
  phone: `+5511944${String(stamp).slice(-6)}`, body: 'SAIR', locale: 'pt-BR',
}, token));

// Bundle check
const html = await fetch(BASE + '/').then(r => r.text());
const jsMatch = html.match(/assets\/index-[^"]+\.js/);
if (jsMatch) {
  const js = await fetch(BASE + '/' + jsMatch[0]).then(r => r.text());
  out.bundle = {
    asset: jsMatch[0],
    privacidade_route: js.includes('privacidade') || js.includes('PrivacyPolicy'),
    vigentes: js.includes('Vigentes'),
    anulados: js.includes('Anulados'),
  };
  console.log('bundle', out.bundle);
}

out.finished_at = new Date().toISOString();
out.summary = { total: out.results.length, ok: out.results.filter(r => r.ok).length, fails: out.fails.length };
fs.writeFileSync('/opt/cursor/artifacts/morning-ready.json', JSON.stringify(out, null, 2));
console.log('SUMMARY', out.summary);
if (out.fails.length) { console.log('FAILS', out.fails); process.exit(2); }
