/**
 * Intake Forms — admin CRUD + public submit with Brazilian LGPD/TCPA-style consent proof.
 * Public routes are unauthenticated; proof = pixel hit + IP/UA + self-attestation + timestamps.
 */
import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit, recordConsent } from '../services/audit';
import { blindIndex, seal, sealJson } from '../services/phiCrypto';

const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

function clientMeta(req: Request) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
  const ua = (req.headers['user-agent'] as string) || null;
  return { ip, ua };
}

function publicBase(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function formPublicUrls(req: Request, slug: string, pixelToken?: string) {
  const base = publicBase(req);
  return {
    link: `${base}/f/${slug}`,
    embed: `<iframe src="${base}/f/${slug}" title="Cadastro Clínica Tanah" width="100%" height="720" style="border:0;border-radius:12px;max-width:640px" loading="lazy"></iframe>`,
    pixel: pixelToken ? `${base}/api/public/forms/pixel.gif?t=${encodeURIComponent(pixelToken)}` : null,
  };
}

// ─── Admin (authenticated) — mount at /api/forms ───────────────────
export const formsRouter = Router();
formsRouter.use(authenticate);

formsRouter.get('/', requireRole('admin', 'receptionist', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const forms = db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM intake_submissions s WHERE s.form_id = f.id AND s.status != 'session') AS submission_count
    FROM intake_forms f
    WHERE f.tenant_id = ?
    ORDER BY f.created_at DESC
  `).all(req.tenantId);
  res.json({
    forms: forms.map((f: any) => ({
      ...f,
      active: !!f.active,
      urls: formPublicUrls(req, f.slug),
    })),
  });
});

formsRouter.get('/:id/submissions', requireRole('admin', 'receptionist', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const form = db.prepare(`SELECT * FROM intake_forms WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId);
  if (!form) { res.status(404).json({ error: 'not_found' }); return; }
  const rows = db.prepare(`
    SELECT id, full_name, phone, email, cpf, status, patient_id,
           consent_lgpd, consent_whatsapp, consent_marketing, consent_calls, self_attested,
           ip_address, pixel_viewed_at, pixel_submitted_at, created_at
    FROM intake_submissions
    WHERE form_id = ? AND tenant_id = ? AND status != 'session'
    ORDER BY created_at DESC LIMIT 100
  `).all(req.params.id, req.tenantId);
  res.json({ submissions: rows });
});

formsRouter.post('/', requireRole('admin'), (req: Request, res: Response) => {
  const schema = z.object({
    name: z.string().min(1).max(120),
    slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
    description: z.string().max(500).optional().nullable(),
    consent_text: z.string().min(20).optional(),
    policy_version: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  const consent = d.consent_text || (
    'Declaro que sou a pessoa identificada neste formulário e autorizo o tratamento dos meus dados conforme a LGPD, podendo revogar a qualquer momento.'
  );
  try {
    db.prepare(`
      INSERT INTO intake_forms (id, tenant_id, name, slug, description, consent_text, policy_version)
      VALUES (?,?,?,?,?,?,?)
    `).run(id, req.tenantId, d.name, d.slug, d.description ?? null, consent, d.policy_version || '1.0');
  } catch (e: any) {
    res.status(409).json({ error: 'duplicate_slug', message: e.message });
    return;
  }
  logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'intake_form_created', resourceType: 'intake_form', resourceId: id,
    legalBasis: 'consent_art7_I',
  });
  res.status(201).json({ id, urls: formPublicUrls(req, d.slug) });
});

formsRouter.patch('/:id', requireRole('admin'), (req: Request, res: Response) => {
  const form = db.prepare(`SELECT * FROM intake_forms WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!form) { res.status(404).json({ error: 'not_found' }); return; }
  const active = req.body?.active;
  if (typeof active === 'boolean') {
    db.prepare(`UPDATE intake_forms SET active = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(active ? 1 : 0, form.id);
  }
  res.json({ ok: true });
});

// ─── Public (no auth) — mount at /api/public/forms ──────────────────
export const publicFormsRouter = Router();

