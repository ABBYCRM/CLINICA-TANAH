/**
 * Public Política de Privacidade — LGPD art. 9 transparency for patients.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../hooks/useI18n';

const API_BASE = import.meta.env.VITE_API_BASE || '';

export default function PrivacyPolicy() {
  const { t, locale, setLocale, locales, localeLabels } = useI18n();
  const [policy, setPolicy] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/public/privacy`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'failed');
        if (!cancelled) setPolicy(data);
      } catch {
        if (!cancelled) setError(t('errors.generic'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [locale, t]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--tex-paper, #f4ead2)' }} data-testid="public-privacy">
      <header className="aluminum-header px-4 py-4 sm:px-8 flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(139,115,85,0.35)]">
        <div>
          <div className="font-display text-xl font-semibold text-[#2a1f16]">{policy?.clinic_name || t('app.name')}</div>
          <div className="text-xs text-[color:var(--ink-muted)]">{t('privacy.page_title')}</div>
        </div>
        <div className="flex items-center gap-2">
          {locales.map((l) => (
            <button key={l} type="button" className={`seg-item !text-xs ${locale === l ? 'is-active' : ''}`} onClick={() => setLocale(l)}>
              {localeLabels[l] || l}
            </button>
          ))}
          <Link to="/login" className="btn-secondary text-xs">{t('nav.login') !== 'nav.login' ? t('nav.login') : 'Login'}</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 sm:px-6 space-y-6">
        {loading && <p className="text-sm text-[color:var(--ink-muted)]">{t('common.loading')}</p>}
        {error && <p className="text-sm text-[#8b3a2a]">{error}</p>}
        {policy && (
          <>
            <section className="crm-record-panel space-y-2">
              <h1 className="font-display text-2xl text-[color:var(--ink)]">{t('privacy.page_title')}</h1>
              <p className="text-sm text-[color:var(--ink-muted)]">
                {t('privacy.version')}: <span className="font-mono">{policy.version}</span> · {policy.effective_date}
              </p>
              <p className="text-sm leading-relaxed text-[color:var(--ink)]">{t('privacy.intro')}</p>
            </section>

            <section className="crm-record-panel space-y-2">
              <h2 className="crm-record-panel-title">{t('privacy.dpo_heading')}</h2>
              <p className="text-lg font-semibold">{policy.dpo?.name}</p>
              <p className="text-sm"><a className="underline" href={`mailto:${policy.dpo?.email}`}>{policy.dpo?.email}</a></p>
              <p className="text-sm text-[color:var(--ink-muted)]">{policy.dpo?.phone}</p>
            </section>

            <section className="crm-record-panel space-y-2">
              <h2 className="crm-record-panel-title">{t('privacy.bases_heading')}</h2>
              <ul className="space-y-2">
                {(policy.legal_bases || []).map((b: any) => (
                  <li key={b.code} className="text-sm border-l-2 border-[color:var(--brass-deep)] pl-3">
                    <div className="font-medium">{b.name} <span className="font-mono text-[10px] text-[color:var(--ink-muted)]">{b.code}</span></div>
                    <div className="text-[color:var(--ink-muted)] text-xs mt-0.5">{b.description}</div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="crm-record-panel space-y-2">
              <h2 className="crm-record-panel-title">{t('privacy.categories_heading')}</h2>
              <ul className="space-y-2">
                {(policy.data_categories || []).map((c: any, i: number) => (
                  <li key={i} className="text-sm">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-[color:var(--ink-muted)]">{(c.examples || []).join(', ')} · {c.retention}</div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="crm-record-panel space-y-2">
              <h2 className="crm-record-panel-title">{t('privacy.rights_heading')}</h2>
              <ul className="space-y-1.5">
                {(policy.rights || []).map((r: any) => (
                  <li key={r.code} className="text-sm">• {r.name}</li>
                ))}
              </ul>
              <h3 className="font-semibold text-sm pt-2">{t('privacy.how_heading')}</h3>
              <ul className="space-y-1 text-sm text-[color:var(--ink-muted)]">
                {(policy.how_to_exercise || []).map((h: string, i: number) => (
                  <li key={i}>• {h}</li>
                ))}
              </ul>
            </section>

            <section className="crm-record-panel space-y-2">
              <h2 className="crm-record-panel-title">{t('privacy.security_heading')}</h2>
              <ul className="text-sm space-y-1.5 text-[color:var(--ink-muted)]">
                {Object.entries(policy.technical_measures_art46 || {}).filter(([k]) => k !== 'note').map(([k, v]) => (
                  <li key={k}><span className="font-medium text-[color:var(--ink)]">{k}:</span> {String(v)}</li>
                ))}
              </ul>
              {policy.technical_measures_art46?.note && (
                <p className="text-xs text-[color:var(--ink-muted)] pt-2 leading-relaxed">{policy.technical_measures_art46.note}</p>
              )}
            </section>

            {policy.marketing_note && (
              <section className="crm-record-panel">
                <p className="text-sm leading-relaxed">{policy.marketing_note}</p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
