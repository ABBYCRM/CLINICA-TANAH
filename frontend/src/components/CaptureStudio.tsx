/**
 * Standardized 4-view clinical capture — BodyPath parity, Clínica Tanah desk UI.
 * Front / Left / Right / Back · EXIF GPS stripped on server · immutable originals
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export const CAPTURE_VIEWS = ['front', 'left', 'right', 'back'] as const;
export type CaptureView = (typeof CAPTURE_VIEWS)[number];

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

function fileToBase64(file: File): Promise<{ contentType: string; dataBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const m = result.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) {
        reject(new Error('invalid_data_url'));
        return;
      }
      resolve({ contentType: m[1] || file.type || 'image/jpeg', dataBase64: m[2] });
    };
    reader.readAsDataURL(file);
  });
}

function QualityBadge({ verdict }: { verdict: string }) {
  const tone = verdict === 'pass'
    ? 'badge-green'
    : verdict === 'improve'
      ? 'badge-yellow'
      : 'badge-red';
  return <span className={`badge ${tone} text-[10px] uppercase`}>{verdict}</span>;
}

export default function CaptureStudio({
  patientId,
  initialSession,
  onSessionChange,
  onGoScenarios,
}: {
  patientId: string;
  initialSession?: any | null;
  onSessionChange?: (session: any) => void;
  onGoScenarios?: () => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<any | null>(initialSession || null);
  const [view, setView] = useState<CaptureView>('front');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    setSession(initialSession || null);
  }, [initialSession?.id, initialSession?.updated_at, initialSession?.status]);

  const viewsComplete = useMemo(
    () => CAPTURE_VIEWS.every((v) => !!session?.assets?.[v]),
    [session],
  );

  const asset = session?.assets?.[view] || null;
  const previewSrc = useAuthBlob(
    asset?.preview_url || null,
    [asset?.id, asset?.preview_url, asset?.sha256],
  );

  const viewLabel = (v: CaptureView) => t(`body.views.${v}`);

  const ensureSession = async () => {
    if (session) return session;
    const created = await api.post(`/api/clinical/body/${patientId}/capture-sessions`, {});
    setSession(created);
    onSessionChange?.(created);
    return created;
  };

  const uploadFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== '') {
      setStatus(t('body.capture_invalid_type'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setStatus(t('body.capture_too_large'));
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const sess = await ensureSession();
      const { contentType, dataBase64 } = await fileToBase64(file);
      const updated = await api.post(`/api/clinical/body/capture-sessions/${sess.id}/assets`, {
        view,
        content_type: contentType,
        data_base64: dataBase64,
      });
      setSession(updated);
      onSessionChange?.(updated);
      setStatus(t('body.capture_uploaded', { view: viewLabel(view) }));
      const idx = CAPTURE_VIEWS.indexOf(view);
      if (idx >= 0 && idx < CAPTURE_VIEWS.length - 1) {
        setView(CAPTURE_VIEWS[idx + 1]);
      }
    } catch (e: any) {
      setStatus(e?.body?.message || e?.message || t('body.capture_upload_failed'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const validateSet = async () => {
    if (!session) return;
    setBusy(true);
    setStatus('');
    try {
      const updated = await api.post(`/api/clinical/body/capture-sessions/${session.id}/validate`, {
        idempotency_key: `idem_${Date.now()}`,
      });
      setSession(updated);
      onSessionChange?.(updated);
      setStatus(t('body.capture_validated'));
    } catch (e: any) {
      setStatus(e?.body?.message || e?.message || t('body.capture_validate_failed'));
    } finally {
      setBusy(false);
    }
  };

  const quality = asset?.quality as Record<string, string> | null;

  return (
    <div className="space-y-4" data-testid="body-capture-studio">
      <header>
        <h3 className="crm-record-panel-title !mb-0">{t('body.capture_title')}</h3>
        <p className="text-xs text-[color:var(--ink-muted)] mt-1 leading-relaxed">
          {t('body.capture_subtitle')}
        </p>
      </header>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <section className="crm-record-panel space-y-3">
          <div className="flex flex-wrap gap-2">
            {CAPTURE_VIEWS.map((v) => {
              const has = !!session?.assets?.[v];
              return (
                <button
                  key={v}
                  type="button"
                  data-testid={`capture-view-${v}`}
                  className={`btn-secondary text-sm inline-flex items-center gap-1.5 ${view === v ? '!bg-[#3a342c] !text-[#f0e2c8]' : ''}`}
                  onClick={() => setView(v)}
                >
                  {viewLabel(v)}
                  {has && (
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4}>
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>

          <div
            className={`relative aspect-[3/4] max-h-[520px] mx-auto rounded-xl overflow-hidden border-2 border-dashed ${
              dragOver ? 'border-[color:var(--brass)] bg-[#f3eadc]' : 'border-[rgba(176,183,192,0.7)] bg-gradient-to-b from-[#faf6ef] to-[#efe6d8]'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void uploadFile(e.dataTransfer.files?.[0]);
            }}
            data-testid="capture-stage"
          >
            {/* posing guides */}
            <div className="absolute inset-8 border border-[rgba(139,110,60,0.35)] rounded-[40%] pointer-events-none" />
            <div className="absolute bottom-6 left-6 right-6 h-px bg-[rgba(139,110,60,0.45)] pointer-events-none" />

            {previewSrc ? (
              <img
                src={previewSrc}
                alt={`${t('body.vista')} ${viewLabel(view)}`}
                className="w-full h-full object-contain relative z-[1]"
              />
            ) : (
              <button
                type="button"
                className="absolute inset-0 flex flex-col items-center justify-center text-[color:var(--ink-muted)] gap-2 px-6 z-[1]"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <span className="w-10 h-10 rounded-full border-2 border-[color:var(--brass)] border-t-transparent animate-spin opacity-70" style={{ animationPlayState: busy ? 'running' : 'paused' }} />
                <p className="text-sm text-center font-medium text-[color:var(--ink)]">
                  {t('body.capture_tap', { view: viewLabel(view) })}
                </p>
                <p className="text-xs text-center">{t('body.capture_pose_hint')}</p>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={busy || session?.status === 'complete'}
              onClick={() => fileRef.current?.click()}
              data-testid="capture-choose-photo"
            >
              {busy ? t('body.capture_uploading') : t('body.choose_photo')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              capture="environment"
              className="sr-only"
              onChange={(e) => void uploadFile(e.target.files?.[0])}
            />
            {session?.status === 'complete' && (
              <span className="badge-green text-xs">{t('body.capture_locked')}</span>
            )}
          </div>
          {status && (
            <p
              className={`text-sm ${/sucesso|success|conclu|valid/i.test(status) ? 'text-[#2f6b45]' : 'text-[#8b3a2a]'}`}
              role="status"
            >
              {status}
            </p>
          )}
        </section>

        <aside className="space-y-4">
          <div className="crm-record-panel">
            <h4 className="crm-record-panel-title">{t('body.quality')}</h4>
            {quality ? (
              <ul className="mt-3 space-y-2 text-sm" data-testid="capture-quality-list">
                {Object.entries(quality).map(([key, verdict]) => (
                  <li key={key} className="flex justify-between items-center gap-2">
                    <span className="capitalize text-[color:var(--ink)]">{key}</span>
                    <QualityBadge verdict={String(verdict)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[color:var(--ink-muted)] mt-2">{t('body.waiting_view')}</p>
            )}
          </div>

          <div className="crm-record-panel">
            <h4 className="crm-record-panel-title">{t('body.privacy')}</h4>
            <p className="text-sm text-[color:var(--ink-muted)] mt-2 leading-relaxed">
              {t('body.public_export_blocked')}
            </p>
            {viewsComplete && (
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  className="btn-secondary w-full text-sm"
                  disabled={busy || session?.status === 'complete'}
                  onClick={validateSet}
                  data-testid="capture-validate-set"
                >
                  {t('body.validate_set')}
                </button>
                <button
                  type="button"
                  className="btn-primary w-full text-sm"
                  onClick={onGoScenarios}
                  data-testid="capture-go-scenarios"
                >
                  {t('body.tabs.scenarios')}
                </button>
              </div>
            )}
          </div>

          {/* Thumbnails of all views */}
          <div className="crm-record-panel">
            <h4 className="crm-record-panel-title">{t('body.capture_set')}</h4>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {CAPTURE_VIEWS.map((v) => (
                <ViewThumb
                  key={v}
                  label={viewLabel(v)}
                  url={session?.assets?.[v]?.preview_url || null}
                  active={view === v}
                  onClick={() => setView(v)}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ViewThumb({
  label, url, active, onClick,
}: { label: string; url: string | null; active: boolean; onClick: () => void }) {
  const src = useAuthBlob(url, [url]);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg overflow-hidden border text-left ${active ? 'border-[color:var(--brass)]' : 'border-[rgba(176,183,192,0.5)]'}`}
    >
      <div className="aspect-[3/4] bg-[#efe6d8]">
        {src ? <img src={src} alt={label} className="w-full h-full object-cover" /> : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-[color:var(--ink-muted)] px-1 text-center">{label}</div>
        )}
      </div>
      <div className="px-1.5 py-1 text-[10px] font-medium truncate">{label}</div>
    </button>
  );
}
