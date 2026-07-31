/**
 * Vitest tests for Brazilian CLT payroll engine (competência 2026).
 */
import { describe, it, expect } from 'vitest';
import {
  calcINSS,
  calcIRRF,
  calcIRRFRedutor,
  computePayslip,
  isValidCpf,
  INSS_MAX_CONTRIB,
  MINIMUM_WAGE,
} from '../src/services/brazilianPayroll';

describe('INSS 2026', () => {
  it('zero salary → zero', () => {
    expect(calcINSS(0)).toBe(0);
  });
  it('first bracket 7.5% up to minimum wage', () => {
    expect(calcINSS(1621)).toBeCloseTo(121.57, 2);
  });
  it('second bracket includes 9% slab', () => {
    expect(calcINSS(2000)).toBeCloseTo(155.69, 2);
  });
  it('capped at max contribution ~988.09', () => {
    expect(calcINSS(10000)).toBe(INSS_MAX_CONTRIB);
    expect(calcINSS(50000)).toBe(INSS_MAX_CONTRIB);
  });
});

describe('IRRF 2026 + Lei 15.270/2025', () => {
  it('redutor zeros tax for income ≤ 5000', () => {
    expect(calcIRRFRedutor(4000)).toBe(312.89);
    expect(calcIRRFRedutor(5000)).toBe(312.89);
  });
  it('phase-out formula between 5000.01 and 7350', () => {
    const r = calcIRRFRedutor(7000);
    expect(r).toBeCloseTo(978.62 - 0.133145 * 7000, 2);
  });
  it('no redutor above 7350', () => {
    expect(calcIRRFRedutor(8000)).toBe(0);
  });
  it('salary 4000 → IRRF 0 after redutor (Receita example path)', () => {
    const inss = calcINSS(4000);
    const { tax } = calcIRRF(4000, inss, 0);
    expect(tax).toBe(0);
  });
  it('salary 5000 → IRRF 0 after redutor', () => {
    const inss = calcINSS(5000);
    const { tax } = calcIRRF(5000, inss, 0);
    expect(tax).toBe(0);
  });
  it('high earner still pays IRRF', () => {
    const gross = 20000;
    const inss = calcINSS(gross);
    const { tax, redutor } = calcIRRF(gross, inss, 0);
    expect(redutor).toBe(0);
    expect(tax).toBeGreaterThan(1000);
  });
});

describe('Payslip engines', () => {
  it('monthly includes FGTS 8% as info, not net deduction', () => {
    const slip = computePayslip({
      base_salary: 5000,
      dependents: 0,
      vale_transporte: true,
      vt_monthly_cost: 400,
    }, '2026-03', 'monthly');
    expect(slip.gross).toBe(5000);
    expect(slip.fgts).toBeCloseTo(400, 2);
    expect(slip.vt_discount).toBeCloseTo(300, 2); // min(6%*5000, 400)=300
    expect(slip.net).toBeCloseTo(slip.gross - slip.inss - slip.irrf - slip.other_deductions, 2);
    expect(slip.lines.some((l) => l.code === 'FGTS')).toBe(true);
  });

  it('overtime + DSR increases gross', () => {
    const slip = computePayslip({ base_salary: 4400, weekly_hours: 44 }, '2026-03', 'monthly', {
      overtime_50_hours: 10,
    });
    expect(slip.earnings.overtime_50).toBeGreaterThan(0);
    expect(slip.earnings.dsr).toBeGreaterThan(0);
    expect(slip.gross).toBeGreaterThan(4400);
  });

  it('13th first parcela has no INSS/IRRF', () => {
    const slip = computePayslip({ base_salary: 6000, admission_date: '2024-01-01' }, '2026-11', '13th_first');
    expect(slip.gross).toBe(3000);
    expect(slip.inss).toBe(0);
    expect(slip.irrf).toBe(0);
    expect(slip.fgts).toBeCloseTo(240, 2);
  });

  it('vacation includes 1/3 constitucional', () => {
    const slip = computePayslip({ base_salary: 3000 }, '2026-07', 'vacation', { vacation_days: 30 });
    expect(slip.earnings.vacation).toBe(3000);
    expect(slip.earnings.vacation_third).toBe(1000);
    expect(slip.gross).toBe(4000);
  });

  it('enforces minimum wage constant', () => {
    expect(MINIMUM_WAGE).toBe(1621);
  });
});

describe('CPF', () => {
  it('validates check digits', () => {
    expect(isValidCpf('11122233396')).toBe(true);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('12345678900')).toBe(false);
  });
});
