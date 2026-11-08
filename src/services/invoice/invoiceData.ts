// Reads what a customer owes and issues numbered invoices (supabase/migrations/20261108001).
import { getSupabase } from "../supabaseClient";
import { toUuid } from "../../utils/idUtils";
import { InvoiceDocument, OpenCredit } from "./types";

/** The customer's unpaid credit sales and hand-added balances, with the price each item was sold at. */
export async function fetchOpenCredit(customerId: string): Promise<OpenCredit[]> {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from("credit_payments")
    .select("id, created_at, amount_owed, amount_paid, balance, note, transaction_id")
    .eq("customer_id", toUuid(customerId))
    .in("status", ["Open", "Partial"])
    .gt("balance", 0)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const txIds = [...new Set((rows || []).map((r: any) => r.transaction_id).filter(Boolean))];
  const sales = new Map<string, OpenCredit["sale"]>();
  for (let i = 0; i < txIds.length; i += 100) {
    const { data: txs, error: txErr } = await supabase
      .from("transactions")
      .select("id, timestamp, tax, delivery_fee, final_total, transaction_items (product_name, unit_price, quantity, products (unit))")
      .in("id", txIds.slice(i, i + 100));
    if (txErr) throw txErr;
    for (const t of txs || []) {
      sales.set(t.id, {
        id: t.id,
        timestamp: t.timestamp,
        tax: Number(t.tax) || 0,
        deliveryFee: Number(t.delivery_fee) || 0,
        finalTotal: Number(t.final_total) || 0,
        items: ((t as any).transaction_items || []).map((it: any) => ({
          name: it.product_name,
          unitPrice: Number(it.unit_price) || 0,
          quantity: Number(it.quantity) || 0,
          unit: it.products?.unit || undefined,
        })),
      });
    }
  }

  return (rows || []).map((r: any) => ({
    id: r.id,
    createdAt: r.created_at,
    amountOwed: Number(r.amount_owed) || 0,
    amountPaid: Number(r.amount_paid) || 0,
    balance: Number(r.balance) || 0,
    note: r.note,
    sale: r.transaction_id ? sales.get(r.transaction_id) || null : null,
  }));
}

function friendly(err: any): Error {
  const msg = String(err?.message || err || "");
  if (/issue_invoice|invoice_counters|invoices/.test(msg) && /does not exist|not find|schema cache/i.test(msg)) {
    return new Error("Invoices are not set up on the server yet. Apply the latest database update, then try again.");
  }
  return err instanceof Error ? err : new Error(msg || "Could not issue the invoice.");
}

/** Takes the next invoice number and stores the invoice exactly as shown. */
export async function issueInvoice(args: {
  businessId: string;
  customerId: string;
  doc: InvoiceDocument;
  createdBy?: string;
}): Promise<InvoiceDocument> {
  const supabase = getSupabase();
  const { doc } = args;
  const { data, error } = await supabase.rpc("issue_invoice", {
    p_business_id: toUuid(args.businessId),
    p_customer_id: toUuid(args.customerId),
    p_prefix: doc.texts.prefix,
    p_issued_at: doc.issuedAt,
    p_due_at: doc.dueAt || null,
    p_balance_due: doc.totals.balance,
    p_document: doc,
    p_created_by: args.createdBy || null,
  });
  if (error) throw friendly(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.invoice_no) throw new Error("The server did not return an invoice number.");
  // The stored copy gets its number back from the row when it is listed (listInvoices).
  return { ...doc, number: row.number, invoiceNo: row.invoice_no };
}

export interface IssuedInvoice {
  id: string;
  invoiceNo: string;
  number: number;
  issuedAt: string;
  balanceDue: number;
  createdBy?: string;
  document: InvoiceDocument;
}

export async function listInvoices(customerId: string): Promise<IssuedInvoice[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_no, number, issued_at, balance_due, created_by, document")
    .eq("customer_id", toUuid(customerId))
    .order("number", { ascending: false })
    .limit(50);
  if (error) throw friendly(error);
  return (data || []).map((r: any) => ({
    id: r.id,
    invoiceNo: r.invoice_no,
    number: r.number,
    issuedAt: r.issued_at,
    balanceDue: Number(r.balance_due) || 0,
    createdBy: r.created_by || undefined,
    document: { ...(r.document as InvoiceDocument), number: r.number, invoiceNo: r.invoice_no },
  }));
}

/** The number the next invoice will get, or null when it cannot be read. */
export async function nextInvoiceNumber(businessId: string): Promise<number | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("invoice_counters").select("last_number").eq("business_id", toUuid(businessId)).maybeSingle();
  if (error) return null;
  return (Number(data?.last_number) || 0) + 1;
}
