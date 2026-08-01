/**
 * HTTP security hardening — LGPD art. 46 technical measures /
 * CFM electronic-record access integrity expectations.
 */
import { Request, Response, NextFunction } from 'express';

const DEFAULT_ORIGINS = [
  'https://clinica-tanah-bbqu7.ondigitalocean.app',
  'http://127.0.0.1:3100',
  'http://localhost:3100',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:3001',
  'http://localhost:3001',
];

function allowedOrigins(): string[] {
  const fromEnv = (process.env.APP_ORIGIN || process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const isProd = process.env.NODE_ENV === 'production';
  if (fromEnv.length) return fromEnv;
  if (isProd) return DEFAULT_ORIGINS.filter((o) => o.startsWith('https://'));
  return DEFAULT_ORIGINS;
}

/** Security headers on every response (helmet-equivalent, zero deps). */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // CSP: SPA + same-origin API; allow inline for Vite legacy only in non-prod if needed
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "object-src 'none'",
    ].join('; '),
  );
  next();
}

/** Reject plain HTTP at the app edge when behind a TLS-terminating proxy. */
export function requireHttps(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== 'production') return next();
  if (process.env.ALLOW_INSECURE_HTTP === '1') return next();
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  if (String(proto).split(',')[0].trim() === 'https') return next();
  // Platform health probes and internal checks
  if (req.path === '/api/health' || req.path === '/health' || req.url?.startsWith('/api/health')) {
    return next();
  }
  // If no forwarded proto header, assume platform terminates TLS (DO App Platform)
  if (!req.headers['x-forwarded-proto']) return next();
  res.status(400).json({
    error: 'https_required',
    message: 'Conexão deve usar HTTPS (LGPD art. 46 — criptografia em trânsito).',
  });
}

export function corsOriginDelegate(
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void,
): void {
  const list = allowedOrigins();
  // Non-browser / same-origin / curl
  if (!origin) return cb(null, true);
  if (list.includes(origin)) return cb(null, true);
  if (process.env.NODE_ENV !== 'production') return cb(null, true);
  cb(null, false);
}

export function getAllowedOrigins(): string[] {
  return allowedOrigins();
}
