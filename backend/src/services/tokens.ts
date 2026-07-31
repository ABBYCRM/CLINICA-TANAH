/**
 * API tokens — programmatic access to the CRM.
 * Format: ct_<48 hex>. Only the SHA-256 hash is stored; the plaintext
 * token is returned exactly once at mint time.
 */
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { db } from '../db/schema';

export type TokenScope = 'read' | 'read_write';
export const TOKEN_PREFIX = 'ct_';

export interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  scope: TokenScope;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function mintToken(name: string, scope: TokenScope, expiresAt: string | null, createdBy: string): { row: ApiTokenRow; token: string } {
  const token = TOKEN_PREFIX + crypto.randomBytes(24).toString('hex'); // ct_ + 48 hex
  const id = uuid();
  db.prepare(`
    INSERT INTO api_tokens (id, name, prefix, token_hash, scope, created_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, token.slice(0, 10), hash(token), scope, createdBy, expiresAt);
  return {
    row: db.prepare(`SELECT * FROM api_tokens WHERE id = ?`).get(id) as ApiTokenRow,
    token,
  };
}

/** Validate a presented token. Updates last_used_at on success (cheap WAL write). */
export function verifyApiToken(raw: string): ApiTokenRow | null {
  if (!raw.startsWith(TOKEN_PREFIX) || raw.length !== TOKEN_PREFIX.length + 48) return null;
  const row = db.prepare(`SELECT * FROM api_tokens WHERE token_hash = ?`).get(hash(raw)) as ApiTokenRow | undefined;
  if (!row || row.revoked_at) return null;
  if (row.expires_at && row.expires_at < new Date().toISOString()) return null;
  db.prepare(`UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?`).run(row.id);
  return row;
}

export function revokeToken(id: string): boolean {
  const res = db.prepare(`UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`).run(id);
  return res.changes > 0;
}
