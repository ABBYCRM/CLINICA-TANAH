/**
 * ANVISA / Brazilian health-authority sanitary alerts & medication recalls.
 *
 * - Seeds a curated catalog (offline-safe) matching clinic inventory registries.
 * - Optionally syncs from ANVISA_ALERTS_FEED_URL (JSON array of normalized alerts).
 * - Matches active alerts to inventory by registro ANVISA, product name, ingredient, batch.
 *
 * Official portals (manual follow-up):
 *   https://www.gov.br/anvisa/pt-br/assuntos/fiscalizacao-e-monitoramento/alertas
 *   https://dados.anvisa.gov.br/dados/
 * Live ANVISA Portal APIs require Gov.br Client ID/Secret — wire via feed URL when available.
 */
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';

export type AnvisaSanitaryAlert = {
  id: string;
  source: string;
  alert_code: string | null;
  title: string;
  alert_type: string | null;
  severity: string;
  product_name: string | null;
  active_ingredient: string | null;
  anvisa_registry: string | null;
  batch_numbers: string[];
  holder: string | null;
  published_at: string | null;
  action_required: string | null;
  source_url: string | null;
  status: string;
  synced_at?: string | null;
  created_at?: string;
};

export type AnvisaAlertMatch = AnvisaSanitaryAlert & {
  match_reason: string;
  matched_items: Array<{
    id: string;
    sku: string;
    name: string;
    anvisa_registry: string | null;
    matched_batches: string[];
  }>;
};

export type SyncResult = {
  ok: boolean;
  source: string;
  upserted: number;
  total_active: number;
  matched: number;
  synced_at: string;
  error?: string;
};

const DEFAULT_PORTAL =
  'https://www.gov.br/anvisa/pt-br/assuntos/fiscalizacao-e-monitoramento/alertas';

function resolveCatalogPath(): string {
  const candidates = [
    path.join(__dirname, '../data/anvisaSanitaryAlerts.json'),
    path.join(process.cwd(), 'src/data/anvisaSanitaryAlerts.json'),
    path.join(process.cwd(), 'dist/data/anvisaSanitaryAlerts.json'),
    path.join(process.cwd(), 'backend/src/data/anvisaSanitaryAlerts.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function loadCatalog(): any[] {
  const file = resolveCatalogPath();
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : [];
}

/** Digits-only ANVISA registry for fuzzy equality (dots/dashes ignored). */
export function normalizeRegistry(reg: string | null | undefined): string {
  if (!reg) return '';
  return String(reg).replace(/\D/g, '');
}

export function tokenizeProduct(text: string | null | undefined): string[] {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !['caixa', 'unidade', 'frasco', 'pacote', 'comprimidos'].includes(w));
}

function parseBatches(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((b) => String(b).trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((b) => String(b).trim()).filter(Boolean);
    } catch { /* comma list */ }
    return raw.split(/[,;|]/).map((b) => b.trim()).filter(Boolean);
  }
  return [];
}

function normalizeAlert(raw: any, fallbackSource: string): AnvisaSanitaryAlert | null {
  const id = String(raw?.id || raw?.alert_id || '').trim();
  const title = String(raw?.title || raw?.titulo || '').trim();
  if (!id || !title) return null;
  return {
    id,
    source: String(raw?.source || fallbackSource),
    alert_code: raw?.alert_code ?? raw?.codigo ?? null,
    title,
    alert_type: raw?.alert_type ?? raw?.tipo ?? null,
    severity: String(raw?.severity || raw?.severidade || 'medium').toLowerCase(),
    product_name: raw?.product_name ?? raw?.produto ?? null,
    active_ingredient: raw?.active_ingredient ?? raw?.principio_ativo ?? null,
    anvisa_registry: raw?.anvisa_registry ?? raw?.registro ?? raw?.numero_registro ?? null,
    batch_numbers: parseBatches(raw?.batch_numbers ?? raw?.lotes),
    holder: raw?.holder ?? raw?.detentor ?? null,
    published_at: raw?.published_at ?? raw?.data_publicacao ?? null,
    action_required: raw?.action_required ?? raw?.acao ?? null,
    source_url: raw?.source_url ?? raw?.url ?? DEFAULT_PORTAL,
    status: String(raw?.status || 'active').toLowerCase(),
  };
}

export function ensureAnvisaSanitaryAlertsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anvisa_sanitary_alerts (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'anvisa_curated',
      alert_code TEXT,
      title TEXT NOT NULL,
      alert_type TEXT,
      severity TEXT NOT NULL DEFAULT 'medium',
      product_name TEXT,
      active_ingredient TEXT,
      anvisa_registry TEXT,
      batch_numbers TEXT,
      holder TEXT,
      published_at TEXT,
      action_required TEXT,
      source_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      raw_json TEXT,
      synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_anvisa_alert_status ON anvisa_sanitary_alerts(status);
    CREATE INDEX IF NOT EXISTS idx_anvisa_alert_registry ON anvisa_sanitary_alerts(anvisa_registry);

    CREATE TABLE IF NOT EXISTS anvisa_alert_sync_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_sync_at TEXT,
      last_sync_source TEXT,
      last_sync_status TEXT,
      last_sync_count INTEGER,
      last_error TEXT
    );
    INSERT OR IGNORE INTO anvisa_alert_sync_meta (id) VALUES (1);
  `);
}

function upsertAlerts(db: Database.Database, alerts: AnvisaSanitaryAlert[], syncedAt: string): number {
  const stmt = db.prepare(`
    INSERT INTO anvisa_sanitary_alerts (
      id, source, alert_code, title, alert_type, severity, product_name, active_ingredient,
      anvisa_registry, batch_numbers, holder, published_at, action_required, source_url,
      status, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source = excluded.source,
      alert_code = excluded.alert_code,
      title = excluded.title,
      alert_type = excluded.alert_type,
      severity = excluded.severity,
      product_name = excluded.product_name,
      active_ingredient = excluded.active_ingredient,
      anvisa_registry = excluded.anvisa_registry,
      batch_numbers = excluded.batch_numbers,
      holder = excluded.holder,
      published_at = excluded.published_at,
      action_required = excluded.action_required,
      source_url = excluded.source_url,
      status = excluded.status,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at
  `);

  let upserted = 0;
  const tx = db.transaction(() => {
    for (const a of alerts) {
      const info = stmt.run(
        a.id,
        a.source,
        a.alert_code,
        a.title,
        a.alert_type,
        a.severity,
        a.product_name,
        a.active_ingredient,
        a.anvisa_registry,
        JSON.stringify(a.batch_numbers || []),
        a.holder,
        a.published_at,
        a.action_required,
        a.source_url,
        a.status || 'active',
        JSON.stringify(a),
        syncedAt,
      );
      if (info.changes > 0) upserted += 1;
    }
  });
  tx();
  return upserted;
}

/** Idempotent seed from local curated ANVISA-style catalog. */
export function ensureAnvisaSanitaryAlerts(db: Database.Database): { upserted: number; total: number } {
  ensureAnvisaSanitaryAlertsSchema(db);
  const syncedAt = new Date().toISOString();
  const alerts = loadCatalog()
    .map((r) => normalizeAlert(r, 'anvisa_curated'))
    .filter((a): a is AnvisaSanitaryAlert => !!a);
  const upserted = upsertAlerts(db, alerts, syncedAt);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM anvisa_sanitary_alerts`).get() as any)?.n || 0;

  const existing = db.prepare(`SELECT last_sync_at FROM anvisa_alert_sync_meta WHERE id = 1`).get() as any;
  if (!existing?.last_sync_at) {
    db.prepare(`
      UPDATE anvisa_alert_sync_meta SET
        last_sync_at = ?, last_sync_source = 'curated_seed', last_sync_status = 'ok',
        last_sync_count = ?, last_error = NULL
      WHERE id = 1
    `).run(syncedAt, upserted);
  }
  return { upserted, total };
}

