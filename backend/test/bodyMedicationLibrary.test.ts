import { describe, expect, it, beforeAll } from 'vitest';
import { initSchema, db } from '../src/db/schema';
import {
  ensureBodyMedicationLibrary,
  getById,
  listLibrary,
  search,
} from '../src/services/bodyMedicationLibrary';

describe('bodyMedicationLibrary', () => {
  beforeAll(() => {
    initSchema();
  });

  it('seeds ANVISA catalog idempotently', () => {
    const first = ensureBodyMedicationLibrary(db);
    expect(first.total).toBeGreaterThanOrEqual(180);
    const second = ensureBodyMedicationLibrary(db);
    expect(second.total).toBe(first.total);

    const items = listLibrary(db);
    expect(items.length).toBeGreaterThanOrEqual(180);
    expect(items.some((i) => i.visual_profile === 'glp1_metabolic')).toBe(true);
    expect(items.every((i) => !!i.id && !!i.brand_name)).toBe(true);
  });

  it('getById and search work', () => {
    const ozempic = getById(db, 'med_sema_ozempic');
    expect(ozempic?.brand_name).toBe('Ozempic');
    expect(ozempic?.visual_profile).toBe('glp1_metabolic');

    const hits = search(db, 'semaglut');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => /semaglut/i.test(h.active_ingredient || ''))).toBe(true);

    const losartan = search(db, 'losartan');
    expect(losartan.length).toBeGreaterThan(0);

    const empty = search(db, 'zzzz-no-such-med-xyz');
    expect(empty.length).toBe(0);
  });
});
