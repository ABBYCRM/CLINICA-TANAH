/**
 * Full anthropometric measurement session — BodyPath field parity, desk UI.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

type FormState = Record<string, string>;

const EMPTY: FormState = {
  height_cm: '', weight_kg: '',
  neck_cm: '', shoulders_cm: '', chest_cm: '', waist_cm: '', abdomen_cm: '', hip_cm: '',
  arm_right_cm: '', arm_left_cm: '', forearm_right_cm: '', forearm_left_cm: '',
  wrist_cm: '', thigh_right_cm: '', thigh_left_cm: '', calf_right_cm: '', calf_left_cm: '', ankle_cm: '',
  body_fat_pct: '', muscle_mass_kg: '', bone_mass_kg: '', visceral_fat_level: '', body_water_pct: '',
  systolic_mmhg: '', diastolic_mmhg: '', heart_rate_bpm: '', spo2_pct: '', temperature_c: '',
  device_label: 'Balança clínica + fita métrica',
  clothing_note: '', posture_note: 'em pé, expiração normal, braços ao lado do corpo',
  fasting_state: 'non_fasting', notes: '',
};

function num(v: string) {
  if (!v.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function Field({ label, value, onChange, required }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <label className="text-xs text-[color:var(--ink-muted)] block">
      {label}{required ? ' *' : ''}
      <input className="input mt-1 w-full" type="number" step="0.1" value={value}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Stat({ label, value, unit }: { label: string; value: any; unit?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--ink-muted)] font-semibold">{label}</div>
      <div className="font-display text-lg tabular-nums text-[color:var(--ink)]">
        {value != null && value !== '' ? value : '—'}
        {value != null && value !== '' && unit ? <span className="text-sm font-body text-[color:var(--ink-muted)] ml-1">{unit}</span> : null}
      </div>
    </div>
  );
}

export default function MeasurementsPanel({
  patientId, latest, onSaved,
}: { patientId: string; latest: any | null; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!latest) return;
    const next = { ...EMPTY };
    for (const k of Object.keys(EMPTY)) {
      const v = latest[k] ?? latest[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
      if (v != null && v !== '') next[k] = String(v);
    }
    if (latest.device_label || latest.deviceLabel) next.device_label = String(latest.device_label || latest.deviceLabel);
    if (latest.fasting_state || latest.fastingState) next.fasting_state = String(latest.fasting_state || latest.fastingState);
    if (latest.notes) next.notes = String(latest.notes);
    setForm(next);
  }, [latest?.id]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const preview = useMemo(() => {
    const h = num(form.height_cm); const w = num(form.weight_kg);
    const waist = num(form.waist_cm); const hip = num(form.hip_cm);
    if (!h || !w) return null;
    return {
      bmi: Number((w / (h / 100) ** 2).toFixed(1)),
      whr: waist && hip ? Number((waist / hip).toFixed(2)) : null,
      whtr: waist ? Number((waist / h).toFixed(2)) : null,
    };
  }, [form]);

  const save = async () => {
    const height_cm = num(form.height_cm); const weight_kg = num(form.weight_kg);
    if (!height_cm || !weight_kg) {
      setMsg(t('body.meas_required'));
      return;
    }
    setBusy(true); setMsg('');
    try {
      const body: any = { height_cm, weight_kg, measured_at: new Date().toISOString(), verified: true };
      for (const [k, v] of Object.entries(form)) {
        if (['height_cm', 'weight_kg', 'device_label', 'clothing_note', 'posture_note', 'fasting_state', 'notes'].includes(k)) continue;
        const n = num(v);
        if (n != null) body[k] = n;
      }
      body.device_label = form.device_label || null;
      body.clothing_note = form.clothing_note || null;
      body.posture_note = form.posture_note || null;
      body.fasting_state = form.fasting_state || 'unknown';
      body.notes = form.notes || null;
      body.waist_cm = num(form.waist_cm) ?? null;
      await api.post(`/api/clinical/body/${patientId}/measurements`, body);
      setMsg(t('body.meas_saved'));
      onSaved();
    } catch (e: any) {
      setMsg(e?.message || t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="body-measurements-full">
      <header>
        <h3 className="crm-record-panel-title !mb-0">{t('body.meas_title')}</h3>
        <p className="text-xs text-[color:var(--ink-muted)] mt-1">{t('body.meas_intro')}</p>
      </header>

      {latest && (
        <section className="crm-record-panel space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.meas_last_set')}</h4>
            {latest.verified ? <span className="badge-green text-[10px]">{t('body.meas_verified')}</span> : null}
          </div>
          <p className="text-xs text-[color:var(--ink-muted)]">{latest.device_label || latest.deviceLabel || '—'}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Stat label={t('body.height')} value={latest.height_cm} unit="cm" />
            <Stat label={t('body.weight')} value={latest.weight_kg} unit="kg" />
            <Stat label={t('body.bmi')} value={latest.bmi} />
            <Stat label="RCQ" value={latest.whr} />
            <Stat label="RCE" value={latest.whtr} />
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] pt-1">{t('body.meas_circ')}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-sm">
            <Stat label={t('body.circ_neck')} value={latest.neck_cm ?? latest.neckCm} unit="cm" />
            <Stat label={t('body.circ_shoulders')} value={latest.shoulders_cm ?? latest.shouldersCm} unit="cm" />
            <Stat label={t('body.circ_chest')} value={latest.chest_cm ?? latest.chestCm} unit="cm" />
            <Stat label={t('body.waist')} value={latest.waist_cm} unit="cm" />
            <Stat label={t('body.circ_abdomen')} value={latest.abdomen_cm ?? latest.abdomenCm} unit="cm" />
            <Stat label={t('body.circ_hip')} value={latest.hip_cm ?? latest.hipCm} unit="cm" />
            <Stat label={t('body.circ_arm')} value={
              (latest.arm_right_cm ?? latest.armRightCm) != null
                ? `${latest.arm_right_cm ?? latest.armRightCm} / ${latest.arm_left_cm ?? latest.armLeftCm ?? '—'}`
                : null
            } unit="cm" />
            <Stat label={t('body.circ_fore')} value={
              (latest.forearm_right_cm ?? latest.forearmRightCm) != null
                ? `${latest.forearm_right_cm ?? latest.forearmRightCm} / ${latest.forearm_left_cm ?? latest.forearmLeftCm ?? '—'}`
                : null
            } unit="cm" />
            <Stat label={t('body.circ_wrist')} value={latest.wrist_cm ?? latest.wristCm} unit="cm" />
            <Stat label={t('body.circ_thigh')} value={
              (latest.thigh_right_cm ?? latest.thighRightCm) != null
                ? `${latest.thigh_right_cm ?? latest.thighRightCm} / ${latest.thigh_left_cm ?? latest.thighLeftCm ?? '—'}`
                : null
            } unit="cm" />
            <Stat label={t('body.circ_calf')} value={
              (latest.calf_right_cm ?? latest.calfRightCm) != null
                ? `${latest.calf_right_cm ?? latest.calfRightCm} / ${latest.calf_left_cm ?? latest.calfLeftCm ?? '—'}`
                : null
            } unit="cm" />
            <Stat label={t('body.circ_ankle')} value={latest.ankle_cm ?? latest.ankleCm} unit="cm" />
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] pt-1">{t('body.meas_comp')}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            <Stat label={t('body.comp_fat')} value={latest.body_fat_pct ?? latest.bodyFatPct} unit="%" />
            <Stat label={t('body.comp_muscle')} value={latest.muscle_mass_kg ?? latest.muscleMassKg} unit="kg" />
            <Stat label={t('body.comp_bone')} value={latest.bone_mass_kg ?? latest.boneMassKg} unit="kg" />
            <Stat label={t('body.comp_visceral')} value={latest.visceral_fat_level ?? latest.visceralFatLevel} />
            <Stat label={t('body.comp_water')} value={latest.body_water_pct ?? latest.bodyWaterPct} unit="%" />
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] pt-1">{t('body.meas_vitals')}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            <Stat label={t('body.vitals_bp')} value={
              (latest.systolic_mmhg ?? latest.systolicMmhg) != null
                ? `${latest.systolic_mmhg ?? latest.systolicMmhg}/${latest.diastolic_mmhg ?? latest.diastolicMmhg}`
                : null
            } unit="mmHg" />
            <Stat label={t('body.vitals_hr')} value={latest.heart_rate_bpm ?? latest.heartRateBpm} unit="bpm" />
            <Stat label="SpO₂" value={latest.spo2_pct ?? latest.spo2Pct} unit="%" />
            <Stat label={t('body.vitals_temp')} value={latest.temperature_c ?? latest.temperatureC} unit="°C" />
          </div>
          <p className="text-[11px] text-[color:var(--ink-muted)]">{t('body.meas_indices_note')}</p>
        </section>
      )}

      <section className="crm-record-panel space-y-4">
        <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.meas_new_session')}</h4>
        <p className="text-xs text-[color:var(--ink-muted)]">{t('body.meas_optional_hint')}</p>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-2">{t('body.meas_base')}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label={t('body.height')} value={form.height_cm} onChange={(v) => set('height_cm', v)} required />
            <Field label={t('body.weight')} value={form.weight_kg} onChange={(v) => set('weight_kg', v)} required />
            <Field label={t('body.waist')} value={form.waist_cm} onChange={(v) => set('waist_cm', v)} />
            <Field label={t('body.circ_hip')} value={form.hip_cm} onChange={(v) => set('hip_cm', v)} />
          </div>
          {preview && (
            <p className="text-xs text-[color:var(--ink-muted)] mt-2">
              {t('body.meas_preview')}: IMC {preview.bmi}
              {preview.whr != null ? ` · RCQ ${preview.whr}` : ''}
              {preview.whtr != null ? ` · RCE ${preview.whtr}` : ''}
            </p>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-2">{t('body.meas_circ')}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <Field label={t('body.circ_neck')} value={form.neck_cm} onChange={(v) => set('neck_cm', v)} />
            <Field label={t('body.circ_shoulders')} value={form.shoulders_cm} onChange={(v) => set('shoulders_cm', v)} />
            <Field label={t('body.circ_chest')} value={form.chest_cm} onChange={(v) => set('chest_cm', v)} />
            <Field label={t('body.circ_abdomen')} value={form.abdomen_cm} onChange={(v) => set('abdomen_cm', v)} />
            <Field label={t('body.circ_arm_r')} value={form.arm_right_cm} onChange={(v) => set('arm_right_cm', v)} />
            <Field label={t('body.circ_arm_l')} value={form.arm_left_cm} onChange={(v) => set('arm_left_cm', v)} />
            <Field label={t('body.circ_fore_r')} value={form.forearm_right_cm} onChange={(v) => set('forearm_right_cm', v)} />
            <Field label={t('body.circ_fore_l')} value={form.forearm_left_cm} onChange={(v) => set('forearm_left_cm', v)} />
            <Field label={t('body.circ_wrist')} value={form.wrist_cm} onChange={(v) => set('wrist_cm', v)} />
            <Field label={t('body.circ_thigh_r')} value={form.thigh_right_cm} onChange={(v) => set('thigh_right_cm', v)} />
            <Field label={t('body.circ_thigh_l')} value={form.thigh_left_cm} onChange={(v) => set('thigh_left_cm', v)} />
            <Field label={t('body.circ_calf_r')} value={form.calf_right_cm} onChange={(v) => set('calf_right_cm', v)} />
            <Field label={t('body.circ_calf_l')} value={form.calf_left_cm} onChange={(v) => set('calf_left_cm', v)} />
            <Field label={t('body.circ_ankle')} value={form.ankle_cm} onChange={(v) => set('ankle_cm', v)} />
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-2">{t('body.meas_comp')}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Field label={t('body.comp_fat')} value={form.body_fat_pct} onChange={(v) => set('body_fat_pct', v)} />
            <Field label={t('body.comp_muscle')} value={form.muscle_mass_kg} onChange={(v) => set('muscle_mass_kg', v)} />
            <Field label={t('body.comp_bone')} value={form.bone_mass_kg} onChange={(v) => set('bone_mass_kg', v)} />
            <Field label={t('body.comp_visceral')} value={form.visceral_fat_level} onChange={(v) => set('visceral_fat_level', v)} />
            <Field label={t('body.comp_water')} value={form.body_water_pct} onChange={(v) => set('body_water_pct', v)} />
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-2">{t('body.meas_vitals')}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Field label={t('body.vitals_sys')} value={form.systolic_mmhg} onChange={(v) => set('systolic_mmhg', v)} />
            <Field label={t('body.vitals_dia')} value={form.diastolic_mmhg} onChange={(v) => set('diastolic_mmhg', v)} />
            <Field label={t('body.vitals_hr')} value={form.heart_rate_bpm} onChange={(v) => set('heart_rate_bpm', v)} />
            <Field label="SpO₂ %" value={form.spo2_pct} onChange={(v) => set('spo2_pct', v)} />
            <Field label={t('body.vitals_temp')} value={form.temperature_c} onChange={(v) => set('temperature_c', v)} />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.meas_device')}
            <input className="input mt-1 w-full" value={form.device_label} onChange={(e) => set('device_label', e.target.value)} />
          </label>
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.meas_fasting')}
            <select className="input mt-1 w-full" value={form.fasting_state} onChange={(e) => set('fasting_state', e.target.value)}>
              <option value="non_fasting">{t('body.meas_non_fasting')}</option>
              <option value="fasting">{t('body.meas_fasting_yes')}</option>
              <option value="unknown">{t('body.meas_unknown')}</option>
            </select>
          </label>
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.meas_clothing')}
            <input className="input mt-1 w-full" value={form.clothing_note} onChange={(e) => set('clothing_note', e.target.value)} />
          </label>
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.meas_posture')}
            <input className="input mt-1 w-full" value={form.posture_note} onChange={(e) => set('posture_note', e.target.value)} />
          </label>
        </div>
        <label className="text-xs text-[color:var(--ink-muted)] block">{t('body.meas_notes')}
          <textarea className="input mt-1 w-full" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>

        <button type="button" className="btn-primary text-sm" disabled={busy} onClick={save} data-testid="meas-save">
          {busy ? '…' : t('common.save')}
        </button>
        {msg && <p className="text-sm text-[color:var(--ink-muted)]">{msg}</p>}
      </section>
    </div>
  );
}
