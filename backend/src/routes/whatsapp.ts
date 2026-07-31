/**
 * WhatsApp bot — state machine for appointment booking + LGPD consent + opt-out
 * Supports pt-BR, es, en (auto-detected from message content)
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
} from '../services/whatsapp';
import { getAvailableSlots, getPractitionerLoads } from '../services/availability';

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

async function reply(phone: string, locale: Locale, key: string, vars: Record<string, string | number> = {}): Promise<void> {
  const body = t(locale, `whatsapp.${key}`, { ...vars, clinic: t(locale, 'app.name') });
  await sendTextMessage(phone, body);
}

async function handleMessage(phone: string, body: string, locale: Locale): Promise<void> {
  const conv = getOrCreateConversation(phone);
  const ctx = conv.context ? JSON.parse(conv.context) : {};
  const text = body.trim();
  const lower = text.toLowerCase();

  // Global opt-out
  if (['sair', 'stop', 'cancelar tudo', 'remover', 'exit', 'salir', 'unsubscribe'].includes(lower) && conv.state !== 'awaiting_consent') {
    updateConversation(phone, { state: 'lgpd_optout', opt_out: true });
    db.prepare(`UPDATE patients SET lgpd_opt_out_marketing = 1 WHERE phone = ?`).run(phone);
    logAudit({ action: 'whatsapp_optout', resourceType: 'whatsapp_conversation', resourceId: phone, legalBasis: 'consent_art7_I' });
    await reply(phone, locale, 'lgpd_optout_confirmed');
    return;
  }

  // LGPD consent prompts
  if (['sim', 's', 'si', 'sí', 'yes', 'y', 'aceito'].includes(lower) && conv.state === 'awaiting_consent') {
    recordConsent({
      subjectType: 'patient', subjectId: conv.patient_id || 'pending',
      consentType: 'whatsapp_communication', granted: true,
      policyVersion: '1.0', evidence: `WhatsApp consent at ${new Date().toISOString()} via bot.`,
    });
    updateConversation(phone, { state: 'idle', consent: true });
    await reply(phone, locale, 'lgpd_consent_granted');
    await reply(phone, locale, 'bot_menu');
    return;
  }
  if (['não', 'nao', 'n', 'no', 'rechazo', 'rejeito'].includes(lower) && conv.state === 'awaiting_consent') {
    recordConsent({
      subjectType: 'patient', subjectId: conv.patient_id || 'pending',
      consentType: 'whatsapp_communication', granted: false,
      policyVersion: '1.0',
    });
    updateConversation(phone, { state: 'lgpd_optout', opt_out: true });
    await reply(phone, locale, 'lgpd_optout_confirmed');
    return;
  }

  // State machine
  switch (conv.state) {
    case 'idle': {
      if (['1', 'agendar', 'book', 'cita', 'agendar consulta', 'agendar uma consulta'].some(k => lower.includes(k))) {
        updateConversation(phone, { state: 'awaiting_cpf' });
        await reply(phone, locale, 'ask_cpf');
        return;
      }
      if (['2', 'consultas', 'appointments', 'citas', 'minhas'].some(k => lower.includes(k))) {
        const appts = db.prepare(`
          SELECT a.scheduled_at, a.type, u.full_name AS practitioner
          FROM appointments a JOIN users u ON u.id = a.practitioner_id
          WHERE a.patient_id = (SELECT id FROM patients WHERE phone = ?)
            AND a.scheduled_at >= datetime('now')
            AND a.status NOT IN ('cancelled','no_show','completed')
          ORDER BY a.scheduled_at ASC LIMIT 5
        `).all(phone);
        if (!appts.length) {
          await sendTextMessage(phone, locale === 'en' ? 'You have no upcoming appointments.' : locale === 'es' ? 'No tienes citas próximas.' : 'Você não tem consultas agendadas.');
        } else {
          const lines = appts.map((a: any) => `📅 ${a.scheduled_at} — ${a.type} (${a.practitioner})`).join('\n');
          await sendTextMessage(phone, lines);
        }
        await reply(phone, locale, 'bot_menu');
        return;
      }
      if (['3', 'cancelar', 'cancel'].some(k => lower.includes(k))) {
        const appts = db.prepare(`
          SELECT a.id, a.scheduled_at, u.full_name AS practitioner
          FROM appointments a JOIN users u ON u.id = a.practitioner_id
          WHERE a.patient_id = (SELECT id FROM patients WHERE phone = ?)
            AND a.scheduled_at >= datetime('now')
            AND a.status NOT IN ('cancelled','no_show','completed')
          ORDER BY a.scheduled_at ASC LIMIT 9
        `).all(phone) as any[];
        if (!appts.length) {
          await reply(phone, locale, 'cancel_none');
          await reply(phone, locale, 'bot_menu');
          return;
        }
        const list = appts.map((a, i) => {
          const [d, h] = a.scheduled_at.split(' ');
          return `${i + 1}️⃣ ${d.split('-').reverse().join('/')} ${h.slice(0, 5)} — ${a.practitioner}`;
        }).join('\n');
        updateConversation(phone, { state: 'awaiting_cancel_choice', context: { ...ctx, cancel_ids: appts.map(a => a.id) } });
        await reply(phone, locale, 'cancel_ask_choice', { list });
        return;
      }
      if (['4', 'humano', 'atendente', 'recepção', 'reception', 'agente'].some(k => lower.includes(k))) {
        await reply(phone, locale, 'transfer_to_human');
        return;
      }
      if (['5', 'remover dados', 'deletar', 'apagar', 'lgpd', 'deletion'].some(k => lower.includes(k))) {
        const p = db.prepare(`SELECT id FROM patients WHERE phone = ?`).get(phone) as any;
        if (p) {
          const reqId = db.prepare(`
            INSERT INTO lgpd_data_requests (id, request_type, subject_type, subject_id, status)
            VALUES (?, 'deletion', 'patient', ?, 'open')
          `).run(uuid(), p.id);
          logAudit({ action: 'lgpd_deletion_request_whatsapp', resourceType: 'patient', resourceId: p.id, legalBasis: 'consent_art7_I' });
        }
        await reply(phone, locale, 'request_received');
        return;
      }
      // Default: show menu
      await reply(phone, locale, 'bot_menu');
      return;
    }

    case 'awaiting_cpf': {
      const cpf = text.replace(/\D/g, '');
      if (cpf.length !== 11) { await reply(phone, locale, 'ask_cpf'); return; }
      const p = db.prepare(`SELECT * FROM patients WHERE cpf = ?`).get(cpf) as any;
      if (!p) {
        await reply(phone, locale, 'not_found');
        updateConversation(phone, { state: 'idle' });
        return;
      }
      updateConversation(phone, { state: 'awaiting_booking_specialty', patient_id: p.id, context: { ...ctx, cpf, patient_id: p.id } });
      await reply(phone, locale, 'ask_specialty');
      return;
    }

    case 'awaiting_booking_specialty': {
      const idx = parseInt(lower) - 1;
      if (idx < 0 || idx >= SPECIALTIES.length) { await reply(phone, locale, 'ask_specialty'); return; }
      const specialty = SPECIALTIES[idx];
      updateConversation(phone, { state: 'awaiting_booking_date', context: { ...ctx, specialty: specialty.code } });
      await reply(phone, locale, 'ask_date');
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
      if (!date) { await reply(phone, locale, 'ask_date'); return; }
      // Pick the doctor with the most room that day — same availability
      // service the calendar/scheduler uses, so channels never conflict.
      const loads = getPractitionerLoads(date);
      const practitioner = loads.find((l) => l.free > 0);
      if (!practitioner) {
        await reply(phone, locale, 'no_slots');
        return;
      }
      const candidates = getAvailableSlots(practitioner.id, date);
      if (!candidates.length) { await reply(phone, locale, 'no_slots'); return; }
      const slot = candidates[0];
      // Create appointment
      const apptId = uuid();
      db.prepare(`
        INSERT INTO appointments (id, patient_id, practitioner_id, scheduled_at, duration_minutes, type, status, source, whatsapp_message_id)
        VALUES (?, ?, ?, ?, 30, 'consultation', 'scheduled', 'whatsapp_bot', ?)
      `).run(apptId, ctx.patient_id, practitioner.id, slot, phone);

      const hour = slot.split(' ')[1].slice(0, 5);
      const dateStr = slot.split(' ')[0].split('-').reverse().join('/');
      await reply(phone, locale, 'booking_confirmed', {
        date: dateStr, time: hour, practitioner: practitioner.full_name,
        address: t(locale, 'app.address'),
      });
      updateConversation(phone, { state: 'idle', context: {} });
      logAudit({ action: 'whatsapp_booking_created', resourceType: 'appointment', resourceId: apptId, legalBasis: 'contract_art7_V' });
      return;
    }

    case 'awaiting_cancel_choice': {
      const ids: string[] = ctx.cancel_ids || [];
      if (lower === '0') {
        updateConversation(phone, { state: 'idle', context: {} });
        await reply(phone, locale, 'bot_menu');
        return;
      }
      const idx = parseInt(lower, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= ids.length) {
        await reply(phone, locale, 'cancel_invalid');
        return;
      }
      const appt = db.prepare(`
        SELECT a.id, a.scheduled_at, u.full_name AS practitioner
        FROM appointments a JOIN users u ON u.id = a.practitioner_id WHERE a.id = ?
      `).get(ids[idx]) as any;
      if (!appt) {
        await reply(phone, locale, 'cancel_invalid');
        return;
      }
      db.prepare(`UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(appt.id);
      logAudit({ action: 'whatsapp_booking_cancelled', resourceType: 'appointment', resourceId: appt.id, legalBasis: 'contract_art7_V' });
      updateConversation(phone, { state: 'idle', context: {} });
      const [d, h] = appt.scheduled_at.split(' ');
      await reply(phone, locale, 'cancel_done', {
        date: d.split('-').reverse().join('/'), time: h.slice(0, 5), practitioner: appt.practitioner,
      });
      await reply(phone, locale, 'bot_menu');
      return;
    }

    case 'awaiting_nps_score': {
      const score = parseInt(lower, 10);
      if (Number.isNaN(score) || score < 0 || score > 10) {
        await reply(phone, locale, 'nps_invalid');
        return;
      }
      updateConversation(phone, { state: 'awaiting_nps_comment', context: { ...ctx, score } });
      await reply(phone, locale, 'nps_ask_comment', { score });
      return;
    }

    case 'awaiting_nps_comment': {
      const skipWords = ['pular', 'saltar', 'skip', 'pular.', 'não', 'nao', 'no'];
      const comment = skipWords.includes(lower) ? null : text.slice(0, 1000);
      const surveyId = uuid();
      db.prepare(`
        INSERT INTO satisfaction_surveys (id, patient_id, appointment_id, score, comment, source)
        VALUES (?, ?, ?, ?, ?, 'whatsapp_bot')
      `).run(surveyId, ctx.patient_id, ctx.appointment_id ?? null, ctx.score, comment);
      logAudit({ action: 'nps_survey_received', resourceType: 'satisfaction_survey', resourceId: surveyId,
                 afterValue: { score: ctx.score }, legalBasis: 'consent_art7_I' });
      updateConversation(phone, { state: 'idle', context: {} });
      await reply(phone, locale, 'nps_thanks');
      await reply(phone, locale, 'bot_menu');
      return;
    }

    default: {
      await reply(phone, locale, 'bot_menu');
      updateConversation(phone, { state: 'idle' });
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
          if (msg.type && msg.type !== 'text') {
            // Real-life: patients send audio/images — answer politely instead of ignoring
            persistIncoming(phone, `[${msg.type}]`, msg.id);
            const locale = detectUserLocale('');
            await reply(phone, locale, 'unsupported_type');
            continue;
          }
          const body = msg.text?.body || '';
          const locale = detectUserLocale(body);
          persistIncoming(phone, body, msg.id);
          await handleMessage(phone, body, locale);
        }
      }
    }
  } catch (e) {
    console.error('WA webhook error:', e);
  }
});

// Staff inbox view
router.get('/conversations', authenticate, (_req, res) => {
  res.json({ conversations: db.prepare(`
    SELECT c.*, p.full_name AS patient_name
    FROM whatsapp_conversations c LEFT JOIN patients p ON p.id = c.patient_id
    ORDER BY c.last_message_at DESC LIMIT 200
  `).all() });
});

router.get('/messages', authenticate, (req: Request, res: Response) => {
  const phone = req.query.phone as string;
  if (!phone) { res.status(400).json({ error: 'phone required' }); return; }
  res.json({ messages: db.prepare(`
    SELECT * FROM whatsapp_messages WHERE phone = ? ORDER BY rowid ASC LIMIT 200
  `).all(phone) });
});

// Staff sends a message to a patient
router.post('/send', authenticate, requireRole('admin','receptionist','doctor','nurse'), async (req: Request, res: Response) => {
  const phone = req.body.phone as string;
  const body = req.body.body as string;
  if (!phone || !body) { res.status(400).json({ error: 'phone and body required' }); return; }
  const conv = db.prepare(`SELECT opted_out FROM whatsapp_conversations WHERE phone = ?`).get(phone) as any;
  if (conv?.opted_out) {
    res.status(409).json({ error: 'opted_out', message: 'This number has opted out (LGPD). Message not sent.' });
    return;
  }
  const result = await sendTextMessage(phone, body);
  logAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'whatsapp_staff_send', resourceType: 'whatsapp_conversation', resourceId: phone, legalBasis: 'consent_art7_I' });
  res.status(result.ok ? 200 : 502).json(result);
});

// Delete a conversation + its messages (staff inbox cleanup; LGPD minimization)
router.delete('/conversations/:phone', authenticate, requireRole('admin','receptionist'), (req: Request, res: Response) => {
  const phone = req.params.phone;
  const conv = db.prepare(`SELECT id FROM whatsapp_conversations WHERE phone = ?`).get(phone) as any;
  if (!conv) { res.status(404).json({ error: 'not_found' }); return; }
  db.prepare(`DELETE FROM whatsapp_messages WHERE phone = ?`).run(phone);
  db.prepare(`DELETE FROM whatsapp_conversations WHERE phone = ?`).run(phone);
  logAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'whatsapp_conversation_deleted', resourceType: 'whatsapp_conversation', resourceId: phone, legalBasis: 'legal_obligation_art7_II' });
  res.json({ ok: true, deleted_phone: phone });
});

// Simulator — for testing without Meta
router.post('/simulate', authenticate, async (req: Request, res: Response) => {
  const phone = req.body.phone as string;
  const body = req.body.body as string;
  const locale: Locale = req.body.locale || detectUserLocale(body);
  if (!phone || !body) { res.status(400).json({ error: 'phone and body required' }); return; }
  persistIncoming(phone, body);
  await handleMessage(phone, body, locale);
  const outbox = db.prepare(`
    SELECT * FROM whatsapp_messages WHERE phone = ? AND direction = 'out' ORDER BY rowid DESC LIMIT 1
  `).get(phone);
  res.json({ ok: true, last_bot_reply: outbox });
});

router.get('/status', authenticate, (_req, res) => {
  const live = !!(process.env.META_WA_TOKEN && process.env.META_WA_PHONE_ID);
  res.json({
    live,
    phone_id: process.env.META_WA_PHONE_ID ? '***configured***' : null,
    app_secret_configured: !!process.env.META_WA_APP_SECRET,
    verify_token_configured: !!process.env.META_WA_VERIFY_TOKEN,
    conversations_count: (db.prepare(`SELECT COUNT(*) as c FROM whatsapp_conversations`).get() as any).c,
    messages_count: (db.prepare(`SELECT COUNT(*) as c FROM whatsapp_messages`).get() as any).c,
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
    ORDER BY s.created_at DESC LIMIT 200
  `).all() as any[];
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
    WHERE a.status = 'completed'
      AND a.scheduled_at >= datetime('now', ?)
      AND a.scheduled_at <= datetime('now')
      AND p.lgpd_opt_out_marketing = 0
      AND NOT EXISTS (SELECT 1 FROM satisfaction_surveys s WHERE s.appointment_id = a.id)
      AND p.phone NOT IN (SELECT phone FROM whatsapp_conversations WHERE opted_out = 1)
    ORDER BY a.scheduled_at DESC LIMIT 100
  `).all(`-${days} days`) as any[];

  let dispatched = 0;
  const locale = (process.env.DEFAULT_LOCALE as Locale) || 'pt-BR';
  for (const row of pending) {
    const conv = getOrCreateConversation(row.phone);
    if (conv.state !== 'idle' && conv.state !== 'lgpd_optout') continue; // don't hijack an active flow
    updateConversation(row.phone, {
      state: 'awaiting_nps_score',
      patient_id: row.patient_id,
      context: { patient_id: row.patient_id, appointment_id: row.appointment_id, survey: true },
    });
    const firstName = row.full_name.split(' ')[0];
    await reply(row.phone, locale, 'nps_ask', { name: `, ${firstName}` });
    dispatched++;
  }
  logAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'nps_dispatch',
             afterValue: { dispatched, window_days: days }, legalBasis: 'consent_art7_I' });
  res.json({ ok: true, dispatched, candidates: pending.length, dry_run: !isLive() });
});

/* ------------------------------------------------------------------
 * Campaigns / promotions (customer appreciation day, offers…)
 * ------------------------------------------------------------------ */

