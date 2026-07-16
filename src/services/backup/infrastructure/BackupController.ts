// src/services/backup/infrastructure/BackupController.ts
import { Router, Request, Response } from "express";
import { RunBackupUseCase } from "../usecases/RunBackupUseCase";
import { FileBackupRepository } from "./FileBackupRepository";
import { GoogleSheetsAdapter } from "./GoogleSheetsAdapter";

export function createBackupRouter(
  repository: FileBackupRepository,
  runBackupUseCase: RunBackupUseCase,
  spreadsheetClient: GoogleSheetsAdapter
): Router {
  const router = Router();

  // Helper to check Owner role
  const checkOwner = (req: Request, res: Response, next: any) => {
    const { activeRole } = req.body;
    if (activeRole !== "Owner") {
      return res.status(403).json({
        success: false,
        error: "Access Denied: Only company Owners are authorized to configure or run Google Sheets backups."
      });
    }
    next();
  };

  /**
   * Retrieves current Backup config settings
   */
  router.post("/config/get", checkOwner, async (req: Request, res: Response) => {
    try {
      const { businessId } = req.body;
      if (!businessId) {
        return res.status(400).json({ success: false, error: "businessId is required." });
      }

      const config = await repository.getConfig(businessId);
      if (!config) {
        return res.json({
          success: true,
          config: {
            googleSheetUrl: "",
            googleServiceAccount: "",
            schedule: "nightly_12am",
            enabled: false,
            isConfigured: false
          }
        });
      }

      // Security: Mask the service account private key or content in the UI
      let maskedServiceAccount = "";
      if (config.googleServiceAccount) {
        try {
          const sa = JSON.parse(config.googleServiceAccount);
          if (sa.private_key) {
            sa.private_key = "••••••••••••••••••••••••••••••••";
          }
          maskedServiceAccount = JSON.stringify(sa, null, 2);
        } catch {
          maskedServiceAccount = "••••••••••••••••";
        }
      }

      res.json({
        success: true,
        config: {
          ...config,
          googleServiceAccount: maskedServiceAccount,
          isConfigured: !!config.googleServiceAccount
        }
      });
    } catch (err: any) {
      console.error("BackupController: Failed to get configuration:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve backup config." });
    }
  });

  /**
   * Saves Backup config settings
   */
  router.post("/config/save", checkOwner, async (req: Request, res: Response) => {
    try {
      const { businessId, config } = req.body;
      if (!businessId) {
        return res.status(400).json({ success: false, error: "businessId is required." });
      }
      if (!config) {
        return res.status(400).json({ success: false, error: "Config payload is required." });
      }

      // Handle masked service account json
      let saJson = config.googleServiceAccount;
      const existing = await repository.getConfig(businessId);

      if (saJson && saJson.includes("••••")) {
        saJson = existing?.googleServiceAccount || "";
      }

      // Basic validation of Service Account JSON structure
      if (saJson && saJson.trim().length > 0) {
        try {
          const parsed = JSON.parse(saJson);
          if (!parsed.client_email || !parsed.private_key) {
            return res.status(400).json({
              success: false,
              error: "Invalid Service Account credentials: Missing client_email or private_key."
            });
          }
        } catch {
          return res.status(400).json({
            success: false,
            error: "Invalid Service Account JSON format. Please paste a valid Google service account JSON."
          });
        }
      }

      const updated = await repository.saveConfig(businessId, {
        googleSheetUrl: config.googleSheetUrl,
        googleServiceAccount: saJson,
        schedule: config.schedule || "nightly_12am",
        enabled: !!config.enabled
      });

      // Verification connection check if configured
      let connectionValid = false;
      if (updated.enabled && updated.googleSheetUrl && updated.googleServiceAccount) {
        connectionValid = await spreadsheetClient.verifyConnection(
          updated.googleSheetUrl,
          updated.googleServiceAccount
        );
      }

      res.json({
        success: true,
        message: "Google Sheets Backup configuration saved successfully.",
        connectionValid,
        config: {
          ...updated,
          googleServiceAccount: updated.googleServiceAccount ? "••••••••" : "",
          isConfigured: !!updated.googleServiceAccount
        }
      });
    } catch (err: any) {
      console.error("BackupController: Failed to save configuration:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to save backup config." });
    }
  });

  /**
   * Retrieves Backup logs history list
   */
  router.post("/history", checkOwner, async (req: Request, res: Response) => {
    try {
      const { businessId } = req.body;
      if (!businessId) {
        return res.status(400).json({ success: false, error: "businessId is required." });
      }

      const history = await repository.getHistory(businessId);
      res.json({
        success: true,
        history
      });
    } catch (err: any) {
      console.error("BackupController: Failed to fetch history:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch backup history." });
    }
  });

  /**
   * Triggers a manual Google Sheets Backup immediately
   */
  router.post("/run", checkOwner, async (req: Request, res: Response) => {
    try {
      const { businessId, clientPayload } = req.body;
      if (!businessId) {
        return res.status(400).json({ success: false, error: "businessId is required." });
      }

      console.log(`BackupController: Starting manual backup for business ${businessId}...`);
      const log = await runBackupUseCase.execute(businessId, "manual", clientPayload);

      if (log.status === "success") {
        res.json({
          success: true,
          message: "Manual Google Sheets backup completed successfully!",
          log
        });
      } else {
        res.status(400).json({
          success: false,
          error: log.error || "Backup failed to complete. Check log history.",
          log
        });
      }
    } catch (err: any) {
      console.error("BackupController: Failed manual backup execution:", err);
      res.status(500).json({ success: false, error: err.message || "Backup execution failed." });
    }
  });

  /**
   * Manually retries a failed Google Sheets Backup log
   */
  router.post("/retry", checkOwner, async (req: Request, res: Response) => {
    try {
      const { businessId, logId } = req.body;
      if (!businessId || !logId) {
        return res.status(400).json({ success: false, error: "businessId and logId are required." });
      }

      console.log(`BackupController: Retrying failed backup log ${logId} for business ${businessId}...`);
      const result = await runBackupUseCase.retry(businessId, logId);

      if (result && result.status === "success") {
        res.json({
          success: true,
          message: "Backup retry completed successfully!",
          log: result
        });
      } else {
        res.status(400).json({
          success: false,
          error: result?.error || "Backup retry failed.",
          log: result
        });
      }
    } catch (err: any) {
      console.error("BackupController: Failed to retry backup:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to retry backup." });
    }
  });

  return router;
}
