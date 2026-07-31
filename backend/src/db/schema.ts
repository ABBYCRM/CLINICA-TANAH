/**
 * Clínica Tanah — Database Schema
 * LGPD-aware medical-grade schema for a Brazilian clínica.
 * - Patients: PHI under LGPD (Lei 13.709/2018) + CFM 2.314 ethics code
 * - Inventory: medicines with batch + expiry + ANVISA registry
 * - Accounting: double-entry chart of accounts (Brazilian plano de contas)
 * - Payroll: INSS/IRRF/FGTS fields
 * - LGPD: consent records, audit log, data subject rights
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

function getDbDir(): string {
  return process.env.DB_DIR || path.join(process.cwd(), 'data');
}

function openDb(): Database.Database {
  if (_db) return _db;
  const dir = getDbDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _dbPath = path.join(dir, 'clinica-tanah.db');
  _db = new Database(_dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

export const db = new Proxy({} as Database.Database, {
  get(_t, prop) { return (openDb() as any)[prop]; },
});

export function getDb(): Database.Database { return openDb(); }
export function getDbPath(): string { if (!_dbPath) openDb(); return _dbPath!; }

export function initSchema(): void {
  openDb().exec(`
    -- ============================================================
    -- USERS / STAFF (RBAC for LGPD access control)
    -- ============================================================
    -- ============================================================
    -- TENANTS — one deployment, many clinics (row-level isolation)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      cnpj TEXT,
      address TEXT,
      phone TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','doctor','nurse','receptionist','accountant','pharmacist','dpo')),
      cpf TEXT,                          -- Brazilian tax ID
      council_number TEXT,               -- CRM/COREN/CRC number for the professional
      council_state TEXT,                -- UF (e.g. 'SP')
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- PATIENTS (PHI — special protection under LGPD art. 11)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      social_name TEXT,                  -- nome social
      birth_date TEXT NOT NULL,          -- ISO YYYY-MM-DD
      cpf TEXT UNIQUE,
      rg TEXT,
      gender TEXT,
      phone TEXT NOT NULL,               -- primary, used as WhatsApp ID
      email TEXT,
      address_street TEXT,
      address_number TEXT,
      address_complement TEXT,
      address_neighborhood TEXT,
      address_city TEXT,
      address_state TEXT,
      address_zip TEXT,                  -- CEP
      health_insurance TEXT,             -- convênio
      health_insurance_number TEXT,
      blood_type TEXT,
      allergies TEXT,                    -- JSON array
      chronic_conditions TEXT,           -- JSON array
      medications_in_use TEXT,           -- JSON array
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      lgpd_consent_at TEXT,              -- ISO timestamp of consent
      lgpd_consent_ip TEXT,
      lgpd_consent_version TEXT,         -- version of the privacy policy accepted
      lgpd_opt_out_marketing INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- APPOINTMENTS (WhatsApp bot targets these)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      practitioner_id TEXT NOT NULL REFERENCES users(id),
      scheduled_at TEXT NOT NULL,        -- ISO datetime
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      type TEXT NOT NULL,                -- 'consultation','return','exam','procedure','teleconsultation'
      status TEXT NOT NULL CHECK(status IN ('scheduled','confirmed','arrived','in_progress','completed','cancelled','no_show')),
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'reception',  -- 'whatsapp_bot','reception','phone','website'
      whatsapp_message_id TEXT,
      reminder_24h_sent_at TEXT,
      reminder_2h_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
    CREATE INDEX IF NOT EXISTS idx_appt_practitioner ON appointments(practitioner_id);
    CREATE INDEX IF NOT EXISTS idx_appt_scheduled ON appointments(scheduled_at);

    -- ============================================================
    -- CLINICAL ENCOUNTERS (SOAP notes, prescriptions, exams)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS encounters (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      practitioner_id TEXT NOT NULL REFERENCES users(id),
      appointment_id TEXT REFERENCES appointments(id),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      subjective TEXT,                   -- S of SOAP
      objective TEXT,                    -- O
      assessment TEXT,                   -- A
      plan TEXT,                         -- P
      icd10_codes TEXT,                  -- JSON array of diagnosis codes
      cid10_codes TEXT,                  -- JSON array (CID-10 BR equivalent)
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_enc_patient ON encounters(patient_id);

    CREATE TABLE IF NOT EXISTS prescriptions (
      id TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      practitioner_id TEXT NOT NULL REFERENCES users(id),
      items TEXT NOT NULL,               -- JSON: [{medication, dosage, frequency, duration, instructions}]
      pdf_path TEXT,                     -- optional generated PDF path
      sent_via_whatsapp INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- VENDORS (Suppliers) — for inventory & accounting
    -- ============================================================
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      legal_name TEXT NOT NULL,          -- razão social
      trade_name TEXT,                   -- nome fantasia
      cnpj TEXT UNIQUE NOT NULL,         -- Brazilian company tax ID
      state_registration TEXT,           -- IE
      phone TEXT,
      email TEXT,
      contact_name TEXT,
      bank_info TEXT,                    -- JSON: banco, agência, conta, pix
      anvisa_license TEXT,               -- for medicine distributors
      address_zip TEXT,
      address_street TEXT,
      address_number TEXT,
      address_city TEXT,
      address_state TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- INVENTORY (Items + Stock + Batches with expiry)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,            -- 'medication','supply','equipment','consumable'
      unit TEXT NOT NULL,                -- 'box','unit','ml','g','ampoule'
      anvisa_registry TEXT,              -- registro ANVISA for medications
      controlled INTEGER NOT NULL DEFAULT 0,  -- controlled substance (Portaria 344/98)
      min_stock REAL NOT NULL DEFAULT 0,
      max_stock REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0,  -- in BRL cents? use REAL for simplicity
      sale_price REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory_batches (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      batch_number TEXT NOT NULL,
      expiry_date TEXT NOT NULL,         -- ISO YYYY-MM-DD
      quantity REAL NOT NULL,
      vendor_id TEXT REFERENCES vendors(id),
      purchase_order_id TEXT,
      cost_per_unit REAL NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_batch_item ON inventory_batches(item_id);
    CREATE INDEX IF NOT EXISTS idx_batch_expiry ON inventory_batches(expiry_date);

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      batch_id TEXT REFERENCES inventory_batches(id),
      movement_type TEXT NOT NULL CHECK(movement_type IN ('in','out','adjust','transfer','discard')),
      quantity REAL NOT NULL,            -- positive for in, negative for out
      reason TEXT,                       -- 'purchase','sale','prescription_dispense','loss','expiry','manual'
      reference_id TEXT,                 -- PO id, encounter id, etc.
      user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mvmt_item ON stock_movements(item_id);

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      po_number TEXT UNIQUE NOT NULL,
      vendor_id TEXT NOT NULL REFERENCES vendors(id),
      status TEXT NOT NULL CHECK(status IN ('draft','sent','confirmed','received','cancelled')),
      total REAL NOT NULL DEFAULT 0,
      notes TEXT,
      expected_delivery TEXT,
      received_at TEXT,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS purchase_order_lines (
      id TEXT PRIMARY KEY,
      po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES inventory_items(id),
      quantity REAL NOT NULL,
      unit_cost REAL NOT NULL,
      received_quantity REAL NOT NULL DEFAULT 0
    );

    -- ============================================================
    -- ACCOUNTING — double-entry chart of accounts + ledger
    -- ============================================================
    CREATE TABLE IF NOT EXISTS chart_of_accounts (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,         -- e.g. '1.1.01.001'
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','revenue','expense')),
      parent_id TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      entry_number TEXT UNIQUE NOT NULL,
      entry_date TEXT NOT NULL,
      description TEXT NOT NULL,
      reference_type TEXT,               -- 'invoice','payment','payroll','po','manual'
      reference_id TEXT,
      total_debit REAL NOT NULL,
      total_credit REAL NOT NULL,
      posted INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_je_date ON journal_entries(entry_date);

    CREATE TABLE IF NOT EXISTS journal_lines (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      cost_center TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT UNIQUE NOT NULL,
      patient_id TEXT REFERENCES patients(id),
      vendor_id TEXT REFERENCES vendors(id),
      encounter_id TEXT REFERENCES encounters(id),
      issue_date TEXT NOT NULL,
      due_date TEXT,
      total REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','issued','paid','overdue','cancelled')),
      payment_method TEXT,
      paid_at TEXT,
      nf_e_key TEXT,                     -- NF-e access key (Brazilian electronic invoice)
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS invoice_lines (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      tax_rate REAL NOT NULL DEFAULT 0
    );

    -- ============================================================
    -- PAYROLL (Brazilian INSS/IRRF/FGTS/13º/férias)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      full_name TEXT NOT NULL,
      cpf TEXT UNIQUE NOT NULL,
      pis TEXT,                          -- PIS/PASEP
      ctps_number TEXT,                  -- CTPS
      ctps_series TEXT,
      role TEXT NOT NULL,                -- 'doctor','nurse','receptionist','cleaner', etc.
      admission_date TEXT NOT NULL,
      termination_date TEXT,
      base_salary REAL NOT NULL,
      weekly_hours REAL NOT NULL DEFAULT 44,
      health_insurance_discount REAL NOT NULL DEFAULT 0,
      other_discounts REAL NOT NULL DEFAULT 0,
      dependents INTEGER NOT NULL DEFAULT 0,
      bank_account TEXT,                 -- JSON
      vale_transporte INTEGER NOT NULL DEFAULT 0,
      vt_monthly_cost REAL NOT NULL DEFAULT 0,
      night_shift INTEGER NOT NULL DEFAULT 0,
      cbo_code TEXT,
      esocial_category TEXT DEFAULT '101',
      contract_type TEXT DEFAULT 'clt',
      registration_number TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payroll_runs (
      id TEXT PRIMARY KEY,
      period TEXT NOT NULL,              -- 'YYYY-MM'
      type TEXT NOT NULL CHECK(type IN ('monthly','13th_first','13th_second','vacation','termination')),
      status TEXT NOT NULL CHECK(status IN ('draft','approved','paid','cancelled')),
      total_gross REAL NOT NULL DEFAULT 0,
      total_net REAL NOT NULL DEFAULT 0,
      total_inss REAL NOT NULL DEFAULT 0,
      total_irrf REAL NOT NULL DEFAULT 0,
      total_fgts REAL NOT NULL DEFAULT 0,
      paid_at TEXT,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payslips (
      id TEXT PRIMARY KEY,
      payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES employees(id),
      base_salary REAL NOT NULL,
      gross_earnings REAL NOT NULL,
      inss_deduction REAL NOT NULL DEFAULT 0,
      irrf_deduction REAL NOT NULL DEFAULT 0,
      other_deductions REAL NOT NULL DEFAULT 0,
      net_pay REAL NOT NULL,
      fgts_deposit REAL NOT NULL DEFAULT 0,
      worked_days INTEGER NOT NULL DEFAULT 30,
      json_breakdown TEXT                -- JSON with full line-by-line
    );

    -- ============================================================
    -- LGPD — Consent, Audit, Data Subject Rights
    -- ============================================================
    CREATE TABLE IF NOT EXISTS lgpd_consents (
      id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,        -- 'patient','employee','vendor'
      subject_id TEXT NOT NULL,
      consent_type TEXT NOT NULL,        -- 'data_processing','marketing','whatsapp_communication','health_data_processing'
      granted INTEGER NOT NULL,          -- 1 = yes, 0 = no
      policy_version TEXT NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      ip_address TEXT,
      user_agent TEXT,
      evidence TEXT                      -- JSON: exact text the subject accepted
    );
    CREATE INDEX IF NOT EXISTS idx_consent_subject ON lgpd_consents(subject_type, subject_id);

    CREATE TABLE IF NOT EXISTS lgpd_data_requests (
      id TEXT PRIMARY KEY,
      request_type TEXT NOT NULL CHECK(request_type IN ('access','rectification','deletion','portability','opposition')),
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open','processing','fulfilled','rejected')),
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      fulfilled_at TEXT,
      response_notes TEXT,
      handled_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,              -- 'create_patient','view_medical_record','update_inventory', etc.
      resource_type TEXT,                -- 'patient','appointment','encounter','inventory_item', etc.
      resource_id TEXT,
      before_value TEXT,                 -- JSON snapshot
      after_value TEXT,                  -- JSON snapshot
      ip_address TEXT,
      user_agent TEXT,
      lgpd_legal_basis TEXT,             -- art. 7º I (consent), V (contract), VI (legal obligation), IX (vital interest), X (public interest), II (legitimate interest)
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(created_at);

    -- ============================================================
    -- WHATSAPP — Conversation state per patient
    -- ============================================================
    CREATE TABLE IF NOT EXISTS whatsapp_conversations (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      patient_id TEXT REFERENCES patients(id),
      state TEXT NOT NULL DEFAULT 'idle',  -- 'idle','awaiting_booking_specialty','awaiting_booking_date','awaiting_booking_time','awaiting_cpf','awaiting_consent','lgpd_optout'
      context TEXT,                      -- JSON: temporary state data
      last_message_at TEXT,
      lgpd_consent_granted INTEGER NOT NULL DEFAULT 0,
      opted_out INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(phone)
    );

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('in','out')),
      body TEXT NOT NULL,
      wa_message_id TEXT,
      status TEXT,                       -- 'sent','delivered','read','failed'
      related_appointment_id TEXT REFERENCES appointments(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wamsg_phone ON whatsapp_messages(phone);

    -- ============================================================
    -- SATISFACTION SURVEYS (NPS pós-consulta via WhatsApp bot)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS satisfaction_surveys (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      appointment_id TEXT REFERENCES appointments(id),
      score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 10),
      comment TEXT,
      source TEXT NOT NULL DEFAULT 'whatsapp_bot',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(appointment_id)              -- one survey per appointment
    );
    CREATE INDEX IF NOT EXISTS idx_survey_patient ON satisfaction_surveys(patient_id);

    -- ============================================================
    -- CAMPAIGNS / PROMOTIONS (customer appreciation day blasts)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      message TEXT NOT NULL,             -- opt-out footer appended automatically
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sending','sent','failed')),
      audience TEXT NOT NULL DEFAULT 'all_consented',
      scheduled_for TEXT,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      dispatched_at TEXT
    );

    -- ============================================================
    -- WHATSAPP MARKETING — Meta-style templates + clinic automations
    -- ============================================================
    CREATE TABLE IF NOT EXISTS wa_templates (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('marketing','utility','authentication')),
      language TEXT NOT NULL DEFAULT 'pt_BR',
      body TEXT NOT NULL,
      header TEXT,
      footer TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','rejected')),
      meta_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wa_templates_tenant ON wa_templates(tenant_id);

    CREATE TABLE IF NOT EXISTS wa_automations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL,
      template_id TEXT REFERENCES wa_templates(id),
      config TEXT,                       -- JSON: offset_hours, inactive_days, etc.
      last_run_at TEXT,
      last_sent_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_wa_automations_tenant ON wa_automations(tenant_id);

    -- ============================================================
    -- API TOKENS — programmatic access to the whole CRM
    -- ============================================================
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,              -- display hint: ct_a1b2c3…
      token_hash TEXT UNIQUE NOT NULL,   -- sha256 hex; plaintext is shown once
      scope TEXT NOT NULL DEFAULT 'read_write' CHECK(scope IN ('read','read_write')),
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      expires_at TEXT,
      revoked_at TEXT
    );

    -- ============================================================
    -- SYSTEM SETTINGS (clinic-level config)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  migrate();
}

/** Fixed id of the tenant that owns all pre-multitenancy data. */
export const DEFAULT_TENANT_ID = 't_clinica_tanah';

