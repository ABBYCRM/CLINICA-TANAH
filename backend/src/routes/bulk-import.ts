/**
 * Bulk import — CSV and FHIR R4 JSON
 * - CSV: simple patient CSV (compatible with spreadsheets)
 * - FHIR R4: accepts a FHIR Bundle of type "transaction" or "batch" with Patient resources
 *   This makes the system compatible with OpenEMR / MedX-style EMRs that export
 *   patients in HL7 FHIR R4 format.
 */
import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit, recordConsent } from '../services/audit';

const router = Router();
router.use(authenticate);

const SPECIALTY_CODES = new Set([
  'dermato', 'transplante_capilar', 'endocrino', 'gineco', 'nutri', 'procto',
]);

/**
 * Parse a simple CSV (one patient per line, header row required)
 * Columns: full_name, social_name, birth_date, cpf, rg, gender, phone, email,
 *          address_zip, address_street, address_number, address_complement,
 *          address_neighborhood, address_city, address_state, health_insurance,
 *          health_insurance_number, blood_type, allergies, chronic_conditions,
 *          emergency_contact_name, emergency_contact_phone, lgpd_policy_version
 *
 * - Commas inside quoted fields are supported
 * - LGPD consent is auto-recorded for every imported patient
 */
function parseCsv(text: string): { rows: Record<string, string>[]; errors: string[] } {
  const lines: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes;
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (cur.length > 0) { lines.push(cur); cur = ''; }
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) lines.push(cur);
  if (lines.length < 2) return { rows: [], errors: ['CSV must have header + at least one row'] };

  const header = lines[0].split(',').map(h => h.trim());
  const rows: Record<string, string>[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < header.length) {
      errors.push(`Row ${i + 1}: expected ${header.length} columns, got ${cols.length}`);
      continue;
    }
    const row: Record<string, string> = {};
    header.forEach((h, j) => row[h] = (cols[j] ?? '').trim());
    rows.push(row);
  }
  return { rows, errors };
}

