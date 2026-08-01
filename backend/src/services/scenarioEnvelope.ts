/**
 * Scenario envelope — wraps the RAG-grounded body-composition engine
 * for if/then UI + photoreal image prompts.
 */
import {
  projectBodyComposition,
  type CompositionProjection,
  type MedInput,
  type PlanInput,
  type PlanConfig,
  type ScenarioAssumptions,
  type Adherence,
  type MagnitudeCap,
} from './bodyCompositionEngine';

export type { Adherence, MagnitudeCap, PlanConfig, ScenarioAssumptions, MedInput, PlanInput };

export type EnvelopeRule = {
  id: string;
  if: string;
  then: string;
  applied: boolean;
  silhouette_delta_pct: number;
  kg_delta?: number;
};

export type ScenarioEnvelope = {
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
    fat_mass_kg?: number | null;
    ffm_kg?: number | null;
    muscle_mass_kg?: number | null;
  };
  deltas?: CompositionProjection['deltas'];
  energy?: CompositionProjection['energy'];
  monthly_rates?: CompositionProjection['monthly_rates'];
  rag_citations?: CompositionProjection['rag_citations'];
  visual_guidance?: CompositionProjection['visual_guidance'];
  silhouette_delta_pct?: number;
  rules: EnvelopeRule[];
  identity_locks: string;
  summary: string;
  /** Present after enrichEnvelopeWithAnatomy */
  anatomicalEnvelope?: {
    maxAbsDeltaPct: number;
    regions: Array<{ region: string; deltaPct: number; rationale: string }>;
    faceLocked?: boolean;
    heightLocked?: boolean;
    limbLengthLocked?: boolean;
    clothingPreserved?: boolean;
    backgroundPreserved?: boolean;
    photorealism?: boolean;
    fidelity?: string;
    uncertaintyBand?: string;
  };
  visualProfiles?: Array<{ medication: string; profileId: string; labelPt: string; kind: string }>;
  narrativePt?: string[];
  prompt_version?: string;
  watermark?: string;
};

function mergePlanCalories(
  plans: PlanInput[] | undefined,
  plan_config: PlanConfig,
): PlanInput[] {
  const list = [...(plans || [])];
  if (plan_config.daily_calories || plan_config.deficit_kcal) {
    if (!list.length) {
      list.push({
        id: '_scenario_nutrition',
        title: 'Cenário (calorias)',
        plan_type: 'nutrition',
        daily_calories: plan_config.daily_calories ?? null,
        deficit_kcal: plan_config.deficit_kcal ?? null,
      });
    } else {
      list[0] = {
        ...list[0],
        daily_calories: plan_config.daily_calories ?? list[0].daily_calories,
        deficit_kcal: plan_config.deficit_kcal ?? list[0].deficit_kcal,
      };
    }
  }
  return list;
}

export function computeScenarioEnvelope(input: {
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
}): ScenarioEnvelope {
  const nutritionPlans = mergePlanCalories(input.nutritionPlans, input.plan_config);
  const proj = projectBodyComposition({
    ...input,
    nutritionPlans,
  });
  const maxAbs = proj.magnitude_cap === 'moderate' ? 12 : 8;
  return {
    ok: proj.ok,
    blockers: proj.blockers,
    horizon_weeks: proj.horizon_weeks,
    magnitude_cap: proj.magnitude_cap,
    max_abs_silhouette_pct: maxAbs,
    projected: {
      weight_kg: proj.projected.weight_kg,
      waist_cm: proj.projected.waist_cm,
      body_fat_pct: proj.projected.body_fat_pct,
      bmi: proj.projected.bmi,
      fat_mass_kg: proj.projected.fat_mass_kg,
      ffm_kg: proj.projected.ffm_kg,
      muscle_mass_kg: proj.projected.muscle_mass_kg,
    },
    deltas: proj.deltas,
    energy: proj.energy,
    monthly_rates: proj.monthly_rates,
    rag_citations: proj.rag_citations,
    visual_guidance: proj.visual_guidance,
    silhouette_delta_pct: proj.silhouette_delta_pct,
    rules: proj.rules,
    identity_locks: proj.identity_locks,
    summary: proj.summary,
  };
}

