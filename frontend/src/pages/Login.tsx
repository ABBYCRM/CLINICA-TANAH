import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../hooks/useI18n';
import { api, ApiError } from '../lib/api';

export default function Login() {
  const { t, locale, setLocale, locales, localeLabels } = useI18n();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@clinica-tanah.com.br');
  const [password, setPassword] = useState('clinica2026');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-clinic-500 via-sky-500 to-primary-700 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex w-16 h-16 rounded-full bg-clinic-500 items-center justify-center text-white text-3xl font-bold mb-3">+</div>
          <h1 className="text-2xl font-bold text-slate-900">{t('app.name')}</h1>
          <p className="text-sm text-slate-500">{t('app.tagline')}</p>
          <p className="text-xs text-slate-400 mt-1">{t('app.address')}</p>
        </div>

        <div className="flex justify-center gap-1 mb-4">
          {locales.map((l) => (
            <button key={l} onClick={() => setLocale(l)}
              className={`px-3 py-1 text-xs rounded ${l === locale ? 'bg-clinic-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {localeLabels[l]}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {error && <div className="p-3 bg-rose-50 text-rose-700 rounded text-sm">{error}</div>}
          <div>
            <label className="label">{t('auth.email')}</label>
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('auth.password')}</label>
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? t('common.loading') : t('auth.sign_in')}
          </button>
        </form>

        <div className="mt-6 p-3 bg-slate-50 rounded text-xs text-slate-600 space-y-1">
          <div className="font-semibold text-slate-700">Test users (senha: clinica2026):</div>
          <div>👤 admin@clinica-tanah.com.br</div>
          <div>👨‍⚕️ silva@clinica-tanah.com.br</div>
          <div>👩‍⚕️ santos@clinica-tanah.com.br</div>
          <div>🔒 dpo@clinica-tanah.com.br</div>
        </div>
      </div>
    </div>
  );
}
