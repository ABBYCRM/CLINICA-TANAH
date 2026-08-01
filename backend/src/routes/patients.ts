import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit, recordConsent, hasActiveConsent } from '../services/audit';
import {
  canViewClinical,
  CONSENT_PURPOSES,
  createPatientTask,
  getConsentLedger,
  LIFECYCLE_STAGES,
  openServiceRecoveryTicket,
  setPatientConsent,
  setPatientRecall,
  type ConsentPurpose,
} from '../services/patientJourney';
import {
  blindIndex,
  openJson,
  revealEncounterRow,
  revealPatientRow,
  revealPrescriptionItems,
  seal,
  sealJson,
  sealPatientRow,
} from '../services/phiCrypto';
import {
  ensurePatientDocumentsSchema,
  listUnifiedPatientDocuments,
  mimeFromName,
  writePatientDocumentFile,
} from '../services/patientDocumentsVault';

const router = Router();

const CLINICAL_PATIENT_FIELDS = [
  'allergies', 'chronic_conditions', 'medications_in_use', 'blood_type',
  'notes', 'open_complaint', 'cns',
] as const;

function redactClinicalIfNeeded(patient: any, role?: string | null) {
  if (canViewClinical(role)) return patient;
  const out = { ...patient };
  for (const f of CLINICAL_PATIENT_FIELDS) delete out[f];
  return out;
}

// HTML forms submit empty strings for untouched optional fields — treat them as null
const optStr = (schema: z.ZodString) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), schema.nullable());

const patientSchema = z.object({
  full_name: z.string().min(1),
  social_name: optStr(z.string()),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cpf: optStr(z.string().regex(/^\d{11}$/)),
  rg: optStr(z.string()),
  rg_issuer: optStr(z.string()),
  gender: optStr(z.string()),
  marital_status: optStr(z.string()),
  occupation: optStr(z.string()),
  education_level: optStr(z.string()),
  nationality: optStr(z.string()),
  birthplace: optStr(z.string()),
  mother_name: optStr(z.string()),
  father_name: optStr(z.string()),
  race_color: optStr(z.string()),
  cns: optStr(z.string().regex(/^\d{15}$/)),
  referral_source: optStr(z.string()),
  notes: optStr(z.string()),
  phone: z.string().min(8),
  phone_secondary: optStr(z.string()),
  email: optStr(z.string().email()),
  address_zip: optStr(z.string()),
  address_street: optStr(z.string()),
  address_number: optStr(z.string()),
  address_complement: optStr(z.string()),
  address_neighborhood: optStr(z.string()),
  address_city: optStr(z.string()),
  address_state: optStr(z.string()),
  health_insurance: optStr(z.string()),
  health_insurance_number: optStr(z.string()),
  blood_type: optStr(z.string()),
  allergies: z.array(z.string()).optional().default([]),
  chronic_conditions: z.array(z.string()).optional().default([]),
  medications_in_use: z.array(z.string()).optional().default([]),
  emergency_contact_name: optStr(z.string()),
  emergency_contact_phone: optStr(z.string()),
  lgpd_consent_granted: z.boolean().optional().default(false),
  lgpd_policy_version: z.string().optional().default('1.0'),
  lifecycle_stage: z.enum([
    'prospect','new_patient','active','in_treatment','follow_up_required',
    'recall_due','inactive','do_not_contact','archived',
  ]).optional(),
  preferred_language: optStr(z.string()),
  assigned_professional_id: optStr(z.string()),
  recall_due_at: optStr(z.string()),
  do_not_contact: z.boolean().optional(),
  open_complaint: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

router.use(authenticate);

// List patients — with search and pagination
router.get('/', (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  const view = (req.query.view as string || 'all').trim();
  const insurance = (req.query.insurance as string || '').trim();
  const gender = (req.query.gender as string || '').trim();
  const createdFrom = (req.query.created_from as string || '').trim();
  const createdTo = (req.query.created_to as string || '').trim();
  const sort = (req.query.sort as string || 'name').trim();
  const limit = Math.min(parseInt(req.query.limit as string || '25', 10) || 25, 200);
  const offset = Math.max(parseInt(req.query.offset as string || '0', 10) || 0, 0);

  const where: string[] = ['p.tenant_id = ?'];
  const args: any[] = [req.tenantId];

  if (q) {
    const like = `%${q}%`;
    const digitsOnly = q.replace(/\D/g, '');
    const digits = `%${digitsOnly || q}%`;
    if (digitsOnly.length === 11) {
      const blind = blindIndex(digitsOnly);
      where.push(`(
        p.full_name LIKE ? OR p.social_name LIKE ? OR p.phone LIKE ? OR p.email LIKE ?
        OR p.cpf_blind = ?
      )`);
      args.push(like, like, like, like, blind);
    } else {
      where.push(`(
        p.full_name LIKE ? OR p.social_name LIKE ? OR p.phone LIKE ?
        OR REPLACE(REPLACE(REPLACE(COALESCE(p.phone,''), '+', ''), '-', ''), ' ', '') LIKE ?
      )`);
      args.push(like, like, like, digits);
    }
  }
  if (insurance === '__none__') {
    where.push(`(p.health_insurance IS NULL OR TRIM(p.health_insurance) = '')`);
  } else if (insurance) {
    where.push(`p.health_insurance = ?`);
    args.push(insurance);
  }
  if (gender) {
    where.push(`p.gender = ?`);
    args.push(gender);
  }
  if (createdFrom) {
    where.push(`date(p.created_at) >= date(?)`);
    args.push(createdFrom);
  }
  if (createdTo) {
    where.push(`date(p.created_at) <= date(?)`);
    args.push(createdTo);
  }

  if (view === 'recent') {
    where.push(`date(p.created_at) >= date('now', '-30 days')`);
  } else if (view === 'insurance') {
    where.push(`p.health_insurance IS NOT NULL AND TRIM(p.health_insurance) != ''`);
  } else if (view === 'upcoming') {
    where.push(`EXISTS (
      SELECT 1 FROM appointments a
      WHERE a.patient_id = p.id AND a.tenant_id = p.tenant_id
        AND a.scheduled_at >= datetime('now')
        AND a.status NOT IN ('cancelled','no_show','completed')
    )`);
  } else if (view === 'inactive') {
    where.push(`NOT EXISTS (
      SELECT 1 FROM appointments a
      WHERE a.patient_id = p.id AND a.tenant_id = p.tenant_id
        AND date(a.scheduled_at) >= date('now', '-90 days')
    )`);
    where.push(`NOT EXISTS (
      SELECT 1 FROM encounters e
      WHERE e.patient_id = p.id AND e.tenant_id = p.tenant_id
        AND date(e.started_at) >= date('now', '-90 days')
    )`);
  }

  const whereSql = where.join(' AND ');
  let orderSql = 'p.full_name ASC';
  if (sort === 'created_desc') orderSql = 'p.created_at DESC';
  else if (sort === 'created_asc') orderSql = 'p.created_at ASC';
  else if (sort === 'updated_desc') orderSql = 'p.updated_at DESC';
  else if (sort === 'last_activity') orderSql = '(last_activity IS NULL), last_activity DESC';

  const total = (db.prepare(`
    SELECT COUNT(*) AS c FROM patients p WHERE ${whereSql}
  `).get(...args) as any).c;

  const rows = db.prepare(`
    SELECT
      p.id, p.full_name, p.social_name, p.phone, p.email, p.cpf, p.birth_date,
      p.gender, p.health_insurance, p.blood_type, p.created_at, p.updated_at,
      (
        SELECT MAX(x.dt) FROM (
          SELECT a.scheduled_at AS dt FROM appointments a
          WHERE a.patient_id = p.id AND a.tenant_id = p.tenant_id
          UNION ALL
          SELECT e.started_at AS dt FROM encounters e
          WHERE e.patient_id = p.id AND e.tenant_id = p.tenant_id
          UNION ALL
          SELECT p.created_at AS dt
        ) x
      ) AS last_activity,
      (
        SELECT u.full_name FROM appointments a
        JOIN users u ON u.id = a.practitioner_id
        WHERE a.patient_id = p.id AND a.tenant_id = p.tenant_id
        ORDER BY a.scheduled_at DESC LIMIT 1
      ) AS owner_name,
      (
        SELECT COUNT(*) FROM appointments a
        WHERE a.patient_id = p.id AND a.tenant_id = p.tenant_id
          AND a.scheduled_at >= datetime('now')
          AND a.status NOT IN ('cancelled','no_show','completed')
      ) AS upcoming_count
    FROM patients p
    WHERE ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset);

  const revealed = (rows as any[]).map((r) => revealPatientRow(r)!);

  const insurers = db.prepare(`
    SELECT DISTINCT health_insurance AS name FROM patients
    WHERE tenant_id = ? AND health_insurance IS NOT NULL AND TRIM(health_insurance) != ''
    ORDER BY health_insurance COLLATE NOCASE
  `).all(req.tenantId).map((r: any) => r.name);

  const viewCounts = {
    all: (db.prepare(`SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ?`).get(req.tenantId) as any).c,
    recent: (db.prepare(`SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ? AND date(created_at) >= date('now', '-30 days')`).get(req.tenantId) as any).c,
    insurance: (db.prepare(`SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ? AND health_insurance IS NOT NULL AND TRIM(health_insurance) != ''`).get(req.tenantId) as any).c,
    upcoming: (db.prepare(`
      SELECT COUNT(DISTINCT p.id) AS c FROM patients p
      JOIN appointments a ON a.patient_id = p.id AND a.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND a.scheduled_at >= datetime('now')
        AND a.status NOT IN ('cancelled','no_show','completed')
    `).get(req.tenantId) as any).c,
    inactive: (db.prepare(`
      SELECT COUNT(*) AS c FROM patients p
      WHERE p.tenant_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.tenant_id = p.tenant_id
            AND date(a.scheduled_at) >= date('now', '-90 days')
        )
        AND NOT EXISTS (
          SELECT 1 FROM encounters e WHERE e.patient_id = p.id AND e.tenant_id = p.tenant_id
            AND date(e.started_at) >= date('now', '-90 days')
        )
    `).get(req.tenantId) as any).c,
  };

  res.json({ patients: revealed, total, limit, offset, insurers, view_counts: viewCounts });
});

// Get single patient — audit logged (PHI access); clinical fields RBAC
router.get('/:id', (req: Request, res: Response) => {
  const raw = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!raw) { res.status(404).json({ error: 'not_found' }); return; }
  const p = redactClinicalIfNeeded(revealPatientRow(raw), req.user?.role);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'view_patient_phi', resourceType: 'patient', resourceId: raw.id,
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({ patient: p });
});

// Create patient — LGPD consent is mandatory
router.post('/', requireRole('admin', 'doctor', 'nurse', 'receptionist'), (req: Request, res: Response) => {
  const parsed = patientSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  if (!d.lgpd_consent_granted) {
    res.status(400).json({ error: 'lgpd_consent_required' });
    return;
  }
  const id = uuid();
  const now = new Date().toISOString();
  const sealed = sealPatientRow({
    cpf: d.cpf ?? null,
    rg: d.rg ?? null,
    cns: d.cns ?? null,
    email: d.email ?? null,
    notes: d.notes ?? null,
    allergies: JSON.stringify(d.allergies),
    chronic_conditions: JSON.stringify(d.chronic_conditions),
    medications_in_use: JSON.stringify(d.medications_in_use),
    mother_name: d.mother_name ?? null,
    father_name: d.father_name ?? null,
    emergency_contact_phone: d.emergency_contact_phone ?? null,
  });
  db.prepare(`
    INSERT INTO patients (id, tenant_id, full_name, social_name, birth_date, cpf, cpf_blind, rg, rg_issuer, gender, phone, phone_secondary, email,
                          address_zip, address_street, address_number, address_complement,
                          address_neighborhood, address_city, address_state,
                          marital_status, occupation, education_level, nationality, birthplace,
                          mother_name, father_name, race_color, cns, referral_source, notes,
                          health_insurance, health_insurance_number, blood_type,
                          allergies, chronic_conditions, medications_in_use,
                          emergency_contact_name, emergency_contact_phone,
                          lgpd_consent_at, lgpd_consent_ip, lgpd_consent_version,
                          created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
            ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, req.tenantId, d.full_name, d.social_name ?? null, d.birth_date,
    sealed.cpf ?? null, sealed.cpf_blind ?? null, sealed.rg ?? null,
    d.rg_issuer ?? null, d.gender ?? null, d.phone, d.phone_secondary ?? null, sealed.email ?? null,
    d.address_zip ?? null, d.address_street ?? null, d.address_number ?? null, d.address_complement ?? null,
    d.address_neighborhood ?? null, d.address_city ?? null, d.address_state ?? null,
    d.marital_status ?? null, d.occupation ?? null, d.education_level ?? null, d.nationality ?? null,
    d.birthplace ?? null, sealed.mother_name ?? null, sealed.father_name ?? null, d.race_color ?? null,
    sealed.cns ?? null, d.referral_source ?? null, sealed.notes ?? null,
    d.health_insurance ?? null, d.health_insurance_number ?? null, d.blood_type ?? null,
    sealed.allergies ?? null, sealed.chronic_conditions ?? null, sealed.medications_in_use ?? null,
    d.emergency_contact_name ?? null, sealed.emergency_contact_phone ?? null,
    now, req.ip ?? null, d.lgpd_policy_version,
    now, now
  );
  // Record formal LGPD consent + granular workspace purposes
  recordConsent({
    tenantId: req.tenantId,
    subjectType: 'patient', subjectId: id,
    consentType: 'health_data_processing',
    granted: true, policyVersion: d.lgpd_policy_version,
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    evidence: JSON.stringify({ source: 'patient_registration' }),
  });
  recordConsent({
    tenantId: req.tenantId,
    subjectType: 'patient', subjectId: id,
    consentType: 'data_processing',
    granted: true, policyVersion: d.lgpd_policy_version,
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    evidence: JSON.stringify({ source: 'patient_registration' }),
  });
  if (d.phone) {
    for (const purpose of ['whatsapp_communication', 'whatsapp_admin', 'appointment_reminders', 'post_visit_survey'] as const) {
      recordConsent({
        tenantId: req.tenantId,
        subjectType: 'patient', subjectId: id,
        consentType: purpose,
        granted: true, policyVersion: d.lgpd_policy_version,
        ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
        evidence: JSON.stringify({ source: 'patient_registration' }),
      });
    }
  }
  try {
    db.prepare(`UPDATE patients SET lifecycle_stage = 'new_patient' WHERE id = ?`).run(id);
  } catch { /* col may miss on old db mid-migrate */ }
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_patient', resourceType: 'patient', resourceId: id,
    afterValue: { full_name: d.full_name, cpf: d.cpf },
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    legalBasis: 'consent_art7_I',
  });
  res.status(201).json({ id });
});

