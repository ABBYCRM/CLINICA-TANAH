import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../hooks/useI18n';
import { ApiError } from '../lib/api';

function LogoMark({ className = 'w-11 h-11' }: { className?: string }) {
  return (
    <div className={`${className} rounded-2xl bg-gradient-to-br from-clinic-400 to-clinic-600 shadow-lg shadow-clinic-900/30 flex items-center justify-center ring-1 ring-white/20`}>
      <svg viewBox="0 0 24 24" className="w-3/5 h-3/5 text-white" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </div>
  );
}

const inputShell =
  'group relative flex items-center rounded-xl border border-slate-300 bg-white shadow-sm transition-all duration-200 focus-within:border-clinic-500 focus-within:ring-4 focus-within:ring-clinic-500/15 hover:border-slate-400';

export default function Login() {
  const { t, locale, setLocale, locales, localeLabels } = useI18n();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) setError(t('auth.invalid_credentials'));
      else setError(t('errors.generic'));
    } finally {
      setLoading(false);
    }
  };

  const features = [
    {
      label: t('auth.feature_records'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M9 14h6M9 17h4" />
        </svg>
      ),
    },
    {
      label: t('auth.feature_whatsapp'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
        </svg>
      ),
    },
    {
      label: t('auth.feature_lgpd'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen flex bg-slate-950">
      {/* Brand panel — desktop */}
      <aside className="relative hidden lg:flex lg:w-[46%] xl:w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-900 via-clinic-950 to-slate-900 p-12 text-white">
        <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-clinic-500/25 blur-3xl animate-drift" aria-hidden="true" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-sky-500/15 blur-3xl animate-drift-alt" aria-hidden="true" />
        <div className="pointer-events-none absolute top-1/3 right-1/4 h-40 w-40 rounded-full bg-clinic-300/10 blur-2xl animate-drift" aria-hidden="true" />

        <div className="relative animate-fade-in-down">
          <div className="flex items-center gap-4">
            <LogoMark />
            <div>
              <div className="text-xl font-semibold tracking-tight">{t('app.name')}</div>
              <div className="text-sm text-clinic-200/80">{t('app.tagline')}</div>
            </div>
          </div>
        </div>

        <div className="relative space-y-8">
          <h2 className="text-4xl xl:text-5xl font-semibold leading-tight tracking-tight animate-fade-in-up delay-100">
            {t('auth.brand_title')}
          </h2>
          <p className="max-w-md text-base text-slate-300/90 leading-relaxed animate-fade-in-up delay-200">
            {t('auth.brand_subtitle')}
          </p>
          <ul className="space-y-4 animate-fade-in-up delay-300">
            {features.map((f) => (
              <li key={f.label} className="flex items-center gap-3 text-sm text-slate-200">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-clinic-200 ring-1 ring-white/15 backdrop-blur-sm">
                  {f.icon}
                </span>
                {f.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-slate-400 animate-fade-in delay-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-clinic-300" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>{t('auth.secure_notice')}</span>
          <span className="text-slate-600">·</span>
          <span className="truncate">{t('app.address')}</span>
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-slate-50 px-0 py-0 lg:px-8 lg:py-8">
        <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-clinic-100/70 blur-3xl" />
          <div className="absolute bottom-0 -left-16 h-72 w-72 rounded-full bg-sky-100/60 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md max-lg:self-start px-4 sm:px-8 pb-8 lg:px-0 lg:pb-0">
          {/* Mobile brand header — gradient bleeds to the screen edges, card overlaps it */}
          <div className="relative -mx-4 sm:-mx-8 -mb-14 overflow-hidden bg-gradient-to-br from-slate-900 via-clinic-950 to-slate-900 px-6 pt-12 pb-24 text-center text-white lg:hidden">
            <div className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-clinic-500/30 blur-3xl animate-drift" aria-hidden="true" />
            <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-sky-500/20 blur-3xl animate-drift-alt" aria-hidden="true" />
            <div className="relative flex flex-col items-center animate-fade-in-down">
              <LogoMark className="w-14 h-14" />
              <h1 className="mt-3 text-xl font-semibold tracking-tight">{t('app.name')}</h1>
              <p className="mt-1 text-sm text-clinic-200/80">{t('app.tagline')}</p>
            </div>
          </div>

          <div className="card relative animate-fade-in-up border-slate-200/80 p-6 shadow-xl shadow-slate-900/5 sm:p-8" data-testid="login-card">
            <div className="mb-6 hidden lg:block">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t('auth.welcome')}</h1>
              <p className="mt-1 text-sm text-slate-500">{t('auth.subtitle')}</p>
            </div>

            {/* Locale switcher */}
            <div className="mb-6 flex justify-center" data-testid="locale-switcher">
              <div className="inline-flex rounded-full bg-slate-100 p-1 ring-1 ring-slate-200">
                {locales.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLocale(l)}
                    aria-pressed={l === locale}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${
                      l === locale
                        ? 'bg-white text-clinic-700 shadow-sm ring-1 ring-slate-200'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {localeLabels[l]}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={submit} className="space-y-4" noValidate={false}>
              {error && (
                <div
                  data-testid="login-error"
                  role="alert"
                  className="animate-shake flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                  </svg>
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="login-email" className="label">{t('auth.email')}</label>
                <div className={inputShell}>
                  <span className="pointer-events-none pl-3.5 text-slate-400 transition-colors group-focus-within:text-clinic-600">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
                    </svg>
                  </span>
                  <input
                    id="login-email"
                    data-testid="login-email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="nome@clinica-tanah.com.br"
                    className="w-full rounded-xl bg-transparent px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="label">{t('auth.password')}</label>
                <div className={inputShell}>
                  <span className="pointer-events-none pl-3.5 text-slate-400 transition-colors group-focus-within:text-clinic-600">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                  </span>
                  <input
                    id="login-password"
                    data-testid="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full rounded-xl bg-transparent px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    data-testid="toggle-password"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t('auth.hide_password') : t('auth.show_password')}
                    className="mr-2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><path d="m1 1 22 22" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                data-testid="login-submit"
                className="btn-primary h-11 w-full rounded-xl text-[15px] font-semibold shadow-clinic-600/20 transition-all duration-200 hover:shadow-lg hover:shadow-clinic-600/25"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
                    </svg>
                    {t('common.loading')}
                  </>
                ) : (
                  t('auth.sign_in')
                )}
              </button>
            </form>

            <details className="group mt-6 rounded-xl border border-slate-200 bg-slate-50/80 text-xs text-slate-600 open:shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 font-medium text-slate-700 transition-colors hover:text-slate-900 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-clinic-600" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
                  </svg>
                  {t('auth.demo_accounts')}
                </span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <div className="space-y-1 border-t border-slate-200 px-3.5 py-3">
                <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">{t('auth.demo_password_hint')}</div>
                <div className="font-mono">admin@clinica-tanah.com.br</div>
                <div className="font-mono">silva@clinica-tanah.com.br</div>
                <div className="font-mono">santos@clinica-tanah.com.br</div>
                <div className="font-mono">dpo@clinica-tanah.com.br</div>
              </div>
            </details>
          </div>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400 animate-fade-in delay-200">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-clinic-500" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {t('auth.secure_notice')}
          </p>
        </div>
      </main>
    </div>
  );
}
