/**
 * WhatsApp Cloud API client (Meta)
 * - Sends messages via the official /v18.0/{PHONE_ID}/messages endpoint
 * - In dry-run mode (no META_WA_TOKEN env), messages are persisted but not actually sent
 *   — useful for development and the seeded demo
 */
import { db } from '../db/schema';
import { v4 as uuid } from 'uuid';

const META_API_VERSION = 'v18.0';
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export interface SendResult { ok: boolean; message_id?: string; error?: string; dry_run: boolean; }

export function isLive(): boolean {
  return !!(process.env.META_WA_TOKEN && process.env.META_WA_PHONE_ID);
}

export async function sendTextMessage(to: string, body: string): Promise<SendResult> {
  db.prepare(`
    INSERT INTO whatsapp_messages (id, phone, direction, body, status)
    VALUES (?, ?, 'out', ?, 'queued')
  `).run(uuid(), to, body);

  if (!isLive()) {
    return { ok: true, message_id: `dry-${uuid()}`, dry_run: true };
  }
  try {
    const res = await fetch(`${META_BASE}/${process.env.META_WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.META_WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body, preview_url: false },
      }),
    });
    const data = await res.json() as any;
    if (!res.ok) {
      db.prepare(`UPDATE whatsapp_messages SET status = 'failed' WHERE id = (SELECT MAX(id) FROM whatsapp_messages WHERE phone = ? AND direction = 'out')`).run(to);
      return { ok: false, error: data.error?.message || 'Meta API error', dry_run: false };
    }
    db.prepare(`UPDATE whatsapp_messages SET status = 'sent', wa_message_id = ? WHERE id = (SELECT MAX(id) FROM whatsapp_messages WHERE phone = ? AND direction = 'out')`)
      .run(data.messages?.[0]?.id, to);
    return { ok: true, message_id: data.messages?.[0]?.id, dry_run: false };
  } catch (e: any) {
    return { ok: false, error: e.message, dry_run: false };
  }
}

export function persistIncoming(phone: string, body: string, waMessageId?: string): void {
  db.prepare(`
    INSERT INTO whatsapp_messages (id, phone, direction, body, wa_message_id, status)
    VALUES (?, ?, 'in', ?, ?, 'received')
  `).run(uuid(), phone, body, waMessageId ?? null);
}

export { persistIncoming as persistIncomingPublic };

export function getOrCreateConversation(phone: string): any {
  let conv = db.prepare(`SELECT * FROM whatsapp_conversations WHERE phone = ?`).get(phone) as any;
  if (!conv) {
    const id = uuid();
    db.prepare(`INSERT INTO whatsapp_conversations (id, phone, state, last_message_at) VALUES (?, ?, 'idle', datetime('now'))`).run(id, phone);
    conv = db.prepare(`SELECT * FROM whatsapp_conversations WHERE id = ?`).get(id);
  }
  return conv;
}

export function updateConversation(phone: string, fields: { state?: string; context?: any; patient_id?: string; consent?: boolean; opt_out?: boolean }): void {
  const sets: string[] = [];
  const args: any[] = [];
  if (fields.state !== undefined) { sets.push('state = ?'); args.push(fields.state); }
  if (fields.context !== undefined) { sets.push('context = ?'); args.push(JSON.stringify(fields.context)); }
  if (fields.patient_id !== undefined) { sets.push('patient_id = ?'); args.push(fields.patient_id); }
  if (fields.consent !== undefined) { sets.push('lgpd_consent_granted = ?'); args.push(fields.consent ? 1 : 0); }
  if (fields.opt_out !== undefined) { sets.push('opted_out = ?'); args.push(fields.opt_out ? 1 : 0); }
  sets.push('last_message_at = datetime(\'now\')');
  sets.push('updated_at = datetime(\'now\')');
  args.push(phone);
  db.prepare(`UPDATE whatsapp_conversations SET ${sets.join(', ')} WHERE phone = ?`).run(...args);
}
