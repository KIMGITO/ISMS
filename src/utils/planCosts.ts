// src/utils/planCosts.ts
// What other companies charge a business (provider_cost_estimates, 20261204003), worked out
// a month for the plan page calculator. Estimates only: the rows are edited by the platform admin.

import { roundMoney } from './money';

export interface CostEstimate {
  id: string;
  provider: string;
  item: string;
  basis: 'percent_mpesa' | 'percent_card' | 'per_sms' | 'per_month' | 'per_year' | 'free';
  amount: number;
  max_amount: number | null;
  needs: string | null;
  note: string | null;
  checked_on: string | null;
  sort: number;
}

const num = (v: unknown) => Number(v) || 0;

/** Monthly cost of one estimate row for the calculator inputs. */
export function estimateMonthly(row: CostEstimate, mpesa: number, card: number, sms: number): number {
  const a = num(row.amount);
  switch (row.basis) {
    case 'percent_mpesa':
      return roundMoney((mpesa * a) / 100);
    case 'percent_card':
      return roundMoney((card * a) / 100);
    case 'per_sms':
      return roundMoney(sms * a);
    case 'per_month':
      return roundMoney(a);
    case 'per_year':
      return roundMoney(a / 12);
    default:
      return 0;
  }
}
