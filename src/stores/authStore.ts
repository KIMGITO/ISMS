// src/stores/authStore.ts
import { create } from "zustand";
import { User, Business, BusinessMembership, Invitation, Employee, Shift, EmployeeRole } from "../types";
import { useBusinessStore } from "./businessStore";
import { useNotificationStore } from "./notificationStore";
import { isSupabaseConfigured, getSupabase } from "../services/supabaseClient";
import { SupabaseService } from "../services/supabaseService";
import { getApiUrl, safeFetch } from "../utils/apiUtils";
import { EmailService } from "../services/emailService";
import { realtimeService } from "../services/realtimeService";
import { ProductRepository, TransactionRepository, CustomerRepository, ExpenseRepository, ExpenseCategoryRepository, InventoryAdjustmentRepository } from "../services/repositories";
import { useCartStore } from "./cartStore";
import { useUiStore } from "./uiStore";
import { useExtraModulesStore } from "./extraModulesStore";
import { PermissionCode, ALL_PERMISSIONS } from "../utils/permissions";
import { toUuid } from "../utils/idUtils";
import { formatToE164 } from "../utils/phoneUtils";

interface AuthState {
  // Existing state for backwards compatibility
  employees: Employee[];
  currentEmployee: Employee | null;
  activeShift: Shift | null;
  shifts: Shift[];
  login: (pin: string) => boolean;
  logout: () => void;
  punchIn: () => void;
  punchOut: () => void;
  toggleTask: (taskId: string) => void;
  updateEmployeePin: (employeeId: string, newPin: string) => void;
  addShiftSale: (finalTotal: number) => void;
  createWorker: (worker: { name: string; email: string; phone: string; role: string; avatar?: string; assignedBranches?: string[] }) => void;
  deleteWorker: (id: string) => Promise<void>;
  setupNewWorkerPin: (emailOrPhone: string, pin: string) => { success: boolean; error?: string; employee?: Employee };
  updateProfile: (id: string, updates: { name: string; email: string; phone: string; pin?: string; avatar?: string; role?: any; assignedBranches?: string[] }) => Promise<void>;
  setEmployees: (employees: Employee[]) => void;

  // New Online Auth & Onboarding state
  users: User[];
  memberships: BusinessMembership[];
  invitations: Invitation[];
  currentUser: User | null;
  currentBusinessId: string | null;
  emailVerificationCode: string | null;
  ownerExists: boolean;

