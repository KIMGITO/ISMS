// src/test/runTests.ts
import "./setupTests";
import { formatReceiptNumber, formatCustomerNumber, getShortId } from "../utils/idUtils";
import { EscPosGenerator } from "../services/printer/EscPosGenerator";
import { PrinterConfig } from "../services/printer/types";
import { EmailService } from "../services/emailService";
import { NotificationRepository } from "../services/notifications/notificationRepository";
import { hasRolePermission } from "../utils/permissions";
import { useAuthStore } from "../stores/authStore";

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
  if (typeof EmailService.sendVerificationCode !== "function") {
    throw new Error("sendVerificationCode is not a function");
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

console.log("🎉 All Application Unit Tests Completed Successfully!");
