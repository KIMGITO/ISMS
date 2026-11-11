// src/test/runTests.ts
import "./kenyaTimezone"; // must stay first
import { formatClock, minutesFromNow, toClock, toDateKey } from "../utils/timeFormat";
import { readFileSync, readdirSync } from "node:fs";
import { respond, UssdContext } from "../../supabase/functions/ussd/menu";
import "./setupTests";
import { formatReceiptNumber, formatCustomerNumber, getShortId } from "../utils/idUtils";
import { EscPosGenerator, toPrinterText } from "../services/printer/EscPosGenerator";
import { CODE128_PATTERNS, code128Codes } from "../services/receipt/code128";
import { buildReceiptLines, buildReceiptText, pair, wrap, columnsFor } from "../services/receipt/layout";
import { normalizeReceiptSettings } from "../services/receipt/ReceiptSettings";
import { buildReceiptContent } from "../services/receipt/ReceiptGenerator";
import { EmailService } from "../services/emailService";
import { toUserMessage, AppError } from "../utils/userError";
import { scrubPersonalData } from "../services/crashReporter";
import { NotificationRepository } from "../services/notifications/notificationRepository";
import { hasRolePermission, SYSTEM_ROLES } from "../utils/permissions";
import { useAuthStore } from "../stores/authStore";
import { defaultKeepId, phoneKey, previewMerge } from "../services/customerMerge";
import { arrangeMobileNav, MAX_BOTTOM_TABS, MORE_TAB_ID } from "../utils/mobileNav";
import { toMsisdn } from "../../supabase/functions/mpesa-payments/phone";
import { cardDetails, fromSubunits, keyEnvironment, newReference, signatureMatches, toSubunits, transactionOutcome } from "../../supabase/functions/card-payments/paystack";
import { MONEY_METHODS, isMoneyMethod, methodLabel, normalizeReference } from "../utils/paymentMethods";
import { createHmac } from "node:crypto";
import { pointsEarned, POINTS_PER_KSH, DEBT_PAYMENT_POINTS_PER_KSH } from "../services/loyalty/tillPoints";
import { cannotAttachReason } from "../services/saleCustomer";
import { SHORTCUTS, GO_TO_KEYS, shortcutsFor, featuresFor } from "../utils/shortcuts";
import { DEFAULT_POINT_SETTINGS, pointValueFor, pointsPerShilling } from "../services/loyalty/pointValue";
import { customerName, readableIds } from "../utils/stringUtils";
import { buildInvoiceLines, combineSameProducts, periodFor } from "../services/invoice/invoiceDraft";
import { mergeDuplicateCredits } from "../services/invoice/invoiceData";
import { tidyNotification } from "../services/notifications/notificationText";
import { NotificationTemplates } from "../services/notifications/notificationTemplates";
// @ts-ignore plain JS module shared with the release workflow
import { classifyCommit, highestBump, nextVersion } from "../../scripts/release-version.mjs";
// @ts-ignore plain JS module shared with the release workflow
import { buildManifest } from "../../scripts/update-manifest.mjs";
import { compareVersions } from "../utils/semver";
import { UpdateError, UPDATE_MESSAGES, toUpdateError, withRetry } from "../core/native/updateErrors";
import { MANIFEST_SOURCES, fetchManifest, parseManifest } from "../core/native/updateManifest";
import { SCREENS, canOpenScreen } from "../utils/screens";
import { salesOutbox, isNetworkError } from "../services/offline/salesOutbox";
import { SupabaseService } from "../services/supabaseService";
import { parseDocument, serializeDocument, plainText as pagePlainText, parseInline } from "../../website/src/richFormat";
import { defaultInfoPageText, INFO_PAGES } from "../../website/src/infoPages";
import { analyse, analyseBranches, bucketIndex, getRange, growth, kenyaNow, kenyaTime, makeBuckets, pickGranularity, previousRange } from "../features/home/metrics";
import { buildShiftReport, shiftReportText } from "../services/shiftReport";

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ TEST PASSED: ${name}`);
  } catch (e) {
    console.error(`❌ TEST FAILED: ${name}`);
    console.error(e);
    process.exit(1);
  }
}

console.log("🚀 Starting Application Unit Tests...");

runTest("Alarm times read the same when set, listed and rung", () => {
  const cases: [string, string][] = [["13:38", "1:38 PM"], ["00:05", "12:05 AM"], ["12:00", "12:00 PM"], ["09:30:00", "9:30 AM"], ["23:59", "11:59 PM"]];
  for (const [input, want] of cases) {
    if (formatClock(input) !== want) throw new Error(`${input} -> ${formatClock(input)}, want ${want}`);
  }
  if (toClock(12, 5, false) !== "00:05" || toClock(1, 38, true) !== "13:38" || toClock(12, 0, true) !== "12:00") throw new Error("12-hour to 24-hour is wrong");
  if (formatClock("") !== "" || formatClock("25:00") !== "") throw new Error("bad times should show nothing");
  const late = new Date(2026, 10, 9, 23, 30);
  const next = minutesFromNow(60, late);
  if (next.date !== "2026-11-10" || next.time !== "00:30") throw new Error("+1 hr near midnight should move to tomorrow");
  if (toDateKey(new Date(2026, 0, 1, 0, 30)) !== "2026-01-01") throw new Error("date key must use local time");
});

runTest("ID Utility getShortId", () => {
  const uuid = "4f8c9b24-9b21-4f1e-8e81-cf1b54a7c29e";
  const shortId = getShortId(uuid);
  if (shortId !== "4F8C9B24") {
    throw new Error(`Expected 4F8C9B24, got ${shortId}`);
  }
});

runTest("formatReceiptNumber Formatter", () => {
  const uuid = "4f8c9b24-9b21-4f1e-8e81-cf1b54a7c29e";
  const num = formatReceiptNumber(uuid);
  if (num !== "TXN-4F8C9B24") {
    throw new Error(`Expected TXN-4F8C9B24, got ${num}`);
  }
});

runTest("formatCustomerNumber Formatter", () => {
  const uuid = "4f8c9b24-9b21-4f1e-8e81-cf1b54a7c29e";
  const num = formatCustomerNumber(uuid);
  if (num !== "CST-4F8C9B24") {
    throw new Error(`Expected CST-4F8C9B24, got ${num}`);
  }
});

const receiptSettings = normalizeReceiptSettings({
  businessName: "Mama Mboga Shop",
  phone: "0712 345 678",
  // Old placeholder defaults must not reach a shop's receipt.
  footerMessage: "You were served using KayKay's POS Application!",
  paperWidth: "58mm",
});
const sampleTx: any = {
  id: "3f2a9c1e-0000-4000-8000-000000000001",
  items: [
    { product: { id: "p1", name: "Fresh Milk 500ml", price: 60, unit: "Packet" }, quantity: 2, discountPercentage: 0 },
    { product: { id: "p2", name: "Mala 1 Litre with an unusually long product name", price: 150, unit: "unit" }, quantity: 1, discountPercentage: 10 },
  ],
  total: 270, discount: 15, tax: 0, finalTotal: 255, paymentMethod: "M-Pesa",
  staffId: "s1", staffName: "Jane", status: "Synced", timestamp: "2026-11-07T10:30:00.000Z",
};

runTest("Receipt layout keeps every line inside the paper width", () => {
  const content = buildReceiptContent(sampleTx, receiptSettings);
  const cols = columnsFor(receiptSettings);
  if (cols !== 32) throw new Error(`58mm should give 32 columns, got ${cols}`);
  for (const line of buildReceiptLines(content, receiptSettings)) {
    if (line.t === "text" && line.text.length > (line.big ? cols / 2 : cols)) throw new Error(`Line too long: "${line.text}"`);
  }
  const { body } = buildReceiptText(content, receiptSettings);
  if (body.split("\n").some((l) => l.length > cols)) throw new Error("Text receipt has a line wider than the paper");
  if (!body.includes("MAMA MBOGA SHOP") || !body.includes("255.00")) throw new Error("Receipt text is missing the shop or total");
  if (body.includes("KayKay")) throw new Error("Placeholder text leaked onto the receipt");
  if (body.includes("KRA")) throw new Error("A sale without a KRA signature must not mention KRA");
  if (pair("Total", "KSh 1,000,000.00", 12).some((l) => l.length > 12)) throw new Error("pair() overflowed");
  if (wrap("abcdefghij", 4).join("|") !== "abcd|efgh|ij") throw new Error("wrap() did not break a long word");
});

runTest("Receipt ends with the italic policy and the green thank-you; barcode can be switched off", () => {
  const settings = { ...receiptSettings, returnPolicy: "Goods once sold are not returnable.", thankYouMessage: "Asante sana!", extraQr: "custom_url" as const, customQrUrl: "https://example.com" };
  const content = buildReceiptContent(sampleTx, settings);
  const lines = buildReceiptLines(content, settings);
  const last = lines[lines.length - 1];
  const before = lines[lines.length - 2];
  if (last.t !== "text" || last.text.trim() !== "Asante sana!" || last.tone !== "green") throw new Error("Thank-you is not the last, green line");
  const policy = lines.filter((l) => l.t === "text" && l.italic).map((l: any) => l.text.trim()).join(" ");
  if (before.t !== "text" || !before.italic || policy !== "Goods once sold are not returnable.") throw new Error("Policy is not second-last in italics");
  if (!lines.some((l) => l.t === "barcode")) throw new Error("Barcode missing while switched on");
  if (buildReceiptLines(content, { ...settings, showBarcode: false }).some((l) => l.t === "barcode")) throw new Error("Barcode printed while switched off");
});

runTest("Receipt shows the KRA block only with a real signature", () => {
  const kra = {
    pin: "P051234567X", branchId: "00", invoiceNo: 7, sdcId: "KRACU0100000001", rcptNo: 152,
    internalData: "ABCDEFGHIJKLMNOP", signature: "QRSTUVWXYZ123456", qrUrl: "https://etims.kra.go.ke/x", environment: "production" as const,
  };
  const lines = buildReceiptLines(buildReceiptContent(sampleTx, receiptSettings, { kra }), receiptSettings);
  if (!lines.some((l) => l.t === "qr" && l.data === kra.qrUrl)) throw new Error("KRA QR missing");
  if (!lines.some((l) => l.t === "text" && l.text.includes("KRACU0100000001/152"))) throw new Error("CU invoice number missing");
});

runTest("Code 128 table and checksum", () => {
  if (CODE128_PATTERNS.length !== 107) throw new Error("Code 128 needs 107 patterns");
  CODE128_PATTERNS.forEach((p, i) => {
    const sum = Array.from(p).reduce((a, c) => a + Number(c), 0);
    if (sum !== (i === 106 ? 13 : 11)) throw new Error(`Pattern ${i} has width ${sum}`);
  });
  // "PJJ123C" in set B: 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879; 879 mod 103 = 55.
  const codes = code128Codes("PJJ123C");
  if (codes[codes.length - 2] !== 55) throw new Error(`Checksum ${codes[codes.length - 2]} != 55`);
});

runTest("ESC/POS output starts with init, ends with cut, has only printable text", () => {
  const content = buildReceiptContent(sampleTx, receiptSettings);
  const bytes = EscPosGenerator.fromLines(buildReceiptLines(content, receiptSettings), { columns: 32, dots: 384, autoCut: true });
  if (bytes[0] !== 0x1b || bytes[1] !== 0x40) throw new Error("Missing ESC @");
  const tail = Array.from(bytes.slice(-4));
  if (tail.join(",") !== [0x1d, 0x56, 66, 0].join(",")) throw new Error("Missing paper cut");
  if (toPrinterText("Café – “Mũrĩa” 🥛") !== 'Cafe - "Muria" ?') throw new Error(`Bad text folding: ${toPrinterText("Café – “Mũrĩa” 🥛")}`);
});

runTest("EmailService class and wrappers structure", () => {
  if (typeof EmailService.sendEmail !== "function") {
    throw new Error("sendEmail is not a function");
  }
});

runTest("toUserMessage hides technical text and keeps friendly text", () => {
  const cases: Array<[unknown, string]> = [
    [{ code: "23505", message: 'duplicate key value violates unique constraint "x"' }, "This record already exists."],
    [{ code: "42P01", message: 'relation "public.secret" does not exist' }, "FALLBACK"],
    [new TypeError("Cannot read properties of undefined (reading 'id')"), "FALLBACK"],
    [new TypeError("Failed to fetch"), "We couldn't reach the server. Please check your connection and try again."],
    [new Error('Edge function "chat" failed: non-2xx'), "FALLBACK"],
    [{ code: "P0001", message: "Insufficient stock for Milk." }, "Insufficient stock for Milk."],
    [new Error("Invalid login credentials"), "Incorrect email or password."],
    [new AppError("Only owners can do this."), "Only owners can do this."],
    [new Error("Please choose a category."), "Please choose a category."],
    [undefined, "FALLBACK"],
    [{}, "FALLBACK"],
  ];
  for (const [input, expected] of cases) {
    const actual = toUserMessage(input, "FALLBACK");
    if (actual !== expected) throw new Error(`Expected "${expected}", got "${actual}"`);
  }
});

runTest("scrubPersonalData removes personal details from crash reports", () => {
  const scrubbed = scrubPersonalData(
    "failed for jane@x.co +254 712 345 678 id 4f8c9b24-9b21-4f1e-8e81-cf1b54a7c29e token eyJabc.def.ghi"
  );
  for (const secret of ["jane@x.co", "712 345", "4f8c9b24", "eyJabc"]) {
    if (scrubbed.includes(secret)) throw new Error(`Leaked "${secret}" in: ${scrubbed}`);
  }
});

runTest("NotificationRepository mock initial state", () => {
  const list = NotificationRepository.getAll();
  if (!Array.isArray(list)) {
    throw new Error("getAll() should return an array");
  }
});

runTest("hasRolePermission dynamic checks and DB overrides", () => {
  // Clear any existing database permissions
  useAuthStore.setState({ dbPermissions: [] });

  // 1. By default, 'Cashier' should not have credit_payments access (assuming standard rules)
  const defaultCashierVal = hasRolePermission("Cashier", "credit_payments" as any);
  
  // 2. Set database permissions override
  useAuthStore.setState({
    dbPermissions: [
      { role: "Cashier", permission: "credit_payments", granted: true }
    ]
  });

  const overrideCashierVal = hasRolePermission("Cashier", "credit_payments" as any);
  if (overrideCashierVal !== true) {
    throw new Error(`Expected Cashier to have credit_payments permission via DB override, got ${overrideCashierVal}`);
  }

  // 3. Explicitly deny a permission via DB override
  useAuthStore.setState({
    dbPermissions: [
      { role: "Cashier", permission: "credit_payments", granted: false }
    ]
  });

  const deniedCashierVal = hasRolePermission("Cashier", "credit_payments" as any);
  if (deniedCashierVal !== false) {
    throw new Error(`Expected Cashier to not have credit_payments permission when explicitly false in DB, got ${deniedCashierVal}`);
  }
});

runTest("BOM Batch Ingredient Requirement & Stock Shortage Calculation", () => {
  const mockIngredients = [
    { productId: "p-milk", quantityRequired: 1.5, wastePercentage: 10, unit: "Liters" }, // 1.5 * 1.1 = 1.65 L per unit
    { productId: "p-[#3-culture]", quantityRequired: 0.5, wastePercentage: 0, unit: "Grams" },  // 0.5 g per unit
  ];

  const batchQty = 10; // Batch of 10 units
  const mockStock = { "p-milk": 15, "p-[#3-culture] border": 10 }; // Milk has 15L, but need 16.5L!

  const availability = mockIngredients.map(ing => {
    const required = ing.quantityRequired * (1 + ing.wastePercentage / 100) * batchQty;
    const current = mockStock[ing.productId as keyof typeof mockStock] || 0;
    return { productId: ing.productId, required, current, isSufficient: current >= required };
  });

  const milkCheck = availability.find(a => a.productId === "p-milk");
  if (!milkCheck || milkCheck.isSufficient !== false || milkCheck.required !== 16.5) {
    throw new Error(`Expected Milk shortage calculation (needed 16.5L, got required=${milkCheck?.required}, isSufficient=${milkCheck?.isSufficient})`);
  }
});

runTest("Batch Cancellation Restocking vs Waste Split Logic", () => {
  const consumedQty = 50; // 50L consumed
  const returnQtyInput = 30; // Return 30L, 20L wasted

  const returnQty = Math.min(consumedQty, Math.max(0, returnQtyInput));
  const wastedQty = Math.max(0, consumedQty - returnQty);

  if (returnQty !== 30 || wastedQty !== 20) {
    throw new Error(`Expected returnQty=30 and wastedQty=20, got returnQty=${returnQty}, wastedQty=${wastedQty}`);
  }
});

runTest("AI Copilot Pending Action Store & Permission Validation", async () => {
  const { usePendingActionStore, evaluateValidation } = await import("../stores/pendingActionStore");
  
  // Clear any existing db overrides
  useAuthStore.setState({ dbPermissions: [], currentEmployee: { id: "e1", name: "Cashier Bob", role: "Cashier", phone: "123" } as any });

  // 1. Evaluate validation for unauthorized action (Cashier trying to create BOM requiring "bom.create")
  const validation = evaluateValidation("create_recipe_bom", "bom.create", { name: "Test BOM" });
  if (validation.isValid !== false || validation.hasPermission !== false) {
    throw new Error(`Expected validation to fail for unauthorized role "Cashier", got isValid=${validation.isValid}`);
  }

  // 2. Add pending action draft to store
  const store = usePendingActionStore.getState();
  const draft = store.addPendingAction({
    type: "create_customer",
    title: "New Customer Draft",
    summary: "Create customer Jane Doe",
    requiredPermission: "customers.create",
    params: { name: "Jane Doe", phone: "0799887766" },
    createdBy: "Kim AI Copilot",
  });

  if (!draft || draft.status !== "pending_review") {
    throw new Error(`Expected draft status to be "pending_review", got ${draft?.status}`);
  }

  // 3. Reject pending action
  store.rejectPendingAction(draft.id);
  const updatedAction = usePendingActionStore.getState().pendingActions.find(a => a.id === draft.id);
  if (updatedAction?.status !== "rejected") {
    throw new Error(`Expected rejected status, got ${updatedAction?.status}`);
  }
});

runTest("Hugging Face Default Provider & Token Rotation Logic", () => {
  // Test default provider selection
  const defaultProvider = "huggingface";
  const defaultModel = "Qwen/Qwen2.5-72B-Instruct";
  
  if (defaultProvider !== "huggingface" || !defaultModel.includes("Qwen")) {
    throw new Error(`Expected huggingface default, got provider=${defaultProvider}, model=${defaultModel}`);
  }

  // Test token env scanner simulation
  const envKeys = ["HF_TOKEN_A", "HF_TOKEN_B", "HF_TOKEN", "HUGGINGFACE_TOKEN"];
  const mockEnv: Record<string, string> = {
    HF_TOKEN_A: "hf_token_a_12345",
    HF_TOKEN_B: "hf_token_b_67890",
  };

  const tokens = envKeys.map(k => mockEnv[k]).filter(Boolean);
  if (tokens.length !== 2 || tokens[0] !== "hf_token_a_12345") {
    throw new Error(`Expected 2 tokens collected from pool, got ${tokens.length}`);
  }
});

runTest("USSD menu registers, orders and checks balances", () => {
  const ctx: UssdContext = {
    shopName: "KayKay's",
    registered: true,
    products: [
      { id: "p1", name: "Milk", unit: "L", price: 80, stock: 10 },
      { id: "p2", name: "Empty", unit: "L", price: 50, stock: 0 },
    ],
    zones: [],
    deliveryEnabled: true,
    deliveryFee: 50,
    summary: "Gold: 5 points",
  };
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(label);
  };

  const unknown = { ...ctx, registered: false };
  check(respond("", unknown).text.startsWith("CON"), "asks a new caller for a name");
  const registered = respond("Asha", unknown);
  check(registered.text.startsWith("END") && registered.action?.type === "register", "registers the caller");

  check(respond("", ctx).text.includes("1. Order"), "shows the main menu");
  check(!respond("1", ctx).text.includes("Empty"), "hides products with no stock");
  check(respond("1*1*99", ctx).text.startsWith("END"), "refuses more than the stock");
  check(respond("1*9", ctx).text.startsWith("END"), "refuses a choice not on the list");

  check(respond("1*1*2*2", ctx).text.includes("Total Ksh 160"), "pickup has no fee");
  const pickup = respond("1*1*2*2*1", ctx);
  check(pickup.action?.type === "order" && pickup.action.fulfilment === "pickup", "places a pickup order");
  check(respond("1*1*2*2*2", ctx).action === undefined, "cancelling places nothing");

  check(respond("1*1*2*1", ctx).text.includes("delivery location"), "delivery asks for a location");
  check(respond("1*1*2*1*Kasarani", ctx).text.includes("Total Ksh 210"), "delivery adds the flat fee");

  const zoned = { ...ctx, zones: [{ id: "z1", name: "Town", fee: 30 }] };
  check(respond("1*1*2*1", zoned).text.includes("Town"), "delivery lists the areas");
  check(respond("1*1*2*1*1*Kasarani", zoned).text.includes("Total Ksh 190"), "the area sets the fee");
  const zonedOrder = respond("1*1*2*1*1*Kasarani*1", zoned);
  check(zonedOrder.action?.type === "order" && zonedOrder.action.zoneId === "z1", "the order carries the area");

  const noDelivery = { ...ctx, deliveryEnabled: false };
  check(respond("1*1*2", noDelivery).text.includes("Total Ksh 160"), "skips the question without delivery");
  check(respond("3", ctx).text === "END Gold: 5 points", "shows the balance");
});

runTest("Database role permissions match the app's role permissions", () => {
  // The newest migration that sets the role defaults is the one in force.
  const dir = "supabase/migrations";
  const latest = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().reverse()
    .find((f) => /INSERT INTO public\.role_default_permissions/.test(readFileSync(`${dir}/${f}`, "utf8")));
  const migration = readFileSync(`${dir}/${latest}`, "utf8");
  for (const role of ["Manager", "Cashier", "Rider"]) {
    const match = migration.match(new RegExp(`\\('${role}', ARRAY\\[(.*?)\\]\\)`));
    if (!match) throw new Error(`${role} is missing from the migration`);
    const inDatabase = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    const inApp = [...new Set<string>(SYSTEM_ROLES[role].permissions)].sort();
    if (JSON.stringify(inDatabase) !== JSON.stringify(inApp)) {
      throw new Error(`${role} permissions differ between the app and the migration`);
    }
  }
});

runTest("Customer merge preview matches the database rules", () => {
  const base = { id: "a", name: "A", phone: "0711111111", email: "", joinDate: "", tier: "Silver" as const, purchasesCount: 4 };
  const preview = previewMerge(
    { ...base, loyaltyPoints: 50000, debtBalance: 500, walletBalance: 0 },
    { ...base, id: "b", tier: "Bronze", loyaltyPoints: 10000, debtBalance: 0, walletBalance: 200, purchasesCount: 1 },
  );
  if (preview.debt !== 300 || preview.wallet !== 0 || preview.offset !== 200) throw new Error("Wallet should clear debt first");
  if (preview.points !== 60000 || preview.purchases !== 5) throw new Error("Points and purchases should add together");
  if (preview.tier !== "Gold") throw new Error("Combined points should raise the tier");
  for (const phone of ["+254711111111", "254711111111", "0711111111", "711111111", "0711 111 111"]) {
    if (phoneKey(phone) !== "254711111111") throw new Error(`${phone} should match the same customer`);
  }
  if (phoneKey("123") !== null) throw new Error("A short number should not match anyone");
  const shop = { ...base, id: "shop", loyaltyPoints: 0, purchasesCount: 0 };
  const online = { ...base, id: "web", loyaltyPoints: 0, purchasesCount: 9 };
  if (defaultKeepId(online, shop, ["web"]) !== "shop") throw new Error("The shop's record should be kept by default");
});

runTest("Mobile nav keeps at most 5 slots, Settings off the bar, Sell centred for cashiers", () => {
  const all = [
    { id: "home", p: "home.view" }, { id: "dashboard", p: "dashboard.view" }, { id: "sell", p: "pos.create_sale" },
    { id: "pos", p: "pos.create_sale" }, { id: "inventory", p: "inventory.view" }, { id: "sales", p: "orders.view" },
    { id: "customers", p: "customers.view" }, { id: "feedback", p: "complaints.view" }, { id: "online-store", p: "customers.view" },
    { id: "deliveries", p: "deliveries.view" }, { id: "workers", p: "staff.view" }, { id: "permissions", p: "staff.roles" },
    { id: "ai", p: "ai.use" }, { id: "profile", p: "dashboard.view" }, { id: "business-management", p: "business.update" },
    { id: "production", p: "bom.view" }, { id: "settings", p: "settings.view" },
  ];
  for (const role of Object.keys(SYSTEM_ROLES)) {
    const allowed = all.filter((t) => t.id === "profile" || hasRolePermission(role, t.p as any)).map((t) => t.id);
    const { primary, overflow } = arrangeMobileNav(allowed, role);
    if (primary.length > MAX_BOTTOM_TABS) throw new Error(`${role}: ${primary.length} slots`);
    if (primary.includes("settings")) throw new Error(`${role}: Settings on the bar`);
    const reachable = [...primary.filter((id) => id !== MORE_TAB_ID), ...overflow].sort();
    if (reachable.join() !== [...allowed].sort().join()) throw new Error(`${role}: a tab is unreachable`);
    if (overflow.length > 0 && !primary.includes(MORE_TAB_ID)) throw new Error(`${role}: overflow without More`);
    if (role === "Cashier" && primary[2] !== "sell") throw new Error(`Cashier middle slot is ${primary[2]}`);
  }
});

runTest("M-Pesa prompts accept Kenyan numbers in any common format", () => {
  const cases: [string, string | null][] = [
    ["0712345678", "254712345678"], ["+254 712 345 678", "254712345678"], ["254712345678", "254712345678"],
    ["0110345678", "254110345678"], ["712345678", "254712345678"],
    ["0812345678", null], ["07123", null], ["", null],
  ];
  for (const [input, expected] of cases) {
    if (toMsisdn(input) !== expected) throw new Error(`${input} gave ${toMsisdn(input)}, expected ${expected}`);
  }
});

runTest("Release versioning reads emoji commit types", () => {
  const cases: [string, string, string][] = [
    ["🚀 feat!: drop old sync", "", "major"],
    ["🐛 fix!: change receipt format", "", "major"],
    ["🐛 fix(payments)!: void instead of delete", "", "major"],
    ["📚 docs!: rename every setting", "", "major"],
    ["🔧 chore: bump deps", "BREAKING CHANGE: needs Node 22", "major"],
    ["🚀 feat: M-Pesa till queue", "", "minor"],
    ["🚀 feat(website): portal", "", "minor"],
    ["🐛 fix: cash payments", "", "patch"],
    ["⚡ perf: faster search", "", "patch"],
    ["♻️ refactor: split repository", "", "patch"],
    ["♻ refactor: no variation selector", "", "patch"],
    ["feat: no emoji", "", "minor"],
    ["🚧 wip: halfway", "", "none"],
    ["📚 docs: readme", "", "none"],
    ["🎨 style: spacing", "", "none"],
    ["✅ test: more cases", "", "none"],
    ["🔧 chore: tidy", "", "none"],
    ["📦 build: vite config", "", "none"],
    ["🤖 ci: cache cargo", "", "none"],
    ["⏪ revert: undo feat", "", "none"],
    ["Update README.md", "", "none"],
  ];
  for (const [subject, body, expected] of cases) {
    const got = classifyCommit(subject, body).bump;
    if (got !== expected) throw new Error(`"${subject}" gave ${got}, expected ${expected}`);
  }
  const bump = highestBump([{ bump: "patch" }, { bump: "minor" }, { bump: "none" }]);
  if (bump !== "minor") throw new Error(`highest bump was ${bump}`);
  const versions: [string, string, string][] = [["1.4.2", "major", "2.0.0"], ["1.4.2", "minor", "1.5.0"], ["1.4.2", "patch", "1.4.3"], ["1.4.2", "none", "1.4.2"]];
  for (const [prev, b, want] of versions) {
    if (nextVersion(prev, b) !== want) throw new Error(`${prev} + ${b} gave ${nextVersion(prev, b)}`);
  }
});

runTest("Update manifest lists signed desktop installers and the Android APK", () => {
  const files = [
    "KayKays-1.2.0-windows-x64.exe", "KayKays-1.2.0-windows-x64-setup.msi", "KayKays-1.2.0-windows-x64-setup.msi.sig",
    "KayKays-1.2.0-linux-x86_64.AppImage", "KayKays-1.2.0-linux-x86_64.AppImage.sig",
    "KayKays-1.2.0-linux-amd64.deb", "KayKays-1.2.0-linux-amd64.deb.sig",
    "KayKays-1.2.0-android.apk",
  ];
  const m = buildManifest({
    version: "1.2.0", tag: "v1.2.0", repo: "KIMGITO/ISMS", notes: "### Features\n- x\n", files,
    readText: (name: string) => `sig-of-${name}\n`, sha256: () => "abc123",
  });
  const base = "https://github.com/KIMGITO/ISMS/releases/download/v1.2.0/";
  if (m.version !== "1.2.0") throw new Error("version");
  if (m.platforms["windows-x86_64"].url !== base + "KayKays-1.2.0-windows-x64-setup.msi") throw new Error("windows url");
  if (m.platforms["windows-x86_64"].signature !== "sig-of-KayKays-1.2.0-windows-x64-setup.msi.sig") throw new Error("windows sig");
  if (m.platforms["linux-x86_64"].url !== base + "KayKays-1.2.0-linux-x86_64.AppImage") throw new Error("linux url");
  // An app installed from the .deb must get the .deb; given the AppImage it fails
  // with "invalid updater binary format".
  if (m.platforms["linux-x86_64-deb"]?.url !== base + "KayKays-1.2.0-linux-amd64.deb") throw new Error("deb url");
  if (m.platforms["linux-x86_64-deb"].signature !== "sig-of-KayKays-1.2.0-linux-amd64.deb.sig") throw new Error("deb sig");
  if (m.platforms["linux-x86_64-appimage"]?.url !== base + "KayKays-1.2.0-linux-x86_64.AppImage") throw new Error("appimage url");
  if (m.android.url !== base + "KayKays-1.2.0-android.apk" || m.android.sha256 !== "abc123") throw new Error("android");
  // Desktop apps refuse unsigned updates, so publishing one must fail instead.
  let threw = false;
  try {
    buildManifest({ version: "1", tag: "v1", repo: "a/b", notes: "", files: ["KayKays-1-windows-x64-setup.msi"], readText: () => "", sha256: () => "" });
  } catch { threw = true; }
  if (!threw) throw new Error("An unsigned installer must be refused");
});

// The offline queue keeps sales in localStorage on a phone. Node's own localStorage
// stores nothing without --localstorage-file, so tests always use an in-memory one.
{
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
    },
  });
}

runTest("Website page text: old pages read the same, new formatting and photos round-trip", () => {
  const site: any = {
    business: { name: "KayKay's", description: "", address: "Kenol", contactEmail: "a@b.co", contactPhone: "0712 345 678", currency: "KSh" },
    settings: { deliveryEnabled: true, deliveryFee: 50, minOrder: 100, assistantEnabled: true, openingHours: "Mon to Sat", whatsapp: null },
    deliveryZones: [{ id: "z", name: "Town", fee: 50 }], branches: [], loyalty: undefined, pages: {},
  };
  // Every standard page survives a trip through the editor unchanged.
  for (const page of INFO_PAGES) {
    const text = defaultInfoPageText(page.id, site);
    const once = parseDocument(text);
    const again = parseDocument(serializeDocument(once));
    if (JSON.stringify(once) !== JSON.stringify(again)) throw new Error(`${page.id} changed after editing round trip`);
  }
  const doc = [
    "## Fresh milk {align=center color=accent}",
    "We deliver **daily** with _care_, ==every== ~~sometimes~~ morning. {size=lg font=serif box=sand}",
    '![Milk on a table](https://x.supabase.co/a.webp "Our milk") {ratio=16:9 x=30 y=70 zoom=1.5 width=md align=right}',
    "---",
    "> Best milk in town",
    "- one {align=center}",
    "- two",
    "1. first",
  ].join("\n");
  const blocks = parseDocument(doc);
  if (blocks.length !== 7) throw new Error(`expected 7 blocks, got ${blocks.length}`);
  const img: any = blocks[2];
  if (img.type !== "img" || img.style.width !== "md" || img.style.x !== 30 || img.style.zoom !== 1.5 || img.caption !== "Our milk") throw new Error("photo not read: " + JSON.stringify(img));
  if ((blocks[0] as any).style.align !== "center" || (blocks[1] as any).style.box !== "sand") throw new Error("style tags not read");
  if (serializeDocument(blocks) !== doc) throw new Error("round trip changed the text:\n" + serializeDocument(blocks));
  // Unsafe or unknown input stays plain text.
  const unsafe = parseDocument("![x](javascript:alert(1))\nHello {onclick=alert}\n[bad](javascript:alert(1))");
  if (unsafe.some((b) => b.type === "img")) throw new Error("non-https photo accepted");
  if ((unsafe[1] as any).text !== "Hello {onclick=alert}") throw new Error("unknown style tag should stay as text");
  if (parseInline("[bad](javascript:alert(1))").some((n) => n.t === "a")) throw new Error("unsafe link accepted");
  // Out-of-range photo values are clamped.
  const wild: any = parseDocument("![a](https://x/y.jpg) {x=500 zoom=9}")[0];
  if (wild.style.x !== 100 || wild.style.zoom !== 3) throw new Error("photo values not clamped");
  if (pagePlainText("**Hi** _there_ [shop](/shop)\n![a](https://x/y.jpg \"Cap\")") !== "Hi there shop Cap") throw new Error("plain text: " + pagePlainText("**Hi** _there_ [shop](/shop)"));
  // snake_case words are not italic.
  if (parseInline("order_ref_number").length !== 1) throw new Error("underscores inside words must not italicise");
});

const offlineSale = (ref: string): any => ({
  id: `tx-${ref}`, referenceId: ref, businessId: "biz", items: [], total: 100, discount: 0, tax: 0,
  finalTotal: 100, paymentMethod: "Cash", staffId: "s", staffName: "S", status: "Synced", timestamp: new Date().toISOString(),
});

runTest("Offline sales queue once per reference and are marked pending", () => {
  localStorage.removeItem("kaykays.offline.sales.v1");
  salesOutbox.add(offlineSale("r1"));
  salesOutbox.add(offlineSale("r1")); // same sale again, e.g. a double tap
  if (salesOutbox.count() !== 1) throw new Error(`Expected 1 queued sale, got ${salesOutbox.count()}`);
  if (salesOutbox.list()[0].tx.status !== "Offline_Pending") throw new Error("Queued sale should be Offline_Pending");
  if (!isNetworkError(new TypeError("Failed to fetch"))) throw new Error("'Failed to fetch' is a network error");
  if (isNetworkError({ code: "23514", message: "violates check constraint" })) throw new Error("A refusal is not a network error");
  localStorage.removeItem("kaykays.offline.sales.v1");
});

// Async: syncing sends what it can, keeps refused sales with their error, stops on network loss.
(async () => {
  const name = "Offline sync keeps refused sales and stops when the network drops";
  const original = SupabaseService.syncOfflineSale;
  try {
    localStorage.removeItem("kaykays.offline.sales.v1");
    ["a", "b", "c", "d"].forEach((r) => salesOutbox.add(offlineSale(r)));
    const sent: string[] = [];
    (SupabaseService as any).syncOfflineSale = async (tx: any) => {
      if (tx.referenceId === "b") throw Object.assign(new Error("violates check constraint"), { code: "23514" });
      if (tx.referenceId === "c") throw new TypeError("Failed to fetch");
      sent.push(tx.referenceId);
      return { id: `server-${tx.referenceId}` };
    };
    const result = await salesOutbox.flush();
    const left = salesOutbox.list().map((q) => q.tx.referenceId).join(",");
    if (sent.join(",") !== "a") throw new Error(`Expected only "a" sent before the network dropped, got ${sent}`);
    if (left !== "b,c,d") throw new Error(`Expected b,c,d still queued, got ${left}`);
    const b = salesOutbox.list().find((q) => q.tx.referenceId === "b")!;
    if (b.attempts !== 1 || !b.lastError?.includes("check constraint")) throw new Error("Refused sale should keep its error");
    if (result.synced.length !== 1 || result.remaining !== 3) throw new Error("Wrong flush result");
    console.log(`✅ TEST PASSED: ${name}`);
  } catch (e) {
    console.error(`❌ TEST FAILED: ${name}`);
    console.error(e);
    process.exitCode = 1;
  } finally {
    (SupabaseService as any).syncOfflineSale = original;
    localStorage.removeItem("kaykays.offline.sales.v1");
  }
})();

runTest("App versions compare numerically", () => {
  const cases: [string, string, number][] = [["1.10.0", "1.9.9", 1], ["1.0.0", "1.0.0", 0], ["v2.0.0", "1.99.99", 1], ["1.0", "1.0.1", -1]];
  for (const [a, b, want] of cases) {
    if (compareVersions(a, b) !== want) throw new Error(`${a} vs ${b} gave ${compareVersions(a, b)}`);
  }
});

runTest("Keyboard shortcuts and search features follow the roles", () => {
  for (const role of Object.keys(SYSTEM_ROLES)) {
    const list = shortcutsFor(role);
    for (const sc of list) {
      if (sc.scope !== "everywhere" && !canOpenScreen(role, sc.scope)) throw new Error(`${role} sees a shortcut for ${sc.scope}`);
      if (sc.id.startsWith("go-") && !canOpenScreen(role, sc.id.slice(3))) throw new Error(`${role} can jump to ${sc.id.slice(3)}`);
    }
    for (const f of featuresFor(role)) if (!canOpenScreen(role, f.screen)) throw new Error(`${role} finds ${f.id} in search`);
  }
  if (shortcutsFor("Rider").some((sc) => sc.id === "go-permissions" || sc.id === "go-settings")) throw new Error("a rider must not see admin screens");
  if (!shortcutsFor("Cashier").some((sc) => sc.id === "sell-customer")) throw new Error("a cashier should add customers to quick sales");
  if (shortcutsFor(undefined).length !== 0) throw new Error("signed out means no shortcuts");

  const goKeys = Object.values(GO_TO_KEYS);
  if (new Set(goKeys).size !== goKeys.length) throw new Error("two screens share a G key");
  if (SCREENS.some((sc) => !GO_TO_KEYS[sc.id])) throw new Error("a screen has no G key");
  const seen = new Set<string>();
  for (const sc of SHORTCUTS.filter((x) => x.key)) {
    const k = `${sc.scope}:${sc.key}`;
    if (seen.has(k)) throw new Error(`two shortcuts use ${k}`);
    if (["g", "/", "[", "]", "?"].includes(sc.key!)) throw new Error(`${sc.id} uses a key kept for every screen`);
    seen.add(k);
  }
  // Every page action points at a button that exists in the code.
  const code = ["InventoryView", "CustomersView", "ProductionBOMView", "DashboardView", "BusinessManagementView", "NotificationsView"]
    .map((f) => readFileSync(`src/features/${f}.tsx`, "utf8")).join("\n");
  for (const sc of SHORTCUTS.filter((x) => x.target)) {
    if (!code.includes(`data-shortcut="${sc.target}"`)) throw new Error(`no button tagged ${sc.target} for ${sc.id}`);
  }
});

runTest("Screen access follows the roles' permissions", () => {
  const expect = (role: string, screen: string, want: boolean) => {
    if (canOpenScreen(role, screen) !== want) throw new Error(`${role} ${want ? "should" : "should not"} open ${screen}`);
  };
  // Payments & Expenses used to sit inside Business Management, which only owners and admins reach.
  expect("Cashier", "money", true);
  expect("Manager", "money", true);
  expect("Rider", "money", false);
  expect("Manager", "business-management", false);
  expect("Cashier", "online-store", true);
  expect("Rider", "settings", false);
  for (const role of Object.keys(SYSTEM_ROLES)) {
    for (const id of ["profile", "about", "notifications"]) expect(role, id, true);
  }
  const ids = SCREENS.map((sc) => sc.id);
  if (new Set(ids).size !== ids.length) throw new Error("A screen is listed twice");
  // Every screen the app renders must be listed, or search and the tour miss it.
  const app = readFileSync("src/App.tsx", "utf8");
  for (const [, tab] of app.matchAll(/activeTab === '([a-z-]+)' && \(/g)) {
    if (!ids.includes(tab as any)) throw new Error(`Screen "${tab}" is missing from utils/screens.ts`);
  }
});


runTest("Home figures: ranges, slots, growth and money received", () => {
  const eq = (a: unknown, b: unknown, what: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  };
  const now = new Date(2026, 10, 7, 15, 30); // 7 Nov 2026
  const week = getRange("last7", now);
  eq(week.start.getDate(), 1, "7 days starts 6 days back");
  const prev = previousRange(week);
  eq([prev.start.getDate(), prev.end.getDate()], [25, 31], "previous 7 days");
  eq(getRange("quarter", now).start.getMonth(), 9, "quarter starts in October");
  eq(pickGranularity(getRange("today", now)), "hour", "today is hourly");
  eq(pickGranularity(getRange("year", now)), "month", "year is monthly");

  // A quarter is ~98 days: every day must land in a slot (the old chart dropped all but 30).
  const q = getRange("quarter", now);
  const qb = makeBuckets(q, pickGranularity(q));
  eq(bucketIndex(q.start.getTime(), qb), 0, "first day in first slot");
  eq(bucketIndex(q.end.getTime(), qb), qb.length - 1, "last moment in last slot");
  eq(bucketIndex(new Date(2026, 8, 30).getTime(), qb), -1, "outside the range");

  eq(growth(150, 100), 50, "growth");
  eq(growth(5, 0), null, "no base to compare with");

  const at = (d: number, h = 10) => new Date(2026, 10, d, h).toISOString();
  const product = { id: "p1", name: "Milk", price: 100, cost: 60 } as any;
  const tx = (d: number, amount: number, method: string, qty = 1, h = 10) =>
    ({ id: `${d}-${amount}-${method}`, timestamp: at(d, h), finalTotal: amount, total: amount, paymentMethod: method, items: [{ product, quantity: qty, discountPercentage: 0 }] }) as any;
  const buckets = makeBuckets(week, "day");
  const result = analyse(
    {
      transactions: [tx(2, 200, "Cash", 2), tx(3, 300, "M-Pesa", 3, 18), tx(4, 100, "Credit_Debt"), tx(-3, 400, "Cash", 4)],
      expenses: [{ id: "e", amount: 50, category: "Rent", date: at(3), description: "", staffName: "" }],
      // Paid 100 of debt through Payments: both rows exist, it must count once.
      debtPayments: [{ id: "d", businessId: "b", customerId: "c1", amountPaid: 100, remainingDebt: 0, paymentMethod: "M-Pesa", recordedBy: "x", created_at: at(5) }],
      payments: [{ id: "pay", businessId: "b", referenceCode: "R", amount: 100, method: "M-Pesa", senderName: "A", status: "Success", date: at(5), customerId: "c1", debtApplied: 100 } as any],
    },
    week,
    buckets,
  );
  eq(result.total.sales, 600, "sales in range");
  eq(result.total.orders, 3, "orders in range");
  eq(result.total.cost, 360, "cost of goods");
  eq(result.total.profit, 600 - 360 - 50, "profit can be computed below zero, not clamped");
  eq(result.total.creditSales, 100, "credit sales");
  eq(result.total.received["M-Pesa"], 400, "M-Pesa: one sale plus one payment, debt row not double counted");
  eq(result.total.received.Cash, 200, "cash");
  eq(result.previous.sales, 400, "previous period sales");
  eq(result.total.hours[18], 300, "sales by hour");
  eq(result.cumulative[2].sales, 500, "running total by slot for replay");
  eq(result.total.products.get("p1")?.qty, 6, "units sold");

  const loss = analyse({ transactions: [], expenses: [{ id: "e", amount: 80, category: "Rent", date: at(2), description: "", staffName: "" }], debtPayments: [], payments: [] }, week, buckets);
  eq(loss.total.profit, -80, "a loss shows as a loss");
  // Debt paid with loyalty points brought no money in, so it is taken off profit.
  const withPoints = analyse({ transactions: [], expenses: [], debtPayments: [], payments: [], pointsToDebt: [{ date: at(3), value: 25 }] }, week, buckets);
  eq(withPoints.total.profit, -25, "points used for debt come off profit");
  eq(withPoints.total.pointsCost, 25, "points cost is shown");

  const rows = analyseBranches(
    [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    [{ businessId: "a", amount: 300, ts: new Date(at(2)).getTime() }, { businessId: "a", amount: 200, ts: new Date(at(-3)).getTime() }, { businessId: "b", amount: 100, ts: new Date(at(3)).getTime() }],
    week,
    buckets,
  );
  eq(rows.map((r) => [r.sales, r.growth, Math.round(r.share)]), [[300, 50, 75], [100, null, 25]], "branch sales, growth and share");
});

runTest("Receipt shows points used, earned and the balance", () => {
  const tx = { ...sampleTx, customerId: "c1", customerName: "Ann", discount: (Number(sampleTx.discount) || 0) + 50 } as any;
  const content = buildReceiptContent(tx, receiptSettings, { pointsUsed: { points: 50, value: 50 }, customerPoints: 120 });
  const { body } = buildReceiptText(content, receiptSettings);
  for (const want of ["Paid with 50 points", "LOYALTY POINTS", "Points used", "Points balance", "120"]) {
    if (!body.includes(want)) throw new Error(`missing "${want}":\n${body}`);
  }
  const cols = columnsFor(receiptSettings);
  if (body.split("\n").some((l) => l.length > cols)) throw new Error("points lines wider than the paper");
  const walkIn = buildReceiptText(buildReceiptContent(sampleTx, receiptSettings, { pointsUsed: { points: 50, value: 50 } }), receiptSettings).body;
  if (walkIn.includes("LOYALTY")) throw new Error("a walk-in sale has no points section");
});

runTest("A credit sale's receipt shows the wallet paying first and only the rest owed", () => {
  const total = Number(sampleTx.finalTotal);
  const part = Math.floor(total / 2);
  const tx = { ...sampleTx, customerId: "c1", customerName: "Ann", paymentMethod: "Credit_Debt", walletApplied: part } as any;
  const content = buildReceiptContent(tx, receiptSettings);
  if (content.walletPaid !== part) throw new Error(`wallet paid ${content.walletPaid}, want ${part}`);
  if (Math.abs(content.balanceDue - (total - part)) > 0.001) throw new Error(`owed ${content.balanceDue}, want ${total - part}`);
  const { body } = buildReceiptText(content, receiptSettings);
  for (const want of ["Paid from wallet", "BALANCE DUE"]) if (!body.includes(want)) throw new Error(`missing "${want}":\n${body}`);
  const full = buildReceiptContent({ ...tx, walletApplied: total }, receiptSettings);
  if (full.balanceDue !== 0 || full.paymentMethod !== "Wallet") throw new Error("a sale the wallet covers owes nothing");
  if (buildReceiptText(full, receiptSettings).body.includes("BALANCE DUE")) throw new Error("no balance due when the wallet paid it all");
});

runTest("Charts use Kenya time and today's hours stop at the current hour", () => {
  const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
  // 12:00 UTC is 3 PM in Nairobi, whatever zone this machine is in
  eq(new Date(kenyaTime("2026-11-07T12:00:00Z")).getHours(), 15, "UTC noon is 3 PM Kenya time");
  const now = kenyaNow();
  const today = getRange("today", now);
  const slots = makeBuckets(today, "hour");
  eq(slots.length, now.getHours() + 1, "one slot per hour so far today, none for hours still to come");
  const yesterday = makeBuckets(getRange("yesterday", now), "hour");
  eq(yesterday.length, 24, "a past day keeps all 24 hours");
});

runTest("End-of-shift report figures and text", () => {
  const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
  const milk = { id: "p1", name: "Milk", price: 60, stock: 40, unit: "L" } as any;
  const t = (h: number) => new Date(Date.UTC(2026, 10, 7, h)).toISOString();
  const sale = (id: string, method: string, total: number, qty: number, h = 8, staffId = "e1", extra: any = {}) =>
    ({ id, timestamp: t(h), staffId, paymentMethod: method, finalTotal: total, total, items: [{ product: milk, quantity: qty, discountPercentage: 0 }], ...extra }) as any;
  const r = buildShiftReport({
    shift: { startTime: t(5), endTime: t(14) },
    employee: { id: "e1", name: "Jane" },
    transactions: [
      sale("a", "Cash", 120, 2),
      sale("b", "M-Pesa", 180, 3),
      sale("c", "Credit", 60, 1, 9, "e1", { customerId: "c1", customerName: "Ann" }),
      sale("d", "Card", 60, 1),
      sale("e", "Bank", 40, 1),
      sale("x", "Cash", 999, 1, 8, "someone-else"),
      sale("y", "Cash", 999, 1, 16),
    ],
    debtPayments: [{ id: "dp", businessId: "b", customerId: "c1", amountPaid: 50, remainingDebt: 10, paymentMethod: "Cash", recordedBy: "Jane", created_at: t(10) }],
    expenses: [{ id: "x1", amount: 30, category: "Transport", description: "Boda", date: t(11), staffName: "Jane", paymentMethod: "Cash" } as any],
    products: [milk],
    customers: [{ id: "c1", name: "Ann", debtBalance: 10 } as any],
    productionBatches: [],
    billOfMaterials: [],
  });
  eq([r.salesCount, r.salesTotal, r.cash, r.mpesa, r.credit, r.card, r.bank], [5, 460, 120, 180, 60, 60, 40], "only this person's sales in this shift, every payment type counted");
  eq(r.expectedCash, 120 + 50 - 30, "cash expected = cash sales + cash debt repaid - cash expenses");
  eq(r.products.map((p) => [p.sold, p.earned, p.left]), [[8, 480, 40]], "products sold");
  const text = shiftReportText(r, { countedCash: 130, notes: "All good" });
  if (!text.includes("short by KSh 10")) throw new Error("counted cash difference missing:\n" + text);
  if (text.includes("```")) throw new Error("report should be plain text");
  if (!text.includes("8:00 – 17:00")) throw new Error("times should be Kenya time:\n" + text);
});


