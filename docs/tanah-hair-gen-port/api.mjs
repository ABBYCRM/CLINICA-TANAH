// API layer for the hair-transplant image generator.
// One Express router. Endpoints:
//   GET  /api/health         — liveness check (DO health check target)
//   GET  /api/presets        — full parameter catalog
//   POST /api/generate       — single AI image generation
//   POST /api/variants       — 3 looks at the same params
//   POST /api/multi-view     — 4 perspectives (front/top/left/right)
//   POST /api/parametric     — deterministic SVG fallback (no AI)
//
// All endpoints accept JSON unless noted. The /api/generate endpoint
// also accepts multipart/form-data with a 'photo' file field for
// direct file upload (the test UI uses this). Identity-preservation
// prompt engineering is in gemini.mjs.

import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEditPrompt, sanitizeParams, assertSafe, callGemini,
  GEMINI_MODELS, MODEL_DEFAULT, VIEW_PROSE
} from './gemini.mjs';
import {
  HAIRLINE_PRESETS, ZONE_PRESETS, LENGTH_PRESETS, COLOR_PRESETS,
  CURL_PRESETS, FULLNESS_PRESETS, TECHNIQUE_PRESETS, SESSION_PRESETS,
  GRAFT_SCENARIOS, VIEW_CATALOG
} from './presets.mjs';
import { watermarkedImageDataUrl } from './watermark.mjs';
import { renderParametricSvg } from './parametric.mjs';
import { randomId } from './security.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const publicRoot = path.resolve(__dirname, 'static');

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;  // 12 MB
const ALLOWED_PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES } });

function sendProblem(res, status, code, title, detail) {
  res.status(status).type('application/problem+json').send({
    type: `about:blank`,
    title, status, code, detail: detail || title
  });
}

// Pull the photo + parameters from a request. The caller MUST provide
// a photo — either as a multipart file or as base64 in JSON. There is
// no default/demo photo anymore; the CRM is expected to upload a real
// patient photo.
async function extractInputs(req) {
  if (req.is('multipart/form-data') || req.is('application/x-www-form-urlencoded')) {
    const photo = req.file;
    if (photo) {
      if (!ALLOWED_PHOTO_MIME.has(photo.mimetype)) {
        const err = new Error(`Unsupported photo MIME type: ${photo.mimetype}. Use JPEG, PNG, or WebP.`);
        err.status = 415; throw err;
      }
      if (photo.size > MAX_PHOTO_BYTES) {
        const err = new Error(`Photo is larger than ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`);
        err.status = 413; throw err;
      }
      return {
        photoBase64: photo.buffer.toString('base64'),
        photoMime: photo.mimetype,
        params: sanitizeParams(req.body || {})
      };
    }
    // multipart with no file → 400, the caller forgot the photo
    const err = new Error('No photo provided. Multipart upload must include a "photo" file field.');
    err.status = 400; throw err;
  }
  const body = req.body || {};
  if (body.photoBase64) {
    return {
      photoBase64: body.photoBase64,
      photoMime: body.photoMime || 'image/jpeg',
      params: sanitizeParams(body.params || body)
    };
  }
  // JSON body without a photo → 400
  const err = new Error('No photo provided. JSON body must include "photoBase64" (and optionally "photoMime").');
  err.status = 400; throw err;
}

