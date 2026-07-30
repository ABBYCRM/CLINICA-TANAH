import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Vendors() {
  const { t, locale } = useI18n();
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/inventory/vendors')
      .then((d) => setVendors(d.vendors))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [locale]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{t('vendors.title')}</h1>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {vendors.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="table-td font-medium">{v.legal_name}</td>
                  <td className="table-td">{v.trade_name || '—'}</td>
                  <td className="table-td font-mono text-xs">{v.cnpj}</td>
                  <td className="table-td">{v.phone || '—'}</td>
                  <td className="table-td">{v.contact_name || '—'}</td>
                  <td className="table-td">{v.anvisa_license ? <span className="badge-green">{v.anvisa_license}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
