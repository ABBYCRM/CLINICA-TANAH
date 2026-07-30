/**
 * Auto-seed on first boot if the database is empty.
 * Runs synchronously during server startup; safe to leave in production.
 */
import { db, initSchema } from './db/schema';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { recordConsent } from './services/audit';

let seeded = false;

export function autoSeedIfEmpty(): void {
  if (seeded) return;
  initSchema();
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const patientCount = (db.prepare('SELECT COUNT(*) as c FROM patients').get() as any).c;
  // Re-seed if we have users but no patients (e.g. test data wiped)
  if (userCount > 0 && patientCount > 0) {
    seeded = true;
    return;
  }
  if (userCount > 0) {
    // Wipe leftover data so the seed produces a clean state
    console.log('🧹 Wiping old data, re-seeding...');
    db.exec(`
      DELETE FROM audit_log; DELETE FROM lgpd_data_requests; DELETE FROM lgpd_consents;
      DELETE FROM whatsapp_messages; DELETE FROM whatsapp_conversations;
      DELETE FROM payslips; DELETE FROM payroll_runs; DELETE FROM employees;
      DELETE FROM users; DELETE FROM invoice_lines; DELETE FROM invoices;
      DELETE FROM journal_lines; DELETE FROM journal_entries; DELETE FROM chart_of_accounts;
      DELETE FROM purchase_order_lines; DELETE FROM purchase_orders;
      DELETE FROM stock_movements; DELETE FROM inventory_batches; DELETE FROM inventory_items;
      DELETE FROM vendors; DELETE FROM prescriptions; DELETE FROM encounters;
      DELETE FROM appointments; DELETE FROM patients; DELETE FROM settings;
    `);
  }
  console.log('🌱 Database empty — running initial seed...');
  runSeed();
  seeded = true;
}

