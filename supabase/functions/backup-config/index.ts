
// deno-lint-ignore-file no-explicit-any
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import {
  handleCors,
  jsonResponse,
  errorResponse,
  verifyUserMembership,
  createUserClient,
} from "../shared/cors.ts";

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE SHEETS HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Extracts Spreadsheet ID from a Google Sheets URL */
function extractSpreadsheetId(url: string): string {
  if (!url) throw new Error("Google Sheet URL is empty.");
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error(
      "Invalid Google Sheet URL. Could not extract spreadsheet ID."
    );
  }
  return match[1];
}

/** Generates a signed RS256 JWT for Google Service Account OAuth */
function signJwt(payload: any, privateKey: string): string {
  const header = { alg: "RS256", typ: "JWT" };

  const base64UrlEncode = (str: string) =>
    Buffer.from(str)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);

  const formattedKey = privateKey.replace(/\\n/g, "\n");
  const signature = sign.sign(formattedKey, "base64");
  const signatureB64 = signature
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${signatureB64}`;
}

/** Authenticates a Google Service Account and returns an OAuth2 access token */
async function authenticateGoogle(serviceAccountJson: string): Promise<string> {
  const credentials = JSON.parse(serviceAccountJson);
  const { client_email, private_key, token_uri } = credentials;

  if (!client_email || !private_key) {
    throw new Error(
      "Invalid Service Account JSON. Missing client_email or private_key."
    );
  }

  const tokenUrl = token_uri || "https://oauth2.googleapis.com/token";
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;

  const jwtPayload = {
    iss: client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: tokenUrl,
    exp,
    iat,
  };

  const assertion = signJwt(jwtPayload, private_key);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Google OAuth token request failed: ${response.statusText} — ${errText}`
    );
  }

  const tokenData = await response.json();
  return tokenData.access_token;
}

/** Verifies that the Google Sheet is accessible with the given service account */
async function verifySpreadsheetConnection(
  spreadsheetUrl: string,
  serviceAccountJson: string
): Promise<boolean> {
  try {
    const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
    const token = await authenticateGoogle(serviceAccountJson);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch (err) {
    console.error("[backup] Connection verification failed:", err);
    return false;
  }
}

/** Masks the private_key in a Service Account JSON string for safe display */
function maskServiceAccount(key: string): string {
  if (!key) return "";
  try {
    const sa = JSON.parse(key);
    if (sa.private_key)
      sa.private_key = "••••••••••••••••••••••••••••••••";
    return JSON.stringify(sa, null, 2);
  } catch {
    return "••••••••••••••••";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHEET WRITE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Ensures all required tabs exist in the spreadsheet, creating any missing ones */
async function ensureSheetTabs(
  spreadsheetId: string,
  token: string,
  requiredTabs: string[]
): Promise<void> {
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    throw new Error(`Failed to fetch sheet metadata: ${await metaRes.text()}`);
  }
  const metaData = await metaRes.json();
  const existingTabs: string[] = (metaData.sheets || []).map(
    (s: any) => s.properties.title
  );

  const tabsToAdd = requiredTabs.filter((t) => !existingTabs.includes(t));
  if (tabsToAdd.length === 0) return;

  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  const addRes = await fetch(batchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: tabsToAdd.map((title) => ({
        addSheet: { properties: { title } },
      })),
    }),
  });
  if (!addRes.ok) {
    throw new Error(`Failed to create sheet tabs: ${await addRes.text()}`);
  }
}

