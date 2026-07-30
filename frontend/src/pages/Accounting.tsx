import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Accounting() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'tb' | 'pl'>('tb');
  const [tb, setTb] = useState<any[]>([]);
  const [pl, setPl] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.get('/api/accounting/trial-balance'), api.get('/api/accounting/income-statement')])
      .then(([a, b]) => { setTb(a.accounts); setPl(b); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [locale]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t('accounting.title')}</h1>
        <div className="flex gap-1 bg-slate-100 p-1 rounded">
          <button onClick={() => setTab('tb')} className={`px-3 py-1.5 text-sm rounded ${tab === 'tb' ? 'bg-white shadow text-clinic-700' : 'text-slate-600'}`}>{t('accounting.trial_balance')}</button>
          <button onClick={() => setTab('pl')} className={`px-3 py-1.5 text-sm rounded ${tab === 'pl' ? 'bg-white shadow text-clinic-700' : 'text-slate-600'}`}>{t('accounting.income_statement')}</button>
        </div>
      </div>

      {tab === 'tb' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-th">Conta</th>
                  <th className="table-th">{t('common.name')}</th>
                  <th className="table-th">{t('common.total') === 'Total' ? 'Tipo' : 'Type'}</th>
                  <th className="table-th text-right">{t('accounting.debit')}</th>
                  <th className="table-th text-right">{t('accounting.credit')}</th>
                  <th className="table-th text-right">{t('accounting.balance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
                {tb.map((row) => (
                  <tr key={row.code} className="hover:bg-slate-50">
                    <td className="table-td font-mono text-xs">{row.code}</td>
                    <td className="table-td">{row.name}</td>
                    <td className="table-td text-xs uppercase text-slate-500">{row.type}</td>
                    <td className="table-td text-right font-mono">{row.total_debit.toFixed(2)}</td>
                    <td className="table-td text-right font-mono">{row.total_credit.toFixed(2)}</td>
                    <td className={`table-td text-right font-mono font-semibold ${row.balance < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                      {row.balance.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'pl' && pl && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-5">
            <h3 className="font-semibold mb-3 text-emerald-700">{t('accounting.revenue')}</h3>
            {pl.lines.filter((r: any) => r.type === 'revenue').map((r: any) => (
              <div key={r.code} className="flex justify-between text-sm border-b border-slate-100 py-1">
                <span>{r.name}</span>
                <span className="font-mono">{r.amount.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold mt-3 pt-3 border-t-2 border-slate-300">
              <span>{t('accounting.revenue')}</span>
              <span>R$ {pl.total_revenue.toFixed(2)}</span>
            </div>
          </div>
          <div className="card p-5">
            <h3 className="font-semibold mb-3 text-rose-700">{t('accounting.expenses')}</h3>
            {pl.lines.filter((r: any) => r.type === 'expense').map((r: any) => (
              <div key={r.code} className="flex justify-between text-sm border-b border-slate-100 py-1">
                <span>{r.name}</span>
                <span className="font-mono">{r.amount.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold mt-3 pt-3 border-t-2 border-slate-300">
              <span>{t('accounting.expenses')}</span>
              <span>R$ {pl.total_expenses.toFixed(2)}</span>
            </div>
          </div>
          <div className="card p-5 col-span-2 bg-clinic-50 border-clinic-200">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-lg">{t('accounting.net_income')}</span>
              <span className={`font-mono font-bold text-2xl ${pl.net_income >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                R$ {pl.net_income.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
