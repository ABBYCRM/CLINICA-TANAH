/**
 * PHI / dados sensíveis — AES-256-GCM field encryption (LGPD art. 46).
 *
 * Brazilian medical CRM equivalent of HIPAA Security Rule “encryption”
 * expectations: protect health data at rest with authenticated encryption,
 * keep a blind index for CPF lookup, and migrate plaintext on boot.
 *
 * Key resolution (first match wins):
 *  1. PHI_ENCRYPTION_KEY — 32 raw bytes as base64 or 64-char hex
 *  2. scrypt(JWT_SECRET, 'clinica-tanah-phi-v1') — deterministic fallback
 *  3. scrypt(dev default, …) — local/e2e only (never production)
 *
 * Ciphertext format: enc1.<iv_b64url>.<tag_b64url>.<ct_b64url>
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const PREFIX = 'enc1.';
const ALGO = 'aes-256-gcm';
const BLIND_PREFIX = 'b1.';

let cachedKey: Buffer | null = null;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function parseKeyMaterial(raw: string): Buffer | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  try {
    const b = Buffer.from(s, 'base64');
    if (b.length === 32) return b;
  } catch { /* ignore */ }
  // Accept passphrase → scrypt
  return scryptSync(s, 'clinica-tanah-phi-key-material-v1', 32);
}

export function assertSecurityConfig(): void {
  if (!isProduction()) return;
  const jwt = process.env.JWT_SECRET || '';
  if (!jwt || jwt === 'clinica-tanah-dev-secret-change-me-in-prod') {
    // Soft-fail: log loudly but allow boot so App Platform can surface logs.
    // Sessions will be unsigned/unstable until JWT_SECRET is configured.
    console.error(
      'SECURITY: JWT_SECRET missing or still the development default — set a strong secret (LGPD art. 46).',
    );
    return;
  }
  if (jwt.length < 24) {
    console.warn('⚠️  JWT_SECRET shorter than recommended (≥24 chars).');
  }
}

function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.PHI_ENCRYPTION_KEY
    ? parseKeyMaterial(process.env.PHI_ENCRYPTION_KEY)
    : null;
  if (fromEnv) {
    cachedKey = fromEnv;
    return cachedKey;
  }
  const jwt = process.env.JWT_SECRET || '';
  if (isProduction() && (!jwt || jwt === 'clinica-tanah-dev-secret-change-me-in-prod')) {
    throw new Error('FATAL: PHI encryption requires PHI_ENCRYPTION_KEY or a strong JWT_SECRET in production.');
  }
  const material = jwt || 'clinica-tanah-dev-secret-change-me-in-prod';
  cachedKey = scryptSync(material, 'clinica-tanah-phi-v1', 32);
  return cachedKey;
}

/** For tests — clear cached key after env changes. */
export function _resetPhiKeyCache(): void {
  cachedKey = null;
}

