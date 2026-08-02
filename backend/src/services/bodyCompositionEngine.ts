/**
 * Realistic body-composition projection engine.
 * Uses RAG-retrieved rates for medication curves, calorie deficit, exercise,
 * and FFM partitioning — then feeds quantitative guidance to image prompts.
 */
import {
  retrieveBodyCompositionKnowledge,
  ratesFromChunks,
} from './bodyCompositionKnowledge';

export type Adherence = 'low' | 'moderate' | 'high';
export type MagnitudeCap = 'conservative' | 'moderate';

export type PlanConfig = {
  medication_record_ids?: string[];
  nutrition_plan_ids?: string[];
  exercise_plan_ids?: string[];
  medication_adherence?: Adherence;
  nutrition_adherence?: Adherence;
  exercise_adherence?: Adherence;
  resistance_days_per_week?: number;
  cardio_days_per_week?: number;
  protein_emphasis?: boolean;
  daily_calories?: number | null;
  deficit_kcal?: number | null;
};

export type ScenarioAssumptions = {
  sleep_adequate?: boolean;
  hydration_adequate?: boolean;
  recovery_adequate?: boolean;
  comorbidity_stable?: boolean;
  change_magnitude?: MagnitudeCap;
};

const ADH_W: Record<Adherence, number> = { low: 0.45, moderate: 0.72, high: 0.95 };

export type MedInput = {
  id: string;
  name: string;
  class_tag?: string | null;
  dosage?: string | null;
};

export type PlanInput = {
  id: string;
  title: string;
  plan_type?: string;
  /** Structured params from lifestyle plan */
  daily_calories?: number | null;
  deficit_kcal?: number | null;
  protein_g?: number | null;
  summary?: string | null;
};

export type CompositionProjection = {
  ok: boolean;
  blockers: string[];
  horizon_weeks: number;
  magnitude_cap: MagnitudeCap;
  energy: {
    bmr_kcal: number | null;
    tdee_kcal: number | null;
    intake_kcal: number | null;
    deficit_kcal_day: number | null;
    activity_factor: number | null;
  };
  deltas: {
    weight_kg: number;
    fat_mass_kg: number;
    ffm_kg: number;
    waist_cm: number;
    body_fat_pct_points: number;
    med_weight_kg: number;
    diet_weight_kg: number;
    exercise_weight_kg: number;
  };
  projected: {
    weight_kg: number | null;
    fat_mass_kg: number | null;
    ffm_kg: number | null;
    waist_cm: number | null;
    body_fat_pct: number | null;
    bmi: number | null;
    muscle_mass_kg: number | null;
  };
  silhouette_delta_pct: number;
  monthly_rates: Array<{ label: string; kg_per_month: number; pct_bw_per_month: number }>;
  rag_citations: Array<{ id: string; title: string; source: string; domain: string; score: number }>;
  rag_context: string;
  rules: Array<{
    id: string;
    if: string;
    then: string;
    applied: boolean;
    silhouette_delta_pct: number;
    kg_delta?: number;
  }>;
  identity_locks: string;
  summary: string;
  visual_guidance: {
    soft_tissue: string;
    waist_hint_cm: number | null;
    muscle_tone: string;
    intensity: 'subtle' | 'modest' | 'noticeable';
  };
};

function classifyMed(m: MedInput): 'tirzepatide' | 'semaglutide' | 'liraglutide' | 'metformin' | 'orlistat' | 'hrt' | 'other' {
  const s = `${m.name} ${m.class_tag || ''} ${m.dosage || ''}`.toLowerCase();
  if (/tirzepatida|tirzepatide|mounjaro|zepbound|dual.?incretin/.test(s)) return 'tirzepatide';
  if (/semaglutida|semaglutide|ozempic|wegovy|rybelsus/.test(s)) return 'semaglutide';
  if (/liraglutida|liraglutide|saxenda|victoza/.test(s)) return 'liraglutide';
  if (/metformin|glifage/.test(s)) return 'metformin';
  if (/orlistat|xenical/.test(s)) return 'orlistat';
  if (/testosteron|androgel|\bhrt\b/.test(s)) return 'hrt';
  if (/incretin|glp.?1|glp1/.test(s)) return 'semaglutide';
  return 'other';
}

