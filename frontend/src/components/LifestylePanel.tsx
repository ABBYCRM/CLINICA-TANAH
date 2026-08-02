/**
 * Dieta e exercício — searchable templates + exhaustive structured params.
 * Feeds the composition engine (calories/deficit/protein + exercise volume).
 */
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import CatalogPicker from './CatalogPicker';
import {
  CALORIE_PRESETS,
  CARB_EMPHASIS,
  CARDIO_MODALITIES,
  DEFICIT_PRESETS,
  EXERCISE_TEMPLATES,
  FAT_EMPHASIS,
  INTENSITY_OPTIONS,
  MEAL_PATTERNS,
  NUTRITION_TEMPLATES,
  PROTEIN_PER_KG,
  SESSION_MINUTES,
  STEPS_TARGETS,
  TRAINING_STYLES,
  pickLabel,
} from '../lib/lifestyleCatalogs';

export default function LifestylePanel({
  patientId, plans, onSaved,
}: { patientId: string; plans: any[]; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const [planType, setPlanType] = useState<'nutrition' | 'exercise'>('nutrition');
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [weeks, setWeeks] = useState('12');
  const [dailyCalories, setDailyCalories] = useState('');
  const [deficitKcal, setDeficitKcal] = useState('');
  const [proteinG, setProteinG] = useState('');
  const [proteinPerKg, setProteinPerKg] = useState('1.6');
  const [carbsG, setCarbsG] = useState('');
  const [fatG, setFatG] = useState('');
  const [fiberG, setFiberG] = useState('');
  const [mealPattern, setMealPattern] = useState('meals_4_5');
  const [carbEmphasis, setCarbEmphasis] = useState('moderate');
  const [fatEmphasis, setFatEmphasis] = useState('moderate');
  const [trainingStyle, setTrainingStyle] = useState('full_body');
  const [resistanceDays, setResistanceDays] = useState('3');
  const [cardioDays, setCardioDays] = useState('3');
  const [resistanceMinutes, setResistanceMinutes] = useState('45');
  const [cardioMinutes, setCardioMinutes] = useState('40');
  const [cardioModality, setCardioModality] = useState('walking');
  const [intensity, setIntensity] = useState('moderate');
  const [stepsTarget, setStepsTarget] = useState('8000');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const nutTemplates = useMemo(() => NUTRITION_TEMPLATES, []);
  const exTemplates = useMemo(() => EXERCISE_TEMPLATES, []);

  const applyNutritionTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = NUTRITION_TEMPLATES.find((x) => x.id === id);
    if (!tpl || id === 'nut_custom' || !id) return;
    setTitle(pickLabel(tpl.labels, locale));
    setSummary(pickLabel(tpl.summary, locale));
    if (tpl.daily_calories != null) setDailyCalories(String(tpl.daily_calories));
    if (tpl.deficit_kcal != null) setDeficitKcal(String(tpl.deficit_kcal));
    if (tpl.protein_g != null) setProteinG(String(tpl.protein_g));
    if (tpl.protein_g_per_kg != null) setProteinPerKg(String(tpl.protein_g_per_kg));
    if (tpl.carbs_g != null) setCarbsG(String(tpl.carbs_g));
    if (tpl.fat_g != null) setFatG(String(tpl.fat_g));
    if (tpl.fiber_g != null) setFiberG(String(tpl.fiber_g));
    if (tpl.meal_pattern) setMealPattern(tpl.meal_pattern);
    if (tpl.carb_emphasis) setCarbEmphasis(tpl.carb_emphasis);
    if (tpl.fat_emphasis) setFatEmphasis(tpl.fat_emphasis);
  };

  const applyExerciseTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = EXERCISE_TEMPLATES.find((x) => x.id === id);
    if (!tpl || id === 'ex_custom' || !id) return;
    setTitle(pickLabel(tpl.labels, locale));
    setSummary(pickLabel(tpl.summary, locale));
    if (tpl.training_style) setTrainingStyle(tpl.training_style);
    if (tpl.resistance_days != null) setResistanceDays(String(tpl.resistance_days));
    if (tpl.cardio_days != null) setCardioDays(String(tpl.cardio_days));
    if (tpl.resistance_minutes != null) setResistanceMinutes(String(tpl.resistance_minutes));
    if (tpl.cardio_minutes != null) setCardioMinutes(String(tpl.cardio_minutes));
    if (tpl.cardio_modality) setCardioModality(tpl.cardio_modality);
    if (tpl.intensity) setIntensity(tpl.intensity);
    if (tpl.steps_target != null) setStepsTarget(String(tpl.steps_target));
  };

  const resetForm = () => {
    setTemplateId('');
    setTitle('');
    setSummary('');
    setDailyCalories('');
    setDeficitKcal('');
    setProteinG('');
    setCarbsG('');
    setFatG('');
    setFiberG('');
  };

  const submit = async () => {
    if (!title.trim()) {
      setMsg(t('body.life_title_required'));
      return;
    }
    setBusy(true); setMsg('');
    try {
      const params: Record<string, unknown> = {
        template_id: templateId || null,
      };
      if (planType === 'nutrition') {
        Object.assign(params, {
          daily_calories: dailyCalories ? Number(dailyCalories) : null,
          deficit_kcal: deficitKcal ? Number(deficitKcal) : null,
          protein_g: proteinG ? Number(proteinG) : null,
          protein_g_per_kg: proteinPerKg ? Number(proteinPerKg) : null,
          carbs_g: carbsG ? Number(carbsG) : null,
          fat_g: fatG ? Number(fatG) : null,
          fiber_g: fiberG ? Number(fiberG) : null,
          meal_pattern: mealPattern || null,
          carb_emphasis: carbEmphasis || null,
          fat_emphasis: fatEmphasis || null,
        });
      } else {
        Object.assign(params, {
          training_style: trainingStyle || null,
          resistance_days_per_week: resistanceDays ? Number(resistanceDays) : null,
          cardio_days_per_week: cardioDays ? Number(cardioDays) : null,
          resistance_minutes: resistanceMinutes ? Number(resistanceMinutes) : null,
          cardio_minutes: cardioMinutes ? Number(cardioMinutes) : null,
          cardio_modality: cardioModality || null,
          intensity: intensity || null,
          steps_target: stepsTarget ? Number(stepsTarget) : null,
        });
      }
      await api.post(`/api/clinical/body/${patientId}/plans`, {
        title: title.trim(),
        summary: summary.trim() || null,
        description: summary.trim() || null,
        plan_type: planType,
        weeks: weeks ? Number(weeks) : null,
        daily_calories: planType === 'nutrition' && dailyCalories ? Number(dailyCalories) : null,
        deficit_kcal: planType === 'nutrition' && deficitKcal ? Number(deficitKcal) : null,
        protein_g: planType === 'nutrition' && proteinG ? Number(proteinG) : null,
        params,
      });
      resetForm();
      setMsg(t('body.life_saved'));
      onSaved();
    } catch (e: any) {
      setMsg(e?.message || t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const planMeta = (p: any) => {
    const bits: string[] = [];
    if (p.daily_calories) bits.push(`${p.daily_calories} kcal/d`);
    if (p.deficit_kcal) bits.push(`déficit ${p.deficit_kcal} kcal`);
    if (p.protein_g) bits.push(`proteína ${p.protein_g} g`);
    const pj = p.params || {};
    if (pj.carbs_g) bits.push(`CHO ${pj.carbs_g} g`);
    if (pj.fat_g) bits.push(`gordura ${pj.fat_g} g`);
    if (pj.training_style) bits.push(String(pj.training_style));
    if (pj.resistance_days_per_week != null) bits.push(`força ${pj.resistance_days_per_week}×`);
    if (pj.cardio_days_per_week != null) bits.push(`cardio ${pj.cardio_days_per_week}×`);
    if (pj.steps_target) bits.push(`${pj.steps_target} passos`);
    if (p.weeks) bits.push(`${p.weeks}w`);
    return bits.join(' · ');
  };

  return (
    <div className="space-y-4" data-testid="body-lifestyle-full">
      <header>
        <h3 className="crm-record-panel-title !mb-0">{t('body.life_title')}</h3>
        <p className="text-xs text-[color:var(--ink-muted)] mt-1">{t('body.life_intro')}</p>
      </header>

      <div className="rounded-lg border border-[rgba(176,183,192,0.45)] bg-[#f7f1e6] px-3 py-2.5 text-xs text-[color:var(--ink)] leading-relaxed">
        {t('body.life_scope_banner')}
      </div>

      <ul className="space-y-2">
        {(plans || []).map((p) => (
          <li key={p.id} className="crm-timeline-card space-y-1" data-testid={`life-plan-${p.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm text-[color:var(--ink)]">{p.title}</span>
              <span className="badge badge-slate text-[10px]">{p.plan_type || 'nutrition'}</span>
              <span className={`badge text-[10px] ${p.status === 'active' ? 'badge-green' : 'badge-slate'}`}>
                {p.status || 'active'}
              </span>
            </div>
            {(p.summary || p.description) && (
              <p className="text-xs text-[color:var(--ink-muted)] leading-relaxed">{p.summary || p.description}</p>
            )}
            {planMeta(p) && (
              <p className="text-[11px] text-[color:var(--ink-muted)] tabular-nums">{planMeta(p)}</p>
            )}
          </li>
        ))}
        {!plans?.length && (
          <li className="text-sm text-[color:var(--ink-muted)]">{t('body.life_empty')}</li>
        )}
      </ul>

      <section className="crm-inset-panel space-y-3" data-testid="life-plan-form">
        <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.life_submit')}</h4>

        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_type')}
            <select
              className="input mt-1 w-full"
              value={planType}
              onChange={(e) => {
                setPlanType(e.target.value as any);
                setTemplateId('');
              }}
              data-testid="life-plan-type"
            >
              <option value="nutrition">{t('body.life_nutrition')}</option>
              <option value="exercise">{t('body.life_exercise')}</option>
            </select>
          </label>
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_weeks')}
            <select className="input mt-1 w-full" value={weeks} onChange={(e) => setWeeks(e.target.value)} data-testid="life-weeks">
              {['4', '8', '12', '16', '24', '36', '52'].map((w) => (
                <option key={w} value={w}>{w}w</option>
              ))}
            </select>
          </label>
        </div>

        {planType === 'nutrition' ? (
          <CatalogPicker
            items={nutTemplates}
            value={templateId}
            onChange={applyNutritionTemplate}
            label={t('body.life_nut_library')}
            placeholder={t('body.life_nut_search_ph')}
            testId="life-nut-library"
            emptyLabel={t('body.catalog_none')}
          />
        ) : (
          <CatalogPicker
            items={exTemplates}
            value={templateId}
            onChange={applyExerciseTemplate}
            label={t('body.life_ex_library')}
            placeholder={t('body.life_ex_search_ph')}
            testId="life-ex-library"
            emptyLabel={t('body.catalog_none')}
          />
        )}

        <label className="text-xs text-[color:var(--ink-muted)] block">{t('body.life_plan_title')}
          <input className="input mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="life-title" />
        </label>

        {planType === 'nutrition' && (
          <>
            <div className="grid sm:grid-cols-3 gap-2">
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_calories')}
                <select
                  className="input mt-1 w-full"
                  value={dailyCalories}
                  onChange={(e) => setDailyCalories(e.target.value)}
                  data-testid="life-calories-preset"
                >
                  <option value="">{t('body.catalog_custom')}</option>
                  {CALORIE_PRESETS.map((o) => (
                    <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                  ))}
                </select>
                <input className="input mt-1 w-full" type="number" min={800} max={6000} value={dailyCalories}
                  onChange={(e) => setDailyCalories(e.target.value)} placeholder="1800" data-testid="life-calories" />
              </label>
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_deficit')}
                <select
                  className="input mt-1 w-full"
                  value={deficitKcal}
                  onChange={(e) => setDeficitKcal(e.target.value)}
                  data-testid="life-deficit-preset"
                >
                  <option value="">{t('body.catalog_custom')}</option>
                  {DEFICIT_PRESETS.map((o) => (
                    <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                  ))}
                </select>
                <input className="input mt-1 w-full" type="number" min={0} max={1500} value={deficitKcal}
                  onChange={(e) => setDeficitKcal(e.target.value)} placeholder="500" data-testid="life-deficit" />
              </label>
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_protein')}
                <input className="input mt-1 w-full" type="number" min={0} max={400} value={proteinG}
                  onChange={(e) => setProteinG(e.target.value)} placeholder="120" data-testid="life-protein" />
              </label>
            </div>

            <div className="grid sm:grid-cols-3 gap-2">
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_protein_per_kg')}
                <select className="input mt-1 w-full" value={proteinPerKg} onChange={(e) => setProteinPerKg(e.target.value)} data-testid="life-protein-per-kg">
                  {PROTEIN_PER_KG.map((o) => (
                    <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_carbs')}
                <input className="input mt-1 w-full" type="number" min={0} max={600} value={carbsG}
                  onChange={(e) => setCarbsG(e.target.value)} placeholder="160" data-testid="life-carbs" />
              </label>
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_fat')}
                <input className="input mt-1 w-full" type="number" min={0} max={200} value={fatG}
                  onChange={(e) => setFatG(e.target.value)} placeholder="55" data-testid="life-fat" />
              </label>
            </div>

            <div className="grid sm:grid-cols-3 gap-2">
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_fiber')}
                <input className="input mt-1 w-full" type="number" min={0} max={80} value={fiberG}
                  onChange={(e) => setFiberG(e.target.value)} placeholder="30" data-testid="life-fiber" />
              </label>
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_meal_pattern')}
                <select className="input mt-1 w-full" value={mealPattern} onChange={(e) => setMealPattern(e.target.value)} data-testid="life-meal-pattern">
                  {MEAL_PATTERNS.map((o) => (
                    <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_carb_emphasis')}
                <select className="input mt-1 w-full" value={carbEmphasis} onChange={(e) => setCarbEmphasis(e.target.value)} data-testid="life-carb-emphasis">
                  {CARB_EMPHASIS.map((o) => (
                    <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="text-xs text-[color:var(--ink-muted)] block">{t('body.life_fat_emphasis')}
              <select className="input mt-1 w-full max-w-md" value={fatEmphasis} onChange={(e) => setFatEmphasis(e.target.value)} data-testid="life-fat-emphasis">
                {FAT_EMPHASIS.map((o) => (
                  <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                ))}
              </select>
            </label>
          </>
        )}

        {planType === 'exercise' && (
          <>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_training_style')}
                <select className="input mt-1 w-full" value={trainingStyle} onChange={(e) => setTrainingStyle(e.target.value)} data-testid="life-training-style">
                  {TRAINING_STYLES.map((o) => (
                    <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_intensity')}
                <select className="input mt-1 w-full" value={intensity} onChange={(e) => setIntensity(e.target.value)} data-testid="life-intensity">
                  {INTENSITY_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid sm:grid-cols-4 gap-2">
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_resist')}
                <input className="input mt-1 w-full" type="number" min={0} max={7} value={resistanceDays}
                  onChange={(e) => setResistanceDays(e.target.value)} data-testid="life-resist-days" />
              </label>
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.sim_cardio')}
                <input className="input mt-1 w-full" type="number" min={0} max={7} value={cardioDays}
                  onChange={(e) => setCardioDays(e.target.value)} data-testid="life-cardio-days" />
              </label>
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_resist_min')}
                <select className="input mt-1 w-full" value={resistanceMinutes} onChange={(e) => setResistanceMinutes(e.target.value)} data-testid="life-resist-min">
                  {SESSION_MINUTES.map((o) => (
                    <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_cardio_min')}
                <select className="input mt-1 w-full" value={cardioMinutes} onChange={(e) => setCardioMinutes(e.target.value)} data-testid="life-cardio-min">
                  {SESSION_MINUTES.map((o) => (
                    <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid sm:grid-cols-2 gap-2">
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_cardio_modality')}
                <select className="input mt-1 w-full" value={cardioModality} onChange={(e) => setCardioModality(e.target.value)} data-testid="life-cardio-modality">
                  {CARDIO_MODALITIES.map((o) => (
                    <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_steps')}
                <select className="input mt-1 w-full" value={stepsTarget} onChange={(e) => setStepsTarget(e.target.value)} data-testid="life-steps">
                  {STEPS_TARGETS.map((o) => (
                    <option key={o.id} value={o.id}>{pickLabel(o.labels, locale)}</option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}

        <label className="text-xs text-[color:var(--ink-muted)] block">{t('body.life_summary')}
          <textarea className="input mt-1 w-full" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} data-testid="life-summary" />
        </label>
        <button type="button" className="btn-primary text-sm" disabled={busy} onClick={submit} data-testid="life-submit">
          {busy ? '…' : t('body.life_submit_btn')}
        </button>
        {msg && <p className="text-sm text-[color:var(--ink-muted)]" data-testid="life-msg">{msg}</p>}
      </section>
    </div>
  );
}
