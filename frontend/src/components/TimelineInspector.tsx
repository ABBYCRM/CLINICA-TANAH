/**
 * Timeline activity inspector — live CRM side panel.
 * Opens from timeline cards; URL-synced via ?event=; hydrates full entity.
 * Desk UI (leather/brass) — not BodyPath teal.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

function fmtDateTime(v?: string | null, locale = 'pt-BR') {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(locale, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--ink-muted)]">{label}</dt>
      <dd className="text-sm text-[color:var(--ink)] mt-0.5 break-words">{children ?? '—'}</dd>
    </div>
  );
}

function statusTone(status?: string | null) {
  if (!status) return 'badge-slate';
  const s = String(status).toLowerCase();
  if (['completed', 'paid', 'confirmed', 'granted', 'signed', 'done', 'resolved', 'active'].includes(s)) return 'badge-green';
  if (['cancelled', 'no_show', 'overdue', 'revoked', 'denied', 'open'].includes(s) && s === 'open') return 'badge-yellow';
  if (['cancelled', 'no_show', 'overdue', 'revoked', 'denied'].includes(s)) return 'badge-red';
  if (['issued', 'scheduled', 'arrived', 'in_progress', 'pending'].includes(s)) return 'badge-yellow';
  return 'badge-slate';
}

export type TimelineNavItem = {
  id: string;
  kind: string;
  title: string;
  at: string;
  status?: string;
  subtitle?: string;
  meta?: Record<string, unknown>;
};

export default function TimelineInspector({
  patientId,
  eventId,
  eventTitle,
  eventList,
  onClose,
  onOpenEvent,
  onNavigateTab,
  onEditPatient,
  onChanged,
}: {
  patientId: string;
  eventId: string;
  eventTitle: string;
  eventList: TimelineNavItem[];
  onClose: () => void;
  onOpenEvent: (id: string) => void;
  onNavigateTab: (tab: string) => void;
  onEditPatient?: () => void;
  onChanged?: () => void;
}) {
  const { t, locale } = useI18n();
  const [payload, setPayload] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get(`/api/patients/${patientId}/timeline/${encodeURIComponent(eventId)}`)
      .then(setPayload)
      .catch((e: any) => {
        setPayload(null);
        setError(e?.body?.message || e?.message || t('errors.generic'));
      })
      .finally(() => setLoading(false));
  }, [patientId, eventId, t]);

  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const idx = eventList.findIndex((x) => x.id === eventId);
        if (idx >= 0 && idx < eventList.length - 1) onOpenEvent(eventList[idx + 1].id);
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = eventList.findIndex((x) => x.id === eventId);
        if (idx > 0) onOpenEvent(eventList[idx - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [eventId, eventList, onClose, onOpenEvent]);

  const kind = payload?.kind || 'unknown';
  const entity = payload?.entity;
  const related = payload?.related || {};
  const actions = payload?.actions || [];

  const idx = useMemo(() => eventList.findIndex((x) => x.id === eventId), [eventList, eventId]);

  const runAction = async (actionId: string) => {
    setBusy(actionId);
    try {
      if (actionId === 'goto_appointments') onNavigateTab('appointments');
      else if (actionId === 'goto_clinical') onNavigateTab('clinical');
      else if (actionId === 'goto_billing') onNavigateTab('billing');
      else if (actionId === 'goto_whatsapp') onNavigateTab('whatsapp');
      else if (actionId === 'goto_surveys') onNavigateTab('surveys');
      else if (actionId === 'goto_tasks') onNavigateTab('tasks');
      else if (actionId === 'goto_documents') onNavigateTab('documents');
      else if (actionId === 'goto_privacy') onNavigateTab('privacy');
      else if (actionId === 'edit_patient') onEditPatient?.();
      else if (actionId === 'open_invoices') window.open('/invoices', '_self');
      else if (actionId === 'goto_encounters') window.open('/encounters', '_self');
      else if (actionId === 'open_related_appt' && related.appointment?.id) {
        onOpenEvent(`appt-${related.appointment.id}`);
      } else if (actionId === 'mark_paid' && entity?.id) {
        await api.put(`/api/accounting/invoices/${entity.id}/mark-paid`, {});
        load();
        onChanged?.();
      } else if (actionId === 'resolve_task' && entity?.id) {
        await api.patch(`/api/patients/${patientId}/tasks/${entity.id}`, { status: 'done' });
        load();
        onChanged?.();
      } else if (actionId === 'resolve_ticket' && entity?.id) {
        await api.patch(`/api/patients/${patientId}/tickets/${entity.id}`, {
          status: 'resolved',
          resolution: 'Resolvido pela equipe',
          outcome: 'contacted',
        });
        load();
        onChanged?.();
      } else if (actionId === 'status_cycle' && entity?.id) {
        const next =
          entity.status === 'scheduled' ? 'confirmed'
            : entity.status === 'confirmed' ? 'arrived'
              : entity.status === 'arrived' || entity.status === 'in_progress' ? 'completed'
                : null;
        if (next) {
          await api.put(`/api/appointments/${entity.id}`, { status: next });
          load();
          onChanged?.();
        }
      }
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  const apptStatusActions = useMemo(() => {
    if (kind !== 'appointment' || !entity) return [];
    const out: Array<{ status: string; label: string }> = [];
    if (entity.status === 'scheduled') {
      out.push({ status: 'confirmed', label: t('appointments.confirm') });
      out.push({ status: 'cancelled', label: t('appointments.mark_cancelled') });
    } else if (entity.status === 'confirmed') {
      out.push({ status: 'arrived', label: t('appointments.mark_arrived') });
      out.push({ status: 'cancelled', label: t('appointments.mark_cancelled') });
    } else if (entity.status === 'arrived' || entity.status === 'in_progress') {
      out.push({ status: 'completed', label: t('appointments.mark_completed') });
    }
    return out;
  }, [kind, entity, t]);

  const setApptStatus = async (status: string) => {
    if (!entity?.id) return;
    setBusy(status);
    try {
      await api.put(`/api/appointments/${entity.id}`, { status });
      load();
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div
        className="appt-drawer-backdrop fixed inset-x-0 bottom-0 z-40 bg-[#1a120c]/40 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="appt-drawer timeline-inspector fixed right-0 z-50 flex flex-col w-full max-w-md"
        data-testid="timeline-inspector"
        role="dialog"
        aria-modal="true"
        aria-label={eventTitle}
      >
        <header className="appt-drawer-header flex items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--ink-muted)]">
              {t('patients.inspector.eyebrow')}
              {idx >= 0 ? ` · ${idx + 1}/${eventList.length}` : ''}
            </div>
            <div className="font-display font-semibold text-[#2a1f16] text-lg leading-tight">
              {eventTitle}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="badge-slate text-[10px]">{kind}</span>
              {(entity?.status || payload?.entity?.status) && (
                <span className={`badge text-[10px] ${statusTone(entity?.status)}`}>{entity.status}</span>
              )}
            </div>
            <p className="text-[11px] text-[color:var(--ink-muted)]">{t('patients.inspector.nav_hint')}</p>
          </div>
          <button type="button" onClick={onClose} className="appt-drawer-close shrink-0" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-5 h-5" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && (
            <div className="space-y-3 animate-pulse" data-testid="inspector-loading">
              <div className="h-4 rounded bg-[#efe6d8] w-2/3" />
              <div className="h-20 rounded-xl bg-[#efe6d8]" />
              <div className="h-20 rounded-xl bg-[#efe6d8]" />
            </div>
          )}

          {error && (
            <div className="text-sm text-[#8b3a2a] bg-[#f8e8e2] border border-[#e2b8a8] rounded-lg px-3 py-2">{error}</div>
          )}

          {!loading && entity && kind === 'appointment' && (
            <div className="space-y-4" data-testid="inspector-appointment">
              {apptStatusActions.length > 0 && (
                <div className="appt-drawer-actions">
                  {apptStatusActions.map((a) => (
                    <button
                      key={a.status}
                      type="button"
                      className={`${a.status === 'cancelled' ? 'btn-danger' : 'btn-primary'} text-sm justify-center`}
                      disabled={!!busy}
                      onClick={() => setApptStatus(a.status)}
                    >
                      {busy === a.status ? '…' : a.label}
                    </button>
                  ))}
                </div>
              )}
              <dl className="appt-drawer-facts grid grid-cols-2 gap-3">
                <Fact label={t('appointments.scheduled_at')}>{fmtDateTime(entity.scheduled_at, locale)}</Fact>
                <Fact label={t('appointments.duration')}>{entity.duration_minutes ? `${entity.duration_minutes} min` : '—'}</Fact>
                <Fact label={t('appointments.practitioner')}>{entity.practitioner_name}</Fact>
                <Fact label={t('appointments.type')}>
                  {t(`appointments.types.${entity.type}`) !== `appointments.types.${entity.type}`
                    ? t(`appointments.types.${entity.type}`)
                    : entity.type}
                </Fact>
                <Fact label={t('appointments.source')}>{entity.source || '—'}</Fact>
                <Fact label={t('common.status')}>{entity.status}</Fact>
              </dl>
              {entity.notes && (
                <div className="rounded-xl border border-[rgba(176,183,192,0.45)] bg-[#f7f1e6] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--ink-muted)] mb-1">{t('common.notes')}</div>
                  <p className="text-sm whitespace-pre-wrap">{entity.notes}</p>
                </div>
              )}
              {related.encounter && (
                <button
                  type="button"
                  className="w-full text-left crm-timeline-card hover:brightness-[0.98]"
                  onClick={() => onOpenEvent(`enc-${related.encounter.id}`)}
                >
                  <div className="text-xs font-semibold text-[color:var(--ink-muted)]">{t('patients.inspector.linked_encounter')}</div>
                  <div className="text-sm mt-0.5">{fmtDateTime(related.encounter.started_at, locale)}</div>
                  {related.encounter.preview && <div className="text-xs text-[color:var(--ink-muted)] mt-1 truncate">{related.encounter.preview}</div>}
                </button>
              )}
            </div>
          )}

          {!loading && entity && kind === 'invoice' && (
            <div className="space-y-4" data-testid="inspector-invoice">
              <dl className="appt-drawer-facts grid grid-cols-2 gap-3">
                <Fact label={t('invoices.number')}>{entity.invoice_number}</Fact>
                <Fact label={t('common.total')}>
                  <span className="font-mono font-semibold">R$ {Number(entity.total).toFixed(2)}</span>
                </Fact>
                <Fact label={t('invoices.issue_date')}>{entity.issue_date}</Fact>
                <Fact label={t('invoices.due_date')}>{entity.due_date || '—'}</Fact>
                <Fact label={t('common.status')}>{entity.status}</Fact>
                {entity.payment_method && (
                  <Fact label={t('patients.inspector.payment_method')}>{entity.payment_method}</Fact>
                )}
                {entity.paid_at && <Fact label={t('patients.inspector.paid_at')}>{fmtDateTime(entity.paid_at, locale)}</Fact>}
              </dl>
              {(related.lines || []).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--ink-muted)] mb-2">{t('invoices.lines')}</div>
                  <ul className="space-y-1.5">
                    {related.lines.map((l: any) => (
                      <li key={l.id} className="flex justify-between gap-2 text-sm border-b border-[rgba(176,183,192,0.35)] py-1">
                        <span className="min-w-0 truncate">{l.description}</span>
                        <span className="font-mono text-[color:var(--ink-muted)] shrink-0">
                          {l.quantity} × {Number(l.unit_price).toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(related.documents || []).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--ink-muted)] mb-2">{t('invoices.documents')}</div>
                  <ul className="space-y-1 text-sm">
                    {related.documents.map((d: any) => (
                      <li key={d.id} className="crm-timeline-card text-xs">
                        <div className="font-medium truncate">{d.original_name}</div>
                        <div className="text-[color:var(--ink-muted)]">OCR: {d.ocr_status}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Link to="/invoices" className="btn-secondary w-full justify-center text-sm">{t('patients.inspector.action_open_invoices')}</Link>
            </div>
          )}

          {!loading && entity && kind === 'encounter' && (
            <div className="space-y-4" data-testid="inspector-encounter">
              <dl className="appt-drawer-facts grid grid-cols-2 gap-3">
                <Fact label={t('appointments.practitioner')}>{entity.practitioner_name}</Fact>
                <Fact label={t('common.date')}>{fmtDateTime(entity.started_at, locale)}</Fact>
              </dl>
              {['subjective', 'objective', 'assessment', 'plan'].map((field) => (
                entity[field] ? (
                  <div key={field} className="rounded-xl border border-[rgba(176,183,192,0.45)] px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--ink-muted)] mb-1">
                      {t(`patients.inspector.soap_${field}`) !== `patients.inspector.soap_${field}`
                        ? t(`patients.inspector.soap_${field}`)
                        : field}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{entity[field]}</p>
                  </div>
                ) : null
              ))}
              {(entity.icd10_codes || []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {entity.icd10_codes.map((c: string) => (
                    <span key={c} className="badge-slate text-[10px]">{c}</span>
                  ))}
                </div>
              )}
              {related.appointment?.id && (
                <button type="button" className="btn-secondary w-full text-sm" onClick={() => onOpenEvent(`appt-${related.appointment.id}`)}>
                  {t('patients.inspector.action_open_related')}
                </button>
              )}
            </div>
          )}

          {!loading && entity && kind === 'prescription' && (
            <div className="space-y-3" data-testid="inspector-prescription">
              <Fact label={t('appointments.practitioner')}>{entity.practitioner_name}</Fact>
              <Fact label={t('common.date')}>{fmtDateTime(entity.created_at, locale)}</Fact>
              <ul className="space-y-2">
                {(Array.isArray(entity.items) ? entity.items : []).map((it: any, i: number) => (
                  <li key={i} className="crm-timeline-card text-sm">
                    <div className="font-medium">{it.medication || it.name || JSON.stringify(it)}</div>
                    {(it.dosage || it.instructions) && (
                      <div className="text-xs text-[color:var(--ink-muted)] mt-0.5">
                        {[it.dosage, it.frequency, it.instructions].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!loading && entity && kind === 'consent' && (
            <div className="space-y-3" data-testid="inspector-consent">
              <dl className="appt-drawer-facts grid grid-cols-1 gap-3">
                <Fact label={t('patients.inspector.purpose')}>
                  {(() => {
                    const key = `patients.consent.${entity.consent_type}`;
                    const tr = t(key);
                    return tr !== key ? tr : entity.consent_type;
                  })()}
                </Fact>
                <Fact label={t('common.status')}>{entity.revoked_at ? 'revoked' : (entity.granted ? 'granted' : 'denied')}</Fact>
                <Fact label={t('patients.inspector.granted_at')}>{fmtDateTime(entity.granted_at, locale)}</Fact>
                {entity.revoked_at && <Fact label={t('patients.inspector.revoked_at')}>{fmtDateTime(entity.revoked_at, locale)}</Fact>}
                <Fact label={t('patients.inspector.policy')}>{entity.policy_version || '—'}</Fact>
              </dl>
            </div>
          )}

          {!loading && entity && ['whatsapp', 'survey', 'task', 'complaint', 'document', 'note', 'created', 'lifecycle', 'welcome', 'recall'].includes(kind) && (
            <div className="space-y-3" data-testid={`inspector-${kind}`}>
              <dl className="appt-drawer-facts grid grid-cols-1 gap-3">
                {entity.body && <Fact label={t('patients.inspector.message')}><span className="whitespace-pre-wrap">{entity.body}</span></Fact>}
                {entity.comment && <Fact label={t('patients.inspector.comment')}>{entity.comment}</Fact>}
                {entity.score != null && <Fact label={t('patients.inspector.score')}>{entity.score}/10</Fact>}
                {entity.title && <Fact label={t('common.title')}>{entity.title}</Fact>}
                {entity.description && <Fact label={t('common.description')}>{entity.description}</Fact>}
                {entity.doc_type && <Fact label={t('patients.inspector.doc_type')}>{entity.doc_type}</Fact>}
                {entity.category && <Fact label={t('patients.inspector.category')}>{entity.category}</Fact>}
                {entity.priority && <Fact label={t('patients.inspector.priority')}>{entity.priority}</Fact>}
                {entity.direction && <Fact label={t('patients.inspector.direction')}>{entity.direction}</Fact>}
                {entity.subtitle && <Fact label={t('patients.inspector.detail')}>{entity.subtitle}</Fact>}
                {(entity.created_at || entity.at || entity.occurred_at) && (
                  <Fact label={t('common.date')}>{fmtDateTime(entity.created_at || entity.at || entity.occurred_at, locale)}</Fact>
                )}
                {entity.status && <Fact label={t('common.status')}>{entity.status}</Fact>}
              </dl>
              {related.appointment?.id && (
                <button type="button" className="btn-secondary w-full text-sm" onClick={() => onOpenEvent(`appt-${related.appointment.id}`)}>
                  {t('patients.inspector.action_open_related')}
                </button>
              )}
            </div>
          )}

          {!loading && actions.length > 0 && (
            <div className="space-y-2 pt-1 border-t border-[rgba(176,183,192,0.4)]">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--ink-muted)]">
                {t('patients.inspector.actions')}
              </div>
              <div className="flex flex-wrap gap-2">
                {actions.filter((a: any) => !['status_cycle'].includes(a.id)).map((a: any) => (
                  <button
                    key={a.id}
                    type="button"
                    className="btn-secondary text-xs"
                    disabled={busy === a.id}
                    data-testid={`inspector-action-${a.id}`}
                    onClick={() => runAction(a.id)}
                  >
                    {busy === a.id ? '…' : (t(a.label_key) !== a.label_key ? t(a.label_key) : a.id)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-[rgba(176,183,192,0.45)] flex items-center justify-between gap-2"
          style={{ background: 'linear-gradient(180deg,#f4efe6,#ebe4d8)' }}>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={idx <= 0}
            onClick={() => idx > 0 && onOpenEvent(eventList[idx - 1].id)}
          >
            ↑ {t('patients.inspector.prev')}
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={idx < 0 || idx >= eventList.length - 1}
            onClick={() => idx >= 0 && idx < eventList.length - 1 && onOpenEvent(eventList[idx + 1].id)}
          >
            {t('patients.inspector.next')} ↓
          </button>
        </footer>
      </aside>
    </>
  );
}
