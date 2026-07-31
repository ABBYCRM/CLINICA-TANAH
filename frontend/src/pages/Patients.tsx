import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

export default function Patients() {
  const { t, locale } = useI18n();
  const [patients, setPatients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get(`/api/patients?q=${encodeURIComponent(search)}&limit=100`)
      .then((d) => setPatients(d.patients))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [search, locale]);

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setError('');
    try {
      const res = await api.del(`/api/patients/${deleting.id}`);
      setDeleting(null);
      load();
      if (res.soft_deleted) setError(t('crud.deactivated_notice'));
    } catch (e: any) {
      setDeleting(null);
      setError(e.body?.error === 'has_clinical_records' ? t('crud.delete_error_clinical') : (e.message || t('errors.generic')));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('patients.title')}</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary" data-testid="new-patient">
          + {t('patients.new')}
        </button>
      </div>

      {error && <FormError message={error} />}

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
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td colSpan={7} className="table-td text-center text-slate-400 py-6">{t('common.loading')}</td></tr>
              )}
              {!loading && patients.length === 0 && (
                <tr><td colSpan={7} className="table-td text-center text-slate-400 py-6">{t('common.no_data')}</td></tr>
              )}
              {patients.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="table-td font-medium">{p.full_name}</td>
                  <td className="table-td font-mono text-xs">{p.cpf || '—'}</td>
                  <td className="table-td">{p.birth_date}</td>
                  <td className="table-td">{p.phone}</td>
                  <td className="table-td">{p.health_insurance || '—'}</td>
                  <td className="table-td">{p.blood_type || '—'}</td>
                  <td className="table-td">
                    <RowActions
                      editTestId={`edit-patient-${p.id}`}
                      deleteTestId={`delete-patient-${p.id}`}
                      onEdit={() => { setEditing(p); setShowForm(true); }}
                      onDelete={() => setDeleting(p)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <PatientForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={deleting.full_name}
          busy={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

const GENDERS = ['female', 'male', 'other'];
const MARITAL = ['single', 'married', 'divorced', 'widowed', 'stable_union'];
const RACES = ['branca', 'preta', 'parda', 'amarela', 'indigena', 'not_informed'];
const REFERRALS = ['indicacao', 'google', 'instagram', 'convenio', 'whatsapp', 'other'];

function PatientForm({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const parseArr = (v: any): string[] => {
    if (Array.isArray(v)) return v;
    try { return v ? JSON.parse(v) : []; } catch { return []; }
  };
  const blank = {
    full_name: '', social_name: '', birth_date: '', cpf: '', rg: '', rg_issuer: '', gender: '',
    marital_status: '', occupation: '', education_level: '', nationality: 'Brasileira', birthplace: '',
    mother_name: '', father_name: '', race_color: '', cns: '', referral_source: '', notes: '',
    phone: '', phone_secondary: '', email: '',
    address_zip: '', address_street: '', address_number: '', address_complement: '',
    address_neighborhood: '', address_city: 'São Paulo', address_state: 'SP',
    health_insurance: '', health_insurance_number: '', blood_type: '',
    emergency_contact_name: '', emergency_contact_phone: '',
    allergies: [] as string[], chronic_conditions: [] as string[], medications_in_use: [] as string[],
    lgpd_consent_granted: false, lgpd_policy_version: '1.0',
  };
  const [form, setForm] = useState<any>(() => {
    if (!initial) return blank;
    const fromApi: any = {};
    for (const k of Object.keys(blank)) {
      if (['allergies', 'chronic_conditions', 'medications_in_use'].includes(k)) fromApi[k] = parseArr(initial[k]);
      else if (k === 'lgpd_consent_granted') fromApi[k] = true;
      else if (k === 'lgpd_policy_version') fromApi[k] = initial.lgpd_consent_version ?? '1.0';
      else fromApi[k] = initial[k] ?? blank[k as keyof typeof blank];
    }
    return fromApi;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.lgpd_consent_granted) { setError(t('patients.lgpd_consent_required')); return; }
    setSaving(true);
    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])
    );
    try {
      if (initial) await api.put(`/api/patients/${initial.id}`, payload);
      else await api.post('/api/patients', payload);
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <fieldset className="rounded-xl border border-slate-200 p-4">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-clinic-700">{title}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </fieldset>
  );

  const F = ({ k, label, required, span, type, placeholder, maxLength, testId }: any) => (
    <div className={span ? 'sm:col-span-2' : ''}>
      <label className="label">{label}{required ? ' *' : ''}</label>
      <input type={type || 'text'} className="input" value={form[k]} required={required}
        placeholder={placeholder} maxLength={maxLength} data-testid={testId}
        onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  const Sel = ({ k, label, options, optionKey }: any) => (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={form[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">—</option>
        {options.map((o: string) => <option key={o} value={o}>{t(`${optionKey}.${o}`)}</option>)}
      </select>
    </div>
  );

  return (
    <Modal title={initial ? `${t('crud.edit')} — ${initial.full_name}` : t('patients.new')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />

        <Section title={t('patients.section_id')}>
          <F k="full_name" label={t('patients.full_name')} required span testId="patient-name" />
          <F k="social_name" label={t('patients.social_name')} />
          <F k="birth_date" label={t('patients.birth_date')} required type="date" />
          <F k="cpf" label={t('patients.cpf')} placeholder="12345678900" maxLength={11} />
          <F k="rg" label={t('patients.rg')} />
          <F k="rg_issuer" label={t('patients.rg_issuer')} placeholder="SSP-SP" />
          <Sel k="gender" label={t('patients.gender')} options={GENDERS} optionKey="patients.gender_options" />
          <F k="cns" label={t('patients.cns')} placeholder="123456789012345" maxLength={15} />
          <F k="mother_name" label={t('patients.mother_name')} />
          <F k="father_name" label={t('patients.father_name')} />
        </Section>

        <Section title={t('patients.section_contact')}>
          <F k="phone" label={t('patients.phone')} required placeholder="+5511999999999" />
          <F k="phone_secondary" label={t('patients.phone_secondary')} />
          <F k="email" label={t('patients.email')} type="email" />
          <Sel k="referral_source" label={t('patients.referral_source')} options={REFERRALS} optionKey="patients.referral_options" />
        </Section>

        <Section title={t('patients.section_address')}>
          <F k="address_zip" label="CEP" />
          <F k="address_street" label={t('patients.address_street')} />
          <F k="address_number" label={t('patients.address_number')} />
          <F k="address_complement" label={t('patients.address_complement') || 'Complemento'} />
          <F k="address_neighborhood" label={t('patients.address_neighborhood')} />
          <F k="address_city" label={t('patients.address_city')} />
          <F k="address_state" label="UF" maxLength={2} />
        </Section>

        <Section title={t('patients.section_social')}>
          <Sel k="marital_status" label={t('patients.marital_status')} options={MARITAL} optionKey="patients.marital_options" />
          <Sel k="race_color" label={t('patients.race_color')} options={RACES} optionKey="patients.race_options" />
          <F k="occupation" label={t('patients.occupation')} />
          <F k="education_level" label={t('patients.education_level')} />
          <F k="nationality" label={t('patients.nationality')} />
          <F k="birthplace" label={t('patients.birthplace')} />
        </Section>

        <Section title={t('patients.section_health')}>
          <F k="health_insurance" label={t('patients.health_insurance')} />
          <F k="health_insurance_number" label={t('patients.health_insurance_number') || 'Nº carteirinha'} />
          <div>
            <label className="label">{t('patients.blood_type')}</label>
            <select className="input" value={form.blood_type} onChange={(e) => set('blood_type', e.target.value)}>
              <option value="">—</option>
              <option>A+</option><option>A-</option><option>B+</option><option>B-</option>
              <option>AB+</option><option>AB-</option><option>O+</option><option>O-</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">{t('patients.allergies')}</label>
            <input className="input" placeholder="Penicilina, frutos do mar..." value={form.allergies.join(', ')}
              onChange={(e) => set('allergies', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">{t('patients.chronic_conditions')}</label>
            <input className="input" placeholder="Hipertensão, diabetes..." value={form.chronic_conditions.join(', ')}
              onChange={(e) => set('chronic_conditions', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">{t('patients.medications_in_use') || 'Medicamentos em uso'}</label>
            <input className="input" placeholder="Losartana 50mg, metformina..." value={form.medications_in_use.join(', ')}
              onChange={(e) => set('medications_in_use', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
          </div>
          <F k="emergency_contact_name" label={t('patients.emergency_name')} />
          <F k="emergency_contact_phone" label={t('patients.emergency_phone')} />
          <div className="sm:col-span-2">
            <label className="label">{t('patients.notes')}</label>
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </Section>

        {!initial && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={form.lgpd_consent_granted}
                onChange={(e) => set('lgpd_consent_granted', e.target.checked)} required />
              <span className="text-sm text-slate-800">{t('patients.consent_checkbox')}</span>
            </label>
            <p className="text-xs text-slate-500 mt-1 pl-7">
              LGPD Lei 13.709/2018 — Política v{form.lgpd_policy_version}
            </p>
          </div>
        )}

        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
