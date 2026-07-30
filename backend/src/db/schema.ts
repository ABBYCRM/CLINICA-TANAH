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
    -- SYSTEM SETTINGS (clinic-level config)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
