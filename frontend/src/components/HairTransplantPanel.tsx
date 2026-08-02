/**
 * Hair transplant clinical planning — real workspace (notes, scale, photos via documents API).
 * Image simulation generation is out of scope until the img2img pipeline is wired; this panel
 * does not fake generation — it stores assessable clinical plans on the patient record.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

type Props = {
  patientId: string;
  patientName?: string;
};

type PlanDoc = {
  id: string;
  title?: string;
  notes?: string | null;
  doc_type?: string;
  created_at?: string;
  mime_type?: string | null;
  has_file?: boolean;
  can_delete?: boolean;
};

const NORWOOD = ['I', 'II', 'IIA', 'III', 'III_VERTEX', 'IV', 'V', 'VI', 'VII'] as const;
const LUDWIG = ['I', 'II', 'III'] as const;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

export default function HairTransplantPanel({ patientId, patientName }: Props) {
  const { t, locale } = useI18n();
  const [scaleSystem, setScaleSystem] = useState<'norwood' | 'ludwig' | 'other'>('norwood');
  const [scaleValue, setScaleValue] = useState<string>('III');
  const [donorNotes, setDonorNotes] = useState('');
  const [graftEstimate, setGraftEstimate] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [plans, setPlans] = useState<PlanDoc[]>([]);

  const loadPlans = useCallback(async () => {
    try {
      const res = await api.get(`/api/patients/${patientId}/documents`);
      const docs = (res.documents || []) as PlanDoc[];
      setPlans(docs.filter((d) => String(d.doc_type || '') === 'hair_transplant_plan'));
    } catch {
      setPlans([]);
    }
  }, [patientId]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const savePlan = async () => {
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const notesPayload = {
        scale_system: scaleSystem,
        scale_value: scaleValue,
        donor_notes: donorNotes.trim(),
        graft_estimate: graftEstimate.trim(),
        plan_notes: planNotes.trim(),
        patient_name: patientName || null,
        saved_at: new Date().toISOString(),
      };
      const payload: Record<string, unknown> = {
        title: `${t('patients.workspace.hair_transplant_plan_title')} — ${scaleSystem} ${scaleValue}`,
        doc_type: 'hair_transplant_plan',
        status: 'active',
        notes: JSON.stringify(notesPayload),
      };
      if (photo) {
        payload.filename = photo.name;
        payload.mime = photo.type || 'image/jpeg';
        payload.data_base64 = await fileToBase64(photo);
      }
      await api.post(`/api/patients/${patientId}/documents`, payload);
      setMsg(t('patients.workspace.hair_transplant_saved'));
      setDonorNotes('');
      setGraftEstimate('');
      setPlanNotes('');
      setPhoto(null);
      await loadPlans();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const removePlan = async (doc: PlanDoc) => {
    if (!doc?.can_delete) return;
    setBusy(true);
    try {
      await api.del(`/api/patients/${patientId}/documents/${doc.id}`);
      await loadPlans();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const scaleOptions = scaleSystem === 'ludwig' ? LUDWIG : scaleSystem === 'norwood' ? NORWOOD : ['custom'];

  return (
    <div className="px-4 py-6 space-y-6" data-testid="workspace-hair-transplant">
      <div>
        <h3 className="font-semibold text-sm text-[var(--ink)]">
          {t('patients.workspace.hair_transplant_heading')}
        </h3>
        <p className="text-xs text-[var(--ink-muted)] mt-1 max-w-2xl">
          {t('patients.workspace.hair_transplant_hint')}
        </p>
        {patientName ? (
          <p className="text-[11px] font-mono text-[var(--ink-muted)] mt-1">{patientName}</p>
        ) : null}
      </div>

      <div className="space-y-4 max-w-xl" data-testid="hair-transplant-plan-form">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-xs space-y-1">
            <span className="text-[var(--ink-muted)]">{t('patients.workspace.hair_transplant_scale_system')}</span>
            <select
              className="input"
              value={scaleSystem}
              onChange={(e) => {
                const v = e.target.value as 'norwood' | 'ludwig' | 'other';
                setScaleSystem(v);
                setScaleValue(v === 'ludwig' ? 'I' : v === 'norwood' ? 'III' : '');
              }}
              data-testid="hair-scale-system"
            >
              <option value="norwood">Norwood-Hamilton</option>
              <option value="ludwig">Ludwig</option>
              <option value="other">{t('patients.workspace.hair_transplant_scale_other')}</option>
            </select>
          </label>
          <label className="block text-xs space-y-1">
            <span className="text-[var(--ink-muted)]">{t('patients.workspace.hair_transplant_scale_value')}</span>
            {scaleSystem === 'other' ? (
              <input
                className="input"
                value={scaleValue}
                onChange={(e) => setScaleValue(e.target.value)}
                data-testid="hair-scale-value"
              />
            ) : (
              <select
                className="input"
                value={scaleValue}
                onChange={(e) => setScaleValue(e.target.value)}
                data-testid="hair-scale-value"
              >
                {scaleOptions.map((o) => (
                  <option key={o} value={o}>{o.replace('_', '-')}</option>
                ))}
              </select>
            )}
          </label>
        </div>

        <label className="block text-xs space-y-1">
          <span className="text-[var(--ink-muted)]">{t('patients.workspace.hair_transplant_donor')}</span>
          <textarea
            className="input min-h-[4.5rem]"
            value={donorNotes}
            onChange={(e) => setDonorNotes(e.target.value)}
            data-testid="hair-donor-notes"
          />
        </label>

        <label className="block text-xs space-y-1">
          <span className="text-[var(--ink-muted)]">{t('patients.workspace.hair_transplant_grafts')}</span>
          <input
            className="input"
            value={graftEstimate}
            onChange={(e) => setGraftEstimate(e.target.value)}
            data-testid="hair-graft-estimate"
          />
        </label>

        <label className="block text-xs space-y-1">
          <span className="text-[var(--ink-muted)]">{t('patients.workspace.hair_transplant_plan_notes')}</span>
          <textarea
            className="input min-h-[5.5rem]"
            value={planNotes}
            onChange={(e) => setPlanNotes(e.target.value)}
            data-testid="hair-plan-notes"
          />
        </label>

        <label className="block text-xs space-y-1">
          <span className="text-[var(--ink-muted)]">{t('patients.workspace.hair_transplant_photo')}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="block w-full text-xs"
            onChange={(e) => setPhoto(e.target.files?.[0] || null)}
            data-testid="hair-photo-input"
          />
        </label>

        {error ? <p className="text-xs text-red-700" data-testid="hair-error">{error}</p> : null}
        {msg ? <p className="text-xs text-emerald-800" data-testid="hair-msg">{msg}</p> : null}

        <button
          type="button"
          className="btn-primary text-sm"
          disabled={busy || (!planNotes.trim() && !donorNotes.trim() && !photo && !graftEstimate.trim())}
          onClick={savePlan}
          data-testid="hair-transplant-save"
        >
          {busy ? t('common.saving') : t('patients.workspace.hair_transplant_save')}
        </button>
      </div>

      <div className="space-y-2" data-testid="hair-transplant-history">
        <h4 className="text-sm font-medium text-[var(--ink)]">
          {t('patients.workspace.hair_transplant_history')}
        </h4>
        {plans.length === 0 ? (
          <p className="text-xs text-[var(--ink-muted)]">{t('common.no_data')}</p>
        ) : (
          <ul className="space-y-2">
            {plans.map((p) => {
              let parsed: any = null;
              try { parsed = p.notes ? JSON.parse(p.notes) : null; } catch { /* plain notes */ }
              const when = p.created_at
                ? new Date(p.created_at).toLocaleString(locale === 'en' ? 'en-US' : locale === 'es' ? 'es-ES' : 'pt-BR')
                : '';
              return (
                <li
                  key={p.id}
                  className="border-b border-[var(--edge-soft)] py-2 flex items-start justify-between gap-3"
                  data-testid="hair-plan-row"
                >
                  <div className="min-w-0 text-xs space-y-0.5">
                    <p className="font-medium text-[var(--ink)] truncate">{p.title}</p>
                    <p className="text-[var(--ink-muted)]">{when}</p>
                    {parsed ? (
                      <p className="text-[var(--ink-muted)]">
                        {parsed.scale_system} {parsed.scale_value}
                        {parsed.graft_estimate ? ` · ${parsed.graft_estimate}` : ''}
                      </p>
                    ) : null}
                  </div>
                  {p.can_delete ? (
                    <button
                      type="button"
                      className="btn-secondary text-[11px] shrink-0"
                      disabled={busy}
                      onClick={() => removePlan(p)}
                      data-testid="hair-plan-remove"
                    >
                      {t('common.delete')}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
