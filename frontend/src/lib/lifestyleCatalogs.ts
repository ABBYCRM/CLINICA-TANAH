/**
 * Exhaustive lifestyle / scenario option catalogs (BR clinical body-composition context).
 * Labels are trilingual; IDs are stable for params_json and plan_config.
 */

export type LangLabel = { pt: string; en: string; es: string };

export type NutritionTemplate = {
  id: string;
  labels: LangLabel;
  summary: LangLabel;
  category: string;
  daily_calories?: number;
  deficit_kcal?: number;
  protein_g?: number;
  protein_g_per_kg?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  meal_pattern?: string;
  carb_emphasis?: string;
  fat_emphasis?: string;
  tags?: string[];
};

export type ExerciseTemplate = {
  id: string;
  labels: LangLabel;
  summary: LangLabel;
  category: string;
  training_style?: string;
  resistance_days?: number;
  cardio_days?: number;
  resistance_minutes?: number;
  cardio_minutes?: number;
  cardio_modality?: string;
  intensity?: string;
  steps_target?: number;
  tags?: string[];
};

export type SimpleOption = { id: string; labels: LangLabel; hint?: LangLabel };

function L(pt: string, en: string, es: string): LangLabel {
  return { pt, en, es };
}

export function pickLabel(labels: LangLabel, locale: string): string {
  if (locale?.startsWith('en')) return labels.en;
  if (locale?.startsWith('es')) return labels.es;
  return labels.pt;
}

