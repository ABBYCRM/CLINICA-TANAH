/**
 * Intake form templates — cadastro vs pré-consulta / pré-triagem (Brasil).
 * Pré-consulta fields align with CFM Resolução 2.416/2024 (mínimo de anamnese
 * no prontuário) + CFM 1.638/2002 (identificação) + LGPD (Lei 13.709/2018)
 * consentimento granular / transparência / TCPA-BR equivalente.
 *
 * Self-reported pré-consulta only — NOT Manchester/ESI certified triage.
 */
export type IntakeFieldType = 'text' | 'textarea' | 'select' | 'checkbox_group' | 'date' | 'tel' | 'email' | 'number';

export type IntakeLocale = 'pt' | 'en' | 'es';

export type IntakeOption = {
  value: string;
  label_pt: string;
  label_en: string;
  label_es: string;
};

export type IntakeSection =
  | 'identity'
  | 'guardian'
  | 'insurance'
  | 'clinical'
  | 'ros'
  | 'history'
  | 'lifestyle'
  | 'safety'
  | 'consent';

export type IntakeFieldDef = {
  key: string;
  type: IntakeFieldType;
  required?: boolean;
  section: IntakeSection;
  options?: IntakeOption[];
  label_pt: string;
  label_en: string;
  label_es: string;
  placeholder_pt?: string;
  placeholder_en?: string;
  placeholder_es?: string;
  help_pt?: string;
  help_en?: string;
  help_es?: string;
};

function opt(value: string, label_pt: string, label_en: string, label_es: string): IntakeOption {
  return { value, label_pt, label_en, label_es };
}

function L(pt: string, en: string, es: string) {
  return { label_pt: pt, label_en: en, label_es: es };
}

function P(pt: string, en: string, es: string) {
  return { placeholder_pt: pt, placeholder_en: en, placeholder_es: es };
}

function H(pt: string, en: string, es: string) {
  return { help_pt: pt, help_en: en, help_es: es };
}

const UF = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']
  .map((u) => opt(u, u, u, u));

const YES_NO_UNK = [
  opt('yes', 'Sim', 'Yes', 'Sí'),
  opt('no', 'Não', 'No', 'No'),
  opt('unknown', 'Não sei / prefiro não informar', 'Unknown / prefer not to say', 'No sé / prefiero no decir'),
];

