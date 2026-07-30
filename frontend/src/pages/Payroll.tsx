import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Payroll() {
  const { t, locale } = useI18n();
  const [employees, setEmployees] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/api/payroll/employees'), api.get('/api/payroll/runs')])
      .then(([e, r]) => { setEmployees(e.employees); setRuns(r.runs); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [locale]);

  const runPayroll = async () => {
    try {
      await api.post('/api/payroll/run', { period });
      load();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{t('payroll.title')}</h1>

      <div className="card p-4 flex items-center gap-3">
        <label className="text-sm font-medium">{t('payroll.run_for_period')}:</label>
        <input type="month" className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <button onClick={runPayroll} className="btn-primary">⚡ {t('payroll.new_run')}</button>
      </div>

      <div className="card">
        <div className="px-5 py-3 border-b border-slate-200 font-semibold">{t('payroll.employees')} ({employees.length})</div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('payroll.full_name')}</th>
                <th className="table-th">{t('payroll.cpf')}</th>
                <th className="table-th">{t('payroll.role')}</th>
                <th className="table-th text-right">{t('payroll.base_salary')}</th>
                <th className="table-th text-right">{t('payroll.dependents')}</th>
                <th className="table-th">{t('payroll.admission_date')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {employees.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="table-td font-medium">{e.full_name}</td>
                  <td className="table-td font-mono text-xs">{e.cpf}</td>
                  <td className="table-td"><span className="badge-blue">{e.role}</span></td>
                  <td className="table-td text-right font-mono">R$ {e.base_salary.toFixed(2)}</td>
                  <td className="table-td text-right">{e.dependents}</td>
                  <td className="table-td">{e.admission_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {runs.length > 0 && (
        <div className="card">
          <div className="px-5 py-3 border-b border-slate-200 font-semibold">{t('payroll.title')} — {t('payroll.period')}</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-th">{t('payroll.period')}</th>
                  <th className="table-th text-right">{t('payroll.gross')}</th>
                  <th className="table-th text-right">{t('payroll.inss')}</th>
                  <th className="table-th text-right">{t('payroll.irrf')}</th>
                  <th className="table-th text-right">{t('payroll.fgts')}</th>
                  <th className="table-th text-right">{t('payroll.net')}</th>
                  <th className="table-th">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="table-td font-mono">{r.period}</td>
                    <td className="table-td text-right font-mono">R$ {r.total_gross.toFixed(2)}</td>
                    <td className="table-td text-right font-mono text-rose-600">R$ {r.total_inss.toFixed(2)}</td>
                    <td className="table-td text-right font-mono text-rose-600">R$ {r.total_irrf.toFixed(2)}</td>
                    <td className="table-td text-right font-mono text-amber-700">R$ {r.total_fgts.toFixed(2)}</td>
                    <td className="table-td text-right font-mono font-bold text-emerald-700">R$ {r.total_net.toFixed(2)}</td>
                    <td className="table-td"><span className={`badge ${r.status === 'paid' ? 'badge-green' : r.status === 'approved' ? 'badge-blue' : 'badge-yellow'}`}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
