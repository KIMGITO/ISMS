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
  const defaultCashierVal = hasRolePermission("Cashier", "credit_payments");
  
  // 2. Set database permissions override
  useAuthStore.setState({
    dbPermissions: [
      { role: "Cashier", permission: "credit_payments", granted: true }
    ]
  });

  const overrideCashierVal = hasRolePermission("Cashier", "credit_payments");
  if (overrideCashierVal !== true) {
    throw new Error(`Expected Cashier to have credit_payments permission via DB override, got ${overrideCashierVal}`);
  }

  // 3. Explicitly deny a permission via DB override
  useAuthStore.setState({
    dbPermissions: [
      { role: "Cashier", permission: "credit_payments", granted: false }
    ]
  });

  const deniedCashierVal = hasRolePermission("Cashier", "credit_payments");
  if (deniedCashierVal !== false) {
    throw new Error(`Expected Cashier to not have credit_payments permission when explicitly false in DB, got ${deniedCashierVal}`);
  }
});

console.log("🎉 All Application Unit Tests Completed Successfully!");