export function buildPhotorealScenarioPrompt(opts: {
  weeks: number;
  envelope: ScenarioEnvelope;
  sex?: string | null;
  hasReferencePhoto?: boolean;
  interventions?: string[];
}): string {
  const sex = opts.sex === 'M' || opts.sex === 'male' ? 'male' : 'female';
  const vg = opts.envelope.visual_guidance;
  const p = opts.envelope.projected;
  const d = opts.envelope.deltas;
  const e = opts.envelope.energy;
  const identity = opts.hasReferencePhoto
    ? 'Edit this clinical front-view photograph of the SAME adult patient. Preserve absolute identity, facial features, skin tone, clothing style/color, pose, camera framing, and studio background.'
    : `Create a photorealistic clinical full-body front-view photograph of an adult ${sex} patient for body-composition educational visualization. Neutral studio lighting, accurate anatomy, natural skin texture, professional medical photography.`;

  const ae = opts.envelope.anatomicalEnvelope;
  const regional = ae?.regions?.length
    ? `Regional anatomical guidance (educational img2img, clamp |Δ|≤${ae.maxAbsDeltaPct}%): ${
        ae.regions
          .filter((r) => Math.abs(r.deltaPct) >= 0.05)
          .map((r) => `${r.region} ${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%`)
          .join(', ') || 'near-zero regional change'
      }. Locks: face=${ae.faceLocked !== false}, height=${ae.heightLocked !== false}, limbs=${ae.limbLengthLocked !== false}, clothing=${ae.clothingPreserved !== false}, background=${ae.backgroundPreserved !== false}.`
    : '';
  const profiles = opts.envelope.visualProfiles?.length
    ? `Visual profiles: ${opts.envelope.visualProfiles.map((v) => `${v.medication}→${v.profileId}`).join('; ')}.`
    : '';

  const compositionBits = [
    vg ? `Visual change: ${vg.soft_tissue}; ${vg.muscle_tone}; intensity=${vg.intensity}.` : '',
    regional,
    profiles,
    d ? `Illustrative compartment deltas (do not render numbers): weight ${d.weight_kg} kg, fat ${d.fat_mass_kg} kg, FFM ${d.ffm_kg} kg, waist ${d.waist_cm} cm.` : '',
    p.weight_kg != null ? `Target physique consistent with ~${p.weight_kg} kg and waist ~${p.waist_cm ?? 'n/a'} cm after ${opts.weeks} weeks (educational, not a promise).` : '',
    p.body_fat_pct != null ? `Body-fat appearance consistent with ~${p.body_fat_pct}% (natural, not extreme).` : '',
    e?.deficit_kcal_day != null && e.deficit_kcal_day > 0
      ? `Context: sustained ~${e.deficit_kcal_day} kcal/day energy deficit with adherence-adjusted medication and training effects.`
      : '',
    opts.envelope.monthly_rates?.length
      ? `Drivers: ${opts.envelope.monthly_rates.map((r) => `${r.label} ≈ ${r.kg_per_month} kg/mo`).join('; ')}.`
      : '',
  ].filter(Boolean);

  const interventions = (opts.interventions || []).slice(0, 8).join('; ');
  const citations = (opts.envelope.rag_citations || []).slice(0, 4).map((c) => c.id).join(', ');
  const watermark = opts.envelope.watermark || 'SIMULACAO ILUSTRATIVA - NAO E PREVISAO';

  return [
    identity,
    `Apply realistic ${opts.weeks}-week body-composition change grounded in medication curves, calorie balance, exercise, and anatomical region envelope — not fantasy transformation.`,
    ...compositionBits,
    interventions ? `Clinical plan context (do not render text): ${interventions}.` : '',
    citations ? `Knowledge grounding ids: ${citations}.` : '',
    'Stay true to nature: ultra-realistic professional 4K-grade imagery, natural proportions, no cartoon, no beauty-filter exaggeration, no surgical alteration, no impossible leanness.',
    `Photoreal only. Burn discreet watermark: ${watermark}.`,
    'Intended use: professionally mediated scenario visualization — not autonomous diagnosis or outcome guarantee.',
  ].filter(Boolean).join(' ');
}
