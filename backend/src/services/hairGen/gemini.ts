/**
 * Gemini image-edit integration from TANAH-HAIR-GEN.
 * Real Generative Language API only — no mock image path.
 */
import {
  HAIRLINE_PRESETS,
  ZONE_PRESETS,
  LENGTH_PRESETS,
  COLOR_PRESETS,
  CURL_PRESETS,
  FULLNESS_PRESETS,
  TECHNIQUE_PRESETS,
  SESSION_PRESETS,
  GRAFT_SCENARIOS,
  VIEW_CATALOG,
} from './presets';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
] as const;

export const MODEL_DEFAULT = 'gemini-3.1-flash-image';

const HAIRLINE_PROSE: Record<string, string> = {
  conservative: "mature conservative — slight temple recession, no widow's peak, age-appropriate, NOT a juvenile hairline",
  balanced: 'balanced natural — soft M-shape, slight temple recession, normal adult-male position',
  restorative: 'restorative youthful — lower even hairline with fuller frontal coverage',
  feminine: 'feminine rounded — soft curve with a central peak, no temple recession',
};
const ZONE_PROSE: Record<string, string> = {
  temples: 'temples and frontal (about 1500 grafts)',
  frontal: 'frontal band only (about 1800 grafts)',
  midscalp: 'frontal and mid-scalp (about 2600 grafts)',
  crown: 'frontal and crown (about 2800 grafts)',
  full: 'full scalp — frontal, mid-scalp, and crown (about 3400 grafts)',
};
const LENGTH_PROSE: Record<string, string> = {
  buzz: 'a buzz cut, about 3mm long',
  short: 'short, about 1-2 cm long',
  medium: 'medium, about 4-5 cm long, just brushing the top of the ears',
  long: 'long, about 8-10 cm, brushing the collar',
};
const COLOR_PROSE: Record<string, string> = {
  black: 'jet black',
  darkBrown: 'dark brown',
  mediumBrown: 'medium brown',
  lightBrown: 'light brown',
  blonde: 'blonde',
  saltPepper: 'salt and pepper — a natural mix of dark and silver-grey',
};
const CURL_PROSE: Record<string, string> = {
  straight: 'straight',
  slight: 'slight wave',
  wavy: 'wavy',
  curly: 'curly / coily',
};
const FULLNESS_PROSE: Record<string, string> = {
  conservative: 'moderate, mature density — restraint rather than a juvenile look',
  moderate: 'normal adult-male density',
  fuller: 'high density, fuller than typical',
};
const TECHNIQUE_PROSE: Record<string, string> = {
  fue: 'FUE (Follicular Unit Extraction) — natural scattered density',
  fut: 'FUT (strip) — dense single-session yield',
  dhi: 'DHI (Direct Hair Implantation) — higher per-square-centimeter density',
};
const SESSIONS_PROSE: Record<string, string> = {
  single: 'single session',
  multi: 'multi-session (2+ procedures staged for maximum density)',
};

export const VIEW_PROSE: Record<string, string> = {
  front: 'Show the result from a direct front view (looking at the person face-to-face).',
  top: "Show the result from a top-down view (looking straight down at the top of the head, like a bird's-eye view). The hair density and coverage are most visible from this angle.",
  left: "Show the result from a left-side profile view (the person's left side facing the camera).",
  right: "Show the result from a right-side profile view (the person's right side facing the camera).",
  crown: 'Show the result from a back view focusing on the crown / donor area at the back of the head.',
  back: "Show the result from a direct back view (looking at the back of the person's head, donor area and new coverage visible).",
};

const safePick = (map: Record<string, string>, key: string, fallback: string) =>
  (map[key] ? map[key] : (map[fallback] || ''));

export type HairGenParams = {
  hairline: string;
  zone: string;
  length: string;
  color: string;
  curl: string;
  fullness: string;
  technique: string;
  sessions: string;
  graftScenario: string;
  view: string;
  density: number;
};

