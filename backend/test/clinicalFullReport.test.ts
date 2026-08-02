import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  collectClinicalReportData,
  ensureClinicalReportsTable,
  renderClinicalReportHtml,
} from '../src/services/clinicalFullReport';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-report-'));
const dbPath = path.join(tmp, 't.sqlite');

describe('clinicalFullReport', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE patients (
        id TEXT PRIMARY KEY, tenant_id TEXT, full_name TEXT, birth_date TEXT, gender TEXT,
        phone TEXT, email TEXT, cpf TEXT, health_insurance TEXT, allergies TEXT,
        chronic_conditions TEXT, address_city TEXT, address_state TEXT,
        lgpd_consent_at TEXT, lgpd_consent_version TEXT, lgpd_opt_out_marketing INTEGER DEFAULT 0
      );
      CREATE TABLE clinical_allergies (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, recorded_by TEXT,
        substance TEXT, reaction TEXT, severity TEXT, status TEXT, created_at TEXT
      );
      CREATE TABLE clinical_problems (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, recorded_by TEXT,
        title TEXT, cid10_code TEXT, status TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE body_consents (
        tenant_id TEXT, patient_id TEXT, purpose TEXT, granted INTEGER, granted_at TEXT, revoked_at TEXT
      );
      CREATE TABLE lgpd_consents (
        subject_type TEXT, subject_id TEXT, consent_type TEXT, granted INTEGER,
        granted_at TEXT, revoked_at TEXT, policy_version TEXT
      );
      CREATE TABLE body_measurements (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, height_cm REAL, weight_kg REAL,
        waist_cm REAL, body_fat_pct REAL, muscle_mass_kg REAL, bmi REAL, recorded_at TEXT
      );
      CREATE TABLE body_medications (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, name TEXT, dosage TEXT,
        class_tag TEXT, status TEXT, created_at TEXT, started_at TEXT
      );
      CREATE TABLE prescriptions (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, items TEXT, status TEXT,
        created_at TEXT, signer_name TEXT, signer_council TEXT, signer_council_state TEXT, signed_at TEXT, encounter_id TEXT
      );
      CREATE TABLE body_lifestyle_plans (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, title TEXT, summary TEXT,
        description TEXT, plan_type TEXT, status TEXT, weeks INTEGER, params_json TEXT, created_at TEXT
      );
      CREATE TABLE body_capture_sessions (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, status TEXT, quality_summary TEXT,
        created_at TEXT, updated_at TEXT, validated_at TEXT, deleted_at TEXT
      );
      CREATE TABLE body_capture_assets (
        id TEXT PRIMARY KEY, tenant_id TEXT, session_id TEXT, patient_id TEXT, view TEXT,
        quality_json TEXT, content_type TEXT, image_path TEXT, created_at TEXT, deleted_at TEXT
      );
      CREATE TABLE body_scenarios (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, title TEXT, goal TEXT, weeks INTEGER,
        horizon_weeks INTEGER, status TEXT, review_status TEXT, provider TEXT, prompt_version TEXT,
        reviewed_at TEXT, review_signature TEXT, execution_plan TEXT, plan_config TEXT, assumptions TEXT,
        created_at TEXT, updated_at TEXT, image_path TEXT, output_views TEXT
      );
      CREATE TABLE clinical_evolutions (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, content TEXT, status TEXT,
        recorded_at TEXT, note_type TEXT, signer_name TEXT
      );
      CREATE TABLE clinical_vitals (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, status TEXT, recorded_at TEXT,
        bp_systolic INTEGER, bp_diastolic INTEGER, heart_rate INTEGER, temperature_c REAL, spo2 INTEGER, weight_kg REAL
      );
      CREATE TABLE clinical_anamnesis (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, status TEXT, recorded_at TEXT,
        chief_complaint TEXT, hpi TEXT, past_history TEXT, family_history TEXT, social_history TEXT, signer_name TEXT
      );
      CREATE TABLE clinical_exam_orders (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, exam_name TEXT, status TEXT, ordered_at TEXT, notes TEXT
      );
      CREATE TABLE clinical_exam_results (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, exam_name TEXT, result_summary TEXT, status TEXT, resulted_at TEXT
      );
      CREATE TABLE clinical_procedures (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, procedure_name TEXT, procedure_code TEXT,
        description TEXT, status TEXT, performed_at TEXT
      );
      CREATE TABLE encounters (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, started_at TEXT, ended_at TEXT, status TEXT,
        subjective TEXT, objective TEXT, assessment TEXT, plan TEXT, cid10_codes TEXT
      );
      CREATE TABLE appointments (
        id TEXT PRIMARY KEY, tenant_id TEXT, patient_id TEXT, practitioner_id TEXT, scheduled_at TEXT,
        type TEXT, status TEXT, source TEXT, notes TEXT
      );
      CREATE TABLE users (id TEXT PRIMARY KEY, full_name TEXT);
    `);
    ensureClinicalReportsTable(db);

    db.prepare(`
      INSERT INTO patients (id, tenant_id, full_name, birth_date, gender, phone, email, health_insurance, allergies, chronic_conditions, address_city, address_state, lgpd_consent_at, lgpd_consent_version)
      VALUES ('p1','t1','Ana Beatriz Lima','1990-05-10','F','11999999999','ana@example.com','Amil','["Asma leve"]','["Asma leve"]','São Paulo','SP','2026-01-01','v1')
    `).run();
    db.prepare(`
      INSERT INTO body_measurements (id, tenant_id, patient_id, height_cm, weight_kg, waist_cm, body_fat_pct, bmi, recorded_at)
      VALUES ('m1','t1','p1',165,98,112,42,36,'2026-07-01')
    `).run();
    db.prepare(`
      INSERT INTO body_lifestyle_plans (id, tenant_id, patient_id, title, summary, plan_type, status, params_json, created_at)
      VALUES ('pl1','t1','p1','Déficit calórico Ana','Proteína elevada','nutrition','active','{"daily_calories":1700,"deficit_kcal":500,"protein_g":120}','2026-07-02')
    `).run();
    db.prepare(`
      INSERT INTO encounters (id, tenant_id, patient_id, started_at, status, subjective, objective, assessment, plan)
      VALUES ('e1','t1','p1','2026-07-03','active','Queixa de peso','IMC 36','Obesidade','Dieta + treino')
    `).run();
    db.prepare(`
      INSERT INTO body_consents (tenant_id, patient_id, purpose, granted, granted_at, revoked_at)
      VALUES ('t1','p1','clinical_record',1,'2026-07-01',NULL),
             ('t1','p1','image_processing',1,'2026-07-01',NULL),
             ('t1','p1','generative_ai',1,'2026-07-01',NULL)
    `).run();
    const imgPath = path.join(tmp, 'front.jpg');
    fs.writeFileSync(imgPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9])); // minimal jpeg bytes
    db.prepare(`
      INSERT INTO body_capture_sessions (id, tenant_id, patient_id, status, quality_summary, created_at, updated_at, validated_at, deleted_at)
      VALUES ('s1','t1','p1','validated','{}','2026-07-04','2026-07-04','2026-07-04',NULL)
    `).run();
    db.prepare(`
      INSERT INTO body_capture_assets (id, tenant_id, session_id, patient_id, view, quality_json, content_type, image_path, created_at, deleted_at)
      VALUES ('a1','t1','s1','p1','front','{}','image/jpeg',?,'2026-07-04',NULL)
    `).run(imgPath);
    db.prepare(`
      INSERT INTO body_scenarios (id, tenant_id, patient_id, title, goal, weeks, horizon_weeks, status, review_status, provider, prompt_version, reviewed_at, review_signature, execution_plan, plan_config, assumptions, created_at, updated_at, image_path, output_views)
      VALUES ('sc1','t1','p1','Cenário 12w','Perda',12,12,'completed','approved','local','v1','2026-07-05','Dra. J',
        '{"summary":"Projeção ilustrativa","projected":{"weight_kg":90,"waist_cm":100,"bmi":33}}',
        NULL, NULL, '2026-07-05','2026-07-05', ?, ?)
    `).run(imgPath, JSON.stringify({ front: { path: imgPath } }));
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('collects and renders full HTML dossier with clinical images', () => {
    const data = collectClinicalReportData({
      db,
      tenantId: 't1',
      patientId: 'p1',
      signatureName: 'Dra. Juliana',
    });
    expect(data.patient.full_name).toContain('Ana');
    expect(data.measurements.length).toBe(1);
    expect(data.plans.length).toBe(1);
    expect(data.encounters.length).toBe(1);
    expect(data.counts.measurements).toBe(1);
    expect(data.image_policy.capture_images_allowed).toBe(true);
    expect(data.image_policy.scenario_images_allowed).toBe(true);
    expect(data.image_policy.capture_images_embedded).toBeGreaterThanOrEqual(1);
    expect(data.image_policy.scenario_images_embedded).toBeGreaterThanOrEqual(1);

    const html = renderClinicalReportHtml(data, { signatureName: 'Dra. Juliana' });
    expect(html).toContain('Relatório clínico completo');
    expect(html).toContain('Ana Beatriz Lima');
    expect(html).toContain('Déficit calórico Ana');
    expect(html).toContain('Queixa de peso');
    expect(html).toContain('IMC');
    expect(html).toContain('data:image/jpeg;base64,');
    expect(html).toContain('img-grid');
  });
});
