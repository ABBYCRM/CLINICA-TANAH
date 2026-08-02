/**
 * Relatório clínico completo — printable HTML dossier aggregating
 * demographics, chart history, body module, consents, and clinic process.
 */
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { revealPatientRow, revealEncounterRow, revealPrescriptionItems } from './phiCrypto';
import { uploadsRoot } from './nvidiaOcr';

export type ClinicalReportInclude = {
  demographics?: boolean;
  consents?: boolean;
  alerts?: boolean;
  measurements?: boolean;
  medications?: boolean;
  lifestyle?: boolean;
  captures?: boolean;
  scenarios?: boolean;
  chart?: boolean;
  appointments?: boolean;
  /** Embed clinical capture / scenario images when patient consented (authenticated dossier). */
  images?: boolean;
};

const DEFAULT_INCLUDE: Required<ClinicalReportInclude> = {
  demographics: true,
  consents: true,
  alerts: true,
  measurements: true,
  medications: true,
  lifestyle: true,
  captures: true,
  scenarios: true,
  chart: true,
  appointments: true,
  images: true,
};

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(v: unknown): string {
  if (!v) return '—';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 16).replace('T', ' ');
  return s;
}

function ageYears(birth: string | null | undefined): number | null {
  if (!birth) return null;
  const d = new Date(birth);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

function parseJson(raw: unknown, fallback: any = null) {
  if (raw == null) return fallback;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function hasGrantedConsent(rows: any[], purpose: string): boolean {
  return (rows || []).some((c) => c.purpose === purpose && Number(c.granted) === 1 && !c.revoked_at);
}

/** Embed local clinical image as data-URI for authenticated HTML dossier (CFM chart). */
function fileToDataUri(filePath: string | null | undefined): string | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
      : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function imgGrid(items: Array<{ label: string; dataUri: string | null }>): string {
  if (!items.length) return '';
  const figures = items.map((it) => {
    const media = it.dataUri
      ? `<img src="${it.dataUri}" alt="${esc(it.label)}" loading="lazy"/>`
      : '<div class="ph">—</div>';
    return `<figure><figcaption>${esc(it.label)}</figcaption>${media}</figure>`;
  }).join('');
  return `<div class="img-grid">${figures}</div>`;
}

function section(title: string, body: string): string {
  if (!body.trim()) return '';
  return `<section class="sec"><h2>${esc(title)}</h2>${body}</section>`;
}

function kvTable(rows: Array<[string, unknown]>): string {
  const cells = rows
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('');
  return cells ? `<table class="kv">${cells}</table>` : '<p class="muted">—</p>';
}

function dataTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return '<p class="muted">Sem registros neste período.</p>';
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="scroll"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export type BuildClinicalReportInput = {
  db: Database.Database;
  tenantId: string;
  patientId: string;
  signatureName: string;
  nextFollowUpDate?: string | null;
  include?: ClinicalReportInclude;
  limits?: {
    measurements?: number;
    encounters?: number;
    evolutions?: number;
    appointments?: number;
    prescriptions?: number;
  };
  generatedBy?: { id?: string; email?: string; name?: string };
};

export type ClinicalReportPayload = {
  generated_at: string;
  patient: any;
  include: Required<ClinicalReportInclude>;
  image_policy: {
    include_requested: boolean;
    capture_images_allowed: boolean;
    scenario_images_allowed: boolean;
    capture_images_embedded: number;
    scenario_images_embedded: number;
  };
  alerts: any;
  consents: any;
  measurements: any[];
  medications: any[];
  prescriptions: any[];
  plans: any[];
  capture_sessions: any[];
  scenarios: any[];
  allergies: any[];
  problems: any[];
  evolutions: any[];
  vitals: any[];
  anamnesis: any | null;
  exam_orders: any[];
  exam_results: any[];
  procedures: any[];
  encounters: any[];
  appointments: any[];
  counts: Record<string, number>;
};

export function collectClinicalReportData(input: BuildClinicalReportInput): ClinicalReportPayload {
  const { db, tenantId, patientId } = input;
  const include = { ...DEFAULT_INCLUDE, ...(input.include || {}) };
  const lim = {
    measurements: input.limits?.measurements ?? 30,
    encounters: input.limits?.encounters ?? 20,
    evolutions: input.limits?.evolutions ?? 20,
    appointments: input.limits?.appointments ?? 20,
    prescriptions: input.limits?.prescriptions ?? 20,
  };

  const patientRaw = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(patientId, tenantId) as any;
  const patient = revealPatientRow(patientRaw) || patientRaw;

  const allergies = db.prepare(`
    SELECT * FROM clinical_allergies
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY CASE severity WHEN 'life_threatening' THEN 0 WHEN 'severe' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END
  `).all(tenantId, patientId) as any[];

  const problems = db.prepare(`
    SELECT * FROM clinical_problems
    WHERE tenant_id = ? AND patient_id = ? AND status IN ('active','resolved')
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC LIMIT 40
  `).all(tenantId, patientId) as any[];

  const bodyConsents = db.prepare(`
    SELECT purpose, granted, granted_at, revoked_at FROM body_consents
    WHERE tenant_id = ? AND patient_id = ?
  `).all(tenantId, patientId) as any[];

  const lgpdConsents = (() => {
    try {
      return db.prepare(`
        SELECT consent_type AS purpose, granted, granted_at, revoked_at, policy_version AS version
        FROM lgpd_consents
        WHERE subject_type = 'patient' AND subject_id = ?
        ORDER BY granted_at DESC LIMIT 40
      `).all(patientId) as any[];
    } catch {
      return [] as any[];
    }
  })();

  const measurements = db.prepare(`
    SELECT * FROM body_measurements
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY recorded_at DESC LIMIT ?
  `).all(tenantId, patientId, lim.measurements) as any[];

  const medications = db.prepare(`
    SELECT * FROM body_medications
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC LIMIT 100
  `).all(tenantId, patientId) as any[];

  const prescriptions = (db.prepare(`
    SELECT id, created_at, items, signer_name, signer_council, signer_council_state, signed_at, status, encounter_id
    FROM prescriptions
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(tenantId, patientId, lim.prescriptions) as any[]).map((pr) => ({
    ...pr,
    items: revealPrescriptionItems(pr.items),
  }));

  const plans = (db.prepare(`
    SELECT * FROM body_lifestyle_plans
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(tenantId, patientId) as any[]).map((row) => {
    let params: any = {};
    try { params = row.params_json ? JSON.parse(row.params_json) : {}; } catch { params = {}; }
    return {
      ...row,
      params,
      daily_calories: params.daily_calories ?? null,
      deficit_kcal: params.deficit_kcal ?? null,
      protein_g: params.protein_g ?? null,
    };
  });

  const sessions = db.prepare(`
    SELECT id, status, quality_summary, created_at, updated_at, validated_at
    FROM body_capture_sessions
    WHERE tenant_id = ? AND patient_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC LIMIT 20
  `).all(tenantId, patientId) as any[];

  const sessionAssets = db.prepare(`
    SELECT session_id, view, quality_json, content_type, image_path, created_at, deleted_at
    FROM body_capture_assets
    WHERE tenant_id = ? AND patient_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC
  `).all(tenantId, patientId) as any[];

  const captureImagesAllowed = include.images && hasGrantedConsent(bodyConsents, 'image_processing');
  const scenarioImagesAllowed = include.images && hasGrantedConsent(bodyConsents, 'generative_ai');
  // Captures are clinical records; also allow with clinical_record consent if image_processing missing but clinical_record granted
  const captureEmbedOk = captureImagesAllowed || (include.images && hasGrantedConsent(bodyConsents, 'clinical_record'));

  let captureImagesEmbedded = 0;
  let scenarioImagesEmbedded = 0;

  const capture_sessions = sessions.map((s) => {
    const assets = sessionAssets.filter((a) => a.session_id === s.id);
    let quality: any = null;
    try { quality = s.quality_summary ? JSON.parse(s.quality_summary) : null; } catch { quality = null; }
    return {
      ...s,
      quality_summary: quality,
      assets: assets.map((a) => {
        let q: any = null;
        try { q = a.quality_json ? JSON.parse(a.quality_json) : null; } catch { q = null; }
        const dataUri = captureEmbedOk ? fileToDataUri(a.image_path) : null;
        if (dataUri) captureImagesEmbedded += 1;
        return {
          view: a.view,
          quality: q,
          created_at: a.created_at,
          content_type: a.content_type || null,
          data_uri: dataUri,
          has_image: !!(a.image_path),
        };
      }),
      asset_count: assets.length,
    };
  });

  const scenarios = (db.prepare(`
    SELECT id, title, goal, weeks, horizon_weeks, status, review_status, provider,
           prompt_version, reviewed_at, review_signature, execution_plan, plan_config,
           assumptions, created_at, updated_at, image_path, output_views
    FROM body_scenarios WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC LIMIT 30
  `).all(tenantId, patientId) as any[]).map((s) => {
    const plan = parseJson(s.execution_plan, null);
    const views = parseJson(s.output_views, {}) || {};
    const viewEntries: Array<{ view: string; data_uri: string | null; has_image: boolean }> = [];
    if (views && typeof views === 'object') {
      for (const [view, entry] of Object.entries(views as Record<string, any>)) {
        const p = entry?.path || entry?.image_path || null;
        const dataUri = scenarioImagesAllowed ? fileToDataUri(p) : null;
        if (dataUri) scenarioImagesEmbedded += 1;
        viewEntries.push({ view, data_uri: dataUri, has_image: !!p });
      }
    }
    if (!viewEntries.length && s.image_path) {
      const dataUri = scenarioImagesAllowed ? fileToDataUri(s.image_path) : null;
      if (dataUri) scenarioImagesEmbedded += 1;
      viewEntries.push({ view: 'front', data_uri: dataUri, has_image: true });
    }
    const viewCount = viewEntries.filter((v) => v.has_image).length;
    return {
      ...s,
      has_image: viewCount > 0 ? 1 : 0,
      execution_plan: plan,
      plan_config: parseJson(s.plan_config, null),
      assumptions: parseJson(s.assumptions, null),
      output_view_count: viewCount,
      output_images: viewEntries,
      projected: plan?.projected || null,
      summary: plan?.summary || s.goal || null,
    };
  });

  const evolutions = db.prepare(`
    SELECT * FROM clinical_evolutions
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY recorded_at DESC LIMIT ?
  `).all(tenantId, patientId, lim.evolutions) as any[];

  const vitals = db.prepare(`
    SELECT * FROM clinical_vitals
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY recorded_at DESC LIMIT 15
  `).all(tenantId, patientId) as any[];

  const anamnesis = db.prepare(`
    SELECT * FROM clinical_anamnesis
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY recorded_at DESC LIMIT 1
  `).get(tenantId, patientId) as any;

  const exam_orders = db.prepare(`
    SELECT * FROM clinical_exam_orders
    WHERE tenant_id = ? AND patient_id = ? AND status != 'cancelled'
    ORDER BY ordered_at DESC LIMIT 20
  `).all(tenantId, patientId) as any[];

  const exam_results = db.prepare(`
    SELECT * FROM clinical_exam_results
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY resulted_at DESC LIMIT 20
  `).all(tenantId, patientId) as any[];

  const procedures = db.prepare(`
    SELECT * FROM clinical_procedures
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY performed_at DESC LIMIT 20
  `).all(tenantId, patientId) as any[];

  const encounters = (db.prepare(`
    SELECT * FROM encounters
    WHERE tenant_id = ? AND patient_id = ? AND COALESCE(status,'active') = 'active'
    ORDER BY started_at DESC LIMIT ?
  `).all(tenantId, patientId, lim.encounters) as any[])
    .map((e) => revealEncounterRow(e) || e);

  const appointments = (() => {
    try {
      return db.prepare(`
        SELECT a.*, u.full_name AS practitioner_name
        FROM appointments a
        LEFT JOIN users u ON u.id = a.practitioner_id
        WHERE a.tenant_id = ? AND a.patient_id = ?
        ORDER BY a.scheduled_at DESC LIMIT ?
      `).all(tenantId, patientId, lim.appointments) as any[];
    } catch {
      try {
        return db.prepare(`
          SELECT a.*, u.full_name AS practitioner_name
          FROM appointments a
          LEFT JOIN users u ON u.id = a.practitioner_id
          WHERE a.patient_id = ?
          ORDER BY a.scheduled_at DESC LIMIT ?
        `).all(patientId, lim.appointments) as any[];
      } catch {
        return [] as any[];
      }
    }
  })();

  const legacyAllergies = parseJson(patient?.allergies, []);
  const chronic = parseJson(patient?.chronic_conditions, []);

  return {
    generated_at: new Date().toISOString(),
    patient: {
      ...patient,
      age_years: ageYears(patient?.birth_date),
      chronic_conditions: chronic,
      allergies_legacy: legacyAllergies,
    },
    include,
    image_policy: {
      include_requested: !!include.images,
      capture_images_allowed: !!captureEmbedOk,
      scenario_images_allowed: !!scenarioImagesAllowed,
      capture_images_embedded: captureImagesEmbedded,
      scenario_images_embedded: scenarioImagesEmbedded,
    },
    alerts: {
      allergy_alert: allergies.some((a) => ['severe', 'life_threatening'].includes(a.severity))
        || (allergies.length + (Array.isArray(legacyAllergies) ? legacyAllergies.length : 0)) > 0,
      allergies,
      allergies_legacy: legacyAllergies,
      chronic_conditions: chronic,
      open_complaint: !!patient?.open_complaint,
    },
    consents: {
      body: bodyConsents,
      lgpd: lgpdConsents,
      patient_lgpd_at: patient?.lgpd_consent_at || null,
      patient_lgpd_version: patient?.lgpd_consent_version || null,
      marketing_opt_out: !!patient?.lgpd_opt_out_marketing,
    },
    measurements,
    medications,
    prescriptions,
    plans,
    capture_sessions,
    scenarios,
    allergies,
    problems,
    evolutions,
    vitals,
    anamnesis,
    exam_orders,
    exam_results,
    procedures,
    encounters,
    appointments,
    counts: {
      allergies: allergies.length,
      problems: problems.length,
      measurements: measurements.length,
      medications: medications.length,
      prescriptions: prescriptions.length,
      plans: plans.length,
      capture_sessions: capture_sessions.length,
      scenarios: scenarios.length,
      evolutions: evolutions.length,
      vitals: vitals.length,
      encounters: encounters.length,
      appointments: appointments.length,
      exam_orders: exam_orders.length,
      procedures: procedures.length,
    },
  };
}

export function renderClinicalReportHtml(
  data: ClinicalReportPayload,
  opts: { signatureName: string; nextFollowUpDate?: string | null; generatedBy?: string | null },
): string {
  const p = data.patient || {};
  const include = data.include;
  const address = [
    p.address_street, p.address_number, p.address_complement,
    p.address_neighborhood, p.address_city, p.address_state, p.address_zip,
  ].filter(Boolean).join(', ');

  const parts: string[] = [];

  parts.push(`
    <header class="cover">
      <div class="brand">Clínica Tanah</div>
      <h1>Relatório clínico completo</h1>
      <p class="meta">Prontuário integrado · módulo Corpo + chart CFM · gerado em ${esc(fmtDate(data.generated_at))}</p>
      <p class="meta">Assinado por: <strong>${esc(opts.signatureName)}</strong>${opts.generatedBy ? ` · ${esc(opts.generatedBy)}` : ''}</p>
      ${opts.nextFollowUpDate ? `<p class="meta">Próximo retorno: ${esc(opts.nextFollowUpDate)}</p>` : ''}
      <p class="meta">Imagens clínicas no dossiê: capturas ${data.image_policy?.capture_images_embedded ?? 0} · simulações ${data.image_policy?.scenario_images_embedded ?? 0} (acesso autenticado · LGPD art. 7º VIII)</p>
    </header>
  `);

  parts.push(section('Índice de conteúdo', `
    <ul class="toc">
      <li>Identificação e demografia</li>
      <li>Alertas clínicos</li>
      <li>Consentimentos (LGPD / Corpo)</li>
      <li>Antropometria e medidas</li>
      <li>Medicamentos e receitas</li>
      <li>Planos de nutrição e treino</li>
      <li>Captura corporal e qualidade</li>
      <li>Cenários / simulações ilustrativas</li>
      <li>Prontuário (SOAP, evoluções, vitais, exames, procedimentos, problemas)</li>
      <li>Agenda / consultas</li>
    </ul>
    <p class="muted">Contagens: medidas ${data.counts.measurements} · meds ${data.counts.medications} · planos ${data.counts.plans} · capturas ${data.counts.capture_sessions} · cenários ${data.counts.scenarios} · evoluções ${data.counts.evolutions} · encontros ${data.counts.encounters} · consultas ${data.counts.appointments}</p>
  `));

  if (include.demographics) {
    parts.push(section('1. Identificação e demografia', kvTable([
      ['Nome completo', p.full_name],
      ['Nome social', p.social_name],
      ['Data de nascimento', p.birth_date],
      ['Idade', p.age_years != null ? `${p.age_years} anos` : null],
      ['Sexo / gênero', p.gender],
      ['CPF', p.cpf],
      ['CNS', p.cns],
      ['Telefone', p.phone],
      ['E-mail', p.email],
      ['Endereço', address],
      ['Convênio', p.health_insurance],
      ['Nº convênio', p.health_insurance_number],
      ['Tipo sanguíneo', p.blood_type],
      ['Ocupação', p.occupation],
      ['Estado civil', p.marital_status],
      ['Contato emergência', [p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(' · ')],
      ['Responsável', [p.guardian_name, p.guardian_relationship, p.guardian_phone].filter(Boolean).join(' · ')],
      ['Estágio', p.lifecycle_stage],
      ['Idioma preferido', p.preferred_language],
      ['Última visita', fmtDate(p.last_visit_at)],
    ])));
  }

  if (include.alerts) {
    const allergyRows = [
      ...data.allergies.map((a) => [
        esc(a.substance || a.name || '—'),
        esc(a.severity || '—'),
        esc(a.reaction || a.notes || '—'),
        esc(fmtDate(a.recorded_at || a.created_at)),
      ]),
      ...(Array.isArray(data.alerts.allergies_legacy) ? data.alerts.allergies_legacy.map((x: any) => [
        esc(typeof x === 'string' ? x : x?.name || JSON.stringify(x)),
        'legado',
        '—',
        '—',
      ]) : []),
    ];
    const chronic = Array.isArray(data.alerts.chronic_conditions)
      ? data.alerts.chronic_conditions.map((c: any) => esc(typeof c === 'string' ? c : c?.name || JSON.stringify(c))).join(', ')
      : '—';
    parts.push(section('2. Alertas clínicos', `
      <p class="${data.alerts.allergy_alert ? 'alert' : 'ok'}">
        ${data.alerts.allergy_alert ? '⚠ Alerta de alergia presente' : 'Sem alerta de alergia ativo'}
        ${data.alerts.open_complaint ? ' · Queixa aberta registrada' : ''}
      </p>
      <h3>Alergias</h3>
      ${dataTable(['Substância', 'Severidade', 'Reação / notas', 'Desde'], allergyRows)}
      <h3>Condições crônicas</h3>
      <p>${chronic || '—'}</p>
      <h3>Problemas ativos / resolvidos</h3>
      ${dataTable(
        ['Problema', 'Status', 'CID', 'Atualizado'],
        data.problems.map((pr) => [
          esc(pr.title || pr.name || '—'),
          esc(pr.status),
          esc(pr.icd10_code || pr.cid10_code || '—'),
          esc(fmtDate(pr.updated_at || pr.created_at)),
        ]),
      )}
    `));
  }

  if (include.consents) {
    const purposeLabel = (x: string) => ({
      clinical_record: 'Registro clínico',
      image_processing: 'Processamento de imagem',
      generative_ai: 'IA generativa',
      cross_border_transfer: 'Transferência internacional',
      research: 'Pesquisa',
      marketing: 'Marketing',
    } as Record<string, string>)[x] || x;
    parts.push(section('3. Consentimentos (LGPD / Corpo)', `
      <p class="muted">Consentimento LGPD do paciente: ${esc(fmtDate(data.consents.patient_lgpd_at))} · versão ${esc(data.consents.patient_lgpd_version || '—')} · opt-out marketing: ${data.consents.marketing_opt_out ? 'sim' : 'não'}</p>
      <h3>Consentimentos granulares (módulo Corpo)</h3>
      ${dataTable(
        ['Finalidade', 'Concedido', 'Em', 'Revogado'],
        (data.consents.body || []).map((c: any) => [
          esc(purposeLabel(c.purpose)),
          c.granted ? 'OK' : 'Não',
          esc(fmtDate(c.granted_at)),
          esc(fmtDate(c.revoked_at)),
        ]),
      )}
      <h3>Ledger LGPD</h3>
      ${dataTable(
        ['Finalidade', 'Concedido', 'Em', 'Versão'],
        (data.consents.lgpd || []).map((c: any) => [
          esc(c.purpose),
          c.granted ? 'OK' : 'Não',
          esc(fmtDate(c.granted_at)),
          esc(c.version || '—'),
        ]),
      )}
    `));
  }

  if (include.measurements) {
    const latest = data.measurements[0];
    const bmi = latest?.bmi ?? (latest?.height_cm && latest?.weight_kg
      ? Math.round((latest.weight_kg / ((latest.height_cm / 100) ** 2)) * 10) / 10
      : null);
    parts.push(section('4. Antropometria e medidas corporais', `
      <h3>Resumo atual</h3>
      ${kvTable([
        ['Altura', latest?.height_cm != null ? `${latest.height_cm} cm` : null],
        ['Peso', latest?.weight_kg != null ? `${latest.weight_kg} kg` : null],
        ['Cintura', latest?.waist_cm != null ? `${latest.waist_cm} cm` : null],
        ['Quadril', latest?.hip_cm != null ? `${latest.hip_cm} cm` : null],
        ['% gordura', latest?.body_fat_pct != null ? `${latest.body_fat_pct}%` : null],
        ['Massa muscular', latest?.muscle_mass_kg != null ? `${latest.muscle_mass_kg} kg` : null],
        ['IMC', bmi],
        ['Registrado em', fmtDate(latest?.recorded_at || latest?.measured_at)],
      ])}
      <h3>Linha do tempo</h3>
      ${dataTable(
        ['Data', 'Peso', 'Cintura', 'IMC', '%G', 'MM'],
        data.measurements.map((m) => {
          const mBmi = m.bmi ?? (m.height_cm && m.weight_kg
            ? Math.round((m.weight_kg / ((m.height_cm / 100) ** 2)) * 10) / 10
            : '—');
          return [
            esc(fmtDate(m.recorded_at || m.measured_at)),
            esc(m.weight_kg ?? '—'),
            esc(m.waist_cm ?? '—'),
            esc(mBmi),
            esc(m.body_fat_pct ?? '—'),
            esc(m.muscle_mass_kg ?? '—'),
          ];
        }),
      )}
    `));
  }

  if (include.medications) {
    parts.push(section('5. Medicamentos (Corpo) e receitas', `
      <h3>Medicamentos no módulo Corpo</h3>
      ${dataTable(
        ['Medicamento', 'Dose', 'Classe', 'Status', 'Desde'],
        data.medications.map((m) => [
          esc(m.name),
          esc(m.dosage || '—'),
          esc(m.class_tag || m.visual_profile || '—'),
          esc(m.status || '—'),
          esc(fmtDate(m.started_at || m.created_at)),
        ]),
      )}
      <h3>Receitas clínicas</h3>
      ${data.prescriptions.length ? data.prescriptions.map((rx) => {
        const items = Array.isArray(rx.items) ? rx.items : [];
        const itemLines = items.map((it: any) => {
          if (typeof it === 'string') return `<li>${esc(it)}</li>`;
          return `<li><strong>${esc(it.medication || it.name || '—')}</strong> — ${esc([it.dosage, it.frequency, it.duration, it.instructions].filter(Boolean).join(' · ') || '—')}</li>`;
        }).join('');
        return `<div class="card"><div class="card-h">${esc(fmtDate(rx.created_at))} · ${esc(rx.status)} · ${esc(rx.signer_name || '—')}</div><ul>${itemLines || '<li>—</li>'}</ul></div>`;
      }).join('') : '<p class="muted">Nenhuma receita registrada.</p>'}
    `));
  }

  if (include.lifestyle) {
    parts.push(section('6. Planos de nutrição e treino', data.plans.length ? data.plans.map((pl) => {
      const meta = [
        pl.plan_type,
        pl.status,
        pl.weeks ? `${pl.weeks}w` : null,
        pl.daily_calories ? `${pl.daily_calories} kcal/d` : null,
        pl.deficit_kcal != null ? `déficit ${pl.deficit_kcal}` : null,
        pl.protein_g ? `prot ${pl.protein_g}g` : null,
        pl.params?.training_style,
        pl.params?.resistance_days_per_week != null ? `força ${pl.params.resistance_days_per_week}×` : null,
        pl.params?.cardio_days_per_week != null ? `cardio ${pl.params.cardio_days_per_week}×` : null,
      ].filter(Boolean).join(' · ');
      return `<div class="card"><div class="card-h">${esc(pl.title)} <span class="muted">${esc(meta)}</span></div><p>${esc(pl.summary || pl.description || '—')}</p></div>`;
    }).join('') : '<p class="muted">Nenhum plano de dieta/treino.</p>'));
  }

  if (include.captures) {
    parts.push(section('7. Captura corporal e qualidade', data.capture_sessions.length ? data.capture_sessions.map((s) => {
      const q = s.quality_summary || {};
      const gates = typeof q === 'object' && q ? Object.entries(q).map(([k, v]) => {
        const val = typeof v === 'object' && v ? ((v as any).status || (v as any).result || JSON.stringify(v)) : v;
        return `<li><code>${esc(k)}</code>: ${esc(val)}</li>`;
      }).join('') : '';
      const assets = (s.assets || []).map((a: any) => `<li>${esc(a.view)}${a.has_image ? '' : ' (sem arquivo)'}</li>`).join('');
      const images = imgGrid((s.assets || []).map((a: any) => ({ label: String(a.view || 'vista'), dataUri: a.data_uri || null })));
      return `<div class="card"><div class="card-h">Sessão ${esc(s.id.slice(0, 8))} · ${esc(s.status)} · ${esc(fmtDate(s.created_at))} · ${s.asset_count || 0}/4 vistas</div>
        <ul>${assets || '<li>Sem assets</li>'}</ul>
        ${images || (data.image_policy?.include_requested && !data.image_policy?.capture_images_allowed
          ? '<p class="muted">Imagens de captura omitidas — conceda consentimento de registro clínico / processamento de imagem.</p>'
          : '')}
        ${gates ? `<h4>Qualidade</h4><ul>${gates}</ul>` : ''}</div>`;
    }).join('') : '<p class="muted">Nenhuma sessão de captura.</p>'));
  }

  if (include.scenarios) {
    parts.push(section('8. Cenários e simulações ilustrativas', `
      <p class="wm-inline">Imagens geradas são ilustrativas — não constituem prognóstico clínico. Incluídas no prontuário autenticado com base legal LGPD art. 7º VIII (tutela da saúde) e consentimento de IA generativa.</p>
      ${data.scenarios.length ? data.scenarios.map((s) => {
        const proj = s.projected || {};
        const images = imgGrid((s.output_images || []).map((v: any) => ({
          label: String(v.view || 'vista'),
          dataUri: v.data_uri || null,
        })));
        return `<div class="card">
          <div class="card-h">${esc(s.title || 'Cenário')} · ${esc(s.status)} · revisão ${esc(s.review_status || '—')} · ${esc(s.horizon_weeks || s.weeks || '—')}w</div>
          <p>${esc(s.summary || s.goal || '—')}</p>
          <p class="muted">Projeção: peso ${esc(proj.weight_kg ?? '—')} kg · cintura ${esc(proj.waist_cm ?? '—')} cm · IMC ${esc(proj.bmi ?? '—')} · vistas ${s.output_view_count || 0}/4</p>
          <p class="muted">Assinatura revisão: ${esc(s.review_signature || '—')} · ${esc(fmtDate(s.reviewed_at))} · prompt ${esc(s.prompt_version || '—')}</p>
          ${images || (data.image_policy?.include_requested && !data.image_policy?.scenario_images_allowed
            ? '<p class="muted">Simulações omitidas — conceda consentimento de IA generativa para embutir imagens neste dossiê.</p>'
            : (s.output_view_count ? '<p class="muted">Arquivos de imagem indisponíveis neste cenário.</p>' : ''))}
        </div>`;
      }).join('') : '<p class="muted">Nenhum cenário gerado.</p>'}
    `));
  }

  if (include.chart) {
    const an = data.anamnesis;
    parts.push(section('9. Prontuário clínico (chart)', `
      <h3>Anamnese (mais recente)</h3>
      ${an ? kvTable([
        ['Registrada em', fmtDate(an.recorded_at)],
        ['Queixa principal', an.chief_complaint],
        ['HDA', an.hpi || an.history_present_illness],
        ['HPP', an.past_history],
        ['Hábitos / HS', an.social_history || an.habits],
        ['História familiar', an.family_history],
        ['Assinatura', an.signer_name],
      ]) : '<p class="muted">Sem anamnese estruturada.</p>'}

      <h3>Sinais vitais</h3>
      ${dataTable(
        ['Data', 'PA', 'FC', 'Temp', 'SpO₂', 'Peso'],
        data.vitals.map((v) => [
          esc(fmtDate(v.recorded_at)),
          esc([v.bp_systolic, v.bp_diastolic].filter((x) => x != null).join('/') || '—'),
          esc(v.heart_rate ?? v.hr ?? '—'),
          esc(v.temperature_c ?? v.temp_c ?? '—'),
          esc(v.spo2 ?? '—'),
          esc(v.weight_kg ?? '—'),
        ]),
      )}

      <h3>Evoluções</h3>
      ${data.evolutions.length ? data.evolutions.map((ev) => `
        <div class="card">
          <div class="card-h">${esc(fmtDate(ev.recorded_at))} · ${esc(ev.note_type || 'evolution')} · ${esc(ev.signer_name || '—')}</div>
          <pre class="note">${esc(ev.content)}</pre>
        </div>`).join('') : '<p class="muted">Sem evoluções.</p>'}

      <h3>Encontros SOAP</h3>
      ${data.encounters.length ? data.encounters.map((en) => `
        <div class="card">
          <div class="card-h">${esc(fmtDate(en.started_at))} → ${esc(fmtDate(en.ended_at))} · ${esc(en.status)}</div>
          <p><strong>S:</strong> ${esc(en.subjective || '—')}</p>
          <p><strong>O:</strong> ${esc(en.objective || '—')}</p>
          <p><strong>A:</strong> ${esc(en.assessment || '—')}</p>
          <p><strong>P:</strong> ${esc(en.plan || '—')}</p>
          <p class="muted">CID: ${esc(en.cid10_codes || en.icd10_codes || '—')}</p>
        </div>`).join('') : '<p class="muted">Sem encontros SOAP.</p>'}

      <h3>Exames pedidos</h3>
      ${dataTable(
        ['Data', 'Exame', 'Status', 'Notas'],
        data.exam_orders.map((o) => [
          esc(fmtDate(o.ordered_at || o.created_at)),
          esc(o.exam_name || o.name || o.code || '—'),
          esc(o.status),
          esc(o.notes || '—'),
        ]),
      )}

      <h3>Resultados de exames</h3>
      ${dataTable(
        ['Data', 'Exame', 'Resultado', 'Status'],
        data.exam_results.map((r) => [
          esc(fmtDate(r.resulted_at || r.created_at)),
          esc(r.exam_name || r.name || '—'),
          esc(r.result_summary || r.result_text || r.summary || r.value || '—'),
          esc(r.status),
        ]),
      )}

      <h3>Procedimentos</h3>
      ${dataTable(
        ['Data', 'Procedimento', 'Código', 'Notas'],
        data.procedures.map((pr) => [
          esc(fmtDate(pr.performed_at || pr.created_at)),
          esc(pr.procedure_name || pr.name || '—'),
          esc(pr.procedure_code || pr.code || '—'),
          esc(pr.description || pr.notes || '—'),
        ]),
      )}
    `));
  }

  if (include.appointments) {
    parts.push(section('10. Agenda e consultas', dataTable(
      ['Data', 'Tipo', 'Status', 'Profissional', 'Fonte', 'Notas'],
      data.appointments.map((a) => [
        esc(fmtDate(a.scheduled_at)),
        esc(a.type),
        esc(a.status),
        esc(a.practitioner_name || a.practitioner_id || '—'),
        esc(a.source || '—'),
        esc(a.notes || '—'),
      ]),
    )));
  }

  parts.push(`
    <footer class="foot">
      <p class="wm">Documento clínico interno autenticado (prontuário). Uso exclusivo da equipe assistencial — não publicar em redes ou portais públicos. Simulações de imagem, quando incluídas, são ilustrativas e não substituem avaliação médica presencial. Base legal: LGPD art. 7º VIII · CFM.</p>
      <p class="muted">Imagens embutidas: capturas ${data.image_policy?.capture_images_embedded ?? 0} · simulações ${data.image_policy?.scenario_images_embedded ?? 0}. Retenção documental CFM · Clínica Tanah · gerado ${esc(data.generated_at)}</p>
    </footer>
  `);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Relatório clínico — ${esc(p.full_name || 'paciente')} — Clínica Tanah</title>
  <style>
    :root { --ink:#1c1814; --muted:#6a5f52; --line:#d9cfc0; --bg:#faf6ef; --card:#fffdf8; --brass:#9a7b3c; --alert:#8b3a2a; --ok:#2f6b45; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: "Source Serif 4", Georgia, "Times New Roman", serif; color:var(--ink); background:linear-gradient(180deg,#f3ebe0,#faf6ef 180px); }
    .wrap { max-width: 920px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
    .brand { font-family: "Fraunces", Georgia, serif; font-size: 1.35rem; letter-spacing: .02em; color: var(--brass); }
    h1 { font-family: "Fraunces", Georgia, serif; font-size: 1.75rem; margin: .35rem 0 .5rem; font-weight: 600; }
    h2 { font-size: 1.15rem; margin: 0 0 .75rem; padding-bottom: .35rem; border-bottom: 1px solid var(--line); }
    h3 { font-size: .95rem; margin: 1rem 0 .4rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
    h4 { font-size: .85rem; margin: .6rem 0 .25rem; color: var(--muted); }
    .meta, .muted { color: var(--muted); font-size: .86rem; }
    .sec { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 1rem 1.1rem; margin: 1rem 0; box-shadow: 0 1px 0 rgba(28,24,20,.04); }
    .cover { margin-bottom: 1rem; }
    .toc { margin: .25rem 0 .5rem 1.1rem; }
    table.kv { width:100%; border-collapse: collapse; font-size: .92rem; }
    table.kv th { text-align:left; width: 34%; color: var(--muted); font-weight: 600; padding: .28rem .4rem .28rem 0; vertical-align: top; }
    table.kv td { padding: .28rem 0; }
    table.grid { width:100%; border-collapse: collapse; font-size: .84rem; }
    table.grid th, table.grid td { border-bottom: 1px solid var(--line); padding: .4rem .35rem; text-align: left; vertical-align: top; }
    table.grid th { color: var(--muted); font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; }
    .scroll { overflow-x: auto; }
    .card { border: 1px solid var(--line); border-radius: 10px; padding: .7rem .8rem; margin: .55rem 0; background: #fff; }
    .card-h { font-weight: 600; margin-bottom: .35rem; font-size: .92rem; }
    .note { white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem; margin: 0; }
    .alert { color: var(--alert); font-weight: 600; }
    .ok { color: var(--ok); }
    .wm, .wm-inline { margin-top: .75rem; padding: .65rem .8rem; border: 1px solid #c9a227; background: #fff8e7; font-size: .82rem; border-radius: 8px; }
    .img-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .65rem; margin: .75rem 0 .25rem; }
    .img-grid figure { margin: 0; }
    .img-grid figcaption { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-bottom: .3rem; }
    .img-grid img { width: 100%; aspect-ratio: 3/4; object-fit: cover; border: 1px solid var(--line); border-radius: 8px; background: #efe6d8; display: block; }
    .img-grid .ph { width: 100%; aspect-ratio: 3/4; display: flex; align-items: center; justify-content: center; background: #efe6d8; border: 1px solid var(--line); border-radius: 8px; color: #888; font-size: .8rem; }
    .foot { margin-top: 1.5rem; }
    @media (max-width: 720px) { .img-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media print {
      body { background: #fff; }
      .wrap { max-width: none; padding: 0; }
      .sec, .card { break-inside: avoid; box-shadow: none; }
      .brand { color: #000; }
      .img-grid img { max-height: 220px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    ${parts.join('\n')}
  </div>
</body>
</html>`;
}

export function writeClinicalReportHtml(opts: {
  tenantId: string;
  patientId: string;
  reportId: string;
  html: string;
}): string {
  const dir = path.join(uploadsRoot(), opts.tenantId, 'body', opts.patientId, 'clinical-reports');
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, `${opts.reportId}.html`);
  fs.writeFileSync(htmlPath, opts.html, 'utf8');
  return htmlPath;
}

export function ensureClinicalReportsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS body_clinical_reports (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'clinical_full',
      title TEXT,
      signature_name TEXT,
      next_follow_up_date TEXT,
      include_json TEXT,
      html_path TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_body_clinical_reports_patient
      ON body_clinical_reports(tenant_id, patient_id, created_at);
  `);
}