/** 1×1 tracking pixel — must be registered before /:slug */
publicFormsRouter.get('/pixel.gif', (req: Request, res: Response) => {
  const token = String(req.query.t || '');
  if (token) {
    const row = db.prepare(`SELECT id, pixel_viewed_at FROM intake_submissions WHERE pixel_token = ?`).get(token) as any;
    if (row && !row.pixel_viewed_at) {
      const { ip, ua } = clientMeta(req);
      db.prepare(`
        UPDATE intake_submissions
        SET pixel_viewed_at = datetime('now'),
            ip_address = COALESCE(ip_address, ?),
            user_agent = COALESCE(user_agent, ?)
        WHERE id = ?
      `).run(ip, ua, row.id);
    }
  }
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.status(200).send(PIXEL_GIF);
});

publicFormsRouter.get('/:slug', (req: Request, res: Response) => {
  const form = db.prepare(`
    SELECT id, tenant_id, name, slug, description, consent_text, policy_version, active
    FROM intake_forms WHERE slug = ? AND active = 1
  `).get(req.params.slug) as any;
  if (!form) { res.status(404).json({ error: 'not_found' }); return; }
  const clinic = db.prepare(`SELECT name, address, phone FROM tenants WHERE id = ?`).get(form.tenant_id) as any;
  res.json({
    form: {
      name: form.name,
      slug: form.slug,
      description: form.description,
      consent_text: form.consent_text,
      policy_version: form.policy_version,
    },
    clinic: {
      name: clinic?.name || 'Clínica Tanah',
      address: clinic?.address || null,
      phone: clinic?.phone || null,
    },
  });
});

/** Start a proof session — issues pixel token before the patient fills the form. */
publicFormsRouter.post('/:slug/session', (req: Request, res: Response) => {
  const form = db.prepare(`
    SELECT id, tenant_id, slug FROM intake_forms WHERE slug = ? AND active = 1
  `).get(req.params.slug) as any;
  if (!form) { res.status(404).json({ error: 'not_found' }); return; }
  const { ip, ua } = clientMeta(req);
  const id = uuid();
  const pixelToken = uuid().replace(/-/g, '');
  db.prepare(`
    INSERT INTO intake_submissions
      (id, tenant_id, form_id, full_name, phone, pixel_token, ip_address, user_agent, status)
    VALUES (?,?,?,'','',?,?,?,'session')
  `).run(id, form.tenant_id, form.id, pixelToken, ip, ua);
  const urls = formPublicUrls(req, form.slug, pixelToken);
  res.status(201).json({
    submission_id: id,
    pixel_token: pixelToken,
    pixel_url: urls.pixel,
  });
});

const submitSchema = z.object({
  pixel_token: z.string().min(8),
  full_name: z.string().min(2).max(160),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phone: z.string().min(8).max(20),
  email: z.string().email().optional().nullable().or(z.literal('')),
  cpf: z.string().regex(/^\d{11}$/).optional().nullable().or(z.literal('')),
  city: z.string().max(80).optional().nullable(),
  state: z.string().max(2).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  consent_lgpd: z.literal(true),
  consent_whatsapp: z.boolean().default(false),
  consent_marketing: z.boolean().default(false),
  consent_calls: z.boolean().default(false),
  self_attested: z.literal(true),
});

