// TANAH-HAIR clinic PWA - trilingual (PT-BR / EN / ES)
// Single source of truth for all UI strings.
// Languages default to PT-BR (the tenant is in São Paulo).
// Strings fall back to EN when a key is missing, then to the key itself.

export type Lang = 'pt-BR' | 'en' | 'es';

export const LANGS: { code: Lang; label: string; short: string }[] = [
  { code: 'pt-BR', label: 'Português (Brasil)', short: 'PT-BR' },
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'es', label: 'Español', short: 'ES' }
];

type Dict = Record<string, string>;
type All = Record<Lang, Dict>;

const D: All = {
  'pt-BR': {
    // Brand
    'brand.name': 'TANAH-HAIR',
    'brand.tagline': 'Workspace clínico',
    'brand.eyebrow': 'CLÍNICA TANAH',

    // Login
    'login.subtitle': 'Planejamento de transplante capilar, operação de procedimentos e jornada do paciente.',
    'login.email': 'E-mail',
    'login.password': 'Senha',
    'login.submit': 'Entrar no workspace clínico',
    'login.error': 'E-mail ou senha incorretos.',
    'login.boundary.title': 'Limite clínico',
    'login.boundary.body': 'Sem diagnóstico autônomo, recomendação de tratamento ou resultado garantido.',

    // Sidebar
    'sidebar.footer.status': 'Controles médicos',
    'sidebar.signout': 'Sair',

    // Nav
    'nav.overview': 'Visão geral',
    'nav.patients': 'Pacientes',
    'nav.planning': 'Hairline Lab',
    'nav.procedures': 'Procedure Board',
    'nav.visualization': 'AI Sandbox',
    'nav.settings': 'Configurações',

    // Topbar context pills
    'topbar.record': 'Prontuário',
    'topbar.lang.pt': 'PT-BR',
    'topbar.lang.en': 'EN',
    'topbar.lang.es': 'ES',

    // Topbar (default values)
    'topbar.subtitle.overview': 'Status operacional, filas clínicas e saúde da integração.',
    'topbar.subtitle.patients': 'Acesso limitado a registros sintéticos de demonstração.',
    'topbar.subtitle.planning': 'Planejamento vetorial manual sobre fotografia clínica imutável.',
    'topbar.subtitle.procedures': 'Controles de fase auditáveis e reconciliação de enxertos.',
    'topbar.subtitle.visualization': 'Geração de imagem Gemini opcional no servidor, com guardrails rígidos.',
    'topbar.subtitle.settings': 'Integrações, segredos e controles de segurança do tenant.',

    // Common
    'common.open': 'Abrir',
    'common.save': 'Salvar',
    'common.cancel': 'Cancelar',
    'common.signedInAs': 'Conectado como',
    'common.demo': 'Dados de demonstração',
    'common.foundationScaffold': 'Esqueleto base',
    'common.awaitingLiveData': 'Aguardando dados ao vivo',

    // Dashboard - metric cards
    'metric.consultations': 'Consultas hoje',
    'metric.consultations.meta': 'Agendadas e confirmadas',
    'metric.plans': 'Planos aguardando assinatura',
    'metric.plans.meta': 'Ação do cirurgião necessária',
    'metric.followups': 'Acompanhamentos pendentes',
    'metric.followups.meta': 'Dia 2 até Mês 18',
    'metric.rooms': 'Salas de procedimento',
    'metric.rooms.meta': 'Verificações de prontidão ativas',

    // Dashboard - sections
    'dashboard.recent.eyebrow': 'JORNADAS ATIVAS',
    'dashboard.recent.title': 'Fila de ações do paciente',
    'dashboard.recent.cta': 'Abrir fila',
    'dashboard.ai.eyebrow': 'SAÚDE DA INTEGRAÇÃO',
    'dashboard.ai.title': 'Gemini Image Gen',
    'dashboard.ai.cta': 'Configurar',
    'dashboard.ai.on': 'LIG',
    'dashboard.ai.off': 'DESL',
    'dashboard.ai.configured': 'Chave configurada',
    'dashboard.ai.notConfigured': 'Não configurado',
    'dashboard.ai.lastTest': 'Último teste',
    'dashboard.sandbox.title': 'Apenas sandbox',
    'dashboard.sandbox.body': 'Conceitos gerados são hipotéticos, marcados com watermark e isolados do prontuário.',

    // Patients
    'patients.queue.eyebrow': 'OPERAÇÕES DE CUIDADO',
    'patients.queue.title': 'Fila de jornada do paciente',
    'patients.queue.newCta': 'Novo paciente',
    'patients.timeline.eyebrow': 'LINHA DO TEMPO PÓS-OPERATÓRIA',
    'patients.timeline.title': 'Marcador de acompanhamento ativo',
    'patients.timeline.note': 'O status do checkpoint vem de fotos reais, não de progresso gerado.',
    'patients.table.patient': 'Paciente',
    'patients.table.stage': 'Estágio',
    'patients.table.next': 'Próxima ação',
    'patients.table.risk': 'Contexto de risco',
    'patients.table.consent': 'Consentimento de foto',
    'patients.noFlags': 'Sem flags ativos',
    'patients.next': 'Próximo',

    // Hairline Lab
    'planning.canvas.eyebrow': 'CANVAS VETORIAL',
    'planning.canvas.title': 'Hairline Lab',
    'planning.canvas.chip': 'Rascunho não assinado',
    'planning.safety.vector': 'Apenas vetor',
    'planning.safety.vectorBody': 'A imagem-fonte é imutável. Todas as sobreposições são vetoriais e o original é preservado por hash.',
    'planning.invariants.eyebrow': 'INVARIANTES DE PLANEJAMENTO',
    'planning.invariants.title': 'Apenas autoria do clínico',
    'planning.invariants.l1': 'Todas as medidas exigem calibração.',
    'planning.invariants.l2': 'As alternativas são nomeadas e versionadas.',
    'planning.invariants.l3': 'A revisão do paciente não pode alterar um plano assinado.',
    'planning.invariants.l4': 'Os totais finais de enxertos exigem assinatura do cirurgião.',
    'planning.next.title': 'Próximo pacote de implementação',
    'planning.next.body': 'Sobreposições imutáveis na imagem-fonte, mapeamento doador, planilha de enxertos e anexos assinados ao plano.',
    'planning.tools.midline': 'Linha média',
    'planning.tools.central': 'Altura central',
    'planning.tools.temporal': 'Pontos temporais',
    'planning.tools.frontotemporal': 'Ângulo frontotemporal',
    'planning.tools.macro': 'Macro',
    'planning.tools.micro': 'Micro',
    'planning.tools.symmetry': 'Simetria',

    // Procedure Board
    'procedures.eyebrow': 'DIA DO PROCEDIMENTO',
    'procedures.title': 'Fases operatórias',
    'procedures.phase1.title': 'Time-out pré-op',
    'procedures.phase1.desc': 'Identidade, consentimento, alergias e plano assinado.',
    'procedures.phase2.title': 'Extração',
    'procedures.phase2.desc': 'Dispositivo, punch, zonas doadoras e contagem de extração.',
    'procedures.phase3.title': 'Preparo dos enxertos',
    'procedures.phase3.desc': 'Unidades de 1/2/3/4+ fios, solução, temperatura e tempo.',
    'procedures.phase4.title': 'Implantação',
    'procedures.phase4.desc': 'Contagem por zona receptora, direção e ângulo.',
    'procedures.phase5.title': 'Fechamento',
    'procedures.phase5.desc': 'Reconciliação, eventos adversos e alta.',
    'procedures.graft.eyebrow': 'CONTADOR DE ENXERTOS',
    'procedures.graft.title': 'Contagem mecânica',
    'procedures.graft.label': 'Sessão 1 — total parcial',
    'procedures.graft.note': 'Cada ajuste registra o valor anterior, o novo valor, o autor e o motivo.',
    'procedures.reconcile.eyebrow': 'INVARIANTE DE CONTABILIDADE OBRIGATÓRIA',
    'procedures.reconcile.formula': 'extraídos = implantados + descartados + danificados + restantes',
    'procedures.reconcile.note': 'O fechamento do procedimento deve ser bloqueado até a reconciliação, ou até que o cirurgião registre evidência de break-glass.',

    // AI Sandbox
    'sandbox.eyebrow': 'SANDBOX NÃO CLÍNICO',
    'sandbox.title': 'Gerar um conceito sintético',
    'sandbox.style': 'Conceito de estilo de cabelo',
    'sandbox.style.placeholder': 'Cabelo curto escuro texturizado',
    'sandbox.coverage': 'Conceito de cobertura',
    'sandbox.coverage.opt1': 'Cobertura frontal conservadora',
    'sandbox.coverage.opt2': 'Cobertura frontal e meio do couro cabeludo equilibrada',
    'sandbox.coverage.opt3': 'Conceito educacional de cobertura da coroa',
    'sandbox.hairline': 'Conceito de linha frontal',
    'sandbox.hairline.opt1': 'Linha frontal madura e conservadora',
    'sandbox.hairline.opt2': 'Irregularidade natural e equilibrada',
    'sandbox.hairline.opt3': 'Estilo de alta densidade sem alegação clínica',
    'sandbox.notes': 'Notas de design neutras',
    'sandbox.notes.placeholder': 'Sem nome do paciente, CPF, diagnóstico ou resultado esperado.',
    'sandbox.submit': 'Gerar conceito marcado',
    'sandbox.submitting': 'Gerando…',
    'sandbox.boundary.title': 'Limite rígido',
    'sandbox.boundary.body': 'Apenas conceito sintético. Sem upload de foto do paciente, diagnóstico, previsão ou resultado garantido.',
    'sandbox.output.eyebrow': 'RESULTADO',
    'sandbox.output.title': 'Visualização hipotética',
    'sandbox.output.empty': 'A imagem gerada aparecerá aqui com marca d’água permanente.',
    'sandbox.enabled': 'Habilitado',
    'sandbox.disabled': 'Desabilitado',

    // Settings
    'settings.nav.settings': 'Configurações',
    'settings.nav.gemini': 'Gemini Image Gen',
    'settings.nav.security': 'Segurança',
    'settings.nav.roles': 'Funções e acesso',
    'settings.nav.audit': 'Auditoria',
    'settings.nav.retention': 'Retenção',
    'settings.eyebrow': 'INTEGRAÇÃO NO SERVIDOR',
    'settings.title': 'Gemini Image Gen API',
    'settings.configured': 'Configurado',
    'settings.notConfigured': 'Não configurado',
    'settings.lede': 'A chave é criptografada pela API e nunca é exposta ao navegador após salvar. Alterá-la ou testá-la exige autenticação step-up.',
    'settings.apiKey': 'Chave da API',
    'settings.apiKey.placeholder': 'Cole uma nova chave da API Gemini',
    'settings.apiKey.hint': 'Deixe em branco para manter a chave criptografada existente.',
    'settings.model': 'Modelo de imagem',
    'settings.toggle.enable': 'Habilitar visualização Gemini',
    'settings.toggle.enableHint': 'Kill switch do tenant. Os fluxos clínicos continuam funcionando quando desligado.',
    'settings.toggle.sandbox': 'Restringir a visualização hipotética não clínica',
    'settings.toggle.sandboxHint': 'Sem imagens, diagnóstico, conselho, previsão ou resultado de marketing identificáveis.',
    'settings.stepup': 'Senha do administrador para step-up',
    'settings.save': 'Salvar configurações criptografadas',
    'settings.test': 'Testar conexão',
    'settings.storedKey': 'Chave armazenada',
    'settings.lastTest': 'Último teste',
    'settings.lastUpdate': 'Última atualização',
    'settings.never': 'Nunca',
    'settings.none': 'Nenhuma',
    'settings.secret.title': 'Tratamento de segredo',
    'settings.secret.body': 'Sem variável VITE_, sem SDK no front-end, sem logging, sem leitura de texto plano. Em produção, substitua o armazenamento criptografado local por um gerenciador de segredos gerenciado.',
    'settings.toast.saved': 'Configurações do Gemini criptografadas e salvas.',
    'settings.toast.connected': 'Conectado e o modelo selecionado está visível.',
    'settings.toast.connectedNoModel': 'Conectado, mas o modelo selecionado não foi listado para esta chave.',

    // Fatal
    'fatal.title': 'Não foi possível carregar o workspace',
    'fatal.retry': 'Tentar novamente',

    // Common - role labels
    'role.admin': 'Administrador',
    'role.clinician': 'Clínico',
    'role.assistant': 'Assistente'
  },

  'en': {
    'brand.name': 'TANAH-HAIR',
    'brand.tagline': 'Clinical workspace',
    'brand.eyebrow': 'TANAH CLINIC',

    'login.subtitle': 'Hair-transplant planning, procedure operations and patient journey.',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Enter clinical workspace',
    'login.error': 'Email or password is incorrect.',
    'login.boundary.title': 'Clinical boundary',
    'login.boundary.body': 'No autonomous diagnosis, treatment recommendation or guaranteed outcome.',

    'sidebar.footer.status': 'Medical-grade controls',
    'sidebar.signout': 'Sign out',

    'nav.overview': 'Overview',
    'nav.patients': 'Patients',
    'nav.planning': 'Hairline Lab',
    'nav.procedures': 'Procedure Board',
    'nav.visualization': 'AI Sandbox',
    'nav.settings': 'Settings',

    'topbar.record': 'Clinical record',
    'topbar.lang.pt': 'PT-BR',
    'topbar.lang.en': 'EN',
    'topbar.lang.es': 'ES',

    'topbar.subtitle.overview': 'Operational status, clinical queues and integration health.',
    'topbar.subtitle.patients': 'Purpose-limited access to synthetic demonstration records.',
    'topbar.subtitle.planning': 'Manual vector planning over immutable clinical photography.',
    'topbar.subtitle.procedures': 'Auditable phase controls and graft reconciliation.',
    'topbar.subtitle.visualization': 'Optional, server-side Gemini image generation with strict guardrails.',
    'topbar.subtitle.settings': 'Tenant integrations, secrets and safety controls.',

    'common.open': 'Open',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.signedInAs': 'Signed in as',
    'common.demo': 'Demo data',
    'common.foundationScaffold': 'Foundation scaffold',
    'common.awaitingLiveData': 'Awaiting live data',

    'metric.consultations': 'Consultations today',
    'metric.consultations.meta': 'Scheduled and confirmed',
    'metric.plans': 'Plans awaiting signature',
    'metric.plans.meta': 'Surgeon action required',
    'metric.followups': 'Follow-ups due',
    'metric.followups.meta': 'Day 2 through Month 18',
    'metric.rooms': 'Procedure rooms',
    'metric.rooms.meta': 'Readiness checks active',

    'dashboard.recent.eyebrow': 'ACTIVE JOURNEYS',
    'dashboard.recent.title': 'Patient action queue',
    'dashboard.recent.cta': 'Open queue',
    'dashboard.ai.eyebrow': 'INTEGRATION HEALTH',
    'dashboard.ai.title': 'Gemini Image Gen',
    'dashboard.ai.cta': 'Configure',
    'dashboard.ai.on': 'ON',
    'dashboard.ai.off': 'OFF',
    'dashboard.ai.configured': 'Key configured',
    'dashboard.ai.notConfigured': 'Not configured',
    'dashboard.ai.lastTest': 'Last test',
    'dashboard.sandbox.title': 'Sandbox-only',
    'dashboard.sandbox.body': 'Generated concepts are hypothetical, watermarked and isolated from the clinical record.',

    'patients.queue.eyebrow': 'CARE OPERATIONS',
    'patients.queue.title': 'Patient journey queue',
    'patients.queue.newCta': 'New patient',
    'patients.timeline.eyebrow': 'POSTOPERATIVE TIMELINE',
    'patients.timeline.title': 'Active follow-up dial',
    'patients.timeline.note': 'Checkpoint status is based on actual photos, not generated progress.',
    'patients.table.patient': 'Patient',
    'patients.table.stage': 'Stage',
    'patients.table.next': 'Next action',
    'patients.table.risk': 'Risk context',
    'patients.table.consent': 'Photo consent',
    'patients.noFlags': 'No active flags',
    'patients.next': 'Next',

    'planning.canvas.eyebrow': 'VECTOR CANVAS',
    'planning.canvas.title': 'Hairline Lab',
    'planning.canvas.chip': 'Unsigned draft',
    'planning.safety.vector': 'Vector-only',
    'planning.safety.vectorBody': 'The source image is immutable. All overlays are vectors and the original is preserved by hash.',
    'planning.invariants.eyebrow': 'PLANNING INVARIANTS',
    'planning.invariants.title': 'Clinician-authored only',
    'planning.invariants.l1': 'All measurements require calibration.',
    'planning.invariants.l2': 'Alternatives are named and versioned.',
    'planning.invariants.l3': 'Patient review cannot alter a signed plan.',
    'planning.invariants.l4': 'Final graft totals require surgeon signature.',
    'planning.next.title': 'Next implementation package',
    'planning.next.body': 'Immutable source-image overlays, donor mapping, graft worksheet and signed plan addenda.',
    'planning.tools.midline': 'Midline',
    'planning.tools.central': 'Central height',
    'planning.tools.temporal': 'Temporal peaks',
    'planning.tools.frontotemporal': 'Frontotemporal ∠',
    'planning.tools.macro': 'Macro',
    'planning.tools.micro': 'Micro',
    'planning.tools.symmetry': 'Symmetry',

    'procedures.eyebrow': 'PROCEDURE DAY',
    'procedures.title': 'Operating phases',
    'procedures.phase1.title': 'Pre-op time-out',
    'procedures.phase1.desc': 'Identity, consent, allergies and signed plan.',
    'procedures.phase2.title': 'Harvesting',
    'procedures.phase2.desc': 'Device, punch, donor zones and extraction count.',
    'procedures.phase3.title': 'Graft preparation',
    'procedures.phase3.desc': '1/2/3/4+ hair units, solution, temperature and time.',
    'procedures.phase4.title': 'Implantation',
    'procedures.phase4.desc': 'Recipient-zone count, direction and angle notes.',
    'procedures.phase5.title': 'Closure',
    'procedures.phase5.desc': 'Reconciliation, adverse events and discharge.',
    'procedures.graft.eyebrow': 'GRAFT COUNTER',
    'procedures.graft.title': 'Mechanical tally',
    'procedures.graft.label': 'Session 1 — running total',
    'procedures.graft.note': 'Every adjustment logs the previous value, new value, author and reason.',
    'procedures.reconcile.eyebrow': 'REQUIRED ACCOUNTING INVARIANT',
    'procedures.reconcile.formula': 'extracted = implanted + discarded + damaged + remaining',
    'procedures.reconcile.note': 'Procedure closure must block until reconciled or a surgeon records break-glass evidence.',

    'sandbox.eyebrow': 'NON-CLINICAL SANDBOX',
    'sandbox.title': 'Generate a synthetic concept',
    'sandbox.style': 'Hair style concept',
    'sandbox.style.placeholder': 'Short textured dark hair',
    'sandbox.coverage': 'Coverage concept',
    'sandbox.coverage.opt1': 'Conservative frontal coverage',
    'sandbox.coverage.opt2': 'Balanced frontal and midscalp coverage',
    'sandbox.coverage.opt3': 'Educational crown coverage concept',
    'sandbox.hairline': 'Hairline concept',
    'sandbox.hairline.opt1': 'Mature conservative hairline',
    'sandbox.hairline.opt2': 'Balanced natural irregularity',
    'sandbox.hairline.opt3': 'High-density-looking style without clinical claim',
    'sandbox.notes': 'Neutral design notes',
    'sandbox.notes.placeholder': 'No patient name, CPF, diagnosis or expected result.',
    'sandbox.submit': 'Generate watermarked concept',
    'sandbox.submitting': 'Generating…',
    'sandbox.boundary.title': 'Hard boundary',
    'sandbox.boundary.body': 'Synthetic concept only. No patient photograph upload, diagnosis, prediction or guaranteed outcome.',
    'sandbox.output.eyebrow': 'OUTPUT',
    'sandbox.output.title': 'Hypothetical visualization',
    'sandbox.output.empty': 'The generated image will appear here with a permanent watermark.',
    'sandbox.enabled': 'Enabled',
    'sandbox.disabled': 'Disabled',

    'settings.nav.settings': 'Settings',
    'settings.nav.gemini': 'Gemini Image Gen',
    'settings.nav.security': 'Security',
    'settings.nav.roles': 'Roles and access',
    'settings.nav.audit': 'Audit',
    'settings.nav.retention': 'Retention',
    'settings.eyebrow': 'SERVER-SIDE INTEGRATION',
    'settings.title': 'Gemini Image Gen API',
    'settings.configured': 'Configured',
    'settings.notConfigured': 'Not configured',
    'settings.lede': 'The key is encrypted by the API and never exposed to the browser after save. Changing or testing it requires step-up authentication.',
    'settings.apiKey': 'API key',
    'settings.apiKey.placeholder': 'Paste a new Gemini API key',
    'settings.apiKey.hint': 'Leave blank to retain the existing encrypted key.',
    'settings.model': 'Image model',
    'settings.toggle.enable': 'Enable Gemini visualization',
    'settings.toggle.enableHint': 'Tenant kill switch. Clinical workflows remain functional when off.',
    'settings.toggle.sandbox': 'Restrict to non-clinical hypothetical visualization',
    'settings.toggle.sandboxHint': 'No identifiable patient images, diagnosis, advice, prediction or marketing result.',
    'settings.stepup': 'Administrator password for step-up',
    'settings.save': 'Save encrypted settings',
    'settings.test': 'Test connection',
    'settings.storedKey': 'Stored key',
    'settings.lastTest': 'Last test',
    'settings.lastUpdate': 'Last update',
    'settings.never': 'Never',
    'settings.none': 'None',
    'settings.secret.title': 'Secret handling',
    'settings.secret.body': 'No VITE_ variable, no frontend SDK, no logging, no plaintext read-back. Production should replace local encrypted storage with a managed secret service.',
    'settings.toast.saved': 'Gemini settings encrypted and saved.',
    'settings.toast.connected': 'Connected and selected model is visible.',
    'settings.toast.connectedNoModel': 'Connected, but selected model was not listed for this key.',

    'fatal.title': 'Unable to load workspace',
    'fatal.retry': 'Retry',

    'role.admin': 'Administrator',
    'role.clinician': 'Clinician',
    'role.assistant': 'Assistant'
  },

  'es': {
    'brand.name': 'TANAH-HAIR',
    'brand.tagline': 'Espacio clínico',
    'brand.eyebrow': 'CLÍNICA TANAH',

    'login.subtitle': 'Planificación de trasplante capilar, operaciones de procedimiento y trayectoria del paciente.',
    'login.email': 'Correo electrónico',
    'login.password': 'Contraseña',
    'login.submit': 'Entrar al espacio clínico',
    'login.error': 'El correo o la contraseña son incorrectos.',
    'login.boundary.title': 'Límite clínico',
    'login.boundary.body': 'Sin diagnóstico autónomo, recomendación de tratamiento ni resultado garantizado.',

    'sidebar.footer.status': 'Controles de grado médico',
    'sidebar.signout': 'Cerrar sesión',

    'nav.overview': 'Resumen',
    'nav.patients': 'Pacientes',
    'nav.planning': 'Hairline Lab',
    'nav.procedures': 'Procedure Board',
    'nav.visualization': 'AI Sandbox',
    'nav.settings': 'Configuración',

    'topbar.record': 'Historia clínica',
    'topbar.lang.pt': 'PT-BR',
    'topbar.lang.en': 'EN',
    'topbar.lang.es': 'ES',

    'topbar.subtitle.overview': 'Estado operativo, colas clínicas y salud de la integración.',
    'topbar.subtitle.patients': 'Acceso limitado a registros sintéticos de demostración.',
    'topbar.subtitle.planning': 'Planificación vectorial manual sobre fotografía clínica inmutable.',
    'topbar.subtitle.procedures': 'Controles de fase auditables y reconciliación de injertos.',
    'topbar.subtitle.visualization': 'Generación de imagen Gemini opcional del lado del servidor, con controles estrictos.',
    'topbar.subtitle.settings': 'Integraciones del tenant, secretos y controles de seguridad.',

    'common.open': 'Abrir',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.signedInAs': 'Conectado como',
    'common.demo': 'Datos de demostración',
    'common.foundationScaffold': 'Andamiaje base',
    'common.awaitingLiveData': 'A la espera de datos en vivo',

    'metric.consultations': 'Consultas hoy',
    'metric.consultations.meta': 'Agendadas y confirmadas',
    'metric.plans': 'Planes esperando firma',
    'metric.plans.meta': 'Acción del cirujano requerida',
    'metric.followups': 'Seguimientos pendientes',
    'metric.followups.meta': 'Del día 2 al mes 18',
    'metric.rooms': 'Salas de procedimiento',
    'metric.rooms.meta': 'Verificaciones de preparación activas',

    'dashboard.recent.eyebrow': 'TRAYECTORIAS ACTIVAS',
    'dashboard.recent.title': 'Cola de acciones del paciente',
    'dashboard.recent.cta': 'Abrir cola',
    'dashboard.ai.eyebrow': 'SALUD DE LA INTEGRACIÓN',
    'dashboard.ai.title': 'Gemini Image Gen',
    'dashboard.ai.cta': 'Configurar',
    'dashboard.ai.on': 'ON',
    'dashboard.ai.off': 'OFF',
    'dashboard.ai.configured': 'Clave configurada',
    'dashboard.ai.notConfigured': 'No configurado',
    'dashboard.ai.lastTest': 'Última prueba',
    'dashboard.sandbox.title': 'Solo sandbox',
    'dashboard.sandbox.body': 'Los conceptos generados son hipotéticos, llevan marca de agua y están aislados de la historia clínica.',

    'patients.queue.eyebrow': 'OPERACIONES DE CUIDADO',
    'patients.queue.title': 'Cola de trayectoria del paciente',
    'patients.queue.newCta': 'Nuevo paciente',
    'patients.timeline.eyebrow': 'LÍNEA DE TIEMPO POSTOPERATORIA',
    'patients.timeline.title': 'Marcador de seguimiento activo',
    'patients.timeline.note': 'El estado del checkpoint se basa en fotos reales, no en progreso generado.',
    'patients.table.patient': 'Paciente',
    'patients.table.stage': 'Etapa',
    'patients.table.next': 'Próxima acción',
    'patients.table.risk': 'Contexto de riesgo',
    'patients.table.consent': 'Consentimiento fotográfico',
    'patients.noFlags': 'Sin alertas activas',
    'patients.next': 'Próximo',

    'planning.canvas.eyebrow': 'LIENZO VECTORIAL',
    'planning.canvas.title': 'Hairline Lab',
    'planning.canvas.chip': 'Borrador sin firmar',
    'planning.safety.vector': 'Solo vector',
    'planning.safety.vectorBody': 'La imagen fuente es inmutable. Todas las superposiciones son vectores y el original se conserva por hash.',
    'planning.invariants.eyebrow': 'INVARIANTES DE PLANIFICACIÓN',
    'planning.invariants.title': 'Solo autoría del clínico',
    'planning.invariants.l1': 'Todas las medidas requieren calibración.',
    'planning.invariants.l2': 'Las alternativas están nombradas y versionadas.',
    'planning.invariants.l3': 'La revisión del paciente no puede alterar un plan firmado.',
    'planning.invariants.l4': 'Los totales finales de injertos requieren firma del cirujano.',
    'planning.next.title': 'Próximo paquete de implementación',
    'planning.next.body': 'Superposiciones inmutables sobre la imagen fuente, mapeo del donante, hoja de cálculo de injertos y adendas firmadas.',
    'planning.tools.midline': 'Línea media',
    'planning.tools.central': 'Altura central',
    'planning.tools.temporal': 'Picos temporales',
    'planning.tools.frontotemporal': 'Ángulo frontotemporal',
    'planning.tools.macro': 'Macro',
    'planning.tools.micro': 'Micro',
    'planning.tools.symmetry': 'Simetría',

    'procedures.eyebrow': 'DÍA DEL PROCEDIMIENTO',
    'procedures.title': 'Fases operatorias',
    'procedures.phase1.title': 'Time-out preoperatorio',
    'procedures.phase1.desc': 'Identidad, consentimiento, alergias y plan firmado.',
    'procedures.phase2.title': 'Extracción',
    'procedures.phase2.desc': 'Dispositivo, punch, zonas donantes y conteo de extracción.',
    'procedures.phase3.title': 'Preparación de injertos',
    'procedures.phase3.desc': 'Unidades de 1/2/3/4+ pelos, solución, temperatura y tiempo.',
    'procedures.phase4.title': 'Implantación',
    'procedures.phase4.desc': 'Conteo por zona receptora, dirección y ángulo.',
    'procedures.phase5.title': 'Cierre',
    'procedures.phase5.desc': 'Reconciliación, eventos adversos y alta.',
    'procedures.graft.eyebrow': 'CONTADOR DE INJERTOS',
    'procedures.graft.title': 'Conteo mecánico',
    'procedures.graft.label': 'Sesión 1 — total parcial',
    'procedures.graft.note': 'Cada ajuste registra el valor anterior, el nuevo valor, el autor y el motivo.',
    'procedures.reconcile.eyebrow': 'INVARIANTE CONTABLE OBLIGATORIA',
    'procedures.reconcile.formula': 'extraídos = implantados + descartados + dañados + restantes',
    'procedures.reconcile.note': 'El cierre del procedimiento debe bloquearse hasta la reconciliación, o hasta que el cirujano registre evidencia de break-glass.',

    'sandbox.eyebrow': 'SANDBOX NO CLÍNICO',
    'sandbox.title': 'Generar un concepto sintético',
    'sandbox.style': 'Concepto de estilo de cabello',
    'sandbox.style.placeholder': 'Cabello corto oscuro texturizado',
    'sandbox.coverage': 'Concepto de cobertura',
    'sandbox.coverage.opt1': 'Cobertura frontal conservadora',
    'sandbox.coverage.opt2': 'Cobertura equilibrada frontal y de mesocuero',
    'sandbox.coverage.opt3': 'Concepto educativo de cobertura de coronilla',
    'sandbox.hairline': 'Concepto de línea frontal',
    'sandbox.hairline.opt1': 'Línea frontal madura y conservadora',
    'sandbox.hairline.opt2': 'Irregularidad natural y equilibrada',
    'sandbox.hairline.opt3': 'Estilo de alta densidad sin afirmación clínica',
    'sandbox.notes': 'Notas de diseño neutras',
    'sandbox.notes.placeholder': 'Sin nombre del paciente, CPF, diagnóstico ni resultado esperado.',
    'sandbox.submit': 'Generar concepto con marca de agua',
    'sandbox.submitting': 'Generando…',
    'sandbox.boundary.title': 'Límite estricto',
    'sandbox.boundary.body': 'Solo concepto sintético. Sin carga de fotos del paciente, diagnóstico, predicción ni resultado garantizado.',
    'sandbox.output.eyebrow': 'RESULTADO',
    'sandbox.output.title': 'Visualización hipotética',
    'sandbox.output.empty': 'La imagen generada aparecerá aquí con una marca de agua permanente.',
    'sandbox.enabled': 'Habilitado',
    'sandbox.disabled': 'Deshabilitado',

    'settings.nav.settings': 'Configuración',
    'settings.nav.gemini': 'Gemini Image Gen',
    'settings.nav.security': 'Seguridad',
    'settings.nav.roles': 'Funciones y acceso',
    'settings.nav.audit': 'Auditoría',
    'settings.nav.retention': 'Retención',
    'settings.eyebrow': 'INTEGRACIÓN DEL LADO DEL SERVIDOR',
    'settings.title': 'Gemini Image Gen API',
    'settings.configured': 'Configurado',
    'settings.notConfigured': 'No configurado',
    'settings.lede': 'La clave es cifrada por la API y nunca se expone al navegador después de guardar. Cambiarla o probarla requiere autenticación step-up.',
    'settings.apiKey': 'Clave de API',
    'settings.apiKey.placeholder': 'Pegue una nueva clave de API de Gemini',
    'settings.apiKey.hint': 'Deje en blanco para conservar la clave cifrada existente.',
    'settings.model': 'Modelo de imagen',
    'settings.toggle.enable': 'Habilitar visualización Gemini',
    'settings.toggle.enableHint': 'Interruptor de apagado del tenant. Los flujos clínicos siguen funcionando cuando está apagado.',
    'settings.toggle.sandbox': 'Restringir a visualización hipotética no clínica',
    'settings.toggle.sandboxHint': 'Sin imágenes identificables del paciente, diagnóstico, consejo, predicción ni resultado de marketing.',
    'settings.stepup': 'Contraseña del administrador para step-up',
    'settings.save': 'Guardar configuración cifrada',
    'settings.test': 'Probar conexión',
    'settings.storedKey': 'Clave almacenada',
    'settings.lastTest': 'Última prueba',
    'settings.lastUpdate': 'Última actualización',
    'settings.never': 'Nunca',
    'settings.none': 'Ninguna',
    'settings.secret.title': 'Tratamiento del secreto',
    'settings.secret.body': 'Sin variable VITE_, sin SDK en el frontend, sin logging, sin lectura en texto plano. En producción, reemplace el almacenamiento cifrado local por un servicio gestionado de secretos.',
    'settings.toast.saved': 'Configuración de Gemini cifrada y guardada.',
    'settings.toast.connected': 'Conectado y el modelo seleccionado está visible.',
    'settings.toast.connectedNoModel': 'Conectado, pero el modelo seleccionado no se listó para esta clave.',

    'fatal.title': 'No se pudo cargar el espacio de trabajo',
    'fatal.retry': 'Reintentar',

    'role.admin': 'Administrador',
    'role.clinician': 'Clínico',
    'role.assistant': 'Asistente'
  }
};

const STORAGE_KEY = 'tanah-hair-lang';
const DEFAULT_LANG: Lang = 'pt-BR';

export function getLang(): Lang {
  if (typeof localStorage === 'undefined') return DEFAULT_LANG;
  const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
  if (stored && (stored === 'pt-BR' || stored === 'en' || stored === 'es')) return stored;
  // Try to match browser language.
  const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
  if (nav.startsWith('pt')) return 'pt-BR';
  if (nav.startsWith('es')) return 'es';
  return 'en';
}

export function setLang(lang: Lang): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang);
  // Notify listeners (the page can re-render).
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tanah:lang', { detail: lang }));
}

/**
 * Lookup a translation. Falls back to English, then to the key itself.
 * Supports {placeholder} interpolation.
 */
export function t(key: string, vars?: Record<string, string | number>, langOverride?: Lang): string {
  const lang = langOverride || getLang();
  let s = D[lang][key] || D.en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
  return s;
}

/**
 * Role label lookup. Falls back to the raw role string if unknown.
 */
export function roleLabel(role: string): string {
  const k = `role.${role}`;
  const lang = getLang();
  return D[lang][k] || D.en[k] || role;
}
