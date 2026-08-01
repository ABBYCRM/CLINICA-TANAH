/**
 * Body Composition Image Simulator — BodyPath parity, Clínica Tanah desk UI.
 * Interventions · adherence · if/then envelope · illustrative generation · inspector
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

const HORIZONS = [4, 8, 12, 24, 52, 54];
const ADHERENCE = ['low', 'moderate', 'high'] as const;

const REVIEW_KEYS = [
  'identity_preserved',
  'anatomy_plausible',
  'scenario_conservative',
  'assumptions_visible',
  'no_prohibited_manipulation',
  'consent_active',
  'watermark_present',
] as const;

type ReviewKey = typeof REVIEW_KEYS[number];

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

async function openAuthHtml(url: string) {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error('report');
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  window.open(obj, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(obj), 60_000);
}

function ScenarioCard({
  patientId,
  scenario,
  selected,
  onSelect,
  onRefresh,
}: {
  patientId: string;
  scenario: any;
  selected: boolean;
  onSelect: () => void;
  onRefresh: () => void;
}) {
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
    <button
      type="button"
      className={`crm-timeline-card overflow-hidden p-0 text-left w-full ${selected ? 'ring-2 ring-[color:var(--brass)]' : ''}`}
      data-testid={`body-scenario-${scenario.id}`}
      onClick={onSelect}
    >
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
          {(() => {
            const n = scenario.output_view_count
              ?? (scenario.output_views
                ? Object.values(scenario.output_views).filter((v: any) => v?.has_image).length
                : (scenario.has_image ? 1 : 0));
            return n > 0 ? ` · ${n}/4` : '';
          })()}
        </div>
        {scenario.prompt_version && (
          <div className="text-[10px] text-[color:var(--ink-muted)] truncate" data-testid={`body-scenario-prompt-${scenario.id}`}>
            {scenario.prompt_version}
          </div>
        )}
      </div>
    </button>
  );
}

function emptyChecklist(): Record<ReviewKey, boolean> {
  return Object.fromEntries(REVIEW_KEYS.map((k) => [k, false])) as Record<ReviewKey, boolean>;
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
  const [stepPassword, setStepPassword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorMode, setInspectorMode] = useState<'single' | 'contact'>('single');
  const [inspectView, setInspectView] = useState<'front' | 'left' | 'right' | 'back'>('front');
  const [checklist, setChecklist] = useState<Record<ReviewKey, boolean>>(emptyChecklist);
  const [reviewSignature, setReviewSignature] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [reportSignature, setReportSignature] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  useEffect(() => {
    setMedIds(medications.filter((m: any) => m.status === 'active').map((m: any) => m.id));
    setNutIds(nutrition.map((p: any) => p.id));
    setExIds(exercise.map((p: any) => p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.medications?.length, data?.plans?.length]);

  useEffect(() => {
    if (!scenarios.length) {
      setSelectedId(null);
      return;
    }
    if (selectedId && scenarios.some((s: any) => s.id === selectedId)) return;
    setSelectedId(scenarios[0].id);
  }, [scenarios, selectedId]);

  const selected = useMemo(
    () => scenarios.find((s: any) => s.id === selectedId) || scenarios[0] || null,
    [scenarios, selectedId],
  );

  const afterViewCount = selected?.output_view_count
    ?? (selected?.output_views
      ? Object.values(selected.output_views).filter((v: any) => v?.has_image).length
      : (selected?.has_image ? 1 : 0));

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
      const step = await api.post('/api/auth/step-up', { password: stepPassword });
      const frontId = session?.assets?.front?.id || null;
      const res = await api.post(`/api/clinical/body/${patientId}/scenarios`, {
        title: t('body.scenario_default_title'),
        goal: t('body.scenario_default_goal'),
        weeks: horizon,
        horizon_weeks: horizon,
        capture_id: frontId,
        capture_session_id: session?.id || null,
        generate: true,
        photorealism: true,
        step_up_token: step.step_up_token,
        plan_config: planConfig,
        assumptions,
        sleep_adequate: sleep,
        hydration_adequate: hydration,
        recovery_adequate: recovery,
        comorbidity_stable: comorbidity,
        change_magnitude: magnitude,
      });
      setStepPassword('');
      if (res?.id || res?.scenario?.id) setSelectedId(res.id || res.scenario.id);
      if ((res?.scenario?.output_view_count || 0) > 1) setInspectorMode('contact');
      onRefresh();
    } catch (e: any) {
      setError(e?.body?.message || e?.message || t('body.simulations_blocked'));
    } finally {
      setBusy('');
    }
  };

  const submitReview = async (decision: 'approved' | 'rejected') => {
    if (!selected?.id || !reviewSignature.trim()) return;
    setBusy('review'); setError('');
    try {
      await api.post(`/api/clinical/body/scenarios/${selected.id}/reviews`, {
        decision,
        checklist,
        signature_name: reviewSignature.trim(),
        comment: reviewComment.trim() || null,
      });
      setChecklist(emptyChecklist());
      setReviewComment('');
      onRefresh();
    } catch (e: any) {
      setError(e?.body?.message || e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  const createReport = async () => {
    if (!selected?.id || !reportSignature.trim()) return;
    setBusy('report'); setError('');
    try {
      const res = await api.post('/api/clinical/body/reports', {
        scenario_id: selected.id,
        signature_name: reportSignature.trim(),
        next_follow_up_date: followUpDate || null,
      });
      if (res?.html_url) await openAuthHtml(res.html_url);
      onRefresh();
    } catch (e: any) {
      setError(e?.body?.message || e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  const qualityFront = session?.assets?.front?.quality || session?.quality_summary?.front || null;
  const views = ['front', 'left', 'right', 'back'] as const;
  const captureReadyCount = views.filter((v) => !!session?.assets?.[v]).length;
  const captureComplete = captureReadyCount === 4;
  const availableViews = views.filter((v) => !!session?.assets?.[v]);
  const activeEnvelope = envelope || pinned;
  const anatomy = activeEnvelope?.anatomicalEnvelope;
  const narrative = activeEnvelope?.narrativePt || [];
  const visualProfiles = activeEnvelope?.visualProfiles || [];

  useEffect(() => {
    if (!availableViews.length) return;
    if (!availableViews.includes(inspectView)) {
      setInspectView(availableViews[0]);
    }
  }, [session?.id, availableViews.join('|'), inspectView]);

  // Default to contact sheet whenever we have any scenario or multi-view capture
  useEffect(() => {
    if (afterViewCount > 1 || captureReadyCount > 1) setInspectorMode('contact');
  }, [selected?.id, afterViewCount, captureReadyCount]);

  const needsReview = selected
    && (selected.review_status === 'pending_review' || !selected.review_status)
    && (
      ['completed', 'ready'].includes(selected.status)
      || !!selected.has_image
      || !!selected.image_url
      || (selected.output_view_count || 0) > 0
    );

  const canReport = selected?.review_status === 'approved';

  const beforeUrl = session?.assets?.[inspectView]?.preview_url || (session?.id
    ? `/api/clinical/body/${patientId}/capture-sessions/${session.id}/assets/${inspectView}/image`
    : null);
  const afterHasView = !!(
    selected?.output_views?.[inspectView]?.has_image
    || (inspectView === 'front' && (selected?.has_image || selected?.image_url))
  );
  const afterUrl = selected && afterHasView
    ? `/api/clinical/body/${patientId}/scenarios/${selected.id}/image?view=${inspectView}`
    : null;

  const providersOrder = data?.image_providers?.order;

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
          {captureComplete ? (
            <span className="badge-green text-[10px]" data-testid="sim-photos-ready">{t('body.sim_photos_ready')}</span>
          ) : captureReadyCount > 0 ? (
            <span className="badge-slate text-[10px]" data-testid="sim-photos-partial">
              {t('body.sim_photos_partial', { count: captureReadyCount })}
            </span>
          ) : (
            <span className="badge-slate text-[10px]" data-testid="sim-photos-missing">{t('body.sim_photos_missing')}</span>
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

        <div className="crm-inset-panel !p-3 space-y-2" data-testid="sim-step-up">
          <label className="text-xs text-[color:var(--ink-muted)] block">
            {t('body.step_up_password')}
            <input
              className="input mt-1 w-full max-w-sm"
              type="password"
              autoComplete="current-password"
              value={stepPassword}
              onChange={(e) => setStepPassword(e.target.value)}
              data-testid="sim-step-password"
            />
          </label>
          <p className="text-[11px] text-[color:var(--ink-muted)]">{t('body.step_up_hint')}</p>
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
            disabled={busy === 'generate' || !data?.simulations_allowed || !stepPassword}
            onClick={generate}
            data-testid="sim-generate"
          >
            {busy === 'generate' ? t('body.generating') : t('body.sim_generate')}
          </button>
          {captureReadyCount > 0 && captureReadyCount < 4 && (
            <span className="text-xs text-[color:var(--ink-muted)] self-center" data-testid="sim-partial-gen-note">
              {t('body.partial_gen_hint')}
            </span>
          )}
        </div>
        {error && <p className="text-sm text-[#8b3a2a]" data-testid="sim-error">{error}</p>}
        {!data?.simulations_allowed && (
          <p className="text-sm text-[#8b3a2a] bg-[#f8e8e2] rounded-lg px-3 py-2">{t('body.simulations_blocked')}</p>
        )}
      </section>

      {activeEnvelope && (
        <section className="crm-inset-panel space-y-2" data-testid="sim-envelope">
          <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.sim_envelope')}</h4>
          {activeEnvelope?.blockers?.length > 0 && (
            <ul className="text-sm text-[#8b3a2a] list-disc pl-4">
              {activeEnvelope.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}
            </ul>
          )}
          <p className="text-sm text-[color:var(--ink)]">{activeEnvelope?.summary}</p>
          <p className="text-[11px] text-[color:var(--ink-muted)]">{activeEnvelope?.identity_locks}</p>
          <ul className="space-y-1.5 pt-1">
            {(activeEnvelope?.rules || []).filter((r: any) => r.applied).map((r: any) => (
              <li key={r.id} className="text-xs border-l-2 border-[color:var(--brass)] pl-2">
                <span className="font-medium">IF</span> {r.if} → <span className="font-medium">THEN</span> {r.then}
                <span className="text-[color:var(--ink-muted)]"> ({r.silhouette_delta_pct?.toFixed?.(1) ?? r.silhouette_delta_pct}%)</span>
              </li>
            ))}
          </ul>
          {activeEnvelope?.projected && (
            <div className="flex flex-wrap gap-4 text-sm pt-1">
              <span>→ {t('body.weight')}: <strong className="tabular-nums">{activeEnvelope.projected.weight_kg ?? '—'}</strong> kg</span>
              <span>{t('body.waist')}: <strong className="tabular-nums">{activeEnvelope.projected.waist_cm ?? '—'}</strong> cm</span>
              <span>IMC: <strong className="tabular-nums">{activeEnvelope.projected.bmi ?? '—'}</strong></span>
              {activeEnvelope.projected.body_fat_pct != null && (
                <span>%G: <strong className="tabular-nums">{activeEnvelope.projected.body_fat_pct}</strong></span>
              )}
            </div>
          )}
          {activeEnvelope?.energy && (
            <div className="text-xs text-[color:var(--ink-muted)] flex flex-wrap gap-3 pt-1">
              <span>BMR {activeEnvelope.energy.bmr_kcal ?? '—'}</span>
              <span>TDEE {activeEnvelope.energy.tdee_kcal ?? '—'}</span>
              <span>{t('body.life_calories')} {activeEnvelope.energy.intake_kcal ?? '—'}</span>
              <span>{t('body.life_deficit')} {activeEnvelope.energy.deficit_kcal_day ?? '—'} kcal/d</span>
            </div>
          )}
          {activeEnvelope?.monthly_rates?.length > 0 && (
            <ul className="text-xs text-[color:var(--ink-muted)] space-y-0.5 pt-1">
              {activeEnvelope.monthly_rates.map((r: any, i: number) => (
                <li key={i} className="tabular-nums">{r.label}: {r.kg_per_month} kg/mês ({r.pct_bw_per_month}% PC/mês)</li>
              ))}
            </ul>
          )}

          {anatomy?.regions?.length > 0 && (
            <div className="pt-2" data-testid="sim-anatomy-regions">
              <div className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold mb-1">{t('body.anatomy_regions')}</div>
              <ul className="grid sm:grid-cols-2 gap-1">
                {anatomy.regions.map((r: any) => (
                  <li key={r.region} className="text-xs flex justify-between gap-2 border-l-2 border-[color:var(--brass)]/40 pl-2">
                    <span className="font-medium">{r.region}</span>
                    <span className="tabular-nums text-[color:var(--ink-muted)]">
                      {typeof r.deltaPct === 'number' ? `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct.toFixed(1)}%` : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {narrative.length > 0 && (
            <div className="pt-2" data-testid="sim-narrative">
              <div className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold mb-1">{t('body.narrative')}</div>
              <ul className="space-y-1 list-disc pl-4">
                {narrative.map((line: string, i: number) => (
                  <li key={i} className="text-xs text-[color:var(--ink)]">{line}</li>
                ))}
              </ul>
            </div>
          )}

          {visualProfiles.length > 0 && (
            <div className="pt-2" data-testid="sim-visual-profiles">
              <div className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold mb-1">Visual profiles</div>
              <ul className="space-y-1">
                {visualProfiles.map((vp: any, i: number) => (
                  <li key={`${vp.profileId}-${i}`} className="text-xs border-l-2 border-[color:var(--brass)]/50 pl-2">
                    <span className="font-medium">{vp.medication}</span>
                    <span className="text-[color:var(--ink-muted)]"> · {vp.labelPt || vp.profileId}</span>
                    {vp.kind ? <span className="text-[color:var(--ink-muted)]"> ({vp.kind})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {activeEnvelope?.rag_citations?.length > 0 && (
            <div className="pt-2">
              <div className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold mb-1">{t('body.sim_rag')}</div>
              <ul className="space-y-1">
                {activeEnvelope.rag_citations.slice(0, 5).map((c: any) => (
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

      <section className="crm-inset-panel space-y-3" data-testid="sim-ba-inspector">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.inspector_title')}</h4>
          <div className="flex gap-1">
            <button
              type="button"
              className={`crm-feed-tab ${inspectorMode === 'single' ? 'is-active' : ''}`}
              onClick={() => setInspectorMode('single')}
              data-testid="sim-inspector-single"
            >
              {t('body.inspector_single')}
            </button>
            <button
              type="button"
              className={`crm-feed-tab ${inspectorMode === 'contact' ? 'is-active' : ''}`}
              onClick={() => setInspectorMode('contact')}
              data-testid="sim-inspector-contact"
            >
              {t('body.inspector_contact')}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-[color:var(--ink-muted)]">{t('body.inspector_sync_note')}</p>
        {inspectorMode === 'single' ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {views.map((v) => {
                const hasBefore = !!session?.assets?.[v];
                return (
                  <button
                    key={v}
                    type="button"
                    className={`crm-feed-tab ${inspectView === v ? 'is-active' : ''} ${!hasBefore ? 'opacity-50' : ''}`}
                    onClick={() => setInspectView(v)}
                    data-testid={`sim-inspect-view-${v}`}
                  >
                    {t(`body.views.${v}`)}{hasBefore ? '' : ' · —'}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3 max-w-lg">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold mb-1">{t('body.inspector_before')}</div>
                <Thumb url={beforeUrl} label={t(`body.views.${inspectView}`)} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold mb-1">{t('body.inspector_after')}</div>
                <Thumb url={afterUrl} label={selected?.title || t('body.tabs.scenarios')} />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {views.map((v) => (
                <div key={`before-${v}`}>
                  <div className="text-[10px] text-center text-[color:var(--ink-muted)] mb-1">{t('body.inspector_before')} · {t(`body.views.${v}`)}</div>
                  <Thumb
                    url={session?.assets?.[v]?.preview_url || (session?.id
                      ? `/api/clinical/body/${patientId}/capture-sessions/${session.id}/assets/${v}/image`
                      : null)}
                    label={t(`body.views.${v}`)}
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {views.map((v) => {
                const has = !!(selected?.output_views?.[v]?.has_image || (v === 'front' && selected?.has_image));
                return (
                  <div key={`after-${v}`}>
                    <div className="text-[10px] text-center text-[color:var(--ink-muted)] mb-1">{t('body.inspector_after')} · {t(`body.views.${v}`)}</div>
                    <Thumb
                      url={selected && has
                        ? `/api/clinical/body/${patientId}/scenarios/${selected.id}/image?view=${v}`
                        : null}
                      label={has ? t(`body.views.${v}`) : '—'}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-[1fr_0.85fr] gap-4">
        <section className="space-y-3">
          <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.tabs.scenarios')}</h4>
          <div className="grid sm:grid-cols-2 gap-3">
            {scenarios.map((s: any) => (
              <ScenarioCard
                key={s.id}
                patientId={patientId}
                scenario={s}
                selected={selected?.id === s.id}
                onSelect={() => setSelectedId(s.id)}
                onRefresh={onRefresh}
              />
            ))}
            {!scenarios.length && <p className="text-sm text-[color:var(--ink-muted)]">{t('body.sim_no_scenarios')}</p>}
          </div>

          {needsReview && (
            <section className="crm-inset-panel space-y-3" data-testid="sim-clinical-review">
              <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.review_title')}</h4>
              <ul className="space-y-1.5">
                {REVIEW_KEYS.map((key) => (
                  <li key={key}>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={!!checklist[key]}
                        onChange={(e) => setChecklist((prev) => ({ ...prev, [key]: e.target.checked }))}
                        data-testid={`sim-review-${key}`}
                      />
                      <span>{t(`body.checklist_${key}`)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <label className="text-xs text-[color:var(--ink-muted)] block">
                {t('body.review_signature')}
                <input
                  className="input mt-1 w-full max-w-sm"
                  value={reviewSignature}
                  onChange={(e) => setReviewSignature(e.target.value)}
                  data-testid="sim-review-signature"
                />
              </label>
              <label className="text-xs text-[color:var(--ink-muted)] block">
                Comment
                <textarea
                  className="input mt-1 w-full min-h-[4rem]"
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  data-testid="sim-review-comment"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={busy === 'review' || !reviewSignature.trim() || !REVIEW_KEYS.every((k) => checklist[k])}
                  onClick={() => submitReview('approved')}
                  data-testid="sim-review-approve"
                >
                  {t('body.review_approve')}
                </button>
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  disabled={busy === 'review' || !reviewSignature.trim()}
                  onClick={() => submitReview('rejected')}
                  data-testid="sim-review-reject"
                >
                  {t('body.review_reject')}
                </button>
              </div>
            </section>
          )}

          {canReport && (
            <section className="crm-inset-panel space-y-3" data-testid="sim-create-report">
              <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.create_report')}</h4>
              <label className="text-xs text-[color:var(--ink-muted)] block">
                {t('body.review_signature')}
                <input
                  className="input mt-1 w-full max-w-sm"
                  value={reportSignature}
                  onChange={(e) => setReportSignature(e.target.value)}
                  data-testid="sim-report-signature"
                />
              </label>
              <label className="text-xs text-[color:var(--ink-muted)] block">
                Follow-up
                <input
                  className="input mt-1 w-full max-w-sm"
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  data-testid="sim-report-followup"
                />
              </label>
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={busy === 'report' || !reportSignature.trim()}
                onClick={createReport}
                data-testid="sim-create-report-btn"
              >
                {t('body.create_report')}
              </button>
            </section>
          )}
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
              {selected?.provider
                ? `${selected.provider} · ${selected.status}${afterViewCount ? ` · ${afterViewCount}/4` : ''}`
                : scenarios[0]?.provider
                  ? `${scenarios[0].provider} · ${scenarios[0].status}`
                  : t('body.sim_awaiting_gen')}
            </p>
            {providersOrder?.length > 0 && (
              <p className="text-[11px] text-[color:var(--ink-muted)] mt-1" data-testid="sim-providers-order">
                {t('body.providers_order')}: {Array.isArray(providersOrder) ? providersOrder.join(' → ') : String(providersOrder)}
              </p>
            )}
            {selected?.prompt_version && (
              <p className="text-[11px] text-[color:var(--ink-muted)] mt-0.5">{selected.prompt_version}</p>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1.5">{t('body.sim_reviewer')}</div>
            <p className="text-xs">
              <span className={`badge ${
                selected?.review_status === 'approved' ? 'badge-green'
                  : selected?.review_status === 'rejected' ? 'badge-slate'
                    : 'badge-yellow'
              }`}>
                {selected?.review_status || t('body.sim_pending_review')}
              </span>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
