// src/services/backup/infrastructure/FileBackupRepository.ts
import fs from "fs";
import path from "path";
import { BackupRepository } from "../domain/ports";
import { BackupConfig, BackupHistoryLog } from "../domain/entities";

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_FILE = path.join(DATA_DIR, "google_sheets_backup_config.json");
const HISTORY_FILE = path.join(DATA_DIR, "google_sheets_backup_history.json");
const EXPENSES_FILE = path.join(DATA_DIR, "expenses.json");
const SUPPLIERS_FILE = path.join(DATA_DIR, "suppliers.json");

export class FileBackupRepository implements BackupRepository {
  constructor() {
    this.ensureDirectoryExists();
    this.seedMockData();
  }

  private ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private seedMockData() {
    // Seed Expenses if not exists
    if (!fs.existsSync(EXPENSES_FILE)) {
      const defaultExpenses = [
        {
          id: "exp-1",
          businessId: "biz-1",
          amount: 12000.00,
          category: "Fuel",
          description: "Generator diesel restock for Karen Hub cold room",
          date: new Date(Date.now() - 3600000 * 48).toISOString(),
          staffName: "Cyrus Langat",
        },
        {
          id: "exp-2",
          businessId: "biz-1",
          amount: 4500.00,
          category: "Utilities",
          description: "Water supply delivery and cleaning service",
          date: new Date(Date.now() - 3600000 * 24).toISOString(),
          staffName: "John Miller",
        },
        {
          id: "exp-3",
          businessId: "biz-1",
          amount: 2500.00,
          category: "Packaging",
          description: "Biodegradable bottles batch sample testing",
          date: new Date().toISOString(),
          staffName: "KayKay (Owner)",
        }
      ];
      fs.writeFileSync(EXPENSES_FILE, JSON.stringify(defaultExpenses, null, 2), "utf-8");
    }

    // Seed Suppliers if not exists
    if (!fs.existsSync(SUPPLIERS_FILE)) {
      const defaultSuppliers = [
        {
          id: "sup-1",
          businessId: "biz-1",
          name: "Limuru Dairy Cooperative",
          phone: "+254700111222",
          email: "info@limurudairy.co.ke",
          company: "Limuru Dairy Co.",
          productSupplied: "Raw Milk",
        },
        {
          id: "sup-2",
          businessId: "biz-1",
          name: "Naivasha Fresh Farms",
          phone: "+254711222333",
          email: "orders@naivashafresh.com",
          company: "Naivasha Farms Ltd.",
          productSupplied: "Cultured Lala",
        },
        {
          id: "sup-3",
          businessId: "biz-1",
          name: "Kiganjo Bottlers",
          phone: "+254722333444",
          email: "sales@kiganjobottlers.co.ke",
          company: "Kiganjo Bottlers Co.",
          productSupplied: "Bottles",
        }
      ];
      fs.writeFileSync(SUPPLIERS_FILE, JSON.stringify(defaultSuppliers, null, 2), "utf-8");
    }
  }

  // ==========================================
  // CONFIGURATION PERSISTENCE
  // ==========================================

  public async getConfig(businessId: string): Promise<BackupConfig | null> {
    try {
      if (!fs.existsSync(CONFIG_FILE)) return null;
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      const configs = JSON.parse(data || "{}");
      return configs[businessId] || null;
    } catch (err) {
      console.error("Failed to read backup config:", err);
      return null;
    }
  }

