/**
 * Brazilian CLT payroll engine — tables & rules for competência 2026.
 *
 * Sources:
 * - Portaria Interministerial MPS/MF nº 13/2026 (INSS / salário mínimo previdenciário)
 * - Tabela progressiva IRRF mensal 2026 + desconto simplificado (R$ 607,20)
 * - Lei nº 15.270/2025 art. 3º-A (redutor IR até R$ 5.000 / faixa 5k–7.350)
 * - CLT: FGTS 8%, HE 50%/100%, adicional noturno 20%, VT até 6%, férias + 1/3, 13º
 */

export const PAYROLL_YEAR = 2026;
export const MINIMUM_WAGE = 1621.0;

/** INSS — empregados / avulsos — Anexo II Portaria MPS/MF 13/2026 */
export const INSS_BRACKETS_2026 = [
  { upTo: 1621.0, rate: 0.075 },
  { upTo: 2902.84, rate: 0.09 },
  { upTo: 4354.27, rate: 0.12 },
  { upTo: 8475.55, rate: 0.14 },
] as const;

export const INSS_CEILING = 8475.55;
/** Contribuição máxima do segurado empregado (~R$ 988,09) */
export const INSS_MAX_CONTRIB = 988.09;

/** IRRF mensal 2026 (tabela progressiva) */
export const IRRF_BRACKETS_2026 = [
  { upTo: 2428.8, rate: 0, deduction: 0 },
  { upTo: 2826.65, rate: 0.075, deduction: 182.16 },
  { upTo: 3751.05, rate: 0.15, deduction: 394.16 },
  { upTo: 4664.68, rate: 0.225, deduction: 675.49 },
  { upTo: Infinity, rate: 0.275, deduction: 908.73 },
] as const;

/** Dedução por dependente IRRF */
export const IRRF_DEPENDENT_DEDUCTION = 189.59;
/** Desconto simplificado mensal = 20% × R$ 2.428,80 */
export const IRRF_SIMPLIFIED_DEDUCTION = 607.2;

/** Lei 15.270/2025 — redutor */
export const IRRF_REDUCTOR_FULL_UNTIL = 5000.0;
export const IRRF_REDUCTOR_MAX = 312.89;
export const IRRF_REDUCTOR_PHASE_UNTIL = 7350.0;
export const IRRF_REDUCTOR_PHASE_A = 978.62;
export const IRRF_REDUCTOR_PHASE_B = 0.133145;

export const FGTS_RATE = 0.08;
export const VT_EMPLOYEE_RATE = 0.06;
export const NIGHT_ADDITIONAL_RATE = 0.2;
export const HE50_MULTIPLIER = 1.5;
export const HE100_MULTIPLIER = 2.0;

export type PayrollRunType = 'monthly' | '13th_first' | '13th_second' | 'vacation' | 'termination';

export type PayslipLine = {
  code: string;
  description: string;
  type: 'earning' | 'deduction' | 'info';
  amount: number;
  reference?: string;
};

export type PeriodInputs = {
  overtime_50_hours?: number;
  overtime_100_hours?: number;
  night_hours?: number;
  absence_days?: number;
  vacation_days?: number;
  /** Meses no ano para 13º (1–12). Default: months from admission through period. */
  months_13th?: number;
  sundays_and_holidays?: number;
  days_in_month?: number;
};

export type EmployeePayrollInput = {
  base_salary: number;
  weekly_hours?: number;
  dependents?: number;
  health_insurance_discount?: number;
  other_discounts?: number;
  vale_transporte?: boolean | number;
  vt_monthly_cost?: number;
  admission_date?: string | null;
  termination_date?: string | null;
};

