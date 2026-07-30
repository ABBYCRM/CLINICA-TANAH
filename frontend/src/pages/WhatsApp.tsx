import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function WhatsApp() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.get('/api/whatsapp/status').then(setStatus).catch(console.error);
    api.get('/api/whatsapp/conversations').then((d) => setConversations(d.conversations)).catch(console.error);
  }, [locale]);

  useEffect(() => {
    if (activePhone) {
      api.get(`/api/whatsapp/messages?phone=${encodeURIComponent(activePhone)}`)
        .then((d) => setMessages(d.messages))
        .catch(console.error);
    }
  }, [activePhone]);

  const send = async () => {
    if (!input.trim() || !activePhone) return;
    setSending(true);
    try {
      await api.post('/api/whatsapp/simulate', { phone: activePhone, body: input, locale });
      setInput('');
      const d = await api.get(`/api/whatsapp/messages?phone=${encodeURIComponent(activePhone)}`);
      setMessages(d.messages);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t('whatsapp.title')}</h1>
        {status && (
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${status.live ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            <span className="text-slate-600">{t('whatsapp.bot_status')}: {status.live ? t('whatsapp.live') : t('whatsapp.dry_run')}</span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-500">{status.conversations_count} conversas · {status.messages_count} mensagens</span>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-4 h-[600px]">
        {/* Conversations list */}
        <div className="card overflow-y-auto">
          <div className="p-3 border-b bg-slate-50 font-semibold text-sm">{t('whatsapp.conversations')}</div>
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setActivePhone(c.phone)}
              className={`w-full text-left p-3 border-b hover:bg-slate-50 ${activePhone === c.phone ? 'bg-clinic-50' : ''}`}
            >
              <div className="font-medium text-sm">{c.patient_name || c.phone}</div>
              <div className="text-xs text-slate-500 font-mono">{c.phone}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`badge ${c.lgpd_consent_granted ? 'badge-green' : 'badge-yellow'}`}>
                  {c.lgpd_consent_granted ? '✓ LGPD' : '⚠ LGPD'}
                </span>
                {c.opted_out ? <span className="badge-red">SAIR</span> : null}
                <span className="text-xs text-slate-400">{c.state}</span>
              </div>
            </button>
          ))}
          {conversations.length === 0 && <div className="p-6 text-center text-slate-400 text-sm">{t('common.no_data')}</div>}
        </div>

        {/* Chat panel */}
        <div className="card md:col-span-2 flex flex-col">
          {activePhone ? (
            <>
              <div className="p-3 border-b bg-slate-50 font-mono text-sm">{activePhone}</div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === 'in' ? 'bg-slate-100 text-slate-800' : 'bg-clinic-500 text-white'
                    }`}>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className={`text-xs mt-1 ${m.direction === 'in' ? 'text-slate-400' : 'text-clinic-100'}`}>
                        {new Date(m.created_at).toLocaleTimeString(locale === 'pt-BR' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US')}
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
                  placeholder={t('whatsapp.type_message')}
                  className="input flex-1"
                />
                <button onClick={send} disabled={sending} className="btn-primary">
                  {sending ? '...' : t('whatsapp.send')}
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
    </div>
  );
}
