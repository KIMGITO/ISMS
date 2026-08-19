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
  return clean.slice(0, 8).toUpperCase();
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
