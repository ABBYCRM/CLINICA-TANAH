import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useI18n } from '../hooks/useI18n';

const API_BASE = import.meta.env.VITE_API_BASE || '';

type FieldOpt = { value: string; label: string };
type FieldDef = {
  key: string;
  type: string;
  required?: boolean;
  section: string;
  label: string;
  placeholder?: string;
  help?: string;
  options?: FieldOpt[];
};
type ConsentBox = { key: string; required: boolean; label: string };

type FormMeta = {
  name: string;
  slug: string;
  description?: string | null;
  consent_text: string;
  policy_version: string;
  kind?: string;
  emergency_notice?: boolean;
  fields?: FieldDef[];
  consent_boxes?: ConsentBox[];
  sections?: string[];
  section_titles?: Record<string, string>;
};

type ClinicMeta = { name: string; address?: string | null; phone?: string | null };

function toggleIn(list: string[], key: string): string[] {
  if (key === 'none') return list.includes('none') ? [] : ['none'];
  const withoutNone = list.filter((x) => x !== 'none');
  if (withoutNone.includes(key)) return withoutNone.filter((x) => x !== key);
  return [...withoutNone, key];
}

const SECTION_FALLBACK: Record<string, string> = {
  identity: 'Identificação',
  guardian: 'Responsável legal',
  insurance: 'Convênio',
  clinical: 'Clínico',
  history: 'Antecedentes',
  ros: 'Sistemas',
  lifestyle: 'Hábitos',
  safety: 'Alertas',
  consent: 'Consentimentos',
};

