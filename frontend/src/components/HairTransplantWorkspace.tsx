/**
 * TANAH-HAIR workspace — full clinic vertical slice inside patient detail.
 * Ported from TANAH-HAIR clinic-pwa (simulator, hairline lab, procedure board)
 * + patient journey guidance. Uses CRM api client + design tokens.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

type Props = {
  patientId: string;
  patientName?: string;
};

type SimParams = {
  hairline: string;
  zone: string;
  density: number;
  length: string;
  color: string;
  curl: string;
  fullness: string;
  technique: string;
  sessions: string;
  graftScenario: string;
  view: string;
};

const DEFAULT_PARAMS: SimParams = {
  hairline: 'balanced',
  zone: 'full',
  density: 0.65,
  length: 'short',
  color: 'darkBrown',
  curl: 'straight',
  fullness: 'moderate',
  technique: 'fue',
  sessions: 'single',
  graftScenario: 'moderate',
  view: 'front',
};

type Panel = 'simulator' | 'hairline' | 'procedure' | 'journey' | 'history';

export default function HairTransplantWorkspace({ patientId, patientName }: Props) {
  const { t } = useI18n();
  const [panel, setPanel] = useState<Panel>('simulator');
  const [params, setParams] = useState<SimParams>(DEFAULT_PARAMS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [variants, setVariants] = useState<any[]>([]);
  const [multi, setMulti] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [gemini, setGemini] = useState<any>(null);
  const [graftTotal, setGraftTotal] = useState(2148);
  const [tally, setTally] = useState({
    session_label: 'Session 1',
    extracted: 2148,
    implanted: 2100,
    discarded: 28,
    damaged: 12,
    remaining: 8,
    notes: '',
  });
  const [history, setHistory] = useState<any[]>([]);

  const [beforeBlobUrl, setBeforeBlobUrl] = useState<string | null>(null);

  const baseImageUrl = beforeBlobUrl;

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/clinical/hair/base-image', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`base_image_${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoked = url;
        setBeforeBlobUrl(url);
      } catch {
        if (!cancelled) setBeforeBlobUrl(null);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [patientId]);

  const loadOverview = useCallback(async () => {
    try {
      const ov = await api.get(`/api/clinical/hair/${patientId}/overview`);
      setOverview(ov);
      setGemini(ov.gemini);
      setHistory(ov.simulations || []);
      if (ov.procedure_tally) {
        setTally({
          session_label: ov.procedure_tally.session_label || 'Session 1',
          extracted: ov.procedure_tally.extracted ?? 0,
          implanted: ov.procedure_tally.implanted ?? 0,
          discarded: ov.procedure_tally.discarded ?? 0,
          damaged: ov.procedure_tally.damaged ?? 0,
          remaining: ov.procedure_tally.remaining ?? 0,
          notes: ov.procedure_tally.notes || '',
        });
        setGraftTotal(ov.procedure_tally.extracted ?? 0);
      }
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    }
  }, [patientId, t]);

  useEffect(() => {
    setAfterUrl(null);
    setVariants([]);
    setMulti([]);
    setSummary('');
    setError('');
    setMsg('');
    loadOverview();
  }, [patientId, loadOverview]);

  const setP = (k: keyof SimParams, v: string | number) =>
    setParams((p) => ({ ...p, [k]: v }));

  const run = async (path: string, then: (body: any) => void) => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const body = await api.post(`/api/clinical/hair/${patientId}/simulator/${path}`, params);
      then(body);
      await loadOverview();
    } catch (e: any) {
      const detail = e instanceof ApiError
        ? (e.body?.missing ? `${e.message} (missing: ${e.body.missing})` : e.message)
        : (e.message || t('errors.generic'));
      setError(detail);
    } finally {
      setBusy(false);
    }
  };

  const saveTally = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.put(`/api/clinical/hair/${patientId}/procedure/tally`, {
        ...tally,
        extracted: graftTotal,
      });
      setMsg(res.reconciled
        ? t('patients.workspace.hair_tally_ok')
        : t('patients.workspace.hair_tally_mismatch'));
      await loadOverview();
    } catch (e: any) {
      setError(e.message || t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const panels: { id: Panel; label: string }[] = [
    { id: 'simulator', label: t('patients.workspace.hair_panel_simulator') },
    { id: 'hairline', label: t('patients.workspace.hair_panel_lab') },
    { id: 'procedure', label: t('patients.workspace.hair_panel_procedure') },
    { id: 'journey', label: t('patients.workspace.hair_panel_journey') },
    { id: 'history', label: t('patients.workspace.hair_panel_history') },
  ];

  return (
    <div className="px-4 py-4 space-y-4" data-testid="workspace-hair-transplant">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm text-[var(--ink)]">
            {t('patients.workspace.hair_transplant_heading')}
          </h3>
          <p className="text-xs text-[var(--ink-muted)] mt-1 max-w-2xl">
            {t('patients.workspace.hair_transplant_hint')}
          </p>
          {patientName ? (
            <p className="text-[11px] font-mono text-[var(--ink-muted)] mt-1">{patientName}</p>
          ) : null}
        </div>
        <div className="text-[11px] text-[var(--ink-muted)] space-y-0.5 text-right">
          <p data-testid="hair-gemini-status">
            Gemini: {gemini?.configured
              ? (gemini.enabled ? `ON · ${gemini.model}` : 'OFF')
              : `NOT CONFIGURED (${gemini?.missing || 'GEMINI_API_KEY'})`}
          </p>
          <p className="font-medium text-[var(--ink)]">{t('patients.workspace.hair_boundary')}</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--edge-soft)] pb-1" data-testid="hair-subtabs">
        {panels.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-t ${
              panel === p.id
                ? 'bg-[var(--paper)] text-[var(--ink)] font-semibold border border-b-0 border-[var(--edge-soft)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
            }`}
            onClick={() => setPanel(p.id)}
            data-testid={`hair-panel-${p.id}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error ? <p className="text-xs text-red-700" data-testid="hair-error">{error}</p> : null}
      {msg ? <p className="text-xs text-emerald-800" data-testid="hair-msg">{msg}</p> : null}

      {panel === 'simulator' && (
        <div className="space-y-4" data-testid="hair-simulator">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)] font-semibold">Before</p>
              <div className="rounded-lg border border-[var(--edge-soft)] bg-[var(--paper-mid)]/30 overflow-hidden aspect-[347/280]">
                {baseImageUrl ? (
                  <img src={baseImageUrl} alt="" className="w-full h-full object-cover" data-testid="hair-before-img" />
                ) : (
                  <p className="text-xs text-[var(--ink-muted)] p-4">{t('patients.workspace.hair_demo_photo')}</p>
                )}
              </div>
              <p className="text-[11px] text-[var(--ink-muted)]">{t('patients.workspace.hair_demo_photo')}</p>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)] font-semibold">After · Hypothetical</p>
                <span className="text-[11px] text-[var(--ink-muted)]" data-testid="hair-sim-summary">{summary || '—'}</span>
              </div>
              <div className="rounded-lg border border-[var(--edge-soft)] bg-[var(--paper-mid)]/30 overflow-hidden min-h-[12rem] flex items-center justify-center">
                {afterUrl ? (
                  <img src={afterUrl} alt="" className="w-full h-auto" data-testid="hair-after-img" />
                ) : (
                  <p className="text-xs text-[var(--ink-muted)] px-4 text-center">{t('patients.workspace.hair_awaiting_render')}</p>
                )}
              </div>
            </section>

            <section className="space-y-3" data-testid="hair-params">
              <p className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)] font-semibold">Parameters</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="space-y-1">
                  <span className="text-[var(--ink-muted)]">Hairline</span>
                  <select className="input text-xs" value={params.hairline} onChange={(e) => setP('hairline', e.target.value)}>
                    <option value="conservative">Mature conservative</option>
                    <option value="balanced">Balanced natural</option>
                    <option value="restorative">Restorative youthful</option>
                    <option value="feminine">Feminine rounded</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[var(--ink-muted)]">Zone</span>
                  <select className="input text-xs" value={params.zone} onChange={(e) => setP('zone', e.target.value)}>
                    <option value="frontal">Frontal</option>
                    <option value="midscalp">Frontal + midscalp</option>
                    <option value="crown">Frontal + crown</option>
                    <option value="full">Full scalp</option>
                    <option value="temples">Temples + frontal</option>
                  </select>
                </label>
                <label className="space-y-1 col-span-2">
                  <span className="text-[var(--ink-muted)]">Density {params.density.toFixed(2)}</span>
                  <input type="range" min={0} max={1} step={0.05} value={params.density}
                    onChange={(e) => setP('density', Number(e.target.value))} className="w-full" data-testid="hair-density" />
                </label>
                <label className="space-y-1">
                  <span className="text-[var(--ink-muted)]">Length</span>
                  <select className="input text-xs" value={params.length} onChange={(e) => setP('length', e.target.value)}>
                    <option value="buzz">Buzz</option>
                    <option value="short">Short</option>
                    <option value="medium">Medium</option>
                    <option value="long">Long</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[var(--ink-muted)]">Color</span>
                  <select className="input text-xs" value={params.color} onChange={(e) => setP('color', e.target.value)}>
                    <option value="black">Black</option>
                    <option value="darkBrown">Dark brown</option>
                    <option value="mediumBrown">Medium brown</option>
                    <option value="lightBrown">Light brown</option>
                    <option value="blonde">Blonde</option>
                    <option value="saltPepper">Salt & pepper</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[var(--ink-muted)]">Curl</span>
                  <select className="input text-xs" value={params.curl} onChange={(e) => setP('curl', e.target.value)}>
                    <option value="straight">Straight</option>
                    <option value="slight">Slight wave</option>
                    <option value="wavy">Wavy</option>
                    <option value="curly">Curly</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[var(--ink-muted)]">Fullness</span>
                  <select className="input text-xs" value={params.fullness} onChange={(e) => setP('fullness', e.target.value)}>
                    <option value="conservative">Conservative</option>
                    <option value="moderate">Moderate</option>
                    <option value="fuller">Fuller</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[var(--ink-muted)]">Technique</span>
                  <select className="input text-xs" value={params.technique} onChange={(e) => setP('technique', e.target.value)}>
                    <option value="fue">FUE</option>
                    <option value="fut">FUT</option>
                    <option value="dhi">DHI</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[var(--ink-muted)]">Sessions</span>
                  <select className="input text-xs" value={params.sessions} onChange={(e) => setP('sessions', e.target.value)}>
                    <option value="single">Single</option>
                    <option value="multi">Multi</option>
                  </select>
                </label>
                <label className="space-y-1 col-span-2">
                  <span className="text-[var(--ink-muted)]">Graft scenario</span>
                  <select className="input text-xs" value={params.graftScenario} onChange={(e) => setP('graftScenario', e.target.value)}>
                    <option value="light">Light (1,200–1,800)</option>
                    <option value="moderate">Moderate (1,800–2,500)</option>
                    <option value="restorative">Restorative (2,500–3,400)</option>
                    <option value="extensive">Extensive (3,400–5,000+)</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary text-xs" disabled={busy} data-testid="hair-ai-generate"
                  onClick={() => run('ai-generate', (b) => {
                    setAfterUrl(b.outputDataUrl);
                    setSummary(`${b.model || 'Gemini'} · AI`);
                  })}>
                  AI Generate (Gemini)
                </button>
                <button type="button" className="btn-secondary text-xs" disabled={busy} data-testid="hair-render"
                  onClick={() => run('apply', (b) => {
                    setAfterUrl(b.outputDataUrl);
                    setSummary(`${b.grafts || '—'} grafts · ${b.hairlineLabel || params.hairline}`);
                  })}>
                  Render (parametric)
                </button>
                <button type="button" className="btn-secondary text-xs" disabled={busy} data-testid="hair-variants"
                  onClick={() => run('photo-variants', (b) => setVariants(b.variants || []))}>
                  3 alternatives
                </button>
                <button type="button" className="btn-secondary text-xs" disabled={busy} data-testid="hair-multi"
                  onClick={() => run('multi-view', (b) => setMulti(b.renders || []))}>
                  Multi-view
                </button>
                <button type="button" className="btn-secondary text-xs" disabled={busy} data-testid="hair-ai-multi"
                  onClick={() => run('ai-multi-view', (b) => setMulti(b.views || []))}>
                  AI 4-view
                </button>
              </div>
            </section>
          </div>

          {variants.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="hair-variants-grid">
              {variants.map((v, i) => (
                <button key={v.id || i} type="button" className="border border-[var(--edge-soft)] rounded-lg overflow-hidden text-left"
                  onClick={() => { setAfterUrl(v.outputDataUrl); setSummary(v.hairlineLabel || v.hairline || ''); }}>
                  <img src={v.outputDataUrl} alt="" className="w-full" />
                </button>
              ))}
            </div>
          )}

          {multi.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="hair-multi-grid">
              {multi.map((v, i) => (
                <div key={v.view || i} className="border border-[var(--edge-soft)] rounded-lg overflow-hidden">
                  {v.outputDataUrl ? (
                    <img src={v.outputDataUrl} alt={v.view || ''} className="w-full" />
                  ) : (
                    <p className="text-[11px] text-red-700 p-2">{v.error || 'failed'}</p>
                  )}
                  <p className="text-[11px] px-2 py-1 text-[var(--ink-muted)]">{v.view || v.label}</p>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" data-testid="hair-view-slots">
            {(overview?.views || [
              { id: 'front', label: 'Frontal', available: true },
              { id: 'left', label: 'Left', available: false },
              { id: 'right', label: 'Right', available: false },
              { id: 'top', label: 'Top', available: false },
              { id: 'crown', label: 'Crown', available: false },
              { id: 'back', label: 'Back', available: false },
            ]).map((v: any) => (
              <div key={v.id} className={`rounded-lg border px-2 py-3 text-center text-[11px] ${
                v.available ? 'border-[var(--ink)]/30 bg-[var(--paper)]' : 'border-dashed border-[var(--edge-soft)] text-[var(--ink-muted)]'
              }`}>
                <p className="font-semibold uppercase">{v.label || v.id}</p>
                <p>{v.available ? 'Attached' : 'Not attached'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {panel === 'hairline' && (
        <div className="space-y-3" data-testid="hair-lab">
          <p className="text-xs text-[var(--ink-muted)]">{t('patients.workspace.hair_lab_hint')}</p>
          <div className="rounded-lg border border-[var(--edge-soft)] bg-[var(--paper-mid)]/20 p-3 max-w-xl">
            <svg viewBox="0 0 500 400" className="w-full h-auto" aria-label="Hairline planning vector canvas">
              <ellipse cx="250" cy="200" rx="140" ry="170" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.45" />
              <line x1="250" y1="60" x2="250" y2="340" stroke="currentColor" strokeWidth="0.6" strokeDasharray="2 4" opacity="0.5" />
              <text x="254" y="68" fontSize="9" fill="currentColor" opacity="0.7">midline</text>
              <line x1="250" y1="120" x2="250" y2="180" stroke="#BE123C" strokeWidth="1.4" />
              <text x="256" y="135" fontSize="9" fill="#BE123C">central 72 mm</text>
              <path d="M 110 200 Q 160 150 220 130 Q 250 122 280 130 Q 340 150 390 200" fill="none" stroke="#BE123C" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M 130 210 Q 145 195 160 205 Q 175 192 190 207 Q 205 195 220 200 Q 235 188 250 195 Q 265 188 280 200 Q 295 195 310 207 Q 325 192 340 205 Q 355 195 370 210" fill="none" stroke="#BE123C" strokeWidth="1" opacity="0.7" />
              <circle cx="115" cy="205" r="4" fill="none" stroke="#0284C7" strokeWidth="1.4" />
              <circle cx="385" cy="205" r="4" fill="none" stroke="#0284C7" strokeWidth="1.4" />
              <text x="100" y="225" fontSize="9" fill="#0284C7">L peak</text>
              <text x="388" y="225" fontSize="9" fill="#0284C7">R peak</text>
              <path d="M 115 205 L 220 130" stroke="#0D9488" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.8" />
              <text x="130" y="160" fontSize="9" fill="#0D9488" transform="rotate(-32 130 160)">frontotemporal ∠ 78°</text>
            </svg>
            <p className="text-xs font-mono mt-2">72 mm · 78°</p>
          </div>
          <ul className="text-xs text-[var(--ink-muted)] space-y-1 list-disc pl-4">
            <li>Macro hairline (proposed) in red; micro irregularity preserved.</li>
            <li>Temporal peaks marked; frontotemporal angle annotated.</li>
            <li>Planning vectors only — not a surgical guarantee.</li>
          </ul>
        </div>
      )}

      {panel === 'procedure' && (
        <div className="space-y-4" data-testid="hair-procedure">
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {[
              ['Preparation', 'Consent, photos, donor/recipient marking.'],
              ['Harvesting', 'Device, punch, donor zones and extraction count.'],
              ['Graft preparation', '1/2/3/4+ hair units, solution, temperature and time.'],
              ['Implantation', 'Recipient-zone count, direction and angle notes.'],
              ['Closure', 'Reconciliation, adverse events and discharge.'],
            ].map(([title, desc], i) => (
              <article key={title} className="rounded-lg border border-[var(--edge-soft)] p-3 text-xs space-y-1">
                <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-[var(--paper-mid)] font-mono text-[10px]">{i + 1}</span>
                <h4 className="font-semibold text-[var(--ink)]">{title}</h4>
                <p className="text-[var(--ink-muted)]">{desc}</p>
              </article>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section className="rounded-lg border border-[var(--edge-soft)] p-4 space-y-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)] font-semibold">Graft counter</p>
              <p className="font-display text-3xl font-semibold tabular-nums" data-testid="hair-graft-total">{graftTotal}</p>
              <div className="flex flex-wrap gap-1">
                {[1, 10, 50, 100].map((n) => (
                  <button key={n} type="button" className="btn-secondary text-[11px]" onClick={() => setGraftTotal((g) => g + n)}>+{n}</button>
                ))}
                <button type="button" className="btn-secondary text-[11px]" onClick={() => setGraftTotal(0)}>Reset</button>
              </div>
              <p className="text-[11px] text-[var(--ink-muted)]">Every save logs previous/new values via CRM audit.</p>
            </section>

            <section className="rounded-lg border border-[var(--edge-soft)] p-4 space-y-2 text-xs">
              <p className="font-semibold">Required accounting invariant</p>
              <code className="block text-[11px] bg-[var(--paper-mid)]/40 rounded px-2 py-1">extracted = implanted + discarded + damaged + remaining</code>
              <div className="grid grid-cols-2 gap-2">
                {(['implanted', 'discarded', 'damaged', 'remaining'] as const).map((k) => (
                  <label key={k} className="space-y-1">
                    <span className="text-[var(--ink-muted)] capitalize">{k}</span>
                    <input type="number" min={0} className="input text-xs" value={(tally as any)[k]}
                      onChange={(e) => setTally((t) => ({ ...t, [k]: Number(e.target.value) || 0 }))} />
                  </label>
                ))}
              </div>
              <label className="block space-y-1">
                <span className="text-[var(--ink-muted)]">Notes</span>
                <textarea className="input text-xs min-h-[3.5rem]" value={tally.notes}
                  onChange={(e) => setTally((t) => ({ ...t, notes: e.target.value }))} />
              </label>
              <button type="button" className="btn-primary text-xs" disabled={busy} onClick={saveTally} data-testid="hair-tally-save">
                Save tally
              </button>
            </section>
          </div>
        </div>
      )}

      {panel === 'journey' && (
        <div className="space-y-4 text-sm" data-testid="hair-journey">
          <section className="space-y-2">
            <h4 className="font-semibold text-sm">{t('patients.workspace.hair_journey_photos')}</h4>
            <p className="text-xs text-[var(--ink-muted)]">{t('patients.workspace.hair_journey_photos_hint')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {['Frontal', 'Left lateral', 'Right lateral', 'Top (vertex)', 'Crown / donor', 'Posterior'].map((v) => (
                <div key={v} className="rounded-lg border border-dashed border-[var(--edge-soft)] px-3 py-6 text-center text-[var(--ink-muted)]">
                  {v}
                </div>
              ))}
            </div>
          </section>
          <section className="space-y-2">
            <h4 className="font-semibold text-sm">{t('patients.workspace.hair_journey_plan')}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              {[
                ['Option A', 'Conservative · ~1,800 grafts · single session'],
                ['Option B', 'Balanced · ~2,400 grafts · single session'],
                ['Option C', 'Restorative · ~3,200 grafts · staged'],
              ].map(([title, body]) => (
                <article key={title} className="rounded-lg border border-[var(--edge-soft)] p-3 space-y-1">
                  <h5 className="font-semibold">{title}</h5>
                  <p className="text-[var(--ink-muted)]">{body}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="space-y-2">
            <h4 className="font-semibold text-sm">{t('patients.workspace.hair_journey_timeline')}</h4>
            <p className="text-xs text-[var(--ink-muted)]">D0 procedure → Day 1–3 care → M1 check → M6 density → M12–18 final review.</p>
            <ul className="text-xs list-disc pl-4 text-[var(--ink-muted)] space-y-1">
              <li>Red flags: fever, spreading redness, uncontrolled bleeding — contact the clinic.</li>
              <li>Visualizations remain hypothetical education tools, not outcome guarantees.</li>
            </ul>
          </section>
        </div>
      )}

      {panel === 'history' && (
        <div className="space-y-2" data-testid="hair-history">
          {history.length === 0 ? (
            <p className="text-xs text-[var(--ink-muted)]">{t('common.no_data')}</p>
          ) : (
            <ul className="divide-y divide-[var(--edge-soft)]">
              {history.map((h) => (
                <li key={h.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="font-medium text-[var(--ink)]">{h.kind} · {h.label || h.id.slice(0, 8)}</p>
                    <p className="text-[var(--ink-muted)]">{h.created_at}{h.grafts != null ? ` · ${h.grafts} grafts` : ''}{h.model ? ` · ${h.model}` : ''}</p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary text-[11px]"
                    onClick={async () => {
                      const detail = await api.get(`/api/clinical/hair/${patientId}/simulations/${h.id}`);
                      if (detail.simulation?.output_data_url) {
                        setAfterUrl(detail.simulation.output_data_url);
                        setPanel('simulator');
                      }
                    }}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
