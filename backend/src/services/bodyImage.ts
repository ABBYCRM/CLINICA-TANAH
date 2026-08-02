/**
 * Body composition scenario imagery — ultra-realistic clinical visualizations.
 *
 * Provider order (BodyPath-compatible): A2E → Gemini → Bitdeer → local_morph fallback.
 * Images illustrate professionally mediated scenarios — NOT autonomous diagnosis.
 */
import fs from 'fs';
import path from 'path';
import { uploadsRoot } from './nvidiaOcr';

export type ImageProvider = 'a2e' | 'gemini' | 'bitdeer' | 'local_morph';

export type ImageGenResult = {
  provider: ImageProvider;
  taskId?: string;
  status: 'completed' | 'pending' | 'failed';
  imageUrl?: string;
  imageBytes?: Buffer;
  contentType?: string;
  error?: string;
  raw?: unknown;
};

/** Quantitative guidance from If/Then body-composition envelope → after-image morph. */
export type MorphGuidance = {
  silhouette_delta_pct: number;
  regional_deltas_pct: Record<string, number>;
  weight_delta_kg?: number | null;
  fat_delta_kg?: number | null;
  waist_delta_cm?: number | null;
  identity_locks?: string[];
  effective_silhouette_delta_pct?: number;
  /** Visual morph cap (%); raised when clinician owns predicted Δkg. */
  effective_silhouette_cap_pct?: number;
};

/** Extract morph guidance from enriched scenario execution_plan / anatomical envelope. */
export function morphGuidanceFromEnvelope(envelope: any | null | undefined): MorphGuidance | null {
  if (!envelope) return null;
  const pipe = envelope.img2img_pipeline_config || envelope.anatomicalEnvelope?.img2img_pipeline_config;
  const regions = envelope.regional_anatomical_deltas_pct
    || envelope.anatomicalEnvelope?.regional_anatomical_deltas_pct
    || Object.fromEntries(
      (envelope.anatomicalEnvelope?.regions || []).map((r: any) => [r.region, r.deltaPct]),
    );
  const silRaw = Number(
    pipe?.effective_silhouette_delta_pct
      ?? envelope.silhouette_delta_pct
      ?? 0,
  );
  // Prefer signed silhouette from envelope (negative = loss)
  const silSigned = Number(envelope.silhouette_delta_pct ?? 0);
  const cap = Number(
    envelope.visual_silhouette_cap_pct
      ?? pipe?.magnitude_ceiling_pct
      ?? (envelope.doctor_override ? 18 : 7),
  ) || 7;
  const silhouette = silSigned !== 0
    ? Math.max(-cap, Math.min(cap, silSigned))
    : (silRaw ? -Math.min(cap, Math.abs(silRaw)) : -5);
  const locks = pipe?.identity_locks || [
    'face', 'height', 'limb_lengths', 'skin_marks', 'clothing', 'pose', 'background',
  ];
  return {
    silhouette_delta_pct: Math.round(silhouette * 100) / 100,
    regional_deltas_pct: regions || {},
    weight_delta_kg: envelope.deltas?.weight_kg ?? null,
    fat_delta_kg: envelope.deltas?.fat_mass_kg ?? null,
    waist_delta_cm: envelope.deltas?.waist_cm ?? null,
    identity_locks: locks,
    effective_silhouette_cap_pct: cap,
    effective_silhouette_delta_pct: Math.abs(silhouette),
  };
}

const A2E_BASE = process.env.A2E_BASE_URL || 'https://video.a2e.ai';
const A2E_MODEL = process.env.A2E_MODEL || 'nano-banana-pro';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
const BITDEER_MODEL = process.env.BITDEER_MODEL || process.env.BITDEER_IMAGE_MODEL || 'google/flash-image-2.5';

