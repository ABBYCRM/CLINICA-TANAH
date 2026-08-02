/**
 * WhatsApp bot — Flow Doctor conversation (PT-first) for appointments + marketing
 * Covers booking, promos/campaigns, NPS, reminders/prefs, LGPD opt-out
 * Supports pt-BR, es, en (auto-detected; Flow Doctor keywords force pt-BR)
 */
import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { recordConsent, logAudit } from '../services/audit';
import { t, type Locale } from '../services/i18n';
import {
  sendTextMessage, persistIncoming, getOrCreateConversation, updateConversation,
  verifyWebhookSignature, markAsRead, applyStatusUpdate, pingMeta, isLive,
  resolveTenantForPhone, listMessagesForPhones, phoneLookupVariants,
  ensurePatientConversation,
} from '../services/whatsapp';
import { getAvailableSlots, getPractitionerLoads } from '../services/availability';
import { DEFAULT_TENANT_ID } from '../db/schema';
import {
  audienceStats, listAudience, marketingAnalytics, runAutomation,
  linkTemplateAutomations, bindTemplateToAutomation,
  suggestedSegmentForTemplate, suggestedAutomationKeyForTemplate,
  type AudienceSegment,
} from '../services/marketing';

const router = Router();

const SPECIALTIES = [
  { code: 'general', name: 'Clínica Geral' },
  { code: 'cardio', name: 'Cardiologia' },
  { code: 'derma', name: 'Dermatologia' },
  { code: 'gineco', name: 'Ginecologia' },
  { code: 'pediatria', name: 'Pediatria' },
  { code: 'orto', name: 'Ortopedia' },
];

function detectUserLocale(text: string): Locale {
  // Quick heuristics
  const lc = text.toLowerCase();
  if (/\b(hola|buenos|cancelar|agendar|cita|sí|gracias)\b/.test(lc)) return 'es';
  if (/\b(hi|hello|book|cancel|thanks|please)\b/.test(lc)) return 'en';
  if (/\b(oi|olá|agendar|cancelar|obrigad|sair)\b/.test(lc)) return 'pt-BR';
  return 'pt-BR';
}

async function reply(phone: string, locale: Locale, key: string, vars: Record<string, string | number> = {}, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
  const body = t(locale, `whatsapp.${key}`, { ...vars, clinic: t(locale, 'app.name') });
  await sendTextMessage(phone, body, tenantId);
}

function isFlowDoctorKeyword(lower: string): boolean {
  return [
    'médico', 'medico', 'flow doctor', 'flowdoctor', 'fluxo', 'fluxo medico', 'fluxo médico',
    'marketing', 'menu', 'doutor', 'doctor',
  ].includes(lower);
}

async function replyFlowDoctorPromos(phone: string, locale: Locale, tenantId: string): Promise<void> {
  const camps = db.prepare(`
    SELECT name, message, status FROM campaigns
    WHERE tenant_id = ?
    ORDER BY created_at DESC LIMIT 3
  `).all(tenantId) as Array<{ name: string; message: string; status: string }>;
  if (!camps.length) {
    const fallback = t(locale, 'whatsapp.flow_doctor_promos_fallback', {});
    await reply(phone, locale, 'flow_doctor_promos', { list: fallback }, tenantId);
    return;
  }
  const list = camps.map((c, i) => {
    const preview = c.message.replace(/\s+/g, ' ').slice(0, 140);
    return `${i + 1}. *${c.name}* (${c.status})\n${preview}${c.message.length > 140 ? '…' : ''}`;
  }).join('\n\n');
  await reply(phone, locale, 'flow_doctor_promos', { list }, tenantId);
}

async function startFlowDoctorNps(phone: string, locale: Locale, tenantId: string): Promise<void> {
  const p = db.prepare(`SELECT id, full_name FROM patients WHERE phone = ? AND tenant_id = ?`).get(phone, tenantId) as any;
  const first = p?.full_name ? ` ${String(p.full_name).split(' ')[0]}` : '';
  updateConversation(phone, tenantId, {
    state: 'awaiting_nps_score',
    patient_id: p?.id,
    context: { patient_id: p?.id ?? null, flow_doctor: true },
  });
  await reply(phone, locale, 'flow_doctor_nps_start', {}, tenantId);
  await reply(phone, locale, 'nps_ask', { name: first }, tenantId);
}