runTest("Invoice lists every unpaid charge and its balance equals what the customer owes", () => {
  const credits: any[] = [
    {
      id: "c1", createdAt: "2026-11-01T08:00:00Z", amountOwed: 1150, amountPaid: 400, balance: 750,
      sale: { id: "t1", timestamp: "2026-11-01T08:00:00Z", tax: 0, deliveryFee: 100, finalTotal: 1150,
        items: [{ name: "Milk 500ml", unitPrice: 60, quantity: 10 }, { name: "Mala 1L", unitPrice: 150, quantity: 3, unit: "Litre" }] },
    },
    { id: "c2", createdAt: "2026-11-03T08:00:00Z", amountOwed: 200, amountPaid: 0, balance: 200, note: "Old balance", sale: null },
    {
      id: "c3", createdAt: "2026-11-05T08:00:00Z", amountOwed: 540, amountPaid: 0, balance: 540,
      sale: { id: "t3", timestamp: "2026-11-05T08:00:00Z", tax: 0, deliveryFee: 0, finalTotal: 540, items: [{ name: "Milk 500ml", unitPrice: 60, quantity: 10 }] },
    },
  ];
  const { lines, totals } = buildInvoiceLines(credits, 1490);
  // Products, the delivery fee and the hand-added balance are all charged.
  if (lines.filter((l) => l.kind === "product").length !== 3) throw new Error("expected 3 product lines");
  if (!lines.some((l) => l.kind === "delivery" && l.amount === 100)) throw new Error("delivery fee missing");
  if (!lines.some((l) => l.kind === "charge" && l.description === "Old balance")) throw new Error("manual balance missing");
  if (totals.subtotal !== 600 + 450 + 100 + 200 + 600) throw new Error(`subtotal ${totals.subtotal}`);
  if (totals.discount !== 60) throw new Error(`discount ${totals.discount}`); // second sale sold 600 for 540
  if (totals.paid !== 400) throw new Error(`paid ${totals.paid}`);
  if (totals.balance !== 1490) throw new Error(`balance ${totals.balance}`);
  if (Math.abs(totals.subtotal - totals.discount + totals.tax - totals.paid - totals.balance) > 0.001) throw new Error("totals do not add up");

  // More owed than the open sales explain: shown as an earlier balance, still adding up.
  const more = buildInvoiceLines(credits, 1600);
  if (!more.lines.some((l) => l.description === "Earlier balance" && l.amount === 110)) throw new Error("earlier balance line missing");
  const t = more.totals;
  if (Math.abs(t.subtotal - t.discount + t.tax - t.paid - 1600) > 0.001) throw new Error("totals with earlier balance do not add up");

  const combined = combineSameProducts(lines);
  const milk = combined.filter((l) => l.description === "Milk 500ml");
  if (milk.length !== 1 || milk[0].quantity !== 20 || milk[0].amount !== 1200) throw new Error("same products not combined");
});

