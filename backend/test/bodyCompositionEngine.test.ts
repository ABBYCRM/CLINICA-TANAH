import { describe, expect, it } from 'vitest';
import { retrieveBodyCompositionKnowledge } from '../src/services/bodyCompositionKnowledge';
import { projectBodyComposition } from '../src/services/bodyCompositionEngine';
import { buildPhotorealScenarioPrompt, computeScenarioEnvelope } from '../src/services/scenarioEnvelope';

describe('body composition RAG', () => {
  it('retrieves medication and energy chunks for GLP-1 + diet query', () => {
    const hits = retrieveBodyCompositionKnowledge({
      text: 'semaglutide ozempic calorie deficit resistance training body fat',
      tags: ['semaglutide', 'diet', 'exercise'],
      limit: 6,
    });
    expect(hits.length).toBeGreaterThan(2);
    const ids = hits.map((h) => h.id);
    expect(ids.some((id) => id.includes('semaglutide') || id.includes('energy') || id.includes('diet'))).toBe(true);
  });
});

describe('body composition projection engine', () => {
  const base = {
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
      { id: 'm1', name: 'Semaglutida 1.0 mg', class_tag: 'glp1' },
    ],
    nutritionPlans: [
      { id: 'n1', title: 'Déficit controlado', plan_type: 'nutrition', daily_calories: 1700, protein_g: 130 },
    ],
    exercisePlans: [
      { id: 'e1', title: 'Força + cardio', plan_type: 'exercise' },
    ],
    plan_config: {
      medication_record_ids: ['m1'],
      nutrition_plan_ids: ['n1'],
      exercise_plan_ids: ['e1'],
      medication_adherence: 'high' as const,
      nutrition_adherence: 'high' as const,
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

  it('projects fat loss from meds + calories + exercise with RAG citations', () => {
    const p = projectBodyComposition(base);
    expect(p.ok).toBe(true);
    expect(p.energy.tdee_kcal).toBeTruthy();
    expect(p.energy.intake_kcal).toBe(1700);
    expect(p.deltas.weight_kg).toBeLessThan(0);
    expect(p.deltas.fat_mass_kg).toBeLessThan(0);
    expect(p.deltas.med_weight_kg).toBeLessThan(0);
    expect(p.deltas.diet_weight_kg).toBeLessThan(0);
    expect(p.projected.weight_kg!).toBeLessThan(92);
    expect(p.projected.waist_cm!).toBeLessThan(98);
    expect(p.rag_citations.length).toBeGreaterThan(0);
    expect(p.monthly_rates.length).toBeGreaterThan(0);
    // Realistic: not > ~8% BW in 12w under conservative cap
    expect(Math.abs(p.deltas.weight_kg) / 92).toBeLessThanOrEqual(0.09);
  });

  it('feeds quantitative guidance into the image prompt', () => {
    const env = computeScenarioEnvelope(base);
    const prompt = buildPhotorealScenarioPrompt({
      weeks: 12,
      envelope: env,
      sex: 'F',
      hasReferencePhoto: true,
      interventions: ['Semaglutida', 'Déficit controlado', 'Força + cardio'],
    });
    expect(prompt).toMatch(/calorie|kcal|fat|waist|realistic/i);
    expect(prompt).toContain('SIMULACAO ILUSTRATIVA');
    expect(prompt).toMatch(/Knowledge grounding ids:/);
    expect(env.visual_guidance?.soft_tissue).toBeTruthy();
  });

  it('tirzepatide loses more than metformin alone at same horizon', () => {
    const met = projectBodyComposition({
      ...base,
      medications: [{ id: 'm1', name: 'Metformina 850 mg', class_tag: 'metformin' }],
      nutritionPlans: [],
      exercisePlans: [],
      plan_config: {
        ...base.plan_config,
        nutrition_plan_ids: [],
        exercise_plan_ids: [],
      },
    });
    const tirz = projectBodyComposition({
      ...base,
      medications: [{ id: 'm1', name: 'Tirzepatida', class_tag: 'dual_incretin' }],
      nutritionPlans: [],
      exercisePlans: [],
      plan_config: {
        ...base.plan_config,
        nutrition_plan_ids: [],
        exercise_plan_ids: [],
      },
    });
    expect(tirz.deltas.weight_kg).toBeLessThan(met.deltas.weight_kg);
  });

  it('honors clinician-predicted loss as authoritative Δkg for morph', () => {
    const p = projectBodyComposition({
      ...base,
      doctor_predicted_loss_kg: 40,
      medications: [],
      nutritionPlans: [],
      exercisePlans: [],
      plan_config: {
        medication_record_ids: [],
        nutrition_plan_ids: [],
        exercise_plan_ids: [],
      },
    });
    expect(p.ok).toBe(true);
    expect(p.doctor_override).toBe(true);
    expect(p.deltas.weight_kg).toBeCloseTo(-40, 0);
    expect(p.projected.weight_kg).toBeCloseTo(52, 0);
    expect(p.target_weight_kg).toBe(52);
    expect(Math.abs(p.silhouette_delta_pct)).toBeGreaterThanOrEqual(10);
    expect(p.visual_silhouette_cap_pct).toBe(18);
  });

  it('accepts absolute target weight as clinician override', () => {
    const p = projectBodyComposition({
      ...base,
      target_weight_kg: 70,
    });
    expect(p.ok).toBe(true);
    expect(p.doctor_override).toBe(true);
    expect(p.deltas.weight_kg).toBeCloseTo(-22, 0);
    expect(p.projected.weight_kg).toBe(70);
  });
});