async function handleMessage(phone: string, body: string, locale: Locale, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
  const conv = getOrCreateConversation(phone, tenantId);
  const ctx = conv.context ? JSON.parse(conv.context) : {};
  const text = body.trim();
  const lower = text.toLowerCase();

  // Flow Doctor / marketing keywords always reply in Portuguese for this clinic channel
  if (isFlowDoctorKeyword(lower)) {
    updateConversation(phone, tenantId, { state: 'idle', context: { ...ctx, flow_doctor: true } });
    await reply(phone, 'pt-BR', 'bot_menu', {}, tenantId);
    return;
  }

  // Global marketing opt-out (SAIR) — does NOT block clinical utility messages
  if (['sair', 'parar', 'stop', 'remover', 'exit', 'salir', 'unsubscribe'].includes(lower) && conv.state !== 'awaiting_consent') {
    db.prepare(`UPDATE patients SET lgpd_opt_out_marketing = 1 WHERE phone = ? AND tenant_id = ?`).run(phone, tenantId);
    try {
      const p = db.prepare(`SELECT id FROM patients WHERE phone = ? AND tenant_id = ?`).get(phone, tenantId) as any;
      if (p) {
        const { setPatientConsent } = await import('../services/patientJourney');
        setPatientConsent({ patientId: p.id, tenantId, purpose: 'marketing_news', granted: false, source: 'whatsapp_sair' });
        setPatientConsent({ patientId: p.id, tenantId, purpose: 'promotions_events', granted: false, source: 'whatsapp_sair' });
      }
    } catch { /* ignore */ }
    // Keep conversation usable for reminders / booking — marketing campaigns already filter lgpd_opt_out_marketing
    updateConversation(phone, tenantId, { state: 'idle' });
    logAudit({ tenantId, action: 'whatsapp_marketing_optout', resourceType: 'whatsapp_conversation', resourceId: phone, legalBasis: 'consent_art7_I' });
    await reply(phone, locale, 'lgpd_optout_confirmed', {}, tenantId);
    return;
  }

  if (['urgência', 'urgencia', 'emergency', 'emergencia'].includes(lower)) {
    await reply(phone, locale, 'emergency_notice', {}, tenantId);
    return;
  }

  if (['atendente', 'humano', 'recepção', 'recepcao', 'agent'].includes(lower)) {
    await reply(phone, locale, 'transfer_to_human', {}, tenantId);
    updateConversation(phone, tenantId, { state: 'awaiting_human' });
    return;
  }

  if (['preferências', 'preferencias', 'preferences'].includes(lower) || lower === '7') {
    updateConversation(phone, tenantId, { state: 'idle' });
    await reply(phone, locale, 'prefs_menu', {}, tenantId);
    return;
  }

  if (['privacidade', 'privacy', 'meus dados', 'meusdados'].includes(lower) || lower === '8') {
    updateConversation(phone, tenantId, { state: 'idle' });
    await reply(phone, locale, 'privacy_menu', {}, tenantId);
    return;
  }

  if (['cancelar mensagens', 'cancelar mensagem'].includes(lower)) {
    updateConversation(phone, tenantId, { state: 'awaiting_message_optout_choice' });
    await reply(phone, locale, 'cancel_messages_clarify', {}, tenantId);
    return;
  }

  // 1 = promos only · 2 = stop all WhatsApp
  if (conv.state === 'awaiting_message_optout_choice') {
    if (['1', '1 — só promoções', '1 - so promocoes', 'promo', 'promos', 'promoções', 'promocoes'].includes(lower) || lower.startsWith('1')) {
      db.prepare(`UPDATE patients SET lgpd_opt_out_marketing = 1 WHERE phone = ? AND tenant_id = ?`).run(phone, tenantId);
      try {
        const p = db.prepare(`SELECT id FROM patients WHERE phone = ? AND tenant_id = ?`).get(phone, tenantId) as any;
        if (p) {
          const { setPatientConsent } = await import('../services/patientJourney');
          setPatientConsent({ patientId: p.id, tenantId, purpose: 'marketing_news', granted: false, source: 'whatsapp_cancel_1' });
          setPatientConsent({ patientId: p.id, tenantId, purpose: 'promotions_events', granted: false, source: 'whatsapp_cancel_1' });
        }
      } catch { /* ignore */ }
      updateConversation(phone, tenantId, { state: 'idle' });
      await reply(phone, locale, 'lgpd_optout_confirmed', {}, tenantId);
      return;
    }
    if (['2', '2 — tudo', '2 - tudo', 'tudo', 'all', 'cancelar tudo'].includes(lower) || lower.startsWith('2')) {
      updateConversation(phone, tenantId, { state: 'lgpd_optout', opt_out: true });
      db.prepare(`UPDATE patients SET lgpd_opt_out_marketing = 1, do_not_contact = 1 WHERE phone = ? AND tenant_id = ?`).run(phone, tenantId);
      logAudit({ tenantId, action: 'whatsapp_full_optout', resourceType: 'whatsapp_conversation', resourceId: phone, legalBasis: 'consent_art7_I' });
      await reply(phone, locale, 'lgpd_optout_confirmed', {}, tenantId);
      return;
    }
    await reply(phone, locale, 'cancel_messages_clarify', {}, tenantId);
    return;
  }

  // LGPD consent prompts
  if (['sim', 's', 'si', 'sí', 'yes', 'y', 'aceito'].includes(lower) && conv.state === 'awaiting_consent') {
    recordConsent({
      subjectType: 'patient', subjectId: conv.patient_id || 'pending',
      consentType: 'whatsapp_communication', granted: true,
      policyVersion: '1.0', evidence: `WhatsApp consent at ${new Date().toISOString()} via bot.`,
    });
    updateConversation(phone, tenantId, { state: 'idle', consent: true });
    await reply(phone, locale, 'lgpd_consent_granted', {}, tenantId);
    await reply(phone, locale, 'bot_menu', {}, tenantId);
    return;
  }
  if (['não', 'nao', 'n', 'no', 'rechazo', 'rejeito'].includes(lower) && conv.state === 'awaiting_consent') {
    recordConsent({
      subjectType: 'patient', subjectId: conv.patient_id || 'pending',
      consentType: 'whatsapp_communication', granted: false,
      policyVersion: '1.0',
    });
    updateConversation(phone, tenantId, { state: 'lgpd_optout', opt_out: true });
    await reply(phone, locale, 'lgpd_optout_confirmed', {}, tenantId);
    return;
  }

  // Reminder reply while idle: confirm / reschedule / cancel upcoming appointment
  if (conv.state === 'idle' && ['confirmar', '1 — confirmar'].includes(lower)) {
    const appt = db.prepare(`
      SELECT a.id FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE p.phone = ? AND a.tenant_id = ? AND a.status IN ('scheduled','confirmed')
        AND a.scheduled_at >= datetime('now')
      ORDER BY a.scheduled_at ASC LIMIT 1
    `).get(phone, tenantId) as any;
    if (appt) {
      db.prepare(`UPDATE appointments SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?`).run(appt.id);
      const p = db.prepare(`SELECT id FROM patients WHERE phone = ? AND tenant_id = ?`).get(phone, tenantId) as any;
      if (p) {
        try {
          const { appendTimelineEvent } = await import('../services/patientJourney');
          appendTimelineEvent({
            tenantId, patientId: p.id, kind: 'appointment', title: 'appointment_confirmed_wa',
            subtitle: 'WhatsApp', status: 'confirmed', meta: { appointment_id: appt.id },
          });
        } catch { /* ignore */ }
      }
      await reply(phone, locale, 'reminder_confirmed', {}, tenantId);
      return;
    }
  }

  // State machine
  switch (conv.state) {
    case 'idle': {
      if (['1', 'agendar', 'book', 'cita', 'marcar', 'marcar consulta', 'agendar consulta'].some(k => lower === k || lower.includes(k))) {
        updateConversation(phone, tenantId, { state: 'awaiting_cpf' });
        await reply(phone, locale, 'ask_cpf', {}, tenantId);
        return;
      }
      if (['2', 'confirmar', 'confirm', 'consultas', 'appointments', 'citas', 'minhas'].some(k => lower === k || lower.startsWith(k))) {
        if (lower === '2' || lower.includes('confirm')) {
          const appt = db.prepare(`
            SELECT a.id, a.scheduled_at FROM appointments a
            JOIN patients p ON p.id = a.patient_id
            WHERE p.phone = ? AND a.tenant_id = ?
              AND a.status IN ('scheduled','confirmed')
              AND a.scheduled_at >= datetime('now')
            ORDER BY a.scheduled_at ASC LIMIT 1
          `).get(phone, tenantId) as any;
          if (appt) {
            db.prepare(`UPDATE appointments SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?`).run(appt.id);
            await reply(phone, locale, 'reminder_confirmed', {}, tenantId);
            return;
          }
        }
        const appts = db.prepare(`
          SELECT a.scheduled_at, a.type, u.full_name AS practitioner
          FROM appointments a JOIN users u ON u.id = a.practitioner_id
          WHERE a.tenant_id = ? AND a.patient_id = (SELECT id FROM patients WHERE phone = ? AND tenant_id = ?)
            AND a.scheduled_at >= datetime('now')
            AND a.status NOT IN ('cancelled','no_show','completed')
          ORDER BY a.scheduled_at ASC LIMIT 5
        `).all(tenantId, phone, tenantId);
        if (!appts.length) {
          await sendTextMessage(phone, locale === 'en' ? 'You have no upcoming appointments.' : locale === 'es' ? 'No tienes citas próximas.' : 'Você não tem consultas agendadas.', tenantId);
        } else {
          const lines = appts.map((a: any) => `📅 ${a.scheduled_at} — ${a.type} (${a.practitioner})`).join('\n');
          await sendTextMessage(phone, lines, tenantId);
        }
        await reply(phone, locale, 'bot_menu', {}, tenantId);
        return;
      }
      if (['3', 'remarcar', 'reschedule', 'reagendar'].some(k => lower === k || lower.includes(k))) {
        const p = db.prepare(`SELECT id FROM patients WHERE phone = ? AND tenant_id = ?`).get(phone, tenantId) as any;
        if (p) {
          const appt = db.prepare(`
            SELECT id FROM appointments
            WHERE patient_id = ? AND tenant_id = ? AND status IN ('scheduled','confirmed')
              AND scheduled_at >= datetime('now')
            ORDER BY scheduled_at ASC LIMIT 1
          `).get(p.id, tenantId) as any;
          if (appt) {
            db.prepare(`
              UPDATE appointments SET notes = COALESCE(notes || ' | ', '') || 'Rescheduling requested via WhatsApp',
                updated_at = datetime('now') WHERE id = ?
            `).run(appt.id);
          }
          try {
            const { createPatientTask, appendTimelineEvent } = await import('../services/patientJourney');
            createPatientTask({
              tenantId,
              patientId: p.id,
              title: 'Remarcação solicitada via WhatsApp',
              category: 'scheduling',
              priority: 'normal',
              relatedAppointmentId: appt?.id ?? null,
            });
            appendTimelineEvent({
              tenantId, patientId: p.id, kind: 'appointment', title: 'reschedule_requested',
              status: 'requested', meta: { appointment_id: appt?.id },
            });
          } catch { /* ignore */ }
        }
        await reply(phone, locale, 'reschedule_requested', {}, tenantId);
        return;
      }
      if (['4', 'cancelar', 'cancel'].some(k => lower === k || lower.includes(k))) {
        const appts = db.prepare(`
          SELECT a.id, a.scheduled_at, u.full_name AS practitioner
          FROM appointments a JOIN users u ON u.id = a.practitioner_id
          WHERE a.tenant_id = ? AND a.patient_id = (SELECT id FROM patients WHERE phone = ? AND tenant_id = ?)
            AND a.scheduled_at >= datetime('now')
            AND a.status NOT IN ('cancelled','no_show','completed')
          ORDER BY a.scheduled_at ASC LIMIT 9
        `).all(tenantId, phone, tenantId) as any[];
        if (!appts.length) {
          await reply(phone, locale, 'cancel_none', {}, tenantId);
          await reply(phone, locale, 'bot_menu', {}, tenantId);
          return;
        }
        const list = appts.map((a, i) => {
          const [d, h] = a.scheduled_at.split(' ');
          return `${i + 1}️⃣ ${d.split('-').reverse().join('/')} ${h.slice(0, 5)} — ${a.practitioner}`;
        }).join('\n');
        updateConversation(phone, tenantId, { state: 'awaiting_cancel_choice', context: { ...ctx, cancel_ids: appts.map(a => a.id) } });
        await reply(phone, locale, 'cancel_ask_choice', { list }, tenantId);
        return;
      }
      if (['5', 'promo', 'promoção', 'promocao', 'campanha', 'campanhas', 'promoções', 'promocoes'].some(k => lower === k || lower.includes(k))) {
        await replyFlowDoctorPromos(phone, locale, tenantId);
        return;
      }
      if (['6', 'nps', 'satisfação', 'satisfacao', 'pesquisa', 'survey', 'avaliação', 'avaliacao'].some(k => lower === k || lower.includes(k))) {
        await startFlowDoctorNps(phone, locale, tenantId);
        return;
      }
      if (['8', 'remover dados', 'deletar', 'apagar', 'lgpd', 'deletion', 'privacidade'].some(k => lower === k || lower.includes(k))) {
        if (lower.includes('remover') || lower.includes('delet') || lower.includes('apag') || lower.includes('deletion')) {
          const p = db.prepare(`SELECT id FROM patients WHERE phone = ? AND tenant_id = ?`).get(phone, tenantId) as any;
          if (p) {
            db.prepare(`
              INSERT INTO lgpd_data_requests (id, tenant_id, request_type, subject_type, subject_id, status)
              VALUES (?, ?, 'deletion', 'patient', ?, 'open')
            `).run(uuid(), tenantId, p.id);
            logAudit({ tenantId, action: 'lgpd_deletion_request_whatsapp', resourceType: 'patient', resourceId: p.id, legalBasis: 'consent_art7_I' });
            await reply(phone, locale, 'request_received', {}, tenantId);
            return;
          }
        }
        await reply(phone, locale, 'privacy_menu', {}, tenantId);
        return;
      }
      if (['9', 'humano', 'atendente', 'recepção', 'reception', 'agente'].some(k => lower === k || lower.includes(k))) {
        await reply(phone, locale, 'transfer_to_human', {}, tenantId);
        updateConversation(phone, tenantId, { state: 'awaiting_human' });
        return;
      }
      if (['endereço', 'endereco', 'horário', 'horario', 'address', 'hours'].some(k => lower === k || lower.includes(k))) {
        await reply(phone, locale, 'clinic_info', {}, tenantId);
        return;
      }
      // Default: show Flow Doctor menu (PT-first for this clinic)
      await reply(phone, locale === 'en' || locale === 'es' ? locale : 'pt-BR', 'bot_menu', {}, tenantId);
      return;
    }

    case 'awaiting_cpf': {
      const cpf = text.replace(/\D/g, '');
      if (cpf.length !== 11) { await reply(phone, locale, 'ask_cpf', {}, tenantId); return; }
      const p = db.prepare(`SELECT * FROM patients WHERE cpf = ? AND tenant_id = ?`).get(cpf, tenantId) as any;
      if (!p) {
        await reply(phone, locale, 'not_found', {}, tenantId);
        updateConversation(phone, tenantId, { state: 'idle' });
        return;
      }
      updateConversation(phone, tenantId, { state: 'awaiting_booking_specialty', patient_id: p.id, context: { ...ctx, cpf, patient_id: p.id } });
      await reply(phone, locale, 'ask_specialty', {}, tenantId);
      return;
    }

    case 'awaiting_booking_specialty': {
      const idx = parseInt(lower) - 1;
      if (idx < 0 || idx >= SPECIALTIES.length) { await reply(phone, locale, 'ask_specialty', {}, tenantId); return; }
      const specialty = SPECIALTIES[idx];
      updateConversation(phone, tenantId, { state: 'awaiting_booking_date', context: { ...ctx, specialty: specialty.code } });
      await reply(phone, locale, 'ask_date', {}, tenantId);
      return;
    }

    case 'awaiting_booking_date': {
      let date: string | null = null;
      const tomorrow = new Date(Date.now() + 24*3600*1000).toISOString().slice(0, 10);
      if (/amanh[ãa]|mañana|tomorrow/i.test(lower)) {
        date = tomorrow;
      } else {
        const m = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
        if (m) {
          const dd = m[1].padStart(2, '0');
          const mm = m[2].padStart(2, '0');
          const yyyy = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : new Date().getFullYear().toString();
          date = `${yyyy}-${mm}-${dd}`;
        }
      }
      if (!date) { await reply(phone, locale, 'ask_date', {}, tenantId); return; }
      // Pick the doctor with the most room that day — same availability
      // service the calendar/scheduler uses, so channels never conflict.
      const loads = getPractitionerLoads(date, tenantId);
      const practitioner = loads.find((l) => l.free > 0);
      if (!practitioner) {
        await reply(phone, locale, 'no_slots', {}, tenantId);
        return;
      }
      const candidates = getAvailableSlots(practitioner.id, date, tenantId);
      if (!candidates.length) { await reply(phone, locale, 'no_slots', {}, tenantId); return; }
      const slot = candidates[0];
      // Create appointment
      const apptId = uuid();
      db.prepare(`
        INSERT INTO appointments (id, tenant_id, patient_id, practitioner_id, scheduled_at, duration_minutes, type, status, source, whatsapp_message_id)
        VALUES (?, ?, ?, ?, ?, 30, 'consultation', 'scheduled', 'whatsapp_bot', ?)
      `).run(apptId, tenantId, ctx.patient_id, practitioner.id, slot, phone);

      const hour = slot.split(' ')[1].slice(0, 5);
      const dateStr = slot.split(' ')[0].split('-').reverse().join('/');
      await reply(phone, locale, 'booking_confirmed', {
        date: dateStr, time: hour, practitioner: practitioner.full_name,
        address: t(locale, 'app.address'),
      }, tenantId);
      updateConversation(phone, tenantId, { state: 'idle', context: {} });
      logAudit({ tenantId, action: 'whatsapp_booking_created', resourceType: 'appointment', resourceId: apptId, legalBasis: 'contract_art7_V' });
      return;
    }

    case 'awaiting_cancel_choice': {
      const ids: string[] = ctx.cancel_ids || [];
      if (lower === '0') {
        updateConversation(phone, tenantId, { state: 'idle', context: {} });
        await reply(phone, locale, 'bot_menu', {}, tenantId);
        return;
      }
      const idx = parseInt(lower, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= ids.length) {
        await reply(phone, locale, 'cancel_invalid', {}, tenantId);
        return;
      }
      const appt = db.prepare(`
        SELECT a.id, a.scheduled_at, u.full_name AS practitioner
        FROM appointments a JOIN users u ON u.id = a.practitioner_id WHERE a.id = ? AND a.tenant_id = ?
      `).get(ids[idx], tenantId) as any;
      if (!appt) {
        await reply(phone, locale, 'cancel_invalid', {}, tenantId);
        return;
      }
      db.prepare(`UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`).run(appt.id, tenantId);
      logAudit({ tenantId, action: 'whatsapp_booking_cancelled', resourceType: 'appointment', resourceId: appt.id, legalBasis: 'contract_art7_V' });
      updateConversation(phone, tenantId, { state: 'idle', context: {} });
      const [d, h] = appt.scheduled_at.split(' ');
      await reply(phone, locale, 'cancel_done', {
        date: d.split('-').reverse().join('/'), time: h.slice(0, 5), practitioner: appt.practitioner,
      }, tenantId);
      await reply(phone, locale, 'bot_menu', {}, tenantId);
      return;
    }

    case 'awaiting_nps_score': {
      const score = parseInt(lower, 10);
      if (Number.isNaN(score) || score < 0 || score > 10) {
        await reply(phone, locale, 'nps_invalid', {}, tenantId);
        return;
      }
      updateConversation(phone, tenantId, { state: 'awaiting_nps_comment', context: { ...ctx, score } });
      await reply(phone, locale, 'nps_ask_comment', { score }, tenantId);
      return;
    }

    case 'awaiting_nps_comment': {
      const skipWords = ['pular', 'saltar', 'skip', 'pular.', 'não', 'nao', 'no'];
      const comment = skipWords.includes(lower) ? null : text.slice(0, 1000);
      const surveyId = uuid();
      db.prepare(`
        INSERT INTO satisfaction_surveys (id, tenant_id, patient_id, appointment_id, score, comment, source)
        VALUES (?, ?, ?, ?, ?, ?, 'whatsapp_bot')
      `).run(surveyId, tenantId, ctx.patient_id, ctx.appointment_id ?? null, ctx.score, comment);
      logAudit({ tenantId, action: 'nps_survey_received', resourceType: 'satisfaction_survey', resourceId: surveyId,
                 afterValue: { score: ctx.score }, legalBasis: 'consent_art7_I' });
      try {
        const { appendTimelineEvent } = await import('../services/patientJourney');
        appendTimelineEvent({
          tenantId,
          patientId: ctx.patient_id,
          kind: 'survey',
          title: 'survey_response',
          subtitle: comment,
          status: String(ctx.score),
          meta: { score: ctx.score, appointment_id: ctx.appointment_id, survey_id: surveyId },
        });
        if (Number(ctx.score) <= 6) {
          const { openServiceRecoveryTicket } = await import('../services/patientJourney');
          openServiceRecoveryTicket({
            tenantId,
            patientId: ctx.patient_id,
            surveyId,
            surveyScore: Number(ctx.score),
            comment,
          });
          await reply(phone, locale, 'nps_recovery', {}, tenantId);
          updateConversation(phone, tenantId, { state: 'idle', context: {} });
          return;
        }
        if (Number(ctx.score) >= 9) {
          appendTimelineEvent({
            tenantId,
            patientId: ctx.patient_id,
            kind: 'survey',
            title: 'satisfied_segment',
            subtitle: `NPS ${ctx.score}`,
            status: 'promoter',
            meta: { score: ctx.score, survey_id: surveyId },
          });
        } else if (Number(ctx.score) >= 7) {
          await sendTextMessage(
            phone,
            locale === 'en'
              ? 'Thank you. What could we improve next time?'
              : locale === 'es'
                ? 'Gracias. ¿Qué podríamos mejorar la próxima vez?'
                : 'Obrigado. O que poderíamos melhorar na próxima vez?',
            tenantId,
          );
        }
      } catch (e) {
        console.error('survey timeline side-effect', e);
      }
      updateConversation(phone, tenantId, { state: 'idle', context: {} });
      await reply(phone, locale, 'nps_thanks', {}, tenantId);
      await reply(phone, locale, 'bot_menu', {}, tenantId);
      return;
    }

    default: {
      await reply(phone, locale, 'bot_menu', {}, tenantId);
      updateConversation(phone, tenantId, { state: 'idle' });
    }
  }
}