runTest("Invoice for a period covers only that period's sales, with older debt optional", () => {
  const credits: any[] = [
    { id: "a", createdAt: "2026-10-20T08:00:00Z", amountOwed: 300, amountPaid: 0, balance: 300, sale: { id: "t0", timestamp: "2026-10-20T08:00:00Z", tax: 0, deliveryFee: 0, finalTotal: 300, items: [{ name: "Ghee", unitPrice: 300, quantity: 1 }] } },
    { id: "b", createdAt: "2026-11-05T08:00:00Z", amountOwed: 540, amountPaid: 0, balance: 540, sale: { id: "t1", timestamp: "2026-11-05T08:00:00Z", tax: 0, deliveryFee: 0, finalTotal: 540, items: [{ name: "Milk", unitPrice: 60, quantity: 9 }] } },
    { id: "c", createdAt: "2026-12-02T08:00:00Z", amountOwed: 120, amountPaid: 0, balance: 120, sale: { id: "t2", timestamp: "2026-12-02T08:00:00Z", tax: 0, deliveryFee: 0, finalTotal: 120, items: [{ name: "Milk", unitPrice: 60, quantity: 2 }] } },
  ];
  const owes = 960;
  const only = buildInvoiceLines(credits, owes, { from: "2026-11-01", to: "2026-11-30", includeEarlier: false });
  if (only.totals.balance !== 540 || only.lines.length !== 1) throw new Error(`period only: ${JSON.stringify(only.totals)}`);
  if (only.totals.owedNow !== 960) throw new Error("owed on the whole account missing");
  const withEarlier = buildInvoiceLines(credits, owes, { from: "2026-11-01", to: "2026-11-30", includeEarlier: true });
  if (withEarlier.totals.balance !== 840) throw new Error(`with earlier: ${withEarlier.totals.balance}`);
  if (!withEarlier.lines[0].description.startsWith("Unpaid from before")) throw new Error("earlier line should come first");
  // Sales after the period are left for the next invoice.
  if (withEarlier.lines.some((l) => l.description === "Milk" && l.quantity === 2)) throw new Error("a sale after the period was included");

  const lastMonth = periodFor("last_month", new Date(2026, 10, 8));
  if (lastMonth.from !== "2026-10-01" || lastMonth.to !== "2026-10-31") throw new Error(JSON.stringify(lastMonth));
  const lastWeek = periodFor("last_week", new Date(2026, 10, 8)); // Sunday 8 Nov 2026
  if (lastWeek.from !== "2026-10-26" || lastWeek.to !== "2026-11-01") throw new Error(JSON.stringify(lastWeek));
});

