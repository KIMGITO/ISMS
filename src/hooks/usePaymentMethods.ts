// The payment methods the active business takes, in the app's order. Every place someone
// picks how a customer pays reads this, so switching a method off hides it everywhere.
import { useMemo } from "react";
import { useBusinessStore } from "../stores/businessStore";
import { enabledMethods } from "../utils/paymentMethods";
import type { MoneyMethod } from "../types";

export function usePaymentMethods(): MoneyMethod[] {
  const list = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.defaultPaymentMethods);
  return useMemo(() => enabledMethods(list), [list]);
}
