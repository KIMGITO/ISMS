import { toUserMessage } from "../utils/userError";
import { create } from "zustand";
import { useNotificationStore } from "./notificationStore";
import { Business } from "../types";
import { getSupabase } from "../services/supabaseClient";
import { SupabaseService } from "../services/supabaseService";
import { enabledMethods } from "../utils/paymentMethods";

interface BusinessState {
  businesses: Business[];
  activeBusinessId: string;
  addBusiness: (
    name: string,
    description?: string,
    address?: string,
    logoUrl?: string,
    businessType?: string,
    country?: string,
    currency?: string,
    coverImageUrl?: string,
    contactEmail?: string,
    contactPhone?: string,
    timezone?: string,
    defaultPaymentMethods?: string[]
  ) => Promise<Business | null>;
  updateBusiness: (
    id: string,
    name: string,
    description?: string,
    address?: string,
    logoUrl?: string,
    businessType?: string,
    country?: string,
    currency?: string,
    coverImageUrl?: string,
    contactEmail?: string,
    contactPhone?: string,
    primaryColor?: string,
    secondaryColor?: string,
    isTaxEnabled?: boolean,
    taxPercentage?: number
  ) => Promise<void>;
  deleteBusiness: (id: string) => Promise<void>;
  setActiveBusinessId: (id: string) => void;
  setBusinesses: (businesses: Business[]) => void;
  integrationConfigs: Record<string, any>;
  fetchIntegrationConfig: (section: string) => Promise<any>;
  fetchAllIntegrationConfigs: () => Promise<Record<string, any>>;
  updateIntegrationConfig: (section: string, payload: any) => Promise<void>;
  /** Switches payment methods on and off for the active business (payments.configure). */
  setPaymentMethods: (methods: string[]) => Promise<void>;
}

const localBusinessesKey = "kkm_businesses_v1";
const localActiveBusinessIdKey = "kkm_active_business_id_v1";

const DEFAULT_BUSINESSES: Business[] = [];

