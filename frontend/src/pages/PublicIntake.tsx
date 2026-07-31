import { FormEvent, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useI18n } from '../hooks/useI18n';

const API_BASE = import.meta.env.VITE_API_BASE || '';

type FormMeta = {
  name: string;
  slug: string;
  description?: string | null;
  consent_text: string;
  policy_version: string;
};

type ClinicMeta = {
  name: string;
  address?: string | null;
  phone?: string | null;
};

export default function PublicIntake() {
  const { slug = '' } = useParams();
  const [search] = useSearchParams();
  const embed = search.get('embed') === '1';
  const { t, locale, setLocale, locales, localeLabels } = useI18n();

  const [form, setForm] = useState<FormMeta | null>(null);
  const [clinic, setClinic] = useState<ClinicMeta | null>(null);
  const [pixelToken, setPixelToken] = useState('');
  const [pixelUrl, setPixelUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const [fullName, setFullName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('SP');
  const [notes, setNotes] = useState('');
  const [consentLgpd, setConsentLgpd] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [consentCalls, setConsentCalls] = useState(false);
  const [selfAttested, setSelfAttested] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const metaRes = await fetch(`${API_BASE}/api/public/forms/${encodeURIComponent(slug)}`);
        const meta = await metaRes.json();
        if (!metaRes.ok) throw new Error(meta.error || 'not_found');
        if (cancelled) return;
        setForm(meta.form);
        setClinic(meta.clinic);

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
  }, [slug, t]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || !pixelToken) return;
    setSubmitting(true);
    setError('');
    try {
      const cpfDigits = cpf.replace(/\D/g, '');
      const res = await fetch(`${API_BASE}/api/public/forms/${encodeURIComponent(slug)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({
          pixel_token: pixelToken,
          full_name: fullName.trim(),
          birth_date: birthDate,
          phone: phone.trim(),
          email: email.trim() || null,
          cpf: cpfDigits || null,
          city: city.trim() || null,
          state: stateUf.trim().toUpperCase() || null,
          notes: notes.trim() || null,
          consent_lgpd: consentLgpd,
          consent_whatsapp: consentWhatsapp,
          consent_marketing: consentMarketing,
          consent_calls: consentCalls,
          self_attested: selfAttested,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message || body.error || 'submit_failed');
      }
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
      style={{
        backgroundImage:
          'radial-gradient(ellipse at top, rgba(201,162,90,0.12), transparent 55%), linear-gradient(180deg, #f7efdc 0%, #f2e6cc 40%, #ead9b8 100%)',
      }}
    >
      {pixelUrl ? (
        <img
          src={pixelUrl}
          alt=""
          width={1}
          height={1}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          data-testid="consent-pixel"
        />
      ) : null}

      <div className={`mx-auto ${embed ? 'max-w-lg' : 'max-w-xl'}`}>
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
            <select
              className="input text-xs py-1.5 w-auto"
              value={locale}
              onChange={(e) => setLocale(e.target.value as any)}
              aria-label={t('common.language')}
            >
              {locales.map((l) => (
                <option key={l} value={l}>{localeLabels[l]}</option>
              ))}
            </select>
          </div>
        )}

        <div className="card p-6 sm:p-8 shadow-[var(--shadow-raised)]">
          {done ? (
            <div className="text-center py-8 space-y-3" data-testid="public-intake-success">
              <div className="text-3xl font-display text-[var(--moss)]">✓</div>
              <h1 className="font-display text-2xl">{t('public_form.success_title')}</h1>
              <p className="text-[var(--ink-muted)]">{t('public_form.success_body')}</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5" data-testid="public-intake-form">
              <div>
                <h1 className="font-display text-2xl sm:text-3xl text-[var(--ink)]">{form?.name}</h1>
                {form?.description && (
                  <p className="text-sm text-[var(--ink-muted)] mt-2">{form.description}</p>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-[var(--clay)]/40 bg-[var(--clay)]/10 px-3 py-2 text-sm text-[var(--clay)]">
                  {error}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('public_form.full_name')} *</span>
                  <input required className="input mt-1 w-full" value={fullName} onChange={(e) => setFullName(e.target.value)} data-testid="pf-name" autoComplete="name" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('public_form.birth_date')} *</span>
                  <input required type="date" className="input mt-1 w-full" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} data-testid="pf-birth" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('public_form.phone')} *</span>
                  <input required className="input mt-1 w-full" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 11 99999-0000" data-testid="pf-phone" autoComplete="tel" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('public_form.email')}</span>
                  <input type="email" className="input mt-1 w-full" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="pf-email" autoComplete="email" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('public_form.cpf')}</span>
                  <input className="input mt-1 w-full" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" data-testid="pf-cpf" inputMode="numeric" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('public_form.city')}</span>
                  <input className="input mt-1 w-full" value={city} onChange={(e) => setCity(e.target.value)} data-testid="pf-city" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('public_form.state')}</span>
                  <input className="input mt-1 w-full" maxLength={2} value={stateUf} onChange={(e) => setStateUf(e.target.value.toUpperCase())} data-testid="pf-state" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t('public_form.notes')}</span>
                  <textarea className="input mt-1 w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="pf-notes" />
                </label>
              </div>

              <div className="rounded-lg border border-[var(--edge-soft)] bg-[var(--paper-mid)]/50 p-4 space-y-3 text-sm">
                <p className="text-[var(--ink-muted)] leading-relaxed">{form?.consent_text}</p>
                <p className="text-[11px] text-[var(--ink-muted)]">
                  {t('public_form.policy_version')}: <span className="font-mono">{form?.policy_version}</span>
                </p>

                <label className="flex gap-2 items-start cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={selfAttested} onChange={(e) => setSelfAttested(e.target.checked)} required data-testid="pf-self" />
                  <span>{t('public_form.self_attested')} *</span>
                </label>
                <label className="flex gap-2 items-start cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={consentLgpd} onChange={(e) => setConsentLgpd(e.target.checked)} required data-testid="pf-lgpd" />
                  <span>{t('public_form.consent_lgpd')} *</span>
                </label>
                <label className="flex gap-2 items-start cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={consentWhatsapp} onChange={(e) => setConsentWhatsapp(e.target.checked)} data-testid="pf-wa" />
                  <span>{t('public_form.consent_whatsapp')}</span>
                </label>
                <label className="flex gap-2 items-start cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={consentMarketing} onChange={(e) => setConsentMarketing(e.target.checked)} data-testid="pf-mkt" />
                  <span>{t('public_form.consent_marketing')}</span>
                </label>
                <label className="flex gap-2 items-start cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={consentCalls} onChange={(e) => setConsentCalls(e.target.checked)} data-testid="pf-calls" />
                  <span>{t('public_form.consent_calls')}</span>
                </label>
              </div>

              <button type="submit" className="btn-primary w-full py-3" disabled={submitting} data-testid="pf-submit">
                {submitting ? t('common.loading') : t('public_form.submit')}
              </button>
            </form>
          )}
        </div>

        {!embed && clinic?.phone && (
          <p className="text-center text-xs text-[var(--ink-muted)] mt-4">
            {clinic.name} · {clinic.phone}
          </p>
        )}
      </div>
    </div>
  );
}
