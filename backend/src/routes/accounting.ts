import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import {
  extractInvoiceFromImage,
  invoiceUploadDir,
  isOcrableMime,
  mimeFromName,
  nvidiaKeysConfigured,
  uploadsRoot,
} from '../services/nvidiaOcr';
import {
  autoPostInvoicePaid,
  incomeStatement as ledgerIncomeStatement,
  ensureChart as ledgerEnsureChart,
} from '../services/ledger';
import { logAudit } from '../services/audit';
import { ensureDispenseAccounts } from '../services/prescriptionDispense';

const router = Router();
router.use(authenticate);

// CHART OF ACCOUNTS — Brazilian padrão
const chartOfAccounts = [
  // Assets
  { code: '1.1.01.001', name: 'Caixa Geral', type: 'asset' },
  { code: '1.1.01.002', name: 'Banco Conta Movimento', type: 'asset' },
  { code: '1.1.02.001', name: 'Contas a Receber', type: 'asset' },
  { code: '1.1.03.001', name: 'Estoque de Medicamentos', type: 'asset' },
  { code: '1.1.03.002', name: 'Estoque de Materiais', type: 'asset' },
  // Liabilities
  { code: '2.1.01.001', name: 'Fornecedores', type: 'liability' },
  { code: '2.1.02.001', name: 'Salários a Pagar', type: 'liability' },
  { code: '2.1.02.002', name: 'INSS a Recolher', type: 'liability' },
  { code: '2.1.02.003', name: 'FGTS a Recolher', type: 'liability' },
  { code: '2.1.02.004', name: 'IRRF a Recolher', type: 'liability' },
  { code: '2.1.03.001', name: 'Simples Nacional a Pagar', type: 'liability' },
  // Equity
  { code: '3.1.01.001', name: 'Capital Social', type: 'equity' },
  { code: '3.1.02.001', name: 'Lucros Acumulados', type: 'equity' },
  // Revenue
  { code: '4.1.01.001', name: 'Receita de Consultas', type: 'revenue' },
  { code: '4.1.01.002', name: 'Receita de Exames', type: 'revenue' },
  { code: '4.1.01.003', name: 'Receita de Procedimentos', type: 'revenue' },
  { code: '4.1.01.005', name: 'Receita de Medicamentos', type: 'revenue' },
  { code: '4.1.02.001', name: 'Receita de Convênios', type: 'revenue' },
  // Expenses
  { code: '5.1.01.001', name: 'Salários', type: 'expense' },
  { code: '5.1.01.002', name: 'INSS', type: 'expense' },
  { code: '5.1.01.003', name: 'FGTS', type: 'expense' },
  { code: '5.1.01.004', name: '13º Salário', type: 'expense' },
  { code: '5.1.01.005', name: 'Férias', type: 'expense' },
  { code: '5.1.02.001', name: 'Aluguel', type: 'expense' },
  { code: '5.1.02.002', name: 'Energia Elétrica', type: 'expense' },
  { code: '5.1.02.003', name: 'Água e Esgoto', type: 'expense' },
  { code: '5.1.02.004', name: 'Material de Consumo', type: 'expense' },
  { code: '5.1.02.005', name: 'Medicamentos', type: 'expense' },
  { code: '5.1.02.006', name: 'Medicamentos Consumidos (CMV)', type: 'expense' },
  { code: '5.1.03.001', name: 'Serviços Contábeis', type: 'expense' },
  { code: '5.1.03.002', name: 'Marketing', type: 'expense' },
];

const invoiceSchema = z.object({
  patient_id: z.string().optional().nullable(),
  vendor_id: z.string().optional().nullable(),
  encounter_id: z.string().optional().nullable(),
  issue_date: z.string().min(1),
  due_date: z.string().optional().nullable(),
  total: z.number().min(0),
  lines: z.array(z.object({
    description: z.string(),
    quantity: z.number().positive(),
    unit_price: z.number().min(0),
    tax_rate: z.number().min(0).max(100).default(0),
  })).min(1).optional(),
  status: z.enum(['draft','issued','paid','overdue','cancelled']).default('issued'),
  payment_method: z.string().optional().nullable(),
  /** Optional number from OCR / NF — falls back to INV-{timestamp} */
  invoice_number_override: z.string().min(1).max(80).optional(),
});

const journalEntrySchema = z.object({
  entry_date: z.string().min(1),
  description: z.string().min(1),
  reference_type: z.string().optional().nullable(),
  reference_id: z.string().optional().nullable(),
  lines: z.array(z.object({
    account_code: z.string(),
    debit: z.number().min(0).default(0),
    credit: z.number().min(0).default(0),
    description: z.string().optional().nullable(),
  })).min(2),
});

