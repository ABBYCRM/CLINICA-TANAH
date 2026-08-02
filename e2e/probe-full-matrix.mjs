/**
 * Exhaustive live API probe — Clínica Tanah production
 * Proof artifact for code↔runtime audit. No guesses: every call logged.
 */
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'https://clinica-tanah-bbqu7.ondigitalocean.app';
const out = { started_at: new Date().toISOString(), base: BASE, login: null, gets: [], mutations: [], fails: [], notes: [] };

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const t0 = Date.now();
  let status = 0, data = null, text = '';
  try {
    const res = await fetch(`${BASE}${path}`, init);
    status = res.status;
    text = await res.text();
    try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 500) }; }
  } catch (e) {
    status = -1;
    data = { error: String(e) };
  }
  return { method, path, status, ms: Date.now() - t0, data };
}

function ok(r) { return r.status >= 200 && r.status < 300; }
function record(list, r, expectOk = true) {
  const entry = {
    method: r.method,
    path: r.path,
    status: r.status,
    ms: r.ms,
    ok: expectOk ? ok(r) : true,
    expectOk,
    keys: r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? Object.keys(r.data).slice(0, 20) : Array.isArray(r.data) ? [`array:${r.data.length}`] : typeof r.data,
    snippet: JSON.stringify(r.data)?.slice(0, 280),
  };
  list.push(entry);
  if (expectOk && !ok(r)) out.fails.push(entry);
  return r;
}

// --- LOGIN ---
const login = await req('POST', '/api/auth/login', { email: 'Juliana', password: '1234' });
out.login = { status: login.status, keys: login.data && Object.keys(login.data), role: login.data?.user?.role, is_superadmin: login.data?.user?.is_superadmin };
if (!ok(login) || !login.data?.token) {
  fs.writeFileSync('/opt/cursor/artifacts/live-full-matrix.json', JSON.stringify(out, null, 2));
  console.error('LOGIN FAILED', login.status, login.data);
  process.exit(1);
}
const token = login.data.token;
const user = login.data.user;
console.log('LOGIN OK', user?.role, 'superadmin=', user?.is_superadmin);

// Helper pickers from list responses
function arr(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of ['items', 'patients', 'data', 'results', 'encounters', 'prescriptions', 'invoices', 'employees', 'runs', 'conversations', 'templates', 'campaigns', 'forms', 'apps', 'tokens', 'users', 'tenants', 'vendors', 'batches', 'movements', 'consents', 'requests', 'lines', 'accounts', 'entries']) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

// --- GET MATRIX ---
const today = new Date().toISOString().slice(0, 10);
const monthStart = today.slice(0, 8) + '01';
const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);
const monthEnd = nextMonth.toISOString().slice(0, 10);

const getPaths = [
  '/api/health',
  '/api/auth/me',
  '/api/dashboard',
  '/api/patients?limit=20&offset=0',
  '/api/patients?view=all&limit=5',
  '/api/appointments?from=' + monthStart + '&to=' + monthEnd,
  '/api/clinical/encounters?status=active',
  '/api/clinical/encounters?status=cancelled',
  '/api/clinical/prescriptions?status=active',
  '/api/clinical/prescriptions?status=cancelled',
  '/api/inventory/items',
  '/api/inventory/batches',
  '/api/inventory/movements',
  '/api/inventory/alerts',
  '/api/inventory/vendors',
  '/api/accounting/chart',
  '/api/accounting/journal',
  '/api/accounting/trial-balance',
  '/api/accounting/income-statement',
  '/api/accounting/invoices?limit=20',
  '/api/payroll/employees',
  '/api/payroll/runs',
  '/api/payroll/meta',
  '/api/whatsapp/status',
  '/api/whatsapp/ping',
  '/api/whatsapp/conversations',
  '/api/whatsapp/templates',
  '/api/whatsapp/campaigns',
  '/api/whatsapp/automations',
  '/api/whatsapp/surveys',
  '/api/whatsapp/analytics',
  '/api/whatsapp/audience?segment=all',
  '/api/forms',
  '/api/lgpd/consents',
  '/api/lgpd/data-requests',
  '/api/lgpd/policy',
  '/api/lgpd/audit',
  '/api/lgpd/security-posture',
  '/api/users',
  '/api/users/directory',
  '/api/tokens',
  '/api/tenants',
  '/api/apps',
];

