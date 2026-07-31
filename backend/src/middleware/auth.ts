/**
 * Auth middleware — JWT-based, role-aware; also accepts API tokens (ct_…).
 * Brazilian medical staff: admin, doctor, nurse, receptionist, accountant, pharmacist, dpo
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/schema';
import { verifyApiToken, TOKEN_PREFIX } from '../services/tokens';

const JWT_SECRET = process.env.JWT_SECRET || 'clinica-tanah-dev-secret-change-me-in-prod';
const TOKEN_TTL = '8h';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Present when the request was authenticated with an API token */
      apiTokenScope?: 'read' | 'read_write';
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    return null;
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const token = header.slice(7);

  // API tokens (ct_…) — full-CRM access, gated by scope
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
    req.user = {
      id: `api-token:${apiToken.id}`,
      email: `api-token:${apiToken.name}`,
      full_name: `[API] ${apiToken.name}`,
      role: 'admin', // API tokens control the entire CRM
    };
    req.apiTokenScope = apiToken.scope;
    next();
    return;
  }

  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  req.user = user;
  next();
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

export function loadUserByEmail(email: string) {
  return db.prepare(`SELECT * FROM users WHERE email = ? AND active = 1`).get(email) as any;
}
