// Accounting: the double-entry books the database keeps from sales, expenses, petty cash,
// customer payments, purchases, supplier payments and stock losses
// (supabase/migrations/20261116003_accounting.sql). This file calls those functions and
// turns account balances into the trial balance, profit & loss and balance sheet.
import { getSupabase } from './supabaseClient';
import { toUuid } from '../utils/idUtils';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface AccountBalance {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  /** Set on accounts the app posts to (cash, sales, …); `exp:<category>` for expense categories. */
  key: string | null;
  description: string | null;
  active: boolean;
  /** Debit minus credit before the period. */
  opening: number;
  debit: number;
  credit: number;
  /** Debit minus credit at the end of the period. */
  closing: number;
  lines: number;
}

export interface AccountingReport {
  start: string;
  end: string;
  accounts: AccountBalance[];
  lockDate: string | null;
  errors: number;
  firstDate: string | null;
  canManage: boolean;
}

export interface JournalLine {
  accountId: string;
  code: string;
  account: string;
  type: AccountType;
  debit: number;
  credit: number;
  party: string | null;
  memo: string | null;
}

export interface JournalEntry {
  id: string;
  no: number;
  date: string;
  memo: string;
  /** null = typed by a person. */
  source: SourceType | null;
  sourceId: string | null;
  reversalOf: string | null;
  reversed: boolean;
  by: string;
  at: string;
  lines: JournalLine[];
}

export type SourceType = 'sale' | 'expense' | 'cledger' | 'payment' | 'purchase' | 'supplier_payment' | 'stock_adj'
  | 'sales_delivery' | 'sales_invoice' | 'invoice_payment' | 'credit_note';

export const SOURCE_LABELS: Record<SourceType | 'manual', string> = {
  sale: 'Sale',
  expense: 'Expense',
  cledger: 'Customer money',
  payment: 'Payment',
  purchase: 'Purchase',
  supplier_payment: 'Supplier payment',
  stock_adj: 'Stock',
  sales_delivery: 'Order delivery',
  sales_invoice: 'Invoice',
  invoice_payment: 'Invoice payment',
  credit_note: 'Credit note',
  manual: 'Typed entry',
};

export const TYPE_LABELS: Record<AccountType, string> = {
  asset: 'What we own',
  liability: 'What we owe',
  equity: "Owner's share",
  income: 'Income',
  expense: 'Expenses',
};

/** Money accounts, by their key. They move the Payments screen balances too. */
export const MONEY_KEYS = ['cash', 'mpesa', 'airtel', 'bank', 'card'] as const;
export const isMoneyKey = (key: string | null) => !!key && (MONEY_KEYS as readonly string[]).includes(key);

const n = (v: unknown) => Number(v) || 0;

function toAccount(r: any): AccountBalance {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    key: r.key ?? null,
    description: r.description ?? null,
    active: r.active !== false,
    opening: n(r.opening),
    debit: n(r.debit),
    credit: n(r.credit),
    closing: n(r.closing),
    lines: n(r.lines),
  };
}

function toEntry(r: any): JournalEntry {
  return {
    id: r.id,
    no: n(r.no),
    date: r.date,
    memo: r.memo || '',
    source: r.source ?? null,
    sourceId: r.sourceId ?? null,
    reversalOf: r.reversalOf ?? null,
    reversed: !!r.reversed,
    by: r.by || '',
    at: r.at,
    lines: (r.lines || []).map((l: any) => ({ ...l, debit: n(l.debit), credit: n(l.credit) })),
  };
}

async function rpc<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw error;
  return data as T;
}

// ---------------------------------------------------------------- reading

export async function loadReport(businessId: string, start: string, end: string): Promise<AccountingReport> {
  const r = await rpc('acc_report', { p_business_id: toUuid(businessId), p_start: start, p_end: end });
  return {
    start: r.start,
    end: r.end,
    accounts: (r.accounts || []).map(toAccount),
    lockDate: r.settings?.lockDate ?? null,
    errors: n(r.errors),
    firstDate: r.firstDate ?? null,
    canManage: !!r.canManage,
  };
}

