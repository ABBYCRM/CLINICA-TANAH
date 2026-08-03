/**
 * Unified patient documents vault — manual uploads + clinic intake sources.
 */
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { uploadsRoot } from './nvidiaOcr';

export type DocSource =
  | 'manual'
  | 'clinical_attachment'
  | 'intake_submission'
  | 'lgpd_consent'
  | 'invoice'
  | 'form';

export type UnifiedDoc = {
  id: string;
  source: DocSource;
  source_id: string;
  title: string;
  doc_type: string;
  status: string;
  mime_type: string | null;
  size_bytes: number | null;
  original_name: string | null;
  created_at: string | null;
  notes: string | null;
  can_download: boolean;
  can_delete: boolean;
  download_url: string | null;
  origin_label: string;
};

export function ensurePatientDocumentsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'form',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      signed_at TEXT,
      file_url TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  for (const sql of [
    `ALTER TABLE patient_documents ADD COLUMN storage_path TEXT`,
    `ALTER TABLE patient_documents ADD COLUMN original_name TEXT`,
    `ALTER TABLE patient_documents ADD COLUMN mime_type TEXT`,
    `ALTER TABLE patient_documents ADD COLUMN size_bytes INTEGER`,
    `ALTER TABLE patient_documents ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`,
    `ALTER TABLE patient_documents ADD COLUMN source_id TEXT`,
    `ALTER TABLE patient_documents ADD COLUMN deleted_at TEXT`,
    `ALTER TABLE patient_documents ADD COLUMN deleted_by TEXT`,
  ]) {
    try { db.exec(sql); } catch { /* exists */ }
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pdocs_source ON patient_documents(tenant_id, patient_id, source, source_id)`);
  } catch { /* exists */ }
}

export function patientDocUploadDir(tenantId: string, patientId: string): string {
  const dir = path.join(uploadsRoot(), tenantId, 'patients', patientId, 'documents');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function safeFilename(name: string): string {
  return String(name || 'arquivo').replace(/[^\w.\-()\sÀ-ÿ]+/g, '_').slice(0, 180);
}

/** Upsert a pointer row for an ingested clinic document (idempotent by source+source_id). */
export function upsertPatientDocumentPointer(db: Database.Database, args: {
  tenantId: string;
  patientId: string;
  title: string;
  docType?: string;
  status?: string;
  source: DocSource;
  sourceId: string;
  notes?: string | null;
  createdBy?: string | null;
  mimeType?: string | null;
  originalName?: string | null;
  storagePath?: string | null;
  sizeBytes?: number | null;
  fileUrl?: string | null;
}): string {
  ensurePatientDocumentsSchema(db);
  const existing = db.prepare(`
    SELECT id FROM patient_documents
    WHERE tenant_id = ? AND patient_id = ? AND source = ? AND source_id = ?
      AND deleted_at IS NULL
    LIMIT 1
  `).get(args.tenantId, args.patientId, args.source, args.sourceId) as any;
  if (existing?.id) {
    db.prepare(`
      UPDATE patient_documents SET
        title = ?, doc_type = ?, status = ?, notes = COALESCE(?, notes),
        mime_type = COALESCE(?, mime_type),
        original_name = COALESCE(?, original_name),
        storage_path = COALESCE(?, storage_path),
        size_bytes = COALESCE(?, size_bytes),
        file_url = COALESCE(?, file_url),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      args.title,
      args.docType || 'form',
      args.status || 'active',
      args.notes ?? null,
      args.mimeType ?? null,
      args.originalName ?? null,
      args.storagePath ?? null,
      args.sizeBytes ?? null,
      args.fileUrl ?? null,
      existing.id,
    );
    return existing.id;
  }
  const id = `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO patient_documents
      (id, tenant_id, patient_id, doc_type, title, status, notes, created_by,
       source, source_id, mime_type, original_name, storage_path, size_bytes, file_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, args.tenantId, args.patientId,
    args.docType || 'form', args.title, args.status || 'active',
    args.notes ?? null, args.createdBy ?? null,
    args.source, args.sourceId,
    args.mimeType ?? null, args.originalName ?? null,
    args.storagePath ?? null, args.sizeBytes ?? null, args.fileUrl ?? null,
  );
  return id;
}

export function listUnifiedPatientDocuments(
  db: Database.Database,
  tenantId: string,
  patientId: string,
): UnifiedDoc[] {
  ensurePatientDocumentsSchema(db);
  const out: UnifiedDoc[] = [];
  const seen = new Set<string>();

  const push = (doc: UnifiedDoc) => {
    const key = `${doc.source}:${doc.source_id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(doc);
  };

  // Native vault rows (manual + ingested pointers)
  const vault = db.prepare(`
    SELECT * FROM patient_documents
    WHERE tenant_id = ? AND patient_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC LIMIT 200
  `).all(tenantId, patientId) as any[];

  for (const d of vault) {
    const source = (d.source || 'manual') as DocSource;
    // Prefer live discovery for clinical attachments (keeps cancel/delete ids consistent)
    if (source === 'clinical_attachment') continue;
    const hasFile = !!(d.storage_path && fs.existsSync(d.storage_path));
    const downloadUrl = hasFile
      ? `/api/patients/${patientId}/documents/${d.id}/file`
      : (d.file_url || null);
    push({
      id: d.id,
      source,
      source_id: d.source_id || d.id,
      title: d.title,
      doc_type: d.doc_type || 'form',
      status: d.status || 'active',
      mime_type: d.mime_type || null,
      size_bytes: d.size_bytes ?? null,
      original_name: d.original_name || null,
      created_at: d.created_at || null,
      notes: d.notes || null,
      can_download: !!(downloadUrl),
      can_delete: source === 'manual',
      download_url: downloadUrl,
      origin_label: originLabel(source),
    });
  }

  // Clinical chart attachments
  try {
    const rows = db.prepare(`
      SELECT * FROM clinical_attachments
      WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 100
    `).all(tenantId, patientId) as any[];
    for (const a of rows) {
      const key = `clinical_attachment:${a.id}`;
      if (seen.has(key)) continue;
      const localPath = a.file_path && fs.existsSync(a.file_path) ? a.file_path : null;
      push({
        id: `att_${a.id}`,
        source: 'clinical_attachment',
        source_id: a.id,
        title: a.title,
        doc_type: a.doc_type || 'other',
        status: a.status,
        mime_type: a.mime || null,
        size_bytes: null,
        original_name: a.title,
        created_at: a.created_at,
        notes: a.notes || null,
        can_download: !!(localPath || (a.file_path && /^https?:\/\//i.test(a.file_path))),
        can_delete: true,
        download_url: localPath
          ? `/api/patients/${patientId}/documents/by-source/clinical_attachment/${a.id}/file`
          : (a.file_path && /^https?:\/\//i.test(a.file_path) ? a.file_path : null),
        origin_label: originLabel('clinical_attachment'),
      });
    }
  } catch { /* table may miss */ }

  // Intake / pre-triage submissions
  try {
    const rows = db.prepare(`
      SELECT s.id, s.status, s.created_at, s.pixel_submitted_at, s.full_name,
             f.name AS form_name, f.kind AS form_kind, f.slug
      FROM intake_submissions s
      LEFT JOIN intake_forms f ON f.id = s.form_id
      WHERE s.patient_id = ? AND s.tenant_id = ?
        AND s.status NOT IN ('session')
        AND COALESCE(s.pixel_submitted_at, s.full_name) IS NOT NULL
      ORDER BY COALESCE(s.pixel_submitted_at, s.created_at) DESC LIMIT 100
    `).all(patientId, tenantId) as any[];
    for (const s of rows) {
      const key = `intake_submission:${s.id}`;
      if (seen.has(key)) continue;
      push({
        id: `intake_${s.id}`,
        source: 'intake_submission',
        source_id: s.id,
        title: s.form_name || (s.form_kind === 'pre_triage' ? 'Pré-triagem' : 'Formulário de intake'),
        doc_type: s.form_kind || 'intake',
        status: s.status,
        mime_type: 'application/json',
        size_bytes: null,
        original_name: null,
        created_at: s.pixel_submitted_at || s.created_at,
        notes: s.slug || null,
        can_download: true,
        can_delete: false,
        download_url: `/api/patients/${patientId}/documents/by-source/intake_submission/${s.id}/file`,
        origin_label: originLabel('intake_submission'),
      });
    }
  } catch {
    // older schema may lack tenant_id on submissions
    try {
      const rows = db.prepare(`
        SELECT s.id, s.status, s.created_at, s.pixel_submitted_at,
               f.name AS form_name, f.kind AS form_kind, f.slug
        FROM intake_submissions s
        LEFT JOIN intake_forms f ON f.id = s.form_id
        WHERE s.patient_id = ?
          AND s.status NOT IN ('session')
        ORDER BY COALESCE(s.pixel_submitted_at, s.created_at) DESC LIMIT 100
      `).all(patientId) as any[];
      for (const s of rows) {
        const key = `intake_submission:${s.id}`;
        if (seen.has(key)) continue;
        push({
          id: `intake_${s.id}`,
          source: 'intake_submission',
          source_id: s.id,
          title: s.form_name || 'Formulário de intake',
          doc_type: s.form_kind || 'intake',
          status: s.status,
          mime_type: 'application/json',
          size_bytes: null,
          original_name: null,
          created_at: s.pixel_submitted_at || s.created_at,
          notes: s.slug || null,
          can_download: true,
          can_delete: false,
          download_url: `/api/patients/${patientId}/documents/by-source/intake_submission/${s.id}/file`,
          origin_label: originLabel('intake_submission'),
        });
      }
    } catch { /* ignore */ }
  }

  // Invoice documents for this patient
  try {
    const rows = db.prepare(`
      SELECT d.id, d.original_name, d.mime_type, d.size_bytes, d.created_at, d.storage_path,
             i.invoice_number, i.id AS invoice_id
      FROM invoice_documents d
      JOIN invoices i ON i.id = d.invoice_id
      WHERE d.tenant_id = ? AND i.patient_id = ?
      ORDER BY d.created_at DESC LIMIT 100
    `).all(tenantId, patientId) as any[];
    for (const d of rows) {
      const key = `invoice:${d.id}`;
      if (seen.has(key)) continue;
      push({
        id: `invdoc_${d.id}`,
        source: 'invoice',
        source_id: d.id,
        title: d.original_name || `Fatura ${d.invoice_number || d.invoice_id}`,
        doc_type: 'invoice',
        status: 'active',
        mime_type: d.mime_type || null,
        size_bytes: d.size_bytes ?? null,
        original_name: d.original_name || null,
        created_at: d.created_at,
        notes: d.invoice_number || null,
        can_download: true,
        can_delete: false,
        download_url: `/api/accounting/invoices/documents/${d.id}/file`,
        origin_label: originLabel('invoice'),
      });
    }
  } catch { /* ignore */ }



  out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return out;
}

function originLabel(source: string): string {
  switch (source) {
    case 'manual': return 'Manual';
    case 'clinical_attachment': return 'Anexo clínico';
    case 'intake_submission': return 'Intake / formulário';
    case 'lgpd_consent': return 'Consentimento LGPD';
    case 'invoice': return 'Fatura';
    case 'form': return 'Formulário';
    default: return source;
  }
}

export function writePatientDocumentFile(opts: {
  tenantId: string;
  patientId: string;
  docId: string;
  filename: string;
  buffer: Buffer;
}): { storagePath: string; originalName: string } {
  const originalName = safeFilename(opts.filename);
  const dir = patientDocUploadDir(opts.tenantId, opts.patientId);
  const storagePath = path.join(dir, `${opts.docId}_${originalName}`);
  fs.writeFileSync(storagePath, opts.buffer);
  return { storagePath, originalName };
}

export { safeFilename };
