import { describe, expect, it } from 'vitest';
import { computeScenarioEnvelope, buildPhotorealScenarioPrompt } from '../src/services/scenarioEnvelope';
import { enrichEnvelopeWithAnatomy } from '../src/services/anatomicalEnvelope';

describe('multi-view after prompts', () => {
  it('emits distinct prompts per capture view', () => {
    const base = computeScenarioEnvelope({
      horizon_weeks: 12,
      sex: 'F',
      baseline: { height_cm: 165, weight_kg: 90, waist_cm: 96, body_fat_pct: 36, bmi: 33 },
      medications: [{ id: 'm1', name: 'Semaglutida', class_tag: 'glp1', visual_profile: 'glp1_metabolic' }],
      nutritionPlans: [{ id: 'n1', title: 'Dieta', plan_type: 'nutrition', daily_calories: 1700 }],
      exercisePlans: [{ id: 'e1', title: 'Treino', plan_type: 'exercise' }],
      plan_config: {
        medication_record_ids: ['m1'],
        nutrition_plan_ids: ['n1'],
        exercise_plan_ids: ['e1'],
        medication_adherence: 'high',
        nutrition_adherence: 'high',
        exercise_adherence: 'moderate',
        resistance_days_per_week: 3,
        cardio_days_per_week: 2,
        protein_emphasis: true,
      },
      assumptions: {
        sleep_adequate: true,
        hydration_adequate: true,
        recovery_adequate: true,
        comorbidity_stable: true,
        change_magnitude: 'conservative',
      },
    });
    const env = enrichEnvelopeWithAnatomy({
      envelope: base,
      medications: [{ name: 'Semaglutida', visual_profile: 'glp1_metabolic' }],
      hasNutrition: true,
      hasExercise: true,
      nutritionAdherence: 'high',
      exerciseAdherence: 'moderate',
      medicationAdherence: 'high',
      resistanceDays: 3,
      cardioDays: 2,
      proteinEmphasis: true,
      assumptions: { change_magnitude: 'conservative' },
      sex: 'F',
    });
    const front = buildPhotorealScenarioPrompt({ weeks: 12, envelope: env, hasReferencePhoto: true, view: 'front' });
    const left = buildPhotorealScenarioPrompt({ weeks: 12, envelope: env, hasReferencePhoto: true, view: 'left' });
    const back = buildPhotorealScenarioPrompt({ weeks: 12, envelope: env, hasReferencePhoto: true, view: 'back' });
    expect(front).toMatch(/front/i);
    expect(left).toMatch(/left/i);
    expect(back).toMatch(/back/i);
    expect(front).not.toEqual(left);
    expect(env.anatomicalEnvelope.regions.length).toBeGreaterThan(0);
  });
});
