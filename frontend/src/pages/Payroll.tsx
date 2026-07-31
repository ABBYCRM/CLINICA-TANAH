import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

export default function Payroll() {
  const { t, locale } = useI18n();
  const [employees, setEmployees] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'employee' | 'run'; row: any } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/api/payroll/employees'), api.get('/api/payroll/runs')])
      .then(([e, r]) => { setEmployees(e.employees); setRuns(r.runs); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [locale]);

  const runPayroll = async () => {
    setError('');
    try {
      await api.post('/api/payroll/run', { period });
      load();
    } catch (e: any) { setError(e.message || t('errors.generic')); }
  };

  const transition = async (id: string, action: 'approve' | 'pay') => {
    setError('');
    try {
      await api.put(`/api/payroll/runs/${id}/${action}`, {});
      load();
    } catch (e: any) { setError(e.message || t('errors.generic')); }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      const url = deleting.kind === 'employee' ? `/api/payroll/employees/${deleting.row.id}` : `/api/payroll/runs/${deleting.row.id}`;
      const res = await api.del(url);
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
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#243328]">{t('payroll.title')}</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary" data-testid="new-employee">
          + {t('payroll.new_employee')}
        </button>
      </div>

      {error && <FormError message={error} />}

      <div className="card p-4 flex flex-wrap items-center gap-3">
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
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={7} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && employees.length === 0 && <tr><td colSpan={7} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
              {employees.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                  <td className="table-td font-medium">{e.full_name}</td>
                  <td className="table-td font-mono text-xs">{e.cpf}</td>
                  <td className="table-td"><span className="badge-blue">{e.role}</span></td>
                  <td className="table-td text-right font-mono">R$ {e.base_salary.toFixed(2)}</td>
                  <td className="table-td text-right">{e.dependents}</td>
                  <td className="table-td">{e.admission_date}</td>
                  <td className="table-td">
                    <RowActions
                      onEdit={() => { setEditing(e); setShowForm(true); }}
                      onDelete={() => setDeleting({ kind: 'employee', row: e })}
                    />
                  </td>
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
                  <th className="table-th text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-td font-mono">{r.period}</td>
                    <td className="table-td text-right font-mono">R$ {r.total_gross.toFixed(2)}</td>
                    <td className="table-td text-right font-mono text-rose-600">R$ {r.total_inss.toFixed(2)}</td>
                    <td className="table-td text-right font-mono text-rose-600">R$ {r.total_irrf.toFixed(2)}</td>
                    <td className="table-td text-right font-mono text-amber-700">R$ {r.total_fgts.toFixed(2)}</td>
                    <td className="table-td text-right font-mono font-bold text-emerald-700">R$ {r.total_net.toFixed(2)}</td>
                    <td className="table-td"><span className={`badge ${r.status === 'paid' ? 'badge-green' : r.status === 'approved' ? 'badge-blue' : 'badge-yellow'}`}>{r.status}</span></td>
                    <td className="table-td">
                      <div className="flex items-center justify-end gap-1">
                        {r.status === 'draft' && (
                          <button onClick={() => transition(r.id, 'approve')} className="text-xs font-medium text-sky-700 hover:underline px-1.5">
                            ✓ {t('common.confirm')}
                          </button>
                        )}
                        {r.status === 'approved' && (
                          <button onClick={() => transition(r.id, 'pay')} className="text-xs font-medium text-emerald-700 hover:underline px-1.5">
                            💰 {t('invoices.mark_paid')}
                          </button>
                        )}
                        {r.status === 'draft' && (
                          <RowActions onDelete={() => setDeleting({ kind: 'run', row: r })} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <EmployeeForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={deleting.kind === 'employee' ? deleting.row.full_name : `${t('payroll.period')} ${deleting.row.period}`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function EmployeeForm({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => initial ? {
    full_name: initial.full_name ?? '', cpf: initial.cpf ?? '', role: initial.role ?? '',
    admission_date: initial.admission_date ?? '', base_salary: initial.base_salary ?? 0,
    weekly_hours: initial.weekly_hours ?? 44, dependents: initial.dependents ?? 0,
    health_insurance_discount: initial.health_insurance_discount ?? 0, other_discounts: initial.other_discounts ?? 0,
  } : {
    full_name: '', cpf: '', role: '', admission_date: new Date().toISOString().slice(0, 10), base_salary: 0,
    weekly_hours: 44, dependents: 0, health_insurance_discount: 0, other_discounts: 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const payload = {
      ...form,
      base_salary: Number(form.base_salary), weekly_hours: Number(form.weekly_hours),
      dependents: Number(form.dependents),
      health_insurance_discount: Number(form.health_insurance_discount),
      other_discounts: Number(form.other_discounts),
    };
    try {
      if (initial) await api.put(`/api/payroll/employees/${initial.id}`, payload);
      else await api.post('/api/payroll/employees', payload);
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? `${t('crud.edit')} — ${initial.full_name}` : t('payroll.new_employee')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <label className="label">{t('payroll.full_name')} *</label>
          <input className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('payroll.cpf')} *</label>
            <input className="input" maxLength={11} placeholder="12345678900" value={form.cpf}
              onChange={(e) => set('cpf', e.target.value.replace(/\D/g, ''))} required />
          </div>
          <div>
            <label className="label">{t('payroll.role')} *</label>
            <input className="input" placeholder="Recepcionista" value={form.role} onChange={(e) => set('role', e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('payroll.admission_date')} *</label>
            <input type="date" className="input" value={form.admission_date} onChange={(e) => set('admission_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('payroll.base_salary')} *</label>
            <input type="number" min={0} step={0.01} className="input" value={form.base_salary} onChange={(e) => set('base_salary', e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('payroll.weekly_hours')}</label>
            <input type="number" min={1} max={60} className="input" value={form.weekly_hours} onChange={(e) => set('weekly_hours', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('payroll.dependents')}</label>
            <input type="number" min={0} className="input" value={form.dependents} onChange={(e) => set('dependents', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('payroll.health_insurance_discount')}</label>
            <input type="number" min={0} step={0.01} className="input" value={form.health_insurance_discount} onChange={(e) => set('health_insurance_discount', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('payroll.other_discounts')}</label>
            <input type="number" min={0} step={0.01} className="input" value={form.other_discounts} onChange={(e) => set('other_discounts', e.target.value)} />
          </div>
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
