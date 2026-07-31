import { useEffect, useState } from 'react';
import { api, apiErrorKey } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Dashboard() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.get('/api/dashboard')
      .then((d) => {
        setData({
          todays_appointments: d.todays_appointments ?? 0,
          patients_total: d.patients_total ?? 0,
          low_stock: d.low_stock ?? 0,
          pending_invoices: d.pending_invoices ?? 0,
          expiring_batches: d.expiring_batches ?? 0,
          open_lgpd_requests: d.open_lgpd_requests ?? 0,
          monthly_revenue: d.monthly_revenue ?? 0,
          upcoming_appointments: Array.isArray(d.upcoming_appointments) ? d.upcoming_appointments : [],
        });
      })
      .catch((e) => {
        console.error(e);
        setData(null);
        setError(t(apiErrorKey(e)));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [locale]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center" data-testid="dashboard-loading">
        <div className="panel-inset px-6 py-4 text-sm text-[#5c6558]">{t('common.loading')}</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4" data-testid="dashboard-error">
        <div
          className="rounded-xl px-4 py-3 text-sm text-[#6e3228]"
          style={{
            background: 'linear-gradient(180deg, #f5e4df, #edd4cd)',
            border: '1px solid rgba(143,74,61,0.35)',
          }}
        >
          {error}
        </div>
        <button type="button" className="btn-primary" onClick={load} data-testid="dashboard-retry">
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (!data) return null;

  const tiles = [
    { key: 'todays_appointments', label: t('dashboard.todays_appointments'), value: data.todays_appointments, tone: 'moss' },
    { key: 'patients_total', label: t('dashboard.patients_total'), value: data.patients_total, tone: 'stone' },
    { key: 'low_stock', label: t('dashboard.low_stock'), value: data.low_stock, tone: 'clay' },
    { key: 'pending_invoices', label: t('dashboard.pending_invoices'), value: data.pending_invoices, tone: 'clay' },
    { key: 'expiring_batches', label: t('dashboard.expiring_batches'), value: data.expiring_batches, tone: 'stone' },
    { key: 'lgpd_requests_open', label: t('dashboard.lgpd_requests_open'), value: data.open_lgpd_requests, tone: 'moss' },
  ];

  const revenue = new Intl.NumberFormat(
    locale === 'pt-BR' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US',
    { style: 'currency', currency: 'BRL' },
  ).format(Number(data.monthly_revenue) || 0);

  const typeLabel = (type: string) => t(`appointments.types.${type}`) !== `appointments.types.${type}`
    ? t(`appointments.types.${type}`)
    : type;
  const statusLabel = (status: string) => t(`appointments.statuses.${status}`) !== `appointments.statuses.${status}`
    ? t(`appointments.statuses.${status}`)
    : status;

  return (
    <div className="space-y-7" data-testid="dashboard">
      <header className="max-w-2xl animate-fade-in-down">
        <h1 className="font-display text-[1.85rem] font-semibold tracking-tight text-[#243328] sm:text-[2.05rem]">
          {t('dashboard.welcome')}
        </h1>
        <p className="mt-1.5 text-sm text-[#5c6558]">
          {t('app.name')} — {t('app.address')}
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tiles.map((c, i) => (
          <div
            key={c.key}
            className={`stat-tile tone-${c.tone} animate-fade-in-up`}
            style={{ animationDelay: `${i * 0.05}s` }}
          >
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.07em] text-[#7a8476]">{c.label}</p>
            <p className="mt-3 font-display text-[1.7rem] font-semibold leading-none tracking-tight text-[#243328]">
              {c.value}
            </p>
          </div>
        ))}
        <div className="stat-tile tone-moss animate-fade-in-up delay-300">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.07em] text-[#7a8476]">
            {t('dashboard.monthly_revenue')}
          </p>
          <p className="mt-3 font-display text-[1.45rem] font-semibold leading-none tracking-tight text-[#243328]">
            {revenue}
          </p>
        </div>
      </section>

      <section className="card overflow-hidden animate-fade-in-up delay-200">
        <div
          className="flex items-center justify-between gap-3 border-b border-[rgba(63,92,66,0.16)] px-5 py-3.5"
          style={{ background: 'linear-gradient(180deg, #f4efe6 0%, #ebe4d8 100%)' }}
        >
          <h2 className="font-display text-lg font-semibold text-[#243328]">
            {t('dashboard.upcoming_appointments')}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">{t('appointments.scheduled_at')}</th>
                <th className="table-th">{t('appointments.patient')}</th>
                <th className="table-th">{t('appointments.practitioner')}</th>
                <th className="table-th">{t('appointments.type')}</th>
                <th className="table-th">{t('appointments.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.upcoming_appointments.length === 0 && (
                <tr>
                  <td colSpan={5} className="table-td text-center text-[#7a8476] py-8">{t('common.no_data')}</td>
                </tr>
              )}
              {data.upcoming_appointments.map((a: any, i: number) => (
                <tr key={i} className="transition-colors hover:bg-[rgba(63,92,66,0.04)]">
                  <td className="table-td font-medium text-[#243328]">{a.scheduled_at}</td>
                  <td className="table-td">{a.patient_name}</td>
                  <td className="table-td">{a.practitioner_name}</td>
                  <td className="table-td">{typeLabel(a.type)}</td>
                  <td className="table-td">
                    <span className={`badge ${a.status === 'confirmed' ? 'badge-green' : 'badge-yellow'}`}>
                      {statusLabel(a.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
