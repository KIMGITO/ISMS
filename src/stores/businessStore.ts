import { create } from "zustand";
import { useNotificationStore } from "./notificationStore";
import { Business } from "../types";
import { getSupabase } from "../services/supabaseClient";
import { SupabaseService } from "../services/supabaseService";

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
}

const localBusinessesKey = "kkm_businesses_v1";
const localActiveBusinessIdKey = "kkm_active_business_id_v1";

const DEFAULT_BUSINESSES: Business[] = [];

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
    integrationConfigs: {},

    fetchIntegrationConfig: async (section: string) => {
      const { activeBusinessId } = get();
      if (!activeBusinessId) return null;
      try {
        const config = await SupabaseService.fetchIntegrationConfig(activeBusinessId, section);
        set((state) => ({
          integrationConfigs: {
            ...state.integrationConfigs,
            [section]: config || {}
          }
        }));
        return config || {};
      } catch (err) {
        console.error(`Failed to fetch config for ${section}`, err);
        return {};
      }
    },

    fetchAllIntegrationConfigs: async () => {
      const { activeBusinessId } = get();
      if (!activeBusinessId) return {};
      try {
        const configs = await SupabaseService.fetchAllIntegrationConfigs(activeBusinessId);
        set({ integrationConfigs: configs });
        return configs;
      } catch (err) {
        console.error(`Failed to fetch all integration configs`, err);
        return {};
      }
    },

    updateIntegrationConfig: async (section: string, payload: any) => {
      const { activeBusinessId } = get();
      if (!activeBusinessId) throw new Error("No active business");
      await SupabaseService.saveIntegrationConfig(activeBusinessId, section, payload);
      set((state) => ({
        integrationConfigs: {
          ...state.integrationConfigs,
          [section]: payload
        }
      }));
    },

    addBusiness: async (
      name, description, address, logoUrl, businessType, country, currency,
      coverImageUrl, contactEmail, contactPhone, timezone, defaultPaymentMethods
    ) => {
      const current = get().businesses;
      if (current.length >= 5) {
        useNotificationStore.getState().showToast(
          "Business Limit",
          "You can own a maximum of 5 businesses at a time.",
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
            default_payment_methods: defaultPaymentMethods || ["Cash", "M-Pesa"]
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
          defaultPaymentMethods: defaultPaymentMethods || ["Cash", "M-Pesa"]
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
          "Business Created",
          `New business "${name}" successfully setup.`,
          undefined,
          "success"
        );

        return newBiz;
      } catch (err: any) {
        useNotificationStore.getState().showToast(
          "Error",
          err.message || "Failed to configure business workspace.",
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
          is_tax_enabled: isTaxEnabled !== false,
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
            isTaxEnabled: isTaxEnabled !== false,
            taxPercentage: typeof taxPercentage === 'number' ? taxPercentage : 16.0
          } : b
        );
        localStorage.setItem(localBusinessesKey, JSON.stringify(updated));
        set({ businesses: updated });

        useNotificationStore.getState().showToast(
          "Business Updated",
          "Business details successfully saved.",
          undefined,
          "success"
        );
      } catch (err: any) {
        useNotificationStore.getState().showToast(
          "Error",
          err.message || "Failed to update business.",
          undefined,
          "error"
        );
      }
    },

    deleteBusiness: async (id) => {
      const current = get().businesses;
      if (current.length <= 1) {
        useNotificationStore.getState().showToast(
          "Operation Blocked",
          "You must retain at least one active business.",
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
          activeBusinessId: nextActiveId
        });

        useNotificationStore.getState().showToast(
          "Business Removed",
          "The business and its associated viewpoint have been closed.",
          undefined,
          "info"
        );
      } catch (err: any) {
        useNotificationStore.getState().showToast(
          "Error",
          err.message || "Failed to delete business.",
          undefined,
          "error"
        );
      }
    },

    setActiveBusinessId: (id) => {
      localStorage.setItem(localActiveBusinessIdKey, id);
      set({ activeBusinessId: id });
    },
    setBusinesses: (businesses) => {
      localStorage.setItem(localBusinessesKey, JSON.stringify(businesses));
      set({ businesses });
    }
  };
});
