/**
 * BodyPath-compatible anatomical envelope enrichment.
 * Keeps Clínica Tanah kg/RAG projections from ScenarioEnvelope and adds
 * regional visual guidance, visual profiles, narrative, and pipeline rules.
 */
import type { ScenarioAssumptions, ScenarioEnvelope, EnvelopeRule, MagnitudeCap } from './scenarioEnvelope';

export const PROMPT_VERSION = 'clinica.scenario.v5.img2img-anatomy-rag';
export const SCENARIO_WATERMARK = 'SIMULACAO ILUSTRATIVA - NAO E PREVISAO';

export type AnatomicalRegion =
  | 'waist'
  | 'abdomen'
  | 'hip'
  | 'arm'
  | 'thigh'
  | 'chest'
  | 'neck';

export type AnatomicalRegionDelta = {
  region: AnatomicalRegion;
  deltaPct: number;
  rationale: string;
};

/** Pipeline v5 img2img identity locks — same person/clothes/pose/BG; only soft-tissue silhouette changes. */
export const IMG2IMG_IDENTITY_LOCKS = [
  'face',
  'height',
  'limb_lengths',
  'skin_marks',
  'clothing',
  'pose',
  'background',
] as const;

/** Visual silhouette dynamic-range cap for img2img (matches BodyCompositionCalculator / pipeline v5). */
export const IMG2IMG_SILHOUETTE_CAP_PCT = 7;

export type Img2ImgPipelineConfig = {
  version: 'v5';
  identity_locks: typeof IMG2IMG_IDENTITY_LOCKS[number][];
  magnitude_ceiling_pct: number;
  effective_silhouette_delta_pct: number;
  rag_kg_preserved_pct: number;
  clothing_drape: 'preserve_garments_show_fit_change';
  transformation_style: 'clinical_before_after_same_frame';
};

export type AnatomicalEnvelope = {
  maxAbsDeltaPct: number;
  regions: AnatomicalRegionDelta[];
  faceLocked: boolean;
  heightLocked: boolean;
  limbLengthLocked: boolean;
  skinMarksLocked: boolean;
  poseLocked: boolean;
  clothingPreserved: boolean;
  backgroundPreserved: boolean;
  photorealism: boolean;
  fidelity: string;
  uncertaintyBand: string;
  /** Flat map for img2img providers / Gemini-style calculators */
  regional_anatomical_deltas_pct: Record<AnatomicalRegion, number>;
  img2img_pipeline_config: Img2ImgPipelineConfig;
};

export type VisualProfileEntry = {
  medication: string;
  profileId: string;
  labelPt: string;
  kind: 'metabolic' | 'redistribution' | 'context' | 'tone';
};

export type EnrichedScenarioEnvelope = ScenarioEnvelope & {
  anatomicalEnvelope: AnatomicalEnvelope;
  visualProfiles: VisualProfileEntry[];
  narrativePt: string[];
  prompt_version: string;
  watermark: string;
  disclaimerPt?: string;
  pillars?: { medication: boolean; nutrition: boolean; exercise: boolean };
  changeMagnitude?: MagnitudeCap;
  img2img_pipeline_config: Img2ImgPipelineConfig;
  regional_anatomical_deltas_pct: Record<AnatomicalRegion, number>;
};

type MedForAnatomy = {
  id?: string;
  name: string;
  visual_profile?: string | null;
  class_tag?: string | null;
  dosage?: string | null;
};

type ProfileMeta = {
  labelPt: string;
  kind: VisualProfileEntry['kind'];
  bias: Partial<Record<AnatomicalRegion, number>>;
};