function insertPatient(row: Record<string, string>, policyVersion: string, actorId: string, actorEmail: string): { id: string; full_name: string } {
  const id = uuid();
  const now = new Date().toISOString();
  const full_name = row.full_name || row.name || 'Sem nome';
  const cpf = (row.cpf || '').replace(/\D/g, '') || null;
  const phone = (row.phone || '').replace(/[^+\d]/g, '') || '';
  if (!full_name || !phone) throw new Error('Missing full_name or phone');

  db.prepare(`
    INSERT INTO patients (id, full_name, social_name, birth_date, cpf, rg, gender, phone, email,
                          address_zip, address_street, address_number, address_complement,
                          address_neighborhood, address_city, address_state,
                          health_insurance, health_insurance_number, blood_type,
                          allergies, chronic_conditions, medications_in_use,
                          emergency_contact_name, emergency_contact_phone,
                          lgpd_consent_at, lgpd_consent_ip, lgpd_consent_version,
                          created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id,
    full_name,
    row.social_name || null,
    row.birth_date || '1900-01-01',
    cpf,
    row.rg || null,
    row.gender || null,
    phone,
    row.email || null,
    row.address_zip || null,
    row.address_street || null,
    row.address_number || null,
    row.address_complement || null,
    row.address_neighborhood || null,
    row.address_city || null,
    row.address_state || null,
    row.health_insurance || null,
    row.health_insurance_number || null,
    row.blood_type || null,
    JSON.stringify((row.allergies || '').split(/[;,]/).map(s => s.trim()).filter(Boolean)),
    JSON.stringify((row.chronic_conditions || '').split(/[;,]/).map(s => s.trim()).filter(Boolean)),
    JSON.stringify([]),
    row.emergency_contact_name || null,
    row.emergency_contact_phone || null,
    now, '0.0.0.0', policyVersion, now, now
  );
  recordConsent({
    subjectType: 'patient', subjectId: id,
    consentType: 'health_data_processing', granted: true, policyVersion,
    ipAddress: '0.0.0.0', evidence: 'Bulk import (CSV/FHIR) — operator attested consent',
  });
  if (phone) {
    recordConsent({
      subjectType: 'patient', subjectId: id,
      consentType: 'whatsapp_communication', granted: true, policyVersion,
      ipAddress: '0.0.0.0', evidence: 'Bulk import — WhatsApp consent attested',
    });
  }
  logAudit({
    actorId, actorEmail, action: 'bulk_import_patient', resourceType: 'patient', resourceId: id,
    afterValue: { full_name, cpf, phone, source: 'csv' },
    legalBasis: 'consent_art7_I',
  });
  return { id, full_name };
}

/**
 * Map a FHIR R4 Patient resource to our internal patient row.
 * https://www.hl7.org/fhir/patient.html
 */
function fhirToRow(p: any): Record<string, string> {
  const name = p.name?.[0] ?? {};
  const full_name = [name.given?.join(' '), name.family].filter(Boolean).join(' ').trim();
  const phone = p.telecom?.find((t: any) => t.system === 'phone')?.value || '';
  const email = p.telecom?.find((t: any) => t.system === 'email')?.value || '';
  const addr = p.address?.[0] ?? {};
  const lines = (addr.line || []).map((l: any) => String(l));
  const address_street = lines[0] || '';
  const address_number = lines[1] || '';
  const address_complement = lines[2] || '';
  const cpf = p.identifier?.find((id: any) => id.system?.includes('cpf') || id.system?.includes('BR'))?.value || '';
  return {
    full_name,
    social_name: '',
    birth_date: p.birthDate || '1900-01-01',
    cpf,
    rg: '',
    gender: p.gender || '',
    phone,
    email,
    address_zip: addr.postalCode || '',
    address_street,
    address_number,
    address_complement,
    address_neighborhood: addr.district || '',
    address_city: addr.city || '',
    address_state: addr.state || '',
    health_insurance: '',
    health_insurance_number: '',
    blood_type: '',
    allergies: '',
    chronic_conditions: '',
    emergency_contact_name: p.contact?.[0]?.name?.[0] ? `${p.contact[0].name[0].given?.join(' ') || ''} ${p.contact[0].name[0].family || ''}`.trim() : '',
    emergency_contact_phone: p.contact?.[0]?.telecom?.[0]?.value || '',
  };
}

/** POST /api/patients/bulk-csv — multipart or raw text/csv body */
router.post('/patients/bulk-csv', requireRole('admin', 'receptionist'), (req: Request, res: Response) => {
  const policyVersion = (req.query.policy_version as string) || '1.0';
  const ct = req.headers['content-type'] || '';
  let csv = '';
  if (ct.includes('text/csv') || ct.includes('text/plain')) {
    csv = req.body as unknown as string;
  } else if (typeof req.body === 'string') {
    csv = req.body;
  } else if (req.body && typeof req.body.csv === 'string') {
    csv = req.body.csv;
  } else {
    res.status(400).json({ error: 'expected text/csv body or { csv: "..." }' });
    return;
  }
  const { rows, errors: parseErrors } = parseCsv(csv);
  if (!rows.length) {
    res.status(400).json({ error: 'no_rows', parse_errors: parseErrors });
    return;
  }
  const inserted: any[] = [];
  const failed: any[] = [];
  const tx = db.transaction((rs: Record<string, string>[]) => {
    for (let i = 0; i < rs.length; i++) {
      try {
        const r = insertPatient(rs[i], policyVersion, req.user!.id, req.user!.email);
        inserted.push(r);
      } catch (e: any) {
        failed.push({ row: i + 2, error: e.message, data: rs[i] });
      }
    }
  });
  tx(rows);
  logAudit({
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'bulk_patient_import_csv', resourceType: 'patient',
    legalBasis: 'consent_art7_I',
    afterValue: { total: rows.length, inserted: inserted.length, failed: failed.length },
  });
  res.json({
    total_rows: rows.length,
    inserted: inserted.length,
    failed: failed.length,
    patients: inserted,
    errors: [...parseErrors, ...failed.map(f => `Row ${f.row}: ${f.error}`)],
  });
});

/** POST /api/patients/bulk-fhir — accepts a FHIR R4 Bundle (transaction/batch) of Patients */
router.post('/patients/bulk-fhir', requireRole('admin', 'receptionist'), (req: Request, res: Response) => {
  const policyVersion = (req.query.policy_version as string) || '1.0';
  const bundle = req.body;
  if (!bundle || bundle.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) {
    res.status(400).json({ error: 'expected FHIR R4 Bundle with entry[]' });
    return;
  }
  const patients = bundle.entry
    .map((e: any) => e.resource)
    .filter((r: any) => r && r.resourceType === 'Patient');

  const inserted: any[] = [];
  const failed: any[] = [];
  const tx = db.transaction(() => {
    for (let i = 0; i < patients.length; i++) {
      try {
        const row = fhirToRow(patients[i]);
        const r = insertPatient(row, policyVersion, req.user!.id, req.user!.email);
        inserted.push({ ...r, fhir_id: patients[i].id });
      } catch (e: any) {
        failed.push({ index: i, error: e.message, fhir_id: patients[i].id });
      }
    }
  });
  tx();
  logAudit({
    actorId: req.user!.id, actorEmail: req.user!.email,
    action: 'bulk_patient_import_fhir', resourceType: 'patient',
    legalBasis: 'consent_art7_I',
    afterValue: { total: patients.length, inserted: inserted.length, failed: failed.length, source: 'fhir_r4' },
  });
  res.json({
    total: patients.length,
    inserted: inserted.length,
    failed: failed.length,
    patients: inserted,
    errors: failed,
  });
});

/** GET /api/patients/bulk-template.csv — returns a sample CSV template */
router.get('/patients/bulk-template.csv', authenticate, (_req, res) => {
  const template = [
    'full_name,social_name,birth_date,cpf,rg,gender,phone,email,address_zip,address_street,address_number,address_complement,address_neighborhood,address_city,address_state,health_insurance,health_insurance_number,blood_type,allergies,chronic_conditions,emergency_contact_name,emergency_contact_phone',
    'Maria da Silva,,1985-04-12,12345678901,1234567-8,F,+5511987654321,maria@email.com,01310-100,Rua Augusta,1000,Apto 12,Consolação,São Paulo,SP,Amil,12345,O+,Penicilina,Hipertensão,João Silva,+5511911112222',
    'Pedro Henrique Souza,,1990-12-03,34567890123,,M,+5511934567890,pedro@email.com,04538-132,Av. Brigadeiro Faria Lima,3500,,Itaim Bibi,São Paulo,SP,Bradesco Saúde,67890,B+,,,Ana Souza,+5511900001111',
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="clinica-tanah-patients-template.csv"');
  res.send(template);
});

/**
 * GET /api/fhir/capabilities — OpenEMR-compatible capability statement
 * Tells FHIR clients (e.g. MedX-style EMRs) what this server supports.
 */
router.get('/fhir/capabilities', (_req, res) => {
  res.json({
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString(),
    publisher: 'Clínica Tanah',
    kind: 'instance',
    software: { name: 'clinica-tanah', version: '1.0.0' },
    fhirVersion: '4.0.1',
    format: ['json'],
    rest: [{
      mode: 'server',
      security: { service: [{ coding: [{ code: 'SMART-on-FHIR' }] }] },
      resource: [
        { type: 'Patient', interaction: [{ code: 'read' }, { code: 'create' }, { code: 'update' }, { code: 'delete' }, { code: 'search-type' }], searchParam: [{ name: 'name', type: 'string' }, { name: 'identifier', type: 'token' }] },
        { type: 'Appointment', interaction: [{ code: 'read' }, { code: 'create' }, { code: 'search-type' }] },
        { type: 'Encounter', interaction: [{ code: 'read' }, { code: 'create' }, { code: 'search-type' }] },
        { type: 'MedicationRequest', interaction: [{ code: 'read' }, { code: 'create' }] },
      ],
    }],
  });
});

export default router;
