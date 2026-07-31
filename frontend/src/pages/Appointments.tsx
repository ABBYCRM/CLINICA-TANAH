import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';
import { CalendarView, AppointmentDrawer } from '../components/AppointmentCalendar';
import { PatientPicker, StaffPicker } from '../components/PatientPicker';

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'badge-green', completed: 'badge-green',
  cancelled: 'badge-red', no_show: 'badge-red',
};
const TYPES = ['consultation', 'return', 'exam', 'procedure', 'teleconsultation'];
const STATUSES = ['scheduled', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show'];

export default function Appointments() {
  const { t, locale } = useI18n();
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

  const refresh = () => setRefreshKey((k) => k + 1);

  const load = () => {
    setLoading(true);
    const from = new Date(Date.now() - 7*86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14*86400000).toISOString().slice(0, 10);
    api.get(`/api/appointments?from=${from}&to=${to}`)
      .then((d) => setAppointments(d.appointments))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale, refreshKey]);

  const changeStatus = async (id: string, status: string) => {
    await api.put(`/api/appointments/${id}`, { status });
    setSelected((s: any) => s && s.id === id ? { ...s, status } : s);
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
        <h1 className="text-2xl font-bold text-slate-900">{t('appointments.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
            {(['calendar', 'list'] as const).map((k) => (
              <button key={k} onClick={() => setView(k)}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${view === k ? 'bg-white shadow-sm text-clinic-700 font-medium' : 'text-slate-600 hover:text-slate-900'}`}
                data-testid={`view-${k}`}>
                {k === 'calendar' ? t('appointments.calendar') : t('appointments.list_view')}
              </button>
            ))}
          </div>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary" data-testid="new-appointment">
            + {t('appointments.new')}
          </button>
        </div>
      </div>

      {error && <FormError message={error} />}

      {view === 'calendar' && (
        <CalendarView onSelect={setSelected} refreshKey={refreshKey} />
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
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); setSelected(null); refresh(); }}
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

function AppointmentForm({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toLocal = (iso: string | undefined) => iso ? iso.slice(0, 16).replace(' ', 'T') : '';
  const [form, setForm] = useState(() => initial ? {
    patient_id: initial.patient_id, practitioner_id: initial.practitioner_id,
    scheduled_at: toLocal(initial.scheduled_at), duration_minutes: initial.duration_minutes,
    type: initial.type, status: initial.status, notes: initial.notes ?? '',
  } : {
    patient_id: '', practitioner_id: '', scheduled_at: '', duration_minutes: 30,
    type: 'consultation', status: 'scheduled', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const patientLabel = initial?.patient_name || '';
  const practitionerLabel = initial?.practitioner_name || '';

  // API-driven scheduler: free slots for the chosen practitioner + day,
  // from the same availability service the WhatsApp bot books through.
  const datePart = form.scheduled_at.slice(0, 10);
  const [slots, setSlots] = useState<{ scheduled_at: string; available: boolean }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  useEffect(() => {
    if (!form.practitioner_id || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) { setSlots([]); return; }
    setSlotsLoading(true);
    api.get(`/api/appointments/availability?practitioner_id=${form.practitioner_id}&date=${datePart}`)
      .then((d) => setSlots(Array.isArray(d?.slots) ? d.slots : []))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [form.practitioner_id, datePart]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const pickSlot = (slot: string) => set('scheduled_at', slot.slice(0, 16).replace(' ', 'T'));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.patient_id || !form.practitioner_id) {
      setError(t('picker.required_patient_staff'));
      return;
    }
    setSaving(true);
    const payload = { ...form, scheduled_at: form.scheduled_at.replace('T', ' ') + ':00', duration_minutes: Number(form.duration_minutes) };
    try {
      if (initial) await api.put(`/api/appointments/${initial.id}`, payload);
      else await api.post('/api/appointments', payload);
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? t('appointments.edit') : t('appointments.new')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <label className="label">{t('appointments.patient')} *</label>
          <PatientPicker
            value={form.patient_id}
            initialLabel={patientLabel}
            required
            hint={t('picker.patient_hint')}
            testId="appointment-patient"
            onChange={(id) => set('patient_id', id)}
          />
        </div>
        <div>
          <label className="label">{t('appointments.practitioner')} *</label>
          <StaffPicker
            value={form.practitioner_id}
            initialLabel={practitionerLabel}
            required
            onChange={(id) => set('practitioner_id', id)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="label">{t('appointments.scheduled_at')} *</label>
            <input type="datetime-local" className="input" value={form.scheduled_at} onChange={(e) => set('scheduled_at', e.target.value)} required data-testid="appointment-datetime" />
          </div>
          {form.practitioner_id && datePart && (
            <div className="col-span-2">
              <label className="label">{t('appointments.pick_slot')}</label>
              {slotsLoading && <div className="text-xs text-slate-400">{t('common.loading')}</div>}
              {!slotsLoading && slots.length > 0 && !slots.some((s) => s.available) && (
                <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{t('appointments.no_slots_that_day')}</div>
              )}
              {!slotsLoading && slots.length > 0 && (
                <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5" data-testid="slot-picker">
                  {slots.map((s) => {
                    const time = s.scheduled_at.slice(11, 16);
                    const chosen = form.scheduled_at === s.scheduled_at.slice(0, 16).replace(' ', 'T');
                    return (
                      <button
                        key={s.scheduled_at}
                        type="button"
                        disabled={!s.available}
                        onClick={() => pickSlot(s.scheduled_at)}
                        className={`rounded-md px-1 py-1.5 text-[11px] font-mono font-medium transition-all ${
                          chosen ? 'bg-clinic-600 text-white shadow-sm'
                          : s.available ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:shadow-sm'
                          : 'bg-slate-100 text-slate-300 line-through cursor-not-allowed'
                        }`}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="col-span-2 sm:col-span-1">
            <label className="label">{t('appointments.duration')}</label>
            <input type="number" min={5} max={480} step={5} className="input" value={form.duration_minutes}
              onChange={(e) => set('duration_minutes', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('appointments.type')}</label>
            <select className="input" value={form.type} onChange={(e) => set('type', e.target.value)}>
              {TYPES.map((ty) => <option key={ty} value={ty}>{t(`appointments.types.${ty}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('appointments.status')}</label>
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">{t('appointments.notes')}</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
