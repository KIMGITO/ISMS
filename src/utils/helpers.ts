import { CartItem } from "../types";


export function handleNumberInput(
  value: string | number,
  onChange: (value: number) => void,
  min: number = 0
): void {
  const stringValue = String(value);
  
  // If empty or just deleted, set to 0
  if (stringValue === '' || stringValue === '0') {
    onChange(0);
    return;
  }
  
  // Remove leading zeros but keep the number
  const cleaned = stringValue.replace(/^0+/, '') || '0';
  const numValue = parseFloat(cleaned);
  
  // Only update if it's a valid number
  if (!isNaN(numValue) && isFinite(numValue)) {
    onChange(Math.max(min, numValue));
  }
}

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


/**
 * Generates a unique SKU based on the category name and current SKU
 * @param categoryName 
 * @param currentSku 
 * @returns 
 */

export const generateSku = (categoryName: string, currentSku: string = ''): string => {
  const cleanCat = (categoryName || '').trim().toUpperCase();
  // Use MILK if category is Milk, otherwise take first 4 characters
  const prefix = cleanCat === 'MILK' ? 'MILK' : cleanCat.substring(0, 4).padEnd(4, 'X');

  // Preserve the existing 3-digit random number if SKU already follows KK-[PREFIX]-[NUM] pattern
  const existingNumMatch = currentSku.match(/^KK-[A-Z0-9]+-(\d{3})$/);
  const num = existingNumMatch ? existingNumMatch[1] : Math.floor(100 + Math.random() * 900);

  return `KK-${prefix}-${num}`;
};