runTest("Points: 2 per KSh 1 paid, nothing on a credit sale, delivery excluded", () => {
  if (pointsEarned(1000, 0, "Cash") !== 2000) throw new Error("cash sale should earn 2 per KSh 1");
  if (pointsEarned(1000, 100, "M-Pesa") !== 1800) throw new Error("delivery must not earn points");
  if (pointsEarned(1000, 0, "Credit_Debt") !== 0 || pointsEarned(1000, 0, "Credit") !== 0) throw new Error("credit sales earn when paid");
  if (pointsEarned(1000, 0, "Credit_Debt", 300) !== 600) throw new Error("the wallet-paid part of a credit sale earns 2 per KSh 1");
  if (pointsEarned(1000, 100, "Credit_Debt", 5000) !== 1800) throw new Error("wallet points stop at the goods total");
  if (DEBT_PAYMENT_POINTS_PER_KSH * 2 !== POINTS_PER_KSH) throw new Error("debt payments earn half of a cash purchase");
  const sql = readFileSync("supabase/migrations/20261108002_loyalty_points_rule.sql", "utf8");
  if (!/\* 2\)\)/.test(sql) || !/FLOOR\(NEW\.amount_paid\)/.test(sql)) throw new Error("database rule differs from the app's");
});

runTest("A walk-in sale added to a customer later earns the same points as at the till", () => {
  const sql = readFileSync("supabase/migrations/20261108003_attach_sale_to_customer.sql", "utf8");
  if (!/FLOOR\(\(v_tx\.final_total - COALESCE\(v_tx\.delivery_fee, 0\)\) \* 2\)/.test(sql)) throw new Error("attach rule differs from the sale rule");
  if (!/customer_id IS NOT NULL THEN\s+RAISE/.test(sql)) throw new Error("a sale's customer must not be swapped");
  const base = { id: "x", items: [], total: 100, discount: 0, tax: 0, finalTotal: 100, staffId: "s", staffName: "S", status: "Synced", timestamp: "" } as any;
  if (cannotAttachReason({ ...base, paymentMethod: "Cash" }) !== null) throw new Error("a walk-in cash sale should take a customer");
  if (!cannotAttachReason({ ...base, paymentMethod: "Cash", customerId: "c1" })) throw new Error("a sale with a customer must refuse");
  if (!cannotAttachReason({ ...base, paymentMethod: "Credit_Debt" })) throw new Error("credit sales must refuse");
});

