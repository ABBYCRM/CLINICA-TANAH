/**
 * Convênios (operadoras de planos de saúde) do Brasil.
 *
 * Curated list of the major ANS-registered health-insurance operators used by
 * clinics in Brazil — national medical plans, large regional operators,
 * self-managed / corporate funds (autogestão) and dental operators.
 *
 * This is intentionally broad (the operators a clinic actually encounters),
 * not a literal dump of all ~700 ANS registrations. The list is de-duplicated
 * and sorted (pt-BR collation) at module load so consumers can render it
 * directly in a <select> / <datalist>.
 */
const RAW_CONVENIOS: string[] = [
  // ---- Particular / não-convênio ----
  'Particular',
  'SUS',

  // ---- Grandes operadoras nacionais (medicina de grupo / seguradoras) ----
  'Amil',
  'Amil One Health',
  'Bradesco Saúde',
  'Mediservice',
  'SulAmérica Saúde',
  'Marítima Saúde',
  'NotreDame Intermédica (GNDI)',
  'Hapvida',
  'Hapvida NotreDame Intermédica',
  'Porto Seguro Saúde',
  'Golden Cross',
  'Prevent Senior',
  'MedSênior',
  'Care Plus',
  'Omint',
  'Allianz Saúde',
  'Sompo Saúde',
  'Lincx',
  'Unimed',
  'Unimed Nacional',
  'Unimed Central Nacional (CNU)',
  'Unimed Seguros Saúde',
  'Unimed Fesp',
  'Unimed Rio',
  'Unimed BH',
  'Unimed Porto Alegre',
  'Unimed Curitiba',
  'Unimed Fortaleza',
  'Unimed Recife',
  'Unimed Vitória',
  'Unimed Campinas',
  'Unimed Santos',

  // ---- Autogestão / fundos corporativos e públicos ----
  'Cassi (Banco do Brasil)',
  'GEAP Saúde',
  'Saúde Caixa',
  'Postal Saúde (Correios)',
  'Petrobras — AMS',
  'Fundação Assefaz',
  'Fundação Itaú (Itauseg Saúde)',
  'Economus',
  'Fundação CESP (Funcesp)',
  'Real Grandeza',
  'Sabesprev',
  'Cemig Saúde',
  'Vale — Fundação Vale',
  'Embratel — TelemarPar',
  'Fusex (Exército)',
  'FunSaúde',
  'IPÊ Saúde (RS)',
  'IPSEMG (MG)',
  'IPSM (MG)',
  'Cabergs',

  // ---- Startups / novas operadoras ----
  'Alice',
  'Sami Saúde',
  'Qsaúde',
  'Leve Saúde',
  'Kipp Saúde',

  // ---- Operadoras regionais (medicina de grupo) ----
  'São Cristóvão Saúde',
  'Santa Casa Saúde',
  'Santa Helena Saúde',
  'Biovida Saúde',
  'Ampla Saúde',
  'Trasmontano Saúde',
  'Green Line Sistema de Saúde',
  'São Francisco Saúde',
  'Vera Cruz Saúde',
  'Ana Costa Saúde',
  'Blue Med Saúde',
  'Cruz Azul Saúde',
  'HB Saúde',
  'Samp',
  'Unihosp',
  'Plamheg',
  'Smile Saúde',
  'Life Empresarial Saúde',
  'Class Saúde',
  'Med-Tour Saúde',
  'Saúde Sim',
  'Vitallis',
  'Promed',
  'Bio Saúde',
  'Nossa Saúde',
  'Salutar Saúde',
  'CarePlus',
  'Intermédica',

  // ---- Odontológicos (planos dentários) ----
  'OdontoPrev',
  'Amil Dental',
  'Bradesco Dental',
  'SulAmérica Odonto',
  'Uniodonto',
  'Interodonto',
  'Dental Uni',
  'MetLife Odonto',
  'Porto Seguro Odonto',
  'OdontoSystem',
  'Odonto Empresas',
  'Prevident',
];

/** De-duplicated, pt-BR sorted list of Brazilian convênios. */
export const CONVENIOS: string[] = Array.from(new Set(RAW_CONVENIOS))
  .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
