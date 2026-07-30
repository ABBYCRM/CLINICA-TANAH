import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Appointments() {
  const { t, locale } = useI18n();
  const [appointments, setAppointments] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const from = new Date(Date.now() - 7*86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14*86400000).toISOString().slice(0, 10);
    api.get(`/api/appointments?from=${from}&to=${to}`)
      .then((d) => setAppointments(d.appointments))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [date, locale]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{t('appointments.title')}</h1>
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('appointments.scheduled_at')}</th>
                <th className="table-th">{t('appointments.patient')}</th>
                <th className="table-th">{t('appointments.practitioner')}</th>
                <th className="table-th">{t('appointments.type')}</th>
                <th className="table-th">{t('appointments.source')}</th>
                <th className="table-th">{t('appointments.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && appointments.length === 0 && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
              {appointments.map((a) => {
                const statusColor = a.status === 'confirmed' || a.status === 'completed' ? 'badge-green' :
                  a.status === 'cancelled' || a.status === 'no_show' ? 'badge-red' : 'badge-yellow';
                return (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="table-td whitespace-nowrap">{a.scheduled_at}</td>
                    <td className="table-td">{a.patient_name}</td>
                    <td className="table-td">{a.practitioner_name}</td>
                    <td className="table-td">{a.type}</td>
                    <td className="table-td">
                      <span className="badge-blue">{a.source}</span>
                    </td>
                    <td className="table-td"><span className={statusColor}>{a.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
