/**
 * Hair transplant image generator routes — port of TANAH-HAIR-GEN
 * mounted under /api/clinical/hair with CRM auth + patient scoping.
 *
 * Endpoints (parity with GEN):
 *   GET  /presets
 *   GET  /status                    — gemini configured?
 *   GET  /:patientId/history
 *   POST /:patientId/generate
 *   POST /:patientId/variants
 *   POST /:patientId/multi-view
 *   POST /:patientId/parametric
 */
import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { presetsCatalog } from '../services/hairGen/presets';
import {
  assertSafe,
  buildEditPrompt,
  callGemini,
  resolveHairGeminiFromEnv,
  sanitizeParams,
  VIEW_PROSE,
} from '../services/hairGen/gemini';
import { watermarkedImageDataUrl } from '../services/hairGen/watermark';
import { renderParametricSvg } from '../services/hairGen/parametric';

const router = Router();
router.use(authenticate);

const CLINICAL = ['admin', 'doctor', 'nurse'] as const;
const WRITE = ['admin', 'doctor'] as const;

const MAX_PHOTO_CHARS = Math.ceil((12 * 1024 * 1024 * 4) / 3); // ~12MB base64

function randomId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}

function ensureHairSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hair_generations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      model TEXT,
      view TEXT,
      params_json TEXT NOT NULL,
      output_data_url TEXT,
      raw_image_data_url TEXT,
      results_json TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_hair_gen_patient
      ON hair_generations(tenant_id, patient_id, created_at DESC);
  `);
}

function patientInTenant(patientId: string, tenantId: string) {
  return db.prepare(`SELECT id, full_name FROM patients WHERE id = ? AND tenant_id = ?`).get(patientId, tenantId) as
    | { id: string; full_name: string }
    | undefined;
}

function sendProblem(res: Response, status: number, code: string, title: string, detail?: string) {
  res.status(status).type('application/problem+json').send({
    type: 'about:blank',
    title,
    status,
    code,
    detail: detail || title,
  });
}

const photoBodySchema = z.object({
  photoBase64: z.string().min(8).max(MAX_PHOTO_CHARS),
  photoMime: z.string().optional(),
  params: z.record(z.any()).optional(),
  seed: z.number().int().optional(),
}).passthrough();

function extractPhoto(body: any): { photoBase64: string; photoMime: string; params: ReturnType<typeof sanitizeParams>; seed?: number } {
  const parsed = photoBodySchema.safeParse(body);
  if (!parsed.success) {
    const err: any = new Error('No photo provided. JSON body must include "photoBase64" (and optionally "photoMime").');
    err.status = 400;
    err.code = 'NO_PHOTO';
    throw err;
  }
  const mime = (parsed.data.photoMime || 'image/jpeg').toLowerCase();
  const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
  if (!allowed.has(mime)) {
    const err: any = new Error(`Unsupported photo MIME type: ${mime}. Use JPEG, PNG, or WebP.`);
    err.status = 415;
    err.code = 'UNSUPPORTED_MEDIA';
    throw err;
  }
  const params = sanitizeParams({ ...(parsed.data.params || {}), ...parsed.data });
  return {
    photoBase64: parsed.data.photoBase64.replace(/^data:[^;]+;base64,/, ''),
    photoMime: mime === 'image/jpg' ? 'image/jpeg' : mime,
    params,
    seed: parsed.data.seed,
  };
}

function persistGeneration(opts: {
  tenantId: string;
  patientId: string;
  userId?: string;
  mode: string;
  model: string | null;
  view: string | null;
  params: any;
  outputDataUrl?: string | null;
  rawImageDataUrl?: string | null;
  results?: any;
  id?: string;
}) {
  ensureHairSchema();
  const id = opts.id || randomId();
  db.prepare(`
    INSERT INTO hair_generations
      (id, tenant_id, patient_id, mode, model, view, params_json, output_data_url, raw_image_data_url, results_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.tenantId,
    opts.patientId,
    opts.mode,
    opts.model,
    opts.view,
    JSON.stringify(opts.params),
    opts.outputDataUrl ?? null,
    opts.rawImageDataUrl ?? null,
    opts.results ? JSON.stringify(opts.results) : null,
    opts.userId ?? null,
  );
  return id;
}

router.get('/presets', requireRole(...CLINICAL), (_req: Request, res: Response) => {
  const gemini = resolveHairGeminiFromEnv();
  res.json({ ...presetsCatalog(), geminiModels: gemini.available, geminiModel: gemini.model });
});