// Settings (receipts, printers, SMS…) are kept on the device too, so a restart, a
// slow connection or being offline never falls back to defaults.
const configsKey = (businessId: string) => `kkm_integration_configs_v1_${businessId}`;
const getSavedConfigs = (businessId: string): Record<string, any> => {
  if (!businessId) return {};
  try {
    const saved = localStorage.getItem(configsKey(businessId));
    const parsed = saved ? JSON.parse(saved) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};
const saveConfigs = (businessId: string, configs: Record<string, any>) => {
  try {
    localStorage.setItem(configsKey(businessId), JSON.stringify(configs));
  } catch {
    /* storage full or blocked: the in-memory copy still works */
  }
};

const getSavedBusinesses = (): Business[] => {
  try {
    const saved = localStorage.getItem(localBusinessesKey);
    return saved ? JSON.parse(saved) : DEFAULT_BUSINESSES;
  } catch {
    return DEFAULT_BUSINESSES;
  }
};

const getSavedActiveBusinessId = (loadedBusinesses: Business[]): string => {
  try {
    const saved = localStorage.getItem(localActiveBusinessIdKey);
    if (saved && loadedBusinesses.some((b) => b.id === saved)) {
      return saved;
    }
    return loadedBusinesses[0]?.id || "";
  } catch {
    return loadedBusinesses[0]?.id || "";
  }
};

export const useBusinessStore = create<BusinessState>((set, get) => {
  const loadedBusinesses = getSavedBusinesses();
  const loadedActiveId = getSavedActiveBusinessId(loadedBusinesses);

  return {
    businesses: loadedBusinesses,
    activeBusinessId: loadedActiveId,
    integrationConfigs: getSavedConfigs(loadedActiveId),

    fetchIntegrationConfig: async (section: string) => {
      const { activeBusinessId } = get();
      if (!activeBusinessId) return null;
      try {
        const config = await SupabaseService.fetchIntegrationConfig(activeBusinessId, section);
        if (get().activeBusinessId !== activeBusinessId) return config || {};
        const integrationConfigs = { ...get().integrationConfigs, [section]: config || {} };
        set({ integrationConfigs });
        saveConfigs(activeBusinessId, integrationConfigs);
        return config || {};
      } catch (err) {
        // Keep what we already have rather than dropping to defaults
        console.error(`Failed to fetch config for ${section}`, err);
        return get().integrationConfigs[section] || {};
      }
    },

    fetchAllIntegrationConfigs: async () => {
      const { activeBusinessId } = get();
      if (!activeBusinessId) return {};
      try {
        const configs = await SupabaseService.fetchAllIntegrationConfigs(activeBusinessId);
        if (get().activeBusinessId !== activeBusinessId) return configs; // switched business meanwhile
        set({ integrationConfigs: configs });
        saveConfigs(activeBusinessId, configs);
        return configs;
      } catch (err) {
        // Offline or a failed request: keep the saved settings, never fall back to defaults
        console.error(`Failed to fetch all integration configs`, err);
        return get().integrationConfigs;
      }
    },

    updateIntegrationConfig: async (section: string, payload: any) => {
      const { activeBusinessId } = get();
      if (!activeBusinessId) throw new Error("No active business");
      await SupabaseService.saveIntegrationConfig(activeBusinessId, section, payload);
      if (get().activeBusinessId !== activeBusinessId) return;
      const integrationConfigs = { ...get().integrationConfigs, [section]: payload };
      set({ integrationConfigs });
      saveConfigs(activeBusinessId, integrationConfigs);
    },

    setPaymentMethods: async (methods: string[]) => {
      const { activeBusinessId } = get();
      if (!activeBusinessId) throw new Error("No active business");
      const { data, error } = await getSupabase().rpc("set_payment_methods", {
        p_business_id: activeBusinessId,
        p_methods: methods,
      });
      if (error) throw error;
      const saved: string[] = Array.isArray(data) ? data : methods;
      const businesses = get().businesses.map((b) =>
        b.id === activeBusinessId ? { ...b, defaultPaymentMethods: saved } : b
      );
      localStorage.setItem(localBusinessesKey, JSON.stringify(businesses));
      set({ businesses });
    },

    addBusiness: async (
      name, description, address, logoUrl, businessType, country, currency,
      coverImageUrl, contactEmail, contactPhone, timezone, defaultPaymentMethods
    ) => {
      const current = get().businesses;
      if (current.length >= 5) {
        useNotificationStore.getState().showToast(
          "Business limit",
          "You can own up to 5 businesses.",
          undefined,
          "error"
        );
        return null;
      }

      const supabase = getSupabase();
      try {
        const { data: newBizId, error: rpcErr } = await supabase.rpc("create_business_with_owner", {
          p_name: name.trim(),
          p_type: businessType || "Retail",
          p_country: country || "Kenya",
          p_currency: currency || "Ksh",
          p_logo_url: logoUrl || "",
          p_description: description || `Dairy distribution center for ${name}`,
          p_address: address || ""
        });

        if (rpcErr) throw rpcErr;

        // Perform immediate update with extended parameters
        const { error: updateErr } = await supabase
          .from("businesses")
          .update({
            cover_image_url: coverImageUrl || null,
            contact_email: contactEmail || null,
            contact_phone: contactPhone || null,
            timezone: timezone || "Africa/Nairobi",
            default_payment_methods: enabledMethods(defaultPaymentMethods)
          })
          .eq("id", newBizId);

        if (updateErr) throw updateErr;

        // Initialize defaults in settings tables
        await supabase.from("receipt_settings").insert({ business_id: newBizId }).select();
        await supabase.from("printer_settings").insert({ business_id: newBizId }).select();
        await supabase.from("sms_settings").insert({ business_id: newBizId }).select();
        await supabase.from("ai_settings").insert({ business_id: newBizId }).select();

        const newBiz: Business = {
          id: newBizId,
          name: name.trim(),
          description: description?.trim(),
          address: address?.trim(),
          logoUrl: logoUrl || "",
          businessType: businessType || "Retail",
          country: country || "Kenya",
          currency: currency || "Ksh",
          coverImageUrl: coverImageUrl || "",
          contactEmail: contactEmail || "",
          contactPhone: contactPhone || "",
          timezone: timezone || "Africa/Nairobi",
          defaultPaymentMethods: enabledMethods(defaultPaymentMethods)
        };

        const updated = [...current, newBiz];
        localStorage.setItem(localBusinessesKey, JSON.stringify(updated));
        set({ businesses: updated });

        // Switch to the newly created branch immediately
        get().setActiveBusinessId(newBizId);

        // Fetch to ensure full sync
        const fetchedBiz = await SupabaseService.fetchBusinesses();
        if (fetchedBiz && fetchedBiz.length > 0) {
          set({ businesses: fetchedBiz });
        }

        useNotificationStore.getState().showToast(
          "Business created",
          `${name} is ready.`,
          undefined,
          "success"
        );

        return newBiz;
      } catch (err: any) {
        useNotificationStore.getState().showToast(
          "Error",
          toUserMessage(err, "Failed to configure business workspace."),
          undefined,
          "error"
        );
        return null;
      }
    },

    updateBusiness: async (
      id,
      name,
      description,
      address,
      logoUrl,
      businessType,
      country,
      currency,
      coverImageUrl,
      contactEmail,
      contactPhone,
      primaryColor,
      secondaryColor,
      isTaxEnabled,
      taxPercentage
    ) => {
      const supabase = getSupabase();
      try {
        const payload = {
          name: name.trim(),
          description: description?.trim(),
          address: address?.trim(),
          logo_url: logoUrl || "",
          business_type: businessType || "Retail",
          country: country || "Kenya",
          currency: currency || "Ksh",
          cover_image_url: coverImageUrl || "",
          contact_email: contactEmail || "",
          contact_phone: contactPhone || "",
          primary_color: primaryColor || "",
          secondary_color: secondaryColor || "",
          is_tax_enabled: isTaxEnabled === true,
          tax_percentage: typeof taxPercentage === 'number' ? taxPercentage : 16.0
        };

        const { error } = await supabase.from("businesses").update(payload).eq("id", id);
        if (error) throw error;

        const updated = get().businesses.map((b) =>
          b.id === id ? { 
            ...b, 
            name: name.trim(), 
            description: description?.trim(), 
            address: address?.trim(),
            logoUrl: logoUrl || "",
            businessType: businessType || "Retail",
            country: country || "Kenya",
            currency: currency || "Ksh",
            coverImageUrl: coverImageUrl || "",
            contactEmail: contactEmail || "",
            contactPhone: contactPhone || "",
            primaryColor: primaryColor || "",
            secondaryColor: secondaryColor || "",
            isTaxEnabled: isTaxEnabled === true,
            taxPercentage: typeof taxPercentage === 'number' ? taxPercentage : 16.0
          } : b
        );
        localStorage.setItem(localBusinessesKey, JSON.stringify(updated));
        set({ businesses: updated });

        useNotificationStore.getState().showToast(
          "Business updated",
          "Business details saved.",
          undefined,
          "success"
        );
      } catch (err: any) {
        useNotificationStore.getState().showToast(
          "Error",
          toUserMessage(err, "Failed to update business."),
          undefined,
          "error"
        );
      }
    },

    deleteBusiness: async (id) => {
      const current = get().businesses;
      if (current.length <= 1) {
        useNotificationStore.getState().showToast(
          "Not allowed",
          "You need at least one open business.",
          undefined,
          "error"
        );
        return;
      }

      const supabase = getSupabase();
      try {
        const { error } = await supabase.from("businesses").delete().eq("id", id);
        if (error) throw error;

        const updated = current.filter((b) => b.id !== id);
        localStorage.setItem(localBusinessesKey, JSON.stringify(updated));

        let nextActiveId = get().activeBusinessId;
        if (nextActiveId === id) {
          nextActiveId = updated[0].id;
          localStorage.setItem(localActiveBusinessIdKey, nextActiveId);
        }

        set({
          businesses: updated,
          activeBusinessId: nextActiveId,
          ...(nextActiveId !== get().activeBusinessId ? { integrationConfigs: getSavedConfigs(nextActiveId) } : {}),
        });

        useNotificationStore.getState().showToast(
          "Business removed",
          "The business is closed.",
          undefined,
          "info"
        );
      } catch (err: any) {
        useNotificationStore.getState().showToast(
          "Error",
          toUserMessage(err, "Failed to delete business."),
          undefined,
          "error"
        );
      }
    },

    setActiveBusinessId: (id) => {
      localStorage.setItem(localActiveBusinessIdKey, id);
      // The sign-in reload picks the branch from this key; keep it on the branch now open.
      if (id) localStorage.setItem("kkm_current_business_id_v2", id);
      if (id === get().activeBusinessId) return;
      // Each business has its own settings: show its saved copy straight away, then refresh
      set({ activeBusinessId: id, integrationConfigs: getSavedConfigs(id) });
      get().fetchAllIntegrationConfigs().catch(() => {});
    },
    setBusinesses: (businesses) => {
      localStorage.setItem(localBusinessesKey, JSON.stringify(businesses));
      set({ businesses });
    }
  };
});

/**
 * Runs `fn` with the new branch id whenever the active branch changes (and not on other
 * business-store updates, like settings being refreshed). Returns the unsubscribe.
 */
export function onBranchChange(fn: (businessId: string) => void): () => void {
  let last = useBusinessStore.getState().activeBusinessId;
  return useBusinessStore.subscribe((state) => {
    if (state.activeBusinessId === last) return;
    last = state.activeBusinessId;
    fn(last);
  });
}
