import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { ConfirmDialog, FormError, IconTrash } from '../components/crud';

type SavedApp = { id: string; label: string; url: string; created_at: string };

export default function Apps() {
  const { t } = useI18n();
  const [apps, setApps] = useState<SavedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<SavedApp | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/api/apps')
      .then((d) => setApps(d.apps || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!label.trim() || !url.trim()) { setError(t('apps.required')); return; }
    setSaving(true);
    try {
      await api.post('/api/apps', { label: label.trim(), url: url.trim() });
      setLabel('');
      setUrl('');
      load();
    } catch {
      setError(t('apps.invalid_url'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/apps/${deleting.id}`);
      setDeleting(null);
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const initialOf = (s: string) => (s.trim()[0] || '?').toUpperCase();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('apps.title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('apps.subtitle')}</p>
      </div>

      <div className="card p-5">
        <form onSubmit={add} className="space-y-4">
          <FormError message={error} />
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr_auto] gap-3 sm:items-end">
            <div>
              <label className="label">{t('apps.label')} *</label>
              <input
                className="input"
                value={label}
                maxLength={120}
                placeholder={t('apps.label_placeholder')}
                onChange={(e) => setLabel(e.target.value)}
                data-testid="app-label"
              />
            </div>
            <div>
              <label className="label">{t('apps.url')} *</label>
              <input
                className="input"
                value={url}
                inputMode="url"
                placeholder={t('apps.url_placeholder')}
                onChange={(e) => setUrl(e.target.value)}
                data-testid="app-url"
              />
            </div>
            <button type="submit" className="btn-primary sm:w-auto w-full" disabled={saving} data-testid="app-add">
              {saving ? t('common.loading') : `+ ${t('apps.add')}`}
            </button>
          </div>
        </form>
      </div>

      {loading && <div className="text-slate-400 text-sm">{t('common.loading')}</div>}

      {!loading && apps.length === 0 && (
        <div className="card p-10 text-center text-slate-400" data-testid="apps-empty">
          {t('apps.empty')}
        </div>
      )}

      {!loading && apps.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="apps-grid">
          {apps.map((app) => (
            <div key={app.id} className="card relative flex items-center gap-3 p-4 transition-shadow hover:shadow-md">
              <a
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-3"
                data-testid="app-open"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-clinic-400 to-clinic-600 text-lg font-semibold text-white shadow-sm">
                  {initialOf(app.label)}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">{app.label}</div>
                  <div className="truncate text-xs text-slate-500">{hostOf(app.url)}</div>
                </div>
              </a>
              <button
                type="button"
                onClick={() => setDeleting(app)}
                title={t('common.delete')}
                aria-label={t('common.delete')}
                data-testid="app-delete"
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
              >
                <IconTrash />
              </button>
            </div>
          ))}
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          name={deleting.label}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
