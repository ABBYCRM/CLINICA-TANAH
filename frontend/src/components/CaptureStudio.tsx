/**
 * Standardized 4-view clinical capture — BodyPath parity, Clínica Tanah desk UI.
 * Front / Left / Right / Back · EXIF GPS stripped on server · immutable originals
 * Mobile-safe: gallery + camera, client JPEG compress, no full-page reload on upload.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export const CAPTURE_VIEWS = ['front', 'left', 'right', 'back'] as const;
export type CaptureView = (typeof CAPTURE_VIEWS)[number];

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const MAX_BYTES = 8 * 1024 * 1024;

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

/** Decode image → resize → JPEG base64 (fixes HEIC/gallery + huge phone photos). */
async function prepareUploadImage(file: File): Promise<{ contentType: string; dataBase64: string }> {
  const type = (file.type || '').toLowerCase();
  if (type && !type.startsWith('image/') && type !== 'application/octet-stream') {
    throw new Error('invalid_type');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode_failed'));
      el.src = objectUrl;
    });
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new Error('decode_failed');
    const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('decode_failed');
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error('encode_failed');
    const approxBytes = Math.ceil((m[2].length * 3) / 4);
    if (approxBytes > MAX_BYTES) throw new Error('too_large');
    return { contentType: 'image/jpeg', dataBase64: m[2] };
  } catch {
    // Fallback: raw FileReader for JPEG/PNG that Image() rejected
    if (file.size > MAX_BYTES) throw new Error('too_large');
    const raw = await new Promise<{ contentType: string; dataBase64: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read_failed'));
      reader.onload = () => {
        const result = String(reader.result || '');
        const m = result.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) {
          reject(new Error('invalid_data_url'));
          return;
        }
        const ct = (m[1] || file.type || 'image/jpeg').toLowerCase();
        if (ct.includes('heic') || ct.includes('heif')) {
          reject(new Error('heic_unsupported'));
          return;
        }
        resolve({ contentType: ct, dataBase64: m[2] });
      };
      reader.readAsDataURL(file);
    });
    return raw;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
  consentsOk = true,
  onRequestConsents,
  onSessionChange,
  onGoScenarios,
}: {
  patientId: string;
  initialSession?: any | null;
  consentsOk?: boolean;
  onRequestConsents?: () => void;
  onSessionChange?: (session: any) => void;
  onGoScenarios?: () => void;
}) {
  const { t } = useI18n();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<any | null>(initialSession || null);
  const [view, setView] = useState<CaptureView>('front');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    // Sync from parent only when session identity/status changes — avoid wiping in-flight uploads
    setSession((prev: any) => {
      if (!initialSession) return prev;
      if (!prev) return initialSession;
      if (prev.id !== initialSession.id) return initialSession;
      if (initialSession.status === 'complete' && prev.status !== 'complete') return initialSession;
      // Prefer richer local asset map if parent is stale
      const localCount = Object.keys(prev.assets || {}).length;
      const parentCount = Object.keys(initialSession.assets || {}).length;
      if (parentCount >= localCount) return initialSession;
      return prev;
    });
  }, [initialSession?.id, initialSession?.updated_at, initialSession?.status, initialSession?.views_complete]);

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
    if (!consentsOk) {
      setStatus(t('body.consent_required'));
      onRequestConsents?.();
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const prepared = await prepareUploadImage(file);
      const sess = await ensureSession();
      try {
        await api.post(`/api/clinical/body/capture-sessions/${sess.id}/assets/sign`, {
          view,
          content_type: prepared.contentType,
        });
      } catch {
        /* optional handshake */
      }
      const updated = await api.post(`/api/clinical/body/capture-sessions/${sess.id}/assets`, {
        view,
        content_type: prepared.contentType,
        data_base64: prepared.dataBase64,
      });
      setSession(updated);
      onSessionChange?.(updated);
      setStatus(t('body.capture_uploaded', { view: viewLabel(view) }));
      const idx = CAPTURE_VIEWS.indexOf(view);
      if (idx >= 0 && idx < CAPTURE_VIEWS.length - 1) {
        setView(CAPTURE_VIEWS[idx + 1]);
      }
    } catch (e: any) {
      const code = e?.message || e?.body?.error || '';
      if (code === 'invalid_type' || code === 'invalid_data_url') setStatus(t('body.capture_invalid_type'));
      else if (code === 'too_large') setStatus(t('body.capture_too_large'));
      else if (code === 'heic_unsupported' || code === 'decode_failed') setStatus(t('body.capture_heic_hint'));
      else if (e?.body?.error === 'consent_required') setStatus(t('body.consent_required'));
      else setStatus(e?.body?.message || e?.message || t('body.capture_upload_failed'));
    } finally {
      setBusy(false);
      if (galleryRef.current) galleryRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
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
  const locked = session?.status === 'complete';

  if (!consentsOk) {
    return (
      <div className="space-y-3" data-testid="body-capture-studio">
        <header className="px-0.5">
          <h3 className="crm-record-panel-title !mb-0">{t('body.capture_title')}</h3>
        </header>
        <section className="crm-inset-panel space-y-3" data-testid="capture-consent-gate">
          <p className="text-sm text-[#8b3a2a] leading-relaxed">{t('body.consent_required')}</p>
          <button type="button" className="btn-primary text-sm" onClick={onRequestConsents} data-testid="capture-grant-consents">
            {t('body.register_consents')}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="body-capture-studio">
      <header className="px-0.5">
        <h3 className="crm-record-panel-title !mb-0">{t('body.capture_title')}</h3>
        <p className="text-xs text-[color:var(--ink-muted)] mt-1 leading-relaxed">
          {t('body.capture_subtitle')}
        </p>
      </header>

      <section className="crm-inset-panel space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {CAPTURE_VIEWS.map((v) => {
            const has = !!session?.assets?.[v];
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                data-testid={`capture-view-${v}`}
                className={`seg-item !text-xs inline-flex items-center gap-1.5 ${active ? 'is-active' : ''}`}
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

        <div className="grid lg:grid-cols-[minmax(0,1fr)_13.5rem] gap-3 items-start">
          <div className="space-y-3 min-w-0">
            <div
              className={`relative aspect-[3/4] max-h-[min(440px,70vh)] w-full mx-auto rounded-xl overflow-hidden border-2 border-dashed ${
                dragOver ? 'border-[color:var(--brass)] bg-[#f3eadc]' : 'border-[rgba(176,183,192,0.65)] bg-gradient-to-b from-[#faf6ef] to-[#efe6d8]'
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
              <div className="absolute inset-8 border border-[rgba(139,110,60,0.35)] rounded-[40%] pointer-events-none" />
              <div className="absolute bottom-6 left-6 right-6 h-px bg-[rgba(139,110,60,0.45)] pointer-events-none" />

              {previewSrc ? (
                <button
                  type="button"
                  className="absolute inset-0 z-[1] p-0 border-0 bg-transparent"
                  onClick={() => !locked && !busy && galleryRef.current?.click()}
                  disabled={busy || locked}
                  aria-label={t('body.choose_photo')}
                >
                  <img
                    src={previewSrc}
                    alt={`${t('body.vista')} ${viewLabel(view)}`}
                    className="w-full h-full object-contain"
                  />
                </button>
              ) : (
                <button
                  type="button"
                  className="absolute inset-0 flex flex-col items-center justify-center text-[color:var(--ink-muted)] gap-2 px-6 z-[1]"
                  onClick={() => galleryRef.current?.click()}
                  disabled={busy || locked}
                >
                  {busy && (
                    <span className="w-10 h-10 rounded-full border-2 border-[color:var(--brass)] border-t-transparent animate-spin opacity-70" />
                  )}
                  <p className="text-sm text-center font-medium text-[color:var(--ink)]">
                    {busy ? t('body.capture_uploading') : t('body.capture_tap', { view: viewLabel(view) })}
                  </p>
                  <p className="text-xs text-center">{t('body.capture_pose_hint')}</p>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={busy || locked}
                onClick={() => galleryRef.current?.click()}
                data-testid="capture-choose-photo"
              >
                {busy ? t('body.capture_uploading') : t('body.choose_photo')}
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={busy || locked}
                onClick={() => cameraRef.current?.click()}
                data-testid="capture-take-photo"
              >
                {t('body.take_photo')}
              </button>
              {/* Gallery / files — no capture= so mobile can pick from library */}
              <input
                ref={galleryRef}
                type="file"
                accept="image/*,.heic,.heif,image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => void uploadFile(e.target.files?.[0])}
                data-testid="capture-file-input"
              />
              {/* Camera — separate control; capture only here */}
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => void uploadFile(e.target.files?.[0])}
                data-testid="capture-camera-input"
              />
              {locked && (
                <span className="badge-green text-xs">{t('body.capture_locked')}</span>
              )}
            </div>
            {status && (
              <p
                className={`text-sm ${/sucesso|success|conclu|valid|enviada/i.test(status) ? 'text-[#2f6b45]' : 'text-[#8b3a2a]'}`}
                role="status"
                data-testid="capture-status"
              >
                {status}
              </p>
            )}
          </div>

          <aside className="space-y-3 min-w-0">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1.5">{t('body.quality')}</h4>
              {quality ? (
                <ul className="space-y-1.5 text-sm" data-testid="capture-quality-list">
                  {Object.entries(quality).map(([key, verdict]) => (
                    <li key={key} className="flex justify-between items-center gap-2">
                      <span className="capitalize text-[color:var(--ink)]">{key}</span>
                      <QualityBadge verdict={String(verdict)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[color:var(--ink-muted)]">{t('body.waiting_view')}</p>
              )}
            </div>

            <div className="border-t border-[rgba(176,183,192,0.35)] pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1.5">{t('body.privacy')}</h4>
              <p className="text-xs text-[color:var(--ink-muted)] leading-relaxed">
                {t('body.public_export_blocked')}
              </p>
              {viewsComplete && (
                <div className="mt-3 space-y-2">
                  <button
                    type="button"
                    className="btn-secondary w-full text-sm"
                    disabled={busy || locked}
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

            <div className="border-t border-[rgba(176,183,192,0.35)] pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)] mb-1.5">{t('body.capture_set')}</h4>
              <div className="grid grid-cols-2 gap-1.5">
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
      </section>
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
      className={`rounded-lg overflow-hidden border text-left transition-colors ${
        active ? 'border-[color:var(--brass-deep)] ring-1 ring-[color:var(--brass)]' : 'border-[rgba(176,183,192,0.5)]'
      }`}
    >
      <div className="aspect-[3/4] bg-[#efe6d8]">
        {src ? <img src={src} alt={label} className="w-full h-full object-cover" /> : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-[color:var(--ink-muted)] px-1 text-center">{label}</div>
        )}
      </div>
      <div className="px-1.5 py-1 text-[10px] font-medium truncate bg-[rgba(255,252,245,0.6)]">{label}</div>
    </button>
  );
}
