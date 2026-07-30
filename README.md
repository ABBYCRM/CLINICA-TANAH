# Clínica Tanah — Medical-Grade CRM

LGPD-compliant clinic management platform for **Clínica Tanah** in São Paulo / SP, Brasil.
Trilingual (Português / Español / English), with WhatsApp bot for appointments, full inventory & vendor
management, double-entry accounting, Brazilian payroll (INSS/IRRF/FGTS), and complete audit trail.

🌐 **Live**: https://clinica-tanah.onrender.com
🔒 **LGPD Mode**: Strict (Lei 13.709/2018 + CFM 2.314/2022)
💬 **WhatsApp Bot**: Trilingual, with appointment booking + opt-out

---

## Quick start

```bash
# Install everything
npm run install:all

# Build frontend + seed database
npm run build:frontend
npm run seed

# Start the server
npm start
# → open http://localhost:3001
```

### Test login

| Email | Role | Password |
|---|---|---|
| `admin@clinica-tanah.com.br` | Admin / Dra. Helena Tanaka | `clinica2026` |
| `dpo@clinica-tanah.com.br` | DPO / Dr. Marcos Vieira | `clinica2026` |
| `silva@clinica-tanah.com.br` | Doctor / Dr. Roberto Silva | `clinica2026` |
| `santos@clinica-tanah.com.br` | Doctor / Dra. Beatriz Santos | `clinica2026` |
| `oliveira@clinica-tanah.com.br` | Doctor / Dr. Carlos Oliveira | `clinica2026` |
| `contabil@clinica-tanah.com.br` | Accountant / João Mendes | `clinica2026` |
| `farmacia@clinica-tanah.com.br` | Pharmacist / Patrícia Almeida | `clinica2026` |
| `mariana@clinica-tanah.com.br` | Receptionist | `clinica2026` |

---

## Feature set (granular)

### Clinical core
- **Patient registration** with full Brazilian address (CEP, bairro, cidade, UF), CPF, RG, convênio, blood type, allergies, chronic conditions, emergency contact.
- **SOAP encounters** with ICD-10/CID-10 diagnosis codes, ICD auto-suggested, signatures.
- **Prescriptions** in PDF-ready format, one-click **send via WhatsApp**.
- **Appointment management** with practitioner schedule, status workflow (scheduled → confirmed → arrived → in progress → completed / cancelled / no_show), sources (reception, phone, website, **WhatsApp bot**).
- **Availability lookup** for the WhatsApp bot — returns open 30-min slots in work hours.
- **LGPD consent collection** mandatory at first contact (consentimento, IP, timestamp, policy version).

### WhatsApp bot (trilingual, Meta Cloud API ready)
- **State machine** for appointment booking: `idle → awaiting_cpf → awaiting_specialty → awaiting_date → confirmed`
- **LGPD consent flow**: bot asks, patient replies SIM/NÃO, consent is recorded with IP + timestamp.
- **Opt-out**: any time, patient can reply `SAIR` / `STOP` / `SALIR` and be removed from all lists.
- **Specialty menu** in PT/ES/EN.
- **Patient lookup** by CPF before showing any PHI (privacy by design).
- **Live mode**: set `META_WA_TOKEN` + `META_WA_PHONE_ID` to send via Meta Cloud API.
- **Dry-run mode**: messages are stored in DB but not sent — used for testing & the in-app simulator.
- **In-app simulator**: at `/whatsapp` in the UI, type as if you were a patient and see the bot reply in real time.

### Inventory & pharmacy
- **Medications, supplies, equipment, consumables** with categories.
- **ANVISA registry tracking** for all medicines.
- **Controlled substance flag** (Portaria 344/98) for items that need special prescription handling.
- **Batch tracking** with expiry date, batch number, vendor, cost per unit, received date.
- **FEFO logic** — first-to-expire-first-out (recommended for medicines; can be enabled in routes).
- **Low-stock alerts** (current stock < min_stock).
- **Expiring-batches alerts** (30-day window).
- **Stock movements** with type, reason, user, reference.
- **Vendors** with CNPJ, ANVISA license, banking info.

### Accounting
- **Brazilian chart of accounts** (plano de contas) — 28 accounts pre-seeded covering assets, liabilities, equity, revenue, expenses.
- **Double-entry journal** with automatic balance check.
- **Trial balance** (balancete) at any date.
- **DRE** (income statement) for any period.
- **Invoices** with payment tracking, overdue detection, NF-e key field.
- **Multi-line invoices** with quantity × unit price × tax rate.
- **Cash/Bank/Receivable accounts** wired.