export const NUTRITION_TEMPLATES: NutritionTemplate[] = [
  {
    id: 'nut_mod_deficit_500',
    labels: L('Déficit moderado ambulatorial (~500 kcal)', 'Moderate outpatient deficit (~500 kcal)', 'Déficit ambulatorio moderado (~500 kcal)'),
    summary: L('Proteína elevada, déficit ~500 kcal — padrão ambulatorial.', 'High protein, ~500 kcal deficit — outpatient standard.', 'Proteína alta, déficit ~500 kcal — estándar ambulatorio.'),
    category: 'deficit',
    daily_calories: 1700, deficit_kcal: 500, protein_g: 120, protein_g_per_kg: 1.6,
    carbs_g: 160, fat_g: 55, fiber_g: 30, meal_pattern: 'meals_4_5', carb_emphasis: 'moderate', fat_emphasis: 'moderate',
    tags: ['glp1', 'weight', 'padrão'],
  },
  {
    id: 'nut_mild_deficit_350',
    labels: L('Déficit leve (~350 kcal)', 'Mild deficit (~350 kcal)', 'Déficit leve (~350 kcal)'),
    summary: L('Perda gradual com maior aderência e preservação de massa magra.', 'Gradual loss with better adherence and lean-mass preservation.', 'Pérdida gradual con mayor adherencia y preservación magra.'),
    category: 'deficit',
    daily_calories: 1850, deficit_kcal: 350, protein_g: 110, protein_g_per_kg: 1.4,
    carbs_g: 190, fat_g: 60, fiber_g: 28, meal_pattern: 'meals_3_4', carb_emphasis: 'moderate', fat_emphasis: 'moderate',
    tags: ['iniciante', 'aderência'],
  },
  {
    id: 'nut_agg_deficit_750',
    labels: L('Déficit agressivo supervisionado (~750 kcal)', 'Supervised aggressive deficit (~750 kcal)', 'Déficit agresivo supervisado (~750 kcal)'),
    summary: L('Somente com acompanhamento clínico próximo; curto horizonte.', 'Only with close clinical follow-up; short horizon.', 'Solo con seguimiento clínico cercano; horizonte corto.'),
    category: 'deficit',
    daily_calories: 1500, deficit_kcal: 750, protein_g: 140, protein_g_per_kg: 2.0,
    carbs_g: 120, fat_g: 45, fiber_g: 30, meal_pattern: 'meals_4_5', carb_emphasis: 'low', fat_emphasis: 'moderate',
    tags: ['supervisionado', 'curto'],
  },
  {
    id: 'nut_maintenance_recomp',
    labels: L('Manutenção / recomposição', 'Maintenance / recomposition', 'Mantenimiento / recomposición'),
    summary: L('Energia próximo do gasto; foco em composição e força.', 'Near energy balance; focus on composition and strength.', 'Cerca del gasto; foco en composición y fuerza.'),
    category: 'maintenance',
    daily_calories: 2200, deficit_kcal: 0, protein_g: 130, protein_g_per_kg: 1.8,
    carbs_g: 220, fat_g: 70, fiber_g: 30, meal_pattern: 'meals_3_4', carb_emphasis: 'moderate', fat_emphasis: 'moderate',
    tags: ['recomposição'],
  },
  {
    id: 'nut_glp1_companion',
    labels: L('High-protein companion GLP-1 / dual incretina', 'High-protein GLP-1 / dual incretin companion', 'Acompañamiento high-protein GLP-1 / dual incretina'),
    summary: L('Proteína alta para preservar FFM sob agonistas incretínicos.', 'High protein to preserve FFM on incretin agonists.', 'Proteína alta para preservar FFM con agonistas incretínicos.'),
    category: 'glp1',
    daily_calories: 1600, deficit_kcal: 500, protein_g: 140, protein_g_per_kg: 2.0,
    carbs_g: 130, fat_g: 50, fiber_g: 32, meal_pattern: 'meals_4_6', carb_emphasis: 'low_moderate', fat_emphasis: 'moderate',
    tags: ['glp1', 'ozempic', 'mounjaro', 'semaglutida', 'tirzepatida'],
  },
  {
    id: 'nut_mediterranean_br',
    labels: L('Mediterrânea adaptada (BR)', 'Mediterranean adapted (BR)', 'Mediterránea adaptada (BR)'),
    summary: L('Azeite, peixes, legumes, fibras; padrão cardiometabólico.', 'Olive oil, fish, legumes, fiber; cardiometabolic pattern.', 'Aceite, pescado, legumbres, fibra; patrón cardiometabólico.'),
    category: 'pattern',
    daily_calories: 1800, deficit_kcal: 400, protein_g: 100, protein_g_per_kg: 1.4,
    carbs_g: 180, fat_g: 65, fiber_g: 35, meal_pattern: 'meals_3_4', carb_emphasis: 'moderate', fat_emphasis: 'higher',
    tags: ['cardio', 'mediterrânea'],
  },
  {
    id: 'nut_dash',
    labels: L('DASH adaptada', 'DASH adapted', 'DASH adaptada'),
    summary: L('Baixo sódio, rica em potássio e fibras — pressão e peso.', 'Low sodium, high potassium/fiber — BP and weight.', 'Bajo sodio, alto potasio/fibra — PA y peso.'),
    category: 'pattern',
    daily_calories: 1750, deficit_kcal: 450, protein_g: 105, protein_g_per_kg: 1.4,
    carbs_g: 185, fat_g: 55, fiber_g: 35, meal_pattern: 'meals_3_4', carb_emphasis: 'moderate', fat_emphasis: 'moderate',
    tags: ['hipertensão', 'dash'],
  },
  {
    id: 'nut_low_carb',
    labels: L('Low-carb moderado (≤130 g CHO)', 'Moderate low-carb (≤130 g CHO)', 'Low-carb moderado (≤130 g CHO)'),
    summary: L('Carboidrato controlado sem cetose obrigatória.', 'Controlled carbs without mandatory ketosis.', 'CHO controlado sin cetosis obligatoria.'),
    category: 'pattern',
    daily_calories: 1700, deficit_kcal: 500, protein_g: 125, protein_g_per_kg: 1.8,
    carbs_g: 110, fat_g: 70, fiber_g: 28, meal_pattern: 'meals_3_4', carb_emphasis: 'low', fat_emphasis: 'higher',
    tags: ['lowcarb', 'insulina'],
  },
  {
    id: 'nut_keto_clinical',
    labels: L('Cetogênica clínica (selecionada)', 'Clinical ketogenic (selected cases)', 'Cetogénica clínica (casos seleccionados)'),
    summary: L('Uso selecionado e supervisionado; não rotina ambulatorial.', 'Selected supervised use; not outpatient default.', 'Uso seleccionado y supervisado; no rutina ambulatoria.'),
    category: 'pattern',
    daily_calories: 1600, deficit_kcal: 550, protein_g: 110, protein_g_per_kg: 1.6,
    carbs_g: 40, fat_g: 110, fiber_g: 20, meal_pattern: 'meals_3', carb_emphasis: 'very_low', fat_emphasis: 'high',
    tags: ['cetogênica', 'supervisionado'],
  },
  {
    id: 'nut_plant_high_protein',
    labels: L('Plant-based / vegetariana high-protein', 'Plant-based / vegetarian high-protein', 'Plant-based / vegetariana high-protein'),
    summary: L('Ênfase em leguminosas, soja, laticínios se ovolacto.', 'Emphasis on legumes, soy, dairy if lacto-ovo.', 'Énfasis en legumbres, soja, lácteos si ovolacto.'),
    category: 'pattern',
    daily_calories: 1750, deficit_kcal: 400, protein_g: 115, protein_g_per_kg: 1.6,
    carbs_g: 200, fat_g: 50, fiber_g: 40, meal_pattern: 'meals_4_5', carb_emphasis: 'moderate_high', fat_emphasis: 'moderate',
    tags: ['vegetariana', 'plant'],
  },
  {
    id: 'nut_anti_inflam',
    labels: L('Anti-inflamatória metabólica', 'Metabolic anti-inflammatory', 'Antiinflamatoria metabólica'),
    summary: L('Reduz ultraprocessados; ênfase em ômega-3 e fibras.', 'Cuts ultra-processed foods; omega-3 and fiber focus.', 'Reduce ultraprocesados; foco en omega-3 y fibra.'),
    category: 'pattern',
    daily_calories: 1800, deficit_kcal: 400, protein_g: 110, protein_g_per_kg: 1.5,
    carbs_g: 170, fat_g: 60, fiber_g: 35, meal_pattern: 'meals_3_4', carb_emphasis: 'moderate', fat_emphasis: 'moderate',
    tags: ['inflamação', 'metabólico'],
  },
  {
    id: 'nut_tre_1410',
    labels: L('Janela alimentar 14:10', 'Time-restricted eating 14:10', 'Ventana alimentaria 14:10'),
    summary: L('Janela de 10 h de alimentação; déficit leve a moderado.', '10 h eating window; mild–moderate deficit.', 'Ventana de 10 h; déficit leve–moderado.'),
    category: 'timing',
    daily_calories: 1700, deficit_kcal: 450, protein_g: 120, protein_g_per_kg: 1.6,
    carbs_g: 165, fat_g: 55, fiber_g: 30, meal_pattern: 'tre_14_10', carb_emphasis: 'moderate', fat_emphasis: 'moderate',
    tags: ['jejum', 'tre'],
  },
  {
    id: 'nut_tre_168',
    labels: L('Janela alimentar 16:8', 'Time-restricted eating 16:8', 'Ventana alimentaria 16:8'),
    summary: L('Janela de 8 h; monitorar adesão e energia no treino.', '8 h window; monitor adherence and training energy.', 'Ventana de 8 h; monitorear adherencia y energía.'),
    category: 'timing',
    daily_calories: 1650, deficit_kcal: 500, protein_g: 125, protein_g_per_kg: 1.8,
    carbs_g: 150, fat_g: 55, fiber_g: 28, meal_pattern: 'tre_16_8', carb_emphasis: 'moderate', fat_emphasis: 'moderate',
    tags: ['jejum', 'tre'],
  },
  {
    id: 'nut_hrt_male_support',
    labels: L('Suporte nutricional TRH masculina', 'Male HRT nutritional support', 'Soporte nutricional TRH masculina'),
    summary: L('Proteína e força para potencializar composição sob TRH.', 'Protein and strength to support composition under HRT.', 'Proteína y fuerza para composición bajo TRH.'),
    category: 'hrt',
    daily_calories: 2200, deficit_kcal: 300, protein_g: 150, protein_g_per_kg: 2.0,
    carbs_g: 230, fat_g: 70, fiber_g: 30, meal_pattern: 'meals_4_5', carb_emphasis: 'moderate_high', fat_emphasis: 'moderate',
    tags: ['trh', 'androgel', 'testosterona'],
  },
  {
    id: 'nut_hrt_female_support',
    labels: L('Suporte nutricional TRH / transição feminina', 'Female HRT / transition nutritional support', 'Soporte nutricional TRH / transición femenina'),
    summary: L('Proteína adequada, cálcio/vit D e composição corporal.', 'Adequate protein, calcium/vit D and body composition.', 'Proteína adecuada, calcio/vit D y composición.'),
    category: 'hrt',
    daily_calories: 1800, deficit_kcal: 350, protein_g: 110, protein_g_per_kg: 1.5,
    carbs_g: 180, fat_g: 60, fiber_g: 30, meal_pattern: 'meals_3_4', carb_emphasis: 'moderate', fat_emphasis: 'moderate',
    tags: ['trh', 'feminina'],
  },
  {
    id: 'nut_metformin_companion',
    labels: L('Companion metformina / resistência insulínica', 'Metformin / insulin-resistance companion', 'Acompañamiento metformina / resistencia insulínica'),
    summary: L('CHO distribuído, fibras altas, déficit moderado.', 'Distributed CHO, high fiber, moderate deficit.', 'CHO distribuido, fibra alta, déficit moderado.'),
    category: 'metabolic',
    daily_calories: 1700, deficit_kcal: 450, protein_g: 115, protein_g_per_kg: 1.6,
    carbs_g: 150, fat_g: 55, fiber_g: 35, meal_pattern: 'meals_4_5', carb_emphasis: 'low_moderate', fat_emphasis: 'moderate',
    tags: ['metformina', 'diabetes'],
  },
  {
    id: 'nut_orlistat_companion',
    labels: L('Companion orlistate (gordura controlada)', 'Orlistat companion (controlled fat)', 'Acompañamiento orlistat (grasa controlada)'),
    summary: L('Gordura ≤30% da energia; déficit moderado.', 'Fat ≤30% energy; moderate deficit.', 'Grasa ≤30% energía; déficit moderado.'),
    category: 'metabolic',
    daily_calories: 1600, deficit_kcal: 500, protein_g: 110, protein_g_per_kg: 1.5,
    carbs_g: 180, fat_g: 45, fiber_g: 30, meal_pattern: 'meals_3_4', carb_emphasis: 'moderate', fat_emphasis: 'low',
    tags: ['orlistate'],
  },
  {
    id: 'nut_custom',
    labels: L('Personalizado (preencher campos)', 'Custom (fill fields)', 'Personalizado (completar campos)'),
    summary: L('Defina calorias, macros e padrão manualmente.', 'Set calories, macros and pattern manually.', 'Defina calorías, macros y patrón manualmente.'),
    category: 'custom',
    tags: ['custom'],
  },
];