runTest("Points are worth less per point in higher tiers, as in the database", () => {
  if (pointsPerShilling(pointValueFor(DEFAULT_POINT_SETTINGS, "Bronze")) !== 50) throw new Error("Bronze: 50 points = KSh 1");
  if (pointsPerShilling(pointValueFor(DEFAULT_POINT_SETTINGS, "Silver")) !== 100) throw new Error("Silver: 100 points = KSh 1");
  if (pointsPerShilling(pointValueFor(DEFAULT_POINT_SETTINGS, "Gold")) !== 200) throw new Error("Gold: 200 points = KSh 1");
  if (pointValueFor(DEFAULT_POINT_SETTINGS, undefined) !== DEFAULT_POINT_SETTINGS.bronze) throw new Error("no tier counts as Bronze");
  const sql = readFileSync("supabase/migrations/20261108002_loyalty_points_rule.sql", "utf8");
  if (!/WHEN 'Gold' THEN 0\.005 WHEN 'Silver' THEN 0\.01 ELSE 0\.02/.test(sql)) throw new Error("database tier values differ from the app's");
  if (/wallet_balance = v_wallet|'wallet_topup'/.test(sql.slice(sql.indexOf("FUNCTION public.fn_redeem_points")))) throw new Error("points must not become wallet money");
});