router.get('/chart', (req: Request, res: Response) => {
  ensureChart(req.tenantId!);
  res.json({ accounts: db.prepare(`SELECT * FROM chart_of_accounts WHERE tenant_id = ? ORDER BY code`).all(req.tenantId) });
});

const accountSchema = z.object({
  code: z.string().min(1).regex(/^[\d.]+$/),
  name: z.string().min(1),
  type: z.enum(['asset','liability','equity','revenue','expense']),
});

router.post('/chart', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  try {
    db.prepare(`INSERT INTO chart_of_accounts (id, tenant_id, code, name, type) VALUES (?,?,?,?,?)`).run(id, req.tenantId, d.code, d.name, d.type);
  } catch (e: any) {
    res.status(409).json({ error: 'duplicate_code', message: e.message });
    return;
  }
  res.status(201).json({ id });
});

router.put('/chart/:id', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const acc = db.prepare(`SELECT id FROM chart_of_accounts WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!acc) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = accountSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of ['code','name','type'] as const) {
    if (d[k] !== undefined) { sets.push(`${k} = ?`); args.push(d[k]); }
  }
  if (!sets.length) { res.json({ ok: true, noop: true }); return; }
  try {
    args.push(req.params.id);
    db.prepare(`UPDATE chart_of_accounts SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...args, req.tenantId);
  } catch (e: any) {
    res.status(409).json({ error: 'duplicate_code', message: e.message });
    return;
  }
  res.json({ ok: true });
});

// Deactivate when the account already has journal lines (ledger history),
// hard delete only when never posted to.
router.delete('/chart/:id', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const acc = db.prepare(`SELECT id, name FROM chart_of_accounts WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!acc) { res.status(404).json({ error: 'not_found' }); return; }
  const used = (db.prepare(`SELECT COUNT(*) AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE jl.account_id = ? AND je.tenant_id = ?`).get(req.params.id, req.tenantId) as any).c;
  if (used > 0) {
    db.prepare(`UPDATE chart_of_accounts SET active = 0 WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
    res.json({ ok: true, soft_deleted: true });
    return;
  }
  db.prepare(`DELETE FROM chart_of_accounts WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  res.json({ ok: true, soft_deleted: false });
});

router.get('/journal', (req: Request, res: Response) => {
  const from = (req.query.from as string) || new Date(Date.now() - 30*24*3600*1000).toISOString().slice(0,10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0,10);
  const entries = db.prepare(`
    SELECT * FROM journal_entries WHERE tenant_id = ? AND date(entry_date) BETWEEN ? AND ? ORDER BY entry_date DESC, entry_number DESC LIMIT 200
  `).all(req.tenantId, from, to);
  res.json({ entries });
});

router.post('/journal', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const parsed = journalEntrySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const totalDebit = d.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = d.lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    res.status(400).json({ error: 'unbalanced_entry', total_debit: totalDebit, total_credit: totalCredit });
    return;
  }
  const id = uuid();
  const entryNumber = `JE-${Date.now()}`;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, reference_type, reference_id, total_debit, total_credit, posted, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,1,?)
    `).run(id, req.tenantId, entryNumber, d.entry_date, d.description, d.reference_type ?? null, d.reference_id ?? null, totalDebit, totalCredit, req.user!.id);
    for (const ln of d.lines) {
      const acc = db.prepare(`SELECT id FROM chart_of_accounts WHERE code = ? AND tenant_id = ?`).get(ln.account_code, req.tenantId) as any;
      if (!acc) throw new Error(`Unknown account: ${ln.account_code}`);
      db.prepare(`
        INSERT INTO journal_lines (id, entry_id, account_id, debit, credit, description)
        VALUES (?,?,?,?,?,?)
      `).run(uuid(), id, acc.id, ln.debit, ln.credit, ln.description ?? null);
    }
  });
  try { tx(); } catch (e: any) {
    res.status(400).json({ error: 'journal_error', message: e.message });
    return;
  }
  res.status(201).json({ id, entry_number: entryNumber });
});

router.get('/trial-balance', (req: Request, res: Response) => {
  ensureChart(req.tenantId!);
  const to = (req.query.to as string) || new Date().toISOString().slice(0,10);
  const rows = db.prepare(`
    SELECT a.code, a.name, a.type,
           COALESCE(SUM(jl.debit), 0) AS total_debit,
           COALESCE(SUM(jl.credit), 0) AS total_credit,
           COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) AS balance
    FROM chart_of_accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jl.entry_id AND date(je.entry_date) <= ? AND je.tenant_id = a.tenant_id
    WHERE a.tenant_id = ?
    GROUP BY a.id
    ORDER BY a.code
  `).all(to, req.tenantId);
  res.json({ as_of: to, accounts: rows });
});

