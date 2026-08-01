/**
 * WhatsApp marketing — audience segments, template helpers, automation runners.
 * Messages stay LGPD-aware (consent + opt-out) and append promo footers for marketing.
 */
import { db } from '../db/schema';
import { sendTextMessage, getOrCreateConversation, updateConversation } from './whatsapp';
import { t, Locale } from './i18n';

export type AudienceSegment =
  | 'all_consented'
  | 'recent_30d'
  | 'inactive_90d'
  | 'birthday_month'
  | 'upcoming_7d'
  | 'high_nps';

const MARKETING_SEGMENTS = new Set<AudienceSegment>([
  'all_consented', 'recent_30d', 'inactive_90d', 'birthday_month', 'high_nps',
]);

function optedOutClause(tenantId: string): string {
  return `p.phone NOT IN (SELECT phone FROM whatsapp_conversations WHERE opted_out = 1 AND tenant_id = '${tenantId.replace(/'/g, '')}')`;
}

function baseConsentFilter(tenantId: string): string {
  return `p.tenant_id = ? AND p.phone IS NOT NULL AND p.phone != ''
    AND p.lgpd_consent_at IS NOT NULL
    AND p.lgpd_opt_out_marketing = 0
    AND ${optedOutClause(tenantId)}`;
}

export function listAudience(tenantId: string, segment: AudienceSegment = 'all_consented'): any[] {
  switch (segment) {
    case 'recent_30d':
      return db.prepare(`
        SELECT DISTINCT p.id, p.full_name, p.phone FROM patients p
        JOIN appointments a ON a.patient_id = p.id AND a.tenant_id = p.tenant_id
        WHERE ${baseConsentFilter(tenantId)}
          AND a.scheduled_at >= datetime('now', '-30 days')
      `).all(tenantId) as any[];
    case 'inactive_90d':
      return db.prepare(`
        SELECT p.id, p.full_name, p.phone FROM patients p
        WHERE ${baseConsentFilter(tenantId)}
          AND NOT EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.patient_id = p.id AND a.tenant_id = p.tenant_id
              AND a.scheduled_at >= datetime('now', '-90 days')
          )
      `).all(tenantId) as any[];
    case 'birthday_month':
      return db.prepare(`
        SELECT p.id, p.full_name, p.phone, p.birth_date FROM patients p
        WHERE ${baseConsentFilter(tenantId)}
          AND CAST(strftime('%m', p.birth_date) AS INTEGER) = CAST(strftime('%m', 'now') AS INTEGER)
      `).all(tenantId) as any[];
    case 'upcoming_7d':
      return db.prepare(`
        SELECT DISTINCT p.id, p.full_name, p.phone FROM patients p
        JOIN appointments a ON a.patient_id = p.id AND a.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.phone IS NOT NULL AND p.phone != ''
          AND p.lgpd_opt_out_marketing = 0
          AND ${optedOutClause(tenantId)}
          AND a.status IN ('scheduled','confirmed')
          AND a.scheduled_at BETWEEN datetime('now') AND datetime('now', '+7 days')
      `).all(tenantId) as any[];
    case 'high_nps':
      return db.prepare(`
        SELECT DISTINCT p.id, p.full_name, p.phone FROM patients p
        JOIN satisfaction_surveys s ON s.patient_id = p.id AND s.tenant_id = p.tenant_id
        WHERE ${baseConsentFilter(tenantId)} AND s.score >= 9
      `).all(tenantId) as any[];
    case 'all_consented':
    default:
      return db.prepare(`
        SELECT p.id, p.full_name, p.phone FROM patients p
        WHERE ${baseConsentFilter(tenantId)}
      `).all(tenantId) as any[];
  }
}

