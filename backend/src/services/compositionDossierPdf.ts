/**
 * Medical-grade PDF dossiers for body composition / clinical notes.
 * Stored in Documentos for patient records, download, and email.
 */
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import type Database from 'better-sqlite3';
import { uploadsRoot } from './nvidiaOcr';
import { patientDocUploadDir } from './patientDocumentsVault';

export type DossierPatient = {
  id: string;
  full_name?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  cpf?: string | null;
  health_insurance?: string | null;
};

export type DossierMeasurement = {
  recorded_at?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  neck_cm?: number | null;
  chest_cm?: number | null;
  abdomen_cm?: number | null;
  body_fat_pct?: number | null;
  muscle_mass_kg?: number | null;
  bmi?: number | null;
  whr?: number | null;
  whtr?: number | null;
  notes?: string | null;
  clothing_note?: string | null;
  posture_note?: string | null;
};

export type DossierMed = {
  name: string;
  class_tag?: string | null;
  dosage?: string | null;
  status?: string | null;
};

export type DossierPlan = {
  title: string;
  plan_type?: string | null;
  summary?: string | null;
  description?: string | null;
  weeks?: number | null;
  daily_calories?: number | null;
  deficit_kcal?: number | null;
  protein_g?: number | null;
};

export type CompositionDossierInput = {
  clinicName?: string;
  patient: DossierPatient;
  measurement?: DossierMeasurement | null;
  medications?: DossierMed[];
  nutritionPlans?: DossierPlan[];
  exercisePlans?: DossierPlan[];
  doctorPredictedLossKg?: number | null;
  targetWeightKg?: number | null;
  scenarioSummary?: string | null;
  scenarioHorizonWeeks?: number | null;
  signatureName?: string | null;
  nextFollowUpDate?: string | null;
  generatedBy?: string | null;
  kind?: 'composition_note' | 'clinical_full';
  title?: string;
};

function fmt(v: unknown, suffix = ''): string {
  if (v == null || v === '') return '—';
  return `${v}${suffix}`;
}

function ageFromBirth(birth?: string | null): string {
  if (!birth || !/^\d{4}-\d{2}-\d{2}/.test(birth)) return '—';
  const d = new Date(birth);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return `${age} anos`;
}

function fmtDatePt(v?: string | null): string {
  if (!v) return '—';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return String(v);
  return m[4] ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.6);
  doc.fillColor('#2c2118').font('Times-Bold').fontSize(12).text(title);
  doc.moveTo(doc.page.margins.left, doc.y + 2)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
    .strokeColor('#c4b59a')
    .lineWidth(0.8)
    .stroke();
  doc.moveDown(0.45);
  doc.fillColor('#2c2118').font('Times-Roman').fontSize(10);
}

