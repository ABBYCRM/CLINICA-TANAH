/**
 * Shared appointment create/edit form — used by scheduler and patient workspace.
 * Slot picker hits the same /api/appointments/availability the WhatsApp bot uses.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, FormError, FormActions } from './crud';
import { PatientPicker, StaffPicker } from './PatientPicker';

const TYPES = ['consultation', 'return', 'exam', 'procedure', 'teleconsultation'];
const STATUSES = ['scheduled', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show'];

export type AppointmentFormValues = {
  patient_id: string;
  practitioner_id: string;
  scheduled_at: string;
  duration_minutes: number | string;
  type: string;
  status: string;
  notes: string;
};

type Props = {
  initial?: any | null;
  /** When set, patient field is locked (patient workspace). */
  lockedPatientId?: string;
  lockedPatientLabel?: string;
  /** Render without Modal chrome (inline panel). */
  inline?: boolean;
  onClose?: () => void;
  onSaved: (result: { id: string; scheduled_at: string }) => void;
};

function toLocal(iso: string | undefined) {
  return iso ? iso.slice(0, 16).replace(' ', 'T') : '';
}

export default function AppointmentForm({
  initial = null,
  lockedPatientId,
  lockedPatientLabel,
  inline = false,
  onClose,
  onSaved,
}: Props) {
  const { t } = useI18n();
  const [form, setForm] = useState<AppointmentFormValues>(() => {
    if (initial) {
      return {
        patient_id: initial.patient_id,
        practitioner_id: initial.practitioner_id,
        scheduled_at: toLocal(initial.scheduled_at),
        duration_minutes: initial.duration_minutes,
        type: initial.type,
        status: initial.status,
        notes: initial.notes ?? '',
      };
    }
    return {
      patient_id: lockedPatientId || '',
      practitioner_id: '',
      scheduled_at: '',
      duration_minutes: 30,
      type: 'consultation',
      status: 'scheduled',
      notes: '',
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const patientLabel = lockedPatientLabel || initial?.patient_name || '';
  const practitionerLabel = initial?.practitioner_name || '';

  const datePart = form.scheduled_at.slice(0, 10);
  const [slots, setSlots] = useState<{ scheduled_at: string; available: boolean }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  useEffect(() => {
    if (lockedPatientId && form.patient_id !== lockedPatientId) {
      setForm((f) => ({ ...f, patient_id: lockedPatientId }));
    }
  }, [lockedPatientId, form.patient_id]);

  useEffect(() => {
    if (!form.practitioner_id || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      setSlots([]);
      return;
    }
    setSlotsLoading(true);
    api.get(`/api/appointments/availability?practitioner_id=${form.practitioner_id}&date=${datePart}`)
      .then((d) => setSlots(Array.isArray(d?.slots) ? d.slots : []))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [form.practitioner_id, datePart]);

  const set = (k: keyof AppointmentFormValues, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const pickSlot = (slot: string) => set('scheduled_at', slot.slice(0, 16).replace(' ', 'T'));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const patientId = lockedPatientId || form.patient_id;
    if (!patientId || !form.practitioner_id) {
      setError(t('picker.required_patient_staff'));
      return;
    }
    if (!form.scheduled_at) {
      setError(t('appointments.scheduled_at'));
      return;
    }
    setSaving(true);
    const scheduled_at = form.scheduled_at.replace('T', ' ') + (form.scheduled_at.length === 16 ? ':00' : '');
    const payload = {
      ...form,
      patient_id: patientId,
      scheduled_at,
      duration_minutes: Number(form.duration_minutes) || 30,
      source: 'reception',
    };
    try {
      if (initial?.id) {
        await api.put(`/api/appointments/${initial.id}`, payload);
        onSaved({ id: initial.id, scheduled_at });
      } else {
        const res = await api.post('/api/appointments', payload);
        onSaved({ id: res.id, scheduled_at });
      }
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <form onSubmit={submit} className="space-y-3" data-testid={inline ? 'workspace-appointment-form' : 'appointment-form'}>
      <FormError message={error} />
      {!lockedPatientId && (
        <div>
          <label className="label">{t('appointments.patient')} *</label>
          <PatientPicker
            value={form.patient_id}
            initialLabel={patientLabel}
            required
            hint={t('picker.patient_hint')}
            testId="appointment-patient"
            onChange={(id) => set('patient_id', id)}
          />
        </div>
      )}
      {lockedPatientId && (
        <p className="text-xs text-[color:var(--ink-muted)]" data-testid="appt-locked-patient">
          {t('appointments.patient')}: <span className="font-medium text-[color:var(--ink)]">{patientLabel || lockedPatientId.slice(0, 8)}</span>
        </p>
      )}
      <div>
        <label className="label">{t('appointments.practitioner')} *</label>
        <StaffPicker
          value={form.practitioner_id}
          initialLabel={practitionerLabel}
          required
          onChange={(id) => set('practitioner_id', id)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="label">{t('appointments.scheduled_at')} *</label>
          <input
            type="datetime-local"
            className="input"
            value={form.scheduled_at}
            onChange={(e) => set('scheduled_at', e.target.value)}
            required
            data-testid="appointment-datetime"
          />
        </div>
        {form.practitioner_id && datePart && (
          <div className="col-span-2">
            <label className="label">{t('appointments.pick_slot')}</label>
            {slotsLoading && <div className="text-xs text-slate-400">{t('common.loading')}</div>}
            {!slotsLoading && slots.length > 0 && !slots.some((s) => s.available) && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{t('appointments.no_slots_that_day')}</div>
            )}
            {!slotsLoading && slots.length > 0 && (
              <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5" data-testid="slot-picker">
                {slots.map((s) => {
                  const time = s.scheduled_at.slice(11, 16);
                  const chosen = form.scheduled_at === s.scheduled_at.slice(0, 16).replace(' ', 'T');
                  return (
                    <button
                      key={s.scheduled_at}
                      type="button"
                      disabled={!s.available}
                      onClick={() => pickSlot(s.scheduled_at)}
                      className={`rounded-md px-1 py-1.5 text-[11px] font-mono font-medium transition-all ${
                        chosen ? 'bg-clinic-600 text-white shadow-sm'
                          : s.available ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:shadow-sm'
                            : 'bg-slate-100 text-slate-300 line-through cursor-not-allowed'
                      }`}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="col-span-2 sm:col-span-1">
          <label className="label">{t('appointments.duration')}</label>
          <input
            type="number"
            min={5}
            max={480}
            step={5}
            className="input"
            value={form.duration_minutes}
            onChange={(e) => set('duration_minutes', e.target.value)}
            data-testid="appointment-duration"
          />
        </div>
        <div>
          <label className="label">{t('appointments.type')}</label>
          <select className="input" value={form.type} onChange={(e) => set('type', e.target.value)} data-testid="appointment-type">
            {TYPES.map((ty) => <option key={ty} value={ty}>{t(`appointments.types.${ty}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('appointments.status')}</label>
          <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)} data-testid="appointment-status">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label">{t('appointments.notes')}</label>
        <textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} data-testid="appointment-notes" />
      </div>
      {inline ? (
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary text-sm" disabled={saving} data-testid="appointment-submit">
            {saving ? '…' : t('patients.workspace.appointments_create')}
          </button>
          {onClose && (
            <button type="button" className="btn-secondary text-sm" onClick={onClose}>{t('common.cancel')}</button>
          )}
        </div>
      ) : (
        <FormActions saving={saving} onCancel={onClose || (() => {})} />
      )}
    </form>
  );

  if (inline) return body;

  return (
    <Modal title={initial?.id ? t('appointments.edit') : t('appointments.new')} onClose={onClose || (() => {})}>
      {body}
    </Modal>
  );
}
