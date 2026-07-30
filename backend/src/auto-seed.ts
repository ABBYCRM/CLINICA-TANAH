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
  if (userCount > 0) {
    seeded = true;
    return;
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

  // Patients
  const patientData = [
    { full_name: 'José Carlos Pereira', cpf: '12345678901', phone: '+5511987654321', blood_type: 'O+', allergies: ['Penicilina'], chronic: ['Hipertensão', 'Diabetes tipo 2'] },
    { full_name: 'Maria Aparecida Silva', cpf: '23456789012', phone: '+5511956781234', blood_type: 'A+', allergies: [], chronic: ['Osteoporose'] },
    { full_name: 'Pedro Henrique Souza', cpf: '34567890123', phone: '+5511934567890', blood_type: 'B+', allergies: ['Frutos do mar'], chronic: [] },
    { full_name: 'Ana Beatriz Lima', cpf: '45678901234', phone: '+5511923456789', blood_type: 'AB+', allergies: [], chronic: ['Asma leve'] },
    { full_name: 'Lucas Oliveira Santos', cpf: '56789012345', phone: '+5511912345678', blood_type: 'O+', allergies: ['Amendoim'], chronic: [] },
    { full_name: 'Fernanda Costa Rodrigues', cpf: '67890123456', phone: '+5511901234567', blood_type: 'A-', allergies: [], chronic: [] },
    { full_name: 'Ricardo Almeida Filho', cpf: '78901234567', phone: '+5511989012345', blood_type: 'O-', allergies: ['Sulfas'], chronic: ['Hipertensão', 'Colesterol alto'] },
    { full_name: 'Camila Mendes Pereira', cpf: '89012345678', phone: '+5511978901234', blood_type: 'B-', allergies: [], chronic: [] },
    { full_name: 'Gabriel Ferreira Costa', cpf: '90123456789', phone: '+5511967890123', blood_type: 'A+', allergies: [], chronic: [] },
    { full_name: 'Juliana Ribeiro Martins', cpf: '01234567890', phone: '+5511956789012', blood_type: 'AB-', allergies: ['Iodo'], chronic: ['Hipotireoidismo'] },
  ];
  const patientIds: string[] = [];
  const insP = db.prepare(`INSERT INTO patients (id, full_name, birth_date, cpf, phone, address_neighborhood, address_city, address_state, blood_type, allergies, chronic_conditions, medications_in_use, lgpd_consent_at, lgpd_consent_ip, lgpd_consent_version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const p of patientData) {
    const id = uuid();
    patientIds.push(id);
    insP.run(id, p.full_name, '1985-06-15', p.cpf, p.phone, 'Pinheiros', 'São Paulo', 'SP', p.blood_type,
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
}
