/**
 * Vitest tests for the payroll INSS/IRRF calculator.
 */
import { describe, it, expect } from 'vitest';
import { calcINSS, calcIRRF } from '../src/routes/payroll';

describe('INSS calculator', () => {
  it('zero salary → zero', () => {
    expect(calcINSS(0)).toBe(0);
  });
  it('first bracket 7.5%', () => {
    expect(calcINSS(1518)).toBeCloseTo(113.85, 2);
  });
  it('second bracket 9%', () => {
    expect(calcINSS(2000)).toBeCloseTo(113.85 + 0.09 * (2000 - 1518), 2);
  });
  it('full ceiling 14%', () => {
    expect(calcINSS(10000)).toBe(951.62);
  });
  it('capped at 951.62', () => {
    expect(calcINSS(50000)).toBe(951.62);
  });
});

describe('IRRF calculator', () => {
  it('first bracket 0%', () => {
    expect(calcIRRF(2000, 0, 0)).toBe(0);
  });
  it('second bracket 7.5% with deduction', () => {
    // base = 2500 - 0 - 0 = 2500
    // 2500 * 0.075 - 169.44 = 18.06
    expect(calcIRRF(2500, 0, 0)).toBeCloseTo(18.06, 2);
  });
  it('dependent deduction applied', () => {
    // gross 5000, inss 0, 1 dependent → base = 5000 - 189.59 = 4810.41
    // 4810.41 lands in 27.5% bracket (>= 4664.68): 4810.41 * 0.275 - 896 = 426.86
    expect(calcIRRF(5000, 0, 1)).toBeCloseTo(426.86, 1);
  });
  it('high bracket 27.5%', () => {
    // gross 10000, inss 951.62, 0 dependents
    // base = 10000 - 951.62 - 0 = 9048.38
    // 9048.38 * 0.275 - 896 = 1592.30
    expect(calcIRRF(10000, 951.62, 0)).toBeCloseTo(1592.30, 1);
  });
});
