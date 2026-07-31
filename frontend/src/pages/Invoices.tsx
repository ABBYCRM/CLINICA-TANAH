import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';
import { PatientPicker } from '../components/PatientPicker';

interface InvLine { description: string; quantity: string; unit_price: string; tax_rate: string; }

export default function Invoices() {
  const { t, locale } = useI18n();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/api/accounting/invoices')
      .then((d) => setInvoices(d.invoices))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale]);

  const markPaid = async (id: string) => {
    try {
      await api.put(`/api/accounting/invoices/${id}/mark-paid`, {});
      setInvoices((arr) => arr.map((i) => i.id === id ? { ...i, status: 'paid' } : i));
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      await api.del(`/api/accounting/invoices/${deleting.id}`);
      setDeleting(null);
      load();
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
        <h1 className="text-2xl font-bold text-slate-900">{t('invoices.title')}</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary" data-testid="new-invoice">
          + {t('invoices.new')}
        </button>
      </div>

      {error && <FormError message={error} />}

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
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && invoices.length === 0 && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
              {invoices.map((inv) => {
                const color = inv.status === 'paid' ? 'badge-green' : inv.status === 'overdue' ? 'badge-red' : inv.status === 'cancelled' ? 'badge-slate' : 'badge-yellow';
                return (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-td font-mono text-xs">{inv.invoice_number}</td>
                    <td className="table-td">{inv.patient_name || '—'}</td>
                    <td className="table-td">{inv.issue_date}</td>
                    <td className="table-td text-right font-mono">R$ {inv.total.toFixed(2)}</td>
                    <td className="table-td"><span className={color}>{inv.status}</span></td>
                    <td className="table-td">
                      <div className="flex items-center justify-end gap-1">
                        {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                          <button onClick={() => markPaid(inv.id)} className="text-xs font-medium text-clinic-700 hover:underline px-1.5">
                            ✓ {t('invoices.mark_paid')}
                          </button>
                        )}
                        {inv.status !== 'paid' && (
                          <RowActions
                            onEdit={() => { setEditing(inv); setShowForm(true); }}
                            onDelete={() => setDeleting(inv)}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <InvoiceForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={deleting.invoice_number}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function InvoiceForm({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => initial ? {
    patient_id: initial.patient_id ?? '', issue_date: initial.issue_date ?? '',
    due_date: initial.due_date ?? '', status: initial.status ?? 'issued',
  } : {
    patient_id: '', issue_date: new Date().toISOString().slice(0, 10), due_date: '', status: 'issued',
  });
  const [lines, setLines] = useState<InvLine[]>([{ description: '', quantity: '1', unit_price: '', tax_rate: '0' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const patientLabel = initial?.patient_name || '';

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, k: keyof InvLine, v: string) =>
    setLines((arr) => arr.map((l, idx) => idx === i ? { ...l, [k]: v } : l));

  const total = lines.reduce((s, l) => {
    const q = parseFloat(l.quantity) || 0;
    const p = parseFloat(l.unit_price) || 0;
    const tax = parseFloat(l.tax_rate) || 0;
    return s + q * p * (1 + tax / 100);
  }, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const clean = lines
      .filter((l) => l.description.trim() && (parseFloat(l.unit_price) || 0) >= 0)
      .map((l) => ({
        description: l.description,
        quantity: parseFloat(l.quantity) || 1,
        unit_price: parseFloat(l.unit_price) || 0,
        tax_rate: parseFloat(l.tax_rate) || 0,
      }));
    if (!clean.length) { setError(t('invoices.description') + ' *'); return; }
    setSaving(true);
    const payload = {
      patient_id: form.patient_id || null,
      issue_date: form.issue_date,
      due_date: form.due_date || null,
      status: form.status,
      total: Math.round(total * 100) / 100,
      lines: clean,
    };
    try {
      if (initial) await api.put(`/api/accounting/invoices/${initial.id}`, payload);
      else await api.post('/api/accounting/invoices', payload);
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? `${t('crud.edit')} — ${initial.invoice_number}` : t('invoices.new')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">{t('invoices.patient')}</label>
            <PatientPicker
              value={form.patient_id}
              initialLabel={patientLabel}
              allowClear
              required={false}
              hint={t('picker.patient_hint')}
              onChange={(id) => set('patient_id', id)}
            />
          </div>
          <div>
            <label className="label">{t('invoices.status')}</label>
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="draft">{t('invoices.status_draft')}</option>
              <option value="issued">{t('invoices.status_issued')}</option>
              <option value="cancelled">{t('invoices.status_cancelled')}</option>
            </select>
          </div>
          <div>
            <label className="label">{t('invoices.issue_date')} *</label>
            <input type="date" className="input" value={form.issue_date} onChange={(e) => set('issue_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('invoices.due_date')}</label>
            <input type="date" className="input" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_70px_100px_80px_32px] gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>{t('invoices.description')}</span>
            <span className="text-right">{t('common.quantity')}</span>
            <span className="text-right">{t('invoices.unit_price')}</span>
            <span className="text-right">{t('invoices.tax_rate')}</span>
            <span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_100px_80px_32px] gap-2 items-center">
              <input className="input" value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} required={i === 0} />
              <input type="number" min={1} step={1} className="input text-right" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />
              <input type="number" min={0} step={0.01} className="input text-right font-mono" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} required={i === 0} />
              <input type="number" min={0} max={100} step={0.1} className="input text-right" value={l.tax_rate} onChange={(e) => setLine(i, 'tax_rate', e.target.value)} />
              <button type="button" disabled={lines.length <= 1}
                onClick={() => setLines((arr) => arr.filter((_, idx) => idx !== i))}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-30" aria-label="Remove line">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setLines((arr) => [...arr, { description: '', quantity: '1', unit_price: '', tax_rate: '0' }])} className="btn-secondary text-sm">
            + {t('invoices.add_line')}
          </button>
          <div className="text-lg font-mono font-bold text-slate-900">R$ {total.toFixed(2)}</div>
        </div>

        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
