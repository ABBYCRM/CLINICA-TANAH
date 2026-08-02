import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { encryptionStatus } from '../services/phiCrypto';
import { buildLgpdPolicy } from '../services/lgpdPolicy';
import { fulfillDataRequest } from '../services/lgpdFulfillment';

const router = Router();

/** Authenticated staff policy (same document as public). */
router.get('/policy', authenticate, (_req, res) => {
  res.json(buildLgpdPolicy());
});

router.use(authenticate);

router.get('/consents', requireRole('admin','dpo'), (req: Request, res: Response) => {
  const subjectType = req.query.subject_type as string | undefined;
  let sql = `SELECT * FROM lgpd_consents WHERE tenant_id = ?`;
  const args: any[] = [req.tenantId];
  if (subjectType) { sql += ` AND subject_type = ?`; args.push(subjectType); }
  sql += ` ORDER BY granted_at DESC LIMIT 500`;
  res.json({ consents: db.prepare(sql).all(...args) });
});

router.get('/data-requests', requireRole('admin','dpo','receptionist'), (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  let sql = `
    SELECT r.*,
           CASE r.subject_type
             WHEN 'patient' THEN (SELECT full_name FROM patients WHERE id = r.subject_id AND tenant_id = r.tenant_id)
             WHEN 'employee' THEN (SELECT full_name FROM employees WHERE id = r.subject_id AND tenant_id = r.tenant_id)
             WHEN 'vendor' THEN (SELECT legal_name FROM vendors WHERE id = r.subject_id AND tenant_id = r.tenant_id)
           END AS subject_name
    FROM lgpd_data_requests r
    WHERE r.tenant_id = ?
  `;
  const args: any[] = [req.tenantId];
  if (status) { sql += ` AND r.status = ?`; args.push(status); }
  sql += ` ORDER BY r.requested_at DESC LIMIT 200`;
  res.json({ requests: db.prepare(sql).all(...args) });
});

router.post('/data-requests', requireRole('admin','dpo','receptionist'), (req: Request, res: Response) => {
  const { request_type, subject_type, subject_id, notes } = req.body ?? {};
  const types = ['access','rectification','deletion','portability','opposition'];
  const subjectTypes = ['patient','employee','vendor'];
  if (!types.includes(request_type) || !subjectTypes.includes(subject_type) || !subject_id) {
    res.status(400).json({ error: 'validation', allowed_types: types, allowed_subject_types: subjectTypes });
    return;
  }
  const id = uuid();
  db.prepare(`
    INSERT INTO lgpd_data_requests (id, tenant_id, request_type, subject_type, subject_id, status)
    VALUES (?, ?, ?, ?, ?, 'open')
  `).run(id, req.tenantId, request_type, subject_type, subject_id);
  if (notes) {
    db.prepare(`UPDATE lgpd_data_requests SET response_notes = ? WHERE id = ? AND tenant_id = ?`).run(notes, id, req.tenantId);
  }
  logAudit({ tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'lgpd_request_registered',
             resourceType: 'lgpd_data_request', resourceId: id,
             afterValue: { request_type, subject_type, subject_id }, legalBasis: 'legal_obligation_art7_II' });
  res.status(201).json({ id });
});

router.put('/data-requests/:id/fulfill', requireRole('admin','dpo'), (req: Request, res: Response) => {
  try {
    const result = fulfillDataRequest({
      tenantId: req.tenantId!,
      requestId: req.params.id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      notes: req.body?.notes ?? null,
    });
    res.json(result);
  } catch (e: any) {
    if (e?.code === 'not_found' || e?.message === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(500).json({ error: 'fulfill_failed', message: e?.message || 'failed' });
  }
});

router.get('/audit', requireRole('admin','dpo'), (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string || '100'), 500);
  const resourceType = req.query.resource_type as string | undefined;
  let sql = `SELECT * FROM audit_log WHERE tenant_id = ?`;
  const args: any[] = [req.tenantId];
  if (resourceType) { sql += ` AND resource_type = ?`; args.push(resourceType); }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  args.push(limit);
  res.json({ entries: db.prepare(sql).all(...args) });
});

router.get('/security-posture', requireRole('admin', 'dpo'), (_req, res) => {
  const enc = encryptionStatus();
  res.json({
    framework: 'LGPD + CFM electronic record controls (HIPAA-analogous safeguards for Brazil)',
    encryption: enc,
    production_key_ok: enc.key_source !== 'dev_default',
    transport: {
      https_required_in_production: true,
      hsts: process.env.NODE_ENV === 'production',
      security_headers: true,
    },
    access_control: {
      jwt: true,
      rbac: true,
      tenant_isolation: true,
      clinical_field_redaction: true,
    },
    audit: {
      phi_access_logged: true,
      audit_phi_redacted: true,
      consent_ledger: true,
    },
    retention: {
      encounters_prescriptions_soft_cancel: true,
      appointments_cancel_not_hard_delete: true,
      body_medications_discontinue_not_hard_delete: true,
      patient_delete_blocked_with_clinical: true,
      /** Alias used by e2e / security posture clients */
      clinical_hard_delete_blocked: true,
      lgpd_deletion_anonymizes_identity: true,
      cfm_years: 20,
    },
    dpo: buildLgpdPolicy().dpo,
  });
});

export default router;
