# TANAH-HAIR → CLINICA-TANAH port map

| Source | CRM destination |
|--------|-----------------|
| `apps/api/src/simulator.mjs` | `backend/src/services/hairSimulator.ts` |
| `apps/api/src/gemini.mjs` | `backend/src/services/geminiHair.ts` (uses `GEMINI_API_KEY` env) |
| `apps/api/src/app.mjs` simulator routes | `backend/src/routes/hair.ts` → `/api/clinical/hair/*` |
| `apps/api/assets/sample-patient.webp` | `backend/src/assets/hair/sample-patient.webp` |
| Clinic Image Simulator UI | `frontend/src/components/HairTransplantWorkspace.tsx` (panel: simulator) |
| Hairline Lab SVG | same component (panel: hairline) |
| Procedure Board + graft counter | same component (panel: procedure) |
| Patient PWA journey content | same component (panel: journey) |
| JSON store persistence | SQLite `hair_simulations` + `hair_procedure_tallies` |
| Auth/session/CSRF of TANAH-HAIR | CRM JWT `authenticate` + role gates (no parallel login) |

## Required env (report if missing — no mock)

- `GEMINI_API_KEY` — required for AI Generate / AI multi-view
- Optional: `GEMINI_HAIR_MODEL`, `GEMINI_HAIR_ENABLED`, `GEMINI_HAIR_SANDBOX_ACK`, `GEMINI_MODEL`, `GEMINI_ENABLED`

Parametric simulator works without Gemini.
