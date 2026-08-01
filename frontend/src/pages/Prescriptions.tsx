import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

interface RxItem { medication: string; dosage: string; frequency: string; duration: string; instructions?: string; }

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

export default function Prescriptions() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<RxTab>('active');
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [counts, setCounts] = useState({ active: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState<any | null>(null);
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

      <div className="flex flex-wrap gap-1 border-b border-[rgba(176,183,192,0.35)]">
        <button
          type="button"
          className={`crm-feed-tab ${tab === 'active' ? 'is-active' : ''}`}
          data-testid="rx-tab-active"
          onClick={() => setTab('active')}
        >
          {t('prescriptions.tab_active')}
          <span className="ml-1.5 tabular-nums text-[color:var(--ink-muted)]">{counts.active}</span>
        </button>
        <button
          type="button"
          className={`crm-feed-tab ${tab === 'cancelled' ? 'is-active' : ''}`}
          data-testid="rx-tab-cancelled"
          onClick={() => setTab('cancelled')}
        >
          {t('prescriptions.tab_cancelled')}
          <span className="ml-1.5 tabular-nums text-[color:var(--ink-muted)]">{counts.cancelled}</span>
        </button>
      </div>

      {tab === 'cancelled' && (
        <p className="text-xs text-[color:var(--ink-muted)] leading-relaxed max-w-3xl rounded-lg px-3 py-2"
          style={{ background: 'linear-gradient(180deg,#f7f1e6,#efe6d8)', border: '1px solid rgba(176,183,192,0.45)' }}>
          {t('prescriptions.retention_notice')}
        </p>
      )}

      {error && <FormError message={error} />}

      <div className="grid gap-3">
        {loading && <div className="text-[color:var(--ink-muted)] py-6 text-center">{t('common.loading')}</div>}
        {!loading && prescriptions.length === 0 && (
          <div className="card p-6 text-center text-[color:var(--ink-muted)]">{t('common.no_data')}</div>
        )}
        {prescriptions.map((p) => {
          const items = parseItems(p.items);
          const cancelled = (p.status || 'active') === 'cancelled';
          return (
            <div
              key={p.id}
              className={`card p-4 ${cancelled ? 'opacity-90' : ''}`}
              data-testid={`rx-card-${p.id}`}
              data-status={p.status || 'active'}
            >
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-[color:var(--ink)]">{p.patient_name}</div>
                  <div className="text-xs text-[color:var(--ink-muted)]">
                    {p.practitioner_name} • {fmtWhen(p.created_at, locale)}
                  </div>
                  {cancelled && (
                    <div className="text-[11px] text-[#8b3a2a] mt-1">
                      {t('prescriptions.cancelled_meta', {
                        when: fmtWhen(p.cancelled_at, locale),
                        by: p.cancelled_by_name || '—',
                      })}
                      {p.cancel_reason ? ` · ${p.cancel_reason}` : ''}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {cancelled ? (
                    <span className="badge-red">{t('prescriptions.status_cancelled')}</span>
                  ) : p.sent_via_whatsapp ? (
                    <span className="badge-green">✓ {t('prescriptions.send_via_whatsapp')}</span>
                  ) : (
                    <span className="badge-slate">PDF</span>
                  )}
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
              <ul className={`space-y-1 text-sm ${cancelled ? 'line-through decoration-[rgba(90,40,30,0.35)]' : ''}`}>
                {items.map((it, i) => (
                  <li key={i} className="border-l-2 border-[color:var(--brass)] pl-3">
                    <span className="font-medium">{it.medication}</span>
                    {(it.dosage || it.frequency || it.duration) ? (
                      <> — {[it.dosage, it.frequency, it.duration].filter(Boolean).join(', ')}</>
                    ) : null}
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
      setError(err.body?.message || err.message || t('errors.generic'));
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
            <div key={i} className="rounded-xl border border-[rgba(176,183,192,0.45)] p-3 space-y-2" style={{ background: 'linear-gradient(180deg,#fbf7f0,#f3ebe0)' }}>
              <div className="flex items-center justify-between gap-2">
                <input className="input flex-1" placeholder={t('prescriptions.medication') + ' *'} value={it.medication}
                  onChange={(e) => setItem(i, 'medication', e.target.value)} required={i === 0} />
                {items.length > 1 && (
                  <button type="button" onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
                    className="rounded-lg p-1.5 text-[color:var(--ink-muted)] hover:bg-[#f8e8e2] hover:text-[#8b3a2a] transition-colors" aria-label="Remove item">
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