export const EXERCISE_TEMPLATES: ExerciseTemplate[] = [
  {
    id: 'ex_fullbody_walk',
    labels: L('Força full-body + caminhada', 'Full-body strength + walking', 'Fuerza full-body + caminata'),
    summary: L('3× força full-body, 3× cardio leve (caminhada).', '3× full-body strength, 3× light cardio (walk).', '3× fuerza full-body, 3× cardio ligero (caminata).'),
    category: 'combined',
    training_style: 'full_body', resistance_days: 3, cardio_days: 3,
    resistance_minutes: 45, cardio_minutes: 40, cardio_modality: 'walking', intensity: 'moderate',
    steps_target: 8000, tags: ['padrão', 'iniciante'],
  },
  {
    id: 'ex_upper_lower',
    labels: L('Upper / lower 4×', 'Upper / lower 4×', 'Upper / lower 4×'),
    summary: L('Divisão superior/inferior 4 dias + cardio base.', 'Upper/lower split 4 days + base cardio.', 'División superior/inferior 4 días + cardio base.'),
    category: 'resistance',
    training_style: 'upper_lower', resistance_days: 4, cardio_days: 2,
    resistance_minutes: 55, cardio_minutes: 30, cardio_modality: 'walking', intensity: 'moderate',
    steps_target: 7000, tags: ['hipertrofia'],
  },
  {
    id: 'ex_ppl',
    labels: L('Push / pull / legs', 'Push / pull / legs', 'Push / pull / legs'),
    summary: L('Volume alto de hipertrofia; cardio LISS 1–2×.', 'High hypertrophy volume; LISS cardio 1–2×.', 'Alto volumen de hipertrofia; cardio LISS 1–2×.'),
    category: 'resistance',
    training_style: 'ppl', resistance_days: 6, cardio_days: 2,
    resistance_minutes: 60, cardio_minutes: 25, cardio_modality: 'bike', intensity: 'moderate_high',
    steps_target: 6000, tags: ['avançado', 'hipertrofia'],
  },
  {
    id: 'ex_hypertrophy_deficit',
    labels: L('Hipertrofia + déficit (preservar FFM)', 'Hypertrophy + deficit (preserve FFM)', 'Hipertrofia + déficit (preservar FFM)'),
    summary: L('Força 3–4× com volume moderado sob déficit calórico.', 'Strength 3–4× moderate volume under calorie deficit.', 'Fuerza 3–4× volumen moderado bajo déficit.'),
    category: 'combined',
    training_style: 'hypertrophy_deficit', resistance_days: 4, cardio_days: 2,
    resistance_minutes: 50, cardio_minutes: 30, cardio_modality: 'walking', intensity: 'moderate',
    steps_target: 8000, tags: ['glp1', 'ffm'],
  },
  {
    id: 'ex_strength_liss',
    labels: L('Força (baixa rep) + cardio LISS', 'Strength (low rep) + LISS cardio', 'Fuerza (baja rep) + cardio LISS'),
    summary: L('Ênfase em força neuromuscular + base aeróbia.', 'Neuromuscular strength focus + aerobic base.', 'Énfasis en fuerza neuromuscular + base aerobia.'),
    category: 'combined',
    training_style: 'strength_liss', resistance_days: 3, cardio_days: 3,
    resistance_minutes: 50, cardio_minutes: 40, cardio_modality: 'walking', intensity: 'moderate',
    steps_target: 9000, tags: ['força'],
  },
  {
    id: 'ex_hiit_base',
    labels: L('HIIT 1–2× + base aeróbia', 'HIIT 1–2× + aerobic base', 'HIIT 1–2× + base aerobia'),
    summary: L('HIIT curto + caminhada/bike na maior parte da semana.', 'Short HIIT + walk/bike most of the week.', 'HIIT corto + caminata/bici la mayor parte de la semana.'),
    category: 'cardio',
    training_style: 'hiit_base', resistance_days: 2, cardio_days: 4,
    resistance_minutes: 35, cardio_minutes: 35, cardio_modality: 'hiit', intensity: 'high',
    steps_target: 7000, tags: ['hiit'],
  },
  {
    id: 'ex_steps_neat',
    labels: L('Caminhada pedométrica (NEAT)', 'Pedometer walking (NEAT)', 'Caminata pedométrica (NEAT)'),
    summary: L('Meta de passos diários; força mínima 2×.', 'Daily step goal; minimum strength 2×.', 'Meta de pasos diarios; fuerza mínima 2×.'),
    category: 'neat',
    training_style: 'steps_neat', resistance_days: 2, cardio_days: 5,
    resistance_minutes: 30, cardio_minutes: 45, cardio_modality: 'walking', intensity: 'low_moderate',
    steps_target: 10000, tags: ['passos', 'neat'],
  },
  {
    id: 'ex_functional',
    labels: L('Funcional / circuit', 'Functional / circuit', 'Funcional / circuito'),
    summary: L('Circuitos metabólicos 3× + mobilidade.', 'Metabolic circuits 3× + mobility.', 'Circuitos metabólicos 3× + movilidad.'),
    category: 'combined',
    training_style: 'functional', resistance_days: 3, cardio_days: 2,
    resistance_minutes: 40, cardio_minutes: 20, cardio_modality: 'circuit', intensity: 'moderate_high',
    steps_target: 7000, tags: ['funcional'],
  },
  {
    id: 'ex_pilates_recovery',
    labels: L('Pilates / mobilidade (recuperação)', 'Pilates / mobility (recovery)', 'Pilates / movilidad (recuperación)'),
    summary: L('Baixo impacto para recuperação e postura.', 'Low impact for recovery and posture.', 'Bajo impacto para recuperación y postura.'),
    category: 'recovery',
    training_style: 'pilates', resistance_days: 2, cardio_days: 2,
    resistance_minutes: 45, cardio_minutes: 25, cardio_modality: 'walking', intensity: 'low',
    steps_target: 6000, tags: ['recuperação', 'pilates'],
  },
  {
    id: 'ex_swim_cycle',
    labels: L('Natação / ciclismo (baixo impacto)', 'Swimming / cycling (low impact)', 'Natación / ciclismo (bajo impacto)'),
    summary: L('Cardio de baixo impacto pós GLP-1 ou articular.', 'Low-impact cardio post GLP-1 or joint-friendly.', 'Cardio de bajo impacto post GLP-1 o articular.'),
    category: 'cardio',
    training_style: 'swim_cycle', resistance_days: 2, cardio_days: 4,
    resistance_minutes: 35, cardio_minutes: 40, cardio_modality: 'swim', intensity: 'moderate',
    steps_target: 5000, tags: ['baixo impacto', 'glp1'],
  },
  {
    id: 'ex_glp1_preserve',
    labels: L('Preservação FFM sob GLP-1', 'FFM preservation on GLP-1', 'Preservación FFM bajo GLP-1'),
    summary: L('Prioriza resistência progressiva 3–4× e passos.', 'Prioritizes progressive resistance 3–4× and steps.', 'Prioriza resistencia progresiva 3–4× y pasos.'),
    category: 'glp1',
    training_style: 'glp1_ffm', resistance_days: 4, cardio_days: 2,
    resistance_minutes: 50, cardio_minutes: 25, cardio_modality: 'walking', intensity: 'moderate',
    steps_target: 8000, tags: ['glp1', 'ffm'],
  },
  {
    id: 'ex_custom',
    labels: L('Personalizado (preencher campos)', 'Custom (fill fields)', 'Personalizado (completar campos)'),
    summary: L('Defina estilo, dias e modalidades manualmente.', 'Set style, days and modalities manually.', 'Defina estilo, días y modalidades manualmente.'),
    category: 'custom',
    tags: ['custom'],
  },
];

