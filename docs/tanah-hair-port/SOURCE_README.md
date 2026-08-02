# TANAH-HAIR

A clinician-governed hair-transplant planning and operations PWA, derived from the HairPath specification.

## Implemented vertical slice

- Installable clinic PWA and patient PWA.
- Admin login, secure session cookie, CSRF protection, and step-up authentication.
- Skeuomorphic teal/slate clinical shell based on the CLINICA-TANAH visual language.
- Dashboard and synthetic patient queue.
- Admin-only Gemini Image integration settings.
- API key encrypted at rest with AES-256-GCM and never returned after save.
- Connection test, model selection, enable/disable kill switch, audit events, and key rotation workflow.
- Non-clinical AI visualization sandbox using structured, synthetic-only inputs.
- Server-generated permanent SVG watermark on every generated concept.
- Patient timeline shell and standardized photo-task guidance.
- Zero third-party runtime dependencies for the initial verified slice.

This first slice intentionally does **not** diagnose hair loss, recommend surgery or medication, predict graft survival, or accept identifiable patient photos for AI processing.

## Run locally

```bash
cp .env.example .env
# Set SESSION_SECRET and MASTER_ENCRYPTION_KEY.
# Generate a 32-byte base64 key with: openssl rand -base64 32
npm run build
npm start
```

Open `http://localhost:3000/clinic/`.

Development demo credentials default to:

- Email: `admin@tanah.hair`
- Password: `1234`

The same password is used as the step-up authentication when changing Gemini settings. Change these before any shared deployment.

## Gemini setting flow

1. Sign in as an administrator.
2. Open **Settings > Gemini Image Gen**.
3. Enter the API key, select an approved image model, acknowledge sandbox-only use, and enter the administrator password for step-up authentication.
4. Save, then use **Test connection**.
5. The server stores only encrypted ciphertext and returns only a masked suffix.

The browser never receives the plaintext key. The AI feature remains disabled until an administrator explicitly enables it.

## Architecture

```text
apps/api           Node HTTP API, auth, encryption, audit and Gemini provider adapter
apps/clinic-pwa    Clinic workspace PWA
apps/patient-pwa   Patient journey PWA
packages/domain    Shared policy and contract notes
scripts            Smoke verification
spec               Original product specification reference
```

## Verification

```bash
npm run check
npm run smoke
```

The API tests verify authentication, step-up enforcement, ciphertext-at-rest, masking, kill-switch behavior and safe prompt controls.

## Production roadmap

The next milestones replace the development JSON store with PostgreSQL/object storage, introduce the React/Vite workspace described in the specification, add tenant isolation, standardized clinical photography, signed planning records, graft accounting, follow-up triage, and formal regulatory verification evidence.