// Webhook verification (Meta GET)
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === (process.env.META_WA_VERIFY_TOKEN || 'clinica-tanah-verify')) {
    res.status(200).send(challenge);
    return;
  }
  res.status(403).send('Forbidden');
});

// Webhook for incoming messages + delivery status callbacks (Meta POST).
// Signature (X-Hub-Signature-256) is verified against META_WA_APP_SECRET when configured.
router.post('/webhook', async (req: Request, res: Response) => {
  const raw = (req as any).rawBody ?? JSON.stringify(req.body ?? {});
  if (!verifyWebhookSignature(raw, req.headers['x-hub-signature-256'] as string | undefined)) {
    logAudit({ action: 'whatsapp_webhook_bad_signature', ipAddress: req.ip, legalBasis: 'legal_obligation_art7_II' });
    res.status(401).send('invalid signature');
    return;
  }
  res.status(200).send('ok'); // acknowledge immediately so Meta doesn't retry
  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        // Delivery status callbacks: sent / delivered / read / failed
        for (const st of change.value?.statuses || []) {
          if (st.id && st.status) applyStatusUpdate(st.id, st.status);
        }

        for (const msg of change.value?.messages || []) {
          const phone = msg.from;
          if (!phone) continue;
          if (msg.id) markAsRead(msg.id).catch(() => undefined);
          const tenantId = resolveTenantForPhone(phone);
          if (msg.type && msg.type !== 'text') {
            // Real-life: patients send audio/images — answer politely instead of ignoring
            persistIncoming(phone, `[${msg.type}]`, msg.id, tenantId);
            const locale = detectUserLocale('');
            await reply(phone, locale, 'unsupported_type', {}, tenantId);
            continue;
          }
          const body = msg.text?.body || '';
          const locale = detectUserLocale(body);
          persistIncoming(phone, body, msg.id, tenantId);
          await handleMessage(phone, body, locale, tenantId);
        }
      }
    }
  } catch (e) {
    console.error('WA webhook error:', e);
  }
});