export async function loadJournal(
  businessId: string,
  opts: { start: string; end: string; search?: string; kind?: SourceType | 'manual' | null; limit?: number; offset?: number },
): Promise<{ total: number; entries: JournalEntry[] }> {
  const r = await rpc('acc_journal', {
    p_business_id: toUuid(businessId),
    p_start: opts.start,
    p_end: opts.end,
    p_search: opts.search || null,
    p_kind: opts.kind || null,
    p_limit: opts.limit ?? 100,
    p_offset: opts.offset ?? 0,
  });
  return { total: n(r.total), entries: (r.entries || []).map(toEntry) };
}

export interface LedgerLine {
  entryId: string;
  no: number;
  date: string;
  memo: string;
  source: SourceType | null;
  party: string | null;
  debit: number;
  credit: number;
  /** Debit minus credit after this line. */
  balance: number;
}

export async function loadLedger(accountId: string, start: string, end: string, limit = 500) {
  const r = await rpc('acc_ledger', { p_account_id: accountId, p_start: start, p_end: end, p_limit: limit });
  return {
    opening: n(r.opening),
    total: n(r.total),
    lines: (r.lines || []).map((l: any): LedgerLine => ({ ...l, no: n(l.no), debit: n(l.debit), credit: n(l.credit), balance: n(l.balance) })),
  };
}

export interface Receivable {
  customerId: string;
  name: string;
  phone: string | null;
  owes: number;
  holds: number;
  appDebt: number;
  /** Part of appDebt that is open invoices (Quotes & Invoices), not till debt. */
  invoices?: number;
  appWallet: number;
  lastDate: string | null;
  since: string | null;
}

export async function loadReceivables(businessId: string): Promise<Receivable[]> {
  const rows = await rpc<any[]>('acc_receivables', { p_business_id: toUuid(businessId) });
  return (rows || []).map((r) => ({ ...r, owes: n(r.owes), holds: n(r.holds), appDebt: n(r.appDebt), invoices: n(r.invoices), appWallet: n(r.appWallet) }));
}

export interface SupplierBill {
  purchaseId: string;
  ref: string;
  received: string;
  total: number;
  paid: number;
  owed: number;
}

export interface Payable {
  party: string;
  supplierId: string | null;
  name: string;
  phone: string | null;
  billed: number;
  paid: number;
  owed: number;
  unlinkedPaid: number;
  bills: SupplierBill[];
}

