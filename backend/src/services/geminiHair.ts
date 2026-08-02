// @ts-nocheck
/**
 * TANAH-HAIR Gemini adapter — ported into CLINICA-TANAH.
 * Uses GEMINI_API_KEY from environment (same as bodyImage.ts).
 * Does NOT invent encrypted-store fallbacks: if key missing, callers get GEMINI_NOT_CONFIGURED.
 * @ts-nocheck — ported from TANAH-HAIR apps/api/src/gemini.mjs
 */
import { randomBytes } from 'crypto';

function randomId(bytes = 12) {
  return randomBytes(bytes).toString('hex');
}

export type HairGeminiRecord = {
  apiKey: string;
  enabled: boolean;
  sandboxAcknowledged: boolean;
  model: string;
  apiKeyLast4?: string;
  updatedAt?: string | null;
  lastTestAt?: string | null;
  lastTestStatus?: string;
};

/** Resolve Gemini config from CRM env. Returns null if key missing (report to caller — no mock). */
export function resolveHairGeminiFromEnv(): HairGeminiRecord | null {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return {
    apiKey,
    enabled: process.env.GEMINI_HAIR_ENABLED !== '0' && process.env.GEMINI_ENABLED !== '0',
    sandboxAcknowledged: process.env.GEMINI_HAIR_SANDBOX_ACK !== '0',
    model: process.env.GEMINI_HAIR_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash-image',
    apiKeyLast4: apiKey.slice(-4),
    updatedAt: null,
    lastTestAt: null,
    lastTestStatus: 'env',
  };
}

// Models that support image generation/editing. gemini-2.5-flash-image is the
// workhorse for image editing (preserves identity, applies the prompt); the
// 3.x flash image models are newer and stricter on safety filters.
export const GEMINI_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image'
];

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function publicGeminiSettings(record: HairGeminiRecord | null) {
  return {
    provider: 'gemini',
    configured: Boolean(record?.apiKey),
    maskedKey: record?.apiKeyLast4 ? `••••••••••••${record.apiKeyLast4}` : null,
    enabled: Boolean(record?.enabled),
    model: record?.model || GEMINI_MODELS[0],
    sandboxAcknowledged: Boolean(record?.sandboxAcknowledged),
    updatedAt: record?.updatedAt || null,
    lastTestAt: record?.lastTestAt || null,
    lastTestStatus: record?.lastTestStatus || 'never',
    source: record ? 'env:GEMINI_API_KEY' : null,
    missing: record ? null : 'GEMINI_API_KEY',
  };
}