export const MEAL_PATTERNS: SimpleOption[] = [
  { id: 'meals_3', labels: L('3 refeições', '3 meals', '3 comidas') },
  { id: 'meals_3_4', labels: L('3–4 refeições', '3–4 meals', '3–4 comidas') },
  { id: 'meals_4_5', labels: L('4–5 refeições', '4–5 meals', '4–5 comidas') },
  { id: 'meals_4_6', labels: L('4–6 refeições', '4–6 meals', '4–6 comidas') },
  { id: 'tre_12_12', labels: L('Janela 12:12', 'Window 12:12', 'Ventana 12:12') },
  { id: 'tre_14_10', labels: L('Janela 14:10', 'Window 14:10', 'Ventana 14:10') },
  { id: 'tre_16_8', labels: L('Janela 16:8', 'Window 16:8', 'Ventana 16:8') },
];

export const CARB_EMPHASIS: SimpleOption[] = [
  { id: 'very_low', labels: L('Muito baixo', 'Very low', 'Muy bajo'), hint: L('<50 g', '<50 g', '<50 g') },
  { id: 'low', labels: L('Baixo', 'Low', 'Bajo'), hint: L('50–130 g', '50–130 g', '50–130 g') },
  { id: 'low_moderate', labels: L('Baixo–moderado', 'Low–moderate', 'Bajo–moderado') },
  { id: 'moderate', labels: L('Moderado', 'Moderate', 'Moderado') },
  { id: 'moderate_high', labels: L('Moderado–alto', 'Moderate–high', 'Moderado–alto') },
  { id: 'high', labels: L('Alto', 'High', 'Alto') },
];

