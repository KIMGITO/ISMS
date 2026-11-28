// src/services/dataExport.ts
//
// Export data: the owner picks a period (default the last 30 days) and gets one Excel workbook
// of the business's records, with a Summary sheet, charts and one clearly named sheet per
// record type. It replaces the old Google Sheets backup (no schedule, nothing runs at night).
//
// Money rule: every figure comes from the same rows the app and the books use. Profit is read
// from the books (acc_lines), never recomputed from a second source.
//
// Each step is fetched page by page and retried. Finished steps are kept in the job, so pressing
// Retry after a failure carries on from the step that failed.
import ExcelJS from 'exceljs';
import { getSupabase } from './supabaseClient';
import { moneyNumber, roundMoney, roundQty } from '../utils/money';

export interface ExportProgress {
  percent: number;
  label: string;
}

type Row = Record<string, any>;
type Fetcher = (businessId: string, fromIso: string, toIso: string) => Promise<Row[]>;

const PAGE = 1000;
const MONEY_FMT = '#,##0.00';
const QTY_FMT = '#,##0.#';

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 800 * 2 ** i));
    }
  }
  throw last;
}

/** Reads every row of a query, 1000 at a time (the API returns at most 1000 per call). */
async function allPages(build: (from: number, to: number) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withRetry(async () => {
      const res = await build(from, from + PAGE - 1);
      if (res.error) throw res.error;
      return res;
    });
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

const sb = () => getSupabase();

const STEPS: { key: string; label: string; fetch: Fetcher }[] = [
  {
    key: 'sales', label: 'Sales',
    fetch: (b, f, t) => allPages((a, z) => sb().from('transactions')
      .select('id, reference_id, timestamp, customer_name, staff_name, payment_method, total, discount, tax, final_total, amount_paid, wallet_applied, is_delivery, delivery_fee, rider_name')
      .eq('business_id', b).is('deleted_at', null).gte('timestamp', f).lte('timestamp', t)
      .order('timestamp').range(a, z)),
  },
  {
    key: 'items', label: 'Items sold',
    fetch: (b, f, t) => allPages((a, z) => sb().from('transaction_items')
      .select('product_name, quantity, unit_price, unit_cost, line_total, transactions!inner(timestamp, reference_id, business_id, deleted_at)')
      .eq('transactions.business_id', b).is('transactions.deleted_at', null)
      .gte('transactions.timestamp', f).lte('transactions.timestamp', t)
      .order('id').range(a, z)),
  },
  {
    key: 'expenses', label: 'Expenses',
    fetch: (b, f, t) => allPages((a, z) => sb().from('expenses')
      .select('reference_id, date, category, description, amount, payment_method, source, staff_name, rider_payment')
      .eq('business_id', b).is('deleted_at', null).gte('date', f).lte('date', t)
      .order('date').range(a, z)),
  },
  {
    key: 'debtPayments', label: 'Customer payments',
    fetch: (b, f, t) => allPages((a, z) => sb().from('debt_payments')
      .select('created_at, amount_paid, remaining_debt, payment_method, recorded_by, note, customers(name)')
      .eq('business_id', b).gte('created_at', f).lte('created_at', t)
      .order('created_at').range(a, z)),
  },
  {
    key: 'supplierPayments', label: 'Supplier payments',
    fetch: (b, f, t) => allPages((a, z) => sb().from('supplier_payments')
      .select('paid_at, supplier_name, amount, method, reference, note, recorded_by')
      .eq('business_id', b).is('voided_at', null).gte('paid_at', f).lte('paid_at', t)
      .order('paid_at').range(a, z)),
  },
  {
    key: 'products', label: 'Products and stock',
    fetch: (b) => allPages((a, z) => sb().from('products')
      .select('name, category, sku, unit, price, cost, stock, min_stock')
      .eq('business_id', b).is('deleted_at', null).order('name').range(a, z)),
  },
  {
    key: 'customers', label: 'Customers',
    fetch: (b) => allPages((a, z) => sb().from('customers')
      .select('name, phone, email, customer_type, tier, purchases_count, loyalty_points, debt_balance, wallet_balance, join_date')
      .eq('business_id', b).is('deleted_at', null).is('merged_into_id', null).order('name').range(a, z)),
  },
  {
    key: 'money', label: 'Money balances',
    fetch: (b) => allPages((a, z) => sb().from('money_assets')
      .select('method, balance, last_payment_at').eq('business_id', b).order('method').range(a, z)),
  },
  {
    key: 'accounts', label: 'Chart of accounts',
    fetch: (b) => allPages((a, z) => sb().from('acc_accounts')
      .select('id, code, name, type').eq('business_id', b).order('code').range(a, z)),
  },
  {
    key: 'lines', label: 'Books',
    fetch: (b, f, t) => allPages((a, z) => sb().from('acc_lines')
      .select('entry_date, account_id, debit, credit, party_name, memo, acc_entries(no, source_type, memo)')
      .eq('business_id', b).gte('entry_date', f.slice(0, 10)).lte('entry_date', t.slice(0, 10))
      .order('entry_date').range(a, z)),
  },
];

export class ExportJob {
  private done = new Map<string, Row[]>();

  constructor(
    private businessId: string,
    private from: Date,
    private to: Date,
    private businessName = 'Business',
  ) {}

  /** Runs (or carries on) the export and returns the workbook file. */
  async run(onProgress: (p: ExportProgress) => void): Promise<{ blob: Blob; filename: string }> {
    const fromIso = this.from.toISOString();
    const toIso = this.to.toISOString();
    const total = STEPS.length + 2;
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      onProgress({ percent: (i / total) * 100, label: `Reading ${step.label.toLowerCase()}` });
      if (!this.done.has(step.key)) {
        this.done.set(step.key, await step.fetch(this.businessId, fromIso, toIso));
      }
    }
    onProgress({ percent: (STEPS.length / total) * 100, label: 'Drawing charts and building the workbook' });
    const wb = buildWorkbook(this.done, this.from, this.to, this.businessName);
    const buffer = await wb.xlsx.writeBuffer();
    onProgress({ percent: 100, label: 'Done' });
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const safeName = this.businessName.replace(/[^\w\- ]+/g, '').trim() || 'Business';
    return {
      blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      filename: `${safeName} data ${day(this.from)} to ${day(this.to)}.xlsx`,
    };
  }
}

