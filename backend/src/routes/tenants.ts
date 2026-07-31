/**
 * Platform tenant administration — superadmin only.
 * Create clinics, list them, bootstrap a clinic admin.
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db, seedMarketingDefaults } from '../db/schema';
import { authenticate, requireSuperadmin } from '../middleware/auth';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, requireSuperadmin);

const createSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  cnpj: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  admin_email: z.string().email(),
  admin_name: z.string().min(1),
  admin_password: z.string().min(8),
});

router.get('/', (_req: Request, res: Response) => {
  const tenants = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.active = 1) AS staff_count,
      (SELECT COUNT(*) FROM patients p WHERE p.tenant_id = t.id) AS patient_count
    FROM tenants t
    ORDER BY t.name ASC
  `).all();
  res.json({ tenants });
});

router.get('/:id', (req: Request, res: Response) => {
  const t = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(req.params.id);
  if (!t) { res.status(404).json({ error: 'not_found' }); return; }
  const staff = db.prepare(`
    SELECT id, email, full_name, role, active FROM users WHERE tenant_id = ? ORDER BY full_name
  `).all(req.params.id);
  res.json({ tenant: t, staff });
});

router.post('/', (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const existing = db.prepare(`SELECT id FROM tenants WHERE slug = ?`).get(d.slug);
  if (existing) { res.status(409).json({ error: 'duplicate_slug' }); return; }
  const emailTaken = db.prepare(`SELECT id FROM users WHERE email = ?`).get(d.admin_email.toLowerCase());
  if (emailTaken) { res.status(409).json({ error: 'duplicate_email' }); return; }

  const tenantId = `t_${uuid().replace(/-/g, '').slice(0, 16)}`;
  const adminId = uuid();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO tenants (id, slug, name, cnpj, address, phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tenantId, d.slug, d.name, d.cnpj ?? null, d.address ?? null, d.phone ?? null);
    db.prepare(`
      INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_superadmin)
      VALUES (?, ?, ?, ?, ?, 'admin', 0)
    `).run(adminId, tenantId, d.admin_email.toLowerCase(), bcrypt.hashSync(d.admin_password, 10), d.admin_name);
  });
  try {
    tx();
    seedMarketingDefaults(tenantId);
  } catch (e: any) {
    res.status(409).json({ error: 'create_failed', message: e.message });
    return;
  }
  logAudit({
    tenantId: tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'tenant_created', resourceType: 'tenant', resourceId: tenantId,
    afterValue: { slug: d.slug, name: d.name, admin_email: d.admin_email },
    legalBasis: 'legal_obligation_art7_II',
  });
  res.status(201).json({ id: tenantId, admin_id: adminId });
});

router.put('/:id', (req: Request, res: Response) => {
  const t = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(req.params.id) as any;
  if (!t) { res.status(404).json({ error: 'not_found' }); return; }
  const { name, cnpj, address, phone, active } = req.body ?? {};
  const sets: string[] = [];
  const args: any[] = [];
  if (name !== undefined) { sets.push('name = ?'); args.push(name); }
  if (cnpj !== undefined) { sets.push('cnpj = ?'); args.push(cnpj); }
  if (address !== undefined) { sets.push('address = ?'); args.push(address); }
  if (phone !== undefined) { sets.push('phone = ?'); args.push(phone); }
  if (active !== undefined) { sets.push('active = ?'); args.push(active ? 1 : 0); }
  if (!sets.length) { res.json({ ok: true, noop: true }); return; }
  args.push(req.params.id);
  db.prepare(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  logAudit({
    tenantId: req.params.id,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'tenant_updated', resourceType: 'tenant', resourceId: req.params.id,
    legalBasis: 'legal_obligation_art7_II',
  });
  res.json({ ok: true });
});

export default router;
