import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorKey } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, FormError, FormActions, IconTrash } from '../components/crud';

type Tab = 'chat' | 'campaigns' | 'templates' | 'automations' | 'audience' | 'analytics' | 'surveys';
type InboxFilter = 'all' | 'needs_human' | 'inbound' | 'bot' | 'opted_out';

const TABS: Tab[] = ['chat', 'campaigns', 'templates', 'automations', 'audience', 'analytics', 'surveys'];

const AUDIENCE_OPTIONS = [
  'all_consented', 'recent_30d', 'inactive_90d', 'birthday_month', 'upcoming_7d', 'high_nps',
] as const;

function relativeTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return locale.startsWith('pt') ? 'agora' : locale.startsWith('es') ? 'ahora' : 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(locale === 'pt-BR' ? 'pt-BR' : locale === 'es' ? 'es' : 'en', {
    day: '2-digit', month: 'short',
  });
}

function previewText(body: string | null | undefined, max = 72): string {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function stateLabel(state: string | null | undefined, t: (k: string) => string): string {
  const s = String(state || 'idle');
  const key = `whatsapp.state_${s}`;
  const translated = t(key);
  return translated === key ? s.replace(/_/g, ' ') : translated;
}

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
  const [flowBusy, setFlowBusy] = useState(false);
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  const [inboxSearch, setInboxSearch] = useState('');
  const [claiming, setClaiming] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = () => {
    api.get('/api/whatsapp/conversations').then((d) => setConversations(d.conversations || [])).catch(console.error);
  };

  useEffect(() => {
    api.get('/api/whatsapp/status').then(setStatus).catch(console.error);
    loadConversations();
  }, [locale]);

  // Soft-poll inbox so inbound Meta / webhook traffic surfaces without leaving the tab
  useEffect(() => {
    if (tab !== 'chat') return;
    const id = window.setInterval(() => {
      loadConversations();
      if (activePhone) loadMessages(activePhone);
    }, 8000);
    return () => window.clearInterval(id);
  }, [tab, activePhone]);

  const loadMessages = (phone: string) => {
    api.get(`/api/whatsapp/messages?phone=${encodeURIComponent(phone)}`)
      .then((d) => setMessages(d.messages || []))
      .catch(console.error);
  };

  useEffect(() => {
    if (activePhone) loadMessages(activePhone);
  }, [activePhone]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, activePhone]);

  const activeConv = useMemo(
    () => conversations.find((c) => c.phone === activePhone) || null,
    [conversations, activePhone],
  );

  const filteredConversations = useMemo(() => {
    const q = inboxSearch.trim().toLowerCase();
    return conversations.filter((c) => {
      if (inboxFilter === 'needs_human' && !(c.needs_human || c.state === 'awaiting_human')) return false;
      if (inboxFilter === 'inbound' && !(c.inbound_waiting || c.last_message_direction === 'in')) return false;
      if (inboxFilter === 'bot' && !(c.awaiting_bot || String(c.state || '').startsWith('awaiting_'))) return false;
      if (inboxFilter === 'opted_out' && !c.opted_out) return false;
      if (!q) return true;
      const hay = `${c.patient_name || ''} ${c.phone || ''} ${c.last_message_body || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [conversations, inboxFilter, inboxSearch]);

  const inboxCounts = useMemo(() => ({
    all: conversations.length,
    needs_human: conversations.filter((c) => c.needs_human || c.state === 'awaiting_human').length,
    inbound: conversations.filter((c) => c.last_message_direction === 'in').length,
    bot: conversations.filter((c) => c.awaiting_bot || (String(c.state || '').startsWith('awaiting_') && c.state !== 'awaiting_human')).length,
    opted_out: conversations.filter((c) => c.opted_out).length,
  }), [conversations]);

  const send = async () => {
    if (!input.trim() || !activePhone) return;
    setSending(true);
    setError('');
    try {
      if (mode === 'simulate') {
        await api.post('/api/whatsapp/simulate', { phone: activePhone, body: input, locale: 'pt-BR' });
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

  const claimConversation = async () => {
    if (!activePhone) return;
    setClaiming(true);
    setError('');
    try {
      await api.post(`/api/whatsapp/conversations/${encodeURIComponent(activePhone)}/claim`, {});
      setMode('send');
      loadConversations();
      loadMessages(activePhone);
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
    } finally {
      setClaiming(false);
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

  const startFlowDoctor = async (phone?: string | null) => {
    const target = phone || activePhone;
    if (!target) {
      setNewChatOpen(true);
      return;
    }
    setMode('simulate');
    setFlowBusy(true);
    setError('');
    setActivePhone(target);
    try {
      await api.post('/api/whatsapp/simulate', { phone: target, body: 'médico', locale: 'pt-BR' });
      loadMessages(target);
      loadConversations();
    } catch (e: any) {
      setError(e.body?.error === 'opted_out' ? t('whatsapp.opted_out_error') : t(apiErrorKey(e)));
    } finally {
      setFlowBusy(false);
    }
  };

  const FILTERS: InboxFilter[] = ['all', 'needs_human', 'inbound', 'bot', 'opted_out'];

  return (
    <div className="space-y-4" data-testid="whatsapp-marketing">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{t('whatsapp.title')}</h1>
          <p className="page-subtitle">{t('whatsapp.subtitle')}</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <div className="seg-track" data-testid="whatsapp-tabs">
            {TABS.map((k) => (
              <button key={k} onClick={() => setTab(k)}
                className={`seg-item ${tab === k ? 'is-active' : ''}`}
                data-testid={`tab-${k}`}>
                {t(`whatsapp.tab_${k}`)}
              </button>
            ))}
          </div>
          {tab === 'chat' && (
            <>
              <button
                onClick={() => { loadConversations(); if (activePhone) loadMessages(activePhone); }}
                className="btn-secondary w-full sm:w-auto justify-center whitespace-nowrap"
                data-testid="refresh-inbox"
              >
                {t('whatsapp.refresh_inbox')}
              </button>
              <button onClick={() => setNewChatOpen(true)} className="btn-primary w-full sm:w-auto justify-center whitespace-nowrap" data-testid="new-chat">
                + {t('whatsapp.new_chat')}
              </button>
            </>
          )}
        </div>
      </div>

      {status && (
        <div className="card p-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[color:var(--ink)]">
          <span className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${status.live ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span className="font-medium">{status.live ? t('whatsapp.live') : t('whatsapp.dry_run')}</span>
          </span>
          <span className="text-[color:var(--ink-muted)]" aria-hidden="true">·</span>
          <span className="text-[color:var(--ink-muted)]">{status.conversations_count} {t('whatsapp.conversations').toLowerCase()} · {status.messages_count} msg</span>
          {inboxCounts.needs_human > 0 && (
            <>
              <span className="text-[color:var(--ink-muted)]" aria-hidden="true">·</span>
              <span className="badge-red" data-testid="inbox-needs-human-count">
                {t('whatsapp.needs_human_count', { n: inboxCounts.needs_human })}
              </span>
            </>
          )}
          {status.live && (
            <>
              <span className="text-[color:var(--ink-muted)]" aria-hidden="true">·</span>
              <span className={`text-xs font-medium ${status.app_secret_configured ? 'text-emerald-800' : 'text-amber-800'}`}>
                {status.app_secret_configured ? '✓ signature' : '⚠ no app secret'}
              </span>
            </>
          )}
          <span className="hidden sm:block flex-1" />
          <button onClick={testConnection} disabled={ping.state === 'loading'} className="btn-secondary text-xs w-full sm:w-auto justify-center" data-testid="test-connection">
            {ping.state === 'loading' ? '…' : t('whatsapp.test_connection')}
          </button>
          {ping.state === 'ok' && <span className="badge-green" data-testid="ping-ok">✓ {t('whatsapp.connection_ok')}{ping.detail ? ` — ${ping.detail}` : ''}</span>}
          {ping.state === 'fail' && <span className="badge-red break-words" data-testid="ping-fail">✕ {t('whatsapp.connection_failed')}{ping.detail ? ` — ${ping.detail}` : ''}</span>}
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
      <div className="wa-inbox-grid" data-testid="wa-inbound-panel">
        {/* LEFT — inbound inbox */}
        <div
          className="card overflow-hidden flex flex-col text-[#2c2118] min-h-[420px] h-[min(74vh,680px)]"
          style={{ backgroundColor: '#f4ead2', backgroundImage: 'linear-gradient(180deg, #f7f2ea, #efe6d8)' }}
        >
          <div
            className="p-3 border-b border-[rgba(139,115,85,0.35)] space-y-2"
            style={{ backgroundColor: '#efe6d8', backgroundImage: 'linear-gradient(180deg, #efe6d8, #e8dfd1)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sm text-[#2c2118]">{t('whatsapp.inbox')}</div>
              <span className="text-[11px] font-medium text-[#5c4a3c]">{filteredConversations.length}</span>
            </div>
            <input
              className="input !py-1.5 !text-sm"
              placeholder={t('whatsapp.inbox_search')}
              value={inboxSearch}
              onChange={(e) => setInboxSearch(e.target.value)}
              data-testid="inbox-search"
            />
            <div className="flex flex-wrap gap-1" data-testid="inbox-filters">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setInboxFilter(f)}
                  className={`wa-filter-chip ${inboxFilter === f ? 'is-active' : ''}`}
                  data-testid={`inbox-filter-${f}`}
                >
                  {t(`whatsapp.filter_${f}`)}
                  {f !== 'all' && inboxCounts[f] > 0 ? ` · ${inboxCounts[f]}` : ''}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredConversations.map((c) => {
              const active = activePhone === c.phone;
              const waiting = c.needs_human || c.state === 'awaiting_human';
              return (
                <div
                  key={c.id}
                  className={`group relative border-b border-[rgba(139,115,85,0.28)] transition-colors ${
                    active ? 'bg-[#e4d9c6]' : waiting ? 'bg-[#f3e4d6]' : 'hover:bg-[#f3ece0]'
                  }`}
                >
                  <button onClick={() => setActivePhone(c.phone)} className="w-full text-left p-3 pr-10" data-testid={`inbox-row-${c.phone}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm text-[#2c2118] truncate">
                        {c.patient_name || c.phone}
                      </div>
                      <span className="text-[10px] font-medium text-[#5c4a3c] shrink-0">
                        {relativeTime(c.last_message_at, locale)}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-[#5c4a3c] truncate">{c.phone}</div>
                    {c.last_message_body && (
                      <div className="text-xs text-[#4a382c] mt-1 line-clamp-2">
                        <span className="font-semibold text-[#5c4a3c]">
                          {c.last_message_direction === 'in' ? t('whatsapp.preview_in') : t('whatsapp.preview_out')}
                        </span>
                        {' '}{previewText(c.last_message_body)}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {waiting && <span className="badge-red">{t('whatsapp.badge_needs_human')}</span>}
                      <span className={`badge ${c.lgpd_consent_granted ? 'badge-green' : 'badge-yellow'}`}>
                        {c.lgpd_consent_granted ? '✓ LGPD' : '⚠ LGPD'}
                      </span>
                      {c.opted_out ? <span className="badge-red">SAIR</span> : null}
                      <span className="text-[10px] font-medium uppercase tracking-wide text-[#5c4a3c]">
                        {stateLabel(c.state, t)}
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={() => setDeleting(c)}
                    title={t('whatsapp.delete_conversation')}
                    className="absolute top-3 right-2 rounded-lg p-1.5 text-[#5c4a3c] transition-colors hover:bg-rose-50 hover:text-rose-700 opacity-0 group-hover:opacity-100"
                  >
                    <IconTrash />
                  </button>
                </div>
              );
            })}
            {filteredConversations.length === 0 && (
              <div className="p-6 text-center text-sm text-[#5c4a3c]" data-testid="inbox-empty">
                {conversations.length === 0 ? t('whatsapp.inbox_empty') : t('whatsapp.inbox_filter_empty')}
              </div>
            )}
          </div>
        </div>

        {/* CENTER — thread + reply */}
        <div className="card flex flex-col overflow-hidden text-[color:var(--ink)] min-h-[420px] h-[min(74vh,680px)] md:col-span-1 lg:col-span-1">
          {activePhone ? (
            <>
              <div
                className="p-3 border-b border-[rgba(139,115,85,0.35)] flex flex-wrap items-center justify-between gap-2"
                style={{ background: 'linear-gradient(180deg, #efe6d8, #e8dfd1)' }}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-[color:var(--ink)] truncate">
                    {activeConv?.patient_name || activePhone}
                  </div>
                  <div className="font-mono text-xs text-[color:var(--ink-muted)]">{activePhone}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(activeConv?.needs_human || activeConv?.state === 'awaiting_human') && (
                    <button
                      type="button"
                      className="btn-primary !py-1 !px-2.5 !text-xs"
                      disabled={claiming}
                      onClick={claimConversation}
                      data-testid="claim-conversation"
                    >
                      {claiming ? '…' : t('whatsapp.claim_conversation')}
                    </button>
                  )}
                  <div className="seg-track !p-0.5">
                    <button onClick={() => setMode('send')}
                      className={`seg-item !py-1 !px-2.5 !text-xs ${mode === 'send' ? 'is-active' : ''}`}
                      data-testid="mode-send">
                      {t('whatsapp.send_as_clinic')}
                    </button>
                    <button onClick={() => setMode('simulate')}
                      className={`seg-item !py-1 !px-2.5 !text-xs ${mode === 'simulate' ? 'is-active' : ''}`}
                      data-testid="mode-simulate">
                      {t('whatsapp.simulate_patient')}
                    </button>
                  </div>
                </div>
              </div>
              <div
                className="flex-1 overflow-y-auto p-4 space-y-2"
                style={{ background: 'linear-gradient(180deg, #ddd4c6 0%, #efe6d8 40%, #f4efe6 100%)' }}
                data-testid="wa-thread"
              >
                {messages.length === 0 && (
                  <p className="text-sm text-center text-[color:var(--ink-muted)] py-8">{t('whatsapp.thread_empty')}</p>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[78%] rounded-xl px-3 py-2 text-sm ${
                      m.direction === 'in' ? 'text-[color:var(--ink)]' : 'text-white'
                    }`}
                      style={m.direction === 'in'
                        ? {
                            background: 'linear-gradient(180deg, #f7f2ea, #e8dfd1)',
                            border: '1px solid rgba(184,172,153,0.55)',
                            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 2px 6px rgba(40,55,35,0.08)',
                          }
                        : {
                            background: 'linear-gradient(180deg, #6d8f6a, #4f6f4c)',
                            border: '1px solid rgba(55,85,50,0.45)',
                            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28), 0 2px 0 #3d5a3a, 0 4px 10px rgba(40,55,35,0.22)',
                          }}
                    >
                      <div className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${
                        m.direction === 'in' ? 'text-[color:var(--ink-muted)]' : 'text-white/80'
                      }`}>
                        {m.direction === 'in' ? t('whatsapp.bubble_inbound') : t('whatsapp.bubble_outbound')}
                      </div>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className={`text-xs mt-1 flex items-center gap-1 ${m.direction === 'in' ? 'text-[color:var(--ink-muted)]' : 'text-white/85'}`}>
                        {new Date(m.created_at).toLocaleTimeString(locale === 'pt-BR' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US')}
                        {m.direction === 'out' && m.status && <span className="opacity-90">· {m.status}</span>}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>
              <div
                className="p-3 border-t border-[rgba(139,115,85,0.35)] space-y-2"
                style={{ background: 'linear-gradient(180deg, #efe6d8, #e8dfd1)' }}
              >
                {mode === 'simulate' && (
                  <p className="text-[11px] text-[color:var(--ink-muted)]">{t('whatsapp.simulator_help')}</p>
                )}
                {mode === 'send' && (
                  <p className="text-[11px] text-[color:var(--ink-muted)]">{t('whatsapp.reply_hint')}</p>
                )}
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && send()}
                    placeholder={mode === 'simulate' ? t('whatsapp.type_message') : t('whatsapp.reply_placeholder')}
                    className="input flex-1"
                    data-testid="chat-input"
                    disabled={!!activeConv?.opted_out && mode === 'send'}
                  />
                  <button onClick={send} disabled={sending || (!!activeConv?.opted_out && mode === 'send')} className="btn-primary" data-testid="chat-send">
                    {sending ? '…' : t('whatsapp.send')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div
              className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center"
              style={{ backgroundColor: '#f4ead2', backgroundImage: 'linear-gradient(180deg, #f4efe6, #ebe2d4)' }}
              data-testid="wa-empty-thread"
            >
              <p className="text-base font-semibold text-[#2c2118] max-w-md">
                {t('whatsapp.inbound_empty')}
              </p>
              <p className="text-sm text-[#5c4a3c] max-w-md">
                {t('whatsapp.inbound_empty_hint')}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  data-testid="empty-open-inbox"
                  disabled={filteredConversations.length === 0}
                  onClick={() => {
                    const first = filteredConversations[0] || conversations[0];
                    if (first) setActivePhone(first.phone);
                  }}
                >
                  {t('whatsapp.open_first_inbound')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  data-testid="empty-start-flow-doctor"
                  disabled={flowBusy}
                  onClick={() => startFlowDoctor(conversations[0]?.phone || activePhone)}
                >
                  {flowBusy ? '…' : t('whatsapp.start_flow_doctor')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — ops rail */}
        <div className="crm-rail-stack hidden lg:flex min-h-[420px] h-[min(74vh,680px)] overflow-y-auto" data-testid="wa-ops-rail">
          <div className="crm-record-panel">
            <div className="crm-record-panel-title">{t('whatsapp.ops_title')}</div>
            <p className="text-xs text-[color:var(--ink-muted)] leading-relaxed mb-3">{t('whatsapp.ops_hint')}</p>
            {activeConv ? (
              <div className="space-y-2 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold">{t('whatsapp.ops_contact')}</div>
                  <div className="font-medium text-[color:var(--ink)]">{activeConv.patient_name || '—'}</div>
                  <div className="font-mono text-xs text-[color:var(--ink-muted)]">{activeConv.phone}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold">{t('whatsapp.ops_state')}</div>
                  <div className="font-medium">{stateLabel(activeConv.state, t)}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={`badge ${activeConv.lgpd_consent_granted ? 'badge-green' : 'badge-yellow'}`}>
                    {activeConv.lgpd_consent_granted ? t('whatsapp.lgpd_ok') : t('whatsapp.lgpd_pending')}
                  </span>
                  {activeConv.opted_out && <span className="badge-red">{t('whatsapp.opted_out_badge')}</span>}
                  {(activeConv.needs_human || activeConv.state === 'awaiting_human') && (
                    <span className="badge-red">{t('whatsapp.badge_needs_human')}</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[color:var(--ink-muted)]">{t('whatsapp.ops_select')}</p>
            )}
            <div className="crm-rail-actions mt-3">
              {activeConv?.patient_id && (
                <Link to={`/patients/${activeConv.patient_id}`} className="btn-secondary">
                  {t('whatsapp.open_patient')}
                </Link>
              )}
              {(activeConv?.needs_human || activeConv?.state === 'awaiting_human') && (
                <button type="button" className="btn-primary" disabled={claiming || !activePhone} onClick={claimConversation}>
                  {t('whatsapp.claim_conversation')}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                data-testid="start-flow-doctor"
                disabled={flowBusy}
                onClick={() => startFlowDoctor(activePhone)}
              >
                {flowBusy ? '…' : t('whatsapp.start_flow_doctor')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setTab('automations')}>
                {t('whatsapp.tab_automations')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setTab('campaigns')}>
                {t('whatsapp.tab_campaigns')}
              </button>
            </div>
          </div>
          <div className="crm-record-panel">
            <div className="crm-record-panel-title">{t('whatsapp.lgpd_rail_title')}</div>
            <p className="text-xs text-[color:var(--ink-muted)] leading-relaxed">{t('whatsapp.lgpd_rail_hint')}</p>
          </div>
        </div>
      </div>
      )}

      {newChatOpen && (
        <NewChatModal
          onClose={() => setNewChatOpen(false)}
          onStart={(phone) => { setNewChatOpen(false); setActivePhone(phone); setMode('send'); loadConversations(); }}
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
        <p className="page-subtitle max-w-2xl">{t('whatsapp.audience_info')}</p>
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
  const [segments, setSegments] = useState<Record<string, number>>({});
  const [automations, setAutomations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [audienceById, setAudienceById] = useState<Record<string, string>>({});
  const [actionId, setActionId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/api/whatsapp/templates'),
      api.get('/api/whatsapp/automations'),
    ])
      .then(([tpl, autos]) => {
        const list = tpl.templates || [];
        setTemplates(list);
        setSegments(tpl.segments || {});
        setAutomations(autos.automations || []);
        setAudienceById((prev) => {
          const next = { ...prev };
          for (const row of list) {
            if (!next[row.id]) next[row.id] = row.suggested_segment || 'all_consented';
          }
          return next;
        });
      })
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

  const sendToAudience = async (tpl: any, dispatch: boolean) => {
    setActionId(tpl.id + (dispatch ? ':send' : ':draft'));
    setError('');
    setNotice('');
    try {
      const audience = audienceById[tpl.id] || tpl.suggested_segment || 'all_consented';
      const res = await api.post(`/api/whatsapp/templates/${tpl.id}/send`, { audience, dispatch });
      if (dispatch) {
        setNotice(t('whatsapp.template_sent', {
          sent: res.sent ?? 0,
          failed: res.failed ?? 0,
          count: res.audience_count ?? 0,
        }));
      } else {
        setNotice(t('whatsapp.template_campaign_draft', { count: res.audience_count ?? 0 }));
      }
      load();
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
    } finally {
      setActionId(null);
    }
  };

  const bindAutomation = async (tpl: any, automationId?: string) => {
    setActionId(tpl.id + ':auto');
    setError('');
    setNotice('');
    try {
      const res = await api.post(`/api/whatsapp/templates/${tpl.id}/automate`, {
        automation_id: automationId || undefined,
        enable: true,
      });
      setNotice(t('whatsapp.template_automated', { name: res.automation?.name || '' }));
      load();
    } catch (e: any) {
      setError(e.body?.error === 'no_suggested_automation'
        ? t('whatsapp.template_pick_automation')
        : t(apiErrorKey(e)));
    } finally {
      setActionId(null);
    }
  };

  const runBoundAutomation = async (tpl: any) => {
    if (!tpl.automation_id) return;
    setActionId(tpl.id + ':run');
    setError('');
    setNotice('');
    try {
      if (!tpl.automation_enabled) {
        await api.put(`/api/whatsapp/automations/${tpl.automation_id}`, { enabled: true });
      }
      const res = await api.post(`/api/whatsapp/automations/${tpl.automation_id}/run`, {});
      setNotice(t('whatsapp.automation_ran', { sent: res.sent ?? 0, failed: res.failed ?? 0 }));
      load();
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="templates-view">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <p className="page-subtitle max-w-3xl text-[color:var(--ink-muted)]">{t('whatsapp.templates_info')}</p>
        <button onClick={() => setShowForm(true)} className="btn-primary shrink-0" data-testid="new-template">
          + {t('whatsapp.new_template')}
        </button>
      </div>
      {error && <FormError message={error} />}
      {notice && (
        <div
          className="rounded-lg border border-[color:var(--moss)]/45 bg-[color:var(--paper)] px-3.5 py-2.5 text-sm font-medium text-[color:var(--ink)]"
          role="status"
          data-testid="templates-notice"
        >
          {notice}
        </div>
      )}
      {loading && <div className="text-[color:var(--ink-muted)] py-6 text-center">{t('common.loading')}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {templates.map((tpl) => {
          const segment = audienceById[tpl.id] || tpl.suggested_segment || 'all_consented';
          const count = segments[segment] ?? tpl.audience_count ?? 0;
          const busySend = actionId === tpl.id + ':send';
          const busyDraft = actionId === tpl.id + ':draft';
          const busyAuto = actionId === tpl.id + ':auto';
          const busyRun = actionId === tpl.id + ':run';
          const approved = tpl.status === 'approved';
          return (
            <div key={tpl.id} className="card p-4 space-y-3" data-testid={`template-${tpl.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-[color:var(--ink)]">{tpl.name}</div>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <span className="badge-blue">{t(`whatsapp.cat_${tpl.category}`)}</span>
                    <span className={`badge ${tpl.status === 'approved' ? 'badge-green' : tpl.status === 'rejected' ? 'badge-red' : 'badge-yellow'}`}>
                      {t(`whatsapp.tpl_status_${tpl.status}`)}
                    </span>
                  </div>
                </div>
                <button onClick={() => setDeleting(tpl)} className="rounded-lg p-1.5 text-[color:var(--ink-muted)] hover:bg-rose-50 hover:text-rose-700" title={t('common.delete')}>
                  <IconTrash />
                </button>
              </div>
              <p className="text-sm text-[color:var(--ink-muted)] whitespace-pre-wrap">{tpl.body}</p>

              {approved && (
                <div className="rounded-lg border border-[color:var(--edge-soft)] bg-[color:var(--paper-mid)]/50 p-3 space-y-3" data-testid={`template-wiring-${tpl.id}`}>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink)]">
                      {t('whatsapp.template_who')}
                    </div>
                    <p className="text-xs text-[color:var(--ink-muted)] mt-0.5">{t('whatsapp.template_who_help')}</p>
                    <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
                      <select
                        className="input flex-1"
                        value={segment}
                        onChange={(e) => setAudienceById((prev) => ({ ...prev, [tpl.id]: e.target.value }))}
                        data-testid={`template-audience-${tpl.id}`}
                      >
                        {AUDIENCE_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {t(`whatsapp.segment_${s}`)} ({segments[s] ?? 0})
                          </option>
                        ))}
                      </select>
                      <span className="text-xs font-medium text-[color:var(--ink)] whitespace-nowrap" data-testid={`template-audience-count-${tpl.id}`}>
                        {t('whatsapp.template_recipients', { count })}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primary text-xs"
                        disabled={!!actionId || count === 0}
                        onClick={() => sendToAudience(tpl, true)}
                        data-testid={`template-send-${tpl.id}`}
                      >
                        {busySend ? '…' : t('whatsapp.template_send_now')}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={!!actionId}
                        onClick={() => sendToAudience(tpl, false)}
                        data-testid={`template-draft-${tpl.id}`}
                      >
                        {busyDraft ? '…' : t('whatsapp.template_save_campaign')}
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-[color:var(--edge-soft)] pt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink)]">
                      {t('whatsapp.template_how')}
                    </div>
                    <p className="text-xs text-[color:var(--ink-muted)] mt-0.5">{t('whatsapp.template_how_help')}</p>
                    {tpl.automation_id ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <div className="text-sm text-[color:var(--ink)]">
                          <span className="font-medium">{tpl.automation_name}</span>
                          <span className={`ml-2 badge ${tpl.automation_enabled ? 'badge-green' : 'badge-yellow'}`}>
                            {tpl.automation_enabled ? t('whatsapp.active') : t('whatsapp.inactive')}
                          </span>
                          <span className="ml-2 text-xs font-mono text-[color:var(--ink-muted)]">{tpl.automation_key}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            disabled={!!actionId}
                            onClick={() => runBoundAutomation(tpl)}
                            data-testid={`template-run-auto-${tpl.id}`}
                          >
                            {busyRun ? '…' : t('whatsapp.run_now')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-col sm:flex-row gap-2">
                        {tpl.suggested_automation_key ? (
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            disabled={!!actionId}
                            onClick={() => bindAutomation(tpl)}
                            data-testid={`template-automate-${tpl.id}`}
                          >
                            {busyAuto ? '…' : t('whatsapp.template_enable_automation')}
                          </button>
                        ) : (
                          <select
                            className="input text-sm"
                            defaultValue=""
                            disabled={!!actionId}
                            onChange={(e) => {
                              if (e.target.value) bindAutomation(tpl, e.target.value);
                            }}
                            data-testid={`template-pick-auto-${tpl.id}`}
                          >
                            <option value="">{t('whatsapp.template_pick_automation')}</option>
                            {automations.map((a) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tpl.status !== 'approved' && (
                <button onClick={() => setStatus(tpl, 'approved')} className="btn-secondary text-xs" data-testid={`approve-${tpl.id}`}>
                  {t('whatsapp.mark_approved')}
                </button>
              )}
            </div>
          );
        })}
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
      <p className="page-subtitle max-w-3xl">{t('whatsapp.automations_info')}</p>
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
              <p className="text-sm text-[color:var(--ink-muted)] mt-1">{a.description}</p>
              {a.template_name ? (
                <p className="text-xs font-medium text-[color:var(--ink)] mt-1" data-testid={`automation-template-${a.key}`}>
                  {t('whatsapp.bound_template')}: {a.template_name}
                </p>
              ) : null}
              <p className="text-sm text-[color:var(--ink-muted)] mt-2 whitespace-pre-wrap border-l-2 border-[color:var(--edge-soft)] pl-3">{a.message}</p>
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
      <p className="page-subtitle max-w-3xl">{t('whatsapp.audience_hub_info')}</p>
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
              <div className="font-display text-2xl font-semibold tracking-tight text-[#3a342c]">{data.segments?.[s] ?? '—'}</div>
            </button>
          ))}
          <div className="card p-4">
            <div className="text-xs text-slate-500 mb-1">{t('whatsapp.opted_out_wa')}</div>
            <div className="text-2xl font-bold text-rose-600">{data.opted_out_whatsapp ?? 0}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-slate-500 mb-1">{t('whatsapp.with_phone')}</div>
            <div className="font-display text-2xl font-semibold tracking-tight text-[#3a342c]">{data.with_phone ?? 0}</div>
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
      <p className="page-subtitle">{t('whatsapp.analytics_info')}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="card p-4 text-center">
            <div className="text-xs text-slate-500 mb-1 truncate">{k.label}</div>
            <div className="font-display text-2xl font-semibold tracking-tight text-[#3a342c]">{k.value}</div>
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
        <p className="page-subtitle max-w-2xl">{t('whatsapp.no_surveys')}</p>
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
  const { t } = useI18n();
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
        await api.post('/api/whatsapp/simulate', { phone, body: 'médico', locale: 'pt-BR' });
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
