import { CartItem } from "../types";

/**
 * Formats a numeric value as Kenyan Shillings (KSh)
 */
export function formatCurrency(amount: number | null | undefined): string {
  const val = amount ?? 0;
  try {
    return `KSh ${val.toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  } catch {
    return `KSh ${val.toFixed(2)}`;
  }
}

/**
 * Formats an ISO date string to a human-friendly format
 */
export function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString("en-KE", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoString.split("T")[0];
  }
}

/**
 * Computes subtotal, discounts, Kenyan VAT (16%), and final total from shopping cart items
 */
export function calculateCartTotals(items: CartItem[]) {
  let totalOriginal = 0;
  let totalDiscount = 0;

  items.forEach((item) => {
    const lineOriginal = item.product.price * item.quantity;
    const lineDiscount = lineOriginal * (item.discountPercentage / 100);
    totalOriginal += lineOriginal;
    totalDiscount += lineDiscount;
  });

  const subtotal = totalOriginal - totalDiscount;
  const tax = subtotal * 0.16; // 16% Kenyan VAT
  const finalTotal = subtotal + tax;

  return {
    totalOriginal,
    totalDiscount,
    subtotal,
    tax,
    finalTotal,
  };
}
