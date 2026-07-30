/**
 * WhatsApp Cloud API client (Meta) — production implementation.
 *
 * Live mode (META_WA_TOKEN + META_WA_PHONE_ID set):
 *   - Sends via POST https://graph.facebook.com/v18.0/{PHONE_ID}/messages
 *   - Verifies webhook payloads with X-Hub-Signature-256 (META_WA_APP_SECRET)
 *   - Marks incoming messages as read, applies delivery status callbacks
 * Dry-run mode (env missing): messages are persisted but not sent — used
 * by tests and the in-app simulator. Everything else behaves identically.
 */
import crypto from 'crypto';
import { db } from '../db/schema';
import { v4 as uuid } from 'uuid';

const META_API_VERSION = 'v18.0';
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const META_TIMEOUT_MS = 10_000;

export interface SendResult { ok: boolean; message_id?: string; error?: string; dry_run: boolean; }

export function isLive(): boolean {
  return !!(process.env.META_WA_TOKEN && process.env.META_WA_PHONE_ID);
}

/** HMAC-SHA256 signature check for Meta webhook payloads (X-Hub-Signature-256). */
export function verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean {
  const secret = process.env.META_WA_APP_SECRET;
  if (!secret) return true; // secret not configured — verification disabled (dev/simulator)
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function metaRequest(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${META_BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(META_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${process.env.META_WA_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function sendTextMessage(to: string, body: string): Promise<SendResult> {
  const id = uuid();
  db.prepare(`
    INSERT INTO whatsapp_messages (id, phone, direction, body, status)
    VALUES (?, ?, 'out', ?, 'queued')
  `).run(id, to, body);

  if (!isLive()) {
    return { ok: true, message_id: `dry-${id}`, dry_run: true };
  }
  try {
    const { ok, data } = await metaRequest(`/${process.env.META_WA_PHONE_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body, preview_url: false },
      }),
    });
    if (!ok) {
      const error = data.error?.message || `Meta API HTTP error`;
      db.prepare(`UPDATE whatsapp_messages SET status = 'failed' WHERE id = ?`).run(id);
      return { ok: false, error, dry_run: false };
    }
    const waId = data.messages?.[0]?.id as string | undefined;
    db.prepare(`UPDATE whatsapp_messages SET status = 'sent', wa_message_id = ? WHERE id = ?`).run(waId ?? null, id);
    return { ok: true, message_id: waId, dry_run: false };
  } catch (e: any) {
    db.prepare(`UPDATE whatsapp_messages SET status = 'failed' WHERE id = ?`).run(id);
    return { ok: false, error: e.message, dry_run: false };
  }
}

/** Mark an incoming message as read in Meta (blue ticks). No-op in dry-run. */
export async function markAsRead(waMessageId: string): Promise<void> {
  if (!isLive() || !waMessageId) return;
  try {
    await metaRequest(`/${process.env.META_WA_PHONE_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: waMessageId }),
    });
  } catch { /* non-critical */ }
}

/** Apply a delivery status callback (sent/delivered/read/failed) to a stored message. */
export function applyStatusUpdate(waMessageId: string, status: string): void {
  const allowed = ['sent', 'delivered', 'read', 'failed'];
  if (!allowed.includes(status)) return;
  db.prepare(`UPDATE whatsapp_messages SET status = ? WHERE wa_message_id = ?`).run(status, waMessageId);
}

/** Live connectivity check against Meta — used by the UI status card. */
export async function pingMeta(): Promise<{ reachable: boolean; display_phone?: string; verified_name?: string; error?: string }> {
  if (!isLive()) return { reachable: false, error: 'not_configured' };
  try {
    const { ok, data } = await metaRequest(`/${process.env.META_WA_PHONE_ID}?fields=display_phone_number,verified_name,quality_rating`);
    if (!ok) return { reachable: false, error: data.error?.message || 'meta_error' };
    return {
      reachable: true,
      display_phone: data.display_phone_number,
      verified_name: data.verified_name,
    };
  } catch (e: any) {
    return { reachable: false, error: e.message };
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