router.get('/income-statement', (req: Request, res: Response) => {
  ensureChart(req.tenantId!);
  ensureDispenseAccounts(req.tenantId!);
  const from = (req.query.from as string) || new Date(Date.now() - 30*24*3600*1000).toISOString().slice(0,10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0,10);
  const rows = db.prepare(`
    SELECT a.id, a.type, a.code, a.name,
           CASE
             WHEN a.type = 'revenue'
               THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
             ELSE COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)
           END AS amount
    FROM chart_of_accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jl.entry_id AND date(je.entry_date) BETWEEN ? AND ? AND je.tenant_id = a.tenant_id
    WHERE a.type IN ('revenue', 'expense') AND a.tenant_id = ? AND a.active = 1
    GROUP BY a.id
    ORDER BY a.type, a.code
  `).all(from, to, req.tenantId) as any[];
  const mapped = rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  const revenue = mapped.filter((r) => r.type === 'revenue').reduce((s, r) => s + r.amount, 0);
  const expenses = mapped.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const cogs = mapped.filter((r) => r.code === '5.1.02.006').reduce((s, r) => s + r.amount, 0);
  const medication_revenue = mapped.filter((r) => r.code === '4.1.01.005').reduce((s, r) => s + r.amount, 0);
  res.json({
    from, to,
    lines: mapped,
    total_revenue: revenue,
    total_expenses: expenses,
    cogs,
    medication_revenue,
    gross_margin: revenue - cogs,
    net_income: revenue - expenses,
  });
});

/** Internal clinic P&L with medication dispense trail summary for the period. */
router.get('/internal-pnl', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  ensureChart(req.tenantId!);
  ensureDispenseAccounts(req.tenantId!);
  const from = (req.query.from as string) || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);

  const pl = ledgerIncomeStatement(req.tenantId!, from, to);

  const dispenses = db.prepare(`
    SELECT pr.id AS prescription_id, pr.dispensed_at, pr.dispense_status,
           p.full_name AS patient_name, u.full_name AS practitioner_name,
           du.full_name AS dispensed_by_name,
           i.id AS invoice_id, i.invoice_number, i.total AS invoice_total, i.status AS invoice_status, i.paid_at
    FROM prescriptions pr
    JOIN patients p ON p.id = pr.patient_id
    JOIN users u ON u.id = pr.practitioner_id
    LEFT JOIN users du ON du.id = pr.dispensed_by
    LEFT JOIN invoices i ON i.id = pr.invoice_id
    WHERE pr.tenant_id = ?
      AND pr.dispense_status IN ('dispensed','reversed')
      AND date(COALESCE(pr.dispensed_at, pr.created_at)) BETWEEN date(?) AND date(?)
    ORDER BY pr.dispensed_at DESC
    LIMIT 200
  `).all(req.tenantId, from, to) as any[];

  const stockMoves = db.prepare(`
    SELECT m.item_id, i.name AS item_name, i.sku,
           SUM(CASE WHEN m.movement_type = 'out' THEN m.quantity ELSE 0 END) AS qty_out,
           SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE 0 END) AS qty_in
    FROM stock_movements m
    JOIN inventory_items i ON i.id = m.item_id
    WHERE m.tenant_id = ?
      AND m.reason IN ('prescription_dispense','prescription_dispense_reverse')
      AND date(m.created_at) BETWEEN date(?) AND date(?)
    GROUP BY m.item_id
    ORDER BY qty_out DESC
  `).all(req.tenantId, from, to) as any[];

  const paidTotal = dispenses
    .filter((d) => d.invoice_status === 'paid')
    .reduce((s, d) => s + Number(d.invoice_total || 0), 0);
  const issuedTotal = dispenses
    .filter((d) => d.invoice_status === 'issued')
    .reduce((s, d) => s + Number(d.invoice_total || 0), 0);

  res.json({
    from, to,
    pnl: pl,
    medication: {
      revenue: pl.medication_revenue,
      cogs: pl.cogs,
      gross_margin: Number(pl.medication_revenue || 0) - Number(pl.cogs || 0),
      invoices_paid_total: paidTotal,
      invoices_open_total: issuedTotal,
      dispense_count: dispenses.length,
    },
    dispenses,
    stock_by_item: stockMoves,
  });
});

const dreLineCreateSchema = z.object({
  type: z.enum(['revenue', 'expense']),
  name: z.string().min(1).max(120),
  amount: z.number().min(0).default(0),
  entry_date: z.string().optional(),
});

const dreLineAmountSchema = z.object({
  amount: z.number().min(0),
  entry_date: z.string().optional(),
});

