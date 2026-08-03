import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { ConfirmDialog, FormError, RowActions } from '../components/crud';
import { CalendarView, AppointmentDrawer } from '../components/AppointmentCalendar';
import AppointmentForm from '../components/AppointmentForm';

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'badge-green', completed: 'badge-green',
  cancelled: 'badge-red', no_show: 'badge-red',
};

export default function Appointments() {
  const { t, locale } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<'list' | 'calendar'>('calendar');
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [prefillPatient, setPrefillPatient] = useState<{ id: string; label: string } | null>(null);
  const [calendarDate, setCalendarDate] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const load = () => {
    setLoading(true);
    const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    api.get(`/api/appointments?from=${from}&to=${to}`)
      .then((d) => setAppointments(d.appointments))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale, refreshKey]);

  // Deep links from patient workspace: ?patient_id=&new=1&date=&focus=
  useEffect(() => {
    const patientId = searchParams.get('patient_id');
    const date = searchParams.get('date');
    const focus = searchParams.get('focus');
    const wantNew = searchParams.get('new') === '1';

    if (date) setCalendarDate(date);
    if (focus) setFocusId(focus);

    if (patientId) {
      api.get(`/api/patients/${patientId}`)
        .then((d) => {
          const p = d.patient || d;
          setPrefillPatient({ id: patientId, label: p.social_name || p.full_name || patientId });
          if (wantNew) {
            setEditing(null);
            setShowForm(true);
          }
        })
        .catch(() => {
          setPrefillPatient({ id: patientId, label: patientId });
          if (wantNew) {
            setEditing(null);
            setShowForm(true);
          }
        });
    } else if (wantNew) {
      setEditing(null);
      setShowForm(true);
    }

    if (patientId || date || focus || wantNew) {
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      // keep patient_id/date/focus briefly for calendar; clear new only
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After appointments load, focus a specific appointment in the drawer
  useEffect(() => {
    if (!focusId || !appointments.length) return;
    const hit = appointments.find((a) => a.id === focusId);
    if (hit) {
      setSelected(hit);
      setFocusId(null);
      return;
    }
    // May be outside ±7/14 list window — fetch single
    api.get(`/api/appointments/${focusId}`)
      .then((d) => {
        if (d.appointment) {
          setSelected(d.appointment);
          if (d.appointment.scheduled_at) {
            setCalendarDate(String(d.appointment.scheduled_at).slice(0, 10));
          }
        }
      })
      .catch(() => {})
      .finally(() => setFocusId(null));
  }, [focusId, appointments]);

  const changeStatus = async (id: string, status: string) => {
    await api.put(`/api/appointments/${id}`, { status });
    setSelected((s: any) => (s && s.id === id ? { ...s, status } : s));
    refresh();
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/appointments/${deleting.id}`);
      setDeleting(null);
      setSelected(null);
      refresh();
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
        <h1 className="page-title">{t('appointments.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg-track" data-testid="appointments-view-toggle">
            {(['calendar', 'list'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setView(k)}
                className={`seg-item !py-1.5 ${view === k ? 'is-active' : ''}`}
                data-testid={`view-${k}`}
              >
                {k === 'calendar' ? t('appointments.calendar') : t('appointments.list_view')}
              </button>
            ))}
          </div>
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="btn-primary"
            data-testid="new-appointment"
          >
            + {t('appointments.new')}
          </button>
        </div>
      </div>

      {error && <FormError message={error} />}

      {view === 'calendar' && (
        <CalendarView
          onSelect={setSelected}
          refreshKey={refreshKey}
          initialDate={calendarDate}
          focusAppointmentId={selected?.id || focusId}
        />
      )}

      {view === 'list' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-th">{t('appointments.scheduled_at')}</th>
                  <th className="table-th">{t('appointments.patient')}</th>
                  <th className="table-th">{t('appointments.practitioner')}</th>
                  <th className="table-th">{t('appointments.type')}</th>
                  <th className="table-th">{t('appointments.source')}</th>
                  <th className="table-th">{t('appointments.status')}</th>
                  <th className="table-th text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && <tr><td colSpan={7} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
                {!loading && appointments.length === 0 && <tr><td colSpan={7} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
                {appointments.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-td whitespace-nowrap">{a.scheduled_at}</td>
                    <td className="table-td">{a.patient_name}</td>
                    <td className="table-td">{a.practitioner_name}</td>
                    <td className="table-td">{t(`appointments.types.${a.type}`)}</td>
                    <td className="table-td"><span className="badge-blue">{a.source}</span></td>
                    <td className="table-td"><span className={STATUS_COLORS[a.status] || 'badge-yellow'}>{a.status}</span></td>
                    <td className="table-td">
                      <RowActions
                        onEdit={() => { setEditing(a); setShowForm(true); }}
                        onDelete={() => setDeleting(a)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <AppointmentForm
          initial={editing || (prefillPatient && !editing ? {
            patient_id: prefillPatient.id,
            patient_name: prefillPatient.label,
            practitioner_id: '',
            scheduled_at: calendarDate ? `${calendarDate}T09:00` : '',
            duration_minutes: 30,
            type: 'consultation',
            status: 'scheduled',
            notes: '',
          } : null)}
          lockedPatientId={!editing && prefillPatient ? prefillPatient.id : undefined}
          lockedPatientLabel={!editing && prefillPatient ? prefillPatient.label : undefined}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={(res) => {
            setShowForm(false);
            setEditing(null);
            setSelected(null);
            if (res.scheduled_at) setCalendarDate(res.scheduled_at.slice(0, 10));
            setFocusId(res.id);
            refresh();
          }}
        />
      )}
      {selected && !showForm && (
        <AppointmentDrawer
          appointment={selected}
          onClose={() => setSelected(null)}
          onStatusChange={changeStatus}
          onEdit={() => { setEditing(selected); setShowForm(true); }}
          onDelete={() => setDeleting(selected)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={`${deleting.patient_name} — ${deleting.scheduled_at}`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
