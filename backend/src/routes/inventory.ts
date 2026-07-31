import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate);

const itemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['medication','supply','equipment','consumable']),
  unit: z.string().min(1),
  anvisa_registry: z.string().optional().nullable(),
  controlled: z.boolean().optional().default(false),
  min_stock: z.number().min(0).default(0),
  max_stock: z.number().min(0).default(0),
  unit_cost: z.number().min(0).default(0),
  sale_price: z.number().min(0).default(0),
});

const batchSchema = z.object({
  item_id: z.string().min(1),
  batch_number: z.string().min(1),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.number().positive(),
  vendor_id: z.string().optional().nullable(),
  purchase_order_id: z.string().optional().nullable(),
  cost_per_unit: z.number().min(0),
});

const movementSchema = z.object({
  item_id: z.string().min(1),
  batch_id: z.string().optional().nullable(),
  movement_type: z.enum(['in','out','adjust','transfer','discard']),
  quantity: z.number(),
  reason: z.string().optional().nullable(),
  reference_id: z.string().optional().nullable(),
});

const vendorSchema = z.object({
  legal_name: z.string().min(1),
  trade_name: z.string().optional().nullable(),
  cnpj: z.string().regex(/^\d{14}$/),
  state_registration: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  contact_name: z.string().optional().nullable(),
  anvisa_license: z.string().optional().nullable(),
  address_zip: z.string().optional().nullable(),
  address_street: z.string().optional().nullable(),
  address_number: z.string().optional().nullable(),
  address_city: z.string().optional().nullable(),
  address_state: z.string().optional().nullable(),
  bank_info: z.any().optional().nullable(),
});

router.get('/items', (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  const category = req.query.category as string | undefined;
  let sql = `SELECT * FROM inventory_items WHERE active = 1 AND tenant_id = ?`;
  const args: any[] = [req.tenantId];
  if (q) { sql += ` AND (name LIKE ? OR sku LIKE ?)`; const like = `%${q}%`; args.push(like, like); }
  if (category) { sql += ` AND category = ?`; args.push(category); }
  sql += ` ORDER BY name ASC`;
  const items = db.prepare(sql).all(...args) as any[];

  // Compute current stock per item (sum of batch quantities, excluding discarded)
  for (const it of items) {
    const row = db.prepare(`
      SELECT COALESCE(SUM(b.quantity), 0) AS total
      FROM inventory_batches b
      WHERE b.item_id = ? AND date(b.expiry_date) >= date('now')
    `).get(it.id) as any; // batches are already tenant-scoped via the item
    it.current_stock = row.total;
    it.low_stock = it.current_stock < it.min_stock;
  }
  res.json({ items });
});

router.post('/items', requireRole('admin','pharmacist'), (req: Request, res: Response) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  try {
    db.prepare(`
      INSERT INTO inventory_items (id, tenant_id, sku, name, category, unit, anvisa_registry, controlled,
                                    min_stock, max_stock, unit_cost, sale_price)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, req.tenantId, d.sku, d.name, d.category, d.unit, d.anvisa_registry ?? null, d.controlled ? 1 : 0,
           d.min_stock, d.max_stock, d.unit_cost, d.sale_price);
  } catch (e: any) {
    res.status(409).json({ error: 'duplicate_sku', message: e.message });
    return;
  }
  logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'create_inventory_item',
             resourceType: 'inventory_item', resourceId: id, afterValue: d, legalBasis: 'contract_art7_V' });
  res.status(201).json({ id });
});

router.put('/items/:id', requireRole('admin','pharmacist'), (req: Request, res: Response) => {
  const parsed = itemSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of ['sku','name','category','unit','anvisa_registry','min_stock','max_stock','unit_cost','sale_price']) {
    if ((d as any)[k] !== undefined) { sets.push(`${k} = ?`); args.push((d as any)[k]); }
  }
  if (d.controlled !== undefined) { sets.push(`controlled = ?`); args.push(d.controlled ? 1 : 0); }
  if (!sets.length) { res.json({ ok: true, noop: true }); return; }
  sets.push(`updated_at = ?`); args.push(new Date().toISOString()); args.push(req.params.id);
  db.prepare(`UPDATE inventory_items SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...args, req.tenantId);
  res.json({ ok: true });
});

