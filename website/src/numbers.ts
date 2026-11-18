// Same rule as the app (src/utils/money.ts): money always has two decimal places, quantities at
// most one. No imports, so any file (and the app's tests) can use it.
const round = (n: number, places: number) => {
  const v = Number(n) || 0;
  return Math.round((v + Math.sign(v) * Number.EPSILON) * 10 ** places) / 10 ** places;
};

export const roundQty = (n: number) => round(n, 1);

/** "KSh 1,250.50", "KSh 100.00". */
export const formatPrice = (currency: string, price: number) =>
  `${currency} ${round(price, 2).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2", "1.5". */
export const qtyNumber = (n: number) => roundQty(n).toLocaleString('en-KE', { maximumFractionDigits: 1 });