// Update patient
router.put('/:id', requireRole('admin', 'doctor', 'nurse', 'receptionist'), (req: Request, res: Response) => {
  const before = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!before) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = patientSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  const allowed = [
    'full_name','social_name','birth_date','cpf','rg','rg_issuer','gender','phone','phone_secondary','email',
    'address_zip','address_street','address_number','address_complement',
    'address_neighborhood','address_city','address_state',
    'marital_status','occupation','education_level','nationality','birthplace',
    'mother_name','father_name','race_color','cns','referral_source','notes',
    'health_insurance','health_insurance_number','blood_type',
    'allergies','chronic_conditions','medications_in_use',
    'emergency_contact_name','emergency_contact_phone',
    'guardian_name','guardian_phone','guardian_relationship',
    'lifecycle_stage','preferred_language','assigned_professional_id',
    'recall_due_at','do_not_contact','open_complaint','tags',
  ];
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of allowed) {
    if ((d as any)[k] !== undefined) {
      sets.push(`${k} = ?`);
      let v = (d as any)[k];
      if (['allergies','chronic_conditions','medications_in_use'].includes(k) && Array.isArray(v)) {
        v = JSON.stringify(v);
      }
      if (k === 'tags' && Array.isArray(v)) v = JSON.stringify(v);
      if (k === 'do_not_contact' || k === 'open_complaint') v = v ? 1 : 0;
      if (k === 'lifecycle_stage' && v && !(LIFECYCLE_STAGES as readonly string[]).includes(String(v))) {
        res.status(400).json({ error: 'invalid_lifecycle_stage' }); return;
      }
      if (['cpf','rg','cns','email','notes','allergies','chronic_conditions','medications_in_use',
           'mother_name','father_name','emergency_contact_phone','guardian_phone'].includes(k) && v != null && v !== '') {
        v = typeof v === 'string' ? seal(String(v)) : sealJson(v);
      }
      if (k === 'cpf') {
        sets.push('cpf_blind = ?');
        args.push(v);
        args.push(blindIndex(String((d as any).cpf || '')));
        continue;
      }
      args.push(v);
    }
  }
  if (sets.length === 0) { res.json({ ok: true, noop: true }); return; }
  sets.push(`updated_at = ?`);
  args.push(new Date().toISOString());
  args.push(req.params.id);
  db.prepare(`UPDATE patients SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...args, req.tenantId);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'update_patient', resourceType: 'patient', resourceId: req.params.id,
    beforeValue: { full_name: before.full_name },
    afterValue: { full_name: d.full_name ?? before.full_name },
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({ ok: true });
});

// Delete patient — admin only.
// Hard delete is only allowed when the patient has NO clinical records
// (CFM 1.821/2007 mandates 20-year retention of medical records; those
// patients must go through the LGPD deletion/anonymization flow instead).
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  const p = db.prepare(`SELECT id, full_name FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  const clinical = (db.prepare(`
    SELECT (SELECT COUNT(*) FROM encounters WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM prescriptions WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM body_medications WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM body_measurements WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM clinical_evolutions WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM clinical_vitals WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM clinical_exam_orders WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM clinical_exam_results WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM clinical_procedures WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM clinical_anamnesis WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM clinical_problems WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM clinical_allergies WHERE patient_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM clinical_attachments WHERE patient_id = ? AND tenant_id = ?) AS c
  `).get(
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
    req.params.id, req.tenantId,
  ) as any).c;
  if (clinical > 0) {
    res.status(409).json({
      error: 'has_clinical_records',
      message: 'Patient has clinical records (CFM 20-year retention). Use the LGPD deletion request flow instead.',
    });
    return;
  }
  db.prepare(`DELETE FROM invoices WHERE patient_id = ? AND status != 'paid' AND tenant_id = ?`).run(req.params.id, req.tenantId);
  db.prepare(`UPDATE whatsapp_conversations SET patient_id = NULL WHERE patient_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM patients WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId); // appointments cascade
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'delete_patient', resourceType: 'patient', resourceId: req.params.id,
    beforeValue: { full_name: p.full_name },
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    legalBasis: 'legal_obligation_art7_II',
  });
  res.json({ ok: true, deleted_id: req.params.id });
});

/** HubSpot-style patient workspace: header props + timeline + associations + consents. */
router.get('/:id/record', (req: Request, res: Response) => {
  const raw = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!raw) { res.status(404).json({ error: 'not_found' }); return; }
  const p = revealPatientRow(raw)!;
  const parseArr = (v: any): string[] => {
    if (Array.isArray(v)) return v;
    try { return v ? JSON.parse(v) : []; } catch { return []; }
  };
  const clinicalOk = canViewClinical(req.user?.role);

  const appointments = db.prepare(`
    SELECT a.id, a.scheduled_at, a.type, a.status, a.notes, a.duration_minutes, a.source,
           u.full_name AS practitioner_name, u.id AS practitioner_id
    FROM appointments a JOIN users u ON u.id = a.practitioner_id
    WHERE a.patient_id = ? AND a.tenant_id = ?
    ORDER BY a.scheduled_at DESC LIMIT 50
  `).all(req.params.id, req.tenantId) as any[];

  const encounters = (db.prepare(`
    SELECT e.id, e.started_at, e.ended_at, e.subjective, e.objective, e.assessment, e.plan,
           e.icd10_codes, u.full_name AS practitioner_name
    FROM encounters e JOIN users u ON u.id = e.practitioner_id
    WHERE e.patient_id = ? AND e.tenant_id = ?
    ORDER BY e.started_at DESC LIMIT 50
  `).all(req.params.id, req.tenantId) as any[]).map((e) => revealEncounterRow(e)!);

  const prescriptions = (db.prepare(`
    SELECT pr.id, pr.created_at, pr.items, pr.sent_via_whatsapp, pr.status, pr.cancelled_at,
           u.full_name AS practitioner_name
    FROM prescriptions pr
    LEFT JOIN users u ON u.id = pr.practitioner_id
    WHERE pr.patient_id = ? AND pr.tenant_id = ?
    ORDER BY pr.created_at DESC LIMIT 30
  `).all(req.params.id, req.tenantId) as any[]).map((pr) => ({
    ...pr,
    status: pr.status || 'active',
    items: revealPrescriptionItems(pr.items),
  }));

  const invoices = db.prepare(`
    SELECT id, invoice_number, issue_date, due_date, total, status, payment_method, paid_at
    FROM invoices WHERE patient_id = ? AND tenant_id = ?
    ORDER BY issue_date DESC LIMIT 30
  `).all(req.params.id, req.tenantId) as any[];

  const consents = db.prepare(`
    SELECT id, consent_type, granted, granted_at, revoked_at, policy_version
    FROM lgpd_consents WHERE subject_type = 'patient' AND subject_id = ?
    ORDER BY granted_at DESC LIMIT 40
  `).all(req.params.id) as any[];

  const surveys = db.prepare(`
    SELECT id, appointment_id, score, comment, created_at
    FROM satisfaction_surveys WHERE patient_id = ? AND tenant_id = ?
    ORDER BY created_at DESC LIMIT 20
  `).all(req.params.id, req.tenantId) as any[];

  const tasks = db.prepare(`
    SELECT t.id, t.title, t.description, t.category, t.priority, t.status, t.due_at, t.assigned_to,
           t.related_ticket_id, t.related_automation_id, t.automation_key, t.automation_link_mode,
           t.triggered_at, t.trigger_result, t.source, t.created_at, t.resolved_at,
           u.full_name AS assigned_to_name,
           a.key AS automation_key_resolved, a.message AS automation_message, a.enabled AS automation_enabled
    FROM patient_tasks t
    LEFT JOIN users u ON u.id = t.assigned_to
    LEFT JOIN wa_automations a ON a.id = t.related_automation_id
    WHERE t.patient_id = ? AND t.tenant_id = ?
    ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END, t.created_at DESC LIMIT 40
  `).all(req.params.id, req.tenantId) as any[];

  const tickets = db.prepare(`
    SELECT id, category, priority, status, title, description, survey_score,
           assigned_to, resolution, outcome, marketing_paused, created_at, resolved_at
    FROM service_tickets WHERE patient_id = ? AND tenant_id = ?
    ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 20
  `).all(req.params.id, req.tenantId) as any[];

  ensurePatientDocumentsSchema(db);
  const documents = listUnifiedPatientDocuments(db, req.tenantId!, req.params.id);

  const privacyRequests = db.prepare(`
    SELECT id, request_type, status, requested_at AS created_at, fulfilled_at AS completed_at
    FROM lgpd_data_requests WHERE subject_type = 'patient' AND subject_id = ? AND tenant_id = ?
    ORDER BY requested_at DESC LIMIT 20
  `).all(req.params.id, req.tenantId) as any[];

  const canSeeAudit = ['admin', 'dpo'].includes(req.user?.role || '');
  const auditEvents = canSeeAudit
    ? (db.prepare(`
        SELECT id, actor_email, action, resource_type, resource_id, created_at,
               lgpd_legal_basis AS legal_basis
        FROM audit_log
        WHERE tenant_id = ? AND (
          (resource_type = 'patient' AND resource_id = ?)
          OR resource_id IN (
            SELECT id FROM appointments WHERE patient_id = ? AND tenant_id = ?
          )
        )
        ORDER BY created_at DESC LIMIT 50
      `).all(req.tenantId, req.params.id, req.params.id, req.tenantId) as any[])
    : [];

  const durableEvents = db.prepare(`
    SELECT id, kind, title, subtitle, status, meta, occurred_at AS at
    FROM patient_timeline_events
    WHERE patient_id = ? AND tenant_id = ?
    ORDER BY occurred_at DESC LIMIT 80
  `).all(req.params.id, req.tenantId) as any[];

  let waMessages: any[] = [];
  if (p.phone) {
    waMessages = db.prepare(`
      SELECT id, direction, body, created_at, status
      FROM whatsapp_messages
      WHERE phone = ? AND tenant_id = ?
      ORDER BY created_at DESC LIMIT 40
    `).all(p.phone, req.tenantId) as any[];
  }

  let assignedProfessional: any = null;
  if (p.assigned_professional_id) {
    assignedProfessional = db.prepare(`
      SELECT id, full_name, role FROM users WHERE id = ? AND tenant_id = ?
    `).get(p.assigned_professional_id, req.tenantId);
  }
  if (!assignedProfessional && appointments[0]) {
    assignedProfessional = {
      id: appointments[0].practitioner_id,
      full_name: appointments[0].practitioner_name,
      role: null,
    };
  }

  const nowIso = new Date().toISOString().slice(0, 16);
  const upcoming = appointments.filter((a) =>
    a.scheduled_at >= nowIso && !['cancelled', 'no_show', 'completed'].includes(a.status),
  );
  const lastVisit = appointments.find((a) => a.status === 'completed') || null;

  type TimelineItem = {
    id: string; kind: string; at: string; title: string; subtitle?: string;
    status?: string; meta?: Record<string, unknown>;
  };
  const timeline: TimelineItem[] = [];

  for (const a of appointments) {
    timeline.push({
      id: `appt-${a.id}`, kind: 'appointment', at: a.scheduled_at,
      title: a.status === 'completed' ? 'appointment_completed' : (a.type || 'appointment'),
      subtitle: a.practitioner_name,
      status: a.status,
      meta: { id: a.id, duration_minutes: a.duration_minutes, source: a.source, type: a.type },
    });
  }
  for (const e of encounters) {
    timeline.push({
      id: `enc-${e.id}`, kind: 'encounter', at: e.started_at,
      title: 'encounter',
      subtitle: e.practitioner_name,
      meta: clinicalOk ? {
        id: e.id,
        assessment: e.assessment ? String(e.assessment).slice(0, 160) : null,
        icd10_codes: parseArr(e.icd10_codes),
      } : { id: e.id, restricted: true },
    });
  }
  for (const pr of prescriptions) {
    timeline.push({
      id: `rx-${pr.id}`, kind: 'prescription', at: pr.created_at,
      title: pr.status === 'cancelled' ? 'prescription_cancelled' : 'prescription',
      subtitle: pr.practitioner_name,
      status: pr.status || 'active',
      meta: { id: pr.id, sent_via_whatsapp: pr.sent_via_whatsapp, status: pr.status || 'active' },
    });
  }

  if (clinicalOk) {
    const evolutions = db.prepare(`
      SELECT e.id, e.recorded_at, e.note_type, e.content, e.status, u.full_name AS author_name,
             e.signer_name, e.signer_council, e.signer_council_state
      FROM clinical_evolutions e LEFT JOIN users u ON u.id = e.author_id
      WHERE e.tenant_id = ? AND e.patient_id = ? AND e.status = 'active'
      ORDER BY e.recorded_at DESC LIMIT 40
    `).all(req.tenantId, req.params.id) as any[];
    for (const ev of evolutions) {
      timeline.push({
        id: `evol-${ev.id}`, kind: 'evolution', at: ev.recorded_at,
        title: 'evolution',
        subtitle: ev.author_name || ev.signer_name,
        meta: { id: ev.id, note_type: ev.note_type, preview: String(ev.content || '').slice(0, 160) },
      });
    }
    const procs = db.prepare(`
      SELECT id, performed_at, procedure_name, status FROM clinical_procedures
      WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
      ORDER BY performed_at DESC LIMIT 30
    `).all(req.tenantId, req.params.id) as any[];
    for (const proc of procs) {
      timeline.push({
        id: `proc-${proc.id}`, kind: 'procedure', at: proc.performed_at,
        title: proc.procedure_name || 'procedure',
        meta: { id: proc.id },
      });
    }
    const examRes = db.prepare(`
      SELECT id, resulted_at, exam_name, abnormal FROM clinical_exam_results
      WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
      ORDER BY resulted_at DESC LIMIT 30
    `).all(req.tenantId, req.params.id) as any[];
    for (const er of examRes) {
      timeline.push({
        id: `examr-${er.id}`, kind: 'exam_result', at: er.resulted_at,
        title: er.exam_name || 'exam_result',
        status: er.abnormal ? 'abnormal' : 'normal',
        meta: { id: er.id, abnormal: !!er.abnormal },
      });
    }
  }

  for (const inv of invoices) {
    timeline.push({
      id: `inv-${inv.id}`, kind: 'invoice', at: inv.issue_date,
      title: inv.invoice_number,
      subtitle: `R$ ${Number(inv.total).toFixed(2)}`,
      status: inv.status,
      meta: { id: inv.id },
    });
  }
  for (const m of waMessages) {
    timeline.push({
      id: `wa-${m.id}`, kind: 'whatsapp', at: m.created_at,
      title: m.direction === 'in' ? 'whatsapp_in' : 'whatsapp_out',
      subtitle: String(m.body || '').slice(0, 120),
      status: m.status,
      meta: { id: m.id, direction: m.direction },
    });
  }
  for (const s of surveys) {
    timeline.push({
      id: `survey-${s.id}`, kind: 'survey', at: s.created_at,
      title: 'survey_response',
      subtitle: s.comment ? String(s.comment).slice(0, 120) : undefined,
      status: String(s.score),
      meta: { id: s.id, score: s.score, appointment_id: s.appointment_id },
    });
  }
  for (const t of tasks) {
    timeline.push({
      id: `task-${t.id}`, kind: 'task', at: t.resolved_at || t.created_at,
      title: t.status === 'done' ? 'task_resolved' : 'task_created',
      subtitle: t.title,
      status: t.status,
      meta: { id: t.id, priority: t.priority, category: t.category },
    });
  }
  for (const tk of tickets) {
    timeline.push({
      id: `ticket-${tk.id}`, kind: 'complaint', at: tk.resolved_at || tk.created_at,
      title: tk.status === 'resolved' ? 'service_recovery_resolved' : 'service_recovery_opened',
      subtitle: tk.title,
      status: tk.priority,
      meta: { id: tk.id, score: tk.survey_score },
    });
  }
  for (const d of documents) {
    timeline.push({
      id: `doc-${d.id}`, kind: 'document', at: d.created_at || new Date().toISOString(),
      title: d.status === 'signed' ? 'document_signed' : (d.source === 'manual' && !d.can_download ? 'document_pending' : 'document_uploaded'),
      subtitle: d.title,
      status: d.status,
      meta: { id: d.id, doc_type: d.doc_type, source: d.source },
    });
  }
  for (const c of consents.slice(0, 15)) {
    timeline.push({
      id: `consent-${c.id}`, kind: 'consent', at: c.revoked_at || c.granted_at,
      title: c.revoked_at ? 'consent_revoked' : (c.granted ? 'consent_granted' : 'consent_denied'),
      subtitle: c.consent_type,
      status: c.revoked_at ? 'revoked' : (c.granted ? 'granted' : 'denied'),
      meta: { purpose: c.consent_type },
    });
  }
  for (const ev of durableEvents) {
    let meta: any = undefined;
    try { meta = ev.meta ? JSON.parse(ev.meta) : undefined; } catch { /* ignore */ }
    timeline.push({
      id: ev.id, kind: ev.kind, at: ev.at,
      title: ev.title, subtitle: ev.subtitle || undefined,
      status: ev.status || undefined, meta,
    });
  }
  if (p.notes) {
    timeline.push({
      id: `note-${p.id}`, kind: 'note', at: p.updated_at || p.created_at,
      title: 'admin_note',
      subtitle: String(p.notes).slice(0, 200),
    });
  }
  if (p.created_at) {
    timeline.push({
      id: `created-${p.id}`, kind: 'created', at: p.created_at,
      title: 'patient_created',
    });
  }

  // Dedupe by id (durable events may overlap appointment_completed)
  const seen = new Set<string>();
  const deduped = timeline.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  deduped.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const consentLedger = getConsentLedger(p.id);

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'view_patient_record_phi', resourceType: 'patient', resourceId: p.id,
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    legalBasis: 'health_protection_art7_VIII',
  });

  const patientOut: any = {
    ...p,
    allergies: parseArr(p.allergies),
    chronic_conditions: parseArr(p.chronic_conditions),
    medications_in_use: parseArr(p.medications_in_use),
    tags: parseArr(p.tags),
    lifecycle_stage: p.lifecycle_stage || 'new_patient',
  };
  if (!clinicalOk) {
    delete patientOut.allergies;
    delete patientOut.chronic_conditions;
    delete patientOut.medications_in_use;
    delete patientOut.blood_type;
  }

  res.json({
    patient: patientOut,
    permissions: {
      clinical: clinicalOk,
      marketing: ['admin', 'receptionist'].includes(req.user?.role || ''),
      privacy: ['admin', 'dpo'].includes(req.user?.role || ''),
    },
    workspace: {
      lifecycle_stage: patientOut.lifecycle_stage,
      next_appointment: upcoming[0] || null,
      last_visit: lastVisit,
      assigned_professional: assignedProfessional,
      communication_preference: consentLedger.find((c) => c.purpose === 'whatsapp_admin')?.granted
        ? 'whatsapp'
        : (consentLedger.find((c) => c.purpose === 'email_communication')?.granted ? 'email' : 'none'),
      consent_ok: consentLedger.some((c) => c.purpose === 'health_data_processing' && c.granted)
        || !!p.lgpd_consent_at,
      open_complaint: !!p.open_complaint,
      do_not_contact: !!p.do_not_contact,
      welcome_sent: !!p.welcome_message_sent_at,
      recall_due_at: p.recall_due_at || null,
      recall_interval_days: p.recall_interval_days ?? null,
      open_tasks: tasks.filter((t) => t.status === 'open').length,
      open_tickets: tickets.filter((t) => t.status === 'open').length,
    },
    owner_name: assignedProfessional?.full_name || null,
    upcoming_appointments: upcoming.slice(0, 8),
    timeline: deduped.slice(0, 100),
    consent_ledger: consentLedger,
    surveys,
    tasks,
    tickets,
    documents,
    privacy_requests: privacyRequests,
    audit_events: auditEvents,
    associations: {
      appointments: { count: appointments.length, items: appointments.slice(0, 8) },
      encounters: {
        count: encounters.length,
        items: encounters.slice(0, 8).map((e) => clinicalOk ? {
          id: e.id, started_at: e.started_at, ended_at: e.ended_at,
          practitioner_name: e.practitioner_name,
          icd10_codes: parseArr(e.icd10_codes),
          assessment: e.assessment ? String(e.assessment).slice(0, 120) : null,
        } : {
          id: e.id, started_at: e.started_at, practitioner_name: e.practitioner_name, restricted: true,
        }),
      },
      prescriptions: {
        count: prescriptions.length,
        items: clinicalOk
          ? prescriptions.slice(0, 8).map((pr) => ({
              id: pr.id, created_at: pr.created_at,
              practitioner_name: pr.practitioner_name,
              sent_via_whatsapp: pr.sent_via_whatsapp,
            }))
          : [],
      },
      invoices: { count: invoices.length, items: invoices.slice(0, 8) },
      consents: { count: consents.length, items: consents.slice(0, 8) },
      whatsapp: { count: waMessages.length, items: waMessages.slice(0, 5) },
      surveys: { count: surveys.length, items: surveys.slice(0, 8) },
      tasks: { count: tasks.length, items: tasks.slice(0, 8) },
      tickets: { count: tickets.length, items: tickets.slice(0, 8) },
      documents: { count: documents.length, items: documents.slice(0, 8) },
    },
  });
});

/**
 * Resolve a timeline event into a live inspectable entity payload.
 * Used by the patient workspace activity inspector (URL ?event=…).
 */
router.get('/:id/timeline/:eventId', (req: Request, res: Response) => {
  const patient = db.prepare(`SELECT id, phone, full_name FROM patients WHERE id = ? AND tenant_id = ?`)
    .get(req.params.id, req.tenantId) as any;
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }

  const eventId = String(req.params.eventId || '');
  const clinicalOk = canViewClinical(req.user?.role);
  const parseArr = (v: any): string[] => {
    if (Array.isArray(v)) return v;
    try { return v ? JSON.parse(v) : []; } catch { return []; }
  };

  const entityIdFrom = (prefix: string) =>
    eventId.startsWith(prefix) ? eventId.slice(prefix.length) : null;

  let kind = 'unknown';
  let entity: any = null;
  let related: Record<string, unknown> = {};
  const actions: Array<{ id: string; label_key: string }> = [];

  const apptId = entityIdFrom('appt-') || (req.query.appointment_id as string) || null;
  const encId = entityIdFrom('enc-');
  const rxId = entityIdFrom('rx-');
  const invId = entityIdFrom('inv-');
  const waId = entityIdFrom('wa-');
  const surveyId = entityIdFrom('survey-');
  const taskId = entityIdFrom('task-');
  const ticketId = entityIdFrom('ticket-');
  const docId = entityIdFrom('doc-');
  const consentId = entityIdFrom('consent-');

  if (apptId || eventId.startsWith('appt-')) {
    const id = apptId || entityIdFrom('appt-');
    kind = 'appointment';
    entity = db.prepare(`
      SELECT a.*, p.full_name AS patient_name, p.phone AS patient_phone,
             u.full_name AS practitioner_name
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      JOIN users u ON u.id = a.practitioner_id
      WHERE a.id = ? AND a.patient_id = ? AND a.tenant_id = ?
    `).get(id, patient.id, req.tenantId);
    if (entity) {
      actions.push(
        { id: 'goto_appointments', label_key: 'patients.inspector.action_goto_appointments' },
        { id: 'status_cycle', label_key: 'patients.inspector.action_update_status' },
      );
      if (clinicalOk) actions.push({ id: 'goto_clinical', label_key: 'patients.inspector.action_goto_clinical' });
      const linkedEnc = clinicalOk
        ? db.prepare(`
            SELECT id, started_at, assessment FROM encounters
            WHERE appointment_id = ? AND patient_id = ? AND tenant_id = ? LIMIT 1
          `).get(entity.id, patient.id, req.tenantId)
        : null;
      related = {
        encounter: linkedEnc
          ? { id: (linkedEnc as any).id, started_at: (linkedEnc as any).started_at, preview: (linkedEnc as any).assessment ? String((linkedEnc as any).assessment).slice(0, 120) : null }
          : null,
      };
    }
  } else if (encId) {
    kind = 'encounter';
    if (!clinicalOk) {
      res.status(403).json({ error: 'clinical_restricted' }); return;
    }
    const raw = db.prepare(`
      SELECT e.*, u.full_name AS practitioner_name
      FROM encounters e JOIN users u ON u.id = e.practitioner_id
      WHERE e.id = ? AND e.patient_id = ? AND e.tenant_id = ?
    `).get(encId, patient.id, req.tenantId) as any;
    if (raw) {
      entity = revealEncounterRow(raw)!;
      entity.practitioner_name = raw.practitioner_name;
      entity.icd10_codes = parseArr(entity.icd10_codes);
      actions.push(
        { id: 'goto_clinical', label_key: 'patients.inspector.action_goto_clinical' },
        { id: 'goto_encounters', label_key: 'patients.inspector.action_goto_encounters' },
      );
      if (entity.appointment_id) {
        related.appointment = db.prepare(`
          SELECT id, scheduled_at, type, status FROM appointments WHERE id = ? AND tenant_id = ?
        `).get(entity.appointment_id, req.tenantId);
      }
    }
  } else if (rxId) {
    kind = 'prescription';
    if (!clinicalOk) {
      res.status(403).json({ error: 'clinical_restricted' }); return;
    }
    const raw = db.prepare(`
      SELECT pr.*, u.full_name AS practitioner_name
      FROM prescriptions pr LEFT JOIN users u ON u.id = pr.practitioner_id
      WHERE pr.id = ? AND pr.patient_id = ? AND pr.tenant_id = ?
    `).get(rxId, patient.id, req.tenantId) as any;
    if (raw) {
      entity = { ...raw, items: revealPrescriptionItems(raw.items) };
      actions.push({ id: 'goto_clinical', label_key: 'patients.inspector.action_goto_clinical' });
    }
  } else if (invId) {
    kind = 'invoice';
    const inv = db.prepare(`
      SELECT i.*, p.full_name AS patient_name
      FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id
      WHERE i.id = ? AND i.patient_id = ? AND i.tenant_id = ?
    `).get(invId, patient.id, req.tenantId) as any;
    if (inv) {
      entity = inv;
      related = {
        lines: db.prepare(`SELECT * FROM invoice_lines WHERE invoice_id = ?`).all(invId),
        documents: db.prepare(`
          SELECT id, original_name, mime_type, size_bytes, ocr_status, ocr_model, created_at
          FROM invoice_documents WHERE invoice_id = ? AND tenant_id = ? ORDER BY created_at DESC
        `).all(invId, req.tenantId),
      };
      actions.push(
        { id: 'goto_billing', label_key: 'patients.inspector.action_goto_billing' },
        { id: 'open_invoices', label_key: 'patients.inspector.action_open_invoices' },
      );
      if (inv.status !== 'paid' && ['admin', 'accountant', 'receptionist'].includes(req.user?.role || '')) {
        actions.push({ id: 'mark_paid', label_key: 'patients.inspector.action_mark_paid' });
      }
    }
  } else if (waId) {
    kind = 'whatsapp';
    if (patient.phone) {
      entity = db.prepare(`
        SELECT id, direction, body, status, created_at, phone
        FROM whatsapp_messages WHERE id = ? AND phone = ? AND tenant_id = ?
      `).get(waId, patient.phone, req.tenantId);
    }
    actions.push({ id: 'goto_whatsapp', label_key: 'patients.inspector.action_goto_whatsapp' });
  } else if (surveyId) {
    kind = 'survey';
    entity = db.prepare(`
      SELECT * FROM satisfaction_surveys WHERE id = ? AND patient_id = ? AND tenant_id = ?
    `).get(surveyId, patient.id, req.tenantId);
    actions.push({ id: 'goto_surveys', label_key: 'patients.inspector.action_goto_surveys' });
  } else if (taskId) {
    kind = 'task';
    entity = db.prepare(`
      SELECT * FROM patient_tasks WHERE id = ? AND patient_id = ? AND tenant_id = ?
    `).get(taskId, patient.id, req.tenantId);
    actions.push({ id: 'goto_tasks', label_key: 'patients.inspector.action_goto_tasks' });
    if (entity && (entity as any).status === 'open') {
      actions.push({ id: 'resolve_task', label_key: 'patients.inspector.action_resolve' });
    }
  } else if (ticketId) {
    kind = 'complaint';
    entity = db.prepare(`
      SELECT * FROM service_tickets WHERE id = ? AND patient_id = ? AND tenant_id = ?
    `).get(ticketId, patient.id, req.tenantId);
    actions.push({ id: 'goto_tasks', label_key: 'patients.inspector.action_goto_tasks' });
    if (entity && (entity as any).status === 'open') {
      actions.push({ id: 'resolve_ticket', label_key: 'patients.inspector.action_resolve' });
    }
  } else if (docId) {
    kind = 'document';
    entity = db.prepare(`
      SELECT * FROM patient_documents WHERE id = ? AND patient_id = ? AND tenant_id = ?
    `).get(docId, patient.id, req.tenantId);
    actions.push({ id: 'goto_documents', label_key: 'patients.inspector.action_goto_documents' });
  } else if (consentId) {
    kind = 'consent';
    entity = db.prepare(`
      SELECT id, consent_type, granted, granted_at, revoked_at, policy_version
      FROM lgpd_consents WHERE id = ? AND subject_type = 'patient' AND subject_id = ?
    `).get(consentId, patient.id);
    actions.push({ id: 'goto_privacy', label_key: 'patients.inspector.action_goto_privacy' });
  } else if (eventId.startsWith('created-') || eventId.startsWith('note-')) {
    kind = eventId.startsWith('note-') ? 'note' : 'created';
    entity = {
      patient_id: patient.id,
      full_name: patient.full_name,
      kind,
    };
    actions.push({ id: 'edit_patient', label_key: 'patients.inspector.action_edit_patient' });
  } else {
    // Durable patient_timeline_events row
    const durable = db.prepare(`
      SELECT id, kind, title, subtitle, status, meta, occurred_at AS at
      FROM patient_timeline_events
      WHERE id = ? AND patient_id = ? AND tenant_id = ?
    `).get(eventId, patient.id, req.tenantId) as any;
    if (durable) {
      kind = durable.kind || 'lifecycle';
      let meta: any = undefined;
      try { meta = durable.meta ? JSON.parse(durable.meta) : undefined; } catch { /* */ }
      entity = { ...durable, meta };
      if (meta?.appointment_id) {
        related.appointment = db.prepare(`
          SELECT id, scheduled_at, type, status FROM appointments WHERE id = ? AND tenant_id = ?
        `).get(meta.appointment_id, req.tenantId);
        actions.push({ id: 'open_related_appt', label_key: 'patients.inspector.action_open_related' });
      }
      if (meta?.purpose) actions.push({ id: 'goto_privacy', label_key: 'patients.inspector.action_goto_privacy' });
      if (meta?.task_id) actions.push({ id: 'goto_tasks', label_key: 'patients.inspector.action_goto_tasks' });
    }
  }

  if (!entity) {
    res.status(404).json({ error: 'event_not_found', event_id: eventId });
    return;
  }

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'inspect_timeline_event',
    resourceType: 'patient',
    resourceId: patient.id,
    afterValue: { event_id: eventId, kind },
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    legalBasis: clinicalOk && ['encounter', 'prescription'].includes(kind)
      ? 'health_protection_art7_VIII'
      : 'legitimate_interest_art7_VI',
  });

  res.json({
    event_id: eventId,
    kind,
    entity,
    related,
    actions,
    patient: { id: patient.id, full_name: patient.full_name },
  });
});

/** Update granular consent ledger from Patient Workspace. */
router.put('/:id/consents', requireRole('admin', 'doctor', 'nurse', 'receptionist', 'dpo'), (req: Request, res: Response) => {
  const p = db.prepare(`SELECT id FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  const purpose = String(req.body?.purpose || '');
  if (!(CONSENT_PURPOSES as readonly string[]).includes(purpose)) {
    res.status(400).json({ error: 'invalid_purpose', allowed: CONSENT_PURPOSES }); return;
  }
  const granted = !!req.body?.granted;
  setPatientConsent({
    patientId: req.params.id,
    tenantId: req.tenantId!,
    purpose: purpose as ConsentPurpose,
    granted,
    actorId: req.user!.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] as string,
    source: 'patient_workspace',
  });
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: granted ? 'grant_patient_consent' : 'revoke_patient_consent',
    resourceType: 'patient', resourceId: req.params.id,
    afterValue: { purpose, granted },
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    legalBasis: 'consent_art7_I',
  });
  res.json({ ok: true, ledger: getConsentLedger(req.params.id) });
});