export const CADASTRO_FIELDS: IntakeFieldDef[] = [
  { key: 'full_name', type: 'text', required: true, section: 'identity', ...L('Nome completo (sem abreviações)', 'Full legal name', 'Nombre completo'), ...P('Como no documento de identidade', 'As on ID document', 'Como en el documento') },
  { key: 'social_name', type: 'text', section: 'identity', ...L('Nome social (se houver)', 'Social name (if any)', 'Nombre social (si aplica)') },
  { key: 'birth_date', type: 'date', required: true, section: 'identity', ...L('Data de nascimento', 'Date of birth', 'Fecha de nacimiento') },
  { key: 'sex_at_birth', type: 'select', required: true, section: 'identity', ...L('Sexo biológico', 'Sex at birth', 'Sexo biológico'), options: [
    opt('F', 'Feminino', 'Female', 'Femenino'),
    opt('M', 'Masculino', 'Male', 'Masculino'),
    opt('I', 'Intersexo / outro', 'Intersex / other', 'Intersex / otro'),
    opt('N', 'Prefiro não informar', 'Prefer not to say', 'Prefiero no decir'),
  ] },
  { key: 'gender', type: 'select', section: 'identity', ...L('Gênero / identidade de gênero', 'Gender identity', 'Identidad de género'), options: [
    opt('F', 'Mulher', 'Woman', 'Mujer'),
    opt('M', 'Homem', 'Man', 'Hombre'),
    opt('O', 'Não binário / outro', 'Non-binary / other', 'No binario / otro'),
    opt('N', 'Prefiro não informar', 'Prefer not to say', 'Prefiero no decir'),
  ] },
  { key: 'marital_status', type: 'select', section: 'identity', ...L('Estado civil', 'Marital status', 'Estado civil'), options: [
    opt('single', 'Solteiro(a)', 'Single', 'Soltero/a'),
    opt('married', 'Casado(a)', 'Married', 'Casado/a'),
    opt('stable_union', 'União estável', 'Domestic partnership', 'Unión estable'),
    opt('divorced', 'Divorciado(a)', 'Divorced', 'Divorciado/a'),
    opt('widowed', 'Viúvo(a)', 'Widowed', 'Viudo/a'),
    opt('other', 'Outro', 'Other', 'Otro'),
  ] },
  { key: 'race_color', type: 'select', section: 'identity', ...L('Raça/cor (IBGE)', 'Race/color (IBGE)', 'Raza/color (IBGE)'), options: [
    opt('branca', 'Branca', 'White', 'Blanca'),
    opt('preta', 'Preta', 'Black', 'Negra'),
    opt('parda', 'Parda', 'Brown', 'Parda'),
    opt('amarela', 'Amarela', 'Asian', 'Amarilla'),
    opt('indigena', 'Indígena', 'Indigenous', 'Indígena'),
    opt('nao_informado', 'Não informado', 'Not stated', 'No informado'),
  ] },
  { key: 'religion', type: 'text', section: 'identity', ...L('Religião (opcional)', 'Religion (optional)', 'Religión (opcional)') },
  { key: 'occupation', type: 'text', section: 'identity', ...L('Profissão / ocupação', 'Occupation', 'Profesión / ocupación') },
  { key: 'nationality', type: 'text', section: 'identity', ...L('Nacionalidade', 'Nationality', 'Nacionalidad'), ...P('Brasileira', 'Brazilian', 'Brasileña') },
  { key: 'place_of_birth', type: 'text', section: 'identity', ...L('Naturalidade (cidade/UF)', 'Place of birth (city/state)', 'Naturalidad (ciudad/UF)') },
  { key: 'mother_name', type: 'text', required: true, section: 'identity', ...L('Nome da mãe (filiação)', "Mother's full name", 'Nombre de la madre'), ...H('Obrigatório no prontuário (CFM)', 'Required on medical record (CFM)', 'Obligatorio en la historia clínica (CFM)') },
  { key: 'father_name', type: 'text', section: 'identity', ...L('Nome do pai (filiação)', "Father's full name", 'Nombre del padre') },
  { key: 'cpf', type: 'text', required: true, section: 'identity', ...L('CPF', 'CPF (tax ID)', 'CPF'), ...P('000.000.000-00', '000.000.000-00', '000.000.000-00') },
  { key: 'rg', type: 'text', section: 'identity', ...L('RG / documento de identidade', 'National ID (RG)', 'Documento de identidad') },
  { key: 'phone', type: 'tel', required: true, section: 'identity', ...L('Telefone / WhatsApp', 'Phone / WhatsApp', 'Teléfono / WhatsApp'), ...P('+55 11 99999-0000', '+55 11 99999-0000', '+55 11 99999-0000') },
  { key: 'phone_secondary', type: 'tel', section: 'identity', ...L('Telefone secundário', 'Secondary phone', 'Teléfono secundario') },
  { key: 'email', type: 'email', section: 'identity', ...L('E-mail', 'Email', 'Correo electrónico') },
  { key: 'address_zip', type: 'text', required: true, section: 'identity', ...L('CEP', 'ZIP / CEP', 'CEP'), ...P('00000-000', '00000-000', '00000-000') },
  { key: 'address_street', type: 'text', required: true, section: 'identity', ...L('Logradouro (rua/av.)', 'Street address', 'Calle / avenida') },
  { key: 'address_number', type: 'text', required: true, section: 'identity', ...L('Número', 'Number', 'Número') },
  { key: 'address_complement', type: 'text', section: 'identity', ...L('Complemento', 'Complement', 'Complemento') },
  { key: 'address_neighborhood', type: 'text', required: true, section: 'identity', ...L('Bairro', 'Neighborhood', 'Barrio') },
  { key: 'city', type: 'text', required: true, section: 'identity', ...L('Cidade', 'City', 'Ciudad') },
  { key: 'state', type: 'select', required: true, section: 'identity', ...L('UF', 'State (UF)', 'UF'), options: UF },
  { key: 'emergency_contact_name', type: 'text', required: true, section: 'identity', ...L('Contato de emergência — nome', 'Emergency contact — name', 'Contacto de emergencia — nombre') },
  { key: 'emergency_contact_phone', type: 'tel', required: true, section: 'identity', ...L('Contato de emergência — telefone', 'Emergency contact — phone', 'Contacto de emergencia — teléfono') },
  { key: 'emergency_contact_relation', type: 'text', section: 'identity', ...L('Parentesco do contato', 'Relationship', 'Parentesco') },
];