  // New Actions
  checkOwnerExists: () => Promise<boolean>;
  signUpOwner: (name: string, email: string, phone: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  verifyEmailCode: (email: string, code: string) => Promise<{ success: boolean; error?: string }>;
  createBusinessWithOwner: (name: string, type: string, country: string, currency: string, logoUrl?: string, description?: string, address?: string) => Promise<{ success: boolean; error?: string }>;
  loginOnline: (emailOrPhone: string, password?: string) => Promise<{ success: boolean; error?: string; emailConfirmRequired?: boolean }>;
  inviteUser: (name: string, email: string, phone: string, role: EmployeeRole, optionalMessage?: string) => Promise<{ success: boolean; error?: string; invitation?: Invitation }>;
  verifyInvitation: (token: string) => Promise<{ success: boolean; error?: string; invitation?: Invitation }>;
  acceptInvitation: (token: string, password?: string, name?: string, phone?: string) => Promise<{ success: boolean; error?: string; requiresLogin?: boolean }>;
  switchBusiness: (businessId: string) => void;
  revokeInvitation: (id: string) => void;
  initializeAuthStateListener: () => (() => void);
  hydrateAuthSessionData: (authUser: any, force?: boolean) => Promise<void>;
  isInitializing: boolean;
  isHydrating: boolean;
  initializationError: string | null;
  performInitialization: () => Promise<void>;
  sendPasswordResetOtp: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyPasswordResetOtp: (email: string, code: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (password: string) => Promise<{ success: boolean; error?: string }>;
  updateEmailDuringVerification: (newEmail: string) => Promise<{ success: boolean; error?: string }>;
  dbPermissions: { role: string; permission: string; granted: boolean }[];
  loadPermissionsFromDatabase: () => Promise<void>;
  saveRolePermissions: (role: string, permissions: PermissionCode[]) => Promise<void>;
}

// Helpers to compute backward-compatible operator values
const computeCurrentEmployee = (
  user: User | null,
  bizId: string | null,
  membershipsList: BusinessMembership[],
  activeShiftObj: Shift | null
): Employee | null => {
  if (!user || !bizId) return null;
  const membership = membershipsList.find((m) => m.userId === user.id && m.businessId === bizId);
  if (!membership) return null;

  return {
    id: user.id,
    name: user.name,
    role: membership.role,
    email: user.email,
    phone: user.phone,
    pin: "", // PIN authentication is obsolete
    activeShiftId: activeShiftObj?.id || null,
    avatar: user.avatar || "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E",
    assignedBranches: [bizId],
    tasks: [
      { id: "task-1", text: "Reconcile daily milk stock counts", completed: false },
      { id: "task-2", text: "Verify cash and mobile checkout transactions", completed: true }
    ]
  };
};

const computeEmployeesList = (bizId: string | null, usersList: User[], membershipsList: BusinessMembership[]): Employee[] => {
  if (!bizId) return [];
  const activeMemberships = membershipsList.filter((m) => m.businessId === bizId && m.status === "Active");
  return activeMemberships.map((m) => {
    const user = usersList.find((u) => u.id === m.userId);
    return {
      id: user?.id || `usr-${m.id}`,
      name: user?.name || "Unknown Operator",
      role: m.role,
      email: user?.email || "",
      phone: user?.phone || "",
      pin: "",
      activeShiftId: null,
      avatar: user?.avatar || "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E",
      assignedBranches: [bizId],
      tasks: []
    };
  });
};

export const useAuthStore = create<AuthState>((set, get) => {
  let unsubPerms: (() => void) | null = null;
  let unsubMembership: (() => void) | null = null;

  return {
    // Basic state
    users: [],
    memberships: [],
    invitations: [],
    currentUser: null,
    currentBusinessId: null,
    emailVerificationCode: null,
    ownerExists: true,
    isInitializing: true,
    isHydrating: false,
    initializationError: null,
    dbPermissions: [],

    // Backward-compatible properties
    employees: [],
    currentEmployee: null,
    activeShift: null,
    shifts: [],

     // Check if any owner account exists in Supabase
    checkOwnerExists: async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc("check_owner_exists");
        if (error) throw error;
        set({ ownerExists: !!data });
        return !!data;
      } catch (err) {
        console.error("Failed to check owner existence:", err);
        return true; // Graceful fallback
      }
    },

    performInitialization: async () => {
      set({ isInitializing: true, initializationError: null });
      const supabase = getSupabase();

      // Create a promise that rejects after 10 seconds
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Connection timed out. Please check your internet connection or server status and try again.")), 10000)
      );

      try {
        await Promise.race([
          (async () => {
            let user = null;
            try {
              const { data } = await supabase.auth.getUser();
              user = data?.user;
            } catch (e) {
              console.warn("Failed to get authenticated user during init:", e);
            }

            if (user) {
              await get().hydrateAuthSessionData(user);
            } else {
              localStorage.removeItem("kkm_current_user_id_v2");
              const { data: ownerData, error: ownerErr } = await supabase.rpc("check_owner_exists");
              if (ownerErr) throw ownerErr;
              set({ ownerExists: !!ownerData });
            }
          })(),
          timeoutPromise
        ]);
        set({ isInitializing: false, initializationError: null });
      } catch (err: any) {
        console.error("Failed to initialize authentication:", err);
        set({
          isInitializing: false,
          initializationError: err.message || "Failed to initialize application connection."
        });
      }
    },

    // Initialize Auth state change listener
    initializeAuthStateListener: () => {
      const supabase = getSupabase();
      
      // Load initial session
      get().performInitialization();

      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        console.log("Supabase Auth Event:", event);
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          if (session?.user) {
            await get().hydrateAuthSessionData(session.user);
          }
        } else if (event === "SIGNED_OUT") {
          // Clear cached state
          set({
            currentUser: null,
            currentEmployee: null,
            currentBusinessId: null,
            memberships: [],
            users: [],
            employees: [],
            activeShift: null,
            shifts: []
          });
          await get().checkOwnerExists();
          set({ isInitializing: false });
        }
      });

      return () => {
        subscription.unsubscribe();
      };
    },

    // Hydrate all user, membership, and business settings once authenticated
    hydrateAuthSessionData: async (authUser, force = false) => {
      if (get().isHydrating) {
        console.log("[AuthStore] Hydration already in progress, skipping.");
        return;
      }
      
      const currentUser = get().currentUser;
      if (!force && currentUser && currentUser.id === authUser.id && currentUser.email === authUser.email) {
        console.log("[AuthStore] Session already hydrated for user:", authUser.id);
        return;
      }

      set({ isHydrating: true });
      try {
        const supabase = getSupabase();

        // 1. Fetch user profile
        const { data: profile, error: profileErr } = await supabase
          .from("users")
          .select("*")
          .eq("auth_user_id", authUser.id)
          .maybeSingle();

        if (profileErr) throw profileErr;
        
        let activeProfile = profile;
        if (!profile) {
          // Fallback user profile creation in case trigger delay
          const { data: newProfile, error: insErr } = await supabase
            .from("users")
            .insert({
              auth_user_id: authUser.id,
              name: authUser.user_metadata?.name || authUser.email?.split("@")[0] || "User",
              email: authUser.email,
              phone: authUser.user_metadata?.phone || authUser.phone || "",
              is_verified: authUser.email_confirmed_at ? true : false
            })
            .select()
            .single();

          if (insErr) throw insErr;
          activeProfile = newProfile;
        }

        const mappedUser: User = {
          id: activeProfile.id,
          name: activeProfile.name,
          email: activeProfile.email,
          phone: activeProfile.phone || "",
          avatar: activeProfile.avatar || "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E",
          isVerified: activeProfile.is_verified || false
        };

        // 2. Fetch memberships
        const { data: memsData, error: memsErr } = await supabase
          .from("business_memberships")
          .select("*")
          .eq("user_id", mappedUser.id)
          .eq("status", "Active");

        if (memsErr) throw memsErr;

        const mappedMems: BusinessMembership[] = (memsData || []).map(m => ({
          id: m.id,
          businessId: m.business_id,
          userId: m.user_id,
          role: m.role,
          status: m.status,
          joinedAt: m.joined_at
        }));

        // 3. Resolve active business ID
        let activeBizId = localStorage.getItem("kkm_current_business_id_v2");
        if (mappedMems.length > 0) {
          const hasActive = mappedMems.some(m => m.businessId === activeBizId);
          if (!hasActive || !activeBizId) {
            activeBizId = mappedMems[0].businessId;
            localStorage.setItem("kkm_current_business_id_v2", activeBizId);
          }
          useBusinessStore.getState().setActiveBusinessId(activeBizId);
        } else {
          activeBizId = null;
        }

        // 4. Hydrate team member lists if active business is resolved
        let teamUsers: User[] = [mappedUser];
        let bizMemberships: BusinessMembership[] = mappedMems;

        if (activeBizId) {
          const { data: teamMems, error: teamMemsErr } = await supabase
            .from("business_memberships")
            .select("*")
            .eq("business_id", activeBizId)
            .eq("status", "Active");

          if (!teamMemsErr && teamMems) {
            bizMemberships = teamMems.map(m => ({
              id: m.id,
              businessId: m.business_id,
              userId: m.user_id,
              role: m.role,
              status: m.status,
              joinedAt: m.joined_at
            }));

            const userIds = teamMems.map(m => m.user_id);
            const { data: teamUsersData, error: teamUsersErr } = await supabase
              .from("users")
              .select("*")
              .in("id", userIds);

            if (!teamUsersErr && teamUsersData) {
              teamUsers = teamUsersData.map(u => ({
                id: u.id,
                name: u.name,
                email: u.email,
                phone: u.phone || "",
                avatar: u.avatar || "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E",
                isVerified: u.is_verified || false
              }));
            }
          }

          // Fetch invitations
          const { data: invitesData } = await supabase
            .from("invitations")
            .select("*")
            .eq("business_id", activeBizId);
          if (invitesData) {
            set({
              invitations: invitesData.map(i => ({
                id: i.id,
                businessId: i.business_id,
                name: i.name,
                email: i.email || "",
                phone: i.phone || "",
                role: i.role,
                invitationToken: i.invitation_token,
                expiresAt: i.expires_at,
                status: i.status,
                invitedBy: i.invited_by || ""
              }))
            });
          }
        }

        // Set auth state
        set({
          currentUser: mappedUser,
          currentBusinessId: activeBizId,
          memberships: mappedMems,
          users: teamUsers,
          employees: computeEmployeesList(activeBizId, teamUsers, bizMemberships),
          currentEmployee: computeCurrentEmployee(mappedUser, activeBizId, mappedMems, get().activeShift)
        });

        // Set local storage for fast session restoration check
        localStorage.setItem("kkm_current_user_id_v2", mappedUser.id);

        // Load database permissions
        await get().loadPermissionsFromDatabase();

        // Subscribe to real-time changes on role_permissions table
        if (unsubPerms) unsubPerms();
        if (activeBizId) {
          const filterString = `business_id=eq.${toUuid(activeBizId)}`;
          const channel = supabase
            .channel("realtime-role-permissions")
            .on(
              "postgres_changes",
              { event: "*", schema: "public", table: "role_permissions", filter: filterString },
              () => {
                get().loadPermissionsFromDatabase();
              }
            )
            .subscribe();

          unsubPerms = () => {
            supabase.removeChannel(channel);
          };
        }

        // Subscribe to real-time changes on business_memberships table for current user
        if (unsubMembership) unsubMembership();
        if (mappedUser.id) {
          const userMemFilter = `user_id=eq.${toUuid(mappedUser.id)}`;
          const memChannel = supabase
            .channel("realtime-user-membership")
            .on(
              "postgres_changes",
              { event: "*", schema: "public", table: "business_memberships", filter: userMemFilter },
              async (payload) => {
                console.log("[AuthStore] User membership real-time update:", payload);
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                  await get().hydrateAuthSessionData(user, true);
                }
              }
            )
            .subscribe();

          unsubMembership = () => {
            supabase.removeChannel(memChannel);
          };
        }

        // Initialize Realtime subscriptions
        realtimeService.initRealtimeSubscriptions();
      } catch (err) {
        console.error("Failed to hydrate auth session:", err);
        // Explicitly clear auth states and sign out if database validation fails
        set({
          currentUser: null,
          currentEmployee: null,
          currentBusinessId: null,
          memberships: [],
          users: [],
          employees: [],
          activeShift: null,
          shifts: []
        });
        const supabase = getSupabase();
        await supabase.auth.signOut().catch(console.error);
      } finally {
        set({ isHydrating: false });
      }
    },

    // PIN Authentication bypass (Obsolete)
    login: (pin) => {
      console.warn("Local PIN login is disabled. Use Supabase email/password login.");
      return false;
    },

    logout: async () => {
      if (unsubPerms) {
        unsubPerms();
        unsubPerms = null;
      }
      if (unsubMembership) {
        unsubMembership();
        unsubMembership = null;
      }

      try {
        const supabase = getSupabase();
        await supabase.auth.signOut();
      } catch (err) {
        console.error("Supabase signOut error:", err);
      }

      // Explicitly clear local variables and persistent storage caches
      localStorage.removeItem("kkm_current_user_id_v2");
      localStorage.removeItem("kkm_current_business_id_v2");
      localStorage.removeItem("kkm_businesses_v1");
      localStorage.removeItem("kkm_active_business_id_v1");
      localStorage.removeItem("kkm_ai_chat_history_v1");
      localStorage.removeItem("kkm_perm_search_target");
      localStorage.removeItem("kkm_calendar_collapsed");
      localStorage.removeItem("kkm_suggestions_collapsed");
      localStorage.removeItem("kkm_schedules_v1");
      localStorage.removeItem("kkm_feedback_comments_v1");
      localStorage.removeItem("kkm_purchases_v1");
      localStorage.removeItem("kkm_recipes_v1");
      localStorage.removeItem("kkm_production_v1");
      localStorage.removeItem("kkm_assets_v1");
      localStorage.removeItem("kkm_files_v1");
      localStorage.removeItem("kkm_audit_logs_v1");
      localStorage.removeItem("kkm_ai_insights_v1");
      localStorage.removeItem("kkm_payments_v1");
      localStorage.removeItem("kkm_notifications_list_v1");

      // Clear local repositories to prevent data leaking
      ProductRepository.setAll([]);
      TransactionRepository.setAll([]);
      CustomerRepository.setAll([]);
      ExpenseRepository.setAll([]);
      ExpenseCategoryRepository.setAll([]);
      InventoryAdjustmentRepository.setAll([]);

      // Clear other stores
      useBusinessStore.getState().setBusinesses([]);
      useBusinessStore.getState().setActiveBusinessId("");
      useCartStore.getState().clearCart();
      useCartStore.getState().selectCustomer(null);

      // Reset UI store state
      useUiStore.setState({
        showNav: true,
        selectedCustomerId: null,
        activeInvoiceData: null,
        activeTab: "home"
      });

      // Clear notification store state and notifications list
      useNotificationStore.getState().clearAllNotifications();

      // Clear extra modules store state
      useExtraModulesStore.setState({
        purchases: [],
        recipes: [],
        productionBatches: [],
        assets: [],
        storageFiles: [],
        auditLogs: [],
        aiInsights: [],
        payments: []
      });

      // Unsubscribe realtime channels
      realtimeService.unsubscribeAll();

      set({
        currentUser: null,
        currentEmployee: null,
        currentBusinessId: null,
        memberships: [],
        users: [],
        employees: [],
        activeShift: null,
        shifts: [],
        dbPermissions: []
      });

      useNotificationStore.getState().showToast(
        "Logged Out",
        "Your session has been terminated securely.",
        undefined,
        "info"
      );
    },

    // Owner Account Creation
    signUpOwner: async (name, email, phone, password) => {
      try {
        const supabase = getSupabase();

        // 1. SignUp through Supabase Auth
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password || "password",
          options: {
            data: {
              name: name.trim(),
              phone: formatToE164(phone)
            }
          }
        });

        if (error) throw error;

        // 2. Generate random 6-digit OTP code
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        // 3. Save OTP in DB via RPC
        const { error: rpcErr } = await supabase.rpc("save_otp", {
          p_email: email.trim(),
          p_code: otpCode,
          p_type: "signup"
        });
        if (rpcErr) throw rpcErr;

        // 4. Send Email via Edge Function
        await EmailService.sendVerificationCode(email.trim(), otpCode, name.trim());

        useNotificationStore.getState().showToast(
          "Verification Code Sent",
          `A 6-digit verification code has been sent to ${email}.`,
          undefined,
          "success"
        );

        set({ ownerExists: true });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || "Failed to sign up owner account." };
      }
    },

    // verifyEmailCode stub (Supabase Auth link-clicks verify the email directly)
    verifyEmailCode: async (email, code) => {
      try {
        const supabase = getSupabase();
        
        const { data: verified, error: rpcErr } = await supabase.rpc("verify_signup_otp", {
          p_email: email.trim(),
          p_code: code.trim()
        });

        if (rpcErr) throw rpcErr;

        if (!verified) {
          return { success: false, error: "Invalid or expired verification code." };
        }

        // Call sendWelcome email asynchronously as a background operation
        try {
          const { data: userProfile } = await supabase
            .from("users")
            .select("name")
            .eq("email", email.trim())
            .maybeSingle();
          
          const userName = userProfile?.name || "Owner";
          EmailService.sendWelcome(email.trim(), userName).catch(e => 
            console.error("Failed to send welcome email:", e)
          );
        } catch (welcomeErr) {
          console.error("Failed to trigger welcome email:", welcomeErr);
        }

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || "Failed to verify code." };
      }
    },

    // Create Business with Owner (via PostgreSQL RPC to bypass RLS dependencies)
    createBusinessWithOwner: async (name, type, country, currency, logoUrl, description, address) => {
      try {
        const supabase = getSupabase();
        
        const { data: newBizId, error: rpcErr } = await supabase.rpc("create_business_with_owner", {
          p_name: name.trim(),
          p_type: type,
          p_country: country,
          p_currency: currency,
          p_logo_url: logoUrl || "",
          p_description: description || `Dairy distribution center for ${name}`,
          p_address: address || `${country} Outlet`
        });

        if (rpcErr) throw rpcErr;

        // Force hydration refresh
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          localStorage.setItem("kkm_current_business_id_v2", newBizId);
          await get().hydrateAuthSessionData(user);
        }

        useNotificationStore.getState().showToast(
          "Business Setup Complete",
          `Welcome to ${name} command center!`,
          undefined,
          "success"
        );

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || "Failed to configure business workspace." };
      }
    },

    // Secure Login Online
    loginOnline: async (emailOrPhone, password) => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: emailOrPhone.trim().toLowerCase(),
          password: password || "password"
        });

        if (error) {
          const isUnconfirmed = error.message.toLowerCase().includes("email not confirmed") || 
                              error.message.toLowerCase().includes("email confirmation");
          return { 
            success: false, 
            error: error.message, 
            emailConfirmRequired: isUnconfirmed 
          };
        }

        // Hydrate data
        await get().hydrateAuthSessionData(data.user);

        useNotificationStore.getState().showToast(
          "Welcome Back",
          `Logged in successfully as ${data.user.email}.`,
          undefined,
          "success"
        );

        return { success: true };
      } catch (err: any) {
        const isUnconfirmed = err.message?.toLowerCase().includes("email not confirmed") || 
                            err.message?.toLowerCase().includes("email confirmation");
        return { 
          success: false, 
          error: err.message || "Invalid email or password credentials.",
          emailConfirmRequired: isUnconfirmed
        };
      }
    },

    // Invite User
    inviteUser: async (name, email, phone, role, optionalMessage) => {
      try {
        const supabase = getSupabase();
        const bizId = get().currentBusinessId;
        const currentUser = get().currentUser;

        if (!bizId || !currentUser) {
          throw new Error("You must be logged in to an active business to invite staff.");
        }

        // Generate INV-XXXXXX token
        const inviteCode = `INV-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        const expiresAt = new Date(Date.now() + 86400000 * 3).toISOString(); // 72 hours limit

        // Client-side checks for registered users
        const { data: existingUser } = await supabase
          .from("users")
          .select("id")
          .eq("email", email.trim());
        if (existingUser && existingUser.length > 0) {
          throw new Error("A registered user with this email address already exists in the system.");
        }

        // Client-side checks for active invitations
        const { data: existingInvite } = await supabase
          .from("invitations")
          .select("id")
          .eq("email", email.trim())
          .eq("status", "Pending")
          .gt("expires_at", new Date().toISOString());
        if (existingInvite && existingInvite.length > 0) {
          throw new Error("An active invitation for this email address already exists.");
        }

        // Insert into invitations table
        const { data: invite, error } = await supabase
          .from("invitations")
          .insert({
            business_id: bizId,
            invited_by: currentUser.id,
            name: name.trim(),
            email: email.trim(),
            phone: formatToE164(phone),
            role: role,
            invitation_token: inviteCode,
            expires_at: expiresAt,
            status: "Pending"
          })
          .select()
          .single();

        if (error) throw error;

        // Dispatch invitation email using EmailService Edge Function
        const businessName = useBusinessStore.getState().businesses.find(b => b.id === bizId)?.name || "KayKay's Milk";
        try {
          await EmailService.sendInvitation(
            email.trim(),
            inviteCode,
            name.trim(),
            businessName,
            role,
            optionalMessage
          );
        } catch (err: any) {
          console.error("EmailService invitation dispatch failed:", err);
          // Delete the invitation from database so we don't have dangling records
          await supabase.from("invitations").delete().eq("id", invite.id);
          throw new Error(err.message || "Failed to deliver invitation email. Invitation aborted.");
        }

        // Hydrate invitations in store
        const { data: invites } = await supabase.from("invitations").select("*").eq("business_id", bizId);
        if (invites) {
          set({
            invitations: invites.map(i => ({
              id: i.id,
              businessId: i.business_id,
              name: i.name,
              email: i.email || "",
              phone: i.phone || "",
              role: i.role,
              invitationToken: i.invitation_token,
              expiresAt: i.expires_at,
              status: i.status,
              invitedBy: i.invited_by || ""
            }))
          });
        }

        useNotificationStore.getState().showToast(
          "Invitation Dispatched",
          `Staff invite code ${inviteCode} sent to ${email}.`,
          undefined,
          "success"
        );

        return {
          success: true,
          invitation: {
            id: invite.id,
            businessId: invite.business_id,
            name: invite.name,
            email: invite.email || "",
            phone: invite.phone || "",
            role: invite.role,
            invitationToken: invite.invitation_token,
            expiresAt: invite.expires_at,
            status: invite.status,
            invitedBy: invite.invited_by || ""
          }
        };
      } catch (err: any) {
        return { success: false, error: err.message || "Failed to issue invitation." };
      }
    },

    // Verify invitation token
    verifyInvitation: async (token) => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc("get_invitation_by_token", { p_token: token.trim() });
        if (error) throw error;

        if (!data || data.length === 0) {
          return { success: false, error: "Invalid, expired, or already used invitation code." };
        }

        const invite = data[0];
        return {
          success: true,
          invitation: {
            id: invite.id,
            businessId: invite.business_id,
            name: invite.business_name, // Returns business_name inside business_name string mapping
            email: invite.email || "",
            phone: invite.phone || "",
            role: invite.role,
            invitationToken: token,
            expiresAt: invite.expires_at,
            status: invite.status,
            invitedBy: ""
          }
        };
      } catch (err: any) {
        return { success: false, error: err.message || "Failed to verify invitation token." };
      }
    },

    // Accept Invitation (Create user profile and memberships atomically in SQL)
    acceptInvitation: async (token, password, name, phone) => {
      try {
        const supabase = getSupabase();

        // 1. Verify invitation again to fetch details
        const verifyRes = await get().verifyInvitation(token);
        if (!verifyRes.success || !verifyRes.invitation) {
          return { success: false, error: verifyRes.error || "Invitation validation failed." };
        }

        const invite = verifyRes.invitation;

        // 2. Register account in Supabase Auth (without emailRedirectTo to avoid magic links)
        const { data, error } = await supabase.auth.signUp({
          email: invite.email,
          password: password || "password",
          options: {
            data: {
              name: name?.trim() || invite.name,
              phone: formatToE164(phone?.trim() || invite.phone || "")
            }
          }
        });

        if (error) throw error;

        // 3. Link user business membership atomically using SECURITY DEFINER RPC
        const { error: linkErr } = await supabase.rpc("accept_invitation_with_token", {
          p_token: token.trim(),
          p_auth_user_id: data?.user?.id,
          p_name: name?.trim() || invite.name,
          p_phone: formatToE164(phone?.trim() || invite.phone || "")
        });

        if (linkErr) throw linkErr;

        // 4. Generate random 6-digit OTP code
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        // 5. Save OTP in DB via RPC
        const { error: rpcErr } = await supabase.rpc("save_otp", {
          p_email: invite.email.trim(),
          p_code: otpCode,
          p_type: "signup"
        });
        if (rpcErr) throw rpcErr;

        // 6. Send Email via Edge Function
        await EmailService.sendVerificationCode(invite.email.trim(), otpCode, name?.trim() || invite.name);

        useNotificationStore.getState().showToast(
          "Verification Code Sent",
          `A 6-digit verification code has been sent to ${invite.email}.`,
          undefined,
          "success"
        );

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || "Failed to complete staff onboarding." };
      }
    },
    loadPermissionsFromDatabase: async () => {
      const activeBizId = useBusinessStore.getState().activeBusinessId;
      if (!activeBizId) {
        set({ dbPermissions: [] });
        return;
      }
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from("role_permissions")
          .select("*")
          .eq("business_id", toUuid(activeBizId));
        if (error) throw error;

        // Force react components to re-render by changing currentEmployee reference
        const currentEmp = get().currentEmployee;
        set({ 
          dbPermissions: data || [],
          currentEmployee: currentEmp ? { ...currentEmp } : null
        });
      } catch (err) {
        console.error("Failed to load permissions from database:", err);
      }
    },

    saveRolePermissions: async (role, permissions) => {
      const activeBizId = useBusinessStore.getState().activeBusinessId;
      if (!activeBizId) return;

      const supabase = getSupabase();
      try {
        const bizUuid = toUuid(activeBizId);

        // Delete existing permissions for this business and role
        const { error: delErr } = await supabase
          .from("role_permissions")
          .delete()
          .eq("business_id", bizUuid)
          .eq("role", role);

        if (delErr) throw delErr;

        // Insert records for all system permissions to explicitly define true/false state
        const payload = ALL_PERMISSIONS.map(p => ({
          business_id: bizUuid,
          role: role,
          permission: p.code,
          granted: permissions.includes(p.code)
        }));

        const { error: insErr } = await supabase
          .from("role_permissions")
          .insert(payload);

        if (insErr) throw insErr;

        // Trigger local refetch to keep state updated instantly
        await get().loadPermissionsFromDatabase();

        useNotificationStore.getState().showToast(
          "Permissions Synchronized",
          `Permissions for "${role}" successfully saved to database.`,
          undefined,
          "success"
        );
      } catch (err: any) {
        console.error("Failed to save role permissions:", err);
        useNotificationStore.getState().showToast(
          "Error",
          err.message || "Failed to save permissions to database.",
          undefined,
          "error"
        );
      }
    },

    // Switch Active Business Workspace
    switchBusiness: async (businessId) => {
      const user = get().currentUser;
      if (!user) return;

      const hasMem = get().memberships.some(m => m.businessId === businessId && m.status === "Active");
      if (!hasMem) {
        useNotificationStore.getState().showToast(
          "Access Denied",
          "You are not a member of this business.",
          undefined,
          "error"
        );
        return;
      }

      localStorage.setItem("kkm_current_business_id_v2", businessId);
      useBusinessStore.getState().setActiveBusinessId(businessId);
      
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await get().hydrateAuthSessionData(session.user);
      }
    },

    // Revoke Invitation
    revokeInvitation: async (id) => {
      try {
        const supabase = getSupabase();
        const { error } = await supabase
          .from("invitations")
          .update({ status: "Revoked" })
          .eq("id", id);

        if (error) throw error;

        // Refresh
        const bizId = get().currentBusinessId;
        if (bizId) {
          const { data: invitesData } = await supabase
            .from("invitations")
            .select("*")
            .eq("business_id", bizId);
          if (invitesData) {
            set({
              invitations: invitesData.map(i => ({
                id: i.id,
                businessId: i.business_id,
                name: i.name,
                email: i.email || "",
                phone: i.phone || "",
                role: i.role,
                invitationToken: i.invitation_token,
                expiresAt: i.expires_at,
                status: i.status,
                invitedBy: i.invited_by || ""
              }))
            });
          }
        }

        useNotificationStore.getState().showToast(
          "Invitation Revoked",
          "Staff invitation cancelled.",
          undefined,
          "info"
        );
      } catch (err: any) {
        console.error("Failed to revoke invitation:", err);
      }
    },

    // Punch in/out local mock implementations
    punchIn: () => {
      const emp = get().currentEmployee;
      if (!emp) return;

      const newShift: Shift = {
        id: `shift-${Date.now()}`,
        employeeId: emp.id,
        startTime: new Date().toISOString(),
        endTime: null,
        salesCount: 0,
        salesTotal: 0,
        status: "Active",
      };

      set({
        activeShift: newShift,
        shifts: [...get().shifts, newShift],
        currentEmployee: { ...emp, activeShiftId: newShift.id }
      });

      useNotificationStore.getState().showToast("Punched In", `Shift started at ${new Date().toLocaleTimeString()}`, undefined, "success");
    },

    punchOut: () => {
      const shift = get().activeShift;
      const emp = get().currentEmployee;
      if (!shift || !emp) return;

      const completedShift: Shift = {
        ...shift,
        endTime: new Date().toISOString(),
        status: "Closed",
      };

      set({
        activeShift: null,
        shifts: get().shifts.map((s) => (s.id === shift.id ? completedShift : s)),
        currentEmployee: { ...emp, activeShiftId: null }
      });

      useNotificationStore.getState().showToast("Punched Out", `Shift closed. Total Sales: Ksh ${shift.salesTotal}`, undefined, "info");
    },

    toggleTask: (taskId) => {
      const emp = get().currentEmployee;
      if (!emp) return;
      const updatedTasks = emp.tasks.map((t) =>
        t.id === taskId ? { ...t, completed: !t.completed } : t
      );
      set({ currentEmployee: { ...emp, tasks: updatedTasks } });
    },

    updateEmployeePin: (employeeId, newPin) => {
      // PIN setting is deprecated
    },

    addShiftSale: (finalTotal) => {
      const currentShift = get().activeShift;
      if (!currentShift) return;

      const updatedShift: Shift = {
        ...currentShift,
        salesCount: currentShift.salesCount + 1,
        salesTotal: currentShift.salesTotal + finalTotal,
      };

      set({
        activeShift: updatedShift,
        shifts: get().shifts.map((s) => (s.id === currentShift.id ? updatedShift : s)),
      });
    },

    createWorker: (worker) => {
      // Workers are invited via inviteUser
    },

    deleteWorker: async (id) => {
      // Terminate membership
      const supabase = getSupabase();
      const bizId = get().currentBusinessId;
      if (bizId) {
        await supabase
          .from("business_memberships")
          .delete()
          .eq("business_id", bizId)
          .eq("user_id", id);
        const { data: { user } } = await supabase.auth.getUser();
        if (user) await get().hydrateAuthSessionData(user);
      }
    },

    setupNewWorkerPin: (emailOrPhone, pin) => {
      return { success: false, error: "PIN passcodes are obsolete. Use email/password logins." };
    },

    updateProfile: async (id, updates) => {
      const supabase = getSupabase();
      const bizId = get().currentBusinessId;
      await supabase
        .from("users")
        .update({
          name: updates.name,
          phone: formatToE164(updates.phone),
          avatar: updates.avatar
        })
        .eq("id", id);
      if (updates.role && bizId) {
        await supabase
          .from("business_memberships")
          .update({ role: updates.role })
          .eq("business_id", bizId)
          .eq("user_id", id);
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await get().hydrateAuthSessionData(user);
    },

    setEmployees: (employees) => {},

    sendPasswordResetOtp: async (email: string) => {
      try {
        const supabase = getSupabase();
        
        // 1. Check if the user exists in public.users to get their name
        const { data: userProfile, error: profileErr } = await supabase
          .from("users")
          .select("name")
          .eq("email", email.trim())
          .maybeSingle();

        if (profileErr) throw profileErr;
        
        if (!userProfile) {
          return { success: false, error: "No account registered with this email address." };
        }

        // 2. Generate random 6-digit OTP code
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        // 3. Save OTP in DB via RPC
        const { error: rpcErr } = await supabase.rpc("save_otp", {
          p_email: email.trim(),
          p_code: otpCode,
          p_type: "recovery"
        });
        if (rpcErr) throw rpcErr;

        // 4. Send email via Edge Function
        await EmailService.sendPasswordResetCode(email.trim(), otpCode, userProfile.name || "User");

        useNotificationStore.getState().showToast(
          "Recovery Code Sent",
          `A 6-digit password recovery code has been sent to ${email}.`,
          undefined,
          "success"
        );

        return { success: true };
      } catch (err: any) {
        console.error("sendPasswordResetOtp error:", err);
        return { success: false, error: err.message || "Failed to send recovery code." };
      }
    },

    verifyPasswordResetOtp: async (email: string, code: string) => {
      try {
        const supabase = getSupabase();
        
        // Native verifyOtp for recovery
        const { data, error } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: code.trim(),
          type: "recovery"
        });

        if (error) throw error;

        // Hydrate session so that the user is logged in
        if (data.user) {
          await get().hydrateAuthSessionData(data.user);
        }

        return { success: true };
      } catch (err: any) {
        console.error("verifyPasswordResetOtp error:", err);
        return { success: false, error: err.message || "Invalid or expired recovery code." };
      }
    },

    updatePassword: async (password: string) => {
      try {
        const supabase = getSupabase();
        const { error } = await supabase.auth.updateUser({
          password: password
        });

        if (error) throw error;

        useNotificationStore.getState().showToast(
          "Password Updated",
          "Your password has been changed successfully.",
          undefined,
          "success"
        );

        return { success: true };
      } catch (err: any) {
        console.error("updatePassword error:", err);
        return { success: false, error: err.message || "Failed to update password." };
      }
    },

    updateEmailDuringVerification: async (newEmail: string) => {
      try {
        const supabase = getSupabase();
        const currentUser = get().currentUser;
        if (!currentUser) {
          throw new Error("You must be logged in to update your email.");
        }

        // 1. Update email in Supabase Auth
        const { error: authErr } = await supabase.auth.updateUser({
          email: newEmail.trim()
        });
        if (authErr) throw authErr;

        // 2. Update email in public.users table
        const { error: dbErr } = await supabase
          .from("users")
          .update({ email: newEmail.trim() })
          .eq("id", currentUser.id);
        if (dbErr) throw dbErr;

        // 3. Generate new OTP and save/send it
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const { error: rpcErr } = await supabase.rpc("save_otp", {
          p_email: newEmail.trim(),
          p_code: otpCode,
          p_type: "signup"
        });
        if (rpcErr) throw rpcErr;

        await EmailService.sendVerificationCode(newEmail.trim(), otpCode, currentUser.name);

        // Update current user state email
        set({
          currentUser: {
            ...currentUser,
            email: newEmail.trim()
          }
        });

        useNotificationStore.getState().showToast(
          "Email Updated",
          `Verification code sent to new email: ${newEmail}`,
          undefined,
          "success"
        );

        return { success: true };
      } catch (err: any) {
        console.error("updateEmailDuringVerification error:", err);
        return { success: false, error: err.message || "Failed to change verification email." };
      }
    }
  };
});
