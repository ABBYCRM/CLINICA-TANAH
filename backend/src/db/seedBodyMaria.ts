/**
 * Seed Maria Aparecida Silva with a full 4-view clinical body capture set
 * (front/left/right/back) so scenario before/after can be tested without manual upload.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';
import { bodyUploadsDir } from '../services/bodyImage';

const VIEWS = ['front', 'left', 'right', 'back'] as const;
const SEED_DIR = path.join(__dirname, '../data/seed-body-maria');

const DEFAULT_QUALITY = {
  framing: 'pass',
  lighting: 'pass',
  blur: 'pass',
  occlusion: 'pass',
  pose: 'pass',
};

export function seedMariaBodyCaptures(
  db: Database.Database,
  opts: { tenantId: string; patientId: string; createdBy: string },
): { sessionId: string; views: string[] } | null {
  const missing = VIEWS.filter((v) => !fs.existsSync(path.join(SEED_DIR, `${v}.jpg`)));
  if (missing.length) {
    console.warn(`  ⚠ Maria body seed images missing: ${missing.join(', ')} (${SEED_DIR})`);
    return null;
  }

  const sessionId = uuid();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO body_capture_sessions
      (id, tenant_id, patient_id, status, validated_at, quality_summary, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'complete', ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    opts.tenantId,
    opts.patientId,
    now,
    JSON.stringify({ seeded: true, views: VIEWS }),
    opts.createdBy,
    now,
    now,
  );

  const dir = bodyUploadsDir(opts.tenantId, opts.patientId);
  const insertAsset = db.prepare(`
    INSERT INTO body_capture_assets
      (id, tenant_id, session_id, patient_id, view, image_path, content_type, sha256, width, height, quality_json, metrics_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'image/jpeg', ?, ?, ?, ?, ?, ?)
  `);

  let frontCaptureId: string | null = null;
  for (const view of VIEWS) {
    const src = path.join(SEED_DIR, `${view}.jpg`);
    const buf = fs.readFileSync(src);
    const assetId = uuid();
    const imagePath = path.join(dir, `session-${sessionId}-${view}-${assetId}.jpg`);
    fs.copyFileSync(src, imagePath);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    insertAsset.run(
      assetId,
      opts.tenantId,
      sessionId,
      opts.patientId,
      view,
      imagePath,
      sha256,
      768,
      1024,
      JSON.stringify(DEFAULT_QUALITY),
      JSON.stringify({ seeded: true, bytes: buf.length }),
      now,
    );
    if (view === 'front') {
      frontCaptureId = uuid();
      db.prepare(`
        INSERT INTO body_captures
          (id, tenant_id, patient_id, view_angle, status, image_path, content_type, notes, created_by, validated_at, created_at)
        VALUES (?, ?, ?, 'front', 'validated', ?, 'image/jpeg', ?, ?, ?, ?)
      `).run(
        frontCaptureId,
        opts.tenantId,
        opts.patientId,
        imagePath,
        'seed:maria-4view',
        opts.createdBy,
        now,
        now,
      );
    }
  }

  // Body module consents required for simulation generate
  const insertConsent = db.prepare(`
    INSERT INTO body_consents (id, tenant_id, patient_id, purpose, granted, granted_at, notice_version)
    VALUES (?, ?, ?, ?, 1, ?, 'body.consent.pt-BR.v1')
    ON CONFLICT(tenant_id, patient_id, purpose) DO UPDATE SET
      granted = 1, granted_at = excluded.granted_at, revoked_at = NULL
  `);
  for (const purpose of ['clinical_record', 'image_processing', 'generative_ai']) {
    insertConsent.run(uuid(), opts.tenantId, opts.patientId, purpose, now);
  }

  // Baseline measurement so envelope/projections have numbers
  db.prepare(`
    INSERT INTO body_measurements
      (id, tenant_id, patient_id, height_cm, weight_kg, waist_cm, notes, recorded_at, recorded_by, bmi, payload)
    VALUES (?, ?, ?, 158, 92.5, 108, ?, ?, ?, 37.0, ?)
  `).run(
    uuid(),
    opts.tenantId,
    opts.patientId,
    'Seed — composição corporal (teste multi-vista)',
    now,
    opts.createdBy,
    JSON.stringify({ hip_cm: 118, body_fat_pct: 42.0, seeded: true }),
  );

  // Baseline lifestyle plans so Cenários generate works out of the box
  db.prepare(`
    INSERT INTO body_lifestyle_plans
      (id, tenant_id, patient_id, title, description, weeks, status, plan_type, summary, params_json)
    VALUES (?, ?, ?, ?, ?, 12, 'active', 'nutrition', ?, ?)
  `).run(
    uuid(),
    opts.tenantId,
    opts.patientId,
    'Déficit calórico moderado',
    'Plano nutricional seed — proteína elevada com déficit controlado',
    'Proteína elevada, déficit ~400 kcal',
    JSON.stringify({ daily_calories: 1800, deficit_kcal: 400, protein_g: 110 }),
  );
  db.prepare(`
    INSERT INTO body_lifestyle_plans
      (id, tenant_id, patient_id, title, description, weeks, status, plan_type, summary, params_json)
    VALUES (?, ?, ?, ?, ?, 12, 'active', 'exercise', ?, ?)
  `).run(
    uuid(),
    opts.tenantId,
    opts.patientId,
    'Força + cardio',
    'Plano de treino seed — 3x resistência, 2x cardio',
    '3x força, 2x cardio leve',
    JSON.stringify({ resistance_days_per_week: 3, cardio_days_per_week: 2 }),
  );

  void frontCaptureId;
  return { sessionId, views: [...VIEWS] };
}
