/**
 * If/then anatomical envelope for body-composition scenario visualization.
 * Conservative clinical communication — no guaranteed kg outcomes.
 */
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
};

export type ScenarioAssumptions = {
  sleep_adequate?: boolean;
  hydration_adequate?: boolean;
  recovery_adequate?: boolean;
  comorbidity_stable?: boolean;
  change_magnitude?: MagnitudeCap;
};

export type EnvelopeRule = {
  id: string;
  if: string;
  then: string;
  applied: boolean;
  silhouette_delta_pct: number;
};

const ADH_W: Record<Adherence, number> = { low: 0.45, moderate: 0.72, high: 0.95 };

export function computeScenarioEnvelope(input: {
  horizon_weeks: number;
  baseline: {
    height_cm?: number | null;
    weight_kg?: number | null;
    waist_cm?: number | null;
    body_fat_pct?: number | null;
    bmi?: number | null;
  };
  medications?: Array<{ id: string; name: string; class_tag?: string | null }>;
  nutritionPlans?: Array<{ id: string; title: string }>;
  exercisePlans?: Array<{ id: string; title: string }>;
  plan_config: PlanConfig;
  assumptions: ScenarioAssumptions;
}): {
  ok: boolean;
  blockers: string[];
  horizon_weeks: number;
  magnitude_cap: MagnitudeCap;
  max_abs_silhouette_pct: number;
  projected: {
    weight_kg: number | null;
    waist_cm: number | null;
    body_fat_pct: number | null;
    bmi: number | null;
  };
  rules: EnvelopeRule[];
  identity_locks: string;
  summary: string;
} {
  const blockers: string[] = [];
  const weeks = Math.max(4, Math.min(260, Number(input.horizon_weeks) || 12));
  const cap: MagnitudeCap = input.assumptions.change_magnitude === 'moderate' ? 'moderate' : 'conservative';
  const maxAbs = cap === 'moderate' ? 8 : 5;

  if (!input.baseline.weight_kg || !input.baseline.height_cm) {
    blockers.push('Altura e peso do baseline são obrigatórios para o envelope.');
  }

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

  const medA = ADH_W[pc.medication_adherence || 'moderate'];
  const nutA = ADH_W[pc.nutrition_adherence || 'moderate'];
  const exA = ADH_W[pc.exercise_adherence || 'moderate'];
  const resist = Math.max(0, Math.min(7, Number(pc.resistance_days_per_week ?? 3)));
  const cardio = Math.max(0, Math.min(7, Number(pc.cardio_days_per_week ?? 2)));

  let score = 0;
  const rules: EnvelopeRule[] = [];

  const push = (id: string, iff: string, then: string, applied: boolean, delta: number) => {
    rules.push({ id, if: iff, then, applied, silhouette_delta_pct: applied ? delta : 0 });
    if (applied) score += delta;
  };

  const hasIncretin = meds.some((m) => /incretin|glp|tirzepatida|semaglutida|mounjaro|ozempic|wegovy/i.test(`${m.name} ${m.class_tag || ''}`));
  const hasMetformin = meds.some((m) => /metformin|glifage/i.test(`${m.name} ${m.class_tag || ''}`));
  const hasHrt = meds.some((m) => /testosteron|androgel|hrt/i.test(`${m.name} ${m.class_tag || ''}`));

  push(
    'med_incretin',
    'GLP-1 / dual incretin com adesão ≥ moderada',
    'Redução preferencial de adiposidade central (ilustrativa)',
    hasIncretin && medA >= ADH_W.moderate,
    -1.8 * medA * (weeks / 12),
  );
  push(
    'med_metformin',
    'Metformina confirmada pelo clínico',
    'Suporte metabólico sem Δ silhueta agressivo',
    hasMetformin,
    -0.35 * medA * (weeks / 12),
  );
  push(
    'med_hrt',
    'TRH/testosterona com acompanhamento',
    'Possível preservação/ganho de massa magra (ilustrativo)',
    hasHrt && medA >= ADH_W.moderate,
    0.25 * medA * (weeks / 12),
  );
  push(
    'nutrition',
    'Plano nutricional ativo com adesão',
    'Déficit energético moderado → menor circunferência',
    nuts.length > 0 && nutA >= ADH_W.low,
    -1.2 * nutA * (weeks / 12) * (pc.protein_emphasis ? 1.1 : 1),
  );
  push(
    'exercise',
    'Treino força+cardio com adesão',
    'Remodelação muscular + redução de cintura',
    exs.length > 0 && exA >= ADH_W.low,
    -0.9 * exA * ((resist + cardio) / 5) * (weeks / 12),
  );
  push(
    'sleep',
    'Sono adequado marcado',
    'Melhor aderência metabólica ao plano',
    !!input.assumptions.sleep_adequate,
    -0.25 * (weeks / 12),
  );
  push(
    'hydration',
    'Hidratação adequada',
    'Suporte a composição corporal',
    !!input.assumptions.hydration_adequate,
    -0.15 * (weeks / 12),
  );
  push(
    'recovery',
    'Recuperação adequada',
    'Permite carga de treino sustentável',
    !!input.assumptions.recovery_adequate,
    -0.2 * (weeks / 12),
  );
  push(
    'comorbidity',
    'Comorbidades estáveis',
    'Envelope clínico liberado',
    input.assumptions.comorbidity_stable !== false,
    0,
  );

  if (input.assumptions.comorbidity_stable === false) {
    blockers.push('Comorbidades não estáveis — revise clinicamente antes de simular.');
  }

  // Clamp silhouette delta
  let silhouette = Math.max(-maxAbs, Math.min(maxAbs, score));
  // Prefer reduction direction for adiposity phenotype when score negative
  if (silhouette > 0 && !hasHrt) silhouette = Math.min(silhouette, 1.5);

  const w0 = input.baseline.weight_kg || null;
  const waist0 = input.baseline.waist_cm || null;
  const fat0 = input.baseline.body_fat_pct || null;
  const h = input.baseline.height_cm || null;

  // Illustrative projections — explicitly not promises
  const wFactor = 1 + silhouette * 0.012;
  const waistFactor = 1 + silhouette * 0.014;
  const fatFactor = 1 + silhouette * 0.016;
  const weight_kg = w0 != null ? Math.round(w0 * wFactor * 10) / 10 : null;
  const waist_cm = waist0 != null ? Math.round(waist0 * waistFactor * 10) / 10 : null;
  const body_fat_pct = fat0 != null ? Math.round(Math.max(5, fat0 * fatFactor) * 10) / 10 : null;
  const bmi = weight_kg != null && h ? Math.round((weight_kg / (h / 100) ** 2) * 10) / 10 : null;

  const ok = blockers.length === 0;
  return {
    ok,
    blockers,
    horizon_weeks: weeks,
    magnitude_cap: cap,
    max_abs_silhouette_pct: maxAbs,
    projected: { weight_kg, waist_cm, body_fat_pct, bmi },
    rules,
    identity_locks: `Face/altura/comprimento de membros bloqueados · teto |Δ| ${maxAbs}% · sem kg prometidos`,
    summary: ok
      ? `Envelope ${weeks}w · Δ silhueta ilustrativo ${silhouette.toFixed(1)}% · teto ${cap}`
      : blockers.join(' '),
  };
}