// Staff inbox view — inbound-first conversation list with last-message preview
router.get('/conversations', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, p.full_name AS patient_name,
      (
        SELECT m.body FROM whatsapp_messages m
        WHERE m.tenant_id = c.tenant_id
          AND m.phone = c.phone
        ORDER BY m.created_at DESC LIMIT 1
      ) AS last_message_body,
      (
        SELECT m.direction FROM whatsapp_messages m
        WHERE m.tenant_id = c.tenant_id
          AND m.phone = c.phone
        ORDER BY m.created_at DESC LIMIT 1
      ) AS last_message_direction
    FROM whatsapp_conversations c
    LEFT JOIN patients p ON p.id = c.patient_id
    WHERE c.tenant_id = ?
    ORDER BY
      CASE WHEN c.state = 'awaiting_human' THEN 0 ELSE 1 END,
      c.last_message_at DESC
    LIMIT 200
  `).all(req.tenantId) as any[];

  const conversations = rows.map((c) => ({
    ...c,
    needs_human: c.state === 'awaiting_human',
    inbound_waiting: c.last_message_direction === 'in' && c.state !== 'awaiting_human' && !c.opted_out,
    awaiting_bot: String(c.state || '').startsWith('awaiting_') && c.state !== 'awaiting_human',
  }));
  res.json({ conversations });
});

/** Staff claims a human handoff — clears awaiting_human so the bot does not steal the thread. */
router.post('/conversations/:phone/claim', authenticate, requireRole('admin', 'receptionist', 'doctor', 'nurse'), (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone);
  let updated = false;
  for (const p of phoneLookupVariants(phone)) {
    const conv = db.prepare(`SELECT id, state FROM whatsapp_conversations WHERE phone = ? AND tenant_id = ?`).get(p, req.tenantId) as any;
    if (!conv) continue;
    updateConversation(p, req.tenantId!, { state: 'idle' });
    updated = true;
    logAudit({
      tenantId: req.tenantId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'whatsapp_claim_conversation',
      resourceType: 'whatsapp_conversation',
      resourceId: p,
      legalBasis: 'consent_art7_I',
      afterValue: { from_state: conv.state, to_state: 'idle' },
    });
    break;
  }
  if (!updated) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true, phone, state: 'idle' });
});

router.get('/messages', authenticate, (req: Request, res: Response) => {
  const phone = req.query.phone as string;
  if (!phone) { res.status(400).json({ error: 'phone required' }); return; }
  res.json({
    messages: listMessagesForPhones(req.tenantId!, phoneLookupVariants(phone), 200, 'asc'),
  });
});

// Staff sends a message to a patient
router.post('/send', authenticate, requireRole('admin','receptionist','doctor','nurse'), async (req: Request, res: Response) => {
  const phone = req.body.phone as string;
  const body = req.body.body as string;
  if (!phone || !body) { res.status(400).json({ error: 'phone and body required' }); return; }
  let opted = false;
  for (const p of phoneLookupVariants(phone)) {
    const conv = db.prepare(`SELECT opted_out FROM whatsapp_conversations WHERE phone = ? AND tenant_id = ?`).get(p, req.tenantId) as any;
    if (conv?.opted_out) { opted = true; break; }
  }
  if (opted) {
    res.status(409).json({ error: 'opted_out', message: 'This number has opted out (LGPD). Message not sent.' });
    return;
  }
  // Link conversation to patient when phone matches a record
  try {
    const digits = String(phone).replace(/\D/g, '');
    const patient = db.prepare(`
      SELECT id FROM patients WHERE tenant_id = ? AND (
        phone = ? OR replace(replace(replace(phone,'+',''),'-',''),' ','') = ?
      ) LIMIT 1
    `).get(req.tenantId, phone, digits) as any;
    if (patient?.id) {
      ensurePatientConversation(req.tenantId!, phone, patient.id);
    }
  } catch { /* ignore */ }
  const result = await sendTextMessage(phone, body, req.tenantId!);
  // Staff reply claims the thread — leave awaiting_human
  try {
    for (const p of phoneLookupVariants(phone)) {
      const conv = db.prepare(`SELECT state FROM whatsapp_conversations WHERE phone = ? AND tenant_id = ?`).get(p, req.tenantId) as any;
      if (conv?.state === 'awaiting_human') {
        updateConversation(p, req.tenantId!, { state: 'idle' });
        break;
      }
    }
  } catch { /* ignore */ }
  logAudit({ tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'whatsapp_staff_send', resourceType: 'whatsapp_conversation', resourceId: phone, legalBasis: 'consent_art7_I' });
  res.status(result.ok ? 200 : 502).json(result);
});

// Delete a conversation + its messages (staff inbox cleanup; LGPD minimization)
router.delete('/conversations/:phone', authenticate, requireRole('admin','receptionist'), (req: Request, res: Response) => {
  const phone = req.params.phone;
  const conv = db.prepare(`SELECT id FROM whatsapp_conversations WHERE phone = ? AND tenant_id = ?`).get(phone, req.tenantId) as any;
  if (!conv) { res.status(404).json({ error: 'not_found' }); return; }
  db.prepare(`DELETE FROM whatsapp_messages WHERE phone = ? AND tenant_id = ?`).run(phone, req.tenantId);
  db.prepare(`DELETE FROM whatsapp_conversations WHERE phone = ? AND tenant_id = ?`).run(phone, req.tenantId);
  logAudit({ tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'whatsapp_conversation_deleted', resourceType: 'whatsapp_conversation', resourceId: phone, legalBasis: 'legal_obligation_art7_II' });
  res.json({ ok: true, deleted_phone: phone });
});

// Simulator — for testing Flow Doctor without Meta (defaults to pt-BR)
router.post('/simulate', authenticate, async (req: Request, res: Response) => {
  const phone = req.body.phone as string;
  const body = req.body.body as string;
  const locale: Locale = req.body.locale || 'pt-BR';
  if (!phone || !body) { res.status(400).json({ error: 'phone and body required' }); return; }
  persistIncoming(phone, body, undefined, req.tenantId!);
  await handleMessage(phone, body, locale, req.tenantId!);
  const outbox = db.prepare(`
    SELECT * FROM whatsapp_messages WHERE phone = ? AND tenant_id = ? AND direction = 'out' ORDER BY rowid DESC LIMIT 1
  `).get(phone, req.tenantId);
  res.json({ ok: true, last_bot_reply: outbox });
});

router.get('/status', authenticate, (req, res) => {
  const live = !!(process.env.META_WA_TOKEN && process.env.META_WA_PHONE_ID);
  res.json({
    live,
    phone_id: process.env.META_WA_PHONE_ID ? '***configured***' : null,
    app_secret_configured: !!process.env.META_WA_APP_SECRET,
    verify_token_configured: !!process.env.META_WA_VERIFY_TOKEN,
    conversations_count: (db.prepare(`SELECT COUNT(*) as c FROM whatsapp_conversations WHERE tenant_id = ?`).get(req.tenantId) as any).c,
    messages_count: (db.prepare(`SELECT COUNT(*) as c FROM whatsapp_messages WHERE tenant_id = ?`).get(req.tenantId) as any).c,
  });
});

// Live connectivity check — actually calls the Meta Graph API
router.get('/ping', authenticate, requireRole('admin','receptionist'), async (_req, res) => {
  res.json(await pingMeta());
});

/* ------------------------------------------------------------------
 * Satisfaction surveys (NPS) — dispatched after completed appointments
 * ------------------------------------------------------------------ */

router.get('/surveys', authenticate, (req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT s.*, p.full_name AS patient_name
    FROM satisfaction_surveys s JOIN patients p ON p.id = s.patient_id
    WHERE s.tenant_id = ?
    ORDER BY s.created_at DESC LIMIT 200
  `).all(req.tenantId) as any[];
  const total = rows.length;
  const avg = total ? rows.reduce((s, r) => s + r.score, 0) / total : 0;
  const promoters = rows.filter((r) => r.score >= 9).length;
  const detractors = rows.filter((r) => r.score <= 6).length;
  const nps = total ? Math.round(((promoters - detractors) / total) * 100) : 0;
  res.json({ total, average: Math.round(avg * 100) / 100, nps, promoters, passives: total - promoters - detractors, detractors, surveys: rows });
});

