import { useSystemHealthStore } from "../stores/systemHealthStore";
import { useAuthStore } from "../stores/authStore";
import { useNotificationStore } from "../stores/notificationStore";
import { networkService } from "./networkService";
import { configManager } from "./configManager";
import { getSupabase } from "./supabaseClient";

export class SystemHealthService {
  private static checkIntervalId: any = null;

  /**
   * Starts the background health checking loop
   */
  public static start() {
    if (this.checkIntervalId) return;

    // Run first check immediately
    this.checkAll();

    // Setup periodic check every 30 seconds
    this.checkIntervalId = setInterval(() => {
      this.checkAll();
    }, 30000);
  }

  /**
   * Stops the background health checking loop
   */
  public static stop() {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }
  }

  /**
   * Runs all health checks
   */
  public static async checkAll() {
    const store = useSystemHealthStore.getState();
    const auth = useAuthStore.getState();

    // 1. Internet Status
    const isOnline = networkService.isOnline();
    const internetStatus = isOnline ? "Online" : "Offline";

    // 2. Database Status (Supabase)
    let dbStatus: "Connected" | "Connecting" | "Offline" | "Error" = "Connecting";
    let dbErrorMsg: string | null = null;

    if (!isOnline) {
      dbStatus = "Offline";
      dbErrorMsg = "Local cache operations active (Offline).";
    } else {
      try {
        const config = configManager.getConfig();
        const url = config.supabaseUrl;

        if (!url || url.includes("your-project.supabase.co") || url.includes("your-supabase-project")) {
          dbStatus = "Error";
          dbErrorMsg = "Supabase connection is unconfigured or using placeholder values.";
        } else {
          const supabase = getSupabase();
          // Perform a fast, lightweight query to check availability
          const { error } = await supabase.from("businesses").select("id").limit(1);
          if (error) {
            dbStatus = "Error";
            dbErrorMsg = `Supabase Error: ${error.message}`;
          } else {
            dbStatus = "Connected";
          }
        }
      } catch (err: any) {
        dbStatus = "Error";
        dbErrorMsg = err.message || "Failed to reach Supabase database.";
      }
    }

    // 3. AI Service Status
    let aiStatus: "Online" | "Offline" | "Error" | "Connecting" = "Connecting";
    let aiErrorMsg: string | null = null;

    if (!isOnline) {
      aiStatus = "Offline";
      aiErrorMsg = "AI Workspace Assistant requires internet connectivity.";
    } else {
      try {
        const response = await fetch("/api/health");
        if (response.ok) {
          const data = await response.json();
          if (data.aiAvailable) {
            aiStatus = "Online";
          } else {
            aiStatus = "Offline";
            aiErrorMsg = "Gemini API key is unconfigured on the server.";
          }
        } else {
          aiStatus = "Offline";
          aiErrorMsg = "AI Workspace Assistant server endpoint returned an error status.";
        }
      } catch (err: any) {
        aiStatus = "Error";
        aiErrorMsg = err.message || "Failed to contact local AI agent route.";
      }
    }

    // 4. Session Status (Authentication Buffer & Validity)
    let sessionStatus: "Logged In" | "Logged Out" | "Session Expired" | "Connecting" | "Error" = "Connecting";
    let sessionErrorMsg: string | null = null;

    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        const wasLoggedIn = localStorage.getItem("kkm_current_user_id_v2");
        sessionStatus = wasLoggedIn ? "Session Expired" : "Logged Out";
        sessionErrorMsg = wasLoggedIn ? "Your session has expired. Please log in again." : "No active session.";
      } else {
        sessionStatus = "Logged In";
      }
    } catch (err: any) {
      sessionStatus = "Error";
      sessionErrorMsg = err.message || "Failed to retrieve active session.";
    }

    // Broadcast status updates globally to the store
    store.setStatuses({
      dbStatus,
      internetStatus,
      aiStatus,
      sessionStatus,
      dbErrorMsg,
      aiErrorMsg,
      sessionErrorMsg,
      lastCheckedAt: new Date().toISOString()
    });
  }

  /**
   * Verifies a set of dependencies before performing an action requiring backend access.
   * Prevents the action and shows a descriptive toast notification if any dependency fails.
   */
  public static verifyDependencies(deps: ("internet" | "db" | "auth" | "ai")[]): boolean {
    const health = useSystemHealthStore.getState();
    const showToast = useNotificationStore.getState().showToast;

    for (const dep of deps) {
      if (dep === "internet" && health.internetStatus === "Offline") {
        showToast(
          "Internet Connection Unavailable",
          "No internet connection. Please verify your Wi-Fi or cellular data and try again.",
          undefined,
          "error"
        );
        return false;
      }
      if (dep === "db" && health.dbStatus !== "Connected") {
        const errorDetail = health.dbErrorMsg || "The database could not be reached.";
        showToast(
          "Database Connection Lost",
          `Database is currently offline: ${errorDetail}`,
          undefined,
          "error"
        );
        return false;
      }
      if (dep === "auth" && health.sessionStatus !== "Logged In") {
        const errorDetail = health.sessionErrorMsg || "Session expired or offline buffer exceeded.";
        showToast(
          "Authentication Expired",
          `Access Denied: ${errorDetail}`,
          undefined,
          "error"
        );
        return false;
      }
      if (dep === "ai" && health.aiStatus !== "Online") {
        const errorDetail = health.aiErrorMsg || "AI services are currently unavailable.";
        showToast(
          "AI Service Unavailable",
          `AI Assistant Error: ${errorDetail}`,
          undefined,
          "error"
        );
        return false;
      }
    }

    return true;
  }
}