for (const p of getPaths) {
  const r = await req('GET', p, undefined, token);
  record(out.gets, r);
  console.log(ok(r) ? '✓' : '✗', r.status, 'GET', p);
}

// Patient detail GETs
const patientsList = out.gets.find(g => g.path.startsWith('/api/patients?limit'));
let patientId = null;
{
  const r = await req('GET', '/api/patients?limit=5', undefined, token);
  const list = arr(r.data);
  patientId = list[0]?.id || r.data?.patients?.[0]?.id;
  if (!patientId && Array.isArray(r.data)) patientId = r.data[0]?.id;
}
if (!patientId) {
  // create one for testing
  const created = await req('POST', '/api/patients', {
    full_name: 'AUDIT Probe Patient ' + Date.now(),
    phone: '+5511999' + String(Date.now()).slice(-6),
    email: `audit.${Date.now()}@example.com`,
  }, token);
  record(out.mutations, created);
  patientId = created.data?.id || created.data?.patient?.id;
}
out.notes.push({ patientId });

if (patientId) {
  for (const p of [
    `/api/patients/${patientId}`,
    `/api/patients/${patientId}/summary`,
    `/api/patients/${patientId}/record`,
    `/api/clinical/body/${patientId}`,
  ]) {
    const r = await req('GET', p, undefined, token);
    record(out.gets, r);
    console.log(ok(r) ? '✓' : '✗', r.status, 'GET', p);
  }
  // timeline events if any
  const rec = await req('GET', `/api/patients/${patientId}/record`, undefined, token);
  const events = rec.data?.timeline || rec.data?.events || [];
  if (Array.isArray(events) && events[0]?.id) {
    const r = await req('GET', `/api/patients/${patientId}/timeline/${events[0].id}`, undefined, token);
    record(out.gets, r);
    console.log(ok(r) ? '✓' : '✗', r.status, 'GET timeline', events[0].id);
  }
}

// Forms submissions
{
  const forms = await req('GET', '/api/forms', undefined, token);
  const fl = arr(forms.data);
  if (fl[0]?.id) {
    const r = await req('GET', `/api/forms/${fl[0].id}/submissions`, undefined, token);
    record(out.gets, r);
    console.log(ok(r) ? '✓' : '✗', r.status, 'GET forms submissions');
  }
}

// Payroll run detail
{
  const runs = await req('GET', '/api/payroll/runs', undefined, token);
  const rl = arr(runs.data);
  if (rl[0]?.id) {
    const r = await req('GET', `/api/payroll/runs/${rl[0].id}`, undefined, token);
    record(out.gets, r);
    console.log(ok(r) ? '✓' : '✗', r.status, 'GET payroll run');
  }
}

// Availability (need practitioner)
{
  const dir = await req('GET', '/api/users/directory', undefined, token);
  const staff = arr(dir.data);
  const prac = staff.find(u => ['doctor', 'nurse', 'admin'].includes(u.role)) || staff[0] || user;
  if (prac?.id) {
    const r = await req('GET', `/api/appointments/availability?practitioner_id=${prac.id}&date=${today}`, undefined, token);
    record(out.gets, r);
    console.log(ok(r) ? '✓' : '✗', r.status, 'GET availability');
  }
}

// --- MUTATION MATRIX (create → use → cleanup soft where needed) ---
console.log('\n=== MUTATIONS ===');

