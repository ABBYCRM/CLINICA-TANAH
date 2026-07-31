/**
 * PWA install affordance:
 * - Chromium / Edge / Android / Windows: native beforeinstallprompt
 * - iOS Safari: Add to Home Screen instructions (no install API)
 */
import { useEffect, useState } from 'react';
import { useI18n } from '../hooks/useI18n';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    // iOS Safari
    (window.navigator as any).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

const DISMISS_KEY = 'pwa_install_dismissed_at';
const DISMISS_DAYS = 14;

export default function InstallPrompt() {
  const { t } = useI18n();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt && Date.now() - Number(dismissedAt) < DISMISS_DAYS * 86400000) return;

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onBip);

    // iOS never fires beforeinstallprompt — show Share → Add to Home Screen tip
    if (isIos()) {
      const tmr = window.setTimeout(() => {
        setShowIos(true);
        setVisible(true);
      }, 2500);
      return () => {
        window.removeEventListener('beforeinstallprompt', onBip);
        clearTimeout(tmr);
      };
    }

    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
    setDeferred(null);
    setShowIos(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === 'accepted') {
      setVisible(false);
    } else {
      dismiss();
    }
    setDeferred(null);
  };

  if (!visible) return null;

  return (
    <div
      data-testid="pwa-install-banner"
      className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-md animate-fade-in-up"
      role="dialog"
      aria-label={t('pwa.install_title')}
    >
      <div className="rounded-2xl border border-clinic-200 bg-white/95 p-4 shadow-xl shadow-clinic-900/10 backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-clinic-400 to-clinic-600 text-white shadow-md">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-900">{t('pwa.install_title')}</div>
            <p className="mt-0.5 text-sm text-slate-600">
              {showIos ? t('pwa.ios_hint') : t('pwa.install_body')}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!showIos && deferred && (
                <button type="button" onClick={install} className="btn-primary text-sm" data-testid="pwa-install-button">
                  {t('pwa.install_cta')}
                </button>
              )}
              {showIos && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                    <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v14" />
                  </svg>
                  {t('pwa.ios_share')}
                </span>
              )}
              <button type="button" onClick={dismiss} className="btn-secondary text-sm" data-testid="pwa-install-dismiss">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
