/**
 * Body composition scenario imagery — ultra-realistic clinical visualizations.
 *
 * Provider order (BodyPath-compatible): A2E (nano-banana-pro 4K) → Gemini image.
 * Images illustrate professionally mediated scenarios — NOT autonomous diagnosis.
 */
import fs from 'fs';
import path from 'path';
import { uploadsRoot } from './nvidiaOcr';

export type ImageGenResult = {
  provider: 'a2e' | 'gemini';
  taskId?: string;
  status: 'completed' | 'pending' | 'failed';
  imageUrl?: string;
  imageBytes?: Buffer;
  contentType?: string;
  error?: string;
  raw?: unknown;
};

const A2E_BASE = process.env.A2E_BASE_URL || 'https://video.a2e.ai';
const A2E_MODEL = process.env.A2E_MODEL || 'nano-banana-pro';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';

export function bodyUploadsDir(tenantId: string, patientId: string): string {
  const dir = path.join(uploadsRoot(), tenantId, 'body', patientId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function calcBmi(heightCm?: number | null, weightKg?: number | null): number | null {
  if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function buildScenarioPrompt(opts: {
  sex?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  waistCm?: number | null;
  weeks?: number | null;
  goal?: string | null;
  hasReferencePhoto?: boolean;
}): string {
  const weeks = opts.weeks || 12;
  const goal = (opts.goal || 'diet+exercise illustrative simulation').trim();
  const sex = opts.sex === 'M' || opts.sex === 'male' ? 'male' : 'female';
  const metrics = [
    opts.heightCm != null ? `height ${opts.heightCm} cm` : null,
    opts.weightKg != null ? `weight ${opts.weightKg} kg` : null,
    opts.waistCm != null ? `waist ${opts.waistCm} cm` : null,
    calcBmi(opts.heightCm, opts.weightKg) != null ? `BMI ${calcBmi(opts.heightCm, opts.weightKg)}` : null,
  ].filter(Boolean).join(', ');

  const identity = opts.hasReferencePhoto
    ? 'Edit this clinical front-view photograph of the SAME adult patient. Preserve absolute identity, facial features, skin tone, clothing style/color, pose, camera framing, and studio background.'
    : `Create a photorealistic clinical full-body front-view photograph of an adult ${sex} patient for body-composition educational visualization. Neutral studio lighting, accurate anatomy, natural skin texture, professional medical photography.`;

  return [
    identity,
    `Apply modest soft-tissue change for a ${weeks}-week ${goal}.`,
    metrics ? `Contextual anthropometrics (do not render as on-image text overlays except the watermark): ${metrics}.` : '',
    'Stay true to nature: ultra-realistic professional 4K-grade imagery, natural proportions, no cartoon, no beauty-filter exaggeration, no surgical alteration.',
    'Photoreal only. Burn discreet watermark: SIMULACAO ILUSTRATIVA - NAO E PREVISAO.',
    'Intended use: professionally mediated scenario visualization — not autonomous diagnosis or outcome guarantee.',
  ].filter(Boolean).join(' ');
}

function a2eEnabled(): boolean {
  return process.env.A2E_ENABLED !== '0' && !!process.env.A2E_API_KEY;
}

function geminiEnabled(): boolean {
  return process.env.GEMINI_ENABLED !== '0' && !!process.env.GEMINI_API_KEY;
}

function providerOrder(): Array<'a2e' | 'gemini'> {
  const raw = (process.env.IMAGE_PROVIDER_ORDER || 'a2e,gemini')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out: Array<'a2e' | 'gemini'> = [];
  for (const p of raw) {
    if (p === 'a2e' && a2eEnabled()) out.push('a2e');
    if (p === 'gemini' && geminiEnabled()) out.push('gemini');
  }
  if (!out.length) {
    if (a2eEnabled()) out.push('a2e');
    if (geminiEnabled()) out.push('gemini');
  }
  return out;
}

async function startA2e(opts: {
  name: string;
  prompt: string;
  inputImages?: string[];
}): Promise<ImageGenResult> {
  const key = process.env.A2E_API_KEY!;
  const body: Record<string, unknown> = {
    name: opts.name,
    prompt: opts.prompt,
    model: A2E_MODEL,
    aspect_ratio: '3:4',
    image_size: process.env.A2E_IMAGE_SIZE || '4K',
  };
  if (opts.inputImages?.length) body.input_images = opts.inputImages.slice(0, 2);

  const res = await fetch(`${A2E_BASE}/api/v1/userNanoBanana/start`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.code !== 0) {
    return {
      provider: 'a2e',
      status: 'failed',
      error: json?.message || json?.msg || `a2e_http_${res.status}`,
      raw: json,
    };
  }
  const data = json.data || {};
  const taskId = data._id || data.id;
  const urls: string[] = data.image_urls || [];
  if (urls.length) {
    return { provider: 'a2e', taskId, status: 'completed', imageUrl: urls[0], raw: json };
  }
  return { provider: 'a2e', taskId, status: 'pending', raw: json };
}

export async function pollA2e(taskId: string): Promise<ImageGenResult> {
  const key = process.env.A2E_API_KEY!;
  const res = await fetch(`${A2E_BASE}/api/v1/userNanoBanana/detail/${taskId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.code !== 0) {
    return { provider: 'a2e', taskId, status: 'failed', error: `a2e_poll_${res.status}`, raw: json };
  }
  const data = json.data || {};
  const status = String(data.current_status || data.status || '').toLowerCase();
  const urls: string[] = data.image_urls || [];
  if (status === 'completed' && urls.length) {
    return { provider: 'a2e', taskId, status: 'completed', imageUrl: urls[0], raw: json };
  }
  if (status === 'failed' || status === 'error') {
    return {
      provider: 'a2e',
      taskId,
      status: 'failed',
      error: data.failed_message || 'a2e_failed',
      raw: json,
    };
  }
  return { provider: 'a2e', taskId, status: 'pending', raw: json };
}

async function generateGemini(opts: {
  prompt: string;
  referenceBytes?: Buffer;
  referenceMime?: string;
}): Promise<ImageGenResult> {
  const key = process.env.GEMINI_API_KEY!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const parts: any[] = [{ text: opts.prompt }];
  if (opts.referenceBytes?.length) {
    parts.unshift({
      inline_data: {
        mime_type: opts.referenceMime || 'image/jpeg',
        data: opts.referenceBytes.toString('base64'),
      },
    });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      provider: 'gemini',
      status: 'failed',
      error: json?.error?.message || `gemini_http_${res.status}`,
      raw: json,
    };
  }
  const candidates = json?.candidates || [];
  for (const c of candidates) {
    for (const p of c?.content?.parts || []) {
      const inline = p.inlineData || p.inline_data;
      if (inline?.data) {
        return {
          provider: 'gemini',
          status: 'completed',
          imageBytes: Buffer.from(inline.data, 'base64'),
          contentType: inline.mimeType || inline.mime_type || 'image/png',
          raw: { model: GEMINI_MODEL },
        };
      }
    }
  }
  return { provider: 'gemini', status: 'failed', error: 'gemini_no_image', raw: json };
}

/** Public HTTPS URL for A2E reference (temporary signed local file via APP_ORIGIN if available). */
export async function generateBodyScenarioImage(opts: {
  name: string;
  prompt: string;
  referencePath?: string | null;
  referencePublicUrl?: string | null;
}): Promise<ImageGenResult> {
  const order = providerOrder();
  if (!order.length) {
    return { provider: 'a2e', status: 'failed', error: 'no_image_provider_configured' };
  }

  let last: ImageGenResult | null = null;
  for (const provider of order) {
    try {
      if (provider === 'a2e') {
        const inputImages = opts.referencePublicUrl ? [opts.referencePublicUrl] : undefined;
        last = await startA2e({ name: opts.name, prompt: opts.prompt, inputImages });
        if (last.status !== 'failed') return last;
        continue;
      }
      if (provider === 'gemini') {
        let referenceBytes: Buffer | undefined;
        let referenceMime: string | undefined;
        if (opts.referencePath && fs.existsSync(opts.referencePath)) {
          referenceBytes = fs.readFileSync(opts.referencePath);
          referenceMime = opts.referencePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
        }
        last = await generateGemini({
          prompt: opts.prompt,
          referenceBytes,
          referenceMime,
        });
        if (last.status !== 'failed') return last;
      }
    } catch (e: any) {
      last = {
        provider,
        status: 'failed',
        error: e?.message || String(e),
      };
    }
  }
  return last || { provider: 'a2e', status: 'failed', error: 'image_generation_failed' };
}

export function imageProvidersStatus() {
  return {
    a2e: a2eEnabled(),
    gemini: geminiEnabled(),
    order: providerOrder(),
    a2e_model: A2E_MODEL,
    gemini_model: GEMINI_MODEL,
  };
}
