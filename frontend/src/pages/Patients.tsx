import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Patients() {
  const { t, locale } = useI18n();
  const [patients, setPatients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/patients?q=${encodeURIComponent(search)}&limit=200`)
      .then((d) => setPatients(d.patients))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [search, locale]);

  const fmtDate = (d: string) => d || '—';
  const fmtPhone = (p: string) => p ? `${p.slice(0, 4)} ${p.slice(4, 8)}-${p.slice(8)}` : '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('patients.title')}</h1>
          <p className="text-sm text-slate-500">MedX-style patient registry · LGPD Lei 13.709/2018</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="btn-secondary">
            ⬆ Bulk Import
          </button>
          <button onClick={() => setShowForm(true)} className="btn-primary">
            + {t('patients.new')}
          </button>
        </div>
      </div>

      <div className="card p-3 flex items-center gap-3">
        <input
          type="text"
          placeholder={`🔍 ${t('common.search')} por nome, CPF ou telefone...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-md"
        />
        <span className="text-xs text-slate-500 ml-auto">
          {patients.length} resultado(s) · Atalho: <kbd className="px-1 bg-slate-100 rounded">/</kbd>
        </span>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="table-th">ID</th>
                <th className="table-th">{t('patients.full_name')}</th>
                <th className="table-th">{t('patients.cpf')}</th>
                <th className="table-th">{t('patients.birth_date')}</th>
                <th className="table-th">{t('patients.phone')}</th>
                <th className="table-th">{t('patients.health_insurance')}</th>
                <th className="table-th">{t('patients.blood_type')}</th>
                <th className="table-th">Convênio #</th>
                <th className="table-th">LGPD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-xs">
              {loading && <tr><td colSpan={9} className="table-td text-center text-slate-400 py-6">{t('common.loading')}</td></tr>}
              {!loading && patients.length === 0 && <tr><td colSpan={9} className="table-td text-center text-slate-400 py-6">{t('common.no_data')}</td></tr>}
              {patients.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="table-td text-slate-400">{p.id.slice(0, 8)}</td>
                  <td className="table-td font-sans font-semibold">{p.full_name}</td>
                  <td className="table-td">{p.cpf || '—'}</td>
                  <td className="table-td">{fmtDate(p.birth_date)}</td>
                  <td className="table-td">{fmtPhone(p.phone)}</td>
                  <td className="table-td font-sans">{p.health_insurance || '—'}</td>
                  <td className="table-td font-sans">{p.blood_type || '—'}</td>
                  <td className="table-td">{p.health_insurance_number || '—'}</td>
                  <td className="table-td">
                    {p.lgpd_consent_at ? <span className="badge-green">✓</span> : <span className="badge-red">✗</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && <PatientForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); setSearch(''); }} />}
      {showImport && <BulkImport onClose={() => setShowImport(false)} onSaved={() => { setShowImport(false); setSearch(''); }} />}
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
          </div>
          <div className="border-t pt-4 bg-amber-50 -mx-6 px-6 -mb-6 pb-6 rounded-b-lg">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={form.lgpd_consent_granted}
                onChange={(e) => set('lgpd_consent_granted', e.target.checked)} required />
              <span className="text-sm text-slate-800">{t('patients.consent_checkbox')}</span>
            </label>
            <p className="text-xs text-slate-500 mt-1 pl-7">LGPD Lei 13.709/2018 — Política v{form.lgpd_policy_version}</p>
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

/**
 * Bulk Import — CSV upload + FHIR R4 JSON import
 * MedX-style: dense form, drag-drop, paste support, progress, error report
 */
