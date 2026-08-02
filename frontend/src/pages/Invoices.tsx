import { useEffect, useRef, useState } from 'react';
import { api, apiErrorKey } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, RowActions, FormError, FormActions } from '../components/crud';
import { PatientPicker } from '../components/PatientPicker';

interface InvLine { description: string; quantity: string; unit_price: string; tax_rate: string; }

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function Invoices() {
  const { t, locale } = useI18n();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ocrReady, setOcrReady] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);

  const load = () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (search) q.set('q', search);
    if (statusFilter) q.set('status', statusFilter);
    api.get(`/api/accounting/invoices?${q}`)
      .then((d) => {
        setInvoices(d.invoices || []);
        setOcrReady(!!d.ocr_ready);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale, search, statusFilter]);

  const markPaid = async (id: string) => {
    try {
      await api.put(`/api/accounting/invoices/${id}/mark-paid`, {});
      setInvoices((arr) => arr.map((i) => (i.id === id ? { ...i, status: 'paid' } : i)));
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    if (!deletePassword.trim()) {
      setError(t('invoices.delete_password_required'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.del(`/api/accounting/invoices/${deleting.id}`, { password: deletePassword });
      setDeleting(null);
      setDeletePassword('');
      if (detail?.invoice?.id === deleting.id) setDetail(null);
      load();
    } catch (e: any) {
      const key = apiErrorKey(e);
      setError(key === 'errors.generic' ? (e.message || t('errors.generic')) : t(key));
      // keep dialog open on wrong password so user can retry
      if (e?.body?.error !== 'invalid_delete_password' && e?.status !== 403) {
        setDeleting(null);
        setDeletePassword('');
      }
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (inv: any) => {
    try {
      const d = await api.get(`/api/accounting/invoices/${inv.id}`);
      setDetail(d);
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    }
  };

  return (
    <div className="space-y-4" data-testid="invoices-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{t('invoices.title')}</h1>
          <p className="page-subtitle">
            {ocrReady ? t('invoices.ocr_ready') : t('invoices.ocr_not_configured')}
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="btn-primary"
          data-testid="new-invoice"
        >
          + {t('invoices.new')}
        </button>
      </div>

      {error && <FormError message={error} />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <input
            className="input"
            placeholder={t('invoices.search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="invoices-search"
          />
        </div>
        <select className="crm-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{t('invoices.status')}</option>
          <option value="draft">{t('invoices.status_draft')}</option>
          <option value="issued">{t('invoices.status_issued')}</option>
          <option value="paid">{t('invoices.status_paid')}</option>
          <option value="overdue">{t('invoices.status_overdue')}</option>
          <option value="cancelled">{t('invoices.status_cancelled')}</option>
        </select>
      </div>

      <div className="card">
        <div className="md:hidden mobile-stack-list" data-testid="invoices-mobile-list">
          {loading && <div className="p-6 text-center text-slate-400">{t('common.loading')}</div>}
          {!loading && invoices.length === 0 && <div className="p-6 text-center text-slate-400">{t('common.no_data')}</div>}
          {invoices.map((inv) => {
            const color = inv.status === 'paid' ? 'badge-green' : inv.status === 'overdue' ? 'badge-red' : inv.status === 'cancelled' ? 'badge-slate' : 'badge-yellow';
            return (
              <div key={inv.id} className="mobile-stack-item">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button type="button" className="mobile-stack-title font-mono text-left text-clinic-700" onClick={() => openDetail(inv)}>
                      {inv.invoice_number}
                    </button>
                    <div className="mobile-stack-meta">{inv.patient_name || '—'} · {inv.issue_date}</div>
                  </div>
                  <span className={`${color} shrink-0`}>{inv.status}</span>
                </div>
                <div className="mobile-stack-grid">
                  <div>
                    <div className="mobile-stack-label">{t('common.total')}</div>
                    <div className="font-mono font-semibold">R$ {Number(inv.total).toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="mobile-stack-label">{t('invoices.documents')}</div>
                    <div>{(inv.document_count || 0) > 0 ? inv.document_count : '—'}</div>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <button type="button" className="btn-secondary text-xs" onClick={() => openDetail(inv)}>
                    {t('invoices.open')}
                  </button>
                  {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                    <button type="button" className="btn-secondary text-xs" onClick={() => markPaid(inv.id)}>
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
              </div>
            );
          })}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('invoices.number')}</th>
                <th className="table-th">{t('invoices.patient')}</th>
                <th className="table-th">{t('invoices.issue_date')}</th>
                <th className="table-th text-right">{t('common.total')}</th>
                <th className="table-th">{t('invoices.documents')}</th>
                <th className="table-th">{t('invoices.status')}</th>
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={7} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && invoices.length === 0 && <tr><td colSpan={7} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
              {invoices.map((inv) => {
                const color = inv.status === 'paid' ? 'badge-green' : inv.status === 'overdue' ? 'badge-red' : inv.status === 'cancelled' ? 'badge-slate' : 'badge-yellow';
                return (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-td">
                      <button type="button" className="font-mono text-xs text-clinic-700 hover:underline" onClick={() => openDetail(inv)}>
                        {inv.invoice_number}
                      </button>
                    </td>
                    <td className="table-td">{inv.patient_name || '—'}</td>
                    <td className="table-td">{inv.issue_date}</td>
                    <td className="table-td text-right font-mono">R$ {Number(inv.total).toFixed(2)}</td>
                    <td className="table-td">
                      {(inv.document_count || 0) > 0
                        ? <span className="badge-blue">{inv.document_count}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="table-td"><span className={color}>{inv.status}</span></td>
                    <td className="table-td">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" className="text-xs font-medium text-clinic-700 hover:underline px-1.5" onClick={() => openDetail(inv)}>
                          {t('invoices.open')}
                        </button>
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
          ocrReady={ocrReady}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
      {detail && (
        <InvoiceDetail
          data={detail}
          ocrReady={ocrReady}
          onClose={() => setDetail(null)}
          onChanged={async () => {
            const d = await api.get(`/api/accounting/invoices/${detail.invoice.id}`);
            setDetail(d);
            load();
          }}
        />
      )}
      {deleting && (
        <Modal title={t('invoices.delete_title')} onClose={() => { setDeleting(null); setDeletePassword(''); }}>
          <div className="space-y-4" data-testid="invoice-delete-dialog">
            <p className="text-sm text-[color:var(--ink-muted)]">
              <span className="font-semibold text-[color:var(--ink)] block mb-1">{deleting.invoice_number}</span>
              {t('invoices.delete_body')}
            </p>
            <label className="block text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)]">
                {t('invoices.delete_password')}
              </span>
              <input
                type="password"
                className="input mt-1"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder={t('invoices.delete_password_placeholder')}
                autoFocus
                data-testid="invoice-delete-password"
                onKeyDown={(e) => { if (e.key === 'Enter') remove(); }}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => { setDeleting(null); setDeletePassword(''); }}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn-danger" disabled={busy} onClick={remove} data-testid="confirm-delete">
                {busy ? t('common.loading') : t('common.delete')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function InvoiceForm({
  initial, ocrReady, onClose, onSaved,
}: {
  initial: any | null;
  ocrReady: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(() => (initial ? {
    patient_id: initial.patient_id ?? '',
    issue_date: initial.issue_date ?? '',
    due_date: initial.due_date ?? '',
    status: initial.status ?? 'issued',
    invoice_number_override: initial.invoice_number ?? '',
  } : {
    patient_id: '',
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: '',
    status: 'issued',
    invoice_number_override: '',
  }));
  const [lines, setLines] = useState<InvLine[]>([{ description: '', quantity: '1', unit_price: '', tax_rate: '0' }]);
  const [saving, setSaving] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ name: string; mime: string; data_base64: string } | null>(null);
  const [ocrMeta, setOcrMeta] = useState<any>(null);
  const [error, setError] = useState('');
  const [patientLabel, setPatientLabel] = useState(initial?.patient_name || '');

  useEffect(() => {
    if (!initial?.id) return;
    api.get(`/api/accounting/invoices/${initial.id}`).then((d) => {
      if (d.lines?.length) {
        setLines(d.lines.map((l: any) => ({
          description: l.description,
          quantity: String(l.quantity),
          unit_price: String(l.unit_price),
          tax_rate: String(l.tax_rate ?? 0),
        })));
      }
    }).catch(() => { /* ignore */ });
  }, [initial?.id]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, k: keyof InvLine, v: string) =>
    setLines((arr) => arr.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  const total = lines.reduce((s, l) => {
    const q = parseFloat(l.quantity) || 0;
    const p = parseFloat(l.unit_price) || 0;
    const tax = parseFloat(l.tax_rate) || 0;
    return s + q * p * (1 + tax / 100);
  }, 0);

  const applyExtraction = (extraction: any, matched?: any) => {
    setOcrMeta(extraction);
    if (extraction.issue_date) set('issue_date', extraction.issue_date);
    if (extraction.due_date) set('due_date', extraction.due_date);
    if (extraction.invoice_number) set('invoice_number_override', extraction.invoice_number);
    if (matched?.id) {
      set('patient_id', matched.id);
      setPatientLabel(matched.full_name);
    }
    if (Array.isArray(extraction.lines) && extraction.lines.length) {
      setLines(extraction.lines.map((l: any) => ({
        description: l.description || '',
        quantity: String(l.quantity || 1),
        unit_price: String(l.unit_price ?? ''),
        tax_rate: String(l.tax_rate ?? 0),
      })));
    } else if (extraction.total != null) {
      setLines([{
        description: extraction.raw_text?.slice(0, 80) || t('invoices.ocr_line_fallback'),
        quantity: '1',
        unit_price: String(extraction.total),
        tax_rate: '0',
      }]);
    }
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setError('');
    if (file.size > 8 * 1024 * 1024) {
      setError(t('invoices.file_too_large'));
      return;
    }
    const data_base64 = await fileToBase64(file);
    setPendingFile({ name: file.name, mime: file.type || 'application/octet-stream', data_base64 });

    const isImage = /^image\/(jpeg|png|webp|gif)$/i.test(file.type);
    if (!isImage) {
      setOcrMeta({ note: 'pdf_stored_after_save' });
      return;
    }
    if (!ocrReady) {
      setError(t('invoices.ocr_not_configured'));
      return;
    }
    setOcrBusy(true);
    try {
      const res = await api.post('/api/accounting/invoices/ocr', {
        filename: file.name,
        mime: file.type,
        data_base64,
        run_ocr: true,
      });
      applyExtraction(res.extraction, res.matched_patient);
    } catch (e: any) {
      setError(t(apiErrorKey(e)) !== 'errors.generic' ? t(apiErrorKey(e)) : (e.body?.message || e.message || t('invoices.ocr_failed')));
    } finally {
      setOcrBusy(false);
    }
  };

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
    const payload: any = {
      patient_id: form.patient_id || null,
      issue_date: form.issue_date,
      due_date: form.due_date || null,
      status: form.status,
      total: Math.round(total * 100) / 100,
      lines: clean,
    };
    if (!initial && form.invoice_number_override) {
      payload.invoice_number_override = form.invoice_number_override;
    }
    try {
      let invoiceId = initial?.id as string | undefined;
      if (initial) await api.put(`/api/accounting/invoices/${initial.id}`, payload);
      else {
        const created = await api.post('/api/accounting/invoices', payload);
        invoiceId = created.id;
      }
      if (pendingFile && invoiceId) {
        await api.post(`/api/accounting/invoices/${invoiceId}/documents`, {
          filename: pendingFile.name,
          mime: pendingFile.mime,
          data_base64: pendingFile.data_base64,
          run_ocr: false,
          apply_ocr_fields: false,
        });
      }
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

        <div className="rounded-xl border border-dashed border-clinic-300 bg-clinic-50/40 p-4" data-testid="invoice-ocr-drop">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">{t('invoices.upload_title')}</div>
              <p className="text-xs text-[color:var(--ink-muted)] mt-0.5">{t('invoices.upload_hint')}</p>
            </div>
            <button type="button" className="btn-secondary text-sm" disabled={ocrBusy} onClick={() => fileRef.current?.click()} data-testid="invoice-upload-btn">
              {ocrBusy ? t('invoices.ocr_running') : t('invoices.upload_cta')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
            />
          </div>
          {pendingFile && (
            <div className="mt-3 text-xs text-slate-600 flex flex-wrap gap-2 items-center">
              <span className="badge-blue">{pendingFile.name}</span>
              {ocrMeta?.model && <span className="badge-slate">{ocrMeta.model}</span>}
              {ocrMeta?.confidence && <span className="badge-green">{ocrMeta.confidence}</span>}
              {ocrBusy && <span className="text-clinic-700">{t('invoices.ocr_running')}</span>}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">{t('invoices.patient')}</label>
            <PatientPicker
              value={form.patient_id}
              initialLabel={patientLabel}
              allowClear
              required={false}
              hint={t('picker.patient_hint')}
              onChange={(id, p) => { set('patient_id', id); setPatientLabel(p?.full_name || ''); }}
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
          {!initial && (
            <div>
              <label className="label">{t('invoices.number')}</label>
              <input className="input font-mono" value={form.invoice_number_override}
                placeholder="INV-… / NF-…"
                onChange={(e) => set('invoice_number_override', e.target.value)} />
            </div>
          )}
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

        {ocrMeta?.raw_text && (
          <details className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">{t('invoices.ocr_raw')}</summary>
            <pre className="mt-2 whitespace-pre-wrap max-h-40 overflow-auto">{ocrMeta.raw_text}</pre>
          </details>
        )}

        <FormActions saving={saving || ocrBusy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function InvoiceDetail({
  data, ocrReady, onClose, onChanged,
}: {
  data: any;
  ocrReady: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inv = data.invoice;

  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const data_base64 = await fileToBase64(file);
      await api.post(`/api/accounting/invoices/${inv.id}/documents`, {
        filename: file.name,
        mime: file.type,
        data_base64,
        run_ocr: true,
        apply_ocr_fields: inv.status !== 'paid',
      });
      await onChanged();
    } catch (e: any) {
      setError(e.body?.message || e.message || t('invoices.ocr_failed'));
    } finally {
      setBusy(false);
    }
  };

  const removeDoc = async (docId: string) => {
    setBusy(true);
    try {
      await api.del(`/api/accounting/invoices/documents/${docId}`);
      await onChanged();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${inv.invoice_number} — ${t('invoices.documents')}`} onClose={onClose} wide>
      <div className="space-y-4" data-testid="invoice-detail">
        <FormError message={error} />
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div><div className="text-xs text-slate-400 uppercase">{t('invoices.patient')}</div><div className="font-medium">{inv.patient_name || '—'}</div></div>
          <div><div className="text-xs text-slate-400 uppercase">{t('invoices.issue_date')}</div><div className="font-medium">{inv.issue_date}</div></div>
          <div><div className="text-xs text-slate-400 uppercase">{t('common.total')}</div><div className="font-mono font-semibold">R$ {Number(inv.total).toFixed(2)}</div></div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase text-slate-500 mb-2">{t('invoices.lines')}</div>
          <ul className="space-y-1 text-sm">
            {(data.lines || []).map((l: any) => (
              <li key={l.id} className="flex justify-between gap-3 border-b border-slate-100 py-1">
                <span>{l.description}</span>
                <span className="font-mono text-slate-600">{l.quantity} × {Number(l.unit_price).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{t('invoices.documents')}</div>
              <p className="text-xs text-slate-500">{ocrReady ? t('invoices.ocr_ready') : t('invoices.ocr_not_configured')}</p>
            </div>
            <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="invoice-detail-upload">
              {busy ? t('invoices.ocr_running') : t('invoices.upload_cta')}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" className="hidden"
              onChange={(e) => upload(e.target.files?.[0] || null)} />
          </div>
          {(data.documents || []).length === 0 && <p className="text-sm text-slate-400">{t('common.no_data')}</p>}
          <ul className="space-y-2">
            {(data.documents || []).map((d: any) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{d.original_name}</div>
                  <div className="text-xs text-slate-500">
                    {d.mime_type} · {(d.size_bytes / 1024).toFixed(1)} KB · OCR: {d.ocr_status}
                    {d.ocr_model ? ` · ${d.ocr_model}` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <a className="text-clinic-700 hover:underline text-xs font-medium"
                    href={`/api/accounting/invoices/documents/${d.id}/file`}
                    target="_blank" rel="noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      const token = localStorage.getItem('auth_token');
                      fetch(`/api/accounting/invoices/documents/${d.id}/file`, {
                        headers: { Authorization: `Bearer ${token}` },
                      }).then(async (r) => {
                        const blob = await r.blob();
                        const url = URL.createObjectURL(blob);
                        window.open(url, '_blank');
                      });
                    }}
                  >
                    {t('invoices.view_file')}
                  </a>
                  <button type="button" className="text-xs text-rose-600 hover:underline" disabled={busy} onClick={() => removeDoc(d.id)}>
                    {t('common.delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.back')}</button>
        </div>
      </div>
    </Modal>
  );
}
