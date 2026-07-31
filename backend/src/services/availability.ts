/**
 * Availability — single source of truth for "who is free when".
 * Used by the REST API (calendar/scheduler UI) AND the WhatsApp bot,
 * so a slot can never be double-booked through either channel.
 */
import { db } from '../db/schema';

export const WORK_START_HOUR = 8;
export const WORK_END_HOUR = 18;
export const SLOT_MINUTES = 30;

export interface SlotInfo { scheduled_at: string; available: boolean; }

function allSlotsForDate(date: string): string[] {
  const slots: string[] = [];
  for (let h = WORK_START_HOUR; h < WORK_END_HOUR; h++) {
    for (let m = 0; m < 60; m += SLOT_MINUTES) {
      slots.push(`${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
    }
  }
  return slots;
}

function takenSlots(practitionerId: string, date: string): Set<string> {
  const rows = db.prepare(`
    SELECT scheduled_at FROM appointments
    WHERE practitioner_id = ? AND date(scheduled_at) = ?
      AND status NOT IN ('cancelled','no_show')
  `).all(practitionerId, date) as any[];
  return new Set(rows.map((r) => r.scheduled_at));
}

/** Every slot of the day, flagged available/taken — drives the scheduler UI. */
export function getDaySlots(practitionerId: string, date: string): SlotInfo[] {
  const taken = takenSlots(practitionerId, date);
  return allSlotsForDate(date).map((s) => ({ scheduled_at: s, available: !taken.has(s) }));
}

/** Only the free slots — used by the WhatsApp bot when offering times. */
export function getAvailableSlots(practitionerId: string, date: string): string[] {
  return getDaySlots(practitionerId, date).filter((s) => s.available).map((s) => s.scheduled_at);
}

export interface PractitionerLoad {
  id: string;
  full_name: string;
  council_number: string | null;
  booked: number;
  free: number;
}

/**
 * Active doctors ranked by how much room they still have on `date`
 * (most free slots first) — the bot's fair, "educated" pick.
 */
export function getPractitionerLoads(date: string): PractitionerLoad[] {
  const doctors = db.prepare(`
    SELECT id, full_name, council_number FROM users
    WHERE role = 'doctor' AND active = 1 ORDER BY full_name ASC
  `).all() as any[];
  return doctors.map((d) => {
    const taken = takenSlots(d.id, date).size;
    const total = allSlotsForDate(date).length;
    return { id: d.id, full_name: d.full_name, council_number: d.council_number, booked: taken, free: total - taken };
  }).sort((a, b) => b.free - a.free || a.full_name.localeCompare(b.full_name));
}
