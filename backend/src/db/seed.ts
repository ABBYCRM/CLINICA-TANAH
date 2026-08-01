/**
 * Seed realistic Clínica Tanah São Paulo data.
 * Run with: npx tsx src/db/seed.ts
 */
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db, initSchema, DEFAULT_TENANT_ID, PRIMARY_USER_ID, PRIMARY_USER_EMAIL, PRIMARY_USER_NAME, PRIMARY_USER_PASSWORD } from './schema';
import { recordConsent } from '../services/audit';
import { seedMariaBodyCaptures } from './seedBodyMaria';
import { seedAnaBodyCaptures } from './seedBodyAna';

initSchema();

console.log('🌱 Seeding Clínica Tanah...');

const now = new Date();
const today = now.toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30*86400000).toISOString().slice(0, 10);

// Wipe and reseed (idempotent for development)
db.exec(`
  DELETE FROM audit_log;
  DELETE FROM lgpd_data_requests;
  DELETE FROM lgpd_consents;
  DELETE FROM whatsapp_messages;
  DELETE FROM whatsapp_conversations;
  DELETE FROM satisfaction_surveys;
  DELETE FROM campaigns;
  DELETE FROM api_tokens;
  DELETE FROM payslips;
  DELETE FROM payroll_runs;
  DELETE FROM employees;
  DELETE FROM users;
  DELETE FROM invoice_lines;
  DELETE FROM invoices;
  DELETE FROM journal_lines;
  DELETE FROM journal_entries;
  DELETE FROM chart_of_accounts;
  DELETE FROM purchase_order_lines;
  DELETE FROM purchase_orders;
  DELETE FROM stock_movements;
  DELETE FROM inventory_batches;
  DELETE FROM inventory_items;
  DELETE FROM vendors;
  DELETE FROM prescriptions;
  DELETE FROM encounters;
  DELETE FROM appointments;
  DELETE FROM body_scenario_reports;
  DELETE FROM body_quality_events;
  DELETE FROM body_scenarios;
  DELETE FROM body_capture_assets;
  DELETE FROM body_capture_sessions;
  DELETE FROM body_captures;
  DELETE FROM body_consents;
  DELETE FROM body_lifestyle_plans;
  DELETE FROM body_medications;
  DELETE FROM body_measurements;
  DELETE FROM patients;
  DELETE FROM settings;
  DELETE FROM tenants;
`);

db.prepare(`
  INSERT INTO tenants (id, slug, name, address, phone, cnpj)
  VALUES (?, 'clinica-tanah', 'Clínica Tanah',
          'Rua Augusta, 1234 — Consolação, São Paulo / SP — CEP 01304-001',
          '+55 11 3000-0000', '12.345.678/0001-90')
`).run(DEFAULT_TENANT_ID);
const T = DEFAULT_TENANT_ID;

// Single staff login: Juliana / 12345678
const passwordHash = bcrypt.hashSync(PRIMARY_USER_PASSWORD, 10);
db.prepare(`
  INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, cpf, council_number, council_state, active, is_superadmin)
  VALUES (?, ?, ?, ?, ?, 'admin', '11122233396', 'CRM-SP 123456', 'SP', 1, 1)
`).run(PRIMARY_USER_ID, T, PRIMARY_USER_EMAIL, passwordHash, PRIMARY_USER_NAME);
const julianaId = PRIMARY_USER_ID;
console.log(`  ✓ 1 user (${PRIMARY_USER_NAME})`);

