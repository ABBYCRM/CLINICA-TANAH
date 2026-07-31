import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';
import { PatientPicker, StaffPicker } from '../components/PatientPicker';

function parseCodes(v: any): string[] {
  if (Array.isArray(v)) return v;
  try { return v ? JSON.parse(v) : []; } catch { return []; }
}

export default function Encounters() {
  const { t, locale } = useI18n();
  const [encounters, setEncounters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/api/clinical/encounters')
      .then((d) => setEncounters(d.encounters))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/clinical/encounters/${deleting.id}`);
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
        <h1 className="text-2xl font-bold text-slate-900">{t('encounters.title')}</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary" data-testid="new-encounter">
          + {t('encounters.new')}
        </button>
      </div>

      {error && <FormError message={error} />}

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('common.date')}</th>
                <th className="table-th">{t('appointments.patient')}</th>
                <th className="table-th">{t('appointments.practitioner')}</th>
                <th className="table-th">{t('encounters.assessment')}</th>
                <th className="table-th">{t('encounters.icd10')}</th>
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && encounters.length === 0 && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
              {encounters.map((e) => {
                const codes = parseCodes(e.icd10_codes);
                return (
                  <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-td whitespace-nowrap">{e.started_at}</td>
                    <td className="table-td">{e.patient_name}</td>
                    <td className="table-td">{e.practitioner_name}</td>
                    <td className="table-td max-w-xs truncate">{e.assessment || '—'}</td>
                    <td className="table-td">{codes.length ? <span className="badge-blue">{codes.join(', ')}</span> : '—'}</td>
                    <td className="table-td">
                      <RowActions
                        onEdit={() => { setEditing(e); setShowForm(true); }}
                        onDelete={() => setDeleting(e)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <EncounterForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={`${deleting.patient_name} — ${deleting.started_at}`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function EncounterForm({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toLocal = (iso: string | undefined) => iso ? iso.slice(0, 16).replace(' ', 'T') : new Date().toISOString().slice(0, 16);
  const [form, setForm] = useState(() => initial ? {
    patient_id: initial.patient_id, practitioner_id: initial.practitioner_id,
    appointment_id: initial.appointment_id ?? '',
    started_at: toLocal(initial.started_at),
    subjective: initial.subjective ?? '', objective: initial.objective ?? '',
    assessment: initial.assessment ?? '', plan: initial.plan ?? '',
    icd10_codes: parseCodes(initial.icd10_codes).join(', '), notes: initial.notes ?? '',
  } : {
    patient_id: '', practitioner_id: '', appointment_id: '',
    started_at: toLocal(undefined),
    subjective: '', objective: '', assessment: '', plan: '', icd10_codes: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [todayAppts, setTodayAppts] = useState<any[]>([]);
  const [patientLabel, setPatientLabel] = useState(initial?.patient_name || '');
  const [practitionerLabel, setPractitionerLabel] = useState(initial?.practitioner_name || '');

  useEffect(() => {
    if (initial) return;
    const today = new Date().toISOString().slice(0, 10);
    api.get(`/api/appointments?from=${today}&to=${today}`)
      .then((d) => {
        const rows = (d.appointments || []).filter((a: any) =>
          !['cancelled', 'no_show', 'completed'].includes(a.status),
        );
        setTodayAppts(rows);
      })
      .catch(console.error);
  }, [initial]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const pickToday = (a: any) => {
    setForm((f) => ({
      ...f,
      patient_id: a.patient_id,
      practitioner_id: a.practitioner_id,
      appointment_id: a.id,
      started_at: toLocal(a.scheduled_at),
    }));
    setPatientLabel(a.patient_name);
    setPractitionerLabel(a.practitioner_name);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.patient_id || !form.practitioner_id) {
      setError(t('picker.required_patient_staff'));
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      appointment_id: form.appointment_id || null,
      started_at: form.started_at.replace('T', ' ') + ':00',
      icd10_codes: form.icd10_codes.split(',').map((s: string) => s.trim()).filter(Boolean),
    };
    try {
      if (initial) await api.put(`/api/clinical/encounters/${initial.id}`, payload);
      else await api.post('/api/clinical/encounters', payload);
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? t('encounters.edit') : t('encounters.new')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4" data-testid="encounter-form">
        <FormError message={error} />

        {!initial && todayAppts.length > 0 && (
          <div className="rounded-xl border border-clinic-100 bg-clinic-50/60 p-3 space-y-2" data-testid="today-appointments">
            <div className="text-xs font-semibold uppercase tracking-wide text-clinic-800">
              {t('encounters.from_today')}
            </div>
            <p className="text-xs text-clinic-700/80">{t('encounters.from_today_hint')}</p>
            <div className="flex flex-wrap gap-2">
              {todayAppts.slice(0, 8).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pickToday(a)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left text-sm transition-all ${
                    form.appointment_id === a.id
                      ? 'border-clinic-500 bg-white text-clinic-900 shadow-sm ring-1 ring-clinic-200'
                      : 'border-clinic-100 bg-white/80 text-slate-700 hover:border-clinic-300'
                  }`}
                  data-testid={`today-appt-${a.id}`}
                >
                  <span className="font-medium">{a.patient_name}</span>
                  <span className="text-xs text-slate-500 ml-2">
                    {String(a.scheduled_at).slice(11, 16)} · {a.practitioner_name?.split(' ').slice(0, 2).join(' ')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">{t('appointments.patient')} *</label>
            <PatientPicker
              value={form.patient_id}
              initialLabel={patientLabel}
              disabled={!!initial}
              required
              hint={t('picker.patient_hint')}
              onChange={(id, p) => {
                set('patient_id', id);
                setPatientLabel(p?.full_name || '');
                if (!initial) set('appointment_id', '');
              }}
            />
          </div>
          <div>
            <label className="label">{t('appointments.practitioner')} *</label>
            <StaffPicker
              value={form.practitioner_id}
              initialLabel={practitionerLabel}
              disabled={!!initial}
              required
              onChange={(id, u) => {
                set('practitioner_id', id);
                setPractitionerLabel(u?.full_name || '');
              }}
            />
          </div>
          <div>
            <label className="label">{t('encounters.started_at')} *</label>
            <input type="datetime-local" className="input" value={form.started_at} onChange={(e) => set('started_at', e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('encounters.icd10')}</label>
            <input className="input" placeholder={t('encounters.icd10_hint')} value={form.icd10_codes} onChange={(e) => set('icd10_codes', e.target.value)} />
          </div>
        </div>
        {(['subjective', 'objective', 'assessment', 'plan'] as const).map((k) => (
          <div key={k}>
            <label className="label">{t(`encounters.${k}`)}</label>
            <textarea className="input" rows={2} value={(form as any)[k]} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
        <div>
          <label className="label">{t('encounters.notes')}</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
