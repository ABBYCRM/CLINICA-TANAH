/**
 * In-process daily ANVISA sanitary-alerts sync.
 *
 * DigitalOcean App Platform (single web service) has no built-in cron for the
 * Node process, so we schedule inside the server:
 *   · on boot — sync if never run or stale (>23h)
 *   · every hour — sync when past ANVISA_SYNC_HOUR_UTC and not yet run today
 *
 * Env:
 *   ANVISA_SYNC_ENABLED   — default true (set "false"/"0" to disable)
 *   ANVISA_SYNC_HOUR_UTC  — 0–23, default 6 (≈03:00 BRT)
 *   ANVISA_ALERTS_FEED_URL — optional JSON feed; otherwise curated catalog refresh
 */
import type Database from 'better-sqlite3';
import { getSyncMeta, syncAnvisaSanitaryAlerts } from './anvisaSanitaryAlerts';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_MS = 23 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 15_000;
const TICK_MS = 60 * 60 * 1000;

export type AnvisaSyncJobConfig = {
  enabled: boolean;
  hourUtc: number;
  staleAfterMs: number;
};

export type AnvisaSyncScheduleInfo = {
  enabled: boolean;
  hour_utc: number;
  next_run_at: string | null;
  mode: 'daily_in_process';
};

let running = false;
let started = false;
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

export function readAnvisaSyncJobConfig(env: NodeJS.ProcessEnv = process.env): AnvisaSyncJobConfig {
  const raw = String(env.ANVISA_SYNC_ENABLED ?? 'true').trim().toLowerCase();
  const enabled = !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
  const hour = parseInt(String(env.ANVISA_SYNC_HOUR_UTC ?? '6'), 10);
  const hourUtc = Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 6;
  return { enabled, hourUtc, staleAfterMs: DEFAULT_STALE_MS };
}

/** True when a sync should run at `now` given last successful/attempted sync time. */
export function isAnvisaSyncDue(
  now: Date,
  lastSyncAt: string | null | undefined,
  hourUtc: number,
  staleAfterMs: number = DEFAULT_STALE_MS,
): boolean {
  if (!lastSyncAt) return true;
  const last = Date.parse(lastSyncAt);
  if (!Number.isFinite(last)) return true;
  if (now.getTime() - last >= staleAfterMs) return true;

  const todayAt = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hourUtc,
    0,
    0,
    0,
  );
  return now.getTime() >= todayAt && last < todayAt;
}

/** Next scheduled run ISO timestamp (or `now` if currently due). */
export function computeNextAnvisaSyncAt(
  now: Date,
  lastSyncAt: string | null | undefined,
  hourUtc: number,
): string {
  const todayAt = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hourUtc,
    0,
    0,
    0,
  );
  const last = lastSyncAt ? Date.parse(lastSyncAt) : NaN;

  if (now.getTime() < todayAt) {
    return new Date(todayAt).toISOString();
  }
  if (Number.isFinite(last) && last >= todayAt) {
    return new Date(todayAt + DAY_MS).toISOString();
  }
  // Past today's hour and not yet synced today → due immediately
  return now.toISOString();
}

export function getAnvisaSyncScheduleInfo(
  db: Database.Database,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): AnvisaSyncScheduleInfo {
  const cfg = readAnvisaSyncJobConfig(env);
  if (!cfg.enabled) {
    return { enabled: false, hour_utc: cfg.hourUtc, next_run_at: null, mode: 'daily_in_process' };
  }
  const meta = getSyncMeta(db);
  return {
    enabled: true,
    hour_utc: cfg.hourUtc,
    next_run_at: computeNextAnvisaSyncAt(now, meta.last_sync_at, cfg.hourUtc),
    mode: 'daily_in_process',
  };
}

async function runIfDue(db: Database.Database, reason: string): Promise<void> {
  if (running) return;
  const cfg = readAnvisaSyncJobConfig();
  if (!cfg.enabled) return;

  const meta = getSyncMeta(db);
  if (!isAnvisaSyncDue(new Date(), meta.last_sync_at, cfg.hourUtc, cfg.staleAfterMs)) {
    return;
  }

  running = true;
  try {
    console.log(`[anvisa-sync] starting (${reason})…`);
    const result = await syncAnvisaSanitaryAlerts(db);
    console.log(
      `[anvisa-sync] done source=${result.source} upserted=${result.upserted} status=${result.error ? 'partial' : 'ok'}`,
    );
  } catch (err: any) {
    console.error('[anvisa-sync] failed:', err?.message || err);
  } finally {
    running = false;
  }
}

/**
 * Start daily ANVISA sync timers. Idempotent. No-op under NODE_ENV=test / Vitest.
 */
export function startAnvisaDailySyncJob(db: Database.Database): void {
  if (started) return;
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;

  const cfg = readAnvisaSyncJobConfig();
  if (!cfg.enabled) {
    console.log('[anvisa-sync] disabled (ANVISA_SYNC_ENABLED)');
    return;
  }

  started = true;
  console.log(
    `[anvisa-sync] daily job armed · hour_utc=${cfg.hourUtc} · feed=${(process.env.ANVISA_ALERTS_FEED_URL || '').trim() ? 'yes' : 'curated_only'}`,
  );

  bootTimer = setTimeout(() => {
    void runIfDue(db, 'boot');
  }, BOOT_DELAY_MS);
  // Allow process to exit in unusual short-lived contexts
  if (typeof bootTimer.unref === 'function') bootTimer.unref();

  tickTimer = setInterval(() => {
    void runIfDue(db, 'hourly_tick');
  }, TICK_MS);
  if (typeof tickTimer.unref === 'function') tickTimer.unref();
}

/** Test/helper: stop timers (does not reset due-state). */
export function stopAnvisaDailySyncJob(): void {
  if (bootTimer) clearTimeout(bootTimer);
  if (tickTimer) clearInterval(tickTimer);
  bootTimer = null;
  tickTimer = null;
  started = false;
  running = false;
}