### Payroll (Brazilian)
- **Employee records** with CPF, PIS, CTPS, dependents, base salary, weekly hours.
- **Payroll runs** (folha mensal) with auto-calculation:
  - **INSS** progressive 7.5% / 9% / 12% / 14% up to ceiling R$ 951.62
  - **IRRF** progressive 0% / 7.5% / 15% / 22.5% / 27.5% with dependent deductions
  - **FGTS** 8% on gross
  - **Net pay** = gross − INSS − IRRF − other deductions
- **Payslips** with full line-by-line JSON breakdown.
- **Approve / pay workflow** (draft → approved → paid).
- **13th salary** (1st and 2nd installments) and **férias** support.

### LGPD compliance
- **DPO** (Encarregado de Dados) designated in the system: Dr. Marcos Vieira, `dpo@clinica-tanah.com.br`.
- **Consent records** for every patient (health_data_processing, whatsapp_communication, marketing) with IP, user-agent, policy version, evidence text.
- **Data subject rights** requests tracked: access, rectification, deletion, portability, opposition (LGPD art. 18).
- **Audit log** of every PHI access and data modification with legal basis (art. 7º I, V, II, VIII, etc.).
- **Retention policy** displayed: 20 years for medical records (CFM 1.821/2007), 5 years for financial (CTN), 2 years for communication.
- **Opt-out** in every WhatsApp message, processed within 24h.