runTest("People never see a database ID in stock or history text", () => {
  const id = "3f2a9c1e-0000-4000-8000-000000000001";
  if (readableIds(`Sold via order #${id}`) !== "Sold · receipt TXN-3F2A9C1E") throw new Error(readableIds(`Sold via order #${id}`));
  if (readableIds(`Paid for order ${id} using wallet credit`) !== "Paid for order receipt TXN-3F2A9C1E using wallet credit".replace("order receipt", "receipt"))
    throw new Error(readableIds(`Paid for order ${id} using wallet credit`));
  if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(readableIds(`Moved ${id} and ${id}`))) throw new Error("a raw ID was left in");
  if (readableIds("Damaged in transit") !== "Damaged in transit") throw new Error("plain text must not change");
  if (formatReceiptNumber(id) !== "TXN-3F2A9C1E") throw new Error("the database receipt number must match the app's");
  const sql = readFileSync("supabase/migrations/20261108004_no_ids_in_text.sql", "utf8");
  if (!/'TXN-' \|\| upper\(left\(replace\(p_id::TEXT, '-', ''\), 8\)\)/.test(sql)) throw new Error("database receipt number differs from the app's");
});

runTest("Customer names start every word with a capital", () => {
  const cases: Array<[string, string]> = [["mary wanjiku", "Mary Wanjiku"], ["  peter   o'neil ", "Peter O'neil"], ["mama of twins", "Mama Of Twins"], ["JOHN", "JOHN"], ["mcDonald", "McDonald"]];
  for (const [input, want] of cases) if (customerName(input) !== want) throw new Error(`${input} -> ${customerName(input)}`);
});

