import React, { useState, useEffect, useRef } from "react";
import { useAppStore } from "./stores/appStore";
import { useCartStore } from "./stores/cartStore";
import PreviewFrame from "./components/PreviewFrame";
import { InteractiveGuide, TourStep } from "./components/InteractiveGuide";
import GlobalSearch from "./components/GlobalSearch";
import POSView from "./features/POSView";
import InventoryView from "./features/InventoryView";
import SalesView from "./features/SalesView";
import CustomersView from "./features/CustomersView";
import DashboardView from "./features/DashboardView";
import WorkspaceAssistantView from "./features/WorkspaceAssistantView";
import WorkersView from "./features/WorkersView";
import PermissionsView from "./features/PermissionsView";
import ProfileView from "./features/ProfileView";
import SettingsView from "./features/SettingsView";
import NotificationsView from "./features/NotificationsView";
import BusinessManagementView from "./features/BusinessManagementView";
import CustomerFeedbackView from "./features/CustomerFeedbackView";
import HomeView from "./features/HomeView";
import { useNotificationStore } from "./stores/notificationStore";
import SearchableDropdown from "./components/SearchableDropdown";
import UnifiedUploader from "./components/shared/UnifiedUploader";
import { LocalPinSetupCard, LocalPinUnlockCard } from "./components/LocalTerminalSecurity";
import { NotificationRepository } from "./services/notifications/notificationRepository";
import { OtpInput } from "./components/OtpInput";
import { hasRolePermission } from "./utils/permissions";
import SecurityGuard from "./components/SecurityGuard";
import { isSupabaseConfigured, getSupabase } from "./services/supabaseClient";
import { configManager } from "./services/configManager";
import { useSystemHealthStore } from "./stores/systemHealthStore";
import { SystemHealthService } from "./services/systemHealthService";
import { SupabaseService } from "./services/supabaseService";
import { useAuthStore } from "./stores/authStore";
import { useInventoryStore } from "./stores/inventoryStore";
import { useCustomerStore } from "./stores/customerStore";
import { useBusinessStore } from "./stores/businessStore";
import { useKeyboardVisible } from "./hooks/useKeyboardVisible";
import {
  nativePlatformService,
  statusBarService,
  splashScreenService,
  nativeUiService
} from "./core/native";


