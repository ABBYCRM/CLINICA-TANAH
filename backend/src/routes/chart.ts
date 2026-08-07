/**
 * Full electronic prontuário — CFM Res. 1.638/2002 chart sections.
 * Soft-cancel / retention wherever clinical content is written.
 * Professional stamp (name + CRM/UF + timestamp) on every signed entry.
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { stampFromUser, formatStampLabel } from '../services/clinicalStamp';
import { revealPrescriptionItems, revealEncounterRow } from '../services/phiCrypto';
import { uploadsRoot } from '../services/nvidiaOcr';
import { mimeFromName, upsertPatientDocumentPointer } from '../services/patientDocumentsVault';

const router = Router();
router.use(authenticate);

const CLINICAL = ['admin', 'doctor', 'nurse'] as const;
const DOCTORISH = ['admin', 'doctor'] as const;

function assertPatient(tenantId: string, patientId: string) {
  return db.prepare(`SELECT id, full_name FROM patients WHERE id = ? AND tenant_id = ?`)
    .get(patientId, tenantId) as { id: string; full_name: string } | undefined;
}

function stampCols(s: ReturnType<typeof stampFromUser>) {
  return [s.signer_name, s.signer_council, s.signer_council_state, s.signed_at] as const;
}

function withStampLabel<T extends Record<string, any>>(row: T) {
  return { ...row, stamp_label: formatStampLabel(row) };
}

function audit(req: Request, action: string, resourceType: string, resourceId?: string, extra?: Record<string, unknown>) {
  logAudit({
    tenantId: req.tenantId!,
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action,
    resourceType,
    resourceId,
    afterValue: extra,
    legalBasis: 'health_protection_art7_VIII',
  });
}

// ─── Chart summary (allergy banner, problems, latest vitals, anamnese, counts) ───
router.get('/:patientId', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  const p = assertPatient(req.tenantId!, patientId);
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }

  const allergies = db.prepare(`
    SELECT * FROM clinical_allergies
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY CASE severity
      WHEN 'life_threatening' THEN 0 WHEN 'severe' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
      substance COLLATE NOCASE
  `).all(req.tenantId, patientId) as any[];

  const problems = db.prepare(`
    SELECT * FROM clinical_problems
    WHERE tenant_id = ? AND patient_id = ? AND status IN ('active','resolved')
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 40
  `).all(req.tenantId, patientId) as any[];

  const latestVitals = db.prepare(`
    SELECT * FROM clinical_vitals
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY recorded_at DESC LIMIT 1
  `).get(req.tenantId, patientId) as any;

  const latestAnamnesis = db.prepare(`
    SELECT * FROM clinical_anamnesis
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY recorded_at DESC LIMIT 1
  `).get(req.tenantId, patientId) as any;

  const recentEvolutions = (db.prepare(`
    SELECT * FROM clinical_evolutions
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY recorded_at DESC LIMIT 5
  `).all(req.tenantId, patientId) as any[]).map(withStampLabel);

  const openExams = db.prepare(`
    SELECT * FROM clinical_exam_orders
    WHERE tenant_id = ? AND patient_id = ? AND status IN ('ordered','collected')
    ORDER BY ordered_at DESC LIMIT 20
  `).all(req.tenantId, patientId) as any[];

  const activeRx = (db.prepare(`
    SELECT id, created_at, items, signer_name, signer_council, signer_council_state, signed_at, status
    FROM prescriptions
    WHERE tenant_id = ? AND patient_id = ? AND COALESCE(status,'active') = 'active'
    ORDER BY created_at DESC LIMIT 10
  `).all(req.tenantId, patientId) as any[]).map((pr) => ({
    ...pr,
    items: revealPrescriptionItems(pr.items),
    stamp_label: formatStampLabel(pr),
  }));

  const counts = {
    evolutions: (db.prepare(`SELECT COUNT(*) AS c FROM clinical_evolutions WHERE tenant_id=? AND patient_id=? AND status='active'`).get(req.tenantId, patientId) as any).c,
    vitals: (db.prepare(`SELECT COUNT(*) AS c FROM clinical_vitals WHERE tenant_id=? AND patient_id=? AND status='active'`).get(req.tenantId, patientId) as any).c,
    exam_orders: (db.prepare(`SELECT COUNT(*) AS c FROM clinical_exam_orders WHERE tenant_id=? AND patient_id=? AND status!='cancelled'`).get(req.tenantId, patientId) as any).c,
    exam_results: (db.prepare(`SELECT COUNT(*) AS c FROM clinical_exam_results WHERE tenant_id=? AND patient_id=? AND status='active'`).get(req.tenantId, patientId) as any).c,
    procedures: (db.prepare(`SELECT COUNT(*) AS c FROM clinical_procedures WHERE tenant_id=? AND patient_id=? AND status='active'`).get(req.tenantId, patientId) as any).c,
    problems_active: problems.filter((x) => x.status === 'active').length,
    allergies_active: allergies.length,
    attachments: (db.prepare(`SELECT COUNT(*) AS c FROM clinical_attachments WHERE tenant_id=? AND patient_id=? AND status='active'`).get(req.tenantId, patientId) as any).c,
    encounters: (db.prepare(`SELECT COUNT(*) AS c FROM encounters WHERE tenant_id=? AND patient_id=? AND COALESCE(status,'active')='active'`).get(req.tenantId, patientId) as any).c,
    prescriptions_active: activeRx.length,
  };

  const patientAllergiesLegacy = (() => {
    const raw = db.prepare(`SELECT allergies FROM patients WHERE id=? AND tenant_id=?`).get(patientId, req.tenantId) as any;
    try {
      const a = raw?.allergies;
      if (Array.isArray(a)) return a;
      return a ? JSON.parse(a) : [];
    } catch { return []; }
  })();

  audit(req, 'view_chart_summary', 'patient_chart', patientId, { counts });

  res.json({
    patient_id: patientId,
    patient_name: p.full_name,
    allergies: allergies.map(withStampLabel),
    allergies_legacy: patientAllergiesLegacy,
    allergy_alert: allergies.some((a) => ['severe', 'life_threatening'].includes(a.severity))
      || (allergies.length + patientAllergiesLegacy.length) > 0,
    problems,
    latest_vitals: latestVitals ? withStampLabel(latestVitals) : null,
    latest_anamnesis: latestAnamnesis ? withStampLabel(latestAnamnesis) : null,
    recent_evolutions: recentEvolutions,
    open_exam_orders: openExams.map(withStampLabel),
    active_prescriptions: activeRx,
    counts,
    compliance: {
      cfm_1638: true,
      stamp_required: true,
      retention_years: 20,
      digital_signature: 'identification_stamp', // name+CRM+UF — not ICP-Brasil NGS2
    },
  });
});

// ─── Evolutions (evoluções diárias) ───
const evolutionSchema = z.object({
  content: z.string().min(1).max(20000),
  note_type: z.enum(['evolution', 'nursing', 'multiprofessional', 'emergency']).optional().default('evolution'),
  encounter_id: z.string().optional().nullable(),
  recorded_at: z.string().optional().nullable(),
});

router.get('/:patientId/evolutions', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const status = String(req.query.status || 'active');
  let sql = `SELECT e.*, u.full_name AS author_name FROM clinical_evolutions e
             LEFT JOIN users u ON u.id = e.author_id
             WHERE e.tenant_id = ? AND e.patient_id = ?`;
  const args: any[] = [req.tenantId, patientId];
  if (status === 'active' || status === 'cancelled') {
    sql += ` AND e.status = ?`;
    args.push(status);
  }
  sql += ` ORDER BY e.recorded_at DESC LIMIT 200`;
  const rows = (db.prepare(sql).all(...args) as any[]).map(withStampLabel);
  res.json({ evolutions: rows });
});

router.post('/:patientId/evolutions', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = evolutionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  const s = stampFromUser(req.user!.id, d.recorded_at || undefined);
  const recordedAt = d.recorded_at || s.signed_at;
  db.prepare(`
    INSERT INTO clinical_evolutions (
      id, tenant_id, patient_id, author_id, encounter_id, recorded_at, note_type, content, status,
      signer_name, signer_council, signer_council_state, signed_at
    ) VALUES (?,?,?,?,?,?,?,?,'active',?,?,?,?)
  `).run(id, req.tenantId, patientId, req.user!.id, d.encounter_id ?? null, recordedAt, d.note_type, d.content, ...stampCols(s));
  audit(req, 'create_evolution', 'clinical_evolution', id);
  res.status(201).json({ id, status: 'active', stamp_label: formatStampLabel(s) });
});

router.post('/:patientId/evolutions/:id/cancel', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const row = db.prepare(`SELECT * FROM clinical_evolutions WHERE id=? AND tenant_id=? AND patient_id=?`)
    .get(req.params.id, req.tenantId, req.params.patientId) as any;
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }
  if (row.status === 'cancelled') { res.json({ ok: true, status: 'cancelled', already: true }); return; }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE clinical_evolutions SET status='cancelled', cancelled_at=?, cancelled_by=?, cancel_reason=?
    WHERE id=? AND tenant_id=?
  `).run(now, req.user!.id, reason, req.params.id, req.tenantId);
  audit(req, 'cancel_evolution', 'clinical_evolution', req.params.id, { reason });
  res.json({ ok: true, status: 'cancelled', clinical_retention: true });
});

router.post('/:patientId/evolutions/:id/restore', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const row = db.prepare(`SELECT * FROM clinical_evolutions WHERE id=? AND tenant_id=? AND patient_id=?`)
    .get(req.params.id, req.tenantId, req.params.patientId) as any;
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }
  db.prepare(`
    UPDATE clinical_evolutions SET status='active', cancelled_at=NULL, cancelled_by=NULL, cancel_reason=NULL
    WHERE id=? AND tenant_id=?
  `).run(req.params.id, req.tenantId);
  audit(req, 'restore_evolution', 'clinical_evolution', req.params.id);
  res.json({ ok: true, status: 'active' });
});

// ─── Vitals ───
const vitalsSchema = z.object({
  recorded_at: z.string().optional().nullable(),
  encounter_id: z.string().optional().nullable(),
  systolic_mmhg: z.number().optional().nullable(),
  diastolic_mmhg: z.number().optional().nullable(),
  heart_rate_bpm: z.number().optional().nullable(),
  respiratory_rate: z.number().optional().nullable(),
  temperature_c: z.number().optional().nullable(),
  spo2_pct: z.number().optional().nullable(),
  pain_score: z.number().int().min(0).max(10).optional().nullable(),
  weight_kg: z.number().optional().nullable(),
  height_cm: z.number().optional().nullable(),
  glucose_mg_dl: z.number().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

router.get('/:patientId/vitals', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const rows = (db.prepare(`
    SELECT v.*, u.full_name AS author_name FROM clinical_vitals v
    LEFT JOIN users u ON u.id = v.author_id
    WHERE v.tenant_id = ? AND v.patient_id = ? AND v.status = 'active'
    ORDER BY v.recorded_at DESC LIMIT 100
  `).all(req.tenantId, patientId) as any[]).map(withStampLabel);
  res.json({ vitals: rows });
});

router.post('/:patientId/vitals', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = vitalsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const hasAny = [
    d.systolic_mmhg, d.diastolic_mmhg, d.heart_rate_bpm, d.respiratory_rate,
    d.temperature_c, d.spo2_pct, d.pain_score, d.weight_kg, d.height_cm, d.glucose_mg_dl,
  ].some((v) => v != null);
  if (!hasAny) { res.status(400).json({ error: 'validation', message: 'Informe ao menos um sinal vital.' }); return; }
  const id = uuid();
  const s = stampFromUser(req.user!.id, d.recorded_at || undefined);
  const recordedAt = d.recorded_at || s.signed_at;
  db.prepare(`
    INSERT INTO clinical_vitals (
      id, tenant_id, patient_id, author_id, encounter_id, recorded_at,
      systolic_mmhg, diastolic_mmhg, heart_rate_bpm, respiratory_rate, temperature_c,
      spo2_pct, pain_score, weight_kg, height_cm, glucose_mg_dl, notes, status,
      signer_name, signer_council, signer_council_state, signed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?)
  `).run(
    id, req.tenantId, patientId, req.user!.id, d.encounter_id ?? null, recordedAt,
    d.systolic_mmhg ?? null, d.diastolic_mmhg ?? null, d.heart_rate_bpm ?? null,
    d.respiratory_rate ?? null, d.temperature_c ?? null, d.spo2_pct ?? null,
    d.pain_score ?? null, d.weight_kg ?? null, d.height_cm ?? null, d.glucose_mg_dl ?? null,
    d.notes ?? null, ...stampCols(s),
  );
  audit(req, 'create_vitals', 'clinical_vitals', id);
  res.status(201).json({ id, stamp_label: formatStampLabel(s) });
});

// ─── Exam orders ───
const examOrderSchema = z.object({
  exam_name: z.string().min(1).max(300),
  exam_code: z.string().max(80).optional().nullable(),
  clinical_indication: z.string().max(4000).optional().nullable(),
  priority: z.enum(['routine', 'urgent', 'emergency']).optional().default('routine'),
  notes: z.string().max(2000).optional().nullable(),
  encounter_id: z.string().optional().nullable(),
  ordered_at: z.string().optional().nullable(),
});

router.get('/:patientId/exam-orders', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const status = String(req.query.status || 'open');
  let sql = `SELECT o.*, u.full_name AS ordered_by_name FROM clinical_exam_orders o
             LEFT JOIN users u ON u.id = o.ordered_by
             WHERE o.tenant_id = ? AND o.patient_id = ?`;
  const args: any[] = [req.tenantId, patientId];
  if (status === 'open') {
    sql += ` AND o.status IN ('ordered','collected')`;
  } else if (status === 'all') {
    /* no filter */
  } else {
    sql += ` AND o.status = ?`;
    args.push(status);
  }
  sql += ` ORDER BY o.ordered_at DESC LIMIT 200`;
  res.json({ orders: (db.prepare(sql).all(...args) as any[]).map(withStampLabel) });
});