// ── workbook ──

const n = (v: any) => roundMoney(Number(v) || 0);
const day = (v: any) => (v ? String(v).slice(0, 10) : '');

function sum<T>(rows: T[], f: (r: T) => number) {
  return roundMoney(rows.reduce((s, r) => s + (Number(f(r)) || 0), 0));
}

function groupSum(rows: Row[], key: (r: Row) => string, val: (r: Row) => number) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r) || 'Other', (m.get(key(r) || 'Other') || 0) + (Number(val(r)) || 0));
  return [...m.entries()].map(([k, v]) => [k, roundMoney(v)] as [string, number]);
}

interface Col { header: string; key: string; width?: number; kind?: 'money' | 'qty' }

function addTable(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Row[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 4) }));
  rows.forEach((r) => ws.addRow(r));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  cols.forEach((c, i) => {
    if (c.kind) ws.getColumn(i + 1).numFmt = c.kind === 'money' ? MONEY_FMT : QTY_FMT;
  });
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

function buildWorkbook(data: Map<string, Row[]>, from: Date, to: Date, businessName: string) {
  const sales = data.get('sales') || [];
  const items = data.get('items') || [];
  const expenses = data.get('expenses') || [];
  const debtPayments = data.get('debtPayments') || [];
  const supplierPayments = data.get('supplierPayments') || [];
  const products = data.get('products') || [];
  const customers = data.get('customers') || [];
  const money = data.get('money') || [];
  const accounts = data.get('accounts') || [];
  const lines = data.get('lines') || [];
  const accById = new Map(accounts.map((a) => [a.id, a]));

  // Books: profit & loss per account for the period.
  const perAccount = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    const p = perAccount.get(l.account_id) || { debit: 0, credit: 0 };
    p.debit += Number(l.debit) || 0;
    p.credit += Number(l.credit) || 0;
    perAccount.set(l.account_id, p);
  }
  const pl = [...perAccount.entries()]
    .map(([id, v]) => ({ acc: accById.get(id), ...v }))
    .filter((r) => r.acc && (r.acc.type === 'income' || r.acc.type === 'expense'))
    .map((r) => ({
      code: r.acc.code, name: r.acc.name, type: r.acc.type === 'income' ? 'Income' : 'Expense',
      amount: roundMoney(r.acc.type === 'income' ? r.credit - r.debit : r.debit - r.credit),
    }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const income = sum(pl.filter((r) => r.type === 'Income'), (r) => r.amount);
  const spending = sum(pl.filter((r) => r.type === 'Expense'), (r) => r.amount);

  const daily = new Map<string, { count: number; total: number }>();
  for (const s of sales) {
    const d = day(s.timestamp);
    const cur = daily.get(d) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(s.final_total) || 0;
    daily.set(d, cur);
  }
  const dailyRows = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, count: v.count, total: roundMoney(v.total), average: roundMoney(v.total / v.count) }));
  const byMethod = groupSum(sales, (s) => s.payment_method, (s) => s.final_total);
  const byCategory = groupSum(expenses.filter((e) => !e.rider_payment), (e) => e.category, (e) => e.amount)
    .sort((a, b) => b[1] - a[1]);
  const productTotals = new Map<string, { qty: number; total: number; cost: number }>();
  for (const it of items) {
    const p = productTotals.get(it.product_name) || { qty: 0, total: 0, cost: 0 };
    p.qty += Number(it.quantity) || 0;
    p.total += Number(it.line_total) || 0;
    p.cost += (Number(it.unit_cost) || 0) * (Number(it.quantity) || 0);
    productTotals.set(it.product_name, p);
  }
  const productRows = [...productTotals.entries()]
    .map(([name, v]) => ({ name, qty: roundQty(v.qty), total: roundMoney(v.total), cost: roundMoney(v.cost), margin: roundMoney(v.total - v.cost) }))
    .sort((a, b) => b.total - a.total);

  const wb = new ExcelJS.Workbook();
  wb.creator = businessName;
  wb.created = new Date();

  // Summary
  const ws = wb.addWorksheet('Summary');
  ws.columns = [{ width: 34 }, { width: 20 }];
  ws.addRow([`${businessName} - data export`]).font = { bold: true, size: 14 };
  ws.addRow([`Period: ${day(from.toISOString())} to ${day(to.toISOString())}`]);
  ws.addRow([`Exported: ${new Date().toLocaleString()}`]);
  ws.addRow([]);
  const kpis: [string, number, 'money' | 'count'][] = [
    ['Sales (count)', sales.length, 'count'],
    ['Sales total', sum(sales, (s) => s.final_total), 'money'],
    ['Discounts given', sum(sales, (s) => s.discount), 'money'],
    ['Delivery fees', sum(sales, (s) => s.delivery_fee), 'money'],
    ['Customer debt payments received', sum(debtPayments, (d) => d.amount_paid), 'money'],
    ['Expenses paid (cash out)', sum(expenses, (e) => e.amount), 'money'],
    ['Supplier payments', sum(supplierPayments, (p) => p.amount), 'money'],
    ['Income (books)', income, 'money'],
    ['Spending (books)', spending, 'money'],
    ['Profit (books)', roundMoney(income - spending), 'money'],
    ['Customers owe now', sum(customers, (c) => c.debt_balance), 'money'],
    ['Customer wallets now', sum(customers, (c) => c.wallet_balance), 'money'],
    ['Stock value at cost now', sum(products, (p) => (Number(p.cost) || 0) * (Number(p.stock) || 0)), 'money'],
  ];
  for (const [label, value, kind] of kpis) {
    const r = ws.addRow([label, value]);
    r.getCell(1).font = { bold: true };
    if (kind === 'money') r.getCell(2).numFmt = MONEY_FMT;
  }
  ws.addRow([]);
  ws.addRow(['Money balances now']).font = { bold: true };
  for (const m of money) ws.addRow([m.method, n(m.balance)]).getCell(2).numFmt = MONEY_FMT;
  ws.addRow([]);
  ws.addRow(['Each sheet is one kind of record. Income, spending and profit come from the books.']).font = { italic: true };

  // Charts
  const charts = wb.addWorksheet('Charts');
  const images: [string, string | null][] = [
    ['Sales per day', drawBarChart('Sales per day (KSh)', dailyRows.map((d) => [d.date.slice(5), d.total]))],
    ['Sales by payment method', drawBarChart('Sales by payment method (KSh)', byMethod)],
    ['Top 10 products', drawBarChart('Top 10 products by sales (KSh)', productRows.slice(0, 10).map((p) => [p.name, p.total]))],
    ['Spending by category', drawBarChart('Expenses by category (KSh)', byCategory.slice(0, 10))],
  ];
  images.forEach(([, png], i) => {
    if (!png) return;
    const id = wb.addImage({ base64: png, extension: 'png' });
    charts.addImage(id, { tl: { col: (i % 2) * 10, row: Math.floor(i / 2) * 22 }, ext: { width: 640, height: 400 } });
  });

  addTable(wb, 'Daily sales', [
    { header: 'Date', key: 'date' }, { header: 'Sales', key: 'count' },
    { header: 'Total', key: 'total', kind: 'money' }, { header: 'Average sale', key: 'average', kind: 'money' },
  ], dailyRows);

  addTable(wb, 'Sales', [
    { header: 'Receipt', key: 'ref', width: 16 }, { header: 'Date', key: 'date', width: 20 },
    { header: 'Customer', key: 'customer', width: 22 }, { header: 'Staff', key: 'staff', width: 18 },
    { header: 'Method', key: 'method' }, { header: 'Subtotal', key: 'total', kind: 'money' },
    { header: 'Discount', key: 'discount', kind: 'money' }, { header: 'Tax', key: 'tax', kind: 'money' },
    { header: 'Total', key: 'final', kind: 'money' }, { header: 'Paid', key: 'paid', kind: 'money' },
    { header: 'From wallet', key: 'wallet', kind: 'money' }, { header: 'Delivery fee', key: 'fee', kind: 'money' },
    { header: 'Rider', key: 'rider' },
  ], sales.map((s) => ({
    ref: s.reference_id || '', date: String(s.timestamp || '').replace('T', ' ').slice(0, 16),
    customer: s.customer_name || '', staff: s.staff_name || '', method: s.payment_method || '',
    total: n(s.total), discount: n(s.discount), tax: n(s.tax), final: n(s.final_total), paid: n(s.amount_paid),
    wallet: n(s.wallet_applied), fee: n(s.delivery_fee), rider: s.rider_name || '',
  })));

  addTable(wb, 'Product sales', [
    { header: 'Product', key: 'name', width: 30 }, { header: 'Quantity', key: 'qty', kind: 'qty' },
    { header: 'Sales', key: 'total', kind: 'money' }, { header: 'Cost', key: 'cost', kind: 'money' },
    { header: 'Margin', key: 'margin', kind: 'money' },
  ], productRows);

  addTable(wb, 'Items sold', [
    { header: 'Receipt', key: 'ref', width: 16 }, { header: 'Date', key: 'date' },
    { header: 'Product', key: 'name', width: 30 }, { header: 'Quantity', key: 'qty', kind: 'qty' },
    { header: 'Unit price', key: 'price', kind: 'money' }, { header: 'Line total', key: 'total', kind: 'money' },
  ], items.map((it) => ({
    ref: it.transactions?.reference_id || '', date: day(it.transactions?.timestamp), name: it.product_name,
    qty: roundQty(it.quantity), price: n(it.unit_price), total: n(it.line_total),
  })));

  addTable(wb, 'Expenses', [
    { header: 'Reference', key: 'ref', width: 16 }, { header: 'Date', key: 'date' },
    { header: 'Category', key: 'category', width: 20 }, { header: 'Description', key: 'description', width: 32 },
    { header: 'Amount', key: 'amount', kind: 'money' }, { header: 'Method', key: 'method' },
    { header: 'Paid from', key: 'source' }, { header: 'Staff', key: 'staff' },
    { header: 'Pays rider debt', key: 'rider' },
  ], expenses.map((e) => ({
    ref: e.reference_id || '', date: day(e.date), category: e.category, description: e.description || '',
    amount: n(e.amount), method: e.payment_method || '', source: e.source || '', staff: e.staff_name || '',
    rider: e.rider_payment ? 'Yes' : '',
  })));

  addTable(wb, 'Customer payments', [
    { header: 'Date', key: 'date' }, { header: 'Customer', key: 'customer', width: 24 },
    { header: 'Paid', key: 'paid', kind: 'money' }, { header: 'Still owes', key: 'left', kind: 'money' },
    { header: 'Method', key: 'method' }, { header: 'Recorded by', key: 'by' }, { header: 'Note', key: 'note', width: 28 },
  ], debtPayments.map((d) => ({
    date: day(d.created_at), customer: d.customers?.name || '', paid: n(d.amount_paid), left: n(d.remaining_debt),
    method: d.payment_method || '', by: d.recorded_by || '', note: d.note || '',
  })));

  addTable(wb, 'Supplier payments', [
    { header: 'Date', key: 'date' }, { header: 'Supplier', key: 'supplier', width: 24 },
    { header: 'Amount', key: 'amount', kind: 'money' }, { header: 'Method', key: 'method' },
    { header: 'Reference', key: 'ref' }, { header: 'Recorded by', key: 'by' }, { header: 'Note', key: 'note', width: 28 },
  ], supplierPayments.map((p) => ({
    date: day(p.paid_at), supplier: p.supplier_name || '', amount: n(p.amount), method: p.method || '',
    ref: p.reference || '', by: p.recorded_by || '', note: p.note || '',
  })));

  addTable(wb, 'Products and stock', [
    { header: 'Product', key: 'name', width: 30 }, { header: 'Category', key: 'category', width: 18 },
    { header: 'SKU', key: 'sku' }, { header: 'Unit', key: 'unit' },
    { header: 'Price', key: 'price', kind: 'money' }, { header: 'Cost', key: 'cost', kind: 'money' },
    { header: 'In stock', key: 'stock', kind: 'qty' }, { header: 'Low at', key: 'min', kind: 'qty' },
    { header: 'Stock value at cost', key: 'value', kind: 'money', width: 20 },
  ], products.map((p) => ({
    name: p.name, category: p.category || '', sku: p.sku || '', unit: p.unit || '', price: n(p.price), cost: n(p.cost),
    stock: roundQty(p.stock), min: roundQty(p.min_stock), value: n((Number(p.cost) || 0) * (Number(p.stock) || 0)),
  })));

  addTable(wb, 'Customers', [
    { header: 'Name', key: 'name', width: 24 }, { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Email', key: 'email', width: 24 }, { header: 'Type', key: 'type' }, { header: 'Tier', key: 'tier' },
    { header: 'Purchases', key: 'count' }, { header: 'Points', key: 'points' },
    { header: 'Owes', key: 'debt', kind: 'money' }, { header: 'Wallet', key: 'wallet', kind: 'money' },
    { header: 'Joined', key: 'joined' },
  ], customers.map((c) => ({
    name: c.name, phone: c.phone || '', email: c.email || '', type: c.customer_type || '', tier: c.tier || '',
    count: c.purchases_count || 0, points: c.loyalty_points || 0, debt: n(c.debt_balance), wallet: n(c.wallet_balance),
    joined: day(c.join_date),
  })));

  addTable(wb, 'Profit and loss', [
    { header: 'Code', key: 'code' }, { header: 'Account', key: 'name', width: 30 },
    { header: 'Type', key: 'type' }, { header: 'Amount', key: 'amount', kind: 'money' },
  ], [...pl, { code: '', name: 'Profit', type: '', amount: roundMoney(income - spending) }]);

  addTable(wb, 'Books', [
    { header: 'Date', key: 'date' }, { header: 'Entry', key: 'no' }, { header: 'Account', key: 'account', width: 28 },
    { header: 'Debit', key: 'debit', kind: 'money' }, { header: 'Credit', key: 'credit', kind: 'money' },
    { header: 'From', key: 'source' }, { header: 'Who', key: 'party', width: 20 }, { header: 'Memo', key: 'memo', width: 32 },
  ], lines.map((l) => {
    const acc = accById.get(l.account_id);
    return {
      date: day(l.entry_date), no: l.acc_entries?.no ?? '', account: acc ? `${acc.code} ${acc.name}` : '',
      debit: n(l.debit), credit: n(l.credit), source: l.acc_entries?.source_type || '',
      party: l.party_name || '', memo: l.memo || l.acc_entries?.memo || '',
    };
  }));

  return wb;
}