export const FAT_EMPHASIS: SimpleOption[] = [
  { id: 'low', labels: L('Baixa (≤25%)', 'Low (≤25%)', 'Baja (≤25%)') },
  { id: 'moderate', labels: L('Moderada (25–35%)', 'Moderate (25–35%)', 'Moderada (25–35%)') },
  { id: 'higher', labels: L('Elevada (35–45%)', 'Higher (35–45%)', 'Elevada (35–45%)') },
  { id: 'high', labels: L('Alta (>45%)', 'High (>45%)', 'Alta (>45%)') },
];

export const PROTEIN_PER_KG: SimpleOption[] = [
  { id: '1.2', labels: L('1,2 g/kg', '1.2 g/kg', '1,2 g/kg') },
  { id: '1.4', labels: L('1,4 g/kg', '1.4 g/kg', '1,4 g/kg') },
  { id: '1.6', labels: L('1,6 g/kg', '1.6 g/kg', '1,6 g/kg') },
  { id: '1.8', labels: L('1,8 g/kg', '1.8 g/kg', '1,8 g/kg') },
  { id: '2.0', labels: L('2,0 g/kg', '2.0 g/kg', '2,0 g/kg') },
  { id: '2.2', labels: L('2,2 g/kg', '2.2 g/kg', '2,2 g/kg') },
];