export interface SupplierPayment {
  id: string;
  supplierId: string | null;
  supplier: string;
  purchaseId: string | null;
  amount: number;
  method: string;
  paidAt: string;
  reference: string | null;
  note: string | null;
  by: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export async function loadPayables(businessId: string): Promise<{ suppliers: Payable[]; payments: SupplierPayment[]; canPay: boolean }> {
  const r = await rpc('acc_payables', { p_business_id: toUuid(businessId) });
  return {
    suppliers: (r.suppliers || []).map((s: any) => ({
      ...s,
      billed: n(s.billed),
      paid: n(s.paid),
      owed: n(s.owed),
      unlinkedPaid: n(s.unlinkedPaid),
      bills: (s.bills || []).map((b: any) => ({ ...b, total: n(b.total), paid: n(b.paid), owed: n(b.owed) })),
    })),
    payments: (r.payments || []).map((p: any) => ({ ...p, amount: n(p.amount) })),
    canPay: !!r.canPay,
  };
}

export interface VatMonth {
  month: string;
  sales: number;
  taxedSales: number;
  vatCharged: number;
  vatPaid: number;
}

export async function loadVat(businessId: string, start: string, end: string) {
  const r = await rpc('acc_vat', { p_business_id: toUuid(businessId), p_start: start, p_end: end });
  return {
    months: (r.months || []).map((m: any): VatMonth => ({ month: m.month, sales: n(m.sales), taxedSales: n(m.taxedSales), vatCharged: n(m.vatCharged), vatPaid: n(m.vatPaid) })),
    taxOn: !!r.taxOn,
    rate: r.rate == null ? null : n(r.rate),
    owedNow: n(r.owedNow),
  };
}

export interface MoneyCheck {
  accountId: string;
  code: string;
  name: string;
  key: string;
  method: string;
  books: number;
  /** The Payments screen balance; null when that method was never used. */
  app: number | null;
}

export interface CheckHistory {
  id: string;
  kind: 'money' | 'stock';
  account: string;
  books: number;
  actual: number;
  app: number | null;
  difference: number;
  note: string | null;
  by: string | null;
  at: string;
  entryNo: number | null;
}

export async function loadChecks(businessId: string) {
  const r = await rpc('acc_checks', { p_business_id: toUuid(businessId) });
  return {
    money: (r.money || []).map((m: any): MoneyCheck => ({ ...m, books: n(m.books), app: m.app == null ? null : n(m.app) })),
    stock: { books: n(r.stock?.books), actual: n(r.stock?.actual), difference: n(r.stock?.difference) },
    history: (r.history || []).map((h: any): CheckHistory => ({
      ...h, books: n(h.books), actual: n(h.actual), app: h.app == null ? null : n(h.app), difference: n(h.difference), entryNo: h.entryNo == null ? null : n(h.entryNo),
    })),
  };
}

export async function loadErrors(businessId: string): Promise<{ source: SourceType; sourceId: string; message: string; at: string }[]> {
  return (await rpc<any[]>('acc_errors', { p_business_id: toUuid(businessId) })) || [];
}

// ---------------------------------------------------------------- writing

export interface DraftLine {
  accountId: string;
  debit: number;
  credit: number;
  memo?: string;
}

export async function saveEntry(businessId: string, draft: { date: string; memo: string; lines: DraftLine[] }, entryId?: string | null) {
  return rpc<string>('acc_save_entry', {
    p_business_id: toUuid(businessId),
    p_date: draft.date,
    p_memo: draft.memo,
    p_lines: draft.lines.map((l) => ({ accountId: l.accountId, debit: l.debit || 0, credit: l.credit || 0, memo: l.memo || null })),
    p_entry_id: entryId || null,
  });
}

export const deleteEntry = (entryId: string) => rpc('acc_delete_entry', { p_entry_id: entryId });
export const reverseEntry = (entryId: string, date?: string) => rpc<string>('acc_reverse_entry', { p_entry_id: entryId, p_date: date || null });

export const saveAccount = (
  businessId: string,
  a: { id?: string | null; code: string; name: string; type: AccountType; description?: string | null; active: boolean },
) =>
  rpc<string>('acc_save_account', {
    p_business_id: toUuid(businessId),
    p_id: a.id || null,
    p_code: a.code,
    p_name: a.name,
    p_type: a.type,
    p_description: a.description || null,
    p_active: a.active,
  });

export const deleteAccount = (id: string) => rpc('acc_delete_account', { p_id: id });
export const setLockDate = (businessId: string, date: string | null) => rpc('acc_set_lock_date', { p_business_id: toUuid(businessId), p_date: date });
export const retryErrors = (businessId: string) => rpc<{ fixed: number; failed: number }>('acc_retry_errors', { p_business_id: toUuid(businessId) });

export const reconcileMoney = (businessId: string, accountId: string, actual: number, note?: string) =>
  rpc<{ difference: number; entryId: string | null }>('acc_reconcile_money', { p_business_id: toUuid(businessId), p_account_id: accountId, p_actual: actual, p_note: note || null });

export const matchStock = (businessId: string, note?: string) =>
  rpc<{ difference: number; entryId: string | null }>('acc_match_stock', { p_business_id: toUuid(businessId), p_note: note || null });

export const recordSupplierPayment = (
  businessId: string,
  p: { supplierId: string | null; supplierName: string; purchaseId: string | null; amount: number; method: string; reference?: string; note?: string; paidAt?: string | null },
) =>
  rpc<string>('record_supplier_payment', {
    p_business_id: toUuid(businessId),
    p_supplier_id: p.supplierId,
    p_supplier_name: p.supplierName,
    p_purchase_id: p.purchaseId,
    p_amount: p.amount,
    p_method: p.method,
    p_reference: p.reference || null,
    p_note: p.note || null,
    p_paid_at: p.paidAt || null,
  });

export const voidSupplierPayment = (id: string, reason: string) => rpc('void_supplier_payment', { p_id: id, p_reason: reason });

/** Rebuilds the books from every record, in pieces. Calls onProgress with a short status. */
export async function rebuildBooks(businessId: string, onProgress?: (text: string) => void): Promise<void> {
  const id = toUuid(businessId);
  const { kinds } = await rpc<{ kinds: SourceType[] }>('acc_rebuild_start', { p_business_id: id });
  const size = 1500;
  for (const kind of kinds) {
    let offset = 0;
    for (;;) {
      onProgress?.(`${SOURCE_LABELS[kind]}s: ${offset.toLocaleString()} done`);
      const done = await rpc<number>('acc_rebuild_chunk', { p_business_id: id, p_type: kind, p_offset: offset, p_limit: size });
      offset += done;
      if (done < size) break;
    }
  }
}

// ---------------------------------------------------------------- statements

/** Balance in the account's own direction: assets/expenses by debit, the rest by credit. */
export function natural(type: AccountType, debitMinusCredit: number): number {
  return type === 'asset' || type === 'expense' ? debitMinusCredit : -debitMinusCredit;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface StatementRow {
  id: string;
  code: string;
  name: string;
  amount: number;
}

export interface ProfitAndLoss {
  income: StatementRow[];
  totalIncome: number;
  costOfSales: StatementRow[];
  totalCostOfSales: number;
  grossProfit: number;
  expenses: StatementRow[];
  totalExpenses: number;
  netProfit: number;
}

/** Profit & loss for the period: income and expenses moved between start and end. */
export function profitAndLoss(accounts: AccountBalance[]): ProfitAndLoss {
  const moved = (a: AccountBalance) => round2(natural(a.type, a.debit - a.credit));
  const rows = (list: AccountBalance[]) =>
    list.map((a) => ({ id: a.id, code: a.code, name: a.name, amount: moved(a) })).filter((r) => r.amount !== 0);
  const income = rows(accounts.filter((a) => a.type === 'income'));
  const cost = rows(accounts.filter((a) => a.type === 'expense' && (a.key === 'cogs' || a.code.startsWith('5'))));
  const expenses = rows(accounts.filter((a) => a.type === 'expense' && !(a.key === 'cogs' || a.code.startsWith('5'))));
  const sum = (r: StatementRow[]) => round2(r.reduce((s, x) => s + x.amount, 0));
  const totalIncome = sum(income);
  const totalCostOfSales = sum(cost);
  const totalExpenses = sum(expenses);
  return {
    income,
    totalIncome,
    costOfSales: cost,
    totalCostOfSales,
    grossProfit: round2(totalIncome - totalCostOfSales),
    expenses,
    totalExpenses,
    netProfit: round2(totalIncome - totalCostOfSales - totalExpenses),
  };
}

export interface BalanceSheet {
  assets: StatementRow[];
  totalAssets: number;
  liabilities: StatementRow[];
  totalLiabilities: number;
  equity: StatementRow[];
  /** All income minus all expenses up to the end date, not yet moved to retained earnings. */
  profitToDate: number;
  totalEquity: number;
  /** Assets minus (liabilities + equity). Zero when the books balance. */
  difference: number;
}

/** What the business owns and owes at the end date. */
export function balanceSheet(accounts: AccountBalance[]): BalanceSheet {
  const at = (a: AccountBalance) => round2(natural(a.type, a.closing));
  const rows = (type: AccountType) =>
    accounts.filter((a) => a.type === type).map((a) => ({ id: a.id, code: a.code, name: a.name, amount: at(a) })).filter((r) => r.amount !== 0);
  const sum = (r: StatementRow[]) => round2(r.reduce((s, x) => s + x.amount, 0));
  const assets = rows('asset');
  const liabilities = rows('liability');
  const equity = rows('equity');
  const profitToDate = round2(
    accounts.filter((a) => a.type === 'income' || a.type === 'expense').reduce((s, a) => s - a.closing, 0),
  );
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = round2(sum(equity) + profitToDate);
  return {
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    profitToDate,
    totalEquity,
    difference: round2(totalAssets - totalLiabilities - totalEquity),
  };
}

export interface TrialRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
}

/** Every account's balance at the end date as a debit or a credit. The two totals match. */
export function trialBalance(accounts: AccountBalance[]) {
  const rows: TrialRow[] = accounts
    .filter((a) => round2(a.closing) !== 0)
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      debit: a.closing > 0 ? round2(a.closing) : 0,
      credit: a.closing < 0 ? round2(-a.closing) : 0,
    }));
  const debit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const credit = round2(rows.reduce((s, r) => s + r.credit, 0));
  return { rows, debit, credit, balanced: debit === credit };
}

