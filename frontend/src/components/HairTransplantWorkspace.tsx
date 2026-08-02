/**
 * Hair Transplant workspace — TANAH-HAIR-GEN image generator
 * wired into the patient record with CLINICA-TANAH CRM UI tokens.
 * Does not reuse the standalone GEN demo chrome (topbar / teal cards / Inter).
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

type Props = {
  patientId: string;
  patientName?: string;
};

type Presets = {
  hairlines: Array<{ id: string; label: string }>;
  zones: Array<{ id: string; label: string }>;
  lengths: Array<{ id: string; label: string }>;
  colors: Array<{ id: string; label: string }>;
  curls: Array<{ id: string; label: string }>;
  fullnesses: Array<{ id: string; label: string }>;
  techniques: Array<{ id: string; label: string }>;
  sessions: Array<{ id: string; label: string }>;
  graftScenarios: Array<{ id: string; label: string }>;
  views: Array<{ id: string; label: string }>;
  geminiModel?: string;
};

type Params = {
  hairline: string;
  zone: string;
  length: string;
  color: string;
  curl: string;
  fullness: string;
  technique: string;
  sessions: string;
  graftScenario: string;
  view: string;
  density: number;
};

const DEFAULT_PARAMS: Params = {
  hairline: 'balanced',
  zone: 'full',
  length: 'short',
  color: 'darkBrown',
  curl: 'straight',
  fullness: 'moderate',
  technique: 'fue',
  sessions: 'single',
  graftScenario: 'moderate',
  view: 'front',
  density: 0.7,
};

type ResultCard =
  | { kind: 'single'; url: string; meta: string }
  | { kind: 'grid'; items: Array<{ label: string; url?: string; error?: string }>; meta: string };

export default function HairTransplantWorkspace({ patientId, patientName }: Props) {
  const { t, locale } = useI18n();
  const [presets, setPresets] = useState<Presets | null>(null);
  const [geminiOk, setGeminiOk] = useState<boolean | null>(null);
  const [modelName, setModelName] = useState('—');
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoMime, setPhotoMime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ResultCard | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const loadMeta = useCallback(async () => {
    try {
      const [p, st, hist] = await Promise.all([
        api.get('/api/clinical/hair/presets'),
        api.get('/api/clinical/hair/status'),
        api.get(`/api/clinical/hair/${patientId}/history`),
      ]);
      setPresets(p);
      setGeminiOk(!!st?.gemini?.configured);
      setModelName(st?.gemini?.model || p?.geminiModel || '—');
      setHistory(hist?.generations || []);
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
    }
  }, [patientId, t]);

  useEffect(() => {
    setPhotoBase64(null);
    setPhotoMime(null);
    setResult(null);
    setError('');
    setParams(DEFAULT_PARAMS);
    void loadMeta();
  }, [patientId, loadMeta]);

  const setField = (key: keyof Params, value: string | number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const onPhoto = (file: File | null) => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      setError(t('patients.workspace.hair_err_too_large'));
      return;
    }
    const mime = file.type || 'image/jpeg';
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      setPhotoBase64(b64);
      setPhotoMime(mime);
      setError('');
    };
    reader.readAsDataURL(file);
  };

  const clearPhoto = () => {
    setPhotoBase64(null);
    setPhotoMime(null);
  };

  const call = async (path: string, mode: 'generate' | 'variants' | 'multi-view' | 'parametric') => {
    if (!photoBase64) {
      setError(t('patients.workspace.hair_err_no_photo'));
      return;
    }
    setBusy(true);
    setError('');
    const t0 = performance.now();
    try {
      const body = await api.post(`/api/clinical/hair/${patientId}/${path}`, {
        photoBase64,
        photoMime: photoMime || 'image/jpeg',
        params,
      });
      const ms = ((performance.now() - t0) / 1000).toFixed(1);
      if (mode === 'variants') {
        setResult({
          kind: 'grid',
          meta: t('patients.workspace.hair_result_variants', {
            ok: (body.variants || []).filter((v: any) => !v.error).length,
            total: (body.variants || []).length,
            ms,
          }),
          items: (body.variants || []).map((v: any) => ({
            label: presets?.hairlines?.find((h) => h.id === v.hairline)?.label || v.hairline,
            url: v.outputDataUrl,
            error: v.error,
          })),
        });
      } else if (mode === 'multi-view') {
        setResult({
          kind: 'grid',
          meta: t('patients.workspace.hair_result_multiview', {
            ok: (body.views || []).filter((v: any) => !v.error).length,
            total: (body.views || []).length,
            ms,
          }),
          items: (body.views || []).map((v: any) => ({
            label: presets?.views?.find((x) => x.id === v.view)?.label || String(v.view || '').toUpperCase(),
            url: v.outputDataUrl,
            error: v.error,
          })),
        });
      } else {
        setResult({
          kind: 'single',
          url: body.outputDataUrl,
          meta: t('patients.workspace.hair_result_meta', {
            model: body.model || mode,
            view: body.view || params.view,
            ms,
            id: body.id || '',
          }),
        });
      }
      const hist = await api.get(`/api/clinical/hair/${patientId}/history`);
      setHistory(hist?.generations || []);
    } catch (e: any) {
      setError(e?.message || t('errors.generic'));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const selectOpts = (list?: Array<{ id: string; label: string }>) =>
    (list || []).map((o) => (
      <option key={o.id} value={o.id}>{o.label}</option>
    ));

  return (
    <div className="px-4 py-4 space-y-4" data-testid="workspace-hair-transplant">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm text-[color:var(--ink)]">
            {t('patients.workspace.hair_transplant_heading')}
          </h3>
          <p className="text-xs text-[color:var(--ink-muted)] mt-1 max-w-2xl">
            {t('patients.workspace.hair_transplant_hint')}
          </p>
          {patientName && (
            <p className="text-[11px] text-[color:var(--ink-muted)] mt-1 font-mono">{patientName}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`badge ${geminiOk ? 'badge-green' : geminiOk === false ? 'badge-red' : 'badge-yellow'}`}
            data-testid="hair-gemini-status"
          >
            {geminiOk ? t('patients.workspace.hair_ai_ready') : geminiOk === false ? t('patients.workspace.hair_ai_offline') : t('common.loading')}
          </span>
          <span className="badge badge-slate" data-testid="hair-model-name">
            {t('patients.workspace.hair_model')}: {modelName}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-[color:var(--ink-muted)] leading-relaxed max-w-3xl">
        {t('patients.workspace.hair_boundary')}
      </p>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-3 py-2" data-testid="hair-error">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-3">
        {/* Photo */}
        <section className="crm-inset-panel space-y-3" data-testid="hair-photo-panel">
          <h4 className="crm-record-panel-title">{t('patients.workspace.hair_photo_title')}</h4>
          <div className="rounded-md border border-[var(--edge-soft)] bg-[var(--paper)] overflow-hidden aspect-[5/4] flex items-center justify-center">
            {photoBase64 ? (
              <img
                src={`data:${photoMime || 'image/jpeg'};base64,${photoBase64}`}
                alt={t('patients.workspace.hair_photo_alt')}
                className="w-full h-full object-cover"
                data-testid="hair-photo-preview"
              />
            ) : (
              <div className="text-center px-4 py-8 text-[color:var(--ink-muted)] text-xs space-y-1">
                <div>{t('patients.workspace.hair_photo_empty')}</div>
                <div className="opacity-80">{t('patients.workspace.hair_photo_limits')}</div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="btn-primary text-xs cursor-pointer">
              {t('patients.workspace.hair_photo_upload')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                data-testid="hair-photo-input"
                onChange={(e) => onPhoto(e.target.files?.[0] || null)}
              />
            </label>
            {photoBase64 && (
              <button type="button" className="btn-secondary text-xs" onClick={clearPhoto} data-testid="hair-photo-clear">
                {t('patients.workspace.hair_photo_clear')}
              </button>
            )}
          </div>
        </section>

        {/* Parameters */}
        <section className="crm-inset-panel space-y-3" data-testid="hair-params-panel">
          <h4 className="crm-record-panel-title">{t('patients.workspace.hair_params_title')}</h4>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['hairline', 'hair_param_hairline', presets?.hairlines],
              ['zone', 'hair_param_zone', presets?.zones],
              ['length', 'hair_param_length', presets?.lengths],
              ['color', 'hair_param_color', presets?.colors],
              ['curl', 'hair_param_curl', presets?.curls],
              ['fullness', 'hair_param_fullness', presets?.fullnesses],
              ['technique', 'hair_param_technique', presets?.techniques],
              ['sessions', 'hair_param_sessions', presets?.sessions],
              ['graftScenario', 'hair_param_grafts', presets?.graftScenarios],
              ['view', 'hair_param_view', presets?.views],
            ] as const).map(([key, labelKey, list]) => (
              <div key={key} className={key === 'graftScenario' || key === 'view' ? 'col-span-2' : ''}>
                <label className="label text-[11px]">{t(`patients.workspace.${labelKey}`)}</label>
                <select
                  className="input text-xs"
                  value={(params as any)[key]}
                  onChange={(e) => setField(key, e.target.value)}
                  data-testid={`hair-param-${key}`}
                >
                  {selectOpts(list)}
                </select>
              </div>
            ))}
            <div className="col-span-2">
              <label className="label text-[11px] flex justify-between">
                <span>{t('patients.workspace.hair_param_density')}</span>
                <span className="font-mono">{params.density.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={params.density}
                onChange={(e) => setField('density', Number(e.target.value))}
                className="w-full"
                data-testid="hair-param-density"
              />
              <p className="text-[10px] text-[color:var(--ink-muted)] mt-0.5">
                {t('patients.workspace.hair_param_density_hint')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={busy || !photoBase64}
              data-testid="hair-generate"
              onClick={() => call('generate', 'generate')}
            >
              {busy ? t('common.loading') : t('patients.workspace.hair_action_generate')}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={busy || !photoBase64}
              data-testid="hair-variants"
              onClick={() => call('variants', 'variants')}
            >
              {t('patients.workspace.hair_action_variants')}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={busy || !photoBase64}
              data-testid="hair-multiview"
              onClick={() => call('multi-view', 'multi-view')}
            >
              {t('patients.workspace.hair_action_multiview')}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={busy || !photoBase64}
              data-testid="hair-parametric"
              onClick={() => call('parametric', 'parametric')}
            >
              {t('patients.workspace.hair_action_parametric')}
            </button>
          </div>
        </section>

        {/* Result */}
        <section className="crm-inset-panel space-y-3" data-testid="hair-result-panel">
          <div className="flex items-center justify-between gap-2">
            <h4 className="crm-record-panel-title">{t('patients.workspace.hair_result_title')}</h4>
            {result && <span className="badge badge-slate text-[10px]">{result.meta}</span>}
          </div>
          {!result && (
            <div className="rounded-md border border-dashed border-[var(--edge-soft)] px-3 py-10 text-center text-xs text-[color:var(--ink-muted)]">
              {t('patients.workspace.hair_result_empty')}
            </div>
          )}
          {result?.kind === 'single' && (
            <img
              src={result.url}
              alt={t('patients.workspace.hair_result_alt')}
              className="w-full rounded-md border border-[var(--edge-soft)] bg-[var(--paper)]"
              data-testid="hair-result-image"
            />
          )}
          {result?.kind === 'grid' && (
            <div className="grid grid-cols-2 gap-2" data-testid="hair-result-grid">
              {result.items.map((item, i) => (
                <figure key={i} className="rounded-md border border-[var(--edge-soft)] overflow-hidden bg-[var(--paper)]">
                  {item.url ? (
                    <img src={item.url} alt={item.label} className="w-full aspect-square object-cover" />
                  ) : (
                    <div className="aspect-square flex items-center justify-center text-[10px] text-rose-700 px-2 text-center">
                      {item.error || t('patients.workspace.hair_result_failed')}
                    </div>
                  )}
                  <figcaption className="px-2 py-1 text-[10px] text-[color:var(--ink-muted)] truncate">{item.label}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* History for this patient */}
      <section className="crm-inset-panel space-y-2" data-testid="hair-history-panel">
        <h4 className="crm-record-panel-title">{t('patients.workspace.hair_history_title')}</h4>
        {history.length === 0 && (
          <p className="text-xs text-[color:var(--ink-muted)]">{t('patients.workspace.hair_history_empty')}</p>
        )}
        <ul className="space-y-2">
          {history.map((g) => (
            <li key={g.id} className="crm-timeline-card flex items-center gap-3">
              {g.outputDataUrl ? (
                <button
                  type="button"
                  className="shrink-0 w-14 h-14 rounded overflow-hidden border border-[var(--edge-soft)]"
                  onClick={() => setResult({
                    kind: 'single',
                    url: g.outputDataUrl,
                    meta: `${g.mode} · ${g.model || '—'}`,
                  })}
                >
                  <img src={g.outputDataUrl} alt="" className="w-full h-full object-cover" />
                </button>
              ) : (
                <div className="w-14 h-14 rounded bg-[var(--paper-mid)] border border-[var(--edge-soft)]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-[color:var(--ink)] truncate">
                  {g.mode} · {g.view || '—'} · {g.model || '—'}
                </div>
                <div className="text-[10px] text-[color:var(--ink-muted)]">
                  {g.createdAt
                    ? new Date(g.createdAt).toLocaleString(locale === 'pt-BR' ? 'pt-BR' : locale === 'es' ? 'es' : 'en')
                    : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
