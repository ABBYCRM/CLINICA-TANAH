import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { FormError } from '../components/crud';

type FormRow = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  active: boolean;
  policy_version: string;
  consent_text: string;
  submission_count: number;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/api/forms')
      .then((d) => {
        setForms(d.forms || []);
        if (!selectedId && d.forms?.length) setSelectedId(d.forms[0].id);
      })
      .catch((e) => setError(e.message || t('errors.generic')))
      .finally(() => setLoading(false));
  }, [selectedId, t]);

  useEffect(() => { load(); }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId) { setSubs([]); return; }
    setSubsLoading(true);
    api.get(`/api/forms/${selectedId}/submissions`)
      .then((d) => setSubs(d.submissions || []))
      .catch(console.error)
      .finally(() => setSubsLoading(false));
  }, [selectedId, locale]);

  const onCopy = async (key: string, text: string) => {
    await copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  const selected = forms.find((f) => f.id === selectedId) || null;

  return (
    <div className="space-y-4" data-testid="forms-page">
      <div>
        <h1 className="page-title">{t('forms.title')}</h1>
        <p className="text-sm text-[var(--ink-muted)] mt-1 max-w-2xl">{t('forms.subtitle')}</p>
      </div>

      {error && <FormError message={error} />}

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
                <div className="truncate">{f.name}</div>
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
                      {t('forms.policy')}: <span className="font-mono">{selected.policy_version}</span>
                      {' · '}
                      {selected.active ? t('forms.active') : t('forms.inactive')}
                    </div>
                  </div>
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

                <div className="rounded-lg border border-[var(--edge-soft)] bg-[var(--paper-mid)]/40 p-3 text-sm text-[var(--ink-muted)]">
                  <strong className="text-[var(--ink)]">{t('forms.proof_title')}</strong>
                  <p className="mt-1">{t('forms.proof_body')}</p>
                </div>
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
