import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { useAuth } from '../hooks/useAuth';
import { ConfirmDialog, FormError } from '../components/crud';
import { PatientForm } from '../components/PatientForm';
import ProntuarioChart from '../components/prontuario/ProntuarioChart';
import TimelineInspector from '../components/TimelineInspector';

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function openAuthedFile(url: string) {
  const token = localStorage.getItem('auth_token');
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(async (r) => {
      if (!r.ok) throw new Error('download_failed');
      const blob = await r.blob();
      const obj = URL.createObjectURL(blob);
      window.open(obj, '_blank');
    })
    .catch(() => { /* ignore */ });
}
type WorkspaceTab =
  | 'overview' | 'timeline' | 'appointments' | 'clinical' | 'whatsapp'
  | 'surveys' | 'documents' | 'billing' | 'tasks' | 'privacy' | 'audit';

const LIFECYCLES = [
  'prospect', 'new_patient', 'active', 'in_treatment', 'follow_up_required',
  'recall_due', 'inactive', 'do_not_contact', 'archived',
] as const;

const CONSENT_PURPOSES = [
  'whatsapp_admin', 'appointment_reminders', 'post_visit_survey', 'phone_calls',
  'marketing_news', 'promotions_events', 'email_communication', 'sms_communication',
  'health_data_processing', 'data_processing',
] as const;

function initials(name: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase();
}

function fmtDate(v?: string | null, locale = 'pt-BR') {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(v?: string | null, locale = 'pt-BR') {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(locale, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function monthKey(at: string, locale: string) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at?.slice(0, 7) || '';
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

function KindIcon({ kind }: { kind: string }) {
  const cls = 'w-4 h-4';
  if (kind === 'appointment') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
  }
  if (kind === 'encounter' || kind === 'clinical' || kind === 'evolution' || kind === 'procedure' || kind === 'exam_result') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4.5 12.5 8 9l3 3 3.5-3.5L18 12" /><path d="M3 21h18" /></svg>;
  }
  if (kind === 'whatsapp' || kind === 'welcome') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" /></svg>;
  }
  if (kind === 'survey' || kind === 'survey_sent') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></svg>;
  }
  if (kind === 'consent' || kind === 'lifecycle') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
  }
  if (kind === 'invoice') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 2h9l5 5v15H6z" /><path d="M9 9h6M9 13h6" /></svg>;
  }
  if (kind === 'note') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>;
  }
  if (kind === 'task' || kind === 'complaint') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
  }
  if (kind === 'document' || kind === 'recall') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>;
  }
  return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="9" /><path d="M12 8v4l2.5 2.5" /></svg>;
}