export const TRAINING_STYLES: SimpleOption[] = [
  { id: 'full_body', labels: L('Full-body', 'Full-body', 'Full-body') },
  { id: 'upper_lower', labels: L('Upper / lower', 'Upper / lower', 'Upper / lower') },
  { id: 'ppl', labels: L('Push / pull / legs', 'Push / pull / legs', 'Push / pull / legs') },
  { id: 'hypertrophy_deficit', labels: L('Hipertrofia + déficit', 'Hypertrophy + deficit', 'Hipertrofia + déficit') },
  { id: 'strength_liss', labels: L('Força + LISS', 'Strength + LISS', 'Fuerza + LISS') },
  { id: 'hiit_base', labels: L('HIIT + base', 'HIIT + base', 'HIIT + base') },
  { id: 'steps_neat', labels: L('Passos / NEAT', 'Steps / NEAT', 'Pasos / NEAT') },
  { id: 'functional', labels: L('Funcional / circuit', 'Functional / circuit', 'Funcional / circuito') },
  { id: 'pilates', labels: L('Pilates / mobilidade', 'Pilates / mobility', 'Pilates / movilidad') },
  { id: 'swim_cycle', labels: L('Natação / ciclismo', 'Swim / cycle', 'Natación / ciclismo') },
  { id: 'glp1_ffm', labels: L('Preservação FFM (GLP-1)', 'FFM preservation (GLP-1)', 'Preservación FFM (GLP-1)') },
];

