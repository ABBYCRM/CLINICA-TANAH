import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

type Tab = 'tb' | 'pl' | 'accounts' | 'journal';
const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

type DreLine = {
  id: string;
  type: 'revenue' | 'expense';
  code: string;
  name: string;
  amount: number;
};

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
      className={`seg-item !py-1.5 ${tab === k ? 'is-active' : ''}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t('accounting.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg-track">
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

      {tab === 'pl' && (
        loading && !pl ? (
          <div className="card p-6 text-sm text-[#8a8174]">{t('common.loading')}</div>
        ) : pl ? (
          <DreWorksheet
            initial={pl}
            onError={(msg) => setError(msg)}
            onMutated={refresh}
          />
        ) : null
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

function money(n: number) {
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DreWorksheet({
  initial,
  onError,
  onMutated,
}: {
  initial: any;
  onError: (msg: string) => void;
  onMutated: () => void;
}) {
  const { t } = useI18n();
  const [lines, setLines] = useState<DreLine[]>(() =>
    (initial.lines || []).map((r: any) => ({
      id: r.id,
      type: r.type,
      code: r.code,
      name: r.name,
      amount: Number(r.amount) || 0,
    })),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const r of initial.lines || []) d[r.id] = Number(r.amount || 0).toFixed(2);
    return d;
  });
  const [adding, setAdding] = useState<'revenue' | 'expense' | null>(null);
  const [deleting, setDeleting] = useState<DreLine | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    const next = (initial.lines || []).map((r: any) => ({
      id: r.id,
      type: r.type as 'revenue' | 'expense',
      code: r.code,
      name: r.name,
      amount: Number(r.amount) || 0,
    }));
    setLines(next);
    const d: Record<string, string> = {};
    for (const r of next) d[r.id] = r.amount.toFixed(2);
    setDrafts(d);
  }, [initial]);

  const revenue = useMemo(
    () => lines.filter((l) => l.type === 'revenue').reduce((s, l) => s + (Number(l.amount) || 0), 0),
    [lines],
  );
  const expenses = useMemo(
    () => lines.filter((l) => l.type === 'expense').reduce((s, l) => s + (Number(l.amount) || 0), 0),
    [lines],
  );
  const net = revenue - expenses;

  const saveAmount = async (line: DreLine, raw: string) => {
    const amount = Math.max(0, parseFloat(raw.replace(',', '.')) || 0);
    const rounded = Math.round(amount * 100) / 100;
    setDrafts((d) => ({ ...d, [line.id]: rounded.toFixed(2) }));
    if (Math.abs(rounded - line.amount) < 0.001) return;
    setBusyId(line.id);
    onError('');
    try {
      await api.put(`/api/accounting/income-statement/lines/${line.id}`, { amount: rounded });
      setLines((arr) => arr.map((l) => (l.id === line.id ? { ...l, amount: rounded } : l)));
      onMutated();
    } catch (e: any) {
      onError(e.message || t('errors.generic'));
      setDrafts((d) => ({ ...d, [line.id]: line.amount.toFixed(2) }));
    } finally {
      setBusyId(null);
    }
  };

  const removeLine = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    onError('');
    try {
      await api.del(`/api/accounting/income-statement/lines/${deleting.id}`);
      setLines((arr) => arr.filter((l) => l.id !== deleting.id));
      setDeleting(null);
      onMutated();
    } catch (e: any) {
      onError(e.message || t('errors.generic'));
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const renderColumn = (type: 'revenue' | 'expense') => {
    const items = lines.filter((l) => l.type === type);
    const total = type === 'revenue' ? revenue : expenses;
    const titleColor = type === 'revenue' ? 'text-emerald-800' : 'text-rose-800';
    return (
      <div className="card p-5 flex flex-col min-h-[22rem]" data-testid={`dre-${type}`}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className={`font-display font-semibold ${titleColor}`}>
            {type === 'revenue' ? t('accounting.revenue') : t('accounting.expenses')}
          </h3>
          <button
            type="button"
            className="btn-secondary text-xs"
            data-testid={`dre-add-${type}`}
            onClick={() => setAdding(type)}
          >
            + {t('accounting.add_line')}
          </button>
        </div>

        <div className="flex-1 space-y-1">
          {items.length === 0 && (
            <p className="text-sm text-[#8a8174] py-6 text-center">{t('common.no_data')}</p>
          )}
          {items.map((line) => (
            <div
              key={line.id}
              className="grid grid-cols-[1fr_7.5rem_2.25rem] gap-2 items-center border-b border-[rgba(139,115,85,0.2)] py-1.5"
              data-testid={`dre-line-${line.id}`}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-[#3a342c] truncate">{line.name}</div>
                <div className="text-[11px] font-mono text-[#8a8174]">{line.code}</div>
              </div>
              <input
                type="number"
                min={0}
                step={0.01}
                className="input text-right font-mono text-sm !py-1.5"
                value={drafts[line.id] ?? line.amount.toFixed(2)}
                disabled={busyId === line.id}
                data-testid={`dre-amount-${line.id}`}
                onChange={(e) => setDrafts((d) => ({ ...d, [line.id]: e.target.value }))}
                onBlur={(e) => saveAmount(line, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <button
                type="button"
                className="inline-flex items-center justify-center min-h-9 min-w-9 rounded-lg text-[#8a8174] hover:bg-rose-50 hover:text-rose-700 transition-colors"
                aria-label={t('common.delete')}
                data-testid={`dre-delete-${line.id}`}
                onClick={() => setDeleting(line)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4" aria-hidden="true">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-between font-bold mt-3 pt-3 border-t-2 border-[rgba(139,115,85,0.35)]">
          <span>{type === 'revenue' ? t('accounting.revenue') : t('accounting.expenses')}</span>
          <span className="font-mono" data-testid={`dre-total-${type}`}>{money(total)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="dre-worksheet">
      <div className="grid md:grid-cols-2 gap-4 items-stretch">
        {renderColumn('revenue')}
        {renderColumn('expense')}
      </div>
      <div className="card p-5" data-testid="dre-net">
        <div className="flex justify-between items-center gap-3">
          <span className="font-display font-semibold text-lg text-[#3a342c]">{t('accounting.net_income')}</span>
          <span className={`font-mono font-bold text-2xl ${net >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
            {money(net)}
          </span>
        </div>
        <p className="mt-1 text-xs text-[#8a8174]">{t('accounting.dre_hint')}</p>
      </div>

      {adding && (
        <DreAddModal
          type={adding}
          onClose={() => setAdding(null)}
          onSaved={(line) => {
            setLines((arr) => [...arr, line].sort((a, b) => a.code.localeCompare(b.code)));
            setDrafts((d) => ({ ...d, [line.id]: line.amount.toFixed(2) }));
            setAdding(null);
            onMutated();
          }}
          onError={onError}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={`${deleting.code} — ${deleting.name}`}
          busy={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={removeLine}
        />
      )}
    </div>
  );
}

function DreAddModal({
  type,
  onClose,
  onSaved,
  onError,
}: {
  type: 'revenue' | 'expense';
  onClose: () => void;
  onSaved: (line: DreLine) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('0.00');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    onError('');
    try {
      const value = Math.max(0, parseFloat(amount.replace(',', '.')) || 0);
      const res = await api.post('/api/accounting/income-statement/lines', {
        type,
        name: name.trim(),
        amount: Math.round(value * 100) / 100,
      });
      onSaved({
        id: res.id,
        type: res.type,
        code: res.code,
        name: res.name,
        amount: Number(res.amount) || 0,
      });
    } catch (err: any) {
      onError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`${t('accounting.add_line')} — ${type === 'revenue' ? t('accounting.revenue') : t('accounting.expenses')}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4" data-testid="dre-add-form">
        <div>
          <label className="label">{t('common.name')} *</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            data-testid="dre-add-name"
            placeholder={type === 'revenue' ? 'Receita de …' : 'Despesa de …'}
          />
        </div>
        <div>
          <label className="label">{t('accounting.amount')}</label>
          <input
            type="number"
            min={0}
            step={0.01}
            className="input font-mono"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="dre-add-amount"
          />
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
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
