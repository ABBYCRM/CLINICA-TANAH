/**
 * Fulfill LGPD art. 18 data-subject requests with real CFM-safe actions.
 * Deletion → anonymize identity, keep clinical retention records.
 */
import { db } from '../db/schema';
import { seal, blindIndex } from './phiCrypto';
import { setPatientConsent, CONSENT_PURPOSES } from './patientJourney';
import { logAudit } from './audit';

export type FulfillResult = {
  ok: true;
  action: string;
  details: Record<string, unknown>;
};

function patientExport(tenantId: string, patientId: string) {
  const patient = db.prepare(`SELECT * FROM patients WHERE id = ? AND tenant_id = ?`).get(patientId, tenantId);
  const appointments = db.prepare(`SELECT id, scheduled_at, type, status, notes FROM appointments WHERE patient_id = ? AND tenant_id = ? ORDER BY scheduled_at DESC LIMIT 200`).all(patientId, tenantId);
  const encounters = db.prepare(`SELECT id, started_at, status, chief_complaint FROM encounters WHERE patient_id = ? AND tenant_id = ? ORDER BY started_at DESC LIMIT 200`).all(patientId, tenantId);
  const prescriptions = db.prepare(`SELECT id, created_at, status FROM prescriptions WHERE patient_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 200`).all(patientId, tenantId);
  const consents = db.prepare(`SELECT consent_type, granted, granted_at, revoked_at, policy_version FROM lgpd_consents WHERE subject_type='patient' AND subject_id = ? ORDER BY granted_at DESC LIMIT 200`).all(patientId);
  return { exported_at: new Date().toISOString(), patient, appointments, encounters, prescriptions, consents };
}

/** Anonymize identifying fields; retain clinical rows (CFM). */
export function anonymizePatientForDeletion(args: {
  tenantId: string;
  patientId: string;
  actorId: string;
  actorEmail: string;
}): FulfillResult {
  const p = db.prepare(`SELECT id, full_name FROM patients WHERE id = ? AND tenant_id = ?`).get(args.patientId, args.tenantId) as any;
  if (!p) throw Object.assign(new Error('not_found'), { code: 'not_found' });

  const anonName = `Paciente anonimizado ${String(args.patientId).slice(0, 8)}`;
  const redactedPhone = `+5500000${String(Date.now()).slice(-6)}`;
  const redactedCpf = '00000000000';

  db.prepare(`
    UPDATE patients SET
      full_name = ?, social_name = NULL,
      cpf = ?, cpf_blind = ?,
      phone = ?, phone_secondary = NULL,
      email = NULL,
      address_zip = NULL, address_street = NULL, address_number = NULL,
      address_complement = NULL, address_neighborhood = NULL,
      address_city = NULL, address_state = NULL,
      rg = NULL, mother_name = NULL, father_name = NULL,
      emergency_contact_name = NULL, emergency_contact_phone = NULL,
      notes = ?,
      lifecycle_stage = 'archived',
      do_not_contact = 1,
      lgpd_opt_out_marketing = 1,
      updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).run(
    anonName,
    seal(redactedCpf),
    blindIndex(redactedCpf),
    redactedPhone,
    seal('LGPD art.18 deletion fulfilled — identity anonymized; clinical retention preserved (CFM 1.821/2007).'),
    args.patientId,
    args.tenantId,
  );

  // Revoke all marketing / communication consents
  for (const purpose of CONSENT_PURPOSES) {
    if (purpose === 'health_data_processing' || purpose === 'data_processing') continue;
    try {
      setPatientConsent({
        patientId: args.patientId,
        tenantId: args.tenantId,
        purpose,
        granted: false,
        source: 'lgpd_deletion_fulfill',
      });
    } catch { /* ignore */ }
  }

  // Opt out WhatsApp conversations linked to this patient
  db.prepare(`UPDATE whatsapp_conversations SET opted_out = 1, patient_id = NULL WHERE patient_id = ?`).run(args.patientId);

  logAudit({
    tenantId: args.tenantId,
    actorId: args.actorId,
    actorEmail: args.actorEmail,
    action: 'lgpd_patient_anonymized',
    resourceType: 'patient',
    resourceId: args.patientId,
    beforeValue: { full_name: p.full_name },
    afterValue: { anonymized: true, clinical_retained: true },
    legalBasis: 'legal_obligation_art7_II',
  });

  return {
    ok: true,
    action: 'anonymized',
    details: {
      patient_id: args.patientId,
      clinical_records_retained: true,
      marketing_revoked: true,
      do_not_contact: true,
    },
  };
}

export function fulfillDataRequest(args: {
  tenantId: string;
  requestId: string;
  actorId: string;
  actorEmail: string;
  notes?: string | null;
}): FulfillResult {
  const req = db.prepare(`SELECT * FROM lgpd_data_requests WHERE id = ? AND tenant_id = ?`).get(args.requestId, args.tenantId) as any;
  if (!req) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  if (req.status === 'fulfilled') {
    return { ok: true, action: 'already_fulfilled', details: { id: req.id } };
  }

  let details: Record<string, unknown> = {};
  let action = 'marked_fulfilled';

  if (req.subject_type === 'patient' && req.subject_id) {
    if (req.request_type === 'deletion') {
      const r = anonymizePatientForDeletion({
        tenantId: args.tenantId,
        patientId: req.subject_id,
        actorId: args.actorId,
        actorEmail: args.actorEmail,
      });
      action = r.action;
      details = r.details;
    } else if (req.request_type === 'access' || req.request_type === 'portability') {
      const payload = patientExport(args.tenantId, req.subject_id);
      details = { export_keys: Object.keys(payload), record_counts: {
        appointments: (payload.appointments as any[]).length,
        encounters: (payload.encounters as any[]).length,
        prescriptions: (payload.prescriptions as any[]).length,
        consents: (payload.consents as any[]).length,
      } };
      // Store export snapshot reference in response notes (size-capped)
      const snap = JSON.stringify(details);
      args.notes = [args.notes, `export:${snap}`].filter(Boolean).join('\n').slice(0, 4000);
      action = 'export_prepared';
    } else if (req.request_type === 'opposition') {
      db.prepare(`UPDATE patients SET do_not_contact = 1, lgpd_opt_out_marketing = 1, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`)
        .run(req.subject_id, args.tenantId);
      for (const purpose of ['marketing_news', 'promotions_events', 'email_communication', 'sms_communication'] as const) {
        try {
          setPatientConsent({ patientId: req.subject_id, tenantId: args.tenantId, purpose, granted: false, source: 'lgpd_opposition' });
        } catch { /* ignore */ }
      }
      action = 'opposition_applied';
      details = { do_not_contact: true };
    }
  }

  db.prepare(`
    UPDATE lgpd_data_requests
       SET status = 'fulfilled', fulfilled_at = datetime('now'), handled_by = ?, response_notes = ?
     WHERE id = ? AND tenant_id = ?
  `).run(args.actorId, args.notes ?? null, args.requestId, args.tenantId);

  logAudit({
    tenantId: args.tenantId,
    actorId: args.actorId,
    actorEmail: args.actorEmail,
    action: 'lgpd_request_fulfilled',
    resourceType: 'lgpd_data_request',
    resourceId: args.requestId,
    afterValue: { request_type: req.request_type, fulfill_action: action, details },
    legalBasis: 'legal_obligation_art7_II',
  });

  return { ok: true, action, details };
}