export function audienceStats(tenantId: string) {
  const segments: AudienceSegment[] = [
    'all_consented', 'recent_30d', 'inactive_90d', 'birthday_month', 'upcoming_7d', 'high_nps',
  ];
  const counts: Record<string, number> = {};
  for (const s of segments) counts[s] = listAudience(tenantId, s).length;
  const optedOut = (db.prepare(`
    SELECT COUNT(*) AS c FROM whatsapp_conversations WHERE tenant_id = ? AND opted_out = 1
  `).get(tenantId) as any).c;
  const marketingOptOut = (db.prepare(`
    SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ? AND lgpd_opt_out_marketing = 1
  `).get(tenantId) as any).c;
  const withPhone = (db.prepare(`
    SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ? AND phone IS NOT NULL AND phone != ''
  `).get(tenantId) as any).c;
  return { segments: counts, opted_out_whatsapp: optedOut, opted_out_marketing: marketingOptOut, with_phone: withPhone };
}

export function renderTemplate(body: string, vars: Record<string, string>): string {
  let out = body;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v ?? '');
  }
  return out;
}

export function marketingAnalytics(tenantId: string) {
  const outbound30 = (db.prepare(`
    SELECT COUNT(*) AS c FROM whatsapp_messages
    WHERE tenant_id = ? AND direction = 'out' AND created_at >= datetime('now', '-30 days')
  `).get(tenantId) as any).c;
  const inbound30 = (db.prepare(`
    SELECT COUNT(*) AS c FROM whatsapp_messages
    WHERE tenant_id = ? AND direction = 'in' AND created_at >= datetime('now', '-30 days')
  `).get(tenantId) as any).c;
  const delivered = (db.prepare(`
    SELECT COUNT(*) AS c FROM whatsapp_messages
    WHERE tenant_id = ? AND direction = 'out' AND status IN ('delivered','read')
      AND created_at >= datetime('now', '-30 days')
  `).get(tenantId) as any).c;
  const read = (db.prepare(`
    SELECT COUNT(*) AS c FROM whatsapp_messages
    WHERE tenant_id = ? AND direction = 'out' AND status = 'read'
      AND created_at >= datetime('now', '-30 days')
  `).get(tenantId) as any).c;
  const failed = (db.prepare(`
    SELECT COUNT(*) AS c FROM whatsapp_messages
    WHERE tenant_id = ? AND direction = 'out' AND status = 'failed'
      AND created_at >= datetime('now', '-30 days')
  `).get(tenantId) as any).c;
  const campaigns = db.prepare(`
    SELECT id, name, status, sent_count, failed_count, skipped_count, dispatched_at, audience, category
    FROM campaigns WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(tenantId);
  const automationsEnabled = (db.prepare(`
    SELECT COUNT(*) AS c FROM wa_automations WHERE tenant_id = ? AND enabled = 1
  `).get(tenantId) as any).c;
  const templatesApproved = (db.prepare(`
    SELECT COUNT(*) AS c FROM wa_templates WHERE tenant_id = ? AND status = 'approved'
  `).get(tenantId) as any).c;
  return {
    period_days: 30,
    outbound: outbound30,
    inbound: inbound30,
    delivered,
    read,
    failed,
    delivery_rate: outbound30 ? Math.round((delivered / outbound30) * 100) : 0,
    read_rate: outbound30 ? Math.round((read / outbound30) * 100) : 0,
    campaigns,
    automations_enabled: automationsEnabled,
    templates_approved: templatesApproved,
    audience: audienceStats(tenantId),
  };
}

async function sendPersonalized(
  tenantId: string,
  phone: string,
  fullName: string,
  message: string,
  vars: Record<string, string>,
  marketing: boolean,
  locale: Locale,
): Promise<boolean> {
  const firstName = fullName.split(' ')[0];
  let body = renderTemplate(message, { name: firstName, ...vars });
  if (marketing) body += t(locale, 'whatsapp.promo_footer', {});
  const result = await sendTextMessage(phone, body, tenantId);
  return !!result.ok;
}

export async function runAutomation(tenantId: string, automationId: string, locale: Locale = 'pt-BR') {
  const auto = db.prepare(`SELECT * FROM wa_automations WHERE id = ? AND tenant_id = ?`).get(automationId, tenantId) as any;
  if (!auto) return { ok: false, error: 'not_found' as const };
  if (!auto.enabled) return { ok: false, error: 'disabled' as const };

  const config = (() => { try { return JSON.parse(auto.config || '{}'); } catch { return {}; } })() as any;
  let sent = 0, failed = 0, skipped = 0;
  const isMarketing = ['birthday', 'inactive_90d'].includes(auto.key);

  if (auto.key === 'reminder_24h' || auto.key === 'reminder_2h') {
    const hours = config.offset_hours || (auto.key === 'reminder_24h' ? 24 : 2);
    const flagCol = auto.key === 'reminder_24h' ? 'reminder_24h_sent_at' : 'reminder_2h_sent_at';
    // Window: appointments starting in ~offset hours (±30 min)
    const rows = db.prepare(`
      SELECT a.id, a.scheduled_at, p.full_name, p.phone
      FROM appointments a JOIN patients p ON p.id = a.patient_id
      WHERE a.tenant_id = ? AND a.status IN ('scheduled','confirmed')
        AND p.phone IS NOT NULL AND p.phone != ''
        AND p.lgpd_opt_out_marketing = 0
        AND ${optedOutClause(tenantId)}
        AND a.${flagCol} IS NULL
        AND a.scheduled_at BETWEEN datetime('now', ?, '-30 minutes')
                               AND datetime('now', ?, '+30 minutes')
      LIMIT 200
    `).all(tenantId, `+${hours} hours`, `+${hours} hours`) as any[];
    for (const row of rows) {
      const dt = new Date(row.scheduled_at.replace(' ', 'T') + 'Z');
      const date = Number.isNaN(dt.getTime()) ? row.scheduled_at.slice(0, 10) : dt.toLocaleDateString('pt-BR');
      const time = Number.isNaN(dt.getTime()) ? row.scheduled_at.slice(11, 16) : dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const ok = await sendPersonalized(tenantId, row.phone, row.full_name, auto.message, { date, time }, false, locale);
      if (ok) {
        sent++;
        try { db.prepare(`UPDATE appointments SET ${flagCol} = datetime('now') WHERE id = ?`).run(row.id); } catch { /* col may miss */ }
      } else failed++;
    }
  } else if (auto.key === 'birthday') {
    const rows = listAudience(tenantId, 'birthday_month').filter((p) => {
      if (!p.birth_date) return false;
      const today = new Date();
      const bd = new Date(p.birth_date);
      return bd.getUTCDate() === today.getUTCDate() && bd.getUTCMonth() === today.getUTCMonth();
    });
    for (const p of rows) {
      const ok = await sendPersonalized(tenantId, p.phone, p.full_name, auto.message, {}, true, locale);
      if (ok) sent++; else failed++;
    }
  } else if (auto.key === 'inactive_90d') {
    const days = config.inactive_days || 90;
    const rows = db.prepare(`
      SELECT p.id, p.full_name, p.phone FROM patients p
      WHERE ${baseConsentFilter(tenantId)}
        AND NOT EXISTS (
          SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.tenant_id = p.tenant_id
            AND a.scheduled_at >= datetime('now', ?)
        )
      LIMIT 200
    `).all(tenantId, `-${days} days`) as any[];
    for (const p of rows) {
      const ok = await sendPersonalized(tenantId, p.phone, p.full_name, auto.message, {}, true, locale);
      if (ok) sent++; else failed++;
    }
  } else if (auto.key === 'no_show') {
    const lookback = config.lookback_days || 3;
    const rows = db.prepare(`
      SELECT a.id, a.scheduled_at, p.full_name, p.phone FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE a.tenant_id = ? AND a.status = 'no_show'
        AND a.scheduled_at >= datetime('now', ?)
        AND p.phone IS NOT NULL AND p.phone != ''
        AND ${optedOutClause(tenantId)}
      LIMIT 100
    `).all(tenantId, `-${lookback} days`) as any[];
    for (const row of rows) {
      const date = String(row.scheduled_at).slice(0, 10);
      const ok = await sendPersonalized(tenantId, row.phone, row.full_name, auto.message, { date }, false, locale);
      if (ok) sent++; else failed++;
    }
  } else if (auto.key === 'nps_auto') {
    const within = config.within_hours || 48;
    const pending = db.prepare(`
      SELECT a.id AS appointment_id, p.id AS patient_id, p.full_name, p.phone
      FROM appointments a JOIN patients p ON p.id = a.patient_id
      WHERE a.tenant_id = ? AND a.status = 'completed'
        AND a.scheduled_at >= datetime('now', ?)
        AND a.scheduled_at <= datetime('now')
        AND p.lgpd_opt_out_marketing = 0
        AND NOT EXISTS (SELECT 1 FROM satisfaction_surveys s WHERE s.appointment_id = a.id AND s.tenant_id = a.tenant_id)
        AND ${optedOutClause(tenantId)}
      LIMIT 100
    `).all(tenantId, `-${within} hours`) as any[];
    for (const row of pending) {
      const conv = getOrCreateConversation(row.phone, tenantId);
      if (conv.state !== 'idle' && conv.state !== 'lgpd_optout') { skipped++; continue; }
      updateConversation(row.phone, tenantId, {
        state: 'awaiting_nps_score',
        patient_id: row.patient_id,
        context: { patient_id: row.patient_id, appointment_id: row.appointment_id, survey: true },
      });
      const ok = await sendPersonalized(tenantId, row.phone, row.full_name, auto.message, {}, false, locale);
      if (ok) sent++; else failed++;
    }
  } else if (auto.key === 'payment_reminder') {
    const rows = db.prepare(`
      SELECT i.number AS invoice, p.full_name, p.phone FROM invoices i
      JOIN patients p ON p.id = i.patient_id
      WHERE i.tenant_id = ? AND i.status IN ('issued','overdue')
        AND p.phone IS NOT NULL AND p.phone != ''
        AND p.lgpd_opt_out_marketing = 0
        AND ${optedOutClause(tenantId)}
      LIMIT 100
    `).all(tenantId) as any[];
    for (const row of rows) {
      const ok = await sendPersonalized(tenantId, row.phone, row.full_name, auto.message, { invoice: row.invoice }, false, locale);
      if (ok) sent++; else failed++;
    }
  } else if (auto.key === 'welcome') {
    // First completed visit, welcome not yet sent (idempotent patient flag)
    const rows = db.prepare(`
      SELECT p.id, p.full_name, p.phone FROM patients p
      WHERE p.tenant_id = ?
        AND p.phone IS NOT NULL AND p.phone != ''
        AND p.welcome_message_sent_at IS NULL
        AND COALESCE(p.do_not_contact, 0) = 0
        AND p.first_completed_visit_at IS NOT NULL
        AND ${optedOutClause(tenantId)}
      LIMIT 100
    `).all(tenantId) as any[];
    const { maybeSendWelcomeMessage } = await import('./patientJourney');
    for (const p of rows) {
      const r = await maybeSendWelcomeMessage({ tenantId, patientId: p.id, locale });
      if (r.sent) sent++;
      else if (r.reason === 'send_failed') failed++;
      else skipped++;
    }
  } else if (auto.key === 'recall') {
    const { processDueRecalls } = await import('./patientJourney');
    const daysBefore = config.days_before || 30;
    const result = await processDueRecalls({ tenantId, daysBefore, locale });
    sent += result.notified;
    skipped += result.tasked;
  } else {
    return { ok: false, error: 'unknown_key' as const, key: auto.key };
  }

  db.prepare(`
    UPDATE wa_automations SET last_run_at = datetime('now'), last_sent_count = ?, updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).run(sent, auto.id, tenantId);

  return { ok: true, key: auto.key, sent, failed, skipped, marketing: isMarketing || MARKETING_SEGMENTS.has(auto.key as any) };
}