// ---------------------------------------------------------------- quick entries

export type QuickKind =
  | 'capital' | 'drawings' | 'transfer' | 'loan_in' | 'loan_repay' | 'vat_paid'
  | 'asset_bought' | 'depreciation' | 'other_income' | 'opening' | 'custom';

export interface QuickTemplate {
  id: QuickKind;
  title: string;
  hint: string;
  /** Account key taking the debit; 'money' = the chosen money account, 'to' = the second money account. */
  debit?: string;
  credit?: string;
}

export const QUICK_ENTRIES: QuickTemplate[] = [
  { id: 'transfer', title: 'Move money between accounts', hint: 'M-Pesa to bank, cash banked, card payout received', debit: 'to', credit: 'money' },
  { id: 'capital', title: 'Owner put money in', hint: "Owner's own money paid into the business", debit: 'money', credit: 'capital' },
  { id: 'drawings', title: 'Owner took money out', hint: 'Money the owner took for personal use', debit: 'drawings', credit: 'money' },
  { id: 'loan_in', title: 'Loan received', hint: 'Money borrowed from a bank, SACCO or person', debit: 'money', credit: 'loans' },
  { id: 'loan_repay', title: 'Loan repaid', hint: 'Paying back money that was borrowed', debit: 'loans', credit: 'money' },
  { id: 'vat_paid', title: 'VAT paid to KRA', hint: 'Lowers the VAT you owe', debit: 'vat', credit: 'money' },
  { id: 'asset_bought', title: 'Equipment bought', hint: 'A fridge, cooler, motorbike or furniture (not stock)', debit: 'fixed_assets', credit: 'money' },
  { id: 'depreciation', title: 'Depreciation', hint: 'Value used up on equipment this period (no money moves)', debit: 'depreciation', credit: 'acc_depreciation' },
  { id: 'other_income', title: 'Other income', hint: 'Money in that is not a sale: rent received, commission', debit: 'money', credit: 'other_income' },
  { id: 'opening', title: 'Opening balance', hint: 'What an account held when you started these books', debit: 'account', credit: 'opening' },
  { id: 'custom', title: 'Write your own entry', hint: 'Any accounts, any number of lines' },
];

