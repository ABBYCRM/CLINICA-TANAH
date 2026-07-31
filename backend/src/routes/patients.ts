import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit, recordConsent, hasActiveConsent } from '../services/audit';
import {
  canViewClinical,
  CONSENT_PURPOSES,
  getConsentLedger,
  LIFECYCLE_STAGES,
  setPatientConsent,
  type ConsentPurpose,
} from '../services/patientJourney';

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
    const digits = `%${q.replace(/\D/g, '') || q}%`;
    where.push(`(
      p.full_name LIKE ? OR p.social_name LIKE ? OR p.cpf LIKE ? OR p.phone LIKE ? OR p.email LIKE ?
      OR REPLACE(REPLACE(REPLACE(COALESCE(p.cpf,''), '.', ''), '-', ''), ' ', '') LIKE ?
    )`);
    args.push(like, like, like, like, like, digits);
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

  res.json({ patients: rows, total, limit, offset, insurers, view_counts: viewCounts });
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

/** HubSpot-style patient workspace: header props + timeline + associations + consents. */
router.get('/:id/record', (req: Request, res: Response) => {
  const p = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  const parseArr = (v: any): string[] => { try { return v ? JSON.parse(v) : []; } catch { return []; } };
  const clinicalOk = canViewClinical(req.user?.role);

  const appointments = db.prepare(`
    SELECT a.id, a.scheduled_at, a.type, a.status, a.notes, a.duration_minutes, a.source,
           u.full_name AS practitioner_name, u.id AS practitioner_id
    FROM appointments a JOIN users u ON u.id = a.practitioner_id
    WHERE a.patient_id = ? AND a.tenant_id = ?
    ORDER BY a.scheduled_at DESC LIMIT 50
  `).all(req.params.id, req.tenantId) as any[];

  const encounters = db.prepare(`
    SELECT e.id, e.started_at, e.ended_at, e.subjective, e.objective, e.assessment, e.plan,
           e.icd10_codes, u.full_name AS practitioner_name
    FROM encounters e JOIN users u ON u.id = e.practitioner_id
    WHERE e.patient_id = ? AND e.tenant_id = ?
    ORDER BY e.started_at DESC LIMIT 50
  `).all(req.params.id, req.tenantId) as any[];

  const prescriptions = db.prepare(`
    SELECT pr.id, pr.created_at, pr.items, pr.sent_via_whatsapp, u.full_name AS practitioner_name
    FROM prescriptions pr
    LEFT JOIN users u ON u.id = pr.practitioner_id
    WHERE pr.patient_id = ? AND pr.tenant_id = ?
    ORDER BY pr.created_at DESC LIMIT 30
  `).all(req.params.id, req.tenantId) as any[];

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
      title: 'prescription',
      subtitle: pr.practitioner_name,
      meta: { id: pr.id, sent_via_whatsapp: pr.sent_via_whatsapp },
    });
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
    },
    owner_name: assignedProfessional?.full_name || null,
    upcoming_appointments: upcoming.slice(0, 8),
    timeline: deduped.slice(0, 100),
    consent_ledger: consentLedger,
    surveys,
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
    },
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