function rowToAlert(row: any): AnvisaSanitaryAlert {
  return {
    id: row.id,
    source: row.source,
    alert_code: row.alert_code,
    title: row.title,
    alert_type: row.alert_type,
    severity: row.severity,
    product_name: row.product_name,
    active_ingredient: row.active_ingredient,
    anvisa_registry: row.anvisa_registry,
    batch_numbers: parseBatches(row.batch_numbers),
    holder: row.holder,
    published_at: row.published_at,
    action_required: row.action_required,
    source_url: row.source_url,
    status: row.status,
    synced_at: row.synced_at,
    created_at: row.created_at,
  };
}

export function listActiveAlerts(db: Database.Database): AnvisaSanitaryAlert[] {
  ensureAnvisaSanitaryAlertsSchema(db);
  return (db.prepare(`
    SELECT * FROM anvisa_sanitary_alerts WHERE status = 'active' ORDER BY published_at DESC, title ASC
  `).all() as any[]).map(rowToAlert);
}

export function getSyncMeta(db: Database.Database): {
  last_sync_at: string | null;
  last_sync_source: string | null;
  last_sync_status: string | null;
  last_sync_count: number | null;
  last_error: string | null;
  portal_url: string;
} {
  ensureAnvisaSanitaryAlertsSchema(db);
  const row = db.prepare(`SELECT * FROM anvisa_alert_sync_meta WHERE id = 1`).get() as any;
  return {
    last_sync_at: row?.last_sync_at ?? null,
    last_sync_source: row?.last_sync_source ?? null,
    last_sync_status: row?.last_sync_status ?? null,
    last_sync_count: row?.last_sync_count ?? null,
    last_error: row?.last_error ?? null,
    portal_url: DEFAULT_PORTAL,
  };
}

type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  anvisa_registry: string | null;
  batches: Array<{ batch_number: string }>;
};

function loadTenantInventory(db: Database.Database, tenantId: string): InventoryItem[] {
  const items = db.prepare(`
    SELECT id, sku, name, anvisa_registry FROM inventory_items
    WHERE active = 1 AND tenant_id = ? AND category IN ('medication','consumable','supply','equipment')
  `).all(tenantId) as any[];

  const batchStmt = db.prepare(`
    SELECT batch_number FROM inventory_batches
    WHERE item_id = ? AND quantity > 0
  `);

  return items.map((it) => ({
    id: it.id,
    sku: it.sku,
    name: it.name,
    anvisa_registry: it.anvisa_registry,
    batches: (batchStmt.all(it.id) as any[]).map((b) => ({ batch_number: String(b.batch_number) })),
  }));
}

/** Match active alerts to clinic stock. Exported for tests. */
export function matchAlertsToInventory(
  alerts: AnvisaSanitaryAlert[],
  inventory: InventoryItem[],
): AnvisaAlertMatch[] {
  const matches: AnvisaAlertMatch[] = [];

  for (const alert of alerts) {
    if (alert.status && alert.status !== 'active') continue;
    const alertReg = normalizeRegistry(alert.anvisa_registry);
    const alertTokens = [
      ...tokenizeProduct(alert.product_name),
      ...tokenizeProduct(alert.active_ingredient),
    ].filter((t) => t.length >= 5);
    const alertBatches = new Set((alert.batch_numbers || []).map((b) => b.toUpperCase()));

    const matched_items: AnvisaAlertMatch['matched_items'] = [];
    const reasonSet = new Set<string>();

    for (const item of inventory) {
      const reasons: string[] = [];
      const itemReg = normalizeRegistry(item.anvisa_registry);
      if (alertReg && itemReg && alertReg === itemReg) reasons.push('anvisa_registry');

      const nameTokens = tokenizeProduct(item.name);
      if (alertTokens.some((t) => nameTokens.some((n) => n.includes(t) || t.includes(n)))) {
        reasons.push('product_name');
      }

      const matched_batches = item.batches
        .map((b) => b.batch_number)
        .filter((bn) => alertBatches.has(bn.toUpperCase()));
      if (matched_batches.length) reasons.push('batch_number');

      // Accept registry or batch hits always; name-only when registries are compatible
      const registryConflict = !!(alertReg && itemReg && alertReg !== itemReg);
      const ok =
        reasons.includes('anvisa_registry') ||
        reasons.includes('batch_number') ||
        (reasons.includes('product_name') && !registryConflict);

      if (!ok) continue;

      matched_items.push({
        id: item.id,
        sku: item.sku,
        name: item.name,
        anvisa_registry: item.anvisa_registry,
        matched_batches,
      });
      for (const r of reasons) reasonSet.add(r);
    }

    if (matched_items.length) {
      matches.push({
        ...alert,
        match_reason: [...reasonSet].join('+') || 'product_name',
        matched_items,
      });
    }
  }

  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, info: 3, low: 4 };
  matches.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));
  return matches;
}

