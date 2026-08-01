/**
 * Auth middleware — JWT-based, role-aware, tenant-aware; also accepts API tokens (ct_…).
 * Brazilian medical staff: admin, doctor, nurse, receptionist, accountant, pharmacist, dpo
 *
 * Multi-tenancy: every authenticated request carries req.tenantId. Regular
 * users are locked to their own tenant; superadmins may view another
 * tenant by sending the X-Tenant-Id header.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/schema';
import { verifyApiToken, TOKEN_PREFIX } from '../services/tokens';

function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET || '';
  if (process.env.NODE_ENV === 'production') {
    if (!fromEnv || fromEnv === 'clinica-tanah-dev-secret-change-me-in-prod') {
      console.error('SECURITY: JWT_SECRET missing/default in production — using ephemeral process secret (sessions will reset on restart).');
      return `ephemeral-${process.pid}-${Date.now()}-clinica-tanah-needs-real-jwt-secret`;
    }
    if (fromEnv.length < 24) {
      console.warn('⚠️  JWT_SECRET is shorter than recommended (≥24 chars) for medical-grade deployments.');
    }
    return fromEnv;
  }
  return fromEnv || 'clinica-tanah-dev-secret-change-me-in-prod';
}

const JWT_SECRET = resolveJwtSecret();
/** Clinic staff often leave a tab open through a shift — 24h beats 8h expiry surprises. */
const TOKEN_TTL = '24h';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  tenant_id: string;
  is_superadmin?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Effective tenant for this request (after superadmin override) */
      tenantId?: string;
      /** Present when the request was authenticated with an API token */
      apiTokenScope?: 'read' | 'read_write';
    }
  }
}

export function signToken(user: Omit<AuthUser, 'is_superadmin'> & { is_superadmin?: boolean }): string {
  return jwt.sign(
    {
      id: user.id, email: user.email, role: user.role,
      full_name: user.full_name, tenant_id: user.tenant_id,
      is_superadmin: user.is_superadmin ? 1 : 0,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    // Always refresh identity from DB so tenant upgrades / role changes apply without re-login
    const row = db.prepare(`
      SELECT id, email, full_name, role, tenant_id, is_superadmin, active
      FROM users WHERE id = ?
    `).get(payload.id) as any;
    if (!row || !row.active) return null;
    const tenantId = row.tenant_id || payload.tenant_id;
    if (!tenantId) return null;
    return {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      role: row.role,
      tenant_id: tenantId,
      is_superadmin: !!row.is_superadmin,
    };
  } catch {
    return null;
  }
}

/** Resolve the effective tenant: superadmins may override via X-Tenant-Id. */
function resolveTenant(req: Request, user: AuthUser): string {
  if (user.is_superadmin) {
    const requested = req.headers['x-tenant-id'] as string | undefined;
    if (requested) {
      const exists = db.prepare(`SELECT id FROM tenants WHERE id = ? AND active = 1`).get(requested);
      if (exists) return requested;
    }
  }
  return user.tenant_id;
}

function finishAuth(req: Request, res: Response, next: NextFunction, user: AuthUser): void {
  if (!user.tenant_id) {
    res.status(401).json({ error: 'invalid_token', message: 'User has no tenant' });
    return;
  }
  req.user = user;
  req.tenantId = resolveTenant(req, user);
  next();
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const token = header.slice(7);

  // API tokens (ct_…) — full-CRM access within the token's tenant, gated by scope
  if (token.startsWith(TOKEN_PREFIX)) {
    const apiToken = verifyApiToken(token);
    if (!apiToken) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    if (apiToken.scope === 'read' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      res.status(403).json({ error: 'scope_read_only', message: 'This API token is read-only.' });
      return;
    }
    finishAuth(req, res, next, {
      id: `api-token:${apiToken.id}`,
      email: `api-token:${apiToken.name}`,
      full_name: `[API] ${apiToken.name}`,
      role: 'admin', // API tokens control the entire CRM (of their tenant)
      tenant_id: (apiToken as any).tenant_id,
      is_superadmin: false,
    });
    return;
  }

  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  finishAuth(req, res, next, user);
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden', required: roles, actual: req.user.role });
      return;
    }
    next();
  };
}

/** Platform-level administration (tenant management). */
export function requireSuperadmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (!req.user.is_superadmin) { res.status(403).json({ error: 'superadmin_required' }); return; }
  next();
}

export function loadUserByEmail(email: string) {
  return loadUserByLogin(email);
}

/** Resolve staff by email, username (full_name), or email local-part — case-insensitive. */
export function loadUserByLogin(login: string) {
  const raw = (login || '').trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  return db.prepare(`
    SELECT * FROM users
    WHERE active = 1 AND (
      lower(email) = ?
      OR lower(full_name) = ?
      OR lower(email) = ? || '@clinica-tanah.com.br'
    )
    LIMIT 1
  `).get(key, key, key) as any;
}