export const GUARDIAN_FIELDS: IntakeFieldDef[] = [
  { key: 'is_minor', type: 'select', required: true, section: 'guardian', ...L('O paciente é menor de 18 anos?', 'Is the patient under 18?', '¿El paciente es menor de 18 años?'), options: [
    opt('no', 'Não', 'No', 'No'),
    opt('yes', 'Sim', 'Yes', 'Sí'),
  ] },
  { key: 'guardian_name', type: 'text', section: 'guardian', ...L('Responsável legal — nome completo', 'Legal guardian — full name', 'Responsable legal — nombre completo'), ...H('Obrigatório se menor de 18 anos', 'Required if under 18', 'Obligatorio si es menor de 18') },
  { key: 'guardian_cpf', type: 'text', section: 'guardian', ...L('Responsável legal — CPF', 'Legal guardian — CPF', 'Responsable legal — CPF') },
  { key: 'guardian_phone', type: 'tel', section: 'guardian', ...L('Responsável legal — telefone', 'Legal guardian — phone', 'Responsable legal — teléfono') },
  { key: 'guardian_relationship', type: 'text', section: 'guardian', ...L('Parentesco do responsável', 'Guardian relationship', 'Parentesco del responsable') },
];

export const INSURANCE_FIELDS: IntakeFieldDef[] = [
  { key: 'health_insurance', type: 'text', section: 'insurance', ...L('Convênio / plano de saúde', 'Health insurance plan', 'Obra social / plan de salud'), ...P('Particular / nome do plano', 'Self-pay / plan name', 'Particular / nombre del plan') },
  { key: 'health_insurance_number', type: 'text', section: 'insurance', ...L('Número da carteirinha', 'Member ID', 'Número de afiliado') },
  { key: 'blood_type', type: 'select', section: 'insurance', ...L('Tipo sanguíneo (se souber)', 'Blood type (if known)', 'Tipo sanguíneo (si sabe)'), options: [
    opt('unknown', 'Não sei', 'Unknown', 'No sé'),
    opt('A+', 'A+', 'A+', 'A+'), opt('A-', 'A-', 'A-', 'A-'),
    opt('B+', 'B+', 'B+', 'B+'), opt('B-', 'B-', 'B-', 'B-'),
    opt('AB+', 'AB+', 'AB+', 'AB+'), opt('AB-', 'AB-', 'AB-', 'AB-'),
    opt('O+', 'O+', 'O+', 'O+'), opt('O-', 'O-', 'O-', 'O-'),
  ] },
];

const CHRONIC_OPTS: IntakeOption[] = [
  opt('hypertension', 'Hipertensão arterial', 'Hypertension', 'Hipertensión'),
  opt('diabetes', 'Diabetes mellitus', 'Diabetes', 'Diabetes'),
  opt('dyslipidemia', 'Dislipidemia', 'Dyslipidemia', 'Dislipidemia'),
  opt('thyroid', 'Doença da tireoide', 'Thyroid disease', 'Enfermedad tiroidea'),
  opt('asthma_copd', 'Asma / DPOC', 'Asthma / COPD', 'Asma / EPOC'),
  opt('heart_disease', 'Doença cardíaca', 'Heart disease', 'Enfermedad cardíaca'),
  opt('stroke', 'AVC / AIT prévio', 'Prior stroke / TIA', 'ACV / AIT previo'),
  opt('kidney_disease', 'Doença renal', 'Kidney disease', 'Enfermedad renal'),
  opt('liver_disease', 'Doença hepática', 'Liver disease', 'Enfermedad hepática'),
  opt('cancer', 'Câncer (atual ou prévio)', 'Cancer (current or prior)', 'Cáncer (actual o previo)'),
  opt('obesity', 'Obesidade', 'Obesity', 'Obesidad'),
  opt('osa', 'Apneia do sono', 'Sleep apnea', 'Apnea del sueño'),
  opt('anxiety_depression', 'Ansiedade / depressão', 'Anxiety / depression', 'Ansiedad / depresión'),
  opt('autoimmune', 'Doença autoimune', 'Autoimmune disease', 'Enfermedad autoinmune'),
  opt('epilepsy', 'Epilepsia / convulsões', 'Epilepsy / seizures', 'Epilepsia / convulsiones'),
  opt('hiv', 'HIV / imunodeficiência', 'HIV / immunodeficiency', 'VIH / inmunodeficiencia'),
  opt('none', 'Nenhuma das anteriores', 'None of the above', 'Ninguna de las anteriores'),
];

