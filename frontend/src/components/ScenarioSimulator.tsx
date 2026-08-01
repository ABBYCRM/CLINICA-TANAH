/**
 * Body Composition Image Simulator — BodyPath parity, Clínica Tanah desk UI.
 * Interventions · adherence · if/then envelope · illustrative generation · inspector
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

const HORIZONS = [4, 8, 12, 24, 52, 54];
const ADHERENCE = ['low', 'moderate', 'high'] as const;

function useAuthBlob(url: string | null, deps: any[]) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    if (!url) { setSrc(null); return; }
    (async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) throw new Error('img');
        const blob = await res.blob();
        if (cancelled) return;
        revoke = URL.createObjectURL(blob);
        setSrc(revoke);
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return src;
}

function Thumb({ url, label }: { url: string | null; label: string }) {
  const src = useAuthBlob(url, [url]);
  return (
    <div className="rounded-md overflow-hidden border border-[rgba(176,183,192,0.45)] bg-[#efe6d8] aspect-[3/4]">
      {src ? <img src={src} alt={label} className="w-full h-full object-cover" /> : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-[color:var(--ink-muted)] px-1 text-center">{label}</div>
      )}
    </div>
  );
}

function ScenarioCard({ patientId, scenario, onRefresh }: { patientId: string; scenario: any; onRefresh: () => void }) {
  const { t } = useI18n();
  const src = useAuthBlob(
    scenario.has_image || scenario.image_url
      ? `/api/clinical/body/${patientId}/scenarios/${scenario.id}/image`
      : null,
    [patientId, scenario.id, scenario.has_image, scenario.status, scenario.updated_at],
  );
  useEffect(() => {
    if (scenario.status !== 'pending' && scenario.status !== 'generating') return;
    const tmr = setInterval(onRefresh, 5000);
    return () => clearInterval(tmr);
  }, [scenario.status, onRefresh]);
  return (
    <div className="crm-timeline-card overflow-hidden p-0" data-testid={`body-scenario-${scenario.id}`}>
      {src ? (
        <img src={src} alt="" className="w-full aspect-[3/4] object-cover" />
      ) : (
        <div className="aspect-[3/4] bg-[#efe6d8] flex items-center justify-center text-xs text-[color:var(--ink-muted)] px-3 text-center">
          {scenario.status === 'failed' ? (scenario.error || t('body.failed')) : t('body.generating')}
        </div>
      )}
      <div className="px-2 py-2 space-y-0.5">
        <div className="text-sm font-medium truncate">{scenario.title}</div>
        <div className="text-[11px] text-[color:var(--ink-muted)]">
          {scenario.review_status || 'pending_review'} · {scenario.status}
          {scenario.horizon_weeks || scenario.weeks ? ` · ${scenario.horizon_weeks || scenario.weeks}w` : ''}
        </div>
      </div>
    </div>
  );
}

export default function ScenarioSimulator({
  patientId,
  data,
  onRefresh,
  onNavigate,
}: {
  patientId: string;
  data: any;
  onRefresh: () => void;
  onNavigate?: (tab: string) => void;
}) {
  const { t } = useI18n();
  const summary = data?.clinical_summary || {};
  const latest = data?.latest_measurement || null;
  const session = data?.active_capture_session || null;
  const medications = data?.medications || [];
  const plans = data?.plans || [];
  const consents = data?.consents || {};
  const scenarios = data?.scenarios || [];

  const nutrition = plans.filter((p: any) => (p.plan_type || 'nutrition') === 'nutrition');
  const exercise = plans.filter((p: any) => p.plan_type === 'exercise');

  const [medIds, setMedIds] = useState<string[]>([]);
  const [nutIds, setNutIds] = useState<string[]>([]);
  const [exIds, setExIds] = useState<string[]>([]);
  const [horizon, setHorizon] = useState(12);
  const [medAdh, setMedAdh] = useState<typeof ADHERENCE[number]>('moderate');
  const [nutAdh, setNutAdh] = useState<typeof ADHERENCE[number]>('moderate');
  const [exAdh, setExAdh] = useState<typeof ADHERENCE[number]>('moderate');
  const [resistDays, setResistDays] = useState(3);
  const [cardioDays, setCardioDays] = useState(2);
  const [magnitude, setMagnitude] = useState<'conservative' | 'moderate'>('conservative');
  const [protein, setProtein] = useState(true);
  const [sleep, setSleep] = useState(true);
  const [hydration, setHydration] = useState(true);
  const [recovery, setRecovery] = useState(true);
  const [comorbidity, setComorbidity] = useState(true);
  const [dailyCalories, setDailyCalories] = useState('');
  const [deficitKcal, setDeficitKcal] = useState('');
  const [envelope, setEnvelope] = useState<any | null>(null);
  const [pinned, setPinned] = useState<any | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setMedIds(medications.filter((m: any) => m.status === 'active').map((m: any) => m.id));
    setNutIds(nutrition.map((p: any) => p.id));
    setExIds(exercise.map((p: any) => p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.medications?.length, data?.plans?.length]);

  const toggle = (list: string[], id: string, setter: (v: string[]) => void) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const planConfig = useMemo(() => ({
    medication_record_ids: medIds,
    nutrition_plan_ids: nutIds,
    exercise_plan_ids: exIds,
    medication_adherence: medAdh,
    nutrition_adherence: nutAdh,
    exercise_adherence: exAdh,
    resistance_days_per_week: resistDays,
    cardio_days_per_week: cardioDays,
    protein_emphasis: protein,
    daily_calories: dailyCalories ? Number(dailyCalories) : null,
    deficit_kcal: deficitKcal ? Number(deficitKcal) : null,
  }), [medIds, nutIds, exIds, medAdh, nutAdh, exAdh, resistDays, cardioDays, protein, dailyCalories, deficitKcal]);

  const assumptions = useMemo(() => ({
    sleep_adequate: sleep,
    hydration_adequate: hydration,
    recovery_adequate: recovery,
    comorbidity_stable: comorbidity,
    change_magnitude: magnitude,
  }), [sleep, hydration, recovery, comorbidity, magnitude]);

  const calcEnvelope = async () => {
    setBusy('preview'); setError('');
    try {
      const res = await api.post(`/api/clinical/body/${patientId}/scenarios/preview`, {
        horizon_weeks: horizon,
        plan_config: planConfig,
        assumptions,
        sleep_adequate: sleep,
        hydration_adequate: hydration,
        recovery_adequate: recovery,
        comorbidity_stable: comorbidity,
        change_magnitude: magnitude,
      });
      setEnvelope(res.execution_plan);
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  const generate = async () => {
    setBusy('generate'); setError('');
    try {
      const frontId = session?.assets?.front?.id || null;
      await api.post(`/api/clinical/body/${patientId}/scenarios`, {
        title: t('body.scenario_default_title'),
        goal: t('body.scenario_default_goal'),
        weeks: horizon,
        horizon_weeks: horizon,
        capture_id: frontId,
        capture_session_id: session?.id || null,
        generate: true,
        photorealism: true,
        plan_config: planConfig,
        assumptions,
        sleep_adequate: sleep,
        hydration_adequate: hydration,
        recovery_adequate: recovery,
        comorbidity_stable: comorbidity,
        change_magnitude: magnitude,
      });
      onRefresh();
    } catch (e: any) {
      setError(e?.body?.message || e?.message || t('body.simulations_blocked'));
    } finally {
      setBusy('');
    }
  };

  const qualityFront = session?.assets?.front?.quality || session?.quality_summary?.front || null;
  const views = ['front', 'left', 'right', 'back'] as const;

  return (
    <div className="space-y-4" data-testid="body-scenarios-full">
      <header className="space-y-2">
        <h3 className="crm-record-panel-title !mb-0">{t('body.sim_title')}</h3>
        <p className="text-sm text-[color:var(--ink)] leading-relaxed">{t('body.sim_intro')}</p>
        <p className="text-xs text-[color:var(--ink-muted)] leading-relaxed">{t('body.sim_audience')}</p>
        <p className="text-xs text-[#8b3a2a] leading-relaxed">{t('body.sim_disclaimer')}</p>
        <p className="text-[11px] text-[color:var(--ink-muted)]">{t('body.sim_flow')}</p>
      </header>

      <nav className="flex flex-wrap gap-1 text-xs text-[color:var(--ink-muted)]">
        {(['capture', 'measurements', 'medications', 'lifestyle'] as const).map((tab, i) => (
          <span key={tab} className="inline-flex items-center gap-1">
            {i > 0 && <span>·</span>}
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => onNavigate?.(tab)}>
              {t(`body.tabs.${tab === 'lifestyle' ? 'lifestyle' : tab}`)}
            </button>
          </span>
        ))}
      </nav>

      <section className="crm-inset-panel space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.sim_baseline')}</h4>
          {session?.assets?.front ? (
            <span className="badge-green text-[10px]">{t('body.sim_photos_ready')}</span>
          ) : (
            <span className="badge-slate text-[10px]">{t('body.sim_photos_missing')}</span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--ink-muted)] font-semibold">Weight</div>
            <div className="font-display text-xl tabular-nums">{summary.weight_kg ?? latest?.weight_kg ?? '—'} <span className="text-sm">kg</span></div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--ink-muted)] font-semibold">Body fat</div>
            <div className="font-display text-xl tabular-nums">{summary.body_fat_pct ?? latest?.body_fat_pct ?? '—'}{summary.body_fat_pct != null || latest?.body_fat_pct != null ? '%' : ''}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--ink-muted)] font-semibold">Waist</div>
            <div className="font-display text-xl tabular-nums">{summary.waist_cm ?? latest?.waist_cm ?? '—'} <span className="text-sm">cm</span></div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--ink-muted)] font-semibold">BMI</div>
            <div className="font-display text-xl tabular-nums">{summary.bmi ?? latest?.bmi ?? '—'}</div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 max-w-md">
          {views.map((v) => (
            <div key={v}>
              <Thumb
                url={session?.assets?.[v]?.preview_url || (session?.id
                  ? `/api/clinical/body/${patientId}/capture-sessions/${session.id}/assets/${v}/image`
                  : null)}
                label={t(`body.views.${v}`)}
              />
              <div className="text-[10px] text-center text-[color:var(--ink-muted)] mt-1">{v}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="crm-inset-panel space-y-3">
        <h4 className="font-display text-base text-[color:var(--ink)]">1. {t('body.sim_interventions')}</h4>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-2">{t('body.sim_meds')}</div>
          <ul className="space-y-1.5">
            {medications.filter((m: any) => m.status !== 'inactive').map((m: any) => (
              <li key={m.id}>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={medIds.includes(m.id)} onChange={() => toggle(medIds, m.id, setMedIds)} />
                  <span>
                    <span className="font-medium">{m.name}</span>
                    <span className="block text-[11px] text-[color:var(--ink-muted)]">
                      {m.confirmation || 'clinician_confirmed'}{m.class_tag ? ` · ${m.class_tag}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
            {!medications.length && <li className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_no_meds')}</li>}
          </ul>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-2">{t('body.sim_nutrition')}</div>
          <ul className="space-y-1.5">
            {nutrition.map((p: any) => (
              <li key={p.id}>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={nutIds.includes(p.id)} onChange={() => toggle(nutIds, p.id, setNutIds)} />
                  <span className="font-medium">{p.title}</span>
                </label>
              </li>
            ))}
            {!nutrition.length && <li className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_no_plans')}</li>}
          </ul>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-2">{t('body.sim_exercise')}</div>
          <ul className="space-y-1.5">
            {exercise.map((p: any) => (
              <li key={p.id}>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={exIds.includes(p.id)} onChange={() => toggle(exIds, p.id, setExIds)} />
                  <span className="font-medium">{p.title}</span>
                </label>
              </li>
            ))}
            {!exercise.length && <li className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_no_plans')}</li>}
          </ul>
        </div>
      </section>

      <section className="crm-inset-panel space-y-3">
        <h4 className="font-display text-base text-[color:var(--ink)]">2. {t('body.sim_horizon_habits')}</h4>
        <div className="flex flex-wrap gap-1.5">
          {HORIZONS.map((w) => (
            <button
              key={w}
              type="button"
              className={`crm-feed-tab ${horizon === w ? 'is-active' : ''}`}
              onClick={() => setHorizon(w)}
            >
              {w}w
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-3 gap-2">
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_adh_med')}
            <select className="input mt-1 w-full" value={medAdh} onChange={(e) => setMedAdh(e.target.value as any)}>
              {ADHERENCE.map((a) => <option key={a} value={a}>{t(`body.adh_${a}`)}</option>)}
            </select>
          </label>
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_adh_nut')}
            <select className="input mt-1 w-full" value={nutAdh} onChange={(e) => setNutAdh(e.target.value as any)}>
              {ADHERENCE.map((a) => <option key={a} value={a}>{t(`body.adh_${a}`)}</option>)}
            </select>
          </label>
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_adh_ex')}
            <select className="input mt-1 w-full" value={exAdh} onChange={(e) => setExAdh(e.target.value as any)}>
              {ADHERENCE.map((a) => <option key={a} value={a}>{t(`body.adh_${a}`)}</option>)}
            </select>
          </label>
        </div>

        <div className="grid sm:grid-cols-3 gap-2">
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_resist')}
            <input className="input mt-1 w-full" type="number" min={0} max={7} value={resistDays} onChange={(e) => setResistDays(Number(e.target.value) || 0)} />
          </label>
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_cardio')}
            <input className="input mt-1 w-full" type="number" min={0} max={7} value={cardioDays} onChange={(e) => setCardioDays(Number(e.target.value) || 0)} />
          </label>
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_magnitude')}
            <select className="input mt-1 w-full" value={magnitude} onChange={(e) => setMagnitude(e.target.value as any)}>
              <option value="conservative">{t('body.sim_mag_conservative')}</option>
              <option value="moderate">{t('body.sim_mag_moderate')}</option>
            </select>
          </label>
        </div>

        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_calories')}
            <input className="input mt-1 w-full" type="number" min={800} max={6000} value={dailyCalories}
              onChange={(e) => setDailyCalories(e.target.value)} placeholder={t('body.sim_calories_ph')} data-testid="sim-calories" />
          </label>
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_deficit')}
            <input className="input mt-1 w-full" type="number" min={0} max={1500} value={deficitKcal}
              onChange={(e) => setDeficitKcal(e.target.value)} placeholder="500" data-testid="sim-deficit" />
          </label>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {([
            ['protein', protein, setProtein, t('body.sim_protein')],
            ['sleep', sleep, setSleep, t('body.sim_sleep')],
            ['hydration', hydration, setHydration, t('body.sim_hydration')],
            ['recovery', recovery, setRecovery, t('body.sim_recovery')],
            ['comorbidity', comorbidity, setComorbidity, t('body.sim_comorbidity')],
          ] as const).map(([key, val, setter, label]) => (
            <label key={key} className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={val} onChange={(e) => setter(e.target.checked)} />
              {label}
            </label>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn-secondary text-sm" disabled={busy === 'preview'} onClick={calcEnvelope} data-testid="sim-calc">
            {busy === 'preview' ? '…' : t('body.sim_calc')}
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={!envelope}
            onClick={() => setPinned(envelope)}
          >
            {t('body.sim_pin')}
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy === 'generate' || !data?.simulations_allowed}
            onClick={generate}
            data-testid="sim-generate"
          >
            {busy === 'generate' ? t('body.generating') : t('body.sim_generate')}
          </button>
        </div>
        {error && <p className="text-sm text-[#8b3a2a]">{error}</p>}
        {!data?.simulations_allowed && (
          <p className="text-sm text-[#8b3a2a] bg-[#f8e8e2] rounded-lg px-3 py-2">{t('body.simulations_blocked')}</p>
        )}
      </section>

      {(envelope || pinned) && (
        <section className="crm-inset-panel space-y-2">
          <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.sim_envelope')}</h4>
          {(envelope || pinned)?.blockers?.length > 0 && (
            <ul className="text-sm text-[#8b3a2a] list-disc pl-4">
              {(envelope || pinned).blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}
            </ul>
          )}
          <p className="text-sm text-[color:var(--ink)]">{(envelope || pinned)?.summary}</p>
          <p className="text-[11px] text-[color:var(--ink-muted)]">{(envelope || pinned)?.identity_locks}</p>
          <ul className="space-y-1.5 pt-1">
            {((envelope || pinned)?.rules || []).filter((r: any) => r.applied).map((r: any) => (
              <li key={r.id} className="text-xs border-l-2 border-[color:var(--brass)] pl-2">
                <span className="font-medium">IF</span> {r.if} → <span className="font-medium">THEN</span> {r.then}
                <span className="text-[color:var(--ink-muted)]"> ({r.silhouette_delta_pct?.toFixed?.(1) ?? r.silhouette_delta_pct}%)</span>
              </li>
            ))}
          </ul>
          {(envelope || pinned)?.projected && (
            <div className="flex flex-wrap gap-4 text-sm pt-1">
              <span>→ {t('body.weight')}: <strong className="tabular-nums">{(envelope || pinned).projected.weight_kg ?? '—'}</strong> kg</span>
              <span>{t('body.waist')}: <strong className="tabular-nums">{(envelope || pinned).projected.waist_cm ?? '—'}</strong> cm</span>
              <span>IMC: <strong className="tabular-nums">{(envelope || pinned).projected.bmi ?? '—'}</strong></span>
              {(envelope || pinned).projected.body_fat_pct != null && (
                <span>%G: <strong className="tabular-nums">{(envelope || pinned).projected.body_fat_pct}</strong></span>
              )}
            </div>
          )}
          {(envelope || pinned)?.energy && (
            <div className="text-xs text-[color:var(--ink-muted)] flex flex-wrap gap-3 pt-1">
              <span>BMR {(envelope || pinned).energy.bmr_kcal ?? '—'}</span>
              <span>TDEE {(envelope || pinned).energy.tdee_kcal ?? '—'}</span>
              <span>{t('body.life_calories')} {(envelope || pinned).energy.intake_kcal ?? '—'}</span>
              <span>{t('body.life_deficit')} {(envelope || pinned).energy.deficit_kcal_day ?? '—'} kcal/d</span>
            </div>
          )}
          {(envelope || pinned)?.monthly_rates?.length > 0 && (
            <ul className="text-xs text-[color:var(--ink-muted)] space-y-0.5 pt-1">
              {(envelope || pinned).monthly_rates.map((r: any, i: number) => (
                <li key={i} className="tabular-nums">{r.label}: {r.kg_per_month} kg/mês ({r.pct_bw_per_month}% PC/mês)</li>
              ))}
            </ul>
          )}
          {(envelope || pinned)?.rag_citations?.length > 0 && (
            <div className="pt-2">
              <div className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold mb-1">{t('body.sim_rag')}</div>
              <ul className="space-y-1">
                {(envelope || pinned).rag_citations.slice(0, 5).map((c: any) => (
                  <li key={c.id} className="text-[11px] border-l-2 border-[color:var(--brass)]/50 pl-2">
                    <span className="font-medium text-[color:var(--ink)]">{c.title}</span>
                    <span className="block text-[color:var(--ink-muted)]">{c.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="grid lg:grid-cols-[1fr_0.85fr] gap-4">
        <section className="space-y-3">
          <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.tabs.scenarios')}</h4>
          <div className="grid sm:grid-cols-2 gap-3">
            {scenarios.map((s: any) => (
              <ScenarioCard key={s.id} patientId={patientId} scenario={s} onRefresh={onRefresh} />
            ))}
            {!scenarios.length && <p className="text-sm text-[color:var(--ink-muted)]">{t('body.sim_no_scenarios')}</p>}
          </div>
        </section>

        <aside className="crm-inset-panel space-y-4" data-testid="sim-inspector">
          <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.sim_inspector')}</h4>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1.5">{t('body.granular_consents')}</div>
            <ul className="space-y-1">
              {(['clinical_record', 'image_processing', 'generative_ai', 'cross_border_transfer', 'research', 'marketing'] as const).map((key) => {
                const ok = !!consents[key]?.granted;
                return (
                  <li key={key} className="flex justify-between text-xs gap-2">
                    <span>{t(`body.consent.${key}`)}</span>
                    <span className={`badge ${ok ? 'badge-green' : 'badge-slate'}`}>{ok ? 'OK' : t('common.no')}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1.5">{t('body.sim_source_quality')}</div>
            {qualityFront ? (
              <ul className="grid grid-cols-2 gap-1">
                {Object.entries(qualityFront).map(([k, v]: any) => (
                  <li key={k} className="flex justify-between text-xs gap-1">
                    <span className="text-[color:var(--ink-muted)]">{k}</span>
                    <span className={`badge text-[9px] ${(v?.verdict || v) === 'pass' ? 'badge-green' : 'badge-slate'}`}>
                      {typeof v === 'object' ? (v.verdict || '—') : String(v)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_no_quality')}</p>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1.5">{t('body.sim_premises')}</div>
            <p className="text-xs text-[color:var(--ink-muted)]">
              {envelope ? envelope.summary : t('body.sim_no_active_scenario')}
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1.5">{t('body.sim_provenance')}</div>
            <p className="text-xs text-[color:var(--ink-muted)]">
              {scenarios[0]?.provider
                ? `${scenarios[0].provider} · ${scenarios[0].status}`
                : t('body.sim_awaiting_gen')}
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1.5">{t('body.sim_reviewer')}</div>
            <p className="text-xs">
              <span className="badge badge-yellow">{t('body.sim_pending_review')}</span>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