/** Lines for a quick entry. Returns an error message when something is missing. */
export function quickLines(
  t: QuickTemplate,
  accounts: AccountBalance[],
  amount: number,
  picks: { money?: string; to?: string; account?: string },
): DraftLine[] | string {
  if (!(amount > 0)) return 'Enter an amount above zero.';
  const byKey = (k: string) => accounts.find((a) => a.key === k)?.id;
  const resolve = (k?: string) => (k === 'money' ? picks.money : k === 'to' ? picks.to : k === 'account' ? picks.account : k ? byKey(k) : undefined);
  const debit = resolve(t.debit);
  const credit = resolve(t.credit);
  if (!debit || !credit) return t.id === 'opening' ? 'Choose the account.' : 'Choose the money account.';
  if (debit === credit) return 'Choose two different accounts.';
  return [
    { accountId: debit, debit: round2(amount), credit: 0 },
    { accountId: credit, debit: 0, credit: round2(amount) },
  ];
}

/** Checks a hand-written entry before sending it. */
export function checkDraft(lines: DraftLine[]): { debit: number; credit: number; error: string | null } {
  const used = lines.filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0);
  const debit = round2(used.reduce((s, l) => s + (l.debit || 0), 0));
  const credit = round2(used.reduce((s, l) => s + (l.credit || 0), 0));
  let error: string | null = null;
  if (used.some((l) => !l.accountId)) error = 'Choose an account for every line with an amount.';
  else if (used.some((l) => (l.debit || 0) > 0 && (l.credit || 0) > 0)) error = 'A line is a debit or a credit, not both.';
  else if (used.length < 2) error = 'An entry needs at least two lines.';
  else if (debit !== credit) error = `Debits and credits differ by ${Math.abs(round2(debit - credit)).toLocaleString()}.`;
  return { debit, credit, error };
}

/** Today on the Kenya clock, as yyyy-mm-dd. */
export const kenyaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
