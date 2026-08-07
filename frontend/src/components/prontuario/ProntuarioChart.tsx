/**
 * Full electronic prontuário hub — CFM 1.638/2002 chart sections.
 * Nested in patient workspace Clínico tab.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useI18n } from '../../hooks/useI18n';

export type ChartTab =
  | 'resumo' | 'anamnese' | 'evolucoes' | 'soap' | 'vitais'
  | 'exames' | 'procedimentos' | 'problemas' | 'alergias'
  | 'receitas' | 'anexos';

const CHART_TABS: ChartTab[] = [
  'resumo', 'anamnese', 'evolucoes', 'soap', 'vitais',
  'exames', 'procedimentos', 'problemas', 'alergias',
  'receitas', 'anexos',
];

function fmtWhen(v?: string | null, locale = 'pt-BR') {
  if (!v) return '—';
  const raw = String(v).replace(' ', 'T');
  const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function Stamp({ label }: { label?: string | null }) {
  if (!label) return null;
  return (
    <div className="text-[11px] text-[color:var(--ink-muted)] mt-1 font-medium tracking-wide">
      {label}
    </div>
  );
}

function Panel({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="crm-inset-panel space-y-3" data-testid={testId}>
      {title ? <h3 className="crm-record-panel-title">{title}</h3> : null}
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[color:var(--ink-muted)]">{children}</p>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-[8rem] flex-1">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export default function ProntuarioChart({
  patientId,
}: {
  patientId: string;
  patientName?: string;
  birthDate?: string | null;
  gender?: string | null;
}) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<ChartTab>('resumo');
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  // section lists
  const [evolutions, setEvolutions] = useState<any[]>([]);
  const [vitals, setVitals] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [procedures, setProcedures] = useState<any[]>([]);
  const [problems, setProblems] = useState<any[]>([]);
  const [allergies, setAllergies] = useState<any[]>([]);
  const [anamnesisList, setAnamnesisList] = useState<any[]>([]);
  const [encounters, setEncounters] = useState<any[]>([]);
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);

  // forms
  const [evolText, setEvolText] = useState('');
  const [evolType, setEvolType] = useState('evolution');
  const [anam, setAnam] = useState({
    chief_complaint: '', hpi: '', past_history: '', family_history: '',
    social_history: '', review_of_systems: '', current_medications: '',
  });
  const [vitalForm, setVitalForm] = useState({
    systolic_mmhg: '', diastolic_mmhg: '', heart_rate_bpm: '', respiratory_rate: '',
    temperature_c: '', spo2_pct: '', pain_score: '', weight_kg: '', height_cm: '', glucose_mg_dl: '', notes: '',
  });
  const [examOrder, setExamOrder] = useState({ exam_name: '', clinical_indication: '', priority: 'routine', exam_code: '' });
  const [examResult, setExamResult] = useState({ exam_name: '', result_summary: '', abnormal: false, order_id: '' });
  const [procForm, setProcForm] = useState({ procedure_name: '', procedure_code: '', description: '', outcome: '', complications: '' });
  const [probForm, setProbForm] = useState({ title: '', cid10_code: '', notes: '' });
  const [allergyForm, setAllergyForm] = useState({ substance: '', reaction: '', severity: 'moderate', notes: '' });
  const [attachForm, setAttachForm] = useState({ title: '', doc_type: 'other', notes: '', file_path: '' });
  const [soapForm, setSoapForm] = useState({
    subjective: '', objective: '', assessment: '', plan: '', cid10: '', notes: '',
  });

  const loadSummary = useCallback(() => {
    setLoading(true);
    setError('');
    api.get(`/api/clinical/chart/${patientId}`)
      .then(setSummary)
      .catch((e) => setError(e?.message || t('errors.generic')))
      .finally(() => setLoading(false));
  }, [patientId, t]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const loadTab = useCallback(async (id: ChartTab) => {
    if (id === 'resumo') return;
    setError('');
    try {
      if (id === 'evolucoes') {
        const d = await api.get(`/api/clinical/chart/${patientId}/evolutions`);
        setEvolutions(d.evolutions || []);
      } else if (id === 'vitais') {
        const d = await api.get(`/api/clinical/chart/${patientId}/vitals`);
        setVitals(d.vitals || []);
      } else if (id === 'exames') {
        const [o, r] = await Promise.all([
          api.get(`/api/clinical/chart/${patientId}/exam-orders?status=all`),
          api.get(`/api/clinical/chart/${patientId}/exam-results`),
        ]);
        setOrders(o.orders || []);
        setResults(r.results || []);
      } else if (id === 'procedimentos') {
        const d = await api.get(`/api/clinical/chart/${patientId}/procedures`);
        setProcedures(d.procedures || []);
      } else if (id === 'problemas') {
        const d = await api.get(`/api/clinical/chart/${patientId}/problems`);
        setProblems(d.problems || []);
      } else if (id === 'alergias') {
        const d = await api.get(`/api/clinical/chart/${patientId}/allergies`);
        setAllergies(d.allergies || []);
      } else if (id === 'anamnese') {
        const d = await api.get(`/api/clinical/chart/${patientId}/anamnesis`);
        setAnamnesisList(d.anamnesis || []);
        if (d.latest) {
          setAnam({
            chief_complaint: d.latest.chief_complaint || '',
            hpi: d.latest.hpi || '',
            past_history: d.latest.past_history || '',
            family_history: d.latest.family_history || '',
            social_history: d.latest.social_history || '',
            review_of_systems: d.latest.review_of_systems || '',
            current_medications: d.latest.current_medications || '',
          });
        }
      } else if (id === 'soap') {
        const d = await api.get(`/api/clinical/chart/${patientId}/encounters`);
        setEncounters(d.encounters || []);
      } else if (id === 'receitas') {
        const d = await api.get(`/api/clinical/chart/${patientId}/prescriptions?status=all`);
        setPrescriptions(d.prescriptions || []);
      } else if (id === 'anexos') {
        const d = await api.get(`/api/clinical/chart/${patientId}/attachments`);
        setAttachments(d.attachments || []);
      }
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
    }
  }, [patientId, t]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const switchTab = (id: ChartTab) => {
    setTab(id);
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      loadSummary();
      await loadTab(tab);
    } catch (e: any) {
      setError(e?.body?.message || e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  if (loading && !summary) {
    return <div className="p-4 text-sm text-[color:var(--ink-muted)]">{t('common.loading')}</div>;
  }

  const counts = summary?.counts || {};
  const severeAllergy = (summary?.allergies || []).some((a: any) =>
    ['severe', 'life_threatening'].includes(a.severity),
  );

  return (
    <div className="flex flex-col min-w-0" data-testid="prontuario-chart">
      {/* Allergy alert banner — CFM safety */}
      {summary?.allergy_alert && (
        <div
          className={`mx-3 sm:mx-4 mt-3 rounded-lg px-3 py-2 text-sm border ${
            severeAllergy
              ? 'bg-[#f8e8e2] border-[#c45c3e] text-[#6b2a1a]'
              : 'bg-[#f7f1e6] border-[rgba(176,183,192,0.55)] text-[#4a453c]'
          }`}
          data-testid="allergy-alert"
          role="alert"
        >
          <strong className="font-semibold">{t('chart.allergy_alert')}</strong>
          {' '}
          {(summary.allergies || []).map((a: any) => a.substance).filter(Boolean).join(', ')
            || (summary.allergies_legacy || []).join(', ')
            || '—'}
          {severeAllergy ? ` · ${t('chart.allergy_severe')}` : ''}
        </div>
      )}

      <div className="px-3 sm:px-4 pt-3 flex flex-wrap gap-1 border-b border-[rgba(176,183,192,0.4)] bg-gradient-to-b from-[#f7f1e6] to-[#f0e8da]">
        {CHART_TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={`crm-feed-tab ${tab === id ? 'is-active' : ''}`}
            data-testid={`chart-tab-${id}`}
            onClick={() => switchTab(id)}
          >
            {t(`chart.tabs.${id}`)}
            {id === 'evolucoes' && counts.evolutions > 0 && (
              <span className="ml-1 tabular-nums text-[color:var(--ink-muted)]">{counts.evolutions}</span>
            )}
            {id === 'alergias' && counts.allergies_active > 0 && (
              <span className="ml-1 tabular-nums text-[#8b3a2a]">{counts.allergies_active}</span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-4 mt-3 text-sm text-[#8b3a2a] bg-[#f8e8e2] border border-[#e2b8a8] rounded-lg px-3 py-2">{error}</div>
      )}

      <div className="p-3 sm:p-4 space-y-3 animate-fade-in">
          {tab === 'resumo' && summary && (
            <>
              <Panel title={t('chart.resumo_title')} testId="chart-resumo">
                <p className="text-xs text-[color:var(--ink-muted)] leading-relaxed">{t('chart.cfm_notice')}</p>
                <div className="flex flex-wrap gap-x-6 gap-y-3 mt-2">
                  {[
                    ['evolutions', counts.evolutions],
                    ['encounters', counts.encounters],
                    ['problems_active', counts.problems_active],
                    ['allergies_active', counts.allergies_active],
                    ['exam_orders', counts.exam_orders],
                    ['procedures', counts.procedures],
                    ['prescriptions_active', counts.prescriptions_active],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="min-w-[5rem]">
                      <div className="text-[10px] uppercase tracking-[0.06em] text-[color:var(--ink-muted)] font-semibold">
                        {t(`chart.count.${k}`)}
                      </div>
                      <div className="font-display text-xl text-[color:var(--ink)] tabular-nums">{v ?? 0}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              {(summary.problems || []).filter((p: any) => p.status === 'active').length > 0 && (
                <Panel title={t('chart.tabs.problemas')}>
                  <ul className="space-y-1.5">
                    {(summary.problems || []).filter((p: any) => p.status === 'active').map((p: any) => (
                      <li key={p.id} className="text-sm flex flex-wrap gap-2 items-baseline">
                        <span className="font-medium">{p.title}</span>
                        {p.cid10_code && <span className="text-xs text-[color:var(--ink-muted)]">CID {p.cid10_code}</span>}
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              {summary.latest_vitals && (
                <Panel title={t('chart.latest_vitals')}>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                    {summary.latest_vitals.systolic_mmhg != null && (
                      <span>PA {summary.latest_vitals.systolic_mmhg}/{summary.latest_vitals.diastolic_mmhg} mmHg</span>
                    )}
                    {summary.latest_vitals.heart_rate_bpm != null && <span>FC {summary.latest_vitals.heart_rate_bpm} bpm</span>}
                    {summary.latest_vitals.temperature_c != null && <span>T {summary.latest_vitals.temperature_c} °C</span>}
                    {summary.latest_vitals.spo2_pct != null && <span>SpO₂ {summary.latest_vitals.spo2_pct}%</span>}
                    {summary.latest_vitals.weight_kg != null && <span>{summary.latest_vitals.weight_kg} kg</span>}
                  </div>
                  <Stamp label={summary.latest_vitals.stamp_label} />
                  <div className="text-[11px] text-[color:var(--ink-muted)]">{fmtWhen(summary.latest_vitals.recorded_at, locale)}</div>
                </Panel>
              )}

              {(summary.recent_evolutions || []).length > 0 && (
                <Panel title={t('chart.recent_evolutions')}>
                  <ul className="space-y-3">
                    {(summary.recent_evolutions || []).map((ev: any) => (
                      <li key={ev.id} className="text-sm border-b border-[rgba(176,183,192,0.35)] pb-2 last:border-0">
                        <div className="text-[11px] text-[color:var(--ink-muted)]">{fmtWhen(ev.recorded_at, locale)}</div>
                        <div className="whitespace-pre-wrap mt-0.5">{String(ev.content || '').slice(0, 280)}</div>
                        <Stamp label={ev.stamp_label} />
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              {(summary.active_prescriptions || []).length > 0 && (
                <Panel title={t('chart.tabs.receitas')}>
                  <ul className="space-y-2">
                    {(summary.active_prescriptions || []).map((rx: any) => (
                      <li key={rx.id} className="text-sm">
                        <div className="text-[11px] text-[color:var(--ink-muted)]">{fmtWhen(rx.created_at, locale)}</div>
                        {(rx.items || []).map((it: any, i: number) => (
                          <div key={i}>{it.medication} — {it.dosage} {it.frequency}</div>
                        ))}
                        <Stamp label={rx.stamp_label} />
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </>
          )}

          {tab === 'anamnese' && (
            <Panel title={t('chart.tabs.anamnese')} testId="chart-anamnese">
              <p className="text-xs text-[color:var(--ink-muted)]">{t('chart.anamnese_hint')}</p>
              <form
                className="space-y-3"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  run('anam', async () => {
                    await api.post(`/api/clinical/chart/${patientId}/anamnesis`, anam);
                  });
                }}
              >
                {([
                  ['chief_complaint', 'chart.fields.chief_complaint'],
                  ['hpi', 'chart.fields.hpi'],
                  ['past_history', 'chart.fields.past_history'],
                  ['family_history', 'chart.fields.family_history'],
                  ['social_history', 'chart.fields.social_history'],
                  ['review_of_systems', 'chart.fields.review_of_systems'],
                  ['current_medications', 'chart.fields.current_medications'],
                ] as const).map(([key, labelKey]) => (
                  <Field key={key} label={t(labelKey)}>
                    <textarea
                      className="input min-h-[4.5rem]"
                      value={(anam as any)[key]}
                      onChange={(e) => setAnam((s) => ({ ...s, [key]: e.target.value }))}
                    />
                  </Field>
                ))}
                <button type="submit" className="btn-primary" disabled={busy === 'anam'} data-testid="save-anamnesis">
                  {busy === 'anam' ? t('common.saving') : t('chart.save_anamnesis')}
                </button>
              </form>
              {anamnesisList.length > 1 && (
                <div className="pt-3 border-t border-[rgba(176,183,192,0.35)] space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)]">{t('chart.history')}</h4>
                  {anamnesisList.slice(1).map((a) => (
                    <div key={a.id} className="text-sm">
                      <div className="text-[11px] text-[color:var(--ink-muted)]">{fmtWhen(a.recorded_at, locale)}</div>
                      <div>{a.chief_complaint || a.hpi?.slice(0, 120) || '—'}</div>
                      <Stamp label={a.stamp_label} />
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {tab === 'evolucoes' && (
            <Panel title={t('chart.tabs.evolucoes')} testId="chart-evolucoes">
              <p className="text-xs text-[color:var(--ink-muted)]">{t('chart.evol_hint')}</p>
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!evolText.trim()) return;
                  run('evol', async () => {
                    await api.post(`/api/clinical/chart/${patientId}/evolutions`, {
                      content: evolText.trim(),
                      note_type: evolType,
                    });
                    setEvolText('');
                  });
                }}
              >
                <div className="flex flex-wrap gap-2">
                  <select className="input w-auto" value={evolType} onChange={(e) => setEvolType(e.target.value)}>
                    <option value="evolution">{t('chart.note_types.evolution')}</option>
                    <option value="nursing">{t('chart.note_types.nursing')}</option>
                    <option value="multiprofessional">{t('chart.note_types.multiprofessional')}</option>
                    <option value="emergency">{t('chart.note_types.emergency')}</option>
                  </select>
                </div>
                <textarea
                  className="input min-h-[6rem]"
                  value={evolText}
                  onChange={(e) => setEvolText(e.target.value)}
                  placeholder={t('chart.evol_placeholder')}
                  data-testid="evolution-content"
                />
                <button type="submit" className="btn-primary" disabled={busy === 'evol' || !evolText.trim()} data-testid="save-evolution">
                  {busy === 'evol' ? t('common.saving') : t('chart.save_evolution')}
                </button>
              </form>
              <ul className="space-y-3 pt-2">
                {evolutions.length === 0 && <Empty>{t('common.no_data')}</Empty>}
                {evolutions.map((ev) => (
                  <li key={ev.id} className="border-b border-[rgba(176,183,192,0.35)] pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] text-[color:var(--ink-muted)]">
                        {fmtWhen(ev.recorded_at, locale)} · {t(`chart.note_types.${ev.note_type || 'evolution'}`)}
                      </div>
                      {ev.status === 'active' && (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => run('cancel-evol', async () => {
                            await api.post(`/api/clinical/chart/${patientId}/evolutions/${ev.id}/cancel`, {
                              reason: t('chart.cancel_default'),
                            });
                          })}
                        >
                          {t('chart.cancel')}
                        </button>
                      )}
                    </div>
                    <div className="text-sm whitespace-pre-wrap mt-1">{ev.content}</div>
                    <Stamp label={ev.stamp_label} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tab === 'soap' && (
            <Panel title={t('chart.tabs.soap')} testId="chart-soap">
              <p className="text-xs text-[color:var(--ink-muted)]">
                {t('chart.soap_hint')}{' '}
                <Link to="/encounters" className="underline text-[color:var(--brass-deep)]">{t('chart.open_encounters')}</Link>
              </p>
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run('soap', async () => {
                    const me = await api.get('/api/auth/me');
                    const practitionerId = me?.user?.id || me?.id;
                    const codes = soapForm.cid10.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
                    await api.post('/api/clinical/encounters', {
                      patient_id: patientId,
                      practitioner_id: practitionerId,
                      started_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
                      subjective: soapForm.subjective || null,
                      objective: soapForm.objective || null,
                      assessment: soapForm.assessment || null,
                      plan: soapForm.plan || null,
                      notes: soapForm.notes || null,
                      cid10_codes: codes,
                      icd10_codes: codes,
                    });
                    setSoapForm({ subjective: '', objective: '', assessment: '', plan: '', cid10: '', notes: '' });
                  });
                }}
              >
                {(['subjective', 'objective', 'assessment', 'plan'] as const).map((k) => (
                  <Field key={k} label={t(`encounters.${k}`)}>
                    <textarea
                      className="input min-h-[3.5rem]"
                      value={soapForm[k]}
                      onChange={(e) => setSoapForm((s) => ({ ...s, [k]: e.target.value }))}
                    />
                  </Field>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Field label={t('encounters.icd10')}>
                    <input className="input" value={soapForm.cid10} onChange={(e) => setSoapForm((s) => ({ ...s, cid10: e.target.value }))} placeholder="E66.9" />
                  </Field>
                </div>
                <button type="submit" className="btn-primary" disabled={busy === 'soap'} data-testid="save-soap">
                  {busy === 'soap' ? t('common.saving') : t('chart.save_soap')}
                </button>
              </form>
              <ul className="space-y-3 pt-3 border-t border-[rgba(176,183,192,0.35)]">
                {encounters.length === 0 && <Empty>{t('common.no_data')}</Empty>}
                {encounters.map((enc) => (
                  <li key={enc.id} className="text-sm space-y-1">
                    <div className="text-[11px] text-[color:var(--ink-muted)]">
                      {fmtWhen(enc.started_at, locale)} · {enc.practitioner_name}
                    </div>
                    {enc.assessment && <div><span className="font-medium">A:</span> {enc.assessment}</div>}
                    {enc.plan && <div><span className="font-medium">P:</span> {enc.plan}</div>}
                    <Stamp label={enc.stamp_label} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tab === 'vitais' && (
            <Panel title={t('chart.tabs.vitais')} testId="chart-vitais">
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run('vitals', async () => {
                    await api.post(`/api/clinical/chart/${patientId}/vitals`, {
                      systolic_mmhg: num(vitalForm.systolic_mmhg),
                      diastolic_mmhg: num(vitalForm.diastolic_mmhg),
                      heart_rate_bpm: num(vitalForm.heart_rate_bpm),
                      respiratory_rate: num(vitalForm.respiratory_rate),
                      temperature_c: num(vitalForm.temperature_c),
                      spo2_pct: num(vitalForm.spo2_pct),
                      pain_score: num(vitalForm.pain_score),
                      weight_kg: num(vitalForm.weight_kg),
                      height_cm: num(vitalForm.height_cm),
                      glucose_mg_dl: num(vitalForm.glucose_mg_dl),
                      notes: vitalForm.notes || null,
                    });
                    setVitalForm({
                      systolic_mmhg: '', diastolic_mmhg: '', heart_rate_bpm: '', respiratory_rate: '',
                      temperature_c: '', spo2_pct: '', pain_score: '', weight_kg: '', height_cm: '', glucose_mg_dl: '', notes: '',
                    });
                  });
                }}
              >
                <div className="flex flex-wrap gap-2">
                  {([
                    ['systolic_mmhg', 'PAS'], ['diastolic_mmhg', 'PAD'], ['heart_rate_bpm', 'FC'],
                    ['respiratory_rate', 'FR'], ['temperature_c', 'T°C'], ['spo2_pct', 'SpO₂'],
                    ['pain_score', 'Dor'], ['weight_kg', 'kg'], ['height_cm', 'cm'], ['glucose_mg_dl', 'Glicemia'],
                  ] as const).map(([k, lab]) => (
                    <Field key={k} label={lab}>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={(vitalForm as any)[k]}
                        onChange={(e) => setVitalForm((s) => ({ ...s, [k]: e.target.value }))}
                      />
                    </Field>
                  ))}
                </div>
                <Field label={t('common.notes')}>
                  <input className="input" value={vitalForm.notes} onChange={(e) => setVitalForm((s) => ({ ...s, notes: e.target.value }))} />
                </Field>
                <button type="submit" className="btn-primary" disabled={busy === 'vitals'} data-testid="save-vitals">
                  {busy === 'vitals' ? t('common.saving') : t('chart.save_vitals')}
                </button>
              </form>
              <ul className="space-y-2 pt-2">
                {vitals.length === 0 && <Empty>{t('common.no_data')}</Empty>}
                {vitals.map((v) => (
                  <li key={v.id} className="text-sm border-b border-[rgba(176,183,192,0.35)] pb-2">
                    <div className="text-[11px] text-[color:var(--ink-muted)]">{fmtWhen(v.recorded_at, locale)}</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {v.systolic_mmhg != null && <span>PA {v.systolic_mmhg}/{v.diastolic_mmhg}</span>}
                      {v.heart_rate_bpm != null && <span>FC {v.heart_rate_bpm}</span>}
                      {v.temperature_c != null && <span>T {v.temperature_c}</span>}
                      {v.spo2_pct != null && <span>SpO₂ {v.spo2_pct}%</span>}
                      {v.weight_kg != null && <span>{v.weight_kg} kg</span>}
                      {v.pain_score != null && <span>Dor {v.pain_score}/10</span>}
                    </div>
                    <Stamp label={v.stamp_label} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tab === 'exames' && (
            <>
              <Panel title={t('chart.order_exam')} testId="chart-exam-orders">
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!examOrder.exam_name.trim()) return;
                    run('exam-o', async () => {
                      await api.post(`/api/clinical/chart/${patientId}/exam-orders`, examOrder);
                      setExamOrder({ exam_name: '', clinical_indication: '', priority: 'routine', exam_code: '' });
                    });
                  }}
                >
                  <div className="flex flex-wrap gap-2">
                    <Field label={t('chart.fields.exam_name')}>
                      <input className="input" value={examOrder.exam_name} onChange={(e) => setExamOrder((s) => ({ ...s, exam_name: e.target.value }))} data-testid="exam-name" />
                    </Field>
                    <Field label={t('chart.fields.exam_code')}>
                      <input className="input" value={examOrder.exam_code} onChange={(e) => setExamOrder((s) => ({ ...s, exam_code: e.target.value }))} />
                    </Field>
                    <Field label={t('chart.fields.priority')}>
                      <select className="input" value={examOrder.priority} onChange={(e) => setExamOrder((s) => ({ ...s, priority: e.target.value }))}>
                        <option value="routine">{t('chart.priority.routine')}</option>
                        <option value="urgent">{t('chart.priority.urgent')}</option>
                        <option value="emergency">{t('chart.priority.emergency')}</option>
                      </select>
                    </Field>
                  </div>
                  <Field label={t('chart.fields.indication')}>
                    <textarea className="input min-h-[3rem]" value={examOrder.clinical_indication} onChange={(e) => setExamOrder((s) => ({ ...s, clinical_indication: e.target.value }))} />
                  </Field>
                  <button type="submit" className="btn-primary" disabled={busy === 'exam-o'}>{t('chart.save_exam_order')}</button>
                </form>
                <ul className="space-y-2 pt-2">
                  {orders.map((o) => (
                    <li key={o.id} className="text-sm flex flex-wrap justify-between gap-2 border-b border-[rgba(176,183,192,0.35)] pb-2">
                      <div>
                        <div className="font-medium">{o.exam_name} <span className="text-xs font-normal text-[color:var(--ink-muted)]">({o.status})</span></div>
                        <div className="text-[11px] text-[color:var(--ink-muted)]">{fmtWhen(o.ordered_at, locale)} · {o.priority}</div>
                        <Stamp label={o.stamp_label} />
                      </div>
                      {o.status !== 'cancelled' && o.status !== 'resulted' && (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => run('exam-c', async () => {
                            await api.patch(`/api/clinical/chart/${patientId}/exam-orders/${o.id}`, { status: 'cancelled', reason: t('chart.cancel_default') });
                          })}
                        >
                          {t('chart.cancel')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title={t('chart.register_result')} testId="chart-exam-results">
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!examResult.exam_name.trim()) return;
                    run('exam-r', async () => {
                      await api.post(`/api/clinical/chart/${patientId}/exam-results`, {
                        exam_name: examResult.exam_name,
                        result_summary: examResult.result_summary || null,
                        abnormal: examResult.abnormal,
                        order_id: examResult.order_id || null,
                      });
                      setExamResult({ exam_name: '', result_summary: '', abnormal: false, order_id: '' });
                    });
                  }}
                >
                  <Field label={t('chart.fields.exam_name')}>
                    <input className="input" value={examResult.exam_name} onChange={(e) => setExamResult((s) => ({ ...s, exam_name: e.target.value }))} />
                  </Field>
                  <Field label={t('chart.fields.result')}>
                    <textarea className="input min-h-[3.5rem]" value={examResult.result_summary} onChange={(e) => setExamResult((s) => ({ ...s, result_summary: e.target.value }))} />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={examResult.abnormal} onChange={(e) => setExamResult((s) => ({ ...s, abnormal: e.target.checked }))} />
                    {t('chart.abnormal')}
                  </label>
                  <button type="submit" className="btn-primary" disabled={busy === 'exam-r'}>{t('chart.save_exam_result')}</button>
                </form>
                <ul className="space-y-2 pt-2">
                  {results.map((r) => (
                    <li key={r.id} className="text-sm border-b border-[rgba(176,183,192,0.35)] pb-2">
                      <div className="font-medium">
                        {r.exam_name}
                        {r.abnormal ? <span className="ml-2 badge badge-red">{t('chart.abnormal')}</span> : null}
                      </div>
                      <div className="whitespace-pre-wrap">{r.result_summary}</div>
                      <div className="text-[11px] text-[color:var(--ink-muted)]">{fmtWhen(r.resulted_at, locale)}</div>
                      <Stamp label={r.stamp_label} />
                    </li>
                  ))}
                </ul>
              </Panel>
            </>
          )}

          {tab === 'procedimentos' && (
            <Panel title={t('chart.tabs.procedimentos')} testId="chart-procedures">
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!procForm.procedure_name.trim()) return;
                  run('proc', async () => {
                    await api.post(`/api/clinical/chart/${patientId}/procedures`, procForm);
                    setProcForm({ procedure_name: '', procedure_code: '', description: '', outcome: '', complications: '' });
                  });
                }}
              >
                <div className="flex flex-wrap gap-2">
                  <Field label={t('chart.fields.procedure_name')}>
                    <input className="input" value={procForm.procedure_name} onChange={(e) => setProcForm((s) => ({ ...s, procedure_name: e.target.value }))} data-testid="procedure-name" />
                  </Field>
                  <Field label={t('chart.fields.procedure_code')}>
                    <input className="input" value={procForm.procedure_code} onChange={(e) => setProcForm((s) => ({ ...s, procedure_code: e.target.value }))} placeholder="TUSS" />
                  </Field>
                </div>
                <Field label={t('chart.fields.description')}>
                  <textarea className="input min-h-[3rem]" value={procForm.description} onChange={(e) => setProcForm((s) => ({ ...s, description: e.target.value }))} />
                </Field>
                <Field label={t('chart.fields.outcome')}>
                  <textarea className="input min-h-[2.5rem]" value={procForm.outcome} onChange={(e) => setProcForm((s) => ({ ...s, outcome: e.target.value }))} />
                </Field>
                <Field label={t('chart.fields.complications')}>
                  <input className="input" value={procForm.complications} onChange={(e) => setProcForm((s) => ({ ...s, complications: e.target.value }))} />
                </Field>
                <button type="submit" className="btn-primary" disabled={busy === 'proc'}>{t('chart.save_procedure')}</button>
              </form>
              <ul className="space-y-2 pt-2">
                {procedures.length === 0 && <Empty>{t('common.no_data')}</Empty>}
                {procedures.map((p) => (
                  <li key={p.id} className="text-sm border-b border-[rgba(176,183,192,0.35)] pb-2">
                    <div className="font-medium">{p.procedure_name} {p.procedure_code ? <span className="text-xs text-[color:var(--ink-muted)]">({p.procedure_code})</span> : null}</div>
                    {p.description && <div className="whitespace-pre-wrap">{p.description}</div>}
                    <div className="text-[11px] text-[color:var(--ink-muted)]">{fmtWhen(p.performed_at, locale)}</div>
                    <Stamp label={p.stamp_label} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tab === 'problemas' && (
            <Panel title={t('chart.tabs.problemas')} testId="chart-problems">
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!probForm.title.trim()) return;
                  run('prob', async () => {
                    await api.post(`/api/clinical/chart/${patientId}/problems`, probForm);
                    setProbForm({ title: '', cid10_code: '', notes: '' });
                  });
                }}
              >
                <div className="flex flex-wrap gap-2">
                  <Field label={t('chart.fields.problem')}>
                    <input className="input" value={probForm.title} onChange={(e) => setProbForm((s) => ({ ...s, title: e.target.value }))} data-testid="problem-title" />
                  </Field>
                  <Field label="CID-10">
                    <input className="input" value={probForm.cid10_code} onChange={(e) => setProbForm((s) => ({ ...s, cid10_code: e.target.value }))} />
                  </Field>
                </div>
                <Field label={t('common.notes')}>
                  <input className="input" value={probForm.notes} onChange={(e) => setProbForm((s) => ({ ...s, notes: e.target.value }))} />
                </Field>
                <button type="submit" className="btn-primary" disabled={busy === 'prob'}>{t('chart.save_problem')}</button>
              </form>
              <ul className="space-y-2 pt-2">
                {problems.map((p) => (
                  <li key={p.id} className="text-sm flex flex-wrap justify-between gap-2 border-b border-[rgba(176,183,192,0.35)] pb-2">
                    <div>
                      <span className="font-medium">{p.title}</span>
                      {p.cid10_code && <span className="ml-2 text-xs text-[color:var(--ink-muted)]">CID {p.cid10_code}</span>}
                      <span className={`ml-2 badge ${p.status === 'active' ? 'badge-yellow' : 'badge-green'}`}>{p.status}</span>
                    </div>
                    {p.status === 'active' && (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => run('prob-r', async () => {
                          await api.patch(`/api/clinical/chart/${patientId}/problems/${p.id}`, { status: 'resolved' });
                        })}
                      >
                        {t('chart.resolve')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tab === 'alergias' && (
            <Panel title={t('chart.tabs.alergias')} testId="chart-allergies">
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!allergyForm.substance.trim()) return;
                  run('alg', async () => {
                    await api.post(`/api/clinical/chart/${patientId}/allergies`, allergyForm);
                    setAllergyForm({ substance: '', reaction: '', severity: 'moderate', notes: '' });
                  });
                }}
              >
                <div className="flex flex-wrap gap-2">
                  <Field label={t('chart.fields.substance')}>
                    <input className="input" value={allergyForm.substance} onChange={(e) => setAllergyForm((s) => ({ ...s, substance: e.target.value }))} data-testid="allergy-substance" />
                  </Field>
                  <Field label={t('chart.fields.severity')}>
                    <select className="input" value={allergyForm.severity} onChange={(e) => setAllergyForm((s) => ({ ...s, severity: e.target.value }))}>
                      <option value="mild">{t('chart.severity.mild')}</option>
                      <option value="moderate">{t('chart.severity.moderate')}</option>
                      <option value="severe">{t('chart.severity.severe')}</option>
                      <option value="life_threatening">{t('chart.severity.life_threatening')}</option>
                    </select>
                  </Field>
                </div>
                <Field label={t('chart.fields.reaction')}>
                  <input className="input" value={allergyForm.reaction} onChange={(e) => setAllergyForm((s) => ({ ...s, reaction: e.target.value }))} />
                </Field>
                <button type="submit" className="btn-primary" disabled={busy === 'alg'}>{t('chart.save_allergy')}</button>
              </form>
              <ul className="space-y-2 pt-2">
                {allergies.length === 0 && <Empty>{t('common.no_data')}</Empty>}
                {allergies.map((a) => (
                  <li key={a.id} className="text-sm flex flex-wrap justify-between gap-2 border-b border-[rgba(176,183,192,0.35)] pb-2">
                    <div>
                      <span className="font-medium">{a.substance}</span>
                      <span className={`ml-2 badge ${['severe', 'life_threatening'].includes(a.severity) ? 'badge-red' : 'badge-yellow'}`}>
                        {t(`chart.severity.${a.severity}`)}
                      </span>
                      {a.reaction && <div className="text-[color:var(--ink-muted)]">{a.reaction}</div>}
                    </div>
                    {a.status === 'active' && (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => run('alg-i', async () => {
                          await api.patch(`/api/clinical/chart/${patientId}/allergies/${a.id}`, { status: 'inactive' });
                        })}
                      >
                        {t('chart.deactivate')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tab === 'receitas' && (
            <Panel title={t('chart.tabs.receitas')} testId="chart-rx">
              <p className="text-xs text-[color:var(--ink-muted)]">
                {t('chart.rx_hint')}{' '}
                <Link to="/prescriptions" className="underline text-[color:var(--brass-deep)]">{t('chart.open_prescriptions')}</Link>
              </p>
              <ul className="space-y-3">
                {prescriptions.length === 0 && <Empty>{t('common.no_data')}</Empty>}
                {prescriptions.map((rx) => (
                  <li key={rx.id} className="text-sm border-b border-[rgba(176,183,192,0.35)] pb-2">
                    <div className="flex flex-wrap gap-2 items-center">
                      <span className="text-[11px] text-[color:var(--ink-muted)]">{fmtWhen(rx.created_at, locale)}</span>
                      <span className={`badge ${rx.status === 'active' ? 'badge-green' : 'badge-yellow'}`}>{rx.status}</span>
                    </div>
                    {(rx.items || []).map((it: any, i: number) => (
                      <div key={i}>{it.medication} — {it.dosage} · {it.frequency} · {it.duration}</div>
                    ))}
                    <Stamp label={rx.stamp_label} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tab === 'anexos' && (
            <Panel title={t('chart.tabs.anexos')} testId="chart-attachments">
              <p className="text-xs text-[color:var(--ink-muted)]">{t('chart.attach_hint')}</p>
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!attachForm.title.trim()) return;
                  run('att', async () => {
                    await api.post(`/api/clinical/chart/${patientId}/attachments`, attachForm);
                    setAttachForm({ title: '', doc_type: 'other', notes: '', file_path: '' });
                  });
                }}
              >
                <div className="flex flex-wrap gap-2">
                  <Field label={t('chart.fields.title')}>
                    <input className="input" value={attachForm.title} onChange={(e) => setAttachForm((s) => ({ ...s, title: e.target.value }))} />
                  </Field>
                  <Field label={t('chart.fields.doc_type')}>
                    <select className="input" value={attachForm.doc_type} onChange={(e) => setAttachForm((s) => ({ ...s, doc_type: e.target.value }))}>
                      <option value="lab">{t('chart.doc_types.lab')}</option>
                      <option value="imaging">{t('chart.doc_types.imaging')}</option>
                      <option value="consent">{t('chart.doc_types.consent')}</option>
                      <option value="referral">{t('chart.doc_types.referral')}</option>
                      <option value="other">{t('chart.doc_types.other')}</option>
                    </select>
                  </Field>
                </div>
                <Field label={t('chart.fields.ref')}>
                  <input className="input" value={attachForm.file_path} onChange={(e) => setAttachForm((s) => ({ ...s, file_path: e.target.value }))} placeholder="URL / path / ref" />
                </Field>
                <Field label={t('common.notes')}>
                  <input className="input" value={attachForm.notes} onChange={(e) => setAttachForm((s) => ({ ...s, notes: e.target.value }))} />
                </Field>
                <button type="submit" className="btn-primary" disabled={busy === 'att'}>{t('chart.save_attachment')}</button>
              </form>
              <ul className="space-y-2 pt-2">
                {attachments.length === 0 && <Empty>{t('common.no_data')}</Empty>}
                {attachments.map((a) => (
                  <li key={a.id} className="text-sm flex flex-wrap justify-between gap-2 border-b border-[rgba(176,183,192,0.35)] pb-2">
                    <div>
                      <div className="font-medium">{a.title} <span className="text-xs text-[color:var(--ink-muted)]">({a.doc_type})</span></div>
                      {a.file_path && <div className="text-xs break-all text-[color:var(--ink-muted)]">{a.file_path}</div>}
                      <div className="text-[11px] text-[color:var(--ink-muted)]">{fmtWhen(a.created_at, locale)} · {a.uploaded_by_name}</div>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => run('att-c', async () => {
                        await api.post(`/api/clinical/chart/${patientId}/attachments/${a.id}/cancel`, {});
                      })}
                    >
                      {t('chart.cancel')}
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
    </div>
  );
}