function BulkImport({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'csv' | 'fhir'>('csv');
  const [csv, setCsv] = useState('');
  const [fhir, setFhir] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [policyVersion, setPolicyVersion] = useState('1.0');
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = async () => {
    const res = await fetch('/api/patients/bulk-template.csv', {
      headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'clinica-tanah-patients-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setCsv((e.target?.result as string) || '');
    reader.readAsText(f);
  };

  const submitCsv = async () => {
    if (!csv.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const r = await fetch('/api/patients/bulk-csv?policy_version=' + policyVersion, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
        body: csv,
      });
      const data = await r.json();
      setResult(data);
      if (data.inserted > 0) setTimeout(() => onSaved(), 1500);
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const submitFhir = async () => {
    if (!fhir.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const bundle = JSON.parse(fhir);
      const r = await api.post(`/api/patients/bulk-fhir?policy_version=${policyVersion}`, bundle);
      setResult(r);
      if (r.inserted > 0) setTimeout(() => onSaved(), 1500);
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Bulk Patient Import</h2>
              <p className="text-sm text-slate-500">CSV upload ou FHIR R4 Bundle (OpenEMR / MedX compat)</p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>

          <div className="flex gap-1 bg-slate-100 p-1 rounded w-fit">
            {(['csv', 'fhir'] as const).map((k) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-4 py-1.5 text-sm rounded ${tab === k ? 'bg-white shadow text-clinic-700' : 'text-slate-600'}`}>
                {k === 'csv' ? 'CSV Upload' : 'FHIR R4 (OpenEMR/MedX)'}
              </button>
            ))}
          </div>

          <div>
            <label className="label">LGPD Policy Version</label>
            <input className="input max-w-xs" value={policyVersion} onChange={(e) => setPolicyVersion(e.target.value)} />
          </div>

          {tab === 'csv' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="text-sm" />
                <button onClick={downloadTemplate} className="btn-secondary text-xs">⬇ Download template CSV</button>
                <span className="text-xs text-slate-500">
                  Colunas: full_name, social_name, birth_date, cpf, phone, email, address_*, health_insurance, blood_type, allergies, chronic_conditions
                </span>
              </div>
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder="Cole aqui o conteúdo CSV ou faça upload acima..."
                className="input font-mono text-xs h-48"
              />
              <button onClick={submitCsv} disabled={submitting || !csv.trim()} className="btn-primary">
                {submitting ? t('common.loading') : `⬆ Importar ${csv.split('\n').length - 1} linha(s)`}
              </button>
            </div>
          )}

          {tab === 'fhir' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Cole um FHIR R4 Bundle (<code className="bg-slate-100 px-1 rounded">resourceType: Bundle</code>) com recursos <code className="bg-slate-100 px-1 rounded">Patient</code>.
                Compatível com export do OpenEMR FHIR R4 e do MedX. Endpoint equivalente: <code className="bg-slate-100 px-1 rounded">POST /apis/default/fhir/Patient</code> convertido.
              </p>
              <textarea
                value={fhir}
                onChange={(e) => setFhir(e.target.value)}
                placeholder='{"resourceType":"Bundle","type":"transaction","entry":[{"resource":{"resourceType":"Patient","name":[{"family":"Silva","given":["Maria"]}],"telecom":[{"system":"phone","value":"+5511999999999"}],"birthDate":"1985-04-12"}}]}'
                className="input font-mono text-xs h-48"
              />
              <button onClick={submitFhir} disabled={submitting || !fhir.trim()} className="btn-primary">
                {submitting ? t('common.loading') : `⬆ Importar FHIR Bundle`}
              </button>
            </div>
          )}

          {result && (
            <div className={`p-4 rounded text-sm ${result.error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {result.error ? (
                <div>❌ {result.error}</div>
              ) : (
                <div>
                  <div className="font-bold mb-2">Importação concluída</div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div>Total: <b>{result.total_rows ?? result.total}</b></div>
                    <div className="text-emerald-700">Inseridos: <b>{result.inserted}</b></div>
                    <div className="text-rose-700">Falharam: <b>{result.failed}</b></div>
                  </div>
                  {result.errors?.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs">Ver erros ({result.errors.length})</summary>
                      <ul className="mt-2 text-xs space-y-1 max-h-32 overflow-y-auto">
                        {result.errors.map((e: string, i: number) => <li key={i} className="font-mono">• {e}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <button onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
