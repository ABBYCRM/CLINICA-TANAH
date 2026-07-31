import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

interface RxItem { medication: string; dosage: string; frequency: string; duration: string; instructions?: string; }

function parseItems(v: any): RxItem[] {
  try { return JSON.parse(v); } catch { return []; }
}

export default function Prescriptions() {
  const { t, locale } = useI18n();
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/api/clinical/prescriptions')
      .then((d) => setPrescriptions(d.prescriptions))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/clinical/prescriptions/${deleting.id}`);
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
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#3a342c]">{t('prescriptions.title')}</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary" data-testid="new-prescription">
          + {t('prescriptions.new')}
        </button>
      </div>

      {error && <FormError message={error} />}

      <div className="grid gap-3">
        {loading && <div className="text-slate-400 py-6 text-center">{t('common.loading')}</div>}
        {!loading && prescriptions.length === 0 && <div className="card p-6 text-center text-slate-400">{t('common.no_data')}</div>}
        {prescriptions.map((p) => {
          const items = parseItems(p.items);
          return (
            <div key={p.id} className="card p-4">
              <div className="flex items-center justify-between mb-2 gap-2">
                <div>
                  <div className="font-semibold">{p.patient_name}</div>
                  <div className="text-xs text-slate-500">{p.practitioner_name} • {p.created_at}</div>
                </div>
                <div className="flex items-center gap-2">
                  {p.sent_via_whatsapp ? (
                    <span className="badge-green">✓ {t('prescriptions.send_via_whatsapp')}</span>
                  ) : (
                    <span className="badge-slate">PDF</span>
                  )}
                  <RowActions
                    onEdit={() => { setEditing(p); setShowForm(true); }}
                    onDelete={() => setDeleting(p)}
                  />
                </div>
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

      {showForm && (
        <PrescriptionForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={`${deleting.patient_name} — ${deleting.created_at}`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

const emptyItem: RxItem = { medication: '', dosage: '', frequency: '', duration: '', instructions: '' };

function PrescriptionForm({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [encounters, setEncounters] = useState<any[]>([]);
  const [encounterId, setEncounterId] = useState(initial?.encounter_id ?? '');
  const [items, setItems] = useState<RxItem[]>(initial ? parseItems(initial.items) : [{ ...emptyItem }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/clinical/encounters').then((d) => setEncounters(d.encounters)).catch(console.error);
  }, []);

  const setItem = (i: number, k: keyof RxItem, v: string) =>
    setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, [k]: v } : it));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const clean = items.filter((it) => it.medication.trim());
    if (!clean.length) { setError(t('prescriptions.medication') + ' *'); return; }
    setSaving(true);
    try {
      if (initial) {
        await api.put(`/api/clinical/prescriptions/${initial.id}`, { items: clean });
      } else {
        const enc = encounters.find((x) => x.id === encounterId);
        if (!enc) { setError(t('prescriptions.encounter') + ' *'); setSaving(false); return; }
        await api.post('/api/clinical/prescriptions', {
          encounter_id: enc.id, patient_id: enc.patient_id, practitioner_id: enc.practitioner_id, items: clean,
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
    <Modal title={initial ? `${t('crud.edit')} — ${initial.patient_name}` : t('prescriptions.new')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
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
            <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2 bg-slate-50/60">
              <div className="flex items-center justify-between gap-2">
                <input className="input flex-1" placeholder={t('prescriptions.medication') + ' *'} value={it.medication}
                  onChange={(e) => setItem(i, 'medication', e.target.value)} required={i === 0} />
                {items.length > 1 && (
                  <button type="button" onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors" aria-label="Remove item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input className="input" placeholder={t('prescriptions.dosage')} value={it.dosage} onChange={(e) => setItem(i, 'dosage', e.target.value)} />
                <input className="input" placeholder={t('prescriptions.frequency')} value={it.frequency} onChange={(e) => setItem(i, 'frequency', e.target.value)} />
                <input className="input" placeholder={t('prescriptions.duration')} value={it.duration} onChange={(e) => setItem(i, 'duration', e.target.value)} />
              </div>
              <input className="input" placeholder={t('prescriptions.instructions')} value={it.instructions ?? ''} onChange={(e) => setItem(i, 'instructions', e.target.value)} />
            </div>
          ))}
        </div>

        <button type="button" onClick={() => setItems((arr) => [...arr, { ...emptyItem }])} className="btn-secondary text-sm">
          + {t('prescriptions.add_item')}
        </button>

        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