const ROS_OPTS: IntakeOption[] = [
  opt('skin', 'Pele / anexos', 'Skin / appendages', 'Piel / anexos'),
  opt('ent', 'Olhos / ouvidos / nariz / garganta', 'Eyes / ears / nose / throat', 'Ojos / oídos / nariz / garganta'),
  opt('cardio', 'Cardiocirculatório', 'Cardiovascular', 'Cardiocirculatorio'),
  opt('resp', 'Respiratório', 'Respiratory', 'Respiratorio'),
  opt('gi', 'Digestório', 'Gastrointestinal', 'Digestivo'),
  opt('gu', 'Gênito-urinário', 'Genitourinary', 'Genitourinario'),
  opt('msk', 'Osteomuscular / articular', 'Musculoskeletal', 'Osteomuscular'),
  opt('neuro', 'Neurológico', 'Neurological', 'Neurológico'),
  opt('endo', 'Endócrino / metabólico', 'Endocrine / metabolic', 'Endocrino / metabólico'),
  opt('psych', 'Psíquico / humor / sono', 'Psychiatric / mood / sleep', 'Psíquico / ánimo / sueño'),
  opt('heme', 'Linfático / hematológico', 'Lymphatic / hematologic', 'Linfático / hematológico'),
  opt('none', 'Sem queixas por sistemas', 'No review-of-systems complaints', 'Sin molestias por sistemas'),
];

const RED_FLAG_OPTS: IntakeOption[] = [
  opt('chest_pain', 'Dor no peito / pressão torácica', 'Chest pain / pressure', 'Dolor de pecho'),
  opt('shortness_of_breath', 'Falta de ar intensa', 'Severe shortness of breath', 'Falta de aire intensa'),
  opt('severe_bleeding', 'Sangramento grave', 'Severe bleeding', 'Sangrado grave'),
  opt('high_fever', 'Febre alta (≥39°C) persistente', 'High fever (≥39°C)', 'Fiebre alta persistente'),
  opt('neuro_deficit', 'Fraqueza súbita / fala alterada / desmaio', 'Sudden weakness / speech change / syncope', 'Debilidad súbita / habla alterada / desmayo'),
  opt('severe_allergic_reaction', 'Reação alérgica grave (inchaço/choque)', 'Severe allergic reaction', 'Reacción alérgica grave'),
  opt('sudden_severe_pain', 'Dor súbita muito intensa', 'Sudden severe pain', 'Dolor súbito muy intenso'),
  opt('suicidal_ideation', 'Ideação suicida / risco a si ou outros', 'Suicidal ideation / risk to self or others', 'Ideación suicida / riesgo'),
  opt('none', 'Nenhum destes sinais agora', 'None of these right now', 'Ninguno de estos ahora'),
];

