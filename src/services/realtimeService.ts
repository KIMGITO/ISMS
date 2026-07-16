// src/services/realtimeService.ts
import { isSupabaseConfigured, getSupabase } from "./supabaseClient";
import { useBusinessStore } from "../stores/businessStore";
import { NotificationRepository } from "./notifications/notificationRepository";
import { SupabaseService } from "./supabaseService";

class RealtimeService {
  private channels: any[] = [];

  constructor() {
    this.initRealtimeSubscriptions();
  }

  public initRealtimeSubscriptions() {
    if (typeof global !== "undefined" && (global as any).IS_TEST) {
      return;
    }

    if (!isSupabaseConfigured()) {
      console.log("Supabase is not configured yet. Realtime channels will activate once configured.");
      return;
    }

    // Clear any previous channels
    this.unsubscribeAll();

    const supabase = getSupabase();
    const tables = ["products", "transactions", "customers", "notifications", "integration_configurations", "businesses"];

    tables.forEach((table) => {
      const channelName = `realtime-${table}-sync-trigger`;

      // Clean up any existing duplicate channel with this name from the Supabase client cache
      const existing = supabase.getChannels().find(
        (ch) => ch.topic === channelName || ch.topic === `realtime:${channelName}`
      );
      if (existing) {
        console.log(`Removing existing duplicate channel for table "${table}":`, existing.topic);
        supabase.removeChannel(existing);
      }

      console.log(`Subscribing to Supabase Realtime channel for table: ${table}`);
      const channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: table },
          (payload) => {
            console.log(`Realtime event intercepted for table "${table}":`, payload.eventType);
            
            // Only fetch the specific table that changed, avoiding global sync storms
            if (table === "notifications") {
              const activeBizId = useBusinessStore.getState().activeBusinessId;
              if (activeBizId) {
                NotificationRepository.loadFromSupabase(activeBizId).catch(console.error);
              }
            } else if (table === "integration_configurations") {
              useBusinessStore.getState().fetchAllIntegrationConfigs().catch(console.error);
            } else if (table === "businesses") {
              SupabaseService.fetchBusinesses().then((fetchedBiz) => {
                if (fetchedBiz && fetchedBiz.length > 0) {
                  useBusinessStore.getState().setBusinesses(fetchedBiz);
                }
              }).catch(console.error);
            }
          }
        )
        .subscribe((status) => {
          console.log(`Realtime subscription status for "${table}":`, status);
        });

      this.channels.push(channel);
    });
  }

  public unsubscribeAll() {
    const supabase = isSupabaseConfigured() ? getSupabase() : null;
    if (supabase && this.channels.length > 0) {
      this.channels.forEach((channel) => {
        supabase.removeChannel(channel);
      });
      this.channels = [];
    }
  }
}

export const realtimeService = new RealtimeService();
export default realtimeService;
