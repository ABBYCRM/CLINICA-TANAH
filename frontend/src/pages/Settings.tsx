import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, RowActions, FormError, FormActions } from '../components/crud';

export default function Settings() {
  const { t, locale } = useI18n();
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMint, setShowMint] = useState(false);
  const [minted, setMinted] = useState<{ token: string; prefix: string; scope: string } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/api/tokens')
      .then((d) => setTokens(d.tokens))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale]);

  const revoke = async (id: string) => {
    setError('');
    try {
      await api.del(`/api/tokens/${id}`);
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    }
  };

  const copy = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.token);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = minted.token;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isActive = (tk: any) => !tk.revoked_at && (!tk.expires_at || tk.expires_at > new Date().toISOString());

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{t('settings.title')}</h1>

      {error && <FormError message={error} />}

      <div className="card">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">{t('settings.api_tokens')}</h2>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">{t('settings.api_tokens_desc')}</p>
          </div>
          <button onClick={() => setShowMint(true)} className="btn-primary shrink-0" data-testid="mint-token">
            + {t('settings.mint')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('common.name')}</th>
                <th className="table-th">Token</th>
                <th className="table-th">{t('settings.scope')}</th>
                <th className="table-th">{t('settings.last_used')}</th>
                <th className="table-th">{t('settings.expires')}</th>
                <th className="table-th">{t('common.status')}</th>
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={7} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && tokens.length === 0 && (
                <tr><td colSpan={7} className="table-td text-center py-6 text-slate-400">{t('settings.no_tokens')}</td></tr>
              )}
              {tokens.map((tk) => (
                <tr key={tk.id} className={`hover:bg-slate-50 transition-colors ${isActive(tk) ? '' : 'opacity-50'}`}>
                  <td className="table-td font-medium">{tk.name}</td>
                  <td className="table-td font-mono text-xs">{tk.prefix}…</td>
                  <td className="table-td">
                    <span className={tk.scope === 'read_write' ? 'badge-red' : 'badge-blue'}>
                      {tk.scope === 'read_write' ? t('settings.scope_read_write') : t('settings.scope_read')}
                    </span>
                  </td>
                  <td className="table-td text-xs text-slate-500">{tk.last_used_at || t('settings.never_used')}</td>
                  <td className="table-td text-xs text-slate-500">{tk.expires_at ? tk.expires_at.slice(0, 10) : t('settings.never')}</td>
                  <td className="table-td">
                    {isActive(tk) ? <span className="badge-green">{t('settings.active')}</span> : <span className="badge-slate">{t('settings.revoked')}</span>}
                  </td>
                  <td className="table-td">
                    {isActive(tk) && (
                      <RowActions deleteTestId={`revoke-token-${tk.id}`} onDelete={() => revoke(tk.id)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showMint && (
        <MintForm
          onClose={() => setShowMint(false)}
          onMinted={(result) => { setShowMint(false); setMinted(result); load(); }}
        />
      )}

      {minted && (
        <Modal title={t('settings.minted_title')} onClose={() => setMinted(null)}>
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              ⚠ {t('settings.minted_warning')}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-xl bg-slate-900 text-emerald-300 font-mono text-sm px-4 py-3 break-all select-all" data-testid="minted-token">
                {minted.token}
              </code>
              <button onClick={copy} className="btn-secondary shrink-0" data-testid="copy-token">
                {copied ? `✓ ${t('settings.copied')}` : t('settings.copy')}
              </button>
            </div>
            <p className="text-xs text-slate-500">{t('settings.usage_hint')}</p>
            <div className="flex justify-end">
              <button onClick={() => setMinted(null)} className="btn-primary">{t('common.confirm')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MintForm({ onClose, onMinted }: { onClose: () => void; onMinted: (r: any) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'read_write'>('read_write');
  const [expiresDays, setExpiresDays] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await api.post('/api/tokens', {
        name,
        scope,
        expires_in_days: expiresDays ? Number(expiresDays) : undefined,
      });
      onMinted(res);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('settings.mint')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <label className="label">{t('settings.token_name')} *</label>
          <input className="input" placeholder={t('settings.token_name_hint')} value={name}
            onChange={(e) => setName(e.target.value)} required data-testid="token-name" />
        </div>
        <div>
          <label className="label">{t('settings.scope')}</label>
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value as any)} data-testid="token-scope">
            <option value="read_write">{t('settings.scope_read_write')}</option>
            <option value="read">{t('settings.scope_read')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('settings.expires_days')}</label>
          <input type="number" min={1} max={3650} className="input" placeholder={t('settings.expires_never')}
            value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)} />
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
