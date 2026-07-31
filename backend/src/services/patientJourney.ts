/**
 * Patient journey automations — HubSpot-style clinic CRM.
 * Event-driven, idempotent side effects after appointment completion.
 */
import { db } from '../db/schema';
import { hasActiveConsent, logAudit, recordConsent } from './audit';
import { getOrCreateConversation, sendTextMessage, updateConversation } from './whatsapp';

type Locale = 'pt-BR' | 'en' | 'es';

const CLINICAL_ROLES = new Set(['admin', 'doctor', 'nurse']);

export function canViewClinical(role?: string | null): boolean {
  return !!role && CLINICAL_ROLES.has(role);
}

export const LIFECYCLE_STAGES = [
  'prospect',
  'new_patient',
  'active',
  'in_treatment',
  'follow_up_required',
  'recall_due',
  'inactive',
  'do_not_contact',
  'archived',
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** Granular LGPD consent purposes (Art. 11 — specific, prominent). */
export const CONSENT_PURPOSES = [
  'whatsapp_admin',
  'appointment_reminders',
  'post_visit_survey',
  'marketing_news',
  'promotions_events',
  'email_communication',
  'sms_communication',
  'health_data_processing',
  'data_processing',
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export function appendTimelineEvent(args: {
  tenantId: string;
  patientId: string;
  kind: string;
  title: string;
  subtitle?: string | null;
  status?: string | null;
  meta?: Record<string, unknown> | null;
  occurredAt?: string;
}): string {
  const id = `pte_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO patient_timeline_events
      (id, tenant_id, patient_id, kind, title, subtitle, status, meta, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    args.tenantId,
    args.patientId,
    args.kind,
    args.title,
    args.subtitle ?? null,
    args.status ?? null,
    args.meta ? JSON.stringify(args.meta) : null,
    args.occurredAt ?? new Date().toISOString(),
  );
  return id;
}

function firstName(fullName: string): string {
  return String(fullName || '').trim().split(/\s+/)[0] || fullName;
}

function clinicName(tenantId: string): string {
  const t = db.prepare(`SELECT name FROM tenants WHERE id = ?`).get(tenantId) as any;
  return t?.name || 'Clínica Tanah';
}

function patientAllows(patientId: string, purpose: ConsentPurpose, fallbackTypes: string[] = []): boolean {
  if (hasActiveConsent('patient', patientId, purpose)) return true;
  for (const t of fallbackTypes) {
    if (hasActiveConsent('patient', patientId, t)) return true;
  }
  return false;
}

function isDoNotContact(patient: any): boolean {
  return !!patient.do_not_contact || patient.lifecycle_stage === 'do_not_contact';
}

/** Idempotent: first completed visit → welcome WhatsApp (once). */
export async function maybeSendWelcomeMessage(args: {
  tenantId: string;
  patientId: string;
  locale?: Locale;
}): Promise<{ sent: boolean; reason?: string }> {
  const p = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(args.patientId, args.tenantId) as any;
  if (!p) return { sent: false, reason: 'not_found' };
  if (p.welcome_message_sent_at) return { sent: false, reason: 'already_sent' };
  if (!p.phone) return { sent: false, reason: 'no_phone' };
  if (isDoNotContact(p)) return { sent: false, reason: 'do_not_contact' };
  if (!patientAllows(p.id, 'whatsapp_admin', ['whatsapp_communication'])) {
    return { sent: false, reason: 'no_consent' };
  }

  const conv = getOrCreateConversation(p.phone, args.tenantId);
  if (conv.opted_out) return { sent: false, reason: 'opted_out' };

  const name = firstName(p.full_name);
  const clinic = clinicName(args.tenantId);
  const body =
    `Olá, ${name}! Agradecemos por escolher a ${clinic}. 💙\n\n` +
    `Este é o nosso canal oficial para confirmações, lembretes e atendimento administrativo.\n\n` +
    `Para falar com nossa equipe, responda ATENDENTE.\n` +
    `Para gerenciar suas preferências de comunicação, responda PREFERÊNCIAS.`;

  const result = await sendTextMessage(p.phone, body, args.tenantId);
  if (!result.ok) return { sent: false, reason: 'send_failed' };

  db.prepare(`
    UPDATE patients SET welcome_message_sent_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).run(p.id, args.tenantId);

  appendTimelineEvent({
    tenantId: args.tenantId,
    patientId: p.id,
    kind: 'welcome',
    title: 'welcome_delivered',
    subtitle: body.slice(0, 120),
    status: 'delivered',
  });

  return { sent: true };
}

/** Idempotent: post-visit satisfaction survey for this appointment. */
export async function maybeSendPostVisitSurvey(args: {
  tenantId: string;
  patientId: string;
  appointmentId: string;
  locale?: Locale;
}): Promise<{ sent: boolean; reason?: string }> {
  const p = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(args.patientId, args.tenantId) as any;
  if (!p) return { sent: false, reason: 'not_found' };
  if (!p.phone) return { sent: false, reason: 'no_phone' };
  if (isDoNotContact(p) || p.open_complaint) return { sent: false, reason: 'blocked' };
  if (!patientAllows(p.id, 'post_visit_survey', ['whatsapp_communication', 'marketing'])) {
    return { sent: false, reason: 'no_consent' };
  }

  const existing = db.prepare(`
    SELECT id FROM satisfaction_surveys WHERE appointment_id = ? AND tenant_id = ?
  `).get(args.appointmentId, args.tenantId);
  if (existing) return { sent: false, reason: 'already_surveyed' };

  const alreadyQueued = db.prepare(`
    SELECT 1 FROM patient_timeline_events
    WHERE patient_id = ? AND tenant_id = ? AND kind = 'survey_sent'
      AND meta LIKE ?
    LIMIT 1
  `).get(args.patientId, args.tenantId, `%"appointment_id":"${args.appointmentId}"%`);
  if (alreadyQueued) return { sent: false, reason: 'already_sent' };

  const conv = getOrCreateConversation(p.phone, args.tenantId);
  if (conv.opted_out) return { sent: false, reason: 'opted_out' };
  if (conv.state !== 'idle' && conv.state !== 'lgpd_optout' && conv.state !== 'awaiting_nps_score') {
    // Don't interrupt active booking flows — still mark intent via timeline only if idle-ish
    if (!['idle', 'awaiting_nps_score'].includes(conv.state)) {
      return { sent: false, reason: 'busy_conversation' };
    }
  }

  updateConversation(p.phone, args.tenantId, {
    state: 'awaiting_nps_score',
    patient_id: p.id,
    context: { patient_id: p.id, appointment_id: args.appointmentId, survey: true },
  });

  const name = firstName(p.full_name);
  const clinic = clinicName(args.tenantId);
  const body =
    `Olá, ${name}. Como foi sua experiência com a ${clinic} hoje?\n\n` +
    `Responda com uma nota de 0 a 10, onde 0 significa “muito insatisfeito” e 10 significa “muito satisfeito”.`;

  const result = await sendTextMessage(p.phone, body, args.tenantId);
  if (!result.ok) return { sent: false, reason: 'send_failed' };

  appendTimelineEvent({
    tenantId: args.tenantId,
    patientId: p.id,
    kind: 'survey_sent',
    title: 'survey_sent',
    subtitle: body.slice(0, 120),
    status: 'sent',
    meta: { appointment_id: args.appointmentId },
  });

  return { sent: true };
}

/**
 * Side effects when appointment → completed.
 * Idempotent welcome (first visit only) + survey enqueue.
 */
export async function onAppointmentCompleted(args: {
  tenantId: string;
  appointmentId: string;
  actorId?: string;
  actorEmail?: string;
}): Promise<{ welcome?: { sent: boolean; reason?: string }; survey?: { sent: boolean; reason?: string } }> {
  const appt = db.prepare(`
    SELECT a.*, p.full_name AS patient_name
    FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.id = ? AND a.tenant_id = ?
  `).get(args.appointmentId, args.tenantId) as any;
  if (!appt || appt.status !== 'completed') return {};

  const completedCount = (db.prepare(`
    SELECT COUNT(*) AS c FROM appointments
    WHERE patient_id = ? AND tenant_id = ? AND status = 'completed'
  `).get(appt.patient_id, args.tenantId) as any).c as number;

  const isFirstCompleted = completedCount <= 1;

  db.prepare(`
    UPDATE patients SET
      last_visit_at = COALESCE(?, last_visit_at, datetime('now')),
      first_completed_visit_at = COALESCE(first_completed_visit_at, datetime('now')),
      lifecycle_stage = CASE
        WHEN lifecycle_stage IN ('do_not_contact', 'archived') THEN lifecycle_stage
        WHEN lifecycle_stage IN ('prospect', 'new_patient') THEN 'active'
        ELSE lifecycle_stage
      END,
      updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).run(appt.scheduled_at, appt.patient_id, args.tenantId);

  appendTimelineEvent({
    tenantId: args.tenantId,
    patientId: appt.patient_id,
    kind: 'appointment',
    title: 'appointment_completed',
    subtitle: appt.patient_name,
    status: 'completed',
    meta: { appointment_id: appt.id, type: appt.type },
    occurredAt: new Date().toISOString(),
  });

  const out: { welcome?: { sent: boolean; reason?: string }; survey?: { sent: boolean; reason?: string } } = {};

  if (isFirstCompleted) {
    out.welcome = await maybeSendWelcomeMessage({
      tenantId: args.tenantId,
      patientId: appt.patient_id,
    });
  }

  out.survey = await maybeSendPostVisitSurvey({
    tenantId: args.tenantId,
    patientId: appt.patient_id,
    appointmentId: appt.id,
  });

  logAudit({
    tenantId: args.tenantId,
    actorId: args.actorId,
    actorEmail: args.actorEmail,
    action: 'appointment_completed_journey',
    resourceType: 'appointment',
    resourceId: appt.id,
    afterValue: { welcome: out.welcome, survey: out.survey, first_visit: isFirstCompleted },
    legalBasis: 'contract_art7_V',
  });

  return out;
}

/** Latest granted/revoked status per consent purpose for a patient. */
export function getConsentLedger(patientId: string): Array<{
  purpose: string;
  granted: boolean;
  granted_at: string | null;
  revoked_at: string | null;
  policy_version: string | null;
  source: string | null;
}> {
  const rows = db.prepare(`
    SELECT consent_type, granted, granted_at, revoked_at, policy_version, evidence
    FROM lgpd_consents
    WHERE subject_type = 'patient' AND subject_id = ?
    ORDER BY granted_at DESC
  `).all(patientId) as any[];

  const latest = new Map<string, any>();
  for (const r of rows) {
    if (!latest.has(r.consent_type)) latest.set(r.consent_type, r);
  }

  return CONSENT_PURPOSES.map((purpose) => {
    const r = latest.get(purpose);
    let source: string | null = null;
    if (r?.evidence) {
      try {
        const ev = typeof r.evidence === 'string' ? JSON.parse(r.evidence) : r.evidence;
        source = ev?.source || null;
      } catch { /* ignore */ }
    }
    return {
      purpose,
      granted: !!(r && r.granted && !r.revoked_at),
      granted_at: r?.granted_at ?? null,
      revoked_at: r?.revoked_at ?? null,
      policy_version: r?.policy_version ?? null,
      source,
    };
  });
}

export function setPatientConsent(args: {
  patientId: string;
  tenantId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  actorId?: string;
  ipAddress?: string;
  userAgent?: string;
  source?: string;
}): void {
  // Revoke prior active of same type
  db.prepare(`
    UPDATE lgpd_consents SET revoked_at = datetime('now')
    WHERE subject_type = 'patient' AND subject_id = ? AND consent_type = ?
      AND granted = 1 AND revoked_at IS NULL
  `).run(args.patientId, args.purpose);

  recordConsent({
    subjectType: 'patient',
    subjectId: args.patientId,
    consentType: args.purpose as any,
    granted: args.granted,
    policyVersion: 'workspace-v1',
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
    evidence: JSON.stringify({ source: args.source || 'patient_workspace', actor_id: args.actorId }),
    tenantId: args.tenantId,
  });

  if (args.purpose === 'marketing_news' || args.purpose === 'promotions_events') {
    db.prepare(`
      UPDATE patients SET lgpd_opt_out_marketing = ?, updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `).run(args.granted ? 0 : 1, args.patientId, args.tenantId);
  }

  if (args.purpose === 'whatsapp_admin' && !args.granted) {
    // Keep reminders opt-in separate; do not force do_not_contact
  }

  appendTimelineEvent({
    tenantId: args.tenantId,
    patientId: args.patientId,
    kind: 'consent',
    title: args.granted ? 'consent_granted' : 'consent_revoked',
    subtitle: args.purpose,
    status: args.granted ? 'granted' : 'revoked',
    meta: { purpose: args.purpose },
  });
}
