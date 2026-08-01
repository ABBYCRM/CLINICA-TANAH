/**
 * Body prontuário — Clínica Tanah desk UI (not BodyPath teal/IBM chrome).
 * Capture · Measurements · Medications · Lifestyle · Scenarios · Reports
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import CaptureStudio from './CaptureStudio';

type BodyTab = 'capture' | 'measurements' | 'medications' | 'lifestyle' | 'scenarios' | 'reports';

const BODY_TABS: BodyTab[] = ['capture', 'measurements', 'medications', 'lifestyle', 'scenarios', 'reports'];

const CONSENT_KEYS = [
  'clinical_record',
  'image_processing',
  'generative_ai',
  'cross_border_transfer',
  'research',
  'marketing',
] as const;

function useAuthBlob(url: string | null, deps: any[]) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    if (!url) { setSrc(null); return; }
    (async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) throw new Error('img');
        const blob = await res.blob();
        if (cancelled) return;
        revoke = URL.createObjectURL(blob);
        setSrc(revoke);
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return src;
}

function Metric({ label, value, unit }: { label: string; value: string | number | null | undefined; unit?: string }) {
  return (
    <div className="min-w-[5.5rem]">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--ink-muted)] font-semibold">{label}</div>
      <div className="font-display text-xl text-[color:var(--ink)] tabular-nums leading-tight mt-0.5">
        {value != null && value !== '' ? value : '—'}
        {value != null && value !== '' && unit ? <span className="text-sm font-body text-[color:var(--ink-muted)] ml-1">{unit}</span> : null}
      </div>
    </div>
  );
}

export default function BodyProntuario({ patientId, patientName, birthDate, gender }: {
  patientId: string;
  patientName?: string;
  birthDate?: string | null;
  gender?: string | null;
}) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<BodyTab>('capture');
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');
  const [medName, setMedName] = useState('');
  const [medDose, setMedDose] = useState('');
  const [planTitle, setPlanTitle] = useState('');
  const [planWeeks, setPlanWeeks] = useState('12');
  const [scenarioTitle, setScenarioTitle] = useState('');
  const [scenarioGoal, setScenarioGoal] = useState('');
  const [scenarioWeeks, setScenarioWeeks] = useState('12');
  const [activeSession, setActiveSession] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get(`/api/clinical/body/${patientId}`)
      .then((d) => {
        setData(d);
        const cs = d.clinical_summary || {};
        if (cs.height_cm != null) setHeight(String(cs.height_cm));
        if (cs.weight_kg != null) setWeight(String(cs.weight_kg));
        if (cs.waist_cm != null) setWaist(String(cs.waist_cm));
        setActiveSession(d.active_capture_session || null);
      })
      .catch((e) => setError(e?.message || t('errors.generic')))
      .finally(() => setLoading(false));
  }, [patientId, t]);

  useEffect(load, [load]);

  const summary = data?.clinical_summary || {};
  const consents = data?.consents || {};
  const counts = data?.counts || {};

  const dobLabel = useMemo(() => {
    if (!birthDate) return '—';
    const d = new Date(birthDate.length === 10 ? `${birthDate}T12:00:00` : birthDate);
    if (Number.isNaN(d.getTime())) return birthDate;
    return d.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
  }, [birthDate, locale]);

  const genderLabel = gender === 'F' || gender === 'female'
    ? t('patients.gender_options.F')
    : gender === 'M' || gender === 'male'
      ? t('patients.gender_options.M')
      : gender || '—';

  const saveMeasurement = async () => {
    setBusy('meas');
    setError('');
    try {
      await api.post(`/api/clinical/body/${patientId}/measurements`, {
        height_cm: height ? Number(height) : null,
        weight_kg: weight ? Number(weight) : null,
        waist_cm: waist ? Number(waist) : null,
      });
      load();
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  const grantConsents = async (purposes: string[]) => {
    setBusy('consent');
    try {
      await api.post(`/api/clinical/body/${patientId}/consents`, { purposes });
      load();
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  const revokeOptional = async () => {
    setBusy('revoke');
    try {
      await api.post(`/api/clinical/body/${patientId}/consents/revoke`, {
        purposes: ['generative_ai', 'cross_border_transfer', 'research', 'marketing', 'image_processing'],
      });
      load();
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  const addMed = async () => {
    if (!medName.trim()) return;
    setBusy('med');
    try {
      await api.post(`/api/clinical/body/${patientId}/medications`, {
        name: medName.trim(),
        dosage: medDose.trim() || null,
      });
      setMedName('');
      setMedDose('');
      load();
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  const addPlan = async () => {
    if (!planTitle.trim()) return;
    setBusy('plan');
    try {
      await api.post(`/api/clinical/body/${patientId}/plans`, {
        title: planTitle.trim(),
        weeks: planWeeks ? Number(planWeeks) : 12,
      });
      setPlanTitle('');
      load();
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  const createScenario = async () => {
    setBusy('scenario');
    setError('');
    try {
      const frontId = activeSession?.assets?.front?.id
        || data?.active_capture_session?.assets?.front?.id
        || null;
      await api.post(`/api/clinical/body/${patientId}/scenarios`, {
        title: scenarioTitle.trim() || t('body.scenario_default_title'),
        goal: scenarioGoal.trim() || t('body.scenario_default_goal'),
        weeks: Number(scenarioWeeks) || 12,
        capture_id: frontId,
        generate: true,
      });
      setScenarioTitle('');
      load();
    } catch (e: any) {
      setError(e?.body?.message || e?.message || t('body.simulations_blocked'));
    } finally {
      setBusy('');
    }
  };

  if (loading && !data) {
    return <div className="p-4 text-sm text-[color:var(--ink-muted)]">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-4" data-testid="body-prontuario">
      {/* Header — brand-aligned, not BodyPath teal */}
      <div className="px-4 pt-4 pb-2 border-b border-[rgba(176,183,192,0.45)]" style={{ background: 'linear-gradient(180deg,#f7f1e6,#efe6d8)' }}>
        <div className="font-display text-2xl text-[color:var(--ink)] leading-tight">{patientName || '—'}</div>
        <div className="text-sm text-[color:var(--ink-muted)] mt-1">
          {t('body.dob')} {dobLabel} · {genderLabel}
        </div>
        <p className="text-xs text-[color:var(--ink-muted)] mt-2 leading-relaxed max-w-2xl">
          {t('body.purpose')}
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="px-2 flex flex-wrap gap-1 border-b border-[rgba(176,183,192,0.35)]">
        {BODY_TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={`crm-feed-tab ${tab === id ? 'is-active' : ''}`}
            data-testid={`body-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {t(`body.tabs.${id}`)}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-4 text-sm text-[#8b3a2a] bg-[#f8e8e2] border border-[#e2b8a8] rounded-lg px-3 py-2">{error}</div>
      )}

      <div className="px-4 pb-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          {/* Clinical summary always visible */}
          <section className="crm-record-panel !shadow-none border border-[rgba(176,183,192,0.4)]">
            <h3 className="crm-record-panel-title">{t('body.clinical_summary')}</h3>
            <div className="flex flex-wrap gap-5 mt-2">
              <Metric label={t('body.height')} value={summary.height_cm} unit="cm" />
              <Metric label={t('body.weight')} value={summary.weight_kg} unit="kg" />
              <Metric label={t('body.waist')} value={summary.waist_cm} unit="cm" />
              <Metric label={t('body.bmi')} value={summary.bmi} />
            </div>
            <p className="text-[11px] text-[color:var(--ink-muted)] mt-3">{t('body.bmi_note')}</p>
            <p className="text-[11px] text-[#8b3a2a] mt-2">{t('body.urgent')}</p>
          </section>

          {tab === 'measurements' && (
            <section className="crm-record-panel space-y-3" data-testid="body-measurements">
              <h3 className="crm-record-panel-title">{t('body.tabs.measurements')}</h3>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-[color:var(--ink-muted)]">{t('body.height')}
                  <input className="input mt-1" type="number" step="0.1" value={height} onChange={(e) => setHeight(e.target.value)} />
                </label>
                <label className="text-xs text-[color:var(--ink-muted)]">{t('body.weight')}
                  <input className="input mt-1" type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
                </label>
                <label className="text-xs text-[color:var(--ink-muted)]">{t('body.waist')}
                  <input className="input mt-1" type="number" step="0.1" value={waist} onChange={(e) => setWaist(e.target.value)} />
                </label>
              </div>
              <button type="button" className="btn-primary text-sm" disabled={busy === 'meas'} onClick={saveMeasurement}>
                {busy === 'meas' ? '…' : t('common.save')}
              </button>
              <ul className="space-y-1.5 pt-2">
                {(data?.measurements || []).slice(0, 8).map((m: any) => (
                  <li key={m.id} className="crm-timeline-card text-sm flex flex-wrap gap-3">
                    <span>{m.height_cm ?? '—'} cm</span>
                    <span>{m.weight_kg ?? '—'} kg</span>
                    <span>{m.waist_cm ?? '—'} cm</span>
                    <span className="text-[color:var(--ink-muted)] text-xs ml-auto">{m.recorded_at?.slice(0, 16)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === 'medications' && (
            <section className="crm-record-panel space-y-3" data-testid="body-medications">
              <h3 className="crm-record-panel-title">{t('body.tabs.medications')}</h3>
              <p className="text-xs text-[color:var(--ink-muted)]">{t('body.meds_disclaimer')}</p>
              <div className="flex flex-wrap gap-2">
                <input className="input flex-1 min-w-[10rem]" placeholder={t('body.med_name')} value={medName} onChange={(e) => setMedName(e.target.value)} />
                <input className="input w-36" placeholder={t('body.med_dose')} value={medDose} onChange={(e) => setMedDose(e.target.value)} />
                <button type="button" className="btn-primary text-sm" disabled={busy === 'med'} onClick={addMed}>{t('common.add')}</button>
              </div>
              <p className="text-xs text-[color:var(--ink-muted)]">{counts.medications || 0} {t('body.records')}</p>
              <ul className="space-y-1.5">
                {(data?.medications || []).map((m: any) => (
                  <li key={m.id} className="crm-timeline-card text-sm flex justify-between gap-2">
                    <span><strong>{m.name}</strong>{m.dosage ? ` · ${m.dosage}` : ''}{m.frequency ? ` · ${m.frequency}` : ''}</span>
                    <button
                      type="button"
                      className="text-xs text-[#8b3a2a]"
                      onClick={async () => {
                        await api.del(`/api/clinical/body/${patientId}/medications/${m.id}`);
                        load();
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === 'lifestyle' && (
            <section className="crm-record-panel space-y-3" data-testid="body-lifestyle">
              <h3 className="crm-record-panel-title">{t('body.tabs.lifestyle')}</h3>
              <div className="flex flex-wrap gap-2">
                <input className="input flex-1 min-w-[10rem]" placeholder={t('body.plan_title')} value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} />
                <input className="input w-24" type="number" value={planWeeks} onChange={(e) => setPlanWeeks(e.target.value)} />
                <button type="button" className="btn-primary text-sm" disabled={busy === 'plan'} onClick={addPlan}>{t('common.add')}</button>
              </div>
              <p className="text-xs text-[color:var(--ink-muted)]">{counts.plans || 0} {t('body.plans_count')}</p>
              <ul className="space-y-1.5">
                {(data?.plans || []).map((p: any) => (
                  <li key={p.id} className="crm-timeline-card text-sm">
                    <div className="font-medium">{p.title}</div>
                    <div className="text-xs text-[color:var(--ink-muted)]">{p.weeks ? `${p.weeks} ${t('body.weeks')}` : ''} · {p.status}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === 'capture' && (
            <CaptureStudio
              patientId={patientId}
              initialSession={activeSession}
              onSessionChange={(s) => {
                setActiveSession(s);
                load();
              }}
              onGoScenarios={() => setTab('scenarios')}
            />
          )}

          {tab === 'scenarios' && (
            <section className="crm-record-panel space-y-3" data-testid="body-scenarios">
              <h3 className="crm-record-panel-title">{t('body.tabs.scenarios')}</h3>
              {!data?.simulations_allowed && (
                <p className="text-sm text-[#8b3a2a] bg-[#f8e8e2] rounded-lg px-3 py-2">{t('body.simulations_blocked')}</p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="input" placeholder={t('body.scenario_title')} value={scenarioTitle} onChange={(e) => setScenarioTitle(e.target.value)} />
                <input className="input" placeholder={t('body.scenario_goal')} value={scenarioGoal} onChange={(e) => setScenarioGoal(e.target.value)} />
                <input className="input" type="number" value={scenarioWeeks} onChange={(e) => setScenarioWeeks(e.target.value)} />
                <button type="button" className="btn-primary text-sm" disabled={busy === 'scenario' || !data?.simulations_allowed} onClick={createScenario}>
                  {busy === 'scenario' ? t('body.generating') : t('body.generate_scenario')}
                </button>
              </div>
              <p className="text-[11px] text-[color:var(--ink-muted)]">{t('body.scenario_notice')}</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {(data?.scenarios || []).map((s: any) => (
                  <ScenarioCard key={s.id} patientId={patientId} scenario={s} onRefresh={load} />
                ))}
              </div>
            </section>
          )}

          {tab === 'reports' && (
            <section className="crm-record-panel space-y-3" data-testid="body-reports">
              <h3 className="crm-record-panel-title">{t('body.tabs.reports')}</h3>
              <p className="text-sm text-[color:var(--ink-muted)]">
                {t('body.captures_scenarios')}: {counts.captures || 0} · {counts.scenarios || 0}
              </p>
              <p className="text-sm text-[color:var(--ink-muted)]">
                {t('body.tabs.medications')}: {counts.medications || 0} · {t('body.tabs.lifestyle')}: {counts.plans || 0}
              </p>
              {summary.bmi != null && (
                <p className="text-sm">{t('body.bmi')}: <strong className="tabular-nums">{summary.bmi}</strong></p>
              )}
            </section>
          )}
        </div>

        {/* Right rail — consents + counts */}
        <aside className="space-y-4">
          <section className="crm-record-panel space-y-3" data-testid="body-consents">
            <h3 className="crm-record-panel-title">{t('body.granular_consents')}</h3>
            <ul className="space-y-2">
              {CONSENT_KEYS.map((key) => {
                const c = consents[key] || {};
                const ok = !!c.granted;
                return (
                  <li key={key} className="flex items-center justify-between text-sm gap-2">
                    <span>
                      {t(`body.consent.${key}`)}
                      {key === 'marketing' && (
                        <span className="block text-[10px] text-[color:var(--ink-muted)]">{t('body.marketing_off')}</span>
                      )}
                    </span>
                    <span className={`badge ${ok ? 'badge-green' : 'badge-slate'}`}>{ok ? 'OK' : t('common.no')}</span>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={busy === 'consent'}
                onClick={() => grantConsents(['clinical_record', 'image_processing', 'generative_ai'])}
              >
                {t('body.register_consents')}
              </button>
              <button type="button" className="btn-secondary text-xs" disabled={busy === 'revoke'} onClick={revokeOptional}>
                {t('body.revoke_optional')}
              </button>
            </div>
            {!data?.simulations_allowed && (
              <p className="text-[11px] text-[color:var(--ink-muted)] leading-relaxed">{t('body.simulations_blocked')}</p>
            )}
          </section>

          <section className="crm-record-panel space-y-2">
            <h3 className="crm-record-panel-title">{t('body.tabs.medications')}</h3>
            <p className="text-sm tabular-nums">{counts.medications || 0} {t('body.records')}</p>
            <h3 className="crm-record-panel-title !mt-3">{t('body.tabs.lifestyle')}</h3>
            <p className="text-sm tabular-nums">{counts.plans || 0} {t('body.plans_count')}</p>
            <h3 className="crm-record-panel-title !mt-3">{t('body.captures_scenarios')}</h3>
            <p className="text-sm tabular-nums">
              {t('body.tabs.capture')}: {counts.captures || 0} · {t('body.tabs.scenarios')}: {counts.scenarios || 0}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ScenarioCard({ patientId, scenario, onRefresh }: { patientId: string; scenario: any; onRefresh: () => void }) {
  const { t } = useI18n();
  const src = useAuthBlob(
    scenario.has_image || scenario.image_url
      ? `/api/clinical/body/${patientId}/scenarios/${scenario.id}/image`
      : null,
    [patientId, scenario.id, scenario.has_image, scenario.status, scenario.updated_at],
  );

  useEffect(() => {
    if (scenario.status !== 'pending' && scenario.status !== 'generating') return;
    const tmr = setInterval(onRefresh, 5000);
    return () => clearInterval(tmr);
  }, [scenario.status, onRefresh]);

  return (
    <div className="crm-timeline-card overflow-hidden p-0" data-testid={`body-scenario-${scenario.id}`}>
      {src ? (
        <img src={src} alt="" className="w-full aspect-[3/4] object-cover" />
      ) : (
        <div className="aspect-[3/4] bg-[#efe6d8] flex items-center justify-center text-xs text-[color:var(--ink-muted)] px-3 text-center">
          {scenario.status === 'failed' ? (scenario.error || t('body.failed')) : t('body.generating')}
        </div>
      )}
      <div className="px-2 py-2 space-y-0.5">
        <div className="text-sm font-medium truncate">{scenario.title}</div>
        <div className="text-[11px] text-[color:var(--ink-muted)]">
          {scenario.status}{scenario.provider ? ` · ${scenario.provider}` : ''}{scenario.weeks ? ` · ${scenario.weeks}w` : ''}
        </div>
      </div>
    </div>
  );
}
