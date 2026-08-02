/**
 * TANAH-HAIR clinical hair-transplant API — mounted under /api/clinical/hair.
 * Ported from TANAH-HAIR apps/api/src/app.mjs simulator + Gemini routes.
 * Auth: CRM JWT (authenticate + clinical roles). Patient-scoped where applicable.
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth';
import { db } from '../db/schema';
import { logAudit } from '../services/audit';
import {
  HAIRLINE_PRESETS,
  COVERAGE_ZONES,
  CURL_PRESETS,
  FULLNESS_PRESETS,
  TECHNIQUE_PRESETS,
  SESSION_PRESETS,
  GRAFT_SCENARIOS,
  VIEW_CATALOG,
  DEMO_SCALP,
  getAvailableViews,
  renderSimulation,
  renderVariants,
  renderPhotoSimulation,
  renderPhotoVariants,
} from '../services/hairSimulator';
import {
  GEMINI_MODELS,
  publicGeminiSettings,
  resolveHairGeminiFromEnv,
  generatePhotoAwareVisualization,
  callGeminiImageEdit,
  watermarkedImageDataUrl,
  buildPhotoEditPrompt,
  testGeminiConnection,
} from '../services/geminiHair';

const router = Router();
const CLINICAL = ['admin', 'doctor', 'nurse'] as const;

function assetPath(): string {
  const candidates = [
    path.join(__dirname, '../assets/hair/sample-patient.webp'),
    path.join(process.cwd(), 'src/assets/hair/sample-patient.webp'),
    path.join(process.cwd(), 'dist/assets/hair/sample-patient.webp'),
    path.join(process.cwd(), 'assets/hair/sample-patient.webp'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function readDemoPhoto(): { base64: string; mime: string } | null {
  const p = assetPath();
  if (!fs.existsSync(p)) return null;
  return { base64: fs.readFileSync(p).toString('base64'), mime: 'image/webp' };
}

function ensureHairSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hair_simulations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      created_by TEXT,
      kind TEXT NOT NULL,
      params_json TEXT NOT NULL,
      output_data_url TEXT,
      model TEXT,
      grafts INTEGER,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_hair_sim_patient ON hair_simulations(tenant_id, patient_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS hair_procedure_tallies (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      session_label TEXT,
      extracted INTEGER NOT NULL DEFAULT 0,
      implanted INTEGER NOT NULL DEFAULT 0,
      discarded INTEGER NOT NULL DEFAULT 0,
      damaged INTEGER NOT NULL DEFAULT 0,
      remaining INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, patient_id, session_label)
    );
  `);
}

function assertPatient(req: Request, res: Response): { id: string } | null {
  const patientId = String(req.params.patientId || '');
  const row = db.prepare(`SELECT id FROM patients WHERE id = ? AND tenant_id = ?`).get(patientId, req.tenantId) as any;
  if (!row) {
    res.status(404).json({ error: 'not_found', message: 'Patient not found' });
    return null;
  }
  return row;
}

function parseSimBody(body: any) {
  const lines = HAIRLINE_PRESETS as Record<string, unknown>;
  const zones = COVERAGE_ZONES as Record<string, unknown>;
  const curls = CURL_PRESETS as Record<string, unknown>;
  const fullnesses = FULLNESS_PRESETS as Record<string, unknown>;
  const techniques = TECHNIQUE_PRESETS as Record<string, unknown>;
  const sessions = SESSION_PRESETS as Record<string, unknown>;
  const grafts = GRAFT_SCENARIOS as Record<string, unknown>;
  return {
    hairline: lines[body?.hairline] ? body.hairline : 'balanced',
    zone: zones[body?.zone] ? body.zone : 'full',
    density: Math.max(0, Math.min(1, Number(body?.density) || 0.6)),
    length: ['buzz', 'short', 'medium', 'long'].includes(body?.length) ? body.length : 'short',
    color: ['black', 'darkBrown', 'mediumBrown', 'lightBrown', 'blonde', 'saltPepper'].includes(body?.color)
      ? body.color
      : 'darkBrown',
    curl: curls[body?.curl] ? body.curl : 'straight',
    fullness: fullnesses[body?.fullness] ? body.fullness : 'moderate',
    technique: techniques[body?.technique] ? body.technique : 'fue',
    sessions: sessions[body?.sessions] ? body.sessions : 'single',
    graftScenario: grafts[body?.graftScenario] ? body.graftScenario : 'moderate',
    skinTone: ['light', 'medium', 'deep'].includes(body?.skinTone) ? body.skinTone : 'medium',
    view: VIEW_CATALOG.some((v: any) => v.id === body?.view) ? body.view : 'front',
    caseId: typeof body?.caseId === 'string' ? body.caseId : 'demo-001',
    seed: Number.isInteger(body?.seed) ? body.seed : undefined,
  };
}

function persistSimulation(opts: {
  tenantId: string;
  patientId: string;
  actorId?: string;
  kind: string;
  params: any;
  artifact: any;
}) {
  ensureHairSchema();
  const id = opts.artifact?.id || uuid();
  db.prepare(`
    INSERT INTO hair_simulations
      (id, tenant_id, patient_id, created_by, kind, params_json, output_data_url, model, grafts, label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.tenantId,
    opts.patientId,
    opts.actorId || null,
    opts.kind,
    JSON.stringify(opts.params),
    opts.artifact?.outputDataUrl || null,
    opts.artifact?.model || null,
    opts.artifact?.grafts ?? null,
    opts.artifact?.label || null,
  );
  return id;
}

router.use(authenticate);

/** Global presets (no patient) — mirrors TANAH-HAIR /api/simulator/presets */
router.get('/presets', requireRole(...CLINICAL), (_req, res) => {
  res.json({
    hairlines: HAIRLINE_PRESETS,
    zones: COVERAGE_ZONES,
    techniques: TECHNIQUE_PRESETS,
    sessions: SESSION_PRESETS,
    curls: CURL_PRESETS,
    fullnesses: FULLNESS_PRESETS,
    graftScenarios: GRAFT_SCENARIOS,
    views: VIEW_CATALOG,
    geminiModels: GEMINI_MODELS,
  });
});