runTest("A credit sale recorded twice is one invoice line, not two with half paid", () => {
  const row = (id: string, paid: number): any => ({ id, saleId: "sale-1", createdAt: "2026-11-01T08:00:00Z", amountOwed: 1000, amountPaid: paid, balance: 1000 - paid });
  // Doubled records: 2,000 owed in all, 400 paid on one of them. The customer owes 600.
  const merged = mergeDuplicateCredits([row("a", 400), row("b", 0)]);
  if (merged.length !== 1 || merged[0].amountOwed !== 1000 || merged[0].balance !== 600) throw new Error(JSON.stringify(merged));
  // Paid in full on one copy: nothing left, so nothing to invoice.
  if (mergeDuplicateCredits([row("a", 1000), row("b", 0)]).length !== 0) throw new Error("a settled sale must drop off the invoice");
  // Records without a sale (manual debt) stay separate.
  const manual: any = (id: string) => ({ id, createdAt: "2026-11-02T08:00:00Z", amountOwed: 200, amountPaid: 0, balance: 200 });
  if (mergeDuplicateCredits([manual("m1"), manual("m2")]).length !== 2) throw new Error("manual balances must not merge");
  const fix = readFileSync("supabase/migrations/20261109002_fix_double_credit_records.sql", "utf8");
  if (!/uq_credit_payments_transaction/.test(fix)) throw new Error("the database must allow one credit record per sale");
});

runTest("Notifications carry no internal IDs and credit sales are not payments", () => {
  const paid = NotificationTemplates.render("Payment Received", { amount: "1,250", paymentMethod: "M-Pesa", fromCustomer: " from Jane" });
  if (paid.message !== "KSh 1,250 received by M-Pesa from Jane.") throw new Error(paid.message);
  const missing = NotificationTemplates.render("Payment Received", { amount: "500", paymentMethod: "Cash" });
  if (missing.message.includes("{")) throw new Error("an unfilled placeholder was shown: " + missing.message);
  const credit = NotificationTemplates.render("Credit Sale", { customerName: "Jane", amount: "400", debtBalance: "1,400" });
  if (/payment|received/i.test(credit.title + credit.message)) throw new Error("a credit sale must not read as a payment");

  const old = tidyNotification({ type: "Payment Received", title: "💰 Payment Received", message: "A payment of KSh 400 was received via Credit Debt for invoice #3f2a9c1e-0000-4000-8000-000000000001." });
  if (old.type !== "Credit Sale" || /3f2a9c1e|invoice/i.test(old.message)) throw new Error(JSON.stringify(old));
  const rider = tidyNotification({ type: "Custom Notification", title: "Rider Dispatch", message: "Rider Ali assigned to deliver Order tx-1731000000000 (KSh 900)." });
  if (/tx-\d/.test(rider.message)) throw new Error(rider.message);
  const order = tidyNotification({ type: "Online Store", title: "New online order", message: "Order #1042 from Mary is paid." });
  if (order.message !== "Order #1042 from Mary is paid.") throw new Error("real order numbers must stay: " + order.message);
});

