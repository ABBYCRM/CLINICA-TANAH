/**
 * Prescription ↔ Inventory ↔ Contabilidade bridge.
 * Dispense clinic-stock lines from a prescription (FEFO), write stock trail,
 * issue medication invoice, post COGS + revenue journals for internal P&L.
 */
import { v4 as uuid } from 'uuid';
import { db } from '../db/schema';
import { revealPrescriptionItems } from './phiCrypto';
import {
  ensureChart,
  postJournal,
  autoPostInvoiceIssued,
  autoPostInvoicePaid,
  accountByCode,
  CLINIC_COA,
  ensurePeriodsTable,
} from './ledger';

export type RxStockItem = {
  medication: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string | null;
  inventory_item_id?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
};

export type DispenseResult = {
  prescription_id: string;
  dispensed: boolean;
  already?: boolean;
  movements: Array<{
    id: string;
    item_id: string;
    item_name: string;
    batch_id: string | null;
    batch_number: string | null;
    quantity: number;
    cost_per_unit: number;
  }>;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_total: number;
  invoice_status: string | null;
  cogs_journal_id: string | null;
  revenue_journal_id: string | null;
  payment_journal_id: string | null;
  total_cogs: number;
  stock_lines: number;
};

/** Ensure medication revenue + COGS accounts exist even on older seeded charts. */
export function ensureDispenseAccounts(tenantId: string): void {
  ensureChart(tenantId);
  ensurePeriodsTable();
  const extras = [
    { code: '4.1.01.005', name: 'Receita de Medicamentos', type: 'revenue' },
    { code: '5.1.02.006', name: 'Medicamentos Consumidos (CMV)', type: 'expense' },
    { code: '5.1.02.005', name: 'Material de Consumo', type: 'expense' },
    { code: '1.1.03.001', name: 'Estoque de Medicamentos', type: 'asset' },
  ];
  for (const a of extras) {
    if (accountByCode(tenantId, a.code)) continue;
    const fromClinic = CLINIC_COA.find((c) => c.code === a.code);
    db.prepare(`
      INSERT INTO chart_of_accounts (id, tenant_id, code, name, type, parent_id, active)
      VALUES (?,?,?,?,?,?,1)
    `).run(uuid(), tenantId, a.code, fromClinic?.name || a.name, a.type, null);
  }
}

