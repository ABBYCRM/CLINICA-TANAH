/**
 * Outbound email — SMTP via nodemailer when configured.
 * Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (or MAIL_FROM), SMTP_SECURE
 */
import nodemailer from 'nodemailer';

export type MailResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
  configured: boolean;
  mailto_url?: string;
};

export function mailerConfigured(): boolean {
  return !!(process.env.SMTP_HOST && (process.env.SMTP_FROM || process.env.MAIL_FROM || process.env.SMTP_USER));
}

export function mailtoUrl(args: { to: string; subject: string; body: string }): string {
  return `mailto:${encodeURIComponent(args.to)}?subject=${encodeURIComponent(args.subject)}&body=${encodeURIComponent(args.body)}`;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<MailResult> {
  const from =
    process.env.SMTP_FROM
    || process.env.MAIL_FROM
    || process.env.SMTP_USER
    || 'noreply@clinica-tanah.local';
  const fallbackMailto = mailtoUrl({ to: args.to, subject: args.subject, body: args.text });

  if (!process.env.SMTP_HOST) {
    return { ok: false, configured: false, error: 'smtp_not_configured', mailto_url: fallbackMailto };
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
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM_NAME ? `"${process.env.MAIL_FROM_NAME}" <${from}>` : from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html || undefined,
    });
    return { ok: true, configured: true, messageId: info.messageId };
  } catch (e: any) {
    return {
      ok: false,
      configured: true,
      error: e?.message || 'smtp_send_failed',
      mailto_url: fallbackMailto,
    };
  }
}

export function buildIntakeInviteEmail(args: {
  clinicName: string;
  recipientName?: string | null;
  formName: string;
  link: string;
  locale?: string;
}): { subject: string; text: string; html: string } {
  const name = args.recipientName?.trim() || 'Olá';
  const clinic = args.clinicName || 'Clínica Tanah';
  const subject = `${clinic} — pré-cadastro / pré-triagem: ${args.formName}`;
  const text = [
    `${name},`,
    '',
    `A ${clinic} convida você a preencher o formulário "${args.formName}" antes da consulta.`,
    'Isso agiliza seu atendimento e registra informações clínicas iniciais com segurança (LGPD).',
    '',
    `Acesse o link: ${args.link}`,
    '',
    'Importante: este formulário não substitui emergência. Em urgência, procure o SAMU 192 ou pronto-socorro.',
    '',
    `— Equipe ${clinic}`,
  ].join('\n');
  const html = `
    <div style="font-family:Georgia,serif;color:#2c2820;line-height:1.5;max-width:560px">
      <p>${name},</p>
      <p>A <strong>${clinic}</strong> convida você a preencher o formulário <strong>${args.formName}</strong> antes da consulta.</p>
      <p>Isso agiliza seu atendimento e registra informações clínicas iniciais com segurança (LGPD).</p>
      <p style="margin:24px 0">
        <a href="${args.link}" style="background:#8b6914;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
          Preencher formulário
        </a>
      </p>
      <p style="font-size:13px;color:#5c564c">Link: <a href="${args.link}">${args.link}</a></p>
      <p style="font-size:12px;color:#8b3a2a">Este formulário não substitui emergência. Em urgência, procure o SAMU 192 ou pronto-socorro.</p>
      <p>— Equipe ${clinic}</p>
    </div>
  `;
  return { subject, text, html };
}