router.get('/gemini/status', requireRole('admin', 'doctor'), (_req, res) => {
  const record = resolveHairGeminiFromEnv();
  res.json(publicGeminiSettings(record));
});

router.post('/gemini/test', requireRole('admin'), async (_req, res) => {
  const record = resolveHairGeminiFromEnv();
  if (!record) {
    res.status(409).json({
      error: 'GEMINI_NOT_CONFIGURED',
      message: 'Missing env GEMINI_API_KEY. Configure on the server — no mock key is invented.',
      missing: 'GEMINI_API_KEY',
    });
    return;
  }
  try {
    const result = await testGeminiConnection({ record });
    res.json(result);
  } catch (e: any) {
    res.status(Number(e?.status) || 502).json({ error: e?.code || 'GEMINI_CONNECTION_FAILED', message: e?.message });
  }
});

router.get('/base-image', requireRole(...CLINICAL), (_req, res) => {
  const p = assetPath();
  if (!fs.existsSync(p)) {
    res.status(404).json({
      error: 'BASE_IMAGE_NOT_FOUND',
      message: 'Bundled demo patient photo missing from build (backend/src/assets/hair/sample-patient.webp).',
    });
    return;
  }
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(path.resolve(p));
});

router.get('/base-image-info', requireRole(...CLINICAL), (_req, res) => {
  res.json({
    id: 'sample-patient',
    width: DEMO_SCALP.width,
    height: DEMO_SCALP.height,
    description: 'Synthetic demo patient (Shutterstock-style). No real patient data.',
    attribution: 'Bundled from TANAH-HAIR; not a real patient.',
    availableViews: getAvailableViews(),
    bundled: true,
  });
});

router.get('/:patientId/overview', requireRole(...CLINICAL), (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  ensureHairSchema();
  const sims = db.prepare(`
    SELECT id, kind, grafts, label, model, created_at, params_json
    FROM hair_simulations
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 20
  `).all(req.tenantId, patient.id);
  const tally = db.prepare(`
    SELECT * FROM hair_procedure_tallies
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY updated_at DESC LIMIT 1
  `).get(req.tenantId, patient.id);
  const gemini = publicGeminiSettings(resolveHairGeminiFromEnv());
  res.json({
    patient_id: patient.id,
    simulations: sims,
    procedure_tally: tally || null,
    gemini,
    views: getAvailableViews(),
    intended_use: {
      diagnosis: false,
      prediction: false,
      guaranteed_outcome: false,
      watermark: 'HYPOTHETICAL VISUALIZATION - NOT A PREDICTION OR GUARANTEE OF RESULTS',
    },
  });
});

