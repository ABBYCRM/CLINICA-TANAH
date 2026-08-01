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
import { blindIndex, seal, sealJson, revealPatientRow } from '../services/phiCrypto';
import { fieldsForKind, PRE_TRIAGE_CONSENT_PT } from '../services/intakeTemplates';
import { buildIntakeInviteEmail, mailerConfigured, sendEmail } from '../services/mailer';
import { sendTextMessage } from '../services/whatsapp';

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
      kind: f.kind || 'cadastro',
      urls: formPublicUrls(req, f.slug),
      mailer_configured: mailerConfigured(),
    })),
  });
});

formsRouter.get('/:id/invites', requireRole('admin', 'receptionist', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const form = db.prepare(`SELECT id FROM intake_forms WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId);
  if (!form) { res.status(404).json({ error: 'not_found' }); return; }
  const rows = db.prepare(`
    SELECT * FROM intake_invites WHERE form_id = ? AND tenant_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.params.id, req.tenantId);
  res.json({ invites: rows });
});

/** Email / WhatsApp the public intake link to a prospect or patient. */
formsRouter.post('/:id/send-invite', requireRole('admin', 'receptionist', 'doctor', 'nurse'), async (req: Request, res: Response) => {
  const form = db.prepare(`SELECT * FROM intake_forms WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!form) { res.status(404).json({ error: 'not_found' }); return; }
  if (!form.active) { res.status(409).json({ error: 'form_inactive' }); return; }

  const schema = z.object({
    email: z.string().email().optional().nullable(),
    phone: z.string().min(8).max(20).optional().nullable(),
    full_name: z.string().max(160).optional().nullable(),
    patient_id: z.string().optional().nullable(),
    channel: z.enum(['email', 'whatsapp', 'both']).default('email'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;

  let email = d.email || null;
  let phone = d.phone || null;
  let fullName = d.full_name || null;
  if (d.patient_id) {
    const raw = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`)
      .get(d.patient_id, req.tenantId) as any;
    if (!raw) { res.status(404).json({ error: 'patient_not_found' }); return; }
    const p = revealPatientRow(raw)!;
    fullName = fullName || p.full_name;
    if (!email && p.email) email = p.email;
    if (!phone && p.phone) phone = p.phone;
  }

  if (d.channel === 'email' && !email) {
    res.status(400).json({ error: 'email_required' }); return;
  }
  if (d.channel === 'whatsapp' && !phone) {
    res.status(400).json({ error: 'phone_required' }); return;
  }
  if (d.channel === 'both' && !email && !phone) {
    res.status(400).json({ error: 'email_or_phone_required' }); return;
  }

  const urls = formPublicUrls(req, form.slug);
  const clinic = db.prepare(`SELECT name FROM tenants WHERE id = ?`).get(req.tenantId) as any;
  const inviteId = uuid();
  const mail = buildIntakeInviteEmail({
    clinicName: clinic?.name || 'Clínica Tanah',
    recipientName: fullName,
    formName: form.name,
    link: urls.link,
  });

  let status = 'pending';
  let errorMsg: string | null = null;
  let mailto: string | null = null;
  const results: Record<string, unknown> = {};

  if (d.channel === 'email' || d.channel === 'both') {
    if (email) {
      const sent = await sendEmail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
      results.email = sent;
      mailto = sent.mailto_url || null;
      if (sent.ok) status = 'sent';
      else {
        status = d.channel === 'both' ? 'partial' : 'failed';
        errorMsg = sent.error || 'email_failed';
      }
    }
  }

  if (d.channel === 'whatsapp' || d.channel === 'both') {
    if (phone) {
      try {
        const waBody = `${mail.text.split('\n').slice(0, 6).join('\n')}\n${urls.link}`;
        const wa = await sendTextMessage(phone.replace(/\s+/g, ''), waBody, req.tenantId!);
        results.whatsapp = wa;
        if ((wa as any)?.ok !== false && !(wa as any)?.error) {
          status = status === 'failed' ? 'partial' : 'sent';
        } else {
          status = status === 'sent' ? 'partial' : 'failed';
          errorMsg = errorMsg || (wa as any)?.error || 'whatsapp_failed';
        }
      } catch (e: any) {
        results.whatsapp = { ok: false, error: e.message };
        status = status === 'sent' ? 'partial' : 'failed';
        errorMsg = errorMsg || e.message;
      }
    }
  }

  db.prepare(`
    INSERT INTO intake_invites (
      id, tenant_id, form_id, patient_id, full_name, email, phone, channel, status, link, error, mailto_url, sent_by, sent_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
  `).run(
    inviteId, req.tenantId, form.id, d.patient_id ?? null, fullName, email, phone,
    d.channel, status, urls.link, errorMsg, mailto, req.user!.id,
  );

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'intake_invite_sent', resourceType: 'intake_form', resourceId: form.id,
    afterValue: { invite_id: inviteId, channel: d.channel, status, email: email ? '[set]' : null },
    legalBasis: 'consent_art7_I',
  });

  // mailto fallback still returns 201 so the desk UI can open the compose link
  const httpStatus = status === 'failed' && !mailto ? 502 : 201;
  res.status(httpStatus).json({
    id: inviteId,
    status,
    link: urls.link,
    mailto_url: mailto,
    mailer_configured: mailerConfigured(),
    results,
    error: errorMsg,
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
    SELECT id, tenant_id, name, slug, description, consent_text, policy_version, active, kind
    FROM intake_forms WHERE slug = ? AND active = 1
  `).get(req.params.slug) as any;
  if (!form) { res.status(404).json({ error: 'not_found' }); return; }
  const clinic = db.prepare(`SELECT name, address, phone FROM tenants WHERE id = ?`).get(form.tenant_id) as any;
  const kind = form.kind || (form.slug === 'pre-triagem-paciente' ? 'pre_triage' : 'cadastro');
  res.json({
    form: {
      name: form.name,
      slug: form.slug,
      description: form.description,
      consent_text: form.consent_text || (kind === 'pre_triage' ? PRE_TRIAGE_CONSENT_PT : form.consent_text),
      policy_version: form.policy_version,
      kind,
      fields: fieldsForKind(kind),
      emergency_notice: kind === 'pre_triage',
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
  gender: z.enum(['F', 'M', 'O', 'N']).optional().nullable(),
  // Pré-triagem
  chief_complaint: z.string().max(4000).optional().nullable(),
  symptom_duration: z.string().max(40).optional().nullable(),
  allergies: z.string().max(2000).optional().nullable(),
  current_medications: z.string().max(2000).optional().nullable(),
  chronic_conditions: z.array(z.string()).optional().default([]),
  prior_surgeries: z.string().max(2000).optional().nullable(),
  family_history: z.string().max(2000).optional().nullable(),
  pregnancy_status: z.string().max(40).optional().nullable(),
  smoking: z.string().max(40).optional().nullable(),
  alcohol: z.string().max(40).optional().nullable(),
  red_flags: z.array(z.string()).optional().default([]),
  urgency_self: z.string().max(40).optional().nullable(),
  additional_notes: z.string().max(2000).optional().nullable(),
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
  const kind = form.kind || (form.slug === 'pre-triagem-paciente' ? 'pre_triage' : 'cadastro');
  if (kind === 'pre_triage') {
    if (!d.chief_complaint?.trim()) {
      res.status(400).json({ error: 'validation', message: 'Informe a queixa principal / motivo da consulta.' });
      return;
    }
    if (!d.red_flags?.length) {
      res.status(400).json({ error: 'validation', message: 'Responda aos sinais de alerta (ou marque nenhum).' });
      return;
    }
  }

  const session = db.prepare(`
    SELECT * FROM intake_submissions
    WHERE pixel_token = ? AND form_id = ? AND tenant_id = ? AND status = 'session'
  `).get(d.pixel_token, form.id, form.tenant_id) as any;
  if (!session) {
    res.status(400).json({ error: 'invalid_session', message: 'Sessão/pixel inválido. Recarregue o formulário.' });
    return;
  }
  if (!session.pixel_viewed_at) {
    db.prepare(`UPDATE intake_submissions SET pixel_viewed_at = COALESCE(pixel_viewed_at, datetime('now')) WHERE id = ?`)
      .run(session.id);
  }

  const { ip, ua } = clientMeta(req);
  const phone = d.phone.replace(/\s+/g, '');
  const email = d.email || null;
  const cpf = d.cpf || null;

  const triageNotes = [
    d.notes,
    d.chief_complaint ? `Queixa: ${d.chief_complaint}` : null,
    d.urgency_self ? `Urgência autodeclarada: ${d.urgency_self}` : null,
    d.additional_notes,
  ].filter(Boolean).join('\n') || null;

  const allergyList = (d.allergies || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chronicList = (d.chronic_conditions || []).filter((c) => c && c !== 'none');
  const medsText = d.current_medications?.trim() || null;

  let patientId: string | null = null;
  let status = 'patient_created';
  const existing = db.prepare(`
    SELECT id FROM patients WHERE tenant_id = ? AND phone = ? LIMIT 1
  `).get(form.tenant_id, phone) as any;

  const now = new Date().toISOString();
  const sealedEmail = email ? seal(email) : null;
  const sealedCpf = cpf ? seal(cpf) : null;
  const sealedNotes = triageNotes ? seal(triageNotes) : null;
  const cpfBlind = cpf ? blindIndex(cpf) : null;
  const sealedAllergies = allergyList.length ? seal(JSON.stringify(allergyList)) : null;
  const sealedChronic = chronicList.length ? seal(JSON.stringify(chronicList)) : null;
  const sealedMeds = medsText ? seal(JSON.stringify(medsText.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean))) : null;

  if (existing) {
    patientId = existing.id;
    status = 'linked_existing';
    db.prepare(`
      UPDATE patients SET
        lgpd_consent_at = COALESCE(lgpd_consent_at, ?),
        lgpd_consent_ip = COALESCE(lgpd_consent_ip, ?),
        lgpd_consent_version = ?,
        email = COALESCE(email, ?),
        gender = COALESCE(gender, ?),
        notes = COALESCE(?, notes),
        allergies = COALESCE(?, allergies),
        chronic_conditions = COALESCE(?, chronic_conditions),
        medications_in_use = COALESCE(?, medications_in_use),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      now, ip, form.policy_version, sealedEmail, d.gender || null,
      sealedNotes, sealedAllergies, sealedChronic, sealedMeds, patientId,
    );
  } else {
    patientId = uuid();
    try {
      db.prepare(`
        INSERT INTO patients (
          id, tenant_id, full_name, birth_date, cpf, cpf_blind, gender, phone, email,
          address_city, address_state, notes, allergies, chronic_conditions, medications_in_use,
          referral_source, lgpd_consent_at, lgpd_consent_ip, lgpd_consent_version,
          lifecycle_stage, preferred_language, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'prospect', 'pt-BR', datetime('now'), datetime('now'))
      `).run(
        patientId, form.tenant_id, d.full_name.trim(), d.birth_date, sealedCpf, cpfBlind,
        d.gender || null, phone, sealedEmail,
        d.city || null, d.state || null, sealedNotes, sealedAllergies, sealedChronic, sealedMeds,
        kind === 'pre_triage' ? 'pre_triage_intake' : 'intake_form',
        now, ip, form.policy_version,
      );
    } catch (e: any) {
      res.status(409).json({ error: 'patient_create_failed', message: e.message });
      return;
    }
  }

  // Structured clinical allergies + anamnesis when pré-triagem
  if (kind === 'pre_triage' && patientId) {
    try {
      for (const substance of allergyList.slice(0, 20)) {
        const dup = db.prepare(`
          SELECT id FROM clinical_allergies
          WHERE tenant_id = ? AND patient_id = ? AND lower(substance) = lower(?) AND status = 'active'
        `).get(form.tenant_id, patientId, substance) as any;
        if (dup) continue;
        db.prepare(`
          INSERT INTO clinical_allergies (
            id, tenant_id, patient_id, recorded_by, substance, reaction, severity, status, notes
          ) VALUES (?,?,?,?,?,?, 'moderate', 'active', 'Pré-triagem (auto-relato)')
        `).run(uuid(), form.tenant_id, patientId, patientId, substance, null);
      }
    } catch { /* table may not exist on old DBs mid-migrate */ }

    try {
      const stamp = { signer_name: d.full_name.trim(), signer_council: null, signer_council_state: null, signed_at: now.slice(0, 19).replace('T', ' ') };
      db.prepare(`
        INSERT INTO clinical_anamnesis (
          id, tenant_id, patient_id, author_id, recorded_at,
          chief_complaint, hpi, past_history, family_history, social_history,
          current_medications, status, signer_name, signer_council, signer_council_state, signed_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?)
      `).run(
        uuid(), form.tenant_id, patientId, patientId, stamp.signed_at,
        d.chief_complaint || null,
        [
          d.symptom_duration ? `Duração: ${d.symptom_duration}` : null,
          d.urgency_self ? `Urgência autodeclarada: ${d.urgency_self}` : null,
          (d.red_flags || []).length ? `Sinais de alerta: ${(d.red_flags || []).join(', ')}` : null,
        ].filter(Boolean).join('\n') || null,
        [
          chronicList.length ? `Comorbidades: ${chronicList.join(', ')}` : null,
          d.prior_surgeries ? `Cirurgias: ${d.prior_surgeries}` : null,
        ].filter(Boolean).join('\n') || null,
        d.family_history || null,
        [
          d.smoking ? `Tabagismo: ${d.smoking}` : null,
          d.alcohol ? `Álcool: ${d.alcohol}` : null,
          d.pregnancy_status ? `Gestação/amamentação: ${d.pregnancy_status}` : null,
        ].filter(Boolean).join('\n') || null,
        medsText,
        stamp.signer_name, null, null, stamp.signed_at,
      );
    } catch { /* optional */ }

    try {
      for (const title of chronicList.slice(0, 15)) {
        const dup = db.prepare(`
          SELECT id FROM clinical_problems
          WHERE tenant_id = ? AND patient_id = ? AND lower(title) = lower(?) AND status = 'active'
        `).get(form.tenant_id, patientId, title) as any;
        if (dup) continue;
        db.prepare(`
          INSERT INTO clinical_problems (id, tenant_id, patient_id, recorded_by, title, status, notes)
          VALUES (?,?,?,?,?,'active','Pré-triagem (auto-relato)')
        `).run(uuid(), form.tenant_id, patientId, patientId, title);
      }
    } catch { /* optional */ }
  }

  const evidenceObj = {
    source: kind === 'pre_triage' ? 'public_pre_triage_form' : 'public_intake_form',
    form_id: form.id,
    form_slug: form.slug,
    form_kind: kind,
    submission_id: session.id,
    pixel_viewed_at: session.pixel_viewed_at || now,
    self_attested: true,
    consent_whatsapp: d.consent_whatsapp,
    consent_marketing: d.consent_marketing,
    consent_calls: d.consent_calls,
    triage: kind === 'pre_triage' ? {
      chief_complaint: d.chief_complaint,
      symptom_duration: d.symptom_duration,
      allergies: allergyList,
      current_medications: medsText,
      chronic_conditions: chronicList,
      prior_surgeries: d.prior_surgeries,
      family_history: d.family_history,
      pregnancy_status: d.pregnancy_status,
      smoking: d.smoking,
      alcohol: d.alcohol,
      red_flags: d.red_flags,
      urgency_self: d.urgency_self,
      gender: d.gender,
    } : null,
    compliance: 'LGPD_art7_I_TCPA_BR_equivalent',
    disclaimer: 'pre_triage_not_emergency_triage',
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
    afterValue: { form_id: form.id, submission_id: session.id, status, kind },
    ipAddress: ip || undefined,
    userAgent: ua || undefined,
    legalBasis: 'consent_art7_I',
  });

  const urgent = (d.red_flags || []).some((f) => f !== 'none') || d.urgency_self === 'urgent';
  res.status(201).json({
    ok: true,
    status,
    submission_id: session.id,
    message: urgent
      ? 'Cadastro recebido. Se você marcou sinais de alerta, procure atendimento de urgência (SAMU 192) se ainda sintomático.'
      : 'Cadastro recebido. Obrigado!',
    urgent_hint: urgent,
  });
});

export default formsRouter;
