import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

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
  const [patients, setPatients] = useState<any[]>([]);
  const [practitioners, setPractitioners] = useState<any[]>([]);
  const toLocal = (iso: string | undefined) => iso ? iso.slice(0, 16).replace(' ', 'T') : new Date().toISOString().slice(0, 16);
  const [form, setForm] = useState(() => initial ? {
    patient_id: initial.patient_id, practitioner_id: initial.practitioner_id,
    started_at: toLocal(initial.started_at),
    subjective: initial.subjective ?? '', objective: initial.objective ?? '',
    assessment: initial.assessment ?? '', plan: initial.plan ?? '',
    icd10_codes: parseCodes(initial.icd10_codes).join(', '), notes: initial.notes ?? '',
  } : {
    patient_id: '', practitioner_id: '', started_at: toLocal(undefined),
    subjective: '', objective: '', assessment: '', plan: '', icd10_codes: '', notes: '',
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
    const payload = {
      ...form,
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
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">{t('appointments.patient')} *</label>
            <select className="input" value={form.patient_id} onChange={(e) => set('patient_id', e.target.value)} required disabled={!!initial}>
              <option value="">—</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('appointments.practitioner')} *</label>
            <select className="input" value={form.practitioner_id} onChange={(e) => set('practitioner_id', e.target.value)} required disabled={!!initial}>
              <option value="">—</option>
              {practitioners.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
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
