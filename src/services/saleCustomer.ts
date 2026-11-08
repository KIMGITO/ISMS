// Puts a finished walk-in sale (usually a Quick Sale) on a customer's account afterwards.
// The customer gets the same points and purchase count as if they had been chosen at the till.
import type { Customer, Transaction } from "../types";
import { getSupabase } from "./supabaseClient";
import { salesOutbox } from "./offline/salesOutbox";
import { pointsEarned } from "./loyalty/tillPoints";
import { useTransactionStore } from "../stores/transactionStore";
import { useCustomerStore } from "../stores/customerStore";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why a sale can't take a customer, or null when it can. */
export function cannotAttachReason(tx: Transaction): string | null {
  if (tx.customerId) return "This sale already has a customer.";
  if (tx.paymentMethod === "Credit" || tx.paymentMethod === "Credit_Debt") return "Credit sales get their customer when they are made.";
  return null;
}

export interface AttachResult {
  transaction: Transaction;
  /** Points the customer earned (or will earn when an offline sale syncs). */
  points: number;
  /** True when the sale is still on this device; the points arrive when it syncs. */
  offline: boolean;
}

export async function attachSaleToCustomer(tx: Transaction, customer: Customer): Promise<AttachResult> {
  const reason = cannotAttachReason(tx);
  if (reason) throw new Error(reason);

  // Still waiting to sync: change the queued copy, and the server awards points on arrival.
  if (tx.status === "Offline_Pending" || !UUID.test(tx.id)) {
    const updated = tx.referenceId ? salesOutbox.setCustomer(tx.referenceId, customer) : null;
    if (!updated) throw new Error("This sale is syncing or has just synced. Add the customer from Sales history in a moment.");
    return { transaction: updated, points: pointsEarned(tx.finalTotal, tx.deliveryFee, tx.paymentMethod), offline: true };
  }

  const { data, error } = await getSupabase().rpc("attach_sale_to_customer", {
    p_transaction_id: tx.id,
    p_customer_id: customer.id,
  });
  if (error) throw error;

  const transaction: Transaction = { ...tx, customerId: customer.id, customerName: (data as any)?.customerName || customer.name };
  useTransactionStore.setState((s) => ({
    transactions: s.transactions.map((t) => (t.id === tx.id ? transaction : t)),
  }));
  await useCustomerStore.getState().refreshCustomer(customer.id).catch(() => {});
  return { transaction, points: Number((data as any)?.points) || 0, offline: false };
}