// PATIENTS — realistic São Paulo patients
const patientData = [
  { full_name: 'José Carlos Pereira', cpf: '12345678901', birth_date: '1972-04-15', gender: 'M', phone: '+5511987654321', email: 'jose.pereira@email.com', address_neighborhood: 'Pinheiros', health_insurance: 'Amil', blood_type: 'O+', allergies: ['Penicilina'], chronic_conditions: ['Hipertensão', 'Diabetes tipo 2'] },
  { full_name: 'Maria Aparecida Silva', cpf: '23456789012', birth_date: '1958-09-22', gender: 'F', phone: '+5511956781234', email: 'maria.aparecida@email.com', address_neighborhood: 'Vila Mariana', health_insurance: 'SulAmérica', blood_type: 'A+', allergies: [], chronic_conditions: ['Osteoporose'] },
  { full_name: 'Pedro Henrique Souza', cpf: '34567890123', birth_date: '1990-12-03', gender: 'M', phone: '+5511934567890', email: 'pedro.souza@email.com', address_neighborhood: 'Moema', health_insurance: 'Bradesco Saúde', blood_type: 'B+', allergies: ['Frutos do mar'], chronic_conditions: [] },
  { full_name: 'Ana Beatriz Lima', cpf: '45678901234', birth_date: '1985-06-18', gender: 'F', phone: '+5511923456789', email: 'ana.lima@email.com', address_neighborhood: 'Itaim Bibi', health_insurance: 'Amil', blood_type: 'AB+', allergies: [], chronic_conditions: ['Asma leve'] },
  { full_name: 'Lucas Oliveira Santos', cpf: '56789012345', birth_date: '2015-03-25', gender: 'M', phone: '+5511912345678', email: 'pais.lucas@email.com', address_neighborhood: 'Tatuapé', health_insurance: 'NotreDame Intermédica', blood_type: 'O+', allergies: ['Amendoim'], chronic_conditions: [] },
  { full_name: 'Fernanda Costa Rodrigues', cpf: '67890123456', birth_date: '1992-11-08', gender: 'F', phone: '+5511901234567', email: 'fernanda.costa@email.com', address_neighborhood: 'Perdizes', health_insurance: 'Particular', blood_type: 'A-', allergies: [], chronic_conditions: [] },
  { full_name: 'Ricardo Almeida Filho', cpf: '78901234567', birth_date: '1965-07-30', gender: 'M', phone: '+5511989012345', email: 'ricardo.almeida@email.com', address_neighborhood: 'Brooklin', health_insurance: 'SulAmérica', blood_type: 'O-', allergies: ['Sulfas'], chronic_conditions: ['Hipertensão', 'Colesterol alto'] },
  { full_name: 'Camila Mendes Pereira', cpf: '89012345678', birth_date: '1988-02-14', gender: 'F', phone: '+5511978901234', email: 'camila.mendes@email.com', address_neighborhood: 'Lapa', health_insurance: 'Hapvida', blood_type: 'B-', allergies: [], chronic_conditions: [] },
  { full_name: 'Gabriel Ferreira Costa', cpf: '90123456789', birth_date: '2001-08-09', gender: 'M', phone: '+5511967890123', email: 'gabriel.ferreira@email.com', address_neighborhood: 'Santana', health_insurance: 'Particular', blood_type: 'A+', allergies: [], chronic_conditions: [] },
  { full_name: 'Juliana Ribeiro Martins', cpf: '01234567890', birth_date: '1979-10-21', gender: 'F', phone: '+5511956789012', email: 'juliana.ribeiro@email.com', address_neighborhood: 'Campo Belo', health_insurance: 'Amil', blood_type: 'AB-', allergies: ['Iodo'], chronic_conditions: ['Hipotireoidismo'] },
];