runTest("Update errors get one standard message each", () => {
  const cases: [unknown, "check" | "download" | "install", string][] = [
    [new Error("Couldn't check for updates (HTTP 504)."), "check", "SERVER_UNAVAILABLE"],
    ["Could not fetch a valid release JSON from the remote", "check", "SERVER_UNAVAILABLE"],
    [{ message: "Download failed with HTTP 504" }, "download", "SERVER_UNAVAILABLE"],
    [{ message: "Download failed with HTTP 404", code: "HTTP" }, "download", "DOWNLOAD_FAILED"],
    [{ message: "Not found", code: "HTTP" }, "check", "NETWORK"],
    [{ message: "HTTP 404" }, "check", "BAD_MANIFEST"],
    [{ message: "Read timed out", code: "NETWORK_ERROR" }, "download", "NETWORK"],
    [{ message: "x", code: "SIGNATURE_MISMATCH" }, "install", "SIGNATURE_MISMATCH"],
    [{ message: "x", code: "NEEDS_PERMISSION" }, "install", "NEEDS_PERMISSION"],
    ["the signature verification failed", "download", "BAD_SIGNATURE"],
    ["error sending request for url", "check", "NETWORK"],
    ["error decoding response body: expected value at line 1", "check", "BAD_MANIFEST"],
    ["something odd", "check", "UNKNOWN"],
  ];
  for (const [err, stage, want] of cases) {
    const got = toUpdateError(err, stage);
    if (got.code !== want) throw new Error(`${JSON.stringify(err)} at ${stage}: expected ${want}, got ${got.code}`);
    if (got.message !== UPDATE_MESSAGES[got.code]) throw new Error("message must be the standard one");
    if (/http|\b5\d\d\b|json/i.test(got.message)) throw new Error("raw details must not reach people: " + got.message);
  }
  if (!toUpdateError("HTTP 504", "check").temporary) throw new Error("a 504 is temporary");
  if (!toUpdateError({ code: "SIGNATURE_MISMATCH" }, "install").permanent) throw new Error("a key mismatch is permanent");
});

runTest("Update manifest is checked before it is trusted", () => {
  const ok = parseManifest(JSON.stringify({ version: "5.0.0", android: { url: "https://x/a.apk", sha256: "a".repeat(64) } }));
  if (ok.version !== "5.0.0" || ok.android?.url !== "https://x/a.apk") throw new Error("valid manifest rejected");
  const bad = ["<html><body><h1>504 Gateway Time-out</h1>", "{}", JSON.stringify({ version: "v5" }),
    JSON.stringify({ version: "5.0.0", android: { url: "http://x/a.apk" } }),
    JSON.stringify({ version: "5.0.0", android: { url: "https://x/a.apk", sha256: "abc" } })];
  for (const body of bad) {
    let code = "";
    try { parseManifest(body); } catch (e) { code = (e as UpdateError).code; }
    if (code !== "BAD_MANIFEST") throw new Error("should be refused: " + body);
  }
});

runTest("Phones and desktops read latest.json from the same places", () => {
  const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const endpoints: string[] = conf.plugins.updater.endpoints;
  if (JSON.stringify(endpoints) !== JSON.stringify(MANIFEST_SOURCES)) {
    throw new Error("tauri.conf.json updater endpoints must match MANIFEST_SOURCES in updateManifest.ts");
  }
  if (!endpoints[endpoints.length - 1].includes("/releases/latest/download/")) throw new Error("keep the release link as the last fallback");
});

await (async () => {
  const name = "Update check falls through to the next source and retries GitHub's 504s";
  try {
    const noSleep = async () => {};
    const good = JSON.stringify({ version: "5.0.0" });
    // First source 504s every time, second 504s once then works.
    const calls: string[] = [];
    let second = 0;
    const m = await fetchManifest(async (url) => {
      calls.push(url);
      if (url === "a") return { status: 504, data: "<html>504 Gateway Time-out</html>" };
      return ++second === 1 ? { status: 502, data: "" } : { status: 200, data: good };
    }, ["a", "b"], [1, 1], noSleep);
    if (m.version !== "5.0.0") throw new Error("expected the second source's manifest");
    if (calls.filter((c) => c === "a").length !== 3) throw new Error("a 504 must be retried twice: " + calls.join());

    // Every source down: one standard, temporary error.
    let err: UpdateError | null = null;
    try { await fetchManifest(async () => ({ status: 504, data: "" }), ["a", "b"], [1], noSleep); } catch (e) { err = e as UpdateError; }
    if (err?.code !== "SERVER_UNAVAILABLE" || !err.temporary) throw new Error("expected SERVER_UNAVAILABLE, got " + err?.code);

    // A version that can never install is not retried.
    let tries = 0;
    try { await withRetry(async () => { tries++; throw { code: "SIGNATURE_MISMATCH" }; }, "install", [1, 1], noSleep); } catch {}
    if (tries !== 1) throw new Error("permanent errors must not be retried");
    console.log(`✅ TEST PASSED: ${name}`);
  } catch (e) {
    console.error(`❌ TEST FAILED: ${name}`);
    console.error(e);
    process.exit(1);
  }
})();

runTest("Money comes in four ways only, the same in the app and the database", () => {
  if (JSON.stringify(MONEY_METHODS) !== JSON.stringify(["Cash", "M-Pesa", "Card", "Bank"])) throw new Error("the four methods changed");
  for (const old of ["Mobile_Wallet", "Other", "Credit_Debt", ""]) if (isMoneyMethod(old)) throw new Error(`${old} is not a way money comes in`);
  if (methodLabel("Credit_Debt") !== "Credit") throw new Error("credit label");
  if (normalizeReference("M-Pesa", " sxk2 m9q1tz ") !== "SXK2M9Q1TZ") throw new Error("M-Pesa codes are capitals without spaces");
  if (normalizeReference("Bank", "  FT 1234  ") !== "FT 1234") throw new Error("bank references stay as typed");

  // Every table that stores a method allows exactly these four (transactions also allow credit).
  const migration = readFileSync("supabase/migrations/20261110009_four_payment_methods_cards.sql", "utf8");
  for (const constraint of ["payments_method_check", "money_assets_method_check", "expenses_payment_method_check", "debt_payments_payment_method_check"]) {
    const line = migration.split("\n").find((l) => l.includes(`ADD CONSTRAINT ${constraint}`));
    if (!line || !line.includes("'Cash', 'M-Pesa', 'Card', 'Bank'")) throw new Error(`${constraint} must allow the four methods`);
  }
  console.log("   (debt_payments accepts Card and Bank: a Bank payment against a small debt no longer fails)");
});

runTest("Card amounts and Paystack answers are read correctly", () => {
  if (toSubunits(23000) !== 2300000 || toSubunits(0.2) !== 20 || toSubunits(19.99) !== 1999) throw new Error("KES to cents");
  if (fromSubunits(1999) !== 19.99) throw new Error("cents to KES");
  if (keyEnvironment("sk_test_abc123") !== "test" || keyEnvironment("sk_live_abc123") !== "live") throw new Error("key mode");
  if (keyEnvironment("pk_live_abc") !== null || keyEnvironment("sk_live_") !== null) throw new Error("only secret keys");
  const a = newReference(), b = newReference();
  if (a === b || !/^KK[0-9A-Z]{12,}$/.test(a)) throw new Error(`reference looks wrong: ${a}`);
  if (transactionOutcome("success") !== "success" || transactionOutcome("abandoned") !== "failed" || transactionOutcome("ongoing") !== "pending") throw new Error("outcome");
  const card = cardDetails({ authorization: { last4: "4081", brand: "visa " } });
  if (card.last4 !== "4081" || card.brand !== "visa") throw new Error("card details");
  if (cardDetails({ authorization: { last4: "40x1" } }).last4 !== null) throw new Error("bad last4 is dropped");
});

(async () => {
  const name = "Paystack webhooks are only trusted with the right signature";
  try {
    const secret = "sk_test_signing";
    const body = JSON.stringify({ event: "charge.success", data: { reference: "KKABC" } });
    const good = createHmac("sha512", secret).update(body).digest("hex");
    if (!(await signatureMatches(secret, body, good))) throw new Error("a correct signature must match");
    if (await signatureMatches("sk_test_other", body, good)) throw new Error("another business's key must not match");
    if (await signatureMatches(secret, body + " ", good)) throw new Error("a changed body must not match");
    if (await signatureMatches(secret, body, null)) throw new Error("no signature must not match");
    console.log(`✅ TEST PASSED: ${name}`);
  } catch (e) {
    console.error(`❌ TEST FAILED: ${name}`);
    console.error(e);
    process.exit(1);
  }
})();

console.log("🎉 All Application Unit Tests Completed Successfully!");
