import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

const START_HOUR = 8;
const END_HOUR = 18;

export const STATUS_COLORS: Record<string, string> = {
  scheduled: 'appt-block',
  confirmed: 'appt-block',
  arrived: 'appt-block',
  in_progress: 'appt-block',
  completed: 'appt-block opacity-70',
  cancelled: 'appt-block opacity-50 line-through',
  no_show: 'appt-block opacity-50',
};

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function weekStart(date: Date): Date {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function useLocaleTag(locale: string) {
  return locale === 'pt-BR' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US';
}

export function CalendarView({ onSelect, refreshKey }: {
  onSelect: (a: any) => void;
  refreshKey: number;
}) {
  const { t, locale } = useI18n();
  const tag = useLocaleTag(locale);
  const [anchor, setAnchor] = useState(() => new Date());
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mobileDay, setMobileDay] = useState(0); // index into the week

  const monday = useMemo(() => weekStart(anchor), [anchor]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  }), [monday]);
  const todayISO = toISO(new Date());

  useEffect(() => {
    setLoading(true);
    const from = toISO(days[0]);
    const to = toISO(days[6]);
    api.get(`/api/appointments?from=${from}&to=${to}`)
      .then((d) => setAppointments(d.appointments))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [monday, locale, refreshKey]);

  const bySlot = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const a of appointments) {
      const key = a.scheduled_at; // 'YYYY-MM-DD HH:MM:SS'
      (map[key] ||= []).push(a);
    }
    return map;
  }, [appointments]);

  const shift = (weeks: number) => {
    const d = new Date(anchor);
    d.setDate(d.getDate() + weeks * 7);
    setAnchor(d);
  };

  const hours = Array.from({ length: (END_HOUR - START_HOUR) * 2 }, (_, i) => START_HOUR + i / 2);
  const weekLabel = `${days[0].toLocaleDateString(tag, { day: 'numeric', month: 'short' })} — ${days[6].toLocaleDateString(tag, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const chip = (a: any, compact = false) => (
    <button
      key={a.id}
      onClick={() => onSelect(a)}
      data-testid={`appt-chip-${a.id}`}
      className={`${STATUS_COLORS[a.status] || 'appt-block'}`}
    >
      <div className="font-semibold truncate">{a.patient_name}</div>
      {!compact && <div className="truncate opacity-80">{a.practitioner_name}</div>}
      {!compact && <div className="opacity-70">{t(`appointments.types.${a.type}`)}</div>}
    </button>
  );

  return (
    <div className="card overflow-hidden" data-testid="calendar-view">
      {/* header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 transition-colors" aria-label="Previous week" data-testid="cal-prev">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button onClick={() => { setAnchor(new Date()); setMobileDay(0); }} className="btn-secondary text-xs px-2.5 py-1" data-testid="cal-today">
            {t('appointments.today')}
          </button>
          <button onClick={() => shift(1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 transition-colors" aria-label="Next week" data-testid="cal-next">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <div className="text-sm font-semibold text-slate-700 capitalize">{weekLabel}</div>
      </div>

      {/* week grid — desktop */}
      <div className="hidden md:block overflow-x-auto">
        <div className="grid min-w-[900px]" style={{ gridTemplateColumns: '64px repeat(7, 1fr)' }}>
          <div className="border-b border-slate-200 bg-slate-50" />
          {days.map((d) => {
            const iso = toISO(d);
            const isToday = iso === todayISO;
            return (
              <div key={iso} className={`border-b border-l border-slate-200 px-2 py-2 text-center ${isToday ? 'bg-clinic-50' : 'bg-slate-50'}`}>
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{d.toLocaleDateString(tag, { weekday: 'short' })}</div>
                <div className={`text-sm font-semibold ${isToday ? 'text-clinic-700' : 'text-slate-800'}`}>{d.getDate()}</div>
              </div>
            );
          })}
          {hours.map((h) => {
            const label = `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;
            return [
              <div key={`t-${h}`} className="border-b border-slate-100 px-1 py-1 text-right text-[10px] text-slate-400">{label}</div>,
              ...days.map((d) => {
                const iso = `${toISO(d)} ${label}:00`;
                const items = bySlot[iso] || [];
                return (
                  <div key={`${h}-${iso}`} className={`border-b border-l border-slate-100 p-0.5 min-h-[44px] ${toISO(d) === todayISO ? 'bg-clinic-50/40' : ''}`}>
                    {items.map((a) => chip(a))}
                  </div>
                );
              }),
            ];
          })}
        </div>
      </div>

      {/* agenda — mobile */}
      <div className="md:hidden">
        <div className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-slate-200">
          {days.map((d, i) => {
            const isToday = toISO(d) === todayISO;
            return (
              <button key={i} onClick={() => setMobileDay(i)}
                className={`flex-1 min-w-[44px] rounded-lg px-2 py-1.5 text-center transition-all ${mobileDay === i ? 'bg-clinic-600 text-white shadow-sm' : isToday ? 'bg-clinic-50 text-clinic-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                <div className="text-[10px] uppercase">{d.toLocaleDateString(tag, { weekday: 'short' })}</div>
                <div className="text-sm font-semibold">{d.getDate()}</div>
              </button>
            );
          })}
        </div>
        <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {loading && <div className="p-6 text-center text-slate-400 text-sm">{t('common.loading')}</div>}
          {!loading && (
            (() => {
              const dayISO = toISO(days[mobileDay]);
              const items = appointments
                .filter((a) => a.scheduled_at.startsWith(dayISO))
                .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
              if (!items.length) return <div className="p-6 text-center text-slate-400 text-sm">{t('common.no_data')}</div>;
              return items.map((a) => (
                <button key={a.id} onClick={() => onSelect(a)} data-testid={`agenda-item-${a.id}`}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900 text-sm">{a.patient_name}</span>
                    <span className={`badge ${STATUS_COLORS[a.status] ? '' : ''} ${a.status === 'confirmed' || a.status === 'completed' ? 'badge-green' : a.status === 'cancelled' || a.status === 'no_show' ? 'badge-red' : 'badge-yellow'}`}>{a.status}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {a.scheduled_at.slice(11, 16)} · {a.practitioner_name} · {t(`appointments.types.${a.type}`)}
                  </div>
                </button>
              ));
            })()
          )}
        </div>
      </div>

      {loading && <div className="hidden md:block p-6 text-center text-slate-400 text-sm">{t('common.loading')}</div>}
    </div>
  );
}

export function AppointmentDrawer({ appointment, onClose, onStatusChange, onEdit, onDelete }: {
  appointment: any;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const tag = useLocaleTag(locale);
  const [summary, setSummary] = useState<any>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    setSummary(null);
    api.get(`/api/patients/${appointment.patient_id}/summary`)
      .then(setSummary)
      .catch(console.error);
  }, [appointment.patient_id]);

  const transition = async (status: string) => {
    setBusy(status);
    try { await onStatusChange(appointment.id, status); } finally { setBusy(''); }
  };

  const p = summary?.patient;
  const age = p?.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 3.156e10) : null;

  const ActionBtn = ({ status, label, cls }: { status: string; label: string; cls: string }) => (
    <button onClick={() => transition(status)} disabled={!!busy}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 ${cls}`}>
      {busy === status ? '…' : label}
    </button>
  );

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#141c16]/45 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md panel-inset flex flex-col animate-slide-in-left !rounded-none border-l border-[rgba(63,92,66,0.28)]" data-testid="appointment-drawer" style={{ animationName: 'slide-in-right' }}>
        <style>{`@keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
        <div className="flex items-start justify-between border-b border-[rgba(63,92,66,0.16)] px-5 py-4">
          <div>
            <div className="font-display font-semibold text-slate-900 text-lg leading-tight">{appointment.patient_name}</div>
            <div className="text-sm text-slate-500">
              {new Date(appointment.scheduled_at.replace(' ', 'T')).toLocaleString(tag, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {' · '}{appointment.practitioner_name}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className={`badge ${appointment.status === 'confirmed' || appointment.status === 'completed' ? 'badge-green' : appointment.status === 'cancelled' || appointment.status === 'no_show' ? 'badge-red' : 'badge-yellow'}`}>{appointment.status}</span>
              <span className="badge-blue">{t(`appointments.types.${appointment.type}`)}</span>
              <span className="badge-slate">{appointment.source}</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-5 h-5"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* status workflow */}
          <div className="flex flex-wrap gap-2">
            {appointment.status === 'scheduled' && (
              <>
                <ActionBtn status="confirmed" label={`✓ ${t('appointments.confirm')}`} cls="bg-emerald-600 text-white hover:bg-emerald-700" />
                <ActionBtn status="cancelled" label={t('appointments.mark_cancelled')} cls="bg-rose-50 text-rose-700 hover:bg-rose-100" />
              </>
            )}
            {appointment.status === 'confirmed' && (
              <>
                <ActionBtn status="arrived" label={`🚶 ${t('appointments.mark_arrived')}`} cls="bg-violet-600 text-white hover:bg-violet-700" />
                <ActionBtn status="cancelled" label={t('appointments.mark_cancelled')} cls="bg-rose-50 text-rose-700 hover:bg-rose-100" />
              </>
            )}
            {(appointment.status === 'arrived' || appointment.status === 'in_progress') && (
              <ActionBtn status="completed" label={`✓ ${t('appointments.mark_completed')}`} cls="bg-emerald-600 text-white hover:bg-emerald-700" />
            )}
            <button onClick={onEdit} className="rounded-lg px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all">{t('crud.edit')}</button>
            <button onClick={onDelete} className="rounded-lg px-3 py-1.5 text-xs font-medium bg-rose-50 text-rose-700 hover:bg-rose-100 transition-all">{t('common.delete')}</button>
          </div>

          {appointment.notes && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">{appointment.notes}</div>
          )}

          {/* clinical snapshot — the educated-decision panel */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-clinic-700 mb-3">{t('appointments.patient_summary')}</h3>
            {!summary && <div className="text-sm text-slate-400">{t('common.loading')}</div>}
            {p && (
              <div className="space-y-4 animate-fade-in">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <div><span className="text-slate-400">{t('patients.birth_date')}:</span> {p.birth_date}{age !== null ? ` (${age})` : ''}</div>
                  <div><span className="text-slate-400">{t('patients.blood_type')}:</span> {p.blood_type || '—'}</div>
                  <div><span className="text-slate-400">{t('patients.health_insurance')}:</span> {p.health_insurance || '—'}</div>
                  <div><span className="text-slate-400">{t('patients.phone')}:</span> {p.phone}</div>
                </div>

                {p.allergies.length > 0 && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3" data-testid="drawer-allergies">
                    <div className="text-xs font-semibold text-rose-700 uppercase tracking-wide mb-1">⚠ {t('patients.allergies')}</div>
                    <div className="text-sm text-rose-800 font-medium">{p.allergies.join(', ')}</div>
                  </div>
                )}
                {p.chronic_conditions.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">{t('patients.chronic_conditions')}</div>
                    <div className="text-sm text-amber-900">{p.chronic_conditions.join(', ')}</div>
                  </div>
                )}
                {p.medications_in_use.length > 0 && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
                    <div className="text-xs font-semibold text-sky-700 uppercase tracking-wide mb-1">{t('patients.medications_in_use')}</div>
                    <div className="text-sm text-sky-900">{p.medications_in_use.join(', ')}</div>
                  </div>
                )}

                {summary.recent_encounters.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{t('appointments.recent_encounters')}</div>
                    <ul className="space-y-1.5 text-sm">
                      {summary.recent_encounters.map((e: any) => (
                        <li key={e.id} className="border-l-2 border-clinic-400 pl-3">
                          <span className="text-slate-400">{e.started_at?.slice(0, 10)}</span> — {e.assessment || '—'}
                          {e.icd10_codes.length > 0 && <span className="ml-1 badge-blue">{e.icd10_codes.join(', ')}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span>{t('appointments.prescriptions_count')}: <b>{summary.prescriptions_count}</b></span>
                  {p.emergency_contact_name && (
                    <span>{t('patients.emergency_contact_name')}: <b>{p.emergency_contact_name}</b> ({p.emergency_contact_phone})</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