function interpolatePct(weeks: number, points: Array<[number, number]>): number {
  if (!points.length) return 0;
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  if (weeks <= sorted[0][0]) return sorted[0][1] * (weeks / Math.max(1, sorted[0][0]));
  for (let i = 0; i < sorted.length - 1; i++) {
    const [w0, p0] = sorted[i];
    const [w1, p1] = sorted[i + 1];
    if (weeks <= w1) {
      const t = (weeks - w0) / Math.max(1e-6, w1 - w0);
      return p0 + t * (p1 - p0);
    }
  }
  const [wLast, pLast] = sorted[sorted.length - 1];
  // plateau-ish after last point
  return pLast * (1 + 0.05 * Math.min(1, (weeks - wLast) / 52));
}

function medCurvePct(kind: ReturnType<typeof classifyMed>, weeks: number, rates: Record<string, number>): number {
  if (kind === 'tirzepatide') {
    return interpolatePct(weeks, [
      [12, rates.pct_bw_at_12w ?? 7.5],
      [24, rates.pct_bw_at_24w ?? 13],
      [52, rates.pct_bw_at_52w ?? 18],
      [72, rates.pct_bw_at_72w ?? 20.9],
    ]);
  }
  if (kind === 'semaglutide') {
    return interpolatePct(weeks, [
      [12, rates.pct_bw_at_12w ?? 5.5],
      [24, rates.pct_bw_at_24w ?? 9.5],
      [52, rates.pct_bw_at_52w ?? 13.5],
      [68, rates.pct_bw_at_68w ?? 14.9],
    ]);
  }
  if (kind === 'liraglutide') {
    return interpolatePct(weeks, [
      [12, rates.pct_bw_at_12w ?? 3.5],
      [24, rates.pct_bw_at_24w ?? 5.5],
      [52, rates.pct_bw_at_52w ?? 7.5],
      [56, rates.pct_bw_at_56w ?? 8],
    ]);
  }
  if (kind === 'metformin') {
    return interpolatePct(weeks, [
      [12, rates.pct_bw_at_12w ?? 1],
      [24, rates.pct_bw_at_24w ?? 1.8],
      [52, rates.pct_bw_at_52w ?? 2.5],
    ]);
  }
  if (kind === 'orlistat') {
    return interpolatePct(weeks, [
      [12, rates.pct_bw_at_12w ?? 1.2],
      [24, rates.pct_bw_at_24w ?? 2.2],
      [52, rates.pct_bw_at_52w ?? 3.2],
    ]);
  }
  return 0;
}

function activityFactor(resist: number, cardio: number, rates: Record<string, number>): number {
  const load = resist * 1.1 + cardio;
  if (load >= 8) return rates.activity_high ?? 1.725;
  if (load >= 5) return rates.activity_moderate ?? 1.55;
  if (load >= 2) return rates.activity_light ?? 1.375;
  return rates.activity_sedentary ?? 1.2;
}

function mifflinBmr(weight: number, height: number, sex: string | null | undefined, age = 40): number {
  const base = 10 * weight + 6.25 * height - 5 * age;
  return sex === 'M' || sex === 'male' ? base + 5 : base - 161;
}

function estimateFatMass(weight: number, bfPct: number | null | undefined, sex: string | null | undefined): number {
  if (bfPct != null && bfPct > 3 && bfPct < 70) return weight * (bfPct / 100);
  // rough defaults
  const def = sex === 'M' || sex === 'male' ? 0.22 : 0.32;
  return weight * def;
}

