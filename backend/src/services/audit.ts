/**
 * Audit Log + LGPD consent service
 * Every read/write of patient medical data must be logged with a legal basis.
 * Required by LGPD art. 37, art. 7º and CFM 2.314/2022 for medical record access.
 */
import { v4 as uuid } from 'uuid';
import { db, DEFAULT_TENANT_ID } from '../db/schema';

export type LgpdLegalBasis =
  | 'consent_art7_I'
  | 'contract_art7_V'
  | 'legal_obligation_art7_II'   // CFM/ANVISA/SUS requirements
  | 'vital_interest_art7_III'
  | 'public_interest_art7_IV'
  | 'legitimate_interest_art7_VI'
  | 'health_protection_art7_VIII';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  beforeValue?: any;
  afterValue?: any;
  ipAddress?: string;
  userAgent?: string;
  legalBasis?: LgpdLegalBasis;
  tenantId?: string;
}

export function logAudit(entry: AuditEntry): void {
  db.prepare(`
    INSERT INTO audit_log (id, actor_id, actor_email, action, resource_type, resource_id,
                           before_value, after_value, ip_address, user_agent, lgpd_legal_basis, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuid(),
    entry.actorId ?? null,
    entry.actorEmail ?? null,
    entry.action,
    entry.resourceType ?? null,
    entry.resourceId ?? null,
    entry.beforeValue ? JSON.stringify(entry.beforeValue) : null,
    entry.afterValue ? JSON.stringify(entry.afterValue) : null,
    entry.ipAddress ?? null,
    entry.userAgent ?? null,
    entry.legalBasis ?? null,
    entry.tenantId ?? DEFAULT_TENANT_ID
  );
}

/** Record a consent under LGPD art. 7º I. Must be called before any data processing. */
export function recordConsent(args: {
  subjectType: 'patient' | 'employee' | 'vendor';
  subjectId: string;
  consentType: string;
  granted: boolean;
  policyVersion: string;
  ipAddress?: string;
  userAgent?: string;
  evidence?: string;
  tenantId?: string;
}): string {
  const id = uuid();
  db.prepare(`
    INSERT INTO lgpd_consents (id, tenant_id, subject_type, subject_id, consent_type, granted,
                               policy_version, granted_at, ip_address, user_agent, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
  `).run(
    id,
    args.tenantId ?? DEFAULT_TENANT_ID,
    args.subjectType,
    args.subjectId,
    args.consentType,
    args.granted ? 1 : 0,
    args.policyVersion,
    args.ipAddress ?? null,
    args.userAgent ?? null,
    args.evidence ? JSON.stringify(args.evidence) : null
  );
  return id;
}

/** Revoke a prior consent. */
export function revokeConsent(consentId: string): void {
  db.prepare(`UPDATE lgpd_consents SET revoked_at = datetime('now') WHERE id = ?`).run(consentId);
}

/** Check if a subject has an active consent for a given type. */
export function hasActiveConsent(subjectType: string, subjectId: string, consentType: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM lgpd_consents
    WHERE subject_type = ? AND subject_id = ? AND consent_type = ? AND granted = 1 AND revoked_at IS NULL
    ORDER BY granted_at DESC LIMIT 1
  `).get(subjectType, subjectId, consentType);
  return !!row;
}

/** Submit a data subject right request. */
export function submitDataRequest(args: {
  requestType: 'access' | 'rectification' | 'deletion' | 'portability' | 'opposition';
  subjectType: string;
  subjectId: string;
}): string {
  const id = uuid();
  db.prepare(`
    INSERT INTO lgpd_data_requests (id, request_type, subject_type, subject_id, status)
    VALUES (?, ?, ?, ?, 'open')
  `).run(id, args.requestType, args.subjectType, args.subjectId);
  logAudit({
    action: 'lgpd_data_request',
    resourceType: 'lgpd_data_request',
    resourceId: id,
    afterValue: args,
    legalBasis: 'legal_obligation_art7_II',
  });
  return id;
}
