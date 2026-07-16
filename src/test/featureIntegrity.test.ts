// src/test/featureIntegrity.test.ts
import "./setupTests";
import { isSupabaseConfigured } from "../services/supabaseClient";
import { formatReceiptNumber } from "../utils/idUtils";
import { EscPosGenerator } from "../services/printer/EscPosGenerator";
import { PrinterConfig } from "../services/printer/types";
import { NotificationService } from "../services/notifications/notificationService";

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      res.then(() => {
        console.log(`✅ INTEGRITY TEST PASSED: ${name}`);
      }).catch((e) => {
        console.error(`❌ INTEGRITY TEST FAILED: ${name}`);
        console.error(e);
        process.exit(1);
      });
    } else {
      console.log(`✅ INTEGRITY TEST PASSED: ${name}`);
    }
  } catch (e) {
    console.error(`❌ INTEGRITY TEST FAILED: ${name}`);
    console.error(e);
    process.exit(1);
  }
}

console.log("🚀 Starting Feature Integrity Checks...");

// 1. Supabase environment presence & config method validation
runTest("Supabase Client configuration query methods", () => {
  // Test local mock keys configuration status check is working
  const configured = isSupabaseConfigured();
  console.log(`- Supabase configuration detected: ${configured}`);
});

// 2. Push notification engine mock trigger verification
runTest("Notification banner alerts & local triggers", () => {
  const notification = NotificationService.createAINotification(
    "Out-of-Stock Insight",
    "Mala stocks are critically depleted in Branch 1. Top-up recommended.",
    "critical"
  );
  if (!notification) {
    throw new Error("Failed to create AI notification instance");
  }
  if (notification.type !== "AI Business Insight" || notification.priority !== "critical") {
    throw new Error("Notification fields mismatch original payload definition");
  }
  console.log(`- Notification generated successfully: ${notification.title}`);
});

// 3. Persistent receipt formatting & printer output streams
runTest("Receipt printer generator persistency", () => {
  const txnId = "9c23b2c1-d249-11ea-87d0-0242ac130003";
  const numStr = formatReceiptNumber(txnId);
  if (numStr !== "TXN-9C23B2C1") {
    throw new Error(`Formatted receipt number output mismatch: ${numStr}`);
  }

  const mockConfig: PrinterConfig = {
    defaultPrinterId: null,
    paperWidth: "58mm",
    charactersPerLine: 32,
    isAutoCutEnabled: true,
    printDensity: 2,
    copies: 1,
    printLogo: true,
    printQrCode: true,
    printBarcode: true,
    connectionTimeout: 5000,
    autoReconnect: false,
  };
  const stream = EscPosGenerator.generateTestPrintBytes("ReceiptTestDevice", mockConfig);
  if (!stream || stream.length === 0) {
    throw new Error("ESC/POS printer command stream was empty");
  }
});

import { SchedulerService } from "../services/backup/infrastructure/SchedulerService";

// 4. Nightly scheduled backup chrome/cron cycle checks
runTest("Backup scheduler configuration and check cycle", async () => {
  let executeCalled = false;
  let retryCalled = false;

  const mockRepo = {
    getConfig: async () => ({
      enabled: true,
      schedule: "nightly_12am",
      spreadsheetId: "mock-sheet-123",
      lastBackupAt: null,
    }),
    getHistory: async () => [
      { id: "log-1", timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(), type: "manual", status: "failed", retries: 1, error: "Network lost" },
      { id: "log-2", timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), type: "auto", status: "success", retries: 0 }
    ],
    saveConfig: async () => {},
    saveLog: async () => {},
  } as any;

  const mockUseCase = {
    execute: async () => {
      executeCalled = true;
      return { success: true, logId: "log-new" };
    },
    retry: async () => {
      retryCalled = true;
      return { success: true };
    }
  } as any;

  const scheduler = new SchedulerService(mockRepo, mockUseCase);
  await scheduler.checkSchedule("biz-1");

  // Since log-1 failed 30 mins ago and has 1 retry, it should trigger a retry!
  if (!retryCalled) {
    throw new Error("Scheduler failed to trigger retry execution for failed backup log");
  }
  
  // Since no auto backup has run successfully today, it should trigger an auto-run!
  if (!executeCalled) {
    throw new Error("Scheduler failed to trigger scheduled automatic backup execution");
  }
});

console.log("🎉 Feature Integrity Verification Completed!");
