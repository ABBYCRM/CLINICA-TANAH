import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { ConfirmDialog, FormError } from '../components/crud';
import { PatientForm } from '../components/PatientForm';

type FeedTab = 'activity' | 'appointments' | 'encounters' | 'notes' | 'whatsapp';

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
  if (kind === 'encounter') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4.5 12.5 8 9l3 3 3.5-3.5L18 12" /><path d="M3 21h18" /></svg>;
  }
  if (kind === 'prescription') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="m10.5 20.5-7-7a4.95 4.95 0 1 1 7-7l7 7a4.95 4.95 0 1 1-7 7z" /><path d="m7 10 7 7" /></svg>;
  }
  if (kind === 'invoice') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 2h9l5 5v15H6z" /><path d="M9 9h6M9 13h6" /></svg>;
  }
  if (kind === 'whatsapp') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" /></svg>;
  }
  if (kind === 'note') {
    return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>;
  }
  return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="9" /><path d="M12 8v4l2.5 2.5" /></svg>;
}

export default function PatientRecord() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedTab, setFeedTab] = useState<FeedTab>('activity');
  const [aboutOpen, setAboutOpen] = useState(true);
  const [assocOpen, setAssocOpen] = useState<Record<string, boolean>>({
    appointments: true, encounters: false, prescriptions: false, invoices: false, consents: false, whatsapp: false,
  });
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  const load = () => {
    if (!id) return;
    setLoading(true);
    setError('');
    api.get(`/api/patients/${id}/record`)
      .then(setData)
      .catch((e: any) => setError(e.message || t('errors.generic')))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id, locale]);

  const patient = data?.patient;
  const timeline = data?.timeline || [];
  const associations = data?.associations || {};
  const upcoming = data?.upcoming_appointments || [];

  const feedItems = useMemo(() => {
    if (feedTab === 'activity') return timeline;
    if (feedTab === 'appointments') return timeline.filter((x: any) => x.kind === 'appointment');
    if (feedTab === 'encounters') return timeline.filter((x: any) => x.kind === 'encounter' || x.kind === 'prescription');
    if (feedTab === 'notes') return timeline.filter((x: any) => x.kind === 'note');
    if (feedTab === 'whatsapp') return timeline.filter((x: any) => x.kind === 'whatsapp');
    return timeline;
  }, [timeline, feedTab]);

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const item of feedItems) {
      const key = monthKey(item.at, locale);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [feedItems, locale]);

  const prop = (label: string, value: React.ReactNode) => (
    <div className="crm-prop">
      <dt>{label}</dt>
      <dd>{value || <span className="text-slate-400">—</span>}</dd>
    </div>
  );

  const timelineTitle = (item: any) => {
    const map: Record<string, string> = {
      encounter: t('patients.timeline.encounter'),
      prescription: t('patients.timeline.prescription'),
      whatsapp_in: t('patients.timeline.whatsapp_in'),
      whatsapp_out: t('patients.timeline.whatsapp_out'),
      admin_note: t('patients.timeline.admin_note'),
      patient_created: t('patients.timeline.patient_created'),
    };
    if (item.kind === 'appointment') {
      return t('patients.timeline.appointment', { type: item.title || '' });
    }
    if (item.kind === 'invoice') {
      return t('patients.timeline.invoice', { number: item.title || '' });
    }
    return map[item.title] || map[item.kind] || item.title;
  };

  const remove = async () => {
    if (!patient) return;
    setDeleteBusy(true);
    try {
      await api.del(`/api/patients/${patient.id}`);
      navigate('/patients');
    } catch (e: any) {
      setError(e.body?.error === 'has_clinical_records' ? t('crud.delete_error_clinical') : (e.message || t('errors.generic')));
      setDeleting(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-slate-400" data-testid="patient-record-loading">{t('common.loading')}</div>;
  }

  if (!patient) {
    return (
      <div className="space-y-3" data-testid="patient-record-missing">
        <FormError message={error || t('errors.not_found')} />
        <Link to="/patients" className="text-clinic-700 hover:underline text-sm">{t('patients.back_to_list')}</Link>
      </div>
    );
  }

  const displayName = patient.social_name || patient.full_name;

  return (
    <div className="crm-record animate-fade-in" data-testid="patient-record">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <Link to="/patients" className="inline-flex items-center gap-1.5 text-sm text-clinic-700 hover:underline font-medium">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="m15 18-6-6 6-6" /></svg>
          {t('patients.back_to_list')}
        </Link>
        <div className="relative">
          <button type="button" className="btn-secondary !py-1.5" onClick={() => setActionsOpen((v) => !v)} data-testid="record-actions">
            {t('patients.actions')}
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {actionsOpen && (
            <>
              <button type="button" className="fixed inset-0 z-10" aria-label="close" onClick={() => setActionsOpen(false)} />
              <div className="absolute right-0 mt-1 z-20 w-48 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setShowForm(true); setActionsOpen(false); }}>
                  {t('common.edit')}
                </button>
                <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50" onClick={() => navigate('/appointments')}>
                  {t('patients.quick_schedule')}
                </button>
                <button type="button" className="w-full text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50" onClick={() => { setDeleting(true); setActionsOpen(false); }}>
                  {t('common.delete')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {error && <div className="mb-3"><FormError message={error} /></div>}

      <div className="crm-record-grid">
        {/* LEFT — profile & properties */}
        <aside className="crm-record-left space-y-4">
          <div className="card p-5">
            <div className="flex flex-col items-center text-center">
              <div className="crm-avatar-lg mb-3">{initials(displayName)}</div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight" data-testid="patient-record-name">{displayName}</h1>
              {patient.social_name && patient.social_name !== patient.full_name && (
                <p className="text-sm text-slate-500 mt-0.5">{patient.full_name}</p>
              )}
              {data.owner_name && (
                <p className="text-xs text-slate-500 mt-2">
                  {t('patients.col_owner')}: <span className="font-medium text-slate-700">{data.owner_name}</span>
                </p>
              )}
            </div>

            <div className="flex justify-center gap-2 mt-4">
              {patient.phone && (
                <a href={`tel:${patient.phone}`} className="crm-quick-btn" title={t('patients.phone')} aria-label={t('patients.phone')}>
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.74a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z" /></svg>
                </a>
              )}
              {patient.email && (
                <a href={`mailto:${patient.email}`} className="crm-quick-btn" title={t('patients.email')} aria-label={t('patients.email')}>
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 4h16v16H4z" /><path d="m22 6-10 7L2 6" /></svg>
                </a>
              )}
              {patient.phone && (
                <Link to="/whatsapp" className="crm-quick-btn" title="WhatsApp" aria-label="WhatsApp">
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" /></svg>
                </Link>
              )}
              <button type="button" className="crm-quick-btn" onClick={() => setShowForm(true)} title={t('common.edit')} aria-label={t('common.edit')}>
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </button>
              <button type="button" className="crm-quick-btn" onClick={() => navigate('/appointments')} title={t('patients.quick_schedule')} aria-label={t('patients.quick_schedule')}>
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
              </button>
            </div>
          </div>

          <div className="card overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              onClick={() => setAboutOpen((v) => !v)}
            >
              <span className="text-sm font-semibold text-slate-800">{t('patients.about')}</span>
              <svg viewBox="0 0 24 24" className={`w-4 h-4 text-slate-400 transition-transform ${aboutOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" /></svg>
            </button>
            {aboutOpen && (
              <dl className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                {prop(t('patients.email'), patient.email)}
                {prop(t('patients.phone'), patient.phone)}
                {prop(t('patients.phone_secondary'), patient.phone_secondary)}
                {prop(t('patients.cpf'), patient.cpf)}
                {prop(t('patients.birth_date'), fmtDate(patient.birth_date, locale))}
                {prop(t('patients.gender'), (() => {
                  if (!patient.gender) return null;
                  const key = `patients.gender_options.${patient.gender}`;
                  const label = t(key);
                  if (label !== key) return label;
                  const map: Record<string, string> = { female: 'F', male: 'M', F: 'F', M: 'M', other: 'other', O: 'other' };
                  const norm = map[patient.gender];
                  return norm ? t(`patients.gender_options.${norm}`) : patient.gender;
                })())}
                {prop(t('patients.health_insurance'), patient.health_insurance)}
                {prop(t('patients.health_insurance_number'), patient.health_insurance_number)}
                {prop(t('patients.blood_type'), patient.blood_type)}
                {prop(t('patients.col_owner'), data.owner_name || t('patients.unassigned'))}
                {prop(t('patients.created_at'), fmtDateTime(patient.created_at, locale))}
                {prop(t('patients.referral_source'), patient.referral_source ? (t(`patients.referral_options.${patient.referral_source}`) !== `patients.referral_options.${patient.referral_source}` ? t(`patients.referral_options.${patient.referral_source}`) : patient.referral_source) : null)}
                {(patient.allergies?.length > 0) && prop(t('patients.allergies'), patient.allergies.join(', '))}
                {(patient.chronic_conditions?.length > 0) && prop(t('patients.chronic_conditions'), patient.chronic_conditions.join(', '))}
                {(patient.medications_in_use?.length > 0) && prop(t('patients.medications_in_use'), patient.medications_in_use.join(', '))}
                {prop(t('patients.emergency_name'), patient.emergency_contact_name)}
                {prop(t('patients.emergency_phone'), patient.emergency_contact_phone)}
                {prop(t('patients.address_city'), [patient.address_street, patient.address_number, patient.address_neighborhood, patient.address_city, patient.address_state].filter(Boolean).join(', '))}
              </dl>
            )}
          </div>
        </aside>

        {/* CENTER — activity timeline */}
        <section className="crm-record-center min-w-0">
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-1 px-2 pt-2 border-b border-slate-200 overflow-x-auto">
              {(['activity', 'appointments', 'encounters', 'notes', 'whatsapp'] as FeedTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFeedTab(tab)}
                  className={`crm-feed-tab ${feedTab === tab ? 'is-active' : ''}`}
                  data-testid={`feed-tab-${tab}`}
                >
                  {t(`patients.feed.${tab}`)}
                </button>
              ))}
            </div>

            {upcoming.length > 0 && feedTab === 'activity' && (
              <div className="px-4 py-3 border-b border-slate-100 bg-clinic-50/40">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{t('patients.upcoming')}</div>
                <div className="space-y-2">
                  {upcoming.slice(0, 3).map((a: any) => (
                    <div key={a.id} className="flex items-start justify-between gap-3 rounded-lg bg-white border border-slate-200 px-3 py-2">
                      <div>
                        <div className="text-sm font-medium text-slate-800">{a.type} — {a.practitioner_name}</div>
                        <div className="text-xs text-slate-500">{fmtDateTime(a.scheduled_at, locale)}</div>
                      </div>
                      <span className="badge-blue shrink-0">{a.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="p-4 space-y-6 max-h-[70vh] overflow-y-auto">
              {grouped.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">{t('common.no_data')}</p>
              )}
              {grouped.map(([month, items]) => (
                <div key={month}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">{month}</div>
                  <div className="space-y-3">
                    {items.map((item: any) => (
                      <article key={item.id} className="crm-timeline-card">
                        <div className="flex items-start gap-3">
                          <span className="crm-timeline-icon" aria-hidden><KindIcon kind={item.kind} /></span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h3 className="text-sm font-semibold text-slate-800">{timelineTitle(item)}</h3>
                              <time className="text-xs text-slate-400 whitespace-nowrap">{fmtDateTime(item.at, locale)}</time>
                            </div>
                            {item.subtitle && <p className="text-sm text-slate-600 mt-0.5">{item.subtitle}</p>}
                            {item.status && <span className="inline-block mt-1.5 badge-slate">{item.status}</span>}
                            {item.meta?.assessment && (
                              <p className="text-xs text-slate-500 mt-1 line-clamp-2">{String(item.meta.assessment)}</p>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* RIGHT — associations */}
        <aside className="crm-record-right space-y-0 card overflow-hidden divide-y divide-slate-100">
          {([
            ['appointments', t('patients.assoc.appointments'), associations.appointments],
            ['encounters', t('patients.assoc.encounters'), associations.encounters],
            ['prescriptions', t('patients.assoc.prescriptions'), associations.prescriptions],
            ['invoices', t('patients.assoc.invoices'), associations.invoices],
            ['consents', t('patients.assoc.consents'), associations.consents],
            ['whatsapp', t('patients.assoc.whatsapp'), associations.whatsapp],
          ] as const).map(([key, label, block]) => {
            const count = block?.count ?? 0;
            const open = assocOpen[key];
            return (
              <div key={key}>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-50"
                  onClick={() => setAssocOpen((s) => ({ ...s, [key]: !s[key] }))}
                >
                  <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" /></svg>
                  <span className="text-sm font-medium text-slate-800 flex-1">{label}</span>
                  <span className="text-xs tabular-nums text-slate-500">({count})</span>
                  <span className="w-1 h-5 rounded-full bg-clinic-500/80" aria-hidden />
                </button>
                {open && (
                  <div className="px-4 pb-3 space-y-2">
                    {count === 0 && <p className="text-xs text-slate-400 pl-5">{t('common.no_data')}</p>}
                    {(block?.items || []).map((item: any) => (
                      <div key={item.id} className="pl-5 text-xs text-slate-600">
                        {key === 'appointments' && (
                          <div>
                            <div className="font-medium text-slate-800">{item.type} · {item.status}</div>
                            <div>{fmtDateTime(item.scheduled_at, locale)} — {item.practitioner_name}</div>
                          </div>
                        )}
                        {key === 'encounters' && (
                          <div>
                            <div className="font-medium text-slate-800">{item.practitioner_name}</div>
                            <div>{fmtDateTime(item.started_at, locale)}</div>
                          </div>
                        )}
                        {key === 'prescriptions' && (
                          <div>
                            <div className="font-medium text-slate-800">{item.practitioner_name || 'RX'}</div>
                            <div>{fmtDateTime(item.created_at, locale)}</div>
                          </div>
                        )}
                        {key === 'invoices' && (
                          <div>
                            <div className="font-medium text-slate-800">{item.invoice_number} · {item.status}</div>
                            <div>R$ {Number(item.total).toFixed(2)} — {fmtDate(item.issue_date, locale)}</div>
                          </div>
                        )}
                        {key === 'consents' && (
                          <div>
                            <div className="font-medium text-slate-800">{item.consent_type}</div>
                            <div>{item.granted ? '✓' : '✗'} {fmtDateTime(item.granted_at, locale)}</div>
                          </div>
                        )}
                        {key === 'whatsapp' && (
                          <div>
                            <div className="font-medium text-slate-800">{item.direction === 'in' ? '←' : '→'} {String(item.body || '').slice(0, 80)}</div>
                            <div>{fmtDateTime(item.created_at, locale)}</div>
                          </div>
                        )}
                      </div>
                    ))}
                    {key === 'appointments' && (
                      <Link to="/appointments" className="block pl-5 text-xs text-clinic-700 hover:underline font-medium pt-1">
                        {t('patients.quick_schedule')} →
                      </Link>
                    )}
                    {key === 'whatsapp' && (
                      <Link to="/whatsapp" className="block pl-5 text-xs text-clinic-700 hover:underline font-medium pt-1">
                        WhatsApp →
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
          name={patient.full_name}
          busy={deleteBusy}
          onCancel={() => setDeleting(false)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