router.get('/status', requireRole(...CLINICAL), (_req: Request, res: Response) => {
  const gemini = resolveHairGeminiFromEnv();
  res.json({
    status: 'ok',
    service: 'tanah-hair-gen',
    time: new Date().toISOString(),
    gemini: {
      configured: gemini.configured,
      model: gemini.model,
      available: gemini.available,
    },
  });
});

router.get('/:patientId/history', requireRole(...CLINICAL), (req: Request, res: Response) => {
  ensureHairSchema();
  const patient = patientInTenant(req.params.patientId, req.tenantId!);
  if (!patient) return res.status(404).json({ error: 'patient_not_found' });
  const rows = db.prepare(`
    SELECT id, mode, model, view, params_json, output_data_url, created_at, created_by
    FROM hair_generations
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC
    LIMIT 40
  `).all(req.tenantId, req.params.patientId) as any[];
  res.json({
    patient_id: patient.id,
    patient_name: patient.full_name,
    generations: rows.map((r) => ({
      id: r.id,
      mode: r.mode,
      model: r.model,
      view: r.view,
      params: JSON.parse(r.params_json || '{}'),
      outputDataUrl: r.output_data_url,
      createdAt: r.created_at,
      createdBy: r.created_by,
    })),
  });
});

router.post('/:patientId/generate', requireRole(...WRITE), async (req: Request, res: Response) => {
  try {
    const patient = patientInTenant(req.params.patientId, req.tenantId!);
    if (!patient) return res.status(404).json({ error: 'patient_not_found' });
    const { photoBase64, photoMime, params } = extractPhoto(req.body);
    const gemini = resolveHairGeminiFromEnv();
    const prompt = buildEditPrompt(params);
    assertSafe(prompt);
    const { image } = await callGemini({
      apiKey: gemini.apiKey,
      model: gemini.model,
      prompt,
      photoBase64,
      photoMime,
    });
    const watermarked = watermarkedImageDataUrl({ image, view: params.view });
    const rawImageDataUrl = `data:${image.mimeType};base64,${image.data}`;
    const id = persistGeneration({
      tenantId: req.tenantId!,
      patientId: patient.id,
      userId: req.user!.id,
      mode: 'generate',
      model: gemini.model,
      view: params.view,
      params,
      outputDataUrl: watermarked,
      rawImageDataUrl,
    });
    logAudit({
      tenantId: req.tenantId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'hair_generate',
      resourceType: 'hair_generation',
      resourceId: id,
      legalBasis: 'health_protection_art7_VIII',
      afterValue: { mode: 'generate', model: gemini.model, view: params.view, patientId: patient.id },
    });
    res.status(201).json({
      id,
      model: gemini.model,
      view: params.view,
      outputDataUrl: watermarked,
      rawImageDataUrl,
      params,
      createdAt: new Date().toISOString(),
      patientId: patient.id,
    });
  } catch (err: any) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error('[hair/generate]', err?.stack || err);
    return sendProblem(res, status, err?.code || 'GENERATION_FAILED', 'Generation failed', err?.message || 'The image generator failed.');
  }
});

router.post('/:patientId/variants', requireRole(...WRITE), async (req: Request, res: Response) => {
  try {
    const patient = patientInTenant(req.params.patientId, req.tenantId!);
    if (!patient) return res.status(404).json({ error: 'patient_not_found' });
    const { photoBase64, photoMime, params } = extractPhoto(req.body);
    const gemini = resolveHairGeminiFromEnv();
    const variants = ['conservative', 'balanced', 'restorative'] as const;
    const artifacts = await Promise.all(variants.map(async (hairline) => {
      const variantParams = { ...params, hairline };
      const prompt = buildEditPrompt(variantParams);
      assertSafe(prompt);
      try {
        const { image } = await callGemini({
          apiKey: gemini.apiKey,
          model: gemini.model,
          prompt,
          photoBase64,
          photoMime,
        });
        return {
          hairline,
          outputDataUrl: watermarkedImageDataUrl({ image, view: variantParams.view }),
          rawImageDataUrl: `data:${image.mimeType};base64,${image.data}`,
          params: variantParams,
        };
      } catch (error: any) {
        return { hairline, error: error?.message || 'Gemini failed', code: error?.code || 'GEMINI_FAILED' };
      }
    }));
    const firstOk = artifacts.find((a: any) => a.outputDataUrl) as any;
    const id = persistGeneration({
      tenantId: req.tenantId!,
      patientId: patient.id,
      userId: req.user!.id,
      mode: 'variants',
      model: gemini.model,
      view: params.view,
      params,
      outputDataUrl: firstOk?.outputDataUrl ?? null,
      results: artifacts,
    });
    logAudit({
      tenantId: req.tenantId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'hair_variants',
      resourceType: 'hair_generation',
      resourceId: id,
      legalBasis: 'health_protection_art7_VIII',
      afterValue: { mode: 'variants', patientId: patient.id, ok: artifacts.filter((a: any) => a.outputDataUrl).length },
    });
    res.json({ id, variants: artifacts, params, patientId: patient.id });
  } catch (err: any) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error('[hair/variants]', err?.stack || err);
    return sendProblem(res, status, err?.code || 'VARIANTS_FAILED', 'Variant generation failed', err?.message);
  }
});