router.post('/:patientId/exam-orders', requireRole(...DOCTORISH), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = examOrderSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  const s = stampFromUser(req.user!.id, d.ordered_at || undefined);
  const orderedAt = d.ordered_at || s.signed_at;
  db.prepare(`
    INSERT INTO clinical_exam_orders (
      id, tenant_id, patient_id, ordered_by, encounter_id, ordered_at,
      exam_name, exam_code, clinical_indication, priority, status, notes,
      signer_name, signer_council, signer_council_state, signed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,'ordered',?,?,?,?,?)
  `).run(
    id, req.tenantId, patientId, req.user!.id, d.encounter_id ?? null, orderedAt,
    d.exam_name, d.exam_code ?? null, d.clinical_indication ?? null, d.priority, d.notes ?? null,
    ...stampCols(s),
  );
  audit(req, 'create_exam_order', 'clinical_exam_order', id);
  res.status(201).json({ id, status: 'ordered', stamp_label: formatStampLabel(s) });
});

router.patch('/:patientId/exam-orders/:id', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const row = db.prepare(`SELECT * FROM clinical_exam_orders WHERE id=? AND tenant_id=? AND patient_id=?`)
    .get(req.params.id, req.tenantId, req.params.patientId) as any;
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }
  const next = z.object({
    status: z.enum(['ordered', 'collected', 'resulted', 'cancelled']).optional(),
    notes: z.string().max(2000).optional().nullable(),
  }).safeParse(req.body);
  if (!next.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = next.data;
  if (d.status === 'cancelled') {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE clinical_exam_orders SET status='cancelled', cancelled_at=?, cancelled_by=?, cancel_reason=?, notes=COALESCE(?, notes)
      WHERE id=? AND tenant_id=?
    `).run(now, req.user!.id, reason, d.notes ?? null, req.params.id, req.tenantId);
  } else {
    const sets: string[] = [];
    const args: any[] = [];
    if (d.status) { sets.push('status = ?'); args.push(d.status); }
    if (d.notes !== undefined) { sets.push('notes = ?'); args.push(d.notes); }
    if (!sets.length) { res.json({ ok: true, noop: true }); return; }
    args.push(req.params.id, req.tenantId);
    db.prepare(`UPDATE clinical_exam_orders SET ${sets.join(', ')} WHERE id=? AND tenant_id=?`).run(...args);
  }
  audit(req, 'update_exam_order', 'clinical_exam_order', req.params.id, d);
  res.json({ ok: true });
});

// ─── Exam results ───
const examResultSchema = z.object({
  exam_name: z.string().min(1).max(300),
  order_id: z.string().optional().nullable(),
  result_summary: z.string().max(8000).optional().nullable(),
  result_values: z.any().optional().nullable(),
  abnormal: z.boolean().optional().default(false),
  resulted_at: z.string().optional().nullable(),
  attachment_id: z.string().optional().nullable(),
});

router.get('/:patientId/exam-results', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const rows = (db.prepare(`
    SELECT r.*, u.full_name AS recorded_by_name FROM clinical_exam_results r
    LEFT JOIN users u ON u.id = r.recorded_by
    WHERE r.tenant_id = ? AND r.patient_id = ? AND r.status = 'active'
    ORDER BY r.resulted_at DESC LIMIT 200
  `).all(req.tenantId, patientId) as any[]).map((r) => {
    let values = r.result_values;
    try { values = values ? JSON.parse(values) : null; } catch { /* keep */ }
    return withStampLabel({ ...r, result_values: values });
  });
  res.json({ results: rows });
});

router.post('/:patientId/exam-results', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = examResultSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  const s = stampFromUser(req.user!.id, d.resulted_at || undefined);
  const resultedAt = d.resulted_at || s.signed_at;
  const valuesJson = d.result_values != null ? JSON.stringify(d.result_values) : null;
  db.prepare(`
    INSERT INTO clinical_exam_results (
      id, tenant_id, patient_id, order_id, recorded_by, resulted_at,
      exam_name, result_summary, result_values, abnormal, attachment_id, status,
      signer_name, signer_council, signer_council_state, signed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?)
  `).run(
    id, req.tenantId, patientId, d.order_id ?? null, req.user!.id, resultedAt,
    d.exam_name, d.result_summary ?? null, valuesJson, d.abnormal ? 1 : 0, d.attachment_id ?? null,
    ...stampCols(s),
  );
  if (d.order_id) {
    db.prepare(`UPDATE clinical_exam_orders SET status='resulted' WHERE id=? AND tenant_id=? AND patient_id=?`)
      .run(d.order_id, req.tenantId, patientId);
  }
  audit(req, 'create_exam_result', 'clinical_exam_result', id);
  res.status(201).json({ id, stamp_label: formatStampLabel(s) });
});

// ─── Procedures ───
const procedureSchema = z.object({
  procedure_name: z.string().min(1).max(300),
  procedure_code: z.string().max(80).optional().nullable(),
  description: z.string().max(8000).optional().nullable(),
  outcome: z.string().max(4000).optional().nullable(),
  complications: z.string().max(4000).optional().nullable(),
  materials_used: z.string().max(4000).optional().nullable(),
  encounter_id: z.string().optional().nullable(),
  performed_at: z.string().optional().nullable(),
});

router.get('/:patientId/procedures', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const status = String(req.query.status || 'active');
  let sql = `SELECT p.*, u.full_name AS performed_by_name FROM clinical_procedures p
             LEFT JOIN users u ON u.id = p.performed_by
             WHERE p.tenant_id = ? AND p.patient_id = ?`;
  const args: any[] = [req.tenantId, patientId];
  if (status === 'active' || status === 'cancelled') {
    sql += ` AND p.status = ?`;
    args.push(status);
  }
  sql += ` ORDER BY p.performed_at DESC LIMIT 200`;
  res.json({ procedures: (db.prepare(sql).all(...args) as any[]).map(withStampLabel) });
});

router.post('/:patientId/procedures', requireRole(...DOCTORISH), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = procedureSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  const s = stampFromUser(req.user!.id, d.performed_at || undefined);
  const performedAt = d.performed_at || s.signed_at;
  db.prepare(`
    INSERT INTO clinical_procedures (
      id, tenant_id, patient_id, performed_by, encounter_id, performed_at,
      procedure_name, procedure_code, description, outcome, complications, materials_used, status,
      signer_name, signer_council, signer_council_state, signed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?)
  `).run(
    id, req.tenantId, patientId, req.user!.id, d.encounter_id ?? null, performedAt,
    d.procedure_name, d.procedure_code ?? null, d.description ?? null, d.outcome ?? null,
    d.complications ?? null, d.materials_used ?? null, ...stampCols(s),
  );
  audit(req, 'create_procedure', 'clinical_procedure', id);
  res.status(201).json({ id, stamp_label: formatStampLabel(s) });
});

router.post('/:patientId/procedures/:id/cancel', requireRole(...DOCTORISH), (req: Request, res: Response) => {
  const row = db.prepare(`SELECT * FROM clinical_procedures WHERE id=? AND tenant_id=? AND patient_id=?`)
    .get(req.params.id, req.tenantId, req.params.patientId) as any;
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }
  if (row.status === 'cancelled') { res.json({ ok: true, already: true }); return; }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE clinical_procedures SET status='cancelled', cancelled_at=?, cancelled_by=?, cancel_reason=?
    WHERE id=? AND tenant_id=?
  `).run(now, req.user!.id, reason, req.params.id, req.tenantId);
  audit(req, 'cancel_procedure', 'clinical_procedure', req.params.id, { reason });
  res.json({ ok: true, status: 'cancelled', clinical_retention: true });
});

