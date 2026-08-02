/**
 * Hair transplant workspace stub — placeholder for future img2img / simulation.
 */
import { useI18n } from '../hooks/useI18n';

type Props = {
  patientId: string;
  patientName?: string;
};

export default function HairTransplantStub({ patientId, patientName }: Props) {
  const { t } = useI18n();

  return (
    <div className="px-4 py-6 space-y-4" data-testid="workspace-hair-transplant">
      <div>
        <h3 className="font-semibold text-sm text-[var(--ink)]">
          {t('patients.workspace.hair_transplant_heading')}
        </h3>
        <p className="text-xs text-[var(--ink-muted)] mt-1 max-w-xl">
          {t('patients.workspace.hair_transplant_hint')}
        </p>
      </div>

      <div
        className="rounded-lg border border-dashed border-[var(--edge-soft)] bg-[var(--paper-mid)]/40 px-4 py-10 text-center space-y-3"
        data-testid="hair-transplant-stub"
      >
        <div className="mx-auto w-14 h-14 rounded-full bg-[var(--paper)] border border-[var(--edge-soft)] flex items-center justify-center text-[var(--ink-muted)]" aria-hidden>
          <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3c-2.5 2.2-4 5-4 8a4 4 0 0 0 8 0c0-3-1.5-5.8-4-8Z" />
            <path d="M8 14c-1.2.8-2 2-2 3.5A3.5 3.5 0 0 0 12 21" />
            <path d="M16 14c1.2.8 2 2 2 3.5A3.5 3.5 0 0 1 12 21" />
          </svg>
        </div>
        <p className="text-sm font-medium text-[var(--ink)]">
          {t('patients.workspace.hair_transplant_stub_title')}
        </p>
        <p className="text-xs text-[var(--ink-muted)] max-w-md mx-auto leading-relaxed">
          {t('patients.workspace.hair_transplant_stub_body')}
        </p>
        <p className="text-[11px] font-mono text-[var(--ink-muted)] pt-2">
          {patientName || patientId}
        </p>
        <button
          type="button"
          className="btn-secondary text-xs opacity-60 cursor-not-allowed"
          disabled
          data-testid="hair-transplant-generate-disabled"
          title={t('patients.workspace.hair_transplant_coming_soon')}
        >
          {t('patients.workspace.hair_transplant_generate')}
        </button>
      </div>
    </div>
  );
}