// Delete an item: soft-deactivate when it has stock history (keeps the
// audit trail / ANVISA traceability), hard delete only when never used.
router.delete('/items/:id', requireRole('admin','pharmacist'), (req: Request, res: Response) => {
  const item = db.prepare(`SELECT id, name FROM inventory_items WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!item) { res.status(404).json({ error: 'not_found' }); return; }
  const refs = (db.prepare(`
    SELECT (SELECT COUNT(*) FROM inventory_batches WHERE item_id = ?) +
           (SELECT COUNT(*) FROM stock_movements WHERE item_id = ?) AS c
  `).get(req.params.id, req.params.id) as any).c;
  if (refs > 0) {
    db.prepare(`UPDATE inventory_items SET active = 0, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(new Date().toISOString(), req.params.id, req.tenantId);
    logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'deactivate_inventory_item',
               resourceType: 'inventory_item', resourceId: req.params.id, beforeValue: { name: item.name },
               legalBasis: 'legal_obligation_art7_II' });
    res.json({ ok: true, soft_deleted: true });
    return;
  }
  db.prepare(`DELETE FROM inventory_items WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'delete_inventory_item',
             resourceType: 'inventory_item', resourceId: req.params.id, beforeValue: { name: item.name },
             legalBasis: 'legal_obligation_art7_II' });
  res.json({ ok: true, soft_deleted: false });
});

router.get('/batches', (req: Request, res: Response) => {
  const itemId = req.query.item_id as string | undefined;
  const expiringSoon = req.query.expiring_soon === 'true';
  let sql = `SELECT b.*, i.name AS item_name, i.sku, i.unit, i.category
             FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
             WHERE b.tenant_id = ?`;
  const args: any[] = [req.tenantId];
  const conds: string[] = [];
  if (itemId) { conds.push(`b.item_id = ?`); args.push(itemId); }
  if (expiringSoon) { conds.push(`date(b.expiry_date) <= date('now', '+30 days')`); }
  if (conds.length) sql += ` AND ` + conds.join(' AND ');
  sql += ` ORDER BY b.expiry_date ASC`;
  res.json({ batches: db.prepare(sql).all(...args) });
});

router.post('/batches', requireRole('admin','pharmacist'), (req: Request, res: Response) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO inventory_batches (id, tenant_id, item_id, batch_number, expiry_date, quantity, vendor_id, purchase_order_id, cost_per_unit)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(id, req.tenantId, d.item_id, d.batch_number, d.expiry_date, d.quantity, d.vendor_id ?? null, d.purchase_order_id ?? null, d.cost_per_unit);
    db.prepare(`
      INSERT INTO stock_movements (id, tenant_id, item_id, batch_id, movement_type, quantity, reason, reference_id, user_id)
      VALUES (?, ?, ?, ?, 'in', ?, 'purchase', ?, ?)
    `).run(uuid(), req.tenantId, d.item_id, id, d.quantity, d.purchase_order_id ?? null, req.user!.id);
  });
  tx();
  res.status(201).json({ id });
});

// Update batch metadata (quantity changes only happen through movements)
router.put('/batches/:id', requireRole('admin','pharmacist'), (req: Request, res: Response) => {
  const batch = db.prepare(`SELECT * FROM inventory_batches WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!batch) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = batchSchema.omit({ item_id: true, quantity: true }).partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of ['batch_number','expiry_date','vendor_id','cost_per_unit'] as const) {
    if (d[k] !== undefined) { sets.push(`${k} = ?`); args.push(d[k]); }
  }
  if (!sets.length) { res.json({ ok: true, noop: true }); return; }
  args.push(req.params.id);
  db.prepare(`UPDATE inventory_batches SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'update_inventory_batch',
             resourceType: 'inventory_batch', resourceId: req.params.id, legalBasis: 'contract_art7_V' });
  res.json({ ok: true });
});

// Delete a batch — remaining stock is written off with a discard movement
router.delete('/batches/:id', requireRole('admin','pharmacist'), (req: Request, res: Response) => {
  const batch = db.prepare(`SELECT * FROM inventory_batches WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!batch) { res.status(404).json({ error: 'not_found' }); return; }
  const tx = db.transaction(() => {
    if (batch.quantity > 0) {
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, item_id, batch_id, movement_type, quantity, reason, user_id)
        VALUES (?, ?, ?, ?, 'discard', ?, 'batch_deleted', ?)
      `).run(uuid(), req.tenantId, batch.item_id, batch.id, batch.quantity, req.user!.id);
    }
    db.prepare(`UPDATE stock_movements SET batch_id = NULL WHERE batch_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM inventory_batches WHERE id = ?`).run(req.params.id);
  });
  tx();
  logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'delete_inventory_batch',
             resourceType: 'inventory_batch', resourceId: req.params.id,
             beforeValue: { batch_number: batch.batch_number, quantity: batch.quantity },
             legalBasis: 'legal_obligation_art7_II' });
  res.json({ ok: true, deleted_id: req.params.id, written_off: batch.quantity });
});

// Stock movement — actually adjusts batch stock (FEFO when no batch given)
router.post('/movements', requireRole('admin','pharmacist','nurse','doctor'), (req: Request, res: Response) => {
  const parsed = movementSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  if (d.quantity <= 0) { res.status(400).json({ error: 'validation', message: 'quantity must be positive' }); return; }
  const item = db.prepare(`SELECT id FROM inventory_items WHERE id = ? AND active = 1 AND tenant_id = ?`).get(d.item_id, req.tenantId) as any;
  if (!item) { res.status(404).json({ error: 'item_not_found' }); return; }

  const id = uuid();
  try {
    const tx = db.transaction(() => {
      if (d.movement_type === 'in') {
        if (!d.batch_id) throw Object.assign(new Error('batch_id_required'), { code: 'batch_id_required' });
        const b = db.prepare(`SELECT id FROM inventory_batches WHERE id = ? AND item_id = ?`).get(d.batch_id, d.item_id);
        if (!b) throw Object.assign(new Error('batch_not_found'), { code: 'batch_not_found' });
        db.prepare(`UPDATE inventory_batches SET quantity = quantity + ? WHERE id = ?`).run(d.quantity, d.batch_id);
      } else if (d.movement_type === 'out' || d.movement_type === 'discard') {
        let remaining = d.quantity;
        const batches = d.batch_id
          ? db.prepare(`SELECT * FROM inventory_batches WHERE id = ? AND item_id = ?`).all(d.batch_id, d.item_id) as any[]
          // FEFO — first-to-expire-first-out
          : db.prepare(`SELECT * FROM inventory_batches WHERE item_id = ? AND quantity > 0 ORDER BY date(expiry_date) ASC`).all(d.item_id) as any[];
        for (const b of batches) {
          if (remaining <= 0) break;
          const take = Math.min(b.quantity, remaining);
          db.prepare(`UPDATE inventory_batches SET quantity = quantity - ? WHERE id = ?`).run(take, b.id);
          remaining -= take;
        }
        if (remaining > 0) throw Object.assign(new Error('insufficient_stock'), { code: 'insufficient_stock' });
      } else if (d.movement_type === 'adjust') {
        if (!d.batch_id) throw Object.assign(new Error('batch_id_required'), { code: 'batch_id_required' });
        db.prepare(`UPDATE inventory_batches SET quantity = ? WHERE id = ? AND item_id = ?`).run(d.quantity, d.batch_id, d.item_id);
      }
      // 'transfer' records the movement without changing totals (same clinic)
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, item_id, batch_id, movement_type, quantity, reason, reference_id, user_id)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(id, req.tenantId, d.item_id, d.batch_id ?? null, d.movement_type, d.quantity, d.reason ?? null, d.reference_id ?? null, req.user!.id);
    });
    tx();
  } catch (e: any) {
    if (e.code === 'insufficient_stock') { res.status(409).json({ error: 'insufficient_stock' }); return; }
    if (e.code === 'batch_id_required') { res.status(400).json({ error: 'batch_id_required' }); return; }
    if (e.code === 'batch_not_found') { res.status(404).json({ error: 'batch_not_found' }); return; }
    throw e;
  }
  logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: `stock_${d.movement_type}`,
             resourceType: 'inventory_item', resourceId: d.item_id, afterValue: { quantity: d.quantity },
             legalBasis: 'contract_art7_V' });
  res.status(201).json({ id });
});

router.get('/movements', (req: Request, res: Response) => {
  const itemId = req.query.item_id as string | undefined;
  let sql = `SELECT m.*, i.name AS item_name, u.full_name AS user_name FROM stock_movements m
             JOIN inventory_items i ON i.id = m.item_id
             LEFT JOIN users u ON u.id = m.user_id
             WHERE m.tenant_id = ?`;
  const args: any[] = [req.tenantId];
  if (itemId) { sql += ` AND m.item_id = ?`; args.push(itemId); }
  sql += ` ORDER BY m.created_at DESC LIMIT 200`;
  res.json({ movements: db.prepare(sql).all(...args) });
});

router.get('/alerts', (req: Request, res: Response) => {
  const lowStock = db.prepare(`
    SELECT i.id, i.sku, i.name, i.min_stock, COALESCE(SUM(b.quantity), 0) AS current_stock
    FROM inventory_items i
    LEFT JOIN inventory_batches b ON b.item_id = i.id AND date(b.expiry_date) >= date('now')
    WHERE i.active = 1 AND i.tenant_id = ?
    GROUP BY i.id
    HAVING current_stock < i.min_stock
  `).all(req.tenantId);
  const expiring = db.prepare(`
    SELECT b.id, b.batch_number, b.expiry_date, b.quantity, i.name AS item_name, i.sku,
           CAST(julianday(b.expiry_date) - julianday('now') AS INTEGER) AS days_to_expiry
    FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
    WHERE date(b.expiry_date) <= date('now', '+30 days') AND b.tenant_id = ?
    ORDER BY b.expiry_date ASC
  `).all(req.tenantId);
  res.json({ low_stock: lowStock, expiring_soon: expiring });
});

// VENDORS
router.get('/vendors', (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  let sql = `SELECT * FROM vendors WHERE active = 1 AND tenant_id = ?`;
  const args: any[] = [req.tenantId];
  if (q) { sql += ` AND (legal_name LIKE ? OR trade_name LIKE ? OR cnpj LIKE ?)`; const l = `%${q}%`; args.push(l, l, l); }
  sql += ` ORDER BY legal_name ASC`;
  res.json({ vendors: db.prepare(sql).all(...args) });
});

router.post('/vendors', requireRole('admin','pharmacist','accountant'), (req: Request, res: Response) => {
  const parsed = vendorSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  try {
    db.prepare(`
      INSERT INTO vendors (id, tenant_id, legal_name, trade_name, cnpj, state_registration, phone, email, contact_name,
                           anvisa_license, address_zip, address_street, address_number, address_city, address_state, bank_info)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, req.tenantId, d.legal_name, d.trade_name ?? null, d.cnpj, d.state_registration ?? null,
           d.phone ?? null, d.email ?? null, d.contact_name ?? null, d.anvisa_license ?? null,
           d.address_zip ?? null, d.address_street ?? null, d.address_number ?? null,
           d.address_city ?? null, d.address_state ?? null,
           d.bank_info ? JSON.stringify(d.bank_info) : null);
  } catch (e: any) {
    res.status(409).json({ error: 'duplicate_cnpj', message: e.message });
    return;
  }
  res.status(201).json({ id });
});