export const CARDIO_MODALITIES: SimpleOption[] = [
  { id: 'walking', labels: L('Caminhada', 'Walking', 'Caminata') },
  { id: 'jogging', labels: L('Trote leve', 'Light jog', 'Trote ligero') },
  { id: 'bike', labels: L('Bicicleta / ergômetro', 'Bike / ergometer', 'Bici / ergómetro') },
  { id: 'elliptical', labels: L('Elíptico', 'Elliptical', 'Elíptica') },
  { id: 'swim', labels: L('Natação', 'Swimming', 'Natación') },
  { id: 'hiit', labels: L('HIIT', 'HIIT', 'HIIT') },
  { id: 'circuit', labels: L('Circuito', 'Circuit', 'Circuito') },
  { id: 'dance', labels: L('Dança / zumba', 'Dance / zumba', 'Baile / zumba') },
  { id: 'row', labels: L('Remo', 'Rowing', 'Remo') },
  { id: 'mixed', labels: L('Misto', 'Mixed', 'Mixto') },
];

export const INTENSITY_OPTIONS: SimpleOption[] = [
  { id: 'low', labels: L('Baixa (RPE 3–4)', 'Low (RPE 3–4)', 'Baja (RPE 3–4)') },
  { id: 'low_moderate', labels: L('Baixa–moderada (RPE 4–5)', 'Low–moderate (RPE 4–5)', 'Baja–moderada (RPE 4–5)') },
  { id: 'moderate', labels: L('Moderada (RPE 5–6)', 'Moderate (RPE 5–6)', 'Moderada (RPE 5–6)') },
  { id: 'moderate_high', labels: L('Moderada–alta (RPE 6–7)', 'Moderate–high (RPE 6–7)', 'Moderada–alta (RPE 6–7)') },
  { id: 'high', labels: L('Alta (RPE 7–8)', 'High (RPE 7–8)', 'Alta (RPE 7–8)') },
];

export const DEFICIT_PRESETS: SimpleOption[] = [
  { id: '0', labels: L('0 — manutenção', '0 — maintenance', '0 — mantenimiento') },
  { id: '250', labels: L('250 kcal — muito leve', '250 kcal — very mild', '250 kcal — muy leve') },
  { id: '350', labels: L('350 kcal — leve', '350 kcal — mild', '350 kcal — leve') },
  { id: '500', labels: L('500 kcal — moderado', '500 kcal — moderate', '500 kcal — moderado') },
  { id: '750', labels: L('750 kcal — agressivo', '750 kcal — aggressive', '750 kcal — agresivo') },
  { id: '1000', labels: L('1000 kcal — máximo supervisionado', '1000 kcal — max supervised', '1000 kcal — máximo supervisado') },
];

export const CALORIE_PRESETS: SimpleOption[] = [
  { id: '1400', labels: L('1400 kcal/d', '1400 kcal/d', '1400 kcal/d') },
  { id: '1500', labels: L('1500 kcal/d', '1500 kcal/d', '1500 kcal/d') },
  { id: '1600', labels: L('1600 kcal/d', '1600 kcal/d', '1600 kcal/d') },
  { id: '1700', labels: L('1700 kcal/d', '1700 kcal/d', '1700 kcal/d') },
  { id: '1800', labels: L('1800 kcal/d', '1800 kcal/d', '1800 kcal/d') },
  { id: '1900', labels: L('1900 kcal/d', '1900 kcal/d', '1900 kcal/d') },
  { id: '2000', labels: L('2000 kcal/d', '2000 kcal/d', '2000 kcal/d') },
  { id: '2200', labels: L('2200 kcal/d', '2200 kcal/d', '2200 kcal/d') },
  { id: '2400', labels: L('2400 kcal/d', '2400 kcal/d', '2400 kcal/d') },
  { id: '2600', labels: L('2600 kcal/d', '2600 kcal/d', '2600 kcal/d') },
];