// 1. Patient CRUD (create/update — no delete if clinical)
{
  const name = 'AUDIT Mut ' + Date.now();
  const c = await req('POST', '/api/patients', {
    full_name: name,
    phone: '+5511888' + String(Date.now()).slice(-6),
    email: `mut.${Date.now()}@example.com`,
  }, token);
  record(out.mutations, c);
  console.log(ok(c) ? '✓' : '✗', c.status, 'POST patients', c.data?.id || c.data?.error);
  const pid = c.data?.id || c.data?.patient?.id;
  if (pid) {
    const u = await req('PUT', `/api/patients/${pid}`, { notes: 'audit note' }, token);
    record(out.mutations, u);
    console.log(ok(u) ? '✓' : '✗', u.status, 'PUT patients notes');
    const lc = await req('PUT', `/api/patients/${pid}/lifecycle`, { lifecycle_stage: 'lead' }, token);
    record(out.mutations, lc);
    console.log(ok(lc) ? '✓' : '✗', lc.status, 'PUT lifecycle');
    const task = await req('POST', `/api/patients/${pid}/tasks`, { title: 'Audit task', category: 'follow_up' }, token);
    record(out.mutations, task);
    console.log(ok(task) ? '✓' : '✗', task.status, 'POST task');
    const ticket = await req('POST', `/api/patients/${pid}/tickets`, { subject: 'Audit ticket', priority: 'normal' }, token);
    record(out.mutations, ticket);
    console.log(ok(ticket) ? '✓' : '✗', ticket.status, 'POST ticket', ticket.data?.error || '');
    const doc = await req('POST', `/api/patients/${pid}/documents`, { title: 'Audit doc', doc_type: 'form', status: 'pending' }, token);
    record(out.mutations, doc);
    console.log(ok(doc) ? '✓' : '✗', doc.status, 'POST document');
    const cons = await req('PUT', `/api/patients/${pid}/consents`, { purpose: 'treatment', granted: true }, token);
    record(out.mutations, cons);
    console.log(ok(cons) ? '✓' : '✗', cons.status, 'PUT consents');
    // hard delete should succeed (no clinical yet)
    const d = await req('DELETE', `/api/patients/${pid}`, undefined, token);
    record(out.mutations, d);
    console.log(ok(d) ? '✓' : '✗', d.status, 'DELETE patient (no clinical)');
  }
}

// 2. Appointment create/update/delete
{
  const dir = await req('GET', '/api/users/directory', undefined, token);
  const staff = arr(dir.data);
  const prac = staff.find(u => u.role === 'doctor') || staff.find(u => u.role === 'admin') || { id: user.id };
  const plist = await req('GET', '/api/patients?limit=3', undefined, token);
  const p0 = arr(plist.data)[0];
  if (p0?.id && prac?.id) {
    const start = new Date(); start.setHours(start.getHours() + 3, 0, 0, 0);
    const end = new Date(start); end.setMinutes(end.getMinutes() + 30);
    const c = await req('POST', '/api/appointments', {
      patient_id: p0.id,
      practitioner_id: prac.id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      type: 'consultation',
      status: 'scheduled',
    }, token);
    record(out.mutations, c);
    console.log(ok(c) ? '✓' : '✗', c.status, 'POST appointment', c.data?.id || c.data?.error || c.data?.message);
    const aid = c.data?.id;
    if (aid) {
      const u = await req('PUT', `/api/appointments/${aid}`, { status: 'confirmed' }, token);
      record(out.mutations, u);
      console.log(ok(u) ? '✓' : '✗', u.status, 'PUT appointment confirmed');
      const d = await req('DELETE', `/api/appointments/${aid}`, undefined, token);
      record(out.mutations, d);
      console.log(ok(d) ? '✓' : '✗', d.status, 'DELETE appointment');
    }
  }
}

