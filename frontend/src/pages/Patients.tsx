import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Patients() {
  const { t, locale } = useI18n();
  const [patients, setPatients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/patients?q=${encodeURIComponent(search)}&limit=100`)
      .then((d) => setPatients(d.patients))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [search, locale]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t('patients.title')}</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ {t('patients.new')}</button>
      </div>

      <div className="card p-4">
        <input
          type="text"
          placeholder={t('common.search') + '...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-md"
        />
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('patients.full_name')}</th>
                <th className="table-th">{t('patients.cpf')}</th>
                <th className="table-th">{t('patients.birth_date')}</th>
                <th className="table-th">{t('patients.phone')}</th>
                <th className="table-th">{t('patients.health_insurance')}</th>
                <th className="table-th">{t('patients.blood_type')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td colSpan={6} className="table-td text-center text-slate-400 py-6">{t('common.loading')}</td></tr>
              )}
              {!loading && patients.length === 0 && (
                <tr><td colSpan={6} className="table-td text-center text-slate-400 py-6">{t('common.no_data')}</td></tr>
              )}
              {patients.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="table-td font-medium">{p.full_name}</td>
                  <td className="table-td font-mono text-xs">{p.cpf || '—'}</td>
                  <td className="table-td">{p.birth_date}</td>
                  <td className="table-td">{p.phone}</td>
                  <td className="table-td">{p.health_insurance || '—'}</td>
                  <td className="table-td">{p.blood_type || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && <PatientForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); setSearch(''); }} />}
    </div>
  );
}

function PatientForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    full_name: '', birth_date: '', cpf: '', phone: '', email: '',
    address_zip: '', address_street: '', address_number: '', address_neighborhood: '',
    address_city: 'São Paulo', address_state: 'SP',
    health_insurance: '', blood_type: '',
    allergies: [] as string[], chronic_conditions: [] as string[],
    lgpd_consent_granted: false, lgpd_policy_version: '1.0',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.lgpd_consent_granted) { setError(t('patients.lgpd_consent_required')); return; }
    setSaving(true);
    try {
      await api.post('/api/patients', form);
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">{t('patients.new')}</h2>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>

          {error && <div className="p-3 bg-rose-50 text-rose-700 rounded text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">{t('patients.full_name')} *</label>
              <input className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required />
            </div>
            <div>
              <label className="label">{t('patients.birth_date')} *</label>
              <input type="date" className="input" value={form.birth_date} onChange={(e) => set('birth_date', e.target.value)} required />
            </div>
            <div>
              <label className="label">{t('patients.cpf')}</label>
              <input className="input" placeholder="12345678900" maxLength={11} value={form.cpf} onChange={(e) => set('cpf', e.target.value.replace(/\D/g, ''))} />
            </div>
            <div>
              <label className="label">{t('patients.phone')} *</label>
              <input className="input" placeholder="+5511999999999" value={form.phone} onChange={(e) => set('phone', e.target.value)} required />
            </div>
            <div>
              <label className="label">{t('patients.email')}</label>
              <input type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('patients.health_insurance')}</label>
              <input className="input" value={form.health_insurance} onChange={(e) => set('health_insurance', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('patients.blood_type')}</label>
              <select className="input" value={form.blood_type} onChange={(e) => set('blood_type', e.target.value)}>
                <option value="">—</option>
                <option>A+</option><option>A-</option><option>B+</option><option>B-</option>
                <option>AB+</option><option>AB-</option><option>O+</option><option>O-</option>
              </select>
            </div>
            <div className="col-span-2 grid grid-cols-3 gap-4">
              <input className="input" placeholder="CEP" value={form.address_zip} onChange={(e) => set('address_zip', e.target.value)} />
              <input className="input col-span-2" placeholder={t('patients.address_street')} value={form.address_street} onChange={(e) => set('address_street', e.target.value)} />
              <input className="input" placeholder={t('patients.address_number')} value={form.address_number} onChange={(e) => set('address_number', e.target.value)} />
              <input className="input" placeholder={t('patients.address_neighborhood')} value={form.address_neighborhood} onChange={(e) => set('address_neighborhood', e.target.value)} />
              <input className="input" placeholder={t('patients.address_city')} value={form.address_city} onChange={(e) => set('address_city', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">{t('patients.allergies')}</label>
              <input className="input" placeholder="Penicilina, frutos do mar..." value={form.allergies.join(', ')}
                onChange={(e) => set('allergies', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
            </div>
            <div className="col-span-2">
              <label className="label">{t('patients.chronic_conditions')}</label>
              <input className="input" placeholder="Hipertensão, diabetes..." value={form.chronic_conditions.join(', ')}
                onChange={(e) => set('chronic_conditions', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
            </div>
          </div>

          <div className="border-t pt-4 bg-amber-50 -mx-6 px-6 -mb-6 pb-6 rounded-b-lg">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={form.lgpd_consent_granted}
                onChange={(e) => set('lgpd_consent_granted', e.target.checked)} required />
              <span className="text-sm text-slate-800">{t('patients.consent_checkbox')}</span>
            </label>
            <p className="text-xs text-slate-500 mt-1 pl-7">
              LGPD Lei 13.709/2018 — Política v{form.lgpd_policy_version}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
