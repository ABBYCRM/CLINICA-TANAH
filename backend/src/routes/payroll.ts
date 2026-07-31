/**
 * Folha de Pagamento — CLT brasileira (competência 2026).
 * Cálculos em services/brazilianPayroll.ts (INSS, IRRF+Lei 15.270, FGTS, HE, VT, 13º, férias).
 */
import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import {
  MINIMUM_WAGE,
  PAYROLL_YEAR,
  assertMinimumWage,
  calcINSS,
  calcIRRFAmount,
  computePayslip,
  isValidCpf,
  type PayrollRunType,
  type PeriodInputs,
} from '../services/brazilianPayroll';

const router = Router();
router.use(authenticate);

const RUN_TYPES = ['monthly', '13th_first', '13th_second', 'vacation', 'termination'] as const;

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
  vale_transporte: z.union([z.boolean(), z.number()]).optional().default(false),
  vt_monthly_cost: z.number().min(0).optional().default(0),
  night_shift: z.union([z.boolean(), z.number()]).optional().default(false),
  cbo_code: z.string().optional().nullable(),
  esocial_category: z.string().optional().nullable().default('101'),
  contract_type: z.string().optional().nullable().default('clt'),
  registration_number: z.string().optional().nullable(),
});

function ensureEmployeeColumns() {
  const alters = [
    `ALTER TABLE employees ADD COLUMN vale_transporte INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE employees ADD COLUMN vt_monthly_cost REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE employees ADD COLUMN night_shift INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE employees ADD COLUMN cbo_code TEXT`,
    `ALTER TABLE employees ADD COLUMN esocial_category TEXT DEFAULT '101'`,
    `ALTER TABLE employees ADD COLUMN contract_type TEXT DEFAULT 'clt'`,
    `ALTER TABLE employees ADD COLUMN registration_number TEXT`,
  ];
  for (const sql of alters) {
    try { db.exec(sql); } catch { /* exists */ }
  }
}
ensureEmployeeColumns();

router.get('/meta', (_req: Request, res: Response) => {
  res.json({
    year: PAYROLL_YEAR,
    minimum_wage: MINIMUM_WAGE,
    run_types: RUN_TYPES,
    legal_notes: [
      'INSS Portaria MPS/MF 13/2026',
      'IRRF 2026 + desconto simplificado R$ 607,20',
      'Redutor Lei 15.270/2025',
      'FGTS 8% CLT',
      'VT desconto empregado até 6%',
      'HE 50%/100%, adicional noturno 20%, DSR sobre variáveis',
      '13º (1ª/2ª parcela), férias + 1/3 constitucional',
    ],
  });
});

router.get('/employees', (req: Request, res: Response) => {
  const includeInactive = req.query.include_inactive === 'true';
  const rows = db.prepare(
    `SELECT * FROM employees WHERE tenant_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY full_name ASC`,
  ).all(req.tenantId);
  res.json({ employees: rows });
});

