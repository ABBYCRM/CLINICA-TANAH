/**
 * WhatsApp bot — state machine for appointment booking + LGPD consent + opt-out
 * Supports pt-BR, es, en (auto-detected from message content)
 */
import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { recordConsent, logAudit } from '../services/audit';
import { detectLocale, t, type Locale } from '../services/i18n';
import { sendTextMessage, persistIncoming, getOrCreateConversation, updateConversation } from '../services/whatsapp';

const router = Router();

const SPECIALTIES = [
  { code: 'dermato', name: 'Dermatologia' },
  { code: 'transplante_capilar', name: 'Transplante Capilar' },
  { code: 'endocrino', name: 'Endocrinologia' },
  { code: 'gineco', name: 'Ginecologia' },
  { code: 'nutri', name: 'Nutrição' },
  { code: 'procto', name: 'Proctologia' },
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
        await sendTextMessage(phone, locale === 'en' ? 'Reply CANCEL <appointment_id> to cancel.' : locale === 'es' ? 'Responde CANCELAR <id_cita> para cancelar.' : 'Responda CANCELAR <id_da_consulta> para cancelar. Ex: CANCELAR abc123');
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
      // Map specialty code to practitioner email prefix
      const specialtyMap: Record<string, string> = {
        'dermato': 'dermato@',
        'transplante_capilar': 'transplante@',
        'endocrino': 'endocrino@',
        'gineco': 'gineco@',
        'nutri': 'nutri@',
        'procto': 'procto@',
      };
      const emailPrefix = specialtyMap[ctx.specialty];
      let practitioner: any;
      if (emailPrefix) {
        practitioner = db.prepare(`SELECT id, full_name FROM users WHERE role = 'doctor' AND active = 1 AND email LIKE ? LIMIT 1`).get(`${emailPrefix}%`) as any;
      }
      if (!practitioner) {
        // Fallback: any active doctor
        practitioner = db.prepare(`SELECT id, full_name FROM users WHERE role = 'doctor' AND active = 1 LIMIT 1`).get() as any;
      }
      if (!practitioner) {
        await reply(phone, locale, 'not_found');
        return;
      }
      // Check available slots
      const slots = db.prepare(`
        SELECT scheduled_at FROM appointments
        WHERE practitioner_id = ? AND date(scheduled_at) = ? AND status NOT IN ('cancelled','no_show')
      `).all(practitioner.id, date) as any[];
      const taken = new Set(slots.map(s => s.scheduled_at));
      const candidates: string[] = [];
      for (let h = 8; h < 18; h++) for (const m of [0, 30]) {
        const s = `${date} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`;
        if (!taken.has(s)) candidates.push(s);
      }
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

// Webhook for incoming messages
router.post('/webhook', async (req: Request, res: Response) => {
  res.status(200).send('ok'); // acknowledge immediately
  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        for (const msg of change.value?.messages || []) {
          const phone = msg.from;
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
  const result = await sendTextMessage(phone, body);
  res.json(result);
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
    conversations_count: (db.prepare(`SELECT COUNT(*) as c FROM whatsapp_conversations`).get() as any).c,
    messages_count: (db.prepare(`SELECT COUNT(*) as c FROM whatsapp_messages`).get() as any).c,
  });
});

export { handleMessage, detectUserLocale, SPECIALTIES };
export default router;
