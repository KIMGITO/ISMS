import { toUserMessage } from "../utils/userError";
import PlanUsageCard from '../components/plan/PlanUsageCard';
import SupportAccessCard from '../components/support/SupportAccessCard';
import ModulesSupportCard from '../components/support/ModulesSupportCard';
import { usePlan } from '../stores/planStore';
import { markBranchChosen } from '../utils/branchChoice';
import React, { useState, useEffect } from "react";
import { useOverlay } from '../hooks/useOverlay';
import { SwipeRow } from '../components/shared/SwipeRow';
import { useAppStore } from "../stores/appStore";
import { 
  Building, Save, Globe, Phone, Mail, Image as ImageIcon,  MapPin, CheckCircle, Info, Plus, X, Briefcase, Receipt, CreditCard, Calendar, RefreshCw,
  Edit, Wallet, TrendingUp, Smartphone, Banknote, Landmark, User as UserIcon, Store, Search,
  ArrowRight, CircleDollarSign, ShieldCheck, AlertTriangle, CheckCircle2, Trash2, ChevronLeft, ChevronRight, Ban,
  ChevronDown,
} from "lucide-react";
import MpesaPaymentsPanel from "../components/MpesaPaymentsPanel";
import PaymentsList from "../components/payments/PaymentsList";
import TillInbox from "../components/payments/TillInbox";
import CardPaymentsPanel from "../components/payments/CardPaymentsPanel";
import AirtelPaymentsPanel from "../components/payments/AirtelPaymentsPanel";
import ExpensesPanel from "../components/payments/ExpensesPanel";
import AreaAdvisor from "../components/assistant/AreaAdvisor";
import { usePaymentMethods } from "../hooks/usePaymentMethods";
import CardChargeSheet, { type CardChargeResult, describeCard } from "../components/payments/CardChargeSheet";
import { MONEY_METHODS, methodLabel, normalizeReference, referenceHint } from "../utils/paymentMethods";
import UnifiedUploader from "../components/shared/UnifiedUploader";
import { validatePhone, normalizePhone, SUPPORTED_COUNTRIES } from "../utils/phoneUtils";
import { hasRolePermission } from "../utils/permissions";
import SearchableDropdown from "../components/SearchableDropdown";
import { Tabs } from "../components/TabOptions";
import { titleCase } from "../utils/stringUtils";
import { canOpenScreen } from "../utils/screens";
import { useUiStore } from "../stores/uiStore";
import { CopyRef } from "../components/shared/CopyRef";
import type { MoneyMethod } from "../types";
import { Switch } from '../components/shared/Switch';
import { appDialog } from '../components/AppDialog';
import { useKraStatus } from '../services/kra/kraService';
import { NumberInput } from '../components/shared/Input';
import { formatCurrency } from '../utils/helpers';

// Shown only until the business's own list has loaded.

const COLOR_PRESETS = [
  { name: "Denso Amber", primary: "#f59e0b", secondary: "#1e293b", label: "Amber & Slate" },
  { name: "Royal Cobalt", primary: "#2563eb", secondary: "#0f172a", label: "Blue & Navy" },
  { name: "Forest Mint", primary: "#10b981", secondary: "#064e3b", label: "Emerald & Pine" },
  { name: "Crimson Velvet", primary: "#dc2626", secondary: "#450a0a", label: "Ruby & Maroon" },
  { name: "Sunset Orange", primary: "#f97316", secondary: "#1e1b4b", label: "Orange & Indigo" },
  { name: "Monochrome Sleek", primary: "#94a3b8", secondary: "#0f172a", label: "Silver & Charcoal" }
];

type MoneyTab = "payments" | "expenses" | "mpesa" | "airtel" | "cards";

const METHOD_ICONS: Record<MoneyMethod, React.ReactNode> = {
  Cash: <Banknote size={14} className="text-amber-500" />,
  "M-Pesa": <Smartphone size={14} className="text-emerald-500" />,
  "Airtel Money": <Smartphone size={14} className="text-red-500" />,
  Card: <CreditCard size={14} className="text-blue-500" />,
  Bank: <Landmark size={14} className="text-violet-500" />,
};

/** The picked day at the current time when it is today, otherwise midday, so it sorts and shows on the right day. */
function paymentDateIso(day: string): string {
  const today = new Date();
  const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (day === local(today)) return today.toISOString();
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0).toISOString();
}

/**
 * section "business": branches and business details (business.update).
 * section "money": payments, expenses and M-Pesa, each shown to the roles that hold its permissions.
 */
