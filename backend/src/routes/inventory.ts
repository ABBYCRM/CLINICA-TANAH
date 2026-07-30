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
  let sql = `SELECT * FROM inventory_items WHERE active = 1`;
  const args: any[] = [];
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
    `).get(it.id) as any;
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
      INSERT INTO inventory_items (id, sku, name, category, unit, anvisa_registry, controlled,
                                    min_stock, max_stock, unit_cost, sale_price)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, d.sku, d.name, d.category, d.unit, d.anvisa_registry ?? null, d.controlled ? 1 : 0,
           d.min_stock, d.max_stock, d.unit_cost, d.sale_price);
  } catch (e: any) {
    res.status(409).json({ error: 'duplicate_sku', message: e.message });
    return;
  }
  logAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'create_inventory_item',
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
  db.prepare(`UPDATE inventory_items SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  res.json({ ok: true });
});

router.get('/batches', (req: Request, res: Response) => {
  const itemId = req.query.item_id as string | undefined;
  const expiringSoon = req.query.expiring_soon === 'true';
  let sql = `SELECT b.*, i.name AS item_name, i.sku, i.unit, i.category
             FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id`;
  const args: any[] = [];
  const conds: string[] = [];
  if (itemId) { conds.push(`b.item_id = ?`); args.push(itemId); }
  if (expiringSoon) { conds.push(`date(b.expiry_date) <= date('now', '+30 days')`); }
  if (conds.length) sql += ` WHERE ` + conds.join(' AND ');
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
      INSERT INTO inventory_batches (id, item_id, batch_number, expiry_date, quantity, vendor_id, purchase_order_id, cost_per_unit)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, d.item_id, d.batch_number, d.expiry_date, d.quantity, d.vendor_id ?? null, d.purchase_order_id ?? null, d.cost_per_unit);
    db.prepare(`
      INSERT INTO stock_movements (id, item_id, batch_id, movement_type, quantity, reason, reference_id, user_id)
      VALUES (?, ?, ?, 'in', ?, 'purchase', ?, ?)
    `).run(uuid(), d.item_id, id, d.quantity, d.purchase_order_id ?? null, req.user!.id);
  });
  tx();
  res.status(201).json({ id });
});

router.post('/movements', requireRole('admin','pharmacist','nurse','doctor'), (req: Request, res: Response) => {
  const parsed = movementSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  const id = uuid();
  db.prepare(`
    INSERT INTO stock_movements (id, item_id, batch_id, movement_type, quantity, reason, reference_id, user_id)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(id, d.item_id, d.batch_id ?? null, d.movement_type, d.quantity, d.reason ?? null, d.reference_id ?? null, req.user!.id);
  res.status(201).json({ id });
});

router.get('/movements', (req: Request, res: Response) => {
  const itemId = req.query.item_id as string | undefined;
  let sql = `SELECT m.*, i.name AS item_name, u.full_name AS user_name FROM stock_movements m
             JOIN inventory_items i ON i.id = m.item_id
             LEFT JOIN users u ON u.id = m.user_id`;
  const args: any[] = [];
  if (itemId) { sql += ` WHERE m.item_id = ?`; args.push(itemId); }
  sql += ` ORDER BY m.created_at DESC LIMIT 200`;
  res.json({ movements: db.prepare(sql).all(...args) });
});

router.get('/alerts', (req: Request, res: Response) => {
  const lowStock = db.prepare(`
    SELECT i.id, i.sku, i.name, i.min_stock, COALESCE(SUM(b.quantity), 0) AS current_stock
    FROM inventory_items i
    LEFT JOIN inventory_batches b ON b.item_id = i.id AND date(b.expiry_date) >= date('now')
    WHERE i.active = 1
    GROUP BY i.id
    HAVING current_stock < i.min_stock
  `).all();
  const expiring = db.prepare(`
    SELECT b.id, b.batch_number, b.expiry_date, b.quantity, i.name AS item_name, i.sku,
           CAST(julianday(b.expiry_date) - julianday('now') AS INTEGER) AS days_to_expiry
    FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
    WHERE date(b.expiry_date) <= date('now', '+30 days')
    ORDER BY b.expiry_date ASC
  `).all();
  res.json({ low_stock: lowStock, expiring_soon: expiring });
});

// VENDORS
router.get('/vendors', (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  let sql = `SELECT * FROM vendors WHERE active = 1`;
  const args: any[] = [];
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
      INSERT INTO vendors (id, legal_name, trade_name, cnpj, state_registration, phone, email, contact_name,
                           anvisa_license, address_zip, address_street, address_number, address_city, address_state, bank_info)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, d.legal_name, d.trade_name ?? null, d.cnpj, d.state_registration ?? null,
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

export default router;