// Send the NPS question to patients with recently completed appointments
// who haven't answered yet. Bot picks it up from state awaiting_nps_score.
router.post('/surveys/dispatch', authenticate, requireRole('admin','receptionist'), async (req: Request, res: Response) => {
  const days = Math.min(parseInt(req.body?.days ?? '7', 10) || 7, 90);
  const pending = db.prepare(`
    SELECT a.id AS appointment_id, a.scheduled_at, p.id AS patient_id, p.full_name, p.phone
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    WHERE a.tenant_id = ? AND a.status = 'completed'
      AND a.scheduled_at >= datetime('now', ?)
      AND a.scheduled_at <= datetime('now')
      AND p.lgpd_opt_out_marketing = 0
      AND NOT EXISTS (SELECT 1 FROM satisfaction_surveys s WHERE s.appointment_id = a.id AND s.tenant_id = a.tenant_id)
      AND p.phone NOT IN (SELECT phone FROM whatsapp_conversations WHERE opted_out = 1 AND tenant_id = ?)
    ORDER BY a.scheduled_at DESC LIMIT 100
  `).all(req.tenantId, `-${days} days`, req.tenantId) as any[];

  let dispatched = 0;
  const locale = (process.env.DEFAULT_LOCALE as Locale) || 'pt-BR';
  for (const row of pending) {
    const conv = getOrCreateConversation(row.phone, req.tenantId!);
    if (conv.state !== 'idle' && conv.state !== 'lgpd_optout') continue; // don't hijack an active flow
    updateConversation(row.phone, req.tenantId!, {
      state: 'awaiting_nps_score',
      patient_id: row.patient_id,
      context: { patient_id: row.patient_id, appointment_id: row.appointment_id, survey: true },
    });
    const firstName = row.full_name.split(' ')[0];
    await reply(row.phone, locale, 'nps_ask', { name: `, ${firstName}` }, req.tenantId!);
    dispatched++;
  }
  logAudit({ tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'nps_dispatch',
             afterValue: { dispatched, window_days: days }, legalBasis: 'consent_art7_I' });
  res.json({ ok: true, dispatched, candidates: pending.length, dry_run: !isLive() });
});