function kv(doc: PDFKit.PDFDocument, label: string, value: string, colWidth?: number) {
  const x = doc.x;
  const y = doc.y;
  const w = colWidth || (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  doc.font('Times-Bold').fontSize(9).fillColor('#5c4f42').text(label, x, y, { width: w * 0.42, continued: false });
  doc.font('Times-Roman').fontSize(10).fillColor('#2c2118').text(value, x + w * 0.42, y, { width: w * 0.58 });
  doc.moveDown(0.15);
}

/** Build a medical-grade composition / clinical PDF buffer. */
export async function buildCompositionDossierPdf(input: CompositionDossierInput): Promise<Buffer> {
  const clinic = (input.clinicName || 'Clínica Tanah').trim();
  const kind = input.kind || 'composition_note';
  const title = input.title
    || (kind === 'clinical_full'
      ? 'Relatório clínico'
      : 'Nota de composição corporal');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 48, bottom: 56, left: 48, right: 48 },
      info: {
        Title: title,
        Author: clinic,
        Subject: 'Relatório clínico',
        Creator: clinic,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Letterhead
    doc.rect(0, 0, doc.page.width, 68).fill('#2c2118');
    doc.fillColor('#f4efe6').font('Times-Bold').fontSize(16)
      .text(clinic, 48, 20, { width: pageW });
    doc.font('Times-Roman').fontSize(9)
      .text('Medicina · Bem-estar · Acompanhamento clínico', 48, 42, { width: pageW });
    doc.fillColor('#2c2118');
    doc.y = 88;

    doc.font('Times-Bold').fontSize(15).text(title, { width: pageW });
    doc.moveDown(0.25);
    doc.font('Times-Italic').fontSize(9).fillColor('#5c4f42')
      .text(`Emitido em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`, { width: pageW });
    doc.fillColor('#2c2118');

    // Patient
    drawSectionTitle(doc, '1. Identificação');
    kv(doc, 'Nome', input.patient.full_name || '—');
    kv(doc, 'Nascimento', `${fmtDatePt(input.patient.birth_date?.slice?.(0, 10) || input.patient.birth_date)} (${ageFromBirth(input.patient.birth_date)})`);
    const sex = input.patient.gender === 'M' ? 'Masculino'
      : input.patient.gender === 'F' ? 'Feminino'
        : fmt(input.patient.gender);
    kv(doc, 'Sexo', sex);
    kv(doc, 'Telefone', fmt(input.patient.phone));
    kv(doc, 'E-mail', fmt(input.patient.email));
    kv(doc, 'Convênio', fmt(input.patient.health_insurance));

    // Anthropometry
    drawSectionTitle(doc, '2. Antropometria');
    const m = input.measurement;
    if (!m) {
      doc.font('Times-Italic').fillColor('#5c4f42').text('Nenhuma medida registrada.');
      doc.fillColor('#2c2118');
    } else {
      doc.font('Times-Roman').fontSize(9).fillColor('#5c4f42')
        .text(`Data da aferição: ${fmtDatePt(m.recorded_at)}`);
      doc.moveDown(0.3);
      doc.fillColor('#2c2118');
      const leftX = doc.page.margins.left;
      const midX = leftX + pageW / 2 + 8;
      const colW = pageW / 2 - 8;
      const startY = doc.y;
      const rows: Array<[string, string]> = [
        ['Altura', fmt(m.height_cm, ' cm')],
        ['Peso', fmt(m.weight_kg, ' kg')],
        ['IMC', fmt(m.bmi)],
        ['Cintura', fmt(m.waist_cm, ' cm')],
        ['Quadril', fmt(m.hip_cm, ' cm')],
        ['Percentual de gordura', fmt(m.body_fat_pct, '%')],
        ['Massa muscular', fmt(m.muscle_mass_kg, ' kg')],
      ];
      if (m.whr != null || m.whtr != null) {
        rows.push(['RCQ / RCE', `${fmt(m.whr)} / ${fmt(m.whtr)}`]);
      }
      if (m.neck_cm != null) rows.push(['Pescoço', fmt(m.neck_cm, ' cm')]);
      if (m.chest_cm != null) rows.push(['Tórax', fmt(m.chest_cm, ' cm')]);
      if (m.abdomen_cm != null) rows.push(['Abdômen', fmt(m.abdomen_cm, ' cm')]);
      rows.forEach((pair, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = col === 0 ? leftX : midX;
        const y = startY + row * 16;
        doc.font('Times-Bold').fontSize(8).fillColor('#5c4f42').text(pair[0], x, y, { width: colW * 0.45 });
        doc.font('Times-Roman').fontSize(10).fillColor('#2c2118').text(pair[1], x + colW * 0.45, y, { width: colW * 0.55 });
      });
      doc.y = startY + Math.ceil(rows.length / 2) * 16 + 6;
      if (m.clothing_note || m.posture_note || m.notes) {
        doc.font('Times-Roman').fontSize(9).fillColor('#5c4f42');
        if (m.clothing_note) doc.text(`Vestuário: ${m.clothing_note}`);
        if (m.posture_note) doc.text(`Postura: ${m.posture_note}`);
        if (m.notes) doc.text(`Observações: ${m.notes}`);
        doc.fillColor('#2c2118');
      }
    }

    // Medications
    drawSectionTitle(doc, '3. Medicamentos');
    const meds = input.medications || [];
    if (!meds.length) {
      doc.font('Times-Italic').fillColor('#5c4f42').text('Nenhum medicamento ativo registrado.');
      doc.fillColor('#2c2118');
    } else {
      meds.forEach((med, i) => {
        doc.font('Times-Bold').fontSize(10).fillColor('#2c2118')
          .text(`${i + 1}. ${med.name}`);
        doc.font('Times-Roman').fontSize(9).fillColor('#5c4f42')
          .text([med.dosage, med.class_tag].filter(Boolean).join(' · ') || '—');
        doc.fillColor('#2c2118');
        doc.moveDown(0.15);
      });
    }

    // Lifestyle
    drawSectionTitle(doc, '4. Nutrição e exercício');
    const nuts = input.nutritionPlans || [];
    const exs = input.exercisePlans || [];
    if (!nuts.length && !exs.length) {
      doc.font('Times-Italic').fillColor('#5c4f42').text('Nenhum plano nutricional ou de treino ativo.');
      doc.fillColor('#2c2118');
    } else {
      if (nuts.length) {
        doc.font('Times-Bold').fontSize(10).text('Plano nutricional');
        nuts.forEach((p) => {
          doc.font('Times-Roman').fontSize(10).fillColor('#2c2118').text(`• ${p.title}`);
          const bits = [
            p.weeks != null ? `${p.weeks} semanas` : null,
            p.daily_calories != null ? `${p.daily_calories} kcal/dia` : null,
            p.deficit_kcal != null ? `déficit ${p.deficit_kcal} kcal` : null,
            p.protein_g != null ? `proteína ${p.protein_g} g` : null,
          ].filter(Boolean);
          if (bits.length || p.summary || p.description) {
            doc.fontSize(9).fillColor('#5c4f42')
              .text([bits.join(' · '), p.summary || p.description].filter(Boolean).join(' — '));
          }
          doc.fillColor('#2c2118');
        });
        doc.moveDown(0.2);
      }
      if (exs.length) {
        doc.font('Times-Bold').fontSize(10).text('Plano de treino');
        exs.forEach((p) => {
          doc.font('Times-Roman').fontSize(10).fillColor('#2c2118').text(`• ${p.title}`);
          if (p.summary || p.description || p.weeks != null) {
            doc.fontSize(9).fillColor('#5c4f42')
              .text([p.weeks != null ? `${p.weeks} semanas` : null, p.summary || p.description].filter(Boolean).join(' — '));
          }
          doc.fillColor('#2c2118');
        });
      }
    }

    // Clinical projection (illustrative)
    if (input.doctorPredictedLossKg != null || input.targetWeightKg != null || input.scenarioSummary) {
      drawSectionTitle(doc, '5. Projeção ilustrativa');
      doc.font('Times-Roman').fontSize(9).fillColor('#5c4f42')
        .text('Projeção baseada na meta informada pelo clínico. As imagens, quando geradas, são meramente ilustrativas.');
      doc.moveDown(0.25);
      doc.fillColor('#2c2118');
      if (input.doctorPredictedLossKg != null) {
        kv(doc, 'Variação de peso prevista', `${input.doctorPredictedLossKg} kg`);
      }
      if (input.targetWeightKg != null) {
        kv(doc, 'Peso-alvo', `${input.targetWeightKg} kg`);
      }
      if (input.scenarioHorizonWeeks != null) {
        kv(doc, 'Horizonte', `${input.scenarioHorizonWeeks} semanas`);
      }
      if (input.scenarioSummary) {
        doc.font('Times-Roman').fontSize(9).fillColor('#5c4f42').text(input.scenarioSummary, { width: pageW });
        doc.fillColor('#2c2118');
      }
    }

    // Signature / follow-up
    drawSectionTitle(doc, input.doctorPredictedLossKg != null || input.targetWeightKg != null || input.scenarioSummary
      ? '6. Assinatura e retorno'
      : '5. Assinatura e retorno');
    kv(doc, 'Assinatura / carimbo', input.signatureName || '—');
    kv(doc, 'Próximo retorno', input.nextFollowUpDate ? fmtDatePt(input.nextFollowUpDate) : '—');

    doc.moveDown(0.8);
    doc.font('Times-Italic').fontSize(8).fillColor('#5c4f42')
      .text(
        'Simulações de imagem e projeções de peso, quando presentes, são ilustrativas e não constituem prognóstico clínico '
        + 'nem garantia de resultado. Desfechos reais dependem de genética, adesão e resposta individual. '
        + 'Documento destinado ao prontuário e ao acompanhamento do paciente.',
        { width: pageW, align: 'justify' },
      );

    // Footer on each page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Times-Roman').fontSize(7).fillColor('#8a7d6e')
        .text(
          `${clinic} · Relatório clínico · Página ${i - range.start + 1} de ${range.count}`,
          doc.page.margins.left,
          doc.page.height - 36,
          { width: pageW, align: 'center' },
        );
    }

    doc.end();
  });
}