export function buildEditPrompt(params: Partial<HairGenParams>): string {
  return [
    'You are a clinical hair-restoration visualization tool used by a licensed clinic for patient education. The user has uploaded a photograph of a person and selected a set of procedure parameters. Edit the photograph to show the hypothetical result of a successful hair-transplant procedure approximately 12-18 months post-op.',
    '',
    'CRITICAL RULES — you MUST follow these exactly:',
    "- PRESERVE the person's identity, face, facial features, skin texture, skin tone, age, head shape, ear shape, and any facial hair EXACTLY as they appear in the original photograph.",
    '- PRESERVE the lighting, shadows, color temperature, and background of the original photograph EXACTLY. The result should look like the same photo, just with different hair.',
    '- MODIFY ONLY the scalp-hair region (the area of the head that is currently bald or thinning). Do not touch the forehead, eyebrows, eyes, nose, mouth, chin, neck, or clothing.',
    '- Do NOT reshape the face, smooth the skin, change ethnicity, remove scars, change expression, alter age, or apply any other cosmetic enhancement.',
    '- Do NOT include any text, logo, or annotation in the generated image. A watermark will be applied by the application later.',
    '- Do NOT generate any image that resembles a public figure or identifiable real person other than the person in the provided photograph.',
    '- The transformation should look like the NATURAL RESULT of a successful hair-transplant procedure — not a glamorous makeover, not a wig, not a hairpiece.',
    '',
    'SELECTED PARAMETERS (apply these to the scalp hair only):',
    `- New hairline shape: ${safePick(HAIRLINE_PROSE, params.hairline || 'balanced', 'balanced')}.`,
    `- Coverage zone: ${safePick(ZONE_PROSE, params.zone || 'full', 'full')}.`,
    `- Hair length: ${safePick(LENGTH_PROSE, params.length || 'short', 'short')}.`,
    `- Hair color: ${safePick(COLOR_PROSE, params.color || 'darkBrown', 'darkBrown')}.`,
    `- Hair texture / curl pattern: ${safePick(CURL_PROSE, params.curl || 'straight', 'straight')}.`,
    `- Density / fullness: ${safePick(FULLNESS_PROSE, params.fullness || 'moderate', 'moderate')}.`,
    `- Surgical technique (informational, must not appear in image): ${safePick(TECHNIQUE_PROSE, params.technique || 'fue', 'fue')}.`,
    `- Treatment plan (informational): ${safePick(SESSIONS_PROSE, params.sessions || 'single', 'single')}.`,
    '',
    'OUTPUT: a single edited image, same framing, same person, same lighting, same background. Only the scalp hair changes.',
  ].join('\n');
}

/** Validate params against catalogs. Fixes GEN shadowing bug on `view`. Includes density for parametric. */
export function sanitizeParams(input: any): HairGenParams {
  const v = (input && typeof input === 'object') ? input : {};
  return {
    hairline: HAIRLINE_PRESETS[v.hairline] ? v.hairline : 'balanced',
    zone: ZONE_PRESETS[v.zone] ? v.zone : 'full',
    length: LENGTH_PRESETS[v.length] ? v.length : 'short',
    color: COLOR_PRESETS[v.color] ? v.color : 'darkBrown',
    curl: CURL_PRESETS[v.curl] ? v.curl : 'straight',
    fullness: FULLNESS_PRESETS[v.fullness] ? v.fullness : 'moderate',
    technique: TECHNIQUE_PRESETS[v.technique] ? v.technique : 'fue',
    sessions: SESSION_PRESETS[v.sessions] ? v.sessions : 'single',
    graftScenario: GRAFT_SCENARIOS[v.graftScenario] ? v.graftScenario : 'moderate',
    view: VIEW_CATALOG.some((entry) => entry.id === v.view) ? v.view : 'front',
    density: Math.max(0, Math.min(1, Number(v.density) || 0.65)),
  };
}