export function buildPhotorealScenarioPrompt(opts: {
  weeks: number;
  envelope: ReturnType<typeof computeScenarioEnvelope>;
  sex?: string | null;
  hasReferencePhoto?: boolean;
  interventions?: string[];
}): string {
  const sex = opts.sex === 'M' || opts.sex === 'male' ? 'male' : 'female';
  const delta = opts.envelope.rules.reduce((a, r) => a + (r.applied ? r.silhouette_delta_pct : 0), 0);
  const direction = delta < 0 ? 'modest reduction of central soft tissue' : 'subtle athletic remodeling';
  const identity = opts.hasReferencePhoto
    ? 'Edit this clinical front-view photograph of the SAME adult patient. Preserve absolute identity, facial features, skin tone, clothing style/color, pose, camera framing, and studio background.'
    : `Create a photorealistic clinical full-body front-view photograph of an adult ${sex} patient for body-composition educational visualization. Neutral studio lighting, accurate anatomy, natural skin texture, professional medical photography.`;
  const interventions = (opts.interventions || []).slice(0, 6).join('; ');
  return [
    identity,
    `Apply ${direction} consistent with a ${opts.weeks}-week professionally mediated illustrative simulation.`,
    opts.envelope.projected.waist_cm != null ? `Contextual target waist ~${opts.envelope.projected.waist_cm} cm (do not render numbers on image).` : '',
    interventions ? `Clinical plan context (do not render text): ${interventions}.` : '',
    'Stay true to nature: ultra-realistic professional 4K-grade imagery, natural proportions, no cartoon, no beauty-filter exaggeration, no surgical alteration.',
    'Photoreal only. Burn discreet watermark: SIMULACAO ILUSTRATIVA - NAO E PREVISAO.',
    'Intended use: professionally mediated scenario visualization — not autonomous diagnosis or outcome guarantee.',
  ].filter(Boolean).join(' ');
}
