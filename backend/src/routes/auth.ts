import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
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
  const token = signToken({ id: user.id, email: user.email, full_name: user.full_name, role: user.role });
  logAudit({
    actorId: user.id, actorEmail: user.email, action: 'login_success',
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    legalBasis: 'legal_obligation_art7_II',
  });
  res.json({
    token,
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
  });
});

router.get('/me', authenticate, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

router.post('/logout', authenticate, (req: Request, res: Response) => {
  logAudit({
    actorId: req.user!.id, actorEmail: req.user!.email, action: 'logout',
    legalBasis: 'legal_obligation_art7_II',
  });
  res.json({ ok: true });
});

export default router;