/** Clears a sheet tab and writes new data starting at A1 */
async function writeSheetTab(
  spreadsheetId: string,
  token: string,
  tabName: string,
  values: any[][]
): Promise<void> {
  const encoded = encodeURIComponent(tabName);

  // 1. Clear
  const clearRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encoded}:clear`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!clearRes.ok) {
    throw new Error(`Clearing tab "${tabName}" failed: ${await clearRes.text()}`);
  }

  // 2. Write
  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encoded}!A1?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    }
  );
  if (!writeRes.ok) {
    throw new Error(`Writing tab "${tabName}" failed: ${await writeRes.text()}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid or missing JSON payload.", 400);
    }

    const { action, businessId, activeRole, config } = body;

    if (!businessId) return errorResponse("businessId is required.", 400);
    if (!action) return errorResponse("action is required.", 400);

    // ── AUTH: verify user session & business membership ──────────────────
    const { userId, errorResponse: authError } = await verifyUserMembership(
      req,
      businessId
    );
    if (authError) return authError;

    // Create an authenticated Supabase client using user JWT + anon key (RLS)
    const supabase = createUserClient(req);

    // ── ROUTE ────────────────────────────────────────────────────────────
    switch (action) {
      // ── GET CONFIG ────────────────────────────────────────────────────
      case "get": {
        const { data, error } = await supabase
          .from("google_sheets_backup")
          .select("*")
          .eq("business_id", businessId)
          .maybeSingle();

        if (error) {
          console.error("[backup:get] Error:", error);
          return errorResponse("Failed to retrieve backup configuration.", 500);
        }

        if (!data) {
          return jsonResponse({
            success: true,
            config: {
              googleSheetUrl: "",
              googleServiceAccount: "",
              schedule: "nightly_12am",
              enabled: false,
              isConfigured: false,
              lastBackupAt: null,
              lastBackupStatus: null,
            },
          });
        }

        return jsonResponse({
          success: true,
          config: {
            googleSheetUrl: data.google_sheet_url || "",
            googleServiceAccount: data.google_service_account
              ? maskServiceAccount(data.google_service_account)
              : "",
            schedule: data.schedule || "nightly_12am",
            enabled: !!data.enabled,
            isConfigured: !!data.google_service_account,
            lastBackupAt: data.last_backup_at || null,
            lastBackupStatus: data.last_backup_status || null,
          },
        });
      }

      // ── SAVE CONFIG ───────────────────────────────────────────────────
      case "save": {
        if (activeRole !== "Owner") {
          return errorResponse(
            "Access Denied: Only business Owners can configure backups.",
            403
          );
        }
        if (!config) return errorResponse("config payload is required.", 400);

        // Re-use existing service account if the user didn't change it (masked)
        const { data: existing } = await supabase
          .from("google_sheets_backup")
          .select("google_service_account")
          .eq("business_id", businessId)
          .maybeSingle();

        let saToSave = config.googleServiceAccount || "";
        if (saToSave.includes("••••")) {
          saToSave = existing?.google_service_account || "";
        }

        // Validate Service Account JSON structure
        if (saToSave && saToSave.trim().length > 0) {
          try {
            const parsed = JSON.parse(saToSave);
            if (!parsed.client_email || !parsed.private_key) {
              return errorResponse(
                "Invalid Service Account JSON: Missing client_email or private_key.",
                400
              );
            }
          } catch {
            return errorResponse(
              "Invalid Service Account JSON format. Please paste the full JSON file content.",
              400
            );
          }
        }

        const upsertPayload = {
          business_id: businessId,
          google_sheet_url: config.googleSheetUrl || "",
          google_service_account: saToSave,
          schedule: config.schedule || "nightly_12am",
          enabled: !!config.enabled,
          updated_at: new Date().toISOString(),
        };

        const { data: saved, error: saveErr } = await supabase
          .from("google_sheets_backup")
          .upsert(upsertPayload, { onConflict: "business_id" })
          .select()
          .single();

        if (saveErr) {
          console.error("[backup:save] Upsert error:", saveErr);
          return errorResponse("Failed to save backup configuration.", 500);
        }

        // Test the connection after save if enabled
        let connectionValid = false;
        if (saved.enabled && saved.google_sheet_url && saved.google_service_account) {
          connectionValid = await verifySpreadsheetConnection(
            saved.google_sheet_url,
            saved.google_service_account
          );
        }

        return jsonResponse({
          success: true,
          message: "Google Sheets backup configuration saved successfully.",
          connectionValid,
          config: {
            googleSheetUrl: saved.google_sheet_url,
            googleServiceAccount: saved.google_service_account ? "••••••••" : "",
            schedule: saved.schedule,
            enabled: saved.enabled,
            isConfigured: !!saved.google_service_account,
          },
        });
      }

      // ── HISTORY LOGS ──────────────────────────────────────────────────
      case "history": {
        const { data, error } = await supabase
          .from("backup_history_logs")
          .select("*")
          .eq("business_id", businessId)
          .order("timestamp", { ascending: false })
          .limit(50);

        if (error) {
          console.error("[backup:history] Fetch error:", error);
          return errorResponse("Failed to fetch backup history.", 500);
        }

        return jsonResponse({
          success: true,
          history: (data || []).map((l: any) => ({
            id: l.id,
            timestamp: l.timestamp,
            type: l.type,
            status: l.status,
            error: l.error,
            retries: l.retries,
            details: l.details,
          })),
        });
      }

      // ── RUN BACKUP (EXPORT TO GOOGLE SHEETS) ──────────────────────────
      case "run": {
        console.log(`[backup:run] Starting for business: ${businessId}`);

        // 1. Load config
        const { data: cfg, error: cfgErr } = await supabase
          .from("google_sheets_backup")
          .select("*")
          .eq("business_id", businessId)
          .maybeSingle();

        if (cfgErr || !cfg) {
          return errorResponse("Backup configuration not found.", 400);
        }
        if (!cfg.enabled) {
          return errorResponse(
            "Google Sheets backup is currently disabled. Enable it in Settings first.",
            400
          );
        }
        if (!cfg.google_sheet_url || !cfg.google_service_account) {
          return errorResponse(
            "Google Sheet URL or Service Account credentials are missing.",
            400
          );
        }

        // 2. Create a running log entry
        const { data: initialLog, error: logErr } = await supabase
          .from("backup_history_logs")
          .insert({
            business_id: businessId,
            type: "manual",
            status: "running",
            details: { initiated_by: userId },
          })
          .select()
          .single();

        if (logErr || !initialLog) {
          console.error("[backup:run] Failed to create log:", logErr);
          return errorResponse("Failed to initiate backup log.", 500);
        }

        const logId = initialLog.id;

        try {
          // 3. Fetch business name for sheet labeling
          const { data: bizData } = await supabase
            .from("businesses")
            .select("name, currency")
            .eq("id", businessId)
            .maybeSingle();

          const bizName = bizData?.name || "Business";
          const currency = bizData?.currency || "KSh";
          const backupTime = new Date().toISOString();
          const backupTimeDisplay = new Date().toLocaleString("en-KE", {
            timeZone: "Africa/Nairobi",
          });

          // 4. Fetch all operational & financial data in parallel
          const [
            prodsResult,
            adjsResult,
            txsResult,
            txItemsResult,
            custsResult,
            empsResult,
            expsResult,
            supsResult,
            creditsResult,
            walletResult,
            shiftsResult,
          ] = await Promise.all([
            // Products (Stock catalog)
            supabase
              .from("products")
              .select(
                "id, name, category, price, cost, stock, min_stock, unit, sku, description, perishable, expiry_days, created_at, updated_at"
              )
              .eq("business_id", businessId)
              .is("deleted_at", null)
              .order("category")
              .order("name"),

            // Inventory Adjustments
            supabase
              .from("inventory_adjustments")
              .select(
                "id, product_id, product_name, type, quantity_adjusted, previous_stock, new_stock, reason, staff_name, timestamp"
              )
              .eq("business_id", businessId)
              .order("timestamp", { ascending: false }),

            // Sales Transactions
            supabase
              .from("transactions")
              .select(
                "id, timestamp, customer_id, customer_name, staff_name, payment_method, total, discount, tax, final_total, status, is_delivery, delivery_fee, rider_name, note"
              )
              .eq("business_id", businessId)
              .is("deleted_at", null)
              .order("timestamp", { ascending: false }),

            // Sale Line Items
            supabase
              .from("transaction_items")
              .select(
                "id, transaction_id, product_id, product_name, quantity, unit_price, cost_price, discount, total, note"
              )
              .eq("business_id", businessId)
              .order("transaction_id"),

            // Customers
            supabase
              .from("customers")
              .select(
                "id, name, phone, email, tier, loyalty_points, purchases_count, debt_balance, wallet_balance, created_at, updated_at"
              )
              .eq("business_id", businessId)
              .is("deleted_at", null)
              .order("name"),

            // Employees (Workers)
            supabase
              .from("employees")
              .select(
                "id, name, role, email, phone, active_shift_id, created_at, updated_at"
              )
              .eq("business_id", businessId)
              .is("deleted_at", null)
              .order("name"),

            // Expenses
            supabase
              .from("expenses")
              .select(
                "id, amount, category, description, date, staff_name, created_at"
              )
              .eq("business_id", businessId)
              .order("date", { ascending: false }),

            // Suppliers
            supabase
              .from("suppliers")
              .select(
                "id, name, phone, email, company, product_supplied, created_at"
              )
              .eq("business_id", businessId)
              .is("deleted_at", null)
              .order("name"),

            // Credit / Debt Payments
            supabase
              .from("credit_payments")
              .select(
                "id, transaction_id, customer_id, customer_name, amount_owed, amount_paid, balance, status, due_date, settled_at, note, recorded_by, created_at"
              )
              .eq("business_id", businessId)
              .order("created_at", { ascending: false }),

            // Wallet Transactions (Ledger)
            supabase
              .from("wallet_transactions")
              .select(
                "id, customer_id, amount, balance_before, balance_after, reason, transaction_id, recorded_by, created_at"
              )
              .eq("business_id", businessId)
              .order("created_at", { ascending: false }),

            // Shifts Log
            supabase
              .from("shifts")
              .select(
                "id, employee_id, employee_name, clock_in, clock_out, break_duration_minutes, total_hours, notes"
              )
              .eq("business_id", businessId)
              .not("clock_out", "is", null)
              .order("clock_in", { ascending: false })
              .limit(500),
          ]);

          const prods = prodsResult.data || [];
          const adjs = adjsResult.data || [];
          const txs = txsResult.data || [];
          const txItems = txItemsResult.data || [];
          const custs = custsResult.data || [];
          const emps = empsResult.data || [];
          const exps = expsResult.data || [];
          const sups = supsResult.data || [];
          const credits = creditsResult.data || [];
          const wallets = walletResult.data || [];
          const shifts = shiftsResult.data || [];

          // Customers with outstanding debt
          const debtors = custs.filter((c: any) => Number(c.debt_balance) > 0);

          // 5. Define all sheet tabs with structured headers + rows
          const tables: Array<{
            tabName: string;
            headers: string[];
            rows: any[][];
          }> = [
            // ── BACKUP SUMMARY ──
            {
              tabName: `📋 Backup Summary`,
              headers: ["Field", "Value"],
              rows: [
                ["Business Name", bizName],
                ["Business ID", businessId],
                ["Backup Timestamp", backupTimeDisplay],
                ["Backup UTC", backupTime],
                ["Currency", currency],
                ["─── RECORD COUNTS ───", ""],
                ["Total Products (Stock SKUs)", prods.length],
                ["Total Customers", custs.length],
                ["Customers with Active Debt", debtors.length],
                ["Total Sales Transactions", txs.length],
                ["Total Sale Line Items", txItems.length],
                ["Debt Payment Records", credits.length],
                ["Wallet Ledger Entries", wallets.length],
                ["Total Employees (Workers)", emps.length],
                ["Completed Shifts Logged", shifts.length],
                ["Inventory Adjustment Entries", adjs.length],
                ["Expense Records", exps.length],
                ["Suppliers Registered", sups.length],
              ],
            },

            // ── SALES & TRANSACTIONS ──
            {
              tabName: `📊 Sales & Transactions`,
              headers: [
                "Backup Time",
                "Transaction ID",
                "Date & Time",
                "Customer Name",
                "Attendant (Staff)",
                "Payment Method",
                "Subtotal (" + currency + ")",
                "Discount (" + currency + ")",
                "Tax (" + currency + ")",
                "Final Total (" + currency + ")",
                "Is Delivery",
                "Delivery Fee (" + currency + ")",
                "Rider Assigned",
                "Status",
                "Notes",
              ],
              rows: txs.map((t: any) => [
                backupTime,
                t.id,
                t.timestamp,
                t.customer_name || "Walk-in",
                t.staff_name || "",
                t.payment_method || "",
                Number(t.total) || 0,
                Number(t.discount) || 0,
                Number(t.tax) || 0,
                Number(t.final_total) || 0,
                t.is_delivery ? "Yes" : "No",
                Number(t.delivery_fee) || 0,
                t.rider_name || "",
                t.status || "",
                t.note || "",
              ]),
            },

            // ── SALE LINE ITEMS ──
            {
              tabName: `🛒 Sale Items (Line Detail)`,
              headers: [
                "Backup Time",
                "Line Item ID",
                "Transaction ID",
                "Product ID",
                "Product Name",
                "Qty Sold",
                "Unit Price (" + currency + ")",
                "Cost Price (" + currency + ")",
                "Discount (" + currency + ")",
                "Line Total (" + currency + ")",
                "Notes",
              ],
              rows: txItems.map((i: any) => [
                backupTime,
                i.id,
                i.transaction_id,
                i.product_id,
                i.product_name || "",
                Number(i.quantity) || 0,
                Number(i.unit_price) || 0,
                Number(i.cost_price) || 0,
                Number(i.discount) || 0,
                Number(i.total) || 0,
                i.note || "",
              ]),
            },

            // ── DEBT ACCOUNTS ──
            {
              tabName: `💳 Debt Accounts`,
              headers: [
                "Backup Time",
                "Customer ID",
                "Customer Name",
                "Phone Number",
                "Email",
                "Membership Tier",
                "Outstanding Debt (" + currency + ")",
                "Wallet Balance (" + currency + ")",
                "Loyalty Points",
                "Total Purchases",
              ],
              rows: debtors.map((c: any) => [
                backupTime,
                c.id,
                c.name,
                c.phone,
                c.email || "",
                c.tier || "",
                Number(c.debt_balance) || 0,
                Number(c.wallet_balance) || 0,
                Number(c.loyalty_points) || 0,
                Number(c.purchases_count) || 0,
              ]),
            },

            // ── DEBT PAYMENTS ──
            {
              tabName: `💰 Debt Payments`,
              headers: [
                "Backup Time",
                "Payment Record ID",
                "Transaction ID",
                "Customer ID",
                "Customer Name",
                "Amount Owed (" + currency + ")",
                "Amount Paid (" + currency + ")",
                "Remaining Balance (" + currency + ")",
                "Status",
                "Due Date",
                "Settled At",
                "Recorded By",
                "Note",
                "Created At",
              ],
              rows: credits.map((c: any) => [
                backupTime,
                c.id,
                c.transaction_id || "",
                c.customer_id,
                c.customer_name,
                Number(c.amount_owed) || 0,
                Number(c.amount_paid) || 0,
                Number(c.balance) || 0,
                c.status || "",
                c.due_date || "",
                c.settled_at || "",
                c.recorded_by || "",
                c.note || "",
                c.created_at,
              ]),
            },

            // ── CUSTOMERS ──
            {
              tabName: `👥 Customers`,
              headers: [
                "Backup Time",
                "Customer ID",
                "Full Name",
                "Phone Number",
                "Email Address",
                "Membership Tier",
                "Loyalty Points",
                "Total Purchases",
                "Debt Balance (" + currency + ")",
                "Wallet Balance (" + currency + ")",
                "Registered At",
                "Last Updated",
              ],
              rows: custs.map((c: any) => [
                backupTime,
                c.id,
                c.name,
                c.phone,
                c.email || "",
                c.tier || "",
                Number(c.loyalty_points) || 0,
                Number(c.purchases_count) || 0,
                Number(c.debt_balance) || 0,
                Number(c.wallet_balance) || 0,
                c.created_at,
                c.updated_at,
              ]),
            },

            // ── STOCK (PRODUCTS) ──
            {
              tabName: `📦 Stock (Products)`,
              headers: [
                "Backup Time",
                "Product ID",
                "Product Name",
                "Category",
                "Price (" + currency + ")",
                "Cost Price (" + currency + ")",
                "Stock Level",
                "Min Stock Threshold",
                "Unit",
                "SKU",
                "Perishable",
                "Expiry Days",
                "Description",
                "Created At",
                "Last Updated",
              ],
              rows: prods.map((p: any) => [
                backupTime,
                p.id,
                p.name,
                p.category,
                Number(p.price) || 0,
                Number(p.cost) || 0,
                Number(p.stock) || 0,
                Number(p.min_stock) || 0,
                p.unit || "",
                p.sku || "",
                p.perishable ? "Yes" : "No",
                p.expiry_days || "",
                p.description || "",
                p.created_at,
                p.updated_at,
              ]),
            },

            // ── STOCK ADJUSTMENTS ──
            {
              tabName: `🔄 Stock Adjustments`,
              headers: [
                "Backup Time",
                "Adjustment ID",
                "Product ID",
                "Product Name",
                "Adjustment Type",
                "Quantity Adjusted",
                "Stock Before",
                "Stock After",
                "Reason",
                "Logged By (Staff)",
                "Timestamp",
              ],
              rows: adjs.map((a: any) => [
                backupTime,
                a.id,
                a.product_id,
                a.product_name || "",
                a.type || "",
                Number(a.quantity_adjusted) || 0,
                Number(a.previous_stock) || 0,
                Number(a.new_stock) || 0,
                a.reason || "",
                a.staff_name || "",
                a.timestamp,
              ]),
            },

            // ── WORKERS (STAFF / EMPLOYEES) ──
            {
              tabName: `👷 Workers (Staff)`,
              headers: [
                "Backup Time",
                "Staff ID",
                "Full Name",
                "Role",
                "Email Address",
                "Phone Number",
                "Currently On Shift",
                "Active Shift ID",
                "Date Joined",
                "Last Updated",
              ],
              rows: emps.map((e: any) => [
                backupTime,
                e.id,
                e.name,
                e.role || "",
                e.email || "",
                e.phone || "",
                e.active_shift_id ? "Yes — On Duty" : "No — Off Duty",
                e.active_shift_id || "",
                e.created_at,
                e.updated_at,
              ]),
            },

            // ── SHIFT LOG ──
            {
              tabName: `📅 Shift Log`,
              headers: [
                "Backup Time",
                "Shift ID",
                "Employee ID",
                "Employee Name",
                "Clock In",
                "Clock Out",
                "Break (minutes)",
                "Total Hours Worked",
                "Notes",
              ],
              rows: shifts.map((s: any) => [
                backupTime,
                s.id,
                s.employee_id,
                s.employee_name || "",
                s.clock_in,
                s.clock_out || "",
                Number(s.break_duration_minutes) || 0,
                Number(s.total_hours) || 0,
                s.notes || "",
              ]),
            },

            // ── EXPENSES ──
            {
              tabName: `💸 Expenses`,
              headers: [
                "Backup Time",
                "Expense ID",
                "Amount (" + currency + ")",
                "Category",
                "Description",
                "Date",
                "Recorded By (Staff)",
                "Created At",
              ],
              rows: exps.map((e: any) => [
                backupTime,
                e.id,
                Number(e.amount) || 0,
                e.category || "",
                e.description || "",
                e.date || "",
                e.staff_name || "",
                e.created_at,
              ]),
            },

            // ── SUPPLIERS ──
            {
              tabName: `🏭 Suppliers`,
              headers: [
                "Backup Time",
                "Supplier ID",
                "Contact Name",
                "Phone Number",
                "Email Address",
                "Company / Business Name",
                "Product(s) Supplied",
                "Registered At",
              ],
              rows: sups.map((s: any) => [
                backupTime,
                s.id,
                s.name,
                s.phone || "",
                s.email || "",
                s.company || "",
                s.product_supplied || "",
                s.created_at,
              ]),
            },

            // ── WALLET LEDGER ──
            {
              tabName: `💼 Wallet Ledger`,
              headers: [
                "Backup Time",
                "Entry ID",
                "Customer ID",
                "Amount (" + currency + ")",
                "Balance Before (" + currency + ")",
                "Balance After (" + currency + ")",
                "Reason",
                "Linked Transaction ID",
                "Recorded By",
                "Timestamp",
              ],
              rows: wallets.map((w: any) => [
                backupTime,
                w.id,
                w.customer_id,
                Number(w.amount) || 0,
                Number(w.balance_before) || 0,
                Number(w.balance_after) || 0,
                w.reason || "",
                w.transaction_id || "",
                w.recorded_by || "",
                w.created_at,
              ]),
            },
          ];

          // 6. Connect to Google Sheets
          const spreadsheetId = extractSpreadsheetId(cfg.google_sheet_url);
          const googleToken = await authenticateGoogle(cfg.google_service_account);

          // 7. Ensure all tabs exist
          const allTabNames = tables.map((t) => t.tabName);
          await ensureSheetTabs(spreadsheetId, googleToken, allTabNames);

          // 8. Write each tab
          const details: Record<string, number> = {};
          for (const table of tables) {
            const valuesToWrite = [table.headers, ...table.rows];
            await writeSheetTab(
              spreadsheetId,
              googleToken,
              table.tabName,
              valuesToWrite
            );
            details[table.tabName] = table.rows.length;
          }

          // 9. Update log & config record
          await supabase
            .from("backup_history_logs")
            .update({
              status: "success",
              details,
              timestamp: new Date().toISOString(),
            })
            .eq("id", logId);

          await supabase
            .from("google_sheets_backup")
            .update({
              last_backup_at: new Date().toISOString(),
              last_backup_status: "success",
              last_backup_error: null,
            })
            .eq("business_id", businessId);

          console.log(
            `[backup:run] ✅ Success — ${Object.keys(details).length} sheets written for "${bizName}"`
          );

          return jsonResponse({
            success: true,
            message: `Backup completed successfully! ${Object.keys(details).length} data sheets written.`,
            businessName: bizName,
            log: { id: logId, status: "success", details },
          });
        } catch (err: any) {
          console.error("[backup:run] Backup execution failed:", err);

          await supabase
            .from("backup_history_logs")
            .update({
              status: "failed",
              error: err.message || "Unknown error during backup",
              timestamp: new Date().toISOString(),
            })
            .eq("id", logId);

          await supabase
            .from("google_sheets_backup")
            .update({
              last_backup_at: new Date().toISOString(),
              last_backup_status: "failed",
              last_backup_error: err.message || "Unknown error",
            })
            .eq("business_id", businessId);

          return jsonResponse({
            success: false,
            error: err.message || "Backup execution failed. Please try again.",
          });
        }
      }

      // ── IMPORT (FROM GOOGLE SHEETS) ────────────────────────────────────
      case "import": {
        console.log(`[backup:import] Starting for business: ${businessId}`);

        const { data: cfg, error: cfgErr } = await supabase
          .from("google_sheets_backup")
          .select("*")
          .eq("business_id", businessId)
          .maybeSingle();

        if (cfgErr || !cfg || !cfg.enabled) {
          return errorResponse(
            "Google Sheets backup integration is disabled or not configured.",
            400
          );
        }
        if (!cfg.google_sheet_url || !cfg.google_service_account) {
          return errorResponse(
            "Google Sheet URL or Service Account credentials are missing.",
            400
          );
        }

        const { data: initialLog } = await supabase
          .from("backup_history_logs")
          .insert({
            business_id: businessId,
            type: "manual",
            status: "running",
            details: { action: "import", initiated_by: userId },
          })
          .select()
          .single();

        const logId = initialLog?.id;

        try {
          const spreadsheetId = extractSpreadsheetId(cfg.google_sheet_url);
          const googleToken = await authenticateGoogle(cfg.google_service_account);

          // Discover available sheet tabs
          const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`;
          const metaRes = await fetch(metaUrl, {
            headers: { Authorization: `Bearer ${googleToken}` },
          });
          if (!metaRes.ok)
            throw new Error(`Failed to fetch sheet tabs: ${await metaRes.text()}`);

          const metaData = await metaRes.json();
          const existingSheets: string[] = (metaData.sheets || []).map(
            (s: any) => s.properties.title
          );

          const summary: Record<string, number> = {};

          /** Helper to fetch values from a sheet tab */
          const fetchTab = async (tabName: string): Promise<any[][]> => {
            const tabUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A1:Z5000`;
            const res = await fetch(tabUrl, {
              headers: { Authorization: `Bearer ${googleToken}` },
            });
            if (!res.ok) return [];
            const json = await res.json();
            return json.values || [];
          };

          // ── Import Products (from "📦 Stock (Products)") ──
          const productTabName = existingSheets.find((s) =>
            s.includes("Stock (Products)")
          );
          if (productTabName) {
            const values = await fetchTab(productTabName);
            if (values.length > 1) {
              const hdrs = values[0].map((h: string) => h.trim());
              const idx = (col: string) => hdrs.indexOf(col);
              let count = 0;

              for (let i = 1; i < values.length; i++) {
                const row = values[i];
                const name = row[idx("Product Name")];
                if (!name) continue;

                const payload: any = {
                  business_id: businessId,
                  name: String(name),
                  category: row[idx("Category")] || "General",
                  price: Number(row[idx("Price (" + "KSh" + ")")] || row[2] || 0),
                  cost: Number(row[idx("Cost Price (" + "KSh" + ")")] || row[3] || 0),
                  stock: Number(row[idx("Stock Level")] || 0),
                  min_stock: Number(row[idx("Min Stock Threshold")] || 0),
                  unit: row[idx("Unit")] || "Pieces",
                  sku: row[idx("SKU")] || "",
                  description: row[idx("Description")] || "",
                  updated_at: new Date().toISOString(),
                };

                const productId = row[idx("Product ID")];
                if (productId?.includes("-")) {
                  await supabase
                    .from("products")
                    .upsert({ id: productId, ...payload }, { onConflict: "id" });
                } else {
                  await supabase.from("products").insert(payload);
                }
                count++;
              }
              summary["Products"] = count;
            }
          }

          // ── Import Customers (from "👥 Customers") ──
          const customerTabName = existingSheets.find((s) =>
            s.includes("Customers")
          );
          if (customerTabName) {
            const values = await fetchTab(customerTabName);
            if (values.length > 1) {
              const hdrs = values[0].map((h: string) => h.trim());
              const idx = (col: string) => hdrs.indexOf(col);
              let count = 0;

              for (let i = 1; i < values.length; i++) {
                const row = values[i];
                const name = row[idx("Full Name")];
                const phone = row[idx("Phone Number")];
                if (!name || !phone) continue;

                const payload: any = {
                  business_id: businessId,
                  name: String(name),
                  phone: String(phone),
                  email: row[idx("Email Address")] || "",
                  tier: row[idx("Membership Tier")] || "Bronze",
                  loyalty_points: Number(row[idx("Loyalty Points")] || 0),
                  purchases_count: Number(row[idx("Total Purchases")] || 0),
                  debt_balance: Number(row[idx("Debt Balance (" + "KSh" + ")")] || row[8] || 0),
                  wallet_balance: Number(row[idx("Wallet Balance (" + "KSh" + ")")] || row[9] || 0),
                  updated_at: new Date().toISOString(),
                };

                const customerId = row[idx("Customer ID")];
                if (customerId?.includes("-")) {
                  await supabase
                    .from("customers")
                    .upsert({ id: customerId, ...payload }, { onConflict: "id" });
                } else {
                  await supabase.from("customers").insert(payload);
                }
                count++;
              }
              summary["Customers"] = count;
            }
          }

          // Update log
          await supabase
            .from("backup_history_logs")
            .update({
              status: "success",
              details: { action: "import", ...summary },
              timestamp: new Date().toISOString(),
            })
            .eq("id", logId);

          return jsonResponse({
            success: true,
            message: "Data imported successfully from Google Sheets!",
            log: { id: logId, status: "success", details: summary },
          });
        } catch (err: any) {
          console.error("[backup:import] Failed:", err);
          if (logId) {
            await supabase
              .from("backup_history_logs")
              .update({
                status: "failed",
                error: err.message,
                timestamp: new Date().toISOString(),
              })
              .eq("id", logId);
          }
          return jsonResponse({
            success: false,
            error: err.message || "Import failed. Please check your sheet configuration.",
          });
        }
      }

      // ── RETRY (consolidated into "run") ───────────────────────────────
      case "retry":
        return jsonResponse({
          success: false,
          error: "Use the 'run' action to trigger a fresh backup instead of retrying.",
        });

      default:
        return errorResponse(`Unknown action: "${action}"`, 400);
    }
  } catch (err: any) {
    console.error("[backup-config] Fatal error:", err);
    return errorResponse(err.message || "Internal server error", 500);
  }
});
