/**
 * Auth middleware — JWT-based, role-aware.
 * Brazilian medical staff: admin, doctor, nurse, receptionist, accountant, pharmacist, dpo
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/schema';

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