router.post('/employees', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  if (!isValidCpf(d.cpf)) { res.status(400).json({ error: 'invalid_cpf' }); return; }
  const mw = assertMinimumWage(d.base_salary);
  if (mw) { res.status(400).json({ error: 'below_minimum_wage', minimum_wage: MINIMUM_WAGE }); return; }
  const id = uuid();
  try {
    db.prepare(`
      INSERT INTO employees (
        id, tenant_id, user_id, full_name, cpf, pis, ctps_number, ctps_series, role,
        admission_date, termination_date, base_salary, weekly_hours,
        health_insurance_discount, other_discounts, dependents, bank_account,
        vale_transporte, vt_monthly_cost, night_shift, cbo_code, esocial_category, contract_type, registration_number
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, req.tenantId, d.user_id ?? null, d.full_name, d.cpf, d.pis ?? null, d.ctps_number ?? null,
      d.ctps_series ?? null, d.role, d.admission_date, d.termination_date ?? null,
      d.base_salary, d.weekly_hours, d.health_insurance_discount, d.other_discounts,
      d.dependents, d.bank_account ? JSON.stringify(d.bank_account) : null,
      d.vale_transporte ? 1 : 0, d.vt_monthly_cost ?? 0, d.night_shift ? 1 : 0,
      d.cbo_code ?? null, d.esocial_category ?? '101', d.contract_type ?? 'clt', d.registration_number ?? null,
    );
  } catch (e: any) {
    res.status(409).json({ error: 'duplicate_cpf', message: e.message });
    return;
  }
  res.status(201).json({ id });
});

router.put('/employees/:id', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  const parsed = employeeSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  if (d.cpf && !isValidCpf(d.cpf)) { res.status(400).json({ error: 'invalid_cpf' }); return; }
  if (d.base_salary != null) {
    const mw = assertMinimumWage(d.base_salary);
    if (mw) { res.status(400).json({ error: 'below_minimum_wage', minimum_wage: MINIMUM_WAGE }); return; }
  }
  const allowed = [
    'full_name', 'pis', 'ctps_number', 'ctps_series', 'role', 'admission_date', 'termination_date',
    'base_salary', 'weekly_hours', 'health_insurance_discount', 'other_discounts', 'dependents', 'bank_account',
    'vale_transporte', 'vt_monthly_cost', 'night_shift', 'cbo_code', 'esocial_category', 'contract_type', 'registration_number',
  ] as const;
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of allowed) {
    if ((d as any)[k] !== undefined) {
      let v = (d as any)[k];
      if (k === 'bank_account' && v && typeof v === 'object') v = JSON.stringify(v);
      if (k === 'vale_transporte' || k === 'night_shift') v = v ? 1 : 0;
      sets.push(`${k} = ?`); args.push(v);
    }
  }
  if (!sets.length) { res.json({ ok: true, noop: true }); return; }
  sets.push(`updated_at = ?`); args.push(new Date().toISOString()); args.push(req.params.id, req.tenantId);
  const r = db.prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...args);
  if (!r.changes) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

router.delete('/employees/:id', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  const emp = db.prepare(`SELECT id FROM employees WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
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

const runSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  type: z.enum(RUN_TYPES).default('monthly'),
  overrides: z.record(z.object({
    overtime_50_hours: z.number().min(0).optional(),
    overtime_100_hours: z.number().min(0).optional(),
    night_hours: z.number().min(0).optional(),
    absence_days: z.number().min(0).optional(),
    vacation_days: z.number().min(1).max(30).optional(),
    months_13th: z.number().int().min(0).max(12).optional(),
    sundays_and_holidays: z.number().int().min(0).max(15).optional(),
  }).passthrough()).optional(),
});

router.post('/run', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'validation', details: parsed.error.flatten() }); return; }
  const { period, type, overrides } = parsed.data;
  const employees = db.prepare(`SELECT * FROM employees WHERE active = 1 AND tenant_id = ?`).all(req.tenantId) as any[];
  if (!employees.length) { res.status(400).json({ error: 'no_employees' }); return; }

  const dup = db.prepare(
    `SELECT id FROM payroll_runs WHERE tenant_id = ? AND period = ? AND type = ? AND status != 'cancelled'`,
  ).get(req.tenantId, period, type) as any;
  if (dup) { res.status(409).json({ error: 'duplicate_run', existing_id: dup.id }); return; }

  const runId = uuid();
  try {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO payroll_runs (id, tenant_id, period, type, status, created_by) VALUES (?, ?, ?, ?, 'draft', ?)`,
      ).run(runId, req.tenantId, period, type, req.user!.id);

      let totalGross = 0, totalNet = 0, totalINSS = 0, totalIRRF = 0, totalFGTS = 0;
      for (const e of employees) {
        if (e.base_salary < MINIMUM_WAGE) {
          throw Object.assign(new Error('below_minimum_wage'), { employee_id: e.id, name: e.full_name });
        }
        const ov = (overrides?.[e.id] || {}) as PeriodInputs;
        const calc = computePayslip({
          base_salary: e.base_salary,
          weekly_hours: e.weekly_hours,
          dependents: e.dependents,
          health_insurance_discount: e.health_insurance_discount,
          other_discounts: e.other_discounts,
          vale_transporte: e.vale_transporte,
          vt_monthly_cost: e.vt_monthly_cost,
          admission_date: e.admission_date,
          termination_date: e.termination_date,
        }, period, type as PayrollRunType, ov);

        db.prepare(`
          INSERT INTO payslips (
            id, tenant_id, payroll_run_id, employee_id, base_salary, gross_earnings,
            inss_deduction, irrf_deduction, other_deductions, net_pay, fgts_deposit, worked_days, json_breakdown
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          uuid(), req.tenantId, runId, e.id, e.base_salary, calc.gross,
          calc.inss, calc.irrf, calc.other_deductions, calc.net, calc.fgts, calc.worked_days,
          JSON.stringify(calc),
        );
        totalGross += calc.gross;
        totalNet += calc.net;
        totalINSS += calc.inss;
        totalIRRF += calc.irrf;
        totalFGTS += calc.fgts;
      }
      db.prepare(
        `UPDATE payroll_runs SET total_gross=?, total_net=?, total_inss=?, total_irrf=?, total_fgts=? WHERE id=?`,
      ).run(totalGross, totalNet, totalINSS, totalIRRF, totalFGTS, runId);
    });
    tx();
  } catch (e: any) {
    if (e.message === 'below_minimum_wage') {
      res.status(400).json({ error: 'below_minimum_wage', employee_id: e.employee_id, name: e.name, minimum_wage: MINIMUM_WAGE });
      return;
    }
    throw e;
  }
  res.status(201).json({ id: runId, period, type });
});

