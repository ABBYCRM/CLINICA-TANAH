import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Brazilian INSS 2026 brackets (progressiva sobre salário)
const INSS_BRACKETS = [
  { upTo: 1518.00, rate: 0.075 },
  { upTo: 2793.88, rate: 0.09 },
  { upTo: 4190.83, rate: 0.12 },
  { upTo: 8157.41, rate: 0.14 },
];
const INSS_CEILING = 8157.41;
const INSS_MAX_CONTRIB = 951.62;  // ~14% of ceiling

// IRRF 2026 (simplified — 2024 actual values used as placeholder)
const IRRF_BRACKETS = [
  { upTo: 2259.20, rate: 0, deduction: 0 },
  { upTo: 2826.65, rate: 0.075, deduction: 169.44 },
  { upTo: 3751.05, rate: 0.15, deduction: 381.44 },
  { upTo: 4664.68, rate: 0.225, deduction: 662.77 },
  { upTo: Infinity, rate: 0.275, deduction: 896.00 },
];
const IRRF_DEPENDENT_DEDUCTION = 189.59;

function calcINSS(gross: number): number {
  let inss = 0;
  let remaining = gross;
  let lower = 0;
  for (const b of INSS_BRACKETS) {
    const slab = Math.min(remaining, b.upTo - lower);
    if (slab <= 0) break;
    inss += slab * b.rate;
    remaining -= slab;
    lower = b.upTo;
    if (gross <= b.upTo) break;
  }
  return Math.min(inss, INSS_MAX_CONTRIB);
}

function calcIRRF(gross: number, inss: number, dependents: number): number {
  const base = Math.max(0, gross - inss - (dependents * IRRF_DEPENDENT_DEDUCTION));
  for (const b of IRRF_BRACKETS) {
    if (base <= b.upTo) {
      return Math.max(0, base * b.rate - b.deduction);
    }
  }
  return 0;
}

const employeeSchema = z.object({
  user_id: z.string().optional().nullable(),
  full_name: z.string().min(1),
  cpf: z.string().regex(/^\d{11}$/),
  pis: z.string().optional().nullable(),
  ctps_number: z.string().optional().nullable(),
  ctps_series: z.string().optional().nullable(),
  role: z.string().min(1),
  admission_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  termination_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  base_salary: z.number().min(0),
  weekly_hours: z.number().min(1).max(44).default(44),
  health_insurance_discount: z.number().min(0).default(0),
  other_discounts: z.number().min(0).default(0),
  dependents: z.number().int().min(0).default(0),
  bank_account: z.any().optional().nullable(),
});

router.get('/employees', (req: Request, res: Response) => {
  const rows = db.prepare(`SELECT * FROM employees WHERE active = 1 AND tenant_id = ? ORDER BY full_name ASC`).all(req.tenantId);
  res.json({ employees: rows });
});

