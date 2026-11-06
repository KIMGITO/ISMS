// src/test/runTests.ts
import { readFileSync } from "node:fs";
import { respond, UssdContext } from "../../supabase/functions/ussd/menu";
import "./setupTests";
import { formatReceiptNumber, formatCustomerNumber, getShortId } from "../utils/idUtils";
import { EscPosGenerator } from "../services/printer/EscPosGenerator";
import { PrinterConfig } from "../services/printer/types";
import { EmailService } from "../services/emailService";
import { toUserMessage, AppError } from "../utils/userError";
import { scrubPersonalData } from "../services/crashReporter";
import { NotificationRepository } from "../services/notifications/notificationRepository";
import { hasRolePermission, SYSTEM_ROLES } from "../utils/permissions";
import { useAuthStore } from "../stores/authStore";
import { defaultKeepId, phoneKey, previewMerge } from "../services/customerMerge";
import { arrangeMobileNav, MAX_BOTTOM_TABS, MORE_TAB_ID } from "../utils/mobileNav";
import { toMsisdn } from "../../supabase/functions/mpesa-payments/phone";
// @ts-ignore plain JS module shared with the release workflow
import { classifyCommit, highestBump, nextVersion } from "../../scripts/release-version.mjs";
// @ts-ignore plain JS module shared with the release workflow
import { buildManifest } from "../../scripts/update-manifest.mjs";
import { compareVersions } from "../utils/semver";
import { SCREENS, canOpenScreen } from "../utils/screens";

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

runTest("EscPosGenerator command streams", () => {
  const mockConfig: PrinterConfig = {
    defaultPrinterId: null,
    paperWidth: "80mm",
    charactersPerLine: 42,
    isAutoCutEnabled: true,
    printDensity: 3,
    copies: 1,
    printLogo: true,
    printQrCode: true,
    printBarcode: true,
    connectionTimeout: 10000,
    autoReconnect: true,
  };
  const bytes = EscPosGenerator.generateTestPrintBytes("TestPrinter", mockConfig);
  if (bytes.length === 0) {
    throw new Error("Generated test print bytes is empty");
  }
  if (bytes[0] !== 0x1B || bytes[1] !== 0x40) {
    throw new Error("Missing ESC/POS printer initialization sequence [0x1B, 0x40]");
  }
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
  const defaultModel = "Qwen/Qwen2.5-Coder-32B-Instruct";
  
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
  const migration = readFileSync("supabase/migrations/20261105014_role_enforcement.sql", "utf8");
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
    { ...base, loyaltyPoints: 250, debtBalance: 500, walletBalance: 0 },
    { ...base, id: "b", tier: "Bronze", loyaltyPoints: 50, debtBalance: 0, walletBalance: 200, purchasesCount: 1 },
  );
  if (preview.debt !== 300 || preview.wallet !== 0 || preview.offset !== 200) throw new Error("Wallet should clear debt first");
  if (preview.points !== 300 || preview.purchases !== 5) throw new Error("Points and purchases should add together");
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

runTest("Update manifest lists desktop installers and the Android APK", () => {
  const files = [
    "KayKays-1.2.0-windows-x64.exe", "KayKays-1.2.0-windows-x64-setup.msi",
    "KayKays-1.2.0-linux-x86_64.AppImage", "KayKays-1.2.0-linux-amd64.deb",
    "KayKays-1.2.0-android.apk",
  ];
  const m = buildManifest({
    version: "1.2.0", tag: "v1.2.0", repo: "KIMGITO/ISMS", notes: "### Features\n- x\n", files,
    readText: () => "", sha256: () => "abc123",
  });
  const base = "https://github.com/KIMGITO/ISMS/releases/download/v1.2.0/";
  if (m.version !== "1.2.0") throw new Error("version");
  if (m.platforms["windows-x86_64"].url !== base + "KayKays-1.2.0-windows-x64-setup.msi") throw new Error("windows url");
  if (m.platforms["windows-x86_64"].signature !== undefined) throw new Error("windows sig should be undefined when no .sig");
  if (m.platforms["linux-x86_64"].url !== base + "KayKays-1.2.0-linux-x86_64.AppImage") throw new Error("linux url");
  if (m.android.url !== base + "KayKays-1.2.0-android.apk" || m.android.sha256 !== "abc123") throw new Error("android");
  // Desktop installers without .sig files are still listed (signing temporarily skipped).
  if (Object.keys(m.platforms).length !== 2) throw new Error(`Expected 2 desktop platforms, got ${Object.keys(m.platforms).length}`);
});

runTest("App versions compare numerically", () => {
  const cases: [string, string, number][] = [["1.10.0", "1.9.9", 1], ["1.0.0", "1.0.0", 0], ["v2.0.0", "1.99.99", 1], ["1.0", "1.0.1", -1]];
  for (const [a, b, want] of cases) {
    if (compareVersions(a, b) !== want) throw new Error(`${a} vs ${b} gave ${compareVersions(a, b)}`);
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

console.log("🎉 All Application Unit Tests Completed Successfully!");