const patientIds: string[] = [];
const insertPatient = db.prepare(`
  INSERT INTO patients (id, tenant_id, full_name, birth_date, cpf, rg, gender, phone, email, address_zip, address_street, address_number, address_neighborhood, address_city, address_state, health_insurance, health_insurance_number, blood_type, allergies, chronic_conditions, medications_in_use, emergency_contact_name, emergency_contact_phone, lgpd_consent_at, lgpd_consent_ip, lgpd_consent_version, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);
for (const p of patientData) {
  const id = uuid();
  patientIds.push(id);
  insertPatient.run(
    id, T, p.full_name, p.birth_date, p.cpf, `${Math.floor(Math.random()*9+1)}${Math.floor(Math.random()*99999999)}`,
    p.gender, p.phone, p.email,
    '01310-100', 'Rua Augusta', `${1000 + Math.floor(Math.random()*900)}`,
    p.address_neighborhood, 'São Paulo', 'SP',
    p.health_insurance, `${Math.floor(Math.random()*999999999)}`, p.blood_type,
    JSON.stringify(p.allergies), JSON.stringify(p.chronic_conditions), JSON.stringify([]),
    'Familiar', '+5511900000000', now.toISOString(), '127.0.0.1', '1.0', now.toISOString(), now.toISOString()
  );
  recordConsent({
    tenantId: T,
    subjectType: 'patient', subjectId: id, consentType: 'health_data_processing',
    granted: true, policyVersion: '1.0', ipAddress: '127.0.0.1',
    evidence: 'Cadastro presencial com assinatura digital do termo de consentimento.',
  });
  recordConsent({
    tenantId: T,
    subjectType: 'patient', subjectId: id, consentType: 'whatsapp_communication',
    granted: true, policyVersion: '1.0', ipAddress: '127.0.0.1',
    evidence: 'Consentimento WhatsApp registrado no cadastro.',
  });
}
console.log(`  ✓ ${patientData.length} patients with LGPD consent`);

// Maria Aparecida — 4-view body capture set for scenario before/after testing
{
  const mariaIdx = patientData.findIndex((p) => p.full_name === 'Maria Aparecida Silva');
  if (mariaIdx >= 0) {
    const seeded = seedMariaBodyCaptures(db, {
      tenantId: T,
      patientId: patientIds[mariaIdx],
      createdBy: julianaId,
    });
    if (seeded) {
      console.log(`  ✓ Maria body capture session (${seeded.views.join('/')})`);
    }
  }
}

// Ana Beatriz Lima — 4-view overweight baseline for image-gen testing
{
  const anaIdx = patientData.findIndex((p) => p.full_name === 'Ana Beatriz Lima');
  if (anaIdx >= 0) {
    const seeded = seedAnaBodyCaptures(db, {
      tenantId: T,
      patientId: patientIds[anaIdx],
      createdBy: julianaId,
    });
    if (seeded) {
      console.log(`  ✓ Ana body capture session (${seeded.views.join('/')})`);
    }
  }
}

// VENDORS — distributors, labs, suppliers
const vendorData = [
  { legal_name: 'MedSupply Distribuidora de Medicamentos Ltda', trade_name: 'MedSupply', cnpj: '11222333000181', contact_name: 'Carlos Mendes', phone: '+551133334444', email: 'vendas@medsupply.com.br', anvisa_license: 'AFE 1.23456.7', address_city: 'São Paulo', address_state: 'SP' },
  { legal_name: 'FarmaCorp Comercial Farmacêutica S.A.', trade_name: 'FarmaCorp', cnpj: '22333444000192', contact_name: 'Renata Oliveira', phone: '+551133445555', email: 'comercial@farmacorp.com.br', anvisa_license: 'AFE 2.34567.8', address_city: 'Guarulhos', address_state: 'SP' },
  { legal_name: 'LabDiagnósticos Importação e Distribuição Ltda', trade_name: 'LabDiagnósticos', cnpj: '33444555000103', contact_name: 'Felipe Rocha', phone: '+551133556666', email: 'contato@labdiag.com.br', anvisa_license: 'AFE 3.45678.9', address_city: 'São Paulo', address_state: 'SP' },
  { legal_name: 'HospClean Materiais Hospitalares ME', trade_name: 'HospClean', cnpj: '44555666000114', contact_name: 'Sandra Lima', phone: '+551133667777', email: 'vendas@hospclean.com.br', anvisa_license: null, address_city: 'Osasco', address_state: 'SP' },
  { legal_name: 'Energia Elétrica SP S.A.', trade_name: 'Enel São Paulo', cnpj: '61695255000114', contact_name: 'Atendimento', phone: '0800-7272-120', email: 'atendimento@enel.com', anvisa_license: null, address_city: 'São Paulo', address_state: 'SP' },
];
const vendorIds: string[] = [];
const insertVendor = db.prepare(`
  INSERT INTO vendors (id, tenant_id, legal_name, trade_name, cnpj, phone, email, contact_name, anvisa_license, address_city, address_state, active)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,1)