/** Exhaustive pré-consulta / pré-triagem — CFM anamnesis minimum + LGPD. */
export const PRE_TRIAGE_FIELDS: IntakeFieldDef[] = [
  ...CADASTRO_FIELDS,
  ...GUARDIAN_FIELDS,
  ...INSURANCE_FIELDS,

  // Clinical — HDA
  { key: 'chief_complaint', type: 'textarea', required: true, section: 'clinical', ...L('Queixa principal / motivo da consulta', 'Chief complaint / reason for visit', 'Motivo de consulta'), ...P('Descreva com suas palavras', 'Describe in your own words', 'Describa con sus palabras') },
  { key: 'hpi', type: 'textarea', required: true, section: 'clinical', ...L('História da doença atual (início, evolução, tratamentos já feitos)', 'History of present illness (onset, course, prior treatments)', 'Historia de la enfermedad actual'), ...H('CFM: início, sinais/sintomas, duração, evolução, consequências, tratamentos', 'CFM: onset, signs/symptoms, duration, course, treatments', 'CFM: inicio, signos, duración, evolución, tratamientos') },
  { key: 'symptom_duration', type: 'select', required: true, section: 'clinical', ...L('Há quanto tempo começou', 'How long ago it started', 'Hace cuánto comenzó'), options: [
    opt('lt_24h', 'Menos de 24 horas', 'Less than 24 hours', 'Menos de 24 horas'),
    opt('d1_7', '1 a 7 dias', '1–7 days', '1 a 7 días'),
    opt('w1_4', '1 a 4 semanas', '1–4 weeks', '1 a 4 semanas'),
    opt('m1_3', '1 a 3 meses', '1–3 months', '1 a 3 meses'),
    opt('gt_3m', 'Mais de 3 meses', 'More than 3 months', 'Más de 3 meses'),
  ] },
  { key: 'prior_care', type: 'textarea', section: 'clinical', ...L('Já procurou médico/PS/exames por este problema?', 'Prior care/ER/tests for this problem?', '¿Ya consultó médico/urgencias/exámenes por este problema?') },

  // Allergies / meds
  { key: 'allergies', type: 'textarea', required: true, section: 'history', ...L('Alergias (medicamentos, alimentos, látex, contraste) e reação', 'Allergies (drugs, food, latex, contrast) and reaction', 'Alergias y reacción'), ...P('Ex.: dipirona → urticária. Se nenhuma, escreva "Nega alergias".', 'E.g. penicillin → rash. If none, write "No known allergies".', 'Ej.: penicilina → erupción. Si ninguna, escriba "Niega alergias".') },
  { key: 'allergy_severity', type: 'select', section: 'history', ...L('Gravidade da pior alergia', 'Worst allergy severity', 'Gravedad de la peor alergia'), options: [
    opt('na', 'Não se aplica', 'N/A', 'No aplica'),
    opt('mild', 'Leve', 'Mild', 'Leve'),
    opt('moderate', 'Moderada', 'Moderate', 'Moderada'),
    opt('severe', 'Grave / anafilaxia', 'Severe / anaphylaxis', 'Grave / anafilaxia'),
  ] },
  { key: 'current_medications', type: 'textarea', required: true, section: 'history', ...L('Medicamentos em uso (nome, dose, frequência)', 'Current medications (name, dose, frequency)', 'Medicamentos en uso (nombre, dosis, frecuencia)'), ...P('Inclua contínuos, injetáveis, anticoncepcionais, suplementos. Se nenhum: "Nega".', 'Include chronic, injectables, contraceptives, supplements. If none: "None".', 'Incluya crónicos, inyectables, anticonceptivos, suplementos. Si ninguno: "Niega".') },
  { key: 'chronic_conditions', type: 'checkbox_group', required: true, section: 'history', ...L('Doenças / condições crônicas', 'Chronic conditions', 'Condiciones crónicas'), options: CHRONIC_OPTS },
  { key: 'hospitalizations', type: 'textarea', section: 'history', ...L('Internações anteriores (ano / motivo)', 'Prior hospitalizations (year / reason)', 'Internaciones previas (año / motivo)') },
  { key: 'prior_surgeries', type: 'textarea', section: 'history', ...L('Cirurgias / procedimentos prévios', 'Prior surgeries / procedures', 'Cirugías / procedimientos previos') },
  { key: 'transfusions', type: 'select', section: 'history', ...L('Já recebeu transfusão de sangue?', 'Ever received a blood transfusion?', '¿Recibió transfusión de sangre?'), options: YES_NO_UNK },
  { key: 'vaccines_uptodate', type: 'select', section: 'history', ...L('Vacinas em dia (incluindo COVID/influenza se aplicável)', 'Vaccines up to date (incl. COVID/flu if applicable)', 'Vacunas al día'), options: YES_NO_UNK },
  { key: 'family_history', type: 'textarea', required: true, section: 'history', ...L('História familiar (pais, irmãos — doenças relevantes)', 'Family history (parents, siblings — relevant diseases)', 'Antecedentes familiares'), ...P('Ex.: mãe diabetes; pai IAM aos 55. Se desconhece: informe.', 'E.g. mother diabetes; father MI at 55.', 'Ej.: madre diabetes; padre IAM a los 55.') },

  // ROS
  { key: 'ros', type: 'checkbox_group', required: true, section: 'ros', ...L('Interrogatório sintomatológico por sistemas (marque o que se aplica agora)', 'Review of systems (check what applies now)', 'Interrogatorio por sistemas'), options: ROS_OPTS, ...H('CFM 2.416/2024 — interrogatório sucinto por sistemas', 'CFM 2.416/2024 — brief review of systems', 'CFM 2.416/2024 — interrogatorio por sistemas') },
  { key: 'ros_details', type: 'textarea', section: 'ros', ...L('Detalhe os sintomas marcados acima', 'Detail the symptoms checked above', 'Detalle los síntomas marcados') },

  // Lifestyle / social
  { key: 'pregnancy_status', type: 'select', section: 'lifestyle', ...L('Gestação / amamentação', 'Pregnancy / breastfeeding', 'Embarazo / lactancia'), options: [
    opt('na', 'Não se aplica', 'N/A', 'No aplica'),
    opt('no', 'Não gestante', 'Not pregnant', 'No gestante'),
    opt('yes', 'Gestante', 'Pregnant', 'Embarazada'),
    opt('breastfeeding', 'Amamentando', 'Breastfeeding', 'Lactando'),
    opt('unknown', 'Não sei / possível', 'Unknown / possible', 'No sé / posible'),
  ] },
  { key: 'smoking', type: 'select', required: true, section: 'lifestyle', ...L('Tabagismo', 'Smoking', 'Tabaquismo'), options: [
    opt('never', 'Nunca', 'Never', 'Nunca'),
    opt('former', 'Ex-fumante', 'Former', 'Exfumador/a'),
    opt('current', 'Fumante atual', 'Current smoker', 'Fumador/a actual'),
  ] },
  { key: 'alcohol', type: 'select', required: true, section: 'lifestyle', ...L('Álcool', 'Alcohol', 'Alcohol'), options: [
    opt('never', 'Não bebe', 'Does not drink', 'No bebe'),
    opt('social', 'Social / ocasional', 'Social / occasional', 'Social / ocasional'),
    opt('frequent', 'Frequente / pesado', 'Frequent / heavy', 'Frecuente / pesado'),
  ] },
  { key: 'illicit_drugs', type: 'select', section: 'lifestyle', ...L('Uso de substâncias ilícitas', 'Illicit substance use', 'Uso de sustancias ilícitas'), options: YES_NO_UNK },
  { key: 'physical_activity', type: 'select', section: 'lifestyle', ...L('Atividade física', 'Physical activity', 'Actividad física'), options: [
    opt('none', 'Sedentário', 'Sedentary', 'Sedentario'),
    opt('light', 'Leve', 'Light', 'Leve'),
    opt('moderate', 'Moderada', 'Moderate', 'Moderada'),
    opt('intense', 'Intensa', 'Intense', 'Intensa'),
  ] },
  { key: 'sleep_hours', type: 'select', section: 'lifestyle', ...L('Horas de sono por noite (média)', 'Average hours of sleep / night', 'Horas de sueño por noche'), options: [
    opt('lt5', 'Menos de 5h', '< 5h', 'Menos de 5h'),
    opt('5_6', '5–6h', '5–6h', '5–6h'),
    opt('7_8', '7–8h', '7–8h', '7–8h'),
    opt('gt8', 'Mais de 8h', '> 8h', 'Más de 8h'),
  ] },
  { key: 'diet_notes', type: 'textarea', section: 'lifestyle', ...L('Alimentação / restrições dietéticas', 'Diet / dietary restrictions', 'Alimentación / restricciones') },
  { key: 'height_cm', type: 'number', section: 'lifestyle', ...L('Altura (cm)', 'Height (cm)', 'Altura (cm)') },
  { key: 'weight_kg', type: 'number', section: 'lifestyle', ...L('Peso (kg)', 'Weight (kg)', 'Peso (kg)') },

  // Safety
  { key: 'red_flags', type: 'checkbox_group', required: true, section: 'safety', ...L('Sinais de alerta AGORA', 'Red-flag symptoms NOW', 'Signos de alarma AHORA'), options: RED_FLAG_OPTS },
  { key: 'urgency_self', type: 'select', required: true, section: 'safety', ...L('Como avalia a urgência deste atendimento', 'How urgent is this visit', '¿Qué tan urgente es esta consulta?'), options: [
    opt('routine', 'Rotina / eletivo', 'Routine / elective', 'Rutina / electivo'),
    opt('soon', 'Preciso em poucos dias', 'Need within a few days', 'Necesito en pocos días'),
    opt('urgent', 'Urgente (hoje)', 'Urgent (today)', 'Urgente (hoy)'),
  ] },
  { key: 'additional_notes', type: 'textarea', section: 'clinical', ...L('Outras informações que o médico deve saber', 'Anything else the clinician should know', 'Otra información para el médico') },
];