const PROHIBITED = [
  /guarantee(?:d)?\s+(?:result|growth|density|success)/i,
  /diagnos(?:e|is|tic)/i,
  /prescrib(?:e|ing|ed)/i,
  /expected\s+result/i,
  /patient\s+(?:name|cpf|email|phone)/i,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /@[a-z0-9.-]+\.[a-z]{2,}/i,
];

export function assertSafe(prompt: string): void {
  if (PROHIBITED.some((re) => re.test(prompt))) {
    const err: any = new Error('The request contains clinical claims, identifying data, or prohibited instructions.');
    err.status = 422;
    err.code = 'UNSAFE_REQUEST';
    throw err;
  }
}

function extractImage(payload: any): { data: string; mimeType: string } | null {
  for (const candidate of payload?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (part?.inlineData?.data) return { data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
      if (part?.inline_data?.data) return { data: part.inline_data.data, mimeType: part.inline_data.mime_type || 'image/png' };
    }
  }
  if (payload?.output_image?.data) {
    return { data: payload.output_image.data, mimeType: payload.output_image.mime_type || 'image/png' };
  }
  for (const step of payload?.steps || []) {
    for (const block of step?.content || []) {
      if (block?.type === 'image' && block.data) return { data: block.data, mimeType: block.mime_type || 'image/png' };
    }
  }
  return null;
}

export function resolveHairGeminiFromEnv(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  apiKey: string | null;
  model: string;
  available: readonly string[];
} {
  const apiKey = (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '').trim() || null;
  const model = (env.GEMINI_MODEL || MODEL_DEFAULT).trim() || MODEL_DEFAULT;
  return { configured: !!apiKey, apiKey, model, available: GEMINI_MODELS };
}

export async function callGemini(opts: {
  apiKey: string | null | undefined;
  model: string;
  prompt: string;
  photoBase64: string;
  photoMime?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ image: { data: string; mimeType: string }; payload: any }> {
  const { apiKey, model, prompt, photoBase64 } = opts;
  const photoMime = opts.photoMime || 'image/webp';
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? 90_000;

  if (!apiKey) {
    const err: any = new Error('Gemini API key is not configured. Set the GEMINI_API_KEY environment variable.');
    err.status = 503;
    err.code = 'GEMINI_NOT_CONFIGURED';
    throw err;
  }

  const url = `${GEMINI_BASE}/models/${model}:generateContent`;
  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: photoMime, data: photoBase64 } },
      ],
    }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 429) {
      const err: any = new Error('Gemini spending cap reached. Wait a few minutes or replace the API key.');
      err.status = 429;
      err.code = 'GEMINI_QUOTA_EXCEEDED';
      err.detail = detail.slice(0, 300);
      throw err;
    }
    if (response.status === 400) {
      const err: any = new Error(`Gemini rejected the request: ${detail.slice(0, 300)}`);
      err.status = 400;
      err.code = 'GEMINI_BAD_REQUEST';
      err.detail = detail;
      throw err;
    }
    if (response.status === 403) {
      const err: any = new Error(`Gemini refused the request: ${detail.slice(0, 300)}`);
      err.status = 403;
      err.code = 'GEMINI_FORBIDDEN';
      err.detail = detail;
      throw err;
    }
    const err: any = new Error(`Gemini generation failed (${response.status}): ${detail.slice(0, 300)}`);
    err.status = 502;
    err.code = 'GEMINI_GENERATION_FAILED';
    err.detail = detail;
    throw err;
  }

  const payload: any = await response.json();
  const image = extractImage(payload);
  if (!image) {
    let refusal = '';
    for (const candidate of payload?.candidates || []) {
      for (const part of candidate?.content?.parts || []) {
        if (part?.text) { refusal = part.text; break; }
      }
    }
    const err: any = new Error(refusal ? `Gemini declined: ${refusal.slice(0, 200)}` : 'Gemini returned no image.');
    err.status = 502;
    err.code = 'GEMINI_NO_IMAGE';
    throw err;
  }
  return { image, payload };
}