/** Draws a simple bar chart and returns it as a base64 PNG data URL (null when there is nothing to draw). */
function drawBarChart(title: string, data: [string, number][]): string | null {
  if (!data.length || typeof document === 'undefined') return null;
  const W = 1280, H = 800, pad = { l: 140, r: 40, t: 90, b: 170 };
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(title, pad.l, 55);
  const max = Math.max(...data.map(([, v]) => v), 1);
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  ctx.strokeStyle = '#e5e7eb';
  ctx.fillStyle = '#6b7280';
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + plotH - (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(W - pad.r, y);
    ctx.stroke();
    ctx.fillText(moneyNumber((max * i) / 4), pad.l - 12, y + 7);
  }
  const slot = plotW / data.length;
  const bw = Math.max(4, Math.min(80, slot * 0.7));
  data.forEach(([label, v], i) => {
    const x = pad.l + slot * i + (slot - bw) / 2;
    const h = (plotH * Math.max(0, v)) / max;
    ctx.fillStyle = '#d97706';
    ctx.fillRect(x, pad.t + plotH - h, bw, h);
    if (data.length <= 40 || i % Math.ceil(data.length / 40) === 0) {
      ctx.save();
      ctx.translate(x + bw / 2, pad.t + plotH + 14);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#374151';
      ctx.textAlign = 'right';
      ctx.fillText(String(label).slice(0, 18), 0, 0);
      ctx.restore();
    }
  });
  return canvas.toDataURL('image/png');
}
