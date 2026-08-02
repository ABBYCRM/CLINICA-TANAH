/**
 * Saved apps — per-user shortcuts to external URLs.
 * Each user manages their own list within their (effective) tenant:
 * list, add, and delete at will. No admin role required.
 */
import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/schema';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

const MAX_LABEL = 120;
const MAX_URL = 2048;

/** Normalize + validate a user-supplied URL. Returns null when invalid. */
function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.length > MAX_URL) return null;
  // Be forgiving: assume https:// when the user omits the scheme.
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

router.get('/', (req: Request, res: Response) => {
  const apps = db.prepare(
    `SELECT id, label, url, created_at
       FROM user_apps
      WHERE tenant_id = ? AND user_id = ?
      ORDER BY created_at DESC`
  ).all(req.tenantId, req.user!.id);
  res.json({ apps });
});

router.post('/', (req: Request, res: Response) => {
  const { label, url } = req.body ?? {};
  const cleanLabel = typeof label === 'string' ? label.trim() : '';
  if (!cleanLabel) {
    res.status(400).json({ error: 'validation', required: ['label'] });
    return;
  }
  if (cleanLabel.length > MAX_LABEL) {
    res.status(400).json({ error: 'validation', message: `label must be <= ${MAX_LABEL} chars` });
    return;
  }
  const cleanUrl = normalizeUrl(url);
  if (!cleanUrl) {
    res.status(400).json({ error: 'validation', message: 'A valid http(s) URL is required', field: 'url' });
    return;
  }
  const id = uuid();
  db.prepare(
    `INSERT INTO user_apps (id, tenant_id, user_id, label, url)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, req.tenantId, req.user!.id, cleanLabel, cleanUrl);
  const app = db.prepare(`SELECT id, label, url, created_at FROM user_apps WHERE id = ?`).get(id);
  res.status(201).json({ app });
});

router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare(
    `SELECT id FROM user_apps WHERE id = ? AND tenant_id = ? AND user_id = ?`
  ).get(req.params.id, req.tenantId, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  db.prepare(`DELETE FROM user_apps WHERE id = ? AND tenant_id = ? AND user_id = ?`)
    .run(req.params.id, req.tenantId, req.user!.id);
  res.json({ ok: true });
});

export default router;
