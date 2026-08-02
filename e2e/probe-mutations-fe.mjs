/**
 * Mutation probe using EXACT payloads the frontend sends (from FE form code).
 * Distinguishes real product bugs from bad probe payloads.
 */
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'https://clinica-tanah-bbqu7.ondigitalocean.app';
const out = { started_at: new Date().toISOString(), results: [], fails: [], notes: [] };

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 400) }; }
  return { method, path, status: res.status, data };
}
function ok(r) { return r.status >= 200 && r.status < 300; }
function log(label, r, expectOk = true) {
  const entry = { label, method: r.method, path: r.path, status: r.status, ok: expectOk ? ok(r) : true, data: r.data };
  out.results.push(entry);
  if (expectOk && !ok(r)) out.fails.push(entry);
  console.log(ok(r) || !expectOk ? '✓' : '✗', r.status, label, JSON.stringify(r.data)?.slice(0, 180));
  return r;
}
function arr(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of Object.keys(data)) if (Array.isArray(data[k])) return data[k];
  return [];
}

// Valid CPF algorithm
function makeCpf() {
  const n = [];
  for (let i = 0; i < 9; i++) n.push(Math.floor(Math.random() * 9));
  const dig = (base) => {
    let s = 0; for (let i = 0; i < base.length; i++) s += base[i] * (base.length + 1 - i);
    const r = (s * 10) % 11; return r === 10 ? 0 : r;
  };
  n.push(dig(n)); n.push(dig(n));
  return n.join('');
}

const login = await req('POST', '/api/auth/login', { email: 'Juliana', password: '1234' });
if (!ok(login)) { console.error('login fail'); process.exit(1); }
const token = login.data.token;
const me = login.data.user;
const today = new Date().toISOString().slice(0, 10);
const stamp = Date.now();

// --- Patient (FE PatientForm requires birth_date) ---
const patient = log('create patient', await req('POST', '/api/patients', {
  full_name: `Audit Paciente ${stamp}`,
  birth_date: '1990-05-15',
  phone: `+5511988${String(stamp).slice(-6)}`,
  email: `audit.${stamp}@example.com`,
  gender: 'F',
}, token));
const patientId = patient.data?.id;

// --- Appointment (FE uses scheduled_at not starts_at) ---
let apptId = null;
if (patientId) {
  const scheduled = `${today} 16:30:00`;
  const appt = log('create appointment', await req('POST', '/api/appointments', {
    patient_id: patientId,
    practitioner_id: me.id,
    scheduled_at: scheduled,
    duration_minutes: 30,
    type: 'consultation',
    status: 'scheduled',
    notes: 'audit',
  }, token));
  apptId = appt.data?.id;
  if (apptId) {
    log('update appointment', await req('PUT', `/api/appointments/${apptId}`, { status: 'confirmed' }, token));
  }
}

// --- Encounter (FE requires patient_id, practitioner_id, started_at) ---
let encId = null;
if (patientId) {
  const enc = log('create encounter', await req('POST', '/api/clinical/encounters', {
    patient_id: patientId,
    practitioner_id: me.id,
    appointment_id: apptId || null,
    started_at: `${today} 16:30:00`,
    chief_complaint: 'Dor de cabeça — audit',
    assessment: 'Cefaleia tensional',
    plan: 'Repouso',
    icd10_codes: ['R51'],
  }, token));
  encId = enc.data?.id;
  if (encId) {
    log('cancel encounter', await req('POST', `/api/clinical/encounters/${encId}/cancel`, { reason: 'audit void' }, token));
    log('restore encounter', await req('POST', `/api/clinical/encounters/${encId}/restore`, {}, token));
  }
}

// --- Prescription (FE requires encounter_id + practitioner_id) ---
let rxId = null;
if (encId && patientId) {
  const rx = log('create prescription', await req('POST', '/api/clinical/prescriptions', {
    encounter_id: encId,
    patient_id: patientId,
    practitioner_id: me.id,
    items: [{ medication: 'Paracetamol', dosage: '500mg', frequency: '8/8h', duration: '3 dias', instructions: 'após refeição' }],
  }, token));
  rxId = rx.data?.id;
  if (rxId) {
    log('cancel rx', await req('POST', `/api/clinical/prescriptions/${rxId}/cancel`, { reason: 'audit' }, token));
    log('restore rx', await req('POST', `/api/clinical/prescriptions/${rxId}/restore`, {}, token));
    log('soft-delete rx via DELETE', await req('DELETE', `/api/clinical/prescriptions/${rxId}`, undefined, token));
  }
}

// Soft-delete encounter after rx cancelled
if (encId) {
  log('soft-delete encounter via DELETE', await req('DELETE', `/api/clinical/encounters/${encId}`, undefined, token));
}

// Patient with clinical → DELETE must 409 has_clinical_records (expected)
if (patientId) {
  const d = await req('DELETE', `/api/patients/${patientId}`, undefined, token);
  log('delete patient with clinical (expect 409)', d, false);
  if (d.status !== 409 || d.data?.error !== 'has_clinical_records') {
    out.fails.push({ label: 'patient clinical retention gate wrong', status: d.status, data: d.data });
    console.log('✗ unexpected patient delete response', d.status, d.data);
  } else {
    console.log('✓ 409 patient clinical retention gate OK');
  }
}

// --- Vendor (legal_name) ---
const vendor = log('create vendor', await req('POST', '/api/inventory/vendors', {
  legal_name: `Fornecedor Audit ${stamp}`,
  trade_name: 'Audit Trade',
  cnpj: String(stamp).slice(-14).padStart(14, '1'),
  email: `vendor.${stamp}@example.com`,
  phone: '+551133334444',
}, token));