router.put('/vendors/:id', requireRole('admin','pharmacist','accountant'), (req: Request, res: Response) => {
  const vendor = db.prepare(`SELECT id FROM vendors WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!vendor) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = vendorSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of ['legal_name','trade_name','cnpj','state_registration','phone','email','contact_name',
                   'anvisa_license','address_zip','address_street','address_number','address_city','address_state'] as const) {
    if (d[k] !== undefined) { sets.push(`${k} = ?`); args.push(d[k]); }
  }
  if (d.bank_info !== undefined) { sets.push(`bank_info = ?`); args.push(d.bank_info ? JSON.stringify(d.bank_info) : null); }
  if (!sets.length) { res.json({ ok: true, noop: true }); return; }
  try {
    args.push(req.params.id, req.tenantId);
    db.prepare(`UPDATE vendors SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...args);
  } catch (e: any) {
    res.status(409).json({ error: 'duplicate_cnpj', message: e.message });
    return;
  }
  logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'update_vendor',
             resourceType: 'vendor', resourceId: req.params.id, legalBasis: 'contract_art7_V' });
  res.json({ ok: true });
});

// Soft-deactivate when referenced (batches/POs/invoices keep their vendor),
// hard delete when never used.
router.delete('/vendors/:id', requireRole('admin','pharmacist','accountant'), (req: Request, res: Response) => {
  const vendor = db.prepare(`SELECT id, legal_name FROM vendors WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!vendor) { res.status(404).json({ error: 'not_found' }); return; }
  const refs = (db.prepare(`
    SELECT (SELECT COUNT(*) FROM inventory_batches WHERE vendor_id = ?) +
           (SELECT COUNT(*) FROM purchase_orders WHERE vendor_id = ?) +
           (SELECT COUNT(*) FROM invoices WHERE vendor_id = ?) AS c
  `).get(req.params.id, req.params.id, req.params.id) as any).c;
  if (refs > 0) {
    db.prepare(`UPDATE vendors SET active = 0 WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
    logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'deactivate_vendor',
               resourceType: 'vendor', resourceId: req.params.id, beforeValue: { legal_name: vendor.legal_name },
               legalBasis: 'legal_obligation_art7_II' });
    res.json({ ok: true, soft_deleted: true });
    return;
  }
  db.prepare(`DELETE FROM vendors WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  logAudit({
    tenantId: req.tenantId, actorId: req.user!.id, actorEmail: req.user!.email, action: 'delete_vendor',
             resourceType: 'vendor', resourceId: req.params.id, beforeValue: { legal_name: vendor.legal_name },
             legalBasis: 'legal_obligation_art7_II' });
  res.json({ ok: true, soft_deleted: false });
});

export default router;