export function bodyUploadsDir(tenantId: string, patientId: string): string {
  const dir = path.join(uploadsRoot(), tenantId, 'body', patientId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** CFM/LGPD clinical retention copies — never purged by soft-delete. */
export function bodyRetainedDir(tenantId: string, patientId: string): string {
  const dir = path.join(bodyUploadsDir(tenantId, patientId), 'retained');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Copy a capture file into the retained/ archive. Returns retained path or null.
 * Never deletes or overwrites the original.
 */
export function retainBodyPhotoCopy(opts: {
  tenantId: string;
  patientId: string;
  assetId: string;
  view: string;
  sourcePath: string;
}): string | null {
  if (!opts.sourcePath || !fs.existsSync(opts.sourcePath)) return null;
  const ext = path.extname(opts.sourcePath) || '.jpg';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(
    bodyRetainedDir(opts.tenantId, opts.patientId),
    `${opts.assetId}-${opts.view}-${stamp}${ext}`,
  );
  try {
    fs.copyFileSync(opts.sourcePath, dest);
    return dest;
  } catch {
    return null;
  }
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
  view?: 'front' | 'left' | 'right' | 'back';
}): string {
  const weeks = opts.weeks || 12;
  const goal = (opts.goal || 'diet+exercise illustrative simulation').trim();
  const sex = opts.sex === 'M' || opts.sex === 'male' ? 'male' : 'female';
  const view = opts.view || 'front';
  const viewLabel =
    view === 'front' ? 'front'
      : view === 'back' ? 'back'
        : view === 'left' ? 'left profile / ¾'
          : 'right profile / ¾';
  const metrics = [
    opts.heightCm != null ? `height ${opts.heightCm} cm` : null,
    opts.weightKg != null ? `weight ${opts.weightKg} kg` : null,
    opts.waistCm != null ? `waist ${opts.waistCm} cm` : null,
    calcBmi(opts.heightCm, opts.weightKg) != null ? `BMI ${calcBmi(opts.heightCm, opts.weightKg)}` : null,
  ].filter(Boolean).join(', ');

  const identity = opts.hasReferencePhoto
    ? `Edit this clinical ${viewLabel}-view photograph of the SAME adult patient. Preserve absolute identity, facial features, skin tone, clothing style/color, pose, camera framing, and studio background. Keep the ${view} viewing angle unchanged.`
    : `Create a photorealistic clinical full-body ${viewLabel}-view photograph of an adult ${sex} patient for body-composition educational visualization. Neutral studio lighting, accurate anatomy, natural skin texture, professional medical photography.`;

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

function bitdeerBaseUrl(): string | null {
  const base = (
    process.env.BITDEER_BASE_URL
    || process.env.BITDEER_API_BASE
    || process.env.BITDEER_API_URL
    || ''
  ).replace(/\/$/, '');
  return base || null;
}

function bitdeerEnabled(): boolean {
  if (process.env.BITDEER_ENABLED === '0') return false;
  return !!(process.env.BITDEER_API_KEY && bitdeerBaseUrl());
}

function localMorphEnabled(): boolean {
  // Default ON as ultimate identity-preserving fallback unless explicitly disabled
  if (process.env.LOCAL_MORPH_FALLBACK === '0' || process.env.LOCAL_MORPH_FALLBACK === 'false') return false;
  return true;
}

function providerOrder(): ImageProvider[] {
  const raw = (process.env.IMAGE_PROVIDER_ORDER || 'a2e,gemini,bitdeer,local_morph')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out: ImageProvider[] = [];
  const push = (p: ImageProvider) => {
    if (!out.includes(p)) out.push(p);
  };
  for (const p of raw) {
    if (p === 'a2e' && a2eEnabled()) push('a2e');
    if (p === 'gemini' && geminiEnabled()) push('gemini');
    if (p === 'bitdeer' && bitdeerEnabled()) push('bitdeer');
    if ((p === 'local_morph' || p === 'local') && localMorphEnabled()) push('local_morph');
  }
  // Always append local_morph last when enabled and not already listed
  if (localMorphEnabled()) push('local_morph');
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

/** Bitdeer / OpenAI-compatible image generate — also supports Gemini-style proxy. */
async function generateBitdeer(opts: {
  prompt: string;
  referencePath?: string | null;
}): Promise<ImageGenResult> {
  const key = process.env.BITDEER_API_KEY;
  const base = bitdeerBaseUrl();
  if (!key || !base) {
    return { provider: 'bitdeer', status: 'failed', error: 'bitdeer_not_configured' };
  }

  const style = (process.env.BITDEER_API_STYLE || 'openai').toLowerCase();

  // Gemini-compatible proxy (BodyPath often uses google/flash-image via Bitdeer)
  if (style === 'gemini' || /generativelanguage|gemini/i.test(base) || /flash-image|gemini/i.test(BITDEER_MODEL)) {
    const model = process.env.BITDEER_MODEL || 'google/flash-image-2.5';
    const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const parts: any[] = [{ text: opts.prompt }];
    if (opts.referencePath && fs.existsSync(opts.referencePath)) {
      parts.unshift({
        inline_data: {
          mime_type: opts.referencePath.endsWith('.png') ? 'image/png' : 'image/jpeg',
          data: fs.readFileSync(opts.referencePath).toString('base64'),
        },
      });
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        provider: 'bitdeer',
        status: 'failed',
        error: json?.error?.message || json?.message || `bitdeer_gemini_http_${res.status}`,
        raw: json,
      };
    }
    for (const c of json?.candidates || []) {
      for (const p of c?.content?.parts || []) {
        const inline = p.inlineData || p.inline_data;
        if (inline?.data) {
          return {
            provider: 'bitdeer',
            status: 'completed',
            imageBytes: Buffer.from(inline.data, 'base64'),
            contentType: inline.mimeType || inline.mime_type || 'image/png',
            raw: { model, style: 'gemini' },
          };
        }
      }
    }
    return { provider: 'bitdeer', status: 'failed', error: 'bitdeer_gemini_no_image', raw: json };
  }

  const endpoint = process.env.BITDEER_GENERATE_PATH || '/v1/images/generations';
  const url = `${base}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const body: Record<string, unknown> = {
    model: BITDEER_MODEL,
    prompt: opts.prompt,
    n: 1,
    size: process.env.BITDEER_IMAGE_SIZE || '1024x1536',
    response_format: 'b64_json',
  };
  if (opts.referencePath && fs.existsSync(opts.referencePath)) {
    body.image = fs.readFileSync(opts.referencePath).toString('base64');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      provider: 'bitdeer',
      status: 'failed',
      error: json?.error?.message || json?.message || `bitdeer_http_${res.status}`,
      raw: json,
    };
  }
  const item = json?.data?.[0] || json?.images?.[0] || json;
  if (item?.b64_json || item?.base64) {
    return {
      provider: 'bitdeer',
      status: 'completed',
      imageBytes: Buffer.from(item.b64_json || item.base64, 'base64'),
      contentType: 'image/png',
      raw: { model: BITDEER_MODEL },
    };
  }
  if (item?.url) {
    return { provider: 'bitdeer', status: 'completed', imageUrl: item.url, raw: json };
  }
  return { provider: 'bitdeer', status: 'failed', error: 'bitdeer_no_image', raw: json };
}

/** Identity-preserving morph: silhouette/regional morph driven by If/Then calculator. */
function localMorphFallback(
  referencePath?: string | null,
  guidance?: MorphGuidance | null,
): ImageGenResult {
  if (!localMorphEnabled()) {
    return { provider: 'local_morph', status: 'failed', error: 'local_morph_disabled' };
  }
  if (!referencePath || !fs.existsSync(referencePath)) {
    return { provider: 'local_morph', status: 'failed', error: 'local_morph_no_reference' };
  }

  const contentType = referencePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const morphed = applyLocalSilhouetteMorph(referencePath, guidance);
  if (morphed) {
    return {
      provider: 'local_morph',
      status: 'completed',
      imageBytes: morphed,
      contentType: 'image/jpeg',
      raw: {
        note: 'identity_preserving_silhouette_morph',
        morph_guidance: guidance || null,
      },
    };
  }

  const imageBytes = fs.readFileSync(referencePath);
  return {
    provider: 'local_morph',
    status: 'completed',
    imageBytes,
    contentType,
    raw: { note: 'identity_preserving_noop_morph' },
  };
}

/** Mean absolute pixel difference 0–1 between before path and after bytes (resized). */
export function afterImageSimilarity(beforePath: string, afterBytes: Buffer): number | null {
  try {
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const tmpAfter = `${beforePath}.cmp-after-${process.pid}.jpg`;
    fs.writeFileSync(tmpAfter, afterBytes);
    const py = `
from PIL import Image
import sys
a = Image.open(sys.argv[1]).convert('RGB').resize((160, 240))
b = Image.open(sys.argv[2]).convert('RGB').resize((160, 240))
pa = list(a.getdata())
pb = list(b.getdata())
s = 0.0
n = 0
for (r1,g1,b1), (r2,g2,b2) in zip(pa, pb):
    s += abs(r1-r2) + abs(g1-g2) + abs(b1-b2)
    n += 3
print((s / n / 255.0) if n else 1.0)
`;
    const res = spawnSync('python3', ['-c', py, beforePath, tmpAfter], { encoding: 'utf8' });
    try { fs.unlinkSync(tmpAfter); } catch { /* */ }
    if (res.status !== 0) return null;
    const v = Number(String(res.stdout || '').trim());
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * HARDENED RAG rule: if cloud after ≈ before, force calculator-driven morph.
 * Returns possibly replaced bytes + whether enforcement ran.
 */
export function enforceAfterReflectsMath(opts: {
  referencePath: string;
  afterBytes: Buffer;
  guidance?: MorphGuidance | null;
  /** Mean-abs threshold below which after is treated as an illegal copy (default 0.04). */
  maxCopySimilarity?: number;
}): { bytes: Buffer; enforced: boolean; similarity: number | null; contentType: string } {
  const sil = Math.abs(Number(opts.guidance?.silhouette_delta_pct ?? 0));
  const weight = Math.abs(Number(opts.guidance?.weight_delta_kg ?? 0));
  const mustChange = sil >= 3 || weight >= 2;
  let similarity = afterImageSimilarity(opts.referencePath, opts.afterBytes);
  const threshold = opts.maxCopySimilarity ?? 0.04;
  let identicalBytes = false;
  try {
    identicalBytes = opts.afterBytes.equals(fs.readFileSync(opts.referencePath));
  } catch { /* */ }
  const looksLikeCopy = identicalBytes
    || (similarity != null && similarity < threshold);

  if (!mustChange || !looksLikeCopy) {
    return {
      bytes: opts.afterBytes,
      enforced: false,
      similarity,
      contentType: 'image/jpeg',
    };
  }

  // Amplify guidance slightly so the deterministic morph is clinically obvious
  const cap = Math.abs(Number(opts.guidance?.effective_silhouette_cap_pct ?? 7)) || 7;
  const amplified: MorphGuidance = {
    ...(opts.guidance || { silhouette_delta_pct: -5, regional_deltas_pct: {} }),
    silhouette_delta_pct: Math.max(-cap, Math.min(cap,
      (opts.guidance?.silhouette_delta_pct ?? -5) * 1.15,
    )),
    effective_silhouette_cap_pct: cap,
    regional_deltas_pct: Object.fromEntries(
      Object.entries(opts.guidance?.regional_deltas_pct || {}).map(([k, v]) => [
        k,
        Math.max(-cap, Math.min(cap, Number(v) * 1.25)),
      ]),
    ),
  };
  const morphed = applyLocalSilhouetteMorph(opts.referencePath, amplified);
  if (!morphed) {
    return { bytes: opts.afterBytes, enforced: false, similarity, contentType: 'image/jpeg' };
  }
  return { bytes: morphed, enforced: true, similarity, contentType: 'image/jpeg' };
}

/** Narrow/widen silhouette from If/Then calculator guidance (identity-preserving). */
function applyLocalSilhouetteMorph(
  referencePath: string,
  guidance?: MorphGuidance | null,
): Buffer | null {
  try {
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const sil = Number(guidance?.silhouette_delta_pct ?? -7);
    const regions = guidance?.regional_deltas_pct || {};
    const waist = Number(regions.waist ?? regions.abdomen ?? sil * 0.3);
    const abdomen = Number(regions.abdomen ?? waist);
    const hip = Number(regions.hip ?? waist * 0.6);
    const silCap = Math.abs(Number(guidance?.effective_silhouette_cap_pct ?? 12)) || 12;
    const py = `
from PIL import Image, ImageEnhance, ImageFilter
import sys
im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
sil = float(sys.argv[3])
waist = float(sys.argv[4])
abdomen = float(sys.argv[5])
hip = float(sys.argv[6])
# Overall silhouette → horizontal scale (cap from clinician guidance, default 12%)
abs_sil = min(float(sys.argv[7]) / 100.0, abs(sil) / 100.0)
sign = 1.0 if sil > 0 else -1.0
base = 1.0 + sign * abs_sil * 0.9
base = max(0.80, min(1.18, base))
# Mid-torso extra squeeze from waist/abdomen (clinical soft-tissue)
mid = min(0.12, (abs(waist) + abs(abdomen)) / 200.0)
hip_extra = min(0.08, abs(hip) / 200.0)
out = Image.new('RGB', (w, h), (245, 240, 232))
px = im.load()
opx = out.load()
for y in range(h):
    t = y / max(1, h - 1)
    # torso band 0.28–0.72 gets waist/abdomen; hips 0.55–0.85
    torso = 0.0
    if 0.28 <= t <= 0.72:
        # peak at mid-abdomen ~0.48
        torso = 1.0 - abs(t - 0.48) / 0.24
        torso = max(0.0, min(1.0, torso))
    hips = 0.0
    if 0.55 <= t <= 0.88:
        hips = 1.0 - abs(t - 0.70) / 0.18
        hips = max(0.0, min(1.0, hips))
    row_scale = base + sign * (mid * torso + hip_extra * hips)
    row_scale = max(0.78, min(1.20, row_scale))
    nw = max(8, int(round(w * row_scale)))
    # nearest-neighbor sample from source row into centered narrower/wider row
    x0 = (w - nw) // 2
    for x in range(w):
        sx = int((x - x0) * (w - 1) / max(1, nw - 1))
        if 0 <= sx < w and x0 <= x < x0 + nw:
            opx[x, y] = px[sx, y]
        elif x < x0 or x >= x0 + nw:
            # soft edge fill from nearest edge pixel
            edge = 0 if x < x0 else w - 1
            opx[x, y] = px[edge, y]
canvas = out
canvas = ImageEnhance.Contrast(canvas).enhance(1.05)
canvas = ImageEnhance.Color(canvas).enhance(0.98)
canvas = canvas.filter(ImageFilter.UnsharpMask(radius=1.1, percent=55, threshold=2))
out_path = sys.argv[2]
canvas.save(out_path, 'JPEG', quality=90, optimize=True)
`;
    const tmpOut = `${referencePath}.morph-${process.pid}.jpg`;
    const res = spawnSync(
      'python3',
      ['-c', py, referencePath, tmpOut, String(sil), String(waist), String(abdomen), String(hip), String(silCap)],
      { encoding: 'utf8' },
    );
    if (res.status === 0 && fs.existsSync(tmpOut)) {
      const bytes = fs.readFileSync(tmpOut);
      try { fs.unlinkSync(tmpOut); } catch { /* ignore */ }
      return bytes;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Public HTTPS URL for A2E reference (temporary signed local file via APP_ORIGIN if available). */
export async function generateBodyScenarioImage(opts: {
  name: string;
  prompt: string;
  referencePath?: string | null;
  referencePublicUrl?: string | null;
  /** If/Then calculator output — drives local_morph and is reflected in cloud prompts */
  morphGuidance?: MorphGuidance | null;
}): Promise<ImageGenResult> {
  const order = providerOrder();
  if (!order.length) {
    return { provider: 'a2e', status: 'failed', error: 'no_image_provider_configured' };
  }

  // A2E can only fetch publicly reachable HTTPS reference URLs (not localhost).
  const publicRef = opts.referencePublicUrl
    && /^https:\/\//i.test(opts.referencePublicUrl)
    && !/localhost|127\.0\.0\.1/i.test(opts.referencePublicUrl)
    ? opts.referencePublicUrl
    : null;
  const hasLocalRef = !!(opts.referencePath && fs.existsSync(opts.referencePath));

  let last: ImageGenResult | null = null;
  const errors: string[] = [];
  for (const provider of order) {
    try {
      if (provider === 'a2e') {
        // Never fall back to text-only A2E when a capture reference exists — that hallucinates
        // a generic front-like body and breaks multi-view (left/right/back) identity/angle.
        if (hasLocalRef && !publicRef) {
          errors.push('a2e:skipped_no_public_ref_for_img2img');
          continue;
        }
        const attempts: Array<string[] | undefined> = publicRef
          ? [[publicRef]]
          : [undefined];
        for (const inputImages of attempts) {
          last = await startA2e({ name: opts.name, prompt: opts.prompt, inputImages });
          if (last.status !== 'failed') return last;
          errors.push(`a2e:${last.error || 'failed'}`);
        }
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
        errors.push(`gemini:${last.error || 'failed'}`);
        continue;
      }
      if (provider === 'bitdeer') {
        last = await generateBitdeer({
          prompt: opts.prompt,
          referencePath: opts.referencePath,
        });
        if (last.status !== 'failed') return last;
        errors.push(`bitdeer:${last.error || 'failed'}`);
        continue;
      }
      if (provider === 'local_morph') {
        last = localMorphFallback(opts.referencePath, opts.morphGuidance);
        if (last.status !== 'failed') return last;
        errors.push(`local_morph:${last.error || 'failed'}`);
      }
    } catch (e: any) {
      errors.push(`${provider}:${e?.message || String(e)}`);
      last = {
        provider,
        status: 'failed',
        error: e?.message || String(e),
      };
    }
  }
  return last
    ? { ...last, error: errors.join(' | ').slice(0, 500) }
    : { provider: 'a2e', status: 'failed', error: 'image_generation_failed' };
}

export function imageProvidersStatus() {
  return {
    a2e: a2eEnabled(),
    gemini: geminiEnabled(),
    bitdeer: bitdeerEnabled(),
    local_morph: localMorphEnabled(),
    order: providerOrder(),
    a2e_model: A2E_MODEL,
    gemini_model: GEMINI_MODEL,
    bitdeer_model: bitdeerEnabled() ? BITDEER_MODEL : null,
    bitdeer_configured: bitdeerEnabled(),
  };
}
