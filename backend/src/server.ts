/**
 * Clínica Tanah — Backend Server
 * LGPD-aware medical CRM for São Paulo, Brasil
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load .env from repo root and/or backend cwd (never commit real secrets)
for (const candidate of [
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), '..', '.env'),
  path.join(__dirname, '..', '..', '.env'),
  path.join(__dirname, '..', '.env'),
]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate, override: false });
}

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { initSchema } from './db/schema';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import tokensRouter from './routes/tokens';
import patientsRouter from './routes/patients';
import appointmentsRouter from './routes/appointments';
import clinicalRouter from './routes/clinical';
import chartRouter from './routes/chart';
import bodyRouter, { publicBodyAssetHandler } from './routes/body';
import hairRouter from './routes/hair';
import inventoryRouter from './routes/inventory';
import accountingRouter from './routes/accounting';
import payrollRouter from './routes/payroll';
import whatsappRouter from './routes/whatsapp';
import lgpdRouter from './routes/lgpd';
import tenantsRouter from './routes/tenants';
import formsRouter, { publicFormsRouter } from './routes/forms';
import appsRouter from './routes/apps';
import integrationsRouter from './routes/integrations';
import { mountStatic } from './static';
import { authenticate } from './middleware/auth';
import { corsOriginDelegate, requireHttps, securityHeaders } from './middleware/security';
import { assertSecurityConfig, encryptionStatus } from './services/phiCrypto';
import { buildLgpdPolicy } from './services/lgpdPolicy';
import { hydrateImageProviderSettings } from './services/integrationSettings';
assertSecurityConfig();
try {
  initSchema();
} catch (err: any) {
  console.error('FATAL: schema init failed', err?.stack || err);
  process.exit(1);
}

let imageIntegrationStatus: ReturnType<typeof hydrateImageProviderSettings> | null = null;
try {
  imageIntegrationStatus = hydrateImageProviderSettings();
} catch (err: any) {
  console.error('IMAGE PROVIDERS: failed to hydrate saved integration settings', err?.stack || err);
}

const app = express();
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(requireHttps);
// Reflect allowed origins; keep simple for App Platform health probes (no Origin header)
app.use(cors({
  origin: (origin, cb) => {
    try {
      corsOriginDelegate(origin, cb);
    } catch {
      cb(null, true);
    }
  },
}));
// Capture the raw body so the WhatsApp webhook can verify Meta's X-Hub-Signature-256
// 12mb allows invoice document base64 uploads for NVIDIA OCR
app.use(express.json({
  limit: '12mb',
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));

// Rate limit WhatsApp webhook & auth (disabled under NODE_ENV=test so
// the e2e suite — dozens of logins against a disposable DB — stays deterministic)
const isTest = process.env.NODE_ENV === 'test';
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 30, message: { error: 'rate_limited' }, skip: () => isTest });
app.use('/api/auth/login', authLimiter);
app.use('/api/whatsapp/webhook', rateLimit({ windowMs: 1*60*1000, max: 120 }));
const publicFormsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'rate_limited' },
  skip: () => isTest,
});
app.use('/api/public/forms', publicFormsLimiter);

// Health
app.get('/api/health', (_req, res) => {
  let enc: ReturnType<typeof encryptionStatus> | { enabled: false } = { enabled: false };
  try { enc = encryptionStatus(); } catch { /* ignore */ }
  res.json({
    ok: true,
    service: 'clinica-tanah-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    security: {
      phi_encryption: enc,
      https_enforced: process.env.NODE_ENV === 'production',
      compliance: ['LGPD', 'CFM_1821_retention', 'ANPD_art46_measures'],
    },
  });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/tokens', tokensRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/clinical/body', bodyRouter);
app.use('/api/clinical/hair', hairRouter);
app.use('/api/clinical/chart', chartRouter);
app.use('/api/clinical', clinicalRouter);
app.get('/api/public/body-asset/:token', publicBodyAssetHandler);
app.use('/api/inventory', inventoryRouter);
app.use('/api/accounting', accountingRouter);
app.use('/api/payroll', payrollRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/lgpd', lgpdRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/forms', formsRouter);
app.use('/api/public/forms', publicFormsRouter);
app.use('/api/apps', appsRouter);

// Public LGPD privacy policy (no auth — patients / intake)
app.get('/api/public/privacy', (_req, res) => {
  try {
    res.json(buildLgpdPolicy());
  } catch (e: any) {
    res.status(500).json({ error: 'policy_unavailable', message: e?.message });
  }
});

