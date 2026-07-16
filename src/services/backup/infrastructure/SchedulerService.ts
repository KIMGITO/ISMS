// src/services/backup/infrastructure/SchedulerService.ts
import { RunBackupUseCase } from "../usecases/RunBackupUseCase";
import { FileBackupRepository } from "./FileBackupRepository";

export class SchedulerService {
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunningCheck = false;

  constructor(
    private repository: FileBackupRepository,
    private runBackupUseCase: RunBackupUseCase
  ) {}

  /**
   * Starts the background scheduler loop (checks every 15 minutes)
   */
  public start() {
    console.log("SchedulerService: Starting background backup schedule checker...");
    
    // Check immediately on startup
    this.checkSchedule("biz-1");

    // Check every 15 minutes
    this.checkInterval = setInterval(() => {
      this.checkSchedule("biz-1");
    }, 15 * 60 * 1000);
  }

  /**
   * Stops the background scheduler loop
   */
  public stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log("SchedulerService: Background backup schedule checker stopped.");
    }
  }

  /**
   * Periodically checks if backup needs to be run or retried
   */
  public async checkSchedule(businessId: string) {
    if (this.isRunningCheck) return;
    this.isRunningCheck = true;

    try {
      const config = await this.repository.getConfig(businessId);
      if (!config || !config.enabled) {
        this.isRunningCheck = false;
        return;
      }

      const history = await this.repository.getHistory(businessId);
      const now = new Date();
      const currentHour = now.getHours();
      const todayDateStr = now.toDateString(); // e.g. "Tue Jul 07 2026"

      // 1. Check for failed backups to retry
      const failedLogs = history.filter(l => l.status === "failed" && l.retries < 3);
      for (const log of failedLogs) {
        const lastAttemptTime = new Date(log.timestamp).getTime();
        const minutesSinceLastAttempt = (Date.now() - lastAttemptTime) / (60 * 1000);
        
        // Wait at least 15 minutes between retries
        if (minutesSinceLastAttempt >= 15) {
          console.log(`SchedulerService: Retrying failed backup log ${log.id} (Attempt #${log.retries + 1})...`);
          await this.runBackupUseCase.retry(businessId, log.id);
        }
      }

      // 2. Check if a new automatic backup needs to run based on schedule
      const autoLogs = history.filter(l => l.type === "auto");
      const latestAutoLog = autoLogs[0]; // history is sorted descending by timestamp
      
      let shouldRunAuto = false;
      const scheduleType = config.schedule; // "nightly_12am" | "nightly_3am" | "every_12h"

      if (scheduleType === "every_12h") {
        if (!latestAutoLog) {
          shouldRunAuto = true;
        } else {
          const hoursSinceLast = (Date.now() - new Date(latestAutoLog.timestamp).getTime()) / (3600 * 1000);
          if (hoursSinceLast >= 12) {
            shouldRunAuto = true;
          }
        }
      } else {
        // Nightly backups: nightly_12am (Hour 0) or nightly_3am (Hour 3)
        const targetHour = scheduleType === "nightly_3am" ? 3 : 0;
        
        if (currentHour >= targetHour) {
          // Check if we already ran an auto backup TODAY
          const alreadyRanToday = latestAutoLog && new Date(latestAutoLog.timestamp).toDateString() === todayDateStr;
          
          if (!alreadyRanToday) {
            shouldRunAuto = true;
          }
        }
      }

      if (shouldRunAuto) {
        console.log(`SchedulerService: Triggering scheduled automatic backup (${scheduleType})...`);
        await this.runBackupUseCase.execute(businessId, "auto");
      }
    } catch (err) {
      console.error("SchedulerService: Error checking backup schedules:", err);
    } finally {
      this.isRunningCheck = false;
    }
  }
}
