import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

type Tab = 'items' | 'batches' | 'movements' | 'alerts';
const CATEGORIES = ['medication', 'supply', 'equipment', 'consumable'];
const MOVEMENT_TYPES = ['in', 'out', 'adjust', 'discard'] as const;

export default function Inventory() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>('items');
  const [items, setItems] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any>({ low_stock: [], expiring_soon: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // modal state shared by tabs
  const [itemForm, setItemForm] = useState<{ open: boolean; initial: any | null }>({ open: false, initial: null });
  const [batchForm, setBatchForm] = useState<{ open: boolean; initial: any | null }>({ open: false, initial: null });
  const [movementOpen, setMovementOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ kind: 'item' | 'batch'; row: any } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.get('/api/inventory/items'), api.get('/api/inventory/alerts')])
      .then(([its, alts]) => { setItems(its.items); setAlerts(alts); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [locale, refreshKey]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      const url = deleting.kind === 'item' ? `/api/inventory/items/${deleting.row.id}` : `/api/inventory/batches/${deleting.row.id}`;
      const res = await api.del(url);
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

  const tabLabel = (k: Tab) =>
    k === 'items' ? t('inventory.title') :
    k === 'batches' ? t('inventory.batch') :
    k === 'movements' ? t('inventory.movements') : t('inventory.alerts');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('inventory.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
            {(['items', 'batches', 'movements', 'alerts'] as const).map((k) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${tab === k ? 'bg-white shadow-sm text-clinic-700 font-medium' : 'text-slate-600 hover:text-slate-900'}`}>
                {tabLabel(k)}
              </button>
            ))}
          </div>
          {tab === 'items' && (
            <button onClick={() => setItemForm({ open: true, initial: null })} className="btn-primary" data-testid="new-item">+ {t('inventory.new_item')}</button>
          )}
          {tab === 'batches' && (
            <button onClick={() => setBatchForm({ open: true, initial: null })} className="btn-primary" data-testid="new-batch">+ {t('inventory.new_batch')}</button>
          )}
          {tab === 'movements' && (
            <button onClick={() => setMovementOpen(true)} className="btn-primary" data-testid="new-movement">+ {t('inventory.new_movement')}</button>
          )}
        </div>
      </div>

      {error && <FormError message={error} />}

      {tab === 'alerts' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-4">
            <h3 className="font-semibold text-rose-700 mb-3">⚠ {t('dashboard.low_stock')}</h3>
            {alerts.low_stock.length === 0 && <div className="text-sm text-slate-400">OK</div>}
            <ul className="space-y-2">
              {alerts.low_stock.map((it: any) => (
                <li key={it.id} className="flex justify-between text-sm border-b border-slate-100 pb-1">
                  <span>{it.name}</span>
                  <span className="font-mono text-rose-600">{it.current_stock} / min {it.min_stock}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-4">
            <h3 className="font-semibold text-amber-700 mb-3">⏰ {t('dashboard.expiring_batches')}</h3>
            {alerts.expiring_soon.length === 0 && <div className="text-sm text-slate-400">OK</div>}
            <ul className="space-y-2">
              {alerts.expiring_soon.map((b: any) => (
                <li key={b.id} className="flex justify-between text-sm border-b border-slate-100 pb-1">
                  <span>{b.item_name}</span>
                  <span className="font-mono text-amber-700">{b.expiry_date} ({b.days_to_expiry}d)</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === 'items' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-th">{t('inventory.sku')}</th>
                  <th className="table-th">{t('inventory.name')}</th>
                  <th className="table-th">{t('inventory.category')}</th>
                  <th className="table-th">{t('inventory.unit')}</th>
                  <th className="table-th text-right">{t('inventory.current_stock')}</th>
                  <th className="table-th text-right">{t('inventory.min_stock')}</th>
                  <th className="table-th text-right">{t('inventory.unit_cost')}</th>
                  <th className="table-th text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && <tr><td colSpan={8} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
                {!loading && items.length === 0 && <tr><td colSpan={8} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
                {items.map((it) => (
                  <tr key={it.id} className={`hover:bg-slate-50 transition-colors ${it.low_stock ? 'bg-rose-50/40' : ''}`}>
                    <td className="table-td font-mono text-xs">{it.sku}</td>
                    <td className="table-td">
                      {it.name}
                      {it.controlled ? <span className="ml-2 badge-red">⚠ C</span> : null}
                    </td>
                    <td className="table-td">{it.category}</td>
                    <td className="table-td">{it.unit}</td>
                    <td className={`table-td text-right font-mono ${it.low_stock ? 'text-rose-600 font-bold' : ''}`}>{it.current_stock}</td>
                    <td className="table-td text-right text-slate-500">{it.min_stock}</td>
                    <td className="table-td text-right font-mono">R$ {Number(it.unit_cost).toFixed(2)}</td>
                    <td className="table-td">
                      <RowActions
                        editTestId={`edit-item-${it.id}`}
                        deleteTestId={`delete-item-${it.id}`}
                        onEdit={() => setItemForm({ open: true, initial: it })}
                        onDelete={() => setDeleting({ kind: 'item', row: it })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'batches' && (
        <BatchesView
          refreshKey={refreshKey}
          onEdit={(b) => setBatchForm({ open: true, initial: b })}
          onDelete={(b) => setDeleting({ kind: 'batch', row: b })}
        />
      )}

      {tab === 'movements' && <MovementsView refreshKey={refreshKey} />}

      {itemForm.open && (
        <ItemForm
          items={items}
          initial={itemForm.initial}
          onClose={() => setItemForm({ open: false, initial: null })}
          onSaved={() => { setItemForm({ open: false, initial: null }); refresh(); }}
        />
      )}
      {batchForm.open && (
        <BatchForm
          items={items}
          initial={batchForm.initial}
          onClose={() => setBatchForm({ open: false, initial: null })}
          onSaved={() => { setBatchForm({ open: false, initial: null }); refresh(); }}
        />
      )}
      {movementOpen && (
        <MovementForm
          items={items}
          onClose={() => setMovementOpen(false)}
          onSaved={() => { setMovementOpen(false); refresh(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={deleting.kind === 'item' ? deleting.row.name : `${deleting.row.item_name} — ${deleting.row.batch_number}`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function BatchesView({ refreshKey, onEdit, onDelete }: {
  refreshKey: number;
  onEdit: (b: any) => void;
  onDelete: (b: any) => void;
}) {
  const { t } = useI18n();
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/api/inventory/batches')
      .then((d) => setBatches(d.batches))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  return (
    <div className="card">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">{t('inventory.batch_number')}</th>
              <th className="table-th">{t('inventory.name')}</th>
              <th className="table-th text-right">{t('common.quantity')}</th>
              <th className="table-th">{t('inventory.expiry_date')}</th>
              <th className="table-th text-right">{t('inventory.cost_per_unit')}</th>
              <th className="table-th text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
            {!loading && batches.length === 0 && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
            {batches.map((b) => {
              const days = Math.floor((new Date(b.expiry_date).getTime() - Date.now()) / 86400000);
              return (
                <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                  <td className="table-td font-mono text-xs">{b.batch_number}</td>
                  <td className="table-td">{b.item_name}</td>
                  <td className="table-td text-right font-mono">{b.quantity}</td>
                  <td className="table-td">
                    <span className={days < 0 ? 'badge-red' : days < 30 ? 'badge-yellow' : 'badge-slate'}>
                      {b.expiry_date} {days < 0 ? '⚠ ' + t('inventory.expired') : days < 30 ? `(${days}d)` : ''}
                    </span>
                  </td>
                  <td className="table-td text-right font-mono">R$ {Number(b.cost_per_unit ?? 0).toFixed(2)}</td>
                  <td className="table-td">
                    <RowActions onEdit={() => onEdit(b)} onDelete={() => onDelete(b)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MovementsView({ refreshKey }: { refreshKey: number }) {
  const { t } = useI18n();
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/api/inventory/movements')
      .then((d) => setMovements(d.movements))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const badge = (type: string) =>
    type === 'in' ? 'badge-green' : type === 'out' ? 'badge-yellow' : type === 'discard' ? 'badge-red' : 'badge-blue';

  return (
    <div className="card">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">{t('common.date')}</th>
              <th className="table-th">{t('inventory.name')}</th>
              <th className="table-th">{t('inventory.movement_type')}</th>
              <th className="table-th text-right">{t('common.quantity')}</th>
              <th className="table-th">{t('inventory.reason')}</th>
              <th className="table-th">{t('team.full_name')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
            {!loading && movements.length === 0 && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
            {movements.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                <td className="table-td whitespace-nowrap text-xs">{m.created_at}</td>
                <td className="table-td">{m.item_name}</td>
                <td className="table-td"><span className={badge(m.movement_type)}>{t(`inventory.movement_${m.movement_type}`)}</span></td>
                <td className="table-td text-right font-mono">{m.quantity}</td>
                <td className="table-td text-xs text-slate-500">{m.reason || '—'}</td>
                <td className="table-td text-xs text-slate-500">{m.user_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemForm({ initial, onClose, onSaved }: { items: any[]; initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => initial ? {
    sku: initial.sku ?? '', name: initial.name ?? '', category: initial.category ?? 'medication',
    unit: initial.unit ?? 'un', anvisa_registry: initial.anvisa_registry ?? '', controlled: !!initial.controlled,
    min_stock: initial.min_stock ?? 0, max_stock: initial.max_stock ?? 0,
    unit_cost: initial.unit_cost ?? 0, sale_price: initial.sale_price ?? 0,
  } : {
    sku: '', name: '', category: 'medication', unit: 'un', anvisa_registry: '', controlled: false,
    min_stock: 0, max_stock: 0, unit_cost: 0, sale_price: 0,
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
      min_stock: Number(form.min_stock), max_stock: Number(form.max_stock),
      unit_cost: Number(form.unit_cost), sale_price: Number(form.sale_price),
      anvisa_registry: form.anvisa_registry || null,
    };
    try {
      if (initial) await api.put(`/api/inventory/items/${initial.id}`, payload);
      else await api.post('/api/inventory/items', payload);
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? `${t('crud.edit')} — ${initial.name}` : t('inventory.new_item')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('inventory.sku')} *</label>
            <input className="input" value={form.sku} onChange={(e) => set('sku', e.target.value)} required data-testid="item-sku" />
          </div>
          <div>
            <label className="label">{t('inventory.category')} *</label>
            <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">{t('inventory.name')} *</label>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required data-testid="item-name" />
          </div>
          <div>
            <label className="label">{t('inventory.unit')} *</label>
            <input className="input" placeholder="un, cx, fr, ml..." value={form.unit} onChange={(e) => set('unit', e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('inventory.anvisa')}</label>
            <input className="input" value={form.anvisa_registry} onChange={(e) => set('anvisa_registry', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('inventory.min_stock')}</label>
            <input type="number" min={0} className="input" value={form.min_stock} onChange={(e) => set('min_stock', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('inventory.max_stock')}</label>
            <input type="number" min={0} className="input" value={form.max_stock} onChange={(e) => set('max_stock', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('inventory.unit_cost')}</label>
            <input type="number" min={0} step={0.01} className="input" value={form.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('inventory.sale_price')}</label>
            <input type="number" min={0} step={0.01} className="input" value={form.sale_price} onChange={(e) => set('sale_price', e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={form.controlled} onChange={(e) => set('controlled', e.target.checked)} />
          {t('inventory.controlled')}
        </label>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function BatchForm({ items, initial, onClose, onSaved }: { items: any[]; initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => initial ? {
    item_id: initial.item_id, batch_number: initial.batch_number ?? '', expiry_date: initial.expiry_date ?? '',
    quantity: initial.quantity ?? 1, cost_per_unit: initial.cost_per_unit ?? 0,
  } : {
    item_id: '', batch_number: '', expiry_date: '', quantity: 1, cost_per_unit: 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (initial) {
        await api.put(`/api/inventory/batches/${initial.id}`, {
          batch_number: form.batch_number, expiry_date: form.expiry_date, cost_per_unit: Number(form.cost_per_unit),
        });
      } else {
        await api.post('/api/inventory/batches', {
          item_id: form.item_id, batch_number: form.batch_number, expiry_date: form.expiry_date,
          quantity: Number(form.quantity), cost_per_unit: Number(form.cost_per_unit),
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
    <Modal title={initial ? `${t('crud.edit')} — ${initial.batch_number}` : t('inventory.new_batch')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <label className="label">{t('inventory.select_item')} *</label>
          <select className="input" value={form.item_id} onChange={(e) => set('item_id', e.target.value)} required disabled={!!initial}>
            <option value="">—</option>
            {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.sku})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('inventory.batch_number')} *</label>
            <input className="input" value={form.batch_number} onChange={(e) => set('batch_number', e.target.value)} required />
          </div>
          <div>
            <label className="label">{t('inventory.expiry_date')} *</label>
            <input type="date" className="input" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} required />
          </div>
          {!initial && (
            <div>
              <label className="label">{t('common.quantity')} *</label>
              <input type="number" min={1} className="input" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} required />
            </div>
          )}
          <div>
            <label className="label">{t('inventory.cost_per_unit')} *</label>
            <input type="number" min={0} step={0.01} className="input" value={form.cost_per_unit} onChange={(e) => set('cost_per_unit', e.target.value)} required />
          </div>
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function MovementForm({ items, onClose, onSaved }: { items: any[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ item_id: '', batch_id: '', movement_type: 'out' as typeof MOVEMENT_TYPES[number], quantity: 1, reason: '' });
  const [batches, setBatches] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.item_id) { setBatches([]); return; }
    api.get(`/api/inventory/batches?item_id=${form.item_id}`)
      .then((d) => setBatches(d.batches.filter((b: any) => b.quantity > 0)))
      .catch(console.error);
  }, [form.item_id]);

  const needsBatch = form.movement_type === 'in' || form.movement_type === 'adjust';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post('/api/inventory/movements', {
        item_id: form.item_id,
        batch_id: form.batch_id || null,
        movement_type: form.movement_type,
        quantity: Number(form.quantity),
        reason: form.reason || null,
      });
      onSaved();
    } catch (err: any) {
      setError(err.body?.error === 'insufficient_stock' ? 'insufficient_stock' : (err.message || t('errors.generic')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('inventory.new_movement')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <label className="label">{t('inventory.select_item')} *</label>
          <select className="input" value={form.item_id} onChange={(e) => setForm((f) => ({ ...f, item_id: e.target.value, batch_id: '' }))} required>
            <option value="">—</option>
            {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({t('inventory.current_stock')}: {it.current_stock})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('inventory.movement_type')} *</label>
            <select className="input" value={form.movement_type} onChange={(e) => set('movement_type', e.target.value)}>
              {MOVEMENT_TYPES.map((m) => <option key={m} value={m}>{t(`inventory.movement_${m}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('common.quantity')} *</label>
            <input type="number" min={1} className="input" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} required />
          </div>
        </div>
        <div>
          <label className="label">{t('inventory.select_batch')}{needsBatch ? ' *' : ''}</label>
          <select className="input" value={form.batch_id} onChange={(e) => set('batch_id', e.target.value)} required={needsBatch}>
            <option value="">—</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_number} — {b.quantity} un (exp {b.expiry_date})</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('inventory.reason')}</label>
          <input className="input" value={form.reason} onChange={(e) => set('reason', e.target.value)} />
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