const PROFILE_META: Record<string, ProfileMeta> = {
  glp1_metabolic: {
    labelPt: 'GLP-1 — redução direcional cintura/abdômen',
    kind: 'metabolic',
    bias: { waist: -1.0, abdomen: -1.1, hip: -0.35, thigh: -0.2, neck: -0.05 },
  },
  dual_incretin: {
    labelPt: 'Incretina dual — redução cintura/abdômen',
    kind: 'metabolic',
    bias: { waist: -1.1, abdomen: -1.2, hip: -0.45, thigh: -0.25 },
  },
  lipase_inhibitor: {
    labelPt: 'Inibidor de lipase — redução leve cintura/quadril',
    kind: 'metabolic',
    bias: { waist: -0.4, hip: -0.35, abdomen: -0.25 },
  },
  metformin: {
    labelPt: 'Metformina — efeito visual leve no abdômen',
    kind: 'metabolic',
    bias: { abdomen: -0.3, waist: -0.15 },
  },
  hrt_testosterone: {
    labelPt: 'TRH testosterona — tono em braço/coxa; redução ginoide leve',
    kind: 'tone',
    bias: { arm: 0.35, thigh: 0.3, hip: -0.25, waist: -0.1 },
  },
  hrt_estrogen: {
    labelPt: 'TRH estrogênio — redistribuição ginoide (contexto)',
    kind: 'redistribution',
    bias: { hip: 0.4, thigh: 0.15, waist: -0.15, abdomen: -0.1, chest: 0.1, arm: 0.05 },
  },
  hrt_progestogen: {
    labelPt: 'TRH progestágeno — tecido mole/retenção leve',
    kind: 'redistribution',
    bias: { hip: 0.2, abdomen: 0.1, chest: 0.05, waist: 0.05 },
  },
  hrt_tibolone: {
    labelPt: 'Tibolona — redistribuição leve em quadril',
    kind: 'redistribution',
    bias: { hip: 0.25, thigh: 0.1, waist: -0.1 },
  },
  hrt_antiandrogen: {
    labelPt: 'Antiandrógeno — redistribuição leve (contexto)',
    kind: 'redistribution',
    bias: { hip: 0.15, arm: -0.1, thigh: -0.05 },
  },
  thyroid: {
    labelPt: 'Tireoide — quase sem envelope visual próprio',
    kind: 'context',
    bias: { waist: -0.02, abdomen: -0.02 },
  },
  context_only: {
    labelPt: 'Contexto clínico — sem envelope visual próprio',
    kind: 'context',
    bias: {},
  },
};

const ALL_REGIONS: AnatomicalRegion[] = ['waist', 'abdomen', 'hip', 'arm', 'thigh', 'chest', 'neck'];

function inferProfile(m: MedForAnatomy): string {
  if (m.visual_profile && PROFILE_META[m.visual_profile]) return m.visual_profile;
  const s = `${m.name} ${m.class_tag || ''} ${m.dosage || ''}`.toLowerCase();
  if (/tirzepatida|tirzepatide|mounjaro|dual.?incretin/.test(s)) return 'dual_incretin';
  if (/semaglutida|semaglutide|ozempic|wegovy|rybelsus|liraglutida|saxenda|dulaglutida|trulicity|glp.?1/.test(s)) {
    return 'glp1_metabolic';
  }
  if (/orlistat|xenical|lipase/.test(s)) return 'lipase_inhibitor';
  if (/metformin|glifage/.test(s)) return 'metformin';
  if (/testosteron|androgel/.test(s)) return 'hrt_testosterone';
  if (/tibolona|tibolone|livial/.test(s)) return 'hrt_tibolone';
  if (/estradiol|estrogel|climene|premari|estrogen/.test(s)) return 'hrt_estrogen';
  if (/progesteron|utrogestan|duphaston|progest/.test(s)) return 'hrt_progestogen';
  if (/espironolactona|cyproteron|bicalutamid|anti.?androgen/.test(s)) return 'hrt_antiandrogen';
  if (/levotiroxina|euthyrox|synthroid|tireoid|thyroid/.test(s)) return 'thyroid';
  if (/hrt|trh/.test(s) || m.class_tag === 'hrt') return 'hrt_estrogen';
  return 'context_only';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, maxAbs: number): number {
  return Math.max(-maxAbs, Math.min(maxAbs, n));
}

function isMale(sex?: string | null): boolean {
  const s = String(sex || '').toLowerCase();
  return s === 'm' || s === 'male' || s === 'masculino';
}

