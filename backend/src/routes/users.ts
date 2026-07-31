/**
 * Staff (system users) management — admin only, tenant-scoped.
 * Covers the full lifecycle: hire (create), update, deactivate, remove.
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit';

const router = Router();

// Staff directory — any authenticated user (needed to pick a practitioner
// when booking an appointment); never exposes password hashes.
router.get('/directory', authenticate, (req: Request, res: Response) => {
  res.json({
    users: db.prepare(`
      SELECT id, full_name, role, council_number, council_state
      FROM users WHERE active = 1 AND tenant_id = ? ORDER BY full_name ASC
    `).all(req.tenantId),
  });
});

router.use(authenticate, requireRole('admin'));

const ROLES = ['admin','doctor','nurse','receptionist','accountant','pharmacist','dpo'] as const;

const userSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).optional(),
  full_name: z.string().min(1),
  role: z.enum(ROLES),
  cpf: z.string().regex(/^\d{11}$/).optional().nullable(),
  council_number: z.string().optional().nullable(),
  council_state: z.string().length(2).optional().nullable(),
});

const createSchema = userSchema.extend({ password: z.string().min(8) });

const publicCols = `id, email, full_name, role, cpf, council_number, council_state, active, created_at, updated_at`;

router.get('/', (req: Request, res: Response) => {
  const includeInactive = req.query.include_inactive === 'true';
  const rows = db.prepare(
    `SELECT ${publicCols} FROM users WHERE tenant_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY full_name ASC`
  ).all(req.tenantId);
  res.json({ users: rows });
});

router.post('/', (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  try {
    db.prepare(`
      INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, cpf, council_number, council_state)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(id, req.tenantId, d.email.toLowerCase(), bcrypt.hashSync(d.password, 10), d.full_name, d.role,
           d.cpf ?? null, d.council_number ?? null, d.council_state ?? null);
  } catch (e: any) {
    res.status(409).json({ error: 'duplicate_email', message: e.message });
    return;
  }
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_staff_user', resourceType: 'user', resourceId: id,
    afterValue: { email: d.email, role: d.role }, legalBasis: 'legal_obligation_art7_II',
  });
  res.status(201).json({ id });
});

router.put('/:id', (req: Request, res: Response) => {
  const target = db.prepare(`SELECT * FROM users WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!target) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = userSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of ['email','full_name','role','cpf','council_number','council_state'] as const) {
    if (d[k] !== undefined) { sets.push(`${k} = ?`); args.push(k === 'email' ? (d[k] as string).toLowerCase() : d[k]); }
  }
  if (d.password) { sets.push(`password_hash = ?`); args.push(bcrypt.hashSync(d.password, 10)); }
  if (!sets.length) { res.json({ ok: true, noop: true }); return; }
  try {
    sets.push(`updated_at = ?`);
    args.push(new Date().toISOString(), req.params.id, req.tenantId);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...args);
  } catch (e: any) {
    res.status(409).json({ error: 'duplicate_email', message: e.message });
    return;
  }
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'update_staff_user', resourceType: 'user', resourceId: req.params.id,
    beforeValue: { email: target.email, role: target.role },
    afterValue: { email: d.email ?? target.email, role: d.role ?? target.role },
    legalBasis: 'legal_obligation_art7_II',
  });
  res.json({ ok: true });
});

router.delete('/:id', (req: Request, res: Response) => {
  const target = db.prepare(`SELECT id, email, full_name, role FROM users WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!target) { res.status(404).json({ error: 'not_found' }); return; }
  if (target.id === req.user!.id) { res.status(409).json({ error: 'cannot_delete_self' }); return; }
  if (target.role === 'admin') {
    const admins = (db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND tenant_id = ? AND id != ?`).get(req.tenantId, target.id) as any).c;
    if (admins === 0) { res.status(409).json({ error: 'last_admin' }); return; }
  }
  const refs = (db.prepare(`
    SELECT (SELECT COUNT(*) FROM appointments WHERE practitioner_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM encounters WHERE practitioner_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM prescriptions WHERE practitioner_id = ? AND tenant_id = ?) +
           (SELECT COUNT(*) FROM journal_entries WHERE created_by = ? AND tenant_id = ?) AS c
  `).get(target.id, req.tenantId, target.id, req.tenantId, target.id, req.tenantId, target.id, req.tenantId) as any).c;
  if (refs > 0) {
    db.prepare(`UPDATE users SET active = 0, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(new Date().toISOString(), target.id, req.tenantId);
    logAudit({
      tenantId: req.tenantId,
      actorId: req.user!.id, actorEmail: req.user!.email,
      action: 'deactivate_staff_user', resourceType: 'user', resourceId: target.id,
      beforeValue: { email: target.email }, legalBasis: 'legal_obligation_art7_II',
    });
    res.json({ ok: true, soft_deleted: true });
    return;
  }
  db.prepare(`DELETE FROM users WHERE id = ? AND tenant_id = ?`).run(target.id, req.tenantId);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'delete_staff_user', resourceType: 'user', resourceId: target.id,
    beforeValue: { email: target.email }, legalBasis: 'legal_obligation_art7_II',
  });
  res.json({ ok: true, soft_deleted: false });
});

export default router;