export function compositionDossierDir(tenantId: string, patientId: string): string {
  const dir = path.join(uploadsRoot(), tenantId, 'body', patientId, 'dossiers');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeCompositionDossierPdf(opts: {
  tenantId: string;
  patientId: string;
  reportId: string;
  buffer: Buffer;
}): string {
  const dir = compositionDossierDir(opts.tenantId, opts.patientId);
  const filePath = path.join(dir, `${opts.reportId}.pdf`);
  fs.writeFileSync(filePath, opts.buffer);
  // Mirror into patient documents upload dir for vault continuity
  try {
    const vaultDir = patientDocUploadDir(opts.tenantId, opts.patientId);
    fs.copyFileSync(filePath, path.join(vaultDir, `${opts.reportId}.pdf`));
  } catch { /* optional */ }
  return filePath;
}

/** Collect active body prontuário rows for a patient (measurements / meds / plans). */
export function collectBodyProntuarioForDossier(db: Database.Database, tenantId: string, patientId: string): {
  measurement: DossierMeasurement | null;
  medications: DossierMed[];
  nutritionPlans: DossierPlan[];
  exercisePlans: DossierPlan[];
} {
  const row = db.prepare(`
    SELECT * FROM body_measurements
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY recorded_at DESC LIMIT 1
  `).get(tenantId, patientId) as any;
  let measurement: DossierMeasurement | null = null;
  if (row) {
    let payload: any = {};
    try { payload = row.payload ? JSON.parse(row.payload) : {}; } catch { payload = {}; }
    measurement = {
      recorded_at: row.recorded_at || row.measured_at,
      height_cm: payload.height_cm ?? row.height_cm,
      weight_kg: payload.weight_kg ?? row.weight_kg,
      waist_cm: payload.waist_cm ?? row.waist_cm,
      hip_cm: payload.hip_cm,
      neck_cm: payload.neck_cm,
      chest_cm: payload.chest_cm,
      abdomen_cm: payload.abdomen_cm,
      body_fat_pct: payload.body_fat_pct,
      muscle_mass_kg: payload.muscle_mass_kg,
      bmi: payload.bmi ?? row.bmi,
      whr: payload.whr ?? row.whr,
      whtr: payload.whtr ?? row.whtr,
      notes: payload.notes || row.notes,
      clothing_note: payload.clothing_note,
      posture_note: payload.posture_note,
    };
  }
  const medications = (db.prepare(`
    SELECT name, class_tag, dosage, status FROM body_medications
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(tenantId, patientId) as any[]).map((m) => ({
    name: m.name,
    class_tag: m.class_tag,
    dosage: m.dosage,
    status: m.status,
  }));
  const plans = db.prepare(`
    SELECT title, plan_type, summary, description, weeks, params_json
    FROM body_lifestyle_plans
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(tenantId, patientId) as any[];
  const hydrate = (p: any): DossierPlan => {
    let params: any = {};
    try { params = p.params_json ? JSON.parse(p.params_json) : {}; } catch { params = {}; }
    return {
      title: p.title,
      plan_type: p.plan_type,
      summary: p.summary,
      description: p.description,
      weeks: p.weeks,
      daily_calories: params.daily_calories ?? null,
      deficit_kcal: params.deficit_kcal ?? null,
      protein_g: params.protein_g ?? null,
    };
  };
  return {
    measurement,
    medications,
    nutritionPlans: plans.filter((p) => (p.plan_type || 'nutrition') === 'nutrition').map(hydrate),
    exercisePlans: plans.filter((p) => p.plan_type === 'exercise').map(hydrate),
  };
}
