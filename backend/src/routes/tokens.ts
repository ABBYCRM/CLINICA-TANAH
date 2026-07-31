/**
 * API token administration — admin only.
 * Mint (plaintext returned once), list (no secrets), revoke.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { mintToken, revokeToken } from '../services/tokens';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, requireRole('admin'));

const SAFE_COLS = `id, name, prefix, scope, created_by, created_at, last_used_at, expires_at, revoked_at`;

router.get('/', (_req: Request, res: Response) => {
  res.json({
    tokens: db.prepare(`SELECT ${SAFE_COLS} FROM api_tokens ORDER BY created_at DESC`).all(),
  });
});

router.post('/', (req: Request, res: Response) => {
  const { name, scope, expires_in_days } = req.body ?? {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'validation', required: ['name'] });
    return;
  }
  if (scope !== undefined && !['read', 'read_write'].includes(scope)) {
    res.status(400).json({ error: 'validation', allowed_scopes: ['read', 'read_write'] });
    return;
  }
  let expiresAt: string | null = null;
  if (expires_in_days !== undefined && expires_in_days !== null) {
    const days = parseInt(expires_in_days, 10);
    if (Number.isNaN(days) || days < 1 || days > 3650) {
      res.status(400).json({ error: 'validation', message: 'expires_in_days must be 1..3650' });
      return;
    }
    expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  }
  const { row, token } = mintToken(name.trim(), scope ?? 'read_write', expiresAt, req.user!.id);
  logAudit({
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'api_token_minted', resourceType: 'api_token', resourceId: row.id,
    afterValue: { name: row.name, scope: row.scope, expires_at: row.expires_at },
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    legalBasis: 'legal_obligation_art7_II',
  });
  // plaintext token returned exactly once — it cannot be recovered later
  res.status(201).json({ token, id: row.id, prefix: row.prefix, scope: row.scope, expires_at: row.expires_at });
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare(`SELECT id, name, revoked_at FROM api_tokens WHERE id = ?`).get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'not_found' }); return; }
  const changed = revokeToken(req.params.id);
  logAudit({
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'api_token_revoked', resourceType: 'api_token', resourceId: req.params.id,
    beforeValue: { name: existing.name },
    ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
    legalBasis: 'legal_obligation_art7_II',
  });
  res.json({ ok: true, revoked: changed || !!existing.revoked_at });
});

export default router;
