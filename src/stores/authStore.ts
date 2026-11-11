// src/stores/authStore.ts
import { create } from "zustand";
import { User, Business, BusinessMembership, Invitation, Employee, Shift, EmployeeRole } from "../types";
import { onBranchChange, useBusinessStore } from "./businessStore";
import { useNotificationStore } from "./notificationStore";
import { isSupabaseConfigured, getSupabase } from "../services/supabaseClient";
import { SupabaseService } from "../services/supabaseService";
import { getApiUrl, safeFetch } from "../utils/apiUtils";
import { EmailService } from "../services/emailService";
import { AuthOtpService } from "../services/authOtpService";
import { toUserMessage } from "../utils/userError";
import { nativePlatformService } from "../core/native/NativePlatformService";
import { notificationService } from "../core/native/NotificationService";
import { startAlarmSync, clearAlarms } from "../services/notifications/alarmSync";
import { NotificationService } from "../services/notifications/notificationService";
import { NotificationRepository } from "../services/notifications/notificationRepository";
import { NotificationPreferences } from "../services/notifications/notificationPreferences";
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
  restoreActiveShift: () => Promise<void>;
  punchIn: () => Promise<boolean>;
  punchOut: () => Promise<boolean>;
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
  hydrateAuthSessionData: (authUser: any, force?: boolean, quiet?: boolean) => Promise<void>;
  /** Reloads the signed-in person's role, profile and team, e.g. after an admin changes them. */
  refreshSession: () => Promise<void>;
  isInitializing: boolean;
  isHydrating: boolean;
  initializationError: string | null;
  performInitialization: () => Promise<void>;
  sendPasswordResetOtp: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyPasswordResetOtp: (email: string, code: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (password: string, recovery?: { email: string; code: string }) => Promise<{ success: boolean; error?: string }>;
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

// ---------------------------------------------------------------------------
// PRESENCE HEARTBEAT
// Updates the employee's last_seen_at column in Supabase every 2 minutes
// while the app is active. Provides reliable server-side presence tracking.
// Derived status (consumers):
//   Online  = last_seen_at within the last 3 minutes
//   Away    = last_seen_at between 3 and 10 minutes ago
//   Offline = last_seen_at older than 10 minutes or NULL
// Returns a cleanup function that stops the interval.
// ---------------------------------------------------------------------------
function startPresenceHeartbeat(businessId: string | null, userId: string): () => void {
  if (!businessId || !userId) return () => {};

  const supabase = getSupabase();

  const sendBeat = () => {
    supabase
      .from("employees")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .then(({ error }) => {
        if (error) {
          console.warn("[Presence] Heartbeat failed:", error.message);
        }
      });
  };

  // Send an immediate beat so the user appears online right away
  sendBeat();

  const intervalId = setInterval(sendBeat, 120000); // every 2 minutes

  return () => clearInterval(intervalId);
}

export const useAuthStore = create<AuthState>((set, get) => {
  let unsubPerms: (() => void) | null = null;
  let unsubMembership: (() => void) | null = null;
  let unsubPresence: (() => void) | null = null;
  // A refresh asked for while one is running runs again afterwards, so no change is missed.
  let hydrateAgain = false;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFocusRefresh = 0;

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible" || !get().currentUser) return;
      if (Date.now() - lastFocusRefresh < 30000) return;
      lastFocusRefresh = Date.now();
      get().refreshSession().catch(console.error);
    };
    document.addEventListener("visibilitychange", refreshOnReturn);
    window.addEventListener("focus", refreshOnReturn);
  }

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
        sessionStorage.removeItem("kkm_init_retry_count");
      } catch (err: any) {
        console.error("Failed to initialize authentication:", err);
        
        const retryCountStr = sessionStorage.getItem("kkm_init_retry_count");
        const retryCount = retryCountStr ? parseInt(retryCountStr, 10) : 0;
        
        if (retryCount < 4) {
          sessionStorage.setItem("kkm_init_retry_count", String(retryCount + 1));
          console.warn(`Init failed. Automatically reloading browser (attempt ${retryCount + 1}/4)...`);
          window.location.reload();
          return;
        }

        sessionStorage.removeItem("kkm_init_retry_count");
        set({
          isInitializing: false,
          initializationError: toUserMessage(err, "Failed to initialize application connection.")
        });
      }
    },

    // Initialize Auth state change listener
    initializeAuthStateListener: () => {
      const supabase = getSupabase();
      
      // Load initial session
      get().performInitialization();

      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
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
    refreshSession: () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      return new Promise<void>((resolve) => {
        refreshTimer = setTimeout(async () => {
          refreshTimer = null;
          try {
            const { data } = await getSupabase().auth.getSession();
            const user = data.session?.user;
            if (user) await get().hydrateAuthSessionData(user, true, true);
          } catch (err) {
            console.error("Could not refresh the session:", err);
          }
          resolve();
        }, 250);
      });
    },

    hydrateAuthSessionData: async (authUser, force = false, quiet = false) => {
      if (get().isHydrating) {
        if (force) hydrateAgain = true;
        return;
      }
      
      const currentUser = get().currentUser;
      if (!force && currentUser && currentUser.id === authUser.id && currentUser.email === authUser.email) {
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

        // Push: asks for notification permission (Android 13+) right after sign-in, then saves
        // this phone's token (NotificationService's "registration" listener does the saving).
        // Reminders are copied to the phone as real alarms either way.
        notificationService.registerPush().catch((e) => console.warn("[PUSH_REGISTRATION] error:", e));
        startAlarmSync(mappedUser.id);

        // Follow changes to this person's roles, the team and its invitations, so a
        // promotion, a renamed worker or an accepted invitation shows without signing in again.
        if (unsubMembership) unsubMembership();
        if (mappedUser.id) {
          const refresh = () => {
            get().refreshSession().catch(console.error);
          };
          let teamChannel = supabase
            .channel(`realtime-team-${mappedUser.id}`)
            .on(
              "postgres_changes",
              { event: "*", schema: "public", table: "business_memberships", filter: `user_id=eq.${toUuid(mappedUser.id)}` },
              refresh
            )
            .on("postgres_changes", { event: "*", schema: "public", table: "users" }, refresh);
          if (activeBizId) {
            const bizFilter = `business_id=eq.${toUuid(activeBizId)}`;
            teamChannel = teamChannel
              .on("postgres_changes", { event: "*", schema: "public", table: "business_memberships", filter: bizFilter }, refresh)
              .on("postgres_changes", { event: "*", schema: "public", table: "invitations", filter: bizFilter }, refresh);
          }
          teamChannel.subscribe();

          unsubMembership = () => {
            supabase.removeChannel(teamChannel);
          };
        }

        // Initialize Realtime subscriptions
        realtimeService.initRealtimeSubscriptions();

        // Load existing notifications for the active business
        // CRITICAL FIX: Without this, the in-memory notifications array starts empty
        // on app startup, so the Messages page shows nothing even though rows exist
        // in the database (which is why push notifications still work — those are
        // fired by the Supabase DB webhook, completely independent of the client).
        if (activeBizId) {
          NotificationRepository.loadFromSupabase(activeBizId).catch(console.error);
        }

        // Initialize the Schedule Reminder feed (in-app staff reminders) filtered
        // by the current user. Subscribes to realtime on the notifications table.
        useNotificationStore.getState().initScheduleReminders();

        // Start the server-side presence heartbeat: update employees.last_seen_at
        // every 2 minutes while the app is active. Derived status:
        //   Online  = last_seen_at within 3 minutes
        //   Away    = last_seen_at between 3–10 minutes
        //   Offline = last_seen_at older than 10 minutes or NULL
        if (unsubPresence) unsubPresence();
        unsubPresence = startPresenceHeartbeat(activeBizId, mappedUser.id);
      } catch (err) {
        console.error("Failed to hydrate auth session:", err);
        // A background refresh keeps what's on screen; only sign-in clears it.
        if (quiet) return;
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
        if (hydrateAgain) {
          hydrateAgain = false;
          get().refreshSession().catch(console.error);
        }
      }
    },

    // PIN Authentication bypass (Obsolete)
    login: (pin) => {
      console.warn("Local PIN login is disabled. Use Supabase email/password login.");
      return false;
    },

    logout: async () => {
      // While still signed in: this phone stops getting this person's pushes and alarms.
      const pushToken = notificationService.getPushToken();
      if (pushToken) await SupabaseService.unregisterDeviceToken(pushToken).catch(() => undefined);
      await clearAlarms();

      if (unsubPerms) {
        unsubPerms();
        unsubPerms = null;
      }
      if (unsubMembership) {
        unsubMembership();
        unsubMembership = null;
      }
      if (unsubPresence) {
        unsubPresence();
        unsubPresence = null;
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
      localStorage.removeItem("kkm_schedules_v1_store");
      localStorage.removeItem("kkm_pending_actions_v1");
      localStorage.removeItem("kkm_notification_scheduled_tasks_v1");

      // Clear local repositories to prevent data leaking
      NotificationRepository.clearMemory();
      NotificationPreferences.clear();
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
        activeTab: "home",
        tabHistory: []
      });

      // Clear the Schedule Reminder realtime channel + feed to prevent
      // duplicate channel errors on next login.
      try {
        const reminderUnsub = (window as any).__kkm_reminder_unsub__;
        if (typeof reminderUnsub === "function") reminderUnsub();
        (window as any).__kkm_reminder_unsub__ = null;
      } catch (e) {
        console.warn("[AuthStore] Failed to clean Schedule Reminder channel:", e);
      }
      useNotificationStore.setState({ scheduleReminders: [], unreadReminderCount: 0 });

      // Clear the in-memory notification repository so stale data from the
      // previous session doesn't leak into the next login. Unlike
      // clearAllNotifications(), this does NOT soft-delete any rows from
      // the database, so the user's notification history is preserved.
      NotificationRepository.clearMemory();
      useNotificationStore.getState().clearToast();
      useNotificationStore.setState({ notifications: [], unreadCount: 0 });

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

        // 0. Pre-flight check: reject if an Owner already exists
        //    This prevents raw Supabase errors from leaking to the user.
        const { data: ownerAlreadyExists } = await supabase.rpc("check_owner_exists");
        if (ownerAlreadyExists === true) {
          return {
            success: false,
            error: "An Owner account already exists for this workspace. Please sign in instead. If you need access, ask the existing Owner to invite you as a staff member."
          };
        }

        // 1. SignUp through Supabase Auth
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password,
          options: {
            data: {
              name: name.trim(),
              phone: formatToE164(phone)
            }
          }
        });

        if (error) {
          // Map known Supabase error messages to friendly text
          const msg = toUserMessage(error, "");
          if (msg.includes("User already registered") || msg.includes("already been registered")) {
            return { success: false, error: "This email address is already registered. Please sign in or use a different email." };
          }
          if (msg.includes("Password should be")) {
            return { success: false, error: "Password must be at least 6 characters long." };
          }
          throw error;
        }

        // 2. Send verification code
        const otpRes = await AuthOtpService.sendSignupCode(email.trim(), name.trim());
        if (!otpRes.success) return otpRes;

        useNotificationStore.getState().showToast(
          "Verification Code Sent",
          `A 6-digit verification code has been sent to ${email}.`,
          undefined,
          "success"
        );

        set({ ownerExists: true });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: toUserMessage(err, "Registration failed. Please check your connection and try again.") };
      }
    },

    // verifyEmailCode stub (Supabase Auth link-clicks verify the email directly)
    verifyEmailCode: async (email, code) => AuthOtpService.verifySignupCode(email.trim(), code.trim()),

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
          await get().hydrateAuthSessionData(user, true);
        }

        useNotificationStore.getState().showToast(
          "Business Setup Complete",
          `Welcome to ${name} command center!`,
          undefined,
          "success"
        );

        return { success: true };
      } catch (err: any) {
        return { success: false, error: toUserMessage(err, "Failed to configure business workspace.") };
      }
    },

    // Secure Login Online
    loginOnline: async (emailOrPhone, password) => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: emailOrPhone.trim().toLowerCase(),
          password
        });

        if (error) {
          const isUnconfirmed = error.message.toLowerCase().includes("email not confirmed") || 
                              error.message.toLowerCase().includes("email confirmation");
          return { 
            success: false, 
            error: toUserMessage(error, "Failed to log in. Please try again."), 
            emailConfirmRequired: isUnconfirmed 
          };
        }

        // Website customers share Supabase Auth but have nothing to do in the staff app.
        if (data.user.user_metadata?.account_type === "customer") {
          await supabase.auth.signOut();
          return { success: false, error: "This is a customer account. Please sign in on our website instead." };
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
          error: toUserMessage(err, "Invalid email or password credentials."),
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

        // Generate 6-character invitation code (without INV- prefix)
        // 6 characters from a secure random source; no look-alikes (0/O, 1/I/L) so it's easy to type
        const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        const randomBytes = crypto.getRandomValues(new Uint8Array(6));
        const inviteCode = Array.from(randomBytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
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
        const businessName = useBusinessStore.getState().businesses.find(b => b.id === bizId)?.name || "KayKay's";
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
          throw new Error(toUserMessage(err, "Failed to deliver invitation email. Invitation aborted."));
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
        return { success: false, error: toUserMessage(err, "Failed to issue invitation.") };
      }
    },

    // Verify invitation token
    verifyInvitation: async (token) => {
      try {
        const supabase = getSupabase();
        const rawToken = token.trim().toUpperCase();
        let { data, error } = await supabase.rpc("get_invitation_by_token", { p_token: rawToken });

        // Fallback for legacy INV- prefixed tokens
        if ((!data || data.length === 0) && !rawToken.startsWith("INV-")) {
          const legacyRes = await supabase.rpc("get_invitation_by_token", { p_token: `INV-${rawToken}` });
          if (!legacyRes.error && legacyRes.data && legacyRes.data.length > 0) {
            data = legacyRes.data;
          }
        }

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
            // The invitee's own name. Older databases only return the shop name, so leave it blank then.
            name: invite.invitee_name ?? "",
            businessName: invite.business_name || "",
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
        return { success: false, error: toUserMessage(err, "Failed to verify invitation token.") };
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
          password: password,
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

        // 4. Send verification code
        const otpRes = await AuthOtpService.sendSignupCode(invite.email.trim(), name?.trim() || invite.name);
        if (!otpRes.success) return otpRes;

        useNotificationStore.getState().showToast(
          "Verification Code Sent",
          `A 6-digit verification code has been sent to ${invite.email}.`,
          undefined,
          "success"
        );

        return { success: true };
      } catch (err: any) {
        return { success: false, error: toUserMessage(err, "Failed to complete staff onboarding.") };
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
          toUserMessage(err, "Failed to save permissions to database."),
          undefined,
          "error"
        );
      }
    },

    // Switch Active Business Workspace
    switchBusiness: async (businessId) => {
      const user = get().currentUser;
      if (!user) return;

      const allowed =
        get().memberships.some(m => m.businessId === businessId && m.status === "Active") ||
        useBusinessStore.getState().businesses.some(b => b.id === businessId);
      if (!allowed) {
        useNotificationStore.getState().showToast(
          "Access Denied",
          "You are not a member of this business.",
          undefined,
          "error"
        );
        return;
      }

      // The branch-change listener below reloads role, team and notifications for it.
      useBusinessStore.getState().setActiveBusinessId(businessId);
    },

    // Revoke Invitation
    revokeInvitation: async (id) => {
      try {
        const supabase = getSupabase();
        const { error } = await supabase
          .from("invitations")
          .delete()
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
          "Staff invitation cancelled and removed.",
          undefined,
          "info"
        );
      } catch (err: any) {
        console.error("Failed to revoke invitation:", err);
      }
    },

    // Reloads the open shift from the database. The database is the only truth, so
    // a clock-in or clock-out on any other device or session shows up here too.
    restoreActiveShift: async () => {
      const emp = get().currentEmployee;
      const businessId = useBusinessStore.getState().activeBusinessId;
      if (!emp || !businessId) return;
      try {
        const activeShift = await SupabaseService.fetchActiveShift(businessId, emp.id);
        const current = get().currentEmployee;
        if (!current || current.id !== emp.id) return;
        set({
          activeShift,
          currentEmployee: { ...current, activeShiftId: activeShift?.id || null },
        });
      } catch (err) {
        console.error("Failed to restore active shift:", err);
      }
    },

    punchIn: async () => {
      const emp = get().currentEmployee;
      const businessId = useBusinessStore.getState().activeBusinessId;
      if (!emp || !businessId) return false;

      try {
        // Another device may already have clocked this person in: join that shift.
        const existing = await SupabaseService.fetchActiveShift(businessId, emp.id);
        if (existing) {
          set({ activeShift: existing, currentEmployee: { ...emp, activeShiftId: existing.id } });
          return true;
        }

        let newShift: Shift;
        try {
          newShift = await SupabaseService.createShift({
            businessId,
            employeeId: emp.id,
            startTime: new Date().toISOString(),
          });
        } catch (err: any) {
          // Two devices clocked in at the same moment; the database keeps one open shift.
          if (err?.code !== "23505") throw err;
          const winner = await SupabaseService.fetchActiveShift(businessId, emp.id);
          if (!winner) throw err;
          set({ activeShift: winner, currentEmployee: { ...emp, activeShiftId: winner.id } });
          return true;
        }

        set({
          activeShift: newShift,
          shifts: [...get().shifts, newShift],
          currentEmployee: { ...emp, activeShiftId: newShift.id }
        });

        useNotificationStore.getState().showToast("Clocked In", `Shift started at ${new Date().toLocaleTimeString()}.`, undefined, "success");

        NotificationService.createNotification(
          "Custom Notification",
          { message: `${emp.name} clocked in at ${new Date().toLocaleTimeString()}` },
          { title: `Shift Started: ${emp.name}`, role: "Owner", priority: "medium" }
        );
        return true;
      } catch (err) {
        console.error("punchIn error:", err);
        useNotificationStore.getState().showToast("Clock In Failed", toUserMessage(err, "Could not clock you in. Please try again."), undefined, "error");
        return false;
      }
    },

    punchOut: async () => {
      const shift = get().activeShift;
      const emp = get().currentEmployee;
      const businessId = useBusinessStore.getState().activeBusinessId;
      if (!emp || !businessId) return false;

      try {
        // Closes every open shift for this person, including ones opened on other
        // devices; the realtime watch then clears the clock bar on those devices.
        await SupabaseService.closeOpenShifts(businessId, emp.id);
        const endTime = new Date().toISOString();
        set({
          activeShift: null,
          shifts: shift
            ? get().shifts.map((s) => (s.id === shift.id ? { ...s, endTime, status: "Closed" as const } : s))
            : get().shifts,
          currentEmployee: { ...emp, activeShiftId: null }
        });
        return true;
      } catch (err) {
        console.error("punchOut error:", err);
        useNotificationStore.getState().showToast("Clock Out Failed", toUserMessage(err, "Could not clock you out. Please try again."), undefined, "error");
        return false;
      }
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
    },

    addShiftSale: (finalTotal) => {
      const currentShift = get().activeShift;
      if (!currentShift) return;

      const updatedShift: Shift = {
        ...currentShift,
        salesCount: currentShift.salesCount + 1,
        salesTotal: currentShift.salesTotal + finalTotal,
      };

      // Display only. The database counts the sale when it is saved
      // (fn_process_completed_transaction). Writing this copy back would count it
      // twice and could reopen a shift another device already closed.
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
        await get().refreshSession();
      }
    },

    setupNewWorkerPin: (emailOrPhone, pin) => {
      return { success: false, error: "PIN passcodes are obsolete. Use email/password logins." };
    },

    updateProfile: async (id, updates) => {
      const supabase = getSupabase();
      const bizId = get().currentBusinessId;
      const previous = { employees: get().employees, currentEmployee: get().currentEmployee };

      // Show the change straight away; put it back if the server refuses.
      set((state) => ({
        employees: state.employees.map((emp) =>
          emp.id === id ? { ...emp, name: updates.name, phone: updates.phone, avatar: updates.avatar || emp.avatar, role: updates.role || emp.role } : emp
        ),
        currentEmployee: state.currentEmployee?.id === id
          ? { ...state.currentEmployee, name: updates.name, phone: updates.phone, avatar: updates.avatar || state.currentEmployee.avatar, role: updates.role || state.currentEmployee.role }
          : state.currentEmployee
      }));

      try {
        const { error } = await supabase.rpc("update_team_member", {
          p_business_id: bizId ? toUuid(bizId) : null,
          p_user_id: toUuid(id),
          p_name: updates.name,
          p_phone: formatToE164(updates.phone),
          p_avatar: updates.avatar || null,
          p_role: updates.role || null,
        });
        // PGRST202: the database doesn't have update_team_member yet, so use the old direct writes.
        if (error && error.code === "PGRST202") {
          const { error: userErr } = await supabase
            .from("users")
            .update({ name: updates.name, phone: formatToE164(updates.phone), avatar: updates.avatar })
            .eq("id", id);
          if (userErr) throw userErr;
          if (updates.role && bizId) {
            const { error: roleErr } = await supabase
              .from("business_memberships")
              .update({ role: updates.role })
              .eq("business_id", bizId)
              .eq("user_id", id);
            if (roleErr) throw roleErr;
          }
        } else if (error) {
          throw error;
        }
      } catch (err) {
        set(previous);
        throw err;
      }

      await get().refreshSession();
    },

    setEmployees: (employees) => {},

    sendPasswordResetOtp: async (email: string) => AuthOtpService.sendPasswordResetCode(email),

    verifyPasswordResetOtp: async (email: string, code: string) =>
      AuthOtpService.verifyPasswordResetCode(email, code.trim()),

    // Signed-in users change their own password. Recovery requires the emailed code.
    updatePassword: async (password: string, recovery?: { email: string; code: string }) => {
      try {
        if (recovery) {
          const res = await AuthOtpService.resetPassword(recovery.email, recovery.code.trim(), password);
          if (!res.success) return res;
        } else {
          const { error } = await getSupabase().auth.updateUser({ password });
          if (error) throw error;
        }

        useNotificationStore.getState().showToast(
          "Password Updated",
          "Your password has been changed successfully.",
          undefined,
          "success"
        );

        return { success: true };
      } catch (err: any) {
        console.error("updatePassword error:", err);
        return { success: false, error: toUserMessage(err, "Failed to update password.") };
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

        // 3. Send a verification code to the new address
        const otpRes = await AuthOtpService.sendSignupCode(newEmail.trim(), currentUser.name);
        if (!otpRes.success) return otpRes;

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
        return { success: false, error: toUserMessage(err, "Failed to change verification email.") };
      }
    }
  };
});

// A branch switch is a full change: whatever started it (menu, Branches screen, a new
// branch), reload who this person is there (role, team, notifications, presence).
// Skipped while a sign-in reload is running, since that reload is what set the branch.
setTimeout(() => {
  onBranchChange((businessId) => {
    const auth = useAuthStore.getState();
    if (!businessId || !auth.currentUser || auth.isHydrating) return;
    auth.refreshSession().catch(console.error);
  });
}, 0);