function stockAvailable(tenantId: string, itemId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS q
    FROM inventory_batches
    WHERE tenant_id = ? AND item_id = ? AND quantity > 0
      AND date(expiry_date) >= date('now')
  `).get(tenantId, itemId) as any;
  return Number(row?.q || 0);
}

/**
 * FEFO stock-out for one item; writes one stock_movements row per batch slice.
 * Returns movement details + total COGS for that line.
 */
function fefoOut(args: {
  tenantId: string;
  userId: string;
  itemId: string;
  quantity: number;
  referenceId: string;
  reason?: string;
}): {
  movements: DispenseResult['movements'];
  totalCost: number;
} {
  const item = db.prepare(`
    SELECT id, name, sale_price, unit_cost, category
    FROM inventory_items WHERE id = ? AND tenant_id = ? AND active = 1
  `).get(args.itemId, args.tenantId) as any;
  if (!item) {
    throw Object.assign(new Error('item_not_found'), { code: 'item_not_found', item_id: args.itemId });
  }
  const available = stockAvailable(args.tenantId, args.itemId);
  if (available + 1e-9 < args.quantity) {
    throw Object.assign(new Error('insufficient_stock'), {
      code: 'insufficient_stock',
      item_id: args.itemId,
      item_name: item.name,
      available,
      requested: args.quantity,
    });
  }

  let remaining = args.quantity;
  const movements: DispenseResult['movements'] = [];
  let totalCost = 0;
  const batches = db.prepare(`
    SELECT * FROM inventory_batches
    WHERE tenant_id = ? AND item_id = ? AND quantity > 0
      AND date(expiry_date) >= date('now')
    ORDER BY date(expiry_date) ASC
  `).all(args.tenantId, args.itemId) as any[];

  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(Number(b.quantity), remaining);
    db.prepare(`UPDATE inventory_batches SET quantity = quantity - ? WHERE id = ?`).run(take, b.id);
    const movId = uuid();
    db.prepare(`
      INSERT INTO stock_movements
        (id, tenant_id, item_id, batch_id, movement_type, quantity, reason, reference_id, user_id)
      VALUES (?,?,?,?, 'out', ?, ?, ?, ?)
    `).run(
      movId, args.tenantId, args.itemId, b.id, take,
      args.reason || 'prescription_dispense', args.referenceId, args.userId,
    );
    const cpu = Number(b.cost_per_unit ?? item.unit_cost ?? 0);
    totalCost += cpu * take;
    movements.push({
      id: movId,
      item_id: args.itemId,
      item_name: item.name,
      batch_id: b.id,
      batch_number: b.batch_number,
      quantity: take,
      cost_per_unit: cpu,
    });
    remaining -= take;
  }
  if (remaining > 1e-9) {
    throw Object.assign(new Error('insufficient_stock'), { code: 'insufficient_stock' });
  }
  return { movements, totalCost };
}

function reverseStock(args: {
  tenantId: string;
  userId: string;
  prescriptionId: string;
}): number {
  const outs = db.prepare(`
    SELECT * FROM stock_movements
    WHERE tenant_id = ? AND reference_id = ? AND reason = 'prescription_dispense' AND movement_type = 'out'
  `).all(args.tenantId, args.prescriptionId) as any[];
  let restored = 0;
  for (const m of outs) {
    // Avoid double-reverse
    const already = db.prepare(`
      SELECT id FROM stock_movements
      WHERE tenant_id = ? AND reference_id = ? AND reason = 'prescription_dispense_reverse'
        AND batch_id IS ? AND item_id = ? AND quantity = ? AND movement_type = 'in'
      LIMIT 1
    `).get(args.tenantId, args.prescriptionId, m.batch_id, m.item_id, m.quantity) as any;
    if (already) continue;
    if (m.batch_id) {
      db.prepare(`UPDATE inventory_batches SET quantity = quantity + ? WHERE id = ?`).run(m.quantity, m.batch_id);
    }
    db.prepare(`
      INSERT INTO stock_movements
        (id, tenant_id, item_id, batch_id, movement_type, quantity, reason, reference_id, user_id)
      VALUES (?,?,?,?, 'in', ?, 'prescription_dispense_reverse', ?, ?)
    `).run(uuid(), args.tenantId, m.item_id, m.batch_id, m.quantity, args.prescriptionId, args.userId);
    restored += Number(m.quantity);
  }
  return restored;
}

export function stockLinkedItems(items: RxStockItem[]): RxStockItem[] {
  return (items || []).filter((it) => it.inventory_item_id && Number(it.quantity) > 0);
}

/**
 * Dispense clinic-stock lines on a prescription.
 * - Decrements inventory (FEFO)
 * - Creates invoice (medicamentos) linked to patient/encounter/Rx
 * - Posts COGS (Dr CMV / Cr Estoque) and revenue (Dr AR / Cr Receita Medicamentos)
 * - Optionally marks paid → cash journal
 */
export function dispensePrescription(args: {
  tenantId: string;
  userId: string;
  prescriptionId: string;
  markPaid?: boolean;
  paymentMethod?: string | null;
  force?: boolean;
}): DispenseResult {
  ensureDispenseAccounts(args.tenantId);

  const rx = db.prepare(`SELECT * FROM prescriptions WHERE id = ? AND tenant_id = ?`)
    .get(args.prescriptionId, args.tenantId) as any;
  if (!rx) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  if ((rx.status || 'active') === 'cancelled') {
    throw Object.assign(new Error('prescription_cancelled'), { code: 'prescription_cancelled' });
  }

  if ((rx.dispense_status || 'none') === 'dispensed' && !args.force) {
    const inv = rx.invoice_id
      ? db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(rx.invoice_id) as any
      : null;
    return {
      prescription_id: rx.id,
      dispensed: true,
      already: true,
      movements: [],
      invoice_id: rx.invoice_id || null,
      invoice_number: inv?.invoice_number || null,
      invoice_total: Number(inv?.total || 0),
      invoice_status: inv?.status || null,
      cogs_journal_id: null,
      revenue_journal_id: null,
      payment_journal_id: null,
      total_cogs: 0,
      stock_lines: 0,
    };
  }

  let items: RxStockItem[] = [];
  try {
    const revealed = revealPrescriptionItems(rx.items);
    items = Array.isArray(revealed) ? revealed : [];
  } catch {
    items = [];
  }
  const linked = stockLinkedItems(items);
  if (!linked.length) {
    throw Object.assign(new Error('no_stock_lines'), {
      code: 'no_stock_lines',
      message: 'Nenhum item vinculado ao estoque com quantidade.',
    });
  }

  const patient = db.prepare(`SELECT id, full_name FROM patients WHERE id = ? AND tenant_id = ?`)
    .get(rx.patient_id, args.tenantId) as any;
  const practitioner = db.prepare(`SELECT id, full_name FROM users WHERE id = ?`)
    .get(rx.practitioner_id) as any;

  const allMovements: DispenseResult['movements'] = [];
  let totalCogs = 0;
  const invoiceLines: Array<{ description: string; quantity: number; unit_price: number; item_id: string }> = [];

  const run = db.transaction(() => {
    for (const line of linked) {
      const qty = Number(line.quantity);
      const item = db.prepare(`
        SELECT id, name, sale_price, unit_cost FROM inventory_items
        WHERE id = ? AND tenant_id = ?
      `).get(line.inventory_item_id, args.tenantId) as any;
      if (!item) {
        throw Object.assign(new Error('item_not_found'), { code: 'item_not_found', item_id: line.inventory_item_id });
      }
      const { movements, totalCost } = fefoOut({
        tenantId: args.tenantId,
        userId: args.userId,
        itemId: item.id,
        quantity: qty,
        referenceId: rx.id,
        reason: 'prescription_dispense',
      });
      allMovements.push(...movements);
      totalCogs += totalCost;
      const unitPrice = line.unit_price != null && line.unit_price >= 0
        ? Number(line.unit_price)
        : Number(item.sale_price || item.unit_cost || 0);
      invoiceLines.push({
        description: `${item.name} — Rx ${practitioner?.full_name || 'profissional'} → ${patient?.full_name || rx.patient_id}`,
        quantity: qty,
        unit_price: unitPrice,
        item_id: item.id,
      });
    }

    const invoiceTotal = invoiceLines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
    const invoiceId = uuid();
    const invoiceNumber = `RX-${Date.now().toString(36).toUpperCase()}`;
    const issueDate = new Date().toISOString().slice(0, 10);
    const status = args.markPaid ? 'paid' : 'issued';
    const paidAt = args.markPaid ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null;

    db.prepare(`
      INSERT INTO invoices (
        id, tenant_id, invoice_number, patient_id, vendor_id, encounter_id,
        issue_date, due_date, total, status, payment_method, paid_at, prescription_id
      ) VALUES (?,?,?,?,NULL,?,?,NULL,?,?,?,?,?)
    `).run(
      invoiceId, args.tenantId, invoiceNumber, rx.patient_id, rx.encounter_id,
      issueDate, invoiceTotal, status, args.paymentMethod ?? null, paidAt, rx.id,
    );
    for (const ln of invoiceLines) {
      db.prepare(`
        INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_price, tax_rate)
        VALUES (?,?,?,?,?,0)
      `).run(uuid(), invoiceId, ln.description, ln.quantity, ln.unit_price);
    }

    db.prepare(`
      UPDATE prescriptions
      SET dispense_status = 'dispensed', dispensed_at = datetime('now'), dispensed_by = ?, invoice_id = ?
      WHERE id = ? AND tenant_id = ?
    `).run(args.userId, invoiceId, rx.id, args.tenantId);

    return { invoiceId, invoiceNumber, invoiceTotal, status, issueDate };
  });

  const { invoiceId, invoiceNumber, invoiceTotal, status, issueDate } = run();

  let cogsJournalId: string | null = null;
  let revenueJournalId: string | null = null;
  let paymentJournalId: string | null = null;

  if (totalCogs > 0.009) {
    try {
      const { id } = postJournal({
        tenantId: args.tenantId,
        userId: args.userId,
        entry_date: issueDate,
        description: `CMV dispensação receita ${rx.id.slice(0, 8)} — ${patient?.full_name || ''}`,
        reference_type: 'prescription_dispense',
        reference_id: rx.id,
        lines: [
          { account_code: '5.1.02.006', debit: totalCogs, credit: 0, description: 'Medicamentos consumidos (CMV)' },
          { account_code: '1.1.03.001', debit: 0, credit: totalCogs, description: 'Baixa estoque medicamentos' },
        ],
      });
      cogsJournalId = id;
    } catch (e: any) {
      // Don't fail the clinical dispense if period closed — stock already moved
      if (e?.code !== 'period_closed') throw e;
    }
  }

  if (invoiceTotal > 0.009) {
    const inv = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoiceId) as any;
    // Prefer medication revenue (not consultas)
    try {
      ensureDispenseAccounts(args.tenantId);
      const existing = db.prepare(`
        SELECT id FROM journal_entries
        WHERE tenant_id = ? AND reference_type = 'invoice_issue' AND reference_id = ?
      `).get(args.tenantId, invoiceId) as any;
      if (!existing) {
        const { id } = postJournal({
          tenantId: args.tenantId,
          userId: args.userId,
          entry_date: issueDate,
          description: `Receita medicamentos — fatura ${invoiceNumber}`,
          reference_type: 'invoice_issue',
          reference_id: invoiceId,
          lines: [
            { account_code: '1.1.02.001', debit: invoiceTotal, credit: 0, description: 'Contas a receber' },
            { account_code: '4.1.01.005', debit: 0, credit: invoiceTotal, description: 'Receita de medicamentos' },
          ],
        });
        revenueJournalId = id;
      } else {
        revenueJournalId = existing.id;
      }
    } catch (e: any) {
      if (e?.code !== 'period_closed') {
        // Fallback to generic helper
        revenueJournalId = autoPostInvoiceIssued(args.tenantId, args.userId, inv);
      }
    }

    if (args.markPaid) {
      paymentJournalId = autoPostInvoicePaid(args.tenantId, args.userId, {
        ...inv,
        payment_method: args.paymentMethod || inv.payment_method,
        paid_at: inv.paid_at || new Date().toISOString(),
      });
    }
  }

  return {
    prescription_id: rx.id,
    dispensed: true,
    movements: allMovements,
    invoice_id: invoiceId,
    invoice_number: invoiceNumber,
    invoice_total: invoiceTotal,
    invoice_status: status,
    cogs_journal_id: cogsJournalId,
    revenue_journal_id: revenueJournalId,
    payment_journal_id: paymentJournalId,
    total_cogs: Math.round(totalCogs * 100) / 100,
    stock_lines: linked.length,
  };
}

/** Reverse stock when a dispensed Rx is cancelled (unpaid invoice cancelled; paid kept for fiscal). */
export function reverseDispenseOnCancel(args: {
  tenantId: string;
  userId: string;
  prescriptionId: string;
}): { restored_units: number; invoice_cancelled: boolean; invoice_id: string | null } {
  const rx = db.prepare(`SELECT * FROM prescriptions WHERE id = ? AND tenant_id = ?`)
    .get(args.prescriptionId, args.tenantId) as any;
  if (!rx) return { restored_units: 0, invoice_cancelled: false, invoice_id: null };
  if ((rx.dispense_status || 'none') !== 'dispensed') {
    return { restored_units: 0, invoice_cancelled: false, invoice_id: rx.invoice_id || null };
  }

  const restored = reverseStock({
    tenantId: args.tenantId,
    userId: args.userId,
    prescriptionId: args.prescriptionId,
  });

  let invoiceCancelled = false;
  if (rx.invoice_id) {
    const inv = db.prepare(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ?`)
      .get(rx.invoice_id, args.tenantId) as any;
    if (inv && inv.status !== 'paid') {
      db.prepare(`UPDATE invoices SET status = 'cancelled' WHERE id = ? AND tenant_id = ?`)
        .run(rx.invoice_id, args.tenantId);
      invoiceCancelled = true;
    }
  }

  db.prepare(`
    UPDATE prescriptions SET dispense_status = 'reversed'
    WHERE id = ? AND tenant_id = ?
  `).run(args.prescriptionId, args.tenantId);

  return { restored_units: restored, invoice_cancelled: invoiceCancelled, invoice_id: rx.invoice_id || null };
}