function nextPlCode(_tenantId: string, type: 'revenue' | 'expense'): string {
  const prefix = type === 'revenue' ? '4.9.' : '5.9.';
  for (let i = 1; i < 10000; i++) {
    const code = `${prefix}${String(i).padStart(3, '0')}`;
    const exists = db.prepare(`SELECT id FROM chart_of_accounts WHERE code = ?`).get(code);
    if (!exists) return code;
  }
  return `${prefix}${Date.now()}`;
}

function cashAccountId(tenantId: string): string {
  ensureChart(tenantId);
  const cash = db.prepare(`
    SELECT id FROM chart_of_accounts WHERE tenant_id = ? AND code = '1.1.01.001'
  `).get(tenantId) as { id: string } | undefined;
  if (!cash) throw new Error('cash_account_missing');
  return cash.id;
}

/** Replace the period DRE amount for an account with a balanced cash journal. */
function syncDreAmount(opts: {
  tenantId: string;
  userId: string;
  accountId: string;
  amount: number;
  entryDate: string;
}): void {
  const acc = db.prepare(`
    SELECT id, code, name, type FROM chart_of_accounts
    WHERE id = ? AND tenant_id = ? AND type IN ('revenue','expense') AND active = 1
  `).get(opts.accountId, opts.tenantId) as any;
  if (!acc) throw new Error('account_not_found');

  const old = db.prepare(`
    SELECT id FROM journal_entries
    WHERE tenant_id = ? AND reference_type = 'dre_line' AND reference_id = ?
  `).all(opts.tenantId, opts.accountId) as Array<{ id: string }>;
  for (const e of old) {
    db.prepare(`DELETE FROM journal_lines WHERE entry_id = ?`).run(e.id);
    db.prepare(`DELETE FROM journal_entries WHERE id = ?`).run(e.id);
  }

  const amount = Math.round(opts.amount * 100) / 100;
  if (amount <= 0) return;

  const cashId = cashAccountId(opts.tenantId);
  const entryId = uuid();
  const entryNumber = `DRE-${Date.now()}`;
  const desc = `DRE · ${acc.name}`;
  db.prepare(`
    INSERT INTO journal_entries
      (id, tenant_id, entry_number, entry_date, description, reference_type, reference_id, total_debit, total_credit, posted, created_by)
    VALUES (?,?,?,?,?,'dre_line',?,?,?,1,?)
  `).run(entryId, opts.tenantId, entryNumber, opts.entryDate, desc, opts.accountId, amount, amount, opts.userId);

  if (acc.type === 'revenue') {
    // Debit cash / Credit revenue
    db.prepare(`INSERT INTO journal_lines (id, entry_id, account_id, debit, credit, description) VALUES (?,?,?,?,?,?)`)
      .run(uuid(), entryId, cashId, amount, 0, desc);
    db.prepare(`INSERT INTO journal_lines (id, entry_id, account_id, debit, credit, description) VALUES (?,?,?,?,?,?)`)
      .run(uuid(), entryId, acc.id, 0, amount, desc);
  } else {
    // Debit expense / Credit cash
    db.prepare(`INSERT INTO journal_lines (id, entry_id, account_id, debit, credit, description) VALUES (?,?,?,?,?,?)`)
      .run(uuid(), entryId, acc.id, amount, 0, desc);
    db.prepare(`INSERT INTO journal_lines (id, entry_id, account_id, debit, credit, description) VALUES (?,?,?,?,?,?)`)
      .run(uuid(), entryId, cashId, 0, amount, desc);
  }
}

