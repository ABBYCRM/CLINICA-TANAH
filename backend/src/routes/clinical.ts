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
import { stampFromUser, formatStampLabel } from '../services/clinicalStamp';
import {
  dispensePrescription,
  prescriptionDispenseTrail,
  reverseDispenseOnCancel,
  stockLinkedItems,
} from '../services/prescriptionDispense';

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
    inventory_item_id: z.string().optional().nullable(),
    quantity: z.number().positive().optional().nullable(),
    unit_price: z.number().min(0).optional().nullable(),
  })).min(1),
  send_via_whatsapp: z.boolean().optional().default(false),
  /** When true (default if any stock-linked line), decrement clinic inventory + bill. */
  dispense_from_stock: z.boolean().optional(),
  mark_paid: z.boolean().optional().default(false),
  payment_method: z.string().optional().nullable(),
});

// ENCOUNTERS
// status: active (vigente) | cancelled (anulado — CFM retention; never hard-deleted)
router.get('/encounters', requireRole('admin', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const patientId = req.query.patient_id as string | undefined;
  const statusFilter = String(req.query.status || 'active'); // active | cancelled | all
  let sql = `SELECT e.*, p.full_name AS patient_name, u.full_name AS practitioner_name,
                    cu.full_name AS cancelled_by_name
             FROM encounters e
             JOIN patients p ON p.id = e.patient_id
             JOIN users u ON u.id = e.practitioner_id
             LEFT JOIN users cu ON cu.id = e.cancelled_by
             WHERE e.tenant_id = ?`;
  const args: any[] = [req.tenantId];
  if (patientId) { sql += ` AND e.patient_id = ?`; args.push(patientId); }
  if (statusFilter === 'active' || statusFilter === 'cancelled') {
    sql += ` AND COALESCE(e.status, 'active') = ?`;
    args.push(statusFilter);
  }
  sql += ` ORDER BY e.started_at DESC LIMIT 200`;
  const rows = (db.prepare(sql).all(...args) as any[]).map((e) => {
    const revealed = revealEncounterRow(e)!;
    return {
      ...revealed,
      status: e.status || 'active',
      cancelled_at: e.cancelled_at || null,
      cancelled_by: e.cancelled_by || null,
      cancelled_by_name: e.cancelled_by_name || null,
      cancel_reason: e.cancel_reason || null,
      signer_name: e.signer_name || null,
      signer_council: e.signer_council || null,
      signer_council_state: e.signer_council_state || null,
      signed_at: e.signed_at || null,
      stamp_label: formatStampLabel(e),
    };
  });
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN COALESCE(status, 'active') = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM encounters WHERE tenant_id = ?
    ${patientId ? 'AND patient_id = ?' : ''}
  `).get(...(patientId ? [req.tenantId, patientId] : [req.tenantId])) as any;
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'list_encounters_phi', resourceType: 'encounter',
    afterValue: { count: rows.length, patient_id: patientId || null, status: statusFilter },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({
    encounters: rows,
    counts: {
      active: Number(counts?.active || 0),
      cancelled: Number(counts?.cancelled || 0),
    },
  });
});

router.post('/encounters', requireRole('admin', 'doctor', 'nurse'), (req: Request, res: Response) => {
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
  const stamp = stampFromUser(req.user!.id, d.started_at);
  db.prepare(`
    INSERT INTO encounters (id, tenant_id, patient_id, practitioner_id, appointment_id, started_at, ended_at,
                            subjective, objective, assessment, plan, icd10_codes, cid10_codes, notes, status,
                            signer_name, signer_council, signer_council_state, signed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active',?,?,?,?)
  `).run(id, req.tenantId, d.patient_id, d.practitioner_id, d.appointment_id ?? null, d.started_at, d.ended_at ?? null,
         sealed.subjective ?? null, sealed.objective ?? null, sealed.assessment ?? null, sealed.plan ?? null,
         JSON.stringify(d.icd10_codes), JSON.stringify(d.cid10_codes), sealed.notes ?? null,
         stamp.signer_name, stamp.signer_council, stamp.signer_council_state, stamp.signed_at);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_encounter_phi', resourceType: 'encounter', resourceId: id,
    legalBasis: 'health_protection_art7_VIII',
  });
  res.status(201).json({ id, status: 'active', stamp_label: formatStampLabel(stamp) });
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
  res.json({ encounter: { ...e, status: raw.status || 'active' } });
});

// Amend an encounter (SOAP corrections are legitimate; every change is audited)
router.put('/encounters/:id', requireRole('admin', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const before = db.prepare(`SELECT * FROM encounters WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!before) { res.status(404).json({ error: 'not_found' }); return; }
  if ((before.status || 'active') === 'cancelled') {
    res.status(409).json({
      error: 'encounter_cancelled',
      message: 'Atendimento anulado não pode ser editado. Restaure-o primeiro ou registre um novo.',
    });
    return;
  }
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

function cancelEncounter(req: Request, res: Response) {
  const e = db.prepare(`SELECT * FROM encounters WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!e) { res.status(404).json({ error: 'not_found' }); return; }
  if ((e.status || 'active') === 'cancelled') {
    res.json({ ok: true, status: 'cancelled', already: true });
    return;
  }
  const reasonRaw = req.body?.reason ?? req.query.reason;
  const reason = typeof reasonRaw === 'string' ? reasonRaw.slice(0, 500) : null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE encounters
    SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?
    WHERE id = ? AND tenant_id = ?
  `).run(now, req.user!.id, reason, req.params.id, req.tenantId);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'cancel_encounter', resourceType: 'encounter', resourceId: req.params.id,
    beforeValue: { status: e.status || 'active' },
    afterValue: { status: 'cancelled', reason },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({ ok: true, status: 'cancelled', cancelled_at: now, clinical_retention: true });
}

router.post('/encounters/:id/cancel', requireRole('admin', 'doctor', 'nurse'), cancelEncounter);
router.delete('/encounters/:id', requireRole('admin', 'doctor', 'nurse'), cancelEncounter);

router.post('/encounters/:id/restore', requireRole('admin', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const e = db.prepare(`SELECT * FROM encounters WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!e) { res.status(404).json({ error: 'not_found' }); return; }
  if ((e.status || 'active') !== 'cancelled') {
    res.json({ ok: true, status: 'active', already: true });
    return;
  }
  db.prepare(`
    UPDATE encounters
    SET status = 'active', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
    WHERE id = ? AND tenant_id = ?
  `).run(req.params.id, req.tenantId);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'restore_encounter', resourceType: 'encounter', resourceId: req.params.id,
    beforeValue: { status: 'cancelled' },
    afterValue: { status: 'active' },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({ ok: true, status: 'active' });
});

// PRESCRIPTIONS
// status: active (vigente) | cancelled (cancelada — retained under CFM; never hard-deleted)
router.get('/prescriptions', requireRole('admin', 'doctor', 'nurse', 'pharmacist'), (req: Request, res: Response) => {
  const patientId = req.query.patient_id as string | undefined;
  const statusFilter = String(req.query.status || 'active'); // active | cancelled | all
  let sql = `SELECT pr.*, p.full_name AS patient_name, u.full_name AS practitioner_name,
                    cu.full_name AS cancelled_by_name
             FROM prescriptions pr
             JOIN patients p ON p.id = pr.patient_id
             JOIN users u ON u.id = pr.practitioner_id
             LEFT JOIN users cu ON cu.id = pr.cancelled_by
             WHERE pr.tenant_id = ?`;
  const args: any[] = [req.tenantId];
  if (patientId) { sql += ` AND pr.patient_id = ?`; args.push(patientId); }
  if (statusFilter === 'active' || statusFilter === 'cancelled') {
    sql += ` AND COALESCE(pr.status, 'active') = ?`;
    args.push(statusFilter);
  }
  sql += ` ORDER BY pr.created_at DESC LIMIT 200`;
  const rows = (db.prepare(sql).all(...args) as any[]).map((pr) => {
    const items = revealPrescriptionItems(pr.items);
    const inv = pr.invoice_id
      ? db.prepare(`SELECT id, invoice_number, total, status, paid_at, payment_method FROM invoices WHERE id = ?`).get(pr.invoice_id) as any
      : null;
    return {
      ...pr,
      status: pr.status || 'active',
      items,
      stamp_label: formatStampLabel(pr),
      dispense_status: pr.dispense_status || 'none',
      invoice: inv || null,
      stock_linked: stockLinkedItems(items).length,
      paid: inv?.status === 'paid',
    };
  });
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN COALESCE(status, 'active') = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM prescriptions WHERE tenant_id = ?
    ${patientId ? 'AND patient_id = ?' : ''}
  `).get(...(patientId ? [req.tenantId, patientId] : [req.tenantId])) as any;
  res.json({
    prescriptions: rows,
    counts: {
      active: Number(counts?.active || 0),
      cancelled: Number(counts?.cancelled || 0),
    },
  });
});

router.post('/prescriptions', requireRole('admin', 'doctor'), (req: Request, res: Response) => {
  const parsed = prescriptionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  const stamp = stampFromUser(req.user!.id);
  const linked = stockLinkedItems(d.items);
  const shouldDispense = d.dispense_from_stock !== false && linked.length > 0;

  try {
    db.prepare(`
      INSERT INTO prescriptions (id, tenant_id, encounter_id, patient_id, practitioner_id, items, sent_via_whatsapp, status,
                                 signer_name, signer_council, signer_council_state, signed_at, dispense_status)
      VALUES (?,?,?,?,?,?,?, 'active',?,?,?,?, 'none')
    `).run(
      id, req.tenantId, d.encounter_id, d.patient_id, d.practitioner_id,
      sealPrescriptionItems(d.items), d.send_via_whatsapp ? 1 : 0,
      stamp.signer_name, stamp.signer_council, stamp.signer_council_state, stamp.signed_at,
    );
  } catch (e: any) {
    res.status(500).json({ error: 'create_failed', message: e.message });
    return;
  }

  let dispense: any = null;
  if (shouldDispense) {
    try {
      dispense = dispensePrescription({
        tenantId: req.tenantId!,
        userId: req.user!.id,
        prescriptionId: id,
        markPaid: !!d.mark_paid,
        paymentMethod: d.payment_method ?? null,
      });
    } catch (e: any) {
      // Reverse any partial stock if dispense failed mid-flight, then remove the new Rx
      try {
        reverseDispenseOnCancel({
          tenantId: req.tenantId!,
          userId: req.user!.id,
          prescriptionId: id,
        });
      } catch { /* best effort */ }
      // Soft-cancel instead of hard-delete if anything was written; else hard-delete brand-new empty Rx
      const moved = db.prepare(`
        SELECT COUNT(*) AS c FROM stock_movements
        WHERE tenant_id = ? AND reference_id = ? AND reason = 'prescription_dispense'
      `).get(req.tenantId, id) as any;
      if (Number(moved?.c || 0) > 0) {
        db.prepare(`
          UPDATE prescriptions SET status = 'cancelled', cancelled_at = datetime('now'),
            cancelled_by = ?, cancel_reason = ?, dispense_status = 'reversed'
          WHERE id = ? AND tenant_id = ?
        `).run(req.user!.id, `dispense_failed:${e.code || e.message}`, id, req.tenantId);
      } else {
        db.prepare(`DELETE FROM prescriptions WHERE id = ? AND tenant_id = ?`).run(id, req.tenantId);
      }
      const code = e.code || 'dispense_failed';
      const status = code === 'insufficient_stock' ? 409 : 400;
      res.status(status).json({
        error: code,
        message: e.message,
        item_name: e.item_name,
        available: e.available,
        requested: e.requested,
      });
      return;
    }
  }

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_prescription', resourceType: 'prescription', resourceId: id,
    afterValue: {
      dispense_from_stock: shouldDispense,
      invoice_id: dispense?.invoice_id || null,
      stock_lines: linked.length,
    },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.status(201).json({
    id, sent_via_whatsapp: d.send_via_whatsapp, status: 'active',
    stamp_label: formatStampLabel(stamp),
    dispense,
  });
});

// Update prescription items (e.g. dosage correction) — doctor only; only while active
router.put('/prescriptions/:id', requireRole('admin', 'doctor'), (req: Request, res: Response) => {
  const before = db.prepare(`SELECT * FROM prescriptions WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!before) { res.status(404).json({ error: 'not_found' }); return; }
  if ((before.status || 'active') === 'cancelled') {
    res.status(409).json({
      error: 'prescription_cancelled',
      message: 'Receita cancelada não pode ser editada. Restaure-a primeiro ou emita uma nova.',
    });
    return;
  }
  const parsed = prescriptionSchema.pick({ items: true }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  if ((before.dispense_status || 'none') === 'dispensed') {
    res.status(409).json({
      error: 'already_dispensed',
      message: 'Receita já dispensada do estoque. Cancele (reverte estoque se não paga) ou emita nova.',
    });
    return;
  }
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

/**
 * Cancel prescription (soft-delete) — CFM clinical retention.
 * Record remains in the cancelled / retention archive; never hard-deleted.
 * Prefer POST /cancel when a reason is provided (DELETE bodies are unreliable).
 */
function cancelPrescription(req: Request, res: Response) {
  const p = db.prepare(`SELECT * FROM prescriptions WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  if ((p.status || 'active') === 'cancelled') {
    res.json({ ok: true, status: 'cancelled', already: true });
    return;
  }
  const reasonRaw = req.body?.reason ?? req.query.reason;
  const reason = typeof reasonRaw === 'string' ? reasonRaw.slice(0, 500) : null;
  const now = new Date().toISOString();

  let reverse: any = null;
  try {
    reverse = reverseDispenseOnCancel({
      tenantId: req.tenantId!,
      userId: req.user!.id,
      prescriptionId: req.params.id,
    });
  } catch { /* best-effort stock reverse */ }

  db.prepare(`
    UPDATE prescriptions
    SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?
    WHERE id = ? AND tenant_id = ?
  `).run(now, req.user!.id, reason, req.params.id, req.tenantId);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'cancel_prescription', resourceType: 'prescription', resourceId: req.params.id,
    beforeValue: { status: p.status || 'active', dispense_status: p.dispense_status },
    afterValue: { status: 'cancelled', reason, stock_reverse: reverse },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({
    ok: true, status: 'cancelled', cancelled_at: now, clinical_retention: true,
    stock_reverse: reverse,
  });
}

router.post('/prescriptions/:id/cancel', requireRole('doctor', 'admin'), cancelPrescription);
router.delete('/prescriptions/:id', requireRole('doctor', 'admin'), cancelPrescription);

/** Restore a cancelled prescription to active (vigente). Does NOT re-dispense stock. */
router.post('/prescriptions/:id/restore', requireRole('doctor', 'admin'), (req: Request, res: Response) => {
  const p = db.prepare(`SELECT * FROM prescriptions WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!p) { res.status(404).json({ error: 'not_found' }); return; }
  if ((p.status || 'active') !== 'cancelled') {
    res.json({ ok: true, status: 'active', already: true });
    return;
  }
  db.prepare(`
    UPDATE prescriptions
    SET status = 'active', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
    WHERE id = ? AND tenant_id = ?
  `).run(req.params.id, req.tenantId);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'restore_prescription', resourceType: 'prescription', resourceId: req.params.id,
    beforeValue: { status: 'cancelled' },
    afterValue: { status: 'active', note: 'stock_not_re_dispensed' },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.json({ ok: true, status: 'active', note: 'Reabre a receita; re-dispensar estoque via POST /dispense se necessário.' });
});

/** Explicit dispense (pharmacist / admin) for Rx that was created without stock debit. */
router.post('/prescriptions/:id/dispense', requireRole('admin', 'doctor', 'pharmacist', 'nurse'), (req: Request, res: Response) => {
  try {
    const result = dispensePrescription({
      tenantId: req.tenantId!,
      userId: req.user!.id,
      prescriptionId: req.params.id,
      markPaid: !!req.body?.mark_paid,
      paymentMethod: req.body?.payment_method ?? null,
    });
    logAudit({
      tenantId: req.tenantId,
      actorId: req.user!.id, actorEmail: req.user!.email,
      action: 'dispense_prescription', resourceType: 'prescription', resourceId: req.params.id,
      afterValue: {
        invoice_id: result.invoice_id,
        total: result.invoice_total,
        cogs: result.total_cogs,
        paid: result.invoice_status === 'paid',
      },
      legalBasis: 'health_protection_art7_VIII',
    });
    res.status(result.already ? 200 : 201).json(result);
  } catch (e: any) {
    const code = e.code || 'dispense_failed';
    const status = code === 'insufficient_stock' ? 409
      : code === 'not_found' ? 404
      : code === 'prescription_cancelled' ? 409
      : 400;
    res.status(status).json({
      error: code,
      message: e.message,
      item_name: e.item_name,
      available: e.available,
      requested: e.requested,
    });
  }
});

/** Trail: stock out, who prescribed, invoice, paid?, journals. */
router.get('/prescriptions/:id/trail', requireRole('admin', 'doctor', 'nurse', 'pharmacist', 'accountant'), (req: Request, res: Response) => {
  const trail = prescriptionDispenseTrail(req.tenantId!, req.params.id);
  if (!trail) { res.status(404).json({ error: 'not_found' }); return; }
  res.json(trail);
});

export default router;