// Dashboard
import { db } from './db/schema';
app.get('/api/dashboard', authenticate, (req: Request, res: Response, next: NextFunction) => {
  try {
    const tid = req.tenantId!;
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + '-01';
    const todaysAppts = (db.prepare(`SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ? AND date(scheduled_at) = ? AND status NOT IN ('cancelled','no_show')`).get(tid, today) as any).c;
    const totalPatients = (db.prepare(`SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ?`).get(tid) as any).c;
    const lowStock = (db.prepare(`
      SELECT COUNT(*) AS c FROM (
        SELECT i.id, COALESCE(SUM(b.quantity), 0) AS qty
        FROM inventory_items i LEFT JOIN inventory_batches b ON b.item_id = i.id AND date(b.expiry_date) >= date('now')
        WHERE i.active = 1 AND i.tenant_id = ?
        GROUP BY i.id
        HAVING qty < i.min_stock
      )
    `).get(tid) as any).c;
    const pendingInvoices = (db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE tenant_id = ? AND status IN ('issued','overdue')`).get(tid) as any).c;
    const expiringBatches = (db.prepare(`SELECT COUNT(*) AS c FROM inventory_batches WHERE tenant_id = ? AND date(expiry_date) <= date('now', '+30 days')`).get(tid) as any).c;
    const openRequests = (db.prepare(`SELECT COUNT(*) AS c FROM lgpd_data_requests WHERE tenant_id = ? AND status = 'open'`).get(tid) as any).c;
    const monthlyRevenue = (db.prepare(`
      SELECT COALESCE(SUM(total), 0) AS rev FROM invoices
      WHERE tenant_id = ? AND status = 'paid' AND date(paid_at) >= ?
    `).get(tid, monthStart) as any).rev;
    const upcoming = db.prepare(`
      SELECT a.scheduled_at, a.type, a.status, p.full_name AS patient_name, u.full_name AS practitioner_name
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      JOIN users u ON u.id = a.practitioner_id
      WHERE a.tenant_id = ? AND a.scheduled_at >= datetime('now') AND a.status NOT IN ('cancelled','no_show','completed')
      ORDER BY a.scheduled_at ASC LIMIT 10
    `).all(tid);
    res.json({
      todays_appointments: todaysAppts,
      patients_total: totalPatients,
      low_stock: lowStock,
      pending_invoices: pendingInvoices,
      expiring_batches: expiringBatches,
      open_lgpd_requests: openRequests,
      monthly_revenue: monthlyRevenue,
      upcoming_appointments: upcoming,
    });
  } catch (e) { next(e); }
});

// Serve frontend build (production)
mountStatic(app);

// 404
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

// Error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  if (err?.type === 'entity.too.large' || err?.status === 413 || /entity too large/i.test(String(err?.message || ''))) {
    res.status(413).json({ error: 'payload_too_large', message: 'Request body too large (max 12MB). Compress the image and retry.' });
    return;
  }
  res.status(500).json({ error: 'server_error', message: err.message });
});

const PORT = parseInt(process.env.PORT || '3001');
app.listen(PORT, () => {
  console.log(`✅ Clínica Tanah backend running on port ${PORT}`);
  console.log(`   LGPD mode: STRICT (art. 37 — audit log enabled)`);
  console.log(`   WhatsApp: ${process.env.META_WA_TOKEN ? 'LIVE (Meta Cloud API)' : 'DRY-RUN (simulator mode)'}`);
  const nvKeys = (process.env.NVIDIA_API_KEYS || process.env.NVIDIA_API_KEY || '')
    .split(/[\n,]+/).map((k) => k.replace(/^Bearer\s+/i, '').trim()).filter((k) => k.startsWith('nvapi-'));
  console.log(`   NVIDIA OCR: ${nvKeys.length ? `${nvKeys.length} key(s) · ${process.env.NVIDIA_OCR_MODEL || 'nemotron-nano-12b-v2-vl'}` : 'NOT CONFIGURED'}`);
  if (imageIntegrationStatus) {
    const active = Object.entries(imageIntegrationStatus.providers)
      .filter(([, status]) => status.configured)
      .map(([name, status]) => `${name}:${status.source}`)
      .join(', ') || 'none';
    console.log(`   Image providers: ${imageIntegrationStatus.order.join(' → ')} · configured ${active}`);
  }
});

export default app;