export default function PatientRecord() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<WorkspaceTab>('overview');
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [consentBusy, setConsentBusy] = useState<string | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskCategory, setTaskCategory] = useState('follow_up');
  const [taskPriority, setTaskPriority] = useState('normal');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskAutomationId, setTaskAutomationId] = useState('');
  const [taskLinkMode, setTaskLinkMode] = useState<'reference' | 'trigger_on_create' | 'trigger_on_complete'>('reference');
  const [taskRunNow, setTaskRunNow] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskMsg, setTaskMsg] = useState('');
  const [taskFilter, setTaskFilter] = useState<'open' | 'all'>('open');
  const [teamUsers, setTeamUsers] = useState<any[]>([]);
  const [automations, setAutomations] = useState<any[]>([]);
  const [docTitle, setDocTitle] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docBusy, setDocBusy] = useState(false);
  const [docMsg, setDocMsg] = useState('');
  const [recallDays, setRecallDays] = useState('90');
  const [recallBusy, setRecallBusy] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);

  const load = () => {
    if (!id) return;
    setLoading(true);
    setError('');
    api.get(`/api/patients/${id}/record`)
      .then((d) => {
        setData(d);
        setNoteDraft(d.patient?.notes || '');
      })
      .catch((e: any) => setError(e.message || t('errors.generic')))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id, locale]);

  useEffect(() => {
    if (tab !== 'tasks') return;
    let cancelled = false;
    Promise.all([
      api.get('/api/users').catch(() => ({ users: [] })),
      api.get('/api/whatsapp/automations').catch(() => ({ automations: [] })),
    ]).then(([usersRes, autoRes]) => {
      if (cancelled) return;
      setTeamUsers(usersRes.users || usersRes || []);
      setAutomations(autoRes.automations || []);
    });
    return () => { cancelled = true; };
  }, [tab, id]);

  const patient = data?.patient;
  const workspace = data?.workspace || {};
  const permissions = data?.permissions || {};
  const timeline = data?.timeline || [];
  const associations = data?.associations || {};
  const upcoming = data?.upcoming_appointments || [];
  const consentLedger = data?.consent_ledger || [];
  const surveys = data?.surveys || [];
  const tasks = data?.tasks || [];
  const tickets = data?.tickets || [];
  const documents = data?.documents || [];
  const auditEvents = data?.audit_events || [];
  const privacyRequests = data?.privacy_requests || [];
  const clinicalOk = !!permissions.clinical;
  const auditOk = !!permissions.privacy;

  const titleFor = (item: any) => {
    const key = `patients.timeline.${item.title}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (item.kind === 'appointment' && item.meta?.type) {
      const tk = `appointments.types.${item.meta.type}`;
      const tt = t(tk);
      return tt !== tk ? tt : item.title;
    }
    return item.title;
  };

  const openEventId = searchParams.get('event');

  const openEvent = (eventId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('event', eventId);
    setSearchParams(next, { replace: false });
  };

  const closeEvent = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('event');
    setSearchParams(next, { replace: true });
  };

  /** Switch workspace tab; on clinical, close inspector + scroll chart into view (mobile). */
  const selectWorkspaceTab = (next: WorkspaceTab, opts?: { closeInspector?: boolean }) => {
    if (opts?.closeInspector !== false && openEventId) closeEvent();
    setTab(next);
  };

  useEffect(() => {
    if (tab !== 'clinical') return;
    let cancelled = false;
    const scroll = () => {
      if (cancelled) return;
      const chart = document.querySelector('[data-testid="prontuario-chart"]') as HTMLElement | null;
      if (!chart) return;
      const rect = chart.getBoundingClientRect();
      const inView = rect.top >= 0 && rect.top < window.innerHeight * 0.55;
      if (inView) return;
      chart.scrollIntoView({ behavior: 'auto', block: 'start' });
      // Mobile shell sometimes scrolls the window while <main> is not overflow-clipped
      const after = chart.getBoundingClientRect();
      if (!(after.top >= 0 && after.top < window.innerHeight * 0.55)) {
        const delta = after.top - 8;
        window.scrollBy({ top: delta, left: 0, behavior: 'auto' });
        const main = chart.closest('main') as HTMLElement | null;
        if (main && main.scrollHeight > main.clientHeight + 1) {
          main.scrollBy({ top: delta, left: 0, behavior: 'auto' });
        }
      }
    };
    const t1 = window.setTimeout(scroll, 50);
    const t2 = window.setTimeout(scroll, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [tab, id]);

  const filteredTimeline = useMemo(() => {
    if (tab === 'timeline' || tab === 'overview') return timeline;
    if (tab === 'appointments') return timeline.filter((x: any) => x.kind === 'appointment' || x.kind === 'recall');
    if (tab === 'clinical') return timeline.filter((x: any) =>
      ['encounter', 'prescription', 'evolution', 'procedure', 'exam_result'].includes(x.kind)
    );
    if (tab === 'whatsapp') return timeline.filter((x: any) => x.kind === 'whatsapp' || x.kind === 'welcome');
    if (tab === 'surveys') return timeline.filter((x: any) => x.kind === 'survey' || x.kind === 'survey_sent' || x.kind === 'complaint');
    if (tab === 'documents') return timeline.filter((x: any) => x.kind === 'document');
    if (tab === 'billing') return timeline.filter((x: any) => x.kind === 'invoice');
    if (tab === 'tasks') return timeline.filter((x: any) => x.kind === 'task' || x.kind === 'complaint');
    if (tab === 'privacy') return timeline.filter((x: any) => x.kind === 'consent' || x.kind === 'lifecycle');
    return timeline;
  }, [tab, timeline]);

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const item of filteredTimeline) {
      const k = monthKey(item.at, locale);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    return [...map.entries()];
  }, [filteredTimeline, locale]);

  const saveNote = async () => {
    if (!id) return;
    setNoteBusy(true);
    try {
      await api.put(`/api/patients/${id}`, { notes: noteDraft });
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setNoteBusy(false);
    }
  };

  const toggleConsent = async (purpose: string, granted: boolean) => {
    if (!id) return;
    setConsentBusy(purpose);
    try {
      const res = await api.put(`/api/patients/${id}/consents`, { purpose, granted });
      setData((d: any) => d ? { ...d, consent_ledger: res.ledger } : d);
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setConsentBusy(null);
    }
  };

  const changeLifecycle = async (stage: string) => {
    if (!id) return;
    setStageBusy(true);
    try {
      await api.put(`/api/patients/${id}/lifecycle`, { lifecycle_stage: stage });
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setStageBusy(false);
    }
  };

  const resetTaskForm = () => {
    setTaskTitle('');
    setTaskDescription('');
    setTaskCategory('follow_up');
    setTaskPriority('normal');
    setTaskDueAt('');
    setTaskAssignee('');
    setTaskAutomationId('');
    setTaskLinkMode('reference');
    setTaskRunNow(false);
  };

  const createTask = async () => {
    if (!id || !taskTitle.trim()) return;
    setTaskBusy(true);
    setTaskMsg('');
    try {
      const res = await api.post(`/api/patients/${id}/tasks`, {
        title: taskTitle.trim(),
        description: taskDescription.trim() || null,
        category: taskCategory,
        priority: taskPriority,
        due_at: taskDueAt || null,
        assigned_to: taskAssignee || null,
        related_automation_id: taskAutomationId || null,
        automation_link_mode: taskAutomationId ? taskLinkMode : null,
        run_automation_now: !!(taskAutomationId && (taskRunNow || taskLinkMode === 'trigger_on_create')),
      });
      resetTaskForm();
      setTab('tasks');
      setTaskMsg(
        res?.trigger?.sent
          ? t('patients.workspace.task_created_sent')
          : t('patients.workspace.task_created'),
      );
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setTaskBusy(false);
    }
  };

  const resolveTask = async (taskId: string) => {
    if (!id) return;
    try {
      await api.patch(`/api/patients/${id}/tasks/${taskId}`, { status: 'done' });
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    }
  };

  const runTaskAutomation = async (taskId: string) => {
    if (!id) return;
    setTaskBusy(true);
    try {
      const res = await api.post(`/api/patients/${id}/tasks/${taskId}/run-automation`, {});
      setTaskMsg(
        res?.trigger?.sent
          ? t('patients.workspace.automation_sent')
          : (res?.trigger?.error
            ? t('patients.workspace.automation_failed', { error: res.trigger.error })
            : t('patients.workspace.automation_ran')),
      );
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setTaskBusy(false);
    }
  };

  const createTicket = async () => {
    if (!id) return;
    setTicketBusy(true);
    try {
      await api.post(`/api/patients/${id}/tickets`, {
        title: t('patients.workspace.action_ticket'),
        description: t('patients.workspace.ticket_manual_hint'),
        survey_score: 0,
      });
      setTab('tasks');
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setTicketBusy(false);
    }
  };

  const resolveTicket = async (ticketId: string) => {
    if (!id) return;
    try {
      await api.patch(`/api/patients/${id}/tickets/${ticketId}`, {
        status: 'resolved',
        resolution: 'Resolvido pela equipe',
        outcome: 'contacted',
      });
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    }
  };

  const createDocument = async () => {
    if (!id) return;
    if (!docTitle.trim() && !docFile) return;
    setDocBusy(true);
    setDocMsg('');
    try {
      const payload: Record<string, unknown> = {
        title: docTitle.trim() || docFile?.name || 'Documento',
        doc_type: docFile ? 'upload' : 'form',
        status: docFile ? 'active' : 'pending',
      };
      if (docFile) {
        payload.filename = docFile.name;
        payload.mime = docFile.type || 'application/octet-stream';
        payload.data_base64 = await fileToBase64(docFile);
      }
      await api.post(`/api/patients/${id}/documents`, payload);
      setDocTitle('');
      setDocFile(null);
      setDocMsg(t('patients.workspace.documents_saved'));
      setTab('documents');
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setDocBusy(false);
    }
  };

  const removeDocument = async (doc: any) => {
    if (!id || !doc?.can_delete) return;
    setDocBusy(true);
    try {
      await api.del(`/api/patients/${id}/documents/${doc.id}`);
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setDocBusy(false);
    }
  };

  const setRecall = async () => {
    if (!id) return;
    const days = parseInt(recallDays, 10);
    if (!days) return;
    setRecallBusy(true);
    try {
      await api.put(`/api/patients/${id}/recall`, { interval_days: days });
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setRecallBusy(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    setDeleteBusy(true);
    try {
      await api.del(`/api/patients/${id}`);
      navigate('/patients');
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
      setDeleting(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (loading && !data) {
    return <div className="panel-inset px-6 py-8 text-sm text-[color:var(--ink-muted)]">{t('common.loading')}</div>;
  }
  if (error && !patient) {
    return (
      <div className="space-y-3">
        <FormError message={error} />
        <Link to="/patients" className="text-sm font-medium text-[#4b5563] hover:underline">{t('patients.back_to_list')}</Link>
      </div>
    );
  }
  if (!patient) return null;

  const displayName = patient.social_name || patient.full_name;
  const stage = workspace.lifecycle_stage || patient.lifecycle_stage || 'new_patient';
  const tabs: { id: WorkspaceTab; label: string; hide?: boolean }[] = [
    { id: 'overview', label: t('patients.workspace.tab_overview') },
    { id: 'timeline', label: t('patients.workspace.tab_timeline') },
    { id: 'appointments', label: t('patients.workspace.tab_appointments') },
    { id: 'clinical', label: t('patients.workspace.tab_clinical'), hide: !clinicalOk },
    { id: 'whatsapp', label: t('patients.workspace.tab_whatsapp') },
    { id: 'surveys', label: t('patients.workspace.tab_surveys') },
    { id: 'documents', label: t('patients.workspace.tab_documents') },
    { id: 'billing', label: t('patients.workspace.tab_billing') },
    { id: 'tasks', label: t('patients.workspace.tab_tasks') },
    { id: 'privacy', label: t('patients.workspace.tab_privacy') },
    { id: 'audit', label: t('patients.workspace.tab_audit'), hide: !auditOk },
  ];

  const prop = (label: string, value: any) => (
    <div className="crm-prop">
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="patient-workspace">
      {error && <FormError message={error} />}

      {/* Sticky patient header */}
      <header className="aluminum-header rounded-panel px-4 py-4 sm:px-5 space-y-4">
        <div className="crm-record-toolbar">
          <Link to="/patients" className="text-sm font-medium text-[#4a453c] hover:underline shrink-0 leading-none">
            ← {t('patients.back_to_list')}
          </Link>
          <div className="crm-record-actions">
            <Link to="/appointments" className="btn-secondary text-xs">{t('patients.workspace.action_schedule')}</Link>
            <Link to="/whatsapp" className="btn-secondary text-xs">{t('patients.workspace.action_whatsapp')}</Link>
            <button type="button" className="btn-secondary text-xs" onClick={() => setShowForm(true)}>{t('common.edit')}</button>
            {user?.role === 'admin' && (
              <button type="button" className="btn-danger text-xs" onClick={() => setDeleting(true)}>{t('common.delete')}</button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="crm-avatar-lg shrink-0">{initials(displayName)}</div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold text-[#3a342c] truncate leading-tight">{displayName}</h1>
              {patient.social_name && (
                <span className="text-sm text-[color:var(--ink-muted)]">({patient.full_name})</span>
              )}
              <span className="badge-slate font-mono text-[11px]">{patient.id?.slice(0, 12)}</span>
              {workspace.open_complaint ? <span className="badge-red">{t('patients.workspace.open_complaint')}</span> : null}
              {workspace.do_not_contact ? <span className="badge-red">{t('patients.lifecycle.do_not_contact')}</span> : null}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#4a453c]">
              <span>{t('patients.birth_date')}: {fmtDate(patient.birth_date, locale)}</span>
              <span>WhatsApp: <a className="font-mono hover:underline" href={`https://wa.me/${String(patient.phone || '').replace(/\D/g, '')}`}>{patient.phone || '—'}</a></span>
              <span>{t('patients.col_owner')}: {workspace.assigned_professional?.full_name || data.owner_name || t('patients.unassigned')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)]">{t('patients.workspace.lifecycle')}</label>
              <select
                className="crm-filter"
                value={stage}
                disabled={stageBusy}
                onChange={(e) => changeLifecycle(e.target.value)}
                data-testid="lifecycle-select"
              >
                {LIFECYCLES.map((s) => (
                  <option key={s} value={s}>{t(`patients.lifecycle.${s}`)}</option>
                ))}
              </select>
              <span className="text-xs text-[color:var(--ink-muted)]">
                {t('patients.workspace.next_appt')}:{' '}
                {workspace.next_appointment
                  ? fmtDateTime(workspace.next_appointment.scheduled_at, locale)
                  : '—'}
              </span>
              <span className="text-xs text-[color:var(--ink-muted)]">
                {t('patients.workspace.last_visit')}:{' '}
                {workspace.last_visit ? fmtDateTime(workspace.last_visit.scheduled_at, locale) : '—'}
              </span>
              <span className={`badge ${workspace.consent_ok ? 'badge-green' : 'badge-yellow'}`}>
                {workspace.consent_ok ? t('patients.workspace.consent_ok') : t('patients.workspace.consent_missing')}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto border-t border-[#9CA3AF]/50 pt-3 -mb-px" data-testid="workspace-tabs">
          {tabs.filter((x) => !x.hide).map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => selectWorkspaceTab(x.id)}
              className={`crm-feed-tab ${tab === x.id ? 'is-active' : ''}`}
              data-testid={`workspace-tab-${x.id}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </header>

      <div className={`crm-record-grid ${tab === 'clinical' ? 'is-clinical' : ''}`}>
        {/* LEFT — summary */}
        <aside className="crm-record-col">
          <div className="crm-record-panel">
            <h2 className="crm-record-panel-title">{t('patients.workspace.summary')}</h2>
            <dl className="space-y-0">
              {prop(t('patients.email'), patient.email)}
              {prop(t('patients.phone'), patient.phone)}
              {prop(t('patients.phone_secondary'), patient.phone_secondary)}
              {prop(t('patients.workspace.language'), patient.preferred_language || 'pt-BR')}
              {prop(t('patients.cpf'), patient.cpf)}
              {prop(t('patients.health_insurance'), patient.health_insurance)}
              {prop(
                t('patients.address_city'),
                [patient.address_street, patient.address_number, patient.address_neighborhood, patient.address_city, patient.address_state].filter(Boolean).join(', '),
              )}
              {prop(t('patients.emergency_name'), patient.emergency_contact_name)}
              {prop(t('patients.emergency_phone'), patient.emergency_contact_phone)}
              {prop(t('patients.workspace.guardian'), patient.guardian_name)}
              {prop(t('patients.workspace.guardian_phone'), patient.guardian_phone)}
              {prop(t('patients.workspace.recall_due'), workspace.recall_due_at ? fmtDate(workspace.recall_due_at, locale) : '—')}
              {clinicalOk && prop(t('patients.allergies'), (patient.allergies || []).join(', '))}
              {clinicalOk && prop(t('patients.chronic_conditions'), (patient.chronic_conditions || []).join(', '))}
            </dl>
          </div>

          {(tab === 'overview' || tab === 'privacy') && (
            <div className="crm-record-panel space-y-3" data-testid="consent-ledger">
              <h2 className="crm-record-panel-title">{t('patients.workspace.consents')}</h2>
              <p className="text-xs text-[color:var(--ink-muted)]">{t('patients.workspace.consents_hint')}</p>
              <ul className="space-y-2">
                {CONSENT_PURPOSES.map((purpose) => {
                  const row = consentLedger.find((c: any) => c.purpose === purpose);
                  const on = !!row?.granted;
                  return (
                    <li key={purpose} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium text-[#3a342c] truncate">{t(`patients.consent.${purpose}`)}</div>
                        <div className="text-[11px] text-[color:var(--ink-muted)]">
                          {on ? fmtDateTime(row?.granted_at, locale) : (row?.revoked_at ? fmtDateTime(row.revoked_at, locale) : '—')}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={consentBusy === purpose}
                        className={`seg-item !py-1 !px-2.5 !text-xs ${on ? 'is-active' : ''}`}
                        onClick={() => toggleConsent(purpose, !on)}
                        data-testid={`consent-${purpose}`}
                      >
                        {consentBusy === purpose ? '…' : on ? t('common.yes') : t('common.no')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>

        {/* CENTER — timeline / tab bodies */}
        <section className="crm-record-col min-w-0">
          <div className="crm-record-shell">
            {tab !== 'clinical' && (
              <div className="px-4 pt-4 pb-3 border-b border-[rgba(176,183,192,0.45)]">
                <h2 className="crm-record-panel-title !mb-0">
                  {tabs.find((x) => x.id === tab)?.label || t('patients.workspace.tab_overview')}
                </h2>
              </div>
            )}
          {tab === 'overview' && upcoming.length > 0 && (
            <div className="px-4 py-3 border-b border-[rgba(176,183,192,0.45)]" style={{ background: 'linear-gradient(180deg,#E5E7EB,#D1D5DB)' }}>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#4a453c] mb-2">{t('patients.workspace.upcoming')}</div>
              <div className="space-y-1.5">
                {upcoming.slice(0, 3).map((a: any) => (
                  <button
                    key={a.id}
                    type="button"
                    className="w-full flex flex-wrap items-center justify-between gap-2 text-sm text-left rounded-lg px-2 py-1.5 hover:bg-[rgba(255,255,255,0.55)] transition-colors"
                    onClick={() => openEvent(`appt-${a.id}`)}
                    data-testid={`upcoming-appt-${a.id}`}
                  >
                    <span className="font-medium">{fmtDateTime(a.scheduled_at, locale)}</span>
                    <span className="text-[color:var(--ink-muted)]">{a.practitioner_name}</span>
                    <span className={`badge ${a.status === 'confirmed' ? 'badge-green' : 'badge-yellow'}`}>{a.status}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'clinical' && !clinicalOk && (
            <div className="p-4 text-sm text-[color:var(--ink-muted)]">{t('patients.workspace.clinical_restricted')}</div>
          )}

          {tab === 'clinical' && clinicalOk && patient && (
            <ProntuarioChart
              patientId={patient.id}
              patientName={patient.full_name}
              birthDate={patient.birth_date}
              gender={patient.gender}
            />
          )}

          {tab === 'surveys' && (
            <div className="px-4 py-3 border-b border-[rgba(176,183,192,0.45)] space-y-2">
              <h3 className="font-semibold text-sm">{t('patients.workspace.survey_history')}</h3>
              {surveys.length === 0 && <p className="text-sm text-[color:var(--ink-muted)]">{t('common.no_data')}</p>}
              {surveys.map((s: any) => (
                <div key={s.id} className="crm-timeline-card flex items-center justify-between gap-2">
                  <span className="text-sm">{fmtDateTime(s.created_at, locale)}</span>
                  <span className={`badge ${s.score >= 9 ? 'badge-green' : s.score <= 6 ? 'badge-red' : 'badge-yellow'}`}>
                    {s.score}/10
                  </span>
                  <span className="text-xs text-[color:var(--ink-muted)] truncate flex-1">{s.comment || '—'}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'tasks' && (
            <div className="px-4 py-3 border-b border-[rgba(176,183,192,0.45)] space-y-4" data-testid="workspace-tasks">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-sm">{t('patients.workspace.tasks_heading')}</h3>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={`crm-feed-tab ${taskFilter === 'open' ? 'is-active' : ''}`}
                    onClick={() => setTaskFilter('open')}
                    data-testid="tasks-filter-open"
                  >
                    {t('patients.workspace.task_filter_open')}
                  </button>
                  <button
                    type="button"
                    className={`crm-feed-tab ${taskFilter === 'all' ? 'is-active' : ''}`}
                    onClick={() => setTaskFilter('all')}
                    data-testid="tasks-filter-all"
                  >
                    {t('patients.workspace.task_filter_all')}
                  </button>
                </div>
              </div>

              <section className="crm-inset-panel space-y-2" data-testid="workspace-task-form">
                <h4 className="font-display text-base text-[color:var(--ink)]">{t('patients.workspace.create_task')}</h4>
                <p className="text-xs text-[color:var(--ink-muted)] leading-relaxed">{t('patients.workspace.task_form_hint')}</p>

                <label className="text-xs text-[color:var(--ink-muted)] block">
                  {t('patients.workspace.task_title')}
                  <input
                    className="input mt-1 w-full"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder={t('patients.workspace.task_placeholder')}
                    data-testid="task-title"
                  />
                </label>

                <label className="text-xs text-[color:var(--ink-muted)] block">
                  {t('patients.workspace.task_description')}
                  <textarea
                    className="input mt-1 w-full"
                    rows={2}
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                    data-testid="task-description"
                  />
                </label>

                <div className="grid sm:grid-cols-2 gap-2">
                  <label className="text-xs text-[color:var(--ink-muted)]">
                    {t('patients.workspace.task_category')}
                    <select className="input mt-1 w-full" value={taskCategory} onChange={(e) => setTaskCategory(e.target.value)} data-testid="task-category">
                      {['follow_up', 'scheduling', 'recall', 'recall_followup', 'service_recovery', 'no_show', 'billing_followup', 'clinical', 'admin'].map((c) => (
                        <option key={c} value={c}>{t(`patients.workspace.task_cat_${c}`)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-[color:var(--ink-muted)]">
                    {t('patients.inspector.priority')}
                    <select className="input mt-1 w-full" value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)} data-testid="task-priority">
                      {['low', 'normal', 'high', 'urgent'].map((p) => (
                        <option key={p} value={p}>{t(`patients.workspace.task_priority_${p}`)}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid sm:grid-cols-2 gap-2">
                  <label className="text-xs text-[color:var(--ink-muted)]">
                    {t('patients.workspace.task_due')}
                    <input className="input mt-1 w-full" type="datetime-local" value={taskDueAt} onChange={(e) => setTaskDueAt(e.target.value)} data-testid="task-due" />
                  </label>
                  <label className="text-xs text-[color:var(--ink-muted)]">
                    {t('patients.workspace.task_assignee')}
                    <select className="input mt-1 w-full" value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)} data-testid="task-assignee">
                      <option value="">{t('patients.workspace.task_assignee_none')}</option>
                      {teamUsers.filter((u: any) => u.active !== false).map((u: any) => (
                        <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="space-y-2 rounded-lg border border-[rgba(176,183,192,0.4)] bg-[#f7f1e6] px-3 py-2.5">
                  <label className="text-xs text-[color:var(--ink-muted)] block">
                    {t('patients.workspace.task_automation')}
                    <select
                      className="input mt-1 w-full"
                      value={taskAutomationId}
                      onChange={(e) => setTaskAutomationId(e.target.value)}
                      data-testid="task-automation"
                    >
                      <option value="">{t('patients.workspace.task_automation_none')}</option>
                      {automations.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.key}{a.enabled ? '' : ` (${t('patients.workspace.task_automation_disabled')})`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {taskAutomationId && (
                    <>
                      <label className="text-xs text-[color:var(--ink-muted)] block">
                        {t('patients.workspace.task_link_mode')}
                        <select className="input mt-1 w-full" value={taskLinkMode} onChange={(e) => setTaskLinkMode(e.target.value as any)} data-testid="task-link-mode">
                          <option value="reference">{t('patients.workspace.task_link_reference')}</option>
                          <option value="trigger_on_create">{t('patients.workspace.task_link_on_create')}</option>
                          <option value="trigger_on_complete">{t('patients.workspace.task_link_on_complete')}</option>
                        </select>
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={taskRunNow || taskLinkMode === 'trigger_on_create'} onChange={(e) => setTaskRunNow(e.target.checked)} data-testid="task-run-now" />
                        {t('patients.workspace.task_run_now')}
                      </label>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={taskBusy || !taskTitle.trim()}
                  onClick={createTask}
                  data-testid="task-submit"
                >
                  {taskBusy ? '…' : t('patients.workspace.action_task')}
                </button>
                {taskMsg && <p className="text-sm text-[color:var(--ink-muted)]" data-testid="task-msg">{taskMsg}</p>}
              </section>

              {tickets.filter((tk: any) => tk.status === 'open').map((tk: any) => (
                <div key={tk.id} className="crm-timeline-card flex flex-wrap items-center justify-between gap-2" data-testid={`ticket-${tk.id}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{tk.title}</div>
                    <div className="text-xs text-[color:var(--ink-muted)]">{tk.description}</div>
                  </div>
                  <span className="badge-red">{tk.priority}</span>
                  <button type="button" className="btn-secondary text-xs" onClick={() => resolveTicket(tk.id)}>
                    {t('patients.workspace.resolve')}
                  </button>
                </div>
              ))}

              {(() => {
                const visible = tasks.filter((task: any) => taskFilter === 'all' || task.status === 'open');
                if (!visible.length && !tickets.some((tk: any) => tk.status === 'open')) {
                  return (
                    <p className="text-sm text-[color:var(--ink-muted)]" data-testid="tasks-empty">
                      {t('patients.workspace.tasks_empty')}
                    </p>
                  );
                }
                return visible.map((task: any) => (
                  <div key={task.id} className="crm-timeline-card space-y-1.5" data-testid={`task-${task.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{task.title}</div>
                        {task.description && (
                          <div className="text-xs text-[color:var(--ink-muted)] mt-0.5">{task.description}</div>
                        )}
                        <div className="text-[11px] text-[color:var(--ink-muted)] mt-1">
                          {(() => {
                            const ck = `patients.workspace.task_cat_${task.category}`;
                            const ct = t(ck);
                            return ct !== ck ? ct : task.category;
                          })()}
                          {' · '}{task.priority}
                          {task.due_at ? ` · ${t('patients.workspace.task_due')}: ${fmtDateTime(task.due_at, locale)}` : ''}
                          {task.assigned_to_name ? ` · ${task.assigned_to_name}` : ''}
                          {task.automation_key || task.automation_key_resolved
                            ? ` · ${t('patients.workspace.task_automation')}: ${task.automation_key || task.automation_key_resolved}`
                            : ''}
                        </div>
                      </div>
                      <span className={`badge ${task.status === 'open' ? 'badge-yellow' : 'badge-green'}`}>
                        {(() => {
                          const sk = `patients.workspace.task_status_${task.status}`;
                          const st = t(sk);
                          return st !== sk ? st : task.status;
                        })()}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {task.status === 'open' && (
                        <button type="button" className="btn-secondary text-xs" onClick={() => resolveTask(task.id)} data-testid={`task-resolve-${task.id}`}>
                          {t('patients.workspace.resolve')}
                        </button>
                      )}
                      {(task.related_automation_id || task.automation_key) && (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={taskBusy}
                          onClick={() => runTaskAutomation(task.id)}
                          data-testid={`task-run-auto-${task.id}`}
                        >
                          {t('patients.workspace.task_run_automation')}
                        </button>
                      )}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}

          {tab === 'documents' && (
            <div className="px-4 py-3 border-b border-[rgba(176,183,192,0.45)] space-y-3" data-testid="workspace-documents">
              <div>
                <h3 className="font-semibold text-sm">{t('patients.workspace.documents_heading')}</h3>
                <p className="text-xs text-[color:var(--ink-muted)] mt-0.5">{t('patients.workspace.documents_hint')}</p>
              </div>

              <div className="space-y-2 rounded-lg border border-[rgba(176,183,192,0.45)] bg-[color:var(--paper)]/60 p-3" data-testid="workspace-document-form">
                <input
                  className="input"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder={t('patients.workspace.document_placeholder')}
                  data-testid="doc-title"
                />
                <input
                  type="file"
                  className="block w-full text-xs text-[color:var(--ink-muted)]"
                  data-testid="doc-file"
                  onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                />
                {docFile && (
                  <p className="text-[11px] text-[color:var(--ink-muted)] truncate">{docFile.name}</p>
                )}
                <button
                  type="button"
                  className="btn-primary w-full text-sm"
                  disabled={docBusy || (!docTitle.trim() && !docFile)}
                  onClick={createDocument}
                  data-testid="doc-submit"
                >
                  {docBusy ? '…' : t('patients.workspace.documents_add')}
                </button>
                {docMsg && <p className="text-xs text-emerald-700" data-testid="doc-msg">{docMsg}</p>}
              </div>

              {documents.length === 0 && (
                <p className="text-sm text-[color:var(--ink-muted)]" data-testid="documents-empty">{t('patients.workspace.documents_empty')}</p>
              )}
              <ul className="space-y-2">
                {documents.map((d: any) => (
                  <li key={d.id} className="crm-timeline-card space-y-2" data-testid={`doc-row-${d.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{d.title}</div>
                        <div className="text-[11px] text-[color:var(--ink-muted)]">
                          {d.origin_label || d.source}
                          {d.original_name ? ` · ${d.original_name}` : ''}
                          {d.created_at ? ` · ${fmtDateTime(d.created_at, locale)}` : ''}
                          {d.size_bytes != null ? ` · ${(Number(d.size_bytes) / 1024).toFixed(1)} KB` : ''}
                        </div>
                      </div>
                      <span className={`badge shrink-0 ${d.status === 'signed' || d.status === 'active' ? 'badge-green' : 'badge-yellow'}`}>
                        {d.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {d.can_download && d.download_url && (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          data-testid={`doc-download-${d.id}`}
                          onClick={() => openAuthedFile(d.download_url.startsWith('http') ? d.download_url : d.download_url)}
                        >
                          {t('patients.workspace.documents_download')}
                        </button>
                      )}
                      {d.can_delete && (
                        <button
                          type="button"
                          className="btn-secondary text-xs text-rose-700"
                          disabled={docBusy}
                          data-testid={`doc-remove-${d.id}`}
                          onClick={() => removeDocument(d)}
                        >
                          {t('patients.workspace.documents_remove')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'audit' && (
            <div className="px-4 py-3 border-b border-[rgba(176,183,192,0.45)] space-y-2" data-testid="workspace-audit">
              <h3 className="font-semibold text-sm">{t('patients.workspace.audit_heading')}</h3>
              {!auditOk && <p className="text-sm text-[color:var(--ink-muted)]">{t('patients.workspace.audit_restricted')}</p>}
              {auditOk && auditEvents.length === 0 && <p className="text-sm text-[color:var(--ink-muted)]">{t('common.no_data')}</p>}
              {auditOk && auditEvents.map((a: any) => (
                <div key={a.id} className="crm-timeline-card text-sm">
                  <div className="font-medium">{a.action}</div>
                  <div className="text-xs text-[color:var(--ink-muted)]">
                    {a.actor_email || '—'} · {fmtDateTime(a.created_at, locale)} · {a.legal_basis || '—'}
                  </div>
                </div>
              ))}
              {privacyRequests.length > 0 && (
                <div className="pt-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1">{t('patients.workspace.privacy_requests')}</h4>
                  {privacyRequests.map((r: any) => (
                    <div key={r.id} className="crm-timeline-card flex justify-between gap-2 text-sm">
                      <span>{r.request_type}</span>
                      <span className="badge-slate">{r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab !== 'audit' && tab !== 'clinical' && (
          <div className="p-4 space-y-5">
            {grouped.length === 0 && tab !== 'tasks' && tab !== 'documents' && (
              <div className="text-center text-sm text-[color:var(--ink-muted)] py-10">{t('common.no_data')}</div>
            )}
            {tab === 'tasks' && grouped.length > 0 && (
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)]">
                {t('patients.workspace.task_timeline')}
              </h4>
            )}
            {tab !== 'documents' && grouped.map(([month, items]) => (
              <div key={month}>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--ink-muted)] mb-2">{month}</div>
                <ul className="space-y-2">
                  {items.map((item: any) => {
                    const selected = openEventId === item.id;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`crm-timeline-card flex gap-3 w-full text-left cursor-pointer transition-all ${
                            selected ? 'is-selected ring-2 ring-[color:var(--brass-deep)]' : 'hover:brightness-[0.985]'
                          }`}
                          data-testid={`timeline-${item.kind}`}
                          data-event-id={item.id}
                          aria-pressed={selected}
                          onClick={() => openEvent(item.id)}
                        >
                          <span className="crm-timeline-icon"><KindIcon kind={item.kind} /></span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-sm text-[#3a342c]">{titleFor(item)}</span>
                              {item.status && <span className="badge-slate text-[10px]">{item.status}</span>}
                              {item.kind === 'survey' && item.meta?.score != null && (
                                <span className={`badge ${item.meta.score >= 9 ? 'badge-green' : item.meta.score <= 6 ? 'badge-red' : 'badge-yellow'}`}>
                                  {item.meta.score}/10
                                </span>
                              )}
                            </div>
                            {item.subtitle && <div className="text-sm text-[color:var(--ink-muted)] mt-0.5 break-words">{item.subtitle}</div>}
                            <div className="text-[11px] text-[color:var(--ink-muted)] mt-1 flex items-center justify-between gap-2">
                              <span>{fmtDateTime(item.at, locale)}</span>
                              <span className="text-[10px] uppercase tracking-wide opacity-70">{t('patients.inspector.open_hint')}</span>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          )}
          </div>
        </section>

        {/* RIGHT — quick actions */}
        <aside className="crm-record-col crm-rail-stack">
          <div className="crm-record-panel">
            <h2 className="crm-record-panel-title">{t('patients.workspace.quick_actions')}</h2>
            <div className="crm-rail-actions">
              <Link to="/whatsapp" className="btn-secondary">{t('patients.workspace.action_whatsapp')}</Link>
              <Link to="/appointments" className="btn-secondary">{t('patients.workspace.action_schedule')}</Link>
              <button type="button" className="btn-secondary" onClick={() => selectWorkspaceTab('tasks')}>
                {t('patients.workspace.action_task')}
              </button>
              <button type="button" className="btn-secondary" disabled={ticketBusy} onClick={createTicket}>
                {ticketBusy ? '…' : t('patients.workspace.action_ticket')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => selectWorkspaceTab('privacy')}>
                {t('patients.workspace.action_consent')}
              </button>
              {clinicalOk && (
                <button
                  type="button"
                  className="btn-secondary"
                  data-testid="action-open-clinical"
                  onClick={() => selectWorkspaceTab('clinical')}
                >
                  {t('patients.workspace.action_clinical')}
                </button>
              )}
              <Link to="/invoices" className="btn-secondary">{t('patients.workspace.action_billing')}</Link>
            </div>
          </div>

          <div className="crm-record-panel space-y-2">
            <h2 className="crm-record-panel-title">{t('patients.workspace.create_task')}</h2>
            <input className="input" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder={t('patients.workspace.task_placeholder')} data-testid="rail-task-title" />
            <button
              type="button"
              className="btn-primary w-full text-sm"
              disabled={taskBusy || !taskTitle.trim()}
              onClick={createTask}
              data-testid="rail-task-submit"
            >
              {taskBusy ? '…' : t('patients.workspace.action_task')}
            </button>
            <button type="button" className="btn-secondary w-full text-xs" onClick={() => selectWorkspaceTab('tasks')}>
              {t('patients.workspace.task_open_full_form')}
            </button>
          </div>

          <div className="crm-record-panel space-y-2">
            <h2 className="crm-record-panel-title">{t('patients.workspace.create_document')}</h2>
            <input className="input" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder={t('patients.workspace.document_placeholder')} data-testid="rail-doc-title" />
            <input
              type="file"
              className="block w-full text-xs text-[color:var(--ink-muted)]"
              data-testid="rail-doc-file"
              onChange={(e) => setDocFile(e.target.files?.[0] || null)}
            />
            <button type="button" className="btn-secondary w-full text-sm" disabled={docBusy || (!docTitle.trim() && !docFile)} onClick={createDocument} data-testid="rail-doc-submit">
              {docBusy ? '…' : t('patients.workspace.documents_add')}
            </button>
            <button type="button" className="btn-secondary w-full text-xs" onClick={() => selectWorkspaceTab('documents')}>
              {t('patients.workspace.documents_open_vault')}
            </button>
          </div>

          {clinicalOk && (
            <div className="crm-record-panel space-y-2">
              <h2 className="crm-record-panel-title">{t('patients.workspace.set_recall')}</h2>
              <div className="flex gap-2">
                <input className="input" type="number" min={1} max={3650} value={recallDays} onChange={(e) => setRecallDays(e.target.value)} />
                <button type="button" className="btn-secondary text-sm shrink-0" disabled={recallBusy} onClick={setRecall}>
                  {recallBusy ? '…' : t('common.save')}
                </button>
              </div>
              <p className="text-[11px] text-[color:var(--ink-muted)]">{t('patients.workspace.recall_hint')}</p>
            </div>
          )}

          <div className="crm-record-panel space-y-2">
            <h2 className="crm-record-panel-title">{t('patients.workspace.internal_note')}</h2>
            <textarea className="input" rows={4} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
            <button type="button" className="btn-primary w-full text-sm" disabled={noteBusy} onClick={saveNote}>
              {noteBusy ? '…' : t('common.save')}
            </button>
          </div>

          <div className="crm-record-panel !py-3 space-y-0.5">
            {[
              ['appointments', t('patients.assoc.appointments'), associations.appointments],
              ['whatsapp', t('patients.assoc.whatsapp'), associations.whatsapp],
              ['surveys', t('patients.workspace.tab_surveys'), associations.surveys],
              ['tasks', t('patients.workspace.tab_tasks'), associations.tasks],
              ['tickets', t('patients.workspace.tickets'), associations.tickets],
              ['documents', t('patients.workspace.tab_documents'), associations.documents],
              ['invoices', t('patients.assoc.invoices'), associations.invoices],
              ['consents', t('patients.assoc.consents'), associations.consents],
            ].map(([key, label, assoc]: any) => (
              <button
                key={key}
                type="button"
                className="w-full flex items-center justify-between text-sm px-1 py-1.5 rounded-lg hover:bg-[#efe6d8] text-left"
                onClick={() => {
                  const tabMap: Record<string, WorkspaceTab> = {
                    appointments: 'appointments',
                    whatsapp: 'whatsapp',
                    surveys: 'surveys',
                    tasks: 'tasks',
                    tickets: 'tasks',
                    documents: 'documents',
                    invoices: 'billing',
                    consents: 'privacy',
                  };
                  const nextTab = tabMap[key];
                  if (nextTab) selectWorkspaceTab(nextTab);
                  const first = assoc?.items?.[0];
                  if (!first?.id) return;
                  const prefix: Record<string, string> = {
                    appointments: 'appt-',
                    whatsapp: 'wa-',
                    surveys: 'survey-',
                    tasks: 'task-',
                    tickets: 'ticket-',
                    documents: 'doc-',
                    invoices: 'inv-',
                    consents: 'consent-',
                  };
                  if (prefix[key]) openEvent(`${prefix[key]}${first.id}`);
                }}
              >
                <span className="flex items-center gap-2">
                  <span className="w-1 h-4 rounded-full bg-[#9CA3AF]" />
                  {label}
                </span>
                <span className="font-semibold text-[#3a342c]">{assoc?.count ?? 0}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {showForm && (
        <PatientForm
          initial={patient}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={displayName}
          busy={deleteBusy}
          onCancel={() => setDeleting(false)}
          onConfirm={remove}
        />
      )}

      {openEventId && id && (
        <TimelineInspector
          patientId={id}
          eventId={openEventId}
          eventTitle={titleFor(timeline.find((x: any) => x.id === openEventId) || { title: openEventId, kind: 'unknown' })}
          eventList={filteredTimeline}
          onClose={closeEvent}
          onOpenEvent={openEvent}
          onNavigateTab={(tabId) => selectWorkspaceTab(tabId as WorkspaceTab)}
          onEditPatient={() => setShowForm(true)}
          onChanged={load}
        />
      )}
    </div>
  );
}
