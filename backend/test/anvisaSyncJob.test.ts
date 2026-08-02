import { describe, expect, it } from 'vitest';
import {
  computeNextAnvisaSyncAt,
  isAnvisaSyncDue,
  readAnvisaSyncJobConfig,
} from '../src/services/anvisaSyncJob';

describe('anvisaSyncJob schedule', () => {
  it('reads config from env with defaults', () => {
    expect(readAnvisaSyncJobConfig({}).hourUtc).toBe(6);
    expect(readAnvisaSyncJobConfig({}).enabled).toBe(true);
    expect(readAnvisaSyncJobConfig({ ANVISA_SYNC_ENABLED: 'false' }).enabled).toBe(false);
    expect(readAnvisaSyncJobConfig({ ANVISA_SYNC_HOUR_UTC: '9' }).hourUtc).toBe(9);
    expect(readAnvisaSyncJobConfig({ ANVISA_SYNC_HOUR_UTC: '99' }).hourUtc).toBe(23);
  });

  it('is due when never synced or stale', () => {
    const now = new Date('2026-08-02T12:00:00.000Z');
    expect(isAnvisaSyncDue(now, null, 6)).toBe(true);
    expect(isAnvisaSyncDue(now, '2026-08-01T10:00:00.000Z', 6)).toBe(true); // >23h
  });

  it('is due after daily hour if not yet synced today', () => {
    const now = new Date('2026-08-02T07:30:00.000Z'); // past 06:00 UTC
    expect(isAnvisaSyncDue(now, '2026-08-01T20:00:00.000Z', 6)).toBe(true);
    // already synced after today's hour
    expect(isAnvisaSyncDue(now, '2026-08-02T06:05:00.000Z', 6)).toBe(false);
  });

  it('is not due before daily hour when last sync is fresh', () => {
    const now = new Date('2026-08-02T05:00:00.000Z'); // before 06:00 UTC
    expect(isAnvisaSyncDue(now, '2026-08-01T18:00:00.000Z', 6)).toBe(false);
  });

  it('computes next_run_at for upcoming hour, due-now, and tomorrow', () => {
    const before = new Date('2026-08-02T05:00:00.000Z');
    expect(computeNextAnvisaSyncAt(before, '2026-08-01T18:00:00.000Z', 6)).toBe(
      '2026-08-02T06:00:00.000Z',
    );

    const afterUnsynced = new Date('2026-08-02T07:00:00.000Z');
    expect(computeNextAnvisaSyncAt(afterUnsynced, '2026-08-01T18:00:00.000Z', 6)).toBe(
      afterUnsynced.toISOString(),
    );

    const afterSynced = new Date('2026-08-02T07:00:00.000Z');
    expect(computeNextAnvisaSyncAt(afterSynced, '2026-08-02T06:10:00.000Z', 6)).toBe(
      '2026-08-03T06:00:00.000Z',
    );
  });
});
