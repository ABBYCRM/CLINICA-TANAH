import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { FormError } from '../components/crud';

type FormRow = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  active: boolean;
  kind?: string;
  policy_version: string;
  consent_text: string;
  submission_count: number;
  mailer_configured?: boolean;
  urls: { link: string; embed: string };
};

type Submission = {
  id: string;
  full_name: string;
  phone: string;
  email?: string | null;
  status: string;
  patient_id?: string | null;
  consent_lgpd: number;
  consent_whatsapp: number;
  consent_marketing: number;
  consent_calls: number;
  self_attested: number;
  ip_address?: string | null;
  pixel_viewed_at?: string | null;
  pixel_submitted_at?: string | null;
  created_at: string;
};

type Invite = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  channel: string;
  status: string;
  link?: string | null;
  error?: string | null;
  mailto_url?: string | null;
  sent_at?: string | null;
  created_at: string;
};

type SendInviteResult = {
  id: string;
  status: string;
  link: string;
  embed?: string;
  mailto_url?: string | null;
  mailer_configured?: boolean;
  error?: string | null;
};

type LastShare = {
  link: string;
  embed: string;
  mailto_url?: string | null;
  name?: string;
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}

export default function Forms() {
  const { t, locale } = useI18n();
  const [forms, setForms] = useState<FormRow[]>([]);
  const [mailerConfigured, setMailerConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteChannel, setInviteChannel] = useState<'email' | 'whatsapp' | 'both'>('email');
  const [sending, setSending] = useState(false);
  const [lastMailto, setLastMailto] = useState<string | null>(null);
  const [lastShare, setLastShare] = useState<LastShare | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/api/forms')
      .then((d) => {
        const list: FormRow[] = d.forms || [];
        setForms(list);
        setMailerConfigured(Boolean(list[0]?.mailer_configured));
        if (!selectedId && list.length) {
          const prefer = list.find((f) => f.kind === 'pre_triage' || f.slug === 'pre-triagem-paciente');
          setSelectedId((prefer || list[0]).id);
        }
      })
      .catch((e) => setError(e.message || t('errors.generic')))
      .finally(() => setLoading(false));
  }, [selectedId, t]);

  useEffect(() => { load(); }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId) { setSubs([]); setInvites([]); return; }
    setSubsLoading(true);
    api.get(`/api/forms/${selectedId}/submissions`)
      .then((d) => setSubs(d.submissions || []))
      .catch(console.error)
      .finally(() => setSubsLoading(false));
    api.get(`/api/forms/${selectedId}/invites`)
      .then((d) => setInvites(d.invites || []))
      .catch(() => setInvites([]));
  }, [selectedId, locale]);

  const onCopy = async (key: string, text: string) => {
    await copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  const onSendInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    setSending(true);
    setError('');
    setOkMsg('');
    setLastMailto(null);
    setLastShare(null);
    try {
      const res: SendInviteResult = await api.post(`/api/forms/${selectedId}/send-invite`, {
        full_name: inviteName.trim() || null,
        email: inviteEmail.trim() || null,
        phone: invitePhone.trim() || null,
        channel: inviteChannel,
      });
      const current = forms.find((f) => f.id === selectedId);
      const share: LastShare = {
        link: res.link || current?.urls.link || '',
        embed: res.embed || current?.urls.embed || '',
        mailto_url: res.mailto_url || null,
        name: inviteName.trim() || undefined,
      };
      setLastShare(share);
      if (res.mailto_url) {
        setLastMailto(res.mailto_url);
        setOkMsg(t('forms.invite_mailto_hint'));
      } else {
        setOkMsg(t('forms.invite_sent_share'));
      }
      setInviteName('');
      setInviteEmail('');
      setInvitePhone('');
      const inv = await api.get(`/api/forms/${selectedId}/invites`);
      setInvites(inv.invites || []);
    } catch (err) {
      if (err instanceof ApiError && (err.body?.mailto_url || err.body?.link)) {
        const body = err.body as SendInviteResult;
        const current = forms.find((f) => f.id === selectedId);
        setLastShare({
          link: body.link || current?.urls.link || '',
          embed: body.embed || current?.urls.embed || '',
          mailto_url: body.mailto_url || null,
          name: inviteName.trim() || undefined,
        });
        if (body.mailto_url) setLastMailto(body.mailto_url);
        setOkMsg(t('forms.invite_mailto_hint'));
        try {
          const inv = await api.get(`/api/forms/${selectedId}/invites`);
          setInvites(inv.invites || []);
        } catch { /* */ }
      } else {
        setError(err instanceof Error ? err.message : t('errors.generic'));
      }
    } finally {
      setSending(false);
    }
  };

  const selected = forms.find((f) => f.id === selectedId) || null;
  const isTriage = selected?.kind === 'pre_triage' || selected?.slug === 'pre-triagem-paciente';

  return (
    <div className="space-y-4" data-testid="forms-page">
      <div>
        <h1 className="page-title">{t('forms.title')}</h1>
        <p className="text-sm text-[var(--ink-muted)] mt-1 max-w-2xl">{t('forms.subtitle')}</p>
      </div>

      {error && <FormError message={error} />}
      {okMsg && (
        <div className="rounded-lg border border-[var(--moss)]/30 bg-[var(--moss)]/10 px-3 py-2 text-sm text-[var(--moss)]" role="status">
          {okMsg}
          {lastMailto ? (
            <>
              {' '}
              <a href={lastMailto} className="underline font-medium text-[var(--ink)]">{t('forms.open_mailto')}</a>
            </>
          ) : null}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-[var(--ink-muted)]">{t('common.loading')}</div>
      ) : forms.length === 0 ? (
        <div className="card p-6 text-sm">{t('forms.empty')}</div>
      ) : (
        <div className="grid lg:grid-cols-[280px_1fr] gap-4">
          <aside className="card p-3 space-y-1">
            {forms.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedId(f.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                  selectedId === f.id
                    ? 'bg-[var(--paper-mid)] font-semibold text-[var(--ink)]'
                    : 'hover:bg-[var(--paper-mid)]/60 text-[var(--ink-muted)]'
                }`}
                data-testid={`form-item-${f.slug}`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="truncate">{f.name}</span>
                  {(f.kind === 'pre_triage' || f.slug === 'pre-triagem-paciente') && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#8b6914]/15 text-[#6b5210]">
                      {t('forms.kind_pre_triage_short')}
                    </span>
                  )}
                </div>
                <div className="text-[11px] mt-0.5 opacity-80">
                  /{f.slug} · {f.submission_count} {t('forms.submissions_short')}
                </div>
              </button>
            ))}
          </aside>

          {selected && (
            <div className="space-y-4">
              <div className="card p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl text-[var(--ink)]">{selected.name}</h2>
                    {selected.description && (
                      <p className="text-sm text-[var(--ink-muted)] mt-1">{selected.description}</p>
                    )}
                    <div className="text-xs text-[var(--ink-muted)] mt-2">
                      {t('forms.kind')}:{' '}
                      <span className="font-medium text-[var(--ink)]">
                        {isTriage ? t('forms.kind_pre_triage') : t('forms.kind_cadastro')}
                      </span>
                      {' · '}
                      {t('forms.policy')}: <span className="font-mono">{selected.policy_version}</span>
                      {' · '}
                      {selected.active ? t('forms.active') : t('forms.inactive')}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--moss)]/25 bg-[var(--moss)]/5 p-4 space-y-4" data-testid="form-share-primary">
                  <div>
                    <h3 className="font-semibold text-[var(--ink)]">{t('forms.share_primary_title')}</h3>
                    <p className="text-sm text-[var(--ink-muted)] mt-1">{t('forms.share_primary_help')}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)] mb-1.5">
                      {t('forms.public_link')}
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        readOnly
                        className="input flex-1 font-mono text-sm"
                        value={selected.urls.link}
                        data-testid="form-public-link"
                      />
                      <button
                        type="button"
                        className="btn-secondary shrink-0"
                        onClick={() => onCopy('link', selected.urls.link)}
                        data-testid="copy-form-link"
                      >
                        {copied === 'link' ? t('forms.copied') : t('forms.copy_link')}
                      </button>
                      <a
                        href={selected.urls.link}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-primary shrink-0 text-center"
                        data-testid="open-form-link"
                      >
                        {t('forms.open')}
                      </a>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)] mb-1.5">
                      {t('forms.embed_code')}
                    </label>
                    <textarea
                      readOnly
                      rows={3}
                      className="input w-full font-mono text-xs"
                      value={selected.urls.embed}
                      data-testid="form-embed-code"
                    />
                    <button
                      type="button"
                      className="btn-secondary mt-2"
                      onClick={() => onCopy('embed', selected.urls.embed)}
                      data-testid="copy-form-embed"
                    >
                      {copied === 'embed' ? t('forms.copied') : t('forms.copy_embed')}
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--edge-soft)] bg-[var(--paper-mid)]/40 p-3 text-sm text-[var(--ink-muted)]">
                  <strong className="text-[var(--ink)]">{t('forms.proof_title')}</strong>
                  <p className="mt-1">{t('forms.proof_body')}</p>
                </div>
              </div>

              {lastShare && (
                <div className="card p-5 space-y-3 border-[var(--moss)]/30" data-testid="form-last-share">
                  <h3 className="font-semibold text-[var(--ink)]">{t('forms.last_share_title')}</h3>
                  {lastShare.name ? (
                    <p className="text-sm text-[var(--ink-muted)]">{t('forms.last_share_for', { name: lastShare.name })}</p>
                  ) : null}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input readOnly className="input flex-1 font-mono text-sm" value={lastShare.link} data-testid="last-share-link" />
                    <button type="button" className="btn-secondary shrink-0" onClick={() => onCopy('last-link', lastShare.link)}>
                      {copied === 'last-link' ? t('forms.copied') : t('forms.copy_link')}
                    </button>
                  </div>
                  <textarea readOnly rows={2} className="input w-full font-mono text-xs" value={lastShare.embed} data-testid="last-share-embed" />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" onClick={() => onCopy('last-embed', lastShare.embed)}>
                      {copied === 'last-embed' ? t('forms.copied') : t('forms.copy_embed')}
                    </button>
                    {lastShare.mailto_url ? (
                      <a href={lastShare.mailto_url} className="btn-secondary" data-testid="last-share-mailto">
                        {t('forms.open_mailto')}
                      </a>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="card p-5 space-y-4" data-testid="form-send-invite">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-[var(--ink)]">{t('forms.send_invite_title')}</h3>
                    <p className="text-sm text-[var(--ink-muted)] mt-1">{t('forms.send_invite_help')}</p>
                  </div>
                  <span
                    className={`text-[11px] px-2 py-1 rounded ${
                      mailerConfigured
                        ? 'bg-[var(--moss)]/15 text-[var(--moss)]'
                        : 'bg-[#8b6914]/12 text-[#6b5210]'
                    }`}
                  >
                    {mailerConfigured ? t('forms.mailer_ok') : t('forms.mailer_missing')}
                  </span>
                </div>

                <form className="space-y-3" onSubmit={onSendInvite}>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('common.name')}</span>
                      <input
                        className="input mt-1 w-full"
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        placeholder={t('forms.invite_name_ph')}
                        data-testid="invite-name"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('common.email')}</span>
                      <input
                        type="email"
                        className="input mt-1 w-full"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        required={inviteChannel !== 'whatsapp'}
                        data-testid="invite-email"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('common.phone')}</span>
                      <input
                        className="input mt-1 w-full"
                        value={invitePhone}
                        onChange={(e) => setInvitePhone(e.target.value)}
                        required={inviteChannel !== 'email'}
                        placeholder="+55…"
                        data-testid="invite-phone"
                      />
                    </label>
                  </div>
                  <label className="block max-w-xs">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('forms.channel')}</span>
                    <select
                      className="input mt-1 w-full"
                      value={inviteChannel}
                      onChange={(e) => setInviteChannel(e.target.value as typeof inviteChannel)}
                      data-testid="invite-channel"
                    >
                      <option value="email">{t('forms.channel_email')}</option>
                      <option value="whatsapp">{t('forms.channel_whatsapp')}</option>
                      <option value="both">{t('forms.channel_both')}</option>
                    </select>
                  </label>
                  <button type="submit" className="btn-primary" disabled={sending} data-testid="invite-send">
                    {sending ? t('common.loading') : t('forms.send')}
                  </button>
                </form>

                {invites.length > 0 && (
                  <div className="overflow-x-auto border-t border-[var(--edge-soft)] pt-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)] mb-2">
                      {t('forms.recent_invites')}
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-[var(--ink-muted)] border-b border-[var(--edge-soft)]">
                          <th className="px-2 py-2">{t('common.name')}</th>
                          <th className="px-2 py-2">{t('common.email')}</th>
                          <th className="px-2 py-2">{t('forms.channel')}</th>
                          <th className="px-2 py-2">{t('common.status')}</th>
                          <th className="px-2 py-2">{t('forms.public_link')}</th>
                          <th className="px-2 py-2">{t('common.date')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invites.map((inv) => (
                          <tr key={inv.id} className="border-b border-[var(--edge-soft)]/60">
                            <td className="px-2 py-2">{inv.full_name || '—'}</td>
                            <td className="px-2 py-2 font-mono text-xs">{inv.email || inv.phone || '—'}</td>
                            <td className="px-2 py-2 text-xs">{inv.channel}</td>
                            <td className="px-2 py-2 text-xs">{inv.status}</td>
                            <td className="px-2 py-2">
                              {inv.link ? (
                                <button
                                  type="button"
                                  className="text-xs underline"
                                  onClick={() => onCopy(`inv-${inv.id}`, inv.link!)}
                                  data-testid={`copy-invite-link-${inv.id}`}
                                >
                                  {copied === `inv-${inv.id}` ? t('forms.copied') : t('forms.copy_link')}
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-2 py-2 text-xs whitespace-nowrap">
                              {new Date((inv.sent_at || inv.created_at) + ((inv.sent_at || inv.created_at).includes('Z') ? '' : 'Z')).toLocaleString(locale)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="card">
                <div className="px-5 py-3 border-b border-[var(--edge-soft)] font-semibold">
                  {t('forms.submissions')} ({subs.length})
                </div>
                {subsLoading ? (
                  <div className="p-5 text-sm text-[var(--ink-muted)]">{t('common.loading')}</div>
                ) : subs.length === 0 ? (
                  <div className="p-5 text-sm text-[var(--ink-muted)]">{t('forms.no_submissions')}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-[var(--ink-muted)] border-b border-[var(--edge-soft)]">
                          <th className="px-4 py-2">{t('common.name')}</th>
                          <th className="px-4 py-2">{t('common.phone')}</th>
                          <th className="px-4 py-2">{t('common.status')}</th>
                          <th className="px-4 py-2">{t('forms.patient')}</th>
                          <th className="px-4 py-2">{t('forms.pixel')}</th>
                          <th className="px-4 py-2">{t('common.date')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subs.map((s) => (
                          <tr key={s.id} className="border-b border-[var(--edge-soft)]/60">
                            <td className="px-4 py-2.5 font-medium">{s.full_name}</td>
                            <td className="px-4 py-2.5 font-mono text-xs">{s.phone}</td>
                            <td className="px-4 py-2.5">
                              <span className="text-xs">{s.status}</span>
                              {s.self_attested ? (
                                <span className="ml-2 text-[11px] text-[var(--moss)]">✓ {t('forms.self_attested')}</span>
                              ) : null}
                            </td>
                            <td className="px-4 py-2.5 text-xs font-mono">
                              {s.patient_id ? (
                                <a href={`/patients/${s.patient_id}`} className="underline">
                                  #{s.patient_id.slice(0, 8)}
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs">
                              {s.pixel_viewed_at ? (
                                <span className="text-[var(--moss)]">✓ {t('forms.pixel_ok')}</span>
                              ) : (
                                <span className="text-[var(--ink-muted)]">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                              {new Date(s.created_at + (s.created_at.includes('Z') ? '' : 'Z')).toLocaleString(locale)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
