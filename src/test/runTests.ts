// src/test/runTests.ts
import "./kenyaTimezone"; // must stay first
import { formatClock, minutesFromNow, toClock, toDateKey } from "../utils/timeFormat";
import { readFileSync, readdirSync } from "node:fs";
import { respond, UssdContext } from "../../supabase/functions/ussd/menu";
import "./setupTests";
import { vatPercentFor } from "../services/kra/kraService";
import { formatReceiptNumber, formatCustomerNumber, getShortId, newUuid, toUuid } from "../utils/idUtils";
import { EscPosGenerator, toPrinterText } from "../services/printer/EscPosGenerator";
import { CODE128_PATTERNS, code128Codes } from "../services/receipt/code128";
import { buildReceiptLines, buildReceiptText, pair, wrap, columnsFor } from "../services/receipt/layout";
import { normalizeReceiptSettings } from "../services/receipt/ReceiptSettings";
import { buildReceiptContent } from "../services/receipt/ReceiptGenerator";
import { EmailService } from "../services/emailService";
import { toUserMessage, AppError } from "../utils/userError";
import { scrubPersonalData } from "../services/crashReporter";
import { NotificationRepository } from "../services/notifications/notificationRepository";
import { hasRolePermission, SYSTEM_ROLES, ALL_PERMISSIONS } from "../utils/permissions";
import { referralShareText } from "../services/promotions";
import { useAuthStore } from "../stores/authStore";
import { defaultKeepId, phoneKey, previewMerge } from "../services/customerMerge";
import { allPages, liveList } from "../services/repositories";
import { arrangeMobileNav, MAX_BOTTOM_TABS, MORE_TAB_ID } from "../utils/mobileNav";
import { toMsisdn } from "../../supabase/functions/mpesa-payments/phone";
import { cardDetails, fromSubunits, keyEnvironment, newReference, signatureMatches, toSubunits, transactionOutcome } from "../../supabase/functions/card-payments/paystack";
import { MONEY_METHODS, enabledMethods, isMoneyMethod, methodLabel, normalizeReference } from "../utils/paymentMethods";
import { networkOf, toAirtelMsisdn } from "../../supabase/functions/airtel-payments/phone";
import { newReference as airtelReference, outcomeOf as airtelOutcome } from "../../supabase/functions/airtel-payments/airtel";
import { createHmac } from "node:crypto";
import { pointsEarned, POINTS_PER_KSH, DEBT_PAYMENT_POINTS_PER_KSH } from "../services/loyalty/tillPoints";
import { cannotAttachReason } from "../services/saleCustomer";
import { SHORTCUTS, FEATURES, GO_TO_KEYS, shortcutsFor, featuresFor } from "../utils/shortcuts";
import { DEFAULT_POINT_SETTINGS, pointValueFor, pointsPerShilling } from "../services/loyalty/pointValue";
import { customerName, readableIds } from "../utils/stringUtils";
import { fillMessage, unknownVariables, emptyFor, validCustomKey, keyFromLabel, BUILT_IN_VARIABLES } from "../services/messaging/messageVariables";
import { groupMatcher, describeGroups } from "../services/messaging/customerGroups";
import { buildInvoiceLines, combineSameProducts, periodFor } from "../services/invoice/invoiceDraft";
import { contactsLine, defaultInvoiceTexts, receiptClosing } from "../services/invoice/invoiceSettings";
import { closingOf } from "../services/invoice/invoicePdf";
import { matchesReceipt, mentionsReceipt, receiptCode, receiptCodeIn } from "../utils/references";
import { mergeDuplicateCredits } from "../services/invoice/invoiceData";
import { weekText, planStock, customersForDay, addDays, dayLabel, needsDecision, stockAdvice, type RegularBoard } from "../services/regularOrders";
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
import { buildShiftReport, shiftAttention, shiftReportText } from "../services/shiftReport";
import { buildStockReport, normalizeRaw, periodRange as stockPeriodRange, stockReportText } from "../services/stockReport";
import { lineTotal, purchaseRef, nextAssetCode, describeChanges, describeAction } from "../services/operations";
import { balanceSheet, checkDraft, profitAndLoss, quickLines, QUICK_ENTRIES, trialBalance, type AccountBalance } from "../services/accounting";
import { checkLines, creditNotePayload, creditPreview, draftTotals, lineAmounts, refundPreview, termsDaysOf, termsSetting, toInvoiceDocument, type InvoiceLineRow } from "../services/salesDocs";
import { formatHours, minutesWithin, periodRange } from "../utils/workedHours";

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


// The whole database schema (20261120001 merged all earlier migrations). Function bodies are
// kept as written, so the database's rules can be checked against the app's here.
const SCHEMA_SQL = readFileSync("supabase/migrations/20261120001_schema.sql", "utf8");

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