// ─── Problem list ───
const problemSchema = z.object({
  title: z.string().min(1).max(300),
  cid10_code: z.string().max(20).optional().nullable(),
  status: z.enum(['active', 'resolved', 'inactive']).optional().default('active'),
  onset_date: z.string().optional().nullable(),
  resolved_date: z.string().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

router.get('/:patientId/problems', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const rows = db.prepare(`
    SELECT p.*, u.full_name AS recorded_by_name FROM clinical_problems p
    LEFT JOIN users u ON u.id = p.recorded_by
    WHERE p.tenant_id = ? AND p.patient_id = ?
    ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END, p.updated_at DESC
    LIMIT 200
  `).all(req.tenantId, patientId);
  res.json({ problems: rows });
});

router.post('/:patientId/problems', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = problemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  db.prepare(`
    INSERT INTO clinical_problems (
      id, tenant_id, patient_id, recorded_by, title, cid10_code, status, onset_date, resolved_date, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, req.tenantId, patientId, req.user!.id, d.title, d.cid10_code ?? null, d.status,
    d.onset_date ?? null, d.resolved_date ?? null, d.notes ?? null,
  );
  audit(req, 'create_problem', 'clinical_problem', id);
  res.status(201).json({ id, status: d.status });
});

router.patch('/:patientId/problems/:id', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const row = db.prepare(`SELECT * FROM clinical_problems WHERE id=? AND tenant_id=? AND patient_id=?`)
    .get(req.params.id, req.tenantId, req.params.patientId) as any;
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = problemSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  const allowed = ['title', 'cid10_code', 'status', 'onset_date', 'resolved_date', 'notes'] as const;
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const args: any[] = [];
  for (const k of allowed) {
    if ((d as any)[k] !== undefined) {
      sets.push(`${k} = ?`);
      args.push((d as any)[k]);
    }
  }
  if (d.status === 'resolved' && d.resolved_date === undefined && !row.resolved_date) {
    sets.push('resolved_date = date(\'now\')');
  }
  args.push(req.params.id, req.tenantId);
  db.prepare(`UPDATE clinical_problems SET ${sets.join(', ')} WHERE id=? AND tenant_id=?`).run(...args);
  audit(req, 'update_problem', 'clinical_problem', req.params.id, d);
  res.json({ ok: true });
});

// ─── Allergies ───
const allergySchema = z.object({
  substance: z.string().min(1).max(200),
  reaction: z.string().max(1000).optional().nullable(),
  severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']).optional().default('moderate'),
  status: z.enum(['active', 'inactive']).optional().default('active'),
  onset_date: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

router.get('/:patientId/allergies', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const rows = db.prepare(`
    SELECT a.*, u.full_name AS recorded_by_name FROM clinical_allergies a
    LEFT JOIN users u ON u.id = a.recorded_by
    WHERE a.tenant_id = ? AND a.patient_id = ?
    ORDER BY CASE a.status WHEN 'active' THEN 0 ELSE 1 END,
             CASE a.severity WHEN 'life_threatening' THEN 0 WHEN 'severe' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END
  `).all(req.tenantId, patientId);
  res.json({ allergies: rows });
});

router.post('/:patientId/allergies', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = allergySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  db.prepare(`
    INSERT INTO clinical_allergies (
      id, tenant_id, patient_id, recorded_by, substance, reaction, severity, status, onset_date, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, req.tenantId, patientId, req.user!.id, d.substance, d.reaction ?? null, d.severity,
    d.status, d.onset_date ?? null, d.notes ?? null,
  );
  audit(req, 'create_allergy', 'clinical_allergy', id);
  res.status(201).json({ id, status: d.status });
});

router.patch('/:patientId/allergies/:id', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const row = db.prepare(`SELECT * FROM clinical_allergies WHERE id=? AND tenant_id=? AND patient_id=?`)
    .get(req.params.id, req.tenantId, req.params.patientId) as any;
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = allergySchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  const allowed = ['substance', 'reaction', 'severity', 'status', 'onset_date', 'notes'] as const;
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const args: any[] = [];
  for (const k of allowed) {
    if ((d as any)[k] !== undefined) {
      sets.push(`${k} = ?`);
      args.push((d as any)[k]);
    }
  }
  args.push(req.params.id, req.tenantId);
  db.prepare(`UPDATE clinical_allergies SET ${sets.join(', ')} WHERE id=? AND tenant_id=?`).run(...args);
  audit(req, 'update_allergy', 'clinical_allergy', req.params.id, d);
  res.json({ ok: true });
});

