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

  const measurements = db.prepare(`
    SELECT * FROM body_measurements WHERE tenant_id = ? AND patient_id = ?
    ORDER BY recorded_at DESC LIMIT 50
  `).all(req.tenantId, patient.id) as any[];
  const latest = measurements[0] || null;
  const medications = db.prepare(`
    SELECT * FROM body_medications WHERE tenant_id = ? AND patient_id = ?
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
    SELECT id, capture_id, title, goal, weeks, status, provider, image_url,
           CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END AS has_image,
           error, created_at, updated_at
    FROM body_scenarios WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.tenantId, patient.id) as any[];
  const consents = consentMap(req.tenantId!, patient.id);
  const bmi = calcBmi(latest?.height_cm, latest?.weight_kg);

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
      bmi,
    },
    measurements,
    medications,
    plans,
    captures,
    capture_sessions,
    active_capture_session: capture_sessions.find((s: any) => s.status === 'complete')
      || capture_sessions[0]
      || null,
    scenarios,
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
  const parsed = z.object({
    height_cm: z.number().positive().max(300).optional().nullable(),
    weight_kg: z.number().positive().max(500).optional().nullable(),
    waist_cm: z.number().positive().max(400).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    recorded_at: z.string().optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  if (d.height_cm == null && d.weight_kg == null && d.waist_cm == null) {
    res.status(400).json({ error: 'validation', message: 'at_least_one_metric' });
    return;
  }
  const id = uuid();
  db.prepare(`
    INSERT INTO body_measurements
      (id, tenant_id, patient_id, height_cm, weight_kg, waist_cm, notes, recorded_at, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.tenantId, patient.id,
    d.height_cm ?? null, d.weight_kg ?? null, d.waist_cm ?? null,
    d.notes ? seal(d.notes) : null,
    d.recorded_at || new Date().toISOString(),
    req.user!.id,
  );
  const row = db.prepare(`SELECT * FROM body_measurements WHERE id = ?`).get(id) as any;
  if (row?.notes) row.notes = open(row.notes) || row.notes;
  res.status(201).json({
    measurement: row,
    bmi: calcBmi(row.height_cm, row.weight_kg),
  });
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
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const id = uuid();
  const d = parsed.data;
  db.prepare(`
    INSERT INTO body_medications
      (id, tenant_id, patient_id, name, dosage, frequency, notes, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.tenantId, patient.id, d.name, d.dosage ?? null, d.frequency ?? null, d.notes ?? null, d.started_at ?? null);
  const row = db.prepare(`SELECT * FROM body_medications WHERE id = ?`).get(id);
  res.status(201).json({ medication: row });
});

router.delete('/:patientId/medications/:medId', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const r = db.prepare(`
    DELETE FROM body_medications WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).run(req.params.medId, req.params.patientId, req.tenantId);
  if (!r.changes) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

router.post('/:patientId/plans', requireRole('doctor', 'nurse', 'admin'), (req: Request, res: Response) => {
  if (!requireClinical(req, res)) return;
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(4000).optional().nullable(),
    weeks: z.number().int().positive().max(104).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const id = uuid();
  const d = parsed.data;
  db.prepare(`
    INSERT INTO body_lifestyle_plans (id, tenant_id, patient_id, title, description, weeks)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.tenantId, patient.id, d.title, d.description ?? null, d.weeks ?? null);
  res.status(201).json({ plan: db.prepare(`SELECT * FROM body_lifestyle_plans WHERE id = ?`).get(id) });
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
    title: z.string().min(1).max(200).default('Cenário ilustrativo'),
    goal: z.string().max(500).optional().nullable(),
    weeks: z.number().int().positive().max(104).optional().nullable(),
    capture_id: z.string().optional().nullable(),
    generate: z.boolean().optional().default(true),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }

  const latest = latestMeasurement(req.tenantId!, patient.id);
  let capture: any = null;
  if (parsed.data.capture_id) {
    capture = db.prepare(`
      SELECT * FROM body_capture_assets WHERE id = ? AND patient_id = ? AND tenant_id = ?
    `).get(parsed.data.capture_id, patient.id, req.tenantId)
      || db.prepare(`
        SELECT * FROM body_captures WHERE id = ? AND patient_id = ? AND tenant_id = ?
      `).get(parsed.data.capture_id, patient.id, req.tenantId);
  } else {
    capture = latestFrontAsset(req.tenantId!, patient.id)
      || db.prepare(`
        SELECT * FROM body_captures WHERE patient_id = ? AND tenant_id = ? AND image_path IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(patient.id, req.tenantId);
  }

  const prompt = buildScenarioPrompt({
    sex: patient.gender,
    heightCm: latest?.height_cm,
    weightKg: latest?.weight_kg,
    waistCm: latest?.waist_cm,
    weeks: parsed.data.weeks,
    goal: parsed.data.goal,
    hasReferencePhoto: !!(capture?.image_path && fs.existsSync(capture.image_path)),
  });

  const id = uuid();
  const snapshot = JSON.stringify({
    height_cm: latest?.height_cm ?? null,
    weight_kg: latest?.weight_kg ?? null,
    waist_cm: latest?.waist_cm ?? null,
    bmi: calcBmi(latest?.height_cm, latest?.weight_kg),
  });

  db.prepare(`
    INSERT INTO body_scenarios
      (id, tenant_id, patient_id, capture_id, title, goal, weeks, prompt, status,
       measurement_snapshot, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(
    id, req.tenantId, patient.id, capture?.id ?? null,
    parsed.data.title, parsed.data.goal ?? null, parsed.data.weeks ?? 12,
    seal(prompt), snapshot, req.user!.id,
  );

  if (!parsed.data.generate) {
    res.status(201).json({ scenario: db.prepare(`SELECT id, title, status, created_at FROM body_scenarios WHERE id = ?`).get(id) });
    return;
  }

  try {
    await runGenerate(req, id, patient.id, capture, prompt);
  } catch (e: any) {
    db.prepare(`UPDATE body_scenarios SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(String(e?.message || e).slice(0, 500), id);
  }

  const scenario = db.prepare(`
    SELECT id, capture_id, title, goal, weeks, status, provider, image_url,
           CASE WHEN image_path IS NOT NULL AND image_path != '' THEN 1 ELSE 0 END AS has_image,
           error, created_at, updated_at
    FROM body_scenarios WHERE id = ?
  `).get(id);

  res.status(201).json({ scenario });
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
