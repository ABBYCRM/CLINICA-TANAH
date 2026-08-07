/**
 * Outbound email — Resend (preferred) or SMTP via nodemailer.
 *
 * Env (Resend):
 *   RESEND_API_KEY  — required for Resend (https://resend.com)
 *   RESEND_FROM / MAIL_FROM / SMTP_FROM — From address (verified domain on Resend)
 *   MAIL_FROM_NAME  — optional display name
 *   MAIL_REPLY_TO / CLINIC_EMAIL — Reply-To (improves deliverability + trust)
 *
 * Env (SMTP fallback):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE
 */
import nodemailer from 'nodemailer';

export type MailResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
  configured: boolean;
  provider?: 'resend' | 'smtp' | null;
  mailto_url?: string;
};

function resolveFromAddress(): string {
  return (
    process.env.RESEND_FROM
    || process.env.SMTP_FROM
    || process.env.MAIL_FROM
    || process.env.SMTP_USER
    || 'Clínica Tanah <onboarding@resend.dev>'
  );
}

function resolveReplyTo(): string | undefined {
  const raw = (process.env.MAIL_REPLY_TO || process.env.CLINIC_EMAIL || process.env.DPO_EMAIL || '').trim();
  return raw || undefined;
}

function formatFrom(from: string): string {
  const name = (process.env.MAIL_FROM_NAME || '').trim();
  if (!name) return from;
  if (from.includes('<')) return from;
  return `"${name}" <${from}>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function resendConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY || '').trim();
}

export function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && (process.env.SMTP_FROM || process.env.MAIL_FROM || process.env.SMTP_USER));
}

export function mailerConfigured(): boolean {
  return resendConfigured() || smtpConfigured();
}

export function mailerProvider(): 'resend' | 'smtp' | null {
  if (resendConfigured()) return 'resend';
  if (smtpConfigured()) return 'smtp';
  return null;
}

export function mailtoUrl(args: { to: string; subject: string; body: string }): string {
  return `mailto:${encodeURIComponent(args.to)}?subject=${encodeURIComponent(args.subject)}&body=${encodeURIComponent(args.body)}`;
}

export type MailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

async function sendViaResend(args: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
  attachments?: MailAttachment[];
}): Promise<MailResult> {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, configured: false, provider: null, error: 'resend_not_configured' };
  }
  try {
    const replyTo = resolveReplyTo();
    const payload: Record<string, unknown> = {
      from: formatFrom(args.from),
      to: [args.to],
      subject: args.subject,
      text: args.text,
      html: args.html || undefined,
      // Transactional classification helps providers treat this as clinic ops, not promo blast
      tags: args.tags || [{ name: 'category', value: 'transactional_intake' }],
    };
    if (replyTo) payload.reply_to = replyTo;
    if (args.headers && Object.keys(args.headers).length) payload.headers = args.headers;
    if (args.attachments?.length) {
      payload.attachments = args.attachments.map((a) => ({
        filename: a.filename,
        content: Buffer.isBuffer(a.content)
          ? a.content.toString('base64')
          : Buffer.from(String(a.content)).toString('base64'),
        content_type: a.contentType || undefined,
      }));
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body?.message || body?.error || `resend_http_${res.status}`;
      return {
        ok: false,
        configured: true,
        provider: 'resend',
        error: String(detail).slice(0, 300),
      };
    }
    return {
      ok: true,
      configured: true,
      provider: 'resend',
      messageId: body?.id || undefined,
    };
  } catch (e: any) {
    return {
      ok: false,
      configured: true,
      provider: 'resend',
      error: e?.message || 'resend_send_failed',
    };
  }
}

async function sendViaSmtp(args: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from: string;
  attachments?: MailAttachment[];
}): Promise<MailResult> {
  if (!process.env.SMTP_HOST) {
    return { ok: false, configured: false, provider: null, error: 'smtp_not_configured' };
  }
  try {
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true' || port === 465;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
        : undefined,
    });
    const replyTo = resolveReplyTo();
    const info = await transporter.sendMail({
      from: formatFrom(args.from),
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html || undefined,
      replyTo,
      attachments: (args.attachments || []).map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
      headers: {
        'X-Auto-Response-Suppress': 'OOF, AutoReply',
      },
    });
    return { ok: true, configured: true, provider: 'smtp', messageId: info.messageId };
  } catch (e: any) {
    return {
      ok: false,
      configured: true,
      provider: 'smtp',
      error: e?.message || 'smtp_send_failed',
    };
  }
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
  attachments?: MailAttachment[];
}): Promise<MailResult> {
  const from = resolveFromAddress();
  const fallbackMailto = mailtoUrl({ to: args.to, subject: args.subject, body: args.text });

  if (resendConfigured()) {
    const sent = await sendViaResend({ ...args, from });
    if (!sent.ok) return { ...sent, mailto_url: fallbackMailto };
    return sent;
  }

  if (smtpConfigured()) {
    const sent = await sendViaSmtp({ ...args, from });
    if (!sent.ok) return { ...sent, mailto_url: fallbackMailto };
    return sent;
  }

  return {
    ok: false,
    configured: false,
    provider: null,
    error: 'mail_not_configured',
    mailto_url: fallbackMailto,
  };
}

/**
 * Professional, transactional pré-consulta invite.
 * Written for deliverability: calm subject, plain-text twin, single CTA,
 * explicit clinic identity, LGPD purpose, no promo spam cues.
 */
export function buildIntakeInviteEmail(args: {
  clinicName: string;
  recipientName?: string | null;
  formName: string;
  link: string;
  locale?: string;
}): { subject: string; text: string; html: string } {
  const clinic = (args.clinicName || 'Clínica Tanah').trim();
  const formName = (args.formName || 'Pré-consulta').trim();
  const link = (args.link || '').trim();
  const rawName = (args.recipientName || '').trim();
  const firstName = rawName.split(/\s+/)[0] || '';
  const greeting = firstName
    ? `Prezado(a) ${firstName}`
    : 'Prezado(a) paciente';

  // Calm, transactional subject — avoid ALL CAPS, “grátis”, “urgente!!!”, emoji
  const subject = `${clinic}: preparação para a sua consulta`;

  const text = [
    `${greeting},`,
    '',
    `Esperamos que esteja bem.`,
    '',
    `Em nome da equipe da ${clinic}, gostaríamos de convidá-lo(a) a concluir, com antecedência, o formulário “${formName}”.`,
    '',
    'O preenchimento antecipado nos permite conhecer melhor o seu histórico clínico, organizar o atendimento com segurança e reduzir o tempo de espera no dia da consulta — em conformidade com a LGPD (Lei nº 13.709/2018) e as orientações do CFM para anamnese e prontuário.',
    '',
    'O formulário é pessoal, confidencial e destinado exclusivamente à sua preparação clínica. Não se trata de mensagem promocional.',
    '',
    'Acesse com segurança pelo link abaixo:',
    link,
    '',
    'Caso o link não abra, copie e cole o endereço completo no navegador.',
    '',
    'Se não reconhece este convite ou já preencheu o formulário, pode desconsiderar esta mensagem. Em caso de dúvidas, responda a este e-mail ou fale com a recepção da clínica.',
    '',
    'Importante: este formulário não substitui atendimento de emergência. Em situação de urgência, procure o SAMU 192 ou o pronto-socorro mais próximo.',
    '',
    'Com atenção e cordialidade,',
    `Equipe de Atendimento — ${clinic}`,
    '',
    '—',
    `${clinic}`,
    'Mensagem transacional relativa à sua consulta. Dados tratados conforme a LGPD.',
  ].join('\n');

  const safeGreeting = escapeHtml(greeting);
  const safeClinic = escapeHtml(clinic);
  const safeForm = escapeHtml(formName);
  const safeLink = escapeHtml(link);

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${safeClinic} — preparação para a sua consulta</title>
</head>
<body style="margin:0;padding:0;background:#f4efe6;color:#2c2118;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">
    Convite da ${safeClinic} para preenchimento do formulário clínico antes da sua consulta.
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4efe6;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#fbf7f0;border:1px solid #e2d4bc;border-radius:12px;">
          <tr>
            <td style="padding:28px 28px 8px 28px;font-family:Georgia,'Times New Roman',serif;color:#2c2118;">
              <p style="margin:0 0 6px 0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#6b5210;font-family:Arial,Helvetica,sans-serif;">
                ${safeClinic}
              </p>
              <h1 style="margin:0 0 18px 0;font-size:22px;line-height:1.35;font-weight:normal;color:#2c2118;">
                Preparação para a sua consulta
              </h1>
              <p style="margin:0 0 14px 0;font-size:16px;line-height:1.55;">${safeGreeting},</p>
              <p style="margin:0 0 14px 0;font-size:16px;line-height:1.55;">Esperamos que esteja bem.</p>
              <p style="margin:0 0 14px 0;font-size:16px;line-height:1.55;">
                Em nome da equipe da <strong>${safeClinic}</strong>, gostaríamos de convidá-lo(a) a concluir, com antecedência, o formulário
                <strong>${safeForm}</strong>.
              </p>
              <p style="margin:0 0 14px 0;font-size:16px;line-height:1.55;">
                O preenchimento antecipado nos permite conhecer melhor o seu histórico clínico, organizar o atendimento com segurança
                e reduzir o tempo de espera no dia da consulta — em conformidade com a LGPD (Lei nº&nbsp;13.709/2018) e as orientações
                do CFM para anamnese e prontuário.
              </p>
              <p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;color:#4a382c;">
                O formulário é pessoal, confidencial e destinado exclusivamente à sua preparação clínica. Não se trata de mensagem promocional.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px 0;">
                <tr>
                  <td align="center" bgcolor="#6b5210" style="border-radius:8px;">
                    <a href="${safeLink}"
                       style="display:inline-block;padding:14px 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                      Preencher formulário com segurança
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 18px 0;font-size:13px;line-height:1.5;color:#5c564c;font-family:Arial,Helvetica,sans-serif;word-break:break-all;">
                Se o botão não funcionar, use este link:<br />
                <a href="${safeLink}" style="color:#6b5210;">${safeLink}</a>
              </p>
              <p style="margin:0 0 14px 0;font-size:14px;line-height:1.5;color:#4a382c;">
                Caso não reconheça este convite ou já tenha preenchido o formulário, pode desconsiderar esta mensagem.
                Em caso de dúvidas, responda a este e-mail ou fale com a recepção da clínica.
              </p>
              <p style="margin:0 0 22px 0;font-size:13px;line-height:1.5;color:#7a3b2e;">
                Importante: este formulário não substitui atendimento de emergência. Em situação de urgência, procure o SAMU 192
                ou o pronto-socorro mais próximo.
              </p>
              <p style="margin:0 0 4px 0;font-size:16px;line-height:1.5;">Com atenção e cordialidade,</p>
              <p style="margin:0 0 24px 0;font-size:16px;line-height:1.5;">
                Equipe de Atendimento<br />
                <strong>${safeClinic}</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px 22px 28px;border-top:1px solid #e2d4bc;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.45;color:#6a5c4c;">
              ${safeClinic} · Mensagem transacional relativa à sua consulta.<br />
              Dados tratados conforme a Lei Geral de Proteção de Dados (LGPD).
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
