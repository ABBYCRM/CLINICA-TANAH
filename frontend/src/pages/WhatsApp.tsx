import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, FormError, FormActions, IconTrash } from '../components/crud';

export default function WhatsApp() {
  const { t, locale } = useI18n();
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
      setError(e.body?.error === 'opted_out' ? t('whatsapp.opted_out_error') : (e.message || t('errors.generic')));
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
      setError(e.message || t('errors.generic'));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('whatsapp.title')}</h1>
        <button onClick={() => setNewChatOpen(true)} className="btn-primary" data-testid="new-chat">+ {t('whatsapp.new_chat')}</button>
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

      <div className="grid md:grid-cols-3 gap-4 h-[600px]">
        {/* Conversations list */}
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

        {/* Chat panel */}
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
      setError(err.body?.error === 'opted_out' ? t('whatsapp.opted_out_error') : (err.message || t('errors.generic')));
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
