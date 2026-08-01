import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';

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
  const from = (req.query.from as string) || new Date(Date.now() - 30*24*3600*1000).toISOString().slice(0,10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0,10);
  const rows = db.prepare(`
    SELECT a.type, a.code, a.name,
           COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0) AS amount
    FROM chart_of_accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jl.entry_id AND date(je.entry_date) BETWEEN ? AND ? AND je.tenant_id = a.tenant_id
    WHERE a.type IN ('revenue', 'expense') AND a.tenant_id = ?
    GROUP BY a.id
    ORDER BY a.type, a.code
  `).all(from, to, req.tenantId);
  const revenue = rows.filter((r: any) => r.type === 'revenue').reduce((s: number, r: any) => s + r.amount, 0);
  const expenses = rows.filter((r: any) => r.type === 'expense').reduce((s: number, r: any) => s + r.amount, 0);
  res.json({ from, to, lines: rows, total_revenue: revenue, total_expenses: expenses, net_income: revenue - expenses });
});

// INVOICES
router.get('/invoices', (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  let sql = `SELECT i.*, p.full_name AS patient_name FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id WHERE i.tenant_id = ?`;
  const args: any[] = [req.tenantId];
  if (status) { sql += ` AND i.status = ?`; args.push(status); }
  sql += ` ORDER BY i.issue_date DESC LIMIT 200`;
  res.json({ invoices: db.prepare(sql).all(...args) });
});

router.post('/invoices', requireRole('admin','accountant','receptionist'), (req: Request, res: Response) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  const invoiceNumber = `INV-${Date.now()}`;
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
  tx();
  res.status(201).json({ id, invoice_number: invoiceNumber });
});

router.put('/invoices/:id/mark-paid', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const inv = db.prepare(`SELECT id, status FROM invoices WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!inv) { res.status(404).json({ error: 'not_found' }); return; }
  db.prepare(`UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  res.json({ ok: true });
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

// Delete/cancel an invoice — paid invoices are kept for fiscal retention (CTN 5 years)
router.delete('/invoices/:id', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const inv = db.prepare(`SELECT id, invoice_number, status FROM invoices WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!inv) { res.status(404).json({ error: 'not_found' }); return; }
  if (inv.status === 'paid') { res.status(409).json({ error: 'already_paid', message: 'Paid invoices are fiscal records and cannot be deleted.' }); return; }
  db.prepare(`DELETE FROM invoices WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId); // lines cascade
  res.json({ ok: true, deleted_id: req.params.id });
});

function ensureChart(tenantId: string): void {
  const count = (db.prepare(`SELECT COUNT(*) AS c FROM chart_of_accounts WHERE tenant_id = ?`).get(tenantId) as any).c;
  if (count === 0) {
    const insert = db.prepare(`INSERT INTO chart_of_accounts (id, tenant_id, code, name, type) VALUES (?,?,?,?,?)`);
    for (const a of chartOfAccounts) insert.run(uuid(), tenantId, a.code, a.name, a.type);
  }
}

export default router;