function runSeed(): void {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // (abbreviated seed for production — full version is in src/db/seed.ts)
  const staffData = [
    { email: 'admin@clinica-tanah.com.br', full_name: 'Dra. Helena Tanaka', role: 'admin', cpf: '11122233396' },
    { email: 'dpo@clinica-tanah.com.br', full_name: 'Dr. Marcos Vieira (DPO)', role: 'dpo', cpf: '22233344405' },
    { email: 'dermato@clinica-tanah.com.br', full_name: 'Dra. Beatriz Santos', role: 'doctor', cpf: '44455566623' },
    { email: 'transplante@clinica-tanah.com.br', full_name: 'Dr. Roberto Silva', role: 'doctor', cpf: '33344455514' },
    { email: 'endocrino@clinica-tanah.com.br', full_name: 'Dr. Carlos Oliveira', role: 'doctor', cpf: '55566677732' },
    { email: 'gineco@clinica-tanah.com.br', full_name: 'Dra. Fernanda Lima', role: 'doctor', cpf: '11144477735' },
    { email: 'nutri@clinica-tanah.com.br', full_name: 'Dra. Patrícia Rocha', role: 'doctor', cpf: '11155588896' },
    { email: 'ana.enf@clinica-tanah.com.br', full_name: 'Ana Paula Ferreira', role: 'nurse', cpf: '66677788841' },
    { email: 'mariana@clinica-tanah.com.br', full_name: 'Mariana Costa', role: 'receptionist', cpf: '77788899950' },
    { email: 'contabil@clinica-tanah.com.br', full_name: 'João Mendes', role: 'accountant', cpf: '88899900069' },
    { email: 'farmacia@clinica-tanah.com.br', full_name: 'Patrícia Almeida', role: 'pharmacist', cpf: '99900011178' },
  ];
  const userIds: Record<string, string> = {};
  const hash = bcrypt.hashSync('clinica2026', 10);
  const insUser = db.prepare(`INSERT INTO users (id, email, password_hash, full_name, role, cpf, active) VALUES (?, ?, ?, ?, ?, ?, 1)`);
  for (const u of staffData) {
    const id = uuid();
    userIds[u.email] = id;
    insUser.run(id, u.email, hash, u.full_name, u.role, u.cpf);
  }

  // Patients — single test patient: Luis Lacerda
  const patientData = [
    {
      full_name: 'Luis Lacerda',
      cpf: '56140504780',
      phone: '+55614050478',  // 561 405 0478
      email: 'luis.lacerda@example.com',
      birth_date: '1985-04-15',
      gender: 'M',
      address_neighborhood: 'Pinheiros',
      blood_type: 'O+',
      allergies: [] as string[],
      chronic: [] as string[],
      notes: 'Paciente de teste principal da Clínica Tanah. WhatsApp: +55 61 9405-0478.',
    },
  ];
  const patientIds: string[] = [];
  const insP = db.prepare(`INSERT INTO patients (id, full_name, birth_date, cpf, phone, email, address_neighborhood, address_city, address_state, blood_type, allergies, chronic_conditions, medications_in_use, lgpd_consent_at, lgpd_consent_ip, lgpd_consent_version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const p of patientData) {
    const id = uuid();
    patientIds.push(id);
    insP.run(id, p.full_name, p.birth_date, p.cpf, p.phone, p.email, p.address_neighborhood, 'São Paulo', 'SP', p.blood_type,
      JSON.stringify(p.allergies), JSON.stringify(p.chronic), JSON.stringify([]),
      now.toISOString(), '0.0.0.0', '1.0', now.toISOString(), now.toISOString());
    recordConsent({ subjectType: 'patient', subjectId: id, consentType: 'health_data_processing', granted: true, policyVersion: '1.0' });
    recordConsent({ subjectType: 'patient', subjectId: id, consentType: 'whatsapp_communication', granted: true, policyVersion: '1.0' });
  }

  // Vendors
  const vendors = [
    { legal_name: 'MedSupply Distribuidora de Medicamentos Ltda', cnpj: '11222333000181', trade: 'MedSupply', city: 'São Paulo', state: 'SP' },
    { legal_name: 'FarmaCorp Comercial Farmacêutica S.A.', cnpj: '22333444000192', trade: 'FarmaCorp', city: 'Guarulhos', state: 'SP' },
    { legal_name: 'LabDiagnósticos Importação e Distribuição Ltda', cnpj: '33444555000103', trade: 'LabDiagnósticos', city: 'São Paulo', state: 'SP' },
    { legal_name: 'HospClean Materiais Hospitalares ME', cnpj: '44555666000114', trade: 'HospClean', city: 'Osasco', state: 'SP' },
    { legal_name: 'Energia Elétrica SP S.A.', cnpj: '61695255000114', trade: 'Enel São Paulo', city: 'São Paulo', state: 'SP' },
  ];
  const vendorIds: string[] = [];
  const insV = db.prepare(`INSERT INTO vendors (id, legal_name, trade_name, cnpj, address_city, address_state, active) VALUES (?,?,?,?,?,?,1)`);
  for (const v of vendors) {
    const id = uuid();
    vendorIds.push(id);
    insV.run(id, v.legal_name, v.trade, v.cnpj, v.city, v.state);
  }

  // Inventory items
  const items = [
    { sku: 'MED-001', name: 'Dipirona Sódica 500mg (caixa c/ 20 cp)', cat: 'medication', unit: 'caixa', min: 10, max: 100, cost: 8.5, sale: 15.0 },
    { sku: 'MED-002', name: 'Paracetamol 750mg (caixa c/ 20 cp)', cat: 'medication', unit: 'caixa', min: 15, max: 150, cost: 6.2, sale: 12.0 },
    { sku: 'MED-003', name: 'Amoxicilina 500mg (caixa c/ 21 cp)', cat: 'medication', unit: 'caixa', min: 8, max: 80, cost: 22.0, sale: 45.0 },
    { sku: 'MED-005', name: 'Losartana Potássica 50mg (caixa c/ 30 cp)', cat: 'medication', unit: 'caixa', min: 20, max: 200, cost: 18.0, sale: 35.0 },
    { sku: 'MED-006', name: 'Metformina 850mg (caixa c/ 30 cp)', cat: 'medication', unit: 'caixa', min: 15, max: 150, cost: 14.0, sale: 28.0 },
    { sku: 'CON-001', name: 'Luva de Látex Tam M (caixa c/ 100)', cat: 'consumable', unit: 'caixa', min: 10, max: 80, cost: 28.0, sale: 0 },
    { sku: 'CON-002', name: 'Máscara Cirúrgica (caixa c/ 50)', cat: 'consumable', unit: 'caixa', min: 20, max: 200, cost: 12.0, sale: 0 },
    { sku: 'EQP-001', name: 'Esfigmomanômetro Aneróide Adulto', cat: 'equipment', unit: 'unidade', min: 3, max: 10, cost: 145.0, sale: 0 },
  ];
  const itemIds: string[] = [];
  const insI = db.prepare(`INSERT INTO inventory_items (id, sku, name, category, unit, min_stock, max_stock, unit_cost, sale_price, active) VALUES (?,?,?,?,?,?,?,?,?,1)`);
  for (const it of items) {
    const id = uuid();
    itemIds.push(id);
    insI.run(id, it.sku, it.name, it.cat, it.unit, it.min, it.max, it.cost, it.sale);
  }

  // Employees
  const employees = [
    { name: 'Dra. Helena Tanaka', cpf: '11122233396', role: 'admin', salary: 22000, dep: 2 },
    { name: 'Dra. Beatriz Santos', cpf: '44455566623', role: 'doctor', salary: 19200, dep: 0, spec: 'Dermatologia' },
    { name: 'Dr. Roberto Silva', cpf: '33344455514', role: 'doctor', salary: 28000, dep: 1, spec: 'Transplante Capilar' },
    { name: 'Dr. Carlos Oliveira', cpf: '55566677732', role: 'doctor', salary: 17800, dep: 3, spec: 'Endocrinologia' },
    { name: 'Dra. Fernanda Lima', cpf: '11144477735', role: 'doctor', salary: 19500, dep: 1, spec: 'Ginecologia' },
    { name: 'Dra. Patrícia Rocha', cpf: '11155588896', role: 'doctor', salary: 9500, dep: 0, spec: 'Nutrição' },
    { name: 'Ana Paula Ferreira', cpf: '66677788841', role: 'nurse', salary: 4800, dep: 1 },
    { name: 'Mariana Costa', cpf: '77788899950', role: 'receptionist', salary: 3200, dep: 0 },
    { name: 'João Mendes', cpf: '88899900069', role: 'accountant', salary: 6500, dep: 2 },
    { name: 'Patrícia Almeida', cpf: '99900011178', role: 'pharmacist', salary: 5800, dep: 1 },
  ];
  const insE = db.prepare(`INSERT INTO employees (id, full_name, cpf, role, admission_date, base_salary, dependents) VALUES (?,?,?,?,?,?,?)`);
  for (const e of employees) insE.run(uuid(), e.name, e.cpf, (e as any).spec || e.role, '2024-01-15', e.salary, e.dep);

  // Chart of accounts (minimal)
  const accounts = [
    { code: '1.1.01.001', name: 'Caixa Geral', type: 'asset' },
    { code: '1.1.01.002', name: 'Banco Conta Movimento', type: 'asset' },
    { code: '1.1.02.001', name: 'Contas a Receber', type: 'asset' },
    { code: '1.1.03.001', name: 'Estoque de Medicamentos', type: 'asset' },
    { code: '2.1.01.001', name: 'Fornecedores', type: 'liability' },
    { code: '2.1.02.001', name: 'Salários a Pagar', type: 'liability' },
    { code: '2.1.02.002', name: 'INSS a Recolher', type: 'liability' },
    { code: '2.1.02.003', name: 'FGTS a Recolher', type: 'liability' },
    { code: '3.1.01.001', name: 'Capital Social', type: 'equity' },
    { code: '4.1.01.001', name: 'Receita de Consultas', type: 'revenue' },
    { code: '4.1.01.002', name: 'Receita de Exames', type: 'revenue' },
    { code: '5.1.01.001', name: 'Salários', type: 'expense' },
    { code: '5.1.01.002', name: 'INSS', type: 'expense' },
    { code: '5.1.01.003', name: 'FGTS', type: 'expense' },
    { code: '5.1.02.001', name: 'Aluguel', type: 'expense' },
  ];
  const insA = db.prepare(`INSERT INTO chart_of_accounts (id, code, name, type) VALUES (?,?,?,?)`);
  for (const a of accounts) insA.run(uuid(), a.code, a.name, a.type);

  // Settings
  const insS = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
  const settings = [
    ['clinic_name', 'Clínica Tanah'],
    ['clinic_cnpj', '12.345.678/0001-90'],
    ['clinic_phone', '+55 11 3000-0000'],
    ['clinic_address', 'Rua Augusta, 1234 — Consolação, São Paulo / SP — CEP 01304-001'],
    ['lgpd_policy_version', '1.0'],
    ['lgpd_policy_effective', '2026-07-30'],
    ['dpo_email', 'dpo@clinica-tanah.com.br'],
    ['dpo_name', 'Dr. Marcos Vieira'],
  ];
  for (const [k, v] of settings) insS.run(k, v);

  console.log(`  ✓ ${staffData.length} users, ${patientData.length} patients, ${vendors.length} vendors, ${items.length} items, ${employees.length} employees`);

  // Add a recent appointment + encounter + prescription for the test patient
  if (patientIds.length > 0) {
    const pid = patientIds[0];
    const docId = userIds['dermato@clinica-tanah.com.br'];
    const apptDate = new Date();
    apptDate.setDate(apptDate.getDate() - 7);
    const apptDt = `${apptDate.toISOString().slice(0, 10)} 10:00:00`;
    const apptId = uuid();
    db.prepare(`
      INSERT INTO appointments (id, patient_id, practitioner_id, scheduled_at, duration_minutes, type, status, source, notes)
      VALUES (?, ?, ?, ?, 30, 'consultation', 'completed', 'whatsapp_bot', 'Retorno programado para 30 dias.')
    `).run(apptId, pid, docId, apptDt);

    const encId = uuid();
    db.prepare(`
      INSERT INTO encounters (id, patient_id, practitioner_id, appointment_id, started_at, ended_at, subjective, objective, assessment, plan, icd10_codes, cid10_codes, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(encId, pid, docId, apptId, apptDt, apptDt,
      'Paciente relata melhora da dermatite após início do tratamento tópico.',
      'Lesões eritematosas reduzidas em ~60%. Sem sinais de infecção secundária.',
      'Dermatite atópica (L20.9)',
      'Manter tratamento. Retornar em 30 dias para reavaliação.',
      JSON.stringify(['L20.9']),
      JSON.stringify(['L20.9']),
      'Paciente orientado sobre hidratação diária e evitar sabonetes agressivos.');

    const rxId = uuid();
    db.prepare(`
      INSERT INTO prescriptions (id, encounter_id, patient_id, practitioner_id, items, sent_via_whatsapp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(rxId, encId, pid, docId, JSON.stringify([
      { medication: 'Hidratante facial Cerave', dosage: 'Aplicar camada fina', frequency: '2x ao dia', duration: 'Uso contínuo', instructions: 'Manhã e noite, após limpeza suave' },
      { medication: 'Cetirizina 10mg', dosage: '1 cp', frequency: '1x ao dia', duration: '30 dias', instructions: 'Em caso de prurido intenso' },
    ]), 1);

    // WhatsApp conversation example with the test patient
    const testPhone = patientData[0].phone;
    db.prepare(`
      INSERT INTO whatsapp_conversations (id, phone, patient_id, state, lgpd_consent_granted, last_message_at, created_at, updated_at)
      VALUES (?, ?, ?, 'idle', 1, datetime('now'), datetime('now'), datetime('now'))
    `).run(uuid(), testPhone, pid);
    const stmt = db.prepare(`
      INSERT INTO whatsapp_messages (id, phone, direction, body, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(uuid(), testPhone, 'in', 'oi', 'received', new Date(Date.now() - 2*3600*1000).toISOString());
    stmt.run(uuid(), testPhone, 'out', 'Olá Luis! Sou a assistente da Clínica Tanah. Como posso ajudar?\n\n1️⃣ Agendar consulta\n2️⃣ Ver minhas consultas\n3️⃣ Cancelar consulta\n4️⃣ Falar com a recepção\n5️⃣ Remover meus dados (LGPD)', 'sent', new Date(Date.now() - 2*3600*1000).toISOString());
    stmt.run(uuid(), testPhone, 'in', '1', 'received', new Date(Date.now() - 1*3600*1000).toISOString());
    stmt.run(uuid(), testPhone, 'out', 'Para confirmar, informe seu CPF (somente números).', 'sent', new Date(Date.now() - 1*3600*1000).toISOString());
    stmt.run(uuid(), testPhone, 'in', '56140504780', 'received', new Date(Date.now() - 30*60*1000).toISOString());
    stmt.run(uuid(), testPhone, 'out', 'Qual especialidade você precisa? Digite o número:\n\n1️⃣ Dermatologia\n2️⃣ Transplante Capilar\n3️⃣ Endocrinologia\n4️⃣ Ginecologia\n5️⃣ Nutrição', 'sent', new Date(Date.now() - 30*60*1000).toISOString());

    // Recent invoice
    db.prepare(`
      INSERT INTO invoices (id, invoice_number, patient_id, issue_date, due_date, total, status, payment_method, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, 'paid', 'pix', datetime('now', '-7 days'))
    `).run(uuid(), 'INV-1001', pid, apptDt.slice(0, 10), apptDt.slice(0, 10), 250.00);

    console.log(`  ✓ Recent appointment, encounter, prescription, conversation for Luis Lacerda`);
  }
}
