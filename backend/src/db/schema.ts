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
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { migratePhiAtRest } from '../services/phiCrypto';

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
      status TEXT NOT NULL DEFAULT 'active', -- active | cancelled (CFM retention)
      cancelled_at TEXT,
      cancelled_by TEXT,
      cancel_reason TEXT,
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
      status TEXT NOT NULL DEFAULT 'active', -- active | cancelled (CFM retention — never hard-delete)
      cancelled_at TEXT,
      cancelled_by TEXT,
      cancel_reason TEXT,
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

    -- ============================================================
    -- SAVED APPS — per-user bookmarks/shortcuts to external URLs
    -- ============================================================
    CREATE TABLE IF NOT EXISTS user_apps (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_apps_owner ON user_apps(tenant_id, user_id);
  `);

  migrate();
}

/** Fixed id of the tenant that owns all pre-multitenancy data. */
export const DEFAULT_TENANT_ID = 't_clinica_tanah';

/** Sole production login — username "Juliana". Password from env in prod. */
export const PRIMARY_USER_ID = 'u_juliana';
export const PRIMARY_USER_EMAIL = 'juliana@clinica-tanah.com.br';
export const PRIMARY_USER_NAME = 'Juliana';
/** Demo/e2e default only — never force-reset in production unless ALLOW_DEMO_PASSWORD_RESET=1 */
export const PRIMARY_USER_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || '1234';

/**
 * Ensure the primary admin account exists.
 * In production: create if missing; do NOT reset password on every boot
 * (LGPD art. 46 — credential integrity). Demo/e2e may reset when allowed.
 */
export function ensurePrimaryAccount(): void {
  const db = openDb();
  const allowReset =
    process.env.ALLOW_DEMO_PASSWORD_RESET === '1'
    || !!process.env.ADMIN_BOOTSTRAP_PASSWORD
    || process.env.NODE_ENV !== 'production';
  const hash = bcrypt.hashSync(PRIMARY_USER_PASSWORD, 10);

  let keep = db.prepare(`
    SELECT id, password_hash FROM users
    WHERE id = ? OR lower(email) = lower(?) OR lower(full_name) = lower(?)
    ORDER BY CASE WHEN id = ? THEN 0 WHEN lower(email) = lower(?) THEN 1 ELSE 2 END
    LIMIT 1
  `).get(
    PRIMARY_USER_ID, PRIMARY_USER_EMAIL, PRIMARY_USER_NAME,
    PRIMARY_USER_ID, PRIMARY_USER_EMAIL,
  ) as { id: string; password_hash?: string } | undefined;

  if (!keep) {
    keep = db.prepare(`
      SELECT id, password_hash FROM users
      WHERE tenant_id = ? AND (is_superadmin = 1 OR role = 'admin')
      ORDER BY is_superadmin DESC
      LIMIT 1
    `).get(DEFAULT_TENANT_ID) as { id: string; password_hash?: string } | undefined;
  }

  if (keep) {
    if (allowReset) {
      db.prepare(`
        UPDATE users SET
          email = ?, password_hash = ?, full_name = ?,
          role = 'admin', is_superadmin = 1, active = 1,
          tenant_id = COALESCE(tenant_id, ?)
        WHERE id = ?
      `).run(PRIMARY_USER_EMAIL, hash, PRIMARY_USER_NAME, DEFAULT_TENANT_ID, keep.id);
    } else {
      db.prepare(`
        UPDATE users SET
          email = ?, full_name = ?,
          role = 'admin', is_superadmin = 1, active = 1,
          tenant_id = COALESCE(tenant_id, ?)
        WHERE id = ?
      `).run(PRIMARY_USER_EMAIL, PRIMARY_USER_NAME, DEFAULT_TENANT_ID, keep.id);
    }
  } else {
    db.prepare(`
      INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, active, is_superadmin)
      VALUES (?, ?, ?, ?, ?, 'admin', 1, 1)
    `).run(PRIMARY_USER_ID, DEFAULT_TENANT_ID, PRIMARY_USER_EMAIL, hash, PRIMARY_USER_NAME);
    keep = { id: PRIMARY_USER_ID };
  }

  const keepId = keep.id;
  const others = db.prepare(`
    SELECT id FROM users
    WHERE id != ?
      AND (tenant_id = ? OR tenant_id IS NULL OR lower(email) LIKE '%@clinica-tanah.com.br')
  `).all(keepId, DEFAULT_TENANT_ID) as Array<{ id: string }>;

  if (others.length === 0) return;

  const reassign = (sql: string) => {
    const stmt = db.prepare(sql);
    for (const o of others) stmt.run(keepId, o.id);
  };

  reassign(`UPDATE appointments SET practitioner_id = ? WHERE practitioner_id = ?`);
  reassign(`UPDATE encounters SET practitioner_id = ? WHERE practitioner_id = ?`);
  reassign(`UPDATE prescriptions SET practitioner_id = ? WHERE practitioner_id = ?`);
  reassign(`UPDATE stock_movements SET user_id = ? WHERE user_id = ?`);
  try { reassign(`UPDATE purchase_orders SET created_by = ? WHERE created_by = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE journal_entries SET created_by = ? WHERE created_by = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE payroll_runs SET created_by = ? WHERE created_by = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE lgpd_data_requests SET handled_by = ? WHERE handled_by = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE api_tokens SET created_by = ? WHERE created_by = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE invoice_documents SET uploaded_by = ? WHERE uploaded_by = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE patients SET assigned_professional_id = ? WHERE assigned_professional_id = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE patient_tasks SET assigned_to = ? WHERE assigned_to = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE patient_tasks SET created_by = ? WHERE created_by = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE service_tickets SET assigned_to = ? WHERE assigned_to = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE service_tickets SET created_by = ? WHERE created_by = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE patient_documents SET created_by = ? WHERE created_by = ?`); } catch { /* optional */ }
  try { reassign(`UPDATE audit_log SET actor_id = ? WHERE actor_id = ?`); } catch { /* optional */ }

  for (const o of others) {
    db.prepare(`DELETE FROM users WHERE id = ?`).run(o.id);
  }
}

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
    `ALTER TABLE patients ADD COLUMN lifecycle_stage TEXT NOT NULL DEFAULT 'new_patient'`,
    `ALTER TABLE patients ADD COLUMN preferred_language TEXT DEFAULT 'pt-BR'`,
    `ALTER TABLE patients ADD COLUMN assigned_professional_id TEXT`,
    `ALTER TABLE patients ADD COLUMN welcome_message_sent_at TEXT`,
    `ALTER TABLE patients ADD COLUMN first_completed_visit_at TEXT`,
    `ALTER TABLE patients ADD COLUMN last_visit_at TEXT`,
    `ALTER TABLE patients ADD COLUMN recall_due_at TEXT`,
    `ALTER TABLE patients ADD COLUMN do_not_contact INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE patients ADD COLUMN open_complaint INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE patients ADD COLUMN tags TEXT`,
  ];
  for (const sql of patientCols) {
    try { openDb().exec(sql); } catch { /* column already exists */ }
  }

  try {
    openDb().exec(`
      CREATE TABLE IF NOT EXISTS patient_timeline_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT,
        status TEXT,
        meta TEXT,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    openDb().exec(`CREATE INDEX IF NOT EXISTS idx_pte_patient ON patient_timeline_events(patient_id, occurred_at)`);
    openDb().exec(`CREATE INDEX IF NOT EXISTS idx_pte_tenant ON patient_timeline_events(tenant_id)`);
  } catch { /* exists */ }

  // Patient Workspace Phase 2 — tasks, service tickets, documents
  openDb().exec(`
    CREATE TABLE IF NOT EXISTS patient_tasks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'follow_up',
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'open',
      due_at TEXT,
      assigned_to TEXT,
      created_by TEXT,
      related_ticket_id TEXT,
      related_appointment_id TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ptasks_patient ON patient_tasks(patient_id, status);
    CREATE INDEX IF NOT EXISTS idx_ptasks_tenant ON patient_tasks(tenant_id, status);

    CREATE TABLE IF NOT EXISTS service_tickets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'patient_experience',
      priority TEXT NOT NULL DEFAULT 'high',
      status TEXT NOT NULL DEFAULT 'open',
      title TEXT NOT NULL,
      description TEXT,
      survey_id TEXT,
      survey_score INTEGER,
      assigned_to TEXT,
      resolution TEXT,
      outcome TEXT,
      marketing_paused INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stickets_patient ON service_tickets(patient_id, status);
    CREATE INDEX IF NOT EXISTS idx_stickets_tenant ON service_tickets(tenant_id, status);

    CREATE TABLE IF NOT EXISTS patient_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'form',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      signed_at TEXT,
      file_url TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pdocs_patient ON patient_documents(patient_id);
  `);
  try { openDb().exec(`ALTER TABLE patients ADD COLUMN recall_interval_days INTEGER`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE patients ADD COLUMN recall_notified_at TEXT`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE patients ADD COLUMN guardian_name TEXT`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE patients ADD COLUMN guardian_phone TEXT`); } catch { /* exists */ }
  try { openDb().exec(`ALTER TABLE patients ADD COLUMN guardian_relationship TEXT`); } catch { /* exists */ }

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

  // Public intake forms — Brazilian LGPD / TCPA-style consent with proof pixel
  openDb().exec(`
    CREATE TABLE IF NOT EXISTS intake_forms (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      policy_version TEXT NOT NULL DEFAULT '1.0',
      consent_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_intake_forms_tenant ON intake_forms(tenant_id, active);

    CREATE TABLE IF NOT EXISTS intake_submissions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      form_id TEXT NOT NULL,
      patient_id TEXT,
      full_name TEXT NOT NULL,
      birth_date TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      cpf TEXT,
      city TEXT,
      state TEXT,
      notes TEXT,
      payload TEXT,
      consent_lgpd INTEGER NOT NULL DEFAULT 0,
      consent_whatsapp INTEGER NOT NULL DEFAULT 0,
      consent_marketing INTEGER NOT NULL DEFAULT 0,
      consent_calls INTEGER NOT NULL DEFAULT 0,
      self_attested INTEGER NOT NULL DEFAULT 0,
      ip_address TEXT,
      user_agent TEXT,
      pixel_token TEXT UNIQUE,
      pixel_viewed_at TEXT,
      pixel_submitted_at TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_intake_sub_form ON intake_submissions(form_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_intake_sub_tenant ON intake_submissions(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_intake_sub_pixel ON intake_submissions(pixel_token);
  `);
  // Intake form kind + field template JSON; invite send log (before seed)
  for (const sql of [
    `ALTER TABLE intake_forms ADD COLUMN kind TEXT NOT NULL DEFAULT 'cadastro'`,
    `ALTER TABLE intake_forms ADD COLUMN fields_json TEXT`,
  ]) {
    try { openDb().exec(sql); } catch { /* exists */ }
  }
  openDb().exec(`
    CREATE TABLE IF NOT EXISTS intake_invites (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      form_id TEXT NOT NULL,
      patient_id TEXT,
      full_name TEXT,
      email TEXT,
      phone TEXT,
      channel TEXT NOT NULL DEFAULT 'email',
      status TEXT NOT NULL DEFAULT 'pending',
      link TEXT,
      error TEXT,
      mailto_url TEXT,
      sent_by TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_intake_inv_tenant ON intake_invites(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_intake_inv_form ON intake_invites(form_id, created_at);
  `);

  ensureDefaultIntakeForm(DEFAULT_TENANT_ID);
  ensurePreTriageIntakeForm(DEFAULT_TENANT_ID);

  seedMarketingDefaults(DEFAULT_TENANT_ID);
  ensureRecallAutomation(DEFAULT_TENANT_ID);
  ensurePrimaryAccount();

  // Encrypt existing plaintext PHI at rest (idempotent) — LGPD art. 46
  try {
    const stats = migratePhiAtRest(openDb());
    const n = stats.patients + stats.encounters + stats.prescriptions + stats.intake;
    if (n > 0) console.log(`🔐 PHI at-rest encryption migrated: ${JSON.stringify(stats)}`);
  } catch (e: any) {
    console.warn('PHI encryption migrate skipped:', e?.message || e);
  }
}

function ensureDefaultIntakeForm(tenantId: string): void {
  const db = openDb();
  const exists = db.prepare(`SELECT id FROM intake_forms WHERE tenant_id = ? AND slug = 'cadastro-paciente'`).get(tenantId) as any;
  if (exists) {
    try {
      db.prepare(`UPDATE intake_forms SET kind = COALESCE(kind, 'cadastro') WHERE id = ?`).run(exists.id);
    } catch { /* kind col may not exist yet on first pass */ }
    return;
  }
  const consent =
    'Declaro que sou a pessoa identificada neste formulário e autorizo a Clínica Tanah a tratar meus dados pessoais e de saúde conforme a LGPD (Lei 13.709/2018), para cadastro, atendimento e comunicações administrativas. Autorizo, se marcado abaixo, o contato via WhatsApp, SMS e telefone para lembretes, confirmações e mensagens de marketing, podendo revogar a qualquer momento respondendo SAIR ou solicitando à clínica.';
  db.prepare(`
    INSERT INTO intake_forms (id, tenant_id, name, slug, description, active, policy_version, consent_text, kind)
    VALUES (?, ?, 'Cadastro do paciente', 'cadastro-paciente',
      'Formulário público de cadastro com prova de preenchimento pelo próprio paciente (pixel + IP/UA) — conformidade LGPD / consentimento para comunicações (equivalente TCPA no Brasil).',
      1, '1.0', ?, 'cadastro')
  `).run(`form_cadastro_${tenantId}`, tenantId, consent);
}

function ensurePreTriageIntakeForm(tenantId: string): void {
  const db = openDb();
  const exists = db.prepare(`SELECT id FROM intake_forms WHERE tenant_id = ? AND slug = 'pre-triagem-paciente'`).get(tenantId);
  if (exists) return;
  // Dynamic import avoided — inline consent from template semantics
  const consent =
    'Declaro que sou a pessoa identificada neste formulário de pré-triagem / pré-consulta e autorizo a Clínica Tanah a tratar meus dados pessoais e de saúde conforme a LGPD (Lei 13.709/2018), para cadastro, avaliação clínica inicial, atendimento e comunicações administrativas. '
    + 'Entendo que este formulário NÃO substitui atendimento de urgência/emergência: em caso de dor no peito, falta de ar intensa, sangramento grave, febre muito alta, déficit neurológico ou reação alérgica grave, devo procurar serviço de emergência (SAMU 192 / PS). '
    + 'Autorizo, se marcado abaixo, contato via WhatsApp, SMS e telefone para lembretes e confirmações, podendo revogar a qualquer momento (SAIR no WhatsApp ou solicitação à clínica).';
  try {
    db.prepare(`
      INSERT INTO intake_forms (id, tenant_id, name, slug, description, active, policy_version, consent_text, kind)
      VALUES (?, ?, 'Pré-triagem / novo paciente', 'pre-triagem-paciente',
        'Pré-cadastro e pré-triagem clínica para novos pacientes: queixa, alergias, medicações, comorbidades e sinais de alerta. Pode ser enviado por e-mail antes da consulta.',
        1, '1.1', ?, 'pre_triage')
    `).run(`form_pretriagem_${tenantId}`, tenantId, consent);
  } catch (e: any) {
    // kind column might not exist on very first create before ALTER — retry without kind
    try {
      db.prepare(`
        INSERT INTO intake_forms (id, tenant_id, name, slug, description, active, policy_version, consent_text)
        VALUES (?, ?, 'Pré-triagem / novo paciente', 'pre-triagem-paciente',
          'Pré-cadastro e pré-triagem clínica para novos pacientes.',
          1, '1.1', ?)
      `).run(`form_pretriagem_${tenantId}`, tenantId, consent);
      try { db.prepare(`UPDATE intake_forms SET kind = 'pre_triage' WHERE slug = 'pre-triagem-paciente' AND tenant_id = ?`).run(tenantId); } catch { /* */ }
    } catch { /* duplicate */ }
  }
}

function ensureRecallAutomation(tenantId: string): void {
  const db = openDb();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO wa_automations
        (id, tenant_id, key, name, description, enabled, message, config)
      VALUES (?, ?, 'recall', 'Recall / acompanhamento',
        'Avisa pacientes com recall_due_at nos próximos 30 dias (sem citar procedimento).',
        1,
        'Olá {{name}}. Já está próximo do período recomendado para seu próximo acompanhamento na Clínica Tanah. Gostaria de verificar horários disponíveis?',
        ?)
    `).run(
      `auto_recall_${tenantId}`,
      tenantId,
      JSON.stringify({ days_before: 30 }),
    );
  } catch { /* ignore */ }
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
        'Olá {{name}}. Você tem um agendamento na Clínica Tanah no dia {{date}}, às {{time}}.\n\nEscolha uma opção:\n1 — Confirmar\n2 — Remarcar\n3 — Cancelar', 'approved'],
      ['tpl_reminder_2h', 'Lembrete 2h', 'utility',
        'Olá {{name}}. Você tem um agendamento na Clínica Tanah hoje às {{time}}.\n\n1 — Confirmar | 2 — Remarcar | 3 — Cancelar', 'approved'],
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
        'Olá {{name}}. Você tem um agendamento na Clínica Tanah no dia {{date}}, às {{time}}.\n\nEscolha uma opção:\n1 — Confirmar\n2 — Remarcar\n3 — Cancelar',
        JSON.stringify({ offset_hours: 24 }), { enabled: 1 }],
      ['reminder_2h', 'Lembrete 2 horas antes', 'Lembrete curto no dia da consulta.',
        'Olá {{name}}. Você tem um agendamento na Clínica Tanah hoje às {{time}}.\n\n1 — Confirmar | 2 — Remarcar | 3 — Cancelar',
        JSON.stringify({ offset_hours: 2 }), { enabled: 1 }],
      ['welcome', 'Boas-vindas pós primeira consulta', 'Disparada uma vez após a primeira consulta concluída (checkout).',
        'Olá {{name}}! Agradecemos por escolher a Clínica Tanah. Este é nosso canal oficial para confirmações e atendimento administrativo. Responda ATENDENTE ou PREFERÊNCIAS.',
        JSON.stringify({ trigger: 'first_completed_visit' }), { enabled: 1 }],
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
      ['recall', 'Recall / acompanhamento', 'Avisa pacientes com recall_due_at nos próximos 30 dias (sem citar procedimento).',
        'Olá {{name}}. Já está próximo do período recomendado para seu próximo acompanhamento na Clínica Tanah. Gostaria de verificar horários disponíveis?',
        JSON.stringify({ days_before: 30 }), { enabled: 1 }],
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
  ensureRecallAutomation(tenantId);

  // ---- BodyPath clinical module (prontuário corporal / image scenarios) ----
  openDb().exec(`
    CREATE TABLE IF NOT EXISTS body_measurements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      height_cm REAL,
      weight_kg REAL,
      waist_cm REAL,
      notes TEXT,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      recorded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_body_meas_patient ON body_measurements(tenant_id, patient_id, recorded_at);

    CREATE TABLE IF NOT EXISTS body_medications (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      name TEXT NOT NULL,
      dosage TEXT,
      frequency TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      started_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_body_meds_patient ON body_medications(tenant_id, patient_id);

    CREATE TABLE IF NOT EXISTS body_lifestyle_plans (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      weeks INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_body_plans_patient ON body_lifestyle_plans(tenant_id, patient_id);

    CREATE TABLE IF NOT EXISTS body_consents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 0,
      granted_at TEXT,
      revoked_at TEXT,
      notice_version TEXT NOT NULL DEFAULT 'body.consent.pt-BR.v1',
      evidence_channel TEXT NOT NULL DEFAULT 'in_app',
      UNIQUE(tenant_id, patient_id, purpose)
    );

    CREATE TABLE IF NOT EXISTS body_captures (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      view_angle TEXT NOT NULL DEFAULT 'front',
      status TEXT NOT NULL DEFAULT 'uploaded',
      image_path TEXT,
      content_type TEXT DEFAULT 'image/jpeg',
      notes TEXT,
      created_by TEXT,
      validated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_body_cap_patient ON body_captures(tenant_id, patient_id);

    CREATE TABLE IF NOT EXISTS body_scenarios (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      capture_id TEXT,
      title TEXT NOT NULL,
      goal TEXT,
      weeks INTEGER,
      prompt TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      provider TEXT,
      provider_task_id TEXT,
      image_url TEXT,
      image_path TEXT,
      measurement_snapshot TEXT,
      error TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_body_scen_patient ON body_scenarios(tenant_id, patient_id);

    -- Multi-view capture sessions (BodyPath parity: front/left/right/back)
    CREATE TABLE IF NOT EXISTS body_capture_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      validated_at TEXT,
      quality_summary TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_body_sess_patient ON body_capture_sessions(tenant_id, patient_id);

    CREATE TABLE IF NOT EXISTS body_capture_assets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      view TEXT NOT NULL CHECK(view IN ('front','left','right','back')),
      image_path TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'image/jpeg',
      sha256 TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      quality_json TEXT,
      metrics_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, view)
    );
    CREATE INDEX IF NOT EXISTS idx_body_asset_session ON body_capture_assets(session_id);
  `);

  // Expand anthropometrics + lifestyle + scenario simulator columns
  for (const sql of [
    `ALTER TABLE body_measurements ADD COLUMN payload TEXT`,
    `ALTER TABLE body_measurements ADD COLUMN bmi REAL`,
    `ALTER TABLE body_measurements ADD COLUMN whr REAL`,
    `ALTER TABLE body_measurements ADD COLUMN whtr REAL`,
    `ALTER TABLE body_measurements ADD COLUMN device_label TEXT`,
    `ALTER TABLE body_measurements ADD COLUMN fasting_state TEXT`,
    `ALTER TABLE body_measurements ADD COLUMN clothing_note TEXT`,
    `ALTER TABLE body_measurements ADD COLUMN posture_note TEXT`,
    `ALTER TABLE body_measurements ADD COLUMN verified INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE body_lifestyle_plans ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'nutrition'`,
    `ALTER TABLE body_lifestyle_plans ADD COLUMN summary TEXT`,
    `ALTER TABLE body_lifestyle_plans ADD COLUMN params_json TEXT`,
    `ALTER TABLE body_medications ADD COLUMN class_tag TEXT`,
    `ALTER TABLE body_medications ADD COLUMN confirmation TEXT DEFAULT 'clinician_confirmed'`,
    `ALTER TABLE body_scenarios ADD COLUMN capture_session_id TEXT`,
    `ALTER TABLE body_scenarios ADD COLUMN horizon_weeks INTEGER`,
    `ALTER TABLE body_scenarios ADD COLUMN plan_config TEXT`,
    `ALTER TABLE body_scenarios ADD COLUMN assumptions TEXT`,
    `ALTER TABLE body_scenarios ADD COLUMN execution_plan TEXT`,
    `ALTER TABLE body_scenarios ADD COLUMN photorealism INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE body_scenarios ADD COLUMN review_status TEXT DEFAULT 'pending_review'`,
    // Prescription soft-cancel (CFM clinical retention — never hard-delete)
    `ALTER TABLE prescriptions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE prescriptions ADD COLUMN cancelled_at TEXT`,
    `ALTER TABLE prescriptions ADD COLUMN cancelled_by TEXT`,
    `ALTER TABLE prescriptions ADD COLUMN cancel_reason TEXT`,
    `ALTER TABLE encounters ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE encounters ADD COLUMN cancelled_at TEXT`,
    `ALTER TABLE encounters ADD COLUMN cancelled_by TEXT`,
    `ALTER TABLE encounters ADD COLUMN cancel_reason TEXT`,
    // Professional stamp on SOAP (CFM 1.638 — identificação do profissional)
    `ALTER TABLE encounters ADD COLUMN signer_name TEXT`,
    `ALTER TABLE encounters ADD COLUMN signer_council TEXT`,
    `ALTER TABLE encounters ADD COLUMN signer_council_state TEXT`,
    `ALTER TABLE encounters ADD COLUMN signed_at TEXT`,
    `ALTER TABLE prescriptions ADD COLUMN signer_name TEXT`,
    `ALTER TABLE prescriptions ADD COLUMN signer_council TEXT`,
    `ALTER TABLE prescriptions ADD COLUMN signer_council_state TEXT`,
    `ALTER TABLE prescriptions ADD COLUMN signed_at TEXT`,
  ]) {
    try { openDb().exec(sql); } catch { /* exists */ }
  }

  // ============================================================
  // FULL PRONTUÁRIO — CFM 1.638/2002 mandatory chart sections
  // Evoluções, sinais vitais, exames, procedimentos, problemas,
  // alergias estruturadas, anamnese, anexos clínicos
  // ============================================================
  openDb().exec(`
    CREATE TABLE IF NOT EXISTS clinical_evolutions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      encounter_id TEXT,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      note_type TEXT NOT NULL DEFAULT 'evolution', -- evolution | nursing | multiprofessional | emergency
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', -- active | cancelled (CFM retention)
      signer_name TEXT,
      signer_council TEXT,
      signer_council_state TEXT,
      signed_at TEXT,
      cancelled_at TEXT,
      cancelled_by TEXT,
      cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_evol_patient ON clinical_evolutions(tenant_id, patient_id, recorded_at);

    CREATE TABLE IF NOT EXISTS clinical_vitals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      encounter_id TEXT,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      systolic_mmhg REAL,
      diastolic_mmhg REAL,
      heart_rate_bpm REAL,
      respiratory_rate REAL,
      temperature_c REAL,
      spo2_pct REAL,
      pain_score INTEGER,
      weight_kg REAL,
      height_cm REAL,
      glucose_mg_dl REAL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      signer_name TEXT,
      signer_council TEXT,
      signer_council_state TEXT,
      signed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vitals_patient ON clinical_vitals(tenant_id, patient_id, recorded_at);

    CREATE TABLE IF NOT EXISTS clinical_exam_orders (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      ordered_by TEXT NOT NULL,
      encounter_id TEXT,
      ordered_at TEXT NOT NULL DEFAULT (datetime('now')),
      exam_name TEXT NOT NULL,
      exam_code TEXT,
      clinical_indication TEXT,
      priority TEXT NOT NULL DEFAULT 'routine', -- routine | urgent | emergency
      status TEXT NOT NULL DEFAULT 'ordered', -- ordered | collected | resulted | cancelled
      notes TEXT,
      signer_name TEXT,
      signer_council TEXT,
      signer_council_state TEXT,
      signed_at TEXT,
      cancelled_at TEXT,
      cancelled_by TEXT,
      cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_exam_ord_patient ON clinical_exam_orders(tenant_id, patient_id, ordered_at);

    CREATE TABLE IF NOT EXISTS clinical_exam_results (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      order_id TEXT,
      recorded_by TEXT NOT NULL,
      resulted_at TEXT NOT NULL DEFAULT (datetime('now')),
      exam_name TEXT NOT NULL,
      result_summary TEXT,
      result_values TEXT, -- JSON
      abnormal INTEGER NOT NULL DEFAULT 0,
      attachment_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      signer_name TEXT,
      signer_council TEXT,
      signer_council_state TEXT,
      signed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_exam_res_patient ON clinical_exam_results(tenant_id, patient_id, resulted_at);

    CREATE TABLE IF NOT EXISTS clinical_procedures (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      encounter_id TEXT,
      performed_at TEXT NOT NULL DEFAULT (datetime('now')),
      procedure_name TEXT NOT NULL,
      procedure_code TEXT, -- TUSS / CBHPM when available
      description TEXT,
      outcome TEXT,
      complications TEXT,
      materials_used TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      signer_name TEXT,
      signer_council TEXT,
      signer_council_state TEXT,
      signed_at TEXT,
      cancelled_at TEXT,
      cancelled_by TEXT,
      cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_proc_patient ON clinical_procedures(tenant_id, patient_id, performed_at);

    CREATE TABLE IF NOT EXISTS clinical_problems (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      recorded_by TEXT NOT NULL,
      title TEXT NOT NULL,
      cid10_code TEXT,
      status TEXT NOT NULL DEFAULT 'active', -- active | resolved | inactive
      onset_date TEXT,
      resolved_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_prob_patient ON clinical_problems(tenant_id, patient_id, status);

    CREATE TABLE IF NOT EXISTS clinical_allergies (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      recorded_by TEXT NOT NULL,
      substance TEXT NOT NULL,
      reaction TEXT,
      severity TEXT NOT NULL DEFAULT 'moderate', -- mild | moderate | severe | life_threatening
      status TEXT NOT NULL DEFAULT 'active', -- active | inactive
      onset_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_allergy_patient ON clinical_allergies(tenant_id, patient_id, status);

    CREATE TABLE IF NOT EXISTS clinical_anamnesis (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      chief_complaint TEXT,
      hpi TEXT,              -- história da doença atual
      past_history TEXT,     -- HPP
      family_history TEXT,   -- HF
      social_history TEXT,   -- HS / hábitos
      review_of_systems TEXT,
      current_medications TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      signer_name TEXT,
      signer_council TEXT,
      signer_council_state TEXT,
      signed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_anam_patient ON clinical_anamnesis(tenant_id, patient_id, recorded_at);

    CREATE TABLE IF NOT EXISTS clinical_attachments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      encounter_id TEXT,
      title TEXT NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'other', -- lab | imaging | consent | referral | other
      mime TEXT,
      file_path TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_attach_patient ON clinical_attachments(tenant_id, patient_id, created_at);
  `);

  // ============================================================
  // Rx ↔ Inventory ↔ Contabilidade — dispense + invoice trail
  // ============================================================
  for (const sql of [
    `ALTER TABLE prescriptions ADD COLUMN dispense_status TEXT NOT NULL DEFAULT 'none'`,
    `ALTER TABLE prescriptions ADD COLUMN dispensed_at TEXT`,
    `ALTER TABLE prescriptions ADD COLUMN dispensed_by TEXT`,
    `ALTER TABLE prescriptions ADD COLUMN invoice_id TEXT`,
    `ALTER TABLE invoices ADD COLUMN prescription_id TEXT`,
  ]) {
    try { openDb().exec(sql); } catch { /* exists */ }
  }
  try {
    openDb().exec(`CREATE INDEX IF NOT EXISTS idx_inv_prescription ON invoices(prescription_id)`);
  } catch { /* exists */ }
  try {
    openDb().exec(`CREATE INDEX IF NOT EXISTS idx_mvmt_ref ON stock_movements(reference_id)`);
  } catch { /* exists */ }
}
