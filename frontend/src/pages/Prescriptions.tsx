import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

interface RxItem {
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string;
  inventory_item_id?: string;
  quantity?: number | '';
  unit_price?: number | '';
}

type RxTab = 'active' | 'cancelled';

function parseItems(v: any): RxItem[] {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
}

function fmtWhen(v?: string | null, locale = 'pt-BR') {
  if (!v) return '—';
  const d = new Date(v.includes('T') || v.includes(' ') ? v.replace(' ', 'T') : `${v}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function money(n: number | null | undefined, locale = 'pt-BR') {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString(locale, { style: 'currency', currency: 'BRL' });
}

export default function Prescriptions() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<RxTab>('active');
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [counts, setCounts] = useState({ active: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState<any | null>(null);
  const [trailId, setTrailId] = useState<string | null>(null);
  const [trail, setTrail] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.get(`/api/clinical/prescriptions?status=${tab}`)
      .then((d) => {
        setPrescriptions(d.prescriptions || []);
        setCounts(d.counts || { active: 0, cancelled: 0 });
      })
      .catch((e: any) => setError(e.message || t('errors.generic')))
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale, tab]);

  const openTrail = async (id: string) => {
    setTrailId(id);
    setTrail(null);
    try {
      const d = await api.get(`/api/clinical/prescriptions/${id}/trail`);
      setTrail(d);
    } catch (e: any) {
      setError(e.body?.message || e.message || t('errors.generic'));
      setTrailId(null);
    }
  };

  const cancelRx = async () => {
    if (!cancelling) return;
    setBusy(true);
    try {
      await api.post(`/api/clinical/prescriptions/${cancelling.id}/cancel`, {
        reason: t('prescriptions.cancel_default_reason'),
      });
      setCancelling(null);
      if (tab !== 'cancelled') setTab('cancelled');
      else load();
    } catch (e: any) {
      setError(e.body?.message || e.message || t('errors.generic'));
      setCancelling(null);
    } finally {
      setBusy(false);
    }
  };

  const restoreRx = async (p: any) => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/clinical/prescriptions/${p.id}/restore`, {});
      if (tab !== 'active') setTab('active');
      else load();
    } catch (err: any) {
      setError(err.body?.message || err.message || t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (p: any) => {
    if (!p.invoice?.id) return;
    setBusy(true);
    try {
      await api.put(`/api/accounting/invoices/${p.invoice.id}/mark-paid`, { payment_method: 'pix' });
      load();
    } catch (e: any) {
      setError(e.body?.message || e.message || t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="prescriptions-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t('prescriptions.title')}</h1>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="btn-primary"
          data-testid="new-prescription"
        >
          + {t('prescriptions.new')}
        </button>
      </div>

      <p className="desk-copy text-sm max-w-3xl leading-relaxed">
        {t('prescriptions.stock_bridge_hint')}
      </p>

      <div className="desk-feed-tabs flex flex-wrap gap-1 border-b border-[rgba(201,162,90,0.35)]">
        <button
          type="button"
          className={`crm-feed-tab ${tab === 'active' ? 'is-active' : ''}`}
          data-testid="rx-tab-active"
          onClick={() => setTab('active')}
        >
          {t('prescriptions.tab_active')}
          <span className="ml-1.5 tabular-nums opacity-90">{counts.active}</span>
        </button>
        <button
          type="button"
          className={`crm-feed-tab ${tab === 'cancelled' ? 'is-active' : ''}`}
          data-testid="rx-tab-cancelled"
          onClick={() => setTab('cancelled')}
        >
          {t('prescriptions.tab_cancelled')}
          <span className="ml-1.5 tabular-nums opacity-90">{counts.cancelled}</span>
        </button>
      </div>

      {tab === 'cancelled' && (
        <p className="text-sm text-[color:var(--ink)] leading-relaxed max-w-3xl rounded-lg px-3 py-2"
          style={{ background: 'linear-gradient(180deg,#f7f1e6,#efe6d8)', border: '1px solid rgba(176,183,192,0.45)' }}>
          {t('prescriptions.retention_notice')}
        </p>
      )}

      {error && <FormError message={error} />}

      <div className="grid gap-3">
        {loading && <div className="desk-copy py-6 text-center">{t('common.loading')}</div>}
        {!loading && prescriptions.length === 0 && (
          <div className="card p-6 text-center text-[color:var(--ink)]">{t('common.no_data')}</div>
        )}
        {prescriptions.map((p) => {
          const items = parseItems(p.items);
          const cancelled = (p.status || 'active') === 'cancelled';
          const dispensed = (p.dispense_status || 'none') === 'dispensed';
          return (
            <div
              key={p.id}
              className={`card p-4 ${cancelled ? 'opacity-95' : ''}`}
              data-testid={`rx-card-${p.id}`}
              data-status={p.status || 'active'}
            >
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-[color:var(--ink)] text-base">{p.patient_name}</div>
                  <div className="text-sm text-[color:var(--ink)]/80">
                    {p.practitioner_name} • {fmtWhen(p.created_at, locale)}
                  </div>
                  {cancelled && (
                    <div className="text-xs text-[#8b3a2a] mt-1 font-medium">
                      {t('prescriptions.cancelled_meta', {
                        when: fmtWhen(p.cancelled_at, locale),
                        by: p.cancelled_by_name || '—',
                      })}
                      {p.cancel_reason ? ` · ${p.cancel_reason}` : ''}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0 justify-end">
                  {dispensed && (
                    <span className="badge-green">{t('prescriptions.dispensed')}</span>
                  )}
                  {p.invoice && (
                    <span className={`badge ${p.paid ? 'badge-green' : 'badge-yellow'}`}>
                      {p.invoice.invoice_number} · {p.paid ? t('prescriptions.paid') : t('prescriptions.unpaid')}
                      {' · '}{money(p.invoice.total, locale)}
                    </span>
                  )}
                  {cancelled ? (
                    <span className="badge-red">{t('prescriptions.status_cancelled')}</span>
                  ) : p.sent_via_whatsapp ? (
                    <span className="badge-green">✓ {t('prescriptions.send_via_whatsapp')}</span>
                  ) : null}
                  {!cancelled && (
                    <RowActions
                      onEdit={() => { setEditing(p); setShowForm(true); }}
                      onDelete={() => setCancelling(p)}
                      deleteTitle={t('prescriptions.cancel_action')}
                    />
                  )}
                  {cancelled && (
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      disabled={busy}
                      onClick={() => restoreRx(p)}
                      data-testid={`rx-restore-${p.id}`}
                    >
                      {t('prescriptions.restore')}
                    </button>
                  )}
                </div>
              </div>
              <ul className={`space-y-1.5 text-sm text-[color:var(--ink)] ${cancelled ? 'line-through decoration-[rgba(90,40,30,0.45)]' : ''}`}>
                {items.map((it, i) => (
                  <li key={i} className="border-l-2 border-[color:var(--brass-deep)] pl-3">
                    <span className="font-semibold">{it.medication}</span>
                    {(it.dosage || it.frequency || it.duration) ? (
                      <> — {[it.dosage, it.frequency, it.duration].filter(Boolean).join(', ')}</>
                    ) : null}
                    {it.inventory_item_id && it.quantity ? (
                      <span className="ml-2 text-xs font-medium text-[color:var(--ink)]/75">
                        {t('prescriptions.stock_qty', { qty: String(it.quantity) })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => openTrail(p.id)}>
                  {t('prescriptions.view_trail')}
                </button>
                {!cancelled && dispensed && p.invoice && !p.paid && (
                  <button type="button" className="btn-primary text-xs" disabled={busy} onClick={() => markPaid(p)}>
                    {t('prescriptions.mark_paid')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <PrescriptionForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); setTab('active'); load(); }}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          title={t('prescriptions.cancel_title')}
          body={t('prescriptions.cancel_body')}
          confirmLabel={t('prescriptions.cancel_confirm')}
          name={`${cancelling.patient_name} — ${fmtWhen(cancelling.created_at, locale)}`}
          notice={t('prescriptions.cancel_notice')}
          busy={busy}
          onCancel={() => setCancelling(null)}
          onConfirm={cancelRx}
        />
      )}
      {trailId && (
        <Modal title={t('prescriptions.trail_title')} onClose={() => { setTrailId(null); setTrail(null); }} wide>
          {!trail && <p className="text-sm text-[color:var(--ink-muted)]">{t('common.loading')}</p>}
          {trail && (
            <div className="space-y-3 text-sm" data-testid="rx-trail">
              <div>
                <div className="font-semibold">{trail.prescription.patient_name}</div>
                <div className="text-xs text-[color:var(--ink-muted)]">
                  {t('prescriptions.prescribed_by')}: {trail.prescription.practitioner_name}
                  {trail.prescription.dispensed_by_name ? ` · ${t('prescriptions.dispensed_by')}: ${trail.prescription.dispensed_by_name}` : ''}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1">{t('prescriptions.stock_out')}</h4>
                {(trail.stock_out || []).length === 0 && <p className="text-[color:var(--ink-muted)]">{t('common.no_data')}</p>}
                <ul className="space-y-1">
                  {(trail.stock_out || []).map((s: any) => (
                    <li key={s.item_id}>{s.item_name}: −{s.quantity}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1">{t('prescriptions.invoice')}</h4>
                {trail.invoice ? (
                  <div>
                    {trail.invoice.invoice_number} · {money(trail.invoice.total, locale)} ·{' '}
                    <span className={trail.paid ? 'text-green-800' : 'text-amber-800'}>
                      {trail.paid ? t('prescriptions.paid') : t('prescriptions.unpaid')}
                    </span>
                    <div className="mt-1">
                      <Link to="/invoices" className="underline text-[color:var(--brass-deep)]">{t('prescriptions.open_invoices')}</Link>
                      {' · '}
                      <Link to="/accounting" className="underline text-[color:var(--brass-deep)]">{t('prescriptions.open_accounting')}</Link>
                    </div>
                  </div>
                ) : (
                  <p className="text-[color:var(--ink-muted)]">{t('prescriptions.no_invoice')}</p>
                )}
              </div>
              {(trail.journals || []).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1">{t('prescriptions.journals')}</h4>
                  <ul className="space-y-1">
                    {trail.journals.map((j: any) => (
                      <li key={j.id}>{j.entry_number} · {j.description} · {money(j.total_debit, locale)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

const emptyItem: RxItem = {
  medication: '', dosage: '', frequency: '', duration: '', instructions: '',
  inventory_item_id: '', quantity: '', unit_price: '',
};

function PrescriptionForm({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [encounters, setEncounters] = useState<any[]>([]);
  const [stockItems, setStockItems] = useState<any[]>([]);
  const [encounterId, setEncounterId] = useState(initial?.encounter_id ?? '');
  const [items, setItems] = useState<RxItem[]>(initial ? parseItems(initial.items).map((it) => ({
    ...emptyItem, ...it,
    quantity: it.quantity ?? '',
    unit_price: it.unit_price ?? '',
    inventory_item_id: it.inventory_item_id ?? '',
  })) : [{ ...emptyItem }]);
  const [dispenseFromStock, setDispenseFromStock] = useState(true);
  const [markPaid, setMarkPaid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/clinical/encounters').then((d) => setEncounters(d.encounters || [])).catch(console.error);
    api.get('/api/inventory/items?category=medication')
      .then((d) => setStockItems((d.items || []).filter((x: any) => x.category === 'medication' || true)))
      .catch(() => setStockItems([]));
  }, []);

  const setItem = (i: number, patch: Partial<RxItem>) =>
    setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  const pickStock = (i: number, itemId: string) => {
    const stock = stockItems.find((s) => s.id === itemId);
    if (!stock) {
      setItem(i, { inventory_item_id: '', medication: items[i].medication });
      return;
    }
    setItem(i, {
      inventory_item_id: stock.id,
      medication: stock.name,
      unit_price: stock.sale_price ?? stock.unit_cost ?? '',
      quantity: items[i].quantity || 1,
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const clean = items
      .filter((it) => it.medication.trim())
      .map((it) => ({
        medication: it.medication.trim(),
        dosage: it.dosage || '',
        frequency: it.frequency || '',
        duration: it.duration || '',
        instructions: it.instructions || null,
        inventory_item_id: it.inventory_item_id || null,
        quantity: it.inventory_item_id && it.quantity !== '' ? Number(it.quantity) : null,
        unit_price: it.unit_price !== '' && it.unit_price != null ? Number(it.unit_price) : null,
      }));
    if (!clean.length) { setError(t('prescriptions.medication') + ' *'); return; }
    setSaving(true);
    try {
      if (initial) {
        await api.put(`/api/clinical/prescriptions/${initial.id}`, { items: clean });
      } else {
        const enc = encounters.find((x) => x.id === encounterId);
        if (!enc) { setError(t('prescriptions.encounter') + ' *'); setSaving(false); return; }
        await api.post('/api/clinical/prescriptions', {
          encounter_id: enc.id,
          patient_id: enc.patient_id,
          practitioner_id: enc.practitioner_id,
          items: clean,
          dispense_from_stock: dispenseFromStock,
          mark_paid: markPaid,
          payment_method: markPaid ? 'pix' : null,
        });
      }
      onSaved();
    } catch (err: any) {
      const msg = err.body?.error === 'insufficient_stock'
        ? t('prescriptions.insufficient_stock', {
          item: err.body?.item_name || '',
          available: String(err.body?.available ?? ''),
          requested: String(err.body?.requested ?? ''),
        })
        : (err.body?.message || err.message || t('errors.generic'));
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? `${t('crud.edit')} — ${initial.patient_name}` : t('prescriptions.new')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4" data-testid="rx-form">
        <FormError message={error} />
        {!initial && (
          <div>
            <label className="label">{t('prescriptions.encounter')} *</label>
            <select className="input" value={encounterId} onChange={(e) => setEncounterId(e.target.value)} required>
              <option value="">—</option>
              {encounters.map((enc) => (
                <option key={enc.id} value={enc.id}>{enc.patient_name} — {enc.started_at} ({enc.practitioner_name})</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-3">
          {items.map((it, i) => (
            <div key={i} className="rounded-xl border border-[rgba(176,183,192,0.45)] p-3 space-y-2" style={{ background: 'linear-gradient(180deg,#fbf7f0,#f3ebe0)' }}>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input flex-1 min-w-[12rem]"
                  value={it.inventory_item_id || ''}
                  onChange={(e) => pickStock(i, e.target.value)}
                  data-testid={`rx-stock-${i}`}
                >
                  <option value="">{t('prescriptions.external_med')}</option>
                  {stockItems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · est. {s.current_stock ?? '—'} · {money(s.sale_price)}
                    </option>
                  ))}
                </select>
                {items.length > 1 && (
                  <button type="button" onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
                    className="rounded-lg p-1.5 text-[color:var(--ink-muted)] hover:bg-[#f8e8e2] hover:text-[#8b3a2a] transition-colors" aria-label="Remove item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
              <input className="input w-full" placeholder={t('prescriptions.medication') + ' *'} value={it.medication}
                onChange={(e) => setItem(i, { medication: e.target.value })} required={i === 0} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input className="input" placeholder={t('prescriptions.dosage')} value={it.dosage} onChange={(e) => setItem(i, { dosage: e.target.value })} />
                <input className="input" placeholder={t('prescriptions.frequency')} value={it.frequency} onChange={(e) => setItem(i, { frequency: e.target.value })} />
                <input className="input" placeholder={t('prescriptions.duration')} value={it.duration} onChange={(e) => setItem(i, { duration: e.target.value })} />
                {it.inventory_item_id ? (
                  <input
                    className="input"
                    type="number"
                    min={0.01}
                    step="any"
                    placeholder={t('prescriptions.quantity')}
                    value={it.quantity}
                    onChange={(e) => setItem(i, { quantity: e.target.value === '' ? '' : Number(e.target.value) })}
                    required
                    data-testid={`rx-qty-${i}`}
                  />
                ) : (
                  <div />
                )}
              </div>
              <input className="input" placeholder={t('prescriptions.instructions')} value={it.instructions ?? ''} onChange={(e) => setItem(i, { instructions: e.target.value })} />
            </div>
          ))}
          <button type="button" className="btn-secondary text-sm" onClick={() => setItems((arr) => [...arr, { ...emptyItem }])}>
            + {t('prescriptions.add_item')}
          </button>
        </div>

        {!initial && (
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={dispenseFromStock} onChange={(e) => setDispenseFromStock(e.target.checked)} data-testid="rx-dispense-stock" />
              {t('prescriptions.dispense_from_stock')}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={markPaid} onChange={(e) => setMarkPaid(e.target.checked)} disabled={!dispenseFromStock} />
              {t('prescriptions.mark_paid_on_dispense')}
            </label>
          </div>
        )}

        <FormActions onCancel={onClose} saving={saving} />
      </form>
    </Modal>
  );
}