/* ------------------------------------------------------------------
 * Campaigns / promotions (customer appreciation day, offers…)
 * ------------------------------------------------------------------ */

router.get('/campaigns', authenticate, (req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT c.*, u.full_name AS created_by_name FROM campaigns c
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.tenant_id = ?
    ORDER BY c.created_at DESC LIMIT 100
  `).all(req.tenantId);
  res.json({ campaigns: rows });
});

router.post('/campaigns', authenticate, requireRole('admin','receptionist'), (req: Request, res: Response) => {
  const { name, message, scheduled_for, audience, template_id, category } = req.body ?? {};
  if (!name || !message || typeof name !== 'string' || typeof message !== 'string') {
    res.status(400).json({ error: 'validation', required: ['name', 'message'] });
    return;
  }
  const segment = (audience || 'all_consented') as AudienceSegment;
  const id = uuid();
  db.prepare(`
    INSERT INTO campaigns (id, tenant_id, name, message, scheduled_for, created_by, audience, template_id, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.tenantId, name.trim(), message.trim(), scheduled_for ?? null, req.user!.id,
    segment, template_id ?? null, category === 'utility' ? 'utility' : 'marketing',
  );
  logAudit({ tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'campaign_created',
             resourceType: 'campaign', resourceId: id, afterValue: { name, audience: segment }, legalBasis: 'consent_art7_I' });
  res.status(201).json({ id });
});

// Blast the campaign to segmented, consented, non-opted-out patients (LGPD art. 7º I)
router.post('/campaigns/:id/dispatch', authenticate, requireRole('admin','receptionist'), async (req: Request, res: Response) => {
  const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!campaign) { res.status(404).json({ error: 'not_found' }); return; }
  if (campaign.status === 'sent') { res.status(409).json({ error: 'already_sent' }); return; }

  const segment = (campaign.audience || 'all_consented') as AudienceSegment;
  const audience = listAudience(req.tenantId!, segment);

  db.prepare(`UPDATE campaigns SET status = 'sending' WHERE id = ? AND tenant_id = ?`).run(campaign.id, req.tenantId);
  const locale = (process.env.DEFAULT_LOCALE as Locale) || 'pt-BR';
  const footer = campaign.category === 'utility' ? '' : t(locale, 'whatsapp.promo_footer', {});
  let sent = 0, failed = 0;
  for (const p of audience) {
    const firstName = p.full_name.split(' ')[0];
    const body = campaign.message.replaceAll('{{name}}', firstName) + footer;
    const result = await sendTextMessage(p.phone, body, req.tenantId!);
    if (result.ok) sent++; else failed++;
  }
  db.prepare(`
    UPDATE campaigns SET status = 'sent', sent_count = ?, failed_count = ?, skipped_count = 0,
           dispatched_at = datetime('now') WHERE id = ? AND tenant_id = ?
  `).run(sent, failed, campaign.id, req.tenantId);
  logAudit({ tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'campaign_dispatched',
             resourceType: 'campaign', resourceId: campaign.id,
             afterValue: { sent, failed, audience: audience.length, segment }, legalBasis: 'consent_art7_I' });
  res.json({ ok: true, sent, failed, audience: audience.length, segment, dry_run: !isLive() });
});