/**
 * Idempotent column migrations for existing databases.
 * CREATE TABLE IF NOT EXISTS never alters live tables — add new
 * MedX-parity patient fields here when they're missing.
 */
function migrate(): void {
  const patientCols = [
    `ALTER TABLE patients ADD COLUMN rg_issuer TEXT`,
    `ALTER TABLE patients ADD COLUMN marital_status TEXT`,
    `ALTER TABLE patients ADD COLUMN occupation TEXT`,
    `ALTER TABLE patients ADD COLUMN education_level TEXT`,
    `ALTER TABLE patients ADD COLUMN nationality TEXT`,
    `ALTER TABLE patients ADD COLUMN birthplace TEXT`,
    `ALTER TABLE patients ADD COLUMN mother_name TEXT`,
    `ALTER TABLE patients ADD COLUMN father_name TEXT`,
    `ALTER TABLE patients ADD COLUMN race_color TEXT`,
    `ALTER TABLE patients ADD COLUMN cns TEXT`, // Cartão SUS
    `ALTER TABLE patients ADD COLUMN phone_secondary TEXT`,
    `ALTER TABLE patients ADD COLUMN referral_source TEXT`,
    `ALTER TABLE patients ADD COLUMN notes TEXT`,
  ];
  for (const sql of patientCols) {
    try { openDb().exec(sql); } catch { /* column already exists */ }
  }

  // ---- Multi-tenancy: default tenant owns everything that predates it
  openDb().prepare(`
    INSERT OR IGNORE INTO tenants (id, slug, name, address, phone)
    VALUES (?, 'clinica-tanah', 'Clínica Tanah',
            'Rua Augusta, 1234 — Consolação, São Paulo / SP — CEP 01304-001', '+55 11 3000-0000')
  `).run(DEFAULT_TENANT_ID);

  const tenantTables = [
    'users', 'patients', 'appointments', 'encounters', 'prescriptions',
    'vendors', 'inventory_items', 'inventory_batches', 'stock_movements',
    'purchase_orders', 'chart_of_accounts', 'journal_entries', 'invoices',
    'employees', 'payroll_runs', 'payslips',
    'lgpd_consents', 'lgpd_data_requests',
    'whatsapp_conversations', 'whatsapp_messages',
    'satisfaction_surveys', 'campaigns', 'api_tokens', 'audit_log',
  ];
  for (const table of tenantTables) {
    try {
      openDb().exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}'`);
    } catch { /* column already exists */ }
  }
  try { openDb().exec(`ALTER TABLE users ADD COLUMN is_superadmin INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE employees ADD COLUMN vale_transporte INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE employees ADD COLUMN vt_monthly_cost REAL NOT NULL DEFAULT 0`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE employees ADD COLUMN night_shift INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE employees ADD COLUMN cbo_code TEXT`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE employees ADD COLUMN esocial_category TEXT DEFAULT '101'`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE employees ADD COLUMN contract_type TEXT DEFAULT 'clt'`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE employees ADD COLUMN registration_number TEXT`); } catch { /* exists */ }
  try { openDb().exec(`CREATE INDEX IF NOT EXISTS idx_patients_tenant ON patients(tenant_id)`); } catch { /* exists */ }
  try { openDb().exec(`CREATE INDEX IF NOT EXISTS idx_appt_tenant ON appointments(tenant_id)`); } catch { /* exists */ }

  // Campaign audience / template linkage for marketing blasts
  try { openDb().exec(`ALTER TABLE campaigns ADD COLUMN template_id TEXT`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE campaigns ADD COLUMN category TEXT NOT NULL DEFAULT 'marketing'`); } catch { /* exists */ }

  // Ensure marketing tables exist on DBs created before this migration
  openDb().exec(`
    CREATE TABLE IF NOT EXISTS wa_templates (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('marketing','utility','authentication')),
      language TEXT NOT NULL DEFAULT 'pt_BR',
      body TEXT NOT NULL,
      header TEXT,
      footer TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','rejected')),
      meta_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS wa_automations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL,
      template_id TEXT REFERENCES wa_templates(id),
      config TEXT,
      last_run_at TEXT,
      last_sent_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, key)
    );
  `);

  // Invoice document attachments + NVIDIA OCR metadata
  openDb().exec(`
    CREATE TABLE IF NOT EXISTS invoice_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      storage_path TEXT NOT NULL,
      ocr_status TEXT NOT NULL DEFAULT 'pending'
        CHECK(ocr_status IN ('pending','processing','done','failed','skipped')),
      ocr_model TEXT,
      ocr_raw_text TEXT,
      ocr_json TEXT,
      ocr_error TEXT,
      uploaded_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_inv_docs_invoice ON invoice_documents(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_inv_docs_tenant ON invoice_documents(tenant_id);
  `);
  try { openDb().exec(`ALTER TABLE invoices ADD COLUMN ocr_last_at TEXT`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE invoices ADD COLUMN document_count INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }

  seedMarketingDefaults(DEFAULT_TENANT_ID);
}

/** Seed clinic marketing templates + automations once per tenant (idempotent). */
export function seedMarketingDefaults(tenantId: string): void {
  const db = openDb();
  const hasTpl = (db.prepare(`SELECT COUNT(*) AS c FROM wa_templates WHERE tenant_id = ?`).get(tenantId) as any).c;
  if (hasTpl === 0) {
    const templates: Array<[string, string, string, string, string]> = [
      ['tpl_welcome', 'Boas-vindas', 'utility',
        'Olá {{name}}! Bem-vindo(a) à Clínica Tanah. Estamos felizes em cuidar de você. Responda MENU para agendar.', 'approved'],
      ['tpl_reminder_24h', 'Lembrete 24h', 'utility',
        'Olá {{name}}! Lembrete: sua consulta está marcada para amanhã ({{date}} às {{time}}). Responda 1 para confirmar ou 2 para remarcar.', 'approved'],
      ['tpl_reminder_2h', 'Lembrete 2h', 'utility',
        'Olá {{name}}! Sua consulta é hoje às {{time}}. Estamos te esperando na Clínica Tanah.', 'approved'],
      ['tpl_promo', 'Campanha promocional', 'marketing',
        'Olá {{name}}! 💙 Semana especial na Clínica Tanah: condições exclusivas para você. Agende pelo WhatsApp. Responda SAIR para não receber promoções.', 'approved'],
      ['tpl_birthday', 'Aniversário', 'marketing',
        'Feliz aniversário, {{name}}! 🎂 A Clínica Tanah deseja um dia maravilhoso. Ganhe 10% de desconto em consultas este mês — responda MENU para agendar.', 'approved'],
      ['tpl_nps', 'Pesquisa NPS', 'utility',
        'Olá {{name}}! Como foi sua experiência conosco? Responda com uma nota de 0 a 10.', 'approved'],
      ['tpl_noshow', 'Falta / no-show', 'utility',
        'Olá {{name}}, sentimos sua falta na consulta de {{date}}. Quer remarcar? Responda MENU ou ligue para a clínica.', 'approved'],
      ['tpl_reengage', 'Reativação', 'marketing',
        'Olá {{name}}! Faz um tempo que não nos vemos. Que tal agendar um check-up na Clínica Tanah? Responda MENU. SAIR para optar por sair.', 'approved'],
      ['tpl_payment', 'Lembrete de pagamento', 'utility',
        'Olá {{name}}! Identificamos uma fatura em aberto ({{invoice}}). Podemos ajudar com o pagamento? Responda esta mensagem ou fale com a recepção.', 'approved'],
    ];
    const ins = db.prepare(`
      INSERT OR IGNORE INTO wa_templates (id, tenant_id, name, category, language, body, status, meta_name)
      VALUES (?, ?, ?, ?, 'pt_BR', ?, ?, ?)
    `);
    for (const [id, name, cat, body, status] of templates) {
      ins.run(`${id}_${tenantId}`, tenantId, name, cat, body, status, id);
    }
  }

  const hasAuto = (db.prepare(`SELECT COUNT(*) AS c FROM wa_automations WHERE tenant_id = ?`).get(tenantId) as any).c;
  if (hasAuto === 0) {
    const autos: Array<[string, string, string, string, string, object]> = [
      ['reminder_24h', 'Lembrete 24 horas antes', 'Envia lembrete utilitário 24h antes da consulta confirmada/agendada.',
        'Olá {{name}}! Lembrete: sua consulta está marcada para amanhã ({{date}} às {{time}}). Responda 1 para confirmar ou 2 para remarcar.',
        JSON.stringify({ offset_hours: 24 }), { enabled: 1 }],
      ['reminder_2h', 'Lembrete 2 horas antes', 'Lembrete curto no dia da consulta.',
        'Olá {{name}}! Sua consulta é hoje às {{time}}. Estamos te esperando na Clínica Tanah.',
        JSON.stringify({ offset_hours: 2 }), { enabled: 1 }],
      ['welcome', 'Boas-vindas a novos pacientes', 'Disparada quando um paciente é cadastrado com telefone e consentimento.',
        'Olá {{name}}! Bem-vindo(a) à Clínica Tanah. Responda MENU para agendar sua primeira consulta.',
        JSON.stringify({}), { enabled: 1 }],
      ['birthday', 'Feliz aniversário', 'Mensagem de aniversário (marketing) para pacientes consentidos.',
        'Feliz aniversário, {{name}}! 🎂 A Clínica Tanah deseja um dia maravilhoso. Responda MENU para agendar.',
        JSON.stringify({}), { enabled: 0 }],
      ['no_show', 'Follow-up de falta', 'Contato após consulta marcada como no_show.',
        'Olá {{name}}, sentimos sua falta na consulta de {{date}}. Quer remarcar? Responda MENU.',
        JSON.stringify({ lookback_days: 3 }), { enabled: 1 }],
      ['inactive_90d', 'Reengajamento 90 dias', 'Pacientes sem consulta nos últimos 90 dias.',
        'Olá {{name}}! Faz um tempo que não nos vemos. Que tal um check-up? Responda MENU. SAIR para optar por sair.',
        JSON.stringify({ inactive_days: 90 }), { enabled: 0 }],
      ['nps_auto', 'NPS automático pós-consulta', 'Pesquisa de satisfação após consultas concluídas (últimas 48h).',
        'Olá {{name}}! Como foi sua experiência conosco? Responda com uma nota de 0 a 10.',
        JSON.stringify({ within_hours: 48 }), { enabled: 1 }],
      ['payment_reminder', 'Lembrete de fatura', 'Faturas emitidas/atrasadas com paciente vinculado.',
        'Olá {{name}}! Há uma fatura em aberto ({{invoice}}). Podemos ajudar? Fale com a recepção.',
        JSON.stringify({}), { enabled: 0 }],
    ];
    const insA = db.prepare(`
      INSERT OR IGNORE INTO wa_automations
        (id, tenant_id, key, name, description, enabled, message, config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [key, name, desc, message, config, flags] of autos) {
      insA.run(`auto_${key}_${tenantId}`, tenantId, key, name, desc, (flags as any).enabled ? 1 : 0, message, config);
    }
  }
}