export const PRE_TRIAGE_CONSENT_PT =
  'Declaro que sou a pessoa identificada (ou seu responsável legal) neste formulário de pré-consulta / pré-triagem e autorizo a Clínica Tanah a tratar meus dados pessoais e dados sensíveis de saúde conforme a LGPD (Lei 13.709/2018), para cadastro, composição de prontuário (CFM 1.638/2002 e CFM 2.416/2024), avaliação clínica inicial, atendimento e comunicações administrativas. '
  + 'Fui informado(a) sobre a finalidade da coleta, o caráter sensível dos dados de saúde, a possibilidade de exercer direitos do titular (acesso, correção, eliminação, portabilidade) junto ao Encarregado/DPO da clínica, e de consultar a Política de Privacidade. '
  + 'Entendo que este formulário NÃO substitui atendimento de urgência/emergência e NÃO constitui diagnóstico médico: em dor no peito, falta de ar intensa, sangramento grave, febre muito alta, déficit neurológico, reação alérgica grave ou risco a si/outros, devo procurar serviço de emergência (SAMU 192 / Pronto-Socorro). '
  + 'Autorizo, se marcado abaixo de forma independente, contato via WhatsApp, SMS, e-mail e telefone para lembretes e confirmações; comunicações de marketing exigem consentimento específico e podem ser revogadas a qualquer momento (SAIR no WhatsApp ou solicitação à clínica). '
  + 'Autorizo, se marcado, o uso de imagens/teleatendimento conforme orientação clínica e normas CFM aplicáveis, quando pertinente ao meu cuidado.';