router.post('/:patientId/multi-view', requireRole(...WRITE), async (req: Request, res: Response) => {
  try {
    const patient = patientInTenant(req.params.patientId, req.tenantId!);
    if (!patient) return res.status(404).json({ error: 'patient_not_found' });
    const { photoBase64, photoMime, params } = extractPhoto(req.body);
    const gemini = resolveHairGeminiFromEnv();
    const concurrency = 2;
    const views = ['front', 'top', 'left', 'right'];
    const results = new Array(views.length);
    let cursor = 0;
    async function worker() {
      while (cursor < views.length) {
        const idx = cursor++;
        const view = views[idx];
        const viewParams = { ...params, view };
        const viewPrompt = `${buildEditPrompt(viewParams)}\n- CAMERA: ${VIEW_PROSE[view] || ''}`;
        assertSafe(viewPrompt);
        try {
          const { image } = await callGemini({
            apiKey: gemini.apiKey,
            model: gemini.model,
            prompt: viewPrompt,
            photoBase64,
            photoMime,
          });
          results[idx] = {
            view,
            outputDataUrl: watermarkedImageDataUrl({ image, view }),
            rawImageDataUrl: `data:${image.mimeType};base64,${image.data}`,
            params: viewParams,
          };
        } catch (error: any) {
          results[idx] = { view, error: error?.message || 'Gemini failed', code: error?.code || 'GEMINI_FAILED' };
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const firstOk = results.find((a: any) => a?.outputDataUrl);
    const id = persistGeneration({
      tenantId: req.tenantId!,
      patientId: patient.id,
      userId: req.user!.id,
      mode: 'multi-view',
      model: gemini.model,
      view: params.view,
      params,
      outputDataUrl: firstOk?.outputDataUrl ?? null,
      results,
    });
    logAudit({
      tenantId: req.tenantId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'hair_multi_view',
      resourceType: 'hair_generation',
      resourceId: id,
      legalBasis: 'health_protection_art7_VIII',
      afterValue: { mode: 'multi-view', patientId: patient.id },
    });
    res.json({ id, views: results, params, model: gemini.model, patientId: patient.id });
  } catch (err: any) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error('[hair/multi-view]', err?.stack || err);
    return sendProblem(res, status, err?.code || 'MULTIVIEW_FAILED', 'Multi-view generation failed', err?.message);
  }
});

router.post('/:patientId/parametric', requireRole(...WRITE), async (req: Request, res: Response) => {
  try {
    const patient = patientInTenant(req.params.patientId, req.tenantId!);
    if (!patient) return res.status(404).json({ error: 'patient_not_found' });
    const { photoBase64, photoMime, params, seed } = extractPhoto(req.body);
    const svg = renderParametricSvg({ params, photoBase64, photoMime, seed });
    const outputDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const id = persistGeneration({
      tenantId: req.tenantId!,
      patientId: patient.id,
      userId: req.user!.id,
      mode: 'parametric',
      model: 'parametric-svg',
      view: params.view,
      params,
      outputDataUrl,
    });
    logAudit({
      tenantId: req.tenantId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'hair_parametric',
      resourceType: 'hair_generation',
      resourceId: id,
      legalBasis: 'health_protection_art7_VIII',
      afterValue: { mode: 'parametric', patientId: patient.id },
    });
    res.status(201).json({
      id,
      model: 'parametric-svg',
      view: params.view,
      outputDataUrl,
      seed: seed !== undefined ? seed : null,
      params,
      createdAt: new Date().toISOString(),
      patientId: patient.id,
    });
  } catch (err: any) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error('[hair/parametric]', err?.stack || err);
    return sendProblem(res, status, err?.code || 'PARAMETRIC_FAILED', 'Parametric render failed', err?.message);
  }
});

export default router;
export { ensureHairSchema };
