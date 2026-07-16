// src/services/backup/domain/ports.ts
import { BackupConfig, BackupHistoryLog } from "./entities";

export interface BackupRepository {
  getConfig(businessId: string): Promise<BackupConfig | null>;
  saveConfig(businessId: string, config: BackupConfig): Promise<BackupConfig>;
  getHistory(businessId: string): Promise<BackupHistoryLog[]>;
  addHistoryLog(businessId: string, log: BackupHistoryLog): Promise<BackupHistoryLog>;
  updateHistoryLog(businessId: string, logId: string, updates: Partial<BackupHistoryLog>): Promise<BackupHistoryLog | null>;
  
  // Expenses CRUD helpers for offline/server sync
  getExpenses(businessId: string): Promise<any[]>;
  saveExpenses(businessId: string, expenses: any[]): Promise<void>;
  
  // Suppliers CRUD helpers for offline/server sync
  getSuppliers(businessId: string): Promise<any[]>;
  saveSuppliers(businessId: string, suppliers: any[]): Promise<void>;
}

export interface SpreadsheetClient {
  authenticate(serviceAccountJson: string): Promise<string>; // returns access token
  verifyConnection(spreadsheetUrl: string, serviceAccountJson: string): Promise<boolean>;
  backupTables(
    spreadsheetUrl: string,
    serviceAccountJson: string,
    tables: Record<string, { headers: string[]; rows: any[][] }>
  ): Promise<{ success: boolean; details: Record<string, number>; error?: string }>;
}
