import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, RowActions, FormError, FormActions } from '../components/crud';

type ProviderName = 'openai' | 'gemini' | 'a2e';

type ImageIntegrationStatus = {
  order: string[];
  providers: Record<ProviderName, {
    configured: boolean;
    saved_in_settings: boolean;
    source: 'settings' | 'environment' | null;
    model: string;
  }>;
};

const PROVIDERS: Array<{ name: ProviderName; title: string }> = [
  { name: 'openai', title: 'OpenAI' },
  { name: 'gemini', title: 'Gemini' },
  { name: 'a2e', title: 'A2E AI' },
];

const emptyKeys = (): Record<ProviderName, string> => ({ openai: '', gemini: '', a2e: '' });
const emptyClears = (): Record<ProviderName, boolean> => ({ openai: false, gemini: false, a2e: false });

export default function Settings() {
  const { t, locale } = useI18n();
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMint, setShowMint] = useState(false);
  const [minted, setMinted] = useState<{ token: string; prefix: string; scope: string } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [integration, setIntegration] = useState<ImageIntegrationStatus | null>(null);
  const [providerKeys, setProviderKeys] = useState<Record<ProviderName, string>>(emptyKeys);
  const [clearSaved, setClearSaved] = useState<Record<ProviderName, boolean>>(emptyClears);
  const [savingIntegrations, setSavingIntegrations] = useState(false);
  const [integrationError, setIntegrationError] = useState('');
  const [integrationSaved, setIntegrationSaved] = useState(false);

  const copyText = locale.startsWith('pt') ? {
    title: 'Geração de imagens corporais',
    description: 'As chaves são criptografadas e nunca são exibidas novamente. A ordem de tentativa é fixa para evitar resultados idênticos quando um provedor falha.',
    priority: 'Prioridade',
    configured: 'Configurado',
    notConfigured: 'Não configurado',
    saved: 'Salvo nas configurações',
    environment: 'Variável de ambiente',
    keyPlaceholder: 'Cole uma nova chave para substituir a atual',
    keyPlaceholderEmpty: 'Cole a chave da API',
    removeSaved: 'Remover chave salva',
    save: 'Salvar chaves',
    savedMessage: 'Configurações de geração atualizadas.',
    noChanges: 'Digite pelo menos uma chave ou marque uma chave salva para remoção.',
    security: 'As chaves são armazenadas com AES-256-GCM. Campos vazios mantêm a configuração atual.',
    fallback: 'Fallback local',
  } : locale.startsWith('es') ? {
    title: 'Generación de imágenes corporales',
    description: 'Las claves se cifran y nunca se vuelven a mostrar. El orden de intento es fijo para evitar resultados idénticos cuando falla un proveedor.',
    priority: 'Prioridad',
    configured: 'Configurado',
    notConfigured: 'No configurado',
    saved: 'Guardado en configuración',
    environment: 'Variable de entorno',
    keyPlaceholder: 'Pegue una nueva clave para reemplazar la actual',
    keyPlaceholderEmpty: 'Pegue la clave de API',
    removeSaved: 'Eliminar clave guardada',
    save: 'Guardar claves',
    savedMessage: 'Configuración de generación actualizada.',
    noChanges: 'Ingrese al menos una clave o marque una clave guardada para eliminarla.',
    security: 'Las claves se almacenan con AES-256-GCM. Los campos vacíos mantienen la configuración actual.',
    fallback: 'Fallback local',
  } : {
    title: 'Body image generation',
    description: 'Keys are encrypted and never displayed again. Provider priority is fixed to prevent identical results when a provider fails.',
    priority: 'Priority',
    configured: 'Configured',
    notConfigured: 'Not configured',
    saved: 'Saved in settings',
    environment: 'Environment variable',
    keyPlaceholder: 'Paste a new key to replace the current one',
    keyPlaceholderEmpty: 'Paste the API key',
    removeSaved: 'Remove saved key',
    save: 'Save keys',
    savedMessage: 'Image generation settings updated.',
    noChanges: 'Enter at least one key or mark a saved key for removal.',
    security: 'Keys are stored with AES-256-GCM. Empty fields keep the current configuration.',
    fallback: 'Local fallback',
  };

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get('/api/tokens'),
      api.get('/api/integrations'),
    ])
      .then(([tokenData, integrationData]) => {
        setTokens(tokenData.tokens);
        setIntegration(integrationData.image_generation);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale]);

  const saveIntegrations = async (e: React.FormEvent) => {
    e.preventDefault();
    setIntegrationError('');
    setIntegrationSaved(false);

    const payload: Partial<Record<ProviderName, string | null>> = {};
    for (const { name } of PROVIDERS) {
      if (clearSaved[name]) payload[name] = null;
      else if (providerKeys[name].trim()) payload[name] = providerKeys[name].trim();
    }

    if (Object.keys(payload).length === 0) {
      setIntegrationError(copyText.noChanges);
      return;
    }

    setSavingIntegrations(true);
    try {
      const result = await api.put('/api/integrations', payload);
      setIntegration(result.image_generation);
      setProviderKeys(emptyKeys());
      setClearSaved(emptyClears());
      setIntegrationSaved(true);
      setTimeout(() => setIntegrationSaved(false), 3000);
    } catch (e: any) {
      setIntegrationError(e.message || t('errors.generic'));
    } finally {
      setSavingIntegrations(false);
    }
  };

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
      <h1 className="page-title">{t('settings.title')}</h1>

      {error && <FormError message={error} />}

      <form className="card" onSubmit={saveIntegrations} data-testid="image-provider-settings">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-900">{copyText.title}</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">{copyText.description}</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{copyText.priority}</div>
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
              <span className="badge-blue">1 · OpenAI</span>
              <span aria-hidden="true">→</span>
              <span className="badge-slate">2 · Gemini</span>
              <span aria-hidden="true">→</span>
              <span className="badge-slate">3 · A2E AI</span>
              <span aria-hidden="true">→</span>
              <span className="badge-slate">{copyText.fallback}</span>
            </div>
          </div>

          {integrationError && <FormError message={integrationError} />}
          {integrationSaved && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
              ✓ {copyText.savedMessage}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            {PROVIDERS.map(({ name, title }, index) => {
              const status = integration?.providers?.[name];
              return (
                <div key={name} className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {copyText.priority} {index + 1}
                      </div>
                      <h3 className="font-semibold text-slate-900">{title}</h3>
                      <p className="text-xs text-slate-500">{status?.model || '—'}</p>
                    </div>
                    <span className={status?.configured ? 'badge-green' : 'badge-slate'}>
                      {status?.configured ? copyText.configured : copyText.notConfigured}
                    </span>
                  </div>

                  <div>
                    <label className="label" htmlFor={`${name}-api-key`}>API key</label>
                    <input
                      id={`${name}-api-key`}
                      type="password"
                      autoComplete="new-password"
                      className="input font-mono text-sm"
                      value={providerKeys[name]}
                      disabled={clearSaved[name]}
                      placeholder={status?.configured ? copyText.keyPlaceholder : copyText.keyPlaceholderEmpty}
                      onChange={(e) => setProviderKeys((current) => ({ ...current, [name]: e.target.value }))}
                      data-testid={`${name}-api-key`}
                    />
                  </div>

                  <div className="min-h-5 text-xs text-slate-500">
                    {status?.source === 'settings' && copyText.saved}
                    {status?.source === 'environment' && copyText.environment}
                  </div>

                  {status?.saved_in_settings && (
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={clearSaved[name]}
                        onChange={(e) => setClearSaved((current) => ({ ...current, [name]: e.target.checked }))}
                        data-testid={`clear-${name}-api-key`}
                      />
                      {copyText.removeSaved}
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">🔒 {copyText.security}</p>
            <button type="submit" className="btn-primary" disabled={savingIntegrations} data-testid="save-image-provider-keys">
              {savingIntegrations ? t('common.saving') : copyText.save}
            </button>
          </div>
        </div>
      </form>

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