router.post('/income-statement/lines', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  ensureChart(req.tenantId!);
  const parsed = dreLineCreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const entryDate = d.entry_date || new Date().toISOString().slice(0, 10);
  const id = uuid();
  const code = nextPlCode(req.tenantId!, d.type);
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO chart_of_accounts (id, tenant_id, code, name, type, active)
        VALUES (?,?,?,?,?,1)
      `).run(id, req.tenantId, code, d.name.trim(), d.type);
      syncDreAmount({
        tenantId: req.tenantId!,
        userId: req.user!.id,
        accountId: id,
        amount: d.amount,
        entryDate,
      });
    });
    tx();
  } catch (e: any) {
    res.status(400).json({ error: 'dre_line_error', message: e.message });
    return;
  }
  res.status(201).json({ id, code, type: d.type, name: d.name.trim(), amount: d.amount });
});

router.put('/income-statement/lines/:id', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  ensureChart(req.tenantId!);
  const parsed = dreLineAmountSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const entryDate = parsed.data.entry_date || new Date().toISOString().slice(0, 10);
  try {
    const tx = db.transaction(() => {
      syncDreAmount({
        tenantId: req.tenantId!,
        userId: req.user!.id,
        accountId: req.params.id,
        amount: parsed.data.amount,
        entryDate,
      });
    });
    tx();
  } catch (e: any) {
    const status = e.message === 'account_not_found' ? 404 : 400;
    res.status(status).json({ error: e.message });
    return;
  }
  res.json({ ok: true, id: req.params.id, amount: parsed.data.amount });
});

router.delete('/income-statement/lines/:id', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  const acc = db.prepare(`
    SELECT id, name, type FROM chart_of_accounts
    WHERE id = ? AND tenant_id = ? AND type IN ('revenue','expense')
  `).get(req.params.id, req.tenantId) as any;
  if (!acc) { res.status(404).json({ error: 'not_found' }); return; }

  const tx = db.transaction(() => {
    // Remove DRE-managed journals for this line
    const old = db.prepare(`
      SELECT id FROM journal_entries
      WHERE tenant_id = ? AND reference_type = 'dre_line' AND reference_id = ?
    `).all(req.tenantId, req.params.id) as Array<{ id: string }>;
    for (const e of old) {
      db.prepare(`DELETE FROM journal_lines WHERE entry_id = ?`).run(e.id);
      db.prepare(`DELETE FROM journal_entries WHERE id = ?`).run(e.id);
    }

    const otherUse = (db.prepare(`
      SELECT COUNT(*) AS c FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      WHERE jl.account_id = ? AND je.tenant_id = ?
    `).get(req.params.id, req.tenantId) as any).c;

    if (otherUse > 0) {
      db.prepare(`UPDATE chart_of_accounts SET active = 0 WHERE id = ? AND tenant_id = ?`)
        .run(req.params.id, req.tenantId);
      return { soft_deleted: true };
    }
    db.prepare(`DELETE FROM chart_of_accounts WHERE id = ? AND tenant_id = ?`)
      .run(req.params.id, req.tenantId);
    return { soft_deleted: false };
  });

  const result = tx();
  res.json({ ok: true, ...result });
});

// INVOICES
router.get('/invoices', (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const q = (req.query.q as string || '').trim();
  let sql = `
    SELECT i.*, p.full_name AS patient_name,
           (SELECT COUNT(*) FROM invoice_documents d WHERE d.invoice_id = i.id) AS document_count
    FROM invoices i
    LEFT JOIN patients p ON p.id = i.patient_id
    WHERE i.tenant_id = ?`;
  const args: any[] = [req.tenantId];
  if (status) { sql += ` AND i.status = ?`; args.push(status); }
  if (q) {
    sql += ` AND (i.invoice_number LIKE ? OR p.full_name LIKE ? OR CAST(i.total AS TEXT) LIKE ?)`;
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  sql += ` ORDER BY i.issue_date DESC, i.created_at DESC LIMIT 200`;
  res.json({ invoices: db.prepare(sql).all(...args), ocr_ready: nvidiaKeysConfigured() });
});

router.get('/invoices/ocr/status', (_req: Request, res: Response) => {
  res.json({
    ready: nvidiaKeysConfigured(),
    model: process.env.NVIDIA_OCR_MODEL || 'nvidia/nemotron-nano-12b-v2-vl',
    accepts: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'],
  });
});

const uploadSchema = z.object({
  filename: z.string().min(1).max(260),
  mime: z.string().min(3).max(120).optional(),
  data_base64: z.string().min(32),
  run_ocr: z.boolean().optional().default(true),
});

/** NVIDIA vision OCR — extract invoice fields from an uploaded image (does not persist). */
router.post('/invoices/ocr', requireRole('admin', 'accountant', 'receptionist'), async (req: Request, res: Response) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  if (!nvidiaKeysConfigured()) {
    res.status(503).json({ error: 'nvidia_api_key_missing', message: 'Configure NVIDIA_API_KEYS for OCR.' });
    return;
  }
  const mime = parsed.data.mime || mimeFromName(parsed.data.filename);
  if (!isOcrableMime(mime)) {
    res.status(400).json({
      error: 'ocr_unsupported_type',
      message: 'OCR supports JPEG/PNG/WebP/GIF. PDF can be attached after creating the invoice.',
    });
    return;
  }
  let buffer: Buffer;
  try {
    const raw = parsed.data.data_base64.replace(/^data:[^;]+;base64,/, '');
    buffer = Buffer.from(raw, 'base64');
  } catch {
    res.status(400).json({ error: 'invalid_base64' });
    return;
  }
  try {
    const extraction = await extractInvoiceFromImage({
      buffer, mime, filename: parsed.data.filename,
    });
    // Best-effort patient match for the UI
    let matched_patient: any = null;
    if (extraction.patient_name) {
      matched_patient = db.prepare(`
        SELECT id, full_name, phone, cpf FROM patients
        WHERE tenant_id = ? AND full_name LIKE ?
        ORDER BY full_name ASC LIMIT 1
      `).get(req.tenantId, `%${extraction.patient_name.split(' ')[0]}%`);
    }
    res.json({ extraction, matched_patient, ocr_ready: true });
  } catch (e: any) {
    res.status(e.status && e.status < 500 ? e.status : 502).json({
      error: e.code || 'nvidia_ocr_failed',
      message: e.message,
    });
  }
});

router.get('/invoices/:id', (req: Request, res: Response) => {
  const inv = db.prepare(`
    SELECT i.*, p.full_name AS patient_name
    FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id
    WHERE i.id = ? AND i.tenant_id = ?
  `).get(req.params.id, req.tenantId) as any;
  if (!inv) { res.status(404).json({ error: 'not_found' }); return; }
  const lines = db.prepare(`SELECT * FROM invoice_lines WHERE invoice_id = ?`).all(req.params.id);
  const documents = db.prepare(`
    SELECT id, original_name, mime_type, size_bytes, ocr_status, ocr_model, ocr_error, created_at
    FROM invoice_documents WHERE invoice_id = ? AND tenant_id = ? ORDER BY created_at DESC
  `).all(req.params.id, req.tenantId);
  res.json({ invoice: inv, lines, documents, ocr_ready: nvidiaKeysConfigured() });
});

router.post('/invoices', requireRole('admin','accountant','receptionist'), (req: Request, res: Response) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  const invoiceNumber = d.invoice_number_override || `INV-${Date.now()}`;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO invoices (id, tenant_id, invoice_number, patient_id, vendor_id, encounter_id, issue_date, due_date, total, status, payment_method)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, req.tenantId, invoiceNumber, d.patient_id ?? null, d.vendor_id ?? null, d.encounter_id ?? null,
           d.issue_date, d.due_date ?? null, d.total, d.status, d.payment_method ?? null);
    if (d.lines) {
      for (const ln of d.lines) {
        db.prepare(`
          INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_price, tax_rate)
          VALUES (?,?,?,?,?,?)
        `).run(uuid(), id, ln.description, ln.quantity, ln.unit_price, ln.tax_rate);
      }
    }
  });
  try { tx(); } catch (e: any) {
    res.status(409).json({ error: 'duplicate_invoice', message: e.message });
    return;
  }
  res.status(201).json({ id, invoice_number: invoiceNumber });
});

/** Attach a document to an invoice; optionally run NVIDIA OCR and merge fields. */
router.post('/invoices/:id/documents', requireRole('admin', 'accountant', 'receptionist'), async (req: Request, res: Response) => {
  const inv = db.prepare(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!inv) { res.status(404).json({ error: 'not_found' }); return; }
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }

  const mime = parsed.data.mime || mimeFromName(parsed.data.filename);
  let buffer: Buffer;
  try {
    const raw = parsed.data.data_base64.replace(/^data:[^;]+;base64,/, '');
    buffer = Buffer.from(raw, 'base64');
  } catch {
    res.status(400).json({ error: 'invalid_base64' });
    return;
  }
  if (buffer.length > 8 * 1024 * 1024) {
    res.status(400).json({ error: 'file_too_large', message: 'Max 8MB' });
    return;
  }

  const docId = uuid();
  const safeName = parsed.data.filename.replace(/[^\w.\-()\sÀ-ÿ]+/g, '_').slice(0, 180);
  const dir = invoiceUploadDir(req.tenantId!, inv.id);
  const storageName = `${docId}_${safeName}`;
  const storagePath = path.join(dir, storageName);
  fs.writeFileSync(storagePath, buffer);

  let ocrStatus: string = parsed.data.run_ocr && isOcrableMime(mime) ? 'processing' : 'skipped';
  let ocrModel: string | null = null;
  let ocrRaw: string | null = null;
  let ocrJson: string | null = null;
  let ocrError: string | null = null;
  let extraction: any = null;

  if (parsed.data.run_ocr && isOcrableMime(mime)) {
    if (!nvidiaKeysConfigured()) {
      ocrStatus = 'failed';
      ocrError = 'nvidia_api_key_missing';
    } else {
      try {
        extraction = await extractInvoiceFromImage({ buffer, mime, filename: safeName });
        ocrStatus = 'done';
        ocrModel = extraction.model;
        ocrRaw = extraction.raw_text;
        ocrJson = JSON.stringify(extraction);
      } catch (e: any) {
        ocrStatus = 'failed';
        ocrError = e.message || 'nvidia_ocr_failed';
      }
    }
  } else if (mime === 'application/pdf') {
    ocrStatus = 'skipped';
    ocrError = 'pdf_ocr_convert_to_image';
  }

  db.prepare(`
    INSERT INTO invoice_documents
      (id, tenant_id, invoice_id, original_name, mime_type, size_bytes, storage_path,
       ocr_status, ocr_model, ocr_raw_text, ocr_json, ocr_error, uploaded_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    docId, req.tenantId, inv.id, safeName, mime, buffer.length, storagePath,
    ocrStatus, ocrModel, ocrRaw, ocrJson, ocrError, req.user!.id,
  );

  const applyOcr = req.body?.apply_ocr_fields === true && extraction && inv.status !== 'paid';
  if (applyOcr) {
    const sets: string[] = [];
    const args: any[] = [];
    if (extraction.issue_date) { sets.push('issue_date = ?'); args.push(extraction.issue_date); }
    if (extraction.due_date) { sets.push('due_date = ?'); args.push(extraction.due_date); }
    if (extraction.total != null) { sets.push('total = ?'); args.push(extraction.total); }
    if (extraction.payment_method) { sets.push('payment_method = ?'); args.push(extraction.payment_method); }
    sets.push(`ocr_last_at = datetime('now')`);
    sets.push(`document_count = (SELECT COUNT(*) FROM invoice_documents WHERE invoice_id = ?)`);
    args.push(inv.id);
    args.push(inv.id, req.tenantId);
    db.prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...args);
    if (Array.isArray(extraction.lines) && extraction.lines.length) {
      db.prepare(`DELETE FROM invoice_lines WHERE invoice_id = ?`).run(inv.id);
      for (const ln of extraction.lines) {
        db.prepare(`
          INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_price, tax_rate)
          VALUES (?,?,?,?,?,?)
        `).run(uuid(), inv.id, ln.description, ln.quantity, ln.unit_price, ln.tax_rate || 0);
      }
    }
  } else {
    db.prepare(`
      UPDATE invoices SET document_count = (SELECT COUNT(*) FROM invoice_documents WHERE invoice_id = ?),
        ocr_last_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE ocr_last_at END
      WHERE id = ? AND tenant_id = ?
    `).run(inv.id, ocrStatus, inv.id, req.tenantId);
  }

  res.status(201).json({
    id: docId,
    original_name: safeName,
    mime_type: mime,
    size_bytes: buffer.length,
    ocr_status: ocrStatus,
    ocr_error: ocrError,
    extraction,
  });
});

