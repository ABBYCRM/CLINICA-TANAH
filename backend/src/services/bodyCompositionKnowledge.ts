/**
 * Body-composition knowledge corpus + lightweight RAG retrieval.
 * Curated educational rates for medications, diet energy balance, exercise,
 * and composition partitioning — used to ground scenario projections.
 *
 * Not a clinical decision-support system; illustrative simulation only.
 */

export type KnowledgeDomain =
  | 'medication'
  | 'diet'
  | 'exercise'
  | 'body_composition'
  | 'energy'
  | 'safety';

export type KnowledgeChunk = {
  id: string;
  domain: KnowledgeDomain;
  title: string;
  text: string;
  tags: string[];
  /** Optional structured rates consumed by the projection engine */
  rates?: Record<string, number>;
  source: string;
};

/** Evidence-informed educational corpus (adult outpatient / metabolic care). */
export const BODY_COMPOSITION_CORPUS: KnowledgeChunk[] = [
  {
    id: 'energy-7700',
    domain: 'energy',
    title: 'Energy density of adipose tissue',
    text: 'Approximately 7700 kcal of sustained energy deficit corresponds to ~1 kg of adipose tissue loss in classic models. Real-world loss is slower due to metabolic adaptation (~0.65–0.85 efficiency after several weeks).',
    tags: ['calories', 'deficit', 'fat', 'tdee', 'energy'],
    rates: { kcal_per_kg_fat: 7700, metabolic_efficiency: 0.78 },
    source: 'Hall KD et al. energy balance models; classic Atwater-derived rule of thumb',
  },
  {
    id: 'energy-mifflin',
    domain: 'energy',
    title: 'Resting energy expenditure (Mifflin–St Jeor)',
    text: 'BMR ≈ 10·weight_kg + 6.25·height_cm − 5·age − 161 (female) or +5 (male). TDEE multiplies BMR by activity factor from resistance and cardio frequency.',
    tags: ['bmr', 'tdee', 'calories', 'mifflin', 'energy'],
    rates: {
      activity_sedentary: 1.2,
      activity_light: 1.375,
      activity_moderate: 1.55,
      activity_high: 1.725,
    },
    source: 'Mifflin MD et al. Am J Clin Nutr 1990',
  },
  {
    id: 'diet-deficit-safe',
    domain: 'diet',
    title: 'Safe ambulatory calorie deficit',
    text: 'A 300–750 kcal/day deficit typically yields ~0.25–0.75 kg/week of weight change when adherence is good. Deficits >1000 kcal/day increase lean-mass loss and are capped in conservative simulations.',
    tags: ['diet', 'deficit', 'calories', 'nutrition', 'weight_loss'],
    rates: {
      mild_deficit_kcal: 350,
      moderate_deficit_kcal: 500,
      aggressive_deficit_kcal: 750,
      max_deficit_kcal: 1000,
      weekly_kg_per_500_deficit: 0.45,
    },
    source: 'Obesity guidelines (AACE/ACE, Brazilian ambulatory practice)',
  },
  {
    id: 'diet-protein-ffm',
    domain: 'body_composition',
    title: 'Protein and fat-free mass during deficit',
    text: 'Higher protein (~1.6–2.2 g/kg) plus resistance training shifts loss toward fat mass and preserves FFM. Without both, ~20–35% of weight lost may be lean tissue.',
    tags: ['protein', 'ffm', 'muscle', 'diet', 'composition'],
    rates: {
      ffm_loss_fraction_default: 0.28,
      ffm_loss_fraction_protein_rt: 0.12,
      ffm_loss_fraction_no_rt: 0.35,
    },
    source: 'Helms / ISSN protein position; obesity composition literature',
  },
  {
    id: 'ex-resistance',
    domain: 'exercise',
    title: 'Resistance training vs composition',
    text: 'Resistance 2–4×/week during fat loss primarily preserves muscle and may add ~0.05–0.2 kg FFM/month if protein and recovery are adequate. Visual effect: firmer limbs, modest waist change.',
    tags: ['resistance', 'strength', 'exercise', 'muscle', 'ffm'],
    rates: {
      ffm_gain_kg_per_month_high: 0.18,
      ffm_gain_kg_per_month_mod: 0.1,
      waist_cm_per_kg_fat: 0.85,
    },
    source: 'Resistance training meta-analyses in energy deficit',
  },
  {
    id: 'ex-cardio',
    domain: 'exercise',
    title: 'Cardio energy expenditure',
    text: 'Moderate cardio sessions (~30–45 min) add roughly 180–350 kcal each. Extra weekly expenditure compounds the diet deficit but partially compensates via appetite and NEAT.',
    tags: ['cardio', 'aerobic', 'exercise', 'calories', 'tdee'],
    rates: {
      cardio_kcal_per_session: 250,
      compensation_fraction: 0.25,
    },
    source: 'Exercise energy expenditure estimates; NEAT compensation literature',
  },
  {
    id: 'med-semaglutide',
    domain: 'medication',
    title: 'Semaglutide (GLP-1) weight trajectory',
    text: 'In STEP-1, semaglutide 2.4 mg averaged ~14.9% body-weight reduction at 68 weeks with lifestyle. Early months are faster (~1.5–3% BW/month) then decelerate. Preferential visceral/central fat reduction is typical.',
    tags: ['semaglutide', 'ozempic', 'wegovy', 'glp1', 'incretin', 'medication'],
    rates: {
      pct_bw_at_12w: 5.5,
      pct_bw_at_24w: 9.5,
      pct_bw_at_52w: 13.5,
      pct_bw_at_68w: 14.9,
      fat_fraction_of_loss: 0.82,
    },
    source: 'Wilding JPH et al. STEP 1, NEJM 2021',
  },
  {
    id: 'med-tirzepatide',
    domain: 'medication',
    title: 'Tirzepatide (dual GIP/GLP-1) weight trajectory',
    text: 'SURMOUNT-1 showed ~15–21% mean weight loss at 72 weeks depending on dose. Faster early phase than GLP-1 alone; simulation uses dose-agnostic mid curve for educational envelopes.',
    tags: ['tirzepatide', 'mounjaro', 'zepbound', 'dual_incretin', 'incretin', 'medication'],
    rates: {
      pct_bw_at_12w: 7.5,
      pct_bw_at_24w: 13,
      pct_bw_at_52w: 18,
      pct_bw_at_72w: 20.9,
      fat_fraction_of_loss: 0.84,
    },
    source: 'Jastreboff AM et al. SURMOUNT-1, NEJM 2022',
  },
  {
    id: 'med-liraglutide',
    domain: 'medication',
    title: 'Liraglutide 3 mg weight trajectory',
    text: 'SCALE trials: ~8% mean weight loss at 56 weeks with lifestyle. Slower than semaglutide/tirzepatide.',
    tags: ['liraglutide', 'saxenda', 'victoza', 'glp1', 'incretin', 'medication'],
    rates: {
      pct_bw_at_12w: 3.5,
      pct_bw_at_24w: 5.5,
      pct_bw_at_52w: 7.5,
      pct_bw_at_56w: 8.0,
      fat_fraction_of_loss: 0.8,
    },
    source: 'Pi-Sunyer X et al. SCALE, NEJM 2015',
  },
  {
    id: 'med-metformin',
    domain: 'medication',
    title: 'Metformin modest weight effect',
    text: 'Metformin often yields ~2–3% body-weight reduction over 6–12 months, mainly via appetite and mild energy effects — not a primary fat-loss agent.',
    tags: ['metformin', 'glifage', 'medication', 'diabetes'],
    rates: {
      pct_bw_at_12w: 1.0,
      pct_bw_at_24w: 1.8,
      pct_bw_at_52w: 2.5,
      fat_fraction_of_loss: 0.7,
    },
    source: 'Diabetes Prevention Program / metformin weight literature',
  },
  {
    id: 'med-orlistat',
    domain: 'medication',
    title: 'Orlistat fat absorption',
    text: 'Orlistat blocks ~30% of dietary fat absorption; typical additional loss ~2–4% BW over a year with a reduced-fat diet.',
    tags: ['orlistat', 'xenical', 'medication'],
    rates: {
      pct_bw_at_12w: 1.2,
      pct_bw_at_24w: 2.2,
      pct_bw_at_52w: 3.2,
      fat_fraction_of_loss: 0.85,
    },
    source: 'Orlistat long-term RCTs',
  },
  {
    id: 'comp-waist',
    domain: 'body_composition',
    title: 'Waist change vs fat mass',
    text: 'Central fat loss of ~1 kg often maps to ~0.7–1.1 cm waist reduction in adults with elevated WHtR, with diminishing returns as BMI normalizes.',
    tags: ['waist', 'visceral', 'composition', 'silhouette'],
    rates: { waist_cm_per_kg_central_fat: 0.9, central_fat_share: 0.55 },
    source: 'Anthropometric–DXA correlation studies',
  },
  {
    id: 'comp-bfpct',
    domain: 'body_composition',
    title: 'Body-fat % from compartment change',
    text: 'BF% ≈ fat_mass / weight. Prefer projecting fat_kg and FFM_kg separately, then recompute BF% and BMI rather than scaling BF% alone.',
    tags: ['body_fat', 'ffm', 'fat_mass', 'composition'],
    rates: {},
    source: 'Standard two-compartment model',
  },
  {
    id: 'safety-disclaimer',
    domain: 'safety',
    title: 'Simulation limits',
    text: 'Projections are educational envelopes for professionally mediated visualization. They are not outcome guarantees, not Manchester triage, and must not replace clinical judgment. Image outputs must stay photoreal and watermarked as illustrative.',
    tags: ['safety', 'disclaimer', 'simulation'],
    rates: {},
    source: 'Clínica Tanah body module policy',
  },
  {
    id: 'combine-subadditive',
    domain: 'body_composition',
    title: 'Combining medication + diet + exercise',
    text: 'Medication, calorie deficit, and exercise overlap. Use subadditive combination: total ≈ med + diet·(1−overlap) + exercise_extra, then clamp to magnitude caps and physiological ceilings (~1% BW/week early, less later).',
    tags: ['combination', 'medication', 'diet', 'exercise', 'realistic'],
    rates: {
      med_diet_overlap: 0.35,
      max_weekly_pct_bw: 1.0,
      max_weekly_kg: 1.2,
    },
    source: 'Lifestyle + incretin trial design literature',
  },
];

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9_+]+/)
    .filter((t) => t.length > 1);
}

