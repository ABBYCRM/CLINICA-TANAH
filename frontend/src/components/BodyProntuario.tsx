/**
 * Body prontuário — Clínica Tanah desk UI (not BodyPath teal/IBM chrome).
 * Capture · Measurements · Medications · Lifestyle · Scenarios · Reports
 * Nested inside patient workspace shell — use inset panels, not stacked cards.
 */
import { useCallback, useEffect, useState } from 'react';
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
    <div className="min-w-[5rem]">
      <div className="text-[10px] uppercase tracking-[0.06em] text-[color:var(--ink-muted)] font-semibold">{label}</div>
      <div className="font-display text-xl text-[color:var(--ink)] tabular-nums leading-tight mt-0.5">
        {value != null && value !== '' ? value : '—'}
        {value != null && value !== '' && unit ? <span className="text-sm font-body text-[color:var(--ink-muted)] ml-1">{unit}</span> : null}
      </div>
    </div>
  );
}

export default function BodyProntuario({ patientId }: {
  patientId: string;
  patientName?: string;
  birthDate?: string | null;
  gender?: string | null;
}) {
  const { t } = useI18n();
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

  const showSummaryStrip = tab === 'capture' || tab === 'medications' || tab === 'reports';

  return (
    <div className="flex flex-col min-w-0" data-testid="body-prontuario">
      {/* Sub-tabs only — patient identity already lives in the workspace header */}
      <div className="px-3 sm:px-4 pt-3 flex flex-wrap gap-1 border-b border-[rgba(176,183,192,0.4)] bg-gradient-to-b from-[#f7f1e6] to-[#f0e8da]">
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
        <div className="mx-4 mt-3 text-sm text-[#8b3a2a] bg-[#f8e8e2] border border-[#e2b8a8] rounded-lg px-3 py-2">{error}</div>
      )}

      <div className="p-3 sm:p-4 space-y-3">
        {showSummaryStrip && (
          <section className="crm-inset-panel">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="crm-record-panel-title !mb-2">{t('body.clinical_summary')}</h3>
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  <Metric label={t('body.height')} value={summary.height_cm} unit="cm" />
                  <Metric label={t('body.weight')} value={summary.weight_kg} unit="kg" />
                  <Metric label={t('body.waist')} value={summary.waist_cm} unit="cm" />
                  <Metric label={t('body.bmi')} value={summary.bmi} />
                </div>
              </div>
              <p className="text-[11px] text-[#8b3a2a] max-w-xs leading-snug">{t('body.urgent')}</p>
            </div>
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
          <section className="crm-inset-panel space-y-3" data-testid="body-medications">
            <h3 className="crm-record-panel-title">{t('body.tabs.medications')}</h3>
            <p className="text-xs text-[color:var(--ink-muted)]">{t('body.meds_disclaimer')}</p>
            <div className="flex flex-wrap gap-2">
              <input className="input flex-1 min-w-[10rem]" placeholder={t('body.med_name')} value={medName} onChange={(e) => setMedName(e.target.value)} />
              <input className="input w-36" placeholder={t('body.med_dose')} value={medDose} onChange={(e) => setMedDose(e.target.value)} />
              <input className="input w-40" placeholder={t('body.med_class')} value={medClass} onChange={(e) => setMedClass(e.target.value)} />
              <button type="button" className="btn-primary text-sm" disabled={busy === 'med'} onClick={addMed}>{t('common.add')}</button>
            </div>
            <ul className="space-y-1.5">
              {(data?.medications || []).map((m: any) => (
                <li key={m.id} className="crm-timeline-card text-sm flex justify-between gap-2">
                  <span>
                    <strong>{m.name}</strong>
                    {m.dosage ? ` · ${m.dosage}` : ''}
                    {m.class_tag ? ` · ${m.class_tag}` : ''}
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
              {!data?.medications?.length && (
                <li className="text-sm text-[color:var(--ink-muted)]">{t('common.no_data')}</li>
              )}
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
          <section className="crm-inset-panel space-y-2" data-testid="body-reports">
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

        {/* Consents + counts — one strip under content, not a competing column */}
        {(tab === 'capture' || tab === 'medications' || tab === 'reports') && (
          <div className="grid sm:grid-cols-2 gap-3">
            <section className="crm-inset-panel space-y-3" data-testid="body-consents">
              <h3 className="crm-record-panel-title">{t('body.granular_consents')}</h3>
              <ul className="space-y-1.5">
                {CONSENT_KEYS.map((key) => {
                  const c = consents[key] || {};
                  const ok = !!c.granted;
                  return (
                    <li key={key} className="flex items-center justify-between text-sm gap-2 py-0.5">
                      <span className="min-w-0 truncate">{t(`body.consent.${key}`)}</span>
                      <span className={`badge shrink-0 ${ok ? 'badge-green' : 'badge-slate'}`}>{ok ? 'OK' : t('common.no')}</span>
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

            <section className="crm-inset-panel">
              <h3 className="crm-record-panel-title">{t('body.captures_scenarios')}</h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold">{t('body.tabs.medications')}</dt>
                  <dd className="font-display text-lg tabular-nums">{counts.medications || 0}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold">{t('body.tabs.lifestyle')}</dt>
                  <dd className="font-display text-lg tabular-nums">{counts.plans || 0}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold">{t('body.tabs.capture')}</dt>
                  <dd className="font-display text-lg tabular-nums">{counts.captures || 0}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[color:var(--ink-muted)] font-semibold">{t('body.tabs.scenarios')}</dt>
                  <dd className="font-display text-lg tabular-nums">{counts.scenarios || 0}</dd>
                </div>
              </dl>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