/** Trail for a prescription: movements, invoice, payment, journals. */
export function prescriptionDispenseTrail(tenantId: string, prescriptionId: string) {
  const rx = db.prepare(`
    SELECT pr.*, p.full_name AS patient_name, u.full_name AS practitioner_name,
           du.full_name AS dispensed_by_name
    FROM prescriptions pr
    JOIN patients p ON p.id = pr.patient_id
    JOIN users u ON u.id = pr.practitioner_id
    LEFT JOIN users du ON du.id = pr.dispensed_by
    WHERE pr.id = ? AND pr.tenant_id = ?
  `).get(prescriptionId, tenantId) as any;
  if (!rx) return null;

  const movements = db.prepare(`
    SELECT m.*, i.name AS item_name, i.sku, b.batch_number, u.full_name AS user_name
    FROM stock_movements m
    JOIN inventory_items i ON i.id = m.item_id
    LEFT JOIN inventory_batches b ON b.id = m.batch_id
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ? AND m.reference_id = ?
      AND m.reason IN ('prescription_dispense','prescription_dispense_reverse')
    ORDER BY m.created_at ASC
  `).all(tenantId, prescriptionId) as any[];

  const invoice = rx.invoice_id
    ? db.prepare(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ?`).get(rx.invoice_id, tenantId) as any
    : null;
  const invoiceLines = invoice
    ? db.prepare(`SELECT * FROM invoice_lines WHERE invoice_id = ?`).all(invoice.id) as any[]
    : [];

  const journals = db.prepare(`
    SELECT id, entry_number, entry_date, description, reference_type, reference_id,
           total_debit, total_credit, posted
    FROM journal_entries
    WHERE tenant_id = ? AND (
      (reference_type = 'prescription_dispense' AND reference_id = ?)
      OR (reference_type IN ('invoice_issue','invoice_payment') AND reference_id = ?)
    )
    ORDER BY entry_date, created_at
  `).all(tenantId, prescriptionId, rx.invoice_id || '') as any[];

  const stockTotals = movements
    .filter((m) => m.movement_type === 'out' && m.reason === 'prescription_dispense')
    .reduce((acc: Record<string, any>, m) => {
      const k = m.item_id;
      if (!acc[k]) acc[k] = { item_id: k, item_name: m.item_name, sku: m.sku, quantity: 0 };
      acc[k].quantity += Number(m.quantity);
      return acc;
    }, {});

  return {
    prescription: {
      id: rx.id,
      patient_id: rx.patient_id,
      patient_name: rx.patient_name,
      practitioner_id: rx.practitioner_id,
      practitioner_name: rx.practitioner_name,
      status: rx.status || 'active',
      dispense_status: rx.dispense_status || 'none',
      dispensed_at: rx.dispensed_at || null,
      dispensed_by: rx.dispensed_by || null,
      dispensed_by_name: rx.dispensed_by_name || null,
      created_at: rx.created_at,
    },
    stock_out: Object.values(stockTotals),
    movements,
    invoice: invoice ? {
      ...invoice,
      lines: invoiceLines,
      paid: invoice.status === 'paid',
    } : null,
    journals,
    paid: invoice?.status === 'paid',
  };
}