router.delete('/campaigns/:id', authenticate, requireRole('admin','receptionist'), (req: Request, res: Response) => {
  const campaign = db.prepare(`SELECT id, status FROM campaigns WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!campaign) { res.status(404).json({ error: 'not_found' }); return; }
  if (campaign.status !== 'draft') { res.status(409).json({ error: 'not_draft', message: 'Only draft campaigns can be deleted.' }); return; }
  db.prepare(`DELETE FROM campaigns WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  logAudit({ tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'campaign_deleted',
             resourceType: 'campaign', resourceId: req.params.id, legalBasis: 'legal_obligation_art7_II' });
  res.json({ ok: true, deleted_id: req.params.id });
});

/* ------------------------------------------------------------------
 * Marketing hub — templates, automations, audience, analytics
 * ------------------------------------------------------------------ */

router.get('/templates', authenticate, (req: Request, res: Response) => {
  linkTemplateAutomations(req.tenantId!);
  const rows = db.prepare(`
    SELECT t.*,
      a.id AS automation_id,
      a.key AS automation_key,
      a.name AS automation_name,
      a.enabled AS automation_enabled,
      a.last_run_at AS automation_last_run_at,
      a.last_sent_count AS automation_last_sent_count
    FROM wa_templates t
    LEFT JOIN wa_automations a ON a.template_id = t.id AND a.tenant_id = t.tenant_id
    WHERE t.tenant_id = ?
    ORDER BY t.category, t.name
  `).all(req.tenantId) as any[];
  const stats = audienceStats(req.tenantId!);
  const templates = rows.map((tpl) => {
    const suggested_segment = suggestedSegmentForTemplate(tpl);
    return {
      ...tpl,
      suggested_segment,
      suggested_automation_key: suggestedAutomationKeyForTemplate(tpl),
      audience_count: stats.segments[suggested_segment] ?? 0,
    };
  });
  res.json({ templates, segments: stats.segments });
});

router.post('/templates', authenticate, requireRole('admin','receptionist'), (req: Request, res: Response) => {
  const { name, category, body, header, footer, language, status, meta_name } = req.body ?? {};
  if (!name || !body || !category) {
    res.status(400).json({ error: 'validation', required: ['name', 'category', 'body'] });
    return;
  }
  if (!['marketing', 'utility', 'authentication'].includes(category)) {
    res.status(400).json({ error: 'validation', message: 'invalid category' });
    return;
  }
  const id = uuid();
  db.prepare(`
    INSERT INTO wa_templates (id, tenant_id, name, category, language, body, header, footer, status, meta_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.tenantId, String(name).trim(), category, language || 'pt_BR', String(body).trim(),
    header ?? null, footer ?? null,
    ['draft', 'pending', 'approved', 'rejected'].includes(status) ? status : 'draft',
    meta_name ?? null,
  );
  logAudit({ tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'wa_template_created',
             resourceType: 'wa_template', resourceId: id, afterValue: { name, category }, legalBasis: 'legitimate_interest_art7_VI' });
  res.status(201).json({ id });
});

router.put('/templates/:id', authenticate, requireRole('admin','receptionist'), (req: Request, res: Response) => {
  const existing = db.prepare(`SELECT * FROM wa_templates WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!existing) { res.status(404).json({ error: 'not_found' }); return; }
  const name = req.body?.name ?? existing.name;
  const category = req.body?.category ?? existing.category;
  const body = req.body?.body ?? existing.body;
  const header = req.body?.header !== undefined ? req.body.header : existing.header;
  const footer = req.body?.footer !== undefined ? req.body.footer : existing.footer;
  const status = req.body?.status ?? existing.status;
  const meta_name = req.body?.meta_name !== undefined ? req.body.meta_name : existing.meta_name;
  if (!['marketing', 'utility', 'authentication'].includes(category)) {
    res.status(400).json({ error: 'validation', message: 'invalid category' });
    return;
  }
  db.prepare(`
    UPDATE wa_templates SET name=?, category=?, body=?, header=?, footer=?, status=?, meta_name=?, updated_at=datetime('now')
    WHERE id=? AND tenant_id=?
  `).run(name, category, body, header, footer, status, meta_name, req.params.id, req.tenantId);
  // Keep bound automation message in sync when body changes
  if (body !== existing.body) {
    db.prepare(`
      UPDATE wa_automations SET message = ?, updated_at = datetime('now')
      WHERE template_id = ? AND tenant_id = ?
    `).run(body, req.params.id, req.tenantId);
  }
  res.json({ ok: true });
});

router.delete('/templates/:id', authenticate, requireRole('admin'), (req: Request, res: Response) => {
  const existing = db.prepare(`SELECT id FROM wa_templates WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId);
  if (!existing) { res.status(404).json({ error: 'not_found' }); return; }
  db.prepare(`UPDATE wa_automations SET template_id = NULL WHERE template_id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  db.prepare(`DELETE FROM wa_templates WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  res.json({ ok: true });
});

/**
 * Send template to an audience segment (HubSpot-style campaign from template).
 * Creates a campaign row; when dispatch=true, sends immediately via WhatsApp text.
 */
router.post('/templates/:id/send', authenticate, requireRole('admin','receptionist'), async (req: Request, res: Response) => {
  const tpl = db.prepare(`SELECT * FROM wa_templates WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!tpl) { res.status(404).json({ error: 'not_found' }); return; }
  if (tpl.status !== 'approved') { res.status(409).json({ error: 'template_not_approved' }); return; }

  const segment = (req.body?.audience || suggestedSegmentForTemplate(tpl)) as AudienceSegment;
  const allowed: AudienceSegment[] = [
    'all_consented', 'recent_30d', 'inactive_90d', 'birthday_month', 'upcoming_7d', 'high_nps',
  ];
  if (!allowed.includes(segment)) {
    res.status(400).json({ error: 'validation', message: 'invalid audience segment' });
    return;
  }
  const dispatch = req.body?.dispatch !== false && req.body?.dispatch !== 0;
  const campaignName = String(req.body?.name || `${tpl.name} — ${new Date().toLocaleDateString('pt-BR')}`).trim();
  const category = tpl.category === 'utility' || tpl.category === 'authentication' ? 'utility' : 'marketing';
  const audience = listAudience(req.tenantId!, segment);
  const campaignId = uuid();

  db.prepare(`
    INSERT INTO campaigns (id, tenant_id, name, message, scheduled_for, created_by, audience, template_id, category)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run(campaignId, req.tenantId, campaignName, tpl.body, req.user!.id, segment, tpl.id, category);

  logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'wa_template_campaign_created', resourceType: 'campaign', resourceId: campaignId,
    afterValue: { template_id: tpl.id, audience: segment, dispatch }, legalBasis: 'consent_art7_I',
  });

  if (!dispatch) {
    res.status(201).json({
      ok: true,
      campaign_id: campaignId,
      status: 'draft',
      audience: segment,
      audience_count: audience.length,
      dry_run: !isLive(),
    });
    return;
  }

  db.prepare(`UPDATE campaigns SET status = 'sending' WHERE id = ? AND tenant_id = ?`).run(campaignId, req.tenantId);
  let sent = 0, failed = 0;
  const locale = (process.env.DEFAULT_LOCALE as Locale) || 'pt-BR';
  const footer = category === 'marketing' ? t(locale, 'whatsapp.promo_footer', {}) : '';
  for (const p of audience) {
    const firstName = String(p.full_name || '').split(' ')[0] || '';
    const body = tpl.body.replaceAll('{{name}}', firstName) + footer;
    const result = await sendTextMessage(p.phone, body, req.tenantId!);
    if (result.ok) sent++; else failed++;
  }
  db.prepare(`
    UPDATE campaigns SET status = 'sent', sent_count = ?, failed_count = ?, skipped_count = 0,
      dispatched_at = datetime('now') WHERE id = ? AND tenant_id = ?
  `).run(sent, failed, campaignId, req.tenantId);

  logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'campaign_dispatched', resourceType: 'campaign', resourceId: campaignId,
    afterValue: { sent, failed, audience: audience.length, segment, template_id: tpl.id },
    legalBasis: 'consent_art7_I',
  });

  res.status(201).json({
    ok: true,
    campaign_id: campaignId,
    status: 'sent',
    audience: segment,
    audience_count: audience.length,
    sent,
    failed,
    dry_run: !isLive(),
  });
});

/**
 * Bind template to an automation trigger (HubSpot "publish for automation").
 * Body: { automation_id?: string, enable?: boolean }
 * If automation_id omitted, uses the suggested automation for this template's meta_name.
 */
router.post('/templates/:id/automate', authenticate, requireRole('admin','receptionist'), (req: Request, res: Response) => {
  const tpl = db.prepare(`SELECT * FROM wa_templates WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!tpl) { res.status(404).json({ error: 'not_found' }); return; }
  if (tpl.status !== 'approved') { res.status(409).json({ error: 'template_not_approved' }); return; }

  let automationId = req.body?.automation_id as string | undefined;
  if (!automationId) {
    const key = suggestedAutomationKeyForTemplate(tpl);
    if (!key) {
      res.status(400).json({ error: 'no_suggested_automation', message: 'Pick an automation_id for this template' });
      return;
    }
    const auto = db.prepare(`
      SELECT id FROM wa_automations WHERE tenant_id = ? AND key = ?
    `).get(req.tenantId, key) as any;
    if (!auto) { res.status(404).json({ error: 'automation_not_found', key }); return; }
    automationId = auto.id;
  }

  const enable = req.body?.enable !== undefined ? Boolean(req.body.enable) : true;
  const result = bindTemplateToAutomation({
    tenantId: req.tenantId!,
    templateId: tpl.id,
    automationId: automationId!,
    enable,
  });
  if (!result.ok) {
    res.status(result.error === 'automation_not_found' || result.error === 'template_not_found' ? 404 : 409).json(result);
    return;
  }

  const auto = db.prepare(`
    SELECT id, key, name, enabled, template_id FROM wa_automations WHERE id = ? AND tenant_id = ?
  `).get(automationId, req.tenantId);

  logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'wa_template_bound_automation', resourceType: 'wa_template', resourceId: tpl.id,
    afterValue: { automation_id: automationId, enable }, legalBasis: 'legitimate_interest_art7_VI',
  });

  res.json({ ok: true, automation: auto });
});