export function buildApi({ apiKey, model = MODEL_DEFAULT, fetchImpl = fetch }) {
  const router = express.Router();
  router.use(express.json({ limit: '15mb' }));
  router.use(express.urlencoded({ limit: '15mb', extended: true }));

  // ---- Health check ----
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'tanah-hair-gen',
      time: new Date().toISOString(),
      gemini: {
        configured: Boolean(apiKey),
        model,
        available: GEMINI_MODELS
      }
    });
  });

  // ---- Presets catalog ----
  router.get('/presets', (_req, res) => {
    res.json({
      hairlines: Object.values(HAIRLINE_PRESETS),
      zones: Object.values(ZONE_PRESETS),
      lengths: Object.values(LENGTH_PRESETS),
      colors: Object.values(COLOR_PRESETS),
      curls: Object.values(CURL_PRESETS),
      fullnesses: Object.values(FULLNESS_PRESETS),
      techniques: Object.values(TECHNIQUE_PRESETS),
      sessions: Object.values(SESSION_PRESETS),
      graftScenarios: Object.values(GRAFT_SCENARIOS),
      views: VIEW_CATALOG
    });
  });

  // ---- Single generate ----
  router.post('/generate', upload.single('photo'), async (req, res) => {
    try {
      const { photoBase64, photoMime, params } = await extractInputs(req);
      if (!photoBase64) return sendProblem(res, 503, 'NO_PHOTO', 'No photo available', 'Upload a photo or include photoBase64 in the JSON body.');
      const prompt = buildEditPrompt(params);
      assertSafe(prompt);
      const { image } = await callGemini({ apiKey, model, prompt, photoBase64, photoMime, fetchImpl });
      const watermarked = watermarkedImageDataUrl({ image, view: params.view });
      res.status(201).json({
        id: randomId(),
        model,
        view: params.view,
        outputDataUrl: watermarked,
        rawImageDataUrl: `data:${image.mimeType};base64,${image.data}`,
        params,
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      const status = Number(err?.status) || 500;
      if (status >= 500) console.error('[generate]', err?.stack || err);
      return sendProblem(res, status, err?.code || 'GENERATION_FAILED', 'Generation failed', err?.message || 'The image generator failed.');
    }
  });

  // ---- 3 variants at the same parameters ----
  router.post('/variants', upload.single('photo'), async (req, res) => {
    try {
      const { photoBase64, photoMime, params } = await extractInputs(req);
      if (!photoBase64) return sendProblem(res, 503, 'NO_PHOTO', 'No photo available', 'Upload a photo or include photoBase64 in the JSON body.');
      const variants = ['conservative', 'balanced', 'restorative'];
      const artifacts = await Promise.all(variants.map(async (hairline) => {
        const variantParams = { ...params, hairline };
        const prompt = buildEditPrompt(variantParams);
        assertSafe(prompt);
        try {
          const { image } = await callGemini({ apiKey, model, prompt, photoBase64, photoMime, fetchImpl });
          return {
            hairline,
            outputDataUrl: watermarkedImageDataUrl({ image, view: variantParams.view }),
            rawImageDataUrl: `data:${image.mimeType};base64,${image.data}`,
            params: variantParams
          };
        } catch (error) {
          return { hairline, error: error?.message || 'Gemini failed', code: error?.code || 'GEMINI_FAILED' };
        }
      }));
      res.json({ variants: artifacts, params });
    } catch (err) {
      const status = Number(err?.status) || 500;
      if (status >= 500) console.error('[variants]', err?.stack || err);
      return sendProblem(res, status, err?.code || 'VARIANTS_FAILED', 'Variant generation failed', err?.message);
    }
  });

  // ---- 4 perspectives (front / top / left / right) ----
  router.post('/multi-view', upload.single('photo'), async (req, res) => {
    try {
      const { photoBase64, photoMime, params } = await extractInputs(req);
      if (!photoBase64) return sendProblem(res, 503, 'NO_PHOTO', 'No photo available', 'Upload a photo or include photoBase64 in the JSON body.');
      const concurrency = 2;
      const views = ['front', 'top', 'left', 'right'];
      const results = new Array(views.length);
      let cursor = 0;
      async function worker() {
        while (cursor < views.length) {
          const idx = cursor++;
          const view = views[idx];
          const viewParams = { ...params, view };
          const basePrompt = buildEditPrompt(viewParams);
          const viewPrompt = basePrompt + `\n- CAMERA: ${VIEW_PROSE[view] || ''}`;
          assertSafe(viewPrompt);
          try {
            const { image } = await callGemini({ apiKey, model, prompt: viewPrompt, photoBase64, photoMime, fetchImpl });
            results[idx] = {
              view,
              outputDataUrl: watermarkedImageDataUrl({ image, view }),
              rawImageDataUrl: `data:${image.mimeType};base64,${image.data}`,
              params: viewParams
            };
          } catch (error) {
            results[idx] = { view, error: error?.message || 'Gemini failed', code: error?.code || 'GEMINI_FAILED' };
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, worker));
      res.json({ views: results, params, model });
    } catch (err) {
      const status = Number(err?.status) || 500;
      if (status >= 500) console.error('[multi-view]', err?.stack || err);
      return sendProblem(res, status, err?.code || 'MULTIVIEW_FAILED', 'Multi-view generation failed', err?.message);
    }
  });

  // ---- Deterministic SVG fallback (no AI) ----
  // Always returns. Use this for fast previews or when Gemini is down.
  router.post('/parametric', upload.single('photo'), async (req, res) => {
    try {
      const { photoBase64, photoMime, params } = await extractInputs(req);
      const seed = Number.isInteger(req.body?.seed) ? req.body.seed : undefined;
      const svg = renderParametricSvg({ params, photoBase64, photoMime, seed });
      const base64 = Buffer.from(svg).toString('base64');
      res.status(201).json({
        id: randomId(),
        // Echo model + view so the front-end meta line is consistent
        // with /api/generate (the UI shows the same fields for both paths).
        model: 'parametric-svg',
        view: params.view,
        outputDataUrl: `data:image/svg+xml;base64,${base64}`,
        seed: seed !== undefined ? seed : null,
        params: sanitizeParams(params),
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      const status = Number(err?.status) || 500;
      if (status >= 500) console.error('[parametric]', err?.stack || err);
      return sendProblem(res, status, 'PARAMETRIC_FAILED', 'Parametric render failed', err?.message);
    }
  });

  return router;
}