export const PRE_TRIAGE_CONSENT_CHECKBOXES = [
  { key: 'self_attested', required: true, label_pt: 'Declaro que as informações são verdadeiras e que sou o paciente ou responsável legal autorizado.', label_en: 'I attest the information is true and that I am the patient or authorized legal guardian.', label_es: 'Declaro que la información es verdadera y que soy el paciente o responsable legal autorizado.' },
  { key: 'consent_lgpd', required: true, label_pt: 'Li e concordo com o tratamento dos dados pessoais e de saúde para atendimento e prontuário (LGPD).', label_en: 'I agree to processing of personal and health data for care and medical records (LGPD).', label_es: 'Acepto el tratamiento de datos personales y de salud para atención e historia clínica (LGPD).' },
  { key: 'consent_privacy_ack', required: true, label_pt: 'Confirmo que tive acesso à Política de Privacidade / aviso de finalidade (transparência LGPD).', label_en: 'I confirm access to the Privacy Policy / purpose notice (LGPD transparency).', label_es: 'Confirmo acceso a la Política de Privacidad / aviso de finalidad (transparencia LGPD).' },
  { key: 'consent_whatsapp', required: false, label_pt: 'Autorizo contato via WhatsApp/SMS para lembretes e confirmações de consulta (revogável).', label_en: 'I authorize WhatsApp/SMS for appointment reminders (revocable).', label_es: 'Autorizo WhatsApp/SMS para recordatorios de cita (revocable).' },
  { key: 'consent_calls', required: false, label_pt: 'Autorizo ligações telefônicas administrativas/clínicas relacionadas ao meu cuidado.', label_en: 'I authorize administrative/clinical phone calls related to my care.', label_es: 'Autorizo llamadas administrativas/clínicas relacionadas a mi cuidado.' },
  { key: 'consent_marketing', required: false, label_pt: 'Autorizo comunicações de marketing / novidades da clínica (opcional, revogável).', label_en: 'I authorize clinic marketing / news messages (optional, revocable).', label_es: 'Autorizo comunicaciones de marketing / novedades (opcional, revocable).' },
  { key: 'consent_telehealth_image', required: false, label_pt: 'Autorizo, se clinicamente indicado, teleatendimento e/ou uso de imagens clínicas conforme CFM e política da clínica.', label_en: 'If clinically indicated, I authorize telehealth and/or clinical images per CFM and clinic policy.', label_es: 'Si está clínicamente indicado, autorizo teleatención y/o imágenes clínicas según CFM y política de la clínica.' },
];