router.get('/automations', authenticate, (req: Request, res: Response) => {
  linkTemplateAutomations(req.tenantId!);
  const rows = db.prepare(`
    SELECT a.*, t.name AS template_name, t.meta_name AS template_meta_name
    FROM wa_automations a
    LEFT JOIN wa_templates t ON t.id = a.template_id
    WHERE a.tenant_id = ? ORDER BY a.name
  `).all(req.tenantId);
  res.json({ automations: rows });
});

router.put('/automations/:id', authenticate, requireRole('admin','receptionist'), (req: Request, res: Response) => {
  const existing = db.prepare(`SELECT * FROM wa_automations WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!existing) { res.status(404).json({ error: 'not_found' }); return; }
  const enabled = req.body?.enabled !== undefined ? (req.body.enabled ? 1 : 0) : existing.enabled;
  let message = req.body?.message ?? existing.message;
  const template_id = req.body?.template_id !== undefined ? req.body.template_id : existing.template_id;
  if (req.body?.template_id) {
    const tpl = db.prepare(`SELECT body, status FROM wa_templates WHERE id = ? AND tenant_id = ?`).get(req.body.template_id, req.tenantId) as any;
    if (tpl?.body && tpl.status === 'approved' && req.body?.message === undefined) {
      message = tpl.body;
    }
  }
  const config = req.body?.config !== undefined
    ? (typeof req.body.config === 'string' ? req.body.config : JSON.stringify(req.body.config))
    : existing.config;
  db.prepare(`
    UPDATE wa_automations SET enabled=?, message=?, template_id=?, config=?, updated_at=datetime('now')
    WHERE id=? AND tenant_id=?
  `).run(enabled, message, template_id, config, req.params.id, req.tenantId);
  res.json({ ok: true });
});

router.post('/automations/:id/run', authenticate, requireRole('admin','receptionist'), async (req: Request, res: Response) => {
  const locale = (process.env.DEFAULT_LOCALE as Locale) || 'pt-BR';
  const result = await runAutomation(req.tenantId!, req.params.id, locale);
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'disabled' ? 409 : 400;
    res.status(status).json(result);
    return;
  }
  logAudit({ tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'wa_automation_run',
             resourceType: 'wa_automation', resourceId: req.params.id, afterValue: result, legalBasis: 'consent_art7_I' });
  res.json(result);
});

router.get('/audience', authenticate, (req: Request, res: Response) => {
  const segment = (String(req.query.segment || 'all_consented')) as AudienceSegment;
  const stats = audienceStats(req.tenantId!);
  const preview = listAudience(req.tenantId!, segment).slice(0, 50);
  res.json({ ...stats, segment, preview });
});

router.get('/analytics', authenticate, (req: Request, res: Response) => {
  res.json(marketingAnalytics(req.tenantId!));
});

export { handleMessage, detectUserLocale, SPECIALTIES };
export default router;
