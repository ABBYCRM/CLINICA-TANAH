/**
 * Professional identification stamp for clinical notes (CFM 1.638/2002).
 * Name + council number/UF + timestamp — required on paper and electronic charts.
 */
import { db } from '../db/schema';

export type ClinicalStamp = {
  signer_name: string;
  signer_council: string | null;
  signer_council_state: string | null;
  signed_at: string;
};

export function stampFromUser(userId: string, atIso?: string): ClinicalStamp {
  const u = db.prepare(`
    SELECT full_name, council_number, council_state, role FROM users WHERE id = ?
  `).get(userId) as any;
  return {
    signer_name: u?.full_name || 'Profissional',
    signer_council: u?.council_number || null,
    signer_council_state: u?.council_state || null,
    signed_at: atIso || new Date().toISOString().replace('T', ' ').slice(0, 19),
  };
}

export function formatStampLabel(s: Partial<ClinicalStamp> | null | undefined): string {
  if (!s?.signer_name) return '';
  const council = [s.signer_council, s.signer_council_state].filter(Boolean).join('/');
  const when = s.signed_at ? ` · ${s.signed_at}` : '';
  return council ? `${s.signer_name} — ${council}${when}` : `${s.signer_name}${when}`;
}