router.get('/runs', (req: Request, res: Response) => {
  res.json({
    runs: db.prepare(`SELECT * FROM payroll_runs WHERE tenant_id = ? ORDER BY period DESC, created_at DESC LIMIT 48`).all(req.tenantId),
  });
});

router.get('/runs/:id', (req: Request, res: Response) => {
  const run = db.prepare(`SELECT * FROM payroll_runs WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId);
  if (!run) { res.status(404).json({ error: 'not_found' }); return; }
  const payslips = db.prepare(`
    SELECT ps.*, e.full_name AS employee_name, e.cpf, e.role, e.pis, e.ctps_number, e.registration_number
    FROM payslips ps JOIN employees e ON e.id = ps.employee_id
    WHERE ps.payroll_run_id = ? AND ps.tenant_id = ?
    ORDER BY e.full_name ASC
  `).all(req.params.id, req.tenantId);
  res.json({ run, payslips });
});

router.put('/runs/:id/approve', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  const run = db.prepare(`SELECT id, status FROM payroll_runs WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!run) { res.status(404).json({ error: 'not_found' }); return; }
  if (run.status !== 'draft') { res.status(409).json({ error: 'invalid_status', status: run.status }); return; }
  db.prepare(`UPDATE payroll_runs SET status = 'approved' WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  res.json({ ok: true });
});

router.put('/runs/:id/pay', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  const run = db.prepare(`SELECT id, status FROM payroll_runs WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!run) { res.status(404).json({ error: 'not_found' }); return; }
  if (run.status !== 'approved') { res.status(409).json({ error: 'invalid_status', status: run.status }); return; }
  db.prepare(`UPDATE payroll_runs SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  res.json({ ok: true });
});

router.delete('/runs/:id', requireRole('admin', 'accountant'), (req: Request, res: Response) => {
  const run = db.prepare(`SELECT id, status FROM payroll_runs WHERE id = ? AND tenant_id = ?`).get(req.params.id, req.tenantId) as any;
  if (!run) { res.status(404).json({ error: 'not_found' }); return; }
  if (run.status !== 'draft') {
    res.status(409).json({ error: 'not_draft', message: 'Only draft payroll runs can be deleted.' });
    return;
  }
  db.prepare(`DELETE FROM payroll_runs WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.tenantId);
  res.json({ ok: true, deleted_id: req.params.id });
});

export { calcINSS, calcIRRFAmount as calcIRRF };
export default router;