export const HORIZON_OPTIONS: SimpleOption[] = [
  { id: '4', labels: L('4 semanas', '4 weeks', '4 semanas') },
  { id: '8', labels: L('8 semanas', '8 weeks', '8 semanas') },
  { id: '12', labels: L('12 semanas (~3 meses)', '12 weeks (~3 months)', '12 semanas (~3 meses)') },
  { id: '16', labels: L('16 semanas', '16 weeks', '16 semanas') },
  { id: '24', labels: L('24 semanas (~6 meses)', '24 weeks (~6 months)', '24 semanas (~6 meses)') },
  { id: '36', labels: L('36 semanas', '36 weeks', '36 semanas') },
  { id: '52', labels: L('52 semanas (~1 ano)', '52 weeks (~1 year)', '52 semanas (~1 año)') },
];

export const ADHERENCE_OPTIONS: SimpleOption[] = [
  { id: 'low', labels: L('Baixa (~45%)', 'Low (~45%)', 'Baja (~45%)'), hint: L('Intermitente', 'Intermittent', 'Intermitente') },
  { id: 'moderate', labels: L('Moderada (~70%)', 'Moderate (~70%)', 'Moderada (~70%)'), hint: L('Maioria dos dias', 'Most days', 'Mayoría de días') },
  { id: 'high', labels: L('Alta (~95%)', 'High (~95%)', 'Alta (~95%)'), hint: L('Consistente', 'Consistent', 'Consistente') },
];

export const MAGNITUDE_OPTIONS: SimpleOption[] = [
  { id: 'conservative', labels: L('Conservador (teto ~8% PC)', 'Conservative (~8% BW cap)', 'Conservador (tope ~8% PC)') },
  { id: 'moderate', labels: L('Moderado (teto ~12% PC)', 'Moderate (~12% BW cap)', 'Moderado (tope ~12% PC)') },
];

export const SLEEP_HOURS: SimpleOption[] = [
  { id: '5', labels: L('<6 h', '<6 h', '<6 h') },
  { id: '6', labels: L('6 h', '6 h', '6 h') },
  { id: '7', labels: L('7 h', '7 h', '7 h') },
  { id: '8', labels: L('8 h', '8 h', '8 h') },
  { id: '9', labels: L('≥9 h', '≥9 h', '≥9 h') },
];

export const STEPS_TARGETS: SimpleOption[] = [
  { id: '4000', labels: L('4.000 passos', '4,000 steps', '4.000 pasos') },
  { id: '6000', labels: L('6.000 passos', '6,000 steps', '6.000 pasos') },
  { id: '8000', labels: L('8.000 passos', '8,000 steps', '8.000 pasos') },
  { id: '10000', labels: L('10.000 passos', '10,000 steps', '10.000 pasos') },
  { id: '12000', labels: L('12.000 passos', '12,000 steps', '12.000 pasos') },
];

export const STRESS_LEVELS: SimpleOption[] = [
  { id: 'low', labels: L('Baixo', 'Low', 'Bajo') },
  { id: 'moderate', labels: L('Moderado', 'Moderate', 'Moderado') },
  { id: 'high', labels: L('Alto', 'High', 'Alto') },
];

export const ALCOHOL_OPTIONS: SimpleOption[] = [
  { id: 'none', labels: L('Nenhum / raro', 'None / rare', 'Ninguno / raro') },
  { id: 'light', labels: L('Leve (≤3 doses/sem)', 'Light (≤3 drinks/wk)', 'Leve (≤3 dosis/sem)') },
  { id: 'moderate', labels: L('Moderado', 'Moderate', 'Moderado') },
  { id: 'heavy', labels: L('Elevado (impacto no déficit)', 'Heavy (impacts deficit)', 'Elevado (impacta el déficit)') },
];

export const SESSION_MINUTES: SimpleOption[] = [
  { id: '20', labels: L('20 min', '20 min', '20 min') },
  { id: '30', labels: L('30 min', '30 min', '30 min') },
  { id: '40', labels: L('40 min', '40 min', '40 min') },
  { id: '45', labels: L('45 min', '45 min', '45 min') },
  { id: '50', labels: L('50 min', '50 min', '50 min') },
  { id: '60', labels: L('60 min', '60 min', '60 min') },
  { id: '75', labels: L('75 min', '75 min', '75 min') },
  { id: '90', labels: L('90 min', '90 min', '90 min') },
];

export function filterByQuery<T extends { labels: LangLabel; tags?: string[]; summary?: LangLabel; category?: string }>(
  items: T[],
  q: string,
  locale: string,
): T[] {
  const term = q.trim().toLowerCase();
  if (!term) return items;
  return items.filter((it) => {
    const hay = [
      pickLabel(it.labels, locale),
      it.summary ? pickLabel(it.summary, locale) : '',
      it.category || '',
      ...(it.tags || []),
    ].join(' ').toLowerCase();
    return hay.includes(term);
  });
}