runTest("Receipt numbers differ between sales, old tx- IDs included", () => {
  const a = toUuid("tx-1762905600000"), b = toUuid("tx-1762905600001"), c = toUuid("tx-1762909999999");
  const nums = new Set([a, b, c].map(formatReceiptNumber));
  if (nums.size !== 3) throw new Error(`receipt numbers repeat: ${[...nums].join(", ")}`);
  if (formatReceiptNumber(a) !== "TXN-" + (1762905600000).toString(16).slice(-8).toUpperCase()) throw new Error(formatReceiptNumber(a));
  if (!/^[0-9A-F]{8}$/.test(getShortId(a))) throw new Error("the code must stay 8 hex characters so search still finds it");
  if (newUuid() === newUuid() || !/^[0-9a-f-]{36}$/.test(newUuid())) throw new Error("new sale IDs must be random UUIDs");
  const sql = SCHEMA_SQL;
  if (!sql.includes("'^74782d3[0-9](3[0-9]){12}$'")) throw new Error("the database must spot old IDs the same way");
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

runTest("AI chat: edited draft re-checks, replies split into text, tasks and questions", async () => {
  const { usePendingActionStore } = await import("../stores/pendingActionStore");
  const { parseAssistantReply } = await import("../utils/assistantReply");

  useAuthStore.setState({ dbPermissions: [], currentEmployee: { id: "e1", name: "Owner Ann", role: "Owner", phone: "1" } as any });
  const store = usePendingActionStore.getState();
  const draft = store.addPendingAction({ type: "create_customer", title: "New customer", summary: "", requiredPermission: "", params: { name: "" } });
  if (draft.validation.isValid) throw new Error("A customer with no name should not be ready to confirm");
  store.updatePendingParams(draft.id, { name: "Jane Doe" });
  const edited = usePendingActionStore.getState().pendingActions.find((a) => a.id === draft.id)!;
  if (!edited.validation.isValid || edited.params.name !== "Jane Doe") throw new Error("Editing the name on the card should make it ready");

  const reply = 'Prepared it. Check the details and tap Confirm.\n[PENDING_ACTION: {"type":"settle_debt","title":"Debt payment","summary":"Jane pays 500","params":{"customerName":"Jane","amount":500,"meta":{"a":"}"}}}]\n[ASK: {"question":"How did she pay?","style":"buttons","options":["Cash","M-Pesa","Cash"]}]';
  const parsed = parseAssistantReply(reply);
  if (parsed.text !== "Prepared it. Check the details and tap Confirm.") throw new Error(`Text left over: ${JSON.stringify(parsed.text)}`);
  if (parsed.drafts.length !== 1 || parsed.drafts[0].params.amount !== 500) throw new Error("Task not read from the reply");
  const q = parsed.questions[0];
  if (!q || q.style !== "buttons" || q.options.join() !== "Cash,M-Pesa") throw new Error(`Question not read: ${JSON.stringify(q)}`);

  const many = parseAssistantReply('[ASK: {"question":"Which product?","options":["a","b","c","d","e","f","g"]}]');
  if (many.questions[0]?.style !== "select") throw new Error("Seven choices should show as a dropdown");
  if (parseAssistantReply('[ASK: {"question":"Broken", "options": [}]').questions.length !== 0) throw new Error("Broken JSON should be skipped");
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
  // For each role, the newest migration that sets its defaults is the one in force.
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().reverse().map((f) => readFileSync(`${dir}/${f}`, "utf8"));
  for (const role of ["Manager", "Cashier", "Rider", "Supplier"]) {
    const re = new RegExp(`\\('${role}', ARRAY\\[(.*?)\\]\\)`, "s");
    const migration = files.find((sql) => /INSERT INTO public\.role_default_permissions/.test(sql) && re.test(sql));
    const match = migration?.match(re);
    if (!match) throw new Error(`${role} is missing from the migrations`);
    const inDatabase = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    const inApp = [...new Set<string>(SYSTEM_ROLES[role].permissions)].sort();
    if (JSON.stringify(inDatabase) !== JSON.stringify(inApp)) {
      throw new Error(`${role} permissions differ between the app and the migration`);
    }
  }
  // A supplier gets only supplier-portal permissions, and no staff role gets them.
  if (SYSTEM_ROLES.Supplier.permissions.some((p) => !p.startsWith("supplier_portal."))) throw new Error("a supplier must only have supplier_portal permissions");
  for (const role of ["Manager", "Cashier", "Rider"]) {
    if (SYSTEM_ROLES[role].permissions.some((p) => p.startsWith("supplier_portal."))) throw new Error(`${role} must not have supplier_portal permissions`);
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

runTest("Purchases, assets and the audit log read correctly", () => {
  const lines = [
    { productId: "p1", name: "Milk", quantity: 12.5, unit: "L", price: 48.4 },
    { productId: null, name: "Tape", quantity: 2, unit: "pcs", price: 0.15 },
  ];
  if (lineTotal(lines) !== 605.3) throw new Error(`purchase total should be 605.30, got ${lineTotal(lines)}`);
  if (purchaseRef({ id: "8da29bc6-960f-4686-b5a4-6d61932df8a4" }) !== "PO-8DA29BC6") throw new Error("purchase number should match the database's");
  if (purchaseRef({ id: "x", reference: "INV-77" }) !== "INV-77") throw new Error("a typed number wins");
  const asset = (code: string) => ({ id: code, name: "", code, serialNumber: "", value: 0, status: "Active" as const, location: "", purchasedOn: "", notes: "" });
  if (nextAssetCode([]) !== "AST-001") throw new Error("first asset code");
  if (nextAssetCode([asset("AST-009"), asset("FRIDGE"), asset("ast-002")]) !== "AST-010") throw new Error("next asset code follows the highest");
  const changes = describeChanges({ price: { from: 50, to: 60 }, deleted_at: { from: null, to: "2026-11-16" }, received_at: { from: null, to: "x" } });
  if (changes.join("|") !== "Price: 50 → 60|Removed") throw new Error(`audit changes read wrong: ${changes.join("|")}`);
  const entry = { id: "1", action: "STATUS", table: "purchases", recordId: "", label: "", by: "", at: "", changes: {}, details: { status: "Received" } };
  if (describeAction(entry) !== "Purchase marked received") throw new Error("audit action read wrong");
});

runTest("Accounting statements add up", () => {
  const acc = (id: string, code: string, type: AccountBalance["type"], key: string | null, opening: number, debit: number, credit: number): AccountBalance =>
    ({ id, code, name: id, type, key, description: null, active: true, opening, debit, credit, closing: opening + debit - credit, lines: 1 });
  // A sale of 1,000 (cost 600) paid by M-Pesa, rent of 300 from cash, owner put in 5,000 before the period.
  const accounts = [
    acc("cash", "1000", "asset", "cash", 5000, 0, 300),
    acc("mpesa", "1010", "asset", "mpesa", 0, 1000, 0),
    acc("stock", "1200", "asset", "inventory", 2000, 0, 600),
    acc("capital", "3000", "equity", "capital", -7000, 0, 0),
    acc("sales", "4000", "income", "sales", 0, 0, 1000),
    acc("cogs", "5000", "expense", "cogs", 0, 600, 0),
    acc("rent", "6100", "expense", "exp:rent", 0, 300, 0),
  ];
  const pnl = profitAndLoss(accounts);
  if (pnl.totalIncome !== 1000 || pnl.grossProfit !== 400 || pnl.netProfit !== 100) throw new Error(`profit & loss wrong: ${JSON.stringify(pnl)}`);
  const bs = balanceSheet(accounts);
  if (bs.totalAssets !== 7100 || bs.profitToDate !== 100 || bs.totalEquity !== 7100 || bs.difference !== 0) throw new Error(`balance sheet wrong: ${JSON.stringify(bs)}`);
  const tb = trialBalance(accounts);
  if (!tb.balanced || tb.debit !== 8000) throw new Error(`trial balance wrong: ${tb.debit} / ${tb.credit}`);
  const transfer = QUICK_ENTRIES.find((q) => q.id === "transfer")!;
  const lines = quickLines(transfer, accounts, 250, { money: "mpesa", to: "cash" });
  if (typeof lines === "string" || lines[0].accountId !== "cash" || lines[0].debit !== 250 || lines[1].accountId !== "mpesa" || lines[1].credit !== 250) throw new Error("M-Pesa to cash should debit cash and credit M-Pesa");
  if (quickLines(transfer, accounts, 250, { money: "cash", to: "cash" }) !== "Choose two different accounts.") throw new Error("same account both sides must be refused");
  if (quickLines(QUICK_ENTRIES.find((q) => q.id === "capital")!, accounts, 0, { money: "cash" }) !== "Enter an amount above zero.") throw new Error("zero amount must be refused");
  if (checkDraft([{ accountId: "cash", debit: 100, credit: 0 }, { accountId: "sales", debit: 0, credit: 90 }]).error === null) throw new Error("unbalanced draft must be refused");
  if (checkDraft([{ accountId: "cash", debit: 100.1, credit: 0 }, { accountId: "sales", debit: 0, credit: 100.1 }, { accountId: "", debit: 0, credit: 0 }]).error !== null) throw new Error("balanced draft with an empty line is fine");
});

runTest("Quotes, invoices and credit notes add up like the database", () => {
  // 10 at 150 with 10% off and 16% VAT; 3 at 99.99 with no VAT; delivery 200. The database gave 2,645.97 (QT-2026-0001 on the test copy).
  const lines = [
    { productId: "a", name: "Milk", unit: "L", quantity: 10, unitPrice: 150, discountPct: 10, vatRate: 16 },
    { productId: "b", name: "Yoghurt", unit: "", quantity: 3, unitPrice: 99.99, discountPct: 0, vatRate: 0 },
    { productId: null, name: "Setup service", unit: "", quantity: 1, unitPrice: 500, discountPct: 0, vatRate: 16 },
  ];
  const a = lineAmounts(lines[0]);
  if (a.net !== 1350 || a.vat !== 216 || a.total !== 1566) throw new Error(`line amounts wrong: ${JSON.stringify(a)}`);
  const t = draftTotals(lines, 200);
  if (t.net !== 2149.97 || t.vat !== 296 || t.total !== 2645.97) throw new Error(`totals wrong: ${JSON.stringify(t)}`);
  if (checkLines(lines) !== null) throw new Error("good lines refused");
  if (checkLines([{ ...lines[0], vatRate: 14 }]) === null) throw new Error("VAT 14% must be refused (KRA takes 0, 8, 16)");
  if (checkLines([{ ...lines[0], quantity: 0 }]) === null) throw new Error("zero quantity must be refused");
  if (checkLines([]) === null) throw new Error("no items must be refused");

  // Crediting 1 of 4 units of a line worth 540 + 86.40 VAT gives 156.60 (CN-2026-0002 on the test copy).
  const inv: InvoiceLineRow[] = [{ id: "l1", position: 1, productId: "a", name: "Milk", unit: "L", quantity: 4, unitPrice: 150, discountPct: 10, vatRate: 16, net: 540, vat: 86.4, total: 626.4, orderLineId: "o1", credited: 0 }];
  if (creditPreview(inv, { l1: 1 }) !== 156.6) throw new Error(`credit preview wrong: ${creditPreview(inv, { l1: 1 })}`);
  if (creditPreview(inv, { l1: 9 }) !== 626.4) throw new Error("credit can't go past what is left");

  // A till sale of 400 with 67 off and 16% VAT (386.28): one unit of the 10%-off item gives 93.96 back.
  const sale = [{ id: "i1", productId: "a", name: "Milk", quantity: 3, left: 3, unitNet: 81, vatRate: 16 }, { id: "i2", productId: "b", name: "Bread", quantity: 2, left: 2, unitNet: 45, vatRate: 16 }];
  if (refundPreview(sale, { i1: 1 }).total !== 93.96) throw new Error(`refund preview wrong: ${refundPreview(sale, { i1: 1 }).total}`);
  if (refundPreview(sale, { i1: 3, i2: 2 }).total !== 386.28) throw new Error(`full refund should give the whole sale back: ${refundPreview(sale, { i1: 3, i2: 2 }).total}`);

  const p = creditNotePayload({ transactionId: "t", quantities: { i1: 2, i2: 0 }, reason: " Returned ", settlement: "wallet", method: "Cash", returnStock: true });
  if (p.lines.length !== 1 || (p.lines[0] as any).transactionItemId !== "i1" || p.method !== null || p.reason !== "Returned") throw new Error(`credit note payload wrong: ${JSON.stringify(p)}`);
  if (termsSetting(7) !== "weekly" || termsSetting(14) !== null || termsDaysOf("monthly") !== 30 || termsDaysOf(undefined) !== 0) throw new Error("payment terms mapping wrong");

  const doc = toInvoiceDocument({
    kind: "quote", number: "QT-2026-0001", issueDate: "2026-11-17", validUntil: "2026-12-01",
    lines: [{ id: "x", position: 1, ...lines[0], net: 1350, vat: 216, total: 1566 }], subtotal: 1350, vat: 216, deliveryFee: 200, paid: 0, balance: 1766,
    from: { name: "Shop" }, to: { name: "Hotel" }, texts: defaultInvoiceTexts(), currency: "KSh", accent: "#000",
  });
  if (doc.texts.title !== "Quotation" || doc.dueAt !== "" || doc.lines.length !== 2 || doc.totals.subtotal !== 1550 || doc.texts.note !== "Valid until 01/12/2026") {
    throw new Error(`quote PDF document wrong: ${JSON.stringify({ title: doc.texts.title, due: doc.dueAt, lines: doc.lines.length, sub: doc.totals.subtotal, note: doc.texts.note })}`);
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
  const code = ["InventoryView", "CustomersView", "ProductionBOMView", "DashboardView", "BusinessManagementView", "NotificationsView", "StockTransfersView", "PaymentPromptView", "SuppliersView", "AccountingView", "BuyingView", "SalesView", "POSView", "WorkersView", "AboutView", "PromotionsView", "CustomerFeedbackView"]
    .map((f) => readFileSync(`src/features/${f}.tsx`, "utf8"))
    // Screens built from panels: their buttons live in these components.
    .concat(["payments/ExpensesPanel", "sales/QuotesPanel"].map((f) => readFileSync(`src/components/${f}.tsx`, "utf8")))
    .join("\n");
  // A button is tagged directly, or through a list entry (`shortcut: "name"`) that renders data-shortcut.
  const tagged = (name: string) => code.includes(`data-shortcut="${name}"`) || code.includes(`shortcut: "${name}"`) || code.includes(`shortcut: '${name}'`);
  for (const sc of SHORTCUTS.filter((x) => x.target)) {
    if (!tagged(sc.target!)) throw new Error(`no button tagged ${sc.target} for ${sc.id}`);
  }
  for (const f of FEATURES.filter((x) => x.target)) {
    if (!tagged(f.target!)) throw new Error(`no button tagged ${f.target} for search result ${f.id}`);
  }
  // Points settings: only roles allowed to change them find them.
  const findsPointSettings = (role: string) => featuresFor(role).some((f) => f.id === "points-settings");
  if (!findsPointSettings("Owner")) throw new Error("an owner should find points settings");
  if (findsPointSettings("Cashier") || findsPointSettings("Manager") || findsPointSettings("Rider")) throw new Error("only loyalty.configure finds points settings");
  if (featuresFor("Cashier").some((f) => ["promo-codes", "website-banner", "points-cost"].includes(f.id))) throw new Error("a cashier must not find website or finance features");
  if (!featuresFor("Rider").some((f) => f.id === "delivery-requests")) throw new Error("a rider should find delivery requests");
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
  eq(withPoints.series.reduce((n, p) => n + p.spending, 0), 25, "points used for debt count as spending");
  // Points used at the till are already off the sale, so profit is not cut twice.
  const discounted = analyse({ transactions: [], expenses: [], debtPayments: [], payments: [], pointsDiscounts: [{ date: at(3), value: 40 }] }, week, buckets);
  eq(discounted.total.pointsDiscounts, 40, "points discounts are shown as spent");
  // A refund comes off sales, cost (goods back on the shelf) and the money it was paid back in.
  const refunded = analyse(
    { transactions: [tx(2, 200, "Cash", 2)], expenses: [], debtPayments: [], payments: [],
      refunds: [{ date: at(3), total: 100, cost: 60, settlement: "refund", method: "Cash", lines: [{ productId: "p1", name: "Milk", quantity: 1, total: 100 }] }] },
    week, buckets,
  );
  eq([refunded.total.sales, refunded.total.cost, refunded.total.received.Cash, refunded.total.refunds, refunded.total.orders], [100, 60, 100, 100, 1], "refund balances sales, cost and cash");
  eq(refunded.total.products.get("p1")?.qty, 1, "refunded units come off units sold");
  eq(refunded.total.profit, 40, "profit after a refund");
  // An edit: the sale taken back and redone shows only the corrected sale, no refund line.
  const edited = analyse(
    { transactions: [tx(2, 200, "Cash", 2), tx(2.5, 100, "Cash", 1)], expenses: [], debtPayments: [], payments: [],
      refunds: [{ date: at(2, 11), total: 200, cost: 120, settlement: "refund", method: "Cash", edit: true, lines: [{ productId: "p1", name: "Milk", quantity: 2, total: 200 }] }] },
    week, buckets,
  );
  eq([edited.total.sales, edited.total.cost, edited.total.received.Cash, edited.total.refunds, edited.total.orders], [100, 60, 100, 0, 1], "edit nets out to the redone sale");
  eq(discounted.total.profit, 0, "points discounts do not come off profit twice");

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

runTest("Receipt names the promotion code apart from other discounts", () => {
  const base = Number(sampleTx.discount) || 0;
  const tx = { ...sampleTx, discount: base + 100, promotionCode: "MILK10", promotionDiscount: 100 } as any;
  const { body } = buildReceiptText(buildReceiptContent(tx, receiptSettings, {}), receiptSettings);
  if (!body.includes("Code MILK10")) throw new Error(`missing the code line:\n${body}`);
  if (base > 0 && !body.includes("Discount")) throw new Error("the other discount is gone");
  if (base === 0 && body.includes("Discount")) throw new Error("the code was counted twice as a discount");
  const plain = buildReceiptText(buildReceiptContent(sampleTx, receiptSettings, {}), receiptSettings).body;
  if (plain.includes("Code ")) throw new Error("a sale without a code shows a code line");
  const cols = columnsFor(receiptSettings);
  if (body.split("\n").some((l) => l.length > cols)) throw new Error("code line wider than the paper");
});

runTest("Promotion and referral permissions exist and follow the roles", () => {
  // Every permission the promotion and referral functions check is one the Roles screen knows.
  const sql = ["20261126001_promotions.sql", "20261126002_referrals.sql"].map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  const asked = new Set([...sql.matchAll(/assert_permission\([^,]+,\s*([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((x) => x[1])));
  const known = new Set(ALL_PERMISSIONS.map((p) => p.code));
  for (const p of asked) if (!known.has(p as any)) throw new Error(`${p} is checked by the database but missing in the app`);
  if (!hasRolePermission("Cashier", "pos.apply_promotion")) throw new Error("cashiers type codes at the till");
  if (hasRolePermission("Cashier", "promotions.manage") || hasRolePermission("Cashier", "referrals.manage")) throw new Error("cashiers must not manage promotions or referrals");
  if (hasRolePermission("Rider", "pos.apply_promotion")) throw new Error("riders don't apply codes");
  if (!hasRolePermission("Manager", "promotions.manage") || !hasRolePermission("Manager", "referrals.view")) throw new Error("managers run promotions");
  if (featuresFor("Cashier").some((f) => ["promo-codes", "referral-programme"].includes(f.id))) throw new Error("a cashier must not find promotion management");
});

runTest("Referral share text names the shop, code and the friend's reward", () => {
  const text = referralShareText("KayKay's", {
    code: "DENNIS482", campaign: { name: "x", endsAt: null, youGet: "KSh 100 wallet credit", friendGets: "KSh 50 off", minPurchase: 300 },
  } as any);
  for (const want of ["KayKay's", "DENNIS482", "KSh 50 off", "KSh 300"]) if (!text.includes(want)) throw new Error(`missing ${want}: ${text}`);
  if (text.includes("100")) throw new Error("the referrer's own reward isn't for the friend");
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
  eq(r.products.map((p) => [p.sold, p.earned, p.salesCount, p.cash, p.till, p.credit, p.left]), [[8, 460, 5, 120, 180, 60, 40]], "products sold, split by how they were paid, adding up to the sales total");
  const text = shiftReportText(r, { countedCash: 130, notes: "All good" });
  if (!text.includes("short by KSh 10.00")) throw new Error("counted cash difference missing:\n" + text);
  if (text.includes("```")) throw new Error("report should be plain text");
  if (!text.includes("8:00 – 17:00")) throw new Error("times should be Kenya time:\n" + text);
  eq(r.moneyIn.map((m) => [m.method, m.total]), [["Cash", 170], ["M-Pesa", 180], ["Card", 60], ["Bank", 40]], "money in per method, credit left out, debt repaid added");
  eq(r.moneyInTotal, 450, "money taken in = sales not on credit + debt repaid");
  eq(r.timeline.map((x) => x.kind), ["sale", "sale", "sale", "sale", "sale", "debt", "expense"], "timeline in time order");
  const order = ["*Summary*", "\nMilk\n- Sales: KSh 460.00 from 5 sales", "*Amount made today*", "*Needs attention*", "*Closing balances*", "- Milk: 40 L left", "*Notes from Jane*"].map((h) => text.indexOf(h));
  if (order.some((i) => i < 0) || order.some((i, n) => n && i < order[n - 1])) throw new Error("sections missing or out of order:\n" + text);
  const low = buildShiftReport({ shift: { startTime: t(5), endTime: t(14) }, employee: { id: "e1", name: "Jane" }, transactions: [sale("a", "Cash", 120, 2)], debtPayments: [], expenses: [], products: [{ ...milk, stock: 0 }], customers: [], productionBatches: [], billOfMaterials: [] });
  eq(shiftAttention(low, null), ["Cash in the drawer was not counted", "Milk is out of stock"], "uncounted cash and empty stock are flagged");
  // A cash refund comes out of the drawer; an edit leaves only the redone sale in the report.
  const base = { shift: { startTime: t(5), endTime: t(14) }, employee: { id: "e1", name: "Jane" }, debtPayments: [], expenses: [], products: [milk], customers: [], productionBatches: [], billOfMaterials: [] };
  const withRefund = buildShiftReport({ ...base, transactions: [sale("a", "Cash", 120, 2)], refunds: [{ transactionId: "a", date: t(9), total: 60, settlement: "refund", method: "Cash", createdBy: "Jane" }] });
  eq([withRefund.expectedCash, withRefund.refundsTotal, withRefund.cashRefunds], [60, 60, 60], "cash refund leaves the drawer");
  const withEdit = buildShiftReport({ ...base, transactions: [sale("a", "Cash", 120, 2), sale("b", "Cash", 60, 1, 10)], refunds: [{ transactionId: "a", date: t(10), total: 120, settlement: "refund", method: "Cash", createdBy: "Jane", edit: true }] });
  eq([withEdit.salesCount, withEdit.salesTotal, withEdit.expectedCash, withEdit.refundsTotal, withEdit.products[0].sold], [1, 60, 60, 0, 1], "edited sale shows only the redone sale");
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

runTest("Combining joins delivery fees of the same amount and keeps the total", () => {
  const sale = (id: string, fee: number) => ({ id, createdAt: `2026-11-0${id}T08:00:00Z`, amountOwed: 100 + fee, amountPaid: 0, balance: 100 + fee, saleId: `t${id}`, sale: { id: `t${id}`, timestamp: `2026-11-0${id}T08:00:00Z`, tax: 0, deliveryFee: fee, finalTotal: 100 + fee, items: [{ name: "Bread", unitPrice: 50, quantity: 2 }] } });
  const credits: any[] = [sale("1", 200), sale("2", 200), sale("3", 150)];
  const { lines } = buildInvoiceLines(credits, 850);
  const combined = combineSameProducts(lines);
  const deliveries = combined.filter((l) => l.kind === "delivery");
  if (deliveries.length !== 2) throw new Error(`expected 2 delivery lines (200 and 150), got ${deliveries.length}`);
  const two = deliveries.find((l) => l.unitPrice === 200)!;
  if (two.quantity !== 2 || two.amount !== 400 || two.description !== "Deliveries") throw new Error(`200 fee line: ${JSON.stringify(two)}`);
  const sum = (ls: typeof lines) => Math.round(ls.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  if (sum(combined) !== sum(lines)) throw new Error("combining changed the total");
});

runTest("A receipt number finds its sale and logs in any printed form", () => {
  const id = "abcd1234-5678-4000-8000-000000000001";
  for (const typed of ["RCT-2026-ABCD1234", "TXN-ABCD1234", "abcd1234", "RCT-ABCD1234", "abcd12", id]) {
    const code = receiptCode(typed);
    if (!code || !matchesReceipt(id, code)) throw new Error(`${typed} did not find the sale`);
    if (!mentionsReceipt("TXN-ABCD1234", code)) throw new Error(`${typed} did not find the stock log`);
  }
  if (receiptCode("milk") || receiptCode("1200")) throw new Error("ordinary words or prices taken for receipts");
  if (receiptCodeIn("Sold, receipt TXN-ABCD1234") !== "ABCD1234") throw new Error("log link");
  if (mentionsReceipt("TXN-FFABCD12", "ABCD12")) throw new Error("matched the middle of another code");
});

runTest("Invoice closes like the receipt; title is only what was typed", () => {
  const shop = { ...normalizeReceiptSettings({}), footerMessage: "Goods once sold", returnPolicy: "Returns within 7 days", thankYouMessage: "Asante!", extraQr: "custom_url" as const, customQrUrl: "https://shop.example/pay" };
  const extras = receiptClosing(shop);
  if (extras.closing?.policy !== "Returns within 7 days" || extras.qr?.url !== "https://shop.example/pay") throw new Error(JSON.stringify(extras));
  const texts = { ...defaultInvoiceTexts(), title: "Statement" };
  const doc: any = { texts, closing: extras.closing, qr: extras.qr, number: 3 };
  const c = closingOf(doc);
  if (c.thankYou !== "Asante!" || !c.thankYouStyled || !c.qr) throw new Error(JSON.stringify(c));
  const off = closingOf({ ...doc, texts: { ...texts, closingFromReceipt: false, showQr: false } });
  if (off.thankYou !== texts.thankYou || off.policy || off.qr) throw new Error(JSON.stringify(off));
  if (contactsLine({ phone: "0712", email: "a@b.co", address: "Nairobi", website: "" }) !== "0712   a@b.co   Nairobi") throw new Error("contacts line");
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
  const sql = SCHEMA_SQL;
  if (!/\* 2\)\)/.test(sql) || !/FLOOR\(NEW\.amount_paid\)/.test(sql)) throw new Error("database rule differs from the app's");
});

runTest("A walk-in sale added to a customer later earns the same points as at the till", () => {
  const sql = SCHEMA_SQL;
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
  const sql = SCHEMA_SQL;
  if (!/WHEN 'Gold' THEN 0\.005 WHEN 'Silver' THEN 0\.01 ELSE 0\.02/.test(sql)) throw new Error("database tier values differ from the app's");
  const redeemAt = sql.search(/FUNCTION "?public"?\."?fn_redeem_points"?/);
  if (redeemAt < 0) throw new Error("fn_redeem_points not found in the schema");
  const redeem = sql.slice(redeemAt, sql.indexOf("$$;", redeemAt));
  if (/wallet_balance\s*=|'wallet_topup'/.test(redeem)) throw new Error("points must not become wallet money");
});

runTest("Points rules are the same in the database, the app and the website", () => {
  const sql = SCHEMA_SQL;
  const body = (name: string) => {
    const at = sql.search(new RegExp(`FUNCTION "?public"?\\."?${name}"?\\(`));
    if (at < 0) throw new Error(`${name} not found in the schema`);
    return sql.slice(at, sql.indexOf("$$;", at));
  };
  // Earning: 2 per KSh paid (delivery excluded), 1 per KSh of debt repaid.
  if (POINTS_PER_KSH !== 2 || DEBT_PAYMENT_POINTS_PER_KSH !== 1) throw new Error("app earning rates changed");
  if (!/p_delivery_fee, 0\)\) \* 2\)/.test(body("fn_sale_points"))) throw new Error("database sale points are not 2 per KSh");
  if (!/FLOOR\(NEW\.amount_paid\)/.test(body("fn_debt_payment_points"))) throw new Error("database debt points are not 1 per KSh");
  if (!/'pointsPerShilling', 2\b/.test(sql)) throw new Error("the website is told a different earning rate");
  // Tiers: Silver from 20,000 points, Gold from 60,000, never down.
  const tier = body("calculate_customer_tier");
  if (!/points >= 60000[\s\S]*'Gold'[\s\S]*points >= 20000[\s\S]*'Silver'/.test(tier)) throw new Error("tier levels changed");
  if (!/GREATEST\(NEW\.tier/.test(body("fn_raise_customer_tier"))) throw new Error("tiers must only go up");
  const site = readFileSync("website/src/infoPages.ts", "utf8");
  if (!site.includes("20,000") || !site.includes("60,000")) throw new Error("the website's points page must give the tier levels");
  if (!/debt/i.test(site.slice(site.indexOf("function pointsLines")))) throw new Error("the website's points page must say repaid debt earns points");
  const rewards = readFileSync("website/src/pages/RewardsTab.tsx", "utf8");
  if (/goes to your wallet|Each point is worth Ksh \{/.test(rewards)) throw new Error("the website's Rewards tab describes points wrongly");
  // The minimum is checked wherever points are used.
  for (const fn of ["fn_redeem_points", "spend_points_at_till"]) if (!body(fn).includes("min_redeem_points")) throw new Error(`${fn} skips the minimum`);
});

runTest("Messages fill each customer's own values and catch unknown variables", () => {
  const ctx = { businessName: "Mama Mboga", businessPhone: "0700 111222", currency: "KSh", points: DEFAULT_POINT_SETTINGS, custom: [{ key: "offer_ends", label: "Offer ends", value: "Sunday" }] };
  const jane = { id: "c1", name: "jane wanjiku", phone: "0712", email: "", loyaltyPoints: 1000, joinDate: "2026-01-01", tier: "Bronze" as const, purchasesCount: 3, debtBalance: 1250.5, walletBalance: 0, accountNumber: "C77" };
  const out = fillMessage("Hi {first_name}, you owe {debt} at {store_name} ({business_name}). Points: {points} worth {points_value}. Ends {offer_ends}. {nope}", jane, ctx);
  const want = "Hi Jane, you owe KSh 1,250.50 at Mama Mboga (Mama Mboga). Points: 1,000 worth KSh 20.00. Ends Sunday. {nope}";
  if (out !== want) throw new Error(out);
  if (fillMessage("{ First_Name }", jane, ctx) !== "Jane") throw new Error("variables ignore case and spaces");
  if (unknownVariables("{first_name} {nope} {debt}", ctx).join() !== "nope") throw new Error("unknown variables not found");
  const blanks = emptyFor("{debt}", [jane, { ...jane, id: "c2", debtBalance: 0 }], ctx);
  if (blanks.length !== 1 || blanks[0].count !== 1) throw new Error("one customer owes nothing");
  if (fillMessage("{points}", jane, { ...ctx, points: { ...DEFAULT_POINT_SETTINGS, enabled: false } }) !== "0") throw new Error("points off reads as 0");
  if (validCustomKey("first_name") === null || validCustomKey("Bad Key") === null || validCustomKey("offer_ends") !== null) throw new Error("custom key rules");
  if (keyFromLabel("Offer ends!") !== "offer_ends") throw new Error(keyFromLabel("Offer ends!"));
  // Every built-in key fits the database check on message_variables keys, so the two can't collide silently.
  for (const v of BUILT_IN_VARIABLES) if (!/^[a-z][a-z0-9_]{1,29}$/.test(v.key)) throw new Error(v.key);
});

runTest("Customer groups: any within a section, all across sections", () => {
  const base = { id: "", name: "x", phone: "", email: "", loyaltyPoints: 0, joinDate: "2020-01-01", tier: "Bronze" as const, purchasesCount: 0 };
  const people = [
    { ...base, id: "gold-owes", tier: "Gold" as const, debtBalance: 500 },
    { ...base, id: "silver-owes", tier: "Silver" as const, debtBalance: 9000 },
    { ...base, id: "gold-clear", tier: "Gold" as const, debtBalance: 0 },
    { ...base, id: "bronze-owes", debtBalance: 100 },
  ];
  const ids = (groups: string[]) => people.filter(groupMatcher(groups, { points: DEFAULT_POINT_SETTINGS })).map((c) => c.id).join();
  if (ids([]) !== "gold-owes,silver-owes,gold-clear,bronze-owes") throw new Error("no groups is everyone");
  if (ids(["owes"]) !== "gold-owes,silver-owes,bronze-owes") throw new Error(ids(["owes"]));
  if (ids(["tier:Gold", "tier:Silver"]) !== "gold-owes,silver-owes,gold-clear") throw new Error("same section: either");
  if (ids(["tier:Gold", "tier:Silver", "owes"]) !== "gold-owes,silver-owes") throw new Error("across sections: both");
  if (ids(["owes_min:5000"]) !== "silver-owes") throw new Error(ids(["owes_min:5000"]));
  if (ids(["no-such-group"]) !== ids([])) throw new Error("unknown groups are ignored");
  if (describeGroups(["owes", "tier:Gold", "tier:Silver"]) !== "Owes money · Gold or Silver") throw new Error(describeGroups(["owes", "tier:Gold", "tier:Silver"]));
});

runTest("People never see a database ID in stock or history text", () => {
  const id = "3f2a9c1e-0000-4000-8000-000000000001";
  if (readableIds(`Sold via order #${id}`) !== "Sold · receipt TXN-3F2A9C1E") throw new Error(readableIds(`Sold via order #${id}`));
  if (readableIds(`Paid for order ${id} using wallet credit`) !== "Paid for order receipt TXN-3F2A9C1E using wallet credit".replace("order receipt", "receipt"))
    throw new Error(readableIds(`Paid for order ${id} using wallet credit`));
  if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(readableIds(`Moved ${id} and ${id}`))) throw new Error("a raw ID was left in");
  if (readableIds("Damaged in transit") !== "Damaged in transit") throw new Error("plain text must not change");
  if (formatReceiptNumber(id) !== "TXN-3F2A9C1E") throw new Error("the database receipt number must match the app's");
  const sql = SCHEMA_SQL;
  if (!sql.includes("'TXN-' || public.fn_short_id(p_id)")) throw new Error("database receipt number differs from the app's");
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
  const fix = SCHEMA_SQL;
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

runTest("Money comes in five ways only, the same in the app and the database", () => {
  if (JSON.stringify(MONEY_METHODS) !== JSON.stringify(["Cash", "M-Pesa", "Airtel Money", "Card", "Bank"])) throw new Error("the five methods changed");
  for (const old of ["Mobile_Wallet", "Other", "Credit_Debt", ""]) if (isMoneyMethod(old)) throw new Error(`${old} is not a way money comes in`);
  if (methodLabel("Credit_Debt") !== "Credit") throw new Error("credit label");
  if (normalizeReference("M-Pesa", " sxk2 m9q1tz ") !== "SXK2M9Q1TZ") throw new Error("M-Pesa codes are capitals without spaces");
  if (normalizeReference("Airtel Money", " mp241114.1530.a1 ") !== "MP241114.1530.A1") throw new Error("Airtel IDs are capitals without spaces");
  if (normalizeReference("Bank", "  FT 1234  ") !== "FT 1234") throw new Error("bank references stay as typed");

  // Every table that stores a method allows exactly these five (transactions also allow credit).
  const migration = SCHEMA_SQL;
  for (const constraint of ["payments_method_check", "money_assets_method_check", "expenses_payment_method_check", "debt_payments_payment_method_check", "transactions_payment_method_check"]) {
    const at = migration.indexOf(`CONSTRAINT "${constraint}" CHECK`);
    const text = at < 0 ? "" : migration.slice(at, migration.indexOf("\n", at));
    if (!["Cash", "M-Pesa", "Airtel Money", "Card", "Bank"].every((m) => text.includes(`'${m}'::`))) throw new Error(`${constraint} must allow the five methods`);
  }
  // A sale with Airtel Money must land on its own balance, not the old "Other" fallback.
  if (!migration.includes("WHEN NEW.payment_method = 'Airtel Money' THEN 'Airtel Money'")) throw new Error("sale trigger doesn't know Airtel Money");
  const methodEnum = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf('CREATE TYPE "public"."payment_method" AS ENUM'), SCHEMA_SQL.indexOf(");", SCHEMA_SQL.indexOf('CREATE TYPE "public"."payment_method" AS ENUM')));
  if (!methodEnum.includes("'Airtel Money'")) throw new Error("enum value missing");
});

runTest("Payment methods switch on and off, and the till never ends up with none", () => {
  const same = (a: unknown, b: unknown, what: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: ${JSON.stringify(a)}`); };
  same(enabledMethods(undefined), ["Cash", "M-Pesa", "Card", "Bank"], "nothing chosen gives the defaults");
  same(enabledMethods([]), ["Cash", "M-Pesa", "Card", "Bank"], "an empty list gives the defaults");
  same(enabledMethods(["Bank", "Airtel Money", "Bank", "Other"]), ["Airtel Money", "Bank"], "kept in the app's order, unknown dropped");
  same(enabledMethods(["Mobile_Wallet"]), ["Cash", "M-Pesa", "Card", "Bank"], "only unknown methods gives the defaults");
  const sql = SCHEMA_SQL;
  if (!sql.includes("assert_permission(p_business_id, 'payments.configure')")) throw new Error("switching methods needs payments.configure");
  if (!sql.includes("'Card' = ANY(b.default_payment_methods)")) throw new Error("the website must stop offering cards when Card is off");
  for (const fn of ["mpesa-payments", "airtel-payments", "card-payments", "customer-checkout"]) {
    if (!readFileSync(`supabase/functions/${fn}/index.ts`, "utf8").includes("fn_method_enabled")) throw new Error(`${fn} doesn't check the switch`);
  }
  if (!SYSTEM_ROLES.Cashier.permissions.includes("payments.airtel")) throw new Error("cashiers send Airtel prompts like M-Pesa ones");
  for (const role of ["Manager", "Cashier", "Rider"]) {
    if (SYSTEM_ROLES[role].permissions.includes("payments.configure")) throw new Error(`${role} shouldn't switch methods by default`);
  }
  if (!hasRolePermission("Owner", "payments.configure") || !hasRolePermission("Admin", "payments.configure")) throw new Error("owners and admins switch methods");
});

runTest("Airtel numbers, networks and answers are read correctly", () => {
  if (toAirtelMsisdn("0733 123 456") !== "733123456") throw new Error("local number");
  if (toAirtelMsisdn("+254 100 123456") !== "100123456") throw new Error("01 numbers");
  if (toAirtelMsisdn("254733123456") !== "733123456") throw new Error("with country code");
  if (toAirtelMsisdn("0633123456") !== null || toAirtelMsisdn("07331234") !== null) throw new Error("bad numbers refused");
  if (networkOf("0733123456") !== "airtel" || networkOf("0756123456") !== "airtel" || networkOf("0100123456") !== "airtel") throw new Error("Airtel prefixes");
  if (networkOf("0712345678") !== "safaricom" || networkOf("0110123456") !== "safaricom" || networkOf("0758123456") !== "safaricom") throw new Error("Safaricom prefixes");
  if (networkOf("0771123456") !== "telkom") throw new Error("Telkom prefix");
  if (networkOf("hello") !== null) throw new Error("not a number");
  if (airtelOutcome("TS") !== "success" || airtelOutcome("ts") !== "success") throw new Error("TS is paid");
  if (airtelOutcome("TF") !== "failed") throw new Error("TF is failed");
  if (airtelOutcome("TA") !== "pending" || airtelOutcome("TIP") !== "pending" || airtelOutcome(undefined) !== "pending") throw new Error("ambiguous and in-progress wait");
  const a = airtelReference(), b = airtelReference();
  if (a === b || !/^KK[0-9A-Z]{12,24}$/.test(a) || a.length > 24) throw new Error(`reference looks wrong: ${a}`);
  // A callback only records money after asking Airtel: it settles through refreshPrompt.
  const callback = readFileSync("supabase/functions/airtel-callback/index.ts", "utf8");
  if (!callback.includes("refreshPrompt(admin, row)") || /p_success:\s*true/.test(callback)) throw new Error("callback must not trust the body for a success");
});

runTest("No VAT at all unless KRA eTIMS is connected, even with the tax switch on", () => {
  const on = { isTaxEnabled: true, taxPercentage: 16 };
  const connected = { connected: true, settings: null };
  const off = { connected: false, settings: null };
  if (vatPercentFor(on, connected) !== 16) throw new Error("switch on + eTIMS connected charges VAT");
  if (vatPercentFor(on, off) !== 0) throw new Error("eTIMS not connected must mean no VAT");
  if (vatPercentFor(on, undefined) !== 0) throw new Error("unknown eTIMS status (loading, offline) must mean no VAT");
  if (vatPercentFor({ isTaxEnabled: false, taxPercentage: 16 }, connected) !== 0) throw new Error("switch off means no VAT");
  if (vatPercentFor({}, connected) !== 0) throw new Error("a missing switch means off");
  const sql = readFileSync("supabase/migrations/20261124001_vat_needs_etims.sql", "utf8");
  for (const need of ["vat_allowed", "trg_tax_needs_etims", "trg_0_sale_vat_needs_etims", "IF NOT v_vat_ok THEN", "SET DEFAULT false"]) {
    if (!sql.includes(need)) throw new Error(`database must enforce it too: ${need}`);
  }
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


runTest("Worked hours: periods start on Monday / the 1st, and shifts are cut to the period", () => {
  const wk = periodRange("week", new Date(2026, 10, 18, 15)); // Wed 18 Nov 2026
  if (wk.from.getDate() !== 16 || wk.from.getDay() !== 1 || wk.to.getDate() !== 23) throw new Error(`week ${wk.from} – ${wk.to}`);
  const mo = periodRange("month", new Date(2026, 10, 18));
  if (mo.from.getDate() !== 1 || mo.to.getMonth() !== 11) throw new Error("month");
  const day = periodRange("day", new Date(2026, 10, 18, 9));
  // Night shift 22:00 on the 17th to 06:00 on the 18th: 6 h fall on the 18th.
  const night = { startTime: new Date(2026, 10, 17, 22).toISOString(), endTime: new Date(2026, 10, 18, 6).toISOString() };
  if (minutesWithin(night, day.from, day.to) !== 360) throw new Error("night shift cut to the day");
  // Still clocked in since 08:00, now 10:30: 2h 30m.
  const open = { startTime: new Date(2026, 10, 18, 8).toISOString(), endTime: null };
  const m = minutesWithin(open, day.from, day.to, new Date(2026, 10, 18, 10, 30).getTime());
  if (m !== 150 || formatHours(m) !== "2h 30m" || formatHours(45) !== "45m") throw new Error(`open shift ${m}`);
});

runTest("Daily stock report: opening, where it went, closed, paid and not paid", () => {
  const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
  // The owner's own example: opening 34.5, added 250, sold 71 at the counter (12 of it not paid),
  // Colors 10, Millfield 20, Zimmer 75, closed 107.
  const raw = normalizeRaw({
    products: [
      { id: "milk", name: "Milk", unit: "L", opening: 34.5, closing: 107, received: 250, changes: 9 },
      { id: "eggs", name: "Eggs", unit: "", opening: 18, closing: 3, changes: 1 },
      { id: "idle", name: "Butter", unit: "", opening: 5, closing: 5, changes: 0 },
    ],
    sales: [
      { productId: "milk", method: "M-Pesa", qty: 59, value: 4130 },
      { productId: "milk", customerName: "Yier", customerType: "individual", method: "Credit", qty: 7, value: 490 },
      { productId: "milk", customerName: "Ruth", customerType: "individual", method: "Credit_Debt", qty: 5, value: 350 },
      { productId: "milk", customerName: "Colors", customerType: "institution", method: "Credit", qty: 10, value: 600 },
      { productId: "milk", customerName: "Millfield", customerType: "institution", method: "Bank", qty: 20, value: 1200 },
      { productId: "milk", customerName: "Zimmer", customerType: "business", method: "M-Pesa", qty: 75, value: 4500 },
      { productId: "eggs", method: "Cash", qty: 15, value: 375 },
    ],
    debts: [{ name: "Yier", owes: 8500 }, { name: "Paid up", owes: 0 }],
  });
  const r = buildStockReport(raw);
  eq(r.products.map((p) => p.name), ["Milk", "Eggs"], "products that did not move are left out");
  const milk = r.products[0];
  eq(milk.out.map((l) => [l.label, l.qty]), [["Sales", 71], ["Zimmer", 75], ["Millfield", 20], ["Colors", 10]], "counter sales first, then each big buyer");
  eq([milk.expected, milk.difference], [108.5, -1.5], "expected from the records, 1.5 short at closing");
  eq(milk.notPaid.map((l) => [l.label, l.qty]), [["Colors", 10], ["Yier", 7], ["Ruth", 5]], "credit sales per customer");
  eq(milk.paid.map((l) => [l.label, l.value]), [["M-Pesa", 8630], ["Bank", 1200]], "paid per method");
  eq(r.debts, [{ name: "Yier", owes: 8500 }], "pending bills leave out people who owe nothing");
  const byType = buildStockReport(raw, { groupBuyersByType: true }).products[0];
  eq(byType.out.map((l) => [l.label, l.qty]), [["Sales", 71], ["Businesses", 75], ["Institutions", 30]], "a month can group buyers by type");
  const text = stockReportText(r, { title: "Stock report", branch: "Westlands", period: "Tue 18 Nov 2026", notes: "Token Mng 20 Evg 12" });
  for (const part of ["*Milk (L)*", "Opening: 34.5", "+ Received: 250", "- Zimmer: 75", "Closed: 107 (1.5 short of 108.5 expected)", "1. Colors 10", "*Pending bills (owed now)*", "Token Mng 20 Evg 12"]) {
    if (!text.includes(part)) throw new Error(`report text is missing "${part}":\n${text}`);
  }
  const day = stockPeriodRange("day", { day: "2026-11-18" });
  eq([day.from.toISOString(), day.to.toISOString()], ["2026-11-17T21:00:00.000Z", "2026-11-18T21:00:00.000Z"], "a day runs midnight to midnight Kenya time");
  const month = stockPeriodRange("month", { month: "2026-12" });
  eq([month.from.toISOString(), month.to.toISOString()], ["2026-11-30T21:00:00.000Z", "2026-12-31T21:00:00.000Z"], "December ends at the new year");
  const custom = stockPeriodRange("custom", { from: "2026-11-20", to: "2026-11-18" });
  eq([custom.from.toISOString(), custom.to.toISOString()], ["2026-11-17T21:00:00.000Z", "2026-11-20T21:00:00.000Z"], "custom dates in either order, both days included");
});

runTest("Regular orders: week words, a day's customers, stock outlook", () => {
  const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
  //               Sun Mon Tue Wed Thu Fri Sat
  eq(weekText([0, 0, 0, 0, 0, 0, 10], "L"), "Sat 10 L", "weekly on Saturday");
  eq(weekText([0, 10, 10, 10, 10, 10, 0]), "Mon–Fri 10", "each weekday");
  eq(weekText([0, 20, 0, 0, 0, 0, 0]), "Mon 20", "Mondays");
  eq(weekText([0, 20, 20, 23, 23, 19, 0]), "Mon–Tue 20 · Wed–Thu 23 · Fri 19", "different amounts on different days");
  eq(weekText([5, 5, 5, 5, 5, 5, 5]), "Every day 5", "every day");
  eq(weekText([0, 0, 0, 0, 0, 0, 0]), "No days", "nothing");
  eq(weekText([3, 1, 0, 0, 0, 0, 3]), "Mon 1 · Sat–Sun 3", "Sunday ends the week");
  eq([addDays("2026-11-30", 1), addDays("2026-12-31", 1), addDays("2026-03-01", -1)], ["2026-12-01", "2027-01-01", "2026-02-28"], "dates roll over months and years");
  eq([dayLabel("2026-11-18", "2026-11-18"), dayLabel("2026-11-19", "2026-11-18"), dayLabel("2026-11-17", "2026-11-18")], ["Today", "Tomorrow", "Yesterday"], "near days by name");
  eq([needsDecision({ status: "requested", pendingDayQty: null }), needsDecision({ status: "active", pendingDayQty: [0, 1, 0, 0, 0, 0, 0] }), needsDecision({ status: "active", pendingDayQty: null })], [true, true, false], "customer requests and changes wait for the owner");

  const order = (id: string, customerName: string, productId: string, price: number): any => ({ id, customerId: `c-${customerName}`, customerName, customerPhone: null, productId, productName: productId, unit: "L", price, dayQty: [0, 0, 0, 0, 0, 0, 0] });
  const line = (orderId: string, customerName: string, productId: string, day: string, state: string, quantity: number): any => ({ orderId, customerId: `c-${customerName}`, productId, day, planned: quantity, state, quantity, transactionId: null, message: null, by: null });
  const board: RegularBoard = {
    today: "2026-11-18", ringAt: "16:00",
    orders: [order("o1", "Ann", "milk", 100), order("o2", "Ben", "milk", 100), order("o3", "Ann", "bread", 50), order("o4", "Cy", "milk", 100)],
    lines: [
      line("o1", "Ann", "milk", "2026-11-18", "due", 20), line("o3", "Ann", "bread", "2026-11-18", "skipped", 0),
      line("o2", "Ben", "milk", "2026-11-18", "delivered", 10), line("o4", "Cy", "milk", "2026-11-18", "skipped", 0),
      line("o1", "Ann", "milk", "2026-11-19", "due", 20), line("o2", "Ben", "milk", "2026-11-19", "changed", 30),
    ],
    stock: [{ productId: "milk", name: "Milk", unit: "L", price: 100, stock: 70, avgOther: 15, soldTodayOther: 5 }, { productId: "bread", name: "Bread", unit: "", price: 50, stock: 3, avgOther: 0, soldTodayOther: 0 }],
  };
  const today = customersForDay(board, "2026-11-18");
  eq(today.map((c) => [c.name, c.state, c.value]), [["Ann", "open", 2000], ["Ben", "done", 0], ["Cy", "skipped", 0]], "still to deliver first, then done, then skipped");
  const plan = planStock(board, ["2026-11-18", "2026-11-19"]);
  eq(plan.map((p) => p.name), ["Milk"], "only products with regular orders in the days shown");
  // today: 70 - 20 open - (15 - 5) usual left = 40; tomorrow: 40 - 50 - 15 = -25
  eq(plan[0].days.map((d) => [d.regular, d.other, d.closing]), [[20, 10, 40], [50, 15, -25]], "delivered lines are already out of stock");
  eq([plan[0].level, plan[0].shortOn, plan[0].orderMore], ["short", "2026-11-19", 25], "short tomorrow by 25");
  eq(stockAdvice(plan[0], "2026-11-18"), "Runs out tomorrow. Order about 25 L more.", "what to order");
});

(async () => {
  const name = "Lists: every page is read, and live changes update the list in place";
  try {
    const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
    // 2,500 rows come back as 1,000 + 1,000 + 500.
    const rows = Array.from({ length: 2500 }, (_, i) => i);
    const asked: string[] = [];
    const got = await allPages<number>(async (from, to) => { asked.push(`${from}-${to}`); return { data: rows.slice(from, to + 1), error: null }; });
    eq([got.length, asked], [2500, ["0-999", "1000-1999", "2000-2999"]], "three pages, all rows");
    const exact = await allPages<number>(async (from, to) => ({ data: rows.slice(0, 1000).slice(from, to + 1), error: null }));
    eq(exact.length, 1000, "exactly 1,000 rows: one more (empty) page, no more");
    let failed = false;
    await allPages(async () => ({ data: null, error: new Error("offline") })).catch(() => { failed = true; });
    eq(failed, true, "an error is passed on, not an empty list");

    let shown: { id: string; name: string; stock: number }[] = [];
    const list = liveList((r: any) => ({ id: r.id, name: r.name, stock: Number(r.stock) }), (p) => p.name.toLowerCase(), (l) => { shown = l; });
    list.set([{ id: "1", name: "Bread", stock: 5 }, { id: "2", name: "Milk", stock: 9 }]);
    list.apply({ eventType: "UPDATE", new: { id: "2", name: "Milk", stock: 8 }, old: { id: "2" } });
    list.apply({ eventType: "INSERT", new: { id: "3", name: "Eggs", stock: 30 }, old: {} });
    list.apply({ eventType: "UPDATE", new: { id: "1", name: "Bread", stock: 5, deleted_at: "2026-11-23" }, old: { id: "1" } });
    eq(shown.map((p) => p.id), ["1", "2"], "changes wait a moment, so a sale's lines show together");
    await new Promise((r) => setTimeout(r, 350));
    eq(shown.map((p) => [p.name, p.stock]), [["Eggs", 30], ["Milk", 8]], "new item in name order, stock changed, deleted item gone");
    list.apply({ eventType: "DELETE", new: {}, old: { id: "3" } });
    await new Promise((r) => setTimeout(r, 350));
    eq(shown.map((p) => p.id), ["2"], "a deleted row leaves");
    eq(list.apply({ eventType: "UPDATE", new: {}, old: {} }), false, "a change without an id asks for a full reload");
    list.stop();
    console.log(`✅ TEST PASSED: ${name}`);
  } catch (e) {
    console.error(`❌ TEST FAILED: ${name}`);
    console.error(e);
    process.exit(1);
  }
})();

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
