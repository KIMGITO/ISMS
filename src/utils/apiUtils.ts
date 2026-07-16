// src/utils/apiUtils.ts
import { nativePlatformService } from "../core/native/NativePlatformService";
import { configManager } from "../services/configManager";

export const getApiUrl = (path: string): string => {
  if (typeof localStorage !== "undefined") {
    const storedApiUrl = localStorage.getItem("kkm_api_url");
    if (storedApiUrl) {
      return `${storedApiUrl.replace(/\/$/, "")}${path}`;
    }
  }

  const env = (import.meta as any).env || {};
  const envApiUrl = env.VITE_API_URL;
  if (envApiUrl) {
    return `${envApiUrl.replace(/\/$/, "")}${path}`;
  }

  const appUrl = env.APP_URL;
  if (appUrl) {
    return `${appUrl.replace(/\/$/, "")}${path}`;
  }

  // Handle native Capacitor context. Use Supabase URL if configured, otherwise fallback to loopback/development host.
  if (nativePlatformService.isNative()) {
    const supabaseUrl = configManager.getConfig()?.supabaseUrl;
    if (supabaseUrl) {
      return `${supabaseUrl.replace(/\/$/, "")}${path}`;
    }
    if (nativePlatformService.isAndroid()) {
      // Loopback address mapping to developer host machine
      return `http://10.0.2.2:3000${path}`;
    }
    return `http://localhost:3000${path}`;
  }

  if (typeof window !== "undefined" && window.location) {
    const origin = window.location.origin;
    // Don't treat local assets origin as production endpoint host
    if (origin && origin.startsWith("http") && !origin.includes("localhost")) {
      return `${origin}${path}`;
    }
  }

  return `http://localhost:3000${path}`;
};

export const safeFetch = async (url: string, options?: RequestInit) => {
  const res = await fetch(url, options);
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    throw new Error("Network routing error: Received HTML instead of JSON API response");
  }
  return res;
};
