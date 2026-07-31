import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

type Tab = 'tb' | 'pl' | 'accounts' | 'journal';
const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

export default function Accounting() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>('tb');
  const [tb, setTb] = useState<any[]>([]);
  const [pl, setPl] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [accountForm, setAccountForm] = useState<{ open: boolean; initial: any | null }>({ open: false, initial: null });
  const [entryOpen, setEntryOpen] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/api/accounting/trial-balance'),
      api.get('/api/accounting/income-statement'),
      api.get('/api/accounting/chart'),
      api.get('/api/accounting/journal'),
    ]).then(([a, b, c, j]) => {
      setTb(a.accounts); setPl(b); setAccounts(c.accounts); setEntries(j.entries);
    }).catch(console.error).finally(() => setLoading(false));
  }, [locale, refreshKey]);

  const removeAccount = async () => {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.del(`/api/accounting/chart/${deleting.id}`);
      setDeleting(null);
      refresh();
      if (res.soft_deleted) setError(t('crud.deactivated_notice'));
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (k: Tab, label: string) => (
    <button onClick={() => setTab(k)}
      className={`px-3 py-1.5 text-sm rounded-md transition-all ${tab === k ? 'bg-white shadow-sm text-clinic-700 font-medium' : 'text-slate-600 hover:text-slate-900'}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('accounting.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
            {tabBtn('tb', t('accounting.trial_balance'))}
            {tabBtn('pl', t('accounting.income_statement'))}
            {tabBtn('accounts', t('accounting.accounts'))}
            {tabBtn('journal', t('accounting.journal'))}
          </div>
          {tab === 'accounts' && (
            <button onClick={() => setAccountForm({ open: true, initial: null })} className="btn-primary" data-testid="new-account">+ {t('accounting.new_account')}</button>
          )}
          {tab === 'journal' && (
            <button onClick={() => setEntryOpen(true)} className="btn-primary" data-testid="new-entry">+ {t('accounting.new_entry')}</button>
          )}
        </div>
      </div>

      {error && <FormError message={error} />}

      {tab === 'tb' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-th">{t('accounting.code')}</th>
                  <th className="table-th">{t('common.name')}</th>
                  <th className="table-th">{t('accounting.type')}</th>
                  <th className="table-th text-right">{t('accounting.debit')}</th>
                  <th className="table-th text-right">{t('accounting.credit')}</th>
                  <th className="table-th text-right">{t('accounting.balance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
                {tb.map((row) => (
                  <tr key={row.code} className="hover:bg-slate-50 transition-colors">
                    <td className="table-td font-mono text-xs">{row.code}</td>
                    <td className="table-td">{row.name}</td>
                    <td className="table-td text-xs uppercase text-slate-500">{t(`accounting.types.${row.type}`)}</td>
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

      {tab === 'accounts' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-th">{t('accounting.code')}</th>
                  <th className="table-th">{t('common.name')}</th>
                  <th className="table-th">{t('accounting.type')}</th>
                  <th className="table-th">{t('common.status')}</th>
                  <th className="table-th text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && <tr><td colSpan={5} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
                {accounts.map((a) => (
                  <tr key={a.id} className={`hover:bg-slate-50 transition-colors ${a.active ? '' : 'opacity-50'}`}>
                    <td className="table-td font-mono text-xs">{a.code}</td>
                    <td className="table-td">{a.name}</td>
                    <td className="table-td text-xs uppercase text-slate-500">{t(`accounting.types.${a.type}`)}</td>
                    <td className="table-td">{a.active ? <span className="badge-green">✓</span> : <span className="badge-slate">—</span>}</td>
                    <td className="table-td">
                      <RowActions
                        onEdit={() => setAccountForm({ open: true, initial: a })}
                        onDelete={() => setDeleting(a)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'journal' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-th">#</th>
                  <th className="table-th">{t('accounting.entry_date')}</th>
                  <th className="table-th">{t('accounting.description')}</th>
                  <th className="table-th text-right">{t('accounting.debit')}</th>
                  <th className="table-th text-right">{t('accounting.credit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && <tr><td colSpan={5} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
                {!loading && entries.length === 0 && <tr><td colSpan={5} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-td font-mono text-xs">{e.entry_number}</td>
                    <td className="table-td whitespace-nowrap">{e.entry_date}</td>
                    <td className="table-td">{e.description}</td>
                    <td className="table-td text-right font-mono">{Number(e.total_debit).toFixed(2)}</td>
                    <td className="table-td text-right font-mono">{Number(e.total_credit).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {accountForm.open && (
        <AccountForm
          initial={accountForm.initial}
          onClose={() => setAccountForm({ open: false, initial: null })}
          onSaved={() => { setAccountForm({ open: false, initial: null }); refresh(); }}
        />
      )}
      {entryOpen && (
        <JournalEntryForm
          accounts={accounts.filter((a) => a.active)}
          onClose={() => setEntryOpen(false)}
          onSaved={() => { setEntryOpen(false); refresh(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={`${deleting.code} — ${deleting.name}`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={removeAccount}
        />
      )}
    </div>
  );
}

function AccountForm({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => initial
    ? { code: initial.code, name: initial.name, type: initial.type }
    : { code: '', name: '', type: 'expense' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (initial) await api.put(`/api/accounting/chart/${initial.id}`, form);
      else await api.post('/api/accounting/chart', form);
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? `${t('crud.edit')} — ${initial.name}` : t('accounting.new_account')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('accounting.code')} *</label>
            <input className="input font-mono" placeholder="5.1.02.006" value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} required />
          </div>
          <div>
            <label className="label">{t('accounting.type')} *</label>
            <select className="input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              {ACCOUNT_TYPES.map((ty) => <option key={ty} value={ty}>{t(`accounting.types.${ty}`)}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">{t('common.name')} *</label>
            <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}

interface EntryLine { account_code: string; debit: string; credit: string; }

function JournalEntryForm({ accounts, onClose, onSaved }: { accounts: any[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<EntryLine[]>([
    { account_code: '', debit: '', credit: '' },
    { account_code: '', debit: '', credit: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setLine = (i: number, k: keyof EntryLine, v: string) =>
    setLines((arr) => arr.map((l, idx) => idx === i ? { ...l, [k]: v } : l));

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!balanced) { setError(t('accounting.unbalanced')); return; }
    setSaving(true);
    try {
      await api.post('/api/accounting/journal', {
        entry_date: entryDate,
        description,
        lines: lines.map((l) => ({
          account_code: l.account_code,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
        })),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('accounting.new_entry')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">{t('accounting.entry_date')} *</label>
            <input type="date" className="input" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('accounting.description')} *</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_110px_110px_32px] gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>{t('accounting.account')}</span>
            <span className="text-right">{t('accounting.debit')}</span>
            <span className="text-right">{t('accounting.credit')}</span>
            <span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_110px_110px_32px] gap-2 items-center">
              <select className="input" value={l.account_code} onChange={(e) => setLine(i, 'account_code', e.target.value)} required>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
              <input type="number" min={0} step={0.01} className="input text-right font-mono" placeholder="0.00"
                value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} />
              <input type="number" min={0} step={0.01} className="input text-right font-mono" placeholder="0.00"
                value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} />
              <button type="button" disabled={lines.length <= 2}
                onClick={() => setLines((arr) => arr.filter((_, idx) => idx !== i))}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-30" aria-label="Remove line">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setLines((arr) => [...arr, { account_code: '', debit: '', credit: '' }])} className="btn-secondary text-sm">
            + {t('accounting.add_line')}
          </button>
          <div className={`text-sm font-mono font-semibold ${balanced ? 'text-emerald-700' : 'text-rose-600'}`}>
            D {totalDebit.toFixed(2)} / C {totalCredit.toFixed(2)} {balanced ? '✓' : '≠'}
          </div>
        </div>

        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
