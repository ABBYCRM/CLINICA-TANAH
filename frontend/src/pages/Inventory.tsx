import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Inventory() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any>({ low_stock: [], expiring_soon: [] });
  const [tab, setTab] = useState<'items' | 'batches' | 'alerts'>('items');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.get('/api/inventory/items'), api.get('/api/inventory/alerts')])
      .then(([its, alts]) => { setItems(its.items); setAlerts(alts); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [locale]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t('inventory.title')}</h1>
        <div className="flex gap-1 bg-slate-100 p-1 rounded">
          {(['items', 'batches', 'alerts'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-sm rounded ${tab === k ? 'bg-white shadow text-clinic-700' : 'text-slate-600'}`}>
              {k === 'items' ? t('inventory.title') : k === 'batches' ? t('inventory.batch') : t('inventory.alerts')}
            </button>
          ))}
        </div>
      </div>

      {tab === 'alerts' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-4">
            <h3 className="font-semibold text-rose-700 mb-3">⚠️ {t('dashboard.low_stock')}</h3>
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
                  <th className="table-th text-right">{t('inventory.unit') === 'Unidade' ? 'Custo' : t('inventory.unit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && <tr><td colSpan={7} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
                {items.map((it) => (
                  <tr key={it.id} className={`hover:bg-slate-50 ${it.low_stock ? 'bg-rose-50/40' : ''}`}>
                    <td className="table-td font-mono text-xs">{it.sku}</td>
                    <td className="table-td">
                      {it.name}
                      {it.controlled ? <span className="ml-2 badge-red">⚠ CONTROLADO</span> : null}
                    </td>
                    <td className="table-td">{it.category}</td>
                    <td className="table-td">{it.unit}</td>
                    <td className={`table-td text-right font-mono ${it.low_stock ? 'text-rose-600 font-bold' : ''}`}>
                      {it.current_stock}
                    </td>
                    <td className="table-td text-right text-slate-500">{it.min_stock}</td>
                    <td className="table-td text-right">
                      R$ {it.unit_cost.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'batches' && <BatchesView />}
    </div>
  );
}

function BatchesView() {
  const { t } = useI18n();
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/inventory/batches?expiring_soon=true')
      .then((d) => setBatches(d.batches))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">{t('inventory.batch')}</th>
              <th className="table-th">{t('inventory.name')}</th>
              <th className="table-th text-right">{t('common.quantity')}</th>
              <th className="table-th">{t('inventory.expiry_date')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={4} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
            {batches.map((b) => {
              const days = Math.floor((new Date(b.expiry_date).getTime() - Date.now()) / 86400000);
              return (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="table-td font-mono text-xs">{b.batch_number}</td>
                  <td className="table-td">{b.item_name}</td>
                  <td className="table-td text-right">{b.quantity}</td>
                  <td className="table-td">
                    <span className={days < 0 ? 'badge-red' : days < 30 ? 'badge-yellow' : 'badge-slate'}>
                      {b.expiry_date} {days < 0 ? '⚠ ' + t('inventory.expired') : days < 30 ? `(${days}d)` : ''}
                    </span>
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
