/**
 * Mailer — Resend preferred, SMTP fallback, mailto when unconfigured.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL = { ...process.env };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL);
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_FROM;
  delete process.env.SMTP_USER;
  delete process.env.MAIL_FROM;
  delete process.env.MAIL_FROM_NAME;
});

describe('mailer', () => {
  it('reports unconfigured and returns mailto when no Resend/SMTP', async () => {
    const mailer = await import('../src/services/mailer');
    expect(mailer.mailerConfigured()).toBe(false);
    expect(mailer.mailerProvider()).toBeNull();
    const sent = await mailer.sendEmail({
      to: 'patient@example.com',
      subject: 'Test',
      text: 'Hello',
    });
    expect(sent.ok).toBe(false);
    expect(sent.configured).toBe(false);
    expect(sent.error).toBe('mail_not_configured');
    expect(sent.mailto_url).toMatch(/^mailto:/);
  });

  it('prefers Resend when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_FROM = 'Clínica Tanah <onboarding@resend.dev>';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'email_abc' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const mailer = await import('../src/services/mailer');
    expect(mailer.resendConfigured()).toBe(true);
    expect(mailer.mailerProvider()).toBe('resend');

    const sent = await mailer.sendEmail({
      to: 'patient@example.com',
      subject: 'Pré-triagem',
      text: 'Link: https://example.com/f',
      html: '<p>Link</p>',
    });
    expect(sent.ok).toBe(true);
    expect(sent.provider).toBe('resend');
    expect(sent.messageId).toBe('email_abc');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(['patient@example.com']);
    expect(body.from).toContain('onboarding@resend.dev');
    expect(body.subject).toBe('Pré-triagem');
  });

  it('surfaces Resend API errors and still provides mailto fallback', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'You can only send testing emails to your own email address.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const mailer = await import('../src/services/mailer');
    const sent = await mailer.sendEmail({
      to: 'other@example.com',
      subject: 'X',
      text: 'Y',
    });
    expect(sent.ok).toBe(false);
    expect(sent.configured).toBe(true);
    expect(sent.provider).toBe('resend');
    expect(sent.error).toMatch(/own email/i);
    expect(sent.mailto_url).toMatch(/^mailto:/);
  });

  it('builds intake invite email with clinic + link', async () => {
    const mailer = await import('../src/services/mailer');
    const mail = mailer.buildIntakeInviteEmail({
      clinicName: 'Clínica Tanah',
      recipientName: 'Luis',
      formName: 'Pré-triagem',
      link: 'https://clinic.example/f/pre-triagem',
    });
    expect(mail.subject).toMatch(/Pré-triagem/);
    expect(mail.text).toContain('Luis');
    expect(mail.text).toContain('https://clinic.example/f/pre-triagem');
    expect(mail.html).toContain('href="https://clinic.example/f/pre-triagem"');
  });
});