export default function PublicIntake() {
  const { slug = '' } = useParams();
  const [search] = useSearchParams();
  const embed = search.get('embed') === '1';
  const { t, locale, setLocale, locales, localeLabels } = useI18n();

  const [form, setForm] = useState<FormMeta | null>(null);
  const [clinic, setClinic] = useState<ClinicMeta | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [consentBoxes, setConsentBoxes] = useState<ConsentBox[]>([]);
  const [pixelToken, setPixelToken] = useState('');
  const [pixelUrl, setPixelUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [urgentHint, setUrgentHint] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [consents, setConsents] = useState<Record<string, boolean>>({});

  const isTriage = form?.kind === 'pre_triage' || slug === 'pre-triagem-paciente';

  const sections = useMemo(() => {
    const order = form?.sections || ['identity', 'guardian', 'insurance', 'clinical', 'history', 'ros', 'lifestyle', 'safety'];
    const present = new Set(fields.map((f) => f.section));
    return order.filter((s) => present.has(s));
  }, [form?.sections, fields]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const metaRes = await fetch(`${API_BASE}/api/public/forms/${encodeURIComponent(slug)}`, {
          headers: { 'Accept-Language': locale },
        });
        const meta = await metaRes.json();
        if (!metaRes.ok) throw new Error(meta.error || 'not_found');
        if (cancelled) return;
        setForm(meta.form);
        setClinic(meta.clinic);
        const flds: FieldDef[] = meta.form?.fields || [];
        setFields(flds);
        setConsentBoxes(meta.form?.consent_boxes || []);
        const init: Record<string, string | string[]> = {};
        for (const f of flds) {
          init[f.key] = f.type === 'checkbox_group' ? [] : (f.key === 'state' ? 'SP' : '');
        }
        setValues(init);
        const cInit: Record<string, boolean> = {};
        for (const c of meta.form?.consent_boxes || []) cInit[c.key] = false;
        setConsents(cInit);

        const sessRes = await fetch(`${API_BASE}/api/public/forms/${encodeURIComponent(slug)}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const sess = await sessRes.json();
        if (!sessRes.ok) throw new Error(sess.error || 'session_failed');
        if (cancelled) return;
        setPixelToken(sess.pixel_token);
        setPixelUrl(sess.pixel_url);
      } catch (e: any) {
        if (!cancelled) setError(e.message === 'not_found' ? t('public_form.not_found') : t('errors.generic'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, locale]);

  const setVal = (key: string, v: string | string[]) => setValues((prev) => ({ ...prev, [key]: v }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || !pixelToken) return;

    // Client-side required checks for checkbox groups
    for (const f of fields) {
      if (!f.required) continue;
      const v = values[f.key];
      if (f.type === 'checkbox_group') {
        if (!Array.isArray(v) || v.length === 0) {
          setError(`${f.label}: ${t('public_form.required_field')}`);
          return;
        }
      } else if (!String(v || '').trim()) {
        setError(`${f.label}: ${t('public_form.required_field')}`);
        return;
      }
    }
    for (const c of consentBoxes) {
      if (c.required && !consents[c.key]) {
        setError(c.label);
        return;
      }
    }

    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        pixel_token: pixelToken,
        ...Object.fromEntries(
          Object.entries(values).map(([k, v]) => [k, Array.isArray(v) ? v : (String(v).trim() || null)]),
        ),
        consent_lgpd: !!consents.consent_lgpd,
        consent_privacy_ack: !!consents.consent_privacy_ack,
        consent_whatsapp: !!consents.consent_whatsapp,
        consent_marketing: !!consents.consent_marketing,
        consent_calls: !!consents.consent_calls,
        consent_telehealth_image: !!consents.consent_telehealth_image,
        self_attested: !!consents.self_attested,
      };
      // normalize CPF digits for backend
      if (typeof body.cpf === 'string') body.cpf = body.cpf.replace(/\D/g, '') || null;

      const res = await fetch(`${API_BASE}/api/public/forms/${encodeURIComponent(slug)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'submit_failed');
      setUrgentHint(!!data.urgent_hint);
      setDone(true);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={`min-h-[60vh] flex items-center justify-center ${embed ? 'p-4' : 'p-8'} bg-[var(--paper)]`}>
        <p className="text-[var(--ink-muted)]">{t('common.loading')}</p>
      </div>
    );
  }

  if (error && !form) {
    return (
      <div className={`min-h-[60vh] flex items-center justify-center ${embed ? 'p-4' : 'p-8'} bg-[var(--paper)]`}>
        <p className="text-[var(--clay)]">{error}</p>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen bg-[var(--paper)] text-[var(--ink)] ${embed ? 'py-4 px-3' : 'py-10 px-4'}`}
      data-testid="public-intake"
      data-kind={form?.kind || 'cadastro'}
      data-embed={embed ? '1' : '0'}
      style={{
        backgroundImage:
          'radial-gradient(ellipse at top, rgba(201,162,90,0.12), transparent 55%), linear-gradient(180deg, #f7efdc 0%, #f2e6cc 40%, #ead9b8 100%)',
      }}
    >
      {pixelUrl ? (
        <img src={pixelUrl} alt="" width={1} height={1}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          data-testid="consent-pixel" />
      ) : null}

      <div className={`mx-auto ${embed ? 'max-w-xl' : 'max-w-2xl'}`}>
        {!embed && (
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="brand-medallion w-10 h-10">
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div>
                <div className="font-display font-semibold text-lg leading-tight">{clinic?.name || 'Clínica Tanah'}</div>
                <div className="text-xs text-[var(--ink-muted)]">{t('public_form.tagline')}</div>
              </div>
            </div>
            <select className="input text-xs py-1.5 w-auto" value={locale}
              onChange={(e) => setLocale(e.target.value as any)} aria-label={t('common.language')}>
              {locales.map((l) => <option key={l} value={l}>{localeLabels[l]}</option>)}
            </select>
          </div>
        )}

        <div className="card p-6 sm:p-8 shadow-[var(--shadow-raised)]">
          {done ? (
            <div className="text-center py-8 space-y-3" data-testid="public-intake-success">
              <div className="text-3xl font-display text-[var(--moss)]">✓</div>
              <h1 className="font-display text-2xl">{t('public_form.success_title')}</h1>
              <p className="text-[var(--ink-muted)]">{t('public_form.success_body')}</p>
              {urgentHint && (
                <p className="text-sm text-[#8b3a2a] bg-[#f8e8e2] border border-[#e2b8a8] rounded-lg px-3 py-2">
                  {t('public_form.urgent_followup')}
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5" data-testid="public-intake-form">
              <div>
                <h1 className="font-display text-2xl sm:text-3xl text-[var(--ink)]">{form?.name}</h1>
                {form?.description && (
                  <p className="text-sm text-[var(--ink-muted)] mt-2">{form.description}</p>
                )}
                <p className="text-[11px] text-[var(--ink-muted)] mt-2">
                  {t('public_form.legal_basis_hint')}
                </p>
              </div>

              {isTriage && (
                <div className="rounded-lg border border-[#c45c3e]/35 bg-[#f8e8e2]/70 px-3 py-2 text-sm text-[#6b2a1a]" role="note">
                  {t('public_form.emergency_banner')}
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-[var(--clay)]/40 bg-[var(--clay)]/10 px-3 py-2 text-sm text-[var(--clay)]">{error}</div>
              )}

              {sections.map((section) => {
                const sectionFields = fields.filter((f) => f.section === section);
                if (!sectionFields.length) return null;
                return (
                  <fieldset key={section} className="space-y-3" data-testid={`pf-section-${section}`}>
                    <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      {form?.section_titles?.[section] || SECTION_FALLBACK[section] || section}
                    </legend>
                    <div className="grid sm:grid-cols-2 gap-4">
                      {sectionFields.map((f) => {
                        const span = f.type === 'textarea' || f.type === 'checkbox_group' || f.key === 'full_name' || f.key === 'address_street'
                          ? 'sm:col-span-2'
                          : '';
                        if (f.type === 'checkbox_group') {
                          const selected = Array.isArray(values[f.key]) ? (values[f.key] as string[]) : [];
                          return (
                            <div key={f.key} className={span}>
                              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)] mb-2">
                                {f.label}{f.required ? ' *' : ''}
                              </div>
                              {f.help && <p className="text-[11px] text-[var(--ink-muted)] mb-2">{f.help}</p>}
                              <div className="grid sm:grid-cols-2 gap-1.5">
                                {(f.options || []).map((o) => (
                                  <label key={o.value} className="flex gap-2 items-start text-sm cursor-pointer">
                                    <input
                                      type="checkbox"
                                      className="mt-0.5"
                                      checked={selected.includes(o.value)}
                                      onChange={() => setVal(f.key, toggleIn(selected, o.value))}
                                    />
                                    <span>{o.label}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          );
                        }
                        if (f.type === 'select') {
                          return (
                            <label key={f.key} className={`block ${span}`}>
                              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                                {f.label}{f.required ? ' *' : ''}
                              </span>
                              <select
                                className="input mt-1 w-full"
                                required={!!f.required}
                                value={String(values[f.key] || '')}
                                onChange={(e) => setVal(f.key, e.target.value)}
                                data-testid={`pf-${f.key}`}
                              >
                                <option value="">—</option>
                                {(f.options || []).map((o) => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                              {f.help && <span className="block text-[11px] text-[var(--ink-muted)] mt-1">{f.help}</span>}
                            </label>
                          );
                        }
                        if (f.type === 'textarea') {
                          return (
                            <label key={f.key} className={`block ${span}`}>
                              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                                {f.label}{f.required ? ' *' : ''}
                              </span>
                              <textarea
                                className="input mt-1 w-full"
                                rows={3}
                                required={!!f.required}
                                value={String(values[f.key] || '')}
                                placeholder={f.placeholder}
                                onChange={(e) => setVal(f.key, e.target.value)}
                                data-testid={`pf-${f.key}`}
                              />
                              {f.help && <span className="block text-[11px] text-[var(--ink-muted)] mt-1">{f.help}</span>}
                            </label>
                          );
                        }
                        return (
                          <label key={f.key} className={`block ${span}`}>
                            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                              {f.label}{f.required ? ' *' : ''}
                            </span>
                            <input
                              className="input mt-1 w-full"
                              type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : f.type === 'tel' ? 'tel' : 'text'}
                              required={!!f.required}
                              value={String(values[f.key] || '')}
                              placeholder={f.placeholder}
                              onChange={(e) => setVal(f.key, e.target.value)}
                              data-testid={`pf-${f.key}`}
                            />
                            {f.help && <span className="block text-[11px] text-[var(--ink-muted)] mt-1">{f.help}</span>}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}

              <div className="rounded-lg border border-[var(--edge-soft)] bg-[var(--paper-mid)]/50 p-4 space-y-3 text-sm">
                <p className="text-[var(--ink-muted)] leading-relaxed">{form?.consent_text}</p>
                <p className="text-[11px] text-[var(--ink-muted)]">
                  {t('public_form.policy_version')}: <span className="font-mono">{form?.policy_version}</span>
                  {' · '}
                  <a href="/privacidade" target="_blank" rel="noreferrer" className="underline font-medium text-[color:var(--ink)]" data-testid="pf-privacy-link">
                    {t('privacy.page_title')}
                  </a>
                </p>
                {consentBoxes.map((c) => (
                  <label key={c.key} className="flex gap-2 items-start cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!!consents[c.key]}
                      required={c.required}
                      onChange={(e) => setConsents((prev) => ({ ...prev, [c.key]: e.target.checked }))}
                      data-testid={`pf-${c.key}`}
                    />
                    <span>{c.label}{c.required ? ' *' : ''}</span>
                  </label>
                ))}
              </div>

              <button type="submit" className="btn-primary w-full py-3" disabled={submitting} data-testid="pf-submit">
                {submitting ? t('common.loading') : t('public_form.submit')}
              </button>
            </form>
          )}
        </div>

        {!embed && clinic?.phone && (
          <p className="text-center text-xs text-[var(--ink-muted)] mt-4">{clinic.name} · {clinic.phone}</p>
        )}
      </div>
    </div>
  );
}
