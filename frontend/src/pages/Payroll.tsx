import { useEffect, useMemo, useState } from 'react';
import { api, apiErrorKey } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

const RUN_TYPES = [
  { value: 'monthly', labelKey: 'payroll.type_monthly' },
  { value: '13th_first', labelKey: 'payroll.type_13th_first' },
  { value: '13th_second', labelKey: 'payroll.type_13th_second' },
  { value: 'vacation', labelKey: 'payroll.type_vacation' },
  { value: 'termination', labelKey: 'payroll.type_termination' },
] as const;

function money(n: number, locale: string) {
  return new Intl.NumberFormat(locale === 'pt-BR' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US', {
    style: 'currency', currency: 'BRL',
  }).format(Number(n) || 0);
}

function parseBreakdown(raw: any) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function Payroll() {
  const { t, locale } = useI18n();
  const [employees, setEmployees] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [runType, setRunType] = useState<string>('monthly');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'employee' | 'run'; row: any } | null>(null);
  const [busy, setBusy] = useState(false);
  const [runDetail, setRunDetail] = useState<{ run: any; payslips: any[] } | null>(null);
  const [selectedSlip, setSelectedSlip] = useState<any | null>(null);
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, any>>({});

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/api/payroll/employees'),
      api.get('/api/payroll/runs'),
      api.get('/api/payroll/meta').catch(() => null),
    ])
      .then(([e, r, m]) => {
        setEmployees(e.employees || []);
        setRuns(r.runs || []);
        if (m) setMeta(m);
      })
      .catch((e) => setError(t(apiErrorKey(e))))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [locale]);

  const runPayroll = async () => {
    setError('');
    try {
      const body: any = { period, type: runType };
      if (runType === 'monthly' || runType === 'vacation' || runType === 'termination') {
        const cleaned: Record<string, any> = {};
        for (const [id, ov] of Object.entries(overrides)) {
          const next: any = {};
          for (const [k, v] of Object.entries(ov || {})) {
            if (v === '' || v == null) continue;
            next[k] = Number(v);
          }
          if (Object.keys(next).length) cleaned[id] = next;
        }
        if (Object.keys(cleaned).length) body.overrides = cleaned;
      }
      const res = await api.post('/api/payroll/run', body);
      setOverridesOpen(false);
      load();
      const detail = await api.get(`/api/payroll/runs/${res.id}`);
      setRunDetail(detail);
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
    }
  };

  const openRun = async (id: string) => {
    setError('');
    try {
      const detail = await api.get(`/api/payroll/runs/${id}`);
      setRunDetail(detail);
      setSelectedSlip(null);
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
    }
  };

  const transition = async (id: string, action: 'approve' | 'pay') => {
    setError('');
    try {
      await api.put(`/api/payroll/runs/${id}/${action}`, {});
      load();
      if (runDetail?.run?.id === id) openRun(id);
    } catch (e: any) { setError(t(apiErrorKey(e))); }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      const url = deleting.kind === 'employee' ? `/api/payroll/employees/${deleting.row.id}` : `/api/payroll/runs/${deleting.row.id}`;
      const res = await api.del(url);
      setDeleting(null);
      if (runDetail?.run?.id === deleting.row.id) setRunDetail(null);
      load();
      if (res.soft_deleted) setError(t('crud.deactivated_notice'));
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  const typeLabel = (type: string) => {
    const found = RUN_TYPES.find((x) => x.value === type);
    return found ? t(found.labelKey) : type;
  };

  return (
    <div className="space-y-4" data-testid="payroll-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#243328]">{t('payroll.title')}</h1>
          <p className="text-sm text-[#5c6558] mt-0.5">
            {t('payroll.legal_banner', { year: meta?.year || 2026, wage: money(meta?.minimum_wage || 1621, locale) })}
          </p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary whitespace-nowrap shrink-0" data-testid="new-employee">
          + {t('payroll.new_employee')}
        </button>
      </div>

      {error && <FormError message={error} />}

      <div className="card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-3">
          <div className="min-w-0 sm:w-auto">
            <label className="label">{t('payroll.period')}</label>
            <input type="month" className="input w-full sm:w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div className="min-w-0 flex-1 sm:flex-none sm:min-w-[12rem]">
            <label className="label">{t('payroll.run_type')}</label>
            <select className="input w-full" value={runType} onChange={(e) => setRunType(e.target.value)} data-testid="run-type">
              {RUN_TYPES.map((rt) => (
                <option key={rt.value} value={rt.value}>{t(rt.labelKey)}</option>
              ))}
            </select>
          </div>
          <button type="button" className="btn-secondary w-full sm:w-auto justify-center" onClick={() => setOverridesOpen((v) => !v)}>
            {overridesOpen ? t('payroll.hide_inputs') : t('payroll.period_inputs')}
          </button>
          <button onClick={runPayroll} className="btn-primary w-full sm:w-auto justify-center" data-testid="run-payroll">{t('payroll.new_run')}</button>
        </div>
        {overridesOpen && (
          <div className="rounded-xl border border-[rgba(63,92,66,0.18)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">{t('payroll.employee')}</th>
                  {runType === 'monthly' && (
                    <>
                      <th className="table-th">HE 50% (h)</th>
                      <th className="table-th">HE 100% (h)</th>
                      <th className="table-th">{t('payroll.night_hours')}</th>
                      <th className="table-th">{t('payroll.absence_days')}</th>
                    </>
                  )}
                  {runType === 'vacation' && <th className="table-th">{t('payroll.vacation_days')}</th>}
                  {(runType === '13th_first' || runType === '13th_second' || runType === 'termination') && (
                    <th className="table-th">{t('payroll.months_13th')}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="table-td font-medium">{e.full_name}</td>
                    {runType === 'monthly' && (
                      <>
                        {(['overtime_50_hours', 'overtime_100_hours', 'night_hours', 'absence_days'] as const).map((k) => (
                          <td key={k} className="table-td">
                            <input
                              type="number" min={0} step={0.5} className="input py-1"
                              value={overrides[e.id]?.[k] ?? ''}
                              onChange={(ev) => setOverrides((o) => ({
                                ...o, [e.id]: { ...(o[e.id] || {}), [k]: ev.target.value },
                              }))}
                            />
                          </td>
                        ))}
                      </>
                    )}
                    {runType === 'vacation' && (
                      <td className="table-td">
                        <input type="number" min={1} max={30} className="input py-1"
                          value={overrides[e.id]?.vacation_days ?? 30}
                          onChange={(ev) => setOverrides((o) => ({
                            ...o, [e.id]: { ...(o[e.id] || {}), vacation_days: ev.target.value },
                          }))}
                        />
                      </td>
                    )}
                    {(runType === '13th_first' || runType === '13th_second' || runType === 'termination') && (
                      <td className="table-td">
                        <input type="number" min={0} max={12} className="input py-1"
                          value={overrides[e.id]?.months_13th ?? ''}
                          placeholder="auto"
                          onChange={(ev) => setOverrides((o) => ({
                            ...o, [e.id]: { ...(o[e.id] || {}), months_13th: ev.target.value },
                          }))}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="px-5 py-3 border-b border-slate-200 font-semibold">{t('payroll.employees')} ({employees.length})</div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-[rgba(63,92,66,0.1)]" data-testid="payroll-mobile-list">
          {loading && <div className="p-6 text-center text-slate-400">{t('common.loading')}</div>}
          {!loading && employees.length === 0 && <div className="p-6 text-center text-slate-400">{t('common.no_data')}</div>}
          {employees.map((e) => (
            <div key={e.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-[#243328] break-words">{e.full_name}</div>
                  <div className="text-xs font-mono text-[#5c6558]">{e.cpf}</div>
                </div>
                <span className="badge-blue shrink-0">{e.role}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-[#7a8476]">{t('payroll.base_salary')}</div>
                  <div className="font-mono font-semibold text-[#243328]">{money(e.base_salary, locale)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-[#7a8476]">{t('payroll.admission_date')}</div>
                  <div>{e.admission_date}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-[#7a8476]">{t('payroll.dependents')}</div>
                  <div>{e.dependents}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-[#7a8476]">{t('payroll.vt')}</div>
                  <div>{e.vale_transporte ? t('common.yes') : t('common.no')}</div>
                </div>
              </div>
              <div className="flex justify-end">
                <RowActions
                  onEdit={() => { setEditing(e); setShowForm(true); }}
                  onDelete={() => setDeleting({ kind: 'employee', row: e })}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('payroll.full_name')}</th>
                <th className="table-th">{t('payroll.cpf')}</th>
                <th className="table-th">{t('payroll.role')}</th>
                <th className="table-th text-right">{t('payroll.base_salary')}</th>
                <th className="table-th text-right">{t('payroll.dependents')}</th>
                <th className="table-th">{t('payroll.admission_date')}</th>
                <th className="table-th">{t('payroll.vt')}</th>
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={8} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && employees.length === 0 && <tr><td colSpan={8} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
              {employees.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                  <td className="table-td font-medium">{e.full_name}</td>
                  <td className="table-td font-mono text-xs">{e.cpf}</td>
                  <td className="table-td"><span className="badge-blue">{e.role}</span></td>
                  <td className="table-td text-right font-mono">{money(e.base_salary, locale)}</td>
                  <td className="table-td text-right">{e.dependents}</td>
                  <td className="table-td">{e.admission_date}</td>
                  <td className="table-td">{e.vale_transporte ? t('common.yes') : t('common.no')}</td>
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
          <div className="px-5 py-3 border-b border-slate-200 font-semibold">{t('payroll.runs')}</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-th">{t('payroll.period')}</th>
                  <th className="table-th">{t('payroll.run_type')}</th>
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
                    <td className="table-td font-mono">
                      <button type="button" className="text-[#3f5c42] font-semibold hover:underline" onClick={() => openRun(r.id)}>
                        {r.period}
                      </button>
                    </td>
                    <td className="table-td text-xs">{typeLabel(r.type)}</td>
                    <td className="table-td text-right font-mono">{money(r.total_gross, locale)}</td>
                    <td className="table-td text-right font-mono text-rose-700">{money(r.total_inss, locale)}</td>
                    <td className="table-td text-right font-mono text-rose-700">{money(r.total_irrf, locale)}</td>
                    <td className="table-td text-right font-mono text-amber-800">{money(r.total_fgts, locale)}</td>
                    <td className="table-td text-right font-mono font-bold text-emerald-800">{money(r.total_net, locale)}</td>
                    <td className="table-td">
                      <span className={`badge ${r.status === 'paid' ? 'badge-green' : r.status === 'approved' ? 'badge-blue' : 'badge-yellow'}`}>{r.status}</span>
                    </td>
                    <td className="table-td">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openRun(r.id)} className="text-xs font-medium text-[#3f5c42] hover:underline px-1.5">
                          {t('payroll.view_payslips')}
                        </button>
                        {r.status === 'draft' && (
                          <button onClick={() => transition(r.id, 'approve')} className="text-xs font-medium text-sky-800 hover:underline px-1.5">
                            {t('payroll.approve')}
                          </button>
                        )}
                        {r.status === 'approved' && (
                          <button onClick={() => transition(r.id, 'pay')} className="text-xs font-medium text-emerald-800 hover:underline px-1.5">
                            {t('payroll.pay')}
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

      {runDetail && (
        <Modal
          wide
          title={`${t('payroll.holerites')} — ${runDetail.run.period} (${typeLabel(runDetail.run.type)})`}
          onClose={() => { setRunDetail(null); setSelectedSlip(null); }}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
              <div><div className="text-xs text-[#7a8476] uppercase">{t('payroll.gross')}</div><div className="font-mono font-semibold">{money(runDetail.run.total_gross, locale)}</div></div>
              <div><div className="text-xs text-[#7a8476] uppercase">{t('payroll.inss')}</div><div className="font-mono">{money(runDetail.run.total_inss, locale)}</div></div>
              <div><div className="text-xs text-[#7a8476] uppercase">{t('payroll.irrf')}</div><div className="font-mono">{money(runDetail.run.total_irrf, locale)}</div></div>
              <div><div className="text-xs text-[#7a8476] uppercase">{t('payroll.fgts')}</div><div className="font-mono">{money(runDetail.run.total_fgts, locale)}</div></div>
              <div><div className="text-xs text-[#7a8476] uppercase">{t('payroll.net')}</div><div className="font-mono font-bold">{money(runDetail.run.total_net, locale)}</div></div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-[rgba(63,92,66,0.16)]">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-th">{t('payroll.employee')}</th>
                    <th className="table-th">{t('payroll.cpf')}</th>
                    <th className="table-th text-right">{t('payroll.gross')}</th>
                    <th className="table-th text-right">{t('payroll.inss')}</th>
                    <th className="table-th text-right">{t('payroll.irrf')}</th>
                    <th className="table-th text-right">{t('payroll.fgts')}</th>
                    <th className="table-th text-right">{t('payroll.net')}</th>
                  </tr>
                </thead>
                <tbody>
                  {runDetail.payslips.map((ps) => (
                    <tr key={ps.id} className="hover:bg-[rgba(63,92,66,0.04)] cursor-pointer" onClick={() => setSelectedSlip(ps)}>
                      <td className="table-td font-medium text-[#3f5c42]">{ps.employee_name}</td>
                      <td className="table-td font-mono text-xs">{ps.cpf}</td>
                      <td className="table-td text-right font-mono">{money(ps.gross_earnings, locale)}</td>
                      <td className="table-td text-right font-mono">{money(ps.inss_deduction, locale)}</td>
                      <td className="table-td text-right font-mono">{money(ps.irrf_deduction, locale)}</td>
                      <td className="table-td text-right font-mono">{money(ps.fgts_deposit, locale)}</td>
                      <td className="table-td text-right font-mono font-semibold">{money(ps.net_pay, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedSlip && (
              <PayslipView slip={selectedSlip} locale={locale} t={t} onClose={() => setSelectedSlip(null)} />
            )}
          </div>
        </Modal>
      )}

      {showForm && (
        <EmployeeForm
          initial={editing}
          minimumWage={meta?.minimum_wage || 1621}
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

function PayslipView({ slip, locale, t, onClose }: { slip: any; locale: string; t: (k: string, p?: any) => string; onClose: () => void }) {
  const breakdown = useMemo(() => parseBreakdown(slip.json_breakdown), [slip]);
  const lines = breakdown?.lines || [];
  return (
    <div className="rounded-xl border border-[rgba(63,92,66,0.2)] p-4 space-y-3" data-testid="payslip-detail" style={{ background: 'linear-gradient(180deg,#f8fbf5,#eef3ea)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-[#243328]">{t('payroll.holerite')} — {slip.employee_name}</h3>
          <p className="text-xs text-[#5c6558] font-mono mt-0.5">CPF {slip.cpf} · {slip.role}</p>
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={onClose}>{t('common.back')}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="table-th">{t('payroll.line_code')}</th>
              <th className="table-th">{t('payroll.line_desc')}</th>
              <th className="table-th text-right">{t('payroll.line_amount')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l: any, i: number) => (
              <tr key={`${l.code}-${i}`}>
                <td className="table-td font-mono text-xs">{l.code}</td>
                <td className="table-td">
                  {l.description}
                  {l.reference ? <span className="text-xs text-[#7a8476] ml-1">({l.reference})</span> : null}
                </td>
                <td className={`table-td text-right font-mono ${l.type === 'deduction' ? 'text-rose-700' : l.type === 'info' ? 'text-[#5c6558]' : 'text-emerald-800'}`}>
                  {money(l.amount, locale)}
                </td>
              </tr>
            ))}
            {!lines.length && (
              <tr><td colSpan={3} className="table-td text-center text-[#7a8476]">{t('common.no_data')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {breakdown?.legal && (
        <p className="text-[11px] text-[#7a8476]">
          {t('payroll.legal_footer', {
            year: breakdown.legal.year,
            wage: money(breakdown.legal.minimum_wage, locale),
            ceiling: money(breakdown.legal.inss_ceiling, locale),
          })}
        </p>
      )}
    </div>
  );
}

function isValidCpf(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
  let r = (sum * 10) % 11; if (r === 10) r = 0;
  if (r !== Number(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
  r = (sum * 10) % 11; if (r === 10) r = 0;
  return r === Number(d[10]);
}

function EmployeeForm({ initial, minimumWage, onClose, onSaved }: {
  initial: any | null; minimumWage: number; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => initial ? {
    full_name: initial.full_name ?? '', cpf: initial.cpf ?? '', role: initial.role ?? '',
    admission_date: initial.admission_date ?? '', base_salary: initial.base_salary ?? minimumWage,
    weekly_hours: initial.weekly_hours ?? 44, dependents: initial.dependents ?? 0,
    health_insurance_discount: initial.health_insurance_discount ?? 0, other_discounts: initial.other_discounts ?? 0,
    pis: initial.pis ?? '', ctps_number: initial.ctps_number ?? '', ctps_series: initial.ctps_series ?? '',
    vale_transporte: !!initial.vale_transporte, vt_monthly_cost: initial.vt_monthly_cost ?? 0,
    night_shift: !!initial.night_shift, cbo_code: initial.cbo_code ?? '',
    esocial_category: initial.esocial_category ?? '101', contract_type: initial.contract_type ?? 'clt',
    registration_number: initial.registration_number ?? '',
    bank_bank: initial.bank_account ? (typeof initial.bank_account === 'string' ? JSON.parse(initial.bank_account) : initial.bank_account)?.bank ?? '' : '',
    bank_agency: initial.bank_account ? (typeof initial.bank_account === 'string' ? JSON.parse(initial.bank_account) : initial.bank_account)?.agency ?? '' : '',
    bank_account_number: initial.bank_account ? (typeof initial.bank_account === 'string' ? JSON.parse(initial.bank_account) : initial.bank_account)?.account ?? '' : '',
  } : {
    full_name: '', cpf: '', role: '', admission_date: new Date().toISOString().slice(0, 10),
    base_salary: minimumWage, weekly_hours: 44, dependents: 0, health_insurance_discount: 0, other_discounts: 0,
    pis: '', ctps_number: '', ctps_series: '', vale_transporte: false, vt_monthly_cost: 0, night_shift: false,
    cbo_code: '', esocial_category: '101', contract_type: 'clt', registration_number: '',
    bank_bank: '', bank_agency: '', bank_account_number: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isValidCpf(form.cpf)) { setError(t('errors.invalid_cpf')); return; }
    if (Number(form.base_salary) < minimumWage) {
      setError(t('payroll.below_minimum_wage'));
      return;
    }
    setSaving(true);
    const payload: any = {
      full_name: form.full_name,
      cpf: form.cpf,
      role: form.role,
      admission_date: form.admission_date,
      base_salary: Number(form.base_salary),
      weekly_hours: Number(form.weekly_hours),
      dependents: Number(form.dependents),
      health_insurance_discount: Number(form.health_insurance_discount),
      other_discounts: Number(form.other_discounts),
      pis: form.pis || null,
      ctps_number: form.ctps_number || null,
      ctps_series: form.ctps_series || null,
      vale_transporte: !!form.vale_transporte,
      vt_monthly_cost: Number(form.vt_monthly_cost) || 0,
      night_shift: !!form.night_shift,
      cbo_code: form.cbo_code || null,
      esocial_category: form.esocial_category || '101',
      contract_type: form.contract_type || 'clt',
      registration_number: form.registration_number || null,
      bank_account: (form.bank_bank || form.bank_agency || form.bank_account_number)
        ? { bank: form.bank_bank, agency: form.bank_agency, account: form.bank_account_number }
        : null,
    };
    try {
      if (initial) await api.put(`/api/payroll/employees/${initial.id}`, payload);
      else await api.post('/api/payroll/employees', payload);
      onSaved();
    } catch (err: any) {
      setError(t(apiErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? `${t('crud.edit')} — ${initial.full_name}` : t('payroll.new_employee')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <p className="text-xs text-[#5c6558]">{t('payroll.employee_legal_hint')}</p>
        <div>
          <label className="label">{t('payroll.full_name')} *</label>
          <input className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">{t('payroll.cpf')} *</label>
            <input className="input" maxLength={11} value={form.cpf}
              onChange={(e) => set('cpf', e.target.value.replace(/\D/g, ''))} required disabled={!!initial} />
          </div>
          <div>
            <label className="label">{t('payroll.role')} *</label>
            <input className="input" value={form.role} onChange={(e) => set('role', e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('payroll.admission_date')} *</label>
            <input type="date" className="input" value={form.admission_date} onChange={(e) => set('admission_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('payroll.base_salary')} * (≥ {minimumWage.toFixed(2)})</label>
            <input type="number" min={minimumWage} step={0.01} className="input" value={form.base_salary}
              onChange={(e) => set('base_salary', e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('payroll.weekly_hours')}</label>
            <input type="number" min={1} max={44} className="input" value={form.weekly_hours} onChange={(e) => set('weekly_hours', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('payroll.dependents')}</label>
            <input type="number" min={0} className="input" value={form.dependents} onChange={(e) => set('dependents', e.target.value)} />
          </div>
          <div>
            <label className="label">PIS/PASEP</label>
            <input className="input" value={form.pis} onChange={(e) => set('pis', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('payroll.registration')}</label>
            <input className="input" value={form.registration_number} onChange={(e) => set('registration_number', e.target.value)} />
          </div>
          <div>
            <label className="label">CTPS</label>
            <input className="input" value={form.ctps_number} onChange={(e) => set('ctps_number', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('payroll.ctps_series')}</label>
            <input className="input" value={form.ctps_series} onChange={(e) => set('ctps_series', e.target.value)} />
          </div>
          <div>
            <label className="label">CBO</label>
            <input className="input" value={form.cbo_code} onChange={(e) => set('cbo_code', e.target.value)} placeholder="2235-05" />
          </div>
          <div>
            <label className="label">{t('payroll.esocial_category')}</label>
            <input className="input" value={form.esocial_category} onChange={(e) => set('esocial_category', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('payroll.health_insurance_discount')}</label>
            <input type="number" min={0} step={0.01} className="input" value={form.health_insurance_discount}
              onChange={(e) => set('health_insurance_discount', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('payroll.other_discounts')}</label>
            <input type="number" min={0} step={0.01} className="input" value={form.other_discounts}
              onChange={(e) => set('other_discounts', e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex flex-col sm:flex-row flex-wrap gap-4 items-stretch sm:items-center">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.vale_transporte} onChange={(e) => set('vale_transporte', e.target.checked)} />
              {t('payroll.vt')}
            </label>
            <div className="flex-1 min-w-0 sm:min-w-[10rem]">
              <label className="label">{t('payroll.vt_cost')}</label>
              <input type="number" min={0} step={0.01} className="input" value={form.vt_monthly_cost}
                onChange={(e) => set('vt_monthly_cost', e.target.value)} disabled={!form.vale_transporte} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.night_shift} onChange={(e) => set('night_shift', e.target.checked)} />
              {t('payroll.night_shift')}
            </label>
          </div>
          <div>
            <label className="label">{t('payroll.bank')}</label>
            <input className="input" value={form.bank_bank} onChange={(e) => set('bank_bank', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('payroll.agency')}</label>
            <input className="input" value={form.bank_agency} onChange={(e) => set('bank_agency', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">{t('payroll.account')}</label>
            <input className="input" value={form.bank_account_number} onChange={(e) => set('bank_account_number', e.target.value)} />
          </div>
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