// ─── Anamnesis ───
const anamnesisSchema = z.object({
  chief_complaint: z.string().max(4000).optional().nullable(),
  hpi: z.string().max(20000).optional().nullable(),
  past_history: z.string().max(20000).optional().nullable(),
  family_history: z.string().max(8000).optional().nullable(),
  social_history: z.string().max(8000).optional().nullable(),
  review_of_systems: z.string().max(8000).optional().nullable(),
  current_medications: z.string().max(8000).optional().nullable(),
  recorded_at: z.string().optional().nullable(),
});

router.get('/:patientId/anamnesis', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const rows = (db.prepare(`
    SELECT a.*, u.full_name AS author_name FROM clinical_anamnesis a
    LEFT JOIN users u ON u.id = a.author_id
    WHERE a.tenant_id = ? AND a.patient_id = ? AND a.status = 'active'
    ORDER BY a.recorded_at DESC LIMIT 50
  `).all(req.tenantId, patientId) as any[]).map(withStampLabel);
  res.json({ anamnesis: rows, latest: rows[0] || null });
});

router.post('/:patientId/anamnesis', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = anamnesisSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const hasContent = [
    d.chief_complaint, d.hpi, d.past_history, d.family_history,
    d.social_history, d.review_of_systems, d.current_medications,
  ].some((v) => v && String(v).trim());
  if (!hasContent) { res.status(400).json({ error: 'validation', message: 'Preencha ao menos um campo da anamnese.' }); return; }
  const id = uuid();
  const s = stampFromUser(req.user!.id, d.recorded_at || undefined);
  const recordedAt = d.recorded_at || s.signed_at;
  db.prepare(`
    INSERT INTO clinical_anamnesis (
      id, tenant_id, patient_id, author_id, recorded_at,
      chief_complaint, hpi, past_history, family_history, social_history,
      review_of_systems, current_medications, status,
      signer_name, signer_council, signer_council_state, signed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?)
  `).run(
    id, req.tenantId, patientId, req.user!.id, recordedAt,
    d.chief_complaint ?? null, d.hpi ?? null, d.past_history ?? null, d.family_history ?? null,
    d.social_history ?? null, d.review_of_systems ?? null, d.current_medications ?? null,
    ...stampCols(s),
  );
  audit(req, 'create_anamnesis', 'clinical_anamnesis', id);
  res.status(201).json({ id, stamp_label: formatStampLabel(s) });
});

