import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Encounters() {
  const { t, locale } = useI18n();
  const [encounters, setEncounters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/clinical/encounters')
      .then((d) => setEncounters(d.encounters))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [locale]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{t('encounters.title')}</h1>
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('common.date')}</th>
                <th className="table-th">{t('appointments.patient')}</th>
                <th className="table-th">{t('appointments.practitioner')}</th>
                <th className="table-th">{t('encounters.assessment')}</th>
                <th className="table-th">{t('encounters.icd10')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={5} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && encounters.length === 0 && <tr><td colSpan={5} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
              {encounters.map((e) => {
                let codes: string[] = [];
                try { codes = e.icd10_codes ? JSON.parse(e.icd10_codes) : []; } catch {}
                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="table-td whitespace-nowrap">{e.started_at}</td>
                    <td className="table-td">{e.patient_name}</td>
                    <td className="table-td">{e.practitioner_name}</td>
                    <td className="table-td">{e.assessment || '—'}</td>
                    <td className="table-td"><span className="badge-blue">{codes.join(', ') || '—'}</span></td>
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
