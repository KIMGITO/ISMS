// supabase/functions/kra-etims/index.ts
// KRA eTIMS through the Online Sales Control Unit (OSCU) API. Actions:
//   status      connection details, without the communication key        (settings.view / pos.create_sale)
//   connect     verify PIN + branch + device serial with KRA, store the key (settings.integrations)
//   disconnect  forget the key; receipts stop showing a KRA section         (settings.integrations)
//   sign_sale   send a saved sale to KRA and store the signature it returns (pos.create_sale / orders.view)
// The sale is read from the database, never taken from the request, so what KRA signs is what was recorded.
// Not yet run against the KRA sandbox: field names follow the OSCU specification.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  handleCors,
  jsonResponse,
  errorResponse,
  verifyUserMembership,
  requirePermission,
  enforceRateLimit,
} from "../shared/cors.ts";

type Env = "sandbox" | "production";

const API: Record<Env, string> = {
  sandbox: Deno.env.get("KRA_ETIMS_SANDBOX_URL") || "https://etims-api-sbx.kra.go.ke/etims-api",
  production: Deno.env.get("KRA_ETIMS_PRODUCTION_URL") || "https://etims-api.kra.go.ke/etims-api",
};
const VERIFY: Record<Env, string> = {
  sandbox: "https://etims-sbx.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=",
  production: "https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=",
};

// eTIMS tax types and their rates.
const TAX_RATES: Record<string, number> = { A: 0, B: 16, C: 0, D: 0, E: 8 };
const TAX_TYPES = ["A", "B", "C", "D", "E"] as const;

const PAYMENT_TYPES: Record<string, string> = {
  Cash: "01",
  Credit: "02",
  Credit_Debt: "02",
  Bank: "04",
  Card: "05",
  "M-Pesa": "06",
  Mobile_Wallet: "06",
  Other: "07",
};

const PIN = /^[A-Z][0-9]{9}[A-Z]$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

class KraError extends Error {
  constructor(message: string, public code = "KRA_REJECTED", public status = 502) {
    super(message);
  }
}

async function kraPost(env: Env, path: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${API[env]}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new KraError(`KRA answered with something unexpected (HTTP ${res.status}).`, "KRA_BAD_RESPONSE");
    }
    return json;
  } catch (err) {
    if (err instanceof KraError) throw err;
    if ((err as Error).name === "AbortError") throw new KraError("KRA did not answer in time. Try again.", "KRA_TIMEOUT", 504);
    throw new KraError("Could not reach KRA. Try again shortly.", "KRA_UNREACHABLE", 502);
  } finally {
    clearTimeout(timer);
  }
}

function ok(json: any): boolean {
  return json?.resultCd === "000";
}

function kraMessage(json: any, fallback: string): string {
  const msg = String(json?.resultMsg || "").trim();
  return msg ? `KRA: ${msg}` : fallback;
}

/** yyyyMMddHHmmss in Kenyan time, the format eTIMS uses. */
function kraDateTime(iso: string): { stamp: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const day = `${get("year")}${get("month")}${get("day")}`;
  return { day, stamp: `${day}${get("hour")}${get("minute")}${get("second")}` };
}

