import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Invoices() {
  const { t, locale } = useI18n();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/accounting/invoices')
      .then((d) => setInvoices(d.invoices))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [locale]);

  const markPaid = async (id: string) => {
    await api.put(`/api/accounting/invoices/${id}/mark-paid`, {});
    setInvoices((arr) => arr.map((i) => i.id === id ? { ...i, status: 'paid' } : i));
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{t('invoices.title')}</h1>
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('invoices.number')}</th>
                <th className="table-th">{t('invoices.patient')}</th>
                <th className="table-th">{t('invoices.issue_date')}</th>
                <th className="table-th text-right">{t('common.total')}</th>
                <th className="table-th">{t('invoices.status')}</th>
                <th className="table-th">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {invoices.map((inv) => {
                const color = inv.status === 'paid' ? 'badge-green' : inv.status === 'overdue' ? 'badge-red' : 'badge-yellow';
                return (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="table-td font-mono text-xs">{inv.invoice_number}</td>
                    <td className="table-td">{inv.patient_name || '—'}</td>
                    <td className="table-td">{inv.issue_date}</td>
                    <td className="table-td text-right font-mono">R$ {inv.total.toFixed(2)}</td>
                    <td className="table-td"><span className={color}>{inv.status}</span></td>
                    <td className="table-td">
                      {inv.status !== 'paid' && (
                        <button onClick={() => markPaid(inv.id)} className="text-xs text-clinic-600 hover:underline">
                          ✓ {t('invoices.mark_paid')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
