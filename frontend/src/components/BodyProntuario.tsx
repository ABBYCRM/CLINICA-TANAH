/**
 * Body prontuário — Clínica Tanah desk UI (not BodyPath teal/IBM chrome).
 * Capture · Measurements · Medications · Lifestyle · Scenarios · Reports
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import CaptureStudio from './CaptureStudio';
import MeasurementsPanel from './MeasurementsPanel';
import LifestylePanel from './LifestylePanel';
import ScenarioSimulator from './ScenarioSimulator';

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

  const [medName, setMedName] = useState('');
  const [medDose, setMedDose] = useState('');
  const [medClass, setMedClass] = useState('');
  const [activeSession, setActiveSession] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get(`/api/clinical/body/${patientId}`)
      .then((d) => {
        setData(d);
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
        class_tag: medClass.trim() || null,
        confirmation: 'clinician_confirmed',
      });
      setMedName('');
      setMedDose('');
      setMedClass('');
      load();
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
    } finally {
      setBusy('');
    }
  };

  if (loading && !data) {
    return <div className="p-4 text-sm text-[color:var(--ink-muted)]">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-4" data-testid="body-prontuario">
      <div className="px-4 pt-4 pb-2 border-b border-[rgba(176,183,192,0.45)]" style={{ background: 'linear-gradient(180deg,#f7f1e6,#efe6d8)' }}>
        <div className="font-display text-2xl text-[color:var(--ink)] leading-tight">{patientName || '—'}</div>
        <div className="text-sm text-[color:var(--ink-muted)] mt-1">
          {t('body.dob')} {dobLabel} · {genderLabel}
        </div>
        <p className="text-xs text-[color:var(--ink-muted)] mt-2 leading-relaxed max-w-2xl">
          {t('body.purpose')}
        </p>
      </div>

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

      <div className={`px-4 pb-4 grid gap-4 ${tab === 'scenarios' || tab === 'measurements' ? '' : 'lg:grid-cols-[1.2fr_0.8fr]'}`}>
        <div className="space-y-4">
          {tab !== 'scenarios' && tab !== 'measurements' && tab !== 'lifestyle' && (
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
          )}

          {tab === 'measurements' && (
            <MeasurementsPanel
              patientId={patientId}
              latest={data?.latest_measurement || null}
              onSaved={load}
            />
          )}

          {tab === 'medications' && (
            <section className="crm-record-panel space-y-3" data-testid="body-medications">
              <h3 className="crm-record-panel-title">{t('body.tabs.medications')}</h3>
              <p className="text-xs text-[color:var(--ink-muted)]">{t('body.meds_disclaimer')}</p>
              <div className="flex flex-wrap gap-2">
                <input className="input flex-1 min-w-[10rem]" placeholder={t('body.med_name')} value={medName} onChange={(e) => setMedName(e.target.value)} />
                <input className="input w-36" placeholder={t('body.med_dose')} value={medDose} onChange={(e) => setMedDose(e.target.value)} />
                <input className="input w-40" placeholder={t('body.med_class')} value={medClass} onChange={(e) => setMedClass(e.target.value)} />
                <button type="button" className="btn-primary text-sm" disabled={busy === 'med'} onClick={addMed}>{t('common.add')}</button>
              </div>
              <p className="text-xs text-[color:var(--ink-muted)]">{counts.medications || 0} {t('body.records')}</p>
              <ul className="space-y-1.5">
                {(data?.medications || []).map((m: any) => (
                  <li key={m.id} className="crm-timeline-card text-sm flex justify-between gap-2">
                    <span>
                      <strong>{m.name}</strong>
                      {m.dosage ? ` · ${m.dosage}` : ''}
                      {m.class_tag ? ` · ${m.class_tag}` : ''}
                      {m.confirmation ? (
                        <span className="block text-[11px] text-[color:var(--ink-muted)]">{m.confirmation}</span>
                      ) : null}
                    </span>
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
            <LifestylePanel patientId={patientId} plans={data?.plans || []} onSaved={load} />
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

          {tab === 'scenarios' && data && (
            <ScenarioSimulator
              patientId={patientId}
              data={data}
              onRefresh={load}
              onNavigate={(id) => setTab(id as BodyTab)}
            />
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
              {summary.whr != null && (
                <p className="text-sm">RCQ: <strong className="tabular-nums">{summary.whr}</strong></p>
              )}
              {summary.whtr != null && (
                <p className="text-sm">RCE: <strong className="tabular-nums">{summary.whtr}</strong></p>
              )}
            </section>
          )}
        </div>

        {tab !== 'scenarios' && tab !== 'measurements' && tab !== 'lifestyle' && (
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
        )}
      </div>
    </div>
  );
}
