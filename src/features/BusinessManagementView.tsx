import React, { useState, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { 
  Building, Save, Globe, Phone, Mail, Image as ImageIcon,  MapPin, CheckCircle, Info, Plus, X, Briefcase, Receipt, CreditCard, Calendar, RefreshCw,
  Edit, Wallet, TrendingUp, Smartphone, Banknote, Landmark, User as UserIcon, Store, Search,
  ArrowRight, CircleDollarSign, ShieldCheck, AlertTriangle, CheckCircle2, Trash2, ChevronLeft, ChevronRight
} from "lucide-react";
import UnifiedUploader from "../components/shared/UnifiedUploader";
import { validatePhone, normalizePhone, SUPPORTED_COUNTRIES } from "../utils/phoneUtils";
import { hasRolePermission } from "../utils/permissions";
import SearchableDropdown from "../components/SearchableDropdown";
import { titleCase } from "../utils/stringUtils";
import { BUSINESS_TYPES } from "../App";

const COLOR_PRESETS = [
  { name: "Isms Amber", primary: "#f59e0b", secondary: "#1e293b", label: "Amber & Slate" },
  { name: "Royal Cobalt", primary: "#2563eb", secondary: "#0f172a", label: "Blue & Navy" },
  { name: "Forest Mint", primary: "#10b981", secondary: "#064e3b", label: "Emerald & Pine" },
  { name: "Crimson Velvet", primary: "#dc2626", secondary: "#450a0a", label: "Ruby & Maroon" },
  { name: "Sunset Orange", primary: "#f97316", secondary: "#1e1b4b", label: "Orange & Indigo" },
  { name: "Monochrome Sleek", primary: "#94a3b8", secondary: "#0f172a", label: "Silver & Charcoal" }
];

export default function BusinessManagementView() {
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

  // Creation States
  const [isCreating, setIsCreating] = useState(false);
  const [newBizName, setNewBizName] = useState("");
  const [newBizDesc, setNewBizDesc] = useState("");
  const [newBizAddr, setNewBizAddr] = useState("");
  const [newBizLogo, setNewBizLogo] = useState("");
  const [newBizType, setNewBizType] = useState("Retail");
  const [newBizCustomType, setNewBizCustomType] = useState("");
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
  const [customTypeInput, setCustomTypeInput] = useState("");
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
  const [activeSubTab, setActiveSubTab] = useState<"details" | "expenses" | "payments">("details");

  // Expenses States
  const [expAmount, setExpAmount] = useState("");
  const [expCategory, setExpCategory] = useState("Rent");
  const [expDescription, setExpDescription] = useState("");
  const [expDate, setExpDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [expStaffName, setExpStaffName] = useState("");
  const [expenseSubmitting, setExpenseSubmitting] = useState(false);
  const [localExpenses, setLocalExpenses] = useState<any[]>([]);

  // Payments States - Modern Redesigned
  const [payRef, setPayRef] = useState("");
  const [payAmount, setExpPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"M-Pesa" | "Cash" | "Card" | "Bank" | "Other">("M-Pesa");
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
  const [paySearchQuery, setPaySearchQuery] = useState("");
  const [payCustomerDropdownOpen, setPayCustomerDropdownOpen] = useState(false);
  const [payMethodDisplay, setPayMethodDisplay] = useState<"modern" | "classic">("modern");
  const [payFilter, setPayFilter] = useState<"all" | "customer" | "walk-in">("all");

  // Sync current employee for default staff name in expense
  useEffect(() => {
    if (currentEmployee) {
      setExpStaffName(currentEmployee.name || "");
    }
  }, [currentEmployee]);

  // Subscribe to real-time repositories
  useEffect(() => {
    if (!activeBusinessId) return;
    let unsubExp: (() => void) | undefined;
    let unsubPay: (() => void) | undefined;
    let unsubAssets: (() => void) | undefined;
    let unsubCust: (() => void) | undefined;

    import("../services/repositories").then((mod) => {
      unsubExp = mod.ExpenseRepository.subscribe((exps) => {
        setLocalExpenses(exps);
      });
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
      if (unsubExp) unsubExp();
      if (unsubPay) unsubPay();
      if (unsubAssets) unsubAssets();
      if (unsubCust) unsubCust();
    };
  }, [activeBusinessId]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBusinessId) return;
    const amountNum = Number(expAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast("Error", "Amount must be a positive number.", undefined, "error");
      return;
    }
    const cashierName = expStaffName.trim() || currentEmployee?.name || "System";
    setExpenseSubmitting(true);
    try {
      const { ExpenseRepository } = await import("../services/repositories");
      await ExpenseRepository.add({
        amount: amountNum,
        category: expCategory,
        description: expDescription.trim(),
        date: new Date(expDate).toISOString(),
        staffName: cashierName,
        businessId: activeBusinessId
      });
      showToast("Success", "Operational expense recorded successfully.", undefined, "success");
      setExpAmount("");
      setExpDescription("");
    } catch (err: any) {
      console.error(err);
      showToast("Error", err.message || "Failed to record expense.", undefined, "error");
    } finally {
      setExpenseSubmitting(false);
    }
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBusinessId) return;
    const amountNum = Number(payAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast("Error", "Amount must be a positive number.", undefined, "error");
      return;
    }
    if (!payRef.trim()) {
      showToast("Error", "Reference code is required.", undefined, "error");
      return;
    }
    if (!paySenderName.trim()) {
      showToast("Error", "Customer/Sender name is required.", undefined, "error");
      return;
    }
    setPaymentSubmitting(true);
    try {
      const { PaymentRepository } = await import("../services/repositories");
      const selectedCustomer = localCustomers.find(c => c.id === payCustomerId);

      await PaymentRepository.add({
        referenceCode: payRef.trim(),
        amount: amountNum,
        method: payMethod,
        senderName: paySenderName.trim(),
        senderPhone: paySenderPhone.trim() ? normalizePhone(paySenderPhone) : undefined,
        status: payStatus,
        date: new Date(payDate).toISOString(),
        businessId: activeBusinessId,
        customerId: payCustomerId || undefined,
        paymentType: payType,
        description: payDescription.trim() || undefined,
        recordedBy: currentEmployee?.name || "System",
      });

      const appliedMsg = selectedCustomer?.debtBalance > 0
        ? " Payment applied to outstanding debt balance first."
        : selectedCustomer?.walletBalance > 0 || selectedCustomer?.walletBalance === 0
          ? " Wallet credited with any remaining balance."
          : "";

      showToast(
        "Payment Received",
        `Business payment recorded${selectedCustomer ? ` for ${selectedCustomer.name}` : ""}. Money asset updated.${appliedMsg}`,
        undefined,
        "success"
      );
      setPayRef("");
      setExpPayAmount("");
      setPaySenderName("");
      setPaySenderPhone("");
      setPayCustomerId("");
      setPayDescription("");
      setPayType("walk-in");
      setPaySearchQuery("");
    } catch (err: any) {
      console.error(err);
      showToast("Error", err.message || "Failed to record payment.", undefined, "error");
    } finally {
      setPaymentSubmitting(false);
    }
  };

  // Sync state with active business on load or change
  useEffect(() => {
    if (activeBiz) {
      setName(activeBiz.name || "");
      setDescription(activeBiz.description || "");
      setAddress(activeBiz.address || "");
      setLogoUrl(activeBiz.logoUrl || "");
      setCoverImageUrl(activeBiz.coverImageUrl || "");
      setBusinessType(activeBiz.businessType || "Retail");
      setCountry(activeBiz.country || "Kenya");
      setCurrency(activeBiz.currency || "Ksh");
      setContactEmail(activeBiz.contactEmail || "");
      setContactPhone(activeBiz.contactPhone || "");
      setPrimaryColor(activeBiz.primaryColor || "#f59e0b");
      setSecondaryColor(activeBiz.secondaryColor || "#1e293b");
      setIsTaxEnabled(activeBiz.isTaxEnabled !== false);
      setTaxPercentage(typeof activeBiz.taxPercentage === 'number' ? activeBiz.taxPercentage : 16.0);
      
      // Check if business type is a custom type (not in the predefined list)
      const predefinedTypes = ['Retail', 'Wholesale', 'Dairy Processing', 'Farm', 'Cooperative'];
      if (!predefinedTypes.includes(activeBiz.businessType)) {
        setBusinessType('Other');
        setCustomTypeInput(activeBiz.businessType || "");
      } else {
        setCustomTypeInput("");
      }
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
      showToast("Operation Failed", "No active business workspace detected.", undefined, "error");
      return;
    }

    if (!validateForm()) {
      showToast("Validation Error", "Please correct the highlighted errors.", undefined, "error");
      return;
    }

    setLoading(true);
    try {
      const normalizedPhone = contactPhone.trim() ? normalizePhone(contactPhone) : "";
      const finalBusinessType = businessType === 'Other' ? customTypeInput : businessType;
      
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

      showToast("Workspace Synced", "Business configuration has been updated.", undefined, "success");
    } catch (err: any) {
      console.error("Failed to update business configuration:", err);
      showToast("Update Failed", err.message || "Failed to update business details.", undefined, "error");
    } finally {
      setLoading(false);
    }
  };

  const handlePresetSelect = (primary: string, secondary: string) => {
    setPrimaryColor(primary);
    setSecondaryColor(secondary);
    showToast("Branding Preset", `Applied theme colors.`, undefined, "info");
  };

  const isOwner = currentEmployee?.role === 'Owner';

  const handleDeleteExpense = async (id: string) => {
    if (!isOwner) return;
    if (!confirm("Delete this expense record? This action cannot be undone.")) return;
    try {
      const { ExpenseRepository } = await import("../services/repositories");
      await ExpenseRepository.delete(id);
      showToast("Deleted", "Expense record deleted successfully.", undefined, "success");
    } catch (err: any) {
      console.error(err);
      showToast("Error", err.message || "Failed to delete expense.", undefined, "error");
    }
  };

  const handleDeletePayment = async (id: string) => {
    if (!isOwner) return;
    if (!confirm("Delete this payment record? This action cannot be undone.")) return;
    try {
      const { PaymentRepository } = await import("../services/repositories");
      await PaymentRepository.delete(id);
      showToast("Deleted", "Payment record deleted successfully.", undefined, "success");
    } catch (err: any) {
      console.error(err);
      showToast("Error", err.message || "Failed to delete payment.", undefined, "error");
    }
  };

  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newBizName.trim()) {
      showToast("Validation Error", "Branch/Business Name is required.", undefined, "error");
      return;
    }

    setCreatingLoading(true);
    try {
      const finalBizType = newBizType === 'Other' ? newBizCustomType : newBizType;
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
        setNewBizType("Retail");
        setNewBizCustomType("");
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
    <div className="h-full overflow-y-auto p-4 pb-24 space-y-5 bg-app-bg text-app-text font-sans">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b border-app-border/40 pb-3">
        <div>
          <h2 className="text-sm font-extrabold font-display text-app-text uppercase tracking-wider flex items-center gap-1.5">
            <Building size={16} className="text-amber-500" /> Admin Business
            Management
          </h2>
          <p className="text-[9.5px] text-app-text-muted mt-0.5 font-medium leading-normal">
            Configure metadata, contact points, brand representations, and
            global workspace defaults for your business branches.
          </p>
        </div>
      </div>

      {/* Branch Badge Tabs - Visible only on large screens (xl and above) */}
      <div className="hidden xl:flex items-stretch gap-3 overflow-x-auto pb-2 pt-1 -mx-1 px-1 min-h-[130px]">
        {businesses.map((biz) => {
          const isActive = biz.id === activeBusinessId && !isCreating;
          return (
            <button
              key={biz.id}
              type="button"
              onClick={() => {
                setIsCreating(false);
                setActiveBusinessId(biz.id);
              }}
              className={`relative shrink-0 w-[230px] rounded-2xl border text-left overflow-hidden transition-all cursor-pointer group ${
                isActive
                  ? 'border-amber-500 ring-1 ring-amber-500/30 shadow-md'
                  : 'border-app-border hover:border-amber-500/40 hover:shadow-sm'
              }`}
              style={{ minHeight: '110px' }}
            >
              {/* Cover Image / Badge Header */}
              <div className="h-[52px] w-full bg-gradient-to-r from-amber-500/80 to-amber-600/60 relative overflow-hidden">
                {biz.coverImageUrl && (
                  <img
                    src={biz.coverImageUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover opacity-80"
                    referrerPolicy="no-referrer"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 to-transparent" />
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
                <h4 className="text-[10px] font-black text-app-text uppercase tracking-wider truncate">
                  {titleCase(biz.name)}
                </h4>
                <p className="text-[8.5px] text-app-text-muted font-bold uppercase tracking-wider truncate mt-0.5">
                  {biz.businessType || 'Retail'}
                </p>
                {biz.address && (
                  <span className="text-[8px] font-mono text-app-text-muted uppercase truncate flex items-center gap-0.5 mt-1">
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
            onClick={() => setIsCreating(true)}
            className={`shrink-0 w-[180px] rounded-2xl border-2 border-dashed text-left transition-all cursor-pointer flex flex-col items-center justify-center gap-1 min-h-[110px] ${
              isCreating
                ? 'border-amber-500 text-amber-500 bg-amber-500/5'
                : 'border-app-border text-app-text-muted hover:border-amber-500/50 hover:text-amber-500'
            }`}
          >
            <Plus size={18} />
            <span className="text-[8.5px] font-black uppercase tracking-wider">Add Branch</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Left Column: Businesses & Branches Directory */}
        <div className="xl:hidden flex flex-col gap-4">
          <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-app-border/40 pb-2">
              <span className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                Branches Directory
              </span>
              <span className="text-[8.5px] font-mono text-amber-500 font-bold bg-amber-500/10 px-2 py-0.5 rounded-full">
                {businesses.length}/5
              </span>
            </div>

            <div className="flex flex-col gap-2 max-h-[350px] overflow-y-auto pr-1">
              {businesses.map((biz) => {
                const isActive = biz.id === activeBusinessId && !isCreating;
                return (
                  <div
                    key={biz.id}
                    onClick={() => {
                      setIsCreating(false);
                      setActiveBusinessId(biz.id);
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
                        <p className="text-[8.5px] text-app-text-muted truncate">
                          {biz.businessType || 'Retail'}
                        </p>
                      </div>
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                      )}
                    </div>
                    {biz.address && (
                      <span className="text-[7.5px] font-mono text-app-text-muted uppercase truncate flex items-center gap-0.5">
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
                  onClick={() => setIsCreating(true)}
                  className={`w-full py-2 border-2 border-dashed rounded-xl text-[9px] font-bold uppercase transition flex items-center justify-center gap-1.5 cursor-pointer ${
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
          {isCreating ? (
            /* Creation Form */
            <form
              onSubmit={handleCreateBusiness}
              className="bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-5"
            >
              <div className="flex items-center justify-between border-b border-app-border/40 pb-2">
                <div className="flex items-center gap-2">
                  <Building size={14} className="text-amber-500" />
                  <h3 className="text-xs font-bold text-app-text uppercase tracking-wider">
                    Establish New Business Branch
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
                  <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                    Branch / Business Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ISMS  - Syokimau Hub"
                    value={newBizName}
                    onChange={(e) => setNewBizName(e.target.value)}
                    className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold"
                  />
                </div>

                 {/* Operation Type */}
                 <div className="flex flex-col gap-1">
                   <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                     Operation Type
                   </label>
                   <SearchableDropdown
                     items={
                     BUSINESS_TYPES
                    }
                     selectedValue={newBizType}
                     onChange={(val) => setNewBizType(val)}
                     placeholder="Select operation type..."
                   />
                   {newBizType === 'Other' && (
                     <input
                       type="text"
                       placeholder="Specify business type (e.g., Butchery, Logistics)"
                       value={newBizCustomType}
                       onChange={(e) => setNewBizCustomType(e.target.value)}
                       className="mt-1 bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500"
                       autoFocus
                     />
                   )}
                 </div>

                {/* Country Context */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                    Country Context
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
                  <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                    Operational Currency
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
                <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                  Operational Description / Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Describe branch inventory limits, wholesale distribution scopes..."
                  value={newBizDesc}
                  onChange={(e) => setNewBizDesc(e.target.value)}
                  className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-medium leading-relaxed"
                />
              </div>

              {/* Address */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                  Physical Address / Location
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
                <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
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
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-md text-xs"
                >
                  {creatingLoading ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    'Establish Branch'
                  )}
                </button>
              </div>
            </form>
          ) : activeBiz ? (
            <div className="space-y-5">
              {/* Tab Selector */}
              <div className="flex bg-app-card border border-app-border rounded-2xl p-1 shadow-xs gap-1">
                <button
                  type="button"
                  onClick={() => setActiveSubTab('details')}
                  className={`flex-1 py-2 px-2 sm:px-3 rounded-xl text-[11px] sm:text-xs font-bold transition flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer whitespace-nowrap ${
                    activeSubTab === 'details'
                      ? 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'text-app-text-muted hover:text-app-text hover:bg-app-bg/50'
                  }`}
                >
                  <Building size={16} className="shrink-0" />
                  <span>
                    <span className="hidden xs:inline sm:inline">
                      Business{' '}
                    </span>
                    Details
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSubTab('expenses')}
                  className={`flex-1 py-2 px-2 sm:px-3 rounded-xl text-[11px] sm:text-xs font-bold transition flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer whitespace-nowrap ${
                    activeSubTab === 'expenses'
                      ? 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'text-app-text-muted hover:text-app-text hover:bg-app-bg/50'
                  }`}
                >
                  <Receipt size={16} className="shrink-0" />
                  <span>Expenses</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSubTab('payments')}
                  className={`flex-1 py-2 px-2 sm:px-3 rounded-xl text-[11px] sm:text-xs font-bold transition flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer whitespace-nowrap ${
                    activeSubTab === 'payments'
                      ? 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'text-app-text-muted hover:text-app-text hover:bg-app-bg/50'
                  }`}
                >
                  <CreditCard size={16} className="shrink-0" />
                  <span>Payments</span>
                </button>
              </div>

              {activeSubTab === 'details' && (
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
                        <h3 className="text-xs font-bold text-app-text uppercase tracking-wider">
                          Core Workspace Profile
                        </h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Business Name */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                            Business / Branch Name *
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Westlands Dairy Depot"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={`bg-app-bg text-app-text border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold ${
                              errors.name
                                ? 'border-red-500'
                                : 'border-app-border'
                            }`}
                          />
                          {errors.name && (
                            <span className="text-[9px] text-red-500 font-medium">
                              {errors.name}
                            </span>
                          )}
                        </div>

                         {/* Business Type */}
                         <div className="flex flex-col gap-1">
                           <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                             Operation Type
                           </label>
                           <SearchableDropdown
                             items={
                              BUSINESS_TYPES
                            }
                             selectedValue={businessType}
                             onChange={(val) => {
                               setBusinessType(val);
                               if (val !== 'Other') {
                                 setCustomTypeInput("");
                               }
                             }}
                             placeholder="Select operation type..."
                           />
                           {businessType === 'Other' && (
                             <input
                               type="text"
                               placeholder="Specify business type (e.g., Butchery, Logistics)"
                               value={customTypeInput}
                               onChange={(e) => setCustomTypeInput(e.target.value)}
                               className="mt-1 bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500"
                               autoFocus
                             />
                           )}
                         </div>

                        {/* Description */}
                        <div className="flex flex-col gap-1 md:col-span-2">
                          <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                            Operational Description
                          </label>
                          <textarea
                            rows={3}
                            placeholder="Describe scope, branches, daily handling volume..."
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
                        <h3 className="text-xs font-bold text-app-text uppercase tracking-wider">
                          Contact & Communications
                        </h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Address */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                            Physical Address
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
                          <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                            Contact Email
                          </label>
                          <input
                            type="email"
                            placeholder="e.g. branch@isms.com"
                            value={contactEmail}
                            onChange={(e) => setContactEmail(e.target.value)}
                            className={`bg-app-bg text-app-text border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold ${
                              errors.contactEmail
                                ? 'border-red-500'
                                : 'border-app-border'
                            }`}
                          />
                          {errors.contactEmail && (
                            <span className="text-[9px] text-red-500 font-medium">
                              {errors.contactEmail}
                            </span>
                          )}
                        </div>

                        {/* Phone */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                            Contact Hotline
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
                            <span className="text-[9px] text-red-500 font-medium">
                              {errors.contactPhone}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Card 3: Tax & VAT Settings */}
                    <div className="bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center gap-2 border-b border-app-border/40 pb-2">
                        <Briefcase size={14} className="text-amber-500" />
                        <h3 className="text-xs font-bold text-app-text uppercase tracking-wider">
                          Tax & VAT Settings
                        </h3>
                      </div>

                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <span className="font-extrabold text-app-text text-xs block">
                              Enable Tax / VAT Tracking
                            </span>
                            <span className="text-[10px] text-app-text-muted font-medium block mt-0.5 leading-tight">
                              Toggle tax computations during Point of Sale
                              checkouts.
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsTaxEnabled(!isTaxEnabled)}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              isTaxEnabled ? 'bg-amber-500' : 'bg-app-border'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-900 shadow-lg ring-0 transition duration-200 ease-in-out ${
                                isTaxEnabled ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>

                        {isTaxEnabled && (
                          <div className="flex flex-col gap-1 bg-app-bg/50 p-3.5 border border-app-border rounded-2xl">
                            <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                              VAT Rate % (Supports 0% for Zero-Rating)
                            </label>
                            <input
                              type="number"
                              value={taxPercentage}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setTaxPercentage(isNaN(val) ? 0 : val);
                              }}
                              className="w-[120px] bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-xs font-bold"
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
                        <h3 className="text-xs font-bold text-app-text uppercase tracking-wider">
                          Brand Graphics
                        </h3>
                      </div>

                      {/* Logo Section */}
                      <div className="flex flex-col gap-3">
                        <span className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider text-center block">
                          Workspace Logo
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
                                <span className="text-[7px] font-black uppercase text-amber-500">
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
                          className="w-full hidden bg-app-bg text-app-text border border-app-border rounded-xl px-2.5 py-1.5 text-[9.5px] font-mono text-center focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      {/* Cover Image Section */}
                      <div className="flex flex-col gap-3 border-t border-app-border/20 pt-4">
                        <span className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider text-center block">
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
                                <span className="text-[8px] font-black uppercase text-amber-500">
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
                          className="w-full hidden bg-app-bg text-app-text border border-app-border rounded-xl px-2.5 py-1.5 text-[9.5px] font-mono text-center focus:outline-none focus:border-amber-500"
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
                          Saving configuration changes will sync live settings
                          parameters.
                        </span>
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer shadow-md text-xs"
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

              {activeSubTab === 'expenses' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-in fade-in duration-200">
                  {/* Expense Recorder Form */}
                  <form
                    onSubmit={handleAddExpense}
                    className="lg:col-span-1 bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-4"
                  >
                    <div className="flex items-center gap-2 border-b border-app-border/40 pb-2">
                      <Receipt size={14} className="text-amber-500" />
                      <h3 className="text-xs font-bold text-app-text uppercase tracking-wider">
                        Record Operational Expense
                      </h3>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                        Amount (KSh) *
                      </label>
                      <input
                        type="number"
                        required
                        min="1"
                        placeholder="e.g. 5000"
                        value={expAmount}
                        onChange={(e) => setExpAmount(e.target.value)}
                        className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                        Expense Category *
                      </label>
                      <SearchableDropdown
                        items={[
                          { id: 'Rent', label: 'Rent / Space Lease' },
                          { id: 'Wages', label: 'Wages & Shift Salaries' },
                          { id: 'Transport', label: 'Transport & Logistics' },
                          {
                            id: 'Utilities',
                            label: 'Utilities (Water, Power, Net)',
                          },
                          { id: 'Maintenance', label: 'Maintenance & Repairs' },
                          { id: 'Marketing', label: 'Marketing & Adverts' },
                          {
                            id: 'Other operating costs',
                            label: 'Other Operating Costs',
                          },
                        ]}
                        selectedValue={expCategory}
                        onChange={(val) => setExpCategory(val)}
                        placeholder="Select category..."
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                        Date *
                      </label>
                      <input
                        type="date"
                        required
                        value={expDate}
                        onChange={(e) => setExpDate(e.target.value)}
                        className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-mono font-bold"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                        Staff / Recorder Name
                      </label>
                      <input
                        type="text"
                        placeholder="Staff Name..."
                        value={expStaffName}
                        onChange={(e) => setExpStaffName(e.target.value)}
                        className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                        Description (Optional)
                      </label>
                      <textarea
                        rows={3}
                        placeholder="Describe the nature of this expense..."
                        value={expDescription}
                        onChange={(e) => setExpDescription(e.target.value)}
                        className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-medium"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={expenseSubmitting}
                      className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer shadow-md text-xs"
                    >
                      <Save size={14} />
                      <span>
                        {expenseSubmitting ? 'Recording...' : 'Record Expense'}
                      </span>
                    </button>
                  </form>

                  {/* Expenses Directory / List */}
                  <div className="lg:col-span-2 bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-4 flex flex-col">
                    <div className="flex items-center justify-between border-b border-app-border/40 pb-2">
                      <div className="flex items-center gap-2">
                        <Receipt size={14} className="text-amber-500" />
                        <h3 className="text-xs font-bold text-app-text uppercase tracking-wider">
                          Recorded Operational Expenses
                        </h3>
                      </div>
                      <span className="text-[9px] font-mono text-app-text-muted font-black">
                        {localExpenses.length} Record(s)
                      </span>
                    </div>

                    <div className="flex-1 overflow-x-auto min-h-[300px] max-h-[500px]">
                      {localExpenses.length > 0 ? (
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-app-border/40 text-[9px] text-app-text-muted font-bold uppercase tracking-wider">
                              <th className="py-2.5">Date</th>
                              <th className="py-2.5">Category</th>
                              <th className="py-2.5">Staff</th>
                              <th className="py-2.5">Description</th>
                              <th className="py-2.5 text-right">Amount</th>
                              {isOwner && <th className="py-2.5 text-center">Actions</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-app-border/20 text-xs">
                            {localExpenses.map((exp) => (
                              <tr
                                key={exp.id}
                                className="hover:bg-app-bg/30 transition"
                              >
                                <td className="py-2.5 font-mono text-[10.5px]">
                                  {new Date(exp.date).toLocaleDateString(
                                    undefined,
                                    {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric',
                                    },
                                  )}
                                </td>
                                <td className="py-2.5 font-bold text-app-text">
                                  {exp.category}
                                </td>
                                <td className="py-2.5 text-app-text-muted font-semibold">
                                  {exp.staffName}
                                </td>
                                <td
                                  className="py-2.5 text-app-text-muted max-w-[200px] truncate"
                                  title={exp.description}
                                >
                                  {exp.description || '—'}
                                </td>
                                <td className="py-2.5 text-right font-black font-mono text-red-500">
                                  KSh {Number(exp.amount).toLocaleString()}
                                </td>
                                {isOwner && (
                                  <td className="py-2.5 text-center">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteExpense(exp.id)}
                                      title="Delete expense"
                                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition cursor-pointer"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-app-text-muted text-center py-12">
                          <Receipt size={32} className="text-slate-700 mb-2" />
                          <p className="text-[10.5px] font-bold">
                            No Operational Expenses Logged
                          </p>
                          <p className="text-[9.5px] max-w-xs mt-0.5">
                            Expenses recorded using the form on the left will
                            sync here and update analytics in real-time.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'payments' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  {/* Money Assets Overview Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                    {localMoneyAssets.length === 0 && (
                      <>
                        {(['M-Pesa', 'Cash', 'Card', 'Bank', 'Other'] as const).map((m) => (
                          <div key={m} className="bg-app-card border border-app-border rounded-2xl p-3.5 flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              {m === 'M-Pesa' ? (
                                <Smartphone size={14} className="text-emerald-500" />
                              ) : m === 'Cash' ? (
                                <Banknote size={14} className="text-amber-500" />
                              ) : m === 'Card' ? (
                                <CreditCard size={14} className="text-blue-500" />
                              ) : m === 'Bank' ? (
                                <Landmark size={14} className="text-violet-500" />
                              ) : (
                                <Wallet size={14} className="text-slate-500" />
                              )}
                              <span className="text-[9.5px] font-black uppercase tracking-wider text-app-text-muted">
                                {m}
                              </span>
                            </div>
                            <span className="text-sm font-black font-mono text-app-text">
                              KSh 0
                            </span>
                            <span className="text-[8px] text-app-text-muted font-semibold uppercase">
                              No payments yet
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                    {localMoneyAssets.map((asset) => (
                      <div key={asset.id || asset.method} className="bg-app-card border border-app-border rounded-2xl p-3.5 flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          {asset.method === 'M-Pesa' ? (
                            <Smartphone size={14} className="text-emerald-500" />
                          ) : asset.method === 'Cash' ? (
                            <Banknote size={14} className="text-amber-500" />
                          ) : asset.method === 'Card' ? (
                            <CreditCard size={14} className="text-blue-500" />
                          ) : asset.method === 'Bank' ? (
                            <Landmark size={14} className="text-violet-500" />
                          ) : (
                            <Wallet size={14} className="text-slate-500" />
                          )}
                          <span className="text-[9.5px] font-black uppercase tracking-wider text-app-text-muted">
                            {asset.method}
                          </span>
                        </div>
                        <span className="text-sm font-black font-mono text-emerald-500">
                          KSh {Number(asset.balance || 0).toLocaleString()}
                        </span>
                        {asset.lastPaymentAt && (
                          <span className="text-[8px] text-app-text-muted font-semibold">
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
                      className="lg:col-span-1 bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-4"
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                            <CircleDollarSign size={16} className="text-amber-500" />
                          </div>
                          <div>
                            <h3 className="text-xs font-black text-app-text uppercase tracking-wider">
                              Receive Payment
                            </h3>
                            <p className="text-[9px] text-app-text-muted font-medium">
                              Records money asset + customer credit
                            </p>
                          </div>
                        </div>

                        {/* Payment Type Toggle */}
                        <div className="grid grid-cols-2 gap-1.5 bg-app-bg/60 border border-app-border rounded-xl p-1">
                          <button
                            type="button"
                            onClick={() => {
                              setPayType('customer');
                              setPaySenderName("");
                            }}
                            className={`py-2 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer ${
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
                            className={`py-2 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer ${
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
                            <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                              Customer Account *
                            </label>
                            <div className="relative">
                              <Search
                                size={13}
                                className="absolute left-3 top-3 text-app-text-muted pointer-events-none"
                              />
                              <input
                                type="text"
                                value={paySearchQuery}
                                onChange={(e) => {
                                  setPaySearchQuery(e.target.value);
                                  setPayCustomerDropdownOpen(true);
                                  setPayCustomerId("");
                                }}
                                onFocus={() => setPayCustomerDropdownOpen(true)}
                                placeholder="Search customer by name / phone..."
                                className="w-full bg-app-bg text-app-text border border-app-border rounded-xl pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-bold"
                              />
                              {payCustomerDropdownOpen && (
                                <>
                                  <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setPayCustomerDropdownOpen(false)}
                                  />
                                  <div className="absolute z-20 mt-1 w-full bg-app-card border border-app-border rounded-xl shadow-2xl overflow-hidden">
                                    <div className="max-h-52 overflow-y-auto">
                                      {localCustomers
                                        .filter((c) =>
                                          !paySearchQuery.trim() ||
                                          c.name.toLowerCase().includes(paySearchQuery.toLowerCase()) ||
                                          (c.phone || '').includes(paySearchQuery)
                                        )
                                        .slice(0, 12)
                                        .map((c) => (
                                          <button
                                            type="button"
                                            key={c.id}
                                            onClick={() => {
                                              setPayCustomerId(c.id);
                                              setPaySenderName(c.name);
                                              setPaySenderPhone(c.phone || "");
                                              setPayCustomerDropdownOpen(false);
                                              setPaySearchQuery(c.name);
                                            }}
                                            className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-amber-500/10 transition cursor-pointer ${
                                              payCustomerId === c.id ? 'bg-amber-500/5' : ''
                                            }`}
                                          >
                                            <div className="w-7 h-7 rounded-lg bg-app-bg border border-app-border flex items-center justify-center shrink-0">
                                              <UserIcon size={12} className="text-amber-500" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <p className="text-[11px] font-bold text-app-text truncate">
                                                {c.name}
                                              </p>
                                              <div className="flex items-center gap-2 text-[8.5px] text-app-text-muted font-mono">
                                                {c.phone && <span>{c.phone}</span>}
                                                {Number(c.debtBalance || 0) > 0 && (
                                                  <span className="text-red-500 font-black">
                                                    Debt: KSh {Number(c.debtBalance).toLocaleString()}
                                                  </span>
                                                )}
                                                {Number(c.walletBalance || 0) > 0 && (
                                                  <span className="text-emerald-500 font-black">
                                                    Wallet: KSh {Number(c.walletBalance).toLocaleString()}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                          </button>
                                        ))}
                                      {localCustomers.length === 0 && (
                                        <div className="p-3 text-[10px] text-app-text-muted text-center font-medium">
                                          No registered customers found
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                            {payCustomerId && (
                              <div className="flex items-center gap-1.5 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                                <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                                <span className="text-[9.5px] text-emerald-600 dark:text-emerald-400 font-bold truncate">
                                  Payment will reconcile against this customer's account
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Amount */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                            Amount Received (KSh) *
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-2.5 text-[11px] font-black text-app-text-muted">
                              KSh
                            </span>
                            <input
                              type="number"
                              required
                              min="1"
                              placeholder="0.00"
                              value={payAmount}
                              onChange={(e) => setExpPayAmount(e.target.value)}
                              className="w-full bg-app-bg text-app-text border border-app-border rounded-xl pl-11 pr-3 py-2.5 text-sm font-black font-mono focus:outline-none focus:border-amber-500"
                            />
                          </div>
                        </div>

                        {/* Payment Method - Modern Cards */}
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                              Payment Method *
                            </label>
                            <button
                              type="button"
                              onClick={() => setPayMethodDisplay(payMethodDisplay === 'modern' ? 'classic' : 'modern')}
                              className="text-[8px] font-bold text-app-text-muted hover:text-amber-500 uppercase tracking-wider transition cursor-pointer"
                            >
                              {payMethodDisplay === 'modern' ? 'Classic view' : 'Modern view'}
                            </button>
                          </div>
                          {payMethodDisplay === 'modern' ? (
                            <div className="grid grid-cols-2 gap-1.5">
                              {(['M-Pesa', 'Cash', 'Card', 'Bank'] as const).map((m) => {
                                const icons: Record<string, React.ReactNode> = {
                                  'M-Pesa': <Smartphone size={14} className="text-emerald-500" />,
                                  'Cash': <Banknote size={14} className="text-amber-500" />,
                                  'Card': <CreditCard size={14} className="text-blue-500" />,
                                  'Bank': <Landmark size={14} className="text-violet-500" />,
                                };
                                return (
                                  <button
                                    type="button"
                                    key={m}
                                    onClick={() => setPayMethod(m)}
                                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition cursor-pointer ${
                                      payMethod === m
                                        ? 'border-amber-500 bg-amber-500/5'
                                        : 'border-app-border bg-app-bg/40 hover:border-amber-500/30'
                                    }`}
                                  >
                                    {icons[m]}
                                    <span className={`text-[10px] font-black ${payMethod === m ? 'text-amber-500' : 'text-app-text'}`}>
                                      {m}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <SearchableDropdown
                              items={[
                                { id: 'M-Pesa', label: 'M-Pesa' },
                                { id: 'Cash', label: 'Cash' },
                                { id: 'Card', label: 'Card' },
                                { id: 'Bank', label: 'Bank Transfer' },
                                { id: 'Other', label: 'Other' },
                              ]}
                              selectedValue={payMethod}
                              onChange={(val) => setPayMethod(val as any)}
                              placeholder="Select method..."
                            />
                          )}
                        </div>

                        {/* Sender Name */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
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
                          <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
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
                            <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                              Reference Code / M-Pesa ID *
                            </label>
                            <input
                              type="text"
                              required
                              placeholder="e.g. SXK2M9Q1TZ"
                              value={payRef}
                              onChange={(e) => setPayRef(e.target.value)}
                              className="bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 font-mono font-bold"
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
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
                            <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
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
                          <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                            Notes / Description
                          </label>
                          <textarea
                            rows={2}
                            placeholder={payType === 'walk-in' ? 'e.g. Walk-in customer — fuel reimbursement' : 'e.g. August milk order settlement'}
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
                              <span className="text-[9px] font-black uppercase tracking-wider text-app-text-muted">
                                Reconciliation Preview
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
                                  <div className="flex items-center justify-between text-[9.5px]">
                                    <span className="text-app-text-muted font-semibold">Outstanding Debt</span>
                                    <span className={`font-black font-mono ${debt > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                      KSh {debt.toLocaleString()}
                                    </span>
                                  </div>
                                  {amt > 0 && (
                                    <>
                                      <div className="flex items-center justify-between text-[9.5px]">
                                        <span className="text-app-text-muted font-semibold">→ Applied to debt</span>
                                        <span className="font-black font-mono text-red-500">-KSh {debtApplied.toLocaleString()}</span>
                                      </div>
                                      <div className="flex items-center justify-between text-[9.5px]">
                                        <span className="text-app-text-muted font-semibold">→ Credited to wallet</span>
                                        <span className="font-black font-mono text-emerald-500">+KSh {walletApplied.toLocaleString()}</span>
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
                          className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-xl transition uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md text-xs"
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
                      </div>
                    </form>

                    {/* Payments Directory / List - Modern */}
                    <div className="lg:col-span-2 bg-app-card border border-app-border rounded-2xl p-5 shadow-sm space-y-4 flex flex-col">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-app-border/40 pb-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                            <TrendingUp size={14} className="text-emerald-500" />
                          </div>
                          <div>
                            <h3 className="text-xs font-black text-app-text uppercase tracking-wider">
                              Payment Ledger
                            </h3>
                            <p className="text-[8.5px] text-app-text-muted font-medium">
                              All received business payments
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="flex bg-app-bg/60 border border-app-border rounded-lg p-0.5">
                            {(['all', 'customer', 'walk-in'] as const).map((f) => (
                              <button
                                type="button"
                                key={f}
                                onClick={() => setPayFilter(f)}
                                className={`px-2.5 py-1 rounded-md text-[8.5px] font-black uppercase tracking-wider transition cursor-pointer ${
                                  payFilter === f
                                    ? 'bg-amber-500 text-slate-950'
                                    : 'text-app-text-muted hover:text-app-text'
                                }`}
                              >
                                {f}
                              </button>
                            ))}
                          </div>
                          <span className="text-[9px] font-mono text-app-text-muted font-black bg-app-bg border border-app-border rounded-lg px-2 py-1 whitespace-nowrap">
                            {localPayments.length} Payments
                          </span>
                        </div>
                      </div>

                      <div className="flex-1 overflow-x-auto min-h-[300px] max-h-[520px]">
                        {localPayments.length > 0 ? (
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-app-border/40 text-[8.5px] text-app-text-muted font-bold uppercase tracking-wider">
                                <th className="py-2.5">Date</th>
                                <th className="py-2.5">Payer</th>
                                <th className="py-2.5">Type</th>
                                <th className="py-2.5">Method</th>
                                <th className="py-2.5">Applied To</th>
                                <th className="py-2.5 text-right">Amount</th>
                                {isOwner && <th className="py-2.5 text-center">Actions</th>}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-app-border/20 text-xs">
                              {localPayments
                                .filter((p) => payFilter === 'all' || (p.paymentType || 'walk-in') === payFilter)
                                .map((pay) => (
                                  <tr key={pay.id} className="hover:bg-app-bg/30 transition">
                                    <td className="py-2.5 font-mono text-[10px] whitespace-nowrap">
                                      <div>{new Date(pay.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                                      <div className="text-[8px] text-app-text-muted">
                                        {new Date(pay.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                      </div>
                                    </td>
                                    <td className="py-2.5">
                                      <div className="font-bold text-app-text">{pay.senderName}</div>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        {pay.senderPhone && (
                                          <span className="text-[8.5px] text-app-text-muted font-mono">{pay.senderPhone}</span>
                                        )}
                                        <span className="text-[8.5px] font-mono text-app-text-muted bg-app-bg border border-app-border rounded px-1.5 py-0.5">
                                          {pay.referenceCode}
                                        </span>
                                      </div>
                                      {pay.description && (
                                        <div className="text-[8.5px] text-app-text-muted font-medium mt-0.5 truncate max-w-[180px]" title={pay.description}>
                                          {pay.description}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-2.5">
                                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider inline-flex items-center gap-1 ${(pay.paymentType || 'walk-in') === 'customer' ? 'bg-blue-500/10 text-blue-500' : 'bg-purple-500/10 text-purple-500'}`}>
                                        {(pay.paymentType || 'walk-in') === 'customer' ? <UserIcon size={8} /> : <Store size={8} />}
                                        {(pay.paymentType || 'walk-in') === 'customer' ? (pay.customerName || 'Customer') : 'Walk-in'}
                                      </span>
                                    </td>
                                    <td className="py-2.5">
                                      <div className="flex items-center gap-1.5">
                                        {pay.method === 'M-Pesa' ? (
                                          <Smartphone size={12} className="text-emerald-500" />
                                        ) : pay.method === 'Cash' ? (
                                          <Banknote size={12} className="text-amber-500" />
                                        ) : pay.method === 'Card' ? (
                                          <CreditCard size={12} className="text-blue-500" />
                                        ) : pay.method === 'Bank' ? (
                                          <Landmark size={12} className="text-violet-500" />
                                        ) : (
                                          <Wallet size={12} className="text-slate-500" />
                                        )}
                                        <span className="font-bold text-app-text text-[10.5px]">{pay.method}</span>
                                      </div>
                                    </td>
                                    <td className="py-2.5">
                                      {(pay.appliedTo && pay.appliedTo !== 'none') ? (
                                        <div className="flex flex-col gap-0.5">
                                          <span className={`text-[8px] font-black uppercase ${pay.appliedTo === 'debt' ? 'text-red-500' : pay.appliedTo === 'wallet' ? 'text-emerald-500' : 'text-amber-500'}`}>
                                            {pay.appliedTo === 'mixed' ? 'Mixed' : pay.appliedTo}
                                          </span>
                                          {Number(pay.debtApplied || 0) > 0 && (
                                            <span className="text-[8px] font-mono text-red-500">
                                              Debt: KSh {Number(pay.debtApplied).toLocaleString()}
                                            </span>
                                          )}
                                          {Number(pay.walletApplied || 0) > 0 && (
                                            <span className="text-[8px] font-mono text-emerald-500">
                                              Wallet: KSh {Number(pay.walletApplied).toLocaleString()}
                                            </span>
                                          )}
                                        </div>
                                      ) : (
                                        <span className="text-[8.5px] text-app-text-muted font-semibold uppercase">N/A</span>
                                      )}
                                    </td>
                                    <td className="py-2.5 text-right">
                                      <span className={`font-black font-mono ${pay.status === 'Failed' ? 'text-red-500' : 'text-emerald-500'}`}>
                                        KSh {Number(pay.amount).toLocaleString()}
                                      </span>
                                      <span className={`block text-[8px] font-bold uppercase tracking-wider mt-0.5 ${pay.status === 'Success' ? 'text-emerald-500' : pay.status === 'Pending' ? 'text-amber-500' : 'text-red-500'}`}>
                                        {pay.status}
                                      </span>
                                    </td>
                                    {isOwner && (
                                      <td className="py-2.5 text-center">
                                        <button
                                          type="button"
                                          onClick={() => handleDeletePayment(pay.id)}
                                          title="Delete payment"
                                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition cursor-pointer"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </td>
                                    )}
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center text-app-text-muted text-center py-12">
                            <CircleDollarSign size={32} className="text-slate-700 mb-2" />
                            <p className="text-[10.5px] font-bold">No Payments Recorded Yet</p>
                            <p className="text-[9.5px] max-w-xs mt-0.5">
                              Record customer or walk-in payments to track money assets and reconcile customer accounts.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Fallback No Business Selected */
            <div className="bg-app-card border border-app-border rounded-2xl p-8 text-center text-app-text-muted flex flex-col items-center justify-center min-h-[300px]">
              <Building size={48} className="text-slate-600 mb-3 " />
              <h3 className="text-sm font-extrabold uppercase font-display text-app-text">
                No Business Selected
              </h3>
              <p className="text-[10.5px] mt-1 max-w-xs leading-normal">
                Please select an active business workspace from the Directory or
                create a new branch.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
