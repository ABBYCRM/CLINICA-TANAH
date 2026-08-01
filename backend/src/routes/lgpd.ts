import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { encryptionStatus } from '../services/phiCrypto';

const router = Router();
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

// Staff registers a data-subject request on behalf of the subject
// (e.g. patient calls the reception asking for deletion — LGPD art. 18)
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
  const existing = db.prepare(`SELECT id FROM lgpd_data_requests WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!existing) { res.status(404).json({ error: 'not_found' }); return; }
  db.prepare(`UPDATE lgpd_data_requests SET status = 'fulfilled', fulfilled_at = datetime('now'), handled_by = ?, response_notes = ? WHERE id = ? AND tenant_id = ?`)
    .run(req.user!.id, req.body.notes ?? null, req.params.id, req.tenantId);
  logAudit({ tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'lgpd_request_fulfilled',
             resourceType: 'lgpd_data_request', resourceId: req.params.id, legalBasis: 'legal_obligation_art7_II' });
  res.json({ ok: true });
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

router.get('/policy', (_req, res) => {
  res.json({
    version: '1.1',
    effective_date: '2026-07-31',
    dpo: { name: 'Dr. Marcos Vieira', email: 'dpo@clinica-tanah.com.br', phone: '+55 11 3000-0001' },
    legal_bases: [
      { code: 'art7_I', name: 'Consentimento', description: 'Para tratamentos com base no consentimento explícito do titular.' },
      { code: 'art7_V', name: 'Execução de contrato', description: 'Para cumprimento do contrato de prestação de serviços médicos.' },
      { code: 'art7_II', name: 'Cumprimento de obrigação legal', description: 'CFM 2.314, ANVISA, SUS, obrigações fiscais e trabalhistas.' },
      { code: 'art7_VIII', name: 'Tutela da saúde', description: 'Tratamento de dados de saúde para assistência médica.' },
    ],
    technical_measures_art46: {
      encryption_in_transit: 'TLS terminado na borda (HTTPS obrigatório em produção)',
      encryption_at_rest: 'AES-256-GCM em campos de PHI (CPF, prontuário SOAP, alergias, receitas, e-mail, notas)',
      access_control: 'RBAC por papel clínico + isolamento multi-tenant + JWT',
      audit_trail: 'Registro de acesso a PHI com base legal (LGPD art. 37 / CFM)',
      consent_proof: 'Pixel + IP/UA + autoatestação em formulários públicos',
      retention: 'Prontuário: 20 anos (CFM 1.821/2007) — exclusão física bloqueada',
      note: 'Medidas técnicas alinhadas à LGPD art. 46 e boas práticas ANPD. Não constitui certificação SBIS/CFM.',
    },
    data_categories: [
      { name: 'Dados de identificação', examples: ['nome','CPF','RG'], retention: '20 anos (CFM)', encrypted_at_rest: true },
      { name: 'Dados de saúde', examples: ['prontuário','exames','prescrições'], retention: '20 anos (CFM 1.821/2007)', encrypted_at_rest: true },
      { name: 'Dados financeiros', examples: ['faturas','pagamentos'], retention: '5 anos (CTN)' },
      { name: 'Dados de comunicação', examples: ['WhatsApp','e-mail'], retention: '2 anos após último contato' },
    ],
    rights: [
      { code: 'art18_I', name: 'Confirmação da existência de tratamento' },
      { code: 'art18_II', name: 'Acesso aos dados' },
      { code: 'art18_III', name: 'Correção de dados incompletos ou incorretos' },
      { code: 'art18_IV', name: 'Anonimização, bloqueio ou eliminação' },
      { code: 'art18_V', name: 'Portabilidade' },
      { code: 'art18_VI', name: 'Eliminação dos dados tratados com consentimento' },
      { code: 'art18_VII', name: 'Informação sobre entidades públicas e privadas com as quais houve compartilhamento' },
      { code: 'art18_IX', name: 'Revogação do consentimento' },
    ],
  });
});

router.get('/security-posture', requireRole('admin', 'dpo'), (_req, res) => {
  res.json({
    framework: 'LGPD + CFM electronic record controls (HIPAA-analogous safeguards for Brazil)',
    encryption: encryptionStatus(),
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
      clinical_hard_delete_blocked: true,
      cfm_years: 20,
    },
  });
});

export default router;
