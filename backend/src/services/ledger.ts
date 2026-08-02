/**
 * Enterprise ledger helpers — double-entry posting, reports, invoice auto-journals.
 */
import { v4 as uuid } from 'uuid';
import { db } from '../db/schema';

export const CLINIC_COA: Array<{ code: string; name: string; type: string; parent?: string }> = [
  { code: '1', name: 'Ativo', type: 'asset' },
  { code: '1.1', name: 'Ativo Circulante', type: 'asset', parent: '1' },
  { code: '1.1.01', name: 'Disponibilidades', type: 'asset', parent: '1.1' },
  { code: '1.1.01.001', name: 'Caixa Geral', type: 'asset', parent: '1.1.01' },
  { code: '1.1.01.002', name: 'Banco Conta Movimento', type: 'asset', parent: '1.1.01' },
  { code: '1.1.01.003', name: 'Aplicações Financeiras', type: 'asset', parent: '1.1.01' },
  { code: '1.1.02', name: 'Créditos', type: 'asset', parent: '1.1' },
  { code: '1.1.02.001', name: 'Contas a Receber — Particular', type: 'asset', parent: '1.1.02' },
  { code: '1.1.02.002', name: 'Contas a Receber — Convênios', type: 'asset', parent: '1.1.02' },
  { code: '1.1.03', name: 'Estoques', type: 'asset', parent: '1.1' },
  { code: '1.1.03.001', name: 'Estoque de Medicamentos', type: 'asset', parent: '1.1.03' },
  { code: '1.1.03.002', name: 'Estoque de Materiais', type: 'asset', parent: '1.1.03' },
  { code: '1.2', name: 'Ativo Não Circulante', type: 'asset', parent: '1' },
  { code: '1.2.01.001', name: 'Imobilizado — Equipamentos', type: 'asset', parent: '1.2' },
  { code: '1.2.01.002', name: 'Imobilizado — Móveis e Utensílios', type: 'asset', parent: '1.2' },
  { code: '2', name: 'Passivo', type: 'liability' },
  { code: '2.1', name: 'Passivo Circulante', type: 'liability', parent: '2' },
  { code: '2.1.01.001', name: 'Fornecedores', type: 'liability', parent: '2.1' },
  { code: '2.1.02.001', name: 'Salários a Pagar', type: 'liability', parent: '2.1' },
  { code: '2.1.02.002', name: 'INSS a Recolher', type: 'liability', parent: '2.1' },
  { code: '2.1.02.003', name: 'FGTS a Recolher', type: 'liability', parent: '2.1' },
  { code: '2.1.02.004', name: 'IRRF a Recolher', type: 'liability', parent: '2.1' },
  { code: '2.1.03.001', name: 'Simples Nacional a Pagar', type: 'liability', parent: '2.1' },
  { code: '2.1.04.001', name: 'Adiantamentos de Pacientes', type: 'liability', parent: '2.1' },
  { code: '3', name: 'Patrimônio Líquido', type: 'equity' },
  { code: '3.1.01.001', name: 'Capital Social', type: 'equity', parent: '3' },
  { code: '3.1.02.001', name: 'Lucros / Prejuízos Acumulados', type: 'equity', parent: '3' },
  { code: '3.1.03.001', name: 'Resultado do Exercício', type: 'equity', parent: '3' },
  { code: '4', name: 'Receitas', type: 'revenue' },
  { code: '4.1.01.001', name: 'Receita de Consultas', type: 'revenue', parent: '4' },
  { code: '4.1.01.002', name: 'Receita de Exames', type: 'revenue', parent: '4' },
  { code: '4.1.01.003', name: 'Receita de Procedimentos', type: 'revenue', parent: '4' },
  { code: '4.1.01.004', name: 'Receita de Retornos', type: 'revenue', parent: '4' },
  { code: '4.1.01.005', name: 'Receita de Medicamentos', type: 'revenue', parent: '4' },
  { code: '4.1.02.001', name: 'Receita de Convênios', type: 'revenue', parent: '4' },
  { code: '4.1.03.001', name: 'Outras Receitas Operacionais', type: 'revenue', parent: '4' },
  { code: '5', name: 'Despesas', type: 'expense' },
  { code: '5.1.01.001', name: 'Salários', type: 'expense', parent: '5' },
  { code: '5.1.01.002', name: 'INSS Patronal', type: 'expense', parent: '5' },
  { code: '5.1.01.003', name: 'FGTS', type: 'expense', parent: '5' },
  { code: '5.1.01.004', name: '13º Salário', type: 'expense', parent: '5' },
  { code: '5.1.01.005', name: 'Férias', type: 'expense', parent: '5' },
  { code: '5.1.01.006', name: 'Benefícios (VR/VT/Saúde)', type: 'expense', parent: '5' },
  { code: '5.1.02.001', name: 'Aluguel', type: 'expense', parent: '5' },
  { code: '5.1.02.002', name: 'Energia Elétrica', type: 'expense', parent: '5' },
  { code: '5.1.02.003', name: 'Água e Esgoto', type: 'expense', parent: '5' },
  { code: '5.1.02.004', name: 'Internet / Telefonia', type: 'expense', parent: '5' },
  { code: '5.1.02.005', name: 'Material de Consumo', type: 'expense', parent: '5' },
  { code: '5.1.02.006', name: 'Medicamentos Consumidos', type: 'expense', parent: '5' },
  { code: '5.1.03.001', name: 'Serviços Contábeis', type: 'expense', parent: '5' },
  { code: '5.1.03.002', name: 'Marketing e Publicidade', type: 'expense', parent: '5' },
  { code: '5.1.03.003', name: 'Manutenção e Conservação', type: 'expense', parent: '5' },
  { code: '5.1.03.004', name: 'Seguros', type: 'expense', parent: '5' },
  { code: '5.1.04.001', name: 'Impostos e Taxas', type: 'expense', parent: '5' },
];

