/**
 * LGPD policy document + DPO contact — env/settings driven (no hardcoded fake DPO).
 */
import { db } from '../db/schema';
import { encryptionStatus } from './phiCrypto';

function setting(key: string): string | null {
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value?: string } | undefined;
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

export function resolveDpo() {
  const name =
    process.env.DPO_NAME?.trim()
    || setting('dpo_name')
    || 'Encarregado de Dados — Clínica Tanah';
  const email =
    process.env.DPO_EMAIL?.trim()
    || setting('dpo_email')
    || 'dpo@clinica-tanah.com.br';
  const phone =
    process.env.DPO_PHONE?.trim()
    || setting('dpo_phone')
    || '+55 11 3000-0001';
  return { name, email, phone };
}

export function buildLgpdPolicy() {
  const enc = encryptionStatus();
  return {
    version: process.env.LGPD_POLICY_VERSION?.trim() || '1.2',
    effective_date: process.env.LGPD_POLICY_EFFECTIVE?.trim() || '2026-08-01',
    clinic_name: process.env.CLINIC_NAME?.trim() || setting('clinic_name') || 'Clínica Tanah',
    dpo: resolveDpo(),
    public_url: '/privacidade',
    legal_bases: [
      { code: 'art7_I', name: 'Consentimento', description: 'Para marketing, imagem e tratamentos que dependem de consentimento específico e em destaque.' },
      { code: 'art7_V', name: 'Execução de contrato', description: 'Para cumprimento do contrato de prestação de serviços médicos.' },
      { code: 'art7_II', name: 'Cumprimento de obrigação legal', description: 'CFM, ANVISA, obrigações fiscais e trabalhistas.' },
      { code: 'art11_II_f', name: 'Tutela da saúde', description: 'Tratamento de dados de saúde por profissionais/serviços de saúde (LGPD art. 11, II, f).' },
    ],
    technical_measures_art46: {
      encryption_in_transit: 'TLS terminado na borda (HTTPS obrigatório em produção)',
      encryption_at_rest: `AES-256-GCM em campos de PHI (fonte da chave: ${enc.key_source})`,
      access_control: 'RBAC por papel clínico + isolamento multi-tenant + JWT',
      audit_trail: 'Registro de acesso a PHI com base legal (LGPD art. 37 / CFM)',
      consent_proof: 'Pixel + IP/UA + autoatestação em formulários públicos',
      retention: 'Prontuário clínico: retenção CFM 1.821/2007 — cancelamento lógico, sem exclusão física de atendimentos/receitas',
      note: 'Medidas técnicas alinhadas à LGPD art. 46 e boas práticas ANPD. Não constitui certificação SBIS/CFM.',
    },
    data_categories: [
      { name: 'Dados de identificação', examples: ['nome', 'CPF', 'RG'], retention: '20 anos (CFM) / anonimização sob art. 18', encrypted_at_rest: true },
      { name: 'Dados de saúde', examples: ['prontuário', 'prescrições', 'medidas'], retention: '20 anos (CFM 1.821/2007)', encrypted_at_rest: true },
      { name: 'Dados financeiros', examples: ['faturas', 'pagamentos'], retention: '5 anos (CTN)' },
      { name: 'Dados de comunicação', examples: ['WhatsApp', 'e-mail'], retention: '2 anos após último contato' },
    ],
    rights: [
      { code: 'art18_I', name: 'Confirmação da existência de tratamento' },
      { code: 'art18_II', name: 'Acesso aos dados' },
      { code: 'art18_III', name: 'Correção de dados incompletos ou incorretos' },
      { code: 'art18_IV', name: 'Anonimização, bloqueio ou eliminação' },
      { code: 'art18_V', name: 'Portabilidade' },
      { code: 'art18_VI', name: 'Eliminação dos dados tratados com consentimento' },
      { code: 'art18_VII', name: 'Informação sobre compartilhamentos' },
      { code: 'art18_IX', name: 'Revogação do consentimento' },
    ],
    how_to_exercise: [
      'WhatsApp: digite PRIVACIDADE ou MEUS DADOS',
      'E-mail ao Encarregado (DPO) listado nesta política',
      'Recepção da clínica — solicitação registrada no módulo LGPD',
      'Formulário público de cadastro: link desta política',
    ],
    marketing_note: 'Marketing e promoções exigem consentimento específico e destacado, separado do atendimento clínico. Digite SAIR no WhatsApp para optar por sair de promoções sem bloquear lembretes clínicos.',
  };
}
