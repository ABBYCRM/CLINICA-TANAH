import { useEffect, useState } from 'react';
import { api, apiErrorKey } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, FormError, FormActions, IconTrash } from '../components/crud';

type Tab = 'chat' | 'campaigns' | 'templates' | 'automations' | 'audience' | 'analytics' | 'surveys';

const TABS: Tab[] = ['chat', 'campaigns', 'templates', 'automations', 'audience', 'analytics', 'surveys'];

const AUDIENCE_OPTIONS = [
  'all_consented', 'recent_30d', 'inactive_90d', 'birthday_month', 'upcoming_7d', 'high_nps',
] as const;

export default function WhatsApp() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>('chat');
  const [status, setStatus] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<'send' | 'simulate'>('send');
  const [error, setError] = useState('');
  const [ping, setPing] = useState<{ state: 'idle' | 'loading' | 'ok' | 'fail'; detail?: string }>({ state: 'idle' });
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const loadConversations = () => {
    api.get('/api/whatsapp/conversations').then((d) => setConversations(d.conversations)).catch(console.error);
  };

  useEffect(() => {
    api.get('/api/whatsapp/status').then(setStatus).catch(console.error);
    loadConversations();
  }, [locale]);

  const loadMessages = (phone: string) => {
    api.get(`/api/whatsapp/messages?phone=${encodeURIComponent(phone)}`)
      .then((d) => setMessages(d.messages))
      .catch(console.error);
  };

  useEffect(() => {
    if (activePhone) loadMessages(activePhone);
  }, [activePhone]);

  const send = async () => {
    if (!input.trim() || !activePhone) return;
    setSending(true);
    setError('');
    try {
      if (mode === 'simulate') {
        await api.post('/api/whatsapp/simulate', { phone: activePhone, body: input, locale });
      } else {
        await api.post('/api/whatsapp/send', { phone: activePhone, body: input });
      }
      setInput('');
      loadMessages(activePhone);
      loadConversations();
    } catch (e: any) {
      setError(e.body?.error === 'opted_out' ? t('whatsapp.opted_out_error') : t(apiErrorKey(e)));
    } finally {
      setSending(false);
    }
  };

  const testConnection = async () => {
    setPing({ state: 'loading' });
    try {
      const res = await api.get('/api/whatsapp/ping');
      if (res.reachable) setPing({ state: 'ok', detail: `${res.verified_name ?? ''} ${res.display_phone ?? ''}`.trim() });
      else setPing({ state: 'fail', detail: res.error || 'unreachable' });
    } catch (e: any) {
      setPing({ state: 'fail', detail: e.message });
    }
  };

  const removeConversation = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/whatsapp/conversations/${encodeURIComponent(deleting.phone)}`);
      if (activePhone === deleting.phone) { setActivePhone(null); setMessages([]); }
      setDeleting(null);
      loadConversations();
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="whatsapp-marketing">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('whatsapp.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('whatsapp.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-lg">
            {TABS.map((k) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-2.5 py-1.5 text-sm rounded-md transition-all ${tab === k ? 'bg-white shadow-sm text-clinic-700 font-medium' : 'text-slate-600 hover:text-slate-900'}`}
                data-testid={`tab-${k}`}>
                {t(`whatsapp.tab_${k}`)}
              </button>
            ))}
          </div>
          {tab === 'chat' && (
            <button onClick={() => setNewChatOpen(true)} className="btn-primary" data-testid="new-chat">+ {t('whatsapp.new_chat')}</button>
          )}
        </div>
      </div>

      {status && (
        <div className="card p-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${status.live ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span className="font-medium text-slate-700">{status.live ? t('whatsapp.live') : t('whatsapp.dry_run')}</span>
          </span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">{status.conversations_count} {t('whatsapp.conversations').toLowerCase()} · {status.messages_count} msg</span>
          {status.live && (
            <>
              <span className="text-slate-400">·</span>
              <span className={`text-xs ${status.app_secret_configured ? 'text-emerald-700' : 'text-amber-700'}`}>
                {status.app_secret_configured ? '✓ signature' : '⚠ no app secret'}
              </span>
            </>
          )}
          <span className="flex-1" />
          <button onClick={testConnection} disabled={ping.state === 'loading'} className="btn-secondary text-xs" data-testid="test-connection">
            {ping.state === 'loading' ? '…' : `⚡ ${t('whatsapp.test_connection')}`}
          </button>
          {ping.state === 'ok' && <span className="badge-green" data-testid="ping-ok">✓ {t('whatsapp.connection_ok')}{ping.detail ? ` — ${ping.detail}` : ''}</span>}
          {ping.state === 'fail' && <span className="badge-red" data-testid="ping-fail">✕ {t('whatsapp.connection_failed')}{ping.detail ? ` — ${ping.detail}` : ''}</span>}
        </div>
      )}

      {error && <FormError message={error} />}

      {tab === 'campaigns' && <CampaignsView />}
      {tab === 'templates' && <TemplatesView />}
      {tab === 'automations' && <AutomationsView />}
      {tab === 'audience' && <AudienceView />}
      {tab === 'analytics' && <AnalyticsView />}
      {tab === 'surveys' && <SurveysView />}

      {tab === 'chat' && (
      <div className="grid md:grid-cols-3 gap-4 h-[600px]">
        <div className="card overflow-y-auto">
          <div className="p-3 border-b bg-slate-50 font-semibold text-sm">{t('whatsapp.conversations')}</div>
          {conversations.map((c) => (
            <div key={c.id} className={`group relative border-b transition-colors ${activePhone === c.phone ? 'bg-clinic-50' : 'hover:bg-slate-50'}`}>
              <button onClick={() => setActivePhone(c.phone)} className="w-full text-left p-3">
                <div className="font-medium text-sm pr-7">{c.patient_name || c.phone}</div>
                <div className="text-xs text-slate-500 font-mono">{c.phone}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`badge ${c.lgpd_consent_granted ? 'badge-green' : 'badge-yellow'}`}>
                    {c.lgpd_consent_granted ? '✓ LGPD' : '⚠ LGPD'}
                  </span>
                  {c.opted_out ? <span className="badge-red">SAIR</span> : null}
                  <span className="text-xs text-slate-400">{c.state}</span>
                </div>
              </button>
              <button
                onClick={() => setDeleting(c)}
                title={t('whatsapp.delete_conversation')}
                className="absolute top-3 right-2 rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600 opacity-0 group-hover:opacity-100"
              >
                <IconTrash />
              </button>
            </div>
          ))}
          {conversations.length === 0 && <div className="p-6 text-center text-slate-400 text-sm">{t('common.no_data')}</div>}
        </div>

        <div className="card md:col-span-2 flex flex-col">
          {activePhone ? (
            <>
              <div className="p-3 border-b bg-slate-50 flex items-center justify-between gap-2">
                <span className="font-mono text-sm">{activePhone}</span>
                <div className="flex gap-1 bg-slate-200/70 p-0.5 rounded-lg text-xs">
                  <button onClick={() => setMode('send')}
                    className={`px-2.5 py-1 rounded-md transition-all ${mode === 'send' ? 'bg-white shadow-sm text-clinic-700 font-medium' : 'text-slate-500'}`}
                    data-testid="mode-send">
                    {t('whatsapp.send_as_clinic')}
                  </button>
                  <button onClick={() => setMode('simulate')}
                    className={`px-2.5 py-1 rounded-md transition-all ${mode === 'simulate' ? 'bg-white shadow-sm text-clinic-700 font-medium' : 'text-slate-500'}`}
                    data-testid="mode-simulate">
                    {t('whatsapp.simulate_patient')}
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === 'in' ? 'bg-slate-100 text-slate-800' : 'bg-clinic-500 text-white'
                    }`}>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className={`text-xs mt-1 flex items-center gap-1 ${m.direction === 'in' ? 'text-slate-400' : 'text-clinic-100'}`}>
                        {new Date(m.created_at).toLocaleTimeString(locale === 'pt-BR' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US')}
                        {m.direction === 'out' && m.status && <span className="opacity-80">· {m.status}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t bg-slate-50 flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder={mode === 'simulate' ? t('whatsapp.simulator_help') : t('whatsapp.type_message')}
                  className="input flex-1"
                  data-testid="chat-input"
                />
                <button onClick={send} disabled={sending} className="btn-primary" data-testid="chat-send">
                  {sending ? '…' : t('whatsapp.send')}
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              ← {t('whatsapp.simulator_help')}
            </div>
          )}
        </div>
      </div>
      )}

      {newChatOpen && (
        <NewChatModal
          onClose={() => setNewChatOpen(false)}
          onStart={(phone) => { setNewChatOpen(false); setActivePhone(phone); loadConversations(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={deleting.patient_name || deleting.phone}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={removeConversation}
        />
      )}
    </div>
  );
}

function CampaignsView() {
  const { t, locale } = useI18n();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/api/whatsapp/campaigns')
      .then((d) => setCampaigns(d.campaigns))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale]);

  const dispatch = async (c: any) => {
    setDispatching(c.id);
    setError('');
    setNotice('');
    try {
      const res = await api.post(`/api/whatsapp/campaigns/${c.id}/dispatch`, {});
      setNotice(t('whatsapp.dispatched_toast', { sent: res.sent, failed: res.failed }));
      load();
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
    } finally {
      setDispatching(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/whatsapp/campaigns/${deleting.id}`);
      setDeleting(null);
      load();
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 max-w-2xl">{t('whatsapp.audience_info')}</p>
        <button onClick={() => setShowForm(true)} className="btn-primary shrink-0" data-testid="new-campaign">
          + {t('whatsapp.new_campaign')}
        </button>
      </div>

      {error && <FormError message={error} />}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 animate-fade-in">{notice}</div>}

      <div className="grid gap-3">
        {loading && <div className="text-slate-400 py-6 text-center">{t('common.loading')}</div>}
        {!loading && campaigns.length === 0 && <div className="card p-6 text-center text-slate-400">{t('common.no_data')}</div>}
        {campaigns.map((c) => (
          <div key={c.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-900">{c.name}</span>
                  <span className={`badge ${c.status === 'sent' ? 'badge-green' : c.status === 'draft' ? 'badge-yellow' : 'badge-blue'}`}>{c.status}</span>
                  {c.audience && <span className="badge-blue">{t(`whatsapp.segment_${c.audience}`)}</span>}
                  {c.category && <span className="text-xs text-slate-400">{t(`whatsapp.cat_${c.category}`)}</span>}
                </div>
                <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{c.message}</p>
                <div className="text-xs text-slate-400 mt-2">
                  {c.created_by_name} · {c.created_at}
                  {c.status === 'sent' && (
                    <span> · {t('whatsapp.sent_count')}: <b className="text-emerald-700">{c.sent_count}</b> · {t('whatsapp.failed_count')}: <b className={c.failed_count ? 'text-rose-600' : ''}>{c.failed_count}</b></span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {c.status === 'draft' && (
                  <>
                    <button onClick={() => dispatch(c)} disabled={dispatching === c.id} className="btn-primary text-xs" data-testid={`dispatch-${c.id}`}>
                      {dispatching === c.id ? '…' : `🚀 ${t('whatsapp.dispatch')}`}
                    </button>
                    <button onClick={() => setDeleting(c)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors" title={t('common.delete')}>
                      <IconTrash />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <CampaignForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
      )}
      {deleting && (
        <ConfirmDialog name={deleting.name} busy={busy} onCancel={() => setDeleting(null)} onConfirm={remove} />
      )}
    </div>
  );
}

function CampaignForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<string>('all_consented');
  const [category, setCategory] = useState('marketing');
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/whatsapp/templates').then((d) => setTemplates(d.templates || [])).catch(() => {});
  }, []);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = templates.find((x) => x.id === id);
    if (tpl) {
      setMessage(tpl.body);
      setCategory(tpl.category === 'utility' ? 'utility' : 'marketing');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post('/api/whatsapp/campaigns', {
        name, message, audience, category, template_id: templateId || null,
      });
      onSaved();
    } catch (err: any) {
      setError(t(apiErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('whatsapp.new_campaign')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <label className="label">{t('whatsapp.campaign_name')} *</label>
          <input className="input" placeholder="Dia do Cliente — Agosto" value={name} onChange={(e) => setName(e.target.value)} required data-testid="campaign-name" />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">{t('whatsapp.audience_segment')}</label>
            <select className="input" value={audience} onChange={(e) => setAudience(e.target.value)} data-testid="campaign-audience">
              {AUDIENCE_OPTIONS.map((s) => (
                <option key={s} value={s}>{t(`whatsapp.segment_${s}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('whatsapp.category')}</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="campaign-category">
              <option value="marketing">{t('whatsapp.cat_marketing')}</option>
              <option value="utility">{t('whatsapp.cat_utility')}</option>
            </select>
          </div>
        </div>
        {templates.length > 0 && (
          <div>
            <label className="label">{t('whatsapp.use_template')}</label>
            <select className="input" value={templateId} onChange={(e) => applyTemplate(e.target.value)} data-testid="campaign-template">
              <option value="">—</option>
              {templates.filter((x) => x.status === 'approved').map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tpl.name} ({tpl.category})</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">{t('whatsapp.campaign_message')} *</label>
          <textarea className="input" rows={5} placeholder="Olá {{name}}! 💙 Semana do Cliente na Clínica Tanah…"
            value={message} onChange={(e) => setMessage(e.target.value)} required data-testid="campaign-message" />
          <p className="text-xs text-slate-400 mt-1">{t('whatsapp.campaign_hint')}</p>
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function TemplatesView() {
  const { t, locale } = useI18n();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/api/whatsapp/templates')
      .then((d) => setTemplates(d.templates || []))
      .catch((e) => setError(t(apiErrorKey(e))))
      .finally(() => setLoading(false));
  };
  useEffect(load, [locale]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/whatsapp/templates/${deleting.id}`);
      setDeleting(null);
      load();
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (tpl: any, status: string) => {
    try {
      await api.put(`/api/whatsapp/templates/${tpl.id}`, { status });
      load();
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
    }
  };

  return (
    <div className="space-y-4" data-testid="templates-view">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 max-w-2xl">{t('whatsapp.templates_info')}</p>
        <button onClick={() => setShowForm(true)} className="btn-primary shrink-0" data-testid="new-template">
          + {t('whatsapp.new_template')}
        </button>
      </div>
      {error && <FormError message={error} />}
      {loading && <div className="text-slate-400 py-6 text-center">{t('common.loading')}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((tpl) => (
          <div key={tpl.id} className="card p-4 space-y-2" data-testid={`template-${tpl.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-900">{tpl.name}</div>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span className="badge-blue">{t(`whatsapp.cat_${tpl.category}`)}</span>
                  <span className={`badge ${tpl.status === 'approved' ? 'badge-green' : tpl.status === 'rejected' ? 'badge-red' : 'badge-yellow'}`}>
                    {t(`whatsapp.tpl_status_${tpl.status}`)}
                  </span>
                </div>
              </div>
              <button onClick={() => setDeleting(tpl)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title={t('common.delete')}>
                <IconTrash />
              </button>
            </div>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{tpl.body}</p>
            {tpl.status !== 'approved' && (
              <button onClick={() => setStatus(tpl, 'approved')} className="btn-secondary text-xs" data-testid={`approve-${tpl.id}`}>
                {t('whatsapp.mark_approved')}
              </button>
            )}
          </div>
        ))}
      </div>
      {showForm && <TemplateForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
      {deleting && <ConfirmDialog name={deleting.name} busy={busy} onCancel={() => setDeleting(null)} onConfirm={remove} />}
    </div>
  );
}

function TemplateForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('marketing');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/api/whatsapp/templates', { name, category, body, status: 'approved' });
      onSaved();
    } catch (err: any) {
      setError(t(apiErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('whatsapp.new_template')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <label className="label">{t('common.name')} *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required data-testid="template-name" />
        </div>
        <div>
          <label className="label">{t('whatsapp.category')}</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="template-category">
            <option value="marketing">{t('whatsapp.cat_marketing')}</option>
            <option value="utility">{t('whatsapp.cat_utility')}</option>
            <option value="authentication">{t('whatsapp.cat_authentication')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('whatsapp.campaign_message')} *</label>
          <textarea className="input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} required data-testid="template-body" />
          <p className="text-xs text-slate-400 mt-1">{t('whatsapp.campaign_hint')}</p>
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function AutomationsView() {
  const { t, locale } = useI18n();
  const [autos, setAutos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [running, setRunning] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get('/api/whatsapp/automations')
      .then((d) => setAutos(d.automations || []))
      .catch((e) => setError(t(apiErrorKey(e))))
      .finally(() => setLoading(false));
  };
  useEffect(load, [locale]);

  const toggle = async (a: any) => {
    try {
      await api.put(`/api/whatsapp/automations/${a.id}`, { enabled: !a.enabled });
      load();
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
    }
  };

  const run = async (a: any) => {
    setRunning(a.id);
    setError('');
    setNotice('');
    try {
      const res = await api.post(`/api/whatsapp/automations/${a.id}/run`, {});
      setNotice(t('whatsapp.automation_ran', { sent: res.sent ?? 0, failed: res.failed ?? 0 }));
      load();
    } catch (e: any) {
      setError(e.body?.error === 'disabled' ? t('whatsapp.automation_disabled') : t(apiErrorKey(e)));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="automations-view">
      <p className="text-sm text-slate-500 max-w-3xl">{t('whatsapp.automations_info')}</p>
      {error && <FormError message={error} />}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</div>}
      {loading && <div className="text-slate-400 py-6 text-center">{t('common.loading')}</div>}
      <div className="grid gap-3">
        {autos.map((a) => (
          <div key={a.id} className="card p-4 flex flex-col sm:flex-row sm:items-start gap-3 justify-between" data-testid={`automation-${a.key}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-900">{a.name}</span>
                <span className={`badge ${a.enabled ? 'badge-green' : 'badge-yellow'}`}>
                  {a.enabled ? t('whatsapp.active') : t('whatsapp.inactive')}
                </span>
                <span className="text-xs text-slate-400 font-mono">{a.key}</span>
              </div>
              <p className="text-sm text-slate-500 mt-1">{a.description}</p>
              <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap border-l-2 border-clinic-200 pl-3">{a.message}</p>
              {a.last_run_at && (
                <p className="text-xs text-slate-400 mt-2">
                  {t('whatsapp.last_run')}: {a.last_run_at} · {t('whatsapp.sent_count')}: {a.last_sent_count}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => toggle(a)} className="btn-secondary text-xs" data-testid={`toggle-${a.key}`}>
                {a.enabled ? t('whatsapp.disable') : t('whatsapp.enable')}
              </button>
              <button onClick={() => run(a)} disabled={!!running || !a.enabled} className="btn-primary text-xs" data-testid={`run-${a.key}`}>
                {running === a.id ? '…' : t('whatsapp.run_now')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AudienceView() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<any>(null);
  const [segment, setSegment] = useState<string>('all_consented');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/api/whatsapp/audience?segment=${encodeURIComponent(segment)}`)
      .then(setData)
      .catch((e) => setError(t(apiErrorKey(e))))
      .finally(() => setLoading(false));
  }, [locale, segment]);

  return (
    <div className="space-y-4" data-testid="audience-view">
      <p className="text-sm text-slate-500 max-w-3xl">{t('whatsapp.audience_hub_info')}</p>
      {error && <FormError message={error} />}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {AUDIENCE_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSegment(s)}
              className={`card p-4 text-left transition-all ${segment === s ? 'ring-2 ring-clinic-400' : 'hover:bg-slate-50'}`}
              data-testid={`segment-${s}`}
            >
              <div className="text-xs text-slate-500 mb-1">{t(`whatsapp.segment_${s}`)}</div>
              <div className="text-2xl font-bold text-slate-900">{data.segments?.[s] ?? '—'}</div>
            </button>
          ))}
          <div className="card p-4">
            <div className="text-xs text-slate-500 mb-1">{t('whatsapp.opted_out_wa')}</div>
            <div className="text-2xl font-bold text-rose-600">{data.opted_out_whatsapp ?? 0}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-slate-500 mb-1">{t('whatsapp.with_phone')}</div>
            <div className="text-2xl font-bold text-slate-900">{data.with_phone ?? 0}</div>
          </div>
        </div>
      )}
      {loading && <div className="text-slate-400 py-6 text-center">{t('common.loading')}</div>}
      {data?.preview && (
        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b font-semibold text-sm">{t('whatsapp.segment_preview')} — {t(`whatsapp.segment_${segment}`)}</div>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('common.name')}</th>
                <th className="table-th">{t('common.phone')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.preview.length === 0 && (
                <tr><td colSpan={2} className="table-td text-center text-slate-400 py-6">{t('common.no_data')}</td></tr>
              )}
              {data.preview.map((p: any) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="table-td">{p.full_name}</td>
                  <td className="table-td font-mono text-sm">{p.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AnalyticsView() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get('/api/whatsapp/analytics')
      .then(setData)
      .catch((e) => setError(t(apiErrorKey(e))))
      .finally(() => setLoading(false));
  }, [locale]);

  if (loading) return <div className="text-slate-400 py-6 text-center">{t('common.loading')}</div>;
  if (error) return <FormError message={error} />;
  if (!data) return null;

  const kpis = [
    { label: t('whatsapp.outbound_30d'), value: data.outbound },
    { label: t('whatsapp.inbound_30d'), value: data.inbound },
    { label: t('whatsapp.delivery_rate'), value: `${data.delivery_rate}%` },
    { label: t('whatsapp.read_rate'), value: `${data.read_rate}%` },
    { label: t('whatsapp.templates_approved'), value: data.templates_approved },
    { label: t('whatsapp.automations_on'), value: data.automations_enabled },
  ];

  return (
    <div className="space-y-4" data-testid="analytics-view">
      <p className="text-sm text-slate-500">{t('whatsapp.analytics_info')}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="card p-4 text-center">
            <div className="text-xs text-slate-500 mb-1 truncate">{k.label}</div>
            <div className="text-2xl font-bold text-slate-900">{k.value}</div>
          </div>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <div className="px-4 py-3 border-b font-semibold text-sm">{t('whatsapp.tab_campaigns')}</div>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">{t('whatsapp.campaign_name')}</th>
              <th className="table-th">{t('common.status')}</th>
              <th className="table-th">{t('whatsapp.sent_count')}</th>
              <th className="table-th">{t('whatsapp.failed_count')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data.campaigns || []).length === 0 && (
              <tr><td colSpan={4} className="table-td text-center text-slate-400 py-6">{t('common.no_data')}</td></tr>
            )}
            {(data.campaigns || []).map((c: any) => (
              <tr key={c.id}>
                <td className="table-td">{c.name}</td>
                <td className="table-td">{c.status}</td>
                <td className="table-td">{c.sent_count}</td>
                <td className="table-td">{c.failed_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SurveysView() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/api/whatsapp/surveys')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale]);

  const dispatch = async () => {
    setDispatching(true);
    setError('');
    setNotice('');
    try {
      const res = await api.post('/api/whatsapp/surveys/dispatch', { days: 7 });
      setNotice(t('whatsapp.survey_dispatched', { count: res.dispatched }));
      load();
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
    } finally {
      setDispatching(false);
    }
  };

  const npsColor = (nps: number) => nps >= 50 ? 'text-emerald-700' : nps >= 0 ? 'text-amber-700' : 'text-rose-600';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 max-w-2xl">{t('whatsapp.no_surveys')}</p>
        <button onClick={dispatch} disabled={dispatching} className="btn-primary shrink-0" data-testid="dispatch-surveys">
          {dispatching ? '…' : `📨 ${t('whatsapp.survey_dispatch')}`}
        </button>
      </div>

      {error && <FormError message={error} />}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 animate-fade-in">{notice}</div>}

      {loading && <div className="text-slate-400 py-6 text-center">{t('common.loading')}</div>}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'NPS', value: data.nps, cls: npsColor(data.nps) },
              { label: t('whatsapp.avg_score'), value: data.average, cls: 'text-slate-900' },
              { label: t('whatsapp.responses'), value: data.total, cls: 'text-slate-900' },
              { label: t('whatsapp.promoters'), value: data.promoters, cls: 'text-emerald-700' },
              { label: t('whatsapp.passives'), value: data.passives, cls: 'text-amber-700' },
              { label: t('whatsapp.detractors'), value: data.detractors, cls: 'text-rose-600' },
            ].map((c) => (
              <div key={c.label} className="card p-4 text-center" data-testid={`survey-kpi-${c.label}`}>
                <div className="text-xs text-slate-500 mb-1 truncate">{c.label}</div>
                <div className={`text-2xl font-bold ${c.cls}`}>{c.value}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-th">{t('common.date')}</th>
                    <th className="table-th">{t('appointments.patient')}</th>
                    <th className="table-th text-center">{t('whatsapp.score')}</th>
                    <th className="table-th">{t('whatsapp.comment')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.surveys.length === 0 && (
                    <tr><td colSpan={4} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>
                  )}
                  {data.surveys.map((s: any) => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="table-td whitespace-nowrap text-xs">{s.created_at}</td>
                      <td className="table-td">{s.patient_name}</td>
                      <td className="table-td text-center">
                        <span className={`badge ${s.score >= 9 ? 'badge-green' : s.score >= 7 ? 'badge-yellow' : 'badge-red'}`}>{s.score}</span>
                      </td>
                      <td className="table-td text-sm text-slate-600">{s.comment || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NewChatModal({ onClose, onStart }: { onClose: () => void; onStart: (phone: string) => void }) {
  const { t, locale } = useI18n();
  const [phone, setPhone] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (firstMessage.trim()) {
        await api.post('/api/whatsapp/send', { phone, body: firstMessage });
      } else {
        await api.post('/api/whatsapp/simulate', { phone, body: 'oi', locale });
      }
      onStart(phone);
    } catch (err: any) {
      setError(err.body?.error === 'opted_out' ? t('whatsapp.opted_out_error') : t(apiErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('whatsapp.new_chat')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <label className="label">{t('whatsapp.phone_number')} *</label>
          <input className="input font-mono" placeholder="+5511999999999" value={phone} onChange={(e) => setPhone(e.target.value)} required data-testid="new-chat-phone" />
        </div>
        <div>
          <label className="label">{t('whatsapp.type_message')}</label>
          <textarea className="input" rows={3} value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} />
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
