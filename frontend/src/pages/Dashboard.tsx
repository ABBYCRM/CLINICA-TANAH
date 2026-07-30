import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Dashboard() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/dashboard')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [locale]);

  if (loading) return <div className="text-slate-500">{t('common.loading')}</div>;
  if (!data) return <div className="text-rose-500">{t('errors.generic')}</div>;

  const cards = [
    { key: 'todays_appointments', label: t('dashboard.todays_appointments'), value: data.todays_appointments, color: 'bg-clinic-500', icon: '📅' },
    { key: 'patients_total', label: t('dashboard.patients_total'), value: data.patients_total, color: 'bg-sky-500', icon: '👥' },
    { key: 'low_stock', label: t('dashboard.low_stock'), value: data.low_stock, color: 'bg-amber-500', icon: '⚠️' },
    { key: 'pending_invoices', label: t('dashboard.pending_invoices'), value: data.pending_invoices, color: 'bg-rose-500', icon: '📄' },
    { key: 'expiring_batches', label: t('dashboard.expiring_batches'), value: data.expiring_batches, color: 'bg-orange-500', icon: '⏰' },
    { key: 'lgpd_requests_open', label: t('dashboard.lgpd_requests_open'), value: data.open_lgpd_requests, color: 'bg-purple-500', icon: '🔒' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('dashboard.welcome')}</h1>
        <p className="text-slate-500 text-sm">{t('app.name')} — {t('app.address')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.key} className="card p-5">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-md ${c.color} text-white flex items-center justify-center text-2xl`}>
                {c.icon}
              </div>
              <div>
                <div className="text-sm text-slate-500">{c.label}</div>
                <div className="text-2xl font-bold text-slate-900">{c.value}</div>
              </div>
            </div>
          </div>
        ))}
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-md bg-emerald-500 text-white flex items-center justify-center text-2xl">💵</div>
            <div>
              <div className="text-sm text-slate-500">{t('dashboard.monthly_revenue')}</div>
              <div className="text-2xl font-bold text-slate-900">
                {new Intl.NumberFormat(locale === 'pt-BR' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US', { style: 'currency', currency: 'BRL' }).format(data.monthly_revenue)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="px-5 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800">{t('dashboard.upcoming_appointments')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('appointments.scheduled_at')}</th>
                <th className="table-th">{t('appointments.patient')}</th>
                <th className="table-th">{t('appointments.practitioner')}</th>
                <th className="table-th">{t('appointments.type')}</th>
                <th className="table-th">{t('appointments.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.upcoming_appointments.length === 0 && (
                <tr><td colSpan={5} className="table-td text-center text-slate-400 py-6">{t('common.no_data')}</td></tr>
              )}
              {data.upcoming_appointments.map((a: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="table-td">{a.scheduled_at}</td>
                  <td className="table-td">{a.patient_name}</td>
                  <td className="table-td">{a.practitioner_name}</td>
                  <td className="table-td">{a.type}</td>
                  <td className="table-td">
                    <span className={`badge ${a.status === 'confirmed' ? 'badge-green' : 'badge-yellow'}`}>{a.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