export function enrichEnvelopeWithAnatomy(input: {
  envelope: ScenarioEnvelope;
  medications?: MedForAnatomy[];
  sex?: string | null;
  hasNutrition?: boolean;
  hasExercise?: boolean;
  nutritionAdherence?: string;
  exerciseAdherence?: string;
  medicationAdherence?: string;
  proteinEmphasis?: boolean;
  resistanceDays?: number;
  cardioDays?: number;
  assumptions?: ScenarioAssumptions;
}): EnrichedScenarioEnvelope {
  const env = input.envelope;
  const magnitude: MagnitudeCap = env.magnitude_cap || input.assumptions?.change_magnitude || 'conservative';
  const maxAbs = magnitude === 'moderate' ? 7 : 4.5;
  const weeks = env.horizon_weeks || 12;
  const meds = input.medications || [];
  const hasMed = meds.length > 0;
  const hasNutrition = input.hasNutrition ?? false;
  const hasExercise = input.hasExercise ?? false;
  const medAdh = input.medicationAdherence || 'moderate';
  const nutAdh = input.nutritionAdherence || 'moderate';
  const exAdh = input.exerciseAdherence || 'moderate';
  const resistance = input.resistanceDays ?? 3;
  const cardio = input.cardioDays ?? 2;
  const assumptions = input.assumptions || {};

  const sil = env.silhouette_delta_pct ?? 0;
  const wDelta = env.deltas?.weight_kg ?? 0;
  const w0 = env.projected.weight_kg != null && wDelta !== 0
    ? (env.projected.weight_kg - wDelta)
    : null;
  const weightPct = w0 && w0 > 0 ? (wDelta / w0) * 100 : sil;
  // Educational scale: prefer silhouette, fall back to weight %; keep modest
  const scale = Math.min(maxAbs, Math.max(0.35, Math.abs(sil || weightPct) * 0.55));

  const visualProfiles: VisualProfileEntry[] = meds.map((m) => {
    const profileId = inferProfile(m);
    const meta = PROFILE_META[profileId] || PROFILE_META.context_only;
    return {
      medication: m.name,
      profileId,
      labelPt: meta.labelPt,
      kind: meta.kind,
    };
  });

  const regionAccum: Record<AnatomicalRegion, { delta: number; bits: string[] }> = {
    waist: { delta: 0, bits: [] },
    abdomen: { delta: 0, bits: [] },
    hip: { delta: 0, bits: [] },
    arm: { delta: 0, bits: [] },
    thigh: { delta: 0, bits: [] },
    chest: { delta: 0, bits: [] },
    neck: { delta: 0, bits: [] },
  };

  // Lifestyle / plan directional bases (BodyPath-style)
  if (hasNutrition) {
    const nutScale = (nutAdh === 'high' ? 1 : nutAdh === 'low' ? 0.55 : 0.75) * scale * 0.35;
    const sign = sil < 0 || wDelta < 0 ? -1 : sil > 0 ? 1 : -1;
    regionAccum.waist.delta += sign * nutScale * 0.9;
    regionAccum.abdomen.delta += sign * nutScale;
    regionAccum.hip.delta += sign * nutScale * 0.85;
    const bit = `dieta + adesão ${nutAdh} (cenário direcional img2img)`;
    regionAccum.waist.bits.push(bit);
    regionAccum.abdomen.bits.push(bit);
    regionAccum.hip.bits.push(bit);
  }
  if (hasExercise) {
    const exScale = (exAdh === 'high' ? 1 : exAdh === 'low' ? 0.5 : 0.72) * scale * 0.25;
    const lossSign = sil < 0 || wDelta < 0 ? -1 : 0;
    regionAccum.waist.delta += lossSign * exScale * 0.6 * (cardio > 0 ? 1 : 0.4);
    regionAccum.abdomen.delta += lossSign * exScale * 0.7 * (cardio > 0 ? 1 : 0.4);
    regionAccum.arm.delta += resistance > 0 ? exScale * 0.35 : 0;
    regionAccum.thigh.delta += lossSign * exScale * 0.4 + (resistance > 0 ? exScale * 0.15 : 0);
    regionAccum.chest.delta += lossSign * exScale * 0.15;
    if (cardio > 0) {
      regionAccum.waist.bits.push('cardio + adesão (cenário direcional img2img)');
      regionAccum.abdomen.bits.push('cardio + adesão — flancos/abdômen (cenário direcional)');
    }
    if (resistance > 0) {
      regionAccum.arm.bits.push('força / recuperação — tonicidade (não promessa de hipertrofia)');
      regionAccum.thigh.bits.push('força + cardio (cenário direcional img2img)');
      regionAccum.chest.bits.push('treino combinado (cenário direcional img2img)');
    }
  }

  // Medication visual-profile biases
  let metabolicCount = 0;
  let hrtRedistrib = false;
  for (const vp of visualProfiles) {
    const meta = PROFILE_META[vp.profileId] || PROFILE_META.context_only;
    if (meta.kind === 'metabolic') metabolicCount += 1;
    if (meta.kind === 'redistribution' || meta.kind === 'tone') hrtRedistrib = true;
    let bias = { ...meta.bias };
    // Male testosterone: mild gynoid reduction emphasis
    if (vp.profileId === 'hrt_testosterone' && isMale(input.sex)) {
      bias = { ...bias, hip: (bias.hip ?? 0) - 0.15, thigh: (bias.thigh ?? 0) + 0.05 };
    }
    const medScale = (medAdh === 'high' ? 1 : medAdh === 'low' ? 0.5 : 0.75) * scale * 0.55;
    for (const region of ALL_REGIONS) {
      const b = bias[region];
      if (b == null || b === 0) continue;
      regionAccum[region].delta += b * medScale;
      regionAccum[region].bits.push(`${vp.medication}: ${vp.labelPt}`);
    }
  }

  // Synergy when diet + exercise
  const synergy = hasNutrition && hasExercise ? 1.1 : 1;
  if (synergy > 1 && metabolicCount > 0) {
    for (const r of ['waist', 'abdomen'] as AnatomicalRegion[]) {
      regionAccum[r].delta *= synergy;
      regionAccum[r].bits.push('sinergia metabólica leve');
    }
  }

  const regions: AnatomicalRegionDelta[] = ALL_REGIONS.map((region) => {
    const raw = regionAccum[region].delta;
    const deltaPct = round1(clamp(raw, maxAbs));
    const rationale = regionAccum[region].bits.length
      ? regionAccum[region].bits.slice(0, 4).join('; ')
      : 'sem viés regional significativo';
    return { region, deltaPct, rationale };
  }).filter((r) => r.deltaPct !== 0 || regionAccum[r.region].bits.length > 0);

  // Ensure we always expose the seven regions (BodyPath parity)
  const byRegion = new Map(regions.map((r) => [r.region, r]));
  const fullRegions: AnatomicalRegionDelta[] = ALL_REGIONS.map((region) => {
    return byRegion.get(region) || {
      region,
      deltaPct: 0,
      rationale: 'sem viés regional significativo',
    };
  });

  const regionalMap = Object.fromEntries(
    fullRegions.map((r) => [r.region, r.deltaPct]),
  ) as Record<AnatomicalRegion, number>;

  // Pipeline v5: BW magnitude may be 8–12%, but img2img visual delta is capped at 7%.
  const effectiveSilhouette = Math.min(
    IMG2IMG_SILHOUETTE_CAP_PCT,
    Math.abs(sil || weightPct || 0),
    maxAbs,
  );

  const img2img_pipeline_config: Img2ImgPipelineConfig = {
    version: 'v5',
    identity_locks: [...IMG2IMG_IDENTITY_LOCKS],
    magnitude_ceiling_pct: maxAbs,
    effective_silhouette_delta_pct: Math.round(effectiveSilhouette * 100) / 100,
    rag_kg_preserved_pct: Math.round(effectiveSilhouette * 100) / 100,
    clothing_drape: 'preserve_garments_show_fit_change',
    transformation_style: 'clinical_before_after_same_frame',
  };

  const anatomicalEnvelope: AnatomicalEnvelope = {
    maxAbsDeltaPct: maxAbs,
    regions: fullRegions,
    faceLocked: true,
    heightLocked: true,
    limbLengthLocked: true,
    skinMarksLocked: true,
    poseLocked: true,
    clothingPreserved: true,
    backgroundPreserved: true,
    photorealism: true,
    fidelity: 'identity_preserving_anatomical',
    uncertaintyBand: 'increases_with_horizon',
    regional_anatomical_deltas_pct: regionalMap,
    img2img_pipeline_config,
  };

  const rules: EnvelopeRule[] = [...(env.rules || [])];
  const pushRule = (id: string, iff: string, then: string, applied: boolean, silDelta = 0) => {
    if (rules.some((r) => r.id === id)) return;
    rules.push({ id, if: iff, then, applied, silhouette_delta_pct: applied ? silDelta : 0 });
  };

  pushRule(
    'R_IMG2IMG_PIPELINE',
    `horizonte ${weeks}sem · dieta=${hasNutrition} · exercício=${hasExercise}`,
    `pipeline img2img v5 · teto visual |Δ|≤${IMG2IMG_SILHOUETTE_CAP_PCT}% · teto anatômico |Δ| ${maxAbs}% · locks face/altura/membros/marcas/roupa/pose/fundo · drape de roupa muda com silhueta · RAG kg preservado`,
    true,
    -Math.sign(sil || -1) * effectiveSilhouette || sil,
  );

  pushRule(
    'R_BEFORE_AFTER_IDENTITY',
    'foto de referência presente',
    'mesmo paciente, mesma pose, mesmas roupas e fundo; apenas tecido mole/silhueta muda (roupa pode ficar mais folgada ou justa)',
    true,
    0,
  );

  for (const vp of visualProfiles) {
    const ruleId = `R_VISUAL_${vp.profileId.toUpperCase()}`;
    pushRule(
      ruleId,
      `${vp.medication} selecionado (perfil ${vp.profileId})`,
      vp.kind === 'context'
        ? 'sem envelope visual próprio — permanece como contexto clínico'
        : `simulação corporal direcional: ${vp.labelPt}`,
      true,
      vp.kind === 'context' ? 0 : scale * 0.3,
    );
  }

  if (hrtRedistrib) {
    pushRule(
      'R_HRT_REDISTRIBUTION',
      'TRH / hormônios com perfil de redistribuição',
      'priorizar redistribuição de tecido mole regional; preservar identidade; sem sexualização',
      true,
      0.2,
    );
  }

  pushRule(
    'R_AFTER_MUST_REFLECT_MATH',
    'Δpeso/silhueta |Δ| ≥ 3% OU |fat_delta_kg| ≥ 2',
    'HARDENED RAG img2img-after-must-reflect-math: AFTER ≠ BEFORE; aplicar waist/abdomen/hip regionais; cópia idêntica é falha de regra; se o modelo falhar, morph determinístico do envelope é obrigatório',
    Math.abs(sil) >= 3 || Math.abs(wDelta) >= 2,
    sil,
  );

  pushRule(
    'R_IDENTITY',
    'sempre',
    'preservar face, altura, comprimento de membros, marcas de pele, roupa, pose e fundo — transformação estilo before/after clínico',
    true,
    0,
  );
  pushRule(
    'R_MAGNITUDE',
    'teto de magnitude + pilares + adesão + horizonte',
    `magnitude efetiva = ${magnitude} (máx |Δ| ${maxAbs}%)`,
    true,
    maxAbs,
  );
  pushRule(
    'R_SYNERGY',
    'dieta E exercício selecionados',
    hasNutrition && hasExercise
      ? 'sinergia 1.1x no envelope central, ainda sob teto de magnitude'
      : 'sem sinergia dieta+exercício neste cenário',
    hasNutrition && hasExercise,
    hasNutrition && hasExercise ? scale * 0.1 : 0,
  );

  const narrativePt: string[] = [
    `Horizonte: ${weeks} semanas.`,
  ];
  if (visualProfiles.length) {
    narrativePt.push(
      `Medicamentos no cenário: ${visualProfiles.map((v) => v.medication).join(', ')} (adesão ${medAdh}).`,
    );
    for (const vp of visualProfiles) {
      narrativePt.push(`Simulação visual (${vp.medication}): ${vp.labelPt}.`);
    }
  }
  if (hasNutrition) {
    narrativePt.push(
      `Dieta ativa (adesão ${nutAdh}${input.proteinEmphasis ? '; ênfase proteica' : ''}).`,
    );
  }
  if (hasExercise) {
    narrativePt.push(
      `Exercício ativo · força ${resistance}x/sem · cardio ${cardio}x/sem (adesão ${exAdh}).`,
    );
  }
  const lifeBits = [
    assumptions.sleep_adequate !== false ? 'sono adequado' : 'sono a otimizar',
    assumptions.hydration_adequate !== false ? 'hidratação adequada' : 'hidratação a otimizar',
    assumptions.recovery_adequate !== false ? 'recuperação adequada' : 'recuperação a otimizar',
  ];
  narrativePt.push(`Estilo de vida: ${lifeBits.join('; ')}.`);
  if (env.deltas) {
    narrativePt.push(
      `Projeção educacional (RAG/kg): peso ${env.deltas.weight_kg} kg · gordura ${env.deltas.fat_mass_kg} kg · cintura ${env.deltas.waist_cm} cm · silhueta ${sil}%.`,
    );
  }
  narrativePt.push('Envelope anatômico proporcional com fidelidade de identidade (face/altura/membros/marcas/roupa/pose/fundo bloqueados).');
  narrativePt.push(
    `Pipeline img2img v5 · silhueta efetiva ≤${IMG2IMG_SILHOUETTE_CAP_PCT}% · roupa igual com caimento alterado pela silhueta.`,
  );
  narrativePt.push('Simulação ilustrativa — não é previsão médica. Incerteza aumenta com o horizonte; resultados reais variam.');

  return {
    ...env,
    rules,
    anatomicalEnvelope,
    visualProfiles,
    narrativePt,
    prompt_version: PROMPT_VERSION,
    watermark: SCENARIO_WATERMARK,
    disclaimerPt:
      'Simulação ilustrativa fotorealista. Não é previsão individual, diagnóstico ou garantia de resposta ao tratamento.',
    pillars: { medication: hasMed, nutrition: hasNutrition, exercise: hasExercise },
    changeMagnitude: magnitude,
    max_abs_silhouette_pct: Math.min(env.max_abs_silhouette_pct || maxAbs, maxAbs),
    img2img_pipeline_config,
    regional_anatomical_deltas_pct: regionalMap,
  };
}
