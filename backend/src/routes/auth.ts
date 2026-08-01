import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, DEFAULT_TENANT_ID } from '../db/schema';
import { signToken, authenticate, loadUserByEmail } from '../middleware/auth';
import { logAudit } from '../services/audit';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', details: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;
  const user = loadUserByEmail(email);
  if (!user) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    logAudit({
      actorEmail: email,
      action: 'login_failed',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string,
      legalBasis: 'legal_obligation_art7_II',
    });
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  // Legacy rows / partial seeds may lack tenant_id — attach the platform default
  if (!user.tenant_id) {
    db.prepare(`UPDATE users SET tenant_id = ? WHERE id = ?`).run(DEFAULT_TENANT_ID, user.id);
    user.tenant_id = DEFAULT_TENANT_ID;
  }
  const token = signToken({
    id: user.id, email: user.email, full_name: user.full_name,
    role: user.role, tenant_id: user.tenant_id, is_superadmin: !!user.is_superadmin,
  });
  logAudit({
    actorId: user.id, actorEmail: user.email, action: 'login_success',
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    legalBasis: 'legal_obligation_art7_II',
    tenantId: user.tenant_id,
  });
  const tenant = db.prepare(`SELECT id, slug, name FROM tenants WHERE id = ?`).get(user.tenant_id) as any;
  res.json({
    token,
    user: {
      id: user.id, email: user.email, full_name: user.full_name, role: user.role,
      tenant_id: user.tenant_id, is_superadmin: !!user.is_superadmin, tenant_name: tenant?.name,
    },
  });
});

router.get('/me', authenticate, (req: Request, res: Response) => {
  const tenant = db.prepare(`SELECT id, slug, name FROM tenants WHERE id = ?`).get(req.user!.tenant_id) as any;
  const effective = db.prepare(`SELECT id, slug, name FROM tenants WHERE id = ?`).get(req.tenantId) as any;
  res.json({
    user: {
      id: req.user!.id,
      email: req.user!.email,
      full_name: req.user!.full_name,
      role: req.user!.role,
      tenant_id: req.user!.tenant_id,
      is_superadmin: !!req.user!.is_superadmin,
      tenant_name: tenant?.name,
      effective_tenant_name: effective?.name,
    },
  });
});

router.post('/logout', authenticate, (req: Request, res: Response) => {
  logAudit({
    actorId: req.user!.id, actorEmail: req.user!.email, action: 'logout',
    legalBasis: 'legal_obligation_art7_II',
  });
  res.json({ ok: true });
});

export default router;