router.get('/invoices/documents/:docId/file', (req: Request, res: Response) => {
  const doc = db.prepare(`
    SELECT * FROM invoice_documents WHERE id = ? AND tenant_id = ?
  `).get(req.params.docId, req.tenantId) as any;
  if (!doc) { res.status(404).json({ error: 'not_found' }); return; }
  if (!fs.existsSync(doc.storage_path)) { res.status(404).json({ error: 'file_missing' }); return; }
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.original_name)}"`);
  fs.createReadStream(doc.storage_path).pipe(res);
});

router.get('/invoices/documents/:docId', (req: Request, res: Response) => {
  const doc = db.prepare(`
    SELECT id, invoice_id, original_name, mime_type, size_bytes, ocr_status, ocr_model,
           ocr_raw_text, ocr_json, ocr_error, created_at
    FROM invoice_documents WHERE id = ? AND tenant_id = ?
  `).get(req.params.docId, req.tenantId) as any;
  if (!doc) { res.status(404).json({ error: 'not_found' }); return; }
  let extraction = null;
  try { extraction = doc.ocr_json ? JSON.parse(doc.ocr_json) : null; } catch { /* ignore */ }
  res.json({ document: { ...doc, ocr_json: undefined }, extraction });
});

router.delete('/invoices/documents/:docId', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  const doc = db.prepare(`SELECT * FROM invoice_documents WHERE id = ? AND tenant_id = ?`).get(req.params.docId, req.tenantId) as any;
  if (!doc) { res.status(404).json({ error: 'not_found' }); return; }
  try { if (doc.storage_path && fs.existsSync(doc.storage_path)) fs.unlinkSync(doc.storage_path); } catch { /* ignore */ }
  db.prepare(`DELETE FROM invoice_documents WHERE id = ?`).run(doc.id);
  if (doc.invoice_id) {
    db.prepare(`
      UPDATE invoices SET document_count = (SELECT COUNT(*) FROM invoice_documents WHERE invoice_id = ?)
      WHERE id = ? AND tenant_id = ?
    `).run(doc.invoice_id, doc.invoice_id, req.tenantId);
  }
  res.json({ ok: true });
});

