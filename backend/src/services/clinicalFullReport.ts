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
  if (!rows.length) return '<p class="empty">Nenhum registro.</p>';
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

  const viewLabel = (v: string) => ({
    front: 'Frente', left: 'Esquerda', right: 'Direita', back: 'Costas',
  } as Record<string, string>)[v] || v;

  const statusPt = (s: string | null | undefined) => ({
    completed: 'Concluído',
    scheduled: 'Agendado',
    cancelled: 'Cancelado',
    no_show: 'Falta',
    active: 'Ativo',
    ready: 'Pronto',
    pending_review: 'Em revisão',
    approved: 'Aprovado',
    rejected: 'Rejeitado',
    consultation: 'Consulta',
    return: 'Retorno',
    new_patient: 'Paciente novo',
    website: 'Site',
    phone: 'Telefone',
    reception: 'Recepção',
    whatsapp_bot: 'WhatsApp',
  } as Record<string, string>)[String(s || '')] || (s || '—');

  const purposeLabel = (x: string) => ({
    clinical_record: 'Registro clínico',
    image_processing: 'Processamento de imagem',
    generative_ai: 'Inteligência artificial generativa',
    cross_border_transfer: 'Transferência internacional',
    research: 'Pesquisa',
    marketing: 'Marketing',
    health_data_processing: 'Tratamento de dados de saúde',
    whatsapp_communication: 'Comunicação por WhatsApp',
    email_communication: 'Comunicação por e-mail',
    sms_communication: 'Comunicação por SMS',
    marketing_news: 'Novidades / conteúdo',
    promotions_events: 'Promoções e eventos',
  } as Record<string, string>)[x] || x.replace(/_/g, ' ');

  const fmtDatePt = (v: unknown) => {
    const s = fmtDate(v);
    if (!s || s === '—') return '—';
    // Prefer DD/MM/YYYY for medical docs
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return s;
    return m[4] ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`;
  };

  const parts: string[] = [];
  const genDate = fmtDatePt(data.generated_at);

  parts.push(`
    <header class="cover">
      <div class="letterhead">
        <div class="brand">Clínica Tanah</div>
        <div class="brand-sub">Medicina · Bem-estar · Acompanhamento clínico</div>
      </div>
      <h1>Relatório clínico</h1>
      <p class="subtitle">Documento destinado ao prontuário e ao acompanhamento do paciente</p>
      <div class="cover-meta">
        <div><span>Paciente</span><strong>${esc(p.full_name || '—')}</strong></div>
        <div><span>Data de emissão</span><strong>${esc(genDate)}</strong></div>
        <div><span>Assinatura clínica</span><strong>${esc(opts.signatureName)}</strong></div>
        ${opts.nextFollowUpDate ? `<div><span>Próximo retorno</span><strong>${esc(fmtDatePt(opts.nextFollowUpDate))}</strong></div>` : ''}
      </div>
    </header>
  `);

  if (include.demographics) {
    parts.push(section('1. Identificação', kvTable([
      ['Nome completo', p.full_name],
      ['Nome social', p.social_name],
      ['Data de nascimento', fmtDatePt(p.birth_date)],
      ['Idade', p.age_years != null ? `${p.age_years} anos` : null],
      ['Sexo', p.gender === 'M' ? 'Masculino' : p.gender === 'F' ? 'Feminino' : p.gender],
      ['CPF', p.cpf],
      ['CNS', p.cns],
      ['Telefone', p.phone],
      ['E-mail', p.email],
      ['Endereço', address],
      ['Convênio', p.health_insurance],
      ['Nº do convênio', p.health_insurance_number],
      ['Tipo sanguíneo', p.blood_type],
      ['Ocupação', p.occupation],
      ['Estado civil', p.marital_status],
      ['Contato de emergência', [p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(' · ')],
      ['Responsável', [p.guardian_name, p.guardian_relationship, p.guardian_phone].filter(Boolean).join(' · ')],
    ].filter((row) => row[1] != null && String(row[1]).trim() !== '') as Array<[string, unknown]>)));
  }

  if (include.alerts) {
    const allergyRows = [
      ...data.allergies.map((a) => [
        esc(a.substance || a.name || '—'),
        esc(a.severity === 'legado' ? 'Informada' : (a.severity || '—')),
        esc(a.reaction || a.notes || '—'),
      ]),
      ...(Array.isArray(data.alerts.allergies_legacy) ? data.alerts.allergies_legacy.map((x: any) => [
        esc(typeof x === 'string' ? x : x?.name || '—'),
        'Informada',
        '—',
      ]) : []),
    ];
    const chronic = Array.isArray(data.alerts.chronic_conditions)
      ? data.alerts.chronic_conditions.map((c: any) => esc(typeof c === 'string' ? c : c?.name || '—')).join(', ')
      : '—';
    const problemRows = data.problems.map((pr) => [
      esc(pr.title || pr.name || '—'),
      esc(statusPt(pr.status)),
      esc(pr.icd10_code || pr.cid10_code || '—'),
    ]);
    parts.push(section('2. Alertas clínicos', `
      ${data.alerts.allergy_alert
        ? '<p class="alert">Atenção: alergia registrada no prontuário.</p>'
        : '<p class="ok">Sem alerta de alergia ativo.</p>'}
      <h3>Alergias</h3>
      ${allergyRows.length
        ? dataTable(['Substância', 'Severidade', 'Reação / notas'], allergyRows)
        : '<p class="empty">Nenhuma alergia registrada.</p>'}
      <h3>Condições crônicas</h3>
      <p>${chronic && chronic !== '—' ? chronic : 'Nenhuma condição crônica registrada.'}</p>
      ${problemRows.length ? `
        <h3>Problemas clínicos</h3>
        ${dataTable(['Problema', 'Status', 'CID-10'], problemRows)}
      ` : ''}
    `));
  }

  if (include.consents) {
    const bodyRows = (data.consents.body || [])
      .filter((c: any) => c.granted)
      .map((c: any) => [
        esc(purposeLabel(c.purpose)),
        'Sim',
        esc(fmtDatePt(c.granted_at)),
      ]);
    const lgpdRows = (data.consents.lgpd || [])
      .filter((c: any) => c.granted)
      .map((c: any) => [
        esc(purposeLabel(c.purpose)),
        'Sim',
        esc(fmtDatePt(c.granted_at)),
      ]);
    parts.push(section('3. Consentimentos', `
      <p>O paciente autorizou o tratamento de dados de saúde para fins assistenciais${data.consents.patient_lgpd_at ? ` em ${esc(fmtDatePt(data.consents.patient_lgpd_at))}` : ''}.</p>
      ${bodyRows.length ? `
        <h3>Autorizações clínicas (imagem / registro)</h3>
        ${dataTable(['Finalidade', 'Concedido', 'Data'], bodyRows)}
      ` : ''}
      ${lgpdRows.length ? `
        <h3>Comunicações e demais finalidades</h3>
        ${dataTable(['Finalidade', 'Concedido', 'Data'], lgpdRows)}
      ` : ''}
    `));
  }

  if (include.measurements) {
    const latest = data.measurements[0];
    const bmi = latest?.bmi ?? (latest?.height_cm && latest?.weight_kg
      ? Math.round((latest.weight_kg / ((latest.height_cm / 100) ** 2)) * 10) / 10
      : null);
    parts.push(section('4. Antropometria', `
      <h3>Avaliação atual</h3>
      ${kvTable([
        ['Altura', latest?.height_cm != null ? `${latest.height_cm} cm` : null],
        ['Peso', latest?.weight_kg != null ? `${latest.weight_kg} kg` : null],
        ['Cintura', latest?.waist_cm != null ? `${latest.waist_cm} cm` : null],
        ['Quadril', latest?.hip_cm != null ? `${latest.hip_cm} cm` : null],
        ['Percentual de gordura', latest?.body_fat_pct != null ? `${latest.body_fat_pct}%` : null],
        ['Massa muscular', latest?.muscle_mass_kg != null ? `${latest.muscle_mass_kg} kg` : null],
        ['IMC', bmi],
        ['Data da aferição', fmtDatePt(latest?.recorded_at || latest?.measured_at)],
      ])}
      ${data.measurements.length > 1 ? `
        <h3>Evolução</h3>
        ${dataTable(
          ['Data', 'Peso (kg)', 'Cintura (cm)', 'IMC', '% gordura', 'Massa muscular'],
          data.measurements.map((m) => {
            const mBmi = m.bmi ?? (m.height_cm && m.weight_kg
              ? Math.round((m.weight_kg / ((m.height_cm / 100) ** 2)) * 10) / 10
              : '—');
            return [
              esc(fmtDatePt(m.recorded_at || m.measured_at)),
              esc(m.weight_kg ?? '—'),
              esc(m.waist_cm ?? '—'),
              esc(mBmi),
              esc(m.body_fat_pct ?? '—'),
              esc(m.muscle_mass_kg ?? '—'),
            ];
          }),
        )}
      ` : ''}
    `));
  }

  if (include.medications) {
    parts.push(section('5. Medicamentos e receitas', `
      <h3>Medicamentos em uso</h3>
      ${data.medications.length
        ? dataTable(
          ['Medicamento', 'Dose', 'Classe', 'Desde'],
          data.medications.map((m) => [
            esc(m.name),
            esc(m.dosage || '—'),
            esc(m.class_tag || m.visual_profile || '—'),
            esc(fmtDatePt(m.started_at || m.created_at)),
          ]),
        )
        : '<p class="empty">Nenhum medicamento registrado neste módulo.</p>'}
      <h3>Receitas</h3>
      ${data.prescriptions.length ? data.prescriptions.map((rx) => {
        const items = Array.isArray(rx.items) ? rx.items : [];
        const itemLines = items.map((it: any) => {
          if (typeof it === 'string') return `<li>${esc(it)}</li>`;
          return `<li><strong>${esc(it.medication || it.name || '—')}</strong> — ${esc([it.dosage, it.frequency, it.duration, it.instructions].filter(Boolean).join(' · ') || '—')}</li>`;
        }).join('');
        return `<div class="card"><div class="card-h">${esc(fmtDatePt(rx.created_at))} · ${esc(statusPt(rx.status))} · ${esc(rx.signer_name || '—')}</div><ul>${itemLines || '<li>—</li>'}</ul></div>`;
      }).join('') : '<p class="empty">Nenhuma receita registrada.</p>'}
    `));
  }

  if (include.lifestyle) {
    const nut = data.plans.filter((pl) => (pl.plan_type || 'nutrition') === 'nutrition');
    const ex = data.plans.filter((pl) => pl.plan_type === 'exercise');
    const planCard = (pl: any, kind: string) => {
      const bits = [
        pl.weeks ? `${pl.weeks} semanas` : null,
        pl.daily_calories ? `${pl.daily_calories} kcal/dia` : null,
        pl.deficit_kcal != null ? `déficit ${pl.deficit_kcal} kcal` : null,
        pl.protein_g ? `proteína ${pl.protein_g} g` : null,
        pl.params?.resistance_days_per_week != null ? `força ${pl.params.resistance_days_per_week}×/sem` : null,
        pl.params?.cardio_days_per_week != null ? `cardio ${pl.params.cardio_days_per_week}×/sem` : null,
      ].filter(Boolean).join(' · ');
      return `<div class="card"><div class="card-h">${esc(pl.title)}</div>
        <p class="kind">${esc(kind)}${bits ? ` · ${esc(bits)}` : ''}</p>
        <p>${esc(pl.summary || pl.description || '')}</p></div>`;
    };
    parts.push(section('6. Nutrição e exercício', `
      <h3>Plano nutricional</h3>
      ${nut.length ? nut.map((pl) => planCard(pl, 'Nutrição')).join('') : '<p class="empty">Nenhum plano nutricional ativo.</p>'}
      <h3>Plano de treino</h3>
      ${ex.length ? ex.map((pl) => planCard(pl, 'Exercício')).join('') : '<p class="empty">Nenhum plano de treino ativo.</p>'}
    `));
  }

  if (include.captures) {
    const sessions = data.capture_sessions.filter((s) => (s.assets || []).some((a: any) => a.data_uri || a.has_image));
    parts.push(section('7. Registro fotográfico padronizado', sessions.length ? sessions.map((s) => {
      const ordered = ['front', 'left', 'right', 'back']
        .map((v) => (s.assets || []).find((a: any) => a.view === v))
        .filter(Boolean);
      const images = imgGrid(ordered.map((a: any) => ({
        label: viewLabel(String(a.view || '')),
        dataUri: a.data_uri || null,
      })));
      return `<div class="card">
        <div class="card-h">Registro de ${esc(fmtDatePt(s.validated_at || s.created_at))} · ${ordered.length} vistas</div>
        ${images || '<p class="empty">Fotos não disponíveis neste documento.</p>'}
      </div>`;
    }).join('') : '<p class="empty">Nenhum registro fotográfico disponível.</p>'));
  }

  if (include.scenarios) {
    const usable = data.scenarios.filter((s) =>
      ['completed', 'ready'].includes(String(s.status || ''))
      && (s.output_view_count > 0 || (s.output_images || []).some((x: any) => x.data_uri)),
    );
    parts.push(section('8. Simulação ilustrativa de composição corporal', `
      <p class="disclaimer">As imagens a seguir são <strong>ilustrativas</strong> e não constituem prognóstico clínico nem garantia de resultado. Desfechos reais variam conforme adesão, genética e resposta individual.</p>
      ${usable.length ? usable.map((s) => {
        const proj = s.projected || {};
        const ordered = ['front', 'left', 'right', 'back']
          .map((v) => (s.output_images || []).find((x: any) => x.view === v))
          .filter(Boolean);
        const images = imgGrid(ordered.map((v: any) => ({
          label: viewLabel(String(v.view || '')),
          dataUri: v.data_uri || null,
        })));
        const horizon = s.horizon_weeks || s.weeks;
        const loss = s.execution_plan?.deltas?.weight_kg ?? s.deltas?.weight_kg;
        const lossLine = loss != null
          ? `Variação prevista informada: ${Number(loss) > 0 ? '+' : ''}${Number(loss).toFixed(1)} kg`
          : null;
        return `<div class="card">
          <div class="card-h">${esc(s.title || 'Simulação')} ${horizon ? `· horizonte ${esc(horizon)} semanas` : ''}</div>
          ${lossLine ? `<p>${esc(lossLine)}</p>` : ''}
          <p>Projeção ilustrativa: peso <strong>${esc(proj.weight_kg ?? '—')}</strong> kg
            · cintura <strong>${esc(proj.waist_cm ?? '—')}</strong> cm
            · IMC <strong>${esc(proj.bmi ?? '—')}</strong></p>
          ${images || '<p class="empty">Imagens da simulação indisponíveis.</p>'}
        </div>`;
      }).join('') : '<p class="empty">Nenhuma simulação concluída para este relatório.</p>'}
    `));
  }

  if (include.chart) {
    const an = data.anamnesis;
    const hasChart = !!(an || data.vitals.length || data.evolutions.length || data.encounters.length
      || data.exam_orders.length || data.exam_results.length || data.procedures.length);
    if (hasChart) {
      parts.push(section('9. Evolução clínica', `
        ${an ? `
          <h3>Anamnese</h3>
          ${kvTable([
            ['Data', fmtDatePt(an.recorded_at)],
            ['Queixa principal', an.chief_complaint],
            ['História da doença atual', an.hpi || an.history_present_illness],
            ['Antecedentes', an.past_history],
            ['Hábitos de vida', an.social_history || an.habits],
            ['História familiar', an.family_history],
            ['Profissional', an.signer_name],
          ])}
        ` : ''}
        ${data.vitals.length ? `
          <h3>Sinais vitais</h3>
          ${dataTable(
            ['Data', 'PA', 'FC', 'Temp.', 'SpO₂', 'Peso'],
            data.vitals.map((v) => [
              esc(fmtDatePt(v.recorded_at)),
              esc([v.bp_systolic, v.bp_diastolic].filter((x) => x != null).join('/') || '—'),
              esc(v.heart_rate ?? v.hr ?? '—'),
              esc(v.temperature_c ?? v.temp_c ?? '—'),
              esc(v.spo2 ?? '—'),
              esc(v.weight_kg ?? '—'),
            ]),
          )}
        ` : ''}
        ${data.evolutions.length ? `
          <h3>Evoluções</h3>
          ${data.evolutions.map((ev) => `
            <div class="card">
              <div class="card-h">${esc(fmtDatePt(ev.recorded_at))} · ${esc(ev.signer_name || '—')}</div>
              <p class="prose">${esc(ev.content)}</p>
            </div>`).join('')}
        ` : ''}
        ${data.encounters.length ? `
          <h3>Atendimentos (SOAP)</h3>
          ${data.encounters.map((en) => `
            <div class="card">
              <div class="card-h">${esc(fmtDatePt(en.started_at))}</div>
              <p><strong>Subjetivo:</strong> ${esc(en.subjective || '—')}</p>
              <p><strong>Objetivo:</strong> ${esc(en.objective || '—')}</p>
              <p><strong>Avaliação:</strong> ${esc(en.assessment || '—')}</p>
              <p><strong>Plano:</strong> ${esc(en.plan || '—')}</p>
              ${en.cid10_codes || en.icd10_codes ? `<p><strong>CID-10:</strong> ${esc(en.cid10_codes || en.icd10_codes)}</p>` : ''}
            </div>`).join('')}
        ` : ''}
        ${data.exam_orders.length ? `
          <h3>Exames solicitados</h3>
          ${dataTable(
            ['Data', 'Exame', 'Status'],
            data.exam_orders.map((o) => [
              esc(fmtDatePt(o.ordered_at || o.created_at)),
              esc(o.exam_name || o.name || o.code || '—'),
              esc(statusPt(o.status)),
            ]),
          )}
        ` : ''}
        ${data.exam_results.length ? `
          <h3>Resultados de exames</h3>
          ${dataTable(
            ['Data', 'Exame', 'Resultado'],
            data.exam_results.map((r) => [
              esc(fmtDatePt(r.resulted_at || r.created_at)),
              esc(r.exam_name || r.name || '—'),
              esc(r.result_summary || r.result_text || r.summary || r.value || '—'),
            ]),
          )}
        ` : ''}
        ${data.procedures.length ? `
          <h3>Procedimentos</h3>
          ${dataTable(
            ['Data', 'Procedimento', 'Código'],
            data.procedures.map((pr) => [
              esc(fmtDatePt(pr.performed_at || pr.created_at)),
              esc(pr.procedure_name || pr.name || '—'),
              esc(pr.procedure_code || pr.code || '—'),
            ]),
          )}
        ` : ''}
      `));
    }
  }

  if (include.appointments && data.appointments.length) {
    parts.push(section(include.chart ? '10. Agenda' : '9. Agenda', dataTable(
      ['Data', 'Tipo', 'Status', 'Profissional'],
      data.appointments.map((a) => [
        esc(fmtDatePt(a.scheduled_at)),
        esc(statusPt(a.type)),
        esc(statusPt(a.status)),
        esc(a.practitioner_name || '—'),
      ]),
    )));
  }

  parts.push(`
    <footer class="foot">
      <div class="sign-block">
        <p class="sign-line">${esc(opts.signatureName)}</p>
        <p class="muted">Assinatura / carimbo clínico</p>
        ${opts.nextFollowUpDate ? `<p class="muted">Próximo retorno: ${esc(fmtDatePt(opts.nextFollowUpDate))}</p>` : ''}
      </div>
      <p class="legal">Documento clínico da Clínica Tanah, destinado ao prontuário e ao acompanhamento do paciente. Simulações de imagem, quando presentes, são meramente ilustrativas e não substituem avaliação médica presencial.</p>
    </footer>
  `);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Relatório clínico — ${esc(p.full_name || 'paciente')} — Clínica Tanah</title>
  <style>
    :root {
      --ink: #1a1612;
      --muted: #5c5348;
      --line: #ddd2c2;
      --paper: #fffcf7;
      --band: #2c2118;
      --accent: #8a6a32;
      --alert: #8b3a2a;
      --ok: #2f6b45;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: #f3ebe0;
      font-family: "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif;
      line-height: 1.45;
    }
    .wrap { max-width: 860px; margin: 0 auto; padding: 1.75rem 1.35rem 3rem; background: var(--paper); min-height: 100vh; }
    .letterhead { border-bottom: 2px solid var(--band); padding-bottom: .65rem; margin-bottom: .9rem; }
    .brand { font-size: 1.45rem; font-weight: 700; letter-spacing: .03em; color: var(--band); }
    .brand-sub { font-size: .78rem; color: var(--muted); margin-top: .15rem; letter-spacing: .04em; text-transform: uppercase; }
    h1 { font-size: 1.55rem; margin: .2rem 0 .25rem; font-weight: 650; }
    .subtitle { margin: 0 0 1rem; color: var(--muted); font-size: .92rem; }
    .cover-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem .9rem; margin: 1rem 0 1.25rem; }
    .cover-meta span { display: block; font-size: .68rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
    .cover-meta strong { font-size: .95rem; font-weight: 650; }
    h2 { font-size: 1.05rem; margin: 0 0 .7rem; padding-bottom: .3rem; border-bottom: 1px solid var(--line); color: var(--band); }
    h3 { font-size: .8rem; margin: .95rem 0 .35rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; }
    .sec { margin: 1.15rem 0 1.35rem; page-break-inside: avoid; }
    .meta, .muted, .kind, .empty { color: var(--muted); font-size: .88rem; }
    .empty { font-style: italic; }
    table.kv { width: 100%; border-collapse: collapse; font-size: .93rem; }
    table.kv th { text-align: left; width: 36%; color: var(--muted); font-weight: 600; padding: .32rem .45rem .32rem 0; vertical-align: top; }
    table.kv td { padding: .32rem 0; }
    table.grid { width: 100%; border-collapse: collapse; font-size: .86rem; }
    table.grid th, table.grid td { border-bottom: 1px solid var(--line); padding: .42rem .35rem; text-align: left; vertical-align: top; }
    table.grid th { color: var(--muted); font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; }
    .scroll { overflow-x: auto; }
    .card { border: 1px solid var(--line); border-radius: 4px; padding: .75rem .85rem; margin: .55rem 0; background: #fff; }
    .card-h { font-weight: 700; margin-bottom: .3rem; font-size: .95rem; }
    .prose { white-space: pre-wrap; margin: .2rem 0; }
    .alert { color: var(--alert); font-weight: 700; }
    .ok { color: var(--ok); }
    .disclaimer { font-size: .86rem; color: var(--muted); border-left: 3px solid var(--accent); padding: .35rem 0 .35rem .75rem; margin: .4rem 0 .8rem; }
    .img-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .65rem; margin: .7rem 0 .2rem; }
    .img-grid figure { margin: 0; }
    .img-grid figcaption { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-bottom: .28rem; }
    .img-grid img { width: 100%; aspect-ratio: 3/4; object-fit: cover; border: 1px solid var(--line); border-radius: 3px; background: #efe6d8; display: block; }
    .img-grid .ph { width: 100%; aspect-ratio: 3/4; display: flex; align-items: center; justify-content: center; background: #efe6d8; border: 1px solid var(--line); border-radius: 3px; color: #888; font-size: .8rem; }
    .sign-block { margin: 1.5rem 0 1rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }
    .sign-line { font-size: 1.05rem; font-weight: 700; margin: 0 0 .2rem; }
    .legal { font-size: .78rem; color: var(--muted); line-height: 1.4; }
    .foot { margin-top: 1.75rem; }
    @media (max-width: 720px) {
      .cover-meta { grid-template-columns: 1fr; }
      .img-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media print {
      body { background: #fff; }
      .wrap { max-width: none; padding: 0; }
      .sec, .card { break-inside: avoid; }
      .img-grid img { max-height: 210px; }
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
  try { db.exec(`ALTER TABLE body_clinical_reports ADD COLUMN pdf_path TEXT`); } catch { /* exists */ }
}
