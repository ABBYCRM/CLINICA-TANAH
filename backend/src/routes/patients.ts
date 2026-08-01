import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit, recordConsent, hasActiveConsent } from '../services/audit';

const router = Router();

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
});

router.use(authenticate);

// List patients — with search and pagination
router.get('/', (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  const limit = Math.min(parseInt(req.query.limit as string || '50'), 200);
  const offset = parseInt(req.query.offset as string || '0');
  let rows: any[];
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT id, full_name, social_name, phone, email, cpf, birth_date, health_insurance, created_at
      FROM patients
      WHERE tenant_id = ? AND (
        full_name LIKE ? OR social_name LIKE ? OR cpf LIKE ? OR phone LIKE ?
        OR REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') LIKE ?
      )
      ORDER BY full_name ASC LIMIT ? OFFSET ?
    `).all(req.tenantId, like, like, like, like, `%${q.replace(/\D/g, '') || q}%`, limit, offset);
  } else {
    rows = db.prepare(`
      SELECT id, full_name, social_name, phone, email, cpf, birth_date, health_insurance, created_at
      FROM patients WHERE tenant_id = ? ORDER BY full_name ASC LIMIT ? OFFSET ?
    `).all(req.tenantId, limit, offset);
  }
  const total = (db.prepare(`SELECT COUNT(*) as c FROM patients WHERE tenant_id = ?`).get(req.tenantId) as any).c;
  res.json({ patients: rows, total });
});

// Get single patient — audit logged (PHI access)
router.get('/:id', (req: Request, res: Response) => {
  const p = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'view_patient_phi', resourceType: 'patient', resourceId: p.id,
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
  db.prepare(`
    INSERT INTO patients (id, tenant_id, full_name, social_name, birth_date, cpf, rg, rg_issuer, gender, phone, phone_secondary, email,
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
            ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, req.tenantId, d.full_name, d.social_name ?? null, d.birth_date, d.cpf ?? null, d.rg ?? null,
    d.rg_issuer ?? null, d.gender ?? null, d.phone, d.phone_secondary ?? null, d.email ?? null,
    d.address_zip ?? null, d.address_street ?? null, d.address_number ?? null, d.address_complement ?? null,
    d.address_neighborhood ?? null, d.address_city ?? null, d.address_state ?? null,
    d.marital_status ?? null, d.occupation ?? null, d.education_level ?? null, d.nationality ?? null,
    d.birthplace ?? null, d.mother_name ?? null, d.father_name ?? null, d.race_color ?? null,
    d.cns ?? null, d.referral_source ?? null, d.notes ?? null,
    d.health_insurance ?? null, d.health_insurance_number ?? null, d.blood_type ?? null,
    JSON.stringify(d.allergies), JSON.stringify(d.chronic_conditions), JSON.stringify(d.medications_in_use),
    d.emergency_contact_name ?? null, d.emergency_contact_phone ?? null,
    now, req.ip ?? null, d.lgpd_policy_version,
    now, now
  );
  // Record formal LGPD consent
  recordConsent({
    tenantId: req.tenantId,
    subjectType: 'patient', subjectId: id,
    consentType: 'health_data_processing',
    granted: true, policyVersion: d.lgpd_policy_version,
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    evidence: 'Consentimento fornecido durante o cadastro presencial/telefônico.',
  });
  if (d.phone) {
    recordConsent({
      tenantId: req.tenantId,
      subjectType: 'patient', subjectId: id,
      consentType: 'whatsapp_communication',
      granted: true, policyVersion: d.lgpd_policy_version,
      ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
      evidence: 'Consentimento WhatsApp fornecido no cadastro.',
    });
  }
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
           (SELECT COUNT(*) FROM prescriptions WHERE patient_id = ? AND tenant_id = ?) AS c
  `).get(req.params.id, req.tenantId, req.params.id, req.tenantId) as any).c;
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
    SELECT COUNT(*) AS c FROM prescriptions WHERE patient_id = ? AND tenant_id = ?
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
  const p = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId);
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  const encounters = db.prepare(`SELECT * FROM encounters WHERE patient_id = ? AND tenant_id = ? ORDER BY started_at DESC`).all(req.params.id, req.tenantId);
  const prescriptions = db.prepare(`SELECT * FROM prescriptions WHERE patient_id = ? AND tenant_id = ? ORDER BY created_at DESC`).all(req.params.id, req.tenantId);
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
  });
});

export default router;