### Trilingual UI (PT-BR / ES / EN)
- **Locale switcher** in the sidebar and on the login page.
- All UI strings, error messages, validation messages, status labels, types, sources translated.
- Date / currency formatting per locale.
- Backend i18n for the WhatsApp bot replies (PT/ES/EN) — auto-detected from message content.
- **i18n keys** stored as JSON, loaded at runtime, no rebuild needed for content changes.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Browser (PT/ES/EN)                          │
│  React 18 + Vite + Tailwind + i18n          │
└──────────────┬──────────────────────────────┘
               │  /api/*
┌──────────────▼──────────────────────────────┐
│  Express (TypeScript)                        │
│  ├─ auth (JWT, RBAC: admin/doctor/nurse/…)  │
│  ├─ patients (LGPD-aware PHI access)        │
│  ├─ clinical (encounters, prescriptions)    │
│  ├─ inventory (items, batches, alerts)      │
│  ├─ accounting (CoA, journal, trial bal.)   │
│  ├─ payroll (INSS/IRRF/FGTS calc)           │
│  ├─ whatsapp (state machine + Meta API)     │
│  └─ lgpd (consent, audit, data requests)    │
└──────────────┬──────────────────────────────┘
               │  better-sqlite3 (WAL mode)
┌──────────────▼──────────────────────────────┐
│  SQLite (data/clinica-tanah.db)             │
└─────────────────────────────────────────────┘
```

## API endpoints (selected)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | – | Email + password → JWT |
| `GET` | `/api/auth/me` | JWT | Current user |
| `GET` | `/api/patients?q=...` | JWT | List patients (search by name/CPF/phone) |
| `POST` | `/api/patients` | admin/doctor/nurse/receptionist | Create (requires LGPD consent) |
| `GET` | `/api/patients/:id` | JWT | View — logged to audit |
| `GET` | `/api/patients/:id/data-export` | admin/doctor/patient | LGPD art. 18 V portability |
| `GET` | `/api/appointments?from=&to=` | JWT | Date-range query |
| `GET` | `/api/appointments/availability?practitioner_id=&date=` | JWT | Free slots for the bot |
| `POST` | `/api/appointments` | admin/doctor/nurse/receptionist | New appointment |
| `GET` | `/api/clinical/encounters?patient_id=` | JWT | List encounters |
| `POST` | `/api/clinical/encounters` | doctor/nurse | New SOAP note |
| `GET` | `/api/clinical/prescriptions` | JWT | List prescriptions |
| `POST` | `/api/clinical/prescriptions` | doctor | New prescription |
| `GET` | `/api/inventory/items?q=&category=` | JWT | Search items |
| `POST` | `/api/inventory/items` | admin/pharmacist | New item |
| `GET` | `/api/inventory/batches?item_id=&expiring_soon=true` | JWT | List batches |
| `POST` | `/api/inventory/batches` | admin/pharmacist | New batch (auto stock-in) |
| `POST` | `/api/inventory/movements` | admin/pharmacist/nurse/doctor | Stock movement |
| `GET` | `/api/inventory/alerts` | JWT | Low-stock + expiring |
| `GET` | `/api/inventory/vendors` | JWT | List vendors |
| `POST` | `/api/inventory/vendors` | admin/pharmacist/accountant | New vendor |
| `GET` | `/api/accounting/chart` | JWT | Chart of accounts |
| `GET` | `/api/accounting/journal` | JWT | Journal entries |
| `POST` | `/api/accounting/journal` | admin/accountant | New journal entry (must balance) |
| `GET` | `/api/accounting/trial-balance` | JWT | Balancete |
| `GET` | `/api/accounting/income-statement` | JWT | DRE |
| `GET` | `/api/accounting/invoices` | JWT | List invoices |
| `POST` | `/api/accounting/invoices` | admin/accountant/receptionist | New invoice |
| `PUT` | `/api/accounting/invoices/:id/mark-paid` | admin/accountant | Mark paid |
| `GET` | `/api/payroll/employees` | JWT | List employees |
| `POST` | `/api/payroll/employees` | admin/accountant | New employee |
| `POST` | `/api/payroll/run` | admin/accountant | Run payroll for a period |
| `GET` | `/api/payroll/runs` | JWT | Past runs |
| `GET` | `/api/payroll/runs/:id` | JWT | Run + payslips |
| `PUT` | `/api/payroll/runs/:id/approve` | admin/accountant | Approve |
| `PUT` | `/api/payroll/runs/:id/pay` | admin/accountant | Mark paid |
| `GET` | `/api/whatsapp/conversations` | JWT | List conversations |
| `GET` | `/api/whatsapp/messages?phone=` | JWT | Message history |
| `POST` | `/api/whatsapp/send` | admin/doctor/nurse/receptionist | Staff send to patient |
| `POST` | `/api/whatsapp/simulate` | JWT | Test the bot from the UI |
| `GET` | `/api/whatsapp/status` | JWT | Live / dry-run + counts |
| `POST` | `/api/whatsapp/webhook` | Meta | Receive WhatsApp messages |
| `GET` | `/api/whatsapp/webhook` | Meta | Webhook verification |
| `GET` | `/api/lgpd/policy` | JWT | Public policy summary |
| `GET` | `/api/lgpd/consents` | admin/dpo | All consent records |
| `GET` | `/api/lgpd/data-requests` | admin/dpo/receptionist | Subject rights requests |
| `PUT` | `/api/lgpd/data-requests/:id/fulfill` | admin/dpo | Mark as fulfilled |
| `GET` | `/api/lgpd/audit` | admin/dpo | Audit log |
| `GET` | `/api/dashboard` | JWT | KPI summary |

## LGPD mapping

| LGPD requirement | How we satisfy it |
|---|---|
| **art. 7º I** — Consent | `lgpd_consents` table records every consent with IP, user-agent, policy version, evidence. Patient checkbox in the UI. WhatsApp bot collects consent before any PHI. |
| **art. 7º V** — Contract execution | `legal_basis = 'contract_art7_V'` on appointment creation. |
| **art. 7º II** — Legal obligation | CFM 1.821/2007 (20-year retention), ANVISA, SUS, fiscal — tagged as `legal_obligation_art7_II`. |
| **art. 7º VIII** — Health protection | All clinical encounters, prescriptions, PHI access logged with this basis. |
| **art. 18 I-IX** — Subject rights | Full request tracking (`lgpd_data_requests`), with fulfill workflow. |
| **art. 18 V** — Portability | `GET /api/patients/:id/data-export` returns patient + encounters + prescriptions + appointments + consents as JSON. |
| **art. 37** — Record of processing | `audit_log` table — every action by every user with before/after diff. |
| **art. 46** — Security measures | bcrypt password hashing, JWT auth, role-based access, audit log of all access. |
| **art. 48** — Incident notification | `audit_log` captures anomalous access patterns; staff can review. |
| **art. 50** — Good practices | DPO designated publicly, retention policy documented, opt-out mechanism in every WhatsApp message. |

## Testing

```bash
# Unit tests (backend, vitest)
npm test

# E2E — boots the real app (seeded SQLite + built frontend) and checks
# every spec on desktop Chrome AND a mobile (Pixel 7) viewport:
#   · sign-in render / locale switch / invalid + valid login
#   · mobile: no horizontal overflow, drawer navigation
#   · API smoke: health, auth, patients RBAC
npm run test:e2e

# Only the mobile e2e check / only desktop
npm run test:e2e:mobile
npm run test:e2e:desktop

# First time only — install the Chromium browser
npm run e2e:install
```

The e2e suite also runs in CI (`.github/workflows/e2e.yml`) on every push/PR.

## Deploy

```bash
# On Render (auto via render.yaml):
# - Build: cd .. && npm install:all && npm run build:frontend && cd backend && npm run build
# - Start: node dist/server.js
# - Health: /api/health

# Manual:
npm run build      # builds both
npm run seed       # seeds the SQLite DB
npm start          # serves on $PORT (default 3001)
```

## License

MIT — see LICENSE.

---

Built with care for **Clínica Tanah** by the Mavis agent team.
**São Paulo, Brasil · 2026**
