import { describe, expect, it } from 'vitest';
import { computeScenarioEnvelope } from '../src/services/scenarioEnvelope';
import {
  enrichEnvelopeWithAnatomy,
  PROMPT_VERSION,
  SCENARIO_WATERMARK,
} from '../src/services/anatomicalEnvelope';
import { buildPhotorealScenarioPrompt } from '../src/services/scenarioEnvelope';

describe('anatomicalEnvelope', () => {
  const baseInput = {
    horizon_weeks: 12,
    sex: 'F',
    age_years: 42,
    baseline: {
      height_cm: 165,
      weight_kg: 92,
      waist_cm: 98,
      body_fat_pct: 38,
      bmi: 33.8,
    },
    medications: [
      { id: 'm1', name: 'Ozempic', class_tag: 'glp1', visual_profile: 'glp1_metabolic' },
      { id: 'm2', name: 'Oestrogel', visual_profile: 'hrt_estrogen' },
    ],
    nutritionPlans: [
      { id: 'n1', title: 'Déficit', plan_type: 'nutrition', daily_calories: 1700 },
    ],
    exercisePlans: [
      { id: 'e1', title: 'Treino', plan_type: 'exercise' },
    ],
    plan_config: {
      medication_record_ids: ['m1', 'm2'],
      nutrition_plan_ids: ['n1'],
      exercise_plan_ids: ['e1'],
      medication_adherence: 'moderate' as const,
      nutrition_adherence: 'moderate' as const,
      exercise_adherence: 'moderate' as const,
      resistance_days_per_week: 3,
      cardio_days_per_week: 2,
      protein_emphasis: true,
    },
    assumptions: {
      sleep_adequate: true,
      hydration_adequate: true,
      recovery_adequate: true,
      comorbidity_stable: true,
      change_magnitude: 'conservative' as const,
    },
  };

  it('enriches kg/RAG envelope with BodyPath-compatible anatomy fields', () => {
    const env = computeScenarioEnvelope(baseInput);
    expect(env.ok).toBe(true);
    expect(env.deltas).toBeTruthy();

    const enriched = enrichEnvelopeWithAnatomy({
      envelope: env,
      medications: baseInput.medications,
      sex: 'F',
      hasNutrition: true,
      hasExercise: true,
      nutritionAdherence: 'moderate',
      exerciseAdherence: 'moderate',
      medicationAdherence: 'moderate',
      proteinEmphasis: true,
      resistanceDays: 3,
      cardioDays: 2,
      assumptions: baseInput.assumptions,
    });

    expect(enriched.prompt_version).toBe(PROMPT_VERSION);
    expect(enriched.watermark).toBe(SCENARIO_WATERMARK);
    expect(enriched.anatomicalEnvelope.maxAbsDeltaPct).toBe(4.5);
    expect(enriched.anatomicalEnvelope.faceLocked).toBe(true);
    expect(enriched.anatomicalEnvelope.heightLocked).toBe(true);
    expect(enriched.anatomicalEnvelope.regions.length).toBe(7);
    expect(enriched.visualProfiles.map((v) => v.profileId)).toEqual(
      expect.arrayContaining(['glp1_metabolic', 'hrt_estrogen']),
    );
    expect(enriched.narrativePt.length).toBeGreaterThan(3);
    expect(enriched.deltas?.weight_kg).toBe(env.deltas?.weight_kg);

    const ruleIds = enriched.rules.map((r) => r.id);
    expect(ruleIds).toEqual(expect.arrayContaining([
      'R_IMG2IMG_PIPELINE',
      'R_IDENTITY',
      'R_MAGNITUDE',
      'R_SYNERGY',
      'R_VISUAL_GLP1_METABOLIC',
      'R_VISUAL_HRT_ESTROGEN',
    ]));

    const waist = enriched.anatomicalEnvelope.regions.find((r) => r.region === 'waist');
    expect(waist).toBeTruthy();
    expect(Math.abs(waist!.deltaPct)).toBeLessThanOrEqual(4.5);
  });

  it('clamps moderate magnitude to 7 and near-zero for thyroid/context', () => {
    const env = computeScenarioEnvelope({
      ...baseInput,
      medications: [{ id: 't1', name: 'Euthyrox', visual_profile: 'thyroid' }],
      plan_config: {
        ...baseInput.plan_config,
        medication_record_ids: ['t1'],
      },
      assumptions: { ...baseInput.assumptions, change_magnitude: 'moderate' },
    });
    // Force magnitude_cap moderate on envelope
    env.magnitude_cap = 'moderate';

    const enriched = enrichEnvelopeWithAnatomy({
      envelope: env,
      medications: [{ name: 'Euthyrox', visual_profile: 'thyroid' }],
      hasNutrition: false,
      hasExercise: false,
      assumptions: { change_magnitude: 'moderate' },
    });
    expect(enriched.anatomicalEnvelope.maxAbsDeltaPct).toBe(7);
    expect(enriched.visualProfiles[0].kind).toBe('context');
    for (const r of enriched.anatomicalEnvelope.regions) {
      expect(Math.abs(r.deltaPct)).toBeLessThanOrEqual(7);
    }
  });

  it('injects regional guidance into photoreal prompt', () => {
    const env = computeScenarioEnvelope(baseInput);
    const enriched = enrichEnvelopeWithAnatomy({
      envelope: env,
      medications: baseInput.medications,
      hasNutrition: true,
      hasExercise: true,
      assumptions: baseInput.assumptions,
    });
    const prompt = buildPhotorealScenarioPrompt({
      weeks: 12,
      envelope: enriched,
      sex: 'F',
      hasReferencePhoto: true,
      interventions: ['Ozempic'],
    });
    expect(prompt).toMatch(/Regional anatomical guidance/i);
    expect(prompt).toMatch(/SIMULACAO ILUSTRATIVA/);
    expect(prompt).toMatch(/waist|abdomen/i);
  });
});
