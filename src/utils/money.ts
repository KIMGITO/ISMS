// src/utils/money.ts
// One rule for numbers, app and database alike (owner, 2026-11-18):
//   money    always 2 decimal places   KSh 1,250.50   KSh 100.00
//   quantity at most 1 decimal place   2   1.5   0.5
// The database stores money as numeric(14,2) and quantities as numeric(14,1), so whatever the
// app sends is rounded the same way there. Use these helpers instead of toFixed/Math.round/
// toLocaleString on a money or quantity value.

export const MONEY_DECIMALS = 2;
export const QTY_DECIMALS = 1;

// Number.EPSILON keeps 1.005 -> 1.01 instead of 1.00 (binary floats store 1.005 as 1.00499...).
const roundTo = (n: number, places: number) => {
  const v = Number(n) || 0;
  const f = 10 ** places;
  return Math.round((v + Math.sign(v) * Number.EPSILON) * f) / f;
};

/** Money rounded to cents, as stored. */
export const roundMoney = (n: number | null | undefined): number => roundTo(Number(n) || 0, MONEY_DECIMALS);

/** A quantity rounded to one decimal place, as stored. */
export const roundQty = (n: number | null | undefined): number => roundTo(Number(n) || 0, QTY_DECIMALS);

/** "1,250.50", "100.00", "-30.00": always two decimals, with thousands separators. */
export function moneyNumber(n: number | null | undefined): string {
  return roundMoney(n).toLocaleString('en-KE', { minimumFractionDigits: MONEY_DECIMALS, maximumFractionDigits: MONEY_DECIMALS });
}

/** "KSh 1,250.50". A negative amount reads "-KSh 30.00". */
export function formatMoney(n: number | null | undefined, currency = 'KSh'): string {
  const v = roundMoney(n);
  const body = moneyNumber(Math.abs(v));
  const text = currency ? `${currency} ${body}` : body;
  return v < 0 ? `-${text}` : text;
}

/** "2", "1.5", "1,200": at most one decimal place. */
export function formatQty(n: number | null | undefined): string {
  return roundQty(n).toLocaleString('en-KE', { maximumFractionDigits: QTY_DECIMALS });
}
