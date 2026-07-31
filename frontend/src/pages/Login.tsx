import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../hooks/useI18n';
import { ApiError } from '../lib/api';

function LogoMark({ className = 'w-11 h-11' }: { className?: string }) {
  return (
    <div className={`brand-medallion ${className}`}>
      <svg viewBox="0 0 24 24" className="w-3/5 h-3/5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </div>
  );
}

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
    <div className="login-desk min-h-screen flex">
      {/* Brand panel — wood grain plane */}
      <aside className="relative hidden lg:flex lg:w-[46%] xl:w-1/2 flex-col justify-between overflow-hidden shell-wood p-12 text-[#eef5ea]">
        <div
          className="pointer-events-none absolute inset-0 opacity-40 animate-drift"
          style={{
            background:
              'radial-gradient(ellipse 70% 50% at 15% 20%, rgba(143,168,122,0.35), transparent 55%), radial-gradient(ellipse 50% 40% at 85% 85%, rgba(90,70,50,0.3), transparent 50%)',
          }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.7\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
          }}
          aria-hidden="true"
        />

        <div className="relative animate-fade-in-down">
          <div className="flex items-center gap-4">
            <LogoMark className="w-12 h-12" />
            <div className="text-sm text-[#9bb89a]">{t('app.tagline')}</div>
          </div>
        </div>

        <div className="relative space-y-6">
          <h1 className="font-display text-[2.75rem] xl:text-[3.35rem] font-semibold leading-[1.05] tracking-tight animate-fade-in-up delay-100">
            {t('app.name')}
          </h1>
          <p className="max-w-md text-[1.05rem] text-[#c5d4c4] leading-relaxed animate-fade-in-up delay-200">
            {t('auth.brand_subtitle')}
          </p>
          <ul className="space-y-3.5 animate-fade-in-up delay-300">
            {features.map((f) => (
              <li key={f.label} className="flex items-center gap-3 text-sm text-[#d7e4d3]">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl text-[#eef5ea] border border-white/10"
                  style={{
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2), 0 2px 6px rgba(0,0,0,0.2)',
                  }}
                >
                  {f.icon}
                </span>
                {f.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-[#8aa58a] animate-fade-in delay-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>{t('auth.secure_notice')}</span>
          <span className="text-[#5a705a]">·</span>
          <span className="truncate">{t('app.address')}</span>
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-0 py-0 lg:px-8 lg:py-8">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-[#9bb89a]/25 blur-3xl animate-drift" />
          <div className="absolute bottom-0 -left-16 h-72 w-72 rounded-full bg-[#8a6a45]/12 blur-3xl animate-drift-alt" />
        </div>

        <div className="relative w-full max-w-md max-lg:self-start px-4 sm:px-8 pb-8 lg:px-0 lg:pb-0">
          {/* Mobile brand header — full-bleed wood */}
          <div className="relative -mx-4 sm:-mx-8 -mb-14 overflow-hidden shell-wood px-6 pt-12 pb-24 text-center text-[#eef5ea] lg:hidden">
            <div
              className="pointer-events-none absolute inset-0 opacity-50 animate-leaf"
              style={{ background: 'radial-gradient(ellipse at 70% 20%, rgba(143,168,122,0.4), transparent 55%)' }}
              aria-hidden="true"
            />
            <div className="relative flex flex-col items-center animate-fade-in-down">
              <LogoMark className="w-14 h-14" />
              <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">{t('app.name')}</h1>
              <p className="mt-1 text-sm text-[#9bb89a]">{t('app.tagline')}</p>
            </div>
          </div>

          <div className="panel-inset relative animate-fade-in-up p-6 sm:p-8" data-testid="login-card">
            <div className="mb-6 hidden lg:block">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-[#243328]">{t('auth.welcome')}</h2>
              <p className="mt-1 text-sm text-[#5c6558]">{t('auth.subtitle')}</p>
            </div>

            <div className="mb-6 flex justify-center" data-testid="locale-switcher">
              <div
                className="inline-flex rounded-xl p-0.5"
                style={{
                  background: 'linear-gradient(180deg, #dde6d9, #eef3ea)',
                  border: '1px solid rgba(63,92,66,0.22)',
                  boxShadow: 'inset 0 2px 4px rgba(40,55,35,0.12)',
                }}
              >
                {locales.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLocale(l)}
                    aria-pressed={l === locale}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 ${
                      l === locale
                        ? 'text-white shadow-knob'
                        : 'text-[#5c6558] hover:text-[#243328]'
                    }`}
                    style={l === locale ? { background: 'linear-gradient(180deg, #5f8768, #3f5c42)' } : undefined}
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
                  className="animate-shake flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm text-[#6e3228]"
                  style={{
                    background: 'linear-gradient(180deg, #f5e4df, #edd4cd)',
                    border: '1px solid rgba(143,74,61,0.35)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)',
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                  </svg>
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="login-email" className="label">{t('auth.email')}</label>
                <input
                  id="login-email"
                  data-testid="login-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="nome@clinica-tanah.com.br"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div>
                <label htmlFor="login-password" className="label">{t('auth.password')}</label>
                <div className="relative">
                  <input
                    id="login-password"
                    data-testid="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="input pr-11"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    data-testid="toggle-password"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t('auth.hide_password') : t('auth.show_password')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[#7a8476] transition-colors hover:bg-[#e2ebe0] hover:text-[#3f5c42]"
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
                className="btn-primary h-11 w-full text-[15px]"
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

            <details className="group mt-6 rounded-xl text-xs text-[#5c6558] open:shadow-sm"
              style={{
                background: 'linear-gradient(180deg, #eef3ea, #e2ebe0)',
                border: '1px solid rgba(63,92,66,0.2)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
              }}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 font-semibold text-[#334a36] transition-colors hover:text-[#243328] [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-[#3f5c42]" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
                  </svg>
                  {t('auth.demo_accounts')}
                </span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <div className="space-y-1 border-t border-[rgba(63,92,66,0.15)] px-3.5 py-3">
                <div className="mb-1.5 text-[11px] uppercase tracking-wide text-[#7a8476]">{t('auth.demo_password_hint')}</div>
                <div className="font-mono">admin@clinica-tanah.com.br</div>
                <div className="font-mono">silva@clinica-tanah.com.br</div>
                <div className="font-mono">santos@clinica-tanah.com.br</div>
                <div className="font-mono">dpo@clinica-tanah.com.br</div>
              </div>
            </details>
          </div>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-[#7a8476] animate-fade-in delay-200">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-[#3f5c42]" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {t('auth.secure_notice')}
          </p>
        </div>
      </main>
    </div>
  );
}
