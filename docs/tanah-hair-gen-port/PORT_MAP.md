# TANAH-HAIR-GEN → CLINICA-TANAH port map

Source: https://github.com/ABBYCRM/TANAH-HAIR-GEN.git  
Target: Patient Detail → **Transplante capilar** tab

## What was ported

| GEN file | CRM location |
|----------|----------------|
| `app/presets.mjs` | `backend/src/services/hairGen/presets.ts` |
| `app/gemini.mjs` | `backend/src/services/hairGen/gemini.ts` |
| `app/parametric.mjs` | `backend/src/services/hairGen/parametric.ts` |
| `app/watermark.mjs` | `backend/src/services/hairGen/watermark.ts` |
| `app/api.mjs` endpoints | `backend/src/routes/hair.ts` under `/api/clinical/hair` |
| `app/static/*` demo UI | **Not copied** — replaced by `HairTransplantWorkspace.tsx` using CRM tokens (`crm-inset-panel`, `btn-primary`, `--ink`, etc.) |

Source snapshots also live under `docs/tanah-hair-gen-port/*.mjs`.

## API (patient-scoped)

| Method | Path |
|--------|------|
| GET | `/api/clinical/hair/presets` |
| GET | `/api/clinical/hair/status` |
| GET | `/api/clinical/hair/:patientId/history` |
| POST | `/api/clinical/hair/:patientId/generate` |
| POST | `/api/clinical/hair/:patientId/variants` |
| POST | `/api/clinical/hair/:patientId/multi-view` |
| POST | `/api/clinical/hair/:patientId/parametric` |

Auth: JWT + clinical roles. Writes: admin/doctor. Photo required (JSON `photoBase64`) — no demo fallback (GEN contract).

## Env

| Var | Required for AI |
|-----|-----------------|
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Yes for generate / variants / multi-view |
| `GEMINI_MODEL` | Optional (default `gemini-3.1-flash-image`) |

Parametric SVG works without Gemini.

## Fixes vs upstream GEN

- `sanitizeParams` view check no longer self-shadows (always fell back to `front`).
- `density` is preserved for the parametric path.
- Generations are persisted per `tenant_id` + `patient_id` in `hair_generations`.

## Not ported (intentionally)

- Standalone Express host, Multer multipart demo, GEN topbar/Inter/teal chrome, API curl card, language pills (CRM already has i18n).