/** eTIMS quantity unit codes for the units this app uses. */
function qtyUnit(unit: string | null | undefined): string {
  const u = String(unit || "").trim().toLowerCase();
  if (["kg", "kgs", "kilogram", "kilograms"].includes(u)) return "KG";
  if (["l", "ltr", "litre", "litres", "liter", "liters"].includes(u)) return "L";
  if (["g", "gram", "grams"].includes(u)) return "GRM";
  if (["ml", "millilitre", "millilitres"].includes(u)) return "ML";
  return "U";
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const body = await req.json().catch(() => ({}));
    const { action, businessId } = body;
    if (!businessId) return errorResponse("businessId is required.", 400);

    const { userId, errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const staffName = async (): Promise<string> => {
      const { data } = await admin.from("users").select("name").eq("id", userId).maybeSingle();
      return data?.name || "Staff";
    };

    const loadSettings = async () => {
      const { data } = await admin.from("kra_etims_settings").select("*").eq("business_id", businessId).maybeSingle();
      return data;
    };

    const publicSettings = (s: any) =>
      s
        ? {
            environment: s.environment,
            pin: s.kra_pin,
            branchId: s.branch_id,
            deviceSerial: s.device_serial,
            taxpayerName: s.taxpayer_name,
            sdcId: s.sdc_id,
            itemClassCode: s.item_class_code,
            noVatTaxType: s.no_vat_tax_type,
            status: s.status,
            lastError: s.last_error,
            connectedAt: s.connected_at,
          }
        : null;

    // ---------------------------------------------------------------- status
    if (action === "status") {
      const denied = await requirePermission(req, businessId, "settings.view", "settings.integrations", "pos.create_sale", "orders.view");
      if (denied) return denied;
      const settings = await loadSettings();
      return jsonResponse({ success: true, connected: settings?.status === "connected", settings: publicSettings(settings) });
    }

    // ---------------------------------------------------------------- connect
    if (action === "connect") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;
      const limited = await enforceRateLimit(`kra-connect:biz:${businessId}`, 10, 3600);
      if (limited) return limited;

      const environment: Env = body.environment === "production" ? "production" : "sandbox";
      const pin = String(body.pin ?? "").trim().toUpperCase();
      const branchId = String(body.branchId ?? "00").trim().padStart(2, "0");
      const deviceSerial = String(body.deviceSerial ?? "").trim();
      const itemClassCode = String(body.itemClassCode ?? "").trim();
      const noVatTaxType = ["A", "C", "D"].includes(body.noVatTaxType) ? body.noVatTaxType : "D";

      if (!PIN.test(pin)) return errorResponse("A KRA PIN looks like P051234567X.", 400);
      if (!/^[0-9]{2}$/.test(branchId)) return errorResponse("The branch ID is two digits, usually 00 for the head office.", 400);
      if (!deviceSerial) return errorResponse("Enter the device serial number KRA gave you for this OSCU.", 400);
      if (!/^[0-9]{6,10}$/.test(itemClassCode)) return errorResponse("Enter a KRA item classification code (6 to 10 digits).", 400);

      const existing = await loadSettings();
      const { data: secret } = await admin.from("kra_etims_secrets").select("cmc_key").eq("business_id", businessId).maybeSingle();
      const sameDevice =
        existing && existing.kra_pin === pin && existing.branch_id === branchId && existing.device_serial === deviceSerial && existing.environment === environment;

      let cmcKey: string | null = sameDevice ? secret?.cmc_key ?? null : null;
      let info: any = null;
      if (!cmcKey) {
        const init = await kraPost(environment, "/selectInitOsdcInfo", { tin: pin, bhfId: branchId, dvcSrlNo: deviceSerial });
        if (!ok(init)) {
          const message =
            init?.resultCd === "902"
              ? "KRA says this device is already installed. Ask KRA to reset it, or use the same details that were first connected."
              : kraMessage(init, "KRA did not accept these details.");
          await admin.from("kra_etims_settings").update({ status: "error", last_error: message, updated_at: new Date().toISOString() }).eq("business_id", businessId);
          return errorResponse(message, 400, "KRA_INIT_REJECTED");
        }
        info = init?.data?.info ?? {};
        cmcKey = info.cmcKey;
        if (!cmcKey) return errorResponse("KRA accepted the details but sent no communication key.", 502, "KRA_NO_KEY");
      }

      const now = new Date().toISOString();
      const { error: settingsError } = await admin.from("kra_etims_settings").upsert({
        business_id: businessId,
        environment,
        kra_pin: pin,
        branch_id: branchId,
        device_serial: deviceSerial,
        taxpayer_name: info?.taxprNm ?? existing?.taxpayer_name ?? null,
        sdc_id: info?.sdcId ?? existing?.sdc_id ?? null,
        mrc_no: info?.mrcNo ?? existing?.mrc_no ?? null,
        item_class_code: itemClassCode,
        no_vat_tax_type: noVatTaxType,
        status: "connected",
        last_error: null,
        connected_at: now,
        // A different device or PIN starts its own invoice sequence.
        last_invoice_no: sameDevice ? existing.last_invoice_no : 0,
        updated_by: await staffName(),
        updated_at: now,
      });
      if (settingsError) throw settingsError;
      const { error: secretError } = await admin.from("kra_etims_secrets").upsert({ business_id: businessId, cmc_key: cmcKey, updated_at: now });
      if (secretError) throw secretError;
      if (!sameDevice) await admin.from("kra_etims_items").delete().eq("business_id", businessId);

      return jsonResponse({ success: true, connected: true, settings: publicSettings(await loadSettings()) });
    }

    // ---------------------------------------------------------------- disconnect
    if (action === "disconnect") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;
      await admin.from("kra_etims_secrets").delete().eq("business_id", businessId);
      await admin
        .from("kra_etims_settings")
        .update({ status: "disconnected", last_error: null, updated_by: await staffName(), updated_at: new Date().toISOString() })
        .eq("business_id", businessId);
      return jsonResponse({ success: true, connected: false });
    }

    // ---------------------------------------------------------------- sign_sale
    if (action === "sign_sale") {
      const denied = await requirePermission(req, businessId, "pos.create_sale", "orders.view");
      if (denied) return denied;
      const limited = await enforceRateLimit(`kra-sign:biz:${businessId}`, 3000, 86400);
      if (limited) return limited;

      const transactionId = String(body.transactionId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(transactionId)) return errorResponse("This sale has not been saved yet.", 400);

      const settings = await loadSettings();
      const { data: secret } = await admin.from("kra_etims_secrets").select("cmc_key").eq("business_id", businessId).maybeSingle();
      if (!settings || settings.status !== "connected" || !secret?.cmc_key) {
        return errorResponse("KRA eTIMS is not connected for this business.", 409, "KRA_NOT_CONNECTED");
      }
      const env: Env = settings.environment;
      const headers = { tin: settings.kra_pin, bhfId: settings.branch_id, cmcKey: secret.cmc_key };

      const { data: existing } = await admin.from("kra_etims_receipts").select("*").eq("transaction_id", transactionId).maybeSingle();
      if (existing?.status === "signed") return jsonResponse({ success: true, receipt: existing });

      const { data: tx } = await admin
        .from("transactions")
        .select("id, business_id, total, discount, tax, final_total, payment_method, customer_id, customer_name, staff_name, timestamp, is_delivery, delivery_fee, deleted_at")
        .eq("id", transactionId)
        .eq("business_id", businessId)
        .maybeSingle();
      if (!tx || tx.deleted_at) return errorResponse("Sale not found.", 404);

      const { data: lines } = await admin
        .from("transaction_items")
        .select("product_id, product_name, unit_price, quantity, discount_percentage, line_total, products(unit)")
        .eq("transaction_id", transactionId);
      if (!lines?.length) return errorResponse("This sale has no items to report.", 400);

      let customerPhone: string | null = null;
      if (tx.customer_id) {
        const { data: c } = await admin.from("customers").select("phone").eq("id", tx.customer_id).maybeSingle();
        customerPhone = c?.phone ? String(c.phone).replace(/\D/g, "").slice(-12) : null;
      }
      const { data: business } = await admin.from("businesses").select("name, address").eq("id", businessId).maybeSingle();

      // The app adds VAT on top of the discounted subtotal; eTIMS amounts are VAT-inclusive.
      const net = Number(tx.total) - Number(tx.discount);
      const tax = Number(tx.tax);
      let taxType = settings.no_vat_tax_type as string;
      let rate = 0;
      if (tax > 0.004) {
        const pct = Math.round((tax / net) * 100);
        if (pct === 16) taxType = "B";
        else if (pct === 8) taxType = "E";
        else return errorResponse(`eTIMS only accepts VAT at 16% or 8%; this sale used ${pct}%.`, 400, "KRA_TAX_RATE");
        rate = TAX_RATES[taxType] / 100;
      }

      // Claim the sale so two tills cannot send it to KRA at the same time.
      const claimedAt = new Date().toISOString();
      if (!existing) {
        const { error: claimError } = await admin.from("kra_etims_receipts").insert({
          transaction_id: transactionId, business_id: businessId, environment: settings.environment, status: "pending", updated_at: claimedAt,
        });
        if (claimError?.code === "23505") return errorResponse("This sale is already being sent to KRA. Try again in a minute.", 409, "KRA_IN_PROGRESS");
        if (claimError) throw claimError;
      } else {
        const staleBefore = new Date(Date.now() - 90_000).toISOString();
        const { data: claimed } = await admin
          .from("kra_etims_receipts")
          .update({ status: "pending", updated_at: claimedAt })
          .eq("transaction_id", transactionId)
          .or(`status.eq.failed,updated_at.lt."${staleBefore}"`)
          .select("transaction_id");
        if (!claimed?.length) return errorResponse("This sale is already being sent to KRA. Try again in a minute.", 409, "KRA_IN_PROGRESS");
      }

      const recordFailure = async (message: string, invoiceNo: number | null) => {
        await admin.from("kra_etims_receipts").upsert({
          transaction_id: transactionId,
          business_id: businessId,
          environment: env,
          status: "failed",
          invoice_no: invoiceNo,
          attempts: (existing?.attempts ?? 0) + 1,
          last_error: message,
          updated_at: new Date().toISOString(),
        });
      };

      // 1. Make sure every product (and delivery) is registered with eTIMS.
      const registeredBy = await staffName();
      const ensureItem = async (key: string, name: string, unit: string | null, itemTaxType: string, price: number, service: boolean) => {
        const { data: known } = await admin.from("kra_etims_items").select("item_code, item_class_code").eq("business_id", businessId).eq("item_key", key).maybeSingle();
        if (known) return known;
        const { count } = await admin.from("kra_etims_items").select("item_key", { count: "exact", head: true }).eq("business_id", businessId);
        const qty = service ? "U" : qtyUnit(unit);
        const code = `KE${service ? "3" : "2"}NT${qty}${String((count ?? 0) + 1).padStart(7, "0")}`;
        const saved = await kraPost(env, "/saveItem", {
          itemCd: code,
          itemClsCd: settings.item_class_code,
          itemTyCd: service ? "3" : "2",
          itemNm: name.slice(0, 200),
          itemStdNm: null,
          orgnNatCd: "KE",
          pkgUnitCd: "NT",
          qtyUnitCd: qty,
          taxTyCd: itemTaxType,
          btchNo: null,
          bcd: null,
          dftPrc: round2(price),
          grpPrcL1: null, grpPrcL2: null, grpPrcL3: null, grpPrcL4: null, grpPrcL5: null,
          addInfo: null,
          sftyQty: null,
          isrcAplcbYn: "N",
          useYn: "Y",
          regrId: userId,
          regrNm: registeredBy,
          modrId: userId,
          modrNm: registeredBy,
        }, headers);
        if (!ok(saved)) throw new KraError(kraMessage(saved, `KRA would not register "${name}".`));
        const row = { business_id: businessId, item_key: key, item_code: code, item_class_code: settings.item_class_code, tax_type: itemTaxType };
        await admin.from("kra_etims_items").insert(row);
        return { item_code: code, item_class_code: settings.item_class_code };
      };

      // 2. Work out VAT-inclusive line amounts that add up to exactly what the customer paid.
      const itemDiscounts = lines.reduce((s: number, l: any) => s + Number(l.unit_price) * Number(l.quantity) * (Number(l.discount_percentage) / 100), 0);
      const cartDiscount = Math.max(0, Number(tx.discount) - itemDiscounts);
      const lineNets = lines.map((l: any) => Number(l.unit_price) * Number(l.quantity) * (1 - Number(l.discount_percentage) / 100));
      const netSum = lineNets.reduce((a: number, b: number) => a + b, 0) || 1;

      type Row = { key: string; name: string; unit: string | null; qty: number; prc: number; supply: number; disc: number; taxType: string; service: boolean };
      const rows: Row[] = lines.map((l: any, i: number) => {
        const gross = Number(l.unit_price) * Number(l.quantity);
        const disc = gross * (Number(l.discount_percentage) / 100) + cartDiscount * (lineNets[i] / netSum);
        return {
          key: l.product_id,
          name: l.product_name,
          unit: l.products?.unit ?? null,
          qty: Number(l.quantity),
          prc: Number(l.unit_price) * (1 + rate),
          supply: gross * (1 + rate),
          disc: disc * (1 + rate),
          taxType,
          service: false,
        };
      });
      if (tx.is_delivery && Number(tx.delivery_fee) > 0) {
        // The app charges delivery without VAT, so it is reported under the no-VAT type.
        const fee = Number(tx.delivery_fee);
        rows.push({ key: "delivery", name: "Delivery", unit: null, qty: 1, prc: fee, supply: fee, disc: 0, taxType: settings.no_vat_tax_type, service: true });
      }

      const itemList: any[] = [];
      const taxable: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
      const taxAmt: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
      let running = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const supply = round2(r.supply);
        let total = round2(r.supply - r.disc);
        // The last line absorbs rounding so the total matches the receipt to the cent.
        if (i === rows.length - 1) total = round2(Number(tx.final_total) - running);
        running = round2(running + total);
        const dcAmt = round2(supply - total);
        const lineRate = TAX_RATES[r.taxType] / 100;
        const lineTax = lineRate > 0 ? round2((total * lineRate) / (1 + lineRate)) : 0;
        taxable[r.taxType] = round2(taxable[r.taxType] + total);
        taxAmt[r.taxType] = round2(taxAmt[r.taxType] + lineTax);

        let item;
        try {
          item = await ensureItem(r.key, r.name, r.unit, r.taxType, r.prc, r.service);
        } catch (err) {
          const message = err instanceof KraError ? err.message : "Could not register products with KRA.";
          await recordFailure(message, existing?.invoice_no ?? null);
          return errorResponse(message, 502, "KRA_ITEM_REJECTED");
        }
        itemList.push({
          itemSeq: i + 1,
          itemCd: item.item_code,
          itemClsCd: item.item_class_code,
          itemNm: r.name.slice(0, 200),
          bcd: null,
          pkgUnitCd: "NT",
          pkg: 1,
          qtyUnitCd: r.service ? "U" : qtyUnit(r.unit),
          qty: r.qty,
          prc: round2(r.prc),
          splyAmt: supply,
          dcRt: supply > 0 ? round2((dcAmt / supply) * 100) : 0,
          dcAmt,
          isrccCd: null,
          isrccNm: null,
          isrcRt: null,
          isrcAmt: null,
          taxTyCd: r.taxType,
          taxblAmt: total,
          taxAmt: lineTax,
          totAmt: total,
        });
      }

      // 3. Invoice number: reuse the one already given to this sale on a retry.
      let invoiceNo: number = existing?.invoice_no ?? 0;
      if (!invoiceNo) {
        const { data: next, error: seqError } = await admin.rpc("kra_next_invoice_no", { p_business_id: businessId });
        if (seqError) throw seqError;
        invoiceNo = next as number;
        await admin.from("kra_etims_receipts").update({ invoice_no: invoiceNo, updated_at: new Date().toISOString() }).eq("transaction_id", transactionId);
      }

      const when = kraDateTime(tx.timestamp);
      const sale: Record<string, unknown> = {
        trdInvcNo: String(invoiceNo),
        invcNo: invoiceNo,
        orgInvcNo: 0,
        custTin: null,
        custNm: tx.customer_name ? String(tx.customer_name).slice(0, 60) : null,
        salesTyCd: "N",
        rcptTyCd: "S",
        pmtTyCd: PAYMENT_TYPES[tx.payment_method] || "07",
        salesSttsCd: "02",
        cfmDt: when.stamp,
        salesDt: when.day,
        stockRlsDt: when.stamp,
        cnclReqDt: null,
        cnclDt: null,
        rfdDt: null,
        rfdRsnCd: null,
        totItemCnt: itemList.length,
        totTaxblAmt: round2(Object.values(taxable).reduce((a, b) => a + b, 0)),
        totTaxAmt: round2(Object.values(taxAmt).reduce((a, b) => a + b, 0)),
        totAmt: round2(Number(tx.final_total)),
        prchrAcptcYn: "N",
        remark: null,
        regrId: userId,
        regrNm: tx.staff_name || registeredBy,
        modrId: userId,
        modrNm: tx.staff_name || registeredBy,
        receipt: {
          custTin: null,
          custMblNo: customerPhone,
          rptNo: invoiceNo,
          trdeNm: business?.name ?? null,
          adrs: business?.address ?? null,
          topMsg: null,
          btmMsg: null,
          prchrAcptcYn: "N",
        },
        itemList,
      };
      for (const t of TAX_TYPES) {
        sale[`taxblAmt${t}`] = taxable[t];
        sale[`taxRt${t}`] = TAX_RATES[t];
        sale[`taxAmt${t}`] = taxAmt[t];
      }

      let signed: any;
      try {
        signed = await kraPost(env, "/saveTrnsSalesOsdc", sale, headers);
      } catch (err) {
        const message = err instanceof KraError ? err.message : "Could not reach KRA.";
        await recordFailure(message, invoiceNo);
        return errorResponse(message, err instanceof KraError ? err.status : 502, "KRA_UNREACHABLE");
      }
      if (!ok(signed) || !signed?.data?.rcptSign) {
        const message = kraMessage(signed, "KRA did not sign this sale.");
        await recordFailure(message, invoiceNo);
        return errorResponse(message, 502, "KRA_SALE_REJECTED");
      }

      const d = signed.data;
      const sdcId = d.sdcId || settings.sdc_id;
      const receipt = {
        transaction_id: transactionId,
        business_id: businessId,
        environment: env,
        status: "signed",
        invoice_no: invoiceNo,
        kra_pin: settings.kra_pin,
        branch_id: settings.branch_id,
        sdc_id: sdcId,
        mrc_no: d.mrcNo || settings.mrc_no,
        rcpt_no: Number(d.rcptNo),
        tot_rcpt_no: d.totRcptNo != null ? Number(d.totRcptNo) : null,
        internal_data: d.intrlData,
        rcpt_signature: d.rcptSign,
        signed_at_kra: d.vsdcRcptPbctDate ?? null,
        qr_url: `${VERIFY[env]}${settings.kra_pin}${settings.branch_id}${d.rcptSign}`,
        attempts: (existing?.attempts ?? 0) + 1,
        last_error: null,
        updated_at: new Date().toISOString(),
      };
      const { error: saveError } = await admin.from("kra_etims_receipts").upsert(receipt);
      if (saveError) throw saveError;
      return jsonResponse({ success: true, receipt });
    }

    return errorResponse("Unknown action.", 400);
  } catch (err) {
    console.error("[kra-etims] failed:", err);
    if (err instanceof KraError) return errorResponse(err.message, err.status, err.code);
    return errorResponse("Something went wrong talking to KRA.", 500);
  }
});