// Lucide Icons
import {
  Smartphone,
  Database,
  Tag,
  Boxes,
  Receipt,
  Users,
  UserCheck,
  Bot,
  Wifi,
  WifiOff,
  Sun,
  Bell,
  Moon,
  Lock,
  Delete,
  CheckCircle,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  Key,
  CheckCircle2,
  User,
  Clock,
  ShoppingCart,
  Heart,
  ChevronDown,
  ChevronUp,
  Settings,
  Fingerprint,
  Volume2,
  Edit,
  Trash2,
  Plus,
  Camera,
  MessageSquare,
  Home,
  Building,
  ArrowRight,
  Briefcase,
  Globe,
  Coins,
  Mail,
  Phone,
  RefreshCw,
  Brain
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const WorkspaceLogo: React.FC<{ logoUrl?: string; name: string }> = ({ logoUrl, name }) => {
  const [error, setError] = useState(false);
  
  if (error || !logoUrl || logoUrl.trim() === "") {
    return (
      <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center border border-slate-750 shrink-0 text-amber-500">
        <Building size={18} />
      </div>
    );
  }
  
  return (
    <img
      src={logoUrl}
      alt={name}
      onError={() => setError(true)}
      className="w-10 h-10 rounded-xl object-cover border border-slate-850 shrink-0"
      referrerPolicy="no-referrer"
    />
  );
};

const tourSteps: TourStep[] = [
  {
    title: "Welcome to KayKay's Milk!",
    content: "Let's take a quick 1-minute interactive tour to explore your daily staff workflows and tool panels.",
    placement: "bottom"
  },
  {
    targetSelector: "#sidebar-brand-header",
    title: "Business Workspace",
    content: "This shows the current active dairy branch. Operators with multiple locations can switch workspaces here.",
    placement: "right"
  },
  {
    targetSelector: "#sidebar-tab-home",
    title: "Home Dashboard",
    content: "View your key business KPIs, sales summary chart, active driver list, and product analytics at a glance.",
    placement: "right",
    tab: "home"
  },
  {
    targetSelector: "#sidebar-tab-dashboard",
    title: "Shift Controls & Punch",
    content: "Log your starting/ending mileage, punch clock timing, and manage assigned rider delivery tasks.",
    placement: "right",
    tab: "dashboard"
  },
  {
    targetSelector: "#sidebar-tab-pos",
    title: "POS Checkout",
    content: "This is where you log sales! Search for milk products, add them to cart, and checkout with modern payment methods.",
    placement: "right",
    tab: "pos"
  },
  {
    targetSelector: "#sidebar-tab-inventory",
    title: "Inventory stock Reconcile",
    content: "Manage warehouse/truck stock quantities, log supply adjustments, and configure inventory alerts.",
    placement: "right",
    tab: "inventory"
  },
  {
    targetSelector: "#sidebar-tab-sales",
    title: "Sales Log & Orders",
    content: "Review all processed sales orders, customer invoice details, payment receipts, and synchronization status.",
    placement: "right",
    tab: "sales"
  },
  {
    targetSelector: "#sidebar-tab-customers",
    title: "Loyalty Club",
    content: "Register new customers, view loyalty tier ranks (Bronze, Silver, Gold), and manage customer loyalty points.",
    placement: "right",
    tab: "customers"
  },
  {
    targetSelector: "#sidebar-tab-ai",
    title: "AI Co-pilot Assistant",
    content: "Ask questions, write customer reply feedback, auto-generate reports, or resolve errors using the Gemini AI Engine.",
    placement: "right",
    tab: "ai"
  },
  {
    targetSelector: "#sidebar-tab-permissions",
    title: "Access Permissions & Security",
    content: "Owners and Administrators can configure cashier, manager, and driver access rights to secure features.",
    placement: "right",
    tab: "permissions"
  },
  {
    targetSelector: "#sidebar-tab-business-management",
    title: "Business Management",
    content: "Update business contact details, customize logo avatars, add branches, and configure dynamic branding themes.",
    placement: "right",
    tab: "business-management"
  },
  {
    targetSelector: "#sidebar-tab-settings",
    title: "System Settings",
    content: "Adjust device themes, configure bluetooth thermal printers, customize taxes, and access administrative preferences.",
    placement: "right",
    tab: "settings"
  },
  {
    targetSelector: "#global-search-container",
    title: "Global Search Engine",
    content: "Instantly locate customers, check product details, search receipts, or navigate anywhere across the workspace.",
    placement: "bottom"
  },
  {
    targetSelector: "#header-notification-bell",
    title: "System Message Center",
    content: "Read general staff announcements, system notifications, and critical transaction alerts here.",
    placement: "left"
  },
  {
    targetSelector: "#restart-tour-button",
    title: "Restart Tour Anytime",
    content: "You can restart this guided walkthrough tour anytime by clicking this Interactive Tour button or checking Settings.",
    placement: "right"
  }
];

export default function App() {
  const isKeyboardVisible = useKeyboardVisible();
  const mainConstraintsRef = useRef<HTMLDivElement>(null);
  const {
    currentEmployee,
    isOnline,
    toggleNetwork,
    syncWithServer,
    toast,
    showToast,
    clearToast,
    showNav,
    setShowNav,
    activeTab,
    setActiveTab,
    businesses,
    activeBusinessId,
    setActiveBusinessId,
    addBusiness,
    updateBusiness,
    deleteBusiness,
    // Online Auth & Onboarding props
    users,
    memberships,
    invitations,
    currentUser,
    currentBusinessId,
    emailVerificationCode,
    ownerExists,
    isInitializing,
    initializationError,
    performInitialization,
    checkOwnerExists,
    signUpOwner,
    verifyEmailCode,
    createBusinessWithOwner,
    loginOnline,
    verifyInvitation,
    acceptInvitation,
    switchBusiness,
    revokeInvitation,
    logout,
    sendPasswordResetOtp,
    verifyPasswordResetOtp,
    updatePassword,
    updateEmailDuringVerification
  } = useAppStore();

  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);

  const handleCloseTour = () => {
    setIsTourOpen(false);
    localStorage.setItem("kaykays-milk-onboarding-completed", "true");
  };

  useEffect(() => {
    if (currentEmployee) {
      const completed = localStorage.getItem("kaykays-milk-onboarding-completed");
      if (completed !== "true") {
        const timer = setTimeout(() => {
          setIsTourOpen(true);
        }, 1200);
        return () => clearTimeout(timer);
      }
    }
  }, [currentEmployee]);
  const [isCreatingBusiness, setIsCreatingBusiness] = useState(false);
  const [newBizName, setNewBizName] = useState("");
  const [newBizDesc, setNewBizDesc] = useState("");
  const [newBizAddr, setNewBizAddr] = useState("");
  const [newBizLogo, setNewBizLogo] = useState("");
  const [newBizCover, setNewBizCover] = useState("");
  const [newBizPhone, setNewBizPhone] = useState("");
  const [newBizEmail, setNewBizEmail] = useState("");
  const [newBizCurrency, setNewBizCurrency] = useState("Ksh");
  const [newBizTimezone, setNewBizTimezone] = useState("Africa/Nairobi");
  const [newBizType, setNewBizType] = useState("Retail");
  const [newBizPaymentMethods, setNewBizPaymentMethods] = useState<string[]>(["Cash", "M-Pesa"]);
  const [editingBizId, setEditingBizId] = useState<string | null>(null);
  const [editBizName, setEditBizName] = useState("");
  const [editBizDesc, setEditBizDesc] = useState("");
  const [editBizAddr, setEditBizAddr] = useState("");
  const [editBizLogo, setEditBizLogo] = useState("");

  const activeBusiness = businesses.find(b => b.id === activeBusinessId) || businesses[0] || {
    id: "biz-1",
    name: "KayKay's Milk",
    logoUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Crect width='100' height='100' rx='20'/%3E%3Cpath d='M30,70 L50,30 L70,70 Z' fill='%230f172a'/%3E%3C/svg%3E"
  };

  const assignableBranchesCount = currentEmployee
    ? hasRolePermission(currentEmployee.role, "settings.view")
      ? businesses.length
      : (currentEmployee.assignedBranches || []).length || 1
    : 1;



  const [showSwitchDeviceModal, setShowSwitchDeviceModal] = useState(false);
  const [switchAdminPin, setSwitchAdminPin] = useState("");
  const [switchError, setSwitchError] = useState("");
  const [permissionVersion, setPermissionVersion] = useState(0);

  const [isTerminalLocked, setIsTerminalLocked] = useState(() => localStorage.getItem("kkm_terminal_locked") === "true");

  useEffect(() => {
    const handleLock = () => {
      setIsTerminalLocked(true);
    };
    window.addEventListener("terminal-lock", handleLock);
    return () => window.removeEventListener("terminal-lock", handleLock);
  }, []);

  const { dbStatus, aiStatus, internetStatus, sessionStatus } = useSystemHealthStore();
  const [showTempOffline, setShowTempOffline] = useState(false);

  // Connectivity checking function & Auth State initialization
  useEffect(() => {
    SystemHealthService.start();
    const unsubscribe = useAuthStore.getState().initializeAuthStateListener();
    return () => {
      SystemHealthService.stop();
      unsubscribe();
    };
  }, []);

  // Show connection state change toasts
  const prevOnlineRef = useRef(isOnline);
  useEffect(() => {
    if (prevOnlineRef.current !== isOnline) {
      if (isOnline) {
        showToast("Connection Restored", "You're back online.", undefined, "success");
      } else {
        showToast("Connection Lost", "You're currently offline.", undefined, "info");
      }
      prevOnlineRef.current = isOnline;
    }
  }, [isOnline]);

  // Listener for network-action-failed event
  useEffect(() => {
    let timer: any;
    const handleActionFailed = () => {
      setShowTempOffline(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setShowTempOffline(false);
      }, 6000); // Show for 6 seconds
    };
    window.addEventListener("network-action-failed", handleActionFailed);
    return () => {
      window.removeEventListener("network-action-failed", handleActionFailed);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Listen to custom permission change event to trigger instant tab reactivity
  useEffect(() => {
    const handleUpdate = () => setPermissionVersion(v => v + 1);
    window.addEventListener("permissionChange", handleUpdate);
    return () => window.removeEventListener("permissionChange", handleUpdate);
  }, []);

  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [isSystemServicesExpanded, setIsSystemServicesExpanded] = useState(false);

  useEffect(() => {
    return NotificationRepository.subscribe((rows) => {
      setUnreadNotificationsCount(rows.filter(r => !r.read_at).length);
    });
  }, []);

  useEffect(() => {
    const handleNavigate = (e: any) => {
      const targetTab = e.detail?.tab;
      if (targetTab) {
        if (targetTab === "inventory") {
          setActiveTab("inventory");
        } else if (targetTab === "sales") {
          setActiveTab("sales");
        } else if (targetTab === "customer_debt") {
          setActiveTab("customers");
        } else if (targetTab === "ai_insight") {
          setActiveTab("ai");
        } else if (targetTab === "delivery") {
          setActiveTab("sales");
        }
      }
    };
    window.addEventListener("navigate-tab", handleNavigate);
    return () => window.removeEventListener("navigate-tab", handleNavigate);
  }, [setActiveTab]);

  const { cart } = useCartStore();
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  
  // First-time worker setup pin states
  const [isSetupPinMode, setIsSetupPinMode] = useState(false);
  const [setupCred, setSetupCred] = useState("");
  const [setupPin1, setSetupPin1] = useState("");
  const [setupPin2, setSetupPin2] = useState("");
  const [setupError, setSetupError] = useState("");
  const [setupSuccess, setSetupSuccess] = useState("");
  
  // Theme state stored in localStorage
  const [themeMode, setThemeMode] = useState<"light" | "dark">(
    () => (localStorage.getItem("kaykays-theme") as "light" | "dark") || "light"
  );

  // Sidebar collapse state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => localStorage.getItem("kaykays-sidebar-collapsed") === "true"
  );

  const lastScrollY = useRef(0);

  // First-launch onboarding states
  const [supabaseConfiguredState, setSupabaseConfiguredState] = useState(() => isSupabaseConfigured());
  const [termsAccepted, setTermsAccepted] = useState(() => {
    return localStorage.getItem("kkm_terms_accepted") === "true";
  });
  const [setupDbUrl, setSetupDbUrl] = useState("");
  const [setupDbKey, setSetupDbKey] = useState("");
  const [dbConnecting, setDbConnecting] = useState(false);
  const [setupDbError, setSetupDbError] = useState("");
  const [agreeChecked, setAgreeChecked] = useState(false);

  const handleConnectDatabase = async () => {
    if (!setupDbUrl || !setupDbKey) {
      setSetupDbError("Provide both a valid Project URL and Anon API key.");
      return;
    }
    setDbConnecting(true);
    setSetupDbError("");
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(setupDbUrl, setupDbKey);
      if (client) {
        localStorage.setItem("kkm_supabase_url", setupDbUrl);
        localStorage.setItem("kkm_supabase_key", setupDbKey);
        setSupabaseConfiguredState(true);
        showToast("Database Connected", "Supabase sync credentials successfully configured.", undefined, "success");
      }
    } catch (e) {
      setSetupDbError("Invalid credentials format. Connect attempt failed.");
    } finally {
      setDbConnecting(false);
    }
  };

  const handleAcceptTerms = () => {
    localStorage.setItem("kkm_terms_accepted", "true");
    setTermsAccepted(true);
    showToast("System Agreement", "Terms accepted. Initialized digital terminal workspace.", undefined, "success");
  };

  // ==========================================
  // NEW ONLINE AUTH & ONBOARDING STATES
  // ==========================================
  const [authViewTab, setAuthViewTab] = useState<
    "login" | "register" | "verify" | "create-biz" | "accept-invite" |
    "forgot-password" | "verify-reset-code" | "reset-password" | "session-expired" | "unauthorized"
  >("login");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regPassword, setRegPassword] = useState("");

  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyCountdown, setVerifyCountdown] = useState(60);
  const [isResending, setIsResending] = useState(false);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [newEmailInput, setNewEmailInput] = useState("");

  const [forgotEmail, setForgotEmail] = useState("");
  const [resetOtpCode, setResetOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetCountdown, setResetCountdown] = useState(0);

  // Recovery code countdown timer
  useEffect(() => {
    let interval: any;
    if (authViewTab === "verify-reset-code" && resetCountdown > 0) {
      interval = setInterval(() => {
        setResetCountdown((c) => c - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [authViewTab, resetCountdown]);

  // Verification code countdown timer
  useEffect(() => {
    let interval: any;
    if (authViewTab === "verify" && verifyCountdown > 0) {
      interval = setInterval(() => {
        setVerifyCountdown((c) => c - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [authViewTab, verifyCountdown]);

  // Support manual/automated navigation to specific auth screens via URL parameters
  useEffect(() => {
    const handleUrlNavigation = () => {
      const params = new URLSearchParams(window.location.search);
      const screenParam = params.get("screen");
      const emailParam = params.get("email");
      
      if (screenParam) {
        const validScreens = [
          "login", "register", "verify", "create-biz", "accept-invite",
          "forgot-password", "verify-reset-code", "reset-password", "session-expired", "unauthorized"
        ];
        if (validScreens.includes(screenParam)) {
          setAuthViewTab(screenParam as any);
          if (emailParam) {
            if (screenParam === "verify") setVerifyEmail(emailParam);
            else if (screenParam === "login") setLoginEmail(emailParam);
            else if (screenParam === "register") setRegEmail(emailParam);
            else if (screenParam === "forgot-password") setForgotEmail(emailParam);
          }
        }
      }
    };

    handleUrlNavigation();
    window.addEventListener("popstate", handleUrlNavigation);
    return () => window.removeEventListener("popstate", handleUrlNavigation);
  }, []);

  // Synchronize browser URL query parameter with the active authViewTab
  useEffect(() => {
    if (!currentUser) {
      const url = new URL(window.location.href);
      const currentScreen = url.searchParams.get("screen");
      if (currentScreen !== authViewTab) {
        url.searchParams.set("screen", authViewTab);
        window.history.pushState(null, "", url.pathname + url.search);
      }
    }
  }, [authViewTab, currentUser]);

  // Synchronize authViewTab based on Supabase session and owner status
  useEffect(() => {
    if (currentUser) {
      if (authViewTab === "reset-password") {
        // Keep user on the reset-password page to complete password update
        return;
      }
      if (!currentUser.isVerified) {
        setVerifyEmail(currentUser.email);
        setAuthViewTab("verify");
      } else {
        const activeMems = memberships.filter(m => m.userId === currentUser.id && m.status === "Active");
        if (activeMems.length === 0) {
          setAuthViewTab("create-biz");
        }
      }
    } else {
      if (ownerExists === false) {
        setAuthViewTab("register"); // Create Owner Account
      } else {
        // Prevent redirecting away from other guest auth tabs
        const guestTabs = [
          "login", 
          "register", 
          "forgot-password", 
          "verify-reset-code", 
          "reset-password", 
          "accept-invite", 
          "verify",
          "session-expired",
          "unauthorized"
        ];
        if (!guestTabs.includes(authViewTab)) {
          setAuthViewTab("login");
        }
      }
    }
  }, [currentUser, ownerExists, memberships, authViewTab]);

  const handleResendCode = async () => {
    setIsResending(true);
    setAuthError("");
    setAuthSuccess("");
    try {
      const supabase = getSupabase();
      const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
      
      const { error: rpcErr } = await supabase.rpc("save_otp", {
        p_email: verifyEmail.trim(),
        p_code: newOtp,
        p_type: "signup"
      });
      if (rpcErr) throw rpcErr;

      const EmailServiceModule = await import("./services/emailService");
      await EmailServiceModule.EmailService.sendVerificationCode(verifyEmail.trim(), newOtp, regName.trim());

      setVerifyCountdown(60);
      setVerifyCode("");
      setAuthSuccess(`A new verification code has been sent to ${verifyEmail}!`);
    } catch (err: any) {
      console.error("Resend OTP failed:", err);
      setAuthError(err.message || "Failed to resend verification code. Verify provider setup.");
    } finally {
      setIsResending(false);
    }
  };

  const handleVerifyOtpSubmit = async (codeToSubmit?: string) => {
    const code = codeToSubmit || verifyCode;
    if (code.length !== 6) {
      setAuthError("Please enter a valid 6-digit code.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    setAuthSuccess("");
    
    const res = await verifyEmailCode(verifyEmail, code);
    if (res.success) {
      setAuthSuccess("Email verified successfully! Logging you in...");
      try {
        const loginRes = await loginOnline(verifyEmail, regPassword);
        if (loginRes.success) {
          setAuthViewTab("create-biz");
        } else {
          setAuthViewTab("login");
          setLoginEmail(verifyEmail);
          setAuthSuccess("Account verified. Please enter your password to login.");
        }
      } catch (loginErr: any) {
        console.error("Auto login failed after verification:", loginErr);
        setAuthViewTab("login");
        setLoginEmail(verifyEmail);
        setAuthSuccess("Account verified. Please login manually.");
      }
    } else {
      setAuthError(res.error || "Verification failed. Check the code and try again.");
    }
    setAuthLoading(false);
  };

  const [bizNameField, setBizNameField] = useState("");
  const [bizTypeField, setBizTypeField] = useState("Retail");
  const [bizCountryField, setBizCountryField] = useState("Kenya");
  const [bizCurrencyField, setBizCurrencyField] = useState("Ksh");

  const [inviteTokenInput, setInviteTokenInput] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteConfirmPassword, setInviteConfirmPassword] = useState("");
  const [inviteVerified, setInviteVerified] = useState(false);
  const [validatedInvite, setValidatedInvite] = useState<any | null>(null);

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false);

  // Parse secure email invitation links in the URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (token) {
      setAuthViewTab("accept-invite");
      setInviteTokenInput(token);
      
      const checkInvite = async () => {
        setAuthLoading(true);
        setAuthError("");
        setAuthSuccess("");
        const res = await verifyInvitation(token);
        setAuthLoading(false);
        if (res.success && res.invitation) {
          setValidatedInvite(res.invitation);
          setInviteVerified(true);
          setInviteName(res.invitation.name);
          setInvitePhone(res.invitation.phone);
          setAuthSuccess(`Secure invitation verified for joining as ${res.invitation.role}! Fill in your password to register.`);
        } else {
          setAuthError(res.error || "The invitation link is invalid or has expired.");
        }
      };
      checkInvite();
    }
  }, []);

const aiName = import.meta.env?.VITE_AI_NAME || 'Kim';

 useEffect(() => {
  if (isOnline) {
    syncWithServer()
      .catch((err) => console.error("Live context sync breakdown:", err));
  }
}, [isOnline, syncWithServer]);

  // Load and hydrate all data from Supabase if configured
  useEffect(() => {
    const syncSupabaseData = async () => {
      if (!isOnline) return;
      if (isSupabaseConfigured()) {
        try {
          console.log("Supabase is configured. Synchronizing data...");
          
          // 1. Fetch businesses
          const fetchedBiz = await SupabaseService.fetchBusinesses();
          if (fetchedBiz && fetchedBiz.length > 0) {
            useBusinessStore.getState().setBusinesses(fetchedBiz);
            
            // If active business ID is 'biz-1' (the mock fallback), point it to a real UUID business ID from Supabase
            if (activeBusinessId === "biz-1" || !fetchedBiz.some(b => b.id === activeBusinessId)) {
              useBusinessStore.getState().setActiveBusinessId(fetchedBiz[0].id);
            }
          }

          // 2. Fetch employees
          const fetchedEmps = await SupabaseService.fetchEmployees();
          if (fetchedEmps && fetchedEmps.length > 0) {
            useAuthStore.getState().setEmployees(fetchedEmps);
          }

          // 3. Fetch products and customers for the active business
          const currentBizId = useBusinessStore.getState().activeBusinessId;
          if (currentBizId && currentBizId !== "biz-1") {
            const fetchedProds = await SupabaseService.fetchProducts(currentBizId);
            if (fetchedProds) {
              useInventoryStore.getState().setProducts(fetchedProds);
            }

            const fetchedCusts = await SupabaseService.fetchCustomers(currentBizId);
            if (fetchedCusts) {
              useCustomerStore.getState().setCustomers(fetchedCusts);
            }
          }
          
          console.log("Supabase synchronization completed successfully.");
        } catch (err) {
          console.error("Error during Supabase synchronization:", err);
        }
      }
    };

    syncSupabaseData();
  }, [isOnline, activeBusinessId]);

  // Auto-scroll the active mobile tab to center when the active tab changes
  useEffect(() => {
    if (activeTab) {
      setTimeout(() => {
        const activeEl = document.getElementById(`mobile-tab-${activeTab}`);
        if (activeEl) {
          activeEl.scrollIntoView({
            behavior: "smooth",
            inline: "center",
            block: "nearest"
          });
        }
      }, 120);
    }
  }, [activeTab]);

  // Dynamic branding variables mapping to DOM root
  useEffect(() => {
    if (activeBusiness && activeBusiness.primaryColor) {
      document.documentElement.style.setProperty('--brand-primary', activeBusiness.primaryColor);
      document.documentElement.style.setProperty('--brand-primary-hover', activeBusiness.primaryColor + 'ee');
    } else {
      document.documentElement.style.removeProperty('--brand-primary');
      document.documentElement.style.removeProperty('--brand-primary-hover');
    }

    if (activeBusiness && activeBusiness.secondaryColor) {
      document.documentElement.style.setProperty('--brand-secondary', activeBusiness.secondaryColor);
    } else {
      document.documentElement.style.removeProperty('--brand-secondary');
    }
  }, [activeBusiness]);

  // Redirect to first permitted tab if activeTab is not permitted for the logged-in role
  useEffect(() => {
    if (currentEmployee) {
      const allTabsWithPerms = [
        { id: "home", permission: "home.view" as const },
        { id: "pos", permission: "pos.create_sale" as const },
        { id: "inventory", permission: "inventory.view" as const },
        { id: "sales", permission: "orders.view" as const },
        { id: "customers", permission: "customers.view" as const },
        { id: "dashboard", permission: "dashboard.view" as const },
        { id: "feedback", permission: "complaints.view" as const },
        { id: "ai", permission: "ai.use" as const },
        { id: "workers", permission: "staff.view" as const },
        { id: "permissions", permission: "staff.roles" as const },
        { id: "profile", permission: "dashboard.view" as const },
        { id: "business-management", permission: "business.update" as const },
        { id: "settings", permission: "settings.view" as const },
        { id: "notifications", permission: "dashboard.view" as const }
      ];
      const permitted = allTabsWithPerms.filter(tab => 
        tab.id === "profile" || tab.id === "notifications" || hasRolePermission(currentEmployee.role, tab.permission as any)
      );
      if (permitted.length > 0 && !permitted.some(tab => tab.id === activeTab)) {
        setActiveTab(permitted[0].id as any);
      }
    }
  }, [currentEmployee, activeTab, permissionVersion]);

  // Hide native splash screen on first client mount
  useEffect(() => {
    splashScreenService.hide();
  }, []);

  // Keyboard native state listeners to dynamically hide bottom navbar and prevent overlapping
  useEffect(() => {
    const unshow = nativeUiService.onKeyboardShow(() => {
      setShowNav(false);
    });
    const unhide = nativeUiService.onKeyboardHide(() => {
      setShowNav(true);
    });
    return () => {
      unshow();
      unhide();
    };
  }, []);

  // Native Android hardware Back Button interception and confirmation flow
  useEffect(() => {
    const unsubscribeBackButton = nativePlatformService.onBackButton(async () => {
      const shouldExit = await nativeUiService.confirm(
        "Exit Application",
        "Are you sure you want to close KayKay's Milk?"
      );
      if (shouldExit) {
        nativePlatformService.exitApp();
      }
    });
    return unsubscribeBackButton;
  }, []);

  // Ensure focused form input is always visible when the virtual keyboard opens
  useEffect(() => {
    const handleScrollActiveElement = () => {
      // Short delay to allow keyboard animations / viewport resizing to finish
      setTimeout(() => {
        const activeEl = document.activeElement;
        if (activeEl) {
          const isInput = activeEl.tagName === "INPUT" ||
                          activeEl.tagName === "TEXTAREA" ||
                          activeEl.tagName === "SELECT" ||
                          activeEl.closest("[contenteditable='true']");
          if (isInput) {
            activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      }, 150);
    };

    let removeKeyboardListener: (() => void) | undefined;

    if (nativePlatformService.isNative()) {
      removeKeyboardListener = nativeUiService.onKeyboardShow(() => {
        handleScrollActiveElement();
      });
    } else if (window.visualViewport) {
      const visualViewport = window.visualViewport;
      visualViewport.addEventListener("resize", handleScrollActiveElement);
      return () => {
        visualViewport.removeEventListener("resize", handleScrollActiveElement);
      };
    }

    return () => {
      if (removeKeyboardListener) {
        removeKeyboardListener();
      }
    };
  }, []);

  // Handle dark class toggling on document root & save theme
  useEffect(() => {
    localStorage.setItem("kaykays-theme", themeMode);
    const root = window.document.documentElement;
    if (themeMode === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    statusBarService.setStyle(themeMode);
  }, [themeMode]);

  // Dynamic Bottom Navbar hiding listener with robust per-element tracking
  const lastScrollPositions = useRef<Map<HTMLElement, number>>(new Map());

  useEffect(() => {
    const handleScroll = (e: Event) => {
      // If we are on the AI page, keep the bottom navigation fully stable and visible to prevent flickering from keyboard or layout shifts
      if (activeTab === "ai") {
        setShowNav(true);
        return;
      }

      const target = e.target as HTMLElement;
      if (!target) return;
      
      let currentScrollY = 0;
      if ((target as any) === document || (target as any) === window) {
        currentScrollY = window.scrollY;
      } else if (typeof target.scrollTop === "number") {
        currentScrollY = target.scrollTop;
      } else {
        return;
      }
      
      // We only care about major content scrolls or containers with overflow-y-auto
      const isScrollable = target.classList?.contains("overflow-y-auto") || 
                           target.tagName === "MAIN" || 
                           (target as any) === document;
      if (!isScrollable) return;

      const prevScrollY = lastScrollPositions.current.get(target) || 0;
      const delta = currentScrollY - prevScrollY;

      // Filter out micro-scroll changes (e.g. from height changes or image loading)
      if (Math.abs(delta) > 15) {
        // Scrolling down -> hide nav, scrolling up -> show nav
        if (delta > 0 && currentScrollY > 60) {
          setShowNav(false);
        } else {
          setShowNav(true);
        }
      }
      
      // Force show nav ONLY at the absolute top
      if (currentScrollY <= 15) {
        setShowNav(true);
      }
      
      lastScrollPositions.current.set(target, currentScrollY);
    };

    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [activeTab]);

  // Show bottom nav instantly when switching views
  useEffect(() => {
    setShowNav(true);
  }, [activeTab]);

  const toggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("kaykays-sidebar-collapsed", String(next));
      return next;
    });
  };

  const isNavVisible = showNav && !isKeyboardVisible;

  return (
    <PreviewFrame>
      <div className="w-full h-full flex flex-col relative bg-app-bg overflow-hidden text-app-text transition-colors duration-200">
        
        {/* WhatsApp-Style Floating Bottom Popup Notification */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 80, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 80, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 350, damping: 28 }}
              className={`absolute bottom-16 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-[380px] z-[9999] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-2 rounded-2xl p-3.5 shadow-2xl flex items-center justify-between gap-3 cursor-pointer select-none group transition-all duration-200 ${
                toast.type === "error"
                  ? "border-red-500/50 dark:border-red-500/35 bg-red-50/98 dark:bg-slate-950/98 shadow-red-500/5"
                  : "border-emerald-500/20 dark:border-emerald-500/10"
              }`}
              onClick={clearToast}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="relative shrink-0">
                  <img
                    src={toast.avatar || "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E"}
                    alt={toast.sender}
                    className={`w-10 h-10 rounded-full object-cover border-2 shadow-sm ${
                      toast.type === "error" ? "border-red-500/40" : "border-emerald-500/30"
                    }`}
                    referrerPolicy="no-referrer"
                  />
                  <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-white dark:border-slate-900  ${
                    toast.type === "error" ? "bg-red-500" : "bg-emerald-500"
                  }`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider block truncate">
                      {toast.sender}
                    </span>
                    <span className={`text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest ${
                      toast.type === "error" 
                        ? "bg-red-500/10 text-red-500 " 
                        : toast.type === "info"
                        ? "bg-amber-500/10 text-amber-500"
                        : "bg-emerald-500/10 text-emerald-500"
                    }`}>
                      {toast.type === "error" ? "System Alert" : toast.type === "info" ? "Stock Alert" : "Activity Update"}
                    </span>
                  </div>
                  <p className={`text-[11px] leading-relaxed mt-0.5 ${
                    toast.type === "error"
                      ? "text-red-700 dark:text-red-300 font-semibold break-words whitespace-pre-wrap"
                      : "text-slate-600 dark:text-slate-300 font-medium truncate"
                  }`}>
                    {toast.message}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="text-[8px] font-mono text-slate-400 dark:text-slate-500 block">
                  {toast.time || "now"}
                </span>
                <span className={`text-[8px] font-bold block mt-1 uppercase tracking-wider transition-colors ${
                  toast.type === "error"
                    ? "text-red-500 group-hover:text-red-400 font-black"
                    : "text-emerald-500 group-hover:text-amber-500"
                }`}>
                  Dismiss
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {!supabaseConfiguredState ? (
            /* CLOUD DATABASE SYNC GATEWAY (ON FIRST LAUNCH ONLY) */
            <motion.div
              key="db-connect"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col justify-center items-center p-4 md:p-8 bg-slate-950 text-slate-100 min-h-screen overflow-y-auto select-none"
            >
              <div className="w-full max-w-md bg-slate-900 border border-slate-800 backdrop-blur-xl rounded-3xl shadow-2xl p-6 md:p-8 space-y-5 animate-fade-in">
                <div className="text-center space-y-2">
                  <div className="mx-auto w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center text-slate-950 font-black text-lg shadow-xl shadow-amber-500/10">
                    <Database size={22} />
                  </div>
                  <h1 className="text-xl font-black font-display tracking-tight text-amber-500 uppercase tracking-widest">
                    Database Sync setup
                  </h1>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    First Launch Configuration
                  </p>
                </div>

                <p className="text-[10.5px] text-slate-400 font-medium leading-relaxed text-center">
                  Configure your cloud Supabase database URL and anonymous API keys to synchronize local offline transactions.
                </p>

                <div className="space-y-3.5">
                  <div className="flex flex-col gap-1">
                    <label className="text-[8.5px] text-slate-400 font-black uppercase tracking-wider block">Supabase Project URL</label>
                    <input
                      type="text"
                      value={setupDbUrl}
                      onChange={(e) => setSetupDbUrl(e.target.value)}
                      placeholder="https://your-project.supabase.co"
                      className="w-full bg-slate-950 text-xs text-slate-100 px-3 py-2 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[8.5px] text-slate-400 font-black uppercase tracking-wider block">Supabase Anon Key</label>
                    <input
                      type="text"
                      value={setupDbKey}
                      onChange={(e) => setSetupDbKey(e.target.value)}
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      className="w-full bg-slate-950 text-xs text-slate-100 px-3 py-2 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none font-mono"
                    />
                  </div>

                  {setupDbError && (
                    <p className="text-[10px] text-red-400 font-bold leading-normal text-center">{setupDbError}</p>
                  )}

                  <button
                    type="button"
                    onClick={handleConnectDatabase}
                    disabled={dbConnecting}
                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wide cursor-pointer transition flex items-center justify-center gap-1.5"
                  >
                    {dbConnecting ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                    <span>{dbConnecting ? "Testing Sync..." : "Connect Database"}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          ) : !termsAccepted ? (
            /* USER AGREEMENT BLOCKER (LAUNCH ONLY) */
            <motion.div
              key="terms-accept"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col justify-center items-center p-4 md:p-8 bg-slate-950 text-slate-100 min-h-screen overflow-y-auto select-none"
            >
              <div className="w-full max-w-md bg-slate-900 border border-slate-800 backdrop-blur-xl rounded-3xl shadow-2xl p-6 md:p-8 space-y-5 animate-fade-in">
                <div className="text-center space-y-2">
                  <div className="mx-auto w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center text-slate-950 font-black text-lg shadow-xl shadow-amber-500/10">
                    <ShieldCheck size={22} />
                  </div>
                  <h1 className="text-xl font-black font-display tracking-tight text-amber-500 uppercase tracking-widest">
                    Terms & Agreement
                  </h1>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    Accept User Agreement to Continue
                  </p>
                </div>

                <div className="max-h-[160px] overflow-y-auto bg-slate-950 border border-slate-800 rounded-2xl p-3.5 text-[10px] text-slate-400 font-medium leading-relaxed space-y-2.5 text-left">
                  <p className="font-bold text-slate-300">1. Authorized Corporate Access Only</p>
                  <p>This terminal portal is exclusively for authorized staff and logistics agents of KayKay's Milk and partner businesses. Unauthorized access, sharing of staff PINs, or spoofing biometric login credentials is strictly prohibited and subject to disciplinary action.</p>
                  <p className="font-bold text-slate-300">2. Offline Caching & Secure Sync</p>
                  <p>Transaction receipts, customer details, and stock audits are cached locally on your device's secure browser sandbox. Data is automatically pushed to Supabase tables once an active network connection is established. Users must ensure pending synchronizations are complete before signing out to prevent data loss.</p>
                  <p className="font-bold text-slate-300">3. Biometric Security & WebAuthn</p>
                  <p>Device fingerprinting (TouchID/FaceID) is authenticated locally by your platform's secure enclave (WebAuthn API). Raw biometric templates are never captured, stored, or transmitted to KayKay's servers or any third-party database.</p>
                  <p className="font-bold text-slate-300">4. Gemini AI Reports & Consultations</p>
                  <p>The "Kim AI Assistant" relies on the Google Gemini API to analyze store metrics and provide consultative business or KRA tax feedback. AI outputs are advisory only; all financial figures and tax filings must be manually audited before submission.</p>
                  <p className="font-bold text-slate-300">5. POS Auditability & Accountability</p>
                  <p>All Point of Sale transactions, discounts applied, inventory adjustments, and customer debt updates are logged in association with the active employee ID. Staff are fully responsible for the accuracy of POS entries relative to actual physical inventory and deliveries.</p>
                </div>

                <div className="flex items-start gap-2.5 py-1 text-left">
                  <input
                    type="checkbox"
                    id="agree-checkbox"
                    checked={agreeChecked}
                    onChange={(e) => setAgreeChecked(e.target.checked)}
                    className="mt-0.5 w-3.5 h-3.5 accent-amber-500 cursor-pointer rounded shrink-0"
                  />
                  <label htmlFor="agree-checkbox" className="text-[10.5px] text-slate-300 leading-normal font-semibold cursor-pointer select-none">
                    I agree to the terms, conditions, and offline caching security policies of KayKay's Milk Staff Portal.
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleAcceptTerms}
                  disabled={!agreeChecked}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:hover:bg-amber-500 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wide cursor-pointer transition flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 size={12} />
                  <span>Accept & Launch Portal</span>
                </button>
              </div>
            </motion.div>
          ) : isInitializing ? (
            /* SLEEK INITIALIZATION SCREEN */
            <div className="flex-1 flex flex-col justify-center items-center bg-slate-950 text-slate-100 min-h-screen">
              <div className="text-center space-y-4">
                
                <div className="flex justify-center mt-4">
                  <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
                </div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  Loading...
                </p>
              </div>
            </div>
          ) : initializationError ? (
            /* SLEEK INITIALIZATION ERROR SCREEN */
            <div className="flex-1 flex flex-col justify-center items-center bg-slate-950 text-slate-100 min-h-screen p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-md bg-slate-900/80 border border-red-500/30 backdrop-blur-xl rounded-3xl shadow-2xl p-6 md:p-8 space-y-6 text-center relative overflow-hidden"
              >
                {/* Decorative glow */}
                <div className="absolute -top-12 -left-12 w-24 h-24 bg-red-500/10 rounded-full blur-2xl pointer-events-none" />
                <div className="absolute -bottom-12 -right-12 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

                <div className="mx-auto w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center text-red-500 shadow-xl">
                  <WifiOff size={28} className="animate-pulse" />
                </div>
                
                <div className="space-y-2">
                  <h2 className="text-lg font-bold font-display tracking-tight text-red-400 uppercase tracking-wider">
                    Connection Check Failed
                  </h2>
                  <p className="text-xs text-slate-350 leading-relaxed font-semibold">
                    {initializationError}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => performInitialization()}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-slate-950 font-black rounded-2xl text-xs uppercase tracking-wider cursor-pointer transition-all duration-200 shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                >
                  <RefreshCw size={14} />
                  <span>Retry Connection</span>
                </button>
              </motion.div>
            </div>
          ) : !currentUser || !currentUser.isVerified || !currentEmployee || showWorkspaceSwitcher ? (
            /* ONLINE AUTHENTICATION & ONBOARDING PORTAL */
            <motion.div
              key="auth-portal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col justify-center items-center p-4 md:p-8 bg-slate-950 text-slate-100 min-h-screen overflow-y-auto select-none relative"
            >
              {/* Floating Theme Button */}
              <button
                onClick={() => setThemeMode(themeMode === "light" ? "dark" : "light")}
                className="absolute right-4 top-4 p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition cursor-pointer border border-slate-800 shadow-lg flex items-center justify-center"
                title="Toggle Theme"
              >
                {themeMode === "light" ? <Moon size={14} /> : <Sun size={14} />}
              </button>

              <div className="w-full max-w-lg bg-slate-900/80 border border-slate-800 backdrop-blur-xl rounded-3xl shadow-2xl p-6 md:p-8 space-y-6 animate-fade-in relative">
                
                {/* Brand Header */}
                <div className="text-center space-y-2">
                  <div className="mx-auto w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center text-slate-950 font-black text-lg shadow-xl shadow-amber-500/10">
                    <span>KK</span>
                  </div>
                  <h1 className="text-xl font-black font-display tracking-tight text-amber-500 uppercase tracking-widest">
                    KayKay's Milk Systems
                  </h1>
                  <p className="text-[10.5px] text-slate-400 font-bold tracking-wider uppercase">
                    Centralized Auth & Onboarding Hub
                  </p>
                </div>

                {/* WORKSPACE SWITCHER OVERLAY */}
                {showWorkspaceSwitcher && currentUser ? (
                  <div className="space-y-4 animate-fade-in">
                    <div className="text-center space-y-1">
                      <h2 className="text-xs font-black text-amber-500 uppercase tracking-wider">Select Business Workspace</h2>
                      <p className="text-[10px] text-slate-400">Your account is registered across multiple milk retail businesses.</p>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 max-h-[300px] overflow-y-auto">
                      {memberships
                        .filter(m => m.userId === currentUser.id && m.status === "Active")
                        .map(m => {
                          const biz = businesses.find(b => b.id === m.businessId) || {
                            id: m.businessId,
                            name: "Unnamed Workspace Branch",
                            logoUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Crect width='100' height='100' rx='20'/%3E%3Cpath d='M30,70 L50,30 L70,70 Z' fill='%230f172a'/%3E%3C/svg%3E"
                          };
                          return (
                            <button
                              key={m.id}
                              onClick={() => {
                                switchBusiness(m.businessId);
                                setShowWorkspaceSwitcher(false);
                              }}
                              className="w-full p-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/30 rounded-2xl flex items-center justify-between transition group text-left cursor-pointer"
                            >
                              <div className="flex items-center gap-3">
                                <WorkspaceLogo logoUrl={biz.logoUrl} name={biz.name} />
                                <div>
                                  <h4 className="text-xs font-black text-slate-100 group-hover:text-amber-500 transition-colors">
                                    {biz.name}
                                  </h4>
                                  <span className="text-[9px] font-black uppercase text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded tracking-wider">
                                    {m.role}
                                  </span>
                                </div>
                              </div>
                              <ArrowRight size={14} className="text-slate-500 group-hover:text-amber-500 transition-colors" />
                            </button>
                          );
                        })}
                    </div>

                    <button
                      onClick={() => logout()}
                      className="w-full py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold rounded-xl text-xs transition tracking-wide"
                    >
                      Log Out / Back to Login
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Error & Success Alerts */}
                    {authError && (
                      <div className="p-3 bg-red-500/10 border border-red-500/25 text-red-500 rounded-2xl text-[11px] leading-relaxed font-semibold flex items-start gap-2 animate-fade-in">
                        <AlertCircle size={14} className="shrink-0 mt-0.5" />
                        <span>{authError}</span>
                      </div>
                    )}

                    {authSuccess && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 text-emerald-500 rounded-2xl text-[11px] leading-relaxed font-semibold flex items-start gap-2 animate-fade-in">
                        <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                        <span>{authSuccess}</span>
                      </div>
                    )}

                    {/* Navigation Tabs (Only shown if owner exists and not in verifying or business creation steps) */}
                    {ownerExists && authViewTab !== "verify" && authViewTab !== "create-biz" && (
                      <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1.5 rounded-2xl border border-slate-800/80">
                        <button
                          type="button"
                          onClick={() => {
                            setAuthViewTab("login");
                            setAuthError("");
                            setAuthSuccess("");
                          }}
                          className={`py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition ${
                            authViewTab === "login"
                              ? "bg-amber-500 text-slate-950 shadow-md"
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                          }`}
                        >
                          Login
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAuthViewTab("accept-invite");
                            setAuthError("");
                            setAuthSuccess("");
                          }}
                          className={`py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition ${
                            authViewTab === "accept-invite"
                              ? "bg-amber-500 text-slate-950 shadow-md"
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                          }`}
                        >
                          Join Team
                        </button>
                      </div>
                    )}

                    {/* TAB CONTENT: LOGIN */}
                    {authViewTab === "login" && (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!loginEmail.trim() || !loginPassword) {
                            setAuthError("Email/phone and password are required.");
                            return;
                          }
                          setAuthLoading(true);
                          setAuthError("");
                          setAuthSuccess("");
                          const res = await loginOnline(loginEmail, loginPassword);
                          setAuthLoading(false);
                          if (res.success) {
                            const current = useAuthStore.getState().currentUser;
                            const currentMems = useAuthStore.getState().memberships.filter(m => m.userId === current?.id && m.status === "Active");
                            if (currentMems.length > 1) {
                              setShowWorkspaceSwitcher(true);
                            }
                          } else {
                            if (res.emailConfirmRequired) {
                              setVerifyEmail(loginEmail);
                              setAuthViewTab("verify");
                              setAuthSuccess("Your email is not confirmed yet. Verification screen loaded.");
                              
                              // Attempt automatic resend of confirmation OTP
                              try {
                                const supabase = getSupabase();
                                const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
                                await supabase.rpc("save_otp", {
                                  p_email: loginEmail.trim(),
                                  p_code: newOtp,
                                  p_type: "signup"
                                });
                                const EmailServiceModule = await import("./services/emailService");
                                await EmailServiceModule.EmailService.sendVerificationCode(loginEmail.trim(), newOtp, loginEmail.split("@")[0]);
                                setAuthSuccess(`Your email is not confirmed. We've sent a new 6-digit verification code to ${loginEmail}.`);
                              } catch (err: any) {
                                console.error("Auto OTP send failed:", err);
                              }
                            } else {
                              setAuthError(res.error || "Failed to log in.");
                            }
                          }
                        }}
                        className="space-y-4 text-xs"
                      >
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Email Address or Phone *</label>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="e.g. owner@kaykaysmilk.com"
                              value={loginEmail}
                              onChange={(e) => setLoginEmail(e.target.value)}
                              className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                            />
                            <Mail size={13} className="absolute left-3 top-3.5 text-slate-500" />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Secure Password *</label>
                            <button
                              type="button"
                              onClick={() => {
                                setAuthError("");
                                setAuthSuccess("");
                                setForgotEmail(loginEmail);
                                setAuthViewTab("forgot-password");
                              }}
                              className="text-[10px] text-amber-500 hover:text-amber-400 font-bold uppercase tracking-wider transition cursor-pointer bg-transparent border-none outline-none"
                            >
                              Forgot Password?
                            </button>
                          </div>
                          <div className="relative">
                            <input
                              type="password"
                              placeholder="••••••••"
                              value={loginPassword}
                              onChange={(e) => setLoginPassword(e.target.value)}
                              className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                            />
                            <Lock size={13} className="absolute left-3 top-3.5 text-slate-500" />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={authLoading}
                          className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition flex items-center justify-center gap-2 uppercase tracking-wider cursor-pointer shadow-lg shadow-amber-500/5 mt-2"
                        >
                          {authLoading ? "Authenticating Session..." : "Secure Login Session"}
                        </button>

                        <div className="text-center mt-3 pt-1 border-t border-slate-900/60">
                          <button
                            type="button"
                            onClick={() => {
                              setAuthError("");
                              setAuthSuccess("");
                              setVerifyEmail(loginEmail);
                              setAuthViewTab("verify");
                            }}
                            className="text-[10px] text-amber-500 hover:text-amber-400 font-bold uppercase tracking-wider transition cursor-pointer bg-transparent border-none outline-none"
                          >
                            Have an unverified account? Verify here
                          </button>
                        </div>

                      </form>
                    )}

                    {/* TAB CONTENT: OWNER ONBOARDING (REGISTER) */}
                    {authViewTab === "register" && (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!regName.trim() || !regEmail.trim() || !regPhone.trim() || !regPassword) {
                            setAuthError("All registration fields are required.");
                            return;
                          }
                          if (regPassword.length < 6) {
                            setAuthError("Password must be at least 6 characters.");
                            return;
                          }
                          setAuthLoading(true);
                          setAuthError("");
                          setAuthSuccess("");
                          const res = await signUpOwner(regName, regEmail, regPhone, regPassword);
                          setAuthLoading(false);
                          if (res.success) {
                            setVerifyEmail(regEmail);
                            setAuthViewTab("verify");
                            setAuthSuccess(`Verification email dispatched successfully!`);
                          } else {
                            setAuthError(res.error || "Failed to create account.");
                          }
                        }}
                        className="space-y-4 text-xs"
                      >
                        <div className="p-3.5 bg-amber-500/5 border border-amber-500/10 rounded-2xl space-y-1.5">
                          <h4 className="text-[10.5px] font-black text-amber-500 uppercase tracking-wider flex items-center gap-1.5">
                            <Building size={12} /> First Person Creating Business
                          </h4>
                          <p className="text-[9.5px] text-slate-400 leading-normal">
                            You will register your primary encrypted personal profile. Business creation occurs instantly upon completing secure email verification.
                          </p>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Full Name *</label>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="e.g. Kipchoge Keino"
                              value={regName}
                              onChange={(e) => setRegName(e.target.value)}
                              className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                            />
                            <User size={13} className="absolute left-3 top-3.5 text-slate-500" />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Email Address *</label>
                          <div className="relative">
                            <input
                              type="email"
                              placeholder="e.g. owner@kaykaysmilk.com"
                              value={regEmail}
                              onChange={(e) => setRegEmail(e.target.value)}
                              className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                            />
                            <Mail size={13} className="absolute left-3 top-3.5 text-slate-500" />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Phone Number (with Country Code) *</label>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="e.g. +254712345678"
                              value={regPhone}
                              onChange={(e) => setRegPhone(e.target.value)}
                              className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                            />
                            <Phone size={13} className="absolute left-3 top-3.5 text-slate-500" />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Choose Password *</label>
                          <div className="relative">
                            <input
                              type="password"
                              placeholder="Minimum 6 characters"
                              value={regPassword}
                              onChange={(e) => setRegPassword(e.target.value)}
                              className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                            />
                            <Lock size={13} className="absolute left-3 top-3.5 text-slate-500" />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={authLoading}
                          className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition flex items-center justify-center gap-2 uppercase tracking-wider cursor-pointer shadow-lg mt-2"
                        >
                          {authLoading ? "Creating Profile..." : "Register Owner Account"}
                        </button>
                      </form>
                    )}

                    {/* TAB CONTENT: OWNER ONBOARDING (STAGE 2: EMAIL VERIFICATION PENDING) */}
                    {authViewTab === "verify" && (
                      <div className="space-y-5 text-xs animate-fade-in text-center">
                        <div className="py-4 flex justify-center">
                          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-500 ">
                            <Mail size={24} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-xs font-black text-amber-500 uppercase tracking-widest">
                            Confirm Your Email
                          </h3>
                          
                          {!isEditingEmail ? (
                            <div className="space-y-1.5">
                              <p className="text-[10.5px] text-slate-300 leading-relaxed">
                                We've sent a 6-digit verification code to:
                              </p>
                              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl">
                                <span className="font-bold text-slate-200">{verifyEmail || "(no email set)"}</span>
                                <button
                                  onClick={() => {
                                    setNewEmailInput(verifyEmail);
                                    setIsEditingEmail(true);
                                    setAuthError("");
                                    setAuthSuccess("");
                                  }}
                                  className="text-amber-500 hover:text-amber-400 p-0.5 transition cursor-pointer"
                                  title="Edit Email"
                                >
                                  <Edit size={12} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <form
                              onSubmit={async (e) => {
                                e.preventDefault();
                                if (!newEmailInput.trim()) {
                                  setAuthError("Email address cannot be empty.");
                                  return;
                                }
                                setAuthLoading(true);
                                setAuthError("");
                                setAuthSuccess("");
                                
                                if (currentUser) {
                                  const res = await updateEmailDuringVerification(newEmailInput);
                                  setAuthLoading(false);
                                  if (res.success) {
                                    setVerifyEmail(newEmailInput.trim());
                                    setIsEditingEmail(false);
                                    setVerifyCountdown(60);
                                    setVerifyCode("");
                                    setAuthSuccess(`Email updated and verification code sent to ${newEmailInput.trim()}!`);
                                  } else {
                                    setAuthError(res.error || "Failed to update email.");
                                  }
                                } else {
                                  // Guest mode email change - update local state and send new verification code via RPC
                                  try {
                                    const supabase = getSupabase();
                                    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
                                    
                                    const { error: rpcErr } = await supabase.rpc("save_otp", {
                                      p_email: newEmailInput.trim(),
                                      p_code: newOtp,
                                      p_type: "signup"
                                    });
                                    if (rpcErr) throw rpcErr;

                                    const EmailServiceModule = await import("./services/emailService");
                                    await EmailServiceModule.EmailService.sendVerificationCode(newEmailInput.trim(), newOtp, newEmailInput.split("@")[0] || "User");

                                    setVerifyEmail(newEmailInput.trim());
                                    setIsEditingEmail(false);
                                    setVerifyCountdown(60);
                                    setVerifyCode("");
                                    setAuthSuccess(`Verification code sent to ${newEmailInput.trim()}!`);
                                  } catch (err: any) {
                                    console.error("Guest OTP send failed:", err);
                                    setAuthError(err.message || "Failed to send verification code. Verify provider setup.");
                                  } finally {
                                    setAuthLoading(false);
                                  }
                                }
                              }}
                              className="w-full max-w-sm mx-auto space-y-3 bg-slate-950 p-3.5 border border-slate-800 rounded-2xl animate-fade-in"
                            >
                              <div className="text-left space-y-1">
                                <label className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider block">Update Email Address</label>
                                <input
                                  type="email"
                                  placeholder="e.g. owner@kaykaysmilk.com"
                                  value={newEmailInput}
                                  onChange={(e) => setNewEmailInput(e.target.value)}
                                  className="w-full bg-slate-900 text-slate-100 px-3 py-2 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                                />
                              </div>
                              <div className="flex gap-2 text-[10px]">
                                <button
                                  type="submit"
                                  disabled={authLoading}
                                  className="flex-1 py-2 bg-amber-500 text-slate-950 font-black rounded-lg transition hover:bg-amber-600 disabled:opacity-50 uppercase tracking-wide cursor-pointer"
                                >
                                  {authLoading ? "Saving..." : "Save & Resend"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setIsEditingEmail(false)}
                                  className="px-3 py-2 bg-slate-800 text-slate-300 font-bold rounded-lg transition hover:bg-slate-700 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
 
                        {!isEditingEmail && (
                          <>
                            <div className="py-3 flex justify-center">
                              <OtpInput
                                length={6}
                                value={verifyCode}
                                onChange={setVerifyCode}
                                disabled={authLoading}
                                onComplete={(code) => handleVerifyOtpSubmit(code)}
                              />
                            </div>
 
                            <div className="flex flex-col gap-2.5">
                              {verifyCountdown > 0 ? (
                                <span className="text-[10px] text-slate-400">
                                  Resend code in <strong className="text-amber-500">{verifyCountdown}s</strong>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={handleResendCode}
                                  disabled={isResending}
                                  className="text-[10.5px] text-amber-500 hover:text-amber-400 font-bold uppercase tracking-wider transition cursor-pointer"
                                >
                                  {isResending ? "Resending Code..." : "Resend Code"}
                                </button>
                              )}
 
                              <button
                                type="button"
                                onClick={() => handleVerifyOtpSubmit()}
                                disabled={authLoading || verifyCode.length !== 6}
                                className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition uppercase tracking-wider cursor-pointer shadow-lg mt-2"
                              >
                                {authLoading ? "Verifying..." : "Verify Code"}
                              </button>
 
                              {!currentUser ? (
                                <div className="flex justify-center gap-4 mt-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAuthViewTab("login");
                                      setAuthError("");
                                      setAuthSuccess("");
                                    }}
                                    className="text-[10px] text-slate-400 hover:text-slate-300 transition uppercase tracking-wider cursor-pointer font-bold bg-transparent border-none outline-none"
                                  >
                                    Return to Login
                                  </button>
                                  <span className="text-[10px] text-slate-700">|</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAuthViewTab("register");
                                      setAuthError("");
                                      setAuthSuccess("");
                                    }}
                                    className="text-[10px] text-slate-400 hover:text-slate-300 transition uppercase tracking-wider cursor-pointer font-bold bg-transparent border-none outline-none"
                                  >
                                    Return to Register
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => logout()}
                                  className="text-[10px] text-red-400 hover:text-red-300 transition uppercase tracking-wider cursor-pointer mt-1 font-bold bg-transparent border-none outline-none"
                                >
                                  Cancel & Sign Out
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* TAB CONTENT: OWNER ONBOARDING (STAGE 3: CREATE BUSINESS) */}
                    {authViewTab === "create-biz" && (
                      <div className="space-y-5 text-xs animate-fade-in">
                        <div className="text-center space-y-1">
                          <h3 className="text-xs font-black text-amber-500 uppercase tracking-widest flex items-center justify-center gap-1.5">
                            <Building size={16} /> Register Business Hub
                          </h3>
                          <p className="text-[10.5px] text-slate-400">
                            Configure your initial business workspace and dairy branch metadata.
                          </p>
                        </div>

                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!bizNameField.trim()) {
                              setAuthError("Business name is required.");
                              return;
                            }
                            setAuthLoading(true);
                            setAuthError("");
                            setAuthSuccess("");
                            const res = await createBusinessWithOwner(bizNameField, bizTypeField, bizCountryField, bizCurrencyField);
                            setAuthLoading(false);
                            if (res.success) {
                              setBizNameField("");
                            } else {
                              setAuthError(res.error || "Failed to create business.");
                            }
                          }}
                          className="space-y-4"
                        >
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Business / Outlet Name *</label>
                            <div className="relative">
                              <input
                                type="text"
                                placeholder="e.g. KayKay's Milk - Nakuru Outlet"
                                value={bizNameField}
                                onChange={(e) => setBizNameField(e.target.value)}
                                className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                              />
                              <Building size={13} className="absolute left-3 top-3.5 text-slate-500" />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Business Type *</label>
                              <div className="relative">
                                <SearchableDropdown
                                  items={[
                                    { id: "Retail", label: "Retail Store" },
                                    { id: "Wholesale", label: "Wholesale Depot" },
                                    { id: "Farm", label: "Dairy Farm" },
                                    { id: "Dairy Processing", label: "Processing Plant" }
                                  ]}
                                  selectedValue={bizTypeField}
                                  onChange={(val) => setBizTypeField(val)}
                                  placeholder="Select type..."
                                />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Country *</label>
                              <div className="relative">
                                <SearchableDropdown
                                  items={[
                                    { id: "Kenya", label: "Kenya" },
                                    { id: "Uganda", label: "Uganda" },
                                    { id: "Tanzania", label: "Tanzania" },
                                    { id: "Rwanda", label: "Rwanda" },
                                    { id: "Somalia", label: "Somalia" }
                                  ]}
                                  selectedValue={bizCountryField}
                                  onChange={(val) => setBizCountryField(val)}
                                  placeholder="Select country..."
                                />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Base Operating Currency *</label>
                            <div className="relative">
                              <SearchableDropdown
                                items={[
                                  { id: "Ksh", label: "Ksh (Kenyan Shilling)" },
                                  { id: "USh", label: "USh (Ugandan Shilling)" },
                                  { id: "TSh", label: "TSh (Tanzanian Shilling)" },
                                  { id: "RWF", label: "RWF (Rwandan Franc)" },
                                  { id: "USD", label: "USD (US Dollar)" }
                                ]}
                                selectedValue={bizCurrencyField}
                                onChange={(val) => setBizCurrencyField(val)}
                                placeholder="Select currency..."
                              />
                              <Coins size={13} className="absolute left-3 top-3.5 text-slate-500 pointer-events-none" />
                            </div>
                          </div>

                          <button
                            type="submit"
                            disabled={authLoading}
                            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition uppercase tracking-wider font-sans"
                          >
                            {authLoading ? "Initializing Core Hub..." : "Construct Business Workspace"}
                          </button>
                        </form>
                      </div>
                    )}

                    {/* TAB CONTENT: JOIN TEAM (ACCEPT INVITATION) */}
                    {authViewTab === "accept-invite" && (
                      <div className="space-y-4 text-xs animate-fade-in">
                        <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-2xl space-y-1">
                          <h4 className="text-[10.5px] font-black text-amber-500 uppercase tracking-wider flex items-center gap-1.5">
                            <Key size={12} /> Invitation Verification Portal
                          </h4>
                          <p className="text-[9.5px] text-slate-400 leading-normal">
                            Please verify your secure single-use invitation token sent by your Business Owner or Manager to register and attach membership.
                          </p>
                        </div>

                        {!inviteVerified ? (
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              let code = inviteTokenInput.trim().toUpperCase();
                              if (code.startsWith("INV-")) {
                                code = code.slice(4);
                              }
                              if (code.length !== 6) {
                                setAuthError("Invitation Code must be exactly 6 characters.");
                                return;
                              }
                              const fullCode = `INV-${code}`;
                              setAuthLoading(true);
                              setAuthError("");
                              setAuthSuccess("");
                              const res = await verifyInvitation(fullCode);
                              setAuthLoading(false);
                              if (res.success && res.invitation) {
                                setValidatedInvite(res.invitation);
                                setInviteVerified(true);
                                setInviteName(res.invitation.name);
                                setInviteEmail(res.invitation.email);
                                setInvitePhone(res.invitation.phone || "");
                                setInviteTokenInput(fullCode);
                                setAuthSuccess(`Secure invitation validated successfully for joining as ${res.invitation.role}! Fill in details to accept.`);
                              } else {
                                setAuthError(res.error || "Invalid invitation token.");
                              }
                            }}
                            className="space-y-4"
                          >
                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block text-center mb-2">Enter 6-Digit Invitation Code *</label>
                              <div className="flex justify-center py-2">
                                <OtpInput
                                  length={6}
                                  alphanumeric={true}
                                  value={inviteTokenInput.toUpperCase().startsWith("INV-") ? inviteTokenInput.slice(4) : inviteTokenInput}
                                  onChange={(val) => setInviteTokenInput(val)}
                                  disabled={authLoading}
                                  onComplete={async (code) => {
                                    const fullCode = `INV-${code.toUpperCase()}`;
                                    setAuthLoading(true);
                                    setAuthError("");
                                    setAuthSuccess("");
                                    const res = await verifyInvitation(fullCode);
                                    setAuthLoading(false);
                                    if (res.success && res.invitation) {
                                      setValidatedInvite(res.invitation);
                                      setInviteVerified(true);
                                      setInviteName(res.invitation.name);
                                      setInviteEmail(res.invitation.email);
                                      setInvitePhone(res.invitation.phone || "");
                                      setInviteTokenInput(fullCode);
                                      setAuthSuccess(`Secure invitation validated successfully for joining as ${res.invitation.role}! Fill in details to accept.`);
                                    } else {
                                      setAuthError(res.error || "Invalid invitation token.");
                                    }
                                  }}
                                />
                              </div>
                              <span className="text-[9px] text-slate-500 block text-center mt-1 font-mono uppercase">
                                Format: INV-XXXXXX (Prepended automatically)
                              </span>
                            </div>

                            <button
                              type="submit"
                              disabled={authLoading || (inviteTokenInput.toUpperCase().startsWith("INV-") ? inviteTokenInput.length !== 10 : inviteTokenInput.length !== 6)}
                              className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition uppercase tracking-wider cursor-pointer"
                            >
                              {authLoading ? "Validating Token..." : "Verify Invitation Credentials"}
                            </button>
                          </form>
                        ) : (
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              if (!inviteEmail.trim() || !inviteName.trim() || !invitePhone.trim() || !invitePassword || !inviteConfirmPassword) {
                                setAuthError("All credentials are required.");
                                return;
                              }
                              if (inviteEmail.trim().toLowerCase() !== validatedInvite.email.toLowerCase()) {
                                setAuthError("Registration email does not match the invited email address.");
                                return;
                              }
                              if (invitePassword.length < 6) {
                                setAuthError("Password must be at least 6 characters.");
                                return;
                              }
                              if (invitePassword !== inviteConfirmPassword) {
                                setAuthError("Passwords do not match.");
                                return;
                              }
                              setAuthLoading(true);
                              setAuthError("");
                              setAuthSuccess("");
                              setRegPassword(invitePassword);
                              setVerifyEmail(inviteEmail);
                              const res = await acceptInvitation(
                                inviteTokenInput,
                                invitePassword,
                                inviteName,
                                invitePhone
                              );
                              setAuthLoading(false);
                              if (res.success) {
                                setInviteVerified(false);
                                setValidatedInvite(null);
                                setInviteTokenInput("");
                                setInvitePassword("");
                                setInviteConfirmPassword("");
                                setAuthViewTab("verify");
                                setAuthSuccess(`Invitation accepted! A 6-digit OTP verification code has been sent to ${inviteEmail}.`);
                              } else {
                                if (res.requiresLogin) {
                                  // Direct them to login tab
                                  setAuthError(res.error);
                                  setTimeout(() => {
                                    setAuthViewTab("login");
                                    setLoginEmail(validatedInvite.email);
                                  }, 2500);
                                } else {
                                  setAuthError(res.error || "Failed to accept invitation.");
                                }
                              }
                            }}
                            className="space-y-4"
                          >
                            <div className="p-3 bg-slate-950 border border-slate-850 rounded-2xl space-y-1 font-sans">
                              <span className="text-[8px] font-black uppercase text-amber-500 tracking-wider">Target Workspace:</span>
                              <h5 className="text-[11px] font-bold text-slate-200">
                                {businesses.find(b => b.id === validatedInvite.businessId)?.name || "KayKay's Retail Outlet"}
                              </h5>
                              <span className="text-[9px] font-black uppercase text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded inline-block mt-1">
                                Assigned Role: {validatedInvite.role}
                              </span>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Confirm Pre-registered Email *</label>
                              <div className="relative">
                                <input
                                  type="email"
                                  placeholder="Enter your invited email address"
                                  value={inviteEmail}
                                  onChange={(e) => setInviteEmail(e.target.value)}
                                  className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                                />
                                <Mail size={13} className="absolute left-3 top-3.5 text-slate-500" />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Full Name *</label>
                              <div className="relative">
                                <input
                                  type="text"
                                  placeholder="Confirm your name"
                                  value={inviteName}
                                  onChange={(e) => setInviteName(e.target.value)}
                                  className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                                />
                                <User size={13} className="absolute left-3 top-3.5 text-slate-500" />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Phone Number *</label>
                              <div className="relative">
                                <input
                                  type="text"
                                  placeholder="Confirm your phone"
                                  value={invitePhone}
                                  onChange={(e) => setInvitePhone(e.target.value)}
                                  className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                                />
                                <Phone size={13} className="absolute left-3 top-3.5 text-slate-500" />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Secure Password *</label>
                              <div className="relative">
                                <input
                                  type="password"
                                  placeholder="Minimum 6 characters"
                                  value={invitePassword}
                                  onChange={(e) => setInvitePassword(e.target.value)}
                                  className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                                />
                                <Lock size={13} className="absolute left-3 top-3.5 text-slate-500" />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Confirm Password *</label>
                              <div className="relative">
                                <input
                                  type="password"
                                  placeholder="Re-enter password"
                                  value={inviteConfirmPassword}
                                  onChange={(e) => setInviteConfirmPassword(e.target.value)}
                                  className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                                />
                                <Lock size={13} className="absolute left-3 top-3.5 text-slate-500" />
                              </div>
                            </div>

                            <div className="flex gap-2.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setInviteVerified(false);
                                  setValidatedInvite(null);
                                  setAuthError("");
                                  setAuthSuccess("");
                                }}
                                className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold rounded-xl transition"
                              >
                                Re-verify Token
                              </button>
                              <button
                                type="submit"
                                disabled={authLoading}
                                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 text-slate-950 font-black rounded-xl transition uppercase tracking-wider"
                              >
                                {authLoading ? "Joining..." : "Accept & Join"}
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}

                    {/* TAB CONTENT: FORGOT PASSWORD */}
                    {authViewTab === "forgot-password" && (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!forgotEmail.trim()) {
                            setAuthError("Email address is required.");
                            return;
                          }
                          setAuthLoading(true);
                          setAuthError("");
                          setAuthSuccess("");
                          const res = await sendPasswordResetOtp(forgotEmail);
                          setAuthLoading(false);
                          if (res.success) {
                            setAuthViewTab("verify-reset-code");
                            setResetCountdown(60);
                            setAuthSuccess(`A 6-digit password recovery code has been sent to ${forgotEmail}.`);
                          } else {
                            setAuthError(res.error || "Failed to request password reset code.");
                          }
                        }}
                        className="space-y-4 text-xs animate-fade-in"
                      >
                        <div className="text-center space-y-1">
                          <h3 className="text-xs font-black text-amber-500 uppercase tracking-widest flex items-center justify-center gap-1.5">
                            <Key size={16} /> Recover Password
                          </h3>
                          <p className="text-[10.5px] text-slate-400">
                            Enter your email address below to receive a 6-digit secure password reset code.
                          </p>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Email Address *</label>
                          <div className="relative">
                            <input
                              type="email"
                              placeholder="e.g. owner@kaykaysmilk.com"
                              value={forgotEmail}
                              onChange={(e) => setForgotEmail(e.target.value)}
                              className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                            />
                            <Mail size={13} className="absolute left-3 top-3.5 text-slate-500" />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={authLoading}
                          className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition flex items-center justify-center gap-2 uppercase tracking-wider cursor-pointer shadow-lg mt-2"
                        >
                          {authLoading ? "Sending Recovery Code..." : "Send Recovery Code"}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setAuthViewTab("login");
                            setAuthError("");
                            setAuthSuccess("");
                          }}
                          className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-705 text-slate-400 hover:text-slate-200 font-bold rounded-xl text-xs transition tracking-wide text-center"
                        >
                          Return to Login
                        </button>
                      </form>
                    )}

                    {/* TAB CONTENT: VERIFY RESET CODE */}
                    {authViewTab === "verify-reset-code" && (
                      <div className="space-y-5 text-xs animate-fade-in text-center">
                        <div className="py-4 flex justify-center">
                          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-500 ">
                            <ShieldCheck size={24} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-xs font-black text-amber-500 uppercase tracking-widest">
                            Verify Recovery Code
                          </h3>
                          <p className="text-[10.5px] text-slate-300 leading-relaxed">
                            We've sent a 6-digit recovery code to <strong>{forgotEmail}</strong>. Enter it below to verify:
                          </p>
                        </div>

                        <div className="py-3 flex justify-center">
                          <OtpInput
                            length={6}
                            value={resetOtpCode}
                            onChange={setResetOtpCode}
                            disabled={authLoading}
                            onComplete={async (code) => {
                              setAuthLoading(true);
                              setAuthError("");
                              setAuthSuccess("");
                              const res = await verifyPasswordResetOtp(forgotEmail, code);
                              setAuthLoading(false);
                              if (res.success) {
                                setAuthViewTab("reset-password");
                                setAuthSuccess("Code verified! Set your new secure password.");
                              } else {
                                setAuthError(res.error || "Verification failed. Check the code.");
                              }
                            }}
                          />
                        </div>

                        <div className="flex flex-col gap-2.5">
                          {resetCountdown > 0 ? (
                            <span className="text-[10px] text-slate-400">
                              Resend code in <strong className="text-amber-500">{resetCountdown}s</strong>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={async () => {
                                setAuthLoading(true);
                                setAuthError("");
                                setAuthSuccess("");
                                const res = await sendPasswordResetOtp(forgotEmail);
                                setAuthLoading(false);
                                if (res.success) {
                                  setResetCountdown(60);
                                  setResetOtpCode("");
                                  setAuthSuccess(`A new recovery code has been sent to ${forgotEmail}.`);
                                } else {
                                  setAuthError(res.error || "Failed to resend code.");
                                }
                              }}
                              className="text-[10.5px] text-amber-500 hover:text-amber-400 font-bold uppercase tracking-wider transition cursor-pointer"
                            >
                              Resend Code
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={async () => {
                              if (resetOtpCode.length !== 6) {
                                setAuthError("Please enter a valid 6-digit code.");
                                return;
                              }
                              setAuthLoading(true);
                              setAuthError("");
                              setAuthSuccess("");
                              const res = await verifyPasswordResetOtp(forgotEmail, resetOtpCode);
                              setAuthLoading(false);
                              if (res.success) {
                                setAuthViewTab("reset-password");
                                setAuthSuccess("Code verified! Set your new secure password.");
                              } else {
                                setAuthError(res.error || "Verification failed. Check the code.");
                              }
                            }}
                            disabled={authLoading || resetOtpCode.length !== 6}
                            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition uppercase tracking-wider cursor-pointer shadow-lg mt-2"
                          >
                            {authLoading ? "Verifying..." : "Verify Code"}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setAuthViewTab("login");
                              setAuthError("");
                              setAuthSuccess("");
                            }}
                            className="text-[10px] text-slate-400 hover:text-slate-300 transition uppercase tracking-wider cursor-pointer mt-1"
                          >
                            Return to Login
                          </button>
                        </div>
                      </div>
                    )}

                    {/* TAB CONTENT: RESET PASSWORD */}
                    {authViewTab === "reset-password" && (() => {
                      const hasLength = newPassword.length >= 8;
                      const hasUpper = /[A-Z]/.test(newPassword);
                      const hasLower = /[a-z]/.test(newPassword);
                      const hasNumber = /[0-9]/.test(newPassword);
                      const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
                      
                      const strengthScore = [hasLength, hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
                      
                      let strengthColor = "bg-red-500";
                      let strengthText = "Very Weak";
                      if (strengthScore === 2) { strengthColor = "bg-orange-500"; strengthText = "Weak"; }
                      else if (strengthScore === 3) { strengthColor = "bg-yellow-500"; strengthText = "Fair"; }
                      else if (strengthScore === 4) { strengthColor = "bg-lime-500"; strengthText = "Strong"; }
                      else if (strengthScore === 5) { strengthColor = "bg-emerald-500"; strengthText = "Very Strong"; }

                      return (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (newPassword !== confirmPassword) {
                              setAuthError("Passwords do not match.");
                              return;
                            }
                            if (strengthScore < 3) {
                              setAuthError("Please choose a stronger password matching the minimum requirements.");
                              return;
                            }
                            setAuthLoading(true);
                            setAuthError("");
                            setAuthSuccess("");
                            const res = await updatePassword(newPassword);
                            setAuthLoading(false);
                            if (res.success) {
                              setAuthSuccess("Password changed successfully! Returning to login...");
                              // Sign out the recovery session
                              await logout();
                              setTimeout(() => {
                                setAuthViewTab("login");
                                setAuthSuccess("");
                              }, 3000);
                            } else {
                              setAuthError(res.error || "Failed to update password.");
                            }
                          }}
                          className="space-y-4 text-xs animate-fade-in"
                        >
                          <div className="text-center space-y-1">
                            <h3 className="text-xs font-black text-amber-500 uppercase tracking-widest flex items-center justify-center gap-1.5">
                              <Lock size={16} /> Choose New Password
                            </h3>
                            <p className="text-[10.5px] text-slate-400">
                              Establish a strong, encrypted password credentials for your profile.
                            </p>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">New Password *</label>
                            <div className="relative">
                              <input
                                type="password"
                                placeholder="Min. 8 characters"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                              />
                              <Lock size={13} className="absolute left-3 top-3.5 text-slate-500" />
                            </div>
                          </div>

                          {/* PASSWORD STRENGTH VISUAL INDICATOR */}
                          {newPassword && (
                            <div className="space-y-2 p-3 bg-slate-950/65 border border-slate-800 rounded-2xl text-left">
                              <div className="flex justify-between items-center text-[10px]">
                                <span className="text-slate-400 font-semibold">Password Strength:</span>
                                <span className={`font-black uppercase tracking-wider ${strengthScore >= 3 ? "text-emerald-400" : "text-red-400"}`}>{strengthText}</span>
                              </div>
                              <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full ${strengthColor} transition-all duration-300`} 
                                  style={{ width: `${(strengthScore / 5) * 100}%` }} 
                                />
                              </div>
                              
                              <ul className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px] text-slate-400 font-medium">
                                <li className="flex items-center gap-1">
                                  <div className={`w-1.5 h-1.5 rounded-full ${hasLength ? "bg-emerald-500" : "bg-slate-700"}`} />
                                  <span>At least 8 chars</span>
                                </li>
                                <li className="flex items-center gap-1">
                                  <div className={`w-1.5 h-1.5 rounded-full ${hasUpper ? "bg-emerald-500" : "bg-slate-700"}`} />
                                  <span>Uppercase letter</span>
                                </li>
                                <li className="flex items-center gap-1">
                                  <div className={`w-1.5 h-1.5 rounded-full ${hasLower ? "bg-emerald-500" : "bg-slate-700"}`} />
                                  <span>Lowercase letter</span>
                                </li>
                                <li className="flex items-center gap-1">
                                  <div className={`w-1.5 h-1.5 rounded-full ${hasNumber ? "bg-emerald-500" : "bg-slate-700"}`} />
                                  <span>Number digit</span>
                                </li>
                                <li className="flex items-center gap-2 col-span-2">
                                  <div className={`w-1.5 h-1.5 rounded-full ${hasSpecial ? "bg-emerald-500" : "bg-slate-700"}`} />
                                  <span>Special character (e.g. !@#$)</span>
                                </li>
                              </ul>
                            </div>
                          )}

                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Confirm New Password *</label>
                            <div className="relative">
                              <input
                                type="password"
                                placeholder="Re-enter password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full bg-slate-950 text-slate-100 pl-8 pr-3 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none"
                              />
                              <Lock size={13} className="absolute left-3 top-3.5 text-slate-500" />
                            </div>
                          </div>

                          <button
                            type="submit"
                            disabled={authLoading || strengthScore < 3}
                            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition flex items-center justify-center gap-2 uppercase tracking-wider cursor-pointer shadow-lg mt-2"
                          >
                            {authLoading ? "Updating Password..." : "Update Password Credentials"}
                          </button>
                        </form>
                      );
                    })()}

                    {/* TAB CONTENT: SESSION EXPIRED */}
                    {authViewTab === "session-expired" && (
                      <div className="space-y-4 text-xs animate-fade-in text-center py-4">
                        <div className="mx-auto w-12 h-12 bg-red-500/10 border border-red-500/25 rounded-2xl flex items-center justify-center text-red-500 animate-bounce">
                          <Clock size={24} />
                        </div>
                        <div className="space-y-1">
                          <h3 className="text-xs font-black text-red-500 uppercase tracking-wider">Session Expired</h3>
                          <p className="text-[10.5px] text-slate-400 leading-normal">
                            Your secure authenticated session has expired. Please re-authenticate your operator profile.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAuthViewTab("login");
                            setAuthError("");
                            setAuthSuccess("");
                          }}
                          className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl transition uppercase tracking-wider mt-2 cursor-pointer"
                        >
                          Return to Login
                        </button>
                      </div>
                    )}

                    {/* TAB CONTENT: UNAUTHORIZED */}
                    {authViewTab === "unauthorized" && (
                      <div className="space-y-4 text-xs animate-fade-in text-center py-4">
                        <div className="mx-auto w-12 h-12 bg-red-500/10 border border-red-500/25 rounded-2xl flex items-center justify-center text-red-500">
                          <ShieldCheck size={24} />
                        </div>
                        <div className="space-y-1">
                          <h3 className="text-xs font-black text-red-500 uppercase tracking-wider">Unauthorized Access</h3>
                          <p className="text-[10.5px] text-slate-400 leading-normal">
                            You do not have the required permissions to view this business workspace.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            logout();
                            setAuthViewTab("login");
                            setAuthError("");
                            setAuthSuccess("");
                          }}
                          className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl transition uppercase tracking-wider mt-2 cursor-pointer"
                        >
                          Return to Login / Sign Out
                        </button>
                      </div>
                    )}
                  </>
                )}

              </div>
            </motion.div>
          ) : (
            /* COMPACT LOGGED-IN MAIN WORKSPACE VIEW */
            <motion.div
              ref={mainConstraintsRef}
              key="workspace"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col md:flex-row overflow-hidden bg-app-bg"
            >
              {/* SIDEBAR NAVIGATION FOR LARGE SCREENS & TABLETS */}
              <aside 
                className={`hidden md:flex flex-col bg-app-card border-r border-app-border transition-all duration-300 shrink-0 z-30 select-none ${
                  isSidebarCollapsed ? "w-[72px]" : "w-64"
                }`}
              >
                {/* Brand / Expand Toggle Header */}
                <div 
  id="sidebar-brand-header"
  className={`relative border-b border-app-border shrink-0 transition-all duration-300 bg-app-card ${
    isSidebarCollapsed ? "p-4 flex flex-col items-center justify-center gap-4" : "h-40"
  }`}
>
  {isSidebarCollapsed ? (
    <div className="flex flex-col items-center gap-4 w-full">
      <div 
        onClick={() => {
          if (assignableBranchesCount > 1) {
            setShowBusinessDropdown(!showBusinessDropdown);
          }
        }}
        className={`select-none group/brand shrink-0 transition-opacity ${
          assignableBranchesCount > 1 ? "cursor-pointer hover:opacity-90" : "cursor-default"
        }`}
        title={assignableBranchesCount > 1 ? "Click to switch dairy branch" : undefined}
      >
        {activeBusiness.logoUrl ? (
          <img
            src={activeBusiness.logoUrl}
            alt={activeBusiness.name}
            className="w-10 h-10 rounded-full object-cover shadow-sm border border-app-border"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center border border-amber-500/20 transition-colors duration-300">
            <Building size={18} className="text-amber-500" />
          </div>
        )}
      </div>
      <button
        onClick={toggleSidebar}
        className="p-1.5 rounded-lg hover:bg-app-bg text-app-text-muted transition cursor-pointer shrink-0"
        title="Expand Sidebar"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  ) : (
    <div className="flex flex-col w-full h-full relative">
      {/* Cover Photo Banner Area */}
      <div className="relative h-20 w-full shrink-0 bg-gradient-to-r from-amber-500/10 to-amber-600/10 dark:from-amber-500/5 dark:to-amber-600/5">
        {(activeBusiness as any).coverImageUrl && (
          <img
            src={(activeBusiness as any).coverImageUrl}
            alt="Cover"
            className="w-full h-full object-cover filter brightness-[0.85] dark:brightness-[0.6] transition-all duration-300"
            referrerPolicy="no-referrer"
          />
        )}

        {/* Top-Right Toggle Button Overlay */}
        <div className="absolute top-2 right-2 z-10">
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-full bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm transition cursor-pointer"
            title="Collapse Sidebar"
          >
            <ChevronLeft size={14} />
          </button>
        </div>
      </div>

      {/* Profile Section (Overlapping Logo & Text) */}
      <div className="relative flex-1 px-3 pb-3 bg-app-card">
        
        {/* Overlapping Logo (Twitter-style avatar placement) */}
        <div className="absolute -top-7 left-3 p-1 bg-app-card rounded-full z-10 shadow-sm">
          <div
            onClick={() => {
              if (assignableBranchesCount > 1) setShowBusinessDropdown(!showBusinessDropdown);
            }}
            className={`w-12 h-12 rounded-full overflow-hidden bg-app-bg ${
              assignableBranchesCount > 1 ? "cursor-pointer hover:opacity-90" : "cursor-default"
            }`}
          >
            {activeBusiness.logoUrl ? (
              <img
                src={activeBusiness.logoUrl}
                alt={activeBusiness.name}
                className="w-full h-full object-cover border border-app-border/50 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center border border-app-border/50 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 dark:from-slate-800 dark:to-slate-900">
                <Building size={20} className="text-amber-500" />
              </div>
            )}
          </div>
        </div>

        {/* Branch Badge / Spacer (Pushed to the right of the overlapping logo) */}
        <div className="flex justify-end pt-2">
          {assignableBranchesCount > 1 ? (
            <button
              onClick={() => setShowBusinessDropdown(!showBusinessDropdown)}
              className="px-2.5 py-0.5 text-[9px] bg-app-bg border border-app-border hover:border-amber-500/50 text-app-text font-bold rounded-full uppercase tracking-wider transition cursor-pointer"
            >
              Switch ▾
            </button>
          ) : (
            <div className="h-5" /> 
          )}
        </div>

        {/* Business Name Block */}
        <div
          onClick={() => {
            if (assignableBranchesCount > 1) setShowBusinessDropdown(!showBusinessDropdown);
          }}
          className={`mt-1 min-w-0 flex flex-col select-none group/brand ${
            assignableBranchesCount > 1 ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <span className="font-display font-black text-[14px] text-app-text whitespace-nowrap leading-tight truncate">
            {activeBusiness.name}
          </span>
          <span className="text-[10px] text-app-text-muted font-medium mt-0.5 truncate">
            {activeBusiness.address || "Main Workspace"}
          </span>
        </div>
      </div>
    </div>
  )}
</div>

                {/* Profile Badge (Collapsible) */}
                {!isSidebarCollapsed && currentEmployee && (
  <div 
    onClick={() => setActiveTab("profile")} 
    className="mx-3 my-4 p-2.5 bg-app-card hover:bg-app-bg border border-app-border hover:border-amber-500/40 rounded-2xl flex items-center gap-3 shrink-0 cursor-pointer group transition-all duration-300 shadow-sm animate-fade-in"
  >
    {/* Avatar with Status Indicator */}
    <div className="relative shrink-0">
      <img
        src={currentEmployee.avatar}
        alt={currentEmployee.name}
        className="w-10 h-10 rounded-xl object-cover border border-app-border group-hover:border-amber-500/50 transition-colors"
        referrerPolicy="no-referrer"
      />
      {/* Green Online/Active Dot */}
      <span 
        className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-app-card rounded-full" 
        title="Active Shift"
      />
    </div>
    
    {/* User Details */}
    <div className="min-w-0 flex-1">
      <h4 className="text-[12px] font-black text-app-text truncate group-hover:text-amber-500 transition-colors">
        {currentEmployee.name}
      </h4>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="text-[8.5px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded font-black uppercase tracking-widest truncate">
          {currentEmployee.role}
        </span>
      </div>
    </div>

    {/* Hover Action Chevron */}
    <div className="shrink-0 text-app-text-muted group-hover:text-amber-500 transition-all duration-300 opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0">
      <ChevronRight size={14} />
    </div>
  </div>
)}

                {/* Navigation items (Sidebar) */}
                <nav className="flex-1 p-2.5 flex flex-col gap-1 overflow-y-auto">
                  {[
                    { id: "home", label: "Home Dashboard", icon: Home, desc: "Business KPIs & Analytics", permission: "home.view" as const },
                    { id: "dashboard", label: "Shift Controls", icon: Clock, desc: "Punch clock & tasks", permission: "dashboard.view" as const },
                    { id: "pos", label: "POS Checkout", icon: ShoppingCart, desc: "Process delivery sales", permission: "pos.create_sale" as const },
                    { id: "inventory", label: "Inventory Stock", icon: Boxes, desc: "Reconcile truck stock", permission: "inventory.view" as const },
                    { id: "sales", label: "Sales Log", icon: Receipt, desc: "View synced orders", permission: "orders.view" as const },
                    { id: "customers", label: "Loyalty Club", icon: Heart, desc: "Manage members", permission: "customers.view" as const },
                    { id: "feedback", label: "Customer Reviews", icon: MessageSquare, desc: "Feedback & Sentiment", permission: "complaints.view" as const },
                    { id: "workers", label: "Workers List", icon: Users, desc: "Register & manage staff", permission: "staff.view" as const },
                    { id: "permissions", label: "Permissions", icon: Key, desc: "Configure role access", permission: "staff.roles" as const },
                    { id: "ai", label: `${aiName}`, icon: Brain, desc: "Workspace Assistant", permission: "ai.use" as const },
                    { id: "profile", label: "My Profile", icon: User, desc: "Manage profile & PIN", permission: "dashboard.view" as const },
                    { id: "business-management", label: "Business Management", icon: Building, desc: "Name, logo, branding", permission: "business.update" as const },
                    { id: "settings", label: "Settings", icon: Settings, desc: "Preferences & Security", permission: "settings.view" as const }
                  ].filter(tab => currentEmployee ? (tab.id === "profile" || tab.id === "notifications" || hasRolePermission(currentEmployee.role, tab.permission as any)) : false).map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;

                    return (
                      <button
                        key={tab.id}
                        id={`sidebar-tab-${tab.id}`}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all relative group cursor-pointer text-left ${
                          isActive
                            ? "bg-amber-500/10 border-amber-500/20 text-amber-500 font-bold"
                            : "hover:bg-app-bg text-app-text-muted"
                        }`}
                        title={isSidebarCollapsed ? tab.label : undefined}
                      >
                        {tab.id === "profile" ? (
                          <img
                            src={currentEmployee?.avatar || "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E"}
                            alt="Profile"
                            className={`w-5 h-5 rounded-full object-cover shrink-0 transition-all ${
                              isActive ? "ring-2 ring-amber-500 shadow-xs" : "border border-app-border/70"
                            }`}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <Icon size={18} className={isActive ? "text-amber-500" : ""} />
                        )}
                        
                        {!isSidebarCollapsed ? (
                          <div className="min-w-0 flex-1">
                            <span className="text-xs block font-bold text-app-text">{tab.label}</span>
                            <span className="text-[9px] text-app-text-muted block font-medium mt-0.5 truncate">
                              {tab.desc}
                            </span>
                          </div>
                        ) : (
                          /* Compact Hover Tooltip */
                          <div className="absolute left-16 bg-slate-950 text-white text-[10px] font-black px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 whitespace-nowrap shadow-xl border border-slate-800 z-50">
                            {tab.label}
                          </div>
                        )}
                        
                        {tab.id === "pos" && cartItemsCount > 0 && (
                          <span className={`absolute bg-amber-500 text-slate-950 font-black rounded-full flex items-center justify-center shadow-xs  ${
                            isSidebarCollapsed 
                              ? "top-1.5 right-1.5 w-4.5 h-4.5 text-[8.5px]" 
                              : "right-3.5 top-1/2 -translate-y-1/2 min-w-[20px] h-5 px-1.5 text-[10px]"
                          }`}>
                            {cartItemsCount}
                          </span>
                        )}

                        {tab.id === "notifications" && unreadNotificationsCount > 0 && (
                          <span className={`absolute bg-amber-500 text-slate-950 font-black rounded-full flex items-center justify-center shadow-xs  ${
                            isSidebarCollapsed 
                              ? "top-1.5 right-1.5 w-4.5 h-4.5 text-[8.5px]" 
                              : "right-3.5 top-1/2 -translate-y-1/2 min-w-[20px] h-5 px-1.5 text-[10px]"
                          }`}>
                            {unreadNotificationsCount}
                          </span>
                        )}
                        
                        {isActive && (
                          <div className="absolute left-0 top-3 bottom-3 w-1 bg-amber-500 rounded-r" />
                        )}
                      </button>
                    );
                  })}
                </nav>

                {/* Sidebar Sticky Controls Footer */}
                <div className="p-3 border-t border-app-border flex flex-col gap-2 shrink-0">


                  {/* Interactive Tour Onboarding button */}
                  <button
                    id="restart-tour-button"
                    onClick={() => {
                      setIsTourOpen(true);
                      showToast("Tour Started", "Guided onboarding walkthrough started.", undefined, "success");
                    }}
                    className="w-full flex items-center justify-center gap-2.5 p-2 bg-app-bg hover:bg-app-card border border-app-border text-app-text rounded-xl transition text-[11px] font-bold cursor-pointer"
                    title="Interactive User Tour"
                  >
                    <HelpCircle size={13} className="text-amber-500" />
                    {!isSidebarCollapsed && (
                      <span>Interactive Tour</span>
                    )}
                  </button>

                  {/* Dark Mode Theme toggle */}
                  <button
                    onClick={() => setThemeMode(themeMode === "light" ? "dark" : "light")}
                    className="w-full flex items-center justify-center gap-2.5 p-2 bg-app-bg hover:bg-app-card border border-app-border text-app-text rounded-xl transition text-[11px] font-bold cursor-pointer"
                  >
                    {themeMode === "light" ? <Moon size={13} /> : <Sun size={13} />}
                    {!isSidebarCollapsed && (
                      <span>{themeMode === "light" ? "Dark Theme" : "Light Theme"}</span>
                    )}
                  </button>
                </div>
              </aside>

              {/* MAIN CONTENT SECTION */}
              <div className="flex-1 flex flex-col overflow-hidden relative font-sans">
                
                {/* TOP APPLICATION BAR */}
                <header 
                  className="bg-app-card border-b border-app-border px-3 py-1.5 flex items-center justify-between gap-3 shrink-0 shadow-xs z-30"
                  style={{ paddingTop: "calc(0.375rem + env(safe-area-inset-top, 0px))" }}
                >
                  {/* Brand Logo or Indicator for mobile/tablet only */}
                  <div 
                    onClick={() => {
                      if (assignableBranchesCount > 1) {
                        setShowBusinessDropdown(!showBusinessDropdown);
                      }
                    }}
                    className={`flex items-center gap-1.5 shrink-0 md:hidden select-none ${
                      assignableBranchesCount > 1 ? "cursor-pointer" : "cursor-default"
                    }`}
                    title={assignableBranchesCount > 1 ? "Click to switch dairy branch" : undefined}
                  >
                    <img
                      src={activeBusiness.logoUrl || "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Crect width='100' height='100' rx='20'/%3E%3Cpath d='M30,70 L50,30 L70,70 Z' fill='%230f172a'/%3E%3C/svg%3E"}
                      alt={activeBusiness.name}
                      className="w-7 h-7 rounded-lg object-cover shrink-0 shadow-xs border border-amber-500/20"
                      referrerPolicy="no-referrer"
                    />
                    <span className="font-display font-black text-xs text-app-text hidden md:hidden lg:inline-block">
                      {activeBusiness.name}
                    </span>
                    {assignableBranchesCount > 1 && (
                      <span className="text-[9px] text-amber-500">▼</span>
                    )}
                  </div>

                  {/* Desktop dummy spacer for balanced layout */}
                  <div className="hidden md:block shrink-0" />

                  {/* Global Unified Search Bar */}
                  <div id="global-search-container" className="flex-1 max-w-sm hidden md:block">
                    <GlobalSearch onNavigateTab={(tab) => setActiveTab(tab)} />
                  </div>

                  {/* Top Right Action Items */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Notification Bell Icon (Always visible) */}
                    <button
                      id="header-notification-bell"
                      onClick={() => setActiveTab("notifications")}
                      className={`p-1.5 rounded-lg border transition cursor-pointer relative ${
                        activeTab === "notifications"
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-500"
                          : "bg-app-bg border-app-border text-app-text hover:text-app-text"
                      }`}
                      title="System Message Center"
                    >
                      <Bell size={13} className={unreadNotificationsCount > 0 ? "animate-swing" : ""} />
                      {unreadNotificationsCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-amber-500 text-slate-950 font-black rounded-full w-3.5 h-3.5 text-[7.5px] flex items-center justify-center  shadow-sm">
                          {unreadNotificationsCount}
                        </span>
                      )}
                    </button>

                    {/* Status controls (visible on mobile only since desktop is inside sidebar) */}
                    <div className="flex items-center gap-1.5 md:hidden">
                      {/* Network Online status toggle */}
                      <button
                        onClick={toggleNetwork}
                        className={`p-1.5 rounded-lg border transition cursor-pointer ${
                          isOnline 
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/15" 
                            : "bg-red-500/10 border-red-500/20 text-red-500  hover:bg-red-500/15"
                        }`}
                        title={isOnline ? "Network is Online. Click to go Offline." : "Network is Offline. Click to go Online."}
                      >
                        {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
                      </button>

                      {/* Dark Mode toggle */}
                      <button
                        onClick={() => setThemeMode(themeMode === "light" ? "dark" : "light")}
                        className="p-1.5 bg-app-bg border border-app-border text-app-text hover:bg-app-card rounded-lg transition cursor-pointer"
                        title="Toggle Theme"
                      >
                        {themeMode === "light" ? <Moon size={13} /> : <Sun size={13} />}
                      </button>
                    </div>
                  </div>
                </header>

                {/* CORE VIEWPORT CARDS */}
                <div className="flex-1 overflow-hidden relative">
                  <AnimatePresence mode="wait">
                    {activeTab === "pos" && (
                      <motion.div
                        key="pos-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="pos.create_sale">
                          <POSView />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "inventory" && (
                      <motion.div
                        key="inv-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="inventory.view">
                          <InventoryView />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "sales" && (
                      <motion.div
                        key="sales-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="orders.view">
                          <SalesView />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "home" && (
                      <motion.div
                        key="home-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="home.view">
                          <HomeView />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "customers" && (
                      <motion.div
                        key="cust-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="customers.view">
                          <CustomersView />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "dashboard" && (
                      <motion.div
                        key="dash-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="dashboard.view">
                          <DashboardView />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "ai" && (
                      <motion.div
                        key="ai-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="ai.use">
                          <WorkspaceAssistantView />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "workers" && (
                      <motion.div
                        key="workers-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="staff.view">
                          <WorkersView />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "permissions" && (
                      <motion.div
                        key="permissions-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="staff.roles">
                          <PermissionsView />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "feedback" && (
                      <motion.div
                        key="feedback-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="complaints.view">
                          <CustomerFeedbackView />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "profile" && (
                      <motion.div
                        key="profile-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <ProfileView onRestartTour={() => setIsTourOpen(true)} />
                      </motion.div>
                    )}
                    {activeTab === "settings" && (
                      <motion.div
                        key="settings-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="settings.view">
                          <SettingsView onRestartTour={() => setIsTourOpen(true)} />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "business-management" && (
                      <motion.div
                        key="business-management-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <SecurityGuard permission="business.update">
                          <BusinessManagementView />
                        </SecurityGuard>
                      </motion.div>
                    )}
                    {activeTab === "notifications" && (
                      <motion.div
                        key="notifications-view"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0"
                      >
                        <NotificationsView />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Manual Bottom Navbar Toggle Button (Mobile Only) */}
                {currentEmployee && (
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ 
                      opacity: isKeyboardVisible ? 0 : 1,
                      pointerEvents: isKeyboardVisible ? "none" : "auto",
                    }}
                    onClick={() => setShowNav(!showNav)}
                    className="fixed right-0 bottom-24 z-40 md:hidden bg-slate-950/95 dark:bg-slate-900/95 backdrop-blur-md text-amber-500 border-y border-l border-amber-500/20 w-3.5 h-12 rounded-l-md shadow-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:bg-slate-900 transition-colors focus:outline-none"
                    title={showNav ? "Hide Navigation Menu" : "Show Navigation Menu"}
                  >
                    <div className="w-[1.5px] h-3 bg-amber-500/80 rounded-full" />
                    <div className="w-[1.5px] h-1 bg-amber-500/80 rounded-full" />
                  </motion.button>
                )}

                 {/* BOTTOM NAVIGATION BAR (MOBILE ONLY, SLIDES/FADES OUT ON SCROLL) */}
                <motion.nav
                  initial={{ y: 0, opacity: 1 }}
                  animate={{ 
                    y: isNavVisible ? 0 : 90, 
                    opacity: isNavVisible ? 1 : 0,
                    pointerEvents: isNavVisible ? "auto" : "none"
                  }}
                  transition={{ type: "spring", stiffness: 220, damping: 24 }}
                  className="fixed bottom-3.5 left-3.5 right-3.5 md:hidden bg-slate-950/95 dark:bg-slate-900/95 backdrop-blur-md border border-app-border/80 flex items-center justify-around h-15 shrink-0 z-30 shadow-xl rounded-2xl select-none font-sans overflow-x-auto scrollbar-none px-2 gap-0.5"
                >
                  {[
                    { id: "home", label: "Home", icon: Home, permission: "home.view" as const },
                    { id: "dashboard", label: "Shift", icon: Clock, permission: "dashboard.view" as const },
                    { id: "pos", label: "POS", icon: ShoppingCart, permission: "pos.create_sale" as const },
                    { id: "inventory", label: "Inventory", icon: Boxes, permission: "inventory.view" as const },
                    { id: "sales", label: "Sales Log", icon: Receipt, permission: "orders.view" as const },
                    { id: "customers", label: "Loyalty", icon: Heart, permission: "customers.view" as const },
                    { id: "feedback", label: "Feedback", icon: MessageSquare, permission: "complaints.view" as const },
                    { id: "workers", label: "Workers", icon: Users, permission: "staff.view" as const },
                    { id: "permissions", label: "Roles", icon: Key, permission: "staff.roles" as const },
                    { id: "ai", label: "Assistant", icon: Bot, permission: "ai.use" as const },
                    { id: "profile", label: "Profile", icon: User, permission: "dashboard.view" as const },
                    { id: "business-management", label: "Business", icon: Building, permission: "business.update" as const },
                    { id: "settings", label: "Settings", icon: Settings, permission: "settings.view" as const }
                  ].filter(tab => currentEmployee ? (tab.id === "profile" || tab.id === "notifications" || hasRolePermission(currentEmployee.role, tab.permission as any)) : false).map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;

                    return (
                      <button
                        key={tab.id}
                        id={`mobile-tab-${tab.id}`}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex flex-col items-center justify-center flex-1 min-w-[40px] max-w-[80px] px-0.5 h-full transition-all relative shrink-0 cursor-pointer ${
                          isActive 
                            ? "text-amber-500 font-bold" 
                            : "text-slate-400 dark:text-slate-500 hover:text-slate-200"
                        }`}
                      >
                        <div className="relative flex items-center justify-center">
                          {tab.id === "profile" ? (
                            <img
                              src={currentEmployee?.avatar || "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E"}
                              alt="Profile"
                              className={`w-4.5 h-4.5 rounded-full object-cover transition-all ${
                                isActive ? "ring-2 ring-amber-500 shadow-xs" : "border border-app-border/70"
                              }`}
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <Icon size={16} />
                          )}

                          {tab.id === "pos" && cartItemsCount > 0 && (
                            <span className="absolute -top-1.5 -right-2 bg-amber-500 text-slate-950 font-black rounded-full w-3.5 h-3.5 text-[7.5px] flex items-center justify-center shadow-xs ">
                              {cartItemsCount}
                            </span>
                          )}

                          {tab.id === "notifications" && unreadNotificationsCount > 0 && (
                            <span className="absolute -top-1.5 -right-2 bg-amber-500 text-slate-950 font-black rounded-full w-3.5 h-3.5 text-[7.5px] flex items-center justify-center shadow-xs ">
                              {unreadNotificationsCount}
                            </span>
                          )}
                        </div>
                        <span className={`text-[8.5px] mt-0.5 tracking-tight transition-all duration-200 ${isActive ? "opacity-100 scale-100 h-auto" : "opacity-0 scale-75 h-0 overflow-hidden"}`}>{tab.label}</span>
                        {isActive && (
                          <motion.div
                            layoutId="activeTabIndicator"
                            className="absolute bottom-1 w-6 h-0.5 bg-amber-500 rounded-full"
                            transition={{ type: "spring", stiffness: 380, damping: 30 }}
                          />
                        )}
                      </button>
                    );
                  })}
                </motion.nav>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Profile Picture Action Button (FAB) — DRAGGABLE ENCLAVE FIXED */}
        {currentEmployee && !isTerminalLocked && activeTab !== "profile" && (
          <motion.div
            drag
            dragConstraints={mainConstraintsRef}
            dragMomentum={false}
            dragElastic={0.1}
            // ── INITIAL DEFENSIVE LAYOUT CORNER PLACEMENT VIA TRANSFORMS ──
            style={{ 
              touchAction: "none",
              top: "40px",
              right: "16px",
              bottom: "auto",
              left: "auto"
            }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="fixed z-50 group cursor-grab active:cursor-grabbing select-none"
            onTap={() => {
              setActiveTab("profile");
            }}
          >
            <div className="relative">
              <img
                src={currentEmployee.avatar || "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E"}
                alt="My Profile"
                className="w-9 h-9 md:w-10 md:h-10 rounded-full object-cover border-2 border-amber-500 shadow-xl shadow-amber-500/20 bg-slate-900 group-hover:border-amber-400 group-hover:shadow-amber-500/40 transition duration-300 pointer-events-none"
                referrerPolicy="no-referrer"
              />
              <span className="absolute -top-0.5 -right-0.5 bg-amber-500 text-slate-950 font-black rounded-full text-[7.5px] px-1 py-0.5 uppercase tracking-wider scale-90 md:scale-100 shadow-sm border border-white dark:border-slate-900 pointer-events-none">
                Me
              </span>
              {/* Tooltip */}
              <div className="absolute right-12 top-1/2 -translate-y-1/2 bg-slate-950/90 dark:bg-slate-900/90 border border-slate-800 text-white font-bold text-[10px] px-2.5 py-1 rounded-xl shadow-xl uppercase tracking-wider block opacity-0 pointer-events-none group-hover:opacity-100 transition duration-300 whitespace-nowrap">
                My Profile
              </div>
            </div>
          </motion.div>
        )}

        {/* Multi-Business Management & Switcher Modal Overlay */}
        <AnimatePresence>
          {showBusinessDropdown && (
            <>
              {/* Darkened backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setShowBusinessDropdown(false);
                  setIsCreatingBusiness(false);
                  setEditingBizId(null);
                }}
                className="fixed inset-0 bg-black z-[990]"
              />

              {/* Modal Card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="fixed inset-x-4 bottom-4 md:bottom-auto md:top-24 md:left-1/2 md:-translate-x-1/2 md:max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 z-[995] overflow-hidden flex flex-col font-sans"
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-3.5 shrink-0">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100">Select Active Workspace</h3>
                    <p className="text-[9px] text-slate-500 dark:text-slate-400 font-bold uppercase mt-0.5">Switch or configure your dairy branches (Max 5)</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowBusinessDropdown(false);
                      setIsCreatingBusiness(false);
                      setEditingBizId(null);
                    }}
                    className="w-6 h-6 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-400 dark:text-slate-500 text-xs font-bold transition"
                  >
                    ✕
                  </button>
                </div>

                {/* List of Branches */}
                {!isCreatingBusiness && !editingBizId ? (
                  <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
                    {businesses
                      .filter((biz) => {
                        if (!currentEmployee) return false;
                        if (hasRolePermission(currentEmployee.role, "settings.view")) {
                          return true;
                        }
                        const assigned = currentEmployee.assignedBranches || [];
                        if (assigned.length === 0) {
                          return biz.id === "biz-1";
                        }
                        return assigned.includes(biz.id);
                      })
                      .map((biz) => {
                        const isActive = biz.id === activeBusinessId;
                        return (
                          <div
                            key={biz.id}
                            className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                              isActive
                                ? "bg-amber-500/10 border-amber-500"
                                : "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-amber-500/25"
                            }`}
                          >
                            <div
                              onClick={() => {
                                setActiveBusinessId(biz.id);
                                setShowBusinessDropdown(false);
                              }}
                              className="flex-1 flex items-center gap-3 cursor-pointer min-w-0"
                            >
                              <WorkspaceLogo logoUrl={biz.logoUrl} name={biz.name} />
                              <div className="min-w-0 flex-1">
                                <h4 className="text-xs font-black text-slate-900 dark:text-slate-50 truncate">{biz.name}</h4>
                                <p className="text-[9.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{biz.description || "Dairy Branch"}</p>
                                {biz.address && (
                                  <span className="text-[8px] font-mono text-amber-500 uppercase font-black block mt-1">{biz.address}</span>
                                )}
                              </div>
                            </div>

                            {/* Quick Edit/Delete Actions for Owner */}
                            {hasRolePermission(currentEmployee.role, "settings.view") && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => {
                                    setEditingBizId(biz.id);
                                    setEditBizName(biz.name);
                                    setEditBizDesc(biz.description || "");
                                    setEditBizAddr(biz.address || "");
                                    setEditBizLogo(biz.logoUrl || "");
                                  }}
                                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-800/80 transition text-xs flex items-center justify-center"
                                  title="Edit branch settings"
                                >
                                  <Edit size={11} className="text-slate-500" />
                                </button>
                                {businesses.length > 1 && (
                                  <button
                                    onClick={async () => {
                                      const confirmed = await nativeUiService.confirm(
                                        "Delete Workspace",
                                        `Are you sure you want to permanently close and delete "${biz.name}"? This will hide all its associated transaction data.`
                                      );
                                      if (confirmed) {
                                        deleteBusiness(biz.id);
                                        showToast("System Update", `Branch "${biz.name}" has been deleted.`);
                                      }
                                    }}
                                    className="p-1.5 hover:bg-red-500/10 text-red-500 rounded-lg border border-red-500/20 transition text-xs flex items-center justify-center"
                                    title="Close branch"
                                  >
                                    <Trash2 size={11} className="text-red-500" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                    {businesses.length < 5 && hasRolePermission(currentEmployee.role, "settings.view") && (
                      <button
                        onClick={() => {
                          setIsCreatingBusiness(true);
                          setNewBizName("");
                          setNewBizDesc("");
                          setNewBizAddr("");
                        }}
                        className="mt-2 py-2.5 border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-amber-500/50 rounded-2xl text-[10px] font-black uppercase text-amber-500 hover:bg-amber-500/5 transition cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        ➕ Create Branch ({businesses.length}/5)
                      </button>
                    )}
                  </div>
                ) : isCreatingBusiness ? (
                  /* Create Business form */
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newBizName.trim()) {
                        showToast("Validation Error", "Branch/Business Name is required.", undefined, "error");
                        return;
                      }
                      if (newBizEmail.trim() && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(newBizEmail)) {
                        showToast("Validation Error", "Please provide a valid contact email address.", undefined, "error");
                        return;
                      }
                      if (newBizPhone.trim() && !/^\+[1-9]\d{1,14}$/.test(newBizPhone)) {
                        showToast("Validation Error", "Contact Phone must be in E.164 format (e.g. +254712345678).", undefined, "error");
                        return;
                      }

                      const biz = await addBusiness(
                        newBizName,
                        newBizDesc,
                        newBizAddr,
                        newBizLogo,
                        newBizType,
                        "Kenya",
                        newBizCurrency,
                        newBizCover,
                        newBizEmail,
                        newBizPhone,
                        newBizTimezone,
                        newBizPaymentMethods
                      );

                      if (biz) {
                        setIsCreatingBusiness(false);
                        setNewBizName("");
                        setNewBizDesc("");
                        setNewBizAddr("");
                        setNewBizLogo("");
                        setNewBizCover("");
                        setNewBizPhone("");
                        setNewBizEmail("");
                        setNewBizCurrency("Ksh");
                        setNewBizTimezone("Africa/Nairobi");
                        setNewBizType("Retail");
                        setNewBizPaymentMethods(["Cash", "M-Pesa"]);
                        setShowBusinessDropdown(false);
                      }
                    }}
                    className="flex flex-col gap-3.5 text-xs font-semibold animate-fade-in"
                  >
                    <div className="flex-1 overflow-y-auto max-h-[360px] pr-1.5 space-y-3">
                      {/* Name */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Branch / Business Name *</label>
                        <input
                          type="text"
                          placeholder="e.g. KayKay's Milk - Syokimau Hub"
                          value={newBizName}
                          onChange={(e) => setNewBizName(e.target.value)}
                          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 font-bold"
                          required
                        />
                      </div>

                      {/* Description */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Description</label>
                        <input
                          type="text"
                          placeholder="e.g. Cold room distribution & delivery spot"
                          value={newBizDesc}
                          onChange={(e) => setNewBizDesc(e.target.value)}
                          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      {/* Address */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Location Address</label>
                        <input
                          type="text"
                          placeholder="e.g. Airport Road, Nairobi"
                          value={newBizAddr}
                          onChange={(e) => setNewBizAddr(e.target.value)}
                          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      {/* Row: Type & Currency */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Business Type</label>
                          <SearchableDropdown
                            items={[
                              { id: "Retail", label: "Retail" },
                              { id: "Wholesale", label: "Wholesale" },
                              { id: "Farm", label: "Farm" },
                              { id: "Dairy Processing", label: "Dairy Processing" },
                              { id: "Other", label: "Other" }
                            ]}
                            selectedValue={newBizType}
                            onChange={(val) => setNewBizType(val)}
                            placeholder="Select type..."
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Currency</label>
                          <input
                            type="text"
                            placeholder="e.g. Ksh"
                            value={newBizCurrency}
                            onChange={(e) => setNewBizCurrency(e.target.value)}
                            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 font-bold"
                          />
                        </div>
                      </div>

                      {/* Timezone */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Time Zone</label>
                        <SearchableDropdown
                          items={[
                            { id: "Africa/Nairobi", label: "East Africa Time (EAT - Nairobi)" },
                            { id: "UTC", label: "Coordinated Universal Time (UTC)" },
                            { id: "GMT", label: "Greenwich Mean Time (GMT)" },
                            { id: "Africa/Lagos", label: "West Africa Time (WAT - Lagos)" },
                            { id: "Africa/Johannesburg", label: "South Africa Time (SAST - Joburg)" }
                          ]}
                          selectedValue={newBizTimezone}
                          onChange={(val) => setNewBizTimezone(val)}
                          placeholder="Select timezone..."
                        />
                      </div>

                      {/* Row: Contact Phone & Email */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Contact Phone</label>
                          <input
                            type="text"
                            placeholder="e.g. +254712345678"
                            value={newBizPhone}
                            onChange={(e) => setNewBizPhone(e.target.value)}
                            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 font-bold font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Contact Email</label>
                          <input
                            type="email"
                            placeholder="e.g. info@biz.com"
                            value={newBizEmail}
                            onChange={(e) => setNewBizEmail(e.target.value)}
                            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 font-semibold"
                          />
                        </div>
                      </div>

                      {/* Default Payment Methods */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Default Payment Methods</label>
                        <div className="grid grid-cols-2 gap-2">
                          {['Cash', 'M-Pesa', 'Card', 'Bank'].map(method => {
                            const isChecked = newBizPaymentMethods.includes(method);
                            return (
                              <button
                                key={method}
                                type="button"
                                onClick={() => {
                                  if (isChecked) {
                                    setNewBizPaymentMethods(newBizPaymentMethods.filter(m => m !== method));
                                  } else {
                                    setNewBizPaymentMethods([...newBizPaymentMethods, method]);
                                  }
                                }}
                                className={`py-1.5 px-3 rounded-lg border text-[10px] font-bold uppercase transition flex items-center justify-between cursor-pointer ${
                                  isChecked 
                                    ? 'bg-amber-500/10 border-amber-500 text-amber-500' 
                                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-850 text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                <span>{method}</span>
                                <span>{isChecked ? '✓' : ''}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Logo Image Upload */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Branch Logo Picture</label>
                        <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl p-2.5">
                          {newBizLogo ? (
                            <img
                              src={newBizLogo}
                              alt="Logo preview"
                              className="w-10 h-10 rounded-lg object-cover border border-amber-500/20"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-10 h-10 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                              <Camera size={14} className="text-slate-400" />
                            </div>
                          )}
                          <UnifiedUploader
                            onUploadSuccess={(url) => setNewBizLogo(url)}
                            allowedTypes={["image"]}
                            cropAspect={1}
                            buttonText="Upload Logo"
                            bucketName="business-logos"
                            className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[9px] rounded-lg transition uppercase tracking-wider select-none text-center w-full cursor-pointer"
                          />
                        </div>
                      </div>

                      {/* Cover Image Upload */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Branch Cover Image</label>
                        <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl p-2.5">
                          {newBizCover ? (
                            <img
                              src={newBizCover}
                              alt="Cover preview"
                              className="w-16 h-10 rounded-lg object-cover border border-amber-500/20"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-16 h-10 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                              <Camera size={14} className="text-slate-400" />
                            </div>
                          )}
                          <UnifiedUploader
                            onUploadSuccess={(url) => setNewBizCover(url)}
                            allowedTypes={["image"]}
                            cropAspect={1.6}
                            buttonText="Upload Cover"
                            bucketName="business-logos"
                            className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[9px] rounded-lg transition uppercase tracking-wider select-none text-center w-full cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800 mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreatingBusiness(false);
                          setNewBizName("");
                          setNewBizDesc("");
                          setNewBizAddr("");
                          setNewBizLogo("");
                          setNewBizCover("");
                          setNewBizPhone("");
                          setNewBizEmail("");
                          setNewBizCurrency("Ksh");
                          setNewBizTimezone("Africa/Nairobi");
                          setNewBizType("Retail");
                          setNewBizPaymentMethods(["Cash", "M-Pesa"]);
                        }}
                        className="flex-1 py-2 border border-slate-200 dark:border-slate-800 rounded-xl font-bold uppercase text-[9.5px] text-slate-400 dark:text-slate-500 cursor-pointer"
                      >
                        Back
                      </button>
                      <button
                        type="submit"
                        className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl uppercase text-[9.5px] cursor-pointer"
                      >
                        Establish Branch
                      </button>
                    </div>
                  </form>
                ) : (
                  /* Edit Business form */
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!editBizName.trim()) {
                        showToast("Validation Error", "Branch/Business Name is required.", undefined, "error");
                        return;
                      }
                      if (editingBizId) {
                        updateBusiness(editingBizId, editBizName, editBizDesc, editBizAddr, editBizLogo);
                        setEditingBizId(null);
                        setEditBizLogo("");
                        showToast("Branch Updated", `Branch details saved successfully.`);
                      }
                    }}
                    className="flex flex-col gap-3.5 text-xs font-semibold animate-fade-in"
                  >
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Branch / Business Name *</label>
                      <input
                        type="text"
                        value={editBizName}
                        onChange={(e) => setEditBizName(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 font-bold"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Description</label>
                      <input
                        type="text"
                        value={editBizDesc}
                        onChange={(e) => setEditBizDesc(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Location Address</label>
                      <input
                        type="text"
                        value={editBizAddr}
                        onChange={(e) => setEditBizAddr(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    {/* Logo Image Upload / Edit */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Update Logo Picture</label>
                      <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl p-2.5">
                        {editBizLogo ? (
                          <img
                            src={editBizLogo}
                            alt="Logo preview"
                            className="w-10 h-10 rounded-lg object-cover border border-amber-500/20"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                            <Camera size={14} className="text-slate-400" />
                          </div>
                        )}
                        <UnifiedUploader
                          onUploadSuccess={(url) => setEditBizLogo(url)}
                          allowedTypes={["image"]}
                          cropAspect={1}
                          buttonText="Change Logo"
                          bucketName="business-logos"
                          className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[9px] rounded-lg transition uppercase tracking-wider select-none text-center w-full cursor-pointer"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800 mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBizId(null);
                          setEditBizLogo("");
                        }}
                        className="flex-1 py-2 border border-slate-200 dark:border-slate-800 rounded-xl font-bold uppercase text-[9.5px] text-slate-400 dark:text-slate-500"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl uppercase text-[9.5px]"
                      >
                        Save Details
                      </button>
                    </div>
                  </form>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Interactive Onboarding Tour Guide */}
        <InteractiveGuide
          isOpen={isTourOpen}
          steps={tourSteps}
          onClose={handleCloseTour}
          onStepChange={(tab) => setActiveTab(tab as any)}
        />
      </div>
    </PreviewFrame>
  );
}
