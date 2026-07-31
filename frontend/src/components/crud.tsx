import { useEffect } from 'react';
import { useI18n } from '../hooks/useI18n';

export function IconPencil({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />
    </svg>
  );
}

export function IconTrash({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function Modal({ title, onClose, children, wide }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#1a261e]/50 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className={`relative card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto animate-scale-in`}>
        <div
          className="sticky top-0 z-10 flex items-center justify-between border-b border-[rgba(63,92,66,0.18)] px-6 py-4"
          style={{ background: 'linear-gradient(180deg, #f4efe6 0%, #ebe4d8 100%)' }}
        >
          <h2 className="font-display text-lg font-semibold tracking-tight text-[#3a342c]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-xl p-1.5 text-[#7a8476] transition-all hover:text-[#3a342c]"
            style={{
              background: 'linear-gradient(180deg,#f7faf4,#e2ebe0)',
              border: '1px solid rgba(63,92,66,0.2)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 2px rgba(40,55,35,0.1)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-5 h-5" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ name, onCancel, onConfirm, busy, notice }: {
  name?: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  notice?: string;
}) {
  const { t } = useI18n();
  return (
    <Modal title={t('crud.confirm_delete_title')} onClose={onCancel}>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#6e3228]"
            style={{
              background: 'linear-gradient(160deg, #efd0c8, #e0b3a8)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 2px 4px rgba(90,40,30,0.12)',
            }}
          >
            <IconTrash className="w-5 h-5" />
          </div>
          <div className="text-sm text-[#6b645a]">
            {name && <div className="font-semibold text-[#3a342c] mb-1">{name}</div>}
            {t('crud.confirm_delete_body')}
            {notice && (
              <div
                className="mt-2 text-xs text-[#5a4720] rounded-lg px-2.5 py-2"
                style={{ background: 'linear-gradient(180deg, #f0e3c0, #e2cfa0)', border: '1px solid rgba(138,106,69,0.28)' }}
              >
                {notice}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-danger" data-testid="confirm-delete">
            {busy ? t('common.loading') : t('common.delete')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function RowActions({ onEdit, onDelete, editTestId, deleteTestId }: {
  onEdit?: () => void;
  onDelete?: () => void;
  editTestId?: string;
  deleteTestId?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-end gap-1">
      {onEdit && (
        <button type="button" onClick={onEdit} title={t('crud.edit')} data-testid={editTestId}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-clinic-50 hover:text-clinic-700">
          <IconPencil />
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} title={t('common.delete')} data-testid={deleteTestId}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600">
          <IconTrash />
        </button>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="animate-shake rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
      {message}
    </div>
  );
}

export function FormActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
      <button type="submit" className="btn-primary" disabled={saving} data-testid="form-submit">
        {saving ? t('common.loading') : t('common.save')}
      </button>
    </div>
  );
}