/**
 * Run a WhatsApp automation for a single patient (task-linked triggers).
 * Respects LGPD opt-out / do-not-contact. Creates a follow-up task when appropriate.
 */
export async function runAutomationForPatient(
  tenantId: string,
  automationId: string,
  patientId: string,
  locale: Locale = 'pt-BR',
): Promise<{
  ok: boolean;
  error?: string;
  key?: string;
  sent?: number;
  failed?: number;
  skipped?: number;
  reason?: string;
}> {
  const auto = db.prepare(`SELECT * FROM wa_automations WHERE id = ? AND tenant_id = ?`).get(automationId, tenantId) as any;
  if (!auto) return { ok: false, error: 'not_found' };
  if (!auto.enabled) return { ok: false, error: 'disabled' };

  const patient = db.prepare(`
    SELECT id, full_name, phone, lgpd_opt_out_marketing, do_not_contact, open_complaint
    FROM patients WHERE id = ? AND tenant_id = ?
  `).get(patientId, tenantId) as any;
  if (!patient) return { ok: false, error: 'patient_not_found' };
  if (!patient.phone) return { ok: false, error: 'no_phone', key: auto.key, skipped: 1, reason: 'no_phone' };
  if (patient.do_not_contact) return { ok: false, error: 'do_not_contact', key: auto.key, skipped: 1, reason: 'do_not_contact' };

  const isMarketing = ['birthday', 'inactive_90d'].includes(auto.key) || MARKETING_SEGMENTS.has(auto.key as any);
  if (isMarketing && (patient.lgpd_opt_out_marketing || patient.open_complaint)) {
    return { ok: false, error: 'marketing_blocked', key: auto.key, skipped: 1, reason: 'marketing_blocked' };
  }

  // Operational opt-out check via conversation state
  const convOptOut = db.prepare(`
    SELECT state FROM whatsapp_conversations WHERE phone = ? AND tenant_id = ?
  `).get(patient.phone, tenantId) as any;
  if (convOptOut?.state === 'lgpd_optout') {
    return { ok: false, error: 'opted_out', key: auto.key, skipped: 1, reason: 'opted_out' };
  }

  let vars: Record<string, string> = {};
  if (auto.key === 'reminder_24h' || auto.key === 'reminder_2h' || auto.key === 'no_show') {
    const appt = db.prepare(`
      SELECT scheduled_at FROM appointments
      WHERE patient_id = ? AND tenant_id = ?
      ORDER BY scheduled_at DESC LIMIT 1
    `).get(patientId, tenantId) as any;
    if (appt?.scheduled_at) {
      const dt = new Date(String(appt.scheduled_at).replace(' ', 'T') + (String(appt.scheduled_at).includes('Z') ? '' : 'Z'));
      vars.date = Number.isNaN(dt.getTime()) ? String(appt.scheduled_at).slice(0, 10) : dt.toLocaleDateString('pt-BR');
      vars.time = Number.isNaN(dt.getTime()) ? String(appt.scheduled_at).slice(11, 16) : dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
  }
  if (auto.key === 'payment_reminder') {
    const inv = db.prepare(`
      SELECT number FROM invoices
      WHERE patient_id = ? AND tenant_id = ? AND status IN ('issued','overdue')
      ORDER BY created_at DESC LIMIT 1
    `).get(patientId, tenantId) as any;
    if (inv?.number) vars.invoice = String(inv.number);
  }

  const ok = await sendPersonalized(
    tenantId,
    patient.phone,
    patient.full_name,
    auto.message,
    vars,
    isMarketing,
    locale,
  );

  try {
    db.prepare(`
      UPDATE wa_automations SET last_run_at = datetime('now'), last_sent_count = COALESCE(last_sent_count,0) + ?, updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `).run(ok ? 1 : 0, auto.id, tenantId);
  } catch { /* ignore */ }

  return {
    ok: true,
    key: auto.key,
    sent: ok ? 1 : 0,
    failed: ok ? 0 : 1,
    skipped: 0,
  };
}

export { MARKETING_SEGMENTS };
