import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function Prescriptions() {
  const { t, locale } = useI18n();
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/clinical/prescriptions')
      .then((d) => setPrescriptions(d.prescriptions))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [locale]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{t('prescriptions.title')}</h1>
      <div className="grid gap-3">
        {loading && <div className="text-slate-400 py-6 text-center">{t('common.loading')}</div>}
        {!loading && prescriptions.length === 0 && <div className="card p-6 text-center text-slate-400">{t('common.no_data')}</div>}
        {prescriptions.map((p) => {
          let items: any[] = [];
          try { items = JSON.parse(p.items); } catch {}
          return (
            <div key={p.id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold">{p.patient_name}</div>
                  <div className="text-xs text-slate-500">{p.practitioner_name} • {p.created_at}</div>
                </div>
                {p.sent_via_whatsapp ? (
                  <span className="badge-green">✓ {t('prescriptions.send_via_whatsapp')}</span>
                ) : (
                  <span className="badge-slate">📄 PDF</span>
                )}
              </div>
              <ul className="space-y-1 text-sm">
                {items.map((it, i) => (
                  <li key={i} className="border-l-2 border-clinic-500 pl-3">
                    <span className="font-medium">{it.medication}</span> — {it.dosage}, {it.frequency}, {it.duration}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
