/**
 * Body prontuário — measurements, meds, lifestyle plans, consents,
 * clinical photo captures, and AI scenario visualizations.
 *
 * Embedded into Clínica Tanah patient Clínico tab (not a separate CRM).
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createHmac, timingSafeEqual } from 'crypto';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { canViewClinical } from '../services/patientJourney';
import { seal, open } from '../services/phiCrypto';
import { upsertPatientDocumentPointer } from '../services/patientDocumentsVault';
import {
  bodyUploadsDir,
  buildScenarioPrompt,
  calcBmi,
  enforceAfterReflectsMath,
  fetchProviderImageBytes,
  generateBodyScenarioImage,
  imageProvidersStatus,
  lockArchitectureFromBefore,
  morphGuidanceFromEnvelope,
  pollA2e,
  retainBodyPhotoCopy,
  type MorphGuidance,
} from '../services/bodyImage';
import {
  applySessionConsistency,
  CAPTURE_VIEWS,
  processClinicalPhoto,
  type CaptureView,
} from '../services/captureQuality';
import {
  buildPhotorealScenarioPrompt,
  computeScenarioEnvelope,
  type PlanConfig,
  type ScenarioAssumptions,
} from '../services/scenarioEnvelope';
import {
  enrichEnvelopeWithAnatomy,
  PROMPT_VERSION,
  SCENARIO_WATERMARK,
} from '../services/anatomicalEnvelope';
import {
  getById as getLibraryMedById,
  listLibrary,
  search as searchLibrary,
} from '../services/bodyMedicationLibrary';
import { verifyStepUp } from './auth';
import {
  collectClinicalReportData,
  ensureClinicalReportsTable,
  renderClinicalReportHtml,
  writeClinicalReportHtml,
} from '../services/clinicalFullReport';
import {
  buildCompositionDossierPdf,
  collectBodyProntuarioForDossier,
  writeCompositionDossierPdf,
} from '../services/compositionDossierPdf';
import { uploadsRoot } from '../services/nvidiaOcr';

function ageFromBirthDate(birth?: string | null): number | null {
  if (!birth || !/^\d{4}-\d{2}-\d{2}/.test(birth)) return null;
  const d = new Date(birth);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age > 10 && age < 110 ? age : null;
}

function hydrateLifestylePlan(row: any) {
  if (!row) return row;
  let params: any = {};
  try { params = row.params_json ? JSON.parse(row.params_json) : {}; } catch { params = {}; }
  return {
    ...row,
    params,
    daily_calories: params.daily_calories ?? null,
    deficit_kcal: params.deficit_kcal ?? null,
    protein_g: params.protein_g ?? null,
  };
}

const NUM = z.number().finite().optional().nullable();
const measurementBodySchema = z.object({
  measured_at: z.string().optional().nullable(),
  recorded_at: z.string().optional().nullable(),
  height_cm: z.number().positive().max(300),
  weight_kg: z.number().positive().max(500),
  neck_cm: NUM, shoulders_cm: NUM, chest_cm: NUM, waist_cm: NUM, abdomen_cm: NUM, hip_cm: NUM,
  arm_right_cm: NUM, arm_left_cm: NUM, forearm_right_cm: NUM, forearm_left_cm: NUM,
  wrist_cm: NUM, thigh_right_cm: NUM, thigh_left_cm: NUM, calf_right_cm: NUM, calf_left_cm: NUM, ankle_cm: NUM,
  body_fat_pct: NUM, muscle_mass_kg: NUM, bone_mass_kg: NUM, visceral_fat_level: NUM, body_water_pct: NUM,
  systolic_mmhg: NUM, diastolic_mmhg: NUM, heart_rate_bpm: NUM, spo2_pct: NUM, temperature_c: NUM,
  device_label: z.string().max(200).optional().nullable(),
  clothing_note: z.string().max(500).optional().nullable(),
  posture_note: z.string().max(500).optional().nullable(),
  fasting_state: z.enum(['fasting', 'non_fasting', 'unknown']).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  verified: z.boolean().optional(),
});

function flattenMeasurement(row: any) {
  if (!row) return null;
  const payload = row.payload ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) : {};
  const notes = row.notes ? (open(row.notes) || row.notes) : null;
  return {
    id: row.id,
    recorded_at: row.recorded_at,
    measured_at: row.recorded_at,
    height_cm: row.height_cm,
    weight_kg: row.weight_kg,
    waist_cm: row.waist_cm ?? payload.waist_cm ?? null,
    bmi: row.bmi ?? calcBmi(row.height_cm, row.weight_kg),
    whr: row.whr ?? null,
    whtr: row.whtr ?? null,
    device_label: row.device_label || payload.device_label || null,
    fasting_state: row.fasting_state || payload.fasting_state || 'unknown',
    clothing_note: row.clothing_note || payload.clothing_note || null,
    posture_note: row.posture_note || payload.posture_note || null,
    verified: !!row.verified,
    notes,
    ...payload,
    // camelCase aliases for BodyPath-style consumers
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    waistCm: row.waist_cm ?? payload.waist_cm ?? null,
    neckCm: payload.neck_cm ?? null,
    shouldersCm: payload.shoulders_cm ?? null,
    chestCm: payload.chest_cm ?? null,
    abdomenCm: payload.abdomen_cm ?? null,
    hipCm: payload.hip_cm ?? null,
    armRightCm: payload.arm_right_cm ?? null,
    armLeftCm: payload.arm_left_cm ?? null,
    forearmRightCm: payload.forearm_right_cm ?? null,
    forearmLeftCm: payload.forearm_left_cm ?? null,
    wristCm: payload.wrist_cm ?? null,
    thighRightCm: payload.thigh_right_cm ?? null,
    thighLeftCm: payload.thigh_left_cm ?? null,
    calfRightCm: payload.calf_right_cm ?? null,
    calfLeftCm: payload.calf_left_cm ?? null,
    ankleCm: payload.ankle_cm ?? null,
    bodyFatPct: payload.body_fat_pct ?? null,
    muscleMassKg: payload.muscle_mass_kg ?? null,
    boneMassKg: payload.bone_mass_kg ?? null,
    visceralFatLevel: payload.visceral_fat_level ?? null,
    bodyWaterPct: payload.body_water_pct ?? null,
    systolicMmhg: payload.systolic_mmhg ?? null,
    diastolicMmhg: payload.diastolic_mmhg ?? null,
    heartRateBpm: payload.heart_rate_bpm ?? null,
    spo2Pct: payload.spo2_pct ?? null,
    temperatureC: payload.temperature_c ?? null,
    deviceLabel: row.device_label || payload.device_label || null,
    clothingNote: row.clothing_note || payload.clothing_note || null,
    postureNote: row.posture_note || payload.posture_note || null,
    fastingState: row.fasting_state || payload.fasting_state || 'unknown',
  };
}

const router = Router();
router.use(authenticate);

const CLINICAL_ROLES = ['admin', 'doctor', 'nurse'] as const;
const BODY_PURPOSES = [
  'clinical_record',
  'image_processing',
  'generative_ai',
  'cross_border_transfer',
  'research',
  'marketing',
] as const;

const BODY_FEATURE_FLAGS = {
  gemini_generation: true,
  patient_scenario_visibility: true,
  public_export: false,
  provider_model_changes: true,
  offline_phi_queue: false,
  high_contrast_default: false,
} as const;

const REVIEW_CHECKLIST_KEYS = [
  'identity_preserved',
  'anatomy_plausible',
  'scenario_conservative',
  'assumptions_visible',
  'no_prohibited_manipulation',
  'consent_active',
  'watermark_present',
] as const;

function requireStepUp(req: Request, res: Response): boolean {
  const token = String(
    req.headers['x-step-up']
    || req.headers['x-step-up-token']
    || req.body?.step_up_token
    || '',
  ).trim();
  if (!verifyStepUp(token, req.user!.id)) {
    res.status(403).json({
      error: 'step_up_required',
      message: 'Re-authenticate with POST /api/auth/step-up before generating body images.',
    });
    return false;
  }
  return true;
}

type OutputViewEntry = {
  has_image: boolean;
  path?: string;
  provider?: string;
  view: string;
  error?: string | null;
};

/** API-safe output_views (no filesystem paths). */
function publicOutputViews(raw: unknown): Record<string, {
  has_image: boolean;
  provider: string | null;
  view: string;
  error: string | null;
}> | null {
  if (!raw) return null;
  let parsed: any = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const out: Record<string, { has_image: boolean; provider: string | null; view: string; error: string | null }> = {};
  for (const key of CAPTURE_VIEWS) {
    const entry = parsed[key];
    if (!entry) continue;
    out[key] = {
      has_image: !!entry.has_image,
      provider: entry.provider || null,
      view: key,
      error: entry.error || null,
    };
  }
  // Include any unexpected keys without path
  for (const [key, entry] of Object.entries(parsed)) {
    if (out[key] || !entry || typeof entry !== 'object') continue;
    const e = entry as any;
    out[key] = {
      has_image: !!e.has_image,
      provider: e.provider || null,
      view: key,
      error: e.error || null,
    };
  }
  return Object.keys(out).length ? out : null;
}

function writeOutputViews(scenarioId: string, views: Record<string, OutputViewEntry>) {
  db.prepare(`
    UPDATE body_scenarios
       SET output_views = ?, updated_at = datetime('now')
     WHERE id = ?
  `).run(JSON.stringify(views), scenarioId);
}

function markScenarioOutputViews(scenarioId: string, views?: Record<string, OutputViewEntry>) {
  if (views) {
    writeOutputViews(scenarioId, views);
    return;
  }
  writeOutputViews(scenarioId, { front: { has_image: true, view: 'front' } });
}

function loadScenarioForApi(scenarioId: string) {
  const scenario = db.prepare(`
    SELECT id, capture_id, capture_session_id, title, goal, weeks, horizon_weeks, status, provider, image_url,
           CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END AS has_image,
           error, review_status, execution_plan, output_views, prompt_version, watermark,
           created_at, updated_at
    FROM body_scenarios WHERE id = ?
  `).get(scenarioId) as any;
  if (!scenario) return null;
  if (scenario.execution_plan) {
    try { scenario.execution_plan = JSON.parse(scenario.execution_plan); } catch { /* */ }
  }
  scenario.output_views = publicOutputViews(scenario.output_views);
  const views = scenario.output_views || {};
  scenario.output_view_count = Object.values(views).filter((v: any) => v?.has_image).length;
  return scenario;
}

