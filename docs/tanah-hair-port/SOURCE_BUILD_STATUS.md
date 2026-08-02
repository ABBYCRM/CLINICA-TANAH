# TANAH-HAIR build status

## Verified in this build

- Clinic PWA shell with responsive desktop/mobile navigation.
- Patient PWA shell with journey timeline and separate consent states.
- Admin authentication, signed session cookie, CSRF checks and password step-up.
- Gemini Image Gen settings screen and API.
- AES-256-GCM encryption for the Gemini API key at rest.
- Masked read-back only; the plaintext key is never returned to the browser.
- Approved model selection, tenant enable/disable kill switch and connection test.
- Synthetic-only visualization request guardrails.
- Server-side Gemini provider adapter using the Interactions endpoint.
- Permanent SVG watermark: "SIMULAÇÃO HIPOTÉTICA - NÃO É PREVISÃO DE RESULTADO".
- Append-style audit events for authentication, patient-list access, settings changes, tests and generations.
- TypeScript-compiled browser applications.
- Automated API/security tests and executable smoke test.

## Verification evidence

- `npm run check`: TypeScript build plus 4/4 API tests pass.
- `npm run smoke`: clinic PWA, patient PWA and API health endpoint are reachable.

## Not yet production-complete

- PostgreSQL and tenant-isolation migration.
- Object storage and immutable clinical-photo provenance.
- Full React/Vite/TanStack application packages.
- Standardized camera capture and photo-quality workflow.
- Hairline vector editor, donor map and graft worksheet persistence.
- Signed clinical records and addenda.
- Procedure-day inventory, graft batches and reconciliation workflow.
- Follow-up triage rules and clinician acknowledgement SLA.
- LGPD data requests, retention engine and publication-release evidence packets.
- Managed secret manager/KMS, MFA, SSO, penetration testing and production deployment.
- Formal medical, legal, DPO, security and accessibility acceptance.
