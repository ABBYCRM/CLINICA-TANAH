import { describe, expect, it, beforeAll } from 'vitest';
import { initSchema, db, DEFAULT_TENANT_ID } from '../src/db/schema';
import {
  ensureAnvisaSanitaryAlerts,
  getMatchedAlertsForTenant,
  matchAlertsToInventory,
  normalizeRegistry,
  syncAnvisaSanitaryAlerts,
} from '../src/services/anvisaSanitaryAlerts';

describe('anvisaSanitaryAlerts', () => {
  beforeAll(() => {
    initSchema();
  });

  it('normalizes ANVISA registry digits', () => {
    expect(normalizeRegistry('1.0043.0011.001-1')).toBe('1004300110011');
    expect(normalizeRegistry('1.0043.0011.001-1')).toBe(normalizeRegistry('1004300110011'));
  });

  it('seeds curated catalog idempotently', () => {
    const first = ensureAnvisaSanitaryAlerts(db);
    expect(first.total).toBeGreaterThanOrEqual(5);
    const second = ensureAnvisaSanitaryAlerts(db);
    expect(second.total).toBe(first.total);
  });

  it('matches alerts to inventory by registry and excludes unrelated', () => {
    const inventory = [
      {
        id: 'i1',
        sku: 'MED-001',
        name: 'Dipirona Sódica 500mg (caixa c/ 20 cp)',
        anvisa_registry: '1.0043.0011.001-1',
        batches: [{ batch_number: 'A24011' }],
      },
      {
        id: 'i2',
        sku: 'MED-X',
        name: 'Outro produto',
        anvisa_registry: '9.9999.9999.999-9',
        batches: [],
      },
    ];
    const alerts = [
      {
        id: 'a1',
        source: 'test',
        alert_code: 'T1',
        title: 'Recolhimento Dipirona',
        alert_type: 'recall',
        severity: 'critical',
        product_name: 'Dipirona Sódica 500mg',
        active_ingredient: 'Dipirona sódica',
        anvisa_registry: '1.0043.0011.001-1',
        batch_numbers: ['A24011'],
        holder: null,
        published_at: '2024-01-01',
        action_required: 'Recolher',
        source_url: 'https://www.gov.br/anvisa',
        status: 'active',
      },
      {
        id: 'a2',
        source: 'test',
        alert_code: 'T2',
        title: 'Insulina',
        alert_type: 'recall',
        severity: 'high',
        product_name: 'Insulina glargina',
        active_ingredient: 'Insulina glargina',
        anvisa_registry: '1.9999.0000.999-9',
        batch_numbers: [],
        holder: null,
        published_at: '2024-01-01',
        action_required: null,
        source_url: null,
        status: 'active',
      },
    ];
    const matched = matchAlertsToInventory(alerts, inventory);
    expect(matched.map((m) => m.id)).toEqual(['a1']);
    expect(matched[0].matched_items[0].matched_batches).toContain('A24011');
    expect(matched[0].match_reason).toMatch(/anvisa_registry|batch_number/);
  });

  it('matches seed inventory after schema init', () => {
    // Seed may or may not have run; insert a known item if missing
    const existing = db.prepare(`
      SELECT id FROM inventory_items WHERE anvisa_registry = ? AND tenant_id = ?
    `).get('1.0043.0011.001-1', DEFAULT_TENANT_ID) as any;

    if (!existing) {
      db.prepare(`
        INSERT INTO inventory_items (
          id, tenant_id, sku, name, category, unit, anvisa_registry,
          controlled, min_stock, max_stock, unit_cost, sale_price, active
        ) VALUES ('test-dip', ?, 'MED-TEST-DIP', 'Dipirona Sódica 500mg', 'medication', 'caixa',
                  '1.0043.0011.001-1', 0, 1, 10, 1, 2, 1)
      `).run(DEFAULT_TENANT_ID);
    }

    ensureAnvisaSanitaryAlerts(db);
    const matched = getMatchedAlertsForTenant(db, DEFAULT_TENANT_ID);
    expect(matched.length).toBeGreaterThanOrEqual(1);
    expect(matched.some((m) => /dipirona/i.test(m.title) || /dipirona/i.test(m.product_name || ''))).toBe(true);
    // insulin demo alert must not match
    expect(matched.some((m) => /insulina/i.test(m.title))).toBe(false);
  });

  it('sync refreshes curated catalog', async () => {
    const result = await syncAnvisaSanitaryAlerts(db);
    expect(result.ok).toBe(true);
    expect(result.total_active).toBeGreaterThanOrEqual(5);
    expect(result.synced_at).toBeTruthy();
  });
});
