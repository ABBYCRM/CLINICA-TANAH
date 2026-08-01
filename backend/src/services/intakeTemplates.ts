/**
 * Seeded intake form templates — cadastro vs pré-triagem clínica (Brasil).
 * Questions align with ambulatory pre-visit practice (CFM chart elements + red-flag screening).
 * Not Manchester/ESI certified triage — self-reported pre-intake only.
 */
export type IntakeFieldType = 'text' | 'textarea' | 'select' | 'checkbox_group' | 'date';

export type IntakeFieldDef = {
  key: string;
  type: IntakeFieldType;
  required?: boolean;
  options?: string[];
  section: 'identity' | 'clinical' | 'lifestyle' | 'safety' | 'consent';
};

export const CADASTRO_FIELDS: IntakeFieldDef[] = [
  { key: 'full_name', type: 'text', required: true, section: 'identity' },
  { key: 'birth_date', type: 'date', required: true, section: 'identity' },
  { key: 'phone', type: 'text', required: true, section: 'identity' },
  { key: 'email', type: 'text', section: 'identity' },
  { key: 'cpf', type: 'text', section: 'identity' },
  { key: 'city', type: 'text', section: 'identity' },
  { key: 'state', type: 'text', section: 'identity' },
  { key: 'notes', type: 'textarea', section: 'identity' },
];

/** Pré-triagem / pré-consulta — Clínica Tanah (metabólica / cuidado ambulatorial). */
export const PRE_TRIAGE_FIELDS: IntakeFieldDef[] = [
  ...CADASTRO_FIELDS.filter((f) => f.key !== 'notes'),
  { key: 'gender', type: 'select', section: 'identity', options: ['F', 'M', 'O', 'N'] },
  { key: 'chief_complaint', type: 'textarea', required: true, section: 'clinical' },
  {
    key: 'symptom_duration',
    type: 'select',
    required: true,
    section: 'clinical',
    options: ['lt_24h', 'd1_7', 'w1_4', 'm1_3', 'gt_3m'],
  },
  { key: 'allergies', type: 'textarea', section: 'clinical' },
  { key: 'current_medications', type: 'textarea', section: 'clinical' },
  {
    key: 'chronic_conditions',
    type: 'checkbox_group',
    section: 'clinical',
    options: [
      'hypertension', 'diabetes', 'thyroid', 'asthma_copd', 'heart_disease',
      'kidney_disease', 'liver_disease', 'cancer', 'obesity', 'anxiety_depression', 'none',
    ],
  },
  { key: 'prior_surgeries', type: 'textarea', section: 'clinical' },
  { key: 'family_history', type: 'textarea', section: 'clinical' },
  {
    key: 'pregnancy_status',
    type: 'select',
    section: 'lifestyle',
    options: ['na', 'no', 'yes', 'breastfeeding', 'unknown'],
  },
  {
    key: 'smoking',
    type: 'select',
    section: 'lifestyle',
    options: ['never', 'former', 'current'],
  },
  {
    key: 'alcohol',
    type: 'select',
    section: 'lifestyle',
    options: ['never', 'social', 'frequent'],
  },
  {
    key: 'red_flags',
    type: 'checkbox_group',
    required: true,
    section: 'safety',
    options: [
      'chest_pain', 'shortness_of_breath', 'severe_bleeding', 'high_fever',
      'neuro_deficit', 'severe_allergic_reaction', 'sudden_severe_pain', 'none',
    ],
  },
  {
    key: 'urgency_self',
    type: 'select',
    required: true,
    section: 'safety',
    options: ['routine', 'soon', 'urgent'],
  },
  { key: 'additional_notes', type: 'textarea', section: 'clinical' },
];

export const PRE_TRIAGE_CONSENT_PT =
  'Declaro que sou a pessoa identificada neste formulário de pré-triagem / pré-consulta e autorizo a Clínica Tanah a tratar meus dados pessoais e de saúde conforme a LGPD (Lei 13.709/2018), para cadastro, avaliação clínica inicial, atendimento e comunicações administrativas. '
  + 'Entendo que este formulário NÃO substitui atendimento de urgência/emergência: em caso de dor no peito, falta de ar intensa, sangramento grave, febre muito alta, déficit neurológico ou reação alérgica grave, devo procurar serviço de emergência (SAMU 192 / pronto). '
  + 'Autorizo, se marcado abaixo, contato via WhatsApp, SMS e telefone para lembretes e confirmações, podendo revogar a qualquer momento (SAIR no WhatsApp ou solicitação à clínica).';

export function fieldsForKind(kind: string | null | undefined): IntakeFieldDef[] {
  if (kind === 'pre_triage') return PRE_TRIAGE_FIELDS;
  return CADASTRO_FIELDS;
}