export function getMatchedAlertsForTenant(db: Database.Database, tenantId: string): AnvisaAlertMatch[] {
  ensureAnvisaSanitaryAlertsSchema(db);
  const alerts = listActiveAlerts(db);
  const inventory = loadTenantInventory(db, tenantId);
  return matchAlertsToInventory(alerts, inventory);
}

async function fetchRemoteFeed(url: string): Promise<any[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'ClinicaTanah-ANVISA-Sync/1.0' },
    });
    if (!res.ok) throw new Error(`feed_http_${res.status}`);
    const body: any = await res.json();
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.alerts)) return body.alerts;
    if (Array.isArray(body?.data)) return body.data;
    throw new Error('feed_invalid_shape');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sync alerts from ANVISA_ALERTS_FEED_URL when set; otherwise refresh curated seed.
 * Always re-seeds curated catalog so demo/offline clinics keep coverage.
 */
export async function syncAnvisaSanitaryAlerts(db: Database.Database): Promise<SyncResult> {
  ensureAnvisaSanitaryAlertsSchema(db);
  const syncedAt = new Date().toISOString();
  const feedUrl = (process.env.ANVISA_ALERTS_FEED_URL || '').trim();

  // Always refresh curated baseline
  const curated = loadCatalog()
    .map((r) => normalizeAlert(r, 'anvisa_curated'))
    .filter((a): a is AnvisaSanitaryAlert => !!a);

  let remote: AnvisaSanitaryAlert[] = [];
  let source = 'curated_seed';
  let error: string | undefined;

  if (feedUrl) {
    try {
      const raw = await fetchRemoteFeed(feedUrl);
      remote = raw
        .map((r) => normalizeAlert(r, 'anvisa_feed'))
        .filter((a): a is AnvisaSanitaryAlert => !!a);
      source = 'anvisa_feed+curated';
    } catch (e: any) {
      error = e?.message || String(e);
      source = 'curated_seed_fallback';
    }
  }

  // Merge: remote overrides curated on same id
  const byId = new Map<string, AnvisaSanitaryAlert>();
  for (const a of curated) byId.set(a.id, a);
  for (const a of remote) byId.set(a.id, a);
  const merged = [...byId.values()];
  const upserted = upsertAlerts(db, merged, syncedAt);
  const total_active = (db.prepare(`
    SELECT COUNT(*) AS n FROM anvisa_sanitary_alerts WHERE status = 'active'
  `).get() as any)?.n || 0;

  db.prepare(`
    UPDATE anvisa_alert_sync_meta SET
      last_sync_at = ?, last_sync_source = ?, last_sync_status = ?,
      last_sync_count = ?, last_error = ?
    WHERE id = 1
  `).run(syncedAt, source, error ? 'partial' : 'ok', upserted, error ?? null);

  return {
    ok: !error || remote.length > 0 || curated.length > 0,
    source,
    upserted,
    total_active,
    matched: 0,
    synced_at: syncedAt,
    error,
  };
}