`);
for (const v of vendorData) {
  const id = uuid();
  vendorIds.push(id);
  insertVendor.run(id, T, v.legal_name, v.trade_name, v.cnpj, v.phone, v.email, v.contact_name, v.anvisa_license, v.address_city, v.address_state);
}
console.log(`  ✓ ${vendorData.length} vendors`);

// INVENTORY ITEMS
const itemsData = [
  { sku: 'MED-001', name: 'Dipirona Sódica 500mg (caixa c/ 20 cp)', category: 'medication', unit: 'caixa', anvisa_registry: '1.0043.0011.001-1', min_stock: 10, max_stock: 100, unit_cost: 8.50, sale_price: 15.00 },
  { sku: 'MED-002', name: 'Paracetamol 750mg (caixa c/ 20 cp)', category: 'medication', unit: 'caixa', anvisa_registry: '1.0043.0012.002-2', min_stock: 15, max_stock: 150, unit_cost: 6.20, sale_price: 12.00 },
  { sku: 'MED-003', name: 'Amoxicilina 500mg (caixa c/ 21 cp)', category: 'medication', unit: 'caixa', anvisa_registry: '1.0107.0234.003-3', min_stock: 8, max_stock: 80, unit_cost: 22.00, sale_price: 45.00 },
  { sku: 'MED-004', name: 'Ibuprofeno 400mg (caixa c/ 20 cp)', category: 'medication', unit: 'caixa', anvisa_registry: '1.0107.0235.004-4', min_stock: 10, max_stock: 100, unit_cost: 12.00, sale_price: 22.00 },
  { sku: 'MED-005', name: 'Losartana Potássica 50mg (caixa c/ 30 cp)', category: 'medication', unit: 'caixa', anvisa_registry: '1.0535.0145.005-5', min_stock: 20, max_stock: 200, unit_cost: 18.00, sale_price: 35.00 },
  { sku: 'MED-006', name: 'Metformina 850mg (caixa c/ 30 cp)', category: 'medication', unit: 'caixa', anvisa_registry: '1.0535.0146.006-6', min_stock: 15, max_stock: 150, unit_cost: 14.00, sale_price: 28.00 },
  { sku: 'MED-007', name: 'Soro Fisiológico 0,9% 500ml', category: 'medication', unit: 'frasco', anvisa_registry: '1.0043.0098.007-7', min_stock: 25, max_stock: 200, unit_cost: 4.50, sale_price: 9.00 },
  { sku: 'CON-001', name: 'Luva de Látex Tam M (caixa c/ 100)', category: 'consumable', unit: 'caixa', anvisa_registry: '8.1234.5678.001-1', min_stock: 10, max_stock: 80, unit_cost: 28.00, sale_price: 0 },
  { sku: 'CON-002', name: 'Máscara Cirúrgica Descartável (caixa c/ 50)', category: 'consumable', unit: 'caixa', anvisa_registry: '8.1234.5678.002-2', min_stock: 20, max_stock: 200, unit_cost: 12.00, sale_price: 0 },
  { sku: 'CON-003', name: 'Seringa Descartável 10ml (unidade)', category: 'consumable', unit: 'unidade', anvisa_registry: '8.1234.5678.003-3', min_stock: 100, max_stock: 1000, unit_cost: 0.50, sale_price: 0 },
  { sku: 'CON-004', name: 'Algodão Hidrófilo 500g', category: 'consumable', unit: 'pacote', anvisa_registry: '8.1234.5678.004-4', min_stock: 5, max_stock: 30, unit_cost: 14.00, sale_price: 0 },
  { sku: 'CON-005', name: 'Álcool Etílico 70% 1L', category: 'consumable', unit: 'frasco', anvisa_registry: '3.0001.4567.005-5', min_stock: 15, max_stock: 100, unit_cost: 8.00, sale_price: 0 },
  { sku: 'EQP-001', name: 'Esfigmomanômetro Aneróide Adulto', category: 'equipment', unit: 'unidade', anvisa_registry: '8.4567.8901.001-1', min_stock: 3, max_stock: 10, unit_cost: 145.00, sale_price: 0 },
  { sku: 'EQP-002', name: 'Estetoscópio Duplo Adulto', category: 'equipment', unit: 'unidade', anvisa_registry: '8.4567.8901.002-2', min_stock: 3, max_stock: 10, unit_cost: 220.00, sale_price: 0 },
  { sku: 'MED-008', name: 'Lorazepam 2mg (caixa c/ 20 cp) — CONTROLADO', category: 'medication', unit: 'caixa', anvisa_registry: '1.0234.0567.008-8', controlled: true, min_stock: 5, max_stock: 30, unit_cost: 35.00, sale_price: 65.00 },
];
const itemIds: string[] = [];
const insertItem = db.prepare(`
  INSERT INTO inventory_items (id, tenant_id, sku, name, category, unit, anvisa_registry, controlled, min_stock, max_stock, unit_cost, sale_price, active)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)