// 3. Encounter create / cancel / restore
{
  const plist = await req('GET', '/api/patients?limit=3', undefined, token);
  const p0 = arr(plist.data)[0];
  if (p0?.id) {
    const c = await req('POST', '/api/clinical/encounters', {
      patient_id: p0.id,
      chief_complaint: 'Audit encounter',
      assessment: 'ok',
      plan: 'follow-up',
    }, token);
    record(out.mutations, c);
    console.log(ok(c) ? '✓' : '✗', c.status, 'POST encounter', c.data?.id || c.data?.error || c.data?.message);
    const eid = c.data?.id;
    if (eid) {
      const cancel = await req('POST', `/api/clinical/encounters/${eid}/cancel`, { reason: 'audit' }, token);
      record(out.mutations, cancel);
      console.log(ok(cancel) ? '✓' : '✗', cancel.status, 'POST encounter cancel', cancel.data);
      const restore = await req('POST', `/api/clinical/encounters/${eid}/restore`, {}, token);
      record(out.mutations, restore);
      console.log(ok(restore) ? '✓' : '✗', restore.status, 'POST encounter restore');
      // DELETE should soft-cancel not 409 block
      const del = await req('DELETE', `/api/clinical/encounters/${eid}`, undefined, token);
      record(out.mutations, del);
      console.log(ok(del) ? '✓' : '✗', del.status, 'DELETE encounter (soft)', del.data);
    }
  }
}

// 4. Prescription create / cancel / restore
{
  const plist = await req('GET', '/api/patients?limit=3', undefined, token);
  const p0 = arr(plist.data)[0];
  if (p0?.id) {
    const c = await req('POST', '/api/clinical/prescriptions', {
      patient_id: p0.id,
      items: [{ medication: 'Paracetamol', dosage: '500mg', frequency: '8/8h', duration: '3d' }],
    }, token);
    record(out.mutations, c);
    console.log(ok(c) ? '✓' : '✗', c.status, 'POST prescription', c.data?.id || c.data?.error || c.data?.message);
    const rid = c.data?.id;
    if (rid) {
      const cancel = await req('POST', `/api/clinical/prescriptions/${rid}/cancel`, { reason: 'audit' }, token);
      record(out.mutations, cancel);
      console.log(ok(cancel) ? '✓' : '✗', cancel.status, 'POST rx cancel');
      const restore = await req('POST', `/api/clinical/prescriptions/${rid}/restore`, {}, token);
      record(out.mutations, restore);
      console.log(ok(restore) ? '✓' : '✗', restore.status, 'POST rx restore');
      const del = await req('DELETE', `/api/clinical/prescriptions/${rid}`, undefined, token);
      record(out.mutations, del);
      console.log(ok(del) ? '✓' : '✗', del.status, 'DELETE rx (soft)', del.data);
    }
  }
}

// 5. Inventory item + vendor
{
  const v = await req('POST', '/api/inventory/vendors', {
    name: 'Audit Vendor ' + Date.now(),
    cnpj: String(Date.now()).slice(-14).padStart(14, '1'),
  }, token);
  record(out.mutations, v);
  console.log(ok(v) ? '✓' : '✗', v.status, 'POST vendor', v.data?.id || v.data?.error);
  const item = await req('POST', '/api/inventory/items', {
    name: 'Audit Item ' + Date.now(),
    sku: 'AUD-' + Date.now(),
    unit: 'un',
    category: 'supplies',
    reorder_level: 1,
  }, token);
  record(out.mutations, item);
  console.log(ok(item) ? '✓' : '✗', item.status, 'POST inventory item', item.data?.id || item.data?.error || item.data?.message);
}

