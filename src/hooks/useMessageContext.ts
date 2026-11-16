// What messages to customers need besides the customers: the shop, the points settings,
// each customer's buying history and the business's own variables. Loaded once per screen.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBusinessStore } from "../stores/businessStore";
import { fetchPointSettings, type PointSettings } from "../services/loyalty/pointValue";
import {
  fetchPurchaseStats,
  listCustomVariables,
  type CustomVariable,
  type MessageContext,
  type PurchaseStats,
} from "../services/messaging/messageVariables";

const currencyLabel = (c?: string) => (!c || /^(k?sh?s?|kes)$/i.test(c.trim()) ? "KSh" : c.trim());

export function useMessageContext(businessId: string | null | undefined) {
  const business = useBusinessStore((s) => s.businesses.find((b) => b.id === businessId));
  const [points, setPoints] = useState<PointSettings | null>(null);
  const [stats, setStats] = useState<Map<string, PurchaseStats>>(new Map());
  const [custom, setCustom] = useState<CustomVariable[]>([]);

  const reloadCustom = useCallback(() => {
    if (!businessId) return;
    listCustomVariables(businessId).then(setCustom).catch(() => undefined);
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    let live = true;
    fetchPointSettings(businessId).then((p) => live && setPoints(p)).catch(() => undefined);
    fetchPurchaseStats(businessId).then((s) => live && setStats(s)).catch(() => undefined);
    listCustomVariables(businessId).then((v) => live && setCustom(v)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [businessId]);

  const ctx = useMemo<MessageContext>(
    () => ({
      businessName: business?.name || "our shop",
      businessPhone: business?.contactPhone,
      currency: currencyLabel(business?.currency),
      points,
      stats,
      custom,
    }),
    [business?.name, business?.contactPhone, business?.currency, points, stats, custom],
  );

  return { ctx, setCustom, reloadCustom };
}
