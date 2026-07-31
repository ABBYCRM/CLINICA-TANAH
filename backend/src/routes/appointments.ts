import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { getDaySlots, getAvailableSlots, getPractitionerLoads } from '../services/availability';

const router = Router();
router.use(authenticate);

const apptSchema = z.object({
  patient_id: z.string().min(1),
  practitioner_id: z.string().min(1),
  scheduled_at: z.string().min(1),
  duration_minutes: z.number().int().min(5).max(480).default(30),
  type: z.enum(['consultation','return','exam','procedure','teleconsultation']),
  status: z.enum(['scheduled','confirmed','arrived','in_progress','completed','cancelled','no_show']).default('scheduled'),
  notes: z.string().optional().nullable(),
  source: z.enum(['whatsapp_bot','reception','phone','website']).default('reception'),
});

router.get('/', (req: Request, res: Response) => {
  const from = (req.query.from as string) || new Date(Date.now() - 7*24*3600*1000).toISOString().slice(0, 10);
  const to = (req.query.to as string) || new Date(Date.now() + 14*24*3600*1000).toISOString().slice(0, 10);
  const practitionerId = req.query.practitioner_id as string | undefined;
  const status = req.query.status as string | undefined;
  let sql = `
    SELECT a.*, p.full_name AS patient_name, p.phone AS patient_phone,
           u.full_name AS practitioner_name
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN users u ON u.id = a.practitioner_id
    WHERE date(a.scheduled_at) BETWEEN ? AND ? AND a.tenant_id = ?
  `;
  const args: any[] = [from, to, req.tenantId];
  if (practitionerId) { sql += ` AND a.practitioner_id = ?`; args.push(practitionerId); }
  if (status) { sql += ` AND a.status = ?`; args.push(status); }
  sql += ` ORDER BY a.scheduled_at ASC`;
  const rows = db.prepare(sql).all(...args);
  res.json({ appointments: rows });
});

// Availability for the scheduler UI and any API consumer.
// Every slot comes flagged available/taken, plus the day's load per doctor
// (same service the WhatsApp bot books from — no double-booking possible).
router.get('/availability', (req: Request, res: Response) => {
  const practitionerId = req.query.practitioner_id as string;
  const date = req.query.date as string; // YYYY-MM-DD
  if (!practitionerId || !date) {
    res.status(400).json({ error: 'practitioner_id and date required' });
    return;
  }
  res.json({
    date,
    practitioner_id: practitionerId,
    available_slots: getAvailableSlots(practitionerId, date, req.tenantId!),
    slots: getDaySlots(practitionerId, date, req.tenantId!),
    practitioner_loads: getPractitionerLoads(date, req.tenantId!),
  });
});

function slotTaken(practitionerId: string, scheduledAt: string, tenantId: string, excludeId?: string): boolean {
  const row = db.prepare(`
    SELECT id FROM appointments
    WHERE practitioner_id = ? AND scheduled_at = ? AND tenant_id = ?
      AND status NOT IN ('cancelled','no_show') ${excludeId ? 'AND id != ?' : ''}
  `).get(...([practitionerId, scheduledAt, tenantId, ...(excludeId ? [excludeId] : [])] as any[]));
  return !!row;
}

router.post('/', requireRole('admin', 'receptionist', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const parsed = apptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  if (slotTaken(d.practitioner_id, d.scheduled_at, req.tenantId!)) {
    res.status(409).json({ error: 'slot_taken', message: 'This practitioner already has an appointment at that time.' });
    return;
  }
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO appointments (id, tenant_id, patient_id, practitioner_id, scheduled_at, duration_minutes, type, status, notes, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.tenantId, d.patient_id, d.practitioner_id, d.scheduled_at, d.duration_minutes, d.type, d.status, d.notes ?? null, d.source, now, now);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_appointment', resourceType: 'appointment', resourceId: id,
    afterValue: d, legalBasis: 'contract_art7_V',
  });
  res.status(201).json({ id });
});

router.put('/:id', requireRole('admin', 'receptionist', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const before = db.prepare(`SELECT * FROM appointments WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!before) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = apptSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  const newPractitioner = d.practitioner_id ?? before.practitioner_id;
  const newSlot = d.scheduled_at ?? before.scheduled_at;
  if (slotTaken(newPractitioner, newSlot, req.tenantId!, req.params.id)) {
    res.status(409).json({ error: 'slot_taken', message: 'This practitioner already has an appointment at that time.' });
    return;
  }
  const allowed = ['patient_id','practitioner_id','scheduled_at','duration_minutes','type','status','notes','source','reminder_24h_sent_at','reminder_2h_sent_at'];
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of allowed) if ((d as any)[k] !== undefined) { sets.push(`${k} = ?`); args.push((d as any)[k]); }
  if (!sets.length) { res.json({ ok: true, noop: true }); return; }
  sets.push(`updated_at = ?`); args.push(new Date().toISOString()); args.push(req.params.id);
  db.prepare(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...args, req.tenantId);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'update_appointment', resourceType: 'appointment', resourceId: req.params.id,
    beforeValue: { status: before.status }, afterValue: d,
    legalBasis: 'contract_art7_V',
  });
  res.json({ ok: true });
});

router.delete('/:id', requireRole('admin', 'receptionist'), (req: Request, res: Response) => {
  const appt = db.prepare(`SELECT id FROM appointments WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!appt) { res.status(404).json({ error: 'not_found' }); return; }
  db.prepare(`UPDATE encounters SET appointment_id = NULL WHERE appointment_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM appointments WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'delete_appointment', resourceType: 'appointment', resourceId: req.params.id,
    legalBasis: 'contract_art7_V',
  });
  res.json({ ok: true });
});

export default router;