// ─── Clinical attachments (metadata / references; files via existing patient_documents when needed) ───
const attachmentSchema = z.object({
  title: z.string().min(1).max(300),
  doc_type: z.enum(['lab', 'imaging', 'consent', 'referral', 'other']).optional().default('other'),
  mime: z.string().max(120).optional().nullable(),
  file_path: z.string().max(1000).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  encounter_id: z.string().optional().nullable(),
  filename: z.string().max(300).optional().nullable(),
  data_base64: z.string().min(8).optional().nullable(),
});

router.get('/:patientId/attachments', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const rows = db.prepare(`
    SELECT a.*, u.full_name AS uploaded_by_name FROM clinical_attachments a
    LEFT JOIN users u ON u.id = a.uploaded_by
    WHERE a.tenant_id = ? AND a.patient_id = ? AND a.status = 'active'
    ORDER BY a.created_at DESC LIMIT 200
  `).all(req.tenantId, patientId);
  res.json({ attachments: rows });
});

router.post('/:patientId/attachments', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = attachmentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  let filePath = d.file_path ?? null;
  let mime = d.mime ?? null;
  if (d.data_base64) {
    let buffer: Buffer;
    try {
      const raw = String(d.data_base64).replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(raw, 'base64');
    } catch {
      res.status(400).json({ error: 'invalid_base64' }); return;
    }
    if (buffer.length > 12 * 1024 * 1024) {
      res.status(400).json({ error: 'file_too_large', message: 'Max 12MB' }); return;
    }
    const original = String(d.filename || d.title || 'anexo').replace(/[^\w.\-()\sÀ-ÿ]+/g, '_').slice(0, 180);
    const dir = path.join(uploadsRoot(), req.tenantId!, 'patients', patientId, 'attachments');
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, `${id}_${original}`);
    fs.writeFileSync(filePath, buffer);
    mime = mime || mimeFromName(original);
  }
  db.prepare(`
    INSERT INTO clinical_attachments (
      id, tenant_id, patient_id, uploaded_by, encounter_id, title, doc_type, mime, file_path, notes, status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,'active')
  `).run(
    id, req.tenantId, patientId, req.user!.id, d.encounter_id ?? null, d.title, d.doc_type,
    mime, filePath, d.notes ?? null,
  );
  try {
    upsertPatientDocumentPointer(db, {
      tenantId: req.tenantId!,
      patientId,
      title: d.title,
      docType: d.doc_type || 'other',
      status: 'active',
      source: 'clinical_attachment',
      sourceId: id,
      notes: d.notes ?? null,
      createdBy: req.user!.id,
      mimeType: mime,
      originalName: d.filename || d.title,
      storagePath: filePath && !/^https?:\/\//i.test(filePath) ? filePath : null,
      sizeBytes: filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : null,
      fileUrl: filePath && /^https?:\/\//i.test(filePath) ? filePath : null,
    });
  } catch { /* optional */ }
  audit(req, 'create_clinical_attachment', 'clinical_attachment', id);
  res.status(201).json({ id, file_path: filePath });
});

