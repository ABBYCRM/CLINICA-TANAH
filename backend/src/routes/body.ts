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
import {
  bodyUploadsDir,
  buildScenarioPrompt,
  calcBmi,
  generateBodyScenarioImage,
  imageProvidersStatus,
  pollA2e,
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
    db.prepare(`SELECT * FROM body_capture_assets WHERE id = ?`).get(assetId)
    || db.prepare(`SELECT * FROM body_captures WHERE id = ?`).get(assetId)
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
  const assetsRows = db.prepare(`
    SELECT * FROM body_capture_assets WHERE session_id = ? ORDER BY created_at ASC
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
    assets,
    views_complete: CAPTURE_VIEWS.every((v) => !!assets[v]),
  };
}

function latestFrontAsset(tenantId: string, patientId: string) {
  return db.prepare(`
    SELECT a.* FROM body_capture_assets a
    JOIN body_capture_sessions s ON s.id = a.session_id
    WHERE a.tenant_id = ? AND a.patient_id = ? AND a.view = 'front'
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
      created_at = datetime('now')
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

  const assets = db.prepare(`SELECT * FROM body_capture_assets WHERE session_id = ?`).all(session.id) as any[];
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

function latestMeasurement(tenantId: string, patientId: string) {
  return db.prepare(`
    SELECT * FROM body_measurements
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY recorded_at DESC LIMIT 1
  `).get(tenantId, patientId) as any;
}

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
  `).all(req.tenantId, patient.id) as any[];
  const captures = db.prepare(`
    SELECT id, view_angle, status, content_type, notes, validated_at, created_at,
           CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END AS has_image
    FROM body_captures WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.tenantId, patient.id) as any[];
  const sessions = db.prepare(`
    SELECT * FROM body_capture_sessions WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 20
  `).all(req.tenantId, patient.id) as any[];
  const capture_sessions = sessions.map((s) => serializeSession(s, req));
  const scenarios = db.prepare(`
    SELECT id, capture_id, capture_session_id, title, goal, weeks, horizon_weeks, status, provider, image_url,
           CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END AS has_image,
           error, review_status, execution_plan, plan_config, assumptions, created_at, updated_at
    FROM body_scenarios WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.tenantId, patient.id) as any[];
  const consents = consentMap(req.tenantId!, patient.id);
  const bmi = latest?.bmi ?? calcBmi(latest?.height_cm, latest?.weight_kg);

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
    active_capture_session: capture_sessions.find((s: any) => s.status === 'complete')
      || capture_sessions[0]
      || null,
    scenarios: scenarios.map((s) => ({
      ...s,
      execution_plan: s.execution_plan ? JSON.parse(s.execution_plan) : null,
      plan_config: s.plan_config ? JSON.parse(s.plan_config) : null,
      assumptions: s.assumptions ? JSON.parse(s.assumptions) : null,
    })),
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
    name: z.string().min(1).max(200),
    dosage: z.string().max(200).optional().nullable(),
    frequency: z.string().max(200).optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    started_at: z.string().optional().nullable(),
    class_tag: z.string().max(80).optional().nullable(),
    confirmation: z.string().max(80).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const id = uuid();
  const d = parsed.data;
  db.prepare(`
    INSERT INTO body_medications
      (id, tenant_id, patient_id, name, dosage, frequency, notes, started_at, class_tag, confirmation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.tenantId, patient.id, d.name, d.dosage ?? null, d.frequency ?? null, d.notes ?? null,
    d.started_at ?? null, d.class_tag ?? null, d.confirmation ?? 'clinician_confirmed',
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
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const id = uuid();
  const d = parsed.data;
  db.prepare(`
    INSERT INTO body_lifestyle_plans (id, tenant_id, patient_id, title, description, weeks, plan_type, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.tenantId, patient.id, d.title, d.description ?? d.summary ?? null,
    d.weeks ?? null, d.plan_type, d.summary ?? d.description ?? null,
  );
  res.status(201).json({ plan: db.prepare(`SELECT * FROM body_lifestyle_plans WHERE id = ?`).get(id) });
});

/** Preview if/then envelope without generating images */
router.post('/:patientId/scenarios/preview', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  const latest = flattenMeasurement(latestMeasurement(req.tenantId!, patient.id));
  const medications = db.prepare(`SELECT id, name, class_tag FROM body_medications WHERE tenant_id = ? AND patient_id = ? AND status = 'active'`)
    .all(req.tenantId, patient.id) as any[];
  const plans = db.prepare(`SELECT id, title, plan_type FROM body_lifestyle_plans WHERE tenant_id = ? AND patient_id = ? AND status = 'active'`)
    .all(req.tenantId, patient.id) as any[];
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
  const execution_plan = computeScenarioEnvelope({
    horizon_weeks: horizon,
    baseline: {
      height_cm: latest?.height_cm,
      weight_kg: latest?.weight_kg,
      waist_cm: latest?.waist_cm,
      body_fat_pct: latest?.body_fat_pct,
      bmi: latest?.bmi,
    },
    medications,
    nutritionPlans: plans.filter((p) => p.plan_type === 'nutrition'),
    exercisePlans: plans.filter((p) => p.plan_type === 'exercise'),
    plan_config,
    assumptions,
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
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }

  const weeks = parsed.data.horizon_weeks || parsed.data.weeks || 12;
  const latestFlat = flattenMeasurement(latestMeasurement(req.tenantId!, patient.id));
  const medications = db.prepare(`SELECT id, name, class_tag FROM body_medications WHERE tenant_id = ? AND patient_id = ? AND status = 'active'`)
    .all(req.tenantId, patient.id) as any[];
  const plans = db.prepare(`SELECT id, title, plan_type FROM body_lifestyle_plans WHERE tenant_id = ? AND patient_id = ? AND status = 'active'`)
    .all(req.tenantId, patient.id) as any[];

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

  const execution_plan = computeScenarioEnvelope({
    horizon_weeks: weeks,
    baseline: {
      height_cm: latestFlat?.height_cm,
      weight_kg: latestFlat?.weight_kg,
      waist_cm: latestFlat?.waist_cm,
      body_fat_pct: latestFlat?.body_fat_pct,
      bmi: latestFlat?.bmi,
    },
    medications,
    nutritionPlans: plans.filter((p) => p.plan_type === 'nutrition'),
    exercisePlans: plans.filter((p) => p.plan_type === 'exercise'),
    plan_config,
    assumptions,
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
       measurement_snapshot, created_by, plan_config, assumptions, execution_plan, photorealism, review_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, 'pending_review')
  `).run(
    id, req.tenantId, patient.id, capture?.id ?? null, captureSessionId,
    parsed.data.title, parsed.data.goal ?? execution_plan.summary, weeks, weeks,
    seal(prompt), snapshot, req.user!.id,
    JSON.stringify(plan_config), JSON.stringify(assumptions), JSON.stringify(execution_plan),
    parsed.data.photorealism === false ? 0 : 1,
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
    await runGenerate(req, id, patient.id, capture, prompt);
  } catch (e: any) {
    db.prepare(`UPDATE body_scenarios SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(String(e?.message || e).slice(0, 500), id);
  }

  const scenario = db.prepare(`
    SELECT id, capture_id, capture_session_id, title, goal, weeks, horizon_weeks, status, provider, image_url,
           CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END AS has_image,
           error, review_status, execution_plan, created_at, updated_at
    FROM body_scenarios WHERE id = ?
  `).get(id) as any;
  if (scenario?.execution_plan) scenario.execution_plan = JSON.parse(scenario.execution_plan);

  res.status(201).json({ id, scenario, execution_plan });
});

async function runGenerate(req: Request, scenarioId: string, patientId: string, capture: any, prompt: string) {
  db.prepare(`UPDATE body_scenarios SET status = 'generating', updated_at = datetime('now') WHERE id = ?`).run(scenarioId);

  let referencePublicUrl: string | null = null;
  const origin = (process.env.APP_ORIGIN || '').replace(/\/$/, '');
  if (capture?.id && capture?.image_path && fs.existsSync(capture.image_path) && /^https:\/\//i.test(origin)) {
    const candidate = `${origin}/api/public/body-asset/${signBodyAssetToken(capture.id)}`;
    try {
      const head = await fetch(candidate, { method: 'GET' });
      if (head.ok) referencePublicUrl = candidate;
    } catch {
      referencePublicUrl = null;
    }
  }

  const result = await generateBodyScenarioImage({
    name: `clinica-tanah-${scenarioId.slice(0, 8)}`,
    prompt,
    referencePath: capture?.image_path || null,
    referencePublicUrl,
  });

  if (result.status === 'failed') {
    db.prepare(`
      UPDATE body_scenarios SET status = 'failed', provider = ?, error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(result.provider, (result.error || 'failed').slice(0, 500), scenarioId);
    return;
  }

  if (result.status === 'pending' && result.taskId) {
    db.prepare(`
      UPDATE body_scenarios SET status = 'pending', provider = ?, provider_task_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(result.provider, result.taskId, scenarioId);
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const polled = await pollA2e(result.taskId!);
      if (polled.status === 'completed' && polled.imageUrl) {
        await persistScenarioImage(req.tenantId!, patientId, scenarioId, polled.provider, polled.imageUrl, result.taskId);
        return;
      }
      if (polled.status === 'failed') {
        // Reference download failures → retry once as text-only photoreal generation
        const err = String(polled.error || '');
        if (/download|fetch|url|image/i.test(err) && referencePublicUrl) {
          const retry = await generateBodyScenarioImage({
            name: `clinica-tanah-${scenarioId.slice(0, 8)}-txt`,
            prompt,
            referencePath: null,
            referencePublicUrl: null,
          });
          if (retry.status === 'pending' && retry.taskId) {
            db.prepare(`
              UPDATE body_scenarios SET status = 'pending', provider = ?, provider_task_id = ?, error = NULL, updated_at = datetime('now')
              WHERE id = ?
            `).run(retry.provider, retry.taskId, scenarioId);
            for (let j = 0; j < 12; j++) {
              await new Promise((r) => setTimeout(r, 5000));
              const p2 = await pollA2e(retry.taskId!);
              if (p2.status === 'completed' && p2.imageUrl) {
                await persistScenarioImage(req.tenantId!, patientId, scenarioId, p2.provider, p2.imageUrl, retry.taskId);
                return;
              }
              if (p2.status === 'failed') {
                db.prepare(`UPDATE body_scenarios SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
                  .run((p2.error || 'failed').slice(0, 500), scenarioId);
                return;
              }
            }
            return;
          }
          if (retry.status === 'completed' && (retry.imageUrl || retry.imageBytes)) {
            if (retry.imageBytes) {
              const dir = bodyUploadsDir(req.tenantId!, patientId);
              const imagePath = path.join(dir, `scenario-${scenarioId}.jpg`);
              fs.writeFileSync(imagePath, retry.imageBytes);
              db.prepare(`
                UPDATE body_scenarios SET status = 'completed', provider = ?, image_path = ?, error = NULL, updated_at = datetime('now')
                WHERE id = ?
              `).run(retry.provider, imagePath, scenarioId);
              return;
            }
            if (retry.imageUrl) {
              await persistScenarioImage(req.tenantId!, patientId, scenarioId, retry.provider, retry.imageUrl, retry.taskId);
              return;
            }
          }
        }
        db.prepare(`UPDATE body_scenarios SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
          .run((polled.error || 'failed').slice(0, 500), scenarioId);
        return;
      }
    }
    return;
  }

  if (result.imageBytes) {
    const dir = bodyUploadsDir(req.tenantId!, patientId);
    const ext = (result.contentType || '').includes('png') ? 'png' : 'jpg';
    const imagePath = path.join(dir, `scenario-${scenarioId}.${ext}`);
    fs.writeFileSync(imagePath, result.imageBytes);
    db.prepare(`
      UPDATE body_scenarios SET status = 'completed', provider = ?, image_path = ?, error = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(result.provider, imagePath, scenarioId);
    return;
  }

  if (result.imageUrl) {
    await persistScenarioImage(req.tenantId!, patientId, scenarioId, result.provider, result.imageUrl, result.taskId);
  }
}

async function persistScenarioImage(
  tenantId: string,
  patientId: string,
  scenarioId: string,
  provider: string,
  imageUrl: string,
  taskId?: string,
) {
  try {
    const res = await fetch(imageUrl);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const dir = bodyUploadsDir(tenantId, patientId);
      const imagePath = path.join(dir, `scenario-${scenarioId}.jpg`);
      fs.writeFileSync(imagePath, buf);
      db.prepare(`
        UPDATE body_scenarios
        SET status = 'completed', provider = ?, provider_task_id = ?, image_url = ?, image_path = ?, error = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(provider, taskId || null, imageUrl, imagePath, scenarioId);
      return;
    }
  } catch { /* keep remote URL */ }
  db.prepare(`
    UPDATE body_scenarios
    SET status = 'completed', provider = ?, provider_task_id = ?, image_url = ?, error = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(provider, taskId || null, imageUrl, scenarioId);
}

router.post('/:patientId/scenarios/:scenarioId/generate', requireRole('doctor', 'nurse', 'admin'), async (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const consents = consentMap(req.tenantId!, req.params.patientId);
  if (!simulationsAllowed(consents)) {
    res.status(403).json({ error: 'simulations_blocked', consents });
    return;
  }
  const row = db.prepare(`
    SELECT * FROM body_scenarios WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).get(req.params.scenarioId, req.params.patientId, req.tenantId) as any;
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }

  const capture = row.capture_id
    ? db.prepare(`SELECT * FROM body_captures WHERE id = ?`).get(row.capture_id)
    : null;
  const prompt = open(row.prompt) || row.prompt;
  try {
    await runGenerate(req, row.id, row.patient_id, capture, prompt);
  } catch (e: any) {
    db.prepare(`UPDATE body_scenarios SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(String(e?.message || e).slice(0, 500), row.id);
  }
  const scenario = db.prepare(`
    SELECT id, capture_id, title, goal, weeks, status, provider, image_url,
           CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END AS has_image,
           error, created_at, updated_at
    FROM body_scenarios WHERE id = ?
  `).get(row.id);
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

  res.json({
    scenario: {
      id: row.id,
      capture_id: row.capture_id,
      title: row.title,
      goal: row.goal,
      weeks: row.weeks,
      status: row.status,
      provider: row.provider,
      image_url: row.image_url,
      has_image: !!(row.image_path || row.image_url),
      error: row.error,
      measurement_snapshot: row.measurement_snapshot ? JSON.parse(row.measurement_snapshot) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
});

router.get('/:patientId/scenarios/:scenarioId/image', requireRole(...CLINICAL_ROLES), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const row = db.prepare(`
    SELECT * FROM body_scenarios WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).get(req.params.scenarioId, req.params.patientId, req.tenantId) as any;
  if (row?.image_path && fs.existsSync(row.image_path)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(row.image_path).pipe(res);
    return;
  }
  if (row?.image_url) {
    res.redirect(row.image_url);
    return;
  }
  res.status(404).json({ error: 'not_found' });
});

export default router;