async function resolvePublicRef(assetId: string | null | undefined, imagePath: string | null | undefined): Promise<string | null> {
  const origin = (process.env.APP_ORIGIN || '').replace(/\/$/, '');
  if (!assetId || !imagePath || !fs.existsSync(imagePath) || !/^https:\/\//i.test(origin)) return null;
  const candidate = `${origin}/api/public/body-asset/${signBodyAssetToken(assetId)}`;
  try {
    const head = await fetch(candidate, { method: 'GET' });
    if (head.ok) return candidate;
  } catch { /* */ }
  return null;
}

async function generateAndPersistOneView(opts: {
  tenantId: string;
  patientId: string;
  scenarioId: string;
  view: CaptureView;
  prompt: string;
  referencePath: string | null;
  assetId?: string | null;
  morphGuidance?: MorphGuidance | null;
}): Promise<OutputViewEntry> {
  const referencePublicUrl = await resolvePublicRef(opts.assetId, opts.referencePath);
  let result = await generateBodyScenarioImage({
    name: `clinica-tanah-${opts.scenarioId.slice(0, 8)}-${opts.view}`,
    prompt: opts.prompt,
    referencePath: opts.referencePath,
    referencePublicUrl,
    morphGuidance: opts.morphGuidance,
  });

  // Poll A2E if pending — nano-banana often needs 60–120s
  if (result.status === 'pending' && result.taskId) {
    let terminal = false;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const polled = await pollA2e(result.taskId!);
      if (polled.status === 'completed' && polled.imageUrl) {
        result = polled;
        terminal = true;
        break;
      }
      if (polled.status === 'failed') {
        result = polled;
        terminal = true;
        break;
      }
    }
    if (!terminal && result.status === 'pending') {
      result = {
        ...result,
        status: 'failed',
        error: result.error || 'a2e_poll_timeout',
      };
    }
  }

  let imageBytes = result.imageBytes;
  if (!imageBytes && result.imageUrl) {
    imageBytes = await fetchProviderImageBytes(result.imageUrl) || undefined;
  }

  // A2E pending short-circuits the provider chain — if we still have no bytes, force
  // Gemini/Bitdeer/local_morph with local reference (skip A2E by omitting public URL).
  if ((!imageBytes || result.status === 'failed') && opts.referencePath) {
    const fallback = await generateBodyScenarioImage({
      name: `clinica-tanah-${opts.scenarioId.slice(0, 8)}-${opts.view}-fallback`,
      prompt: opts.prompt,
      referencePath: opts.referencePath,
      referencePublicUrl: null,
      morphGuidance: opts.morphGuidance,
    });
    if (fallback.status === 'pending' && fallback.taskId) {
      // Should not happen for gemini/local_morph; ignore pending A2E if misconfigured
    } else if (fallback.status === 'completed' && (fallback.imageBytes || fallback.imageUrl)) {
      result = fallback;
      imageBytes = fallback.imageBytes;
      if (!imageBytes && fallback.imageUrl) {
        imageBytes = await fetchProviderImageBytes(fallback.imageUrl) || undefined;
      }
    } else if (!imageBytes) {
      result = fallback;
    }
  }

  const dir = bodyUploadsDir(opts.tenantId, opts.patientId);

  if (!imageBytes || result.status === 'failed') {
    return {
      view: opts.view,
      has_image: false,
      provider: result.provider,
      error: result.error || 'generation_failed',
    };
  }

  // HARDENED RAG: after must reflect calculator math — reject near-copies of before
  let providerLabel = result.provider;
  if (opts.referencePath && opts.morphGuidance && fs.existsSync(opts.referencePath)) {
    const generative = result.provider === 'gemini'
      || result.provider === 'a2e'
      || result.provider === 'bitdeer'
      || String(result.provider).startsWith('gemini')
      || String(result.provider).startsWith('a2e');
    // Restore straight doors/cabinets — front only (rembg is heavy; 4× parallel OOMs small DO boxes)
    if (generative && opts.view === 'front' && process.env.ARCHITECTURE_LOCK !== '0') {
      const locked = await lockArchitectureFromBefore(opts.referencePath, imageBytes);
      if (locked?.length) {
        imageBytes = locked;
        providerLabel = `${result.provider}+bg_lock` as any;
        result = {
          ...result,
          imageBytes,
          provider: providerLabel,
          raw: {
            ...(typeof result.raw === 'object' && result.raw ? result.raw as object : {}),
            architecture_locked: true,
          },
        };
      }
    }
    const enforced = enforceAfterReflectsMath({
      referencePath: opts.referencePath,
      afterBytes: imageBytes,
      guidance: opts.morphGuidance,
      generativeProvider: generative,
    });
    if (enforced.enforced) {
      imageBytes = enforced.bytes;
      providerLabel = `${result.provider}+morph_rag` as any;
      result = {
        ...result,
        imageBytes,
        contentType: enforced.contentType,
        provider: providerLabel,
        raw: {
          ...(typeof result.raw === 'object' && result.raw ? result.raw as object : {}),
          rag_enforced: true,
          before_after_similarity: enforced.similarity,
          rule: 'img2img-after-must-reflect-math',
        },
      };
    }
  }

  const ext = (result.contentType || '').includes('png') && !String(providerLabel).includes('morph')
    ? 'png'
    : 'jpg';
  const imagePath = path.join(dir, `scenario-${opts.scenarioId}-${opts.view}.${ext}`);
  fs.writeFileSync(imagePath, imageBytes);

  // Keep legacy image_path as front for older UI
  if (opts.view === 'front') {
    const legacy = path.join(dir, `scenario-${opts.scenarioId}.${ext}`);
    fs.writeFileSync(legacy, imageBytes);
    db.prepare(`
      UPDATE body_scenarios
         SET provider = ?, image_path = ?, image_url = COALESCE(?, image_url),
             provider_task_id = COALESCE(?, provider_task_id),
             error = NULL, updated_at = datetime('now')
       WHERE id = ?
    `).run(providerLabel, legacy, result.imageUrl || null, result.taskId || null, opts.scenarioId);
  }

  return {
    view: opts.view,
    has_image: true,
    path: imagePath,
    provider: providerLabel,
    error: null,
  };
}

async function runGenerate(
  req: Request,
  scenarioId: string,
  patientId: string,
  capture: any,
  prompt: string,
  opts?: { captureSessionId?: string | null; envelope?: any; sex?: string | null; interventions?: string[]; weeks?: number },
) {
  db.prepare(`UPDATE body_scenarios SET status = 'generating', updated_at = datetime('now') WHERE id = ?`).run(scenarioId);

  const sessionId = opts?.captureSessionId
    || capture?.session_id
    || (db.prepare(`SELECT capture_session_id FROM body_scenarios WHERE id = ?`).get(scenarioId) as any)?.capture_session_id
    || null;

  const assetsByView: Partial<Record<CaptureView, any>> = {};
  if (sessionId) {
    const assets = db.prepare(`
      SELECT * FROM body_capture_assets WHERE session_id = ? AND tenant_id = ? AND deleted_at IS NULL
    `).all(sessionId, req.tenantId) as any[];
    for (const a of assets) {
      if (CAPTURE_VIEWS.includes(a.view) && a.image_path && fs.existsSync(a.image_path)) {
        assetsByView[a.view as CaptureView] = a;
      }
    }
  }

  // Legacy single capture → front only
  if (!assetsByView.front && capture?.image_path && fs.existsSync(capture.image_path)) {
    assetsByView.front = capture;
  }

  const viewsToGenerate = CAPTURE_VIEWS.filter((v) => !!assetsByView[v]);
  if (!viewsToGenerate.length) {
    // Text-only front generation when no reference photos
    viewsToGenerate.push('front');
  }

  const output: Record<string, OutputViewEntry> = {};
  const envelope = opts?.envelope;
  const weeks = opts?.weeks || 12;
  let lastProvider: string | null = null;
  let anyOk = false;
  const errors: string[] = [];

  // Generate capture views sequentially — parallel rembg/Gemini spikes memory on small DO boxes.
  for (const view of viewsToGenerate) {
    const asset = assetsByView[view];
    const viewPrompt = envelope
      ? buildPhotorealScenarioPrompt({
          weeks,
          envelope,
          sex: opts?.sex,
          hasReferencePhoto: !!(asset?.image_path && fs.existsSync(asset.image_path)),
          interventions: opts?.interventions,
          view,
        })
      : `${prompt} Clinical camera view: ${view}. Preserve the ${view} viewing angle.`;

    try {
      const entry = await generateAndPersistOneView({
        tenantId: req.tenantId!,
        patientId,
        scenarioId,
        view,
        prompt: viewPrompt,
        referencePath: asset?.image_path || null,
        assetId: asset?.id || null,
        morphGuidance: morphGuidanceFromEnvelope(envelope),
      });
      output[view] = entry;
      if (entry.has_image) {
        anyOk = true;
        lastProvider = entry.provider || lastProvider;
      } else if (entry.error) {
        errors.push(`${view}:${entry.error}`);
      }
    } catch (e: any) {
      output[view] = { view, has_image: false, error: e?.message || String(e) };
      errors.push(`${view}:${e?.message || e}`);
    }
  }

  writeOutputViews(scenarioId, output);

  if (anyOk) {
    db.prepare(`
      UPDATE body_scenarios
         SET status = 'completed', provider = COALESCE(?, provider), error = NULL, updated_at = datetime('now')
       WHERE id = ?
    `).run(lastProvider, scenarioId);
  } else {
    db.prepare(`
      UPDATE body_scenarios
         SET status = 'failed', error = ?, updated_at = datetime('now')
       WHERE id = ?
    `).run((errors.join(' | ') || 'generation_failed').slice(0, 500), scenarioId);
  }
}

function enrichFromContext(opts: {
  envelope: ReturnType<typeof computeScenarioEnvelope>;
  medications: any[];
  plans: any[];
  plan_config: PlanConfig;
  assumptions: ScenarioAssumptions;
  sex?: string | null;
}) {
  const medIds = new Set(opts.plan_config.medication_record_ids || opts.medications.map((m) => m.id));
  const nutIds = new Set(opts.plan_config.nutrition_plan_ids || []);
  const exIds = new Set(opts.plan_config.exercise_plan_ids || []);
  const selectedMeds = opts.medications.filter((m) => medIds.has(m.id));
  const nuts = opts.plans.filter((p) => p.plan_type === 'nutrition' && (nutIds.size ? nutIds.has(p.id) : true));
  const exs = opts.plans.filter((p) => p.plan_type === 'exercise' && (exIds.size ? exIds.has(p.id) : true));
  return enrichEnvelopeWithAnatomy({
    envelope: opts.envelope,
    medications: selectedMeds.map((m) => ({
      id: m.id,
      name: m.name,
      visual_profile: m.visual_profile,
      class_tag: m.class_tag,
      dosage: m.dosage,
    })),
    sex: opts.sex,
    hasNutrition: nuts.length > 0 || !!(opts.plan_config.daily_calories || opts.plan_config.deficit_kcal),
    hasExercise: exs.length > 0,
    nutritionAdherence: opts.plan_config.nutrition_adherence,
    exerciseAdherence: opts.plan_config.exercise_adherence,
    medicationAdherence: opts.plan_config.medication_adherence,
    proteinEmphasis: !!opts.plan_config.protein_emphasis,
    resistanceDays: opts.plan_config.resistance_days_per_week,
    cardioDays: opts.plan_config.cardio_days_per_week,
    assumptions: opts.assumptions,
  });
}

/** ANVISA library — mount BEFORE /:patientId */
router.get('/library/medications', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const q = String(req.query.q || req.query.search || '').trim();
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
  const items = q ? searchLibrary(db, q, { limit }) : listLibrary(db, { limit });
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM body_medication_library`).get() as any)?.n || 0;
  res.json({
    notice: 'Registre apenas medicamentos em uso ou prescritos. O aplicativo não recomenda início, troca ou ajuste de dose.',
    items,
    count: items.length,
    total,
  });
});

router.get('/flags', requireRole(...CLINICAL_ROLES), (_req: Request, res: Response) => {
  const flags = {
    gemini_generation: process.env.GEMINI_ENABLED !== '0' && !!process.env.GEMINI_API_KEY
      ? true
      : BODY_FEATURE_FLAGS.gemini_generation,
    patient_scenario_visibility: BODY_FEATURE_FLAGS.patient_scenario_visibility,
    public_export: BODY_FEATURE_FLAGS.public_export,
    provider_model_changes: BODY_FEATURE_FLAGS.provider_model_changes,
    offline_phi_queue: BODY_FEATURE_FLAGS.offline_phi_queue,
    high_contrast_default: BODY_FEATURE_FLAGS.high_contrast_default,
  };
  res.json({ flags, defaults: { ...BODY_FEATURE_FLAGS } });
});

router.get('/settings/integrations', requireRole('admin', 'doctor'), (_req: Request, res: Response) => {
  const status = imageProvidersStatus();
  res.json({
    providers: {
      a2e: { configured: status.a2e, model: status.a2e_model },
      gemini: { configured: status.gemini, model: status.gemini_model },
      bitdeer: {
        configured: status.bitdeer,
        model: status.bitdeer_model,
        note: status.bitdeer
          ? 'active'
          : 'inactive until BITDEER_API_KEY + BITDEER_BASE_URL are set (optional third cloud)',
      },
      local_morph: {
        configured: status.local_morph,
        note: status.local_morph
          ? 'identity-preserving per-view fallback (default ON; set LOCAL_MORPH_FALLBACK=0 to disable)'
          : 'disabled via LOCAL_MORPH_FALLBACK=0',
      },
    },
    order: status.order,
    multi_view: {
      after_images: 'front,left,right,back — each view uses its capture reference',
      a2e_img2img: 'requires public HTTPS asset URL; otherwise gemini/bitdeer/local_morph',
    },
  });
});

router.get('/quality/events', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const rows = db.prepare(`
    SELECT * FROM body_quality_events WHERE tenant_id = ?
    ORDER BY created_at DESC LIMIT 100
  `).all(req.tenantId);
  res.json({ events: rows });
});

router.post('/quality/events', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const parsed = z.object({
    kind: z.string().min(1).max(80),
    title: z.string().min(1).max(200),
    description: z.string().max(4000).optional().nullable(),
    severity: z.enum(['info', 'warning', 'critical']).optional().default('info'),
    related_model: z.string().max(120).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const id = uuid();
  db.prepare(`
    INSERT INTO body_quality_events
      (id, tenant_id, kind, title, description, severity, status, related_model, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    id, req.tenantId, parsed.data.kind, parsed.data.title,
    parsed.data.description ?? null, parsed.data.severity,
    parsed.data.related_model ?? null, req.user!.id,
  );
  const event = db.prepare(`SELECT * FROM body_quality_events WHERE id = ?`).get(id);
  res.status(201).json({ event });
});