export function ensureChart(tenantId: string): void {
  const count = (db.prepare(`SELECT COUNT(*) AS c FROM chart_of_accounts WHERE tenant_id = ?`).get(tenantId) as any).c;
  if (count > 0) return;
  const byCode = new Map<string, string>();
  const insert = db.prepare(`
    INSERT INTO chart_of_accounts (id, tenant_id, code, name, type, parent_id, active)
    VALUES (?,?,?,?,?,?,1)
  `);
  const tx = db.transaction(() => {
    for (const a of CLINIC_COA) {
      const id = uuid();
      byCode.set(a.code, id);
      const parentId = a.parent ? byCode.get(a.parent) ?? null : null;
      insert.run(id, tenantId, a.code, a.name, a.type, parentId);
    }
  });
  tx();
}

export function accountByCode(tenantId: string, code: string) {
  return db.prepare(`SELECT * FROM chart_of_accounts WHERE tenant_id = ? AND code = ?`).get(tenantId, code) as any;
}

export function isPeriodClosed(tenantId: string, entryDate: string): boolean {
  ensurePeriodsTable();
  const row = db.prepare(`
    SELECT id FROM accounting_periods
    WHERE tenant_id = ? AND status = 'closed'
      AND date(?) BETWEEN date(period_start) AND date(period_end)
  `).get(tenantId, entryDate);
  return !!row;
}

export type JournalLineInput = {
  account_code: string;
  debit?: number;
  credit?: number;
  description?: string | null;
  cost_center?: string | null;
};

export type PostJournalInput = {
  tenantId: string;
  userId: string;
  entry_date: string;
  description: string;
  reference_type?: string | null;
  reference_id?: string | null;
  lines: JournalLineInput[];
  posted?: boolean;
};