/** Lightweight RAG: tag + lexical overlap retrieval (no external vector DB). */
export function retrieveBodyCompositionKnowledge(query: {
  text?: string;
  tags?: string[];
  domains?: KnowledgeDomain[];
  limit?: number;
}): Array<KnowledgeChunk & { score: number }> {
  const qTokens = new Set([
    ...tokenize(query.text || ''),
    ...(query.tags || []).flatMap((t) => tokenize(t)),
  ]);
  const domainFilter = query.domains?.length ? new Set(query.domains) : null;
  const scored = BODY_COMPOSITION_CORPUS.map((chunk) => {
    if (domainFilter && !domainFilter.has(chunk.domain)) return { ...chunk, score: -1 };
    let score = 0;
    for (const tag of chunk.tags) {
      const tt = tokenize(tag);
      if (tt.some((t) => qTokens.has(t)) || (query.tags || []).some((t) => t.toLowerCase() === tag)) {
        score += 3;
      }
    }
    for (const tok of tokenize(`${chunk.title} ${chunk.text} ${chunk.id}`)) {
      if (qTokens.has(tok)) score += 1;
    }
    // Always keep safety chunk lightly available
    if (chunk.domain === 'safety') score += 0.5;
    return { ...chunk, score };
  })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const limit = Math.max(1, Math.min(12, query.limit ?? 6));
  return scored.slice(0, limit);
}

export function ratesFromChunks(chunks: Array<KnowledgeChunk | (KnowledgeChunk & { score: number })>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of chunks) {
    if (!c.rates) continue;
    for (const [k, v] of Object.entries(c.rates)) {
      if (typeof v === 'number' && !(k in out)) out[k] = v;
    }
  }
  return out;
}
