/**
 * ANVISA body-medication reference library (educational visual profiles).
 * Idempotent seed from src/data/anvisaBodyMedications.json.
 */
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';

export type BodyMedicationLibraryRow = {
  id: string;
  brand_name: string;
  active_ingredient: string | null;
  dosage_form: string | null;
  concentration: string | null;
  route: string | null;
  pharmacologic_class: string | null;
  therapeutic_category: string | null;
  visual_profile: string | null;
  anvisa_id: string | null;
  holder: string | null;
  indication_text: string | null;
  label_url: string | null;
  status: string | null;
  created_at?: string;
};

function resolveCatalogPath(): string {
  const candidates = [
    path.join(__dirname, '../data/anvisaBodyMedications.json'),
    path.join(process.cwd(), 'src/data/anvisaBodyMedications.json'),
    path.join(process.cwd(), 'dist/data/anvisaBodyMedications.json'),
    path.join(process.cwd(), 'backend/src/data/anvisaBodyMedications.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function loadCatalog(): any[] {
  const file = resolveCatalogPath();
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : [];
}

/** Idempotent seed of body_medication_library from ANVISA JSON catalog. */
export function ensureBodyMedicationLibrary(db: Database.Database): { inserted: number; total: number } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS body_medication_library (
      id TEXT PRIMARY KEY,
      brand_name TEXT,
      active_ingredient TEXT,
      dosage_form TEXT,
      concentration TEXT,
      route TEXT,
      pharmacologic_class TEXT,
      therapeutic_category TEXT,
      visual_profile TEXT,
      anvisa_id TEXT,
      holder TEXT,
      indication_text TEXT,
      label_url TEXT,
      status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const items = loadCatalog();
  const upsert = db.prepare(`
    INSERT INTO body_medication_library (
      id, brand_name, active_ingredient, dosage_form, concentration, route,
      pharmacologic_class, therapeutic_category, visual_profile, anvisa_id, holder,
      indication_text, label_url, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      brand_name = excluded.brand_name,
      active_ingredient = excluded.active_ingredient,
      dosage_form = excluded.dosage_form,
      concentration = excluded.concentration,
      route = excluded.route,
      pharmacologic_class = excluded.pharmacologic_class,
      therapeutic_category = excluded.therapeutic_category,
      visual_profile = excluded.visual_profile,
      anvisa_id = excluded.anvisa_id,
      holder = excluded.holder,
      indication_text = excluded.indication_text,
      label_url = excluded.label_url,
      status = excluded.status
  `);

  let inserted = 0;
  const tx = db.transaction(() => {
    for (const it of items) {
      const id = String(it.id || '').trim();
      if (!id) continue;
      const info = upsert.run(
        id,
        it.brand_name ?? null,
        it.active_ingredient ?? null,
        it.dosage_form ?? null,
        it.concentration ?? null,
        it.route ?? null,
        it.pharmacologic_class ?? null,
        it.therapeutic_category ?? null,
        it.visual_profile ?? null,
        it.anvisa_id ?? null,
        it.holder ?? null,
        it.indication_text ?? null,
        it.label_url ?? null,
        it.status ?? 'reviewed',
      );
      if (info.changes > 0) inserted += 1;
    }
  });
  tx();

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM body_medication_library`).get() as any)?.n || 0;
  return { inserted, total };
}

export function listLibrary(db: Database.Database, opts?: { limit?: number; status?: string }): BodyMedicationLibraryRow[] {
  const limit = Math.min(500, Math.max(1, opts?.limit ?? 200));
  if (opts?.status) {
    return db.prepare(`
      SELECT * FROM body_medication_library WHERE status = ? ORDER BY brand_name ASC LIMIT ?
    `).all(opts.status, limit) as BodyMedicationLibraryRow[];
  }
  return db.prepare(`
    SELECT * FROM body_medication_library ORDER BY brand_name ASC LIMIT ?
  `).all(limit) as BodyMedicationLibraryRow[];
}

export function getById(db: Database.Database, id: string): BodyMedicationLibraryRow | null {
  if (!id) return null;
  return (db.prepare(`SELECT * FROM body_medication_library WHERE id = ?`).get(id) as BodyMedicationLibraryRow) || null;
}

export function search(db: Database.Database, q: string, opts?: { limit?: number }): BodyMedicationLibraryRow[] {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 40));
  const term = (q || '').trim();
  if (!term) return listLibrary(db, { limit });
  const like = `%${term.replace(/%/g, '')}%`;
  return db.prepare(`
    SELECT * FROM body_medication_library
    WHERE brand_name LIKE ? COLLATE NOCASE
       OR active_ingredient LIKE ? COLLATE NOCASE
       OR pharmacologic_class LIKE ? COLLATE NOCASE
       OR visual_profile LIKE ? COLLATE NOCASE
       OR anvisa_id LIKE ? COLLATE NOCASE
    ORDER BY brand_name ASC
    LIMIT ?
  `).all(like, like, like, like, like, limit) as BodyMedicationLibraryRow[];
}