// --- Inventory item ---
const item = log('create inventory item', await req('POST', '/api/inventory/items', {
  sku: `AUD-${stamp}`,
  name: `Item Audit ${stamp}`,
  category: 'supply',
  unit: 'un',
  reorder_level: 5,
  min_stock: 2,
}, token));

// --- DRE line ---
const dre = log('create DRE line', await req('POST', '/api/accounting/income-statement/lines', {
  type: 'expense',
  name: `Despesa audit ${stamp}`,
  amount: 99.9,
}, token));
if (dre.data?.id) {
  log('delete DRE line', await req('DELETE', `/api/accounting/income-statement/lines/${dre.data.id}`, undefined, token));
}

// --- Invoice ---
const inv = log('create invoice', await req('POST', '/api/accounting/invoices', {
  patient_id: patientId,
  issue_date: today,
  due_date: today,
  status: 'pending',
  total: 150,
  lines: [{ description: 'Consulta audit', quantity: 1, unit_price: 150, tax_rate: 0 }],
}, token));
if (inv.data?.id) {
  log('mark invoice paid', await req('PUT', `/api/accounting/invoices/${inv.data.id}/mark-paid`, {}, token));
}

// --- Apps ---
const app = log('create app', await req('POST', '/api/apps', {
  label: `App Audit ${stamp}`,
  url: 'https://example.com/audit',
}, token));
const appId = app.data?.id || app.data?.app?.id;
out.notes.push({ apps_response_keys: app.data && Object.keys(app.data), appId });
if (appId) {
  log('delete app', await req('DELETE', `/api/apps/${appId}`, undefined, token));
} else {
  // list and find
  const list = await req('GET', '/api/apps', undefined, token);
  const found = arr(list.data).find(a => a.label?.includes(String(stamp)));
  if (found) {
    log('delete app (via list)', await req('DELETE', `/api/apps/${found.id}`, undefined, token));
  } else {
    out.fails.push({ label: 'apps create returned no id and not in list', data: { create: app.data, list: list.data } });
  }
}

// --- Tokens ---
const tok = log('create token', await req('POST', '/api/tokens', { name: `audit-${stamp}`, expires_in_days: 1 }, token));
const tokId = tok.data?.id;
if (tokId) log('revoke token', await req('DELETE', `/api/tokens/${tokId}`, undefined, token));

// --- LGPD ---
if (patientId) {
  log('lgpd data request', await req('POST', '/api/lgpd/data-requests', {
    request_type: 'access',
    subject_type: 'patient',
    subject_id: patientId,
    notes: 'audit access request',
  }, token));
}

// --- WhatsApp simulate + campaign ---
log('wa simulate', await req('POST', '/api/whatsapp/simulate', {
  phone: `+5511977${String(stamp).slice(-6)}`,
  body: 'Olá, quero agendar uma consulta',
  locale: 'pt-BR',
}, token));
const camp = log('wa campaign', await req('POST', '/api/whatsapp/campaigns', {
  name: `Campanha Audit ${stamp}`,
  message: 'Olá {{name}}! Semana do Cliente na Clínica Tanah.',
  audience: 'all',
  category: 'marketing',
}, token));
if (camp.data?.id) log('delete campaign', await req('DELETE', `/api/whatsapp/campaigns/${camp.data.id}`, undefined, token));

// --- Payroll employee ---
const emp = log('create employee', await req('POST', '/api/payroll/employees', {
  full_name: `Funcionário Audit ${stamp}`,
  cpf: makeCpf(),
  role: 'Recepcionista',
  admission_date: today,
  base_salary: 2500,
  weekly_hours: 44,
  dependents: 0,
  health_insurance_discount: 0,
  other_discounts: 0,
  vale_transporte: false,
  vt_monthly_cost: 0,
  night_shift: false,
  esocial_category: '101',
  contract_type: 'clt',
}, token));

// --- Body plan ---
if (patientId) {
  log('body lifestyle plan', await req('POST', `/api/clinical/body/${patientId}/plans`, {
    title: 'Plano audit nutrição',
    summary: '1800 kcal',
    description: '1800 kcal',
    plan_type: 'nutrition',
  }, token));
  log('body consent', await req('POST', `/api/clinical/body/${patientId}/consents`, {
    purposes: ['clinical_record', 'image_processing'],
  }, token));
}

// --- Team user ---
const cpf = makeCpf();
const user = log('create team user', await req('POST', '/api/users', {
  email: `audit.user.${stamp}@clinica.test`,
  full_name: 'Audit Recepcionista',
  password: 'Audit1234!',
  role: 'receptionist',
  cpf,
}, token));
if (user.data?.id) {
  log('deactivate user', await req('DELETE', `/api/users/${user.data.id}`, undefined, token));
}

// --- Public forms ---
const forms = await req('GET', '/api/forms', undefined, token);
const form0 = arr(forms.data)[0];
if (form0?.slug || form0?.public_slug) {
  const slug = form0.slug || form0.public_slug;
  const pub = await req('GET', `/api/public/forms/${slug}`, undefined, null);
  log('public form get', pub);
}

// Cleanup appointment if still exists
if (apptId) {
  log('delete appointment', await req('DELETE', `/api/appointments/${apptId}`, undefined, token));
}

out.finished_at = new Date().toISOString();
out.summary = {
  total: out.results.length,
  ok: out.results.filter(r => r.ok).length,
  fails: out.fails.length,
};
fs.writeFileSync('/opt/cursor/artifacts/live-mutations-fe-shaped.json', JSON.stringify(out, null, 2));
console.log('\nSUMMARY', out.summary);
if (out.fails.length) {
  console.log('FAILS:');
  for (const f of out.fails) console.log('-', f.label, f.status, JSON.stringify(f.data)?.slice(0, 200));
}
process.exit(out.fails.length ? 2 : 0);
