/**
 * FHIR R4 endpoints — exposes our patients, appointments, encounters, prescriptions
 * in standard HL7 FHIR R4 JSON so external EMRs (OpenEMR, MedX-style, Bahmni, etc.)
 * can sync bidirectionally.
 *
 * Conforms to:
 * - https://www.hl7.org/fhir/patient.html
 * - https://www.hl7.org/fhir/appointment.html
 * - https://www.hl7.org/fhir/encounter.html
 * - https://www.hl7.org/fhir/medicationrequest.html
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/schema';
import { authenticate } from '../middleware/auth';

const router = Router();

/** GET /fhir/metadata — FHIR CapabilityStatement */
router.get('/fhir/metadata', (_req, res) => {
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
      security: {
        service: [{ coding: [{ code: 'SMART-on-FHIR' }] }],
      },
      resource: [
        {
          type: 'Patient',
          interaction: [{ code: 'read' }, { code: 'create' }, { code: 'update' }, { code: 'delete' }, { code: 'search-type' }],
          searchParam: [
            { name: 'name', type: 'string' },
            { name: 'identifier', type: 'token' },
            { name: 'telecom', type: 'token' },
          ],
        },
        { type: 'Appointment', interaction: [{ code: 'read' }, { code: 'create' }, { code: 'search-type' }] },
        { type: 'Encounter', interaction: [{ code: 'read' }, { code: 'create' }, { code: 'search-type' }] },
        { type: 'MedicationRequest', interaction: [{ code: 'read' }, { code: 'create' }] },
      ],
    }],
  });
});

function patientToFhir(p: any): any {
  const nameParts = (p.full_name || '').split(' ');
  const given = nameParts.slice(0, -1).join(' ');
  const family = nameParts[nameParts.length - 1] || '';
  const fhir: any = {
    resourceType: 'Patient',
    id: p.id,
    active: p.lgpd_opt_out_marketing ? false : true,
    name: [{ use: 'official', given: given ? [given] : [], family }],
    gender: p.gender || 'unknown',
    birthDate: p.birth_date,
  };
  if (p.phone) fhir.telecom = [{ system: 'phone', value: p.phone, use: 'mobile' }];
  if (p.email) (fhir.telecom = fhir.telecom || []).push({ system: 'email', value: p.email });
  if (p.cpf) fhir.identifier = [{ system: 'https://clinica-tanah.com.br/identifier/cpf', value: p.cpf }];
  if (p.address_street) {
    fhir.address = [{
      use: 'home',
      line: [p.address_street, p.address_number, p.address_complement].filter(Boolean),
      city: p.address_city,
      state: p.address_state,
      postalCode: p.address_zip,
      district: p.address_neighborhood,
      country: 'BR',
    }];
  }
  if (p.health_insurance) {
    fhir.coverage = [{
      type: 'insurance',
      payor: [{ display: p.health_insurance }],
      subscriberId: p.health_insurance_number || '',
    }];
  }
  return fhir;
}

/** GET /fhir/Patient — search (params: name, identifier, _count) */
router.get('/fhir/Patient', authenticate, (req: Request, res: Response) => {
  const name = (req.query.name as string || '').trim();
  const identifier = (req.query.identifier as string || '').replace(/\D/g, '');
  const count = Math.min(parseInt(req.query._count as string || '50'), 200);
  let sql = `SELECT * FROM patients WHERE 1=1`;
  const args: any[] = [];
  if (name) { sql += ` AND full_name LIKE ?`; args.push(`%${name}%`); }
  if (identifier) { sql += ` AND cpf = ?`; args.push(identifier); }
  sql += ` ORDER BY full_name ASC LIMIT ?`; args.push(count);
  const rows = db.prepare(sql).all(...args) as any[];
  res.json({
    resourceType: 'Bundle',
    type: 'searchset',
    total: rows.length,
    entry: rows.map(p => ({ resource: patientToFhir(p), fullUrl: `Patient/${p.id}` })),
  });
});

/** GET /fhir/Patient/:id */
router.get('/fhir/Patient/:id', authenticate, (req: Request, res: Response) => {
  const p = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(req.params.id);
  if (!p) { res.status(404).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found' }] }); return; }
  res.json(patientToFhir(p));
});

export default router;