`);
for (const it of itemsData) {
  const id = uuid();
  itemIds.push(id);
  insertItem.run(id, T, it.sku, it.name, it.category, it.unit, it.anvisa_registry,
                 (it as any).controlled ? 1 : 0, it.min_stock, it.max_stock, it.unit_cost, it.sale_price);
}
console.log(`  ✓ ${itemsData.length} inventory items`);

// INVENTORY BATCHES — with realistic expiry dates
const insertBatch = db.prepare(`
  INSERT INTO inventory_batches (id, tenant_id, item_id, batch_number, expiry_date, quantity, vendor_id, cost_per_unit, received_at)
  VALUES (?,?,?,?,?,?,?,?,?)
`);
const insertMovement = db.prepare(`
  INSERT INTO stock_movements (id, tenant_id, item_id, batch_id, movement_type, quantity, reason, user_id, created_at)
  VALUES (?,?,?,?,?,?,?,?,?)
`);
itemIds.forEach((itemId, idx) => {
  const item = itemsData[idx];
  // Each item gets 2-3 batches with different expiries
  const numBatches = 2 + (idx % 2);
  let remaining = Math.floor(item.min_stock + Math.random() * (item.max_stock - item.min_stock));
  for (let b = 0; b < numBatches && remaining > 0; b++) {
    const qty = b === numBatches - 1 ? remaining : Math.floor(remaining / (numBatches - b));
    remaining -= qty;
    const expiry = new Date(Date.now() + (60 + Math.floor(Math.random() * 800)) * 86400000).toISOString().slice(0, 10);
    const batchId = uuid();
    insertBatch.run(batchId, T, itemId, `L${item.sku}-${b+1}-2026`, expiry, qty, vendorIds[idx % vendorIds.length], item.unit_cost, monthAgo);
    insertMovement.run(uuid(), T, itemId, batchId, 'in', qty, 'purchase', julianaId, monthAgo);
  }
});
console.log(`  ✓ Inventory batches created`);

// EMPLOYEES + PAYROLL (HR records — not login accounts)
const employeeData = [
  { full_name: 'Juliana', cpf: '11122233396', pis: '123.45678.90-1', role: 'admin', base_salary: 22000.00, dependents: 2 },
  { full_name: 'Ana Paula Ferreira', cpf: '66677788830', pis: '567.89012.34-5', role: 'nurse', base_salary: 4800.00, dependents: 1 },
  { full_name: 'Mariana Costa', cpf: '77788899941', pis: '678.90123.45-6', role: 'receptionist', base_salary: 3200.00, dependents: 0 },
  { full_name: 'João Mendes', cpf: '88899900078', pis: '789.01234.56-7', role: 'accountant', base_salary: 6500.00, dependents: 2 },
  { full_name: 'Patrícia Almeida', cpf: '99900011112', pis: '890.12345.67-8', role: 'pharmacist', base_salary: 5800.00, dependents: 1 },
  { full_name: 'Roberto Lima Santos', cpf: '12312312387', pis: '111.22233.44-5', role: 'cleaner', base_salary: 2200.00, dependents: 0 },
];
const insertEmployee = db.prepare(`
  INSERT INTO employees (id, tenant_id, full_name, cpf, pis, ctps_number, ctps_series, role, admission_date, base_salary, weekly_hours, dependents)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
`);
const empIds: string[] = [];
for (const e of employeeData) {
  const id = uuid();
  empIds.push(id);
  insertEmployee.run(id, T, e.full_name, e.cpf, e.pis, '12345', '001', e.role, '2024-01-15', e.base_salary, 44, e.dependents);
}
console.log(`  ✓ ${employeeData.length} employees`);

// APPOINTMENTS — past, today, upcoming
const apptTypes = ['consultation','return','exam','procedure'];
const apptStatuses = ['completed','completed','completed','scheduled','confirmed'];
const insertAppt = db.prepare(`
  INSERT INTO appointments (id, tenant_id, patient_id, practitioner_id, scheduled_at, duration_minutes, type, status, source, notes)
  VALUES (?,?,?,?,?,?,?,?,?,?)