/** Update lifecycle stage from Patient Workspace. */
router.put('/:id/lifecycle', requireRole('admin', 'doctor', 'nurse', 'receptionist'), (req: Request, res: Response) => {
  const p = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  const stage = String(req.body?.lifecycle_stage || '');
  if (!(LIFECYCLE_STAGES as readonly string[]).includes(stage)) {
    res.status(400).json({ error: 'invalid_lifecycle_stage', allowed: LIFECYCLE_STAGES }); return;
  }
  const doNotContact = stage === 'do_not_contact' ? 1 : (req.body?.do_not_contact ? 1 : 0);
  db.prepare(`
    UPDATE patients SET lifecycle_stage = ?, do_not_contact = ?, updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).run(stage, doNotContact, req.params.id, req.tenantId);
  db.prepare(`
    INSERT INTO patient_timeline_events
      (id, tenant_id, patient_id, kind, title, subtitle, status, meta, occurred_at)
    VALUES (?, ?, ?, 'lifecycle', 'lifecycle_changed', ?, ?, ?, datetime('now'))
  `).run(
    `pte_lc_${Date.now().toString(36)}`,
    req.tenantId,
    req.params.id,
    `${p.lifecycle_stage || 'new_patient'} → ${stage}`,
    stage,
    JSON.stringify({ from: p.lifecycle_stage, to: stage }),
  );
  res.json({ ok: true, lifecycle_stage: stage });
});

/** Create follow-up / service task on patient workspace (optionally linked to automation). */
router.post('/:id/tasks', requireRole('admin', 'doctor', 'nurse', 'receptionist'), async (req: Request, res: Response) => {
  const p = db.prepare(`SELECT id FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  const title = String(req.body?.title || '').trim();
  if (!title) { res.status(400).json({ error: 'title_required' }); return; }

  const category = String(req.body?.category || 'follow_up');
  const priority = String(req.body?.priority || 'normal');
  const dueAt = req.body?.due_at ? String(req.body.due_at) : null;
  const assignedTo = req.body?.assigned_to ? String(req.body.assigned_to) : null;
  const description = req.body?.description ? String(req.body.description) : null;
  const relatedAppointmentId = req.body?.related_appointment_id ? String(req.body.related_appointment_id) : null;
  let relatedAutomationId = req.body?.related_automation_id ? String(req.body.related_automation_id) : null;
  let automationKey = req.body?.automation_key ? String(req.body.automation_key) : null;
  const automationLinkMode = req.body?.automation_link_mode
    ? String(req.body.automation_link_mode)
    : (relatedAutomationId ? 'reference' : null);
  const runNow = !!req.body?.run_automation_now
    || automationLinkMode === 'trigger_on_create';

  if (relatedAutomationId) {
    const auto = db.prepare(`SELECT id, key, enabled FROM wa_automations WHERE id = ? AND tenant_id = ?`)
      .get(relatedAutomationId, req.tenantId) as any;
    if (!auto) { res.status(400).json({ error: 'automation_not_found' }); return; }
    automationKey = auto.key;
  } else if (automationKey) {
    const auto = db.prepare(`SELECT id, key FROM wa_automations WHERE key = ? AND tenant_id = ?`)
      .get(automationKey, req.tenantId) as any;
    if (auto) relatedAutomationId = auto.id;
  }

  const taskId = createPatientTask({
    tenantId: req.tenantId!,
    patientId: req.params.id,
    title,
    description,
    category,
    priority,
    dueAt,
    assignedTo,
    createdBy: req.user!.id,
    relatedAppointmentId,
    relatedAutomationId,
    automationKey,
    automationLinkMode,
    source: relatedAutomationId ? 'manual_linked' : 'manual',
  });

  let trigger: any = null;
  if (runNow && relatedAutomationId) {
    const { runAutomationForPatient } = await import('../services/marketing');
    const locale = (req.headers['accept-language'] || 'pt-BR').toString().slice(0, 5) as any;
    trigger = await runAutomationForPatient(req.tenantId!, relatedAutomationId, req.params.id, locale);
    db.prepare(`
      UPDATE patient_tasks
      SET triggered_at = datetime('now'), trigger_result = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(trigger), taskId);
  }

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_patient_task', resourceType: 'patient_task', resourceId: taskId,
    afterValue: { patient_id: req.params.id, category, automation_id: relatedAutomationId, run: runNow },
    legalBasis: 'contract_art7_V',
  });

  const task = db.prepare(`SELECT * FROM patient_tasks WHERE id = ?`).get(taskId);
  res.status(201).json({ ok: true, id: taskId, task, trigger });
});

router.patch('/:id/tasks/:taskId', requireRole('admin', 'doctor', 'nurse', 'receptionist'), async (req: Request, res: Response) => {
  const task = db.prepare(`
    SELECT * FROM patient_tasks WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).get(req.params.taskId, req.params.id, req.tenantId) as any;
  if (!task) { res.status(404).json({ error: 'not_found' }); return; }

  const title = req.body?.title != null ? String(req.body.title).trim() : task.title;
  if (!title) { res.status(400).json({ error: 'title_required' }); return; }
  const description = req.body?.description !== undefined
    ? (req.body.description ? String(req.body.description) : null)
    : task.description;
  const category = req.body?.category != null ? String(req.body.category) : task.category;
  const priority = req.body?.priority != null ? String(req.body.priority) : task.priority;
  const dueAt = req.body?.due_at !== undefined
    ? (req.body.due_at ? String(req.body.due_at) : null)
    : task.due_at;
  const assignedTo = req.body?.assigned_to !== undefined
    ? (req.body.assigned_to ? String(req.body.assigned_to) : null)
    : task.assigned_to;
  const status = req.body?.status ? String(req.body.status) : task.status;

  let relatedAutomationId = req.body?.related_automation_id !== undefined
    ? (req.body.related_automation_id ? String(req.body.related_automation_id) : null)
    : task.related_automation_id;
  let automationKey = req.body?.automation_key !== undefined
    ? (req.body.automation_key ? String(req.body.automation_key) : null)
    : task.automation_key;
  const automationLinkMode = req.body?.automation_link_mode !== undefined
    ? (req.body.automation_link_mode ? String(req.body.automation_link_mode) : null)
    : task.automation_link_mode;

  if (req.body?.related_automation_id) {
    const auto = db.prepare(`SELECT id, key FROM wa_automations WHERE id = ? AND tenant_id = ?`)
      .get(relatedAutomationId, req.tenantId) as any;
    if (!auto) { res.status(400).json({ error: 'automation_not_found' }); return; }
    automationKey = auto.key;
  }

  const becomingDone = status === 'done' || status === 'cancelled';
  const resolvedAt = becomingDone
    ? (task.resolved_at || new Date().toISOString())
    : (status === 'open' ? null : task.resolved_at);

  db.prepare(`
    UPDATE patient_tasks SET
      title = ?, description = ?, category = ?, priority = ?, due_at = ?, assigned_to = ?,
      status = ?, resolved_at = ?,
      related_automation_id = ?, automation_key = ?, automation_link_mode = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title, description, category, priority, dueAt, assignedTo,
    status, resolvedAt,
    relatedAutomationId, automationKey, automationLinkMode,
    task.id,
  );

  let trigger: any = null;
  const shouldTriggerOnComplete = becomingDone
    && status === 'done'
    && relatedAutomationId
    && (automationLinkMode === 'trigger_on_complete' || !!req.body?.run_automation_now)
    && !task.triggered_at;

  if (shouldTriggerOnComplete || (!!req.body?.run_automation_now && relatedAutomationId && !becomingDone)) {
    const { runAutomationForPatient } = await import('../services/marketing');
    const locale = (req.headers['accept-language'] || 'pt-BR').toString().slice(0, 5) as any;
    trigger = await runAutomationForPatient(req.tenantId!, relatedAutomationId, req.params.id, locale);
    db.prepare(`
      UPDATE patient_tasks
      SET triggered_at = datetime('now'), trigger_result = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(trigger), task.id);
  }

  if (status === 'done' && task.status !== 'done') {
    db.prepare(`
      INSERT INTO patient_timeline_events
        (id, tenant_id, patient_id, kind, title, subtitle, status, meta, occurred_at)
      VALUES (?, ?, ?, 'task', 'task_resolved', ?, 'done', ?, datetime('now'))
    `).run(
      `pte_tr_${Date.now().toString(36)}`,
      req.tenantId,
      req.params.id,
      title,
      JSON.stringify({ task_id: task.id, automation_id: relatedAutomationId }),
    );
  }

  res.json({
    ok: true,
    status,
    trigger,
    task: db.prepare(`SELECT * FROM patient_tasks WHERE id = ?`).get(task.id),
  });
});

/** Trigger linked automation for an existing task (patient-scoped). */
router.post('/:id/tasks/:taskId/run-automation', requireRole('admin', 'doctor', 'nurse', 'receptionist'), async (req: Request, res: Response) => {
  const task = db.prepare(`
    SELECT * FROM patient_tasks WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).get(req.params.taskId, req.params.id, req.tenantId) as any;
  if (!task) { res.status(404).json({ error: 'not_found' }); return; }
  const automationId = String(req.body?.automation_id || task.related_automation_id || '').trim();
  if (!automationId) { res.status(400).json({ error: 'automation_required' }); return; }

  const { runAutomationForPatient } = await import('../services/marketing');
  const locale = (req.headers['accept-language'] || 'pt-BR').toString().slice(0, 5) as any;
  const trigger = await runAutomationForPatient(req.tenantId!, automationId, req.params.id, locale);
  const auto = db.prepare(`SELECT key FROM wa_automations WHERE id = ? AND tenant_id = ?`).get(automationId, req.tenantId) as any;
  db.prepare(`
    UPDATE patient_tasks SET
      related_automation_id = COALESCE(related_automation_id, ?),
      automation_key = COALESCE(automation_key, ?),
      triggered_at = datetime('now'),
      trigger_result = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(automationId, auto?.key || null, JSON.stringify(trigger), task.id);

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'run_task_automation', resourceType: 'patient_task', resourceId: task.id,
    afterValue: { patient_id: req.params.id, automation_id: automationId, result: trigger },
    legalBasis: 'contract_art7_V',
  });

  res.json({ ok: true, trigger });
});