export function fieldsForKind(kind: string | null | undefined): IntakeFieldDef[] {
  if (kind === 'pre_triage') return PRE_TRIAGE_FIELDS;
  return CADASTRO_FIELDS;
}

export function localizeFields(fields: IntakeFieldDef[], localeRaw?: string) {
  const loc: IntakeLocale = String(localeRaw || 'pt-BR').toLowerCase().startsWith('es')
    ? 'es'
    : String(localeRaw || '').toLowerCase().startsWith('en')
      ? 'en'
      : 'pt';
  return fields.map((f) => ({
    key: f.key,
    type: f.type,
    required: !!f.required,
    section: f.section,
    label: (loc === 'en' ? f.label_en : loc === 'es' ? f.label_es : f.label_pt) || f.label_pt,
    placeholder: (loc === 'en' ? f.placeholder_en : loc === 'es' ? f.placeholder_es : f.placeholder_pt) || undefined,
    help: (loc === 'en' ? f.help_en : loc === 'es' ? f.help_es : f.help_pt) || undefined,
    options: (f.options || []).map((o) => ({
      value: o.value,
      label: loc === 'en' ? o.label_en : loc === 'es' ? o.label_es : o.label_pt,
    })),
  }));
}

export function localizeConsentBoxes(localeRaw?: string) {
  const loc: IntakeLocale = String(localeRaw || 'pt-BR').toLowerCase().startsWith('es')
    ? 'es'
    : String(localeRaw || '').toLowerCase().startsWith('en')
      ? 'en'
      : 'pt';
  return PRE_TRIAGE_CONSENT_CHECKBOXES.map((c) => ({
    key: c.key,
    required: c.required,
    label: loc === 'en' ? c.label_en : loc === 'es' ? c.label_es : c.label_pt,
  }));
}

export const SECTION_ORDER: IntakeSection[] = [
  'identity', 'guardian', 'insurance', 'clinical', 'history', 'ros', 'lifestyle', 'safety', 'consent',
];

export function sectionTitle(section: IntakeSection, localeRaw?: string): string {
  const loc: IntakeLocale = String(localeRaw || 'pt-BR').toLowerCase().startsWith('es')
    ? 'es'
    : String(localeRaw || '').toLowerCase().startsWith('en')
      ? 'en'
      : 'pt';
  const map: Record<IntakeSection, Record<IntakeLocale, string>> = {
    identity: { pt: 'Identificação (CFM)', en: 'Identification (CFM)', es: 'Identificación (CFM)' },
    guardian: { pt: 'Responsável legal / menor', en: 'Legal guardian / minor', es: 'Responsable legal / menor' },
    insurance: { pt: 'Convênio e dados clínicos básicos', en: 'Insurance & basic clinical data', es: 'Cobertura y datos clínicos básicos' },
    clinical: { pt: 'Queixa e história da doença atual', en: 'Chief complaint & HPI', es: 'Motivo e historia actual' },
    history: { pt: 'Antecedentes pessoais e familiares', en: 'Past & family history', es: 'Antecedentes personales y familiares' },
    ros: { pt: 'Interrogatório por sistemas', en: 'Review of systems', es: 'Interrogatorio por sistemas' },
    lifestyle: { pt: 'Hábitos e antropometria', en: 'Lifestyle & anthropometry', es: 'Hábitos y antropometría' },
    safety: { pt: 'Sinais de alerta e urgência', en: 'Red flags & urgency', es: 'Signos de alarma y urgencia' },
    consent: { pt: 'Consentimentos (LGPD)', en: 'Consents (LGPD)', es: 'Consentimientos (LGPD)' },
  };
  return map[section][loc];
}
