import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit';
import {
  revealEncounterRow,
  revealPrescriptionItems,
  seal,
  sealEncounterRow,
  sealPrescriptionItems,
} from '../services/phiCrypto';

const router = Router();
router.use(authenticate);

const encounterSchema = z.object({
  patient_id: z.string().min(1),
  practitioner_id: z.string().min(1),
  appointment_id: z.string().optional().nullable(),
  started_at: z.string().min(1),
  ended_at: z.string().optional().nullable(),
  subjective: z.string().optional().nullable(),
  objective: z.string().optional().nullable(),
  assessment: z.string().optional().nullable(),
  plan: z.string().optional().nullable(),
  icd10_codes: z.array(z.string()).optional().default([]),
  cid10_codes: z.array(z.string()).optional().default([]),
  notes: z.string().optional().nullable(),
});

const prescriptionSchema = z.object({
  encounter_id: z.string().min(1),
  patient_id: z.string().min(1),
  practitioner_id: z.string().min(1),
  items: z.array(z.object({
    medication: z.string(),
    dosage: z.string(),
    frequency: z.string(),
    duration: z.string(),
    instructions: z.string().optional().nullable(),
  })).min(1),
  send_via_whatsapp: z.boolean().optional().default(false),
});

// ENCOUNTERS
router.get('/encounters', requireRole('admin', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const patientId = req.query.patient_id as string | undefined;
  let sql = `SELECT e.*, p.full_name AS patient_name, u.full_name AS practitioner_name FROM encounters e
             JOIN patients p ON p.id = e.patient_id
             JOIN users u ON u.id = e.practitioner_id
             WHERE e.tenant_id = ?`;
  const args: any[] = [req.tenantId];
  if (patientId) { sql += ` AND e.patient_id = ?`; args.push(patientId); }
  sql += ` ORDER BY e.started_at DESC LIMIT 200`;
  const rows = (db.prepare(sql).all(...args) as any[]).map((e) => revealEncounterRow(e)!);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'list_encounters_phi', resourceType: 'encounter',
    afterValue: { count: rows.length, patient_id: patientId || null },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({ encounters: rows });
});

router.post('/encounters', requireRole('doctor', 'nurse'), (req: Request, res: Response) => {
  const parsed = encounterSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  const id = uuid();
  const sealed = sealEncounterRow({
    subjective: d.subjective ?? null,
    objective: d.objective ?? null,
    assessment: d.assessment ?? null,
    plan: d.plan ?? null,
    notes: d.notes ?? null,
  });
  db.prepare(`
    INSERT INTO encounters (id, tenant_id, patient_id, practitioner_id, appointment_id, started_at, ended_at,
                            subjective, objective, assessment, plan, icd10_codes, cid10_codes, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, req.tenantId, d.patient_id, d.practitioner_id, d.appointment_id ?? null, d.started_at, d.ended_at ?? null,
         sealed.subjective ?? null, sealed.objective ?? null, sealed.assessment ?? null, sealed.plan ?? null,
         JSON.stringify(d.icd10_codes), JSON.stringify(d.cid10_codes), sealed.notes ?? null);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_encounter_phi', resourceType: 'encounter', resourceId: id,
    legalBasis: 'health_protection_art7_VIII',
  });
  res.status(201).json({ id });
});

router.get('/encounters/:id', requireRole('admin', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const raw = db.prepare(`SELECT * FROM encounters WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!raw) { res.status(404).json({ error: 'not_found' }); return; }
  const e = revealEncounterRow(raw)!;
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'view_encounter_phi', resourceType: 'encounter', resourceId: e.id,
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({ encounter: e });
});