/** Open manual service-recovery ticket. */
router.post('/:id/tickets', requireRole('admin', 'doctor', 'nurse', 'receptionist'), (req: Request, res: Response) => {
  const p = db.prepare(`SELECT id FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  const score = Number(req.body?.survey_score ?? 0);
  const result = openServiceRecoveryTicket({
    tenantId: req.tenantId!,
    patientId: req.params.id,
    surveyScore: Number.isFinite(score) ? score : 0,
    comment: req.body?.description ? String(req.body.description) : String(req.body?.title || 'Ticket manual'),
    createdBy: req.user!.id,
  });
  res.status(201).json({ ok: true, ...result });
});

router.patch('/:id/tickets/:ticketId', requireRole('admin', 'doctor', 'nurse', 'receptionist'), (req: Request, res: Response) => {
  const ticket = db.prepare(`
    SELECT * FROM service_tickets WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).get(req.params.ticketId, req.params.id, req.tenantId) as any;
  if (!ticket) { res.status(404).json({ error: 'not_found' }); return; }
  const status = req.body?.status ? String(req.body.status) : ticket.status;
  const resolution = req.body?.resolution != null ? String(req.body.resolution) : ticket.resolution;
  const outcome = req.body?.outcome != null ? String(req.body.outcome) : ticket.outcome;
  const resolvedAt = status === 'resolved' || status === 'closed' ? new Date().toISOString() : null;
  db.prepare(`
    UPDATE service_tickets SET status = ?, resolution = ?, outcome = ?,
      resolved_at = COALESCE(?, resolved_at), updated_at = datetime('now')
    WHERE id = ?
  `).run(status, resolution, outcome, resolvedAt, ticket.id);
  if (status === 'resolved' || status === 'closed') {
    const openLeft = (db.prepare(`
      SELECT COUNT(*) AS c FROM service_tickets
      WHERE patient_id = ? AND tenant_id = ? AND status = 'open'
    `).get(req.params.id, req.tenantId) as any).c;
    if (!openLeft) {
      db.prepare(`UPDATE patients SET open_complaint = 0, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`)
        .run(req.params.id, req.tenantId);
    }
    db.prepare(`
      INSERT INTO patient_timeline_events
        (id, tenant_id, patient_id, kind, title, subtitle, status, meta, occurred_at)
      VALUES (?, ?, ?, 'complaint', 'service_recovery_resolved', ?, ?, ?, datetime('now'))
    `).run(
      `pte_sr_${Date.now().toString(36)}`,
      req.tenantId,
      req.params.id,
      resolution || ticket.title,
      status,
      JSON.stringify({ ticket_id: ticket.id, outcome }),
    );
  }
  res.json({ ok: true, status });
});

