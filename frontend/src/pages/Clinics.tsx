import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { useAuth } from '../hooks/useAuth';
import { Modal, FormError, FormActions } from '../components/crud';

interface Tenant {
  id: string;
  slug: string;
  name: string;
  cnpj?: string;
  address?: string;
  phone?: string;
  active: number;
  staff_count?: number;
  patient_count?: number;
}

const emptyForm = {
  name: '', slug: '', cnpj: '', address: '', phone: '',
  admin_email: '', admin_name: '', admin_password: '',
};

export default function Clinics() {
  const { t } = useI18n();
  const { user, setEffectiveTenantId, effectiveTenantId } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/api/tenants')
      .then((d) => setTenants(d.tenants))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (!user?.is_superadmin) {
    return <div className="text-slate-500">{t('clinics.superadmin_only')}</div>;
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/tenants', {
        ...form,
        cnpj: form.cnpj || null,
        address: form.address || null,
        phone: form.phone || null,
      });
      setShowForm(false);
      setForm(emptyForm);
      load();
    } catch (err: any) {
      setError(err.body?.error || err.message || t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#3a342c]">{t('clinics.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('clinics.subtitle')}</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary" data-testid="new-clinic">
          + {t('clinics.new')}
        </button>
      </div>

      {error && <FormError message={error} />}

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('common.name')}</th>
                <th className="table-th">{t('clinics.slug')}</th>
                <th className="table-th">{t('clinics.staff')}</th>
                <th className="table-th">{t('clinics.patients')}</th>
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={5} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && tenants.map((tn) => (
                <tr key={tn.id} className={effectiveTenantId === tn.id ? 'bg-clinic-50' : undefined}>
                  <td className="table-td font-medium">{tn.name}</td>
                  <td className="table-td text-slate-500">{tn.slug}</td>
                  <td className="table-td">{tn.staff_count ?? '—'}</td>
                  <td className="table-td">{tn.patient_count ?? '—'}</td>
                  <td className="table-td text-right">
                    <button
                      className="btn-secondary text-xs"
                      data-testid={`switch-tenant-${tn.slug}`}
                      onClick={() => setEffectiveTenantId(tn.id === user.tenant_id ? null : tn.id)}
                    >
                      {effectiveTenantId === tn.id || (!effectiveTenantId && tn.id === user.tenant_id)
                        ? t('clinics.viewing')
                        : t('clinics.switch')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
      <Modal onClose={() => setShowForm(false)} title={t('clinics.new')}>
        <form onSubmit={create} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">{t('common.name')}</span>
              <input className="input mt-1" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">{t('clinics.slug')}</span>
              <input
                className="input mt-1"
                required
                // Chrome pattern uses the Unicode `v` flag — escape `-` to avoid
                // "Invalid character class" console errors on the Clinics form.
                pattern="[a-z0-9\-]+"
                title="somente minúsculas, números e hífen"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">CNPJ</span>
              <input className="input mt-1" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">{t('common.phone')}</span>
              <input className="input mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-slate-600">{t('common.address')}</span>
              <input className="input mt-1" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <p className="text-sm font-medium text-slate-700 mb-2">{t('clinics.admin_section')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-slate-600">{t('team.full_name')}</span>
                <input className="input mt-1" required value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">{t('common.email')}</span>
                <input type="email" className="input mt-1" required value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="text-slate-600">{t('auth.password')}</span>
                <input type="password" className="input mt-1" required minLength={8} value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} />
              </label>
            </div>
          </div>
          <FormActions onCancel={() => setShowForm(false)} saving={busy} />
        </form>
      </Modal>
      )}
    </div>
  );
}