export type PayslipCalc = {
  type: PayrollRunType;
  period: string;
  base_salary: number;
  hour_value: number;
  worked_days: number;
  earnings: {
    salary: number;
    overtime_50: number;
    overtime_100: number;
    night_additional: number;
    dsr: number;
    vacation: number;
    vacation_third: number;
    thirteenth: number;
    other: number;
  };
  gross: number;
  inss_base: number;
  inss: number;
  irrf_taxable: number;
  irrf_base: number;
  irrf_before_redutor: number;
  irrf_redutor: number;
  irrf: number;
  fgts_base: number;
  fgts: number;
  vt_discount: number;
  health_insurance_discount: number;
  other_discounts: number;
  other_deductions: number;
  net: number;
  lines: PayslipLine[];
  legal: {
    year: number;
    minimum_wage: number;
    inss_ceiling: number;
    fgts_rate: number;
    law_15270: boolean;
  };
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function hourValue(baseSalary: number, weeklyHours = 44): number {
  const hours = weeklyHours > 0 ? weeklyHours : 44;
  // Divisor mensal padrão CLT: 220h para jornada de 44h/semana
  const monthlyHours = (hours / 44) * 220;
  return baseSalary / monthlyHours;
}

/** Progressive INSS (slab method), capped at teto contribuição. */
export function calcINSS(contributionSalary: number): number {
  const base = Math.min(Math.max(0, contributionSalary), INSS_CEILING);
  if (base <= 0) return 0;
  let inss = 0;
  let lower = 0;
  for (const b of INSS_BRACKETS_2026) {
    const slab = Math.min(base, b.upTo) - lower;
    if (slab <= 0) break;
    inss += slab * b.rate;
    lower = b.upTo;
    if (base <= b.upTo) break;
  }
  return round2(Math.min(inss, INSS_MAX_CONTRIB));
}

/** Lei 15.270/2025 redutor — applied on rendimentos tributáveis sujeitos à incidência mensal. */
export function calcIRRFRedutor(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0;
  if (taxableIncome <= IRRF_REDUCTOR_FULL_UNTIL) return IRRF_REDUCTOR_MAX;
  if (taxableIncome <= IRRF_REDUCTOR_PHASE_UNTIL) {
    return round2(Math.max(0, IRRF_REDUCTOR_PHASE_A - IRRF_REDUCTOR_PHASE_B * taxableIncome));
  }
  return 0;
}

/**
 * IRRF with simplified deduction vs legal deductions (whichever is greater),
 * then Lei 15.270 redutor.
 */
export function calcIRRF(
  taxableIncome: number,
  inss: number,
  dependents: number,
  opts?: { applyRedutor?: boolean },
): { tax: number; base: number; beforeRedutor: number; redutor: number; deductionUsed: number } {
  const applyRedutor = opts?.applyRedutor !== false;
  const legal = inss + Math.max(0, dependents) * IRRF_DEPENDENT_DEDUCTION;
  const deductionUsed = Math.max(legal, IRRF_SIMPLIFIED_DEDUCTION);
  const base = Math.max(0, taxableIncome - deductionUsed);
  let before = 0;
  for (const b of IRRF_BRACKETS_2026) {
    if (base <= b.upTo) {
      before = Math.max(0, base * b.rate - b.deduction);
      break;
    }
  }
  before = round2(before);
  const redutor = applyRedutor ? Math.min(before, calcIRRFRedutor(taxableIncome)) : 0;
  const tax = round2(Math.max(0, before - redutor));
  return { tax, base: round2(base), beforeRedutor: before, redutor: round2(redutor), deductionUsed: round2(deductionUsed) };
}

/** Back-compat wrapper used by older tests/callers. */
export function calcIRRFAmount(gross: number, inss: number, dependents: number): number {
  return calcIRRF(gross, inss, dependents).tax;
}

export function monthsFor13th(admissionDate: string | null | undefined, period: string): number {
  if (!/^\d{4}-\d{2}$/.test(period)) return 12;
  const [y] = period.split('-').map(Number);
  if (!admissionDate || !/^\d{4}-\d{2}-\d{2}/.test(admissionDate)) return 12;
  const [ay, am] = admissionDate.slice(0, 7).split('-').map(Number);
  if (ay > y) return 0;
  if (ay < y) return 12; // full calendar year entitlement
  // Admitted in the same year: months from admission through December
  return Math.max(0, Math.min(12, 12 - am + 1));
}

function pushLine(lines: PayslipLine[], code: string, description: string, type: PayslipLine['type'], amount: number, reference?: string) {
  if (Math.abs(amount) < 0.005 && type !== 'info') return;
  lines.push({ code, description, type, amount: round2(amount), reference });
}

export function computePayslip(
  emp: EmployeePayrollInput,
  period: string,
  type: PayrollRunType,
  inputs: PeriodInputs = {},
): PayslipCalc {
  const base = Number(emp.base_salary) || 0;
  const weekly = Number(emp.weekly_hours) || 44;
  const dependents = Number(emp.dependents) || 0;
  const hv = hourValue(base, weekly);
  const daysInMonth = inputs.days_in_month ?? 30;
  const absence = Math.min(daysInMonth, Math.max(0, Number(inputs.absence_days) || 0));
  const workedDays = Math.max(0, daysInMonth - absence);
  const lines: PayslipLine[] = [];

  let salary = 0;
  let overtime50 = 0;
  let overtime100 = 0;
  let nightAdd = 0;
  let dsr = 0;
  let vacation = 0;
  let vacationThird = 0;
  let thirteenth = 0;
  let otherEarn = 0;

  if (type === 'monthly') {
    salary = round2(base * (workedDays / daysInMonth));
    overtime50 = round2((Number(inputs.overtime_50_hours) || 0) * hv * HE50_MULTIPLIER);
    overtime100 = round2((Number(inputs.overtime_100_hours) || 0) * hv * HE100_MULTIPLIER);
    nightAdd = round2((Number(inputs.night_hours) || 0) * hv * NIGHT_ADDITIONAL_RATE);
    const variable = overtime50 + overtime100 + nightAdd;
    const restDays = Math.max(0, Number(inputs.sundays_and_holidays) || 4);
    const workDaysForDsr = Math.max(1, daysInMonth - restDays - absence);
    dsr = variable > 0 ? round2((variable / workDaysForDsr) * restDays) : 0;
    pushLine(lines, 'SAL', 'Salário base (proporcional)', 'earning', salary);
    pushLine(lines, 'HE50', 'Hora extra 50%', 'earning', overtime50, `${inputs.overtime_50_hours || 0}h`);
    pushLine(lines, 'HE100', 'Hora extra 100%', 'earning', overtime100, `${inputs.overtime_100_hours || 0}h`);
    pushLine(lines, 'ADN', 'Adicional noturno 20%', 'earning', nightAdd, `${inputs.night_hours || 0}h`);
    pushLine(lines, 'DSR', 'DSR sobre variáveis', 'earning', dsr);
  } else if (type === '13th_first') {
    const months = inputs.months_13th ?? monthsFor13th(emp.admission_date, period);
    thirteenth = round2((base * Math.min(12, months)) / 12 / 2);
    pushLine(lines, '13A', '13º salário — 1ª parcela (50%)', 'earning', thirteenth, `${months}/12`);
  } else if (type === '13th_second') {
    const months = inputs.months_13th ?? monthsFor13th(emp.admission_date, period);
    const full = round2((base * Math.min(12, months)) / 12);
    const first = round2(full / 2);
    thirteenth = round2(full - first);
    pushLine(lines, '13B', '13º salário — 2ª parcela', 'earning', thirteenth, `integral ${full.toFixed(2)}`);
    // INSS/IRRF bases use full 13th (computed below)
    otherEarn = 0;
    // stash full on earnings via thirteenth temporarily then adjust
    (inputs as any)._full13 = full;
  } else if (type === 'vacation') {
    const days = Math.min(30, Math.max(1, Number(inputs.vacation_days) || 30));
    vacation = round2((base / 30) * days);
    vacationThird = round2(vacation / 3);
    pushLine(lines, 'FER', `Férias (${days} dias)`, 'earning', vacation);
    pushLine(lines, 'FER13', '1/3 constitucional sobre férias', 'earning', vacationThird);
  } else if (type === 'termination') {
    // Simplified verbas: saldo salário (proporcional 15 dias default) + aviso + 13º prop + férias prop + 1/3
    const balDays = inputs.absence_days != null ? Math.max(0, 30 - Number(inputs.absence_days)) : 15;
    salary = round2((base / 30) * balDays);
    const months = inputs.months_13th ?? monthsFor13th(emp.admission_date, period);
    thirteenth = round2((base * Math.min(12, months)) / 12);
    vacation = round2((base / 12) * months); // férias proporcionais simplificadas
    vacationThird = round2(vacation / 3);
    pushLine(lines, 'SAL', `Saldo de salário (${balDays} dias)`, 'earning', salary);
    pushLine(lines, '13P', '13º proporcional', 'earning', thirteenth);
    pushLine(lines, 'FERP', 'Férias proporcionais', 'earning', vacation);
    pushLine(lines, 'FER13', '1/3 constitucional', 'earning', vacationThird);
  }

  let gross = round2(salary + overtime50 + overtime100 + nightAdd + dsr + vacation + vacationThird + thirteenth + otherEarn);

  // Contribution / FGTS bases
  let inssBase = gross;
  let fgtsBase = gross;
  let irrfTaxable = gross;

  if (type === '13th_first') {
    // 1ª parcela: sem INSS/IRRF na prática corrente; FGTS incide
    inssBase = 0;
    irrfTaxable = 0;
  } else if (type === '13th_second') {
    const full = round2((inputs as any)._full13 ?? thirteenth * 2);
    inssBase = full;
    irrfTaxable = full;
    fgtsBase = thirteenth; // deposit on 2ª parcela amount paid now (1ª already deposited)
  }

  const inss = calcINSS(inssBase);
  const irrfParts = irrfTaxable > 0
    ? calcIRRF(irrfTaxable, inss, dependents)
    : { tax: 0, base: 0, beforeRedutor: 0, redutor: 0, deductionUsed: 0 };

  const useVt = !!(emp.vale_transporte);
  const vtCost = Number(emp.vt_monthly_cost) || 0;
  const vtDiscount = type === 'monthly' && useVt && vtCost > 0
    ? round2(Math.min(base * VT_EMPLOYEE_RATE, vtCost))
    : 0;

  const health = type === 'monthly' ? round2(Number(emp.health_insurance_discount) || 0) : 0;
  const otherDisc = type === 'monthly' ? round2(Number(emp.other_discounts) || 0) : 0;
  const otherDeductions = round2(vtDiscount + health + otherDisc);
  const fgts = round2(fgtsBase * FGTS_RATE);
  const net = round2(gross - inss - irrfParts.tax - otherDeductions);

  pushLine(lines, 'INSS', 'INSS (segurado)', 'deduction', inss);
  pushLine(lines, 'IRRF', 'IRRF (após redutor Lei 15.270/2025)', 'deduction', irrfParts.tax);
  if (irrfParts.redutor > 0) {
    pushLine(lines, 'IRRED', 'Redutor IRRF Lei 15.270/2025', 'info', irrfParts.redutor);
  }
  pushLine(lines, 'VT', 'Vale-transporte (até 6%)', 'deduction', vtDiscount);
  pushLine(lines, 'PLANO', 'Plano de saúde', 'deduction', health);
  pushLine(lines, 'OUT', 'Outros descontos', 'deduction', otherDisc);
  pushLine(lines, 'FGTS', 'FGTS depósito (8% — não descontado do líquido)', 'info', fgts);
  pushLine(lines, 'LIQ', 'Líquido a receber', 'info', net);

  return {
    type,
    period,
    base_salary: base,
    hour_value: round2(hv),
    worked_days: type === 'monthly' ? workedDays : daysInMonth,
    earnings: {
      salary, overtime_50: overtime50, overtime_100: overtime100,
      night_additional: nightAdd, dsr, vacation, vacation_third: vacationThird,
      thirteenth, other: otherEarn,
    },
    gross,
    inss_base: round2(inssBase),
    inss,
    irrf_taxable: round2(irrfTaxable),
    irrf_base: irrfParts.base,
    irrf_before_redutor: irrfParts.beforeRedutor,
    irrf_redutor: irrfParts.redutor,
    irrf: irrfParts.tax,
    fgts_base: round2(fgtsBase),
    fgts,
    vt_discount: vtDiscount,
    health_insurance_discount: health,
    other_discounts: otherDisc,
    other_deductions: otherDeductions,
    net,
    lines,
    legal: {
      year: PAYROLL_YEAR,
      minimum_wage: MINIMUM_WAGE,
      inss_ceiling: INSS_CEILING,
      fgts_rate: FGTS_RATE,
      law_15270: true,
    },
  };
}

/** Validate Brazilian CPF (digits + check digits). */
export function isValidCpf(cpf: string): boolean {
  const d = (cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
  let r = (sum * 10) % 11;
  if (r === 10) r = 0;
  if (r !== Number(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
  r = (sum * 10) % 11;
  if (r === 10) r = 0;
  return r === Number(d[10]);
}

export function assertMinimumWage(salary: number): string | null {
  if (salary < MINIMUM_WAGE) {
    return `base_salary_below_minimum_wage_${MINIMUM_WAGE}`;
  }
  return null;
}
