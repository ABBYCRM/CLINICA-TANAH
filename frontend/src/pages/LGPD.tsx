import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, FormError, FormActions } from '../components/crud';
import { PatientPicker } from '../components/PatientPicker';

export default function LGPD() {
  const { t, locale } = useI18n();
  const [consents, setConsents] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [policy, setPolicy] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/api/lgpd/consents'),
      api.get('/api/lgpd/data-requests'),
      api.get('/api/lgpd/policy'),
    ]).then(([c, r, p]) => {
      setConsents(c.consents);
      setRequests(r.requests);
      setPolicy(p);
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, [locale]);

  const fulfill = async (id: string) => {
    setError('');
    try {
      await api.put(`/api/lgpd/data-requests/${id}/fulfill`, {});
      load();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="page-title">{t('lgpd.title')}</h1>
        <button onClick={() => setShowRequestForm(true)} className="btn-primary" data-testid="new-lgpd-request">
          + {t('lgpd.new_request')}
        </button>
      </div>

      {error && <FormError message={error} />}

      {policy && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-5">
            <h3 className="font-semibold mb-3 text-clinic-700">{t('lgpd.dpo_name')}</h3>
            <div className="text-2xl font-bold">{policy.dpo.name}</div>
            <div className="text-sm text-slate-600 mt-1">{policy.dpo.email}</div>
            <div className="text-sm text-slate-600">{policy.dpo.phone}</div>
            <div className="mt-3 text-xs text-slate-500">{t('lgpd.policy_version')}: <span className="font-mono">{policy.version}</span> · {policy.effective_date}</div>
          </div>

          <div className="card p-5">
            <h3 className="font-semibold mb-3">{t('lgpd.retention_policy')}</h3>
            <ul className="text-sm space-y-2">
              {policy.data_categories.map((c: any, i: number) => (
                <li key={i} className="border-l-2 border-clinic-500 pl-3">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.examples.join(', ')}</div>
                  <div className="text-xs text-clinic-700">⏱ {c.retention}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="card">
        <div className="px-5 py-3 border-b border-slate-200 font-semibold">{t('lgpd.consent_records')} ({consents.length})</div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('common.date')}</th>
                <th className="table-th">Tipo</th>
                <th className="table-th">Sujeito</th>
                <th className="table-th">Tipo de consentimento</th>
                <th className="table-th">{t('common.status')}</th>
                <th className="table-th">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {consents.slice(0, 30).map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="table-td whitespace-nowrap text-xs">{c.granted_at}</td>
                  <td className="table-td">{c.subject_type}</td>
                  <td className="table-td font-mono text-xs">{c.subject_id.slice(0, 8)}</td>
                  <td className="table-td">{c.consent_type}</td>
                  <td className="table-td">
                    {c.revoked_at ? <span className="badge-red">Revoked</span> :
                      c.granted ? <span className="badge-green">✓ Active</span> :
                      <span className="badge-yellow">Denied</span>}
                  </td>
                  <td className="table-td font-mono text-xs">{c.ip_address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="px-5 py-3 border-b border-slate-200 font-semibold">{t('lgpd.data_requests')} ({requests.length})</div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('lgpd.request_type')}</th>
                <th className="table-th">{t('lgpd.subject')}</th>
                <th className="table-th">{t('common.name')}</th>
                <th className="table-th">{t('common.date')}</th>
                <th className="table-th">{t('common.status')}</th>
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.length === 0 && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
              {requests.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="table-td">{t(`lgpd.types.${r.request_type}`)}</td>
                  <td className="table-td font-mono text-xs">{r.subject_id.slice(0, 8)}</td>
                  <td className="table-td">{r.subject_name || '—'}</td>
                  <td className="table-td text-xs">{r.requested_at}</td>
                  <td className="table-td">
                    <span className={r.status === 'fulfilled' ? 'badge-green' : r.status === 'rejected' ? 'badge-red' : 'badge-yellow'}>
                      {r.status}
                    </span>
                  </td>
                  <td className="table-td text-right">
                    {r.status === 'open' && (
                      <button onClick={() => fulfill(r.id)} className="text-xs font-medium text-clinic-700 hover:underline">
                        ✓ {t('lgpd.fulfill')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {policy && (
        <div className="card p-5">
          <h3 className="font-semibold mb-3">⚖️ Bases Legais (LGPD art. 7º)</h3>
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            {policy.legal_bases.map((lb: any) => (
              <div key={lb.code} className="border-l-2 border-clinic-500 pl-3">
                <div className="font-mono text-xs text-slate-500">{lb.code}</div>
                <div className="font-semibold">{lb.name}</div>
                <div className="text-slate-600">{lb.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showRequestForm && (
        <DataRequestForm
          onClose={() => setShowRequestForm(false)}
          onSaved={() => { setShowRequestForm(false); load(); }}
        />
      )}
    </div>
  );
}

const REQUEST_TYPES = ['access', 'rectification', 'deletion', 'portability', 'opposition'];

function DataRequestForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ request_type: 'access', subject_id: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.subject_id) {
      setError(t('picker.required_patient'));
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/lgpd/data-requests', {
        request_type: form.request_type,
        subject_type: 'patient',
        subject_id: form.subject_id,
        notes: form.notes || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('lgpd.new_request')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <label className="label">{t('lgpd.request_type')} *</label>
          <select className="input" value={form.request_type} onChange={(e) => setForm((f) => ({ ...f, request_type: e.target.value }))}>
            {REQUEST_TYPES.map((ty) => <option key={ty} value={ty}>{t(`lgpd.types.${ty}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('lgpd.subject')} *</label>
          <PatientPicker
            value={form.subject_id}
            required
            hint={t('picker.patient_hint')}
            onChange={(id) => setForm((f) => ({ ...f, subject_id: id }))}
          />
        </div>
        <div>
          <label className="label">{t('appointments.notes')}</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