// 6. Accounting chart + DRE line + invoice
{
  const code = '9.9.' + String(Date.now()).slice(-4);
  const chart = await req('POST', '/api/accounting/chart', {
    code, name: 'Audit Account', type: 'expense',
  }, token);
  record(out.mutations, chart);
  console.log(ok(chart) ? '✓' : '✗', chart.status, 'POST chart', chart.data?.id || chart.data?.error);
  const dre = await req('POST', '/api/accounting/income-statement/lines', {
    label: 'Audit DRE ' + Date.now(),
    section: 'operating_expenses',
    amount: 10.5,
  }, token);
  record(out.mutations, dre);
  console.log(ok(dre) ? '✓' : '✗', dre.status, 'POST DRE line', dre.data?.id || dre.data?.error || dre.data?.message);
  if (dre.data?.id) {
    const dd = await req('DELETE', `/api/accounting/income-statement/lines/${dre.data.id}`, undefined, token);
    record(out.mutations, dd);
    console.log(ok(dd) ? '✓' : '✗', dd.status, 'DELETE DRE line');
  }
  const plist = await req('GET', '/api/patients?limit=1', undefined, token);
  const p0 = arr(plist.data)[0];
  if (p0?.id) {
    const inv = await req('POST', '/api/accounting/invoices', {
      patient_id: p0.id,
      invoice_number: 'AUD-' + Date.now(),
      issue_date: today,
      lines: [{ description: 'Consulta audit', quantity: 1, unit_price: 100, tax_rate: 0 }],
    }, token);
    record(out.mutations, inv);
    console.log(ok(inv) ? '✓' : '✗', inv.status, 'POST invoice', inv.data?.id || inv.data?.error || inv.data?.message);
    const iid = inv.data?.id;
    if (iid) {
      const paid = await req('PUT', `/api/accounting/invoices/${iid}/mark-paid`, {}, token);
      record(out.mutations, paid);
      console.log(ok(paid) ? '✓' : '✗', paid.status, 'PUT mark-paid');
    }
  }
}

// 7. Apps CRUD
{
  const a = await req('POST', '/api/apps', { label: 'Audit App ' + Date.now(), url: 'https://example.com' }, token);
  record(out.mutations, a);
  console.log(ok(a) ? '✓' : '✗', a.status, 'POST apps', a.data?.id || a.data?.error);
  if (a.data?.id) {
    const d = await req('DELETE', `/api/apps/${a.data.id}`, undefined, token);
    record(out.mutations, d);
    console.log(ok(d) ? '✓' : '✗', d.status, 'DELETE apps');
  }
}

// 8. Tokens
{
  const t = await req('POST', '/api/tokens', { name: 'audit-token-' + Date.now(), expires_days: 1 }, token);
  record(out.mutations, t);
  console.log(ok(t) ? '✓' : '✗', t.status, 'POST tokens', t.data?.id || t.data?.error || t.data?.message);
  const tid = t.data?.id || t.data?.token_id;
  if (tid) {
    const d = await req('DELETE', `/api/tokens/${tid}`, undefined, token);
    record(out.mutations, d);
    console.log(ok(d) ? '✓' : '✗', d.status, 'DELETE tokens');
  }
}

// 9. LGPD data request
{
  const plist = await req('GET', '/api/patients?limit=1', undefined, token);
  const p0 = arr(plist.data)[0];
  if (p0?.id) {
    const r = await req('POST', '/api/lgpd/data-requests', {
      patient_id: p0.id,
      request_type: 'access',
      notes: 'audit',
    }, token);
    record(out.mutations, r);
    console.log(ok(r) ? '✓' : '✗', r.status, 'POST lgpd data-request', r.data?.id || r.data?.error || r.data?.message);
  }
}

// 10. WhatsApp simulate (safe) + template create
{
  const sim = await req('POST', '/api/whatsapp/simulate', {
    phone: '+5511977' + String(Date.now()).slice(-6),
    message: 'Olá, quero agendar',
  }, token);
  record(out.mutations, sim, true);
  console.log(ok(sim) ? '✓' : '✗', sim.status, 'POST whatsapp simulate', sim.data?.error || 'ok');
  const tpl = await req('POST', '/api/whatsapp/templates', {
    name: 'audit_tpl_' + Date.now(),
    category: 'utility',
    language: 'pt_BR',
    body: 'Olá {{name}}, lembrete da Clínica Tanah.',
  }, token);
  record(out.mutations, tpl);
  console.log(ok(tpl) ? '✓' : '✗', tpl.status, 'POST wa template', tpl.data?.id || tpl.data?.error || tpl.data?.message);
  if (tpl.data?.id) {
    const d = await req('DELETE', `/api/whatsapp/templates/${tpl.data.id}`, undefined, token);
    record(out.mutations, d);
    console.log(ok(d) ? '✓' : '✗', d.status, 'DELETE wa template');
  }
  const camp = await req('POST', '/api/whatsapp/campaigns', {
    name: 'Audit Camp ' + Date.now(),
    segment: 'all',
    message_body: 'Teste campanha audit {{name}}',
  }, token);
  record(out.mutations, camp);
  console.log(ok(camp) ? '✓' : '✗', camp.status, 'POST wa campaign', camp.data?.id || camp.data?.error || camp.data?.message);
  if (camp.data?.id) {
    const d = await req('DELETE', `/api/whatsapp/campaigns/${camp.data.id}`, undefined, token);
    record(out.mutations, d);
    console.log(ok(d) ? '✓' : '✗', d.status, 'DELETE wa campaign');
  }
}