router.post('/reports', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const parsed = z.object({
    scenario_id: z.string().min(1),
    signature_name: z.string().min(1).max(200),
    next_follow_up_date: z.string().max(40).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }

  const scenario = db.prepare(`
    SELECT * FROM body_scenarios WHERE id = ? AND tenant_id = ?
  `).get(parsed.data.scenario_id, req.tenantId) as any;
  if (!scenario) { res.status(404).json({ error: 'not_found' }); return; }
  if (scenario.review_status !== 'approved') {
    res.status(400).json({ error: 'review_required', message: 'Scenario must be review_status=approved before report export.' });
    return;
  }

  const patient = patientInTenant(scenario.patient_id, req.tenantId!);
  const plan = scenario.execution_plan ? JSON.parse(scenario.execution_plan) : null;
  let views: Record<string, OutputViewEntry> = {};
  try { views = scenario.output_views ? JSON.parse(scenario.output_views) : {}; } catch { views = {}; }

  const viewBlocks = CAPTURE_VIEWS.map((v) => {
    const entry = views[v];
    let imgTag = '<div class="ph">—</div>';
    if (entry?.path && fs.existsSync(entry.path)) {
      const buf = fs.readFileSync(entry.path);
      const mime = entry.path.endsWith('.png') ? 'image/png' : 'image/jpeg';
      imgTag = `<img src="data:${mime};base64,${buf.toString('base64')}" alt="${v}"/>`;
    } else if (v === 'front' && scenario.image_path && fs.existsSync(scenario.image_path)) {
      const buf = fs.readFileSync(scenario.image_path);
      imgTag = `<img src="data:image/jpeg;base64,${buf.toString('base64')}" alt="front"/>`;
    }
    return `<figure><figcaption>${v}</figcaption>${imgTag}</figure>`;
  }).join('\n');

  const id = uuid();
  const dir = path.join(uploadsRoot(), req.tenantId!, 'body', scenario.patient_id, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, `${id}.html`);
  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/><title>Relatório de cenário — Clínica Tanah</title>
<style>
  body{font-family:Georgia,serif;max-width:880px;margin:2rem auto;padding:0 1rem;color:#1a1a1a;background:#faf8f5}
  h1{font-size:1.4rem;margin-bottom:.25rem} .meta{color:#555;font-size:.9rem}
  .wm{margin-top:1.5rem;padding:.75rem;border:1px solid #c9a227;background:#fff8e7;font-size:.85rem}
  .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:1.25rem 0}
  figure{margin:0} figcaption{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:#555;margin-bottom:.35rem}
  img{width:100%;aspect-ratio:3/4;object-fit:cover;border:1px solid #ddd;background:#efe6d8}
  .ph{width:100%;aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;background:#efe6d8;border:1px solid #ddd;color:#888;font-size:.8rem}
  @media (max-width:720px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body>
  <h1>Relatório ilustrativo de cenário corporal</h1>
  <p class="meta">Paciente: ${patient?.full_name || scenario.patient_id} · Cenário: ${scenario.title || scenario.id}</p>
  <p class="meta">Assinado por: ${parsed.data.signature_name} · Gerado em ${new Date().toISOString()}</p>
  ${parsed.data.next_follow_up_date ? `<p class="meta">Próximo retorno: ${parsed.data.next_follow_up_date}</p>` : ''}
  <p>${(plan?.summary || scenario.goal || '').replace(/</g, '&lt;')}</p>
  <h2 style="font-size:1.05rem;margin-top:1.5rem">Depois (simulação) — 4 vistas</h2>
  <div class="grid">${viewBlocks}</div>
  <p class="wm">${scenario.watermark || SCENARIO_WATERMARK}</p>
  <p class="meta">prompt_version: ${scenario.prompt_version || PROMPT_VERSION}</p>
</body></html>`;
  fs.writeFileSync(htmlPath, html, 'utf8');

  db.prepare(`
    INSERT INTO body_scenario_reports
      (id, tenant_id, patient_id, scenario_id, signature_name, next_follow_up_date, html_path, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)
  `).run(
    id, req.tenantId, scenario.patient_id, scenario.id,
    parsed.data.signature_name, parsed.data.next_follow_up_date ?? null,
    htmlPath, req.user!.id,
  );

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_body_scenario_report', resourceType: 'body_scenario_report', resourceId: id,
    afterValue: { scenario_id: scenario.id },
    legalBasis: 'health_protection_art7_VIII',
  });

  res.status(201).json({
    id,
    html_url: `/api/clinical/body/reports/${id}/html`,
  });
});

router.get('/reports/:reportId/html', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const row = db.prepare(`
    SELECT * FROM body_scenario_reports WHERE id = ? AND tenant_id = ?
  `).get(req.params.reportId, req.tenantId) as any;
  if (!row?.html_path || !fs.existsSync(row.html_path)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=60');
  fs.createReadStream(row.html_path).pipe(res);
});

/** Full clinical dossier HTML (auth-only) */
router.get('/clinical-reports/:reportId/html', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  ensureClinicalReportsTable(db);
  const row = db.prepare(`
    SELECT * FROM body_clinical_reports WHERE id = ? AND tenant_id = ?
  `).get(req.params.reportId, req.tenantId) as any;
  if (!row?.html_path || !fs.existsSync(row.html_path)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'view_clinical_full_report', resourceType: 'body_clinical_report', resourceId: row.id,
    afterValue: { patient_id: row.patient_id },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=60');
  fs.createReadStream(row.html_path).pipe(res);
});

/** Full clinical dossier PDF (auth-only) — patient-facing Documentos artifact */
router.get('/clinical-reports/:reportId/pdf', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  ensureClinicalReportsTable(db);
  const row = db.prepare(`
    SELECT * FROM body_clinical_reports WHERE id = ? AND tenant_id = ?
  `).get(req.params.reportId, req.tenantId) as any;
  if (!row?.pdf_path || !fs.existsSync(row.pdf_path)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'view_clinical_full_report_pdf', resourceType: 'body_clinical_report', resourceId: row.id,
    afterValue: { patient_id: row.patient_id },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(String(row.title || 'relatorio-clinico').replace(/\s+/g, '-') + '.pdf')}"`,
  );
  res.setHeader('Cache-Control', 'private, max-age=60');
  fs.createReadStream(row.pdf_path).pipe(res);
});

router.post('/scenarios/:scenarioId/reviews', requireRole('doctor', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const scenario = db.prepare(`
    SELECT * FROM body_scenarios WHERE id = ? AND tenant_id = ?
  `).get(req.params.scenarioId, req.tenantId) as any;
  if (!scenario) { res.status(404).json({ error: 'not_found' }); return; }

  const reviewable = ['completed', 'ready', 'pending_review'].includes(scenario.status)
    || scenario.review_status === 'pending_review';
  if (!reviewable) {
    res.status(400).json({
      error: 'invalid_status',
      message: 'Review only when status is completed/ready/pending_review',
      status: scenario.status,
    });
    return;
  }

  const checklistSchema = z.object(
    Object.fromEntries(REVIEW_CHECKLIST_KEYS.map((k) => [k, z.boolean()])) as Record<typeof REVIEW_CHECKLIST_KEYS[number], z.ZodBoolean>,
  );
  const parsed = z.object({
    decision: z.enum(['approved', 'rejected']),
    checklist: checklistSchema,
    signature_name: z.string().min(1).max(200),
    comment: z.string().max(2000).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }

  const checklist = parsed.data.checklist as Record<string, boolean>;

  db.prepare(`
    UPDATE body_scenarios SET
      review_status = ?,
      reviewed_at = datetime('now'),
      reviewed_by = ?,
      review_checklist = ?,
      review_signature = ?,
      review_comment = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    parsed.data.decision,
    req.user!.id,
    JSON.stringify(checklist),
    parsed.data.signature_name,
    parsed.data.comment ?? null,
    scenario.id,
  );

  const updated = db.prepare(`SELECT id, status, review_status, reviewed_at, review_signature FROM body_scenarios WHERE id = ?`).get(scenario.id);
  res.json({ scenario: updated });
});

router.post('/capture-sessions/:sessionId/assets/sign', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const session = db.prepare(`
    SELECT * FROM body_capture_sessions WHERE id = ? AND tenant_id = ?
  `).get(req.params.sessionId, req.tenantId) as any;
  if (!session) { res.status(404).json({ error: 'not_found' }); return; }
  if (session.status === 'complete') {
    res.status(409).json({ error: 'session_immutable' }); return;
  }
  const view = String(req.body?.view || 'front') as CaptureView;
  if (!CAPTURE_VIEWS.includes(view)) {
    res.status(400).json({ error: 'invalid_view' });
    return;
  }
  const contentType = String(req.body?.content_type || 'image/jpeg');
  const ttl = Number(req.body?.ttl_sec) || 3600;
  // Pre-upload handshake (BodyPath parity) — token scopes session+view; upload still authenticated.
  const payload = `${session.id}.${view}.${Math.floor(Date.now() / 1000) + ttl}`;
  const sig = createHmac('sha256', assetSigningSecret()).update(payload).digest('hex').slice(0, 32);
  const upload_token = Buffer.from(`${payload}.${sig}`).toString('base64url');
  const expires_at = new Date(Date.now() + ttl * 1000).toISOString();
  res.json({
    upload_token,
    view,
    content_type: contentType,
    expires_at,
    session_id: session.id,
  });
});

function assetSigningSecret(): string {
  return process.env.JWT_SECRET || process.env.A2E_API_KEY || 'clinica-tanah-body-asset-dev';
}

/** Short-lived HMAC token so A2E can fetch a capture without CRM auth. */
export function signBodyAssetToken(assetId: string, ttlSec = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${assetId}.${exp}`;
  const sig = createHmac('sha256', assetSigningSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function publicBodyAssetHandler(req: Request, res: Response): void {
  const token = String(req.params.token || '');
  const parts = token.split('.');
  if (parts.length !== 3) {
    res.status(400).json({ error: 'invalid_token' });
    return;
  }
  const [assetId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!assetId || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    res.status(401).json({ error: 'expired' });
    return;
  }
  const expect = createHmac('sha256', assetSigningSecret()).update(`${assetId}.${expStr}`).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({ error: 'bad_signature' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'bad_signature' });
    return;
  }
  const row = (
    db.prepare(`SELECT * FROM body_capture_assets WHERE id = ? AND deleted_at IS NULL`).get(assetId)
    || db.prepare(`SELECT * FROM body_captures WHERE id = ? AND status != 'retained'`).get(assetId)
  ) as any;
  if (!row?.image_path || !fs.existsSync(row.image_path)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.setHeader('Content-Type', row.content_type || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  fs.createReadStream(row.image_path).pipe(res);
}

function requireClinical(req: Request, res: Response): boolean {
  if (!canViewClinical(req.user?.role)) {
    res.status(403).json({ error: 'clinical_restricted' });
    return false;
  }
  return true;
}

function patientInTenant(patientId: string, tenantId: string) {
  return db.prepare(`SELECT id, full_name, gender, birth_date FROM patients WHERE id = ? AND tenant_id = ?`)
    .get(patientId, tenantId) as any;
}

function consentMap(tenantId: string, patientId: string) {
  const rows = db.prepare(`
    SELECT purpose, granted, granted_at, revoked_at FROM body_consents
    WHERE tenant_id = ? AND patient_id = ?
  `).all(tenantId, patientId) as any[];
  const map: Record<string, { granted: boolean; granted_at: string | null; revoked_at: string | null }> = {};
  for (const p of BODY_PURPOSES) {
    map[p] = { granted: false, granted_at: null, revoked_at: null };
  }
  for (const r of rows) {
    map[r.purpose] = {
      granted: !!r.granted && !r.revoked_at,
      granted_at: r.granted_at || null,
      revoked_at: r.revoked_at || null,
    };
  }
  return map;
}

function simulationsAllowed(consents: ReturnType<typeof consentMap>) {
  return !!(
    consents.clinical_record.granted
    && consents.image_processing.granted
    && consents.generative_ai.granted
  );
}

function serializeSession(session: any, req: Request) {
  if (session.deleted_at) {
    return {
      id: session.id,
      patient_id: session.patient_id,
      status: session.status,
      validated_at: session.validated_at,
      quality_summary: null,
      created_at: session.created_at,
      updated_at: session.updated_at,
      deleted_at: session.deleted_at,
      clinical_retention: true,
      assets: {},
      views_complete: false,
    };
  }
  const assetsRows = db.prepare(`
    SELECT * FROM body_capture_assets
    WHERE session_id = ? AND deleted_at IS NULL
    ORDER BY created_at ASC
  `).all(session.id) as any[];
  const assets: Record<string, any> = {};
  for (const a of assetsRows) {
    assets[a.view] = {
      id: a.id,
      view: a.view,
      content_type: a.content_type,
      width: a.width,
      height: a.height,
      sha256: a.sha256,
      quality: a.quality_json ? JSON.parse(a.quality_json) : null,
      metrics: a.metrics_json ? JSON.parse(a.metrics_json) : null,
      preview_url: `/api/clinical/body/${session.patient_id}/capture-sessions/${session.id}/assets/${a.view}/image`,
      created_at: a.created_at,
    };
  }
  return {
    id: session.id,
    patient_id: session.patient_id,
    status: session.status,
    validated_at: session.validated_at,
    quality_summary: session.quality_summary ? JSON.parse(session.quality_summary) : null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    deleted_at: null,
    assets,
    views_complete: CAPTURE_VIEWS.every((v) => !!assets[v]),
  };
}

function softDeleteCaptureAsset(opts: {
  asset: any;
  tenantId: string;
  actorId: string;
  reason?: string | null;
}) {
  const now = new Date().toISOString();
  const retained = retainBodyPhotoCopy({
    tenantId: opts.tenantId,
    patientId: opts.asset.patient_id,
    assetId: opts.asset.id,
    view: opts.asset.view,
    sourcePath: opts.asset.image_path,
  });
  db.prepare(`
    UPDATE body_capture_assets
       SET deleted_at = ?, deleted_by = ?, delete_reason = ?,
           retained_path = COALESCE(?, retained_path)
     WHERE id = ? AND deleted_at IS NULL
  `).run(
    now,
    opts.actorId,
    opts.reason || 'clinician_removed_from_active_chart',
    retained,
    opts.asset.id,
  );
  // Soft-hide mirrored legacy front capture if same id
  if (opts.asset.view === 'front') {
    db.prepare(`
      UPDATE body_captures
         SET status = 'retained', notes = COALESCE(notes, '') || ' | soft_deleted'
       WHERE id = ? AND tenant_id = ?
    `).run(opts.asset.id, opts.tenantId);
  }
  return { retained_path: retained, deleted_at: now };
}

function latestFrontAsset(tenantId: string, patientId: string) {
  return db.prepare(`
    SELECT a.* FROM body_capture_assets a
    JOIN body_capture_sessions s ON s.id = a.session_id
    WHERE a.tenant_id = ? AND a.patient_id = ? AND a.view = 'front'
      AND a.deleted_at IS NULL AND s.deleted_at IS NULL
    ORDER BY CASE s.status WHEN 'complete' THEN 0 ELSE 1 END, a.created_at DESC
    LIMIT 1
  `).get(tenantId, patientId) as any;
}

/** Create capture session — BodyPath: POST /patients/:id/capture-sessions */
router.post('/:patientId/capture-sessions', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  const consents = consentMap(req.tenantId!, patient.id);
  if (!consents.clinical_record.granted || !consents.image_processing.granted) {
    res.status(403).json({ error: 'consent_required', message: 'image_processing_and_clinical_record_required' });
    return;
  }
  const id = uuid();
  db.prepare(`
    INSERT INTO body_capture_sessions (id, tenant_id, patient_id, status, created_by)
    VALUES (?, ?, ?, 'open', ?)
  `).run(id, req.tenantId, patient.id, req.user!.id);
  const session = db.prepare(`SELECT * FROM body_capture_sessions WHERE id = ?`).get(id);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_body_capture_session', resourceType: 'body_capture_session', resourceId: id,
    afterValue: { patient_id: patient.id },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.status(201).json(serializeSession(session, req));
});

/** Upload one view — BodyPath: POST /capture-sessions/:id/assets */
router.post('/capture-sessions/:sessionId/assets', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const session = db.prepare(`SELECT * FROM body_capture_sessions WHERE id = ? AND tenant_id = ?`)
    .get(req.params.sessionId, req.tenantId) as any;
  if (!session) { res.status(404).json({ error: 'not_found' }); return; }
  if (session.status === 'complete') {
    res.status(409).json({ error: 'session_immutable', message: 'Validated sessions cannot replace originals.' });
    return;
  }

  const parsed = z.object({
    view: z.enum(['front', 'left', 'right', 'back']),
    content_type: z.string().default('image/jpeg'),
    data_base64: z.string().min(32).optional(),
    image_base64: z.string().min(32).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const b64 = (parsed.data.data_base64 || parsed.data.image_base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) { res.status(400).json({ error: 'validation', message: 'data_base64_required' }); return; }

  let buf: Buffer;
  try { buf = Buffer.from(b64, 'base64'); } catch {
    res.status(400).json({ error: 'invalid_image' }); return;
  }
  if (buf.length > 8 * 1024 * 1024) {
    res.status(400).json({ error: 'image_too_large', message: 'max_8mb' });
    return;
  }

  const analyzed = processClinicalPhoto(buf, parsed.data.content_type);
  const assetId = uuid();
  const dir = bodyUploadsDir(req.tenantId!, session.patient_id);
  const imagePath = path.join(dir, `session-${session.id}-${parsed.data.view}-${assetId}.jpg`);
  // Immutable original: never overwrite in place — new asset id path always
  fs.writeFileSync(imagePath, analyzed.buffer);

  db.prepare(`
    INSERT INTO body_capture_assets
      (id, tenant_id, session_id, patient_id, view, image_path, content_type, sha256, width, height, quality_json, metrics_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, view) DO UPDATE SET
      id = excluded.id,
      image_path = excluded.image_path,
      content_type = excluded.content_type,
      sha256 = excluded.sha256,
      width = excluded.width,
      height = excluded.height,
      quality_json = excluded.quality_json,
      metrics_json = excluded.metrics_json,
      created_at = datetime('now'),
      deleted_at = NULL,
      deleted_by = NULL,
      delete_reason = NULL
  `).run(
    assetId, req.tenantId, session.id, session.patient_id, parsed.data.view,
    imagePath, analyzed.contentType, analyzed.sha256, analyzed.width, analyzed.height,
    JSON.stringify(analyzed.quality), JSON.stringify(analyzed.metrics),
  );

  // Also mirror front into legacy body_captures for older scenario wiring
  if (parsed.data.view === 'front') {
    db.prepare(`
      INSERT INTO body_captures
        (id, tenant_id, patient_id, view_angle, status, image_path, content_type, notes, created_by, validated_at)
      VALUES (?, ?, ?, 'front', 'uploaded', ?, ?, ?, ?, NULL)
    `).run(assetId, req.tenantId, session.patient_id, imagePath, analyzed.contentType, `session:${session.id}`, req.user!.id);
  }

  db.prepare(`UPDATE body_capture_sessions SET updated_at = datetime('now') WHERE id = ?`).run(session.id);
  const fresh = db.prepare(`SELECT * FROM body_capture_sessions WHERE id = ?`).get(session.id);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'upload_body_capture_asset', resourceType: 'body_capture_asset', resourceId: assetId,
    afterValue: { session_id: session.id, view: parsed.data.view, sha256: analyzed.sha256, exif_stripped: true },
    legalBasis: 'health_protection_art7_VIII',
  });
  res.status(201).json(serializeSession(fresh, req));
});

/** Validate full set — BodyPath: POST /capture-sessions/:id/validate */
router.post('/capture-sessions/:sessionId/validate', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const session = db.prepare(`SELECT * FROM body_capture_sessions WHERE id = ? AND tenant_id = ?`)
    .get(req.params.sessionId, req.tenantId) as any;
  if (!session) { res.status(404).json({ error: 'not_found' }); return; }

  const assets = db.prepare(`
    SELECT * FROM body_capture_assets WHERE session_id = ? AND deleted_at IS NULL
  `).all(session.id) as any[];
  const missing = CAPTURE_VIEWS.filter((v) => !assets.some((a) => a.view === v));
  if (missing.length) {
    res.status(400).json({ error: 'incomplete_set', missing, message: 'All four views required: front, left, right, back.' });
    return;
  }

  const scored = applySessionConsistency(assets.map((a) => ({
    view: a.view,
    metrics: a.metrics_json ? JSON.parse(a.metrics_json) : {},
    quality: a.quality_json ? JSON.parse(a.quality_json) : {},
  })));
  const upd = db.prepare(`UPDATE body_capture_assets SET quality_json = ? WHERE session_id = ? AND view = ?`);
  for (const s of scored) {
    upd.run(JSON.stringify(s.quality), session.id, s.view);
  }

  const summary = Object.fromEntries(scored.map((s) => [s.view, s.quality]));
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE body_capture_sessions
    SET status = 'complete', validated_at = ?, quality_summary = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(now, JSON.stringify(summary), session.id);

  // Lock front legacy row
  const front = assets.find((a) => a.view === 'front');
  if (front) {
    db.prepare(`UPDATE body_captures SET status = 'validated', validated_at = ? WHERE id = ?`).run(now, front.id);
  }

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'validate_body_capture_session', resourceType: 'body_capture_session', resourceId: session.id,
    afterValue: { views: CAPTURE_VIEWS.length },
    legalBasis: 'health_protection_art7_VIII',
  });

  const fresh = db.prepare(`SELECT * FROM body_capture_sessions WHERE id = ?`).get(session.id);
  res.json(serializeSession(fresh, req));
});

router.get('/:patientId/capture-sessions/:sessionId', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const session = db.prepare(`
    SELECT * FROM body_capture_sessions WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).get(req.params.sessionId, req.params.patientId, req.tenantId) as any;
  if (!session) { res.status(404).json({ error: 'not_found' }); return; }
  res.json(serializeSession(session, req));
});

router.get('/:patientId/capture-sessions/:sessionId/assets/:view/image', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const view = req.params.view as CaptureView;
  if (!CAPTURE_VIEWS.includes(view)) { res.status(400).json({ error: 'invalid_view' }); return; }
  const row = db.prepare(`
    SELECT a.* FROM body_capture_assets a
    JOIN body_capture_sessions s ON s.id = a.session_id
    WHERE a.session_id = ? AND a.patient_id = ? AND a.tenant_id = ? AND a.view = ?
      AND a.deleted_at IS NULL AND s.deleted_at IS NULL
  `).get(req.params.sessionId, req.params.patientId, req.tenantId, view) as any;
  if (!row?.image_path || !fs.existsSync(row.image_path)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.setHeader('Content-Type', row.content_type || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('X-Content-SHA256', row.sha256 || '');
  fs.createReadStream(row.image_path).pipe(res);
});

/** Soft-delete one view — file retained for CFM/LGPD clinical archive. */
router.delete('/capture-sessions/:sessionId/assets/:view', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const view = req.params.view as CaptureView;
  if (!CAPTURE_VIEWS.includes(view)) { res.status(400).json({ error: 'invalid_view' }); return; }
  const session = db.prepare(`SELECT * FROM body_capture_sessions WHERE id = ? AND tenant_id = ?`)
    .get(req.params.sessionId, req.tenantId) as any;
  if (!session || session.deleted_at) { res.status(404).json({ error: 'not_found' }); return; }

  const parsed = z.object({
    reason: z.string().max(500).optional().nullable(),
  }).safeParse(req.body || {});
  const reason = parsed.success ? (parsed.data.reason || null) : null;

  const asset = db.prepare(`
    SELECT * FROM body_capture_assets
    WHERE session_id = ? AND tenant_id = ? AND view = ? AND deleted_at IS NULL
  `).get(session.id, req.tenantId, view) as any;
  if (!asset) { res.status(404).json({ error: 'not_found' }); return; }

  const result = softDeleteCaptureAsset({
    asset,
    tenantId: req.tenantId!,
    actorId: req.user!.id,
    reason,
  });
  db.prepare(`UPDATE body_capture_sessions SET updated_at = datetime('now') WHERE id = ?`).run(session.id);

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'soft_delete_body_capture_asset',
    resourceType: 'body_capture_asset',
    resourceId: asset.id,
    afterValue: {
      session_id: session.id,
      view,
      clinical_retention: true,
      retained_path: result.retained_path,
      original_path_kept: asset.image_path,
      reason: reason || 'clinician_removed_from_active_chart',
    },
    legalBasis: 'health_protection_art7_VIII',
  });

  const fresh = db.prepare(`SELECT * FROM body_capture_sessions WHERE id = ?`).get(session.id);
  res.json({
    ok: true,
    clinical_retention: true,
    view,
    deleted_at: result.deleted_at,
    session: serializeSession(fresh, req),
  });
});

/** Soft-delete entire capture session — all assets retained on disk. */
router.delete('/capture-sessions/:sessionId', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const session = db.prepare(`SELECT * FROM body_capture_sessions WHERE id = ? AND tenant_id = ?`)
    .get(req.params.sessionId, req.tenantId) as any;
  if (!session) { res.status(404).json({ error: 'not_found' }); return; }
  if (session.deleted_at) {
    res.json({ ok: true, clinical_retention: true, status: 'already_deleted' });
    return;
  }

  const parsed = z.object({
    reason: z.string().max(500).optional().nullable(),
  }).safeParse(req.body || {});
  const reason = parsed.success ? (parsed.data.reason || null) : null;
  const now = new Date().toISOString();

  const assets = db.prepare(`
    SELECT * FROM body_capture_assets WHERE session_id = ? AND deleted_at IS NULL
  `).all(session.id) as any[];
  const retained: string[] = [];
  for (const asset of assets) {
    const r = softDeleteCaptureAsset({
      asset,
      tenantId: req.tenantId!,
      actorId: req.user!.id,
      reason: reason || 'session_removed_from_active_chart',
    });
    if (r.retained_path) retained.push(r.retained_path);
  }

  db.prepare(`
    UPDATE body_capture_sessions
       SET deleted_at = ?, deleted_by = ?, delete_reason = ?, updated_at = datetime('now')
     WHERE id = ?
  `).run(now, req.user!.id, reason || 'session_removed_from_active_chart', session.id);

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'soft_delete_body_capture_session',
    resourceType: 'body_capture_session',
    resourceId: session.id,
    afterValue: {
      patient_id: session.patient_id,
      clinical_retention: true,
      assets_retained: assets.length,
      retained_copies: retained.length,
      reason: reason || 'session_removed_from_active_chart',
    },
    legalBasis: 'health_protection_art7_VIII',
  });

  res.json({
    ok: true,
    clinical_retention: true,
    deleted_at: now,
    assets_retained: assets.length,
  });
});

function latestMeasurement(tenantId: string, patientId: string) {
  return db.prepare(`
    SELECT * FROM body_measurements
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY recorded_at DESC LIMIT 1
  `).get(tenantId, patientId) as any;
}

router.get('/:patientId/reports', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  ensureClinicalReportsTable(db);
  const scenarioReports = db.prepare(`
    SELECT id, scenario_id, signature_name, next_follow_up_date, status, created_by, created_at,
           'scenario' AS kind,
           '/api/clinical/body/reports/' || id || '/html' AS html_url
    FROM body_scenario_reports
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.tenantId, patient.id) as any[];
  const clinicalReports = db.prepare(`
    SELECT id, NULL AS scenario_id, signature_name, next_follow_up_date, status, created_by, created_at,
           kind, title,
           '/api/clinical/body/clinical-reports/' || id || '/html' AS html_url,
           CASE WHEN pdf_path IS NOT NULL AND pdf_path != ''
             THEN '/api/clinical/body/clinical-reports/' || id || '/pdf'
             ELSE NULL END AS pdf_url
    FROM body_clinical_reports
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.tenantId, patient.id) as any[];
  const reports = [...clinicalReports, ...scenarioReports]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 80);
  res.json({ reports, clinical_reports: clinicalReports, scenario_reports: scenarioReports });
});

router.get('/:patientId/clinical-reports', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  ensureClinicalReportsTable(db);
  const reports = db.prepare(`
    SELECT id, kind, title, signature_name, next_follow_up_date, status, created_by, created_at,
           '/api/clinical/body/clinical-reports/' || id || '/html' AS html_url,
           CASE WHEN pdf_path IS NOT NULL AND pdf_path != ''
             THEN '/api/clinical/body/clinical-reports/' || id || '/pdf'
             ELSE NULL END AS pdf_url
    FROM body_clinical_reports
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.tenantId, patient.id);
  res.json({ reports });
});

router.post('/:patientId/clinical-reports', requireRole('doctor', 'nurse', 'admin'), async (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = z.object({
    signature_name: z.string().min(1).max(200),
    next_follow_up_date: z.string().max(40).optional().nullable(),
    title: z.string().max(200).optional().nullable(),
    include: z.object({
      demographics: z.boolean().optional(),
      consents: z.boolean().optional(),
      alerts: z.boolean().optional(),
      measurements: z.boolean().optional(),
      medications: z.boolean().optional(),
      lifestyle: z.boolean().optional(),
      captures: z.boolean().optional(),
      scenarios: z.boolean().optional(),
      chart: z.boolean().optional(),
      appointments: z.boolean().optional(),
      images: z.boolean().optional(),
    }).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }

  ensureClinicalReportsTable(db);
  const include = { images: true, ...(parsed.data.include || {}) };
  const payload = collectClinicalReportData({
    db,
    tenantId: req.tenantId!,
    patientId: patient.id,
    signatureName: parsed.data.signature_name,
    nextFollowUpDate: parsed.data.next_follow_up_date,
    include,
    generatedBy: { id: req.user!.id, email: req.user!.email, name: (req.user as any).full_name },
  });
  const html = renderClinicalReportHtml(payload, {
    signatureName: parsed.data.signature_name,
    nextFollowUpDate: parsed.data.next_follow_up_date,
    generatedBy: (req.user as any).full_name || req.user!.email,
  });
  const id = uuid();
  const htmlPath = writeClinicalReportHtml({
    tenantId: req.tenantId!,
    patientId: patient.id,
    reportId: id,
    html,
  });
  const title = parsed.data.title?.trim()
    || `Relatório clínico completo — ${patient.full_name || patient.id}`;

  // Medical-grade PDF for Documentos / patient email
  const bodyRows = collectBodyProntuarioForDossier(db, req.tenantId!, patient.id);
  const latestScenario = db.prepare(`
    SELECT horizon_weeks, weeks, execution_plan FROM body_scenarios
    WHERE tenant_id = ? AND patient_id = ? AND status IN ('completed','ready')
    ORDER BY created_at DESC LIMIT 1
  `).get(req.tenantId, patient.id) as any;
  let doctorLoss: number | null = null;
  let targetWeight: number | null = null;
  let scenarioSummary: string | null = null;
  try {
    const plan = latestScenario?.execution_plan ? JSON.parse(latestScenario.execution_plan) : null;
    doctorLoss = plan?.doctor_predicted_loss_kg ?? null;
    targetWeight = plan?.target_weight_kg ?? plan?.projected?.weight_kg ?? null;
    scenarioSummary = plan?.summary || null;
  } catch { /* */ }

  let pdfPath: string | null = null;
  try {
    const pdfBuf = await buildCompositionDossierPdf({
      clinicName: 'Clínica Tanah',
      patient: {
        id: patient.id,
        full_name: patient.full_name,
        birth_date: patient.birth_date,
        gender: patient.gender,
        phone: patient.phone,
        email: patient.email,
        health_insurance: patient.health_insurance,
      },
      measurement: bodyRows.measurement,
      medications: bodyRows.medications,
      nutritionPlans: bodyRows.nutritionPlans,
      exercisePlans: bodyRows.exercisePlans,
      doctorPredictedLossKg: doctorLoss,
      targetWeightKg: targetWeight,
      scenarioSummary,
      scenarioHorizonWeeks: latestScenario?.horizon_weeks || latestScenario?.weeks || null,
      signatureName: parsed.data.signature_name,
      nextFollowUpDate: parsed.data.next_follow_up_date,
      generatedBy: (req.user as any).full_name || req.user!.email,
      kind: 'clinical_full',
      title,
    });
    pdfPath = writeCompositionDossierPdf({
      tenantId: req.tenantId!,
      patientId: patient.id,
      reportId: id,
      buffer: pdfBuf,
    });
  } catch { /* PDF optional — HTML still saved */ }

  db.prepare(`
    INSERT INTO body_clinical_reports
      (id, tenant_id, patient_id, kind, title, signature_name, next_follow_up_date, include_json, html_path, pdf_path, status, created_by)
    VALUES (?, ?, ?, 'clinical_full', ?, ?, ?, ?, ?, ?, 'ready', ?)
  `).run(
    id, req.tenantId, patient.id, title,
    parsed.data.signature_name, parsed.data.next_follow_up_date ?? null,
    JSON.stringify(include), htmlPath, pdfPath, req.user!.id,
  );

  let documentId: string | null = null;
  try {
    const primaryPath = pdfPath || htmlPath;
    const isPdf = !!pdfPath;
    let sizeBytes: number | null = null;
    try { sizeBytes = fs.statSync(primaryPath).size; } catch { /* */ }
    documentId = upsertPatientDocumentPointer(db, {
      tenantId: req.tenantId!,
      patientId: patient.id,
      title,
      docType: 'clinical_report',
      status: 'active',
      source: 'body_clinical_report',
      sourceId: id,
      notes: `Assinado: ${parsed.data.signature_name}${parsed.data.next_follow_up_date ? ` · Retorno: ${parsed.data.next_follow_up_date}` : ''}${isPdf ? ' · PDF' : ''}`,
      createdBy: req.user!.id,
      mimeType: isPdf ? 'application/pdf' : 'text/html',
      originalName: isPdf ? `${id}.pdf` : `${id}.html`,
      storagePath: primaryPath,
      sizeBytes,
      fileUrl: isPdf
        ? `/api/clinical/body/clinical-reports/${id}/pdf`
        : `/api/clinical/body/clinical-reports/${id}/html`,
    });
    db.prepare(`
      INSERT INTO patient_timeline_events
        (id, tenant_id, patient_id, kind, title, subtitle, status, meta, occurred_at)
      VALUES (?, ?, ?, 'document', 'document_clinical_report', ?, 'active', ?, datetime('now'))
    `).run(
      `pte_crep_${Date.now().toString(36)}`,
      req.tenantId,
      patient.id,
      title,
      JSON.stringify({
        report_id: id,
        document_id: documentId,
        signature_name: parsed.data.signature_name,
        images: payload.image_policy,
        format: isPdf ? 'pdf' : 'html',
      }),
    );
  } catch { /* vault/timeline optional — report HTML still saved */ }

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'create_clinical_full_report', resourceType: 'body_clinical_report', resourceId: id,
    afterValue: {
      patient_id: patient.id,
      sections: Object.keys(include).length ? include : 'all',
      document_id: documentId,
      images: payload.image_policy,
      pdf: !!pdfPath,
    },
    legalBasis: 'health_protection_art7_VIII',
  });

  res.status(201).json({
    id,
    kind: 'clinical_full',
    title,
    html_url: `/api/clinical/body/clinical-reports/${id}/html`,
    pdf_url: pdfPath ? `/api/clinical/body/clinical-reports/${id}/pdf` : null,
    document_id: documentId,
    vault: 'patient_documents',
    counts: payload.counts,
    image_policy: payload.image_policy,
  });
});

/** GET /api/clinical/body/:patientId — full body prontuário summary */
router.get('/:patientId', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }

  const measurementsRaw = db.prepare(`
    SELECT * FROM body_measurements WHERE tenant_id = ? AND patient_id = ?
    ORDER BY recorded_at DESC LIMIT 50
  `).all(req.tenantId, patient.id) as any[];
  const measurements = measurementsRaw.map(flattenMeasurement);
  const latest = measurements[0] || null;
  const medications = db.prepare(`
    SELECT * FROM body_medications WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 100
  `).all(req.tenantId, patient.id) as any[];
  const plans = db.prepare(`
    SELECT * FROM body_lifestyle_plans WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.tenantId, patient.id).map(hydrateLifestylePlan) as any[];
  const captures = db.prepare(`
    SELECT id, view_angle, status, content_type, notes, validated_at, created_at,
           CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END AS has_image
    FROM body_captures WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.tenantId, patient.id) as any[];
  const sessions = db.prepare(`
    SELECT * FROM body_capture_sessions
    WHERE tenant_id = ? AND patient_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC LIMIT 20
  `).all(req.tenantId, patient.id) as any[];
  const capture_sessions = sessions.map((s) => serializeSession(s, req));
  // Prefer richest non-empty active session for clinical UI
  const active_capture_session = (() => {
    const ranked = [...capture_sessions]
      .filter((s: any) => !s.deleted_at && Object.keys(s.assets || {}).length > 0)
      .sort((a: any, b: any) => {
        const ac = Object.keys(a.assets || {}).length;
        const bc = Object.keys(b.assets || {}).length;
        if (bc !== ac) return bc - ac;
        const at = Date.parse(a.updated_at || a.created_at || 0);
        const bt = Date.parse(b.updated_at || b.created_at || 0);
        return bt - at;
      });
    return ranked[0] || capture_sessions.find((s: any) => !s.deleted_at) || null;
  })();
  const scenarios = db.prepare(`
    SELECT id, capture_id, capture_session_id, title, goal, weeks, horizon_weeks, status, provider, image_url,
           CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END AS has_image,
           error, review_status, execution_plan, plan_config, assumptions, created_at, updated_at,
           prompt_version, watermark, output_views, reviewed_at, review_signature
    FROM body_scenarios WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.tenantId, patient.id) as any[];
  const consents = consentMap(req.tenantId!, patient.id);
  const bmi = latest?.bmi ?? calcBmi(latest?.height_cm, latest?.weight_kg);

  const parsedScenarios = scenarios.map((s) => {
    const output_views = publicOutputViews(s.output_views);
    return {
      ...s,
      execution_plan: s.execution_plan ? JSON.parse(s.execution_plan) : null,
      plan_config: s.plan_config ? JSON.parse(s.plan_config) : null,
      assumptions: s.assumptions ? JSON.parse(s.assumptions) : null,
      output_views,
      output_view_count: output_views
        ? Object.values(output_views).filter((v) => v.has_image).length
        : (s.has_image ? 1 : 0),
    };
  });
  const latestPlan = parsedScenarios.find((s) => s.execution_plan)?.execution_plan || null;

  const includeLibrary = String(req.query.include_library || '') === '1'
    || String(req.query.library || '') === '1';

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'view_body_prontuario_phi', resourceType: 'patient', resourceId: patient.id,
    legalBasis: 'health_protection_art7_VIII',
  });

  res.json({
    patient: {
      id: patient.id,
      full_name: patient.full_name,
      gender: patient.gender,
      birth_date: patient.birth_date,
    },
    purpose: 'care_record_scenario_visualization',
    clinical_summary: {
      height_cm: latest?.height_cm ?? null,
      weight_kg: latest?.weight_kg ?? null,
      waist_cm: latest?.waist_cm ?? null,
      body_fat_pct: latest?.body_fat_pct ?? null,
      bmi,
      whr: latest?.whr ?? null,
      whtr: latest?.whtr ?? null,
    },
    latest_measurement: latest,
    measurements,
    medications,
    plans,
    captures,
    capture_sessions,
    active_capture_session,
    scenarios: parsedScenarios,
    anatomical: latestPlan ? {
      anatomicalEnvelope: latestPlan.anatomicalEnvelope || null,
      visualProfiles: latestPlan.visualProfiles || null,
      narrativePt: latestPlan.narrativePt || null,
      prompt_version: latestPlan.prompt_version || null,
      watermark: latestPlan.watermark || null,
    } : null,
    ...(includeLibrary ? { medication_library: listLibrary(db, { limit: 100 }) } : {}),
    consents,
    simulations_allowed: simulationsAllowed(consents),
    counts: {
      medications: medications.length,
      plans: plans.length,
      captures: captures.length,
      capture_sessions: capture_sessions.length,
      scenarios: scenarios.length,
    },
    image_providers: imageProvidersStatus(),
  });
});

router.post('/:patientId/measurements', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = measurementBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const payload = {
    neck_cm: d.neck_cm ?? null,
    shoulders_cm: d.shoulders_cm ?? null,
    chest_cm: d.chest_cm ?? null,
    waist_cm: d.waist_cm ?? null,
    abdomen_cm: d.abdomen_cm ?? null,
    hip_cm: d.hip_cm ?? null,
    arm_right_cm: d.arm_right_cm ?? null,
    arm_left_cm: d.arm_left_cm ?? null,
    forearm_right_cm: d.forearm_right_cm ?? null,
    forearm_left_cm: d.forearm_left_cm ?? null,
    wrist_cm: d.wrist_cm ?? null,
    thigh_right_cm: d.thigh_right_cm ?? null,
    thigh_left_cm: d.thigh_left_cm ?? null,
    calf_right_cm: d.calf_right_cm ?? null,
    calf_left_cm: d.calf_left_cm ?? null,
    ankle_cm: d.ankle_cm ?? null,
    body_fat_pct: d.body_fat_pct ?? null,
    muscle_mass_kg: d.muscle_mass_kg ?? null,
    bone_mass_kg: d.bone_mass_kg ?? null,
    visceral_fat_level: d.visceral_fat_level ?? null,
    body_water_pct: d.body_water_pct ?? null,
    systolic_mmhg: d.systolic_mmhg ?? null,
    diastolic_mmhg: d.diastolic_mmhg ?? null,
    heart_rate_bpm: d.heart_rate_bpm ?? null,
    spo2_pct: d.spo2_pct ?? null,
    temperature_c: d.temperature_c ?? null,
    device_label: d.device_label ?? null,
    clothing_note: d.clothing_note ?? null,
    posture_note: d.posture_note ?? null,
    fasting_state: d.fasting_state ?? 'unknown',
  };
  const bmi = calcBmi(d.height_cm, d.weight_kg);
  const whr = d.waist_cm && d.hip_cm ? Math.round((d.waist_cm / d.hip_cm) * 100) / 100 : null;
  const whtr = d.waist_cm && d.height_cm ? Math.round((d.waist_cm / d.height_cm) * 100) / 100 : null;
  const id = uuid();
  db.prepare(`
    INSERT INTO body_measurements
      (id, tenant_id, patient_id, height_cm, weight_kg, waist_cm, notes, recorded_at, recorded_by,
       payload, bmi, whr, whtr, device_label, fasting_state, clothing_note, posture_note, verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.tenantId, patient.id,
    d.height_cm, d.weight_kg, d.waist_cm ?? null,
    d.notes ? seal(d.notes) : null,
    d.measured_at || d.recorded_at || new Date().toISOString(),
    req.user!.id,
    JSON.stringify(payload), bmi, whr, whtr,
    d.device_label ?? null, d.fasting_state ?? 'unknown',
    d.clothing_note ?? null, d.posture_note ?? null,
    d.verified === false ? 0 : 1,
  );
  const row = db.prepare(`SELECT * FROM body_measurements WHERE id = ?`).get(id);
  res.status(201).json({ measurement: flattenMeasurement(row) });
});

router.post('/:patientId/medications', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = z.object({
    name: z.string().min(1).max(200).optional(),
    dosage: z.string().max(200).optional().nullable(),
    frequency: z.string().max(200).optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    started_at: z.string().optional().nullable(),
    class_tag: z.string().max(80).optional().nullable(),
    confirmation: z.string().max(80).optional().nullable(),
    library_id: z.string().max(80).optional().nullable(),
    visual_profile: z.string().max(80).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  let name = d.name || '';
  let visual_profile = d.visual_profile ?? null;
  let library_id = d.library_id ?? null;
  let class_tag = d.class_tag ?? null;
  if (library_id) {
    const lib = getLibraryMedById(db, library_id);
    if (!lib) { res.status(400).json({ error: 'library_id_not_found' }); return; }
    name = name || lib.brand_name || lib.active_ingredient || library_id;
    visual_profile = visual_profile || lib.visual_profile;
    if (!class_tag && lib.visual_profile) class_tag = lib.visual_profile;
  }
  if (!name) { res.status(400).json({ error: 'validation', message: 'name_or_library_id_required' }); return; }
  const id = uuid();
  db.prepare(`
    INSERT INTO body_medications
      (id, tenant_id, patient_id, name, dosage, frequency, notes, started_at, class_tag, confirmation, library_id, visual_profile)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.tenantId, patient.id, name, d.dosage ?? null, d.frequency ?? null, d.notes ?? null,
    d.started_at ?? null, class_tag, d.confirmation ?? 'clinician_confirmed',
    library_id, visual_profile,
  );
  const row = db.prepare(`SELECT * FROM body_medications WHERE id = ?`).get(id);
  res.status(201).json({ medication: row });
});

router.delete('/:patientId/medications/:medId', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  // Soft-discontinue — retain medication history (clinical retention)
  const r = db.prepare(`
    UPDATE body_medications
       SET status = 'discontinued', updated_at = datetime('now')
     WHERE id = ? AND patient_id = ? AND tenant_id = ? AND status != 'discontinued'
  `).run(req.params.medId, req.params.patientId, req.tenantId);
  if (!r.changes) {
    const exists = db.prepare(`
      SELECT id, status FROM body_medications WHERE id = ? AND patient_id = ? AND tenant_id = ?
    `).get(req.params.medId, req.params.patientId, req.tenantId) as any;
    if (!exists) { res.status(404).json({ error: 'not_found' }); return; }
    res.json({ ok: true, status: exists.status, clinical_retention: true });
    return;
  }
  res.json({ ok: true, status: 'discontinued', clinical_retention: true });
});

router.post('/:patientId/plans', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(4000).optional().nullable(),
    summary: z.string().max(4000).optional().nullable(),
    weeks: z.number().int().positive().max(104).optional().nullable(),
    plan_type: z.enum(['nutrition', 'exercise']).default('nutrition'),
    daily_calories: z.number().min(800).max(6000).optional().nullable(),
    deficit_kcal: z.number().min(0).max(1500).optional().nullable(),
    protein_g: z.number().min(0).max(400).optional().nullable(),
    params: z.record(z.any()).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const id = uuid();
  const d = parsed.data;
  const params = {
    ...(d.params || {}),
    daily_calories: d.daily_calories ?? d.params?.daily_calories ?? null,
    deficit_kcal: d.deficit_kcal ?? d.params?.deficit_kcal ?? null,
    protein_g: d.protein_g ?? d.params?.protein_g ?? null,
  };
  db.prepare(`
    INSERT INTO body_lifestyle_plans (id, tenant_id, patient_id, title, description, weeks, plan_type, summary, params_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.tenantId, patient.id, d.title, d.description ?? d.summary ?? null,
    d.weeks ?? null, d.plan_type, d.summary ?? d.description ?? null,
    JSON.stringify(params),
  );
  res.status(201).json({ plan: hydrateLifestylePlan(db.prepare(`SELECT * FROM body_lifestyle_plans WHERE id = ?`).get(id)) });
});

/** Preview if/then envelope without generating images */
router.post('/:patientId/scenarios/preview', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  const latest = flattenMeasurement(latestMeasurement(req.tenantId!, patient.id));
  const medications = db.prepare(`SELECT id, name, class_tag, dosage, visual_profile, library_id FROM body_medications WHERE tenant_id = ? AND patient_id = ? AND status = 'active'`)
    .all(req.tenantId, patient.id) as any[];
  const plans = db.prepare(`SELECT * FROM body_lifestyle_plans WHERE tenant_id = ? AND patient_id = ? AND status = 'active'`)
    .all(req.tenantId, patient.id).map(hydrateLifestylePlan) as any[];
  const horizon = Number(req.body?.horizon_weeks) || 12;
  const plan_config = (req.body?.plan_config || {}) as PlanConfig;
  if (!plan_config.medication_record_ids?.length && !plan_config.nutrition_plan_ids?.length && !plan_config.exercise_plan_ids?.length) {
    plan_config.medication_record_ids = medications.map((m) => m.id);
    plan_config.nutrition_plan_ids = plans.filter((p) => p.plan_type === 'nutrition').map((p) => p.id);
    plan_config.exercise_plan_ids = plans.filter((p) => p.plan_type === 'exercise').map((p) => p.id);
  }
  const assumptions: ScenarioAssumptions = {
    sleep_adequate: !!req.body?.sleep_adequate,
    hydration_adequate: !!req.body?.hydration_adequate,
    recovery_adequate: !!req.body?.recovery_adequate,
    comorbidity_stable: req.body?.comorbidity_stable !== false,
    change_magnitude: req.body?.change_magnitude === 'moderate' ? 'moderate' : 'conservative',
    ...(req.body?.assumptions || {}),
  };
  const doctor_predicted_loss_kg = req.body?.doctor_predicted_loss_kg != null
    ? Number(req.body.doctor_predicted_loss_kg)
    : (req.body?.predicted_loss_kg != null ? Number(req.body.predicted_loss_kg) : null);
  const target_weight_kg = req.body?.target_weight_kg != null ? Number(req.body.target_weight_kg) : null;
  const basePlan = computeScenarioEnvelope({
    horizon_weeks: horizon,
    sex: patient.gender,
    age_years: ageFromBirthDate(patient.birth_date),
    baseline: {
      height_cm: latest?.height_cm,
      weight_kg: latest?.weight_kg,
      waist_cm: latest?.waist_cm,
      body_fat_pct: latest?.body_fat_pct,
      muscle_mass_kg: latest?.muscle_mass_kg,
      bmi: latest?.bmi,
    },
    medications,
    nutritionPlans: plans.filter((p) => p.plan_type === 'nutrition'),
    exercisePlans: plans.filter((p) => p.plan_type === 'exercise'),
    plan_config,
    assumptions,
    doctor_predicted_loss_kg: Number.isFinite(doctor_predicted_loss_kg as number) ? doctor_predicted_loss_kg : null,
    target_weight_kg: Number.isFinite(target_weight_kg as number) ? target_weight_kg : null,
  });
  const execution_plan = enrichFromContext({
    envelope: basePlan,
    medications,
    plans,
    plan_config,
    assumptions,
    sex: patient.gender,
  });
  res.json({ execution_plan });
});

router.post('/:patientId/consents', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = z.object({
    purposes: z.array(z.enum(BODY_PURPOSES)).min(1),
    notice_version: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const now = new Date().toISOString();
  const notice = parsed.data.notice_version || 'body.consent.pt-BR.v1';
  const upsert = db.prepare(`
    INSERT INTO body_consents (id, tenant_id, patient_id, purpose, granted, granted_at, revoked_at, notice_version)
    VALUES (?, ?, ?, ?, 1, ?, NULL, ?)
    ON CONFLICT(tenant_id, patient_id, purpose) DO UPDATE SET
      granted = 1, granted_at = excluded.granted_at, revoked_at = NULL, notice_version = excluded.notice_version
  `);
  for (const purpose of parsed.data.purposes) {
    upsert.run(uuid(), req.tenantId, patient.id, purpose, now, notice);
  }
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'grant_body_consents', resourceType: 'patient', resourceId: patient.id,
    afterValue: { purposes: parsed.data.purposes },
    legalBasis: 'consent_art7_I',
  });
  res.json({ consents: consentMap(req.tenantId!, patient.id), simulations_allowed: simulationsAllowed(consentMap(req.tenantId!, patient.id)) });
});

router.post('/:patientId/consents/revoke', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = z.object({
    purposes: z.array(z.enum(BODY_PURPOSES)).min(1),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const now = new Date().toISOString();
  const optional = new Set(['generative_ai', 'cross_border_transfer', 'research', 'marketing']);
  for (const purpose of parsed.data.purposes) {
    if (!optional.has(purpose) && purpose !== 'image_processing') continue;
    db.prepare(`
      UPDATE body_consents SET granted = 0, revoked_at = ?
      WHERE tenant_id = ? AND patient_id = ? AND purpose = ?
    `).run(now, req.tenantId, patient.id, purpose);
  }
  const consents = consentMap(req.tenantId!, patient.id);
  res.json({ consents, simulations_allowed: simulationsAllowed(consents) });
});

router.post('/:patientId/captures', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = z.object({
    view_angle: z.enum(['front', 'side', 'back', 'other']).default('front'),
    content_type: z.string().default('image/jpeg'),
    image_base64: z.string().min(32),
    notes: z.string().max(1000).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }

  const consents = consentMap(req.tenantId!, patient.id);
  if (!consents.clinical_record.granted || !consents.image_processing.granted) {
    res.status(403).json({ error: 'consent_required', message: 'image_processing_and_clinical_record_required' });
    return;
  }

  const id = uuid();
  const raw = parsed.data.image_base64.replace(/^data:[^;]+;base64,/, '');
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    res.status(400).json({ error: 'invalid_image' });
    return;
  }
  if (buf.length > 12 * 1024 * 1024) {
    res.status(400).json({ error: 'image_too_large' });
    return;
  }
  const ext = parsed.data.content_type.includes('png') ? 'png' : 'jpg';
  const dir = bodyUploadsDir(req.tenantId!, patient.id);
  const imagePath = path.join(dir, `${id}.${ext}`);
  fs.writeFileSync(imagePath, buf);

  db.prepare(`
    INSERT INTO body_captures
      (id, tenant_id, patient_id, view_angle, status, image_path, content_type, notes, created_by, validated_at)
    VALUES (?, ?, ?, ?, 'validated', ?, ?, ?, ?, datetime('now'))
  `).run(
    id, req.tenantId, patient.id, parsed.data.view_angle,
    imagePath, parsed.data.content_type, parsed.data.notes ?? null, req.user!.id,
  );

  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'upload_body_capture', resourceType: 'body_capture', resourceId: id,
    afterValue: { patient_id: patient.id, view_angle: parsed.data.view_angle, bytes: buf.length },
    legalBasis: 'health_protection_art7_VIII',
  });

  res.status(201).json({
    capture: {
      id,
      view_angle: parsed.data.view_angle,
      status: 'validated',
      has_image: true,
      created_at: new Date().toISOString(),
    },
  });
});

router.get('/:patientId/captures/:captureId/image', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const row = db.prepare(`
    SELECT * FROM body_captures WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).get(req.params.captureId, req.params.patientId, req.tenantId) as any;
  if (!row?.image_path || !fs.existsSync(row.image_path)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.setHeader('Content-Type', row.content_type || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=60');
  fs.createReadStream(row.image_path).pipe(res);
});

router.post('/:patientId/scenarios', requireRole('doctor', 'nurse', 'admin'), async (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }

  const consents = consentMap(req.tenantId!, patient.id);
  if (!simulationsAllowed(consents)) {
    res.status(403).json({
      error: 'simulations_blocked',
      message: 'New simulations were blocked. Grant clinical record, image processing, and generative AI consents.',
      consents,
    });
    return;
  }

  const parsed = z.object({
    title: z.string().min(1).max(200).optional().default('Cenário ilustrativo'),
    goal: z.string().max(500).optional().nullable(),
    weeks: z.number().int().positive().max(260).optional().nullable(),
    horizon_weeks: z.number().int().positive().max(260).optional().nullable(),
    capture_id: z.string().optional().nullable(),
    capture_session_id: z.string().optional().nullable(),
    photorealism: z.boolean().optional().default(true),
    generate: z.boolean().optional().default(true),
    plan_config: z.record(z.any()).optional().nullable(),
    assumptions: z.record(z.any()).optional().nullable(),
    sleep_adequate: z.boolean().optional(),
    hydration_adequate: z.boolean().optional(),
    recovery_adequate: z.boolean().optional(),
    comorbidity_stable: z.boolean().optional(),
    change_magnitude: z.enum(['conservative', 'moderate']).optional(),
    /** Clinician-owned predicted loss in kg (positive = loss). Primary driver for morph. */
    doctor_predicted_loss_kg: z.number().positive().max(200).optional().nullable(),
    predicted_loss_kg: z.number().positive().max(200).optional().nullable(),
    /** Absolute target weight in kg. */
    target_weight_kg: z.number().positive().max(400).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }

  if (parsed.data.generate && !requireStepUp(req, res)) return;

  const weeks = parsed.data.horizon_weeks || parsed.data.weeks || 12;
  const latestFlat = flattenMeasurement(latestMeasurement(req.tenantId!, patient.id));
  const medications = db.prepare(`SELECT id, name, class_tag, dosage, visual_profile, library_id FROM body_medications WHERE tenant_id = ? AND patient_id = ? AND status = 'active'`)
    .all(req.tenantId, patient.id) as any[];
  const plans = db.prepare(`SELECT * FROM body_lifestyle_plans WHERE tenant_id = ? AND patient_id = ? AND status = 'active'`)
    .all(req.tenantId, patient.id).map(hydrateLifestylePlan) as any[];

  const plan_config = (parsed.data.plan_config || {}) as PlanConfig;
  // Auto-select all active interventions if none chosen
  if (!plan_config.medication_record_ids?.length && !plan_config.nutrition_plan_ids?.length && !plan_config.exercise_plan_ids?.length) {
    plan_config.medication_record_ids = medications.map((m) => m.id);
    plan_config.nutrition_plan_ids = plans.filter((p) => p.plan_type === 'nutrition').map((p) => p.id);
    plan_config.exercise_plan_ids = plans.filter((p) => p.plan_type === 'exercise').map((p) => p.id);
  }
  const assumptions: ScenarioAssumptions = {
    sleep_adequate: parsed.data.sleep_adequate ?? parsed.data.assumptions?.sleep_adequate ?? true,
    hydration_adequate: parsed.data.hydration_adequate ?? parsed.data.assumptions?.hydration_adequate ?? true,
    recovery_adequate: parsed.data.recovery_adequate ?? parsed.data.assumptions?.recovery_adequate ?? true,
    comorbidity_stable: parsed.data.comorbidity_stable ?? parsed.data.assumptions?.comorbidity_stable ?? true,
    change_magnitude: parsed.data.change_magnitude
      || parsed.data.assumptions?.change_magnitude
      || 'conservative',
  };

  const doctorLoss = parsed.data.doctor_predicted_loss_kg ?? parsed.data.predicted_loss_kg ?? null;
  const targetWeight = parsed.data.target_weight_kg ?? null;

  const basePlan = computeScenarioEnvelope({
    horizon_weeks: weeks,
    sex: patient.gender,
    age_years: ageFromBirthDate(patient.birth_date),
    baseline: {
      height_cm: latestFlat?.height_cm,
      weight_kg: latestFlat?.weight_kg,
      waist_cm: latestFlat?.waist_cm,
      body_fat_pct: latestFlat?.body_fat_pct,
      muscle_mass_kg: latestFlat?.muscle_mass_kg,
      bmi: latestFlat?.bmi,
    },
    medications,
    nutritionPlans: plans.filter((p) => p.plan_type === 'nutrition'),
    exercisePlans: plans.filter((p) => p.plan_type === 'exercise'),
    plan_config,
    assumptions,
    doctor_predicted_loss_kg: doctorLoss,
    target_weight_kg: targetWeight,
  });
  const execution_plan = enrichFromContext({
    envelope: basePlan,
    medications,
    plans,
    plan_config,
    assumptions,
    sex: patient.gender,
  });

  let capture: any = null;
  let captureSessionId = parsed.data.capture_session_id || null;
  if (parsed.data.capture_id) {
    capture = db.prepare(`
      SELECT * FROM body_capture_assets WHERE id = ? AND patient_id = ? AND tenant_id = ?
    `).get(parsed.data.capture_id, patient.id, req.tenantId)
      || db.prepare(`
        SELECT * FROM body_captures WHERE id = ? AND patient_id = ? AND tenant_id = ?
      `).get(parsed.data.capture_id, patient.id, req.tenantId);
  } else if (captureSessionId) {
    capture = db.prepare(`
      SELECT * FROM body_capture_assets WHERE session_id = ? AND view = 'front' AND tenant_id = ?
    `).get(captureSessionId, req.tenantId);
  } else {
    const sess = db.prepare(`
      SELECT * FROM body_capture_sessions WHERE patient_id = ? AND tenant_id = ?
      ORDER BY CASE status WHEN 'complete' THEN 0 ELSE 1 END, created_at DESC LIMIT 1
    `).get(patient.id, req.tenantId) as any;
    captureSessionId = sess?.id || null;
    capture = latestFrontAsset(req.tenantId!, patient.id)
      || db.prepare(`
        SELECT * FROM body_captures WHERE patient_id = ? AND tenant_id = ? AND image_path IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(patient.id, req.tenantId);
  }

  const interventions = [
    ...medications.filter((m) => (plan_config.medication_record_ids || []).includes(m.id)).map((m) => m.name),
    ...plans.filter((p) => [...(plan_config.nutrition_plan_ids || []), ...(plan_config.exercise_plan_ids || [])].includes(p.id)).map((p) => p.title),
  ];

  const prompt = buildPhotorealScenarioPrompt({
    weeks,
    envelope: execution_plan,
    sex: patient.gender,
    hasReferencePhoto: !!(capture?.image_path && fs.existsSync(capture.image_path)),
    interventions,
  });

  const id = uuid();
  const snapshot = JSON.stringify({
    height_cm: latestFlat?.height_cm ?? null,
    weight_kg: latestFlat?.weight_kg ?? null,
    waist_cm: latestFlat?.waist_cm ?? null,
    body_fat_pct: latestFlat?.body_fat_pct ?? null,
    bmi: latestFlat?.bmi ?? null,
    whr: latestFlat?.whr ?? null,
    whtr: latestFlat?.whtr ?? null,
  });

  db.prepare(`
    INSERT INTO body_scenarios
      (id, tenant_id, patient_id, capture_id, capture_session_id, title, goal, weeks, horizon_weeks, prompt, status,
       measurement_snapshot, created_by, plan_config, assumptions, execution_plan, photorealism, review_status,
       prompt_version, watermark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?)
  `).run(
    id, req.tenantId, patient.id, capture?.id ?? null, captureSessionId,
    parsed.data.title, parsed.data.goal ?? execution_plan.summary, weeks, weeks,
    seal(prompt), snapshot, req.user!.id,
    JSON.stringify(plan_config), JSON.stringify(assumptions), JSON.stringify(execution_plan),
    parsed.data.photorealism === false ? 0 : 1,
    execution_plan.prompt_version || PROMPT_VERSION,
    execution_plan.watermark || SCENARIO_WATERMARK,
  );

  if (!parsed.data.generate) {
    res.status(201).json({
      id,
      scenario: { id, title: parsed.data.title, status: 'draft', created_at: new Date().toISOString() },
      execution_plan,
    });
    return;
  }

  if (!execution_plan.ok) {
    db.prepare(`UPDATE body_scenarios SET status = 'blocked', error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(execution_plan.blockers.join(' ').slice(0, 500), id);
    res.status(400).json({ error: 'envelope_blocked', execution_plan, id });
    return;
  }

  try {
    // Mark pending and return immediately — DO App Platform gateway ~100s;
    // generative + architecture-lock for 4 views routinely exceeds that.
    db.prepare(`UPDATE body_scenarios SET status = 'pending', updated_at = datetime('now') WHERE id = ?`).run(id);
    const bgReq = { tenantId: req.tenantId } as Request;
    const genOpts = {
      captureSessionId,
      envelope: execution_plan,
      sex: patient.gender,
      interventions,
      weeks,
    };
    setImmediate(() => {
      runGenerate(bgReq, id, patient.id, capture, prompt, genOpts).catch((e: any) => {
        try {
          db.prepare(`UPDATE body_scenarios SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(String(e?.message || e).slice(0, 500), id);
        } catch { /* */ }
        console.error('[body_scenario_generate]', id, e?.message || e);
      });
    });
  } catch (e: any) {
    db.prepare(`UPDATE body_scenarios SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(String(e?.message || e).slice(0, 500), id);
  }

  const scenario = loadScenarioForApi(id);

  // Persist medical PDF note (meds / diet / measures + clinician Δkg) into Documentos
  let compositionNoteDocumentId: string | null = null;
  try {
    if (execution_plan?.doctor_override || doctorLoss || targetWeight) {
      const bodyRows = collectBodyProntuarioForDossier(db, req.tenantId!, patient.id);
      const noteTitle = `Nota de composição corporal — ${patient.full_name || patient.id}`;
      const pdfBuf = await buildCompositionDossierPdf({
        clinicName: 'Clínica Tanah',
        patient: {
          id: patient.id,
          full_name: patient.full_name,
          birth_date: patient.birth_date,
          gender: patient.gender,
          phone: patient.phone,
          email: patient.email,
          health_insurance: patient.health_insurance,
        },
        measurement: bodyRows.measurement,
        medications: bodyRows.medications,
        nutritionPlans: bodyRows.nutritionPlans,
        exercisePlans: bodyRows.exercisePlans,
        doctorPredictedLossKg: execution_plan?.doctor_predicted_loss_kg ?? doctorLoss,
        targetWeightKg: execution_plan?.target_weight_kg ?? targetWeight,
        scenarioSummary: execution_plan?.summary || null,
        scenarioHorizonWeeks: weeks,
        signatureName: (req.user as any).full_name || req.user!.email,
        generatedBy: (req.user as any).full_name || req.user!.email,
        kind: 'composition_note',
        title: noteTitle,
      });
      const noteId = `note_${id}`;
      const pdfPath = writeCompositionDossierPdf({
        tenantId: req.tenantId!,
        patientId: patient.id,
        reportId: noteId,
        buffer: pdfBuf,
      });
      compositionNoteDocumentId = upsertPatientDocumentPointer(db, {
        tenantId: req.tenantId!,
        patientId: patient.id,
        title: noteTitle,
        docType: 'composition_note',
        status: 'active',
        source: 'body_composition_note',
        sourceId: id,
        notes: `Cenário ${id} · Δkg clínico ${execution_plan?.deltas?.weight_kg ?? doctorLoss ?? '—'} · PDF prontuário`,
        createdBy: req.user!.id,
        mimeType: 'application/pdf',
        originalName: `${noteId}.pdf`,
        storagePath: pdfPath,
        sizeBytes: pdfBuf.length,
        fileUrl: `/api/patients/${patient.id}/documents/by-source/body_composition_note/${id}/file`,
      });
      db.prepare(`
        INSERT INTO patient_timeline_events
          (id, tenant_id, patient_id, kind, title, subtitle, status, meta, occurred_at)
        VALUES (?, ?, ?, 'document', 'document_composition_note', ?, 'active', ?, datetime('now'))
      `).run(
        `pte_cnote_${Date.now().toString(36)}`,
        req.tenantId,
        patient.id,
        noteTitle,
        JSON.stringify({ scenario_id: id, document_id: compositionNoteDocumentId }),
      );
    }
  } catch { /* note is best-effort */ }

  res.status(201).json({
    id,
    scenario,
    execution_plan,
    composition_note_document_id: compositionNoteDocumentId,
  });
});

async function persistScenarioImage(
  tenantId: string,
  patientId: string,
  scenarioId: string,
  provider: string,
  imageUrl: string,
  taskId?: string,
) {
  try {
    const buf = await fetchProviderImageBytes(imageUrl);
    if (buf?.length) {
      const dir = bodyUploadsDir(tenantId, patientId);
      const imagePath = path.join(dir, `scenario-${scenarioId}.jpg`);
      fs.writeFileSync(imagePath, buf);
      db.prepare(`
        UPDATE body_scenarios
        SET status = 'completed', provider = ?, provider_task_id = ?, image_url = ?, image_path = ?, error = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(provider, taskId || null, imageUrl, imagePath, scenarioId);
      markScenarioOutputViews(scenarioId);
      return;
    }
  } catch { /* keep remote URL */ }
  db.prepare(`
    UPDATE body_scenarios
    SET status = 'completed', provider = ?, provider_task_id = ?, image_url = ?, error = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(provider, taskId || null, imageUrl, scenarioId);
  markScenarioOutputViews(scenarioId);
}

router.post('/:patientId/scenarios/:scenarioId/generate', requireRole('doctor', 'nurse', 'admin'), async (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  if (!requireStepUp(req, res)) return;
  const consents = consentMap(req.tenantId!, req.params.patientId);
  if (!simulationsAllowed(consents)) {
    res.status(403).json({ error: 'simulations_blocked', consents });
    return;
  }
  const row = db.prepare(`
    SELECT * FROM body_scenarios WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).get(req.params.scenarioId, req.params.patientId, req.tenantId) as any;
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }

  let capture: any = null;
  if (row.capture_id) {
    capture = db.prepare(`SELECT * FROM body_capture_assets WHERE id = ?`).get(row.capture_id)
      || db.prepare(`SELECT * FROM body_captures WHERE id = ?`).get(row.capture_id);
  }
  const prompt = open(row.prompt) || row.prompt;
  let envelope: any = null;
  try { envelope = row.execution_plan ? JSON.parse(row.execution_plan) : null; } catch { envelope = null; }
  try {
    await runGenerate(req, row.id, row.patient_id, capture, prompt, {
      captureSessionId: row.capture_session_id,
      envelope,
      weeks: row.horizon_weeks || row.weeks || 12,
      sex: patientInTenant(row.patient_id, req.tenantId!)?.gender,
    });
  } catch (e: any) {
    db.prepare(`UPDATE body_scenarios SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(String(e?.message || e).slice(0, 500), row.id);
  }
  const scenario = loadScenarioForApi(row.id);
  res.json({ scenario });
});

router.get('/:patientId/scenarios/:scenarioId', requireRole(...CLINICAL_ROLES), async (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  let row = db.prepare(`
    SELECT * FROM body_scenarios WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).get(req.params.scenarioId, req.params.patientId, req.tenantId) as any;
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }

  if (row.status === 'pending' && row.provider === 'a2e' && row.provider_task_id) {
    const polled = await pollA2e(row.provider_task_id);
    if (polled.status === 'completed' && polled.imageUrl) {
      await persistScenarioImage(req.tenantId!, row.patient_id, row.id, 'a2e', polled.imageUrl, row.provider_task_id);
      row = db.prepare(`SELECT * FROM body_scenarios WHERE id = ?`).get(row.id);
    } else if (polled.status === 'failed') {
      db.prepare(`UPDATE body_scenarios SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
        .run((polled.error || 'failed').slice(0, 500), row.id);
      row = db.prepare(`SELECT * FROM body_scenarios WHERE id = ?`).get(row.id);
    }
  }

  const scenario = loadScenarioForApi(row.id);
  res.json({ scenario });
});

router.get('/:patientId/scenarios/:scenarioId/image', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const row = db.prepare(`
    SELECT * FROM body_scenarios WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).get(req.params.scenarioId, req.params.patientId, req.tenantId) as any;
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }

  const view = String(req.query.view || 'front').toLowerCase();
  let views: any = {};
  try { views = row.output_views ? JSON.parse(row.output_views) : {}; } catch { views = {}; }
  const entry = views[view];
  if (entry?.path && fs.existsSync(entry.path)) {
    res.setHeader('Content-Type', entry.path.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Body-View', view);
    fs.createReadStream(entry.path).pipe(res);
    return;
  }

  // Legacy front path
  if ((view === 'front' || !entry) && row.image_path && fs.existsSync(row.image_path)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Body-View', 'front');
    fs.createReadStream(row.image_path).pipe(res);
    return;
  }
  if (view === 'front' && row.image_url) {
    res.redirect(row.image_url);
    return;
  }
  res.status(404).json({ error: 'not_found', view });
});

export default router;