export async function testGeminiConnection({ record, fetchImpl = fetch }: { record: HairGeminiRecord; fetchImpl?: typeof fetch }) {
  if (!record?.apiKey) throw Object.assign(new Error('Gemini API key is not configured'), { status: 409, code: 'GEMINI_NOT_CONFIGURED' });
  const apiKey = record.apiKey;
  // Test by sending a tiny image-edit request (cheaper than listing models,
  // and proves the key has image-gen permissions, not just model-list).
  const response = await fetchImpl(`${GEMINI_BASE}/models/${record.model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }],
      generationConfig: { responseModalities: ['TEXT'] }
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw Object.assign(new Error(`Gemini rejected the credentials (${response.status}): ${detail.slice(0, 240)}`), { status: 502, code: 'GEMINI_CONNECTION_FAILED' });
  }
  return { ok: true, modelVisible: true };
}

// ---------- Photo-aware prompt construction ----------

const HAIRLINE_PROSE = {
  conservative: 'mature conservative — slight temple recession, no widow\'s peak, age-appropriate, NOT a juvenile hairline',
  balanced:     'balanced natural — soft M-shape, slight temple recession, normal adult-male position',
  restorative:  'restorative youthful — lower even hairline with fuller frontal coverage',
  feminine:     'feminine rounded — soft curve with a central peak, no temple recession'
};

const ZONE_PROSE = {
  frontal:  'frontal band only (about 1800 grafts)',
  midscalp: 'frontal and mid-scalp (about 2600 grafts)',
  crown:    'frontal and crown (about 2800 grafts)',
  full:     'full scalp — frontal, mid-scalp, and crown (about 3400 grafts)',
  temples:  'temples and frontal (about 1500 grafts)'
};

const LENGTH_PROSE = {
  buzz:   'a buzz cut, about 3mm long',
  short:  'short, about 1-2 cm long',
  medium: 'medium, about 4-5 cm long, just brushing the top of the ears',
  long:   'long, about 8-10 cm, brushing the collar'
};

const COLOR_PROSE = {
  black:        'jet black',
  darkBrown:    'dark brown',
  mediumBrown:  'medium brown',
  lightBrown:   'light brown',
  blonde:       'blonde',
  saltPepper:   'salt and pepper — a natural mix of dark and silver-grey'
};

const CURL_PROSE = {
  straight: 'straight',
  slight:   'slight wave',
  wavy:     'wavy',
  curly:    'curly / coily'
};

const FULLNESS_PROSE = {
  conservative: 'moderate, mature density — restraint rather than a juvenile look',
  moderate:     'normal adult-male density — most common in clinic',
  fuller:       'high density, fuller than typical'
};

const TECHNIQUE_PROSE = {
  fue: 'FUE (Follicular Unit Extraction) — natural scattered density, no linear donor scar',
  fut: 'FUT (strip) — dense single-session yield, linear donor scar hidden under hair',
  dhi: 'DHI (Direct Hair Implantation) — implanter pen, higher per-square-centimeter density'
};

const SESSIONS_PROSE = {
  single: 'single session',
  multi:  'multi-session (2+ procedures staged for maximum density)'
};

// Build the safety-aware edit prompt. The CRITICAL RULES block is the
// most important part — it tells the model what NOT to change. The
// parameters block tells it what to change.
export function buildPhotoEditPrompt(params) {
  const safePick = (map, key, fallback) => (map[key] ? `${map[key]}` : (map[fallback] || ''));
  return [
    'You are a clinical hair-restoration visualization tool used by a licensed clinic for patient education. The user has uploaded a real top-down photograph of a person and selected a set of procedure parameters. Edit the photograph to show the hypothetical result of a successful hair-transplant procedure approximately 12-18 months post-op.',
    '',
    'CRITICAL RULES — you MUST follow these exactly:',
    '- PRESERVE the person\'s identity, face, facial features, skin texture, skin tone, age, head shape, ear shape, and any facial hair EXACTLY as they appear in the original photograph.',
    '- PRESERVE the lighting, shadows, color temperature, and background of the original photograph EXACTLY. The result should look like the same photo, just with different hair.',
    '- MODIFY ONLY the scalp-hair region (the area of the head that is currently bald or thinning). Do not touch the forehead, eyebrows, eyes, nose, mouth, chin, neck, or clothing.',
    '- Do NOT reshape the face, smooth the skin, change ethnicity, remove scars, change expression, alter age, or apply any other cosmetic enhancement.',
    '- Do NOT include any text, logo, or annotation in the generated image. A watermark will be applied by the application later.',
    '- Do NOT generate any image that resembles a public figure or identifiable real person other than the person in the provided photograph.',
    '- The transformation should look like the NATURAL RESULT of a successful hair-transplant procedure — not a glamorous makeover, not a wig, not a hairpiece.',
    '',
    'SELECTED PARAMETERS (apply these to the scalp hair only):',
    `- New hairline shape: ${safePick(HAIRLINE_PROSE, params.hairline, 'balanced')}.`,
    `- Coverage zone: ${safePick(ZONE_PROSE, params.zone, 'full')}.`,
    `- Hair length: ${safePick(LENGTH_PROSE, params.length, 'short')}.`,
    `- Hair color: ${safePick(COLOR_PROSE, params.color, 'darkBrown')}.`,
    `- Hair texture / curl pattern: ${safePick(CURL_PROSE, params.curl, 'straight')}.`,
    `- Density / fullness: ${safePick(FULLNESS_PROSE, params.fullness, 'moderate')}.`,
    `- Surgical technique (informational, must not appear in image): ${safePick(TECHNIQUE_PROSE, params.technique, 'fue')}.`,
    `- Treatment plan (informational): ${safePick(SESSIONS_PROSE, params.sessions, 'single')}.`,
    '',
    'OUTPUT: a single edited image, same framing, same person, same lighting, same background. Only the scalp hair changes.'
  ].join('\n');
}

// Patterns that would make a prompt unsafe (clinical claims, identifying
// data, etc.). We check the merged parameters + the prompt we build.
const prohibitedPatterns = [
  /guarantee(?:d)?\s+(?:result|growth|density|success)/i,
  /diagnos(?:e|is|tic)/i,
  /prescrib(?:e|ing|ed)/i,
  /expected\s+result/i,
  /patient\s+(?:name|cpf|email|phone)/i,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /@[a-z0-9.-]+\.[a-z]{2,}/i
];

export function assertPhotoPromptSafe(prompt) {
  if (prohibitedPatterns.some(pattern => pattern.test(prompt))) {
    throw Object.assign(new Error('The request contains clinical claims, identifying data or prohibited instructions'), { status: 422, code: 'UNSAFE_VISUALIZATION_REQUEST' });
  }
}

// ---------- API call ----------

// Parse the Gemini response and extract the image bytes. The shape of the
// response differs by API version (snake_case vs camelCase, content.parts[]
// vs output_image{}, etc.) so we try all the known shapes.
function extractImage(payload) {
  // v1beta generateContent (camelCase, current standard)
  for (const candidate of payload?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (part?.inlineData?.data) return { data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
    }
  }
  // v1beta generateContent (snake_case, older)
  for (const candidate of payload?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (part?.inline_data?.data) return { data: part.inline_data.data, mimeType: part.inline_data.mime_type || 'image/png' };
    }
  }
  // Interactions API (Gemini 3.x)
  if (payload?.output_image?.data) return { data: payload.output_image.data, mimeType: payload.output_image.mime_type || 'image/png' };
  for (const step of payload?.steps || []) {
    for (const block of step?.content || []) {
      if (block?.type === 'image' && block.data) return { data: block.data, mimeType: block.mime_type || 'image/png' };
    }
  }
  return null;
}

export async function callGeminiImageEdit({ record, prompt, photoBase64, photoMime, fetchImpl = fetch }: any) {
  if (!record?.apiKey) throw Object.assign(new Error('Gemini API key is not configured'), { status: 409, code: 'GEMINI_NOT_CONFIGURED' });
  if (!record?.enabled) throw Object.assign(new Error('Gemini visualization is disabled by the tenant kill switch'), { status: 409, code: 'GEMINI_DISABLED' });
  if (!record?.sandboxAcknowledged) throw Object.assign(new Error('Sandbox-only acknowledgement is required'), { status: 409, code: 'SANDBOX_ACK_REQUIRED' });
  if (!photoBase64) throw Object.assign(new Error('A reference photograph is required for the photo-aware simulator'), { status: 400, code: 'PHOTO_REQUIRED' });

  const apiKey = record.apiKey;
  const url = `${GEMINI_BASE}/models/${record.model}:generateContent`;
  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: photoMime || 'image/jpeg', data: photoBase64 } }
      ]
    }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
  };

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000)
  });
  if (!response.ok) {
    const detail = await response.text();
    // Translate common failure modes into actionable errors.
    if (response.status === 429) throw Object.assign(new Error('Gemini spending cap reached. Switch to the parametric simulator or replace the API key.'), { status: 429, code: 'GEMINI_QUOTA_EXCEEDED', detail: detail.slice(0, 300) });
    if (response.status === 400) throw Object.assign(new Error(`Gemini rejected the request: ${detail.slice(0, 300)}`), { status: 400, code: 'GEMINI_BAD_REQUEST', detail });
    if (response.status === 403) throw Object.assign(new Error(`Gemini refused the request: ${detail.slice(0, 300)}`), { status: 403, code: 'GEMINI_FORBIDDEN', detail });
    throw Object.assign(new Error(`Gemini generation failed (${response.status}): ${detail.slice(0, 300)}`), { status: 502, code: 'GEMINI_GENERATION_FAILED', detail });
  }
  const payload = await response.json();
  const image = extractImage(payload);
  if (!image) {
    // Look for a refusal text part so we can return the reason
    let refusal = '';
    for (const candidate of payload?.candidates || []) {
      for (const part of candidate?.content?.parts || []) {
        if (part?.text) { refusal = part.text; break; }
      }
    }
    throw Object.assign(new Error(refusal ? `Gemini declined: ${refusal.slice(0, 200)}` : 'Gemini returned no image'), { status: 502, code: 'GEMINI_NO_IMAGE' });
  }
  return { image, payload };
}

// Build the final response shape (id, model, prompt, watermarked image).
export function watermarkedImageDataUrl(image) {
  // The returned Gemini image is high-res (1K) and already in
  // its own frame. We embed it in an SVG with the spec-mandated
  // English watermark + view tag. The SVG is itself a data URL
  // that the front-end can drop into an <img> src.
  // The image dimensions are read from the data header if available.
  // Default to 1024x1024 (1K output) which is what Gemini returns.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid meet">
  <image href="data:${image.mimeType};base64,${image.data}" width="1024" height="1024" preserveAspectRatio="xMidYMid meet"/>
  <rect x="0" y="950" width="1024" height="74" fill="#0F172A" fill-opacity="0.92"/>
  <text x="512" y="980" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="24" font-weight="700" fill="#fff" letter-spacing="0.8">HYPOTHETICAL VISUALIZATION</text>
  <text x="512" y="1006" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="16" fill="#5EEAD4" letter-spacing="0.4">NOT A PREDICTION OR GUARANTEE OF RESULTS · TANAH-HAIR</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export async function generatePhotoAwareVisualization({ record, params, photoBase64, photoMime, fetchImpl = fetch }: any) {
  const prompt = buildPhotoEditPrompt(params);
  assertPhotoPromptSafe(prompt);
  const { image, payload } = await callGeminiImageEdit({ record, prompt, photoBase64, photoMime, fetchImpl });
  // Optional text part from the model (if any)
  let modelText = '';
  for (const candidate of payload?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (part?.text) modelText = part.text;
    }
  }
  return {
    id: randomId(),
    model: record.model,
    prompt,
    modelText: modelText.slice(0, 400),
    outputDataUrl: watermarkedImageDataUrl(image),
    mimeType: image.mimeType,
    rawImageDataUrl: `data:${image.mimeType};base64,${image.data}`,
    createdAt: new Date().toISOString(),
    label: 'HYPOTHETICAL VISUALIZATION - NOT A PREDICTION OR GUARANTEE OF RESULTS'
  };
}

// Backward-compat: the old text-only "synthetic head" generator. We keep
// it exported so the old /api/visualizations endpoint still resolves its
// import, but the new photo-aware generator (above) is the recommended
// path. The legacy prompt is reused for the safety check.
export function buildSafeVisualizationPrompt(input) {
  const style = String(input.style || '').trim().slice(0, 120);
  const coverage = String(input.coverage || '').trim().slice(0, 120);
  const hairline = String(input.hairline || '').trim().slice(0, 120);
  const notes = String(input.notes || '').trim().slice(0, 300);
  const combined = `${style} ${coverage} ${hairline} ${notes}`;
  if (!style || !coverage || !hairline) throw Object.assign(new Error('Style, coverage and hairline concept are required'), { status: 400, code: 'VISUALIZATION_FIELDS_REQUIRED' });
  if (prohibitedPatterns.some(pattern => pattern.test(combined))) {
    throw Object.assign(new Error('The request contains clinical claims, identifying data or prohibited instructions'), { status: 422, code: 'UNSAFE_VISUALIZATION_REQUEST' });
  }
  return [
    'Create a synthetic adult head-and-scalp educational concept image for a hair-restoration consultation interface.',
    'This is not a real patient and must not resemble a public figure or identifiable person.',
    `Hair style concept: ${style}.`,
    `Coverage concept: ${coverage}.`,
    `Hairline concept: ${hairline}.`,
    notes ? `Additional neutral design notes: ${notes}.` : '',
    'Use a neutral clinical studio background and realistic but non-glamorized lighting.',
    'Do not smooth skin, reshape the face, change age or ethnicity, hide scars, imply surgical success, or include medical claims.',
    'Leave clear lower margin space for a permanent Portuguese hypothetical-simulation watermark.'
  ].filter(Boolean).join(' ');
}

export async function generateGeminiVisualization({ record, input, fetchImpl = fetch }: any) {
  if (!record?.enabled) throw Object.assign(new Error('Gemini visualization is disabled by the tenant kill switch'), { status: 409, code: 'GEMINI_DISABLED' });
  if (!record?.sandboxAcknowledged) throw Object.assign(new Error('Sandbox-only acknowledgement is required'), { status: 409, code: 'SANDBOX_ACK_REQUIRED' });
  const prompt = buildSafeVisualizationPrompt(input);
  // Legacy text-only path: no input image. Use the Interactions API
  // shape the legacy code used. We route through the same standard
  // :generateContent endpoint with text only, which still works for
  // text-to-image with the current Gemini image models.
  const apiKey = record.apiKey;
  const response = await fetchImpl(`${GEMINI_BASE}/models/${record.model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
    }),
    signal: AbortSignal.timeout(90_000)
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 429) throw Object.assign(new Error('Gemini spending cap reached.'), { status: 429, code: 'GEMINI_QUOTA_EXCEEDED' });
    throw Object.assign(new Error(`Gemini generation failed (${response.status}): ${detail.slice(0, 300)}`), { status: 502, code: 'GEMINI_GENERATION_FAILED' });
  }
  const payload = await response.json();
  const image = extractImage(payload);
  if (!image) throw Object.assign(new Error('Gemini returned no image'), { status: 502, code: 'GEMINI_NO_IMAGE' });
  return {
    id: randomId(),
    model: record.model,
    prompt,
    outputDataUrl: watermarkedImageDataUrl(image),
    createdAt: new Date().toISOString(),
    label: 'HYPOTHETICAL VISUALIZATION - NOT A PREDICTION OR GUARANTEE OF RESULTS'
  };
}