// 11. Payroll employee
{
  const emp = await req('POST', '/api/payroll/employees', {
    full_name: 'Audit Emp ' + Date.now(),
    cpf: String(Date.now()).slice(-11).padStart(11, '2'),
    role_title: 'Recepcionista',
    hire_date: today,
    salary_type: 'monthly',
    base_salary: 2500,
    employment_type: 'CLT',
  }, token);
  record(out.mutations, emp);
  console.log(ok(emp) ? '✓' : '✗', emp.status, 'POST employee', emp.data?.id || emp.data?.error || emp.data?.message);
}

// 12. Body measurements + meds (if patient)
if (patientId) {
  const m = await req('POST', `/api/clinical/body/${patientId}/measurements`, {
    weight_kg: 70, height_cm: 170, measured_at: new Date().toISOString(),
  }, token);
  record(out.mutations, m);
  console.log(ok(m) ? '✓' : '✗', m.status, 'POST body measurements', m.data?.error || m.data?.message || 'ok');
  const med = await req('POST', `/api/clinical/body/${patientId}/medications`, {
    name: 'Metformina', dose: '500mg', drug_class: 'antidiabetic',
  }, token);
  record(out.mutations, med);
  console.log(ok(med) ? '✓' : '✗', med.status, 'POST body med', med.data?.id || med.data?.error || med.data?.message);
  if (med.data?.id) {
    const d = await req('DELETE', `/api/clinical/body/${patientId}/medications/${med.data.id}`, undefined, token);
    record(out.mutations, d);
    console.log(ok(d) ? '✓' : '✗', d.status, 'DELETE body med');
  }
  const plan = await req('POST', `/api/clinical/body/${patientId}/plans`, {
    plan_type: 'diet',
    content: { calories: 1800, notes: 'audit' },
  }, token);
  record(out.mutations, plan);
  console.log(ok(plan) ? '✓' : '✗', plan.status, 'POST body plan', plan.data?.error || plan.data?.message || 'ok');
}

// 13. Team user create (admin)
{
  const email = `audit.user.${Date.now()}@clinica.test`;
  const u = await req('POST', '/api/users', {
    email,
    full_name: 'Audit User',
    password: 'Audit1234!',
    role: 'receptionist',
  }, token);
  record(out.mutations, u);
  console.log(ok(u) ? '✓' : '✗', u.status, 'POST user', u.data?.id || u.data?.error || u.data?.message);
  if (u.data?.id) {
    const d = await req('DELETE', `/api/users/${u.data.id}`, undefined, token);
    record(out.mutations, d);
    console.log(ok(d) ? '✓' : '✗', d.status, 'DELETE/deactivate user', d.data);
  }
}

out.finished_at = new Date().toISOString();
out.summary = {
  gets_total: out.gets.length,
  gets_ok: out.gets.filter(g => g.ok).length,
  mutations_total: out.mutations.length,
  mutations_ok: out.mutations.filter(m => m.ok).length,
  fails: out.fails.length,
};

fs.writeFileSync('/opt/cursor/artifacts/live-full-matrix.json', JSON.stringify(out, null, 2));
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(out.summary, null, 2));
if (out.fails.length) {
  console.log('\n=== FAILS ===');
  for (const f of out.fails) console.log(f.status, f.method, f.path, f.snippet);
}
process.exit(out.fails.length ? 2 : 0);