router.put('/invoices/:id/mark-paid', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const inv = db.prepare(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!inv) { res.status(404).json({ error: 'not_found' }); return; }
  if (inv.status === 'paid') {
    res.json({ ok: true, already: true });
    return;
  }
  const method = typeof req.body?.payment_method === 'string' ? req.body.payment_method : (inv.payment_method || 'cash');
  const paidAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`
    UPDATE invoices SET status = 'paid', paid_at = ?, payment_method = ?
    WHERE id = ? AND tenant_id = ?
  `).run(paidAt, method, req.params.id, req.tenantId);
  let journalId: string | null = null;
  try {
    ensureDispenseAccounts(req.tenantId!);
    journalId = autoPostInvoicePaid(req.tenantId!, req.user!.id, {
      ...inv,
      status: 'paid',
      paid_at: paidAt,
      payment_method: method,
    });
  } catch (e: any) {
    // Payment recorded even if journal period closed
    journalId = null;
  }
  res.json({ ok: true, paid_at: paidAt, journal_id: journalId });
});

// Edit an invoice — only while unpaid (paid invoices are fiscal records)
router.put('/invoices/:id', requireRole('admin','accountant','receptionist'), (req: Request, res: Response) => {
  const inv = db.prepare(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!inv) { res.status(404).json({ error: 'not_found' }); return; }
  if (inv.status === 'paid') { res.status(409).json({ error: 'already_paid' }); return; }
  const parsed = invoiceSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const tx = db.transaction(() => {
    const sets: string[] = [];
    const args: any[] = [];
    for (const k of ['patient_id','vendor_id','encounter_id','issue_date','due_date','total','status','payment_method'] as const) {
      if (d[k] !== undefined) { sets.push(`${k} = ?`); args.push(d[k]); }
    }
    if (sets.length) {
      args.push(req.params.id);
      db.prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...args, req.tenantId);
    }
    if (d.lines) {
      db.prepare(`DELETE FROM invoice_lines WHERE invoice_id = ?`).run(req.params.id);
      for (const ln of d.lines) {
        db.prepare(`
          INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_price, tax_rate)
          VALUES (?,?,?,?,?,?)
        `).run(uuid(), req.params.id, ln.description, ln.quantity, ln.unit_price, ln.tax_rate);
      }
    }
  });
  tx();
  res.json({ ok: true });
});

