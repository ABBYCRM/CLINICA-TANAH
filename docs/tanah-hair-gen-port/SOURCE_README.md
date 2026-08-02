# TANAH-HAIR-GEN

Hair-transplant image generator. One thing, done well.

Drop a patient photo in. Get back a photorealistic before/after preview with the
patient's face, skin, age, head shape, lighting, and background preserved exactly
— only the scalp hair changes. Built to be embedded in a CRM, not to be a CRM.

```
┌──────────────┐   POST photo + params   ┌─────────────────────┐   watermarked
│  CRM client  │ ───────────────────────▶│  TANAH-HAIR-GEN     │──▶  image data URL
└──────────────┘   /api/generate          │  (this service)     │
                                          └─────────────────────┘
```

## What it does

- **One POST endpoint** that does it all: `POST /api/generate`
- **Three optional variants** at the same parameters (`POST /api/variants`)
- **Four synchronized views** of the same result (`POST /api/multi-view`)
- **An offline SVG fallback** that works without any AI key (`POST /api/parametric`)
- **A watermarked image** on every response (spec-mandated, not optional)

## Why a separate service

The previous version of this code lived inside a full CRM repo
(clinic dashboard, patient queue, settings UI, login, audit log, i18n, ~3k lines
of code that isn't the image generator). For a CRM that wants to embed the
simulator, none of that is relevant. This repo is just the image generator.

## Tech stack

- **Node.js 22** + **Express** — small surface area, deploys anywhere
- **Gemini 2.5 Flash Image / 3.1 Flash Image** — the model that scans the picture,
  preserves identity, and applies the spec-aligned parameters
- **Vanilla JS UI** — one `index.html` that exercises every endpoint

No build step. No React. No bundler. The whole service is 12 files.

## Quick start

### 1. Get a Gemini API key

The service calls Google's Gemini image-editing endpoint. Sign up at
<https://aistudio.google.com/app/apikey> and create a key.

### 2. Run it

```bash
git clone https://github.com/ABBYCRM/TANAH-HAIR-GEN.git
cd TANAH-HAIR-GEN
npm install
GEMINI_API_KEY=... npm start
# → TANAH-HAIR-GEN listening on http://0.0.0.0:8080  [AI: gemini-3.1-flash-image]
```

Open <http://localhost:8080> in a browser. The default "before" image is the
bundled sample patient (a 347×280 stock image — not a real person). Press
**Generate (AI)**. In 5–15 seconds you get a watermarked preview.

### 3. Call the API from your CRM

```bash
# Single image
curl -X POST http://localhost:8080/api/generate \
  -F "photo=@patient.jpg" \
  -F "hairline=balanced" \
  -F "zone=full" \
  -F "length=short" \
  -F "color=darkBrown" \
  -F "curl=straight" \
  -F "fullness=moderate" \
  -F "technique=fue" \
  -F "sessions=single"
```

```bash
# Or as JSON (base64 photo)
curl -X POST http://localhost:8080/api/generate \
  -H "content-type: application/json" \
  -d '{"photoBase64":"<...>", "photoMime":"image/jpeg", "params":{...}}'
```

The response is:

```json
{
  "id": "abc123",
  "model": "gemini-3.1-flash-image",
  "view": "front",
  "outputDataUrl": "data:image/svg+xml;base64,...",
  "rawImageDataUrl": "data:image/png;base64,...",
  "params": { "hairline": "balanced", "zone": "full", ... },
  "createdAt": "2026-08-01T22:00:00.000Z"
}
```

Drop `outputDataUrl` straight into an `<img src>` tag. It's a 1024×1024 SVG with
the spec-mandated watermark baked in.

## API reference

### `GET /api/health`

Liveness check. Used by DigitalOcean App Platform for healthcheck.

```json
{
  "status": "ok",
  "service": "tanah-hair-gen",
  "gemini": { "configured": true, "model": "gemini-3.1-flash-image", "available": [...] }
}
```

### `GET /api/presets`

Returns the full parameter catalog. Cache this client-side; it doesn't change.

```json
{
  "hairlines": [{ "id": "conservative", "label": "Mature conservative", "grafts": 2000, "description": "..." }, ...],
  "zones":     [...],
  "lengths":   [...],
  "colors":    [...],
  "curls":     [...],
  "fullnesses":[...],
  "techniques":[...],
  "sessions":  [...],
  "graftScenarios": [...],
  "views":     [{ "id": "front", "label": "Frontal", "description": "..." }, ...]
}
```

### `POST /api/generate`

Single-image generation. Returns a watermarked SVG containing the AI render.

**Request** — JSON or multipart:
- `photo` (multipart file, OR `photoBase64` + `photoMime` in JSON) — required
- `params` (object) or each param as a top-level field:
  - `hairline` — `conservative` | `balanced` | `restorative` | `feminine`
  - `zone`     — `temples` | `frontal` | `midscalp` | `crown` | `full`
  - `density`  — `0`..`1`, default `0.7`
  - `length`   — `buzz` | `short` | `medium` | `long`
  - `color`    — `black` | `darkBrown` | `mediumBrown` | `lightBrown` | `blonde` | `saltPepper`
  - `curl`     — `straight` | `slight` | `wavy` | `curly`
  - `fullness` — `conservative` | `moderate` | `fuller`
  - `technique`— `fue` | `fut` | `dhi`
  - `sessions` — `single` | `multi`
  - `graftScenario` — `light` | `moderate` | `restorative` | `extensive`
  - `view`     — `front` (only view currently supported for single-image)

**Response** (`201`):
```json
{
  "id": "...",
  "model": "gemini-3.1-flash-image",
  "view": "front",
  "outputDataUrl": "data:image/svg+xml;base64,...",
  "rawImageDataUrl": "data:image/png;base64,...",
  "params": { ... },
  "createdAt": "..."
}
```

**Error codes** (`application/problem+json`):
- `400 GEMINI_BAD_REQUEST` — Gemini refused the input
- `403 GEMINI_FORBIDDEN` — API key doesn't have image-gen permissions
- `413` — photo > 12 MB
- `415` — unsupported photo MIME type
- `422 UNSAFE_REQUEST` — prompt contained prohibited clinical claims
- `429 GEMINI_QUOTA_EXCEEDED` — spending cap reached
- `502 GEMINI_GENERATION_FAILED` / `GEMINI_NO_IMAGE` — model failed
- `503 GEMINI_NOT_CONFIGURED` — `GEMINI_API_KEY` env var not set

### `POST /api/variants`

Same as `/api/generate` but the `hairline` is overridden to produce three looks:
`conservative` (mature), `balanced` (natural), `restorative` (youthful). Useful for
the "let me show you the range of options" consultation moment.

**Response** (`200`):
```json
{
  "variants": [
    { "hairline": "conservative", "outputDataUrl": "...", "rawImageDataUrl": "...", "params": {...} },
    { "hairline": "balanced",     "outputDataUrl": "...", "rawImageDataUrl": "...", "params": {...} },
    { "hairline": "restorative",  "outputDataUrl": "...", "rawImageDataUrl": "...", "params": {...} }
  ],
  "params": { ... }   // the original params echoed back
}
```

Per-variant errors are returned as `{ hairline, error, code }` so the UI can
show "this one failed, the other two worked."

### `POST /api/multi-view`

Renders the same parameters from four perspectives in parallel: `front`, `top`,
`left`, `right`. Two concurrent Gemini calls at a time; the whole batch finishes
in 30–60 seconds.

**Response** (`200`):
```json
{
  "views": [
    { "view": "front", "outputDataUrl": "...", "rawImageDataUrl": "...", "params": {...} },
    { "view": "top",   "outputDataUrl": "...", ... },
    { "view": "left",  "outputDataUrl": "...", ... },
    { "view": "right", "outputDataUrl": "...", ... }
  ],
  "params": { ... },
  "model": "gemini-3.1-flash-image"
}
```

Each render has a `FRONTAL` / `TOP` / `LEFT LATERAL` / `RIGHT LATERAL` tag in the
top-right corner of the watermark so multi-view galleries are unambiguous.

### `POST /api/parametric`

Offline SVG fallback. Doesn't call Gemini. Always returns in <100ms with a
deterministic, seedable, watermarked SVG composite.

Use this for:
- Fast previews while a real render is in flight
- CI / regression tests (no external API needed)
- A graceful-degradation path when Gemini is at quota

**Request** (same shape as `/api/generate`):
- `photo` (optional) — overrides the bundled sample
- `params` (same as generate)
- `seed` (optional integer) — deterministic output

**Response** (`201`): same shape as `/api/generate` but `outputDataUrl` is a
`data:image/svg+xml;...` containing a procedural hair overlay.

## What we deliberately left out

- **No login / users / sessions.** This is a CRM component, not a product.
- **No database / audit log.** Generation is stateless. If your CRM needs an
  audit trail, log the request/response in your CRM's own DB before/after
  the call.
- **No payment / quota tracking.** The Gemini key is shared across all callers.
  Your CRM should rate-limit per-clinic if needed.
- **No 3D model / trichoscopy / donor area calculation.** Just the image
  generator. Tools like TrichoLAB and HARRTS do those parts; integrate them
  separately if your CRM needs them.
- **No patient photo storage.** Photos are processed in-memory and never
  persisted. If you want to keep them, do it in your CRM's storage, not here.

## How identity preservation works

The hardest part of the simulator is making the model preserve the patient's
identity while modifying only the scalp hair. We don't fine-tune a model — we
just write a careful prompt. The critical block of every prompt sent to Gemini
is:

```
CRITICAL RULES — you MUST follow these exactly:
- PRESERVE the person's identity, face, facial features, skin texture, skin
  tone, age, head shape, ear shape, and any facial hair EXACTLY as they
  appear in the original photograph.
- PRESERVE the lighting, shadows, color temperature, and background of the
  original photograph EXACTLY.
- MODIFY ONLY the scalp-hair region (the area of the head that is currently
  bald or thinning). Do not touch the forehead, eyebrows, eyes, nose, mouth,
  chin, neck, or clothing.
- Do NOT reshape the face, smooth the skin, change ethnicity, remove scars,
  change expression, alter age, or apply any other cosmetic enhancement.
- Do NOT generate any image that resembles a public figure or identifiable
  real person other than the person in the provided photograph.
```

The model is `gemini-3.1-flash-image` (Nano Banana 2). It understands this prompt
and follows it on the bundled sample ~99% of the time. If you see identity
drift, regenerate — every call uses a different seed.

## Deploy to DigitalOcean App Platform

This repo is configured for App Platform. Connect the GitHub repo
(`ABBYCRM/TANAH-HAIR-GEN`), set:

- **Source directory** — `/` (root)
- **Dockerfile path** — `Dockerfile`
- **HTTP port** — `8080`
- **Health check path** — `/api/health`
- **Instance size** — `basic-xxs` for demo, `apps-s-1vcpu-1gb` for production
- **Region** — `nyc` (or nearest your CRM users)
- **Env vars** —
  - `GEMINI_API_KEY` (type `SECRET`, scope `RUN_TIME`): your Google AI Studio key
  - `GEMINI_MODEL` (optional, default `gemini-3.1-flash-image`)
  - `PORT` (auto-set to 8080 by the platform)

Push to `main` and App Platform auto-deploys. Build time ~60-90s.

## Running the tests

```bash
npm install
npm test
```

The test suite covers the health check, presets catalog, sample photo,
parametric path, and the spec-mandated watermark text. To run the live AI
test (which actually calls Gemini), set `GEMINI_TEST_KEY` in the environment.

## Operational notes

- **Cost:** Gemini 2.5/3.1 Flash Image is $30 per 1M output tokens, ~1290
  tokens per image. A single render is roughly $0.04. Multi-view is 4×.
- **Latency:** 5–15 seconds per single image; 30–60s for multi-view (parallel).
- **Failure modes:** 429 (quota) and 502 (model rejected the prompt) are
  the most common. The response is a problem+json with a `code` field; your
  CRM should map these to user-friendly error states.
- **Key rotation:** the API key is read from `process.env.GEMINI_API_KEY` at
  boot. To rotate, update the env var on App Platform and redeploy.

## License

This repo is part of the TANAH-HAIR product family. All rights reserved.