router.post('/:patientId/attachments/:id/cancel', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const row = db.prepare(`SELECT * FROM clinical_attachments WHERE id=? AND tenant_id=? AND patient_id=?`)
    .get(req.params.id, req.tenantId, req.params.patientId) as any;
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }
  db.prepare(`UPDATE clinical_attachments SET status='cancelled' WHERE id=? AND tenant_id=?`)
    .run(req.params.id, req.tenantId);
  audit(req, 'cancel_clinical_attachment', 'clinical_attachment', req.params.id);
  res.json({ ok: true, status: 'cancelled', clinical_retention: true });
});

// ─── Patient-scoped SOAP + Rx convenience (same tables, filtered) ───
router.get('/:patientId/encounters', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const status = String(req.query.status || 'active');
  let sql = `SELECT e.*, u.full_name AS practitioner_name FROM encounters e
             JOIN users u ON u.id = e.practitioner_id
             WHERE e.tenant_id = ? AND e.patient_id = ?`;
  const args: any[] = [req.tenantId, patientId];
  if (status === 'active' || status === 'cancelled') {
    sql += ` AND COALESCE(e.status,'active') = ?`;
    args.push(status);
  }
  sql += ` ORDER BY e.started_at DESC LIMIT 100`;
  const rows = (db.prepare(sql).all(...args) as any[]).map((e) => {
    const revealed = revealEncounterRow(e)!;
    return withStampLabel({ ...revealed, status: e.status || 'active', practitioner_name: e.practitioner_name });
  });
  res.json({ encounters: rows });
});

router.get('/:patientId/prescriptions', requireRole(...CLINICAL), (req: Request, res: Response) => {
  const patientId = req.params.patientId;
  if (!assertPatient(req.tenantId!, patientId)) { res.status(404).json({ error: 'not_found' }); return; }
  const status = String(req.query.status || 'active');
  let sql = `SELECT pr.*, u.full_name AS practitioner_name FROM prescriptions pr
             LEFT JOIN users u ON u.id = pr.practitioner_id
             WHERE pr.tenant_id = ? AND pr.patient_id = ?`;
  const args: any[] = [req.tenantId, patientId];
  if (status === 'active' || status === 'cancelled') {
    sql += ` AND COALESCE(pr.status,'active') = ?`;
    args.push(status);
  }
  sql += ` ORDER BY pr.created_at DESC LIMIT 100`;
  const rows = (db.prepare(sql).all(...args) as any[]).map((pr) => withStampLabel({
    ...pr,
    status: pr.status || 'active',
    items: revealPrescriptionItems(pr.items),
  }));
  res.json({ prescriptions: rows });
});

export default router;