/** Temporary PIN for invoice delete (override with INVOICE_DELETE_PASSWORD). Default: 1234 */
function invoiceDeletePasswordOk(provided: unknown): boolean {
  const expected = String(process.env.INVOICE_DELETE_PASSWORD || '1234').trim();
  const got = String(provided ?? '').trim();
  return !!expected && got === expected;
}

// Delete/cancel an invoice — paid invoices are kept for fiscal retention (CTN 5 years).
// Requires confirm password (default PIN 1234) in JSON body: { password: "1234" }
router.delete('/invoices/:id', requireRole('admin','accountant'), (req: Request, res: Response) => {
  if (!invoiceDeletePasswordOk(req.body?.password ?? req.headers['x-delete-password'])) {
    res.status(403).json({ error: 'invalid_delete_password', message: 'Password required to delete invoice.' });
    return;
  }
  const inv = db.prepare(`SELECT id, invoice_number, status FROM invoices WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!inv) { res.status(404).json({ error: 'not_found' }); return; }
  if (inv.status === 'paid') { res.status(409).json({ error: 'already_paid', message: 'Paid invoices are fiscal records and cannot be deleted.' }); return; }
  const docs = db.prepare(`SELECT storage_path FROM invoice_documents WHERE invoice_id = ?`).all(req.params.id) as any[];
  for (const d of docs) {
    try { if (d.storage_path && fs.existsSync(d.storage_path)) fs.unlinkSync(d.storage_path); } catch { /* ignore */ }
  }
  db.prepare(`DELETE FROM invoice_documents WHERE invoice_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM invoices WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId); // lines cascade
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'delete_invoice',
    resourceType: 'invoice',
    resourceId: req.params.id,
    legalBasis: 'legal_obligation_art7_II',
    afterValue: { invoice_number: inv.invoice_number, status: inv.status },
  });
  res.json({ ok: true, deleted_id: req.params.id });
});

function ensureChart(tenantId: string): void {
  const count = (db.prepare(`SELECT COUNT(*) AS c FROM chart_of_accounts WHERE tenant_id = ?`).get(tenantId) as any).c;
  if (count === 0) {
    const insert = db.prepare(`INSERT INTO chart_of_accounts (id, tenant_id, code, name, type) VALUES (?,?,?,?,?)`);
    for (const a of chartOfAccounts) insert.run(uuid(), tenantId, a.code, a.name, a.type);
  } else {
    // Upsert newer CoA codes (medicamentos) onto existing charts
    ensureDispenseAccounts(tenantId);
  }
}

// silence unused until we expose upload roots in admin
void uploadsRoot;
void ledgerEnsureChart;

export default router;
