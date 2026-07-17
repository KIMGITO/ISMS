// src/services/configManager.ts

export type AppEnvironment = "Development" | "Staging" | "Production" | "Developer Mode";

export interface EnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  environmentName: AppEnvironment;
}

const DEFAULT_URL = import.meta.env?.VITE_SUPABASE_URL || "https://your-project.supabase.co";
const DEFAULT_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || "your-anon-key";

// Build configuration bundled backends
const ENV_CONFIGS: Record<AppEnvironment, EnvConfig> = {
  Production: {
    supabaseUrl: import.meta.env?.VITE_SUPABASE_URL_PROD || DEFAULT_URL,
    supabaseAnonKey: import.meta.env?.VITE_SUPABASE_ANON_KEY_PROD || DEFAULT_ANON_KEY,
    environmentName: "Production",
  },
  Staging: {
    supabaseUrl: import.meta.env?.VITE_SUPABASE_URL_STAGING || DEFAULT_URL,
    supabaseAnonKey: import.meta.env?.VITE_SUPABASE_ANON_KEY_STAGING || DEFAULT_ANON_KEY,
    environmentName: "Staging",
  },
  Development: {
    supabaseUrl: import.meta.env?.VITE_SUPABASE_URL_DEV || DEFAULT_URL,
    supabaseAnonKey: import.meta.env?.VITE_SUPABASE_ANON_KEY_DEV || DEFAULT_ANON_KEY,
    environmentName: "Development",
  },
  "Developer Mode": {
    supabaseUrl: import.meta.env?.VITE_SUPABASE_URL_DEV_MODE || DEFAULT_URL,
    supabaseAnonKey: import.meta.env?.VITE_SUPABASE_ANON_KEY_DEV_MODE || DEFAULT_ANON_KEY,
    environmentName: "Developer Mode",
  }
};

class ConfigManager {
  private activeEnv: AppEnvironment = "Production";

  constructor() {
    this.initEnvironment();
  }

  private initEnvironment() {
    // 1. Determine env based on build configuration
    const envMode = import.meta.env?.MODE || "production";
    if (envMode === "development") {
      this.activeEnv = "Development";
    } else if (envMode === "staging") {
      this.activeEnv = "Staging";
    } else {
      this.activeEnv = "Production";
    }

    // 2. Check for manual override (Developer Mode) in localStorage
    if (typeof localStorage !== "undefined") {
      const savedEnv = localStorage.getItem("kkm_active_env") as AppEnvironment;
      if (savedEnv && ["Development", "Staging", "Production", "Developer Mode"].includes(savedEnv)) {
        this.activeEnv = savedEnv;
      }
    }
  }

  public getActiveEnvironment(): AppEnvironment {
    return this.activeEnv;
  }

  public setEnvironment(env: AppEnvironment) {
    this.activeEnv = env;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("kkm_active_env", env);
    }
  }

  public getConfig(): EnvConfig {
    return ENV_CONFIGS[this.activeEnv] || ENV_CONFIGS.Production;
  }
}

export const configManager = new ConfigManager();
export default configManager;