publicFormsRouter.post('/:slug/submit', (req: Request, res: Response) => {
  const form = db.prepare(`
    SELECT * FROM intake_forms WHERE slug = ? AND active = 1
  `).get(req.params.slug) as any;
  if (!form) { res.status(404).json({ error: 'not_found' }); return; }

  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const session = db.prepare(`
    SELECT * FROM intake_submissions
    WHERE pixel_token = ? AND form_id = ? AND tenant_id = ? AND status = 'session'
  `).get(d.pixel_token, form.id, form.tenant_id) as any;
  if (!session) {
    res.status(400).json({ error: 'invalid_session', message: 'Sessão/pixel inválido. Recarregue o formulário.' });
    return;
  }
  if (!session.pixel_viewed_at) {
    // Soft requirement: still accept but stamp view (privacy blockers may block GIF)
    db.prepare(`UPDATE intake_submissions SET pixel_viewed_at = COALESCE(pixel_viewed_at, datetime('now')) WHERE id = ?`)
      .run(session.id);
  }

  const { ip, ua } = clientMeta(req);
  const phone = d.phone.replace(/\s+/g, '');
  const email = d.email || null;
  const cpf = d.cpf || null;

  let patientId: string | null = null;
  let status = 'patient_created';
  const existing = db.prepare(`
    SELECT id FROM patients WHERE tenant_id = ? AND phone = ? LIMIT 1
  `).get(form.tenant_id, phone) as any;

  const now = new Date().toISOString();
  const sealedEmail = email ? seal(email) : null;
  const sealedCpf = cpf ? seal(cpf) : null;
  const sealedNotes = d.notes ? seal(d.notes) : null;
  const cpfBlind = cpf ? blindIndex(cpf) : null;

  if (existing) {
    patientId = existing.id;
    status = 'linked_existing';
    db.prepare(`
      UPDATE patients SET
        lgpd_consent_at = COALESCE(lgpd_consent_at, ?),
        lgpd_consent_ip = COALESCE(lgpd_consent_ip, ?),
        lgpd_consent_version = ?,
        email = COALESCE(email, ?),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(now, ip, form.policy_version, sealedEmail, patientId);
  } else {
    patientId = uuid();
    try {
      db.prepare(`
        INSERT INTO patients (
          id, tenant_id, full_name, birth_date, cpf, cpf_blind, phone, email,
          address_city, address_state, notes, referral_source,
          lgpd_consent_at, lgpd_consent_ip, lgpd_consent_version,
          lifecycle_stage, preferred_language, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'prospect', 'pt-BR', datetime('now'), datetime('now'))
      `).run(
        patientId, form.tenant_id, d.full_name.trim(), d.birth_date, sealedCpf, cpfBlind, phone, sealedEmail,
        d.city || null, d.state || null, sealedNotes, 'intake_form',
        now, ip, form.policy_version,
      );
    } catch (e: any) {
      res.status(409).json({ error: 'patient_create_failed', message: e.message });
      return;
    }
  }

  const evidenceObj = {
    source: 'public_intake_form',
    form_id: form.id,
    form_slug: form.slug,
    submission_id: session.id,
    pixel_viewed_at: session.pixel_viewed_at || now,
    self_attested: true,
    consent_whatsapp: d.consent_whatsapp,
    consent_marketing: d.consent_marketing,
    consent_calls: d.consent_calls,
    compliance: 'LGPD_art7_I_TCPA_BR_equivalent',
  };
  const evidence = JSON.stringify(evidenceObj);
  const sealedPayload = sealJson(evidenceObj);

  const consents: string[] = ['health_data_processing', 'data_processing'];
  if (d.consent_whatsapp) consents.push('whatsapp_communication', 'whatsapp_admin', 'appointment_reminders');
  if (d.consent_marketing) consents.push('marketing_news', 'promotions_events');
  if (d.consent_calls) consents.push('phone_calls', 'post_visit_survey');

  for (const ctype of consents) {
    recordConsent({
      subjectType: 'patient',
      subjectId: patientId!,
      consentType: ctype,
      granted: true,
      policyVersion: form.policy_version,
      ipAddress: ip || undefined,
      userAgent: ua || undefined,
      evidence,
      tenantId: form.tenant_id,
    });
  }

  db.prepare(`
    UPDATE intake_submissions SET
      patient_id = ?, full_name = ?, birth_date = ?, phone = ?, email = ?, cpf = ?,
      city = ?, state = ?, notes = ?,
      consent_lgpd = 1, consent_whatsapp = ?, consent_marketing = ?, consent_calls = ?,
      self_attested = 1, payload = ?, status = ?,
      pixel_submitted_at = datetime('now'),
      ip_address = COALESCE(?, ip_address),
      user_agent = COALESCE(?, user_agent)
    WHERE id = ?
  `).run(
    patientId, d.full_name.trim(), d.birth_date, phone, sealedEmail, sealedCpf,
    d.city || null, d.state || null, sealedNotes,
    d.consent_whatsapp ? 1 : 0, d.consent_marketing ? 1 : 0, d.consent_calls ? 1 : 0,
    sealedPayload, status, ip, ua, session.id,
  );

  logAudit({
    tenantId: form.tenant_id,
    action: 'intake_form_submitted',
    resourceType: 'patient',
    resourceId: patientId!,
    afterValue: { form_id: form.id, submission_id: session.id, status },
    ipAddress: ip || undefined,
    userAgent: ua || undefined,
    legalBasis: 'consent_art7_I',
  });

  res.status(201).json({
    ok: true,
    status,
    submission_id: session.id,
    message: 'Cadastro recebido. Obrigado!',
  });
});

export default formsRouter;
