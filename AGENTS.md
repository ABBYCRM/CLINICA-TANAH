# Clínica Tanah

Medical-grade CRM (single deployable app) for a São Paulo clinic: patients/PHI, SOAP
encounters, scheduling, WhatsApp bot, inventory/pharmacy, accounting, payroll, LGPD.
It is a small npm monorepo: `backend/` (Express + embedded SQLite via better-sqlite3)
and `frontend/` (React + Vite + Tailwind PWA). In dev/prod the backend serves the built
frontend from `backend/public`, so it is single-origin — there is **no external
database, Redis, or message broker to run**.

## Cursor Cloud specific instructions

The update script only refreshes dependencies (`npm install` + `npm run install:all`,
which also compiles the `better-sqlite3` native module). Build, seed, and service
startup are intentionally NOT in the update script — do them yourself at session start
as needed. Standard scripts live in the root/`backend`/`frontend` `package.json`; the
notes below are the non-obvious bits.

### First-time-per-session bring-up (required before the UI/API is usable)
Run from the repo root:
1. `npm run build:frontend` — builds React and copies `dist/*` into `backend/public`. The
   backend serves the UI from there, so the app is unusable in the browser until this runs.
2. `npm run seed` — creates/seeds the SQLite DB at `backend/data/clinica-tanah.db`. Login
   is impossible without it (all users come from the seed). Re-running wipes and reseeds
   to a known state.
3. Start the backend:
   - Dev (hot reload, preferred): `cd backend && npm run dev` (tsx watch) → http://localhost:3001
   - Prod-style: `npm run build` then `npm start` (serves `backend/dist/server.js`).
   Health check: `GET /api/health`. Default port is `3001` locally (prod containers use `10000`).

`.env` is optional in dev — `JWT_SECRET`/`PORT` have working defaults and the WhatsApp/Meta
integration falls back to dry-run (simulator) mode when `META_WA_*` are unset. Copy
`.env.example` → `.env` only if you need to override these.

### Seeded logins (password for all: `clinica2026`)
`admin@clinica-tanah.com.br` (admin/superadmin), `dpo@…`, `silva@…`/`santos@…`/`oliveira@…`
(doctors), `ana.enf@…` (nurse), `mariana@…` (receptionist), `contabil@…` (accountant),
`farmacia@…` (pharmacist). Auth is JWT stored in `localStorage` (`auth_token`).

### Lint / test / build
- Lint: there is **no lint script**. Type-checking is done by `tsc`, which runs as part of
  `npm run build` (frontend and backend).
- Unit tests: backend `npm test` (Vitest, ~53 tests). The frontend has **no** unit tests
  (`npm test` in `frontend/` exits with "No test files").
- E2E (Playwright, desktop + mobile Chrome): first run `npm run e2e:install` (downloads
  Chromium), then `npm run test:e2e`. The E2E harness (`e2e/serve.mjs`) auto-builds the
  frontend if missing and boots the backend on an isolated seeded DB (port 3100,
  `NODE_ENV=test`, rate limiting off) — it does not touch your dev DB.

### Manual-testing gotcha
Some create/edit modals (e.g. the "Novo paciente" form in `frontend/src/pages/Patients.tsx`)
define their field sub-components inside the render body, so real char-by-char typing into
those free-text inputs can lose focus and truncate after a few characters. Prefer flows
driven by dropdown pickers/selects/date pickers (e.g. creating an appointment via the
patient/practitioner typeahead pickers) for reliable GUI testing; Playwright `fill()` is
unaffected because it sets the value directly.