router.get('/:patientId/simulations', requireRole(...CLINICAL), (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  ensureHairSchema();
  const rows = db.prepare(`
    SELECT id, kind, grafts, label, model, created_at, params_json, output_data_url
    FROM hair_simulations
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.tenantId, patient.id);
  res.json({ simulations: rows });
});

router.get('/:patientId/simulations/:simId', requireRole(...CLINICAL), (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  ensureHairSchema();
  const row = db.prepare(`
    SELECT * FROM hair_simulations WHERE id = ? AND patient_id = ? AND tenant_id = ?
  `).get(req.params.simId, patient.id, req.tenantId);
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ simulation: row });
});

router.post('/:patientId/simulator/render', requireRole(...CLINICAL), (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  const safe = parseSimBody(req.body);
  const artifact = renderSimulation(safe);
  persistSimulation({
    tenantId: req.tenantId!,
    patientId: patient.id,
    actorId: req.user?.id,
    kind: 'parametric',
    params: safe,
    artifact,
  });
  logAudit({
    tenantId: req.tenantId!,
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'hair_simulator_render',
    resourceType: 'hair_simulation',
    resourceId: artifact.id,
    afterValue: { patient_id: patient.id, kind: 'parametric' },
  });
  res.status(201).json(artifact);
});

router.post('/:patientId/simulator/variants', requireRole(...CLINICAL), (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  const safe = parseSimBody(req.body);
  const variants = renderVariants(safe);
  res.json({ variants });
});

router.post('/:patientId/simulator/apply', requireRole(...CLINICAL), (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  const safe = parseSimBody(req.body);
  const photo = readDemoPhoto();
  const artifact = (renderPhotoSimulation as any)({ ...safe, photoBase64: photo?.base64 || null });
  persistSimulation({
    tenantId: req.tenantId!,
    patientId: patient.id,
    actorId: req.user?.id,
    kind: 'photo_parametric',
    params: safe,
    artifact,
  });
  logAudit({
    tenantId: req.tenantId!,
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'hair_simulator_photo_apply',
    resourceType: 'hair_simulation',
    resourceId: artifact.id,
    afterValue: { patient_id: patient.id },
  });
  res.status(201).json(artifact);
});

router.post('/:patientId/simulator/photo-variants', requireRole(...CLINICAL), (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  const safe = parseSimBody(req.body);
  const photo = readDemoPhoto();
  const variants = (renderPhotoVariants as any)({ ...safe, photoBase64: photo?.base64 || null });
  res.json({
    variants,
    baseImage: `/api/clinical/hair/base-image`,
    view: safe.view,
    caseId: safe.caseId,
  });
});

router.post('/:patientId/simulator/multi-view', requireRole(...CLINICAL), (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  const safe = parseSimBody(req.body);
  const photo = readDemoPhoto();
  const available = getAvailableViews().filter((v: any) => v.available);
  const renders = available.map((v: any) =>
    (renderPhotoSimulation as any)({ ...safe, view: v.id, photoBase64: photo?.base64 || null }),
  );
  res.json({
    renders,
    availableViews: getAvailableViews(),
    baseImage: `/api/clinical/hair/base-image`,
    caseId: safe.caseId,
  });
});

router.post('/:patientId/simulator/ai-generate', requireRole(...CLINICAL), async (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  const record = resolveHairGeminiFromEnv();
  if (!record) {
    res.status(409).json({
      error: 'GEMINI_NOT_CONFIGURED',
      message: 'Missing env GEMINI_API_KEY. Configure on DigitalOcean/app env — no mock key is used.',
      missing: 'GEMINI_API_KEY',
    });
    return;
  }
  if (!record.enabled) {
    res.status(409).json({ error: 'GEMINI_DISABLED', message: 'Gemini hair visualization is disabled (GEMINI_HAIR_ENABLED=0 or GEMINI_ENABLED=0).' });
    return;
  }
  const photo = readDemoPhoto();
  if (!photo) {
    res.status(503).json({ error: 'BASE_IMAGE_NOT_FOUND', message: 'Demo photo asset missing from build.' });
    return;
  }
  const safe = parseSimBody(req.body);
  try {
    const artifact = await generatePhotoAwareVisualization({
      record,
      params: safe,
      photoBase64: photo.base64,
      photoMime: photo.mime,
    });
    persistSimulation({
      tenantId: req.tenantId!,
      patientId: patient.id,
      actorId: req.user?.id,
      kind: 'gemini_photo',
      params: safe,
      artifact,
    });
    logAudit({
      tenantId: req.tenantId!,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'hair_simulator_ai_generate',
      resourceType: 'hair_simulation',
      resourceId: artifact.id,
      afterValue: { patient_id: patient.id, model: artifact.model },
    });
    res.status(201).json(artifact);
  } catch (e: any) {
    res.status(Number(e?.status) || 502).json({ error: e?.code || 'GEMINI_GENERATION_FAILED', message: e?.message });
  }
});

router.post('/:patientId/simulator/ai-multi-view', requireRole(...CLINICAL), async (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  const record = resolveHairGeminiFromEnv();
  if (!record?.enabled) {
    res.status(409).json({
      error: record ? 'GEMINI_DISABLED' : 'GEMINI_NOT_CONFIGURED',
      message: record
        ? 'Gemini hair visualization is disabled.'
        : 'Missing env GEMINI_API_KEY.',
      missing: record ? undefined : 'GEMINI_API_KEY',
    });
    return;
  }
  const photo = readDemoPhoto();
  if (!photo) {
    res.status(503).json({ error: 'BASE_IMAGE_NOT_FOUND', message: 'Demo photo asset missing from build.' });
    return;
  }
  const safe = parseSimBody(req.body);
  const viewPrompts: Record<string, string> = {
    front: 'Show the result from a direct front view (looking at the person face-to-face).',
    top: 'Show the result from a top-down view (looking straight down at the top of the head).',
    side: 'Show the result from a left-side profile view.',
    back: 'Show the result from a direct back view (donor area and new coverage visible).',
  };
  const views = Object.keys(viewPrompts);
  const results: any[] = [];
  let cursor = 0;
  const concurrency = 2;
  async function worker() {
    while (cursor < views.length) {
      const idx = cursor++;
      const v = views[idx];
      const params = { ...safe, view: v };
      const basePrompt = buildPhotoEditPrompt(params);
      const fullPrompt = `${basePrompt}\n- CAMERA: ${viewPrompts[v]}`;
      try {
        const art = await callGeminiImageEdit({
          record,
          prompt: fullPrompt,
          photoBase64: photo!.base64,
          photoMime: photo!.mime,
        });
        results.push({
          view: v,
          label: viewPrompts[v],
          outputDataUrl: watermarkedImageDataUrl(art.image),
          model: record!.model,
        });
      } catch (error: any) {
        results.push({
          view: v,
          label: viewPrompts[v],
          error: error?.message || 'Gemini failed',
          code: error?.code || 'GEMINI_FAILED',
        });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  logAudit({
    tenantId: req.tenantId!,
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'hair_simulator_ai_multi_view',
    resourceType: 'hair_simulation',
    resourceId: patient.id,
    afterValue: { count: results.length, model: record.model },
  });
  res.json({
    views: results,
    baseImage: `/api/clinical/hair/base-image`,
    caseId: safe.caseId,
    model: record.model,
  });
});

const tallySchema = z.object({
  session_label: z.string().min(1).max(80).default('Session 1'),
  extracted: z.number().int().min(0).default(0),
  implanted: z.number().int().min(0).default(0),
  discarded: z.number().int().min(0).default(0),
  damaged: z.number().int().min(0).default(0),
  remaining: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional().nullable(),
});

router.get('/:patientId/procedure', requireRole(...CLINICAL), (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  ensureHairSchema();
  const rows = db.prepare(`
    SELECT * FROM hair_procedure_tallies
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY updated_at DESC
  `).all(req.tenantId, patient.id);
  res.json({
    tallies: rows,
    invariant: 'extracted = implanted + discarded + damaged + remaining',
    phases: [
      { id: 'prep', label: 'Preparation', description: 'Consent, photos, donor/recipient marking.' },
      { id: 'harvest', label: 'Harvesting', description: 'Device, punch, donor zones and extraction count.' },
      { id: 'prep_grafts', label: 'Graft preparation', description: '1/2/3/4+ hair units, solution, temperature and time.' },
      { id: 'implant', label: 'Implantation', description: 'Recipient-zone count, direction and angle notes.' },
      { id: 'closure', label: 'Closure', description: 'Reconciliation, adverse events and discharge.' },
    ],
  });
});

router.put('/:patientId/procedure/tally', requireRole(...CLINICAL), (req, res) => {
  const patient = assertPatient(req, res);
  if (!patient) return;
  const parsed = tallySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const sumParts = d.implanted + d.discarded + d.damaged + d.remaining;
  const reconciled = d.extracted === sumParts;
  ensureHairSchema();
  const id = uuid();
  db.prepare(`
    INSERT INTO hair_procedure_tallies
      (id, tenant_id, patient_id, session_label, extracted, implanted, discarded, damaged, remaining, notes, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id, patient_id, session_label) DO UPDATE SET
      extracted = excluded.extracted,
      implanted = excluded.implanted,
      discarded = excluded.discarded,
      damaged = excluded.damaged,
      remaining = excluded.remaining,
      notes = excluded.notes,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `).run(
    id,
    req.tenantId,
    patient.id,
    d.session_label,
    d.extracted,
    d.implanted,
    d.discarded,
    d.damaged,
    d.remaining,
    d.notes || null,
    req.user!.id,
  );
  logAudit({
    tenantId: req.tenantId!,
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'hair_procedure_tally',
    resourceType: 'hair_procedure',
    resourceId: patient.id,
    afterValue: { ...d, reconciled },
  });
  res.json({ ok: true, reconciled, invariant_ok: reconciled });
});

export default router;