/** Set recall interval (days from now). */
router.put('/:id/recall', requireRole('admin', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const p = db.prepare(`SELECT id FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  const days = parseInt(String(req.body?.interval_days || 0), 10);
  if (!days || days < 1 || days > 3650) {
    res.status(400).json({ error: 'invalid_interval_days' }); return;
  }
  const result = setPatientRecall({
    tenantId: req.tenantId!,
    patientId: req.params.id,
    intervalDays: days,
    actorId: req.user!.id,
  });
  res.json({ ok: true, ...result });
});

/** List unified patient documents (manual + intake + clinical + invoices + reports). */
router.get('/:id/documents', (req: Request, res: Response) => {
  const p = db.prepare(`SELECT id FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  ensurePatientDocumentsSchema(db);
  const documents = listUnifiedPatientDocuments(db, req.tenantId!, req.params.id);
  res.json({ documents });
});

/** Upload / register a document on the patient vault (optional base64 file). */
router.post('/:id/documents', requireRole('admin', 'doctor', 'nurse', 'receptionist'), (req: Request, res: Response) => {
  const p = db.prepare(`SELECT id FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  ensurePatientDocumentsSchema(db);

  const filename = String(req.body?.filename || req.body?.original_name || '').trim();
  const dataB64 = req.body?.data_base64 ? String(req.body.data_base64) : '';
  const title = String(req.body?.title || filename || '').trim();
  if (!title && !dataB64) { res.status(400).json({ error: 'title_required' }); return; }

  let buffer: Buffer | null = null;
  if (dataB64) {
    try {
      const raw = dataB64.replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(raw, 'base64');
    } catch {
      res.status(400).json({ error: 'invalid_base64' }); return;
    }
    if (buffer.length > 12 * 1024 * 1024) {
      res.status(400).json({ error: 'file_too_large', message: 'Max 12MB' }); return;
    }
  }

  const id = `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const status = buffer ? 'active' : String(req.body?.status || 'pending');
  const signedAt = status === 'signed' ? new Date().toISOString() : null;
  const mime = req.body?.mime || req.body?.mime_type || (filename ? mimeFromName(filename) : null);
  let storagePath: string | null = null;
  let originalName: string | null = filename || null;
  let sizeBytes: number | null = null;

  if (buffer) {
    const written = writePatientDocumentFile({
      tenantId: req.tenantId!,
      patientId: req.params.id,
      docId: id,
      filename: filename || `${title || 'documento'}.bin`,
      buffer,
    });
    storagePath = written.storagePath;
    originalName = written.originalName;
    sizeBytes = buffer.length;
  }

  db.prepare(`
    INSERT INTO patient_documents
      (id, tenant_id, patient_id, doc_type, title, status, signed_at, notes, created_by,
       source, source_id, mime_type, original_name, storage_path, size_bytes, file_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.tenantId,
    req.params.id,
    String(req.body?.doc_type || (buffer ? 'upload' : 'form')),
    title || originalName || 'Documento',
    status,
    signedAt,
    req.body?.notes ? String(req.body.notes) : null,
    req.user!.id,
    id,
    mime,
    originalName,
    storagePath,
    sizeBytes,
    req.body?.file_url ? String(req.body.file_url) : null,
  );
  db.prepare(`
    INSERT INTO patient_timeline_events
      (id, tenant_id, patient_id, kind, title, subtitle, status, meta, occurred_at)
    VALUES (?, ?, ?, 'document', ?, ?, ?, ?, datetime('now'))
  `).run(
    `pte_doc_${Date.now().toString(36)}`,
    req.tenantId,
    req.params.id,
    buffer ? 'document_uploaded' : (status === 'signed' ? 'document_signed' : 'document_pending'),
    title || originalName || 'Documento',
    status,
    JSON.stringify({ document_id: id, has_file: !!buffer }),
  );
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'patient_document_create',
    resourceType: 'patient_document',
    resourceId: id,
    afterValue: { patient_id: req.params.id, has_file: !!buffer },
  });
  res.status(201).json({
    ok: true,
    id,
    document: listUnifiedPatientDocuments(db, req.tenantId!, req.params.id).find((d) => d.id === id) || null,
  });
});

/** Download aggregated source files (intake JSON, clinical attachment bytes). */
router.get('/:id/documents/by-source/:source/:sourceId/file', (req: Request, res: Response) => {
  const p = db.prepare(`SELECT id FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  const source = String(req.params.source || '');
  const sourceId = String(req.params.sourceId || '');

  if (source === 'intake_submission') {
    const row = db.prepare(`
      SELECT s.*, f.name AS form_name, f.kind AS form_kind, f.slug
      FROM intake_submissions s
      LEFT JOIN intake_forms f ON f.id = s.form_id
      WHERE s.id = ? AND s.patient_id = ? AND s.tenant_id = ?
    `).get(sourceId, req.params.id, req.tenantId) as any;
    if (!row) { res.status(404).json({ error: 'not_found' }); return; }
    const payload = openJson(row.payload, null);
    const exportBody = {
      id: row.id,
      form_name: row.form_name,
      form_kind: row.form_kind,
      form_slug: row.slug,
      status: row.status,
      full_name: row.full_name,
      birth_date: row.birth_date,
      phone: row.phone,
      city: row.city,
      state: row.state,
      submitted_at: row.pixel_submitted_at || row.created_at,
      payload,
    };
    const buf = Buffer.from(JSON.stringify(exportBody, null, 2), 'utf8');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="intake_${sourceId}.json"`);
    res.send(buf);
    return;
  }

  if (source === 'clinical_attachment') {
    const row = db.prepare(`
      SELECT * FROM clinical_attachments
      WHERE id = ? AND patient_id = ? AND tenant_id = ? AND status = 'active'
    `).get(sourceId, req.params.id, req.tenantId) as any;
    if (!row) { res.status(404).json({ error: 'not_found' }); return; }
    if (row.file_path && /^https?:\/\//i.test(row.file_path)) {
      res.redirect(row.file_path);
      return;
    }
    if (!row.file_path || !fs.existsSync(row.file_path)) {
      res.status(404).json({ error: 'file_missing' }); return;
    }
    res.setHeader('Content-Type', row.mime || mimeFromName(row.file_path));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(row.title || path.basename(row.file_path))}"`,
    );
    fs.createReadStream(row.file_path).pipe(res);
    return;
  }

  res.status(400).json({ error: 'unsupported_source' });
});

/** Stream a vault-stored file. */
router.get('/:id/documents/:docId/file', (req: Request, res: Response) => {
  const p = db.prepare(`SELECT id FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  ensurePatientDocumentsSchema(db);
  const doc = db.prepare(`
    SELECT * FROM patient_documents
    WHERE id = ? AND patient_id = ? AND tenant_id = ? AND deleted_at IS NULL
  `).get(req.params.docId, req.params.id, req.tenantId) as any;
  if (!doc) { res.status(404).json({ error: 'not_found' }); return; }
  if (!doc.storage_path || !fs.existsSync(doc.storage_path)) {
    res.status(404).json({ error: 'file_missing' }); return;
  }
  res.setHeader('Content-Type', doc.mime_type || mimeFromName(doc.original_name || doc.storage_path));
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(doc.original_name || path.basename(doc.storage_path))}"`,
  );
  fs.createReadStream(doc.storage_path).pipe(res);
});

/** Soft-delete a manual vault document, or cancel a clinical attachment. */
router.delete('/:id/documents/:docId', requireRole('admin', 'doctor', 'nurse', 'receptionist'), (req: Request, res: Response) => {
  const p = db.prepare(`SELECT id FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  ensurePatientDocumentsSchema(db);
  const docId = String(req.params.docId || '');

  if (docId.startsWith('att_')) {
    const attId = docId.slice(4);
    const row = db.prepare(`
      SELECT * FROM clinical_attachments WHERE id = ? AND patient_id = ? AND tenant_id = ?
    `).get(attId, req.params.id, req.tenantId) as any;
    if (!row) { res.status(404).json({ error: 'not_found' }); return; }
    db.prepare(`UPDATE clinical_attachments SET status='cancelled' WHERE id=? AND tenant_id=?`)
      .run(attId, req.tenantId);
    db.prepare(`
      UPDATE patient_documents SET deleted_at = datetime('now'), deleted_by = ?, updated_at = datetime('now')
      WHERE tenant_id = ? AND patient_id = ? AND source = 'clinical_attachment' AND source_id = ?
        AND deleted_at IS NULL
    `).run(req.user!.id, req.tenantId, req.params.id, attId);
    logAudit({
      tenantId: req.tenantId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'patient_document_remove_attachment',
      resourceType: 'clinical_attachment',
      resourceId: attId,
    });
    res.json({ ok: true, removed: docId });
    return;
  }

  const doc = db.prepare(`
    SELECT * FROM patient_documents
    WHERE id = ? AND patient_id = ? AND tenant_id = ? AND deleted_at IS NULL
  `).get(docId, req.params.id, req.tenantId) as any;
  if (!doc) { res.status(404).json({ error: 'not_found' }); return; }
  if ((doc.source || 'manual') !== 'manual') {
    res.status(403).json({ error: 'cannot_delete_ingested', message: 'Documentos de intake/fatura/relatório não podem ser removidos aqui.' });
    return;
  }
  db.prepare(`
    UPDATE patient_documents SET deleted_at = datetime('now'), deleted_by = ?, status = 'removed', updated_at = datetime('now')
    WHERE id = ?
  `).run(req.user!.id, docId);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'patient_document_delete',
    resourceType: 'patient_document',
    resourceId: docId,
  });
  res.json({ ok: true, removed: docId });
});

// Clinical snapshot for the scheduler drawer — everything the medical team
// needs next to an appointment to make an educated decision.
router.get('/:id/summary', (req: Request, res: Response) => {
  const p = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  const parseArr = (v: any): string[] => { try { return v ? JSON.parse(v) : []; } catch { return []; } };
  const recentEncounters = db.prepare(`
    SELECT e.id, e.started_at, e.assessment, e.icd10_codes, u.full_name AS practitioner_name
    FROM encounters e JOIN users u ON u.id = e.practitioner_id
    WHERE e.patient_id = ? AND e.tenant_id = ? ORDER BY e.started_at DESC LIMIT 3
  `).all(req.params.id, req.tenantId) as any[];
  const upcoming = db.prepare(`
    SELECT a.id, a.scheduled_at, a.type, a.status, u.full_name AS practitioner_name
    FROM appointments a JOIN users u ON u.id = a.practitioner_id
    WHERE a.patient_id = ? AND a.tenant_id = ? AND a.scheduled_at >= datetime('now')
      AND a.status NOT IN ('cancelled','no_show','completed')
    ORDER BY a.scheduled_at ASC LIMIT 5
  `).all(req.params.id, req.tenantId);
  const activePrescriptions = (db.prepare(`
    SELECT COUNT(*) AS c FROM prescriptions
    WHERE patient_id = ? AND tenant_id = ? AND COALESCE(status, 'active') = 'active'
  `).get(req.params.id, req.tenantId) as any).c;
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'view_patient_summary_phi', resourceType: 'patient', resourceId: p.id,
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({
    patient: {
      id: p.id, full_name: p.full_name, birth_date: p.birth_date, gender: p.gender,
      phone: p.phone, email: p.email, cpf: p.cpf,
      blood_type: p.blood_type, health_insurance: p.health_insurance,
      health_insurance_number: p.health_insurance_number,
      allergies: parseArr(p.allergies),
      chronic_conditions: parseArr(p.chronic_conditions),
      medications_in_use: parseArr(p.medications_in_use),
      emergency_contact_name: p.emergency_contact_name,
      emergency_contact_phone: p.emergency_contact_phone,
    },
    recent_encounters: recentEncounters.map((e) => ({ ...e, icd10_codes: parseArr(e.icd10_codes) })),
    upcoming_appointments: upcoming,
    prescriptions_count: activePrescriptions,
  });
});

// Patient LGPD data export (portability)
router.get('/:id/data-export', requireRole('admin', 'patient', 'doctor'), (req: Request, res: Response) => {
  const raw = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId);
  if (!raw) { res.status(404).json({ error: 'not_found' }); return; }
  const p = revealPatientRow(raw as any);
  const encounters = (db.prepare(`SELECT * FROM encounters WHERE patient_id = ? AND tenant_id = ? ORDER BY started_at DESC`).all(req.params.id, req.tenantId) as any[])
    .map((e) => revealEncounterRow(e)!);
  const prescriptions = (db.prepare(`SELECT * FROM prescriptions WHERE patient_id = ? AND tenant_id = ? ORDER BY created_at DESC`).all(req.params.id, req.tenantId) as any[])
    .map((pr) => ({ ...pr, items: revealPrescriptionItems(pr.items) }));
  const appointments = db.prepare(`SELECT * FROM appointments WHERE patient_id = ? AND tenant_id = ? ORDER BY scheduled_at DESC`).all(req.params.id, req.tenantId);
  const consents = db.prepare(`SELECT * FROM lgpd_consents WHERE subject_type='patient' AND subject_id = ? ORDER BY granted_at DESC`).all(req.params.id);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'lgpd_data_portability_export',
    resourceType: 'patient', resourceId: req.params.id,
    legalBasis: 'consent_art7_I',
  });
  res.json({
    patient: p, encounters, prescriptions, appointments, consents,
    generated_at: new Date().toISOString(),
    legal_basis: 'LGPD art. 18, V — direito de portabilidade',
    encryption_note: 'Dados armazenados com AES-256-GCM; exportação em claro apenas para o titular/autorizado.',
  });
});

export default router;
