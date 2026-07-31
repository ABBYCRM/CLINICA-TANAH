import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

export default function Vendors() {
  const { t, locale } = useI18n();
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/api/inventory/vendors')
      .then((d) => setVendors(d.vendors))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.del(`/api/inventory/vendors/${deleting.id}`);
      setDeleting(null);
      load();
      if (res.soft_deleted) setError(t('crud.deactivated_notice'));
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
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#243328]">{t('vendors.title')}</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary" data-testid="new-vendor">
          + {t('vendors.new')}
        </button>
      </div>

      {error && <FormError message={error} />}

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('vendors.legal_name')}</th>
                <th className="table-th">{t('vendors.trade_name')}</th>
                <th className="table-th">{t('vendors.cnpj')}</th>
                <th className="table-th">{t('vendors.phone')}</th>
                <th className="table-th">{t('vendors.contact_name')}</th>
                <th className="table-th">{t('vendors.anvisa_license')}</th>
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={7} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && vendors.length === 0 && <tr><td colSpan={7} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
              {vendors.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                  <td className="table-td font-medium">{v.legal_name}</td>
                  <td className="table-td">{v.trade_name || '—'}</td>
                  <td className="table-td font-mono text-xs">{v.cnpj}</td>
                  <td className="table-td">{v.phone || '—'}</td>
                  <td className="table-td">{v.contact_name || '—'}</td>
                  <td className="table-td">{v.anvisa_license ? <span className="badge-green">{v.anvisa_license}</span> : '—'}</td>
                  <td className="table-td">
                    <RowActions
                      onEdit={() => { setEditing(v); setShowForm(true); }}
                      onDelete={() => setDeleting(v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <VendorForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={deleting.legal_name}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function VendorForm({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => initial ? {
    legal_name: initial.legal_name ?? '', trade_name: initial.trade_name ?? '', cnpj: initial.cnpj ?? '',
    phone: initial.phone ?? '', email: initial.email ?? '', contact_name: initial.contact_name ?? '',
    anvisa_license: initial.anvisa_license ?? '',
  } : {
    legal_name: '', trade_name: '', cnpj: '', phone: '', email: '', contact_name: '', anvisa_license: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
    try {
      if (initial) await api.put(`/api/inventory/vendors/${initial.id}`, payload);
      else await api.post('/api/inventory/vendors', payload);
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? `${t('crud.edit')} — ${initial.legal_name}` : t('vendors.new')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <label className="label">{t('vendors.legal_name')} *</label>
          <input className="input" value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('vendors.trade_name')}</label>
            <input className="input" value={form.trade_name} onChange={(e) => set('trade_name', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('vendors.cnpj')} *</label>
            <input className="input" placeholder="12345678000190" maxLength={14} value={form.cnpj}
              onChange={(e) => set('cnpj', e.target.value.replace(/\D/g, ''))} required />
          </div>
          <div>
            <label className="label">{t('vendors.phone')}</label>
            <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('common.email')}</label>
            <input type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('vendors.contact_name')}</label>
            <input className="input" value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('vendors.anvisa_license')}</label>
            <input className="input" value={form.anvisa_license} onChange={(e) => set('anvisa_license', e.target.value)} />
          </div>
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
