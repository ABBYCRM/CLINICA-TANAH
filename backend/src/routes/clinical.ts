import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit';

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
router.get('/encounters', (req: Request, res: Response) => {
  const patientId = req.query.patient_id as string | undefined;
  let sql = `SELECT e.*, p.full_name AS patient_name, u.full_name AS practitioner_name FROM encounters e
             JOIN patients p ON p.id = e.patient_id
             JOIN users u ON u.id = e.practitioner_id`;
  const args: any[] = [];
  if (patientId) { sql += ` WHERE e.patient_id = ?`; args.push(patientId); }
  sql += ` ORDER BY e.started_at DESC LIMIT 200`;
  res.json({ encounters: db.prepare(sql).all(...args) });
});

router.post('/encounters', requireRole('doctor', 'nurse'), (req: Request, res: Response) => {
  const parsed = encounterSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  const id = uuid();
  db.prepare(`
    INSERT INTO encounters (id, patient_id, practitioner_id, appointment_id, started_at, ended_at,
                            subjective, objective, assessment, plan, icd10_codes, cid10_codes, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, d.patient_id, d.practitioner_id, d.appointment_id ?? null, d.started_at, d.ended_at ?? null,
         d.subjective ?? null, d.objective ?? null, d.assessment ?? null, d.plan ?? null,
         JSON.stringify(d.icd10_codes), JSON.stringify(d.cid10_codes), d.notes ?? null);
  logAudit({
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_encounter_phi', resourceType: 'encounter', resourceId: id,
    legalBasis: 'health_protection_art7_VIII',
  });
  res.status(201).json({ id });
});

router.get('/encounters/:id', (req: Request, res: Response) => {
  const e = db.prepare(`SELECT * FROM encounters WHERE id = ?`).get(req.params.id) as any;
  if (!e) { res.status(404).json({ error: 'not_found' }); return; }
  logAudit({
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'view_encounter_phi', resourceType: 'encounter', resourceId: e.id,
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({ encounter: e });
});

// PRESCRIPTIONS
router.get('/prescriptions', (req: Request, res: Response) => {
  const patientId = req.query.patient_id as string | undefined;
  let sql = `SELECT pr.*, p.full_name AS patient_name, u.full_name AS practitioner_name
             FROM prescriptions pr
             JOIN patients p ON p.id = pr.patient_id
             JOIN users u ON u.id = pr.practitioner_id`;
  const args: any[] = [];
  if (patientId) { sql += ` WHERE pr.patient_id = ?`; args.push(patientId); }
  sql += ` ORDER BY pr.created_at DESC LIMIT 200`;
  res.json({ prescriptions: db.prepare(sql).all(...args) });
});

router.post('/prescriptions', requireRole('doctor'), (req: Request, res: Response) => {
  const parsed = prescriptionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  db.prepare(`
    INSERT INTO prescriptions (id, encounter_id, patient_id, practitioner_id, items, sent_via_whatsapp)
    VALUES (?,?,?,?,?,?)
  `).run(id, d.encounter_id, d.patient_id, d.practitioner_id, JSON.stringify(d.items), d.send_via_whatsapp ? 1 : 0);
  logAudit({
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_prescription', resourceType: 'prescription', resourceId: id,
    legalBasis: 'health_protection_art7_VIII',
  });
  res.status(201).json({ id, sent_via_whatsapp: d.send_via_whatsapp });
});

export default router;