export default function BusinessManagementView({ section = "business" }: { section?: "business" | "money" }) {
  const { 
    businesses, 
    activeBusinessId, 
    updateBusiness, 
    showToast,
    setActiveBusinessId,
    addBusiness,
    currentEmployee
  } = useAppStore();

  const activeBiz = businesses.find(b => b.id === activeBusinessId);
  // VAT can only be charged once KRA eTIMS is connected (the receipts must be signed)
  const { status: kraStatus } = useKraStatus(activeBusinessId);
  const kraConnected = kraStatus?.connected === true;

  // Creation States
  const [isCreating, setIsCreating] = useState(false);
  useOverlay(isCreating, () => setIsCreating(false), 'screen');
  const [newBizName, setNewBizName] = useState("");
  const [newBizDesc, setNewBizDesc] = useState("");
  const [newBizAddr, setNewBizAddr] = useState("");
  const [newBizLogo, setNewBizLogo] = useState("");
  const [newBizType, setNewBizType] = useState("");
  const [newBizCountry, setNewBizCountry] = useState("Kenya");
  const [newBizCurrency, setNewBizCurrency] = useState("Ksh");
  const [creatingLoading, setCreatingLoading] = useState(false);

  // States
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [businessType, setBusinessType] = useState("Retail");
  const [country, setCountry] = useState("Kenya");
  const [currency, setCurrency] = useState("Ksh");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [isTaxEnabled, setIsTaxEnabled] = useState(false);
  const [taxPercentage, setTaxPercentage] = useState(16.0);
  
  // Custom theme colors
  const [primaryColor, setPrimaryColor] = useState("#f59e0b");
  const [secondaryColor, setSecondaryColor] = useState("#1e293b");

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Tab State
  const role = currentEmployee?.role || "Guest";
  const moneyTabs = ([
    { id: "payments", label: "Payments", shortcut: "money-payments", icon: <CreditCard size={14} />, allowed: hasRolePermission(role, "payments.view") || hasRolePermission(role, "payments.cash") || hasRolePermission(role, "payments.mpesa") || hasRolePermission(role, "payments.verify") },
    { id: "mpesa", label: "M-Pesa", icon: <Smartphone size={14} />, allowed: hasRolePermission(role, "payments.mpesa") || hasRolePermission(role, "payments.verify") || hasRolePermission(role, "settings.integrations") },
    { id: "airtel", label: "Airtel Money", shortcut: "money-airtel", icon: <Smartphone size={14} />, allowed: hasRolePermission(role, "payments.airtel") || hasRolePermission(role, "settings.integrations") },
    { id: "cards", label: "Cards", icon: <CreditCard size={14} />, allowed: hasRolePermission(role, "payments.card") || hasRolePermission(role, "payments.view") || hasRolePermission(role, "settings.integrations") },
    { id: "expenses", label: "Expenses", shortcut: "money-expenses", icon: <Receipt size={14} />, allowed: hasRolePermission(role, "expenses.view") || hasRolePermission(role, "expenses.create") },
  ] as { id: MoneyTab; label: string; shortcut?: string; icon: React.ReactNode; allowed: boolean }[]).filter((t) => t.allowed);
  const [activeSubTab, setActiveSubTab] = useState<"details" | MoneyTab>(
    section === "money" ? moneyTabs[0]?.id ?? "payments" : "details",
  );
  const isMoney = section === "money";

  // A new branch only when the plan has room (the database refuses it anyway; this says why first).
  const plan = usePlan();
  const startCreatingBranch = () => {
    if (plan && !plan.legacy && plan.branches_used >= plan.max_branches) {
      showToast(
        "Plan limit",
        `Your plan (${plan.plan_name}) allows ${plan.max_branches} branch${plan.max_branches === 1 ? "" : "es"}. Upgrade to add more.`,
        undefined,
        "error",
      );
      return;
    }
    setIsCreating(true);
  };




  // Payments States - Modern Redesigned
  const [payRef, setPayRef] = useState("");
  const [payAmount, setExpPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<MoneyMethod>("M-Pesa");
  // Only the methods this business has switched on can be chosen for a new payment.
  const payMethods = usePaymentMethods();
  useEffect(() => {
    if (!payMethods.includes(payMethod)) setPayMethod(payMethods.includes("M-Pesa") ? "M-Pesa" : payMethods[0]);
  }, [payMethods, payMethod]);
  const [chargingCard, setChargingCard] = useState(false);
  const [paySenderName, setPaySenderName] = useState("");
  const [paySenderPhone, setPaySenderPhone] = useState("");
  const [payStatus, setPayStatus] = useState<"Success" | "Pending" | "Failed">("Success");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [localPayments, setLocalPayments] = useState<any[]>([]);
  const [localMoneyAssets, setLocalMoneyAssets] = useState<any[]>([]);
  const [localCustomers, setLocalCustomers] = useState<any[]>([]);
  const [payCustomerId, setPayCustomerId] = useState("");
  const [payDescription, setPayDescription] = useState("");
  const [payType, setPayType] = useState<"customer" | "walk-in">("walk-in");
  const [payMethodDisplay, setPayMethodDisplay] = useState<"modern" | "classic">("modern");
  // The record form folds away on phones so the list is in view; open on wide screens.
  const [payFormOpen, setPayFormOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 1024);

  // Opened from search on one payment: the Payments tab with every payment showing, so search
  // can highlight its row.
  const searchTarget = useUiStore((st) => st.searchTarget);
  useEffect(() => {
    if (searchTarget?.kind !== "payment" || !isMoney) return;
    useUiStore.getState().setSearchTarget(null);
    if (moneyTabs.some((t) => t.id === "payments")) setActiveSubTab("payments");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget]);


  // Subscribe to real-time repositories
  useEffect(() => {
    if (!activeBusinessId) return;
    let unsubPay: (() => void) | undefined;
    let unsubAssets: (() => void) | undefined;
    let unsubCust: (() => void) | undefined;

    import("../services/repositories").then((mod) => {
      unsubPay = mod.PaymentRepository.subscribe((pays) => {
        setLocalPayments(pays);
      });
      unsubAssets = mod.MoneyAssetRepository.subscribe((assets) => {
        setLocalMoneyAssets(assets);
      });
      unsubCust = mod.CustomerRepository.subscribe((custs) => {
        setLocalCustomers(custs);
      });
    }).catch(err => console.error("Failed to load repositories in BusinessManagementView", err));

    return () => {
      if (unsubPay) unsubPay();
      if (unsubAssets) unsubAssets();
      if (unsubCust) unsubCust();
    };
  }, [activeBusinessId]);

  const resetPaymentForm = () => {
    setPayRef("");
    setExpPayAmount("");
    setPaySenderName("");
    setPaySenderPhone("");
    setPayCustomerId("");
    setPayDescription("");
    setPayType("walk-in");
  };

  /** Checks the form. Returns an error message, or null when it can be recorded. */
  const paymentFormError = (needsReference: boolean): string | null => {
    const amountNum = Number(payAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) return "Enter the amount received.";
    if (Math.round(amountNum * 100) !== Math.round(amountNum * 100 * 1000) / 1000) return "Use at most 2 decimal places.";
    if (payType === "customer" && !payCustomerId) return "Choose the customer from the list, or switch to Walk-in.";
    if (!paySenderName.trim()) return "Enter who paid.";
    if (needsReference && !payRef.trim()) return `Enter the ${referenceHint(payMethod)?.label.toLowerCase() || "reference"}.`;
    if (payRef.trim()) {
      const ref = normalizeReference(payMethod, payRef).toLowerCase();
      const dup = localPayments.find((p) => p.status !== "Voided" && String(p.referenceCode || "").toLowerCase() === ref);
      if (dup) {
        return `${payRef.trim()} was already recorded on ${new Date(dup.date).toLocaleDateString()} for ${formatCurrency(Number(dup.amount))}${dup.senderName ? ` from ${dup.senderName}` : ""}. Void that one first if it was wrong.`;
      }
    }
    return null;
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBusinessId) return;
    const problem = paymentFormError(payMethod !== "Cash");
    if (problem) {
      showToast("Check the payment", problem, undefined, "error");
      return;
    }
    const amountNum = Math.round(Number(payAmount) * 100) / 100;
    setPaymentSubmitting(true);
    try {
      const { PaymentRepository } = await import("../services/repositories");
      const selectedCustomer = payType === "customer" ? localCustomers.find(c => c.id === payCustomerId) : undefined;
      // The list as it was before this submit (this handler's closure doesn't see later updates).
      const knownIds = new Set(localPayments.map((p) => p.id));

      const saved = await PaymentRepository.add({
        referenceCode: normalizeReference(payMethod, payRef),
        amount: amountNum,
        method: payMethod,
        senderName: paySenderName.trim(),
        senderPhone: paySenderPhone.trim() ? normalizePhone(paySenderPhone) : undefined,
        status: payStatus,
        date: paymentDateIso(payDate),
        businessId: activeBusinessId,
        customerId: selectedCustomer?.id,
        paymentType: selectedCustomer ? "customer" : "walk-in",
        description: payDescription.trim() || undefined,
        recordedBy: currentEmployee?.name || "System",
      });

      // Same reference already recorded (e.g. on another device just now): the server returns that one.
      if (knownIds.has(saved.id) || Math.abs(Number(saved.amount) - amountNum) > 0.001) {
        showToast("Already recorded", `This reference was already recorded for ${formatCurrency(Number(saved.amount))}. Nothing was added.`, undefined, "error");
        return;
      }

      // Only a successful payment moves money balances or a customer's account.
      const debt = Number(selectedCustomer?.debtBalance || 0);
      const appliedMsg = payStatus !== "Success"
        ? ` Saved as ${payStatus.toLowerCase()}, so no balances changed.`
        : selectedCustomer && debt > 0
          ? amountNum > debt
            ? ` ${formatCurrency(debt)} cleared their debt and ${formatCurrency(amountNum - debt)} went to their wallet.`
            : " It paid down their debt."
          : selectedCustomer
            ? " It went to their wallet."
            : "";

      showToast(
        "Payment recorded",
        `${formatCurrency(amountNum)} by ${methodLabel(payMethod)}${selectedCustomer ? ` for ${selectedCustomer.name}` : ""}.${appliedMsg}`,
        undefined,
        "success"
      );
      resetPaymentForm();
    } catch (err: any) {
      console.error(err);
      showToast("Payment not recorded", toUserMessage(err, "Could not save the payment."), undefined, "error");
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const startCardCharge = () => {
    const problem = paymentFormError(false);
    if (problem) {
      showToast("Check the payment", problem, undefined, "error");
      return;
    }
    setChargingCard(true);
  };

  // Paid online or on the reader: the server already recorded the payment.
  const onCardCharged = (result: CardChargeResult) => {
    setChargingCard(false);
    if (result.via === "machine") {
      // Card machine: the approval code becomes the reference, then it's recorded like any payment.
      setPayRef(result.reference);
      if (result.last4) setPayDescription((d) => d || `Card •••• ${result.last4}`);
      showToast("Approval code added", "Press Record Payment to save it.", undefined, "info");
      return;
    }
    showToast(
      "Card payment received",
      `${formatCurrency(result.amountPaid)} ${describeCard(result.brand, result.last4)} was recorded.`.replace(/\s+\./, "."),
      undefined,
      "success",
    );
    resetPaymentForm();
  };

  // Sync state with active business on load or change
  useEffect(() => {
    if (activeBiz) {
      setName(activeBiz.name || "");
      setDescription(activeBiz.description || "");
      setAddress(activeBiz.address || "");
      setLogoUrl(activeBiz.logoUrl || "");
      setCoverImageUrl(activeBiz.coverImageUrl || "");
      setBusinessType(activeBiz.businessType || "");
      setCountry(activeBiz.country || "Kenya");
      setCurrency(activeBiz.currency || "Ksh");
      setContactEmail(activeBiz.contactEmail || "");
      setContactPhone(activeBiz.contactPhone || "");
      setPrimaryColor(activeBiz.primaryColor || "#f59e0b");
      setSecondaryColor(activeBiz.secondaryColor || "#1e293b");
      setIsTaxEnabled(activeBiz.isTaxEnabled === true);
      setTaxPercentage(typeof activeBiz.taxPercentage === 'number' ? activeBiz.taxPercentage : 16.0);
      
    }
  }, [activeBiz]);

  // Frontend Validation
  const validateForm = (): boolean => {
    const errs: { [key: string]: string } = {};

    if (!name.trim()) {
      errs.name = "Business name is required.";
    }

    if (!currency.trim()) {
      errs.currency = "Operational currency is required.";
    }

    if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      errs.contactEmail = "Please enter a valid email address.";
    }

    if (contactPhone.trim()) {
      const normalized = normalizePhone(contactPhone);
      if (!validatePhone(normalized)) {
        errs.contactPhone = "Please enter a valid phone number.";
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!activeBusinessId) {
      showToast("No branch chosen", "Pick a branch first.", undefined, "error");
      return;
    }

    if (!validateForm()) {
      showToast("Check the form", "Fix the boxes marked in red.", undefined, "error");
      return;
    }

    setLoading(true);
    try {
      const normalizedPhone = contactPhone.trim() ? normalizePhone(contactPhone) : "";
      const finalBusinessType = businessType.trim() || "Retail";
      
      await updateBusiness(
        activeBusinessId,
        name.trim(),
        description.trim(),
        address.trim(),
        logoUrl.trim(),
        finalBusinessType,
        country,
        currency.trim(),
        coverImageUrl.trim(),
        contactEmail.trim(),
        normalizedPhone,
        primaryColor,
        secondaryColor,
        isTaxEnabled,
        taxPercentage
      );

      showToast("Saved", "Your business details are updated.", undefined, "success");
    } catch (err: any) {
      console.error("Failed to update business configuration:", err);
      showToast("Update failed", toUserMessage(err, "Could not save business details."), undefined, "error");
    } finally {
      setLoading(false);
    }
  };

  const handlePresetSelect = (primary: string, secondary: string) => {
    setPrimaryColor(primary);
    setSecondaryColor(secondary);
    showToast("Colours applied", `Tap Save to keep them.`, undefined, "info");
  };

  const isOwner = currentEmployee?.role === 'Owner';

  const canVoidPayments = hasRolePermission(currentEmployee?.role || 'Guest', 'payments.manage');

  // Both throw on failure so the payment sheet stays open.
  const voidPayment = async (id: string, reason: string) => {
    try {
      const { PaymentRepository } = await import("../services/repositories");
      await PaymentRepository.void(id, reason, currentEmployee?.name || "Staff");
      showToast("Payment voided", "The money balance and the customer's account have been put back.", undefined, "success");
    } catch (err: any) {
      showToast("Could not void", toUserMessage(err, "Could not cancel the payment."), undefined, "error");
      throw err;
    }
  };

  const assignPayment = async (id: string, customerId: string) => {
    try {
      const { PaymentRepository } = await import("../services/repositories");
      await PaymentRepository.assignToCustomer(id, customerId, currentEmployee?.name || "Staff");
      const c = localCustomers.find((x) => x.id === customerId);
      showToast("Payment moved", `It is now ${c?.name || "the customer"}'s payment: debt first, then wallet.`, undefined, "success");
    } catch (err: any) {
      showToast("Not moved", toUserMessage(err, "Could not give the payment to the customer."), undefined, "error");
      throw err;
    }
  };


  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newBizName.trim()) {
      showToast("Name needed", "Type the branch or business name.", undefined, "error");
      return;
    }

    setCreatingLoading(true);
    try {
      const finalBizType = newBizType.trim() || "Retail";
      const created = await addBusiness(
        newBizName.trim(),
        newBizDesc.trim(),
        newBizAddr.trim(),
        newBizLogo.trim(),
        finalBizType,
        newBizCountry,
        newBizCurrency.trim()
      );

      if (created) {
        setIsCreating(false);
        setNewBizName("");
        setNewBizDesc("");
        setNewBizAddr("");
        setNewBizLogo("");
        setNewBizType("");
        setNewBizCountry("Kenya");
        setNewBizCurrency("Ksh");
      }
    } catch (err: any) {
      console.error("Failed to create new branch:", err);
    } finally {
      setCreatingLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 pb-nav  space-y-5 bg-app-bg text-app-text font-sans">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b border-app-border/40 pb-3">
        <div>
          <h2 className="text-sm font-semibold font-display text-app-text flex items-center gap-1.5">
            {isMoney ? (
              <><Wallet size={16} className="text-amber-500" /> Payments &amp; Expenses</>
            ) : (
              <><Building size={16} className="text-amber-500" /> Business & branches</>
            )}
          </h2>
          <p className="text-[11px] text-app-text-muted mt-0.5 font-medium leading-normal">
            {isMoney
              ? "Record money coming in and going out, and handle M-Pesa payments."
              : "Branches, contact details, logo and colours."}
          </p>
        </div>
      </div>

     

      {/* The company's plan: limits, use and what is locked */}
      {!isMoney && <PlanUsageCard />}

      {/* The Owner lets platform support into this branch for a while */}
      {!isMoney && isOwner && activeBusinessId && <SupportAccessCard businessId={activeBusinessId} />}
      {!isMoney && isOwner && activeBusinessId && <ModulesSupportCard businessId={activeBusinessId} />}

      {/* Branch Badge Tabs - Visible only on large screens (xl and above) */}
      {!isMoney && (
      <div className="hidden md:flex items-stretch gap-3 overflow-x-auto pb-2 pt-1 -mx-1 px-1 min-h-[130px]">
        {businesses.map((biz) => {
          const isActive = biz.id === activeBusinessId && !isCreating;
          return (
            <button
              key={biz.id}
              data-search-id={`biz-${biz.id}`}
              type="button"
              onClick={() => {
                setIsCreating(false);
                setActiveBusinessId(biz.id);
                markBranchChosen(biz.id);
              }}
              className={`relative shrink-0 w-[230px] rounded-2xl border text-left overflow-hidden transition-all cursor-pointer group ${
                isActive
                  ? 'border-amber-500 ring-1 ring-amber-500/30 shadow-md'
                  : 'border-app-border hover:border-amber-500/40 hover:shadow-sm'
              }`}
              style={{ minHeight: '110px' }}
            >
              {/* Cover Image / Badge Header */}
              <div className="h-[52px] w-full bg-amber-500/70 relative overflow-hidden">
                {biz.coverImageUrl && (
                  <img
                    src={biz.coverImageUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover opacity-80"
                    referrerPolicy="no-referrer"
                  />
                )}
                <div className="absolute inset-0 bg-slate-950/25" />
                {/* Logo overlapping cover */}
                <img
                  src={
                    biz.logoUrl ||
                    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Crect width='100' height='100' rx='20'/%3E%3Cpath d='M30,70 L50,30 L70,70 Z' fill='%230f172a'/%3E%3C/svg%3E"
                  }
                  alt={biz.name}
                  className="absolute -bottom-3 left-3 w-10 h-10 rounded-xl border-2 border-app-card object-cover shadow-md"
                  referrerPolicy="no-referrer"
                />
                {isActive && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-emerald-400/30" />
                )}
              </div>

              {/* Badge Info */}
              <div className="pt-5 pb-2 px-3 bg-app-card">
                <h4 className="text-[10px] font-semibold text-app-text truncate">
                  {titleCase(biz.name)}
                </h4>
                <p className="text-[11px] text-app-text-muted font-bold truncate mt-0.5">
                  {biz.businessType || 'Retail'}
                </p>
                {biz.address && (
                  <span className="text-[11px] text-app-text-muted truncate flex items-center gap-0.5 mt-1">
                    <MapPin size={7} /> {biz.address}
                  </span>
                )}
              </div>
            </button>
          );
        })}
        {/* Add New Branch Quick Button */}
        {businesses.length < 5 && hasRolePermission(currentEmployee?.role || 'Guest', 'settings.view') && (
          <button
            type="button"
            onClick={startCreatingBranch}
            data-shortcut="new"
            className={`shrink-0 w-[180px] rounded-2xl border-2 border-dashed text-left transition-all cursor-pointer flex flex-col items-center justify-center gap-1 min-h-[110px] ${
              isCreating
                ? 'border-amber-500 text-amber-500 bg-amber-500/5'
                : 'border-app-border text-app-text-muted hover:border-amber-500/50 hover:text-amber-500'
            }`}
          >
            <Plus size={18} />
            <span className="text-[11px] font-semibold">Add Branch</span>
          </button>
        )}
      </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Column: Businesses & Branches */}
        <div className={`xl:hidden flex flex-col gap-4 ${isMoney ? "hidden" : ""}`}>
          <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-app-border/40 pb-2">
              <span className="text-[10px] text-app-text-muted font-bold">
                Branches
              </span>
              <span className="text-[11px] font-mono text-amber-500 font-bold bg-amber-500/10 px-2 py-0.5 rounded-full">
                {businesses.length}/5
              </span>
            </div>

            <div className="flex flex-col gap-2 max-h-[350px] overflow-y-auto pr-1">
              {businesses.map((biz) => {
                const isActive = biz.id === activeBusinessId && !isCreating;
                return (
                  <div
                    key={biz.id}
                    data-search-id={`biz-${biz.id}`}
                    onClick={() => {
                      setIsCreating(false);
                      setActiveBusinessId(biz.id);
                markBranchChosen(biz.id);
                    }}
                    className={`p-3 rounded-xl border transition-all flex flex-col gap-1.5 cursor-pointer ${
                      isActive
                        ? 'bg-amber-500/10 border-amber-500'
                        : 'bg-app-bg border-app-border/60 hover:border-amber-500/25'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={
                          biz.logoUrl ||
                          "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Crect width='100' height='100' rx='20'/%3E%3Cpath d='M30,70 L50,30 L70,70 Z' fill='%230f172a'/%3E%3C/svg%3E"
                        }
                        alt={biz.name}
                        className="w-8 h-8 rounded-lg object-cover border border-app-border shrink-0"
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-[11px] font-bold text-app-text truncate">
                          {titleCase(biz.name)}
                        </h4>
                        <p className="text-[11px] text-app-text-muted truncate">
                          {biz.businessType || 'Retail'}
                        </p>
                      </div>
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                      )}
                    </div>
                    {biz.address && (
                      <span className="text-[11px] text-app-text-muted truncate flex items-center gap-0.5">
                        <MapPin size={8} /> {biz.address}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {businesses.length < 5 &&
              hasRolePermission(
                currentEmployee?.role || 'Guest',
                'settings.view',
              ) && (
                <button
                  type="button"
                  onClick={startCreatingBranch}
                  className={`w-full py-2 border-2 border-dashed rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    isCreating
                      ? 'border-amber-500 text-amber-500 bg-amber-500/5'
                      : 'border-app-border text-app-text-muted hover:border-amber-500/50 hover:text-amber-500'
                  }`}
                >
                  <Plus size={10} /> Add Business Branch
                </button>
              )}
          </div>
        </div>

        {/* Right Columns: Forms (active biz profile or creation form) */}
        <div className="xl:col-span-3">
          {isCreating && !isMoney ? (
            /* Creation Form */
            <form
              onSubmit={handleCreateBusiness}
              className="bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-5"
            >
              <div className="flex items-center justify-between border-b border-app-border/40 pb-2">
                <div className="flex items-center gap-2">
                  <Building size={14} className="text-amber-500" />
                  <h3 className="text-xs font-bold text-app-text">
                    New branch
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="p-1 hover:bg-app-bg border border-app-border rounded-lg text-app-text-muted hover:text-app-text transition"
                >
                  <X size={12} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Name */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-app-text-muted font-bold">
                    Branch / Business Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Town Centre branch"
                    value={newBizName}
                    onChange={(e) => setNewBizName(e.target.value)}
                    className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold"
                  />
                </div>

                 {/* Type of business */}
                 <div className="flex flex-col gap-1">
                   <label className="text-[10px] text-app-text-muted font-bold">
                     Type of business
                   </label>
                   <input
                     type="text"
                     placeholder="e.g. Shop, Butchery"
                     value={newBizType}
                     onChange={(e) => setNewBizType(e.target.value)}
                     maxLength={60}
                     className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500"
                   />
                 </div>

                {/* Country */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-app-text-muted font-bold">
                    Country
                  </label>
                  <SearchableDropdown
                    items={[
                      { id: 'Kenya', label: 'Kenya 🇰🇪' },
                      { id: 'Uganda', label: 'Uganda 🇺🇬' },
                      { id: 'Tanzania', label: 'Tanzania 🇹🇿' },
                      { id: 'Rwanda', label: 'Rwanda 🇷🇼' },
                      { id: 'United States', label: 'United States 🇺🇸' },
                      { id: 'United Kingdom', label: 'United Kingdom 🇬🇧' },
                    ]}
                    selectedValue={newBizCountry}
                    onChange={(val) => setNewBizCountry(val)}
                    placeholder="Select country..."
                  />
                </div>

                {/* Currency */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-app-text-muted font-bold">
                    Currency
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ksh"
                    value={newBizCurrency}
                    onChange={(e) => setNewBizCurrency(e.target.value)}
                    className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold"
                  />
                </div>
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-app-text-muted font-bold">
                  Description (optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="What this branch does (optional)"
                  value={newBizDesc}
                  onChange={(e) => setNewBizDesc(e.target.value)}
                  className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-medium leading-relaxed"
                />
              </div>

              {/* Address */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-app-text-muted font-bold">
                  Address
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. Airport Road, Nairobi"
                    value={newBizAddr}
                    onChange={(e) => setNewBizAddr(e.target.value)}
                    className="w-full bg-app-bg text-app-text border border-app-border pl-8 pr-3 py-2 rounded-xl text-xs focus:outline-none focus:border-amber-500 font-medium"
                  />
                  <MapPin
                    size={13}
                    className="absolute left-3 top-3 text-app-text-muted"
                  />
                </div>
              </div>

              {/* Logo URL */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-app-text-muted font-bold">
                  Custom Logo URL (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Paste custom Logo image URL..."
                  value={newBizLogo}
                  onChange={(e) => setNewBizLogo(e.target.value)}
                  className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="flex gap-3 justify-end border-t border-app-border/40 pt-4">
                <button
                  type="button"
                  disabled={creatingLoading}
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-app-text font-bold rounded-xl transition text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingLoading}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-md text-xs"
                >
                  {creatingLoading ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    'Add branch'
                  )}
                </button>
              </div>
            </form>
          ) : activeBiz ? (
            <div className="space-y-5 min-w-0">
              {isMoney && (hasRolePermission(role, "payments.view") || hasRolePermission(role, "expenses.view")) && <AreaAdvisor area="money" />}
              {isMoney && moneyTabs.length > 1 && (
                <Tabs<typeof activeSubTab>
                  tabs={moneyTabs.map(({ id, label, icon, shortcut }) => ({ id, label, icon, shortcut }))}
                  activeTab={activeSubTab}
                  onChange={setActiveSubTab}
                />
              )}
              {isMoney && moneyTabs.length === 0 && (
                <p className="text-sm text-app-text-muted">Your role doesn't include payments or expenses.</p>
              )}

              {!isMoney && activeSubTab === 'details' && (
                <form
                  onSubmit={handleSave}
                  className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-in fade-in duration-200"
                >
                  {/* Left 2 Columns: Identity, Contact, Settings */}
                  <div className="lg:col-span-2 flex flex-col gap-5">
                    {/* Card 1: Core Identity */}
                    <div className="bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center gap-2 border-b border-app-border/40 pb-2">
                        <Building size={14} className="text-amber-500" />
                        <h3 className="text-xs font-bold text-app-text">
                          Business details
                        </h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Business Name */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] text-app-text-muted font-bold">
                            Business / Branch Name *
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Westlands branch"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={`bg-app-bg text-app-text border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold ${
                              errors.name
                                ? 'border-red-500'
                                : 'border-app-border'
                            }`}
                          />
                          {errors.name && (
                            <span className="text-[11px] text-red-500 font-medium">
                              {errors.name}
                            </span>
                          )}
                        </div>

                         {/* Business Type */}
                         <div className="flex flex-col gap-1">
                           <label className="text-[10px] text-app-text-muted font-bold">
                             Type of business
                           </label>
                           <input
                             type="text"
                             placeholder="e.g. Shop, Butchery"
                             value={businessType}
                             onChange={(e) => setBusinessType(e.target.value)}
                             maxLength={60}
                             className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500"
                           />
                         </div>

                        {/* Description */}
                        <div className="flex flex-col gap-1 md:col-span-2">
                          <label className="text-[10px] text-app-text-muted font-bold">
                            Description
                          </label>
                          <textarea
                            rows={3}
                            placeholder="What the business does (optional)"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-semibold"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Card 2: Contact Points */}
                    <div className="bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center gap-2 border-b border-app-border/40 pb-2">
                        <Phone size={14} className="text-amber-500" />
                        <h3 className="text-xs font-bold text-app-text">
                          Contact details
                        </h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Address */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] text-app-text-muted font-bold">
                            Address
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Suite 4B, Woodvale Grove, Westlands"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold"
                          />
                        </div>

                        {/* Email */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] text-app-text-muted font-bold">
                            Contact Email
                          </label>
                          <input
                            type="email"
                            placeholder="e.g. branch@yourshop.co.ke"
                            value={contactEmail}
                            onChange={(e) => setContactEmail(e.target.value)}
                            className={`bg-app-bg text-app-text border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold ${
                              errors.contactEmail
                                ? 'border-red-500'
                                : 'border-app-border'
                            }`}
                          />
                          {errors.contactEmail && (
                            <span className="text-[11px] text-red-500 font-medium">
                              {errors.contactEmail}
                            </span>
                          )}
                        </div>

                        {/* Phone */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] text-app-text-muted font-bold">
                            Phone
                          </label>
                          <input
                            type="tel"
                            placeholder="e.g. +254 712 345 678"
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            className={`bg-app-bg text-app-text border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold ${
                              errors.contactPhone
                                ? 'border-red-500'
                                : 'border-app-border'
                            }`}
                          />
                          {errors.contactPhone && (
                            <span className="text-[11px] text-red-500 font-medium">
                              {errors.contactPhone}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Card 3: VAT. Only with KRA eTIMS connected; without it no sale carries VAT. */}
                    <div className="bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center gap-2 border-b border-app-border/40 pb-2">
                        <Briefcase size={14} className="text-amber-500" />
                        <h3 className="text-xs font-bold text-app-text">
                          VAT
                        </h3>
                      </div>

                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <span className="font-semibold text-app-text text-xs block">
                              Charge VAT
                            </span>
                            <span className="text-[11px] text-app-text-muted block mt-0.5 leading-tight">
                              {kraConnected
                                ? 'Added to every sale and quote.'
                                : kraStatus === undefined
                                  ? 'Checking KRA eTIMS…'
                                  : 'Needs KRA eTIMS.'}
                            </span>
                          </div>
                          <Switch
                            // Shows what sales really do: without eTIMS it is off, whatever was saved.
                            checked={isTaxEnabled && kraConnected}
                            disabled={!kraConnected}
                            onChange={() => setIsTaxEnabled(!isTaxEnabled)}
                            ariaLabel="Charge VAT"
                          />
                        </div>

                        {isTaxEnabled && kraConnected && (
                          <div className="flex flex-col gap-1 bg-app-bg/50 p-3.5 border border-app-border rounded-2xl">
                            <label className="text-[10px] text-app-text-muted font-bold">
                              Rate %
                            </label>
                            <NumberInput
                              disabled={!kraConnected}
                              value={taxPercentage}
                              onChange={(v) => {
                                const val = (v ?? NaN);
                                setTaxPercentage(isNaN(val) ? 0 : val);
                              }}
                              size="sm" className="w-[120px]" inputClassName="font-bold"
                              placeholder="16"
                              max={100}
                              min={0}
                              step={0.1}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Visual Assets & Save controls */}
                  <div className="lg:col-span-1 flex flex-col gap-5">
                    {/* Card 4: Branding Graphics */}
                    <div className="bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center gap-2 border-b border-app-border/40 pb-2">
                        <ImageIcon size={14} className="text-amber-500" />
                        <h3 className="text-xs font-bold text-app-text">
                          Logo and cover
                        </h3>
                      </div>

                      {/* Logo Section */}
                      <div className="flex flex-col gap-3">
                        <span className="text-[10px] text-app-text-muted font-bold text-center block">
                          Logo
                        </span>
                        <UnifiedUploader
                          onUploadSuccess={(url) => setLogoUrl(url)}
                          allowedTypes={['image']}
                          cropAspect={1 / 1}
                          bucketName="business-logos"
                          triggerElement={
                            <div className="relative group cursor-pointer border border-app-border hover:border-amber-500 rounded-full p-1 bg-app-bg transition shadow-sm w-20 h-20 mx-auto">
                              <img
                                src={
                                  logoUrl ||
                                  'https://images.unsplash.com/photo-1550989460-0adf9ea622e2?auto=format&fit=crop&q=80&w=150'
                                }
                                alt="Logo Preview"
                                className="w-full h-full rounded-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition">
                                <Edit size={12} className="text-amber-500 " />
                                <span className="text-[11px] font-semibold text-amber-500">
                                  Edit
                                </span>
                              </div>
                            </div>
                          }
                        />
                        <input
                          type="text"
                          placeholder="Or paste custom Logo URL..."
                          value={logoUrl}
                          onChange={(e) => setLogoUrl(e.target.value)}
                          className="w-full hidden bg-app-bg text-app-text border border-app-border rounded-xl px-2.5 py-1.5 text-[11px] font-mono text-center focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      {/* Cover Image Section */}
                      <div className="flex flex-col gap-3 border-t border-app-border/20 pt-4">
                        <span className="text-[10px] text-app-text-muted font-bold text-center block">
                          Cover Banner{' '}
                        </span>
                        <UnifiedUploader
                          onUploadSuccess={(url) => setCoverImageUrl(url)}
                          allowedTypes={['image']}
                          cropAspect={16 / 9}
                          bucketName="business-logos"
                          triggerElement={
                            <div className="relative group cursor-pointer border border-app-border hover:border-amber-500 rounded-2xl p-1 bg-app-bg transition shadow-sm w-full">
                              <img
                                src={
                                  coverImageUrl ||
                                  'https://images.unsplash.com/photo-1550989460-0adf9ea622e2?auto=format&fit=crop&q=80&w=350'
                                }
                                alt="Cover Preview"
                                className="w-full h-32 rounded-xl object-cover"
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 bg-black/60 rounded-xl opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition gap-1">
                                <Edit size={16} className="text-amber-500" />
                                <span className="text-[11px] font-semibold text-amber-500">
                                  Edit Cover Banner
                                </span>
                              </div>
                            </div>
                          }
                        />
                        <input
                          type="text"
                          placeholder="Or paste custom Cover Image URL..."
                          value={coverImageUrl}
                          onChange={(e) => setCoverImageUrl(e.target.value)}
                          className="w-full hidden bg-app-bg text-app-text border border-app-border rounded-xl px-2.5 py-1.5 text-[11px] font-mono text-center focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>

                    {/* Card 5: Action Controls */}
                    <div className="bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-3.5">
                      <div className="flex gap-2 items-start text-app-text-muted text-[10px] leading-relaxed font-semibold">
                        <Info
                          size={14}
                          className="text-amber-500 shrink-0 mt-0.5"
                        />
                        <span>
                          Changes show on every device once you save.
                        </span>
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md text-xs"
                      >
                        <Save size={14} />
                        <span>
                          {loading
                            ? 'Saving Settings...'
                            : 'Save Brand Details'}
                        </span>
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {isMoney && activeSubTab === 'expenses' && <ExpensesPanel />}

              {isMoney && activeSubTab === 'mpesa' && (
                <MpesaPaymentsPanel />
              )}

              {isMoney && activeSubTab === 'cards' && <CardPaymentsPanel />}

              {isMoney && activeSubTab === 'airtel' && <AirtelPaymentsPanel />}


              <CardChargeSheet
                open={chargingCard}
                amount={Number(payAmount) || 0}
                purpose="payment"
                customer={payType === 'customer' ? localCustomers.find((c) => c.id === payCustomerId) ?? null : null}
                payerName={paySenderName.trim() || undefined}
                description={payDescription.trim() || undefined}
                onPaid={onCardCharged}
                onClose={() => setChargingCard(false)}
              />

              {isMoney && activeSubTab === 'payments' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  {(hasRolePermission(role, "payments.mpesa") || hasRolePermission(role, "payments.verify")) && (
                    <TillInbox customers={localCustomers} canAssign />
                  )}
                  {/* Money balances by method */}
                  <div className="flex gap-3 overflow-x-auto snap-x -mx-1 px-1 pb-1 sm:grid sm:grid-cols-3 lg:grid-cols-5 sm:overflow-visible [&>*]:shrink-0 [&>*]:min-w-[9.5rem] [&>*]:snap-start sm:[&>*]:min-w-0">
                    {localMoneyAssets.length === 0 && (
                      <>
                        {MONEY_METHODS.map((m) => (
                          <div key={m} className="bg-app-card border border-app-border rounded-2xl p-3.5 flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              {METHOD_ICONS[m]}
                              <span className="text-[11px] font-semibold text-app-text-muted">
                                {m}
                              </span>
                            </div>
                            <span className="text-sm font-semibold font-mono text-app-text">
                              KSh 0
                            </span>
                            <span className="text-[11px] text-app-text-muted font-semibold">
                              No payments yet
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                    {[...localMoneyAssets].sort((x, y) => MONEY_METHODS.indexOf(x.method) - MONEY_METHODS.indexOf(y.method)).map((asset) => (
                      <div key={asset.id || asset.method} className="bg-app-card border border-app-border rounded-2xl p-3.5 flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          {METHOD_ICONS[asset.method as MoneyMethod] ?? <Wallet size={14} className="text-slate-500" />}
                          <span className="text-[11px] font-semibold text-app-text-muted">
                            {asset.method}
                          </span>
                        </div>
                        <span className="text-sm font-semibold font-mono text-emerald-500">
                          {formatCurrency(Number(asset.balance || 0))}
                        </span>
                        {asset.lastPaymentAt && (
                          <span className="text-[11px] text-app-text-muted font-semibold">
                            Last: {new Date(asset.lastPaymentAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {/* Payment Recorder Form - Modern */}
                    <form
                      onSubmit={handleAddPayment}
                      className="lg:col-span-1 lg:self-start bg-app-card border border-app-border rounded-2xl p-4 sm:p-5 shadow-sm space-y-4"
                    >
                      <div className="flex flex-col gap-3">
                        <button
                          type="button"
                          onClick={() => setPayFormOpen((v) => !v)}
                          aria-expanded={payFormOpen}
                          className="flex items-center gap-2.5 text-left cursor-pointer"
                        >
                          <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                            <CircleDollarSign size={16} className="text-amber-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-app-text">
                              Record a payment
                            </h3>
                            <p className="text-xs text-app-text-muted">
                              Cash, M-Pesa till, card or bank, from a customer or walk-in
                            </p>
                          </div>
                          <ChevronDown size={18} className={`text-app-text-muted transition ${payFormOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {payFormOpen && (<>

                        {/* Payment Type Toggle */}
                        <div className="grid grid-cols-2 gap-1.5 bg-app-bg/60 border border-app-border rounded-xl p-1">
                          <button
                            type="button"
                            onClick={() => {
                              setPayType('customer');
                              setPaySenderName("");
                            }}
                            className={`py-2 rounded-lg text-[11px] font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                              payType === 'customer'
                                ? 'bg-amber-500 text-slate-950 shadow-sm'
                                : 'text-app-text-muted hover:text-app-text'
                            }`}
                          >
                            <UserIcon size={12} />
                            Customer
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPayType('walk-in');
                              setPayCustomerId("");
                            }}
                            className={`py-2 rounded-lg text-[11px] font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                              payType === 'walk-in'
                                ? 'bg-amber-500 text-slate-950 shadow-sm'
                                : 'text-app-text-muted hover:text-app-text'
                            }`}
                          >
                            <Store size={12} />
                            Walk-in
                          </button>
                        </div>

                        {/* Customer selector (only for customer type) */}
                        {payType === 'customer' && (
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] text-app-text-muted font-bold">
                              Customer Account *
                            </label>
                            <SearchableDropdown
                              items={localCustomers.map((c) => ({
                                id: c.id,
                                label: c.name,
                                sublabel: [c.accountNumber && `Acc ${c.accountNumber}`, c.phone, Number(c.debtBalance || 0) > 0 && `owes ${formatCurrency(Number(c.debtBalance))}`, Number(c.walletBalance || 0) > 0 && `wallet ${formatCurrency(Number(c.walletBalance))}`].filter(Boolean).join(' · '),
                              }))}
                              selectedValue={payCustomerId}
                              onChange={(id) => {
                                const c = localCustomers.find((x) => x.id === id);
                                setPayCustomerId(id);
                                setPaySenderName(c?.name || "");
                                setPaySenderPhone(c?.phone || "");
                              }}
                              placeholder="Choose the customer"
                              searchPlaceholder="Name, phone or account number"
                            />
                            {payCustomerId && (
                              <div className="flex items-center gap-1.5 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                                <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold truncate">
                                  The payment goes to this customer's account
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Amount */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] text-app-text-muted font-bold">
                            Amount Received (KSh) *
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-2.5 text-[11px] font-semibold text-app-text-muted">
                              KSh
                            </span>
                            <NumberInput
                              required
                              min={0.01}
                              placeholder="0.00"
                              value={payAmount}
                              onChange={(v) => setExpPayAmount((v == null ? '' : String(v)))}
                              className="w-full" inputClassName="font-mono"
                            />
                          </div>
                        </div>

                        {/* Payment Method - Modern Cards */}
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-app-text-muted font-bold">
                              Payment Method *
                            </label>
                           
                          </div>
                          {payMethodDisplay === 'modern' ? (
                            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Payment method">
                              {payMethods.map((m) => (
                                <button
                                  type="button"
                                  key={m}
                                  role="radio"
                                  aria-checked={payMethod === m}
                                  onClick={() => setPayMethod(m)}
                                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition cursor-pointer ${
                                    payMethod === m
                                      ? 'border-amber-500 bg-amber-500/5'
                                      : 'border-app-border bg-app-bg/40 hover:border-amber-500/30'
                                  }`}
                                >
                                  {METHOD_ICONS[m]}
                                  <span className={`text-[10px] font-semibold ${payMethod === m ? 'text-amber-500' : 'text-app-text'}`}>
                                    {methodLabel(m)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <SearchableDropdown
                              items={payMethods.map((m) => ({ id: m, label: m === 'Bank' ? 'Bank transfer' : methodLabel(m) }))}
                              selectedValue={payMethod}
                              onChange={(val) => setPayMethod(val as MoneyMethod)}
                              placeholder="Select method..."
                            />
                          )}
                          {payMethod === 'Card' && (
                            <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-2.5 space-y-2">
                              <p className="text-[10px] text-app-text-muted">
                                Card machine: type the approval code. Or charge the card now.
                              </p>
                              {hasRolePermission(role, "payments.card") && (
                                <button
                                  type="button"
                                  onClick={startCardCharge}
                                  className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <CreditCard size={13} /> Charge card{Number(payAmount) > 0 ? ` ${formatCurrency(Number(payAmount))}` : ''}
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Sender Name */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] text-app-text-muted font-bold">
                            {payType === 'customer' ? 'Payer Name' : 'Customer / Payer Name *'}
                          </label>
                          <div className="relative">
                            <UserIcon size={13} className="absolute left-3 top-3 text-app-text-muted pointer-events-none" />
                            <input
                              type="text"
                              required
                              placeholder={payType === 'customer' ? 'Auto-filled from customer' : 'e.g. James Karuri'}
                              value={paySenderName}
                              onChange={(e) => setPaySenderName(e.target.value)}
                              className="w-full bg-app-bg text-app-text border border-app-border rounded-xl pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold"
                            />
                          </div>
                        </div>

                        {/* Sender Phone */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] text-app-text-muted font-bold">
                            Phone (Optional)
                          </label>
                          <input
                            type="tel"
                            placeholder="e.g. +254712345678"
                            value={paySenderPhone}
                            onChange={(e) => setPaySenderPhone(e.target.value)}
                            className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold"
                          />
                        </div>

                        {/* Reference + Status + Date grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="flex flex-col gap-1.5 sm:col-span-2">
                            <label className="text-[10px] text-app-text-muted font-bold">
                              {referenceHint(payMethod)?.label ?? 'Reference (optional)'}{payMethod !== 'Cash' ? ' *' : ''}
                            </label>
                            <input
                              type="text"
                              required={payMethod !== 'Cash'}
                              placeholder={referenceHint(payMethod)?.placeholder ?? 'Receipt number, if any'}
                              value={payRef}
                              onChange={(e) => setPayRef(e.target.value)}
                              className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-mono font-bold"
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] text-app-text-muted font-bold">
                              Status
                            </label>
                            <SearchableDropdown
                              items={[
                                { id: 'Success', label: 'Success' },
                                { id: 'Pending', label: 'Pending' },
                                { id: 'Failed', label: 'Failed' },
                              ]}
                              selectedValue={payStatus}
                              onChange={(val) => setPayStatus(val as any)}
                              placeholder="Status..."
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] text-app-text-muted font-bold">
                              Date
                            </label>
                            <input
                              type="date"
                              required
                              value={payDate}
                              onChange={(e) => setPayDate(e.target.value)}
                              className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-mono font-bold"
                            />
                          </div>
                        </div>

                        {/* Description */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] text-app-text-muted font-bold">
                            Notes / Description
                          </label>
                          <textarea
                            rows={2}
                            placeholder={payType === 'walk-in' ? 'e.g. Walk-in customer — fuel reimbursement' : 'e.g. August order settlement'}
                            value={payDescription}
                            onChange={(e) => setPayDescription(e.target.value)}
                            className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-medium"
                          />
                        </div>

                        {/* Info Banner */}
                        {payCustomerId && localCustomers.find(c => c.id === payCustomerId) && (
                          <div className="bg-app-bg/50 border border-app-border rounded-xl p-3 space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <ShieldCheck size={12} className="text-amber-500 shrink-0" />
                              <span className="text-[11px] font-semibold text-app-text-muted">
                                Where the money goes
                              </span>
                            </div>
                            {(() => {
                              const cust = localCustomers.find(c => c.id === payCustomerId)!;
                              const debt = Number(cust.debtBalance || 0);
                              const wallet = Number(cust.walletBalance || 0);
                              const amt = Number(payAmount) || 0;
                              const debtApplied = Math.min(debt, amt);
                              const walletApplied = amt > debt ? amt - debt : 0;
                              return (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-app-text-muted font-semibold">Outstanding Debt</span>
                                    <span className={`font-semibold font-mono ${debt > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                      {formatCurrency(debt)}
                                    </span>
                                  </div>
                                  {amt > 0 && (
                                    <>
                                      <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-app-text-muted font-semibold">→ Applied to debt</span>
                                        <span className="font-semibold font-mono text-red-500">-{formatCurrency(debtApplied)}</span>
                                      </div>
                                      <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-app-text-muted font-semibold">→ Credited to wallet</span>
                                        <span className="font-semibold font-mono text-emerald-500">+{formatCurrency(walletApplied)}</span>
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        <button
                          type="submit"
                          disabled={paymentSubmitting}
                          className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-md text-xs"
                        >
                          {paymentSubmitting ? (
                            <>
                              <RefreshCw size={14} className="animate-spin" />
                              <span>Recording...</span>
                            </>
                          ) : (
                            <>
                              <CircleDollarSign size={14} />
                              <span>Record Payment</span>
                            </>
                          )}
                        </button>
                        </>)}
                      </div>
                    </form>

                    <div className="lg:col-span-2 min-w-0">
                      <PaymentsList
                        payments={localPayments}
                        customers={localCustomers}
                        canVoid={canVoidPayments}
                        canAssign={canVoidPayments}
                        onVoid={voidPayment}
                        onAssign={assignPayment}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Fallback No Business Selected */
            <div className="bg-app-card border border-app-border rounded-2xl p-8 text-center text-app-text-muted flex flex-col items-center justify-center min-h-[300px]">
              <Building size={48} className="text-slate-600 mb-3 " />
              <h3 className="text-sm font-semibold uppercase font-display text-app-text">
                No Business Selected
              </h3>
              <p className="text-[10.5px] mt-1 max-w-xs leading-normal">
                Pick a branch from the list or add a new one.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
