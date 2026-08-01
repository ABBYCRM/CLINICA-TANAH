import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db, DEFAULT_TENANT_ID } from '../db/schema';
import { signToken, authenticate, loadUserByLogin } from '../middleware/auth';
import { logAudit } from '../services/audit';

const router = Router();

const STEP_UP_TTL_SEC = 5 * 60;
const stepUpMemory = new Map<string, { userId: string; expiresAt: number }>();

function stepUpSecret(): string {
  return process.env.JWT_SECRET || 'clinica-tanah-dev-secret-change-me-in-prod';
}

/** Issue a short-lived step-up token after password re-verification. */
export function issueStepUpToken(userId: string): { step_up_token: string; expires_at: string } {
  const expiresAtMs = Date.now() + STEP_UP_TTL_SEC * 1000;
  const expires_at = new Date(expiresAtMs).toISOString();
  const step_up_token = jwt.sign(
    { typ: 'step_up', sub: userId, exp: Math.floor(expiresAtMs / 1000) },
    stepUpSecret(),
  );
  stepUpMemory.set(step_up_token, { userId, expiresAt: expiresAtMs });
  // Opportunistic prune
  if (stepUpMemory.size > 500) {
    const now = Date.now();
    for (const [k, v] of stepUpMemory) {
      if (v.expiresAt < now) stepUpMemory.delete(k);
    }
  }
  return { step_up_token, expires_at };
}

/** Verify a step-up token belongs to the given user and is unexpired. */
export function verifyStepUp(token: string | null | undefined, userId: string): boolean {
  if (!token || !userId) return false;
  const mem = stepUpMemory.get(token);
  if (mem) {
    if (mem.expiresAt < Date.now() || mem.userId !== userId) return false;
    return true;
  }
  try {
    const payload = jwt.verify(token, stepUpSecret()) as any;
    if (payload?.typ !== 'step_up') return false;
    if (String(payload.sub) !== String(userId)) return false;
    return true;
  } catch {
    return false;
  }
}

const loginSchema = z.object({
  email: z.string().min(1), // username or email
  password: z.string().min(1),
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', details: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;
  const user = loadUserByLogin(email);
  if (!user) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  const ok = await bcrypt.compare(String(password).trim(), user.password_hash);
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

/** Re-verify password for sensitive body-image generation (step-up auth). */
router.post('/step-up', authenticate, async (req: Request, res: Response) => {
  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation' });
    return;
  }
  const user = db.prepare(`SELECT id, password_hash FROM users WHERE id = ? AND active = 1`).get(req.user!.id) as any;
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const ok = await bcrypt.compare(String(parsed.data.password).trim(), user.password_hash);
  if (!ok) {
    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'step_up_failed',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string,
      legalBasis: 'legal_obligation_art7_II',
      tenantId: req.tenantId,
    });
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  const issued = issueStepUpToken(user.id);
  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'step_up_ok',
    legalBasis: 'legal_obligation_art7_II',
    tenantId: req.tenantId,
  });
  res.json({ ok: true, ...issued });
});

export default router;
