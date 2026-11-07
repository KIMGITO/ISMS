// Client side of KRA eTIMS. All KRA calls go through the kra-etims edge function,
// which holds the communication key; the app only ever sees what KRA returned.
import { useEffect, useState } from "react";
import { getSupabase } from "../supabaseClient";
import { SupabaseService } from "../supabaseService";
import type { KraSignature } from "../receipt/types";

export interface KraSettings {
  environment: "sandbox" | "production";
  pin: string;
  branchId: string;
  deviceSerial: string;
  taxpayerName?: string | null;
  sdcId?: string | null;
  itemClassCode: string;
  noVatTaxType: "A" | "C" | "D";
  status: "connected" | "disconnected" | "error";
  lastError?: string | null;
  connectedAt?: string | null;
}

export interface KraStatus {
  connected: boolean;
  settings: KraSettings | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const statusCache = new Map<string, KraStatus>();
const inFlight = new Map<string, Promise<KraSignature>>();
const listeners = new Set<(businessId: string, status: KraStatus) => void>();

function publish(businessId: string, status: KraStatus) {
  statusCache.set(businessId, status);
  listeners.forEach((l) => l(businessId, status));
}

function toSignature(row: any): KraSignature | null {
  if (!row || row.status !== "signed" || !row.rcpt_signature) return null;
  return {
    pin: row.kra_pin,
    branchId: row.branch_id,
    invoiceNo: row.invoice_no,
    sdcId: row.sdc_id,
    mrcNo: row.mrc_no || undefined,
    rcptNo: row.rcpt_no,
    totRcptNo: row.tot_rcpt_no ?? undefined,
    internalData: row.internal_data,
    signature: row.rcpt_signature,
    signedAt: row.signed_at_kra || undefined,
    qrUrl: row.qr_url,
    environment: row.environment,
  };
}

export const kraService = {
  isSavedSale(transactionId: string): boolean {
    return UUID.test(transactionId);
  },

  cachedStatus(businessId: string): KraStatus | undefined {
    return statusCache.get(businessId);
  },

  async status(businessId: string, force = false): Promise<KraStatus> {
    if (!force && statusCache.has(businessId)) return statusCache.get(businessId)!;
    if (!UUID.test(businessId)) {
      const none = { connected: false, settings: null };
      publish(businessId, none);
      return none;
    }
    // Read straight from the table (RLS allows staff); avoids an edge call on every receipt.
    const { data, error } = await getSupabase().from("kra_etims_settings").select("*").eq("business_id", businessId).maybeSingle();
    if (error) throw error;
    const status: KraStatus = {
      connected: data?.status === "connected",
      settings: data
        ? {
            environment: data.environment,
            pin: data.kra_pin,
            branchId: data.branch_id,
            deviceSerial: data.device_serial,
            taxpayerName: data.taxpayer_name,
            sdcId: data.sdc_id,
            itemClassCode: data.item_class_code,
            noVatTaxType: data.no_vat_tax_type,
            status: data.status,
            lastError: data.last_error,
            connectedAt: data.connected_at,
          }
        : null,
    };
    publish(businessId, status);
    return status;
  },

  async connect(
    businessId: string,
    details: Pick<KraSettings, "environment" | "pin" | "branchId" | "deviceSerial" | "itemClassCode" | "noVatTaxType">,
  ): Promise<KraStatus> {
    const res = await SupabaseService.callEdgeFunction("kra-etims", { action: "connect", businessId, ...details });
    const status = { connected: !!res?.connected, settings: res?.settings ?? null };
    publish(businessId, status);
    return status;
  },

  async disconnect(businessId: string): Promise<void> {
    await SupabaseService.callEdgeFunction("kra-etims", { action: "disconnect", businessId });
    await this.status(businessId, true);
  },

  /** The signature already stored for a sale, if KRA signed it. */
  async getSignature(transactionId: string): Promise<KraSignature | null> {
    if (!UUID.test(transactionId)) return null;
    const { data, error } = await getSupabase().from("kra_etims_receipts").select("*").eq("transaction_id", transactionId).maybeSingle();
    if (error) throw error;
    return toSignature(data);
  },

  /** Sends the saved sale to KRA (safe to repeat: a signed sale is returned as-is). Calls for one sale share a request. */
  signSale(businessId: string, transactionId: string): Promise<KraSignature> {
    const running = inFlight.get(transactionId);
    if (running) return running;
    const request = (async () => {
      const res = await SupabaseService.callEdgeFunction("kra-etims", { action: "sign_sale", businessId, transactionId });
      const signature = toSignature(res?.receipt);
      if (!signature) throw new Error("KRA did not return a signature for this sale.");
      return signature;
    })().finally(() => inFlight.delete(transactionId));
    inFlight.set(transactionId, request);
    return request;
  },

  /** After a sale: report it to KRA in the background when this business is connected. */
  async reportSaleIfConnected(businessId: string, transactionId: string): Promise<void> {
    if (!UUID.test(transactionId)) return;
    const status = await this.status(businessId).catch(() => null);
    if (!status?.connected) return;
    await this.signSale(businessId, transactionId).catch((err) => {
      // The receipt screen shows the failure and offers a retry; the sale itself is already saved.
      console.warn("[kra] Sale not signed yet:", err?.message || err);
    });
  },

  subscribe(listener: (businessId: string, status: KraStatus) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useKraStatus(businessId: string | null | undefined): { status: KraStatus | undefined; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<KraStatus | undefined>(() => (businessId ? kraService.cachedStatus(businessId) : undefined));
  useEffect(() => {
    if (!businessId) return;
    setStatus(kraService.cachedStatus(businessId));
    kraService.status(businessId).then(setStatus).catch(() => setStatus({ connected: false, settings: null }));
    return kraService.subscribe((id, s) => {
      if (id === businessId) setStatus(s);
    });
  }, [businessId]);
  return {
    status,
    refresh: async () => {
      if (businessId) setStatus(await kraService.status(businessId, true));
    },
  };
}