router.get('/campaigns', authenticate, (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT c.*, u.full_name AS created_by_name FROM campaigns c
    LEFT JOIN users u ON u.id = c.created_by ORDER BY c.created_at DESC LIMIT 100
  `).all();
  res.json({ campaigns: rows });
});

router.post('/campaigns', authenticate, requireRole('admin','receptionist'), (req: Request, res: Response) => {
  const { name, message, scheduled_for } = req.body ?? {};
  if (!name || !message || typeof name !== 'string' || typeof message !== 'string') {
    res.status(400).json({ error: 'validation', required: ['name', 'message'] });
    return;
  }
  const id = uuid();
  db.prepare(`
    INSERT INTO campaigns (id, name, message, scheduled_for, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name.trim(), message.trim(), scheduled_for ?? null, req.user!.id);
  logAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'campaign_created',
             resourceType: 'campaign', resourceId: id, afterValue: { name }, legalBasis: 'consent_art7_I' });
  res.status(201).json({ id });
});

// Blast the campaign to every consented, non-opted-out patient (LGPD art. 7º I)
router.post('/campaigns/:id/dispatch', authenticate, requireRole('admin','receptionist'), async (req: Request, res: Response) => {
  const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(req.params.id) as any;
  if (!campaign) { res.status(404).json({ error: 'not_found' }); return; }
  if (campaign.status === 'sent') { res.status(409).json({ error: 'already_sent' }); return; }

  const audience = db.prepare(`
    SELECT p.id, p.full_name, p.phone FROM patients p
    WHERE p.phone IS NOT NULL AND p.phone != ''
      AND p.lgpd_consent_at IS NOT NULL
      AND p.lgpd_opt_out_marketing = 0
      AND p.phone NOT IN (SELECT phone FROM whatsapp_conversations WHERE opted_out = 1)
  `).all() as any[];

  db.prepare(`UPDATE campaigns SET status = 'sending' WHERE id = ?`).run(campaign.id);
  const locale = (process.env.DEFAULT_LOCALE as Locale) || 'pt-BR';
  const footer = t(locale, 'whatsapp.promo_footer', {});
  let sent = 0, failed = 0;
  for (const p of audience) {
    const firstName = p.full_name.split(' ')[0];
    const body = campaign.message.replaceAll('{{name}}', firstName) + footer;
    const result = await sendTextMessage(p.phone, body);
    if (result.ok) sent++; else failed++;
  }
  db.prepare(`
    UPDATE campaigns SET status = 'sent', sent_count = ?, failed_count = ?, skipped_count = 0,
           dispatched_at = datetime('now') WHERE id = ?
  `).run(sent, failed, campaign.id);
  logAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'campaign_dispatched',
             resourceType: 'campaign', resourceId: campaign.id,
             afterValue: { sent, failed, audience: audience.length }, legalBasis: 'consent_art7_I' });
  res.json({ ok: true, sent, failed, audience: audience.length, dry_run: !isLive() });
});

router.delete('/campaigns/:id', authenticate, requireRole('admin','receptionist'), (req: Request, res: Response) => {
  const campaign = db.prepare(`SELECT id, status FROM campaigns WHERE id = ?`).get(req.params.id) as any;
  if (!campaign) { res.status(404).json({ error: 'not_found' }); return; }
  if (campaign.status !== 'draft') { res.status(409).json({ error: 'not_draft', message: 'Only draft campaigns can be deleted.' }); return; }
  db.prepare(`DELETE FROM campaigns WHERE id = ?`).run(req.params.id);
  logAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'campaign_deleted',
             resourceType: 'campaign', resourceId: req.params.id, legalBasis: 'legal_obligation_art7_II' });
  res.json({ ok: true, deleted_id: req.params.id });
});

export { handleMessage, detectUserLocale, SPECIALTIES };
export default router;