`);
for (let day = -7; day <= 7; day++) {
  const date = new Date(Date.now() + day * 86400000);
  const dateStr = date.toISOString().slice(0, 10);
  const numAppts = day === 0 ? 6 : 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < numAppts; i++) {
    const h = 8 + Math.floor(Math.random() * 9);
    const m = Math.random() < 0.5 ? 0 : 30;
    const scheduled = `${dateStr} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`;
    const status = day < 0 ? 'completed' : apptStatuses[Math.floor(Math.random() * apptStatuses.length)];
    insertAppt.run(uuid(), T, patientIds[Math.floor(Math.random() * patientIds.length)],
                   julianaId, scheduled, 30,
                   apptTypes[Math.floor(Math.random() * apptTypes.length)],
                   status, ['reception','whatsapp_bot','phone','website'][Math.floor(Math.random() * 4)],
                   null);
  }
}
console.log(`  ✓ Appointments across 15 days`);

// ENCOUNTERS + PRESCRIPTIONS for past appointments
const insertEncounter = db.prepare(`
  INSERT INTO encounters (id, tenant_id, patient_id, practitioner_id, appointment_id, started_at, ended_at, subjective, objective, assessment, plan, icd10_codes, cid10_codes, notes)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);
const pastAppts = db.prepare(`
  SELECT a.*, p.id AS pid FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  WHERE a.status = 'completed' LIMIT 10
`).all() as any[];
const icd10 = ['I10','E11.9','J45','M54.5','R51','K21.9','J06.9','F41.1'];
for (const a of pastAppts) {
  const eid = uuid();
  insertEncounter.run(
    eid, T, a.patient_id, a.practitioner_id, a.id,
    a.scheduled_at, a.scheduled_at,
    'Paciente relata sintomas descritos na consulta anterior.',
    'Exame físico sem alterações significativas. PA: 130/85 mmHg. FC: 78 bpm.',
    icd10[Math.floor(Math.random() * icd10.length)],
    'Manter medicação. Retornar em 30 dias.',
    JSON.stringify([icd10[Math.floor(Math.random() * icd10.length)]]),
    JSON.stringify([icd10[Math.floor(Math.random() * icd10.length)]]),
    'Paciente orientado sobre hábitos saudáveis.'
  );
  // Prescription
  db.prepare(`
    INSERT INTO prescriptions (id, tenant_id, encounter_id, patient_id, practitioner_id, items, sent_via_whatsapp)
    VALUES (?,?,?,?,?,?,?)
  `).run(uuid(), T, eid, a.patient_id, a.practitioner_id, JSON.stringify([
    { medication: 'Dipirona 500mg', dosage: '1 cp', frequency: '6/6h se dor', duration: '5 dias', instructions: 'Tomar com água após refeições' },
    { medication: 'Paracetamol 750mg', dosage: '1 cp', frequency: '8/8h', duration: '7 dias', instructions: 'Em caso de febre' },
  ]), Math.random() < 0.6 ? 1 : 0);
}
console.log(`  ✓ ${pastAppts.length} clinical encounters + prescriptions`);

// INVOICES — past month
const insertInvoice = db.prepare(`
  INSERT INTO invoices (id, tenant_id, invoice_number, patient_id, issue_date, due_date, total, status, payment_method, paid_at)
  VALUES (?,?,?,?,?,?,?,?,?,?)
`);
for (let i = 0; i < 25; i++) {
  const issueDate = new Date(Date.now() - Math.floor(Math.random() * 30) * 86400000).toISOString().slice(0, 10);
  const total = [150, 180, 220, 250, 280, 320, 350, 400][Math.floor(Math.random() * 8)];
  const status = Math.random() < 0.7 ? 'paid' : (Math.random() < 0.5 ? 'issued' : 'overdue');
  insertInvoice.run(uuid(), T, `INV-${String(1000 + i).padStart(4,'0')}`,
    patientIds[Math.floor(Math.random() * patientIds.length)],
    issueDate, issueDate, total, status,
    ['pix','credit_card','cash','health_insurance'][Math.floor(Math.random() * 4)],
    status === 'paid' ? issueDate : null);
}
console.log(`  ✓ 25 invoices`);

// WHATSAPP — Flow Doctor marketing conversations (PT)
const waPhones = ['+5511987654321', '+5511956781234', '+5511934567890'];
const flowDoctorMenu =
  'Olá! Sou o *Flow Doctor* da Clínica Tanah 🩺\nSeu assistente de WhatsApp em português para consultas e marketing.\n\n1 — Marcar consulta\n2 — Confirmar / minhas consultas\n3 — Remarcar\n4 — Cancelar consulta\n5 — Promoções e campanhas\n6 — Pesquisa de satisfação\n7 — Lembretes e preferências\n8 — Privacidade e LGPD\n9 — Atendente / endereço\n\nComandos: MÉDICO · MENU · SAIR · ATENDENTE';