// Amend an encounter (SOAP corrections are legitimate; every change is audited)
router.put('/encounters/:id', requireRole('doctor', 'nurse'), (req: Request, res: Response) => {
  const before = db.prepare(`SELECT * FROM encounters WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!before) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = encounterSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  const allowed = ['appointment_id','started_at','ended_at','subjective','objective','assessment','plan','icd10_codes','cid10_codes','notes'];
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of allowed) {
    if ((d as any)[k] !== undefined) {
      sets.push(`${k} = ?`);
      let v = (d as any)[k];
      if (['icd10_codes','cid10_codes'].includes(k) && Array.isArray(v)) v = JSON.stringify(v);
      if (['subjective','objective','assessment','plan','notes'].includes(k) && v != null && v !== '') {
        v = seal(String(v));
      }
      args.push(v);
    }
  }
  if (sets.length === 0) { res.json({ ok: true, noop: true }); return; }
  args.push(req.params.id);
  db.prepare(`UPDATE encounters SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...args, req.tenantId);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'update_encounter_phi', resourceType: 'encounter', resourceId: req.params.id,
    beforeValue: { assessment: before.assessment }, afterValue: { assessment: d.assessment ?? before.assessment },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({ ok: true });
});

// Soft-block hard delete — CFM 1.821/2007 20-year medical record retention
router.delete('/encounters/:id', requireRole('admin'), (req: Request, res: Response) => {
  const e = db.prepare(`SELECT id FROM encounters WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!e) { res.status(404).json({ error: 'not_found' }); return; }
  res.status(409).json({
    error: 'clinical_retention',
    message: 'Prontuário eletrônico não pode ser apagado (retenção CFM 20 anos). Use solicitação LGPD / anonimização.',
  });
});

// PRESCRIPTIONS
router.get('/prescriptions', requireRole('admin', 'doctor', 'nurse', 'pharmacist'), (req: Request, res: Response) => {
  const patientId = req.query.patient_id as string | undefined;
  let sql = `SELECT pr.*, p.full_name AS patient_name, u.full_name AS practitioner_name
             FROM prescriptions pr
             JOIN patients p ON p.id = pr.patient_id
             JOIN users u ON u.id = pr.practitioner_id
             WHERE pr.tenant_id = ?`;
  const args: any[] = [req.tenantId];
  if (patientId) { sql += ` AND pr.patient_id = ?`; args.push(patientId); }
  sql += ` ORDER BY pr.created_at DESC LIMIT 200`;
  const rows = (db.prepare(sql).all(...args) as any[]).map((pr) => ({
    ...pr,
    items: revealPrescriptionItems(pr.items),
  }));
  res.json({ prescriptions: rows });
});

router.post('/prescriptions', requireRole('doctor'), (req: Request, res: Response) => {
  const parsed = prescriptionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  db.prepare(`
    INSERT INTO prescriptions (id, tenant_id, encounter_id, patient_id, practitioner_id, items, sent_via_whatsapp)
    VALUES (?,?,?,?,?,?,?)
  `).run(id, req.tenantId, d.encounter_id, d.patient_id, d.practitioner_id, sealPrescriptionItems(d.items), d.send_via_whatsapp ? 1 : 0);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_prescription', resourceType: 'prescription', resourceId: id,
    legalBasis: 'health_protection_art7_VIII',
  });
  res.status(201).json({ id, sent_via_whatsapp: d.send_via_whatsapp });
});

// Update prescription items (e.g. dosage correction) — doctor only
router.put('/prescriptions/:id', requireRole('doctor'), (req: Request, res: Response) => {
  const before = db.prepare(`SELECT * FROM prescriptions WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!before) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = prescriptionSchema.pick({ items: true }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  db.prepare(`UPDATE prescriptions SET items = ? WHERE id = ? AND tenant_id = ?`)
    .run(sealPrescriptionItems(parsed.data.items), req.params.id, req.tenantId);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'update_prescription', resourceType: 'prescription', resourceId: req.params.id,
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({ ok: true });
});

// Cancel prescription — retain record (CFM); mark items as voided ciphertext
router.delete('/prescriptions/:id', requireRole('doctor', 'admin'), (req: Request, res: Response) => {
  const p = db.prepare(`SELECT id FROM prescriptions WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  res.status(409).json({
    error: 'clinical_retention',
    message: 'Prescrições fazem parte do prontuário (retenção CFM). Não é permitido apagar.',
  });
});

export default router;