export function postJournal(input: PostJournalInput): { id: string; entry_number: string } {
  if (isPeriodClosed(input.tenantId, input.entry_date)) {
    throw Object.assign(new Error('period_closed'), { code: 'period_closed' });
  }
  const lines = input.lines.map((l) => ({
    ...l,
    debit: Number(l.debit || 0),
    credit: Number(l.credit || 0),
  }));
  for (const l of lines) {
    if (l.debit > 0 && l.credit > 0) {
      throw Object.assign(new Error('line_both_sides'), { code: 'line_both_sides' });
    }
    if (l.debit <= 0 && l.credit <= 0) {
      throw Object.assign(new Error('line_empty'), { code: 'line_empty' });
    }
  }
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw Object.assign(new Error('unbalanced_entry'), {
      code: 'unbalanced_entry', total_debit: totalDebit, total_credit: totalCredit,
    });
  }
  if (lines.length < 2) {
    throw Object.assign(new Error('min_two_lines'), { code: 'min_two_lines' });
  }

  const id = uuid();
  const entryNumber = `JE-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
  const posted = input.posted === false ? 0 : 1;

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO journal_entries
        (id, tenant_id, entry_number, entry_date, description, reference_type, reference_id,
         total_debit, total_credit, posted, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, input.tenantId, entryNumber, input.entry_date, input.description,
      input.reference_type ?? null, input.reference_id ?? null,
      totalDebit, totalCredit, posted, input.userId,
    );
    for (const ln of lines) {
      const acc = accountByCode(input.tenantId, ln.account_code);
      if (!acc) throw Object.assign(new Error(`Unknown account: ${ln.account_code}`), { code: 'unknown_account' });
      if (!acc.active) throw Object.assign(new Error(`Inactive account: ${ln.account_code}`), { code: 'inactive_account' });
      db.prepare(`
        INSERT INTO journal_lines (id, entry_id, account_id, debit, credit, description, cost_center)
        VALUES (?,?,?,?,?,?,?)
      `).run(uuid(), id, acc.id, ln.debit, ln.credit, ln.description ?? null, ln.cost_center ?? null);
    }
  });
  tx();
  return { id, entry_number: entryNumber };
}

/** Contas a Receber → Caixa/Banco when an invoice is marked paid. */
export function autoPostInvoicePaid(tenantId: string, userId: string, invoice: any): string | null {
  ensureChart(tenantId);
  const existing = db.prepare(`
    SELECT id FROM journal_entries
    WHERE tenant_id = ? AND reference_type = 'invoice_payment' AND reference_id = ?
  `).get(tenantId, invoice.id) as any;
  if (existing) return existing.id;

  const cashCode = invoice.payment_method === 'pix' || invoice.payment_method === 'transfer' || invoice.payment_method === 'card'
    ? '1.1.01.002'
    : '1.1.01.001';
  const arCode = '1.1.02.001';
  const amount = Number(invoice.total) || 0;
  if (amount <= 0) return null;

  const { id } = postJournal({
    tenantId,
    userId,
    entry_date: (invoice.paid_at || new Date().toISOString()).slice(0, 10),
    description: `Recebimento fatura ${invoice.invoice_number}`,
    reference_type: 'invoice_payment',
    reference_id: invoice.id,
    lines: [
      { account_code: cashCode, debit: amount, credit: 0, description: 'Recebimento' },
      { account_code: arCode, debit: 0, credit: amount, description: 'Baixa contas a receber' },
    ],
    posted: true,
  });
  return id;
}

/** On issue: Debit AR / Credit Revenue (clinical default). */
export function autoPostInvoiceIssued(tenantId: string, userId: string, invoice: any): string | null {
  ensureChart(tenantId);
  const existing = db.prepare(`
    SELECT id FROM journal_entries
    WHERE tenant_id = ? AND reference_type = 'invoice_issue' AND reference_id = ?
  `).get(tenantId, invoice.id) as any;
  if (existing) return existing.id;
  const amount = Number(invoice.total) || 0;
  if (amount <= 0) return null;
  const { id } = postJournal({
    tenantId,
    userId,
    entry_date: invoice.issue_date,
    description: `Emissão fatura ${invoice.invoice_number}`,
    reference_type: 'invoice_issue',
    reference_id: invoice.id,
    lines: [
      { account_code: '1.1.02.001', debit: amount, credit: 0, description: 'Contas a receber' },
      { account_code: '4.1.01.001', debit: 0, credit: amount, description: 'Receita de consultas' },
    ],
    posted: true,
  });
  return id;
}

export function trialBalance(tenantId: string, asOf: string, opts?: { activeOnly?: boolean }) {
  ensureChart(tenantId);
  const rows = db.prepare(`
    SELECT a.id, a.code, a.name, a.type, a.parent_id, a.active,
           COALESCE(SUM(x.debit), 0) AS total_debit,
           COALESCE(SUM(x.credit), 0) AS total_credit,
           COALESCE(SUM(x.debit), 0) - COALESCE(SUM(x.credit), 0) AS balance
    FROM chart_of_accounts a
    LEFT JOIN (
      SELECT jl.account_id, jl.debit, jl.credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.tenant_id = ? AND je.posted = 1 AND date(je.entry_date) <= ?
    ) x ON x.account_id = a.id
    WHERE a.tenant_id = ?
    GROUP BY a.id
    ORDER BY a.code
  `).all(tenantId, asOf, tenantId) as any[];
  const filtered = opts?.activeOnly === false ? rows : rows.filter((r) => r.active || r.total_debit || r.total_credit);
  const totals = filtered.reduce(
    (acc, r) => ({
      debit: acc.debit + Number(r.total_debit),
      credit: acc.credit + Number(r.total_credit),
    }),
    { debit: 0, credit: 0 },
  );
  return { as_of: asOf, accounts: filtered, totals };
}

export function incomeStatement(tenantId: string, from: string, to: string) {
  ensureChart(tenantId);
  const rows = db.prepare(`
    SELECT a.id, a.code, a.name, a.type,
           COALESCE(SUM(x.credit), 0) - COALESCE(SUM(x.debit), 0) AS amount
    FROM chart_of_accounts a
    LEFT JOIN (
      SELECT jl.account_id, jl.debit, jl.credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.tenant_id = ? AND je.posted = 1 AND date(je.entry_date) BETWEEN ? AND ?
    ) x ON x.account_id = a.id
    WHERE a.tenant_id = ? AND a.type IN ('revenue','expense') AND a.active = 1
    GROUP BY a.id
    ORDER BY a.type DESC, a.code
  `).all(tenantId, from, to, tenantId) as any[];

  const revenueLines = rows.filter((r) => r.type === 'revenue');
  const expenseLines = rows.filter((r) => r.type === 'expense');
  const total_revenue = revenueLines.reduce((s, r) => s + Number(r.amount), 0);
  const total_expenses = expenseLines.reduce((s, r) => s + Number(-r.amount), 0); // expenses usually credit-debit negative for IS natural
  // For expenses, natural balance is debit → amount (credit-debit) is negative; present as positive expense
  const expensePresented = expenseLines.map((r) => ({ ...r, amount: Math.abs(Number(r.amount)) }));
  const expTotal = expensePresented.reduce((s, r) => s + Number(r.amount), 0);
  const cogs = expensePresented
    .filter((r) => r.code === '5.1.02.006' || r.code === '5.1.02.005')
    .reduce((s, r) => s + Number(r.amount), 0);
  return {
    from, to,
    revenue_lines: revenueLines.map((r) => ({ ...r, amount: Number(r.amount) })),
    expense_lines: expensePresented,
    total_revenue,
    total_expenses: expTotal,
    cogs,
    medication_revenue: revenueLines
      .filter((r) => r.code === '4.1.01.005')
      .reduce((s, r) => s + Number(r.amount), 0),
    gross_margin: total_revenue - cogs,
    operating_income: total_revenue - expTotal,
    net_income: total_revenue - expTotal,
  };
}

export function balanceSheet(tenantId: string, asOf: string) {
  const tb = trialBalance(tenantId, asOf);
  const assets = tb.accounts.filter((a) => a.type === 'asset');
  const liabilities = tb.accounts.filter((a) => a.type === 'liability');
  const equity = tb.accounts.filter((a) => a.type === 'equity');

  // Asset natural = debit; liability/equity natural = credit
  const total_assets = assets.reduce((s, a) => s + Number(a.balance), 0);
  const total_liabilities = liabilities.reduce((s, a) => s + (-Number(a.balance)), 0);
  const total_equity_book = equity.reduce((s, a) => s + (-Number(a.balance)), 0);

  // Current year P&L rolled into equity for the as-of date
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const pl = incomeStatement(tenantId, yearStart, asOf);
  const total_equity = total_equity_book + pl.net_income;

  return {
    as_of: asOf,
    assets: assets.map((a) => ({ ...a, balance: Number(a.balance) })),
    liabilities: liabilities.map((a) => ({ ...a, balance: -Number(a.balance) })),
    equity: [
      ...equity.map((a) => ({ ...a, balance: -Number(a.balance) })),
      {
        id: 'net_income_ytd', code: '3.1.03.001', name: 'Resultado do Exercício (YTD)',
        type: 'equity', balance: pl.net_income, computed: true,
      },
    ],
    total_assets,
    total_liabilities,
    total_equity,
    total_liabilities_equity: total_liabilities + total_equity,
    balanced: Math.abs(total_assets - (total_liabilities + total_equity)) < 0.05,
  };
}

export function generalLedger(tenantId: string, accountId: string, from: string, to: string) {
  const account = db.prepare(`SELECT * FROM chart_of_accounts WHERE id = ? AND tenant_id = ?`).get(accountId, tenantId) as any;
  if (!account) return null;

  // Opening balance before `from`
  const openRow = db.prepare(`
    SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_id = ? AND je.tenant_id = ? AND je.posted = 1 AND date(je.entry_date) < ?
  `).get(accountId, tenantId, from) as any;
  const opening = Number(openRow.d) - Number(openRow.c);

  const movements = db.prepare(`
    SELECT je.id AS entry_id, je.entry_number, je.entry_date, je.description AS entry_description,
           je.reference_type, je.reference_id,
           jl.debit, jl.credit, jl.description AS line_description, jl.cost_center
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_id = ? AND je.tenant_id = ? AND je.posted = 1
      AND date(je.entry_date) BETWEEN ? AND ?
    ORDER BY je.entry_date ASC, je.entry_number ASC
  `).all(accountId, tenantId, from, to) as any[];

  let running = opening;
  const lines = movements.map((m) => {
    running += Number(m.debit) - Number(m.credit);
    return { ...m, balance: running };
  });

  return {
    account,
    from, to,
    opening_balance: opening,
    closing_balance: running,
    lines,
    period_debit: lines.reduce((s, l) => s + Number(l.debit), 0),
    period_credit: lines.reduce((s, l) => s + Number(l.credit), 0),
  };
}

export function journalDetail(tenantId: string, entryId: string) {
  const entry = db.prepare(`
    SELECT je.*, u.full_name AS created_by_name
    FROM journal_entries je
    LEFT JOIN users u ON u.id = je.created_by
    WHERE je.id = ? AND je.tenant_id = ?
  `).get(entryId, tenantId) as any;
  if (!entry) return null;
  const lines = db.prepare(`
    SELECT jl.*, a.code AS account_code, a.name AS account_name, a.type AS account_type
    FROM journal_lines jl
    JOIN chart_of_accounts a ON a.id = jl.account_id
    WHERE jl.entry_id = ?
    ORDER BY jl.debit DESC, a.code
  `).all(entryId);
  return { entry, lines };
}

export function ensurePeriodsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_periods (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
      closed_at TEXT,
      closed_by TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, period_start, period_end)
    );
  `);
}