export function projectBodyComposition(input: {
  horizon_weeks: number;
  sex?: string | null;
  age_years?: number | null;
  baseline: {
    height_cm?: number | null;
    weight_kg?: number | null;
    waist_cm?: number | null;
    body_fat_pct?: number | null;
    muscle_mass_kg?: number | null;
    bmi?: number | null;
  };
  medications?: MedInput[];
  nutritionPlans?: PlanInput[];
  exercisePlans?: PlanInput[];
  plan_config: PlanConfig;
  assumptions: ScenarioAssumptions;
}): CompositionProjection {
  const blockers: string[] = [];
  const weeks = Math.max(4, Math.min(260, Number(input.horizon_weeks) || 12));
  const months = weeks / 4.345;
  const cap: MagnitudeCap = input.assumptions.change_magnitude === 'moderate' ? 'moderate' : 'conservative';
  // Cap total BW % change for communication realism
  const maxAbsPct = cap === 'moderate' ? 12 : 8;

  const w0 = input.baseline.weight_kg ?? null;
  const h0 = input.baseline.height_cm ?? null;
  if (!w0 || !h0) blockers.push('Altura e peso do baseline são obrigatórios para o envelope.');

  const pc = input.plan_config || {};
  const medIds = new Set(pc.medication_record_ids || []);
  const nutIds = new Set(pc.nutrition_plan_ids || []);
  const exIds = new Set(pc.exercise_plan_ids || []);
  const meds = (input.medications || []).filter((m) => medIds.has(m.id));
  const nuts = (input.nutritionPlans || []).filter((p) => nutIds.has(p.id));
  const exs = (input.exercisePlans || []).filter((p) => exIds.has(p.id));

  if (!meds.length && !nuts.length && !exs.length) {
    blockers.push('Selecione ao menos um plano de intervenção (medicamento, nutrição ou treino).');
  }
  if (input.assumptions.comorbidity_stable === false) {
    blockers.push('Comorbidades não estáveis — revise clinicamente antes de simular.');
  }

  const medA = ADH_W[pc.medication_adherence || 'moderate'];
  const nutA = ADH_W[pc.nutrition_adherence || 'moderate'];
  const exA = ADH_W[pc.exercise_adherence || 'moderate'];
  const resist = Math.max(0, Math.min(7, Number(pc.resistance_days_per_week ?? 3)));
  const cardio = Math.max(0, Math.min(7, Number(pc.cardio_days_per_week ?? 2)));

  // RAG retrieval grounded on selected interventions
  const queryText = [
    ...meds.map((m) => `${m.name} ${m.class_tag || ''}`),
    ...nuts.map((n) => `diet calories deficit ${n.title} ${n.summary || ''}`),
    ...exs.map((e) => `exercise resistance cardio ${e.title}`),
    `body composition fat free mass waist TDEE ${weeks} weeks`,
    pc.protein_emphasis ? 'protein FFM' : '',
  ].join(' ');

  const chunks = retrieveBodyCompositionKnowledge({
    text: queryText,
    tags: [
      ...meds.map((m) => classifyMed(m)),
      nuts.length ? 'diet' : '',
      exs.length ? 'exercise' : '',
      'energy',
      'composition',
      'safety',
    ].filter(Boolean),
    limit: 8,
  });
  const rates = ratesFromChunks(chunks);

  const kcalPerKg = rates.kcal_per_kg_fat ?? 7700;
  const efficiency = rates.metabolic_efficiency ?? 0.78;
  const overlap = rates.med_diet_overlap ?? 0.35;
  const maxWeeklyKg = rates.max_weekly_kg ?? 1.2;
  const maxWeeklyPct = rates.max_weekly_pct_bw ?? 1.0;

  const age = input.age_years && input.age_years > 16 && input.age_years < 100 ? input.age_years : 40;
  const bmr = w0 && h0 ? mifflinBmr(w0, h0, input.sex, age) : null;
  const act = activityFactor(resist, cardio, rates);
  const tdee = bmr != null ? bmr * act : null;

  // Nutrition intake
  const planCalories = nuts.map((n) => n.daily_calories).find((c) => c && c > 800) || null;
  const planDeficit = nuts.map((n) => n.deficit_kcal).find((c) => c && c > 0) || null;
  let intake: number | null = null;
  let deficitDay: number | null = null;
  if (tdee != null) {
    if (planCalories) {
      intake = planCalories;
      deficitDay = Math.max(0, tdee - planCalories);
    } else if (planDeficit) {
      deficitDay = Math.min(rates.max_deficit_kcal ?? 1000, planDeficit);
      intake = tdee - deficitDay;
    } else if (nuts.length) {
      deficitDay = rates.moderate_deficit_kcal ?? 500;
      intake = tdee - deficitDay;
    } else {
      deficitDay = 0;
      intake = tdee;
    }
  }

  // Extra cardio kcal (compensated)
  const cardioKcalWeek = cardio * (rates.cardio_kcal_per_session ?? 250) * (1 - (rates.compensation_fraction ?? 0.25));
  const cardioDeficitDay = cardioKcalWeek / 7;

  const rules: CompositionProjection['rules'] = [];
  const monthlyRates: CompositionProjection['monthly_rates'] = [];
  const push = (
    id: string,
    iff: string,
    then: string,
    applied: boolean,
    sil: number,
    kg?: number,
  ) => {
    rules.push({ id, if: iff, then, applied, silhouette_delta_pct: applied ? sil : 0, kg_delta: kg });
  };

  // Medication kg from %BW curves (adherence-scaled)
  let medKg = 0;
  let medFatFrac = 0.8;
  for (const m of meds) {
    const kind = classifyMed(m);
    if (kind === 'hrt') {
      const ffmGain = 0.15 * medA * months;
      push('med_hrt', 'TRH/testosterona com acompanhamento', `+${ffmGain.toFixed(2)} kg FFM ilustrativo`, true, 0.4 * medA * (weeks / 12), -ffmGain * 0.1);
      continue;
    }
    // Prefer corpus rates for this medication class
    const corp = retrieveBodyCompositionKnowledge({ tags: [kind], domains: ['medication'], limit: 2 });
    const r = { ...rates, ...ratesFromChunks(corp) };
    const pct = medCurvePct(kind, weeks, r) * medA;
    if (pct <= 0 || !w0) {
      push(`med_${kind}_${m.id.slice(0, 6)}`, `${m.name}`, 'Sem curva de peso aplicável', false, 0);
      continue;
    }
    const kg = -(w0 * (pct / 100));
    medKg += kg;
    medFatFrac = Math.max(medFatFrac, r.fat_fraction_of_loss ?? 0.8);
    const perMonth = kg / Math.max(0.25, months);
    monthlyRates.push({ label: m.name, kg_per_month: Math.round(perMonth * 100) / 100, pct_bw_per_month: Math.round((pct / months) * 100) / 100 });
    push(
      `med_${kind}`,
      `${m.name} (${kind}) · adesão ${pc.medication_adherence || 'moderate'}`,
      `${pct.toFixed(1)}% PC ≈ ${kg.toFixed(1)} kg em ${weeks}w (curva educacional)`,
      true,
      kg / w0 * 100 * 0.7,
      kg,
    );
  }

  // Diet from calorie deficit
  let dietKg = 0;
  if (nuts.length && deficitDay != null && deficitDay > 0 && w0) {
    const days = weeks * 7;
    const effective = deficitDay * nutA * efficiency;
    dietKg = -((effective * days) / kcalPerKg);
    const perMonth = dietKg / Math.max(0.25, months);
    monthlyRates.push({
      label: 'Déficit calórico (dieta)',
      kg_per_month: Math.round(perMonth * 100) / 100,
      pct_bw_per_month: Math.round((-dietKg / w0 / months) * 10000) / 100,
    });
    push(
      'diet_energy',
      `Ingestão ~${Math.round(intake || 0)} kcal/d vs TDEE ~${Math.round(tdee || 0)} (déficit ${Math.round(deficitDay)} kcal)`,
      `${dietKg.toFixed(1)} kg via balanço energético (η=${efficiency})`,
      true,
      (dietKg / w0) * 100 * 0.75,
      dietKg,
    );
  } else if (nuts.length) {
    push('diet_energy', 'Plano nutricional sem calorias estruturadas', 'Usando déficit moderado padrão se TDEE disponível', false, 0);
  }

  // Exercise extra (cardio kcal) + resistance FFM
  let exKg = 0;
  let ffmDelta = 0;
  if (exs.length && w0) {
    const days = weeks * 7;
    const exDeficit = cardioDeficitDay * exA;
    exKg = -((exDeficit * days) / kcalPerKg);
    if (resist >= 2 && pc.protein_emphasis !== false) {
      ffmDelta += (rates.ffm_gain_kg_per_month_mod ?? 0.1) * months * exA;
    } else if (resist >= 2) {
      ffmDelta += (rates.ffm_gain_kg_per_month_mod ?? 0.1) * 0.5 * months * exA;
    }
    monthlyRates.push({
      label: 'Exercício (gasto + composição)',
      kg_per_month: Math.round((exKg / Math.max(0.25, months)) * 100) / 100,
      pct_bw_per_month: Math.round((-exKg / w0 / months) * 10000) / 100,
    });
    push(
      'exercise_energy',
      `Força ${resist}d + cardio ${cardio}d · adesão ${pc.exercise_adherence || 'moderate'}`,
      `${exKg.toFixed(1)} kg via gasto + ${ffmDelta.toFixed(2)} kg FFM`,
      true,
      (exKg / w0) * 100 * 0.6,
      exKg,
    );
  }

  // Lifestyle modifiers
  if (input.assumptions.sleep_adequate) {
    push('sleep', 'Sono adequado', 'Suporte a adesão metabólica (+8% eficiência dieta)', true, -0.15 * (weeks / 12));
    dietKg *= 1.08;
  }
  if (input.assumptions.hydration_adequate) {
    push('hydration', 'Hidratação adequada', 'Suporte a composição', true, -0.1 * (weeks / 12));
  }
  if (input.assumptions.recovery_adequate) {
    push('recovery', 'Recuperação adequada', 'Permite carga de treino', true, -0.12 * (weeks / 12));
    ffmDelta *= 1.1;
  }
  push(
    'comorbidity',
    'Comorbidades estáveis',
    'Envelope clínico liberado',
    input.assumptions.comorbidity_stable !== false,
    0,
  );

  // Subadditive combination of med + diet (+ exercise)
  const combinedKg =
    medKg
    + dietKg * (1 - (medKg < 0 ? overlap : 0))
    + exKg;

  // Physiological weekly ceiling
  let totalKg = combinedKg;
  if (w0) {
    const maxKg = -Math.min(maxWeeklyKg * weeks, (maxWeeklyPct / 100) * w0 * weeks);
    // maxKg is negative (loss ceiling). Allow HRT-driven slight gain separately via ffm
    if (totalKg < maxKg) totalKg = maxKg;
  }

  // Magnitude communication cap (% BW)
  if (w0) {
    const pct = (totalKg / w0) * 100;
    if (pct < -maxAbsPct) totalKg = -((maxAbsPct / 100) * w0);
    if (pct > 1.5 && !meds.some((m) => classifyMed(m) === 'hrt')) totalKg = Math.min(totalKg, 0.015 * w0);
  }

  // Partition fat vs FFM
  const fat0 = w0 ? estimateFatMass(w0, input.baseline.body_fat_pct, input.sex) : null;
  const ffm0 = w0 && fat0 != null ? w0 - fat0 : null;
  const hasRt = resist >= 2 && exs.length > 0;
  const ffmLossFrac = pc.protein_emphasis && hasRt
    ? (rates.ffm_loss_fraction_protein_rt ?? 0.12)
    : hasRt
      ? (rates.ffm_loss_fraction_default ?? 0.2)
      : (rates.ffm_loss_fraction_no_rt ?? 0.35);

  let fatDelta = 0;
  let ffmChange = ffmDelta;
  if (totalKg < 0) {
    // weight loss: mostly fat, some FFM; meds skew more to fat
    const loss = -totalKg;
    const medShare = medKg < 0 ? Math.min(1, (-medKg) / Math.max(1e-6, -combinedKg || 1)) : 0;
    const fatFrac = medFatFrac * medShare + (1 - medShare) * (1 - ffmLossFrac);
    fatDelta = -(loss * fatFrac);
    ffmChange += -(loss * (1 - fatFrac));
  } else {
    fatDelta = totalKg * 0.3;
    ffmChange += totalKg * 0.7;
  }

  // Net weight from compartments
  const netWeightDelta = fatDelta + ffmChange;
  const weight1 = w0 != null ? Math.round((w0 + netWeightDelta) * 10) / 10 : null;
  const fat1 = fat0 != null ? Math.max(2, Math.round((fat0 + fatDelta) * 10) / 10) : null;
  const ffm1 = ffm0 != null ? Math.max(20, Math.round((ffm0 + ffmChange) * 10) / 10) : null;
  const bf1 = weight1 && fat1 != null ? Math.round((fat1 / weight1) * 1000) / 10 : null;
  const bmi1 = weight1 && h0 ? Math.round((weight1 / (h0 / 100) ** 2) * 10) / 10 : null;

  const centralShare = rates.central_fat_share ?? 0.55;
  const waistPerKg = rates.waist_cm_per_kg_central_fat ?? 0.9;
  const waistDelta = fatDelta < 0 ? fatDelta * centralShare * waistPerKg : fatDelta * 0.4 * waistPerKg;
  const waist0 = input.baseline.waist_cm ?? null;
  const waist1 = waist0 != null ? Math.round((waist0 + waistDelta) * 10) / 10 : null;

  // BW magnitude may use 8–12% caps; img2img visual silhouette is capped at 7% (pipeline v5).
  const IMG2IMG_SIL_CAP = 7;
  const silhouetteRaw = w0 ? Math.max(-maxAbsPct, Math.min(maxAbsPct, (netWeightDelta / w0) * 100)) : 0;
  const silhouette = Math.max(-IMG2IMG_SIL_CAP, Math.min(IMG2IMG_SIL_CAP, silhouetteRaw));
  const absSil = Math.abs(silhouette);
  const intensity: CompositionProjection['visual_guidance']['intensity'] =
    absSil >= 6 ? 'noticeable' : absSil >= 3 ? 'modest' : 'subtle';

  const muscleTone = ffmChange > 0.15
    ? 'slightly firmer limb and trunk musculature'
    : ffmChange < -0.4
      ? 'mild soft-tissue reduction without athletic exaggeration'
      : 'natural soft-tissue change with preserved muscle contours';

  const softTissue = netWeightDelta < -0.3
    ? `${intensity} reduction of subcutaneous soft tissue, preferential central abdomen`
    : netWeightDelta > 0.3
      ? 'subtle soft-tissue increase with natural proportions'
      : 'minimal silhouette change';

  const ragContext = chunks
    .map((c) => `[${c.id}] ${c.title}: ${c.text}`)
    .join('\n');

  const ok = blockers.length === 0;
  const dietMonth = dietKg / Math.max(0.25, months);
  const medMonth = medKg / Math.max(0.25, months);

  return {
    ok,
    blockers,
    horizon_weeks: weeks,
    magnitude_cap: cap,
    energy: {
      bmr_kcal: bmr != null ? Math.round(bmr) : null,
      tdee_kcal: tdee != null ? Math.round(tdee) : null,
      intake_kcal: intake != null ? Math.round(intake) : null,
      deficit_kcal_day: deficitDay != null ? Math.round(deficitDay + (exs.length ? cardioDeficitDay * exA : 0)) : null,
      activity_factor: Math.round(act * 1000) / 1000,
    },
    deltas: {
      weight_kg: Math.round(netWeightDelta * 100) / 100,
      fat_mass_kg: Math.round(fatDelta * 100) / 100,
      ffm_kg: Math.round(ffmChange * 100) / 100,
      waist_cm: Math.round(waistDelta * 100) / 100,
      body_fat_pct_points: bf1 != null && input.baseline.body_fat_pct != null
        ? Math.round((bf1 - input.baseline.body_fat_pct) * 10) / 10
        : 0,
      med_weight_kg: Math.round(medKg * 100) / 100,
      diet_weight_kg: Math.round(dietKg * 100) / 100,
      exercise_weight_kg: Math.round(exKg * 100) / 100,
    },
    projected: {
      weight_kg: weight1,
      fat_mass_kg: fat1,
      ffm_kg: ffm1,
      waist_cm: waist1,
      body_fat_pct: bf1,
      bmi: bmi1,
      muscle_mass_kg: ffm1 != null
        ? Math.round((ffm1 * 0.55) * 10) / 10
        : input.baseline.muscle_mass_kg ?? null,
    },
    silhouette_delta_pct: Math.round(silhouette * 10) / 10,
    monthly_rates: monthlyRates,
    rag_citations: chunks.map((c) => ({
      id: c.id,
      title: c.title,
      source: c.source,
      domain: c.domain,
      score: c.score,
    })),
    rag_context: ragContext,
    rules,
    identity_locks: `Face/altura/membros/marcas/roupa/pose/fundo bloqueados · teto BW |Δ| ${maxAbsPct}% · silhueta img2img ≤7% · med ${medMonth.toFixed(2)} kg/mês · dieta ${dietMonth.toFixed(2)} kg/mês · sem promessa clínica`,
    summary: ok
      ? `${weeks}w · Δ ${netWeightDelta.toFixed(1)} kg (gordura ${fatDelta.toFixed(1)} / FFM ${ffmChange.toFixed(1)}) · déficit ${deficitDay != null ? Math.round(deficitDay) : '—'} kcal/d · RAG ${chunks.length} fontes`
      : blockers.join(' '),
    visual_guidance: {
      soft_tissue: softTissue,
      waist_hint_cm: waist1,
      muscle_tone: muscleTone,
      intensity,
    },
  };
}
