import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'badge-green', completed: 'badge-green',
  cancelled: 'badge-red', no_show: 'badge-red',
};
const TYPES = ['consultation', 'return', 'exam', 'procedure', 'teleconsultation'];
const STATUSES = ['scheduled', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show'];

export default function Appointments() {
  const { t, locale } = useI18n();
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    const from = new Date(Date.now() - 7*86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14*86400000).toISOString().slice(0, 10);
    api.get(`/api/appointments?from=${from}&to=${to}`)
      .then((d) => setAppointments(d.appointments))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/appointments/${deleting.id}`);
      setDeleting(null);
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('appointments.title')}</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary" data-testid="new-appointment">
          + {t('appointments.new')}
        </button>
      </div>

      {error && <FormError message={error} />}

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

      {showForm && (
        <AppointmentForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
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
  const [patients, setPatients] = useState<any[]>([]);
  const [practitioners, setPractitioners] = useState<any[]>([]);
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

  useEffect(() => {
    api.get('/api/patients?limit=200').then((d) => setPatients(d.patients)).catch(console.error);
    api.get('/api/users/directory')
      .then((d) => setPractitioners(d.users.filter((u: any) => ['doctor', 'nurse', 'admin'].includes(u.role))))
      .catch(console.error);
  }, []);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
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
          <select className="input" value={form.patient_id} onChange={(e) => set('patient_id', e.target.value)} required data-testid="appointment-patient">
            <option value="">—</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('appointments.practitioner')} *</label>
          <select className="input" value={form.practitioner_id} onChange={(e) => set('practitioner_id', e.target.value)} required>
            <option value="">—</option>
            {practitioners.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}{u.council_number ? ` (${u.council_number})` : ''}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="label">{t('appointments.scheduled_at')} *</label>
            <input type="datetime-local" className="input" value={form.scheduled_at} onChange={(e) => set('scheduled_at', e.target.value)} required />
          </div>
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