router.post('/employees', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = uuid();
  try {
    db.prepare(`
      INSERT INTO employees (id, tenant_id, user_id, full_name, cpf, pis, ctps_number, ctps_series, role,
                             admission_date, termination_date, base_salary, weekly_hours,
                             health_insurance_discount, other_discounts, dependents, bank_account)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, req.tenantId, d.user_id ?? null, d.full_name, d.cpf, d.pis ?? null, d.ctps_number ?? null,
           d.ctps_series ?? null, d.role, d.admission_date, d.termination_date ?? null,
           d.base_salary, d.weekly_hours, d.health_insurance_discount, d.other_discounts,
           d.dependents, d.bank_account ? JSON.stringify(d.bank_account) : null);
  } catch (e: any) {
    res.status(409).json({ error: 'duplicate_cpf', message: e.message });
    return;
  }
  res.status(201).json({ id });
});

router.put('/employees/:id', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const parsed = employeeSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
  const d = parsed.data;
  const allowed = ['full_name','pis','ctps_number','ctps_series','role','admission_date','termination_date',
                   'base_salary','weekly_hours','health_insurance_discount','other_discounts','dependents','bank_account'];
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of allowed) {
    if ((d as any)[k] !== undefined) {
      let v = (d as any)[k];
      if (k === 'bank_account' && v && typeof v === 'object') v = JSON.stringify(v);
      sets.push(`${k} = ?`); args.push(v);
    }
  }
  if (!sets.length) { res.json({ ok: true, noop: true }); return; }
  sets.push(`updated_at = ?`); args.push(new Date().toISOString()); args.push(req.params.id, req.tenantId);
  const r = db.prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...args);
  if (!r.changes) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

// Terminate/deactivate an employee (keeps payslip history; eSocial-style
// termination date can be set via PUT). Hard delete only if never paid.
router.delete('/employees/:id', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const emp = db.prepare(`SELECT id, full_name FROM employees WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!emp) { res.status(404).json({ error: 'not_found' }); return; }
  const slips = (db.prepare(`SELECT COUNT(*) AS c FROM payslips WHERE employee_id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any).c;
  if (slips > 0) {
    db.prepare(`UPDATE employees SET active = 0, termination_date = COALESCE(termination_date, date('now')), updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(new Date().toISOString(), req.params.id, req.tenantId);
    res.json({ ok: true, soft_deleted: true });
    return;
  }
  db.prepare(`DELETE FROM employees WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  res.json({ ok: true, soft_deleted: false });
});

router.post('/run', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const period = req.body.period as string; // 'YYYY-MM'
  if (!/^\d{4}-\d{2}$/.test(period)) { res.status(400).json({ error: 'invalid_period' }); return; }
  const employees = db.prepare(`SELECT * FROM employees WHERE active = 1 AND tenant_id = ?`).all(req.tenantId) as any[];
  if (!employees.length) { res.status(400).json({ error: 'no_employees' }); return; }

  const runId = uuid();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO payroll_runs (id, tenant_id, period, type, status, created_by) VALUES (?, ?, ?, 'monthly', 'draft', ?)`)
      .run(runId, req.tenantId, period, req.user!.id);
    let totalGross = 0, totalNet = 0, totalINSS = 0, totalIRRF = 0, totalFGTS = 0;
    for (const e of employees) {
      const gross = e.base_salary;
      const inss = calcINSS(gross);
      const irrf = calcIRRF(gross, inss, e.dependents);
      const otherDeductions = (e.health_insurance_discount || 0) + (e.other_discounts || 0);
      const net = gross - inss - irrf - otherDeductions;
      const fgts = gross * 0.08;
      const breakdown = {
        base_salary: e.base_salary,
        gross, inss, irrf, fgts, net, dependents: e.dependents,
        health_insurance_discount: e.health_insurance_discount,
        other_discounts: e.other_discounts,
        inss_brackets: INSS_BRACKETS,
        irrf_brackets: IRRF_BRACKETS,
      };
      db.prepare(`
        INSERT INTO payslips (id, tenant_id, payroll_run_id, employee_id, base_salary, gross_earnings, inss_deduction, irrf_deduction, other_deductions, net_pay, fgts_deposit, worked_days, json_breakdown)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(uuid(), req.tenantId, runId, e.id, e.base_salary, gross, inss, irrf, otherDeductions, net, fgts, 30, JSON.stringify(breakdown));
      totalGross += gross; totalNet += net; totalINSS += inss; totalIRRF += irrf; totalFGTS += fgts;
    }
    db.prepare(`UPDATE payroll_runs SET total_gross=?, total_net=?, total_inss=?, total_irrf=?, total_fgts=? WHERE id=?`)
      .run(totalGross, totalNet, totalINSS, totalIRRF, totalFGTS, runId);
  });
  tx();
  res.status(201).json({ id: runId, period });
});

router.get('/runs', (req: Request, res: Response) => {
  res.json({ runs: db.prepare(`SELECT * FROM payroll_runs WHERE tenant_id = ? ORDER BY period DESC LIMIT 24`).all(req.tenantId) });
});

router.get('/runs/:id', (req: Request, res: Response) => {
  const run = db.prepare(`SELECT * FROM payroll_runs WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId);
  if (!run) { res.status(404).json({ error: 'not_found' }); return; }
  const payslips = db.prepare(`
    SELECT ps.*, e.full_name AS employee_name, e.cpf, e.role
    FROM payslips ps JOIN employees e ON e.id = ps.employee_id
    WHERE ps.payroll_run_id = ? AND ps.tenant_id = ?
  `).all(req.params.id, req.tenantId);
  res.json({ run, payslips });
});

router.put('/runs/:id/approve', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const run = db.prepare(`SELECT id FROM payroll_runs WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!run) { res.status(404).json({ error: 'not_found' }); return; }
  db.prepare(`UPDATE payroll_runs SET status = 'approved' WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  res.json({ ok: true });
});

router.put('/runs/:id/pay', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const run = db.prepare(`SELECT id FROM payroll_runs WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!run) { res.status(404).json({ error: 'not_found' }); return; }
  db.prepare(`UPDATE payroll_runs SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  res.json({ ok: true });
});

// Delete a payroll run — drafts only; approved/paid runs are labor records
router.delete('/runs/:id', requireRole('admin','accountant'), (req: Request, res: Response) => {
  const run = db.prepare(`SELECT id, status, period FROM payroll_runs WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!run) { res.status(404).json({ error: 'not_found' }); return; }
  if (run.status !== 'draft') {
    res.status(409).json({ error: 'not_draft', message: 'Only draft payroll runs can be deleted.' });
    return;
  }
  db.prepare(`DELETE FROM payroll_runs WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId); // payslips cascade
  res.json({ ok: true, deleted_id: req.params.id });
});

export { calcINSS, calcIRRF, INSS_BRACKETS, IRRF_BRACKETS };
export default router;