// Sample marketing campaign for Flow Doctor option 5
db.prepare(`
  INSERT INTO campaigns (id, tenant_id, name, message, status, audience, category, created_by, created_at)
  VALUES (?, ?, ?, ?, 'draft', 'all_consented', 'marketing', ?, datetime('now'))
`).run(
  uuid(),
  T,
  'Check-up completo — outono',
  'Olá {{name}}! A Clínica Tanah preparou um check-up completo com prioridade de agenda neste mês. Responda 1 no WhatsApp para marcar ou SAIR para não receber promoções.',
  PRIMARY_USER_ID,
);

for (const p of waPhones) {
  const convId = uuid();
  db.prepare(`
    INSERT INTO whatsapp_conversations (id, tenant_id, phone, patient_id, state, lgpd_consent_granted, last_message_at, created_at, updated_at)
    VALUES (?, ?, ?, (SELECT id FROM patients WHERE phone = ? AND tenant_id = ?), 'idle', 1, datetime('now'), datetime('now'), datetime('now'))
  `).run(convId, T, p, p, T);
  const stmt = db.prepare(`
    INSERT INTO whatsapp_messages (id, tenant_id, phone, direction, body, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const t0 = Date.now() - 2 * 3600 * 1000;
  stmt.run(uuid(), T, p, 'in', 'Oi', 'received', new Date(t0).toISOString());
  stmt.run(uuid(), T, p, 'out', flowDoctorMenu, 'sent', new Date(t0 + 30_000).toISOString());
  if (p === '+5511987654321') {
    // José — full marketing Flow Doctor demo thread
    stmt.run(uuid(), T, p, 'in', '5', 'received', new Date(t0 + 120_000).toISOString());
    stmt.run(
      uuid(), T, p, 'out',
      '📢 *Promoções e campanhas* da Clínica Tanah:\n\n1. *Check-up completo — outono* (draft)\nOlá {{name}}! A Clínica Tanah preparou um check-up completo com prioridade de agenda neste mês…\n\nPara agendar com a promoção, responda *1*.\nPara sair da lista de marketing, responda *SAIR*.\nDigite *MENU* para voltar.',
      'sent', new Date(t0 + 150_000).toISOString(),
    );
    stmt.run(uuid(), T, p, 'in', '7', 'received', new Date(t0 + 240_000).toISOString());
    stmt.run(
      uuid(), T, p, 'out',
      '⚙️ *Lembretes e preferências* (Flow Doctor):\n\n• Lembrete 24h e 2h antes da consulta\n• Boas-vindas após a primeira visita\n• Aniversário e reativação (90 dias)\n• Lembrete de pagamento (quando aplicável)\n• Pesquisa NPS pós-consulta\n\nComandos:\n• *SAIR* — parar novidades e promoções\n• *CANCELAR MENSAGENS* — escolher o que interromper\n• *ATENDENTE* — falar com a equipe',
      'sent', new Date(t0 + 270_000).toISOString(),
    );
  } else {
    stmt.run(uuid(), T, p, 'in', '1', 'received', new Date(t0 + 120_000).toISOString());
    stmt.run(
      uuid(), T, p, 'out',
      'Para confirmar, informe seu CPF (somente números).',
      'sent', new Date(t0 + 150_000).toISOString(),
    );
  }
}
console.log(`  ✓ WhatsApp Flow Doctor conversation examples + campaign`);

// SETTINGS
const settings = [
  ['clinic_name', 'Clínica Tanah'],
  ['clinic_cnpj', '12.345.678/0001-90'],
  ['clinic_phone', '+55 11 3000-0000'],
  ['clinic_address', 'Rua Augusta, 1234 — Consolação, São Paulo / SP — CEP 01304-001'],
  ['lgpd_policy_version', '1.0'],
  ['lgpd_policy_effective', '2026-07-30'],
  ['dpo_email', PRIMARY_USER_EMAIL],
  ['dpo_name', PRIMARY_USER_NAME],
  ['default_locale', 'pt-BR'],
  ['default_currency', 'BRL'],
];
const insertSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
for (const [k, v] of settings) insertSetting.run(k, v);
console.log(`  ✓ ${settings.length} settings`);

console.log('\n✅ Seed complete!\n');
console.log(`  Tenant: Clínica Tanah (${T})`);
console.log(`  Login: ${PRIMARY_USER_NAME} / ${PRIMARY_USER_PASSWORD}  (also ${PRIMARY_USER_EMAIL})`);
console.log('');