export function isSealed(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function seal(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') return plaintext ?? null;
  if (isSealed(plaintext)) return plaintext;
  const key = resolveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(String(plaintext), 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

export function open(value: string | null | undefined): string | null {
  if (value == null || value === '') return value ?? null;
  if (!isSealed(value)) return value;
  const parts = value.slice(PREFIX.length).split('.');
  if (parts.length !== 3) return value;
  const [ivB, tagB, ctB] = parts;
  try {
    const key = resolveKey();
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    // Wrong key or corrupt — do not crash reads; surface opaque marker for staff
    return '[dados_protegidos_indisponiveis]';
  }
}

export function sealJson(value: unknown): string | null {
  if (value == null) return null;
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return seal(raw);
}

export function openJson<T = any>(value: string | null | undefined, fallback: T): T {
  const raw = open(value);
  if (raw == null || raw === '') return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** HMAC blind index for exact CPF match without storing searchable plaintext. */
export function blindIndex(normalized: string | null | undefined): string | null {
  if (!normalized) return null;
  const digits = String(normalized).replace(/\D/g, '');
  if (!digits) return null;
  const key = resolveKey();
  const mac = createHmac('sha256', key).update(`cpf:${digits}`).digest('base64url');
  return `${BLIND_PREFIX}${mac}`;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Patient columns encrypted at rest (dados pessoais sensíveis / saúde). */
export const PATIENT_SEAL_FIELDS = [
  'cpf', 'rg', 'cns', 'email', 'notes',
  'allergies', 'chronic_conditions', 'medications_in_use',
  'mother_name', 'father_name', 'emergency_contact_phone',
  'guardian_phone',
] as const;

export const ENCOUNTER_SEAL_FIELDS = [
  'subjective', 'objective', 'assessment', 'plan', 'notes',
] as const;

export function sealPatientRow(input: Record<string, any>): Record<string, any> {
  const out = { ...input };
  for (const f of PATIENT_SEAL_FIELDS) {
    if (out[f] != null && out[f] !== '') {
      if (typeof out[f] !== 'string') out[f] = JSON.stringify(out[f]);
      out[f] = seal(String(out[f]));
    }
  }
  if (input.cpf != null) {
    out.cpf_blind = blindIndex(String(input.cpf));
  }
  return out;
}

export function revealPatientRow<T extends Record<string, any>>(row: T | null | undefined): T | null {
  if (!row) return null;
  const out: any = { ...row };
  for (const f of PATIENT_SEAL_FIELDS) {
    if (out[f] != null) out[f] = open(String(out[f]));
  }
  // Parse JSON clinical arrays after decrypt
  for (const f of ['allergies', 'chronic_conditions', 'medications_in_use', 'tags'] as const) {
    if (typeof out[f] === 'string' && out[f] && !out[f].startsWith(PREFIX)) {
      try { out[f] = JSON.parse(out[f]); } catch { /* leave string */ }
    }
  }
  return out;
}

export function sealEncounterRow(input: Record<string, any>): Record<string, any> {
  const out = { ...input };
  for (const f of ENCOUNTER_SEAL_FIELDS) {
    if (out[f] != null && out[f] !== '') out[f] = seal(String(out[f]));
  }
  return out;
}

export function revealEncounterRow<T extends Record<string, any>>(row: T | null | undefined): T | null {
  if (!row) return null;
  const out: any = { ...row };
  for (const f of ENCOUNTER_SEAL_FIELDS) {
    if (out[f] != null) out[f] = open(String(out[f]));
  }
  return out;
}

export function sealPrescriptionItems(items: unknown): string {
  const raw = typeof items === 'string' ? items : JSON.stringify(items ?? []);
  return seal(raw) || '[]';
}

export function revealPrescriptionItems(items: string | null | undefined): any {
  return openJson(items, []);
}

/** Redact PHI from audit before/after payloads (avoid second plaintext copy). */
export function redactForAudit(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactForAudit);
  const SENSITIVE = new Set([
    'cpf', 'rg', 'cns', 'email', 'phone', 'phone_secondary', 'password', 'password_hash',
    'subjective', 'objective', 'assessment', 'plan', 'notes', 'items', 'payload',
    'allergies', 'chronic_conditions', 'medications_in_use', 'mother_name', 'father_name',
    'emergency_contact_phone', 'guardian_phone', 'open_complaint', 'pixel_token',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE.has(k)) {
      out[k] = v == null || v === '' ? v : '[redacted]';
    } else if (v && typeof v === 'object') {
      out[k] = redactForAudit(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function encryptionStatus(): {
  enabled: true;
  algorithm: string;
  key_source: 'PHI_ENCRYPTION_KEY' | 'JWT_SECRET_derived' | 'dev_default';
  sealed_prefix: string;
} {
  const keySource = process.env.PHI_ENCRYPTION_KEY
    ? 'PHI_ENCRYPTION_KEY'
    : (process.env.JWT_SECRET && process.env.JWT_SECRET !== 'clinica-tanah-dev-secret-change-me-in-prod')
      ? 'JWT_SECRET_derived'
      : 'dev_default';
  // Touch key to validate resolvable
  resolveKey();
  return {
    enabled: true,
    algorithm: 'AES-256-GCM',
    key_source: keySource,
    sealed_prefix: PREFIX,
  };
}

/** One-time / idempotent seal of existing plaintext PHI rows. */
export function migratePhiAtRest(db: { prepare: (sql: string) => any }): { patients: number; encounters: number; prescriptions: number; intake: number } {
  let patients = 0;
  let encounters = 0;
  let prescriptions = 0;
  let intake = 0;

  try {
    db.prepare(`ALTER TABLE patients ADD COLUMN cpf_blind TEXT`).run();
  } catch { /* exists */ }
  try {
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_patients_cpf_blind ON patients(tenant_id, cpf_blind)`).run();
  } catch { /* ignore */ }

  const patientRows = db.prepare(`
    SELECT id, cpf, rg, cns, email, notes, allergies, chronic_conditions, medications_in_use,
           mother_name, father_name, emergency_contact_phone, guardian_phone, cpf_blind
    FROM patients
  `).all() as any[];

  const updPatient = db.prepare(`
    UPDATE patients SET
      cpf = ?, rg = ?, cns = ?, email = ?, notes = ?,
      allergies = ?, chronic_conditions = ?, medications_in_use = ?,
      mother_name = ?, father_name = ?, emergency_contact_phone = ?,
      guardian_phone = ?, cpf_blind = ?
    WHERE id = ?
  `);

  for (const row of patientRows) {
    const needs =
      (row.cpf && !isSealed(row.cpf))
      || (row.email && !isSealed(row.email))
      || (row.notes && !isSealed(row.notes))
      || (row.allergies && !isSealed(row.allergies))
      || (row.cpf && !row.cpf_blind);
    if (!needs) continue;
    const sealed = sealPatientRow(row);
    updPatient.run(
      sealed.cpf ?? null, sealed.rg ?? null, sealed.cns ?? null, sealed.email ?? null, sealed.notes ?? null,
      sealed.allergies ?? null, sealed.chronic_conditions ?? null, sealed.medications_in_use ?? null,
      sealed.mother_name ?? null, sealed.father_name ?? null, sealed.emergency_contact_phone ?? null,
      sealed.guardian_phone ?? null, sealed.cpf_blind ?? row.cpf_blind ?? null,
      row.id,
    );
    patients += 1;
  }

  const encRows = db.prepare(`
    SELECT id, subjective, objective, assessment, plan, notes FROM encounters
  `).all() as any[];
  const updEnc = db.prepare(`
    UPDATE encounters SET subjective = ?, objective = ?, assessment = ?, plan = ?, notes = ? WHERE id = ?
  `);
  for (const row of encRows) {
    const needs = [row.subjective, row.objective, row.assessment, row.plan, row.notes]
      .some((v) => v && !isSealed(v));
    if (!needs) continue;
    const sealed = sealEncounterRow(row);
    updEnc.run(sealed.subjective ?? null, sealed.objective ?? null, sealed.assessment ?? null, sealed.plan ?? null, sealed.notes ?? null, row.id);
    encounters += 1;
  }

  const rxRows = db.prepare(`SELECT id, items FROM prescriptions`).all() as any[];
  const updRx = db.prepare(`UPDATE prescriptions SET items = ? WHERE id = ?`);
  for (const row of rxRows) {
    if (!row.items || isSealed(row.items)) continue;
    updRx.run(sealPrescriptionItems(row.items), row.id);
    prescriptions += 1;
  }

  try {
    const subRows = db.prepare(`
      SELECT id, cpf, email, notes, payload FROM intake_submissions WHERE status != 'session'
    `).all() as any[];
    const updSub = db.prepare(`
      UPDATE intake_submissions SET cpf = ?, email = ?, notes = ?, payload = ? WHERE id = ?
    `);
    for (const row of subRows) {
      const needs = [row.cpf, row.email, row.notes, row.payload].some((v) => v && !isSealed(v));
      if (!needs) continue;
      updSub.run(
        row.cpf ? seal(row.cpf) : null,
        row.email ? seal(row.email) : null,
        row.notes ? seal(row.notes) : null,
        row.payload ? seal(row.payload) : null,
        row.id,
      );
      intake += 1;
    }
  } catch { /* table may not exist mid-migrate */ }

  return { patients, encounters, prescriptions, intake };
}
