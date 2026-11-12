/**
 * ID Utility Formatters
 * 
 * Provides functions to generate user-friendly identifiers from raw database IDs
 * (UUIDs) across the application, preventing exposure of internal database keys.
 */

export function getShortId(id: string | null | undefined): string {
  if (!id) return "";
  // Strip non-alphanumeric characters, and grab the first 8 characters
  const clean = id.replace(/[^a-zA-Z0-9]/g, "");
  return (legacyShortId(clean) || clean.slice(0, 8)).toUpperCase();
}

/**
 * Sales used to get the ID "tx-<milliseconds>", stored by toUuid() as the hex of those
 * characters, so every one started 74782d31 ("tx-1") and all their receipts showed the same
 * number. For those, the code is the last 8 hex digits of the time instead: different for
 * every sale (unique over ~49 days). fn_receipt_number() in the database does the same.
 */
function legacyShortId(clean: string): string | null {
  if (!/^74782d3[0-9]{1}(3[0-9]){12}$/i.test(clean)) return null;
  let ms = "";
  for (let i = 6; i < 32; i += 2) ms += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  return BigInt(ms).toString(16).padStart(8, "0").slice(-8);
}

/** A new random ID for a sale (or anything else made on this device). */
export function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function formatReceiptNumber(txId: string | null | undefined): string {
  if (!txId) return "";
  return `TXN-${getShortId(txId)}`;
}

export function formatCustomerNumber(customerId: string | null | undefined): string {
  if (!customerId) return "";
  return `CST-${getShortId(customerId)}`;
}

export function formatProductCode(productId: string | null | undefined): string {
  if (!productId) return "";
  return `PRD-${getShortId(productId)}`;
}

export function formatSupplierNumber(supplierId: string | null | undefined): string {
  if (!supplierId) return "";
  return `SUP-${getShortId(supplierId)}`;
}

export function formatEmployeeNumber(employeeId: string | null | undefined): string {
  if (!employeeId) return "";
  return `EMP-${getShortId(employeeId)}`;
}

export function formatExpenseNumber(expenseId: string | null | undefined): string {
  if (!expenseId) return "";
  return `EXP-${getShortId(expenseId)}`;
}

export function formatDeliveryNumber(deliveryId: string | null | undefined): string {
  if (!deliveryId) return "";
  return `DEL-${getShortId(deliveryId)}`;
}

export function formatNotificationNumber(notifId: string | null | undefined): string {
  if (!notifId) return "";
  return `NTF-${getShortId(notifId)}`;
}

export function formatBusinessNumber(businessId: string | null | undefined): string {
  if (!businessId) return "";
  return `BUS-${getShortId(businessId)}`;
}

export function toUuid(id: string | null | undefined): string {
  if (!id) return "00000000-0000-0000-0000-000000000000";
  
  // Standard UUID regex check
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) {
    return id.toLowerCase();
  }

  // Predefined mapping for defaults
  if (id === "biz-1") return "00000000-0000-0000-0000-000000000001";
  if (id === "biz-2") return "00000000-0000-0000-0000-000000000002";
  if (id === "biz-3") return "00000000-0000-0000-0000-000000000003";

  // Deterministic conversion for other custom/mock strings
  let hashStr = "";
  for (let i = 0; i < id.length; i++) {
    hashStr += id.charCodeAt(i).toString(16);
  }
  
  const cleanHex = hashStr.replace(/[^0-9a-f]/gi, "").toLowerCase().padEnd(32, "0").slice(0, 32);
  return `${cleanHex.slice(0, 8)}-${cleanHex.slice(8, 12)}-${cleanHex.slice(12, 16)}-${cleanHex.slice(16, 20)}-${cleanHex.slice(20, 32)}`;
}