  public async saveConfig(businessId: string, config: BackupConfig): Promise<BackupConfig> {
    try {
      let configs: Record<string, BackupConfig> = {};
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, "utf-8");
        configs = JSON.parse(data || "{}");
      }
      configs[businessId] = {
        ...config,
      };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2), "utf-8");
      return configs[businessId];
    } catch (err: any) {
      console.error("Failed to save backup config:", err);
      throw new Error(`Failed to save config: ${err.message}`);
    }
  }

  // ==========================================
  // BACKUP LOG HISTORY PERSISTENCE
  // ==========================================

  public async getHistory(businessId: string): Promise<BackupHistoryLog[]> {
    try {
      if (!fs.existsSync(HISTORY_FILE)) return [];
      const data = fs.readFileSync(HISTORY_FILE, "utf-8");
      const historyMap = JSON.parse(data || "{}");
      const logs = historyMap[businessId] || [];
      // Sort logs by timestamp descending
      return logs.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (err) {
      console.error("Failed to read backup history:", err);
      return [];
    }
  }

  public async addHistoryLog(businessId: string, log: BackupHistoryLog): Promise<BackupHistoryLog> {
    try {
      let historyMap: Record<string, BackupHistoryLog[]> = {};
      if (fs.existsSync(HISTORY_FILE)) {
        const data = fs.readFileSync(HISTORY_FILE, "utf-8");
        historyMap = JSON.parse(data || "{}");
      }
      if (!historyMap[businessId]) {
        historyMap[businessId] = [];
      }
      historyMap[businessId].push(log);
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyMap, null, 2), "utf-8");
      return log;
    } catch (err: any) {
      console.error("Failed to append backup history:", err);
      throw new Error(`Failed to log history: ${err.message}`);
    }
  }

  public async updateHistoryLog(
    businessId: string,
    logId: string,
    updates: Partial<BackupHistoryLog>
  ): Promise<BackupHistoryLog | null> {
    try {
      if (!fs.existsSync(HISTORY_FILE)) return null;
      const data = fs.readFileSync(HISTORY_FILE, "utf-8");
      const historyMap = JSON.parse(data || "{}");
      const logs = historyMap[businessId] || [];

      const logIndex = logs.findIndex((l: any) => l.id === logId);
      if (logIndex === -1) return null;

      const updatedLog = {
        ...logs[logIndex],
        ...updates,
      };

      logs[logIndex] = updatedLog;
      historyMap[businessId] = logs;

      fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyMap, null, 2), "utf-8");
      return updatedLog;
    } catch (err) {
      console.error("Failed to update backup log:", err);
      return null;
    }
  }

  // ==========================================
  // EXPENSES DATA STORAGE
  // ==========================================

  public async getExpenses(businessId: string): Promise<any[]> {
    try {
      if (!fs.existsSync(EXPENSES_FILE)) return [];
      const data = fs.readFileSync(EXPENSES_FILE, "utf-8");
      const expenses = JSON.parse(data || "[]");
      return expenses.filter((e: any) => e.businessId === businessId);
    } catch (err) {
      console.error("Failed to read expenses:", err);
      return [];
    }
  }

  public async saveExpenses(businessId: string, expenses: any[]): Promise<void> {
    try {
      let allExpenses: any[] = [];
      if (fs.existsSync(EXPENSES_FILE)) {
        const data = fs.readFileSync(EXPENSES_FILE, "utf-8");
        allExpenses = JSON.parse(data || "[]");
      }
      // Remove previous ones for this business
      allExpenses = allExpenses.filter((e: any) => e.businessId !== businessId);
      // Add new ones
      allExpenses.push(...expenses.map(e => ({ ...e, businessId })));
      fs.writeFileSync(EXPENSES_FILE, JSON.stringify(allExpenses, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save expenses:", err);
    }
  }

  // ==========================================
  // SUPPLIERS DATA STORAGE
  // ==========================================

  public async getSuppliers(businessId: string): Promise<any[]> {
    try {
      if (!fs.existsSync(SUPPLIERS_FILE)) return [];
      const data = fs.readFileSync(SUPPLIERS_FILE, "utf-8");
      const suppliers = JSON.parse(data || "[]");
      return suppliers.filter((s: any) => s.businessId === businessId);
    } catch (err) {
      console.error("Failed to read suppliers:", err);
      return [];
    }
  }

  public async saveSuppliers(businessId: string, suppliers: any[]): Promise<void> {
    try {
      let allSuppliers: any[] = [];
      if (fs.existsSync(SUPPLIERS_FILE)) {
        const data = fs.readFileSync(SUPPLIERS_FILE, "utf-8");
        allSuppliers = JSON.parse(data || "[]");
      }
      // Remove previous ones for this business
      allSuppliers = allSuppliers.filter((s: any) => s.businessId !== businessId);
      // Add new ones
      allSuppliers.push(...suppliers.map(s => ({ ...s, businessId })));
      fs.writeFileSync(SUPPLIERS_FILE, JSON.stringify(allSuppliers, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save suppliers:", err);
    }
  }
}
