import React, { useState, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { 
  UserPlus, Search, Phone, Mail, Award, CheckCircle2, Star, ShieldAlert, 
  X, ChevronRight, Trash2, Send, Share2, Check, ArrowLeft,
  Brain, RefreshCw,
  Coins
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useForm } from "../hooks/useForm";
import { hasRolePermission } from "../utils/permissions";
import { formatCurrency } from "../utils/helpers";
import SearchableDropdown from "../components/SearchableDropdown";
import { titleCase, searchMatch } from "../utils/stringUtils";
import { normalizePhone, validatePhone, SUPPORTED_COUNTRIES } from "../utils/phoneUtils";
import { formatCustomerNumber, formatReceiptNumber } from "../utils/idUtils";
import { SupabaseService } from "../services/supabaseService";
import { ReceiptShareService } from "../services/receipt/ReceiptShareService";

// Dynamically synthesize retro-modern digital workspace sounds using Web Audio API
const playSfx = (type: "send" | "receive" | "save") => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    if (type === "send") {
      // Light digital pop
      osc.type = "sine";
      osc.frequency.setValueAtTime(580, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === "receive") {
      // High-pitched notification chime
      osc.type = "triangle";
      osc.frequency.setValueAtTime(950, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(750, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } else if (type === "save") {
      // Warm twin success notes
      osc.type = "sine";
      osc.frequency.setValueAtTime(450, ctx.currentTime);
      osc.frequency.setValueAtTime(900, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    }
  } catch (e) {
    console.warn("Web Audio API not supported or suspended by browser policies.", e);
  }
};

export default function CustomersView() {
  const { 
    customers, addCustomer, currentEmployee, 
    updateCustomer, deleteCustomer, products,
    selectedCustomerId, setSelectedCustomerId, 
    activeInvoiceData, setActiveInvoiceData, transactions,
    showToast,activeBusinessId,
    payCustomerDebt, depositCustomerWallet, spendCustomerWallet, adjustCustomerDebt
  } = useAppStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [successBanner, setSuccessBanner] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<"overview" | "history" | "invoice" | "message" | "ledger">("overview");
  const [payMethod, setPayMethod] = useState<'Cash' | 'M-Pesa'>('Cash');
  const [adjustNote, setAdjustNote] = useState('');
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  // Country selector states
  const [selectedCountryCode, setSelectedCountryCode] = useState("+254");
  const [editCountryCode, setEditCountryCode] = useState("+254");

  // Local state for profile edits within detail panel
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTier, setEditTier] = useState<"Bronze" | "Silver" | "Gold">("Bronze");
  const [editPoints, setEditPoints] = useState(0);
  const [editDescription, setEditDescription] = useState("");

  // Local state for manual balance adjustments
  const [adjustAmt, setAdjustAmt] = useState<number>(0);

  // Local state for manual message typing
  const [messageText, setMessageText] = useState("");

  // Invoice creator local state
  const [invoiceItems, setInvoiceItems] = useState<{ productId: string; quantity: number }[]>([]);
  const [selectedInvoiceProdId, setSelectedInvoiceProdId] = useState(products[0]?.id || "");
  const [successMsg, setSuccessMsg] = useState("");

  // CRM AI Assistant local states
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    { role: 'assistant', content: "Jambo! I am Kim, your KayKay's Milk CRM Assistant. Click any prompt below or type your message to help manage customer relationships!" }
  ]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isAddingDebt, setIsAddingDebt] = useState(false);
  const [isPayingDebt, setIsPayingDebt] = useState(false);
  const [isDepositingWallet, setIsDepositingWallet] = useState(false);
  const [isSpendingWallet, setIsSpendingWallet] = useState(false);
  const [isDeletingCustomer, setIsDeletingCustomer] = useState(false);

  useEffect(() => {
    if (activeDetailTab === "ledger" && selectedCustomerId) {
      setLoadingLedger(true);
      SupabaseService.fetchCustomerLedger(selectedCustomerId)
        .then(entries => {
          setLedgerEntries(entries);
        })
        .catch(err => {
          showToast("Error", `Failed to load ledger: ${err.message}`, undefined, "error");
        })
        .finally(() => {
          setLoadingLedger(false);
        });
    }
  }, [activeDetailTab, selectedCustomerId]);

  // Centralized permission validations
  const canViewCustomers = currentEmployee ? hasRolePermission(currentEmployee.role, "customers.view") : false;
  const canCreateCustomers = currentEmployee ? hasRolePermission(currentEmployee.role, "customers.create") : false;
  const canDeleteCustomers = currentEmployee ? hasRolePermission(currentEmployee.role, "customers.delete") : false;

  // New Customer Form handling using custom useForm hook
  const {
    values,
    errors,
    handleChange,
    handleSubmit,
    resetForm,
    isSubmitting
  } = useForm({
    initialValues: {
      name: "",
      phone: "",
      email: "",
      tier: "Bronze" as "Bronze" | "Silver" | "Gold",
      startingPoints: 10,
      description: "",
    },
    validate: (vals) => {
      const errs: Record<string, string> = {};
      if (!vals.name.trim()) errs.name = "Customer name is required.";
      if (!vals.phone.trim()) {
        errs.phone = "Phone number is required.";
      } else {
        const fullPhone = normalizePhone(vals.phone, selectedCountryCode);
        if (!validatePhone(fullPhone)) {
          errs.phone = "Phone must be valid. Check country prefix and length.";
        }
      }
      return errs;
    },
    onSubmit: async (vals) => {
      try {
        await addCustomer({
          name: vals.name,
          phone: normalizePhone(vals.phone, selectedCountryCode),
          email: vals.email || "no-email@kaykaysmilk.com",
          loyaltyPoints: vals.startingPoints,
          tier: vals.tier,
          description: vals.description,
        });
        setIsAdding(false);
        setSuccessBanner(true);
        setTimeout(() => setSuccessBanner(false), 2000);
        showToast("Customer Added", `"${vals.name}" successfully created.`, undefined, "success");
      } catch (err: any) {
        showToast("Database Error", `Failed to add customer: ${err.message}`, undefined, "error");
      }
    },
  });

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  useEffect(() => {
    if (selectedCustomer) {
      setEditName(selectedCustomer.name);
      setEditEmail(selectedCustomer.email);
      setEditTier(selectedCustomer.tier);
      setEditPoints(selectedCustomer.loyaltyPoints);
      setEditDescription(selectedCustomer.description || "");
      setAdjustAmt(0);
      setMessageText("");
      setSuccessMsg("");

      // Attempt to auto-detect country code from the customer's phone number
      const matchedCountry = SUPPORTED_COUNTRIES.find(c => selectedCustomer.phone.startsWith(c.code));
      if (matchedCountry) {
        setEditCountryCode(matchedCountry.code);
        setEditPhone(selectedCustomer.phone.slice(matchedCountry.code.length));
      } else {
        setEditCountryCode("+254");
        setEditPhone(selectedCustomer.phone);
      }
      
      if (activeInvoiceData && activeInvoiceData.customerId === selectedCustomer.id) {
        setInvoiceItems(activeInvoiceData.items || []);
        setActiveDetailTab("invoice");
      } else {
        setInvoiceItems([]);
        setActiveDetailTab("overview");
      }
    }
  }, [selectedCustomerId, selectedCustomer, activeInvoiceData]);

  // Sync default invoice product selection
  useEffect(() => {
    if (products.length > 0 && !selectedInvoiceProdId) {
      setSelectedInvoiceProdId(products[0].id);
    }
  }, [products, selectedInvoiceProdId]);

  const filteredCustomers = customers.filter(c =>
    searchMatch(c.name, searchQuery) || 
    searchMatch(c.phone, searchQuery) ||
    searchMatch(c.email, searchQuery) ||
    searchMatch(c.tier, searchQuery)
  );

  // Generate automated debt breakdown text for WhatsApp
  const getDebtBreakdownMessage = (cust: typeof selectedCustomer) => {
    if (!cust) return "";
    const debtTx = transactions.filter(t => t.customerId === cust.id && t.paymentMethod === 'Credit_Debt');
    
    let itemSummary = "";
    let totalTax = 0;
    let totalDelivery = 0;
    const itemMap = new Map<string, { name: string; qty: number; price: number }>();

    debtTx.forEach(tx => {
      tx.items.forEach(item => {
        const key = item.product.id;
        const current = itemMap.get(key) || { name: item.product.name, qty: 0, price: item.product.price };
        current.qty += item.quantity;
        itemMap.set(key, current);
      });
      totalTax += tx.tax || 0;
      if (tx.isDelivery && tx.deliveryFee) {
        totalDelivery += tx.deliveryFee;
      }
    });

    itemMap.forEach((val) => {
      itemSummary += `• ${val.name} x ${val.qty} (KSh ${(val.price * val.qty).toFixed(0)})\n`;
    });

    let msg = `Hi *${cust.name}*,\n\n`;
    msg += `This is a friendly statement regarding your outstanding balance of *KSh ${(cust.debtBalance || 0).toFixed(0)}* at KayKay's Milk.\n\n`;
    if (itemSummary) {
      msg += `*Included Products:*\n${itemSummary}\n`;
    }
    if (totalDelivery > 0) {
      msg += `*Delivery Fees:* KSh ${totalDelivery.toFixed(0)}\n`;
    }
    if (totalTax > 0) {
      msg += `*Sales Tax (16% VAT):* KSh ${totalTax.toFixed(0)}\n`;
    }
    msg += `\nPlease settle this balance at your earliest convenience. You can pay via M-Pesa or cash. Thank you for your continued support!`;
    return msg;
  };

  const handleSendAiMessage = async (textToSend?: string) => {
    const text = textToSend || aiInput;
    if (!text.trim()) return;

    playSfx("send");

    const newMessages = [...aiMessages, { role: "user" as const, content: text }];
    setAiMessages(newMessages);
    setAiInput("");
    setAiLoading(true);

    try {
      // ✅ FIX: SupabaseService.callEdgeFunction returns the data directly.
      // Do NOT call .json() on it.
      const data = await SupabaseService.callEdgeFunction('chat', {
          messages: newMessages,
          activeRole: currentEmployee?.role,
          permissions: currentEmployee ? [currentEmployee.role] : [],
          employeeName: currentEmployee?.name,
          businessId: activeBusinessId,
      });

      console.log('CRM response data', data);

      // ✅ FIX: Access the properties directly from 'data'
      if (data && data.success) {
        setAiMessages([...newMessages, { role: "assistant" as const, content: data.reply }]);
        playSfx("receive");
      } else {
        setAiMessages([...newMessages, { role: "assistant" as const, content: "Error: " + (data?.error || "Failed to contact CRM intelligence.") }]);
        playSfx("receive");
      }
    } catch (err: any) {
      console.error("AI Error:", err);
      setAiMessages([...newMessages, { role: "assistant" as const, content: "Offline / Timeout: Make sure your development server is active." }]);
      playSfx("receive");
    } finally {
      setAiLoading(false);
    }
  };

  if (!canViewCustomers) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-app-bg text-center font-sans">
        <div className="p-4 bg-red-500/10 rounded-2xl border border-red-500/20 text-red-500 max-w-sm flex flex-col items-center gap-2.5 shadow">
          <ShieldAlert size={36} />
          <div>
            <h4 className="font-extrabold text-sm uppercase tracking-wider">Access Restrained</h4>
            <p className="text-[11px] text-app-text-muted mt-1 leading-relaxed">
              Your operator account role (<strong>{currentEmployee?.role || "Guest"}</strong>) does not hold the necessary clearances to access the customer loyalty database.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full bg-app-bg text-app-text relative overflow-y-auto lg:overflow-hidden font-sans">
      
      {/* LEFT PANEL: CLUB MEMBERS LIST (Hidden on mobile when a member is selected to allow full view) */}
      <div className={`w-full lg:w-[380px] shrink-0 flex flex-col border-r border-app-border h-full bg-app-card transition-all ${selectedCustomerId ? "hidden lg:flex" : "flex"}`}>
        
        {/* Header Title with Enrollment button */}
        <div className="border-b border-app-border p-4 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-extrabold font-display text-app-text uppercase tracking-wider">Loyalty Club</h2>
            <span className="text-[10px] text-app-text-muted font-medium">Customer Profiles & Tier Perks</span>
          </div>
          {canCreateCustomers && (
            <button
              onClick={() => {
                resetForm();
                setIsAdding(true);
              }}
              className="px-3 py-1.5 bg-amber-500 text-slate-950 font-black rounded-xl text-[10.5px] uppercase tracking-wider flex items-center gap-1 hover:bg-amber-600 transition cursor-pointer shadow-sm"
            >
              <UserPlus size={11} />
              <span>Enroll</span>
            </button>
          )}
        </div>

        {/* Search list inputs */}
        <div className="border-b border-app-border p-3 shrink-0 bg-app-bg/15">
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-app-text-muted" />
            <input
              type="text"
              placeholder="Search loyalty club..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-app-bg text-xs pl-9 pr-4 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-app-text transition"
            />
          </div>
        </div>

        {/* Member list scroll container */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 pb-24">
          {filteredCustomers.length === 0 ? (
            <div className="p-8 text-center text-xs text-app-text-muted font-medium">
              No loyalty profiles found. Create a new member above!
            </div>
          ) : (
            filteredCustomers.map((c) => {
              const isGold = c.tier === "Gold";
              const isSilver = c.tier === "Silver";
              const isSelected = selectedCustomerId === c.id;

              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedCustomerId(c.id)}
                  className={`rounded-2xl border p-3.5 flex items-center justify-between gap-3 shadow-xs cursor-pointer transition-all ${
                    isSelected
                      ? "bg-amber-500/10 border-amber-500 ring-1 ring-amber-500/30"
                      : "bg-app-bg border-app-border hover:border-amber-500/20 hover:bg-app-bg"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xs font-extrabold font-display text-app-text truncate">{titleCase(c.name)}</h3>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase flex items-center gap-0.5 ${
                        isGold 
                          ? "bg-amber-500/15 text-amber-500 border border-amber-500/20"
                          : isSilver 
                          ? "bg-slate-500/15 text-slate-500 border border-slate-500/20"
                          : "bg-orange-500/15 text-orange-600 border border-orange-500/20"
                      }`}>
                        <Award size={8} />
                        <span>{c.tier}</span>
                      </span>
                      <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0 ${
                        (c as any).sync_status === "synced" 
                          ? "bg-emerald-500/15 text-emerald-500" 
                          : "bg-amber-500/15 text-amber-500 "
                      }`}>
                        <span className="w-1 h-1 rounded-full bg-current" />
                        <span>{(c as any).sync_status === "synced" ? "Synced" : "Offline"}</span>
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 mt-2 text-[9.5px] text-app-text-muted font-bold">
                      <div className="flex items-center gap-1">
                        <Phone size={10} className="opacity-70 shrink-0" />
                        <span>{c.phone}</span>
                      </div>
                      <div className="flex gap-2.5 text-[9px] font-mono mt-0.5 border-t border-app-border/40 pt-1">
                        {c.debtBalance !== undefined && c.debtBalance > 0 ? (
                          <span className="text-red-500 font-extrabold uppercase">Debt: KSh {c.debtBalance.toFixed(0)}</span>
                        ) : (
                          <span className="text-app-text-muted uppercase">No Debt</span>
                        )}
                        <span>Points: {c.loyaltyPoints}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={13} className={isSelected ? "text-amber-500" : "text-app-text-muted"} />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT PANEL: FULL CLIENT ACCOUNT WORKSPACE (Desktop Side-by-Side, Mobile overlay slide-in) */}
      <div className={`flex-1 flex flex-col h-full overflow-y-auto lg:overflow-hidden bg-app-bg ${!selectedCustomerId ? "hidden lg:flex" : "flex"}`}>
        {selectedCustomer ? (
          <div className="flex-1 flex flex-col h-full overflow-y-auto lg:overflow-hidden p-4 md:p-6">
            
            {/* Mobile Back navigation trigger */}
            <button
              onClick={() => setSelectedCustomerId(null)}
              className="lg:hidden flex items-center gap-1.5 text-[10.5px] text-amber-500 font-black uppercase tracking-wider px-3.5 py-2 bg-app-card border border-app-border rounded-xl mb-4 self-start shadow-xs transition"
            >
              <ArrowLeft size={12} />
              <span>Back to Club Members</span>
            </button>

            {/* Profile Overview Card */}
            <div className="bg-app-card border border-app-border rounded-3xl p-4 md:p-5 shadow-xs shrink-0 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-sm md:text-base font-extrabold font-display text-app-text uppercase tracking-wide">
                      {titleCase(selectedCustomer.name)}
                    </h2>
                    <span className={`px-2 py-0.5 rounded text-[8.5px] font-black uppercase flex items-center gap-0.5 ${
                      selectedCustomer.tier === "Gold" 
                        ? "bg-amber-500/15 text-amber-500 border border-amber-500/20"
                        : selectedCustomer.tier === "Silver" 
                        ? "bg-slate-500/15 text-slate-500 border border-slate-500/20"
                        : "bg-orange-500/15 text-orange-600 border border-orange-500/20"
                    }`}>
                      <Award size={9} />
                      <span>{selectedCustomer.tier} MEMBER</span>
                    </span>
                  </div>
                  <p className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider mt-0.5">
                    Account Reference: {formatCustomerNumber(selectedCustomer.id)} · Enrolled on {selectedCustomer.joinDate || "July 2026"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedCustomerId(null)}
                    className="hidden lg:flex p-2 hover:bg-app-bg border border-app-border rounded-xl text-app-text-muted hover:text-app-text transition cursor-pointer"
                    title="Close workspace"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Balances Dashboard Grid */}
              <div className="grid grid-cols-3 gap-2 md:gap-3 bg-app-bg p-3 rounded-2xl border border-app-border/80 mt-4">
                <div className="flex flex-col items-center justify-center p-1 text-center">
                  <span className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider">Loyalty Stars</span>
                  <span className="text-xs md:text-sm font-black text-amber-500 flex items-center gap-0.5 mt-1 font-mono">
                    <Star size={12} className="fill-amber-500" />
                    {selectedCustomer.loyaltyPoints}
                  </span>
                </div>
                <div className="flex flex-col items-center justify-center p-1 text-center border-x border-app-border/50">
                  <span className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider">Outstanding Debt</span>
                  <span className={`text-xs md:text-sm font-black mt-1 font-mono ${selectedCustomer.debtBalance && selectedCustomer.debtBalance > 0 ? "text-red-500 " : "text-app-text-muted"}`}>
                    {formatCurrency(selectedCustomer.debtBalance || 0)}
                  </span>
                </div>
                <div className="flex flex-col items-center justify-center p-1 text-center">
                  <span className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider">Wallet Balance</span>
                  <span className={`text-xs md:text-sm font-black mt-1 font-mono ${selectedCustomer.walletBalance && selectedCustomer.walletBalance > 0 ? "text-emerald-500" : "text-app-text-muted"}`}>
                    {formatCurrency(selectedCustomer.walletBalance || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Tabbed workspace panels */}
            <div className="bg-app-card border border-app-border rounded-3xl p-4 flex-1 flex flex-col overflow-y-auto lg:overflow-hidden shadow-xs">
              
              {/* Navigation Tabs Bar */}
              <div className="flex gap-1 border-b border-app-border pb-2.5 mb-3.5 shrink-0 overflow-x-auto scrollbar-none select-none">
                {[
                  { id: "overview", label: "Overview & Profile" },
                  { id: "ledger", label: "Wallet & Debt Ledger" },
                  { id: "history", label: "Invoice Logs" },
                  { id: "message", label: "Outreach & Messages" },
                  { id: "invoice", label: "Custom Invoice" },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setActiveDetailTab(t.id as any);
                      setSuccessMsg("");
                    }}
                    className={`px-3.5 py-2 rounded-xl text-[10.5px] font-extrabold uppercase tracking-wide shrink-0 transition border cursor-pointer ${
                      activeDetailTab === t.id 
                        ? "bg-amber-500/10 text-amber-500 border-amber-500/25" 
                        : "bg-app-bg border-transparent text-app-text-muted hover:text-app-text hover:bg-app-bg"
                    }`}
                  >
                    {t.id === "invoice" && activeInvoiceData && activeInvoiceData.customerId === selectedCustomer.id && (
                      <span className="inline-block w-1.5 h-1.5 bg-red-500 rounded-full animate-ping mr-1.5" />
                    )}
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Scrollable Viewport */}
              <div className="flex-1 overflow-y-auto pb-12 font-semibold">
                
                {/* 1. OVERVIEW & PROFILE TAB */}
                {activeDetailTab === "overview" && (
                  <div className="flex flex-col gap-4 text-xs">
                    
                    {/* Basic Info editing */}
                    <div className="flex flex-col gap-3 bg-app-bg p-4 border border-app-border rounded-2xl">
                      <h4 className="text-[10.5px] font-extrabold text-app-text uppercase tracking-wider border-b border-app-border/40 pb-1.5 mb-1.5">
                        Club Record Details
                      </h4>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase">Full Name</label>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="bg-app-card border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500 font-bold"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase">Phone Number</label>
                          <div className="grid  grid-cols-4 gap-1.5">
                            <SearchableDropdown
                              items={SUPPORTED_COUNTRIES.map((country) => ({ id: country.code, label: `${country.flag} ${country.code}` }))}
                              selectedValue={editCountryCode}
                              onChange={(val) => setEditCountryCode(val)}
                              placeholder="Code"
                              className="w-28 shrink-0 col-span-1 "
                            />
                            <input
                              type="text"
                              value={editPhone}
                              onChange={(e) => setEditPhone(e.target.value)}
                              className="flex-1 col-span-3 bg-app-card border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500 font-mono font-bold"
                            />
                          </div>
                          <span className="text-[8.5px] text-app-text-muted">Stored E.164: {normalizePhone(editPhone, editCountryCode)}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase">Loyalty Points Balance</label>
                          <input
                            type="number"
                            value={editPoints}
                            onChange={(e) => setEditPoints(parseInt(e.target.value) || 0)}
                            className="bg-app-card border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500 font-mono font-black"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase">Customer Loyalty Tier</label>
                          <SearchableDropdown
                            items={[
                              { id: "Bronze", label: "Bronze Tier Club" },
                              { id: "Silver", label: "Silver Tier Club" },
                              { id: "Gold", label: "Gold Tier Club" }
                            ]}
                            selectedValue={editTier}
                            onChange={(val) => setEditTier(val as any)}
                            placeholder="Select badge..."
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-app-text-muted uppercase">worker Address (Secured)</label>
                        <input
                          type="email"
                          disabled
                          value={editEmail}
                          className="bg-app-card/50 border border-app-border/40 opacity-70 rounded-xl px-3 py-2 text-xs text-app-text cursor-not-allowed font-medium"
                          title="Emails are secured for fraud prevention."
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-app-text-muted uppercase">Customer Description / Notes</label>
                        <textarea
                          rows={3}
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          className="bg-app-card border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500 font-sans font-medium"
                          placeholder="Add customer descriptions or notes..."
                        />
                      </div>

                      <button
                        type="button"
                        disabled={isSavingProfile}
                        onClick={async () => {
                          if (!editName.trim()) {
                            showToast("Input Validation", "Customer name cannot be empty.", undefined, "error");
                            return;
                          }
                          const fullPhone = normalizePhone(editPhone, editCountryCode);
                          if (!validatePhone(fullPhone)) {
                            showToast("Input Validation", "Invalid phone number or length for the selected country.", undefined, "error");
                            return;
                          }
                          setIsSavingProfile(true);
                          try {
                            await updateCustomer({
                              ...selectedCustomer,
                              name: editName,
                              phone: fullPhone,
                              tier: editTier,
                              loyaltyPoints: editPoints,
                              description: editDescription,
                            });
                            playSfx("save");
                            setSuccessMsg("Customer record updated successfully!");
                            setTimeout(() => setSuccessMsg(""), 3000);
                            showToast("Profile Updated", `Customer "${editName}" successfully updated in database.`, undefined, "success");
                          } catch (err: any) {
                            showToast("Database Error", `Failed to update customer: ${err.message}`, undefined, "error");
                          } finally {
                            setIsSavingProfile(false);
                          }
                        }}
                        className="w-full mt-2.5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        {isSavingProfile ? (
                          <>
                            <RefreshCw size={13} className="animate-spin" />
                            <span>Saving Changes...</span>
                          </>
                        ) : (
                          "Apply Profile Changes"
                        )}
                      </button>
                    </div>

                    {/* Balance adjustments (Credits, Debts) */}
                    <div className="flex flex-col gap-3 bg-app-bg p-4 border border-app-border rounded-2xl">
                      <div className="flex items-center justify-between border-b border-app-border/40 pb-1.5 mb-1">
                        <h4 className="text-[10.5px] font-extrabold text-app-text uppercase tracking-wider">
                          Durable Balance Adjustment Ledger
                        </h4>
                        <span className="text-[8px] bg-red-500/15 text-red-500 border border-red-500/25 px-1.5 py-0.5 rounded font-black tracking-widest uppercase">
                          Manager Approval Required
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[9px] font-black text-app-text-muted uppercase">Adjustment Value (KSh)</label>
                          <input
                            type="number"
                            placeholder="0.00"
                            value={adjustAmt === 0 ? "" : adjustAmt}
                            onChange={(e) => setAdjustAmt(parseFloat(e.target.value) || 0)}
                            className="bg-app-card border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500 font-bold font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[9px] font-black text-app-text-muted uppercase">Note / Reference (Optional)</label>
                          <input
                            type="text"
                            placeholder="Reference or note..."
                            value={adjustNote}
                            onChange={(e) => setAdjustNote(e.target.value)}
                            className="bg-app-card border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500 font-bold"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-3">
                        {/* Debt Operations */}
                        <div className="flex flex-col gap-1.5 p-2 bg-red-500/5 rounded-xl border border-red-500/10">
                          <span className="text-[8px] font-black text-red-400 uppercase tracking-wider block text-center mb-1">Debt Adjuster</span>
                          
                          <div className="flex flex-col gap-1.5 mb-2 mt-1">
                            <label className="text-[8px] font-black text-app-text-muted uppercase">Pay Method (For Pay Off)</label>
                            <div className="grid grid-cols-2 gap-2">
                              {['Cash', 'M-Pesa'].map(m => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setPayMethod(m as any)}
                                  className={`py-1 rounded-lg text-[9px] font-black uppercase transition cursor-pointer border ${
                                    payMethod === m 
                                      ? 'bg-amber-500/10 border-amber-500 text-amber-500' 
                                      : 'bg-app-card border-app-border text-app-text-muted'
                                  }`}
                                >
                                  {m}
                                </button>
                              ))}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={adjustAmt <= 0 || isAddingDebt}
                            onClick={async () => {
                              setIsAddingDebt(true);
                              try {
                                const cashierName = currentEmployee?.name || "System";
                                const actionId = `debt-${Date.now()}`;
                                await adjustCustomerDebt(
                                  selectedCustomer.id,
                                  adjustAmt,
                                  'add',
                                  cashierName,
                                  adjustNote,
                                  actionId
                                );
                                playSfx("save");
                                setAdjustAmt(0);
                                setAdjustNote("");
                                setSuccessMsg("Debt balance added successfully!");
                                setTimeout(() => setSuccessMsg(""), 3000);
                                showToast("Debt Added", `KSh ${adjustAmt} debt added to "${selectedCustomer.name}".`, undefined, "success");
                              } catch (err: any) {
                                showToast("Database Error", `Failed to adjust debt: ${err.message}`, undefined, "error");
                              } finally {
                                setIsAddingDebt(false);
                              }
                            }}
                            className="py-2 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-red-500 border border-red-500/20 rounded-lg text-[9.5px] font-black uppercase transition cursor-pointer flex items-center justify-center gap-1"
                          >
                            {isAddingDebt ? "Adding..." : "Add New Debt (+)"}
                          </button>
                          
                          <button
                            type="button"
                            disabled={adjustAmt <= 0 || !(selectedCustomer.debtBalance && selectedCustomer.debtBalance > 0) || isPayingDebt}
                            onClick={async () => {
                              setIsPayingDebt(true);
                              try {
                                const cashierName = currentEmployee?.name || "System";
                                const actionId = `pay-${Date.now()}`;
                                await payCustomerDebt(
                                  selectedCustomer.id,
                                  adjustAmt,
                                  payMethod,
                                  cashierName,
                                  adjustNote,
                                  actionId
                                );
                                playSfx("save");
                                setAdjustAmt(0);
                                setAdjustNote("");
                                setSuccessMsg("Paid off debt successfully!");
                                setTimeout(() => setSuccessMsg(""), 3000);
                                showToast("Debt Paid Off", `KSh ${adjustAmt} paid off via ${payMethod} for "${selectedCustomer.name}".`, undefined, "success");
                              } catch (err: any) {
                                showToast("Database Error", `Failed to adjust debt: ${err.message}`, undefined, "error");
                              } finally {
                                setIsPayingDebt(false);
                              }
                            }}
                            className="py-2 bg-red-500 text-white hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-[9.5px] font-black uppercase transition cursor-pointer shadow-sm flex items-center justify-center gap-1"
                          >
                            {isPayingDebt ? "Paying..." : "Pay Off Debt (-)"}
                          </button>
                        </div>
 
                        {/* Wallet Operations */}
                        <div className="flex flex-col gap-1.5 p-2 bg-emerald-500/5 rounded-xl border border-emerald-500/10">
                          <span className="text-[8px] font-black text-emerald-400 uppercase tracking-wider block text-center mb-1">Digital Wallet Adjuster</span>
                          
                          <button
                            type="button"
                            disabled={adjustAmt <= 0 || isDepositingWallet}
                            onClick={async () => {
                              setIsDepositingWallet(true);
                              try {
                                const cashierName = currentEmployee?.name || "System";
                                const actionId = `dep-${Date.now()}`;
                                await depositCustomerWallet(
                                  selectedCustomer.id,
                                  adjustAmt,
                                  cashierName,
                                  adjustNote,
                                  actionId
                                );
                                playSfx("save");
                                setAdjustAmt(0);
                                setAdjustNote("");
                                setSuccessMsg("Wallet credits deposited!");
                                setTimeout(() => setSuccessMsg(""), 3000);
                                showToast("Wallet Credit Deposited", `KSh ${adjustAmt} credited to "${selectedCustomer.name}".`, undefined, "success");
                              } catch (err: any) {
                                showToast("Database Error", `Failed to adjust wallet: ${err.message}`, undefined, "error");
                              } finally {
                                setIsDepositingWallet(false);
                              }
                            }}
                            className="py-2 bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-[9.5px] font-black uppercase transition cursor-pointer shadow-sm flex items-center justify-center gap-1"
                          >
                            {isDepositingWallet ? "Depositing..." : "Deposit Credit (+)"}
                          </button>
                          
                          <button
                            type="button"
                            disabled={adjustAmt <= 0 || !(selectedCustomer.walletBalance && selectedCustomer.walletBalance >= adjustAmt) || isSpendingWallet}
                            onClick={async () => {
                              setIsSpendingWallet(true);
                              try {
                                const cashierName = currentEmployee?.name || "System";
                                const actionId = `spend-${Date.now()}`;
                                await spendCustomerWallet(
                                  selectedCustomer.id,
                                  adjustAmt,
                                  cashierName,
                                  adjustNote,
                                  actionId
                                );
                                playSfx("save");
                                setAdjustAmt(0);
                                setAdjustNote("");
                                setSuccessMsg("Credits deducted from wallet!");
                                setTimeout(() => setSuccessMsg(""), 3000);
                                showToast("Wallet Credit Spent", `KSh ${adjustAmt} spent from "${selectedCustomer.name}".`, undefined, "success");
                              } catch (err: any) {
                                showToast("Database Error", `Failed to adjust wallet: ${err.message}`, undefined, "error");
                              } finally {
                                setIsSpendingWallet(false);
                              }
                            }}
                            className="py-2 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-emerald-500 border border-emerald-500/20 rounded-lg text-[9.5px] font-black uppercase transition cursor-pointer flex items-center justify-center gap-1"
                          >
                            {isSpendingWallet ? "Spending..." : "Spend Credit (-)"}
                          </button>
                        </div>
                      </div>
                    </div>
 
                    {/* Dangerous Action: Delete Profile */}
                    {canDeleteCustomers && (
                      <div className="bg-red-500/5 p-4 border border-red-500/15 rounded-2xl flex flex-col gap-2 mt-2">
                        <div>
                          <h4 className="text-[10px] font-extrabold text-red-500 uppercase tracking-wider font-display">Danger Zone</h4>
                          <p className="text-[9px] text-app-text-muted mt-0.5 font-bold">Delete this customer loyalty account permanently. All accumulated perks, wallet credits, and history will be lost.</p>
                        </div>
                        <button
                          type="button"
                          disabled={isDeletingCustomer}
                          onClick={async () => {
                            if (confirm(`Are you absolutely sure you want to delete the profile of "${selectedCustomer.name}"? This action is permanent!`)) {
                              setIsDeletingCustomer(true);
                              try {
                                await deleteCustomer(selectedCustomer.id);
                                setSelectedCustomerId(null);
                                showToast("Customer Deleted", `"${selectedCustomer.name}" successfully deleted from database.`, undefined, "success");
                              } catch (err: any) {
                                showToast("Database Error", `Failed to delete customer: ${err.message}`, undefined, "error");
                              } finally {
                                setIsDeletingCustomer(false);
                              }
                            }
                          }}
                          className="w-full py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-1 transition cursor-pointer"
                        >
                          {isDeletingCustomer ? (
                            <>
                              <RefreshCw size={13} className="animate-spin" />
                              <span>Deleting Profile...</span>
                            </>
                          ) : (
                            <>
                              <Trash2 size={13} />
                              <span>Delete Loyalty Profile</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 5. CUSTOMER LEDGER TAB */}
                {activeDetailTab === "ledger" && (
                  <div className="flex flex-col gap-2.5 text-xs">
                    <div className="flex items-center justify-between border-b border-app-border/40 pb-1.5 mb-1">
                      <h4 className="text-[10px] font-extrabold text-app-text-muted uppercase tracking-wider">
                        Wallet & Outstanding Debt Ledger
                      </h4>
                      <button
                        onClick={async () => {
                          setLoadingLedger(true);
                          try {
                            const entries = await SupabaseService.fetchCustomerLedger(selectedCustomer.id);
                            setLedgerEntries(entries);
                          } finally {
                            setLoadingLedger(false);
                          }
                        }}
                        className="text-[9px] font-black text-amber-500 hover:underline uppercase transition cursor-pointer"
                      >
                        Refresh History
                      </button>
                    </div>

                    {loadingLedger ? (
                      <div className="py-8 text-center text-xs text-app-text-muted font-bold flex items-center justify-center gap-2">
                        <RefreshCw size={12} className="animate-spin text-amber-500" />
                        <span>Loading ledger history...</span>
                      </div>
                    ) : ledgerEntries.length === 0 ? (
                      <div className="p-8 text-center text-xs text-app-text-muted bg-app-bg border border-app-border rounded-2xl font-bold">
                        No ledger transactions recorded yet for this customer.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 max-h-[350px] overflow-y-auto pr-1">
                        {ledgerEntries.map((entry) => {
                          let typeLabel = entry.type;
                          let typeColor = "text-app-text";
                          let amountSign = "";

                          switch (entry.type) {
                            case "wallet_topup":
                              typeLabel = "Wallet Top-up";
                              typeColor = "text-emerald-500";
                              amountSign = "+";
                              break;
                            case "wallet_usage":
                              typeLabel = "Wallet Spending";
                              typeColor = "text-amber-500";
                              amountSign = "-";
                              break;
                            case "debt_creation":
                              typeLabel = "Debt Incurred";
                              typeColor = "text-red-500";
                              amountSign = "+";
                              break;
                            case "debt_payment":
                              typeLabel = "Debt Payment";
                              typeColor = "text-emerald-500";
                              amountSign = "-";
                              break;
                            case "debt_adjustment":
                              typeLabel = "Debt Adjustment";
                              typeColor = "text-blue-500";
                              break;
                            case "refund":
                              typeLabel = "Refund";
                              typeColor = "text-purple-500";
                              amountSign = "+";
                              break;
                          }

                          return (
                            <div key={entry.id} className="bg-app-bg p-3 border border-app-border rounded-2xl flex flex-col gap-1 shadow-xs">
                              <div className="flex justify-between items-center text-[10.5px]">
                                <span className={`font-black ${typeColor}`}>{typeLabel}</span>
                                <span className="text-app-text-muted text-[9px] font-bold">
                                  {entry.created_at ? new Date(entry.created_at).toLocaleString() : ""}
                                </span>
                              </div>

                              <div className="flex justify-between items-center font-bold text-xs mt-1">
                                <span className="text-app-text-muted">Amount:</span>
                                <span className={`font-mono font-black ${typeColor}`}>
                                  {amountSign}KSh {entry.amount.toLocaleString()}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-2 text-[10px] text-app-text-muted border-t border-app-border/40 pt-1.5 mt-1 font-bold">
                                <div>Wallet: KSh {entry.walletBalance.toLocaleString()}</div>
                                <div className="text-right">Debt: KSh {entry.debtBalance.toLocaleString()}</div>
                              </div>

                              {entry.note && (
                                <div className="text-[10px] text-app-text-muted bg-app-card border border-app-border/40 p-1.5 rounded-lg mt-1 font-medium italic">
                                  Note: {entry.note}
                                </div>
                              )}
                              {entry.recordedBy && (
                                <div className="text-[8px] text-app-text-muted text-right font-bold mt-0.5">
                                  Recorded By: {entry.recordedBy}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. PURCHASE HISTORY TAB */}
                {activeDetailTab === "history" && (
                  <div className="flex flex-col gap-2.5 text-xs">
                    <h4 className="text-[10px] font-extrabold text-app-text-muted uppercase tracking-wider border-b border-app-border/40 pb-1.5 mb-1">
                      Shop Utilization Transaction Logs
                    </h4>
                    
                    {transactions.filter(t => t.customerId === selectedCustomer.id).length === 0 ? (
                      <div className="p-8 text-center text-xs text-app-text-muted bg-app-bg border border-app-border rounded-2xl font-bold">
                        No transactions recorded yet for this customer in this session.
                      </div>
                    ) : (
                      transactions.filter(t => t.customerId === selectedCustomer.id).map((tx) => (
                        <div key={tx.id} className="bg-app-bg p-4 border border-app-border rounded-2xl flex flex-col gap-2 shadow-xs">
                          <div className="flex justify-between items-center text-[10.5px]">
                            <span className="font-mono text-app-text-muted font-bold">RECEIPT NO: {formatReceiptNumber(tx.id)}</span>
                            <span className="text-app-text-muted font-bold">{new Date(tx.timestamp).toLocaleString()}</span>
                          </div>
                          
                          <div className="flex flex-col gap-1 my-1">
                            {tx.items.map((item, index) => (
                              <div key={index} className="flex justify-between items-center text-[11px] font-bold">
                                <span className="text-app-text font-medium">{item.product?.name || "Product"} <span className="text-app-text-muted text-[10px]">x{item.quantity}</span></span>
                                <span className="font-mono">{formatCurrency((item.product?.price || 0) * item.quantity)}</span>
                              </div>
                            ))}
                          </div>
                          
                          <div className="h-[1px] bg-app-border/50 my-1" />
                          
                          {tx.isDelivery && (
                            <div className="flex justify-between items-center text-[10px] text-blue-500 font-extrabold uppercase mb-1">
                              <span>Delivery Fee (Rider: {tx.riderName || "Not assigned"})</span>
                              <span>{formatCurrency(tx.deliveryFee || 0)}</span>
                            </div>
                          )}

                          <div className="flex justify-between items-center font-extrabold text-[11px] pt-1">
                            <span className="text-app-text-muted uppercase text-[9px]">Total ({tx.paymentMethod})</span>
                            <span className="text-amber-500 font-black font-mono text-xs">{formatCurrency(tx.finalTotal)}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* 3. SEND MESSAGE TAB */}
                {activeDetailTab === "message" && (
                  <div className="flex flex-col gap-4 text-xs">
                    <div className="bg-app-bg p-4 border border-app-border rounded-2xl flex flex-col gap-3.5">
                      <h4 className="text-[10.5px] font-extrabold text-app-text uppercase tracking-wider border-b border-app-border/40 pb-1.5 mb-1">
                        Outreach Communications Center
                      </h4>
                      
                      {/* Debt breakdown automated card if has debt */}
                      {selectedCustomer.debtBalance !== undefined && selectedCustomer.debtBalance > 0 && (
                        <div className="bg-red-500/5 border border-red-500/15 p-3.5 rounded-2xl flex flex-col gap-2 animate-fade-in">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-red-500 font-extrabold uppercase text-[10px] tracking-wider">
                              <Brain size={13} className="text-red-500" />
                              <span>Outstanding Debt Breakdown Generator</span>
                            </div>
                            <span className="text-[8px] bg-red-500/15 text-red-500 px-1.5 py-0.5 rounded font-black uppercase">
                              Statement Ready
                            </span>
                          </div>
                          <p className="text-[9.5px] text-app-text-muted leading-relaxed font-bold">
                            Generate and load a detailed billing breakdown including all unpaid items, quantities, taxes, and delivery fees for this client.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              const debtMsg = getDebtBreakdownMessage(selectedCustomer);
                              setMessageText(debtMsg);
                              setSuccessMsg("Loaded detailed debt statement breakdown!");
                              setTimeout(() => setSuccessMsg(""), 3000);
                            }}
                            className="self-start px-3.5 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-[9.5px] font-black uppercase transition cursor-pointer flex items-center gap-1 shadow-sm"
                          >
                            <Coins size={11} />
                            <span>Load Debt Statement</span>
                          </button>
                        </div>
                      )}

                      {/* Outreach Templates */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-black text-app-text-muted uppercase">Templates</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {[
                            { label: "Loyalty Bonus Alert", text: `Hi ${selectedCustomer.name}, thank you for being an amazing customer of KayKay's Milk! We have just credited 50 bonus points to your wallet as part of our Gold member rewards!` },
                            { label: "Payment Overdue Note", text: `Hi ${selectedCustomer.name}, this is a gentle reminder that you have an outstanding debt of ${formatCurrency(selectedCustomer.debtBalance || 0)} at KayKay's Milk. Please settle at your earliest convenience. Thank you!` },
                            { label: "Promotional Offer", text: `Hello ${selectedCustomer.name}! Get 10% off on fresh whole Milk deliveries today at KayKay's! Use code FRESH10. Call us to book.` },
                            { label: "Wallet Deposit Notice", text: `Hi ${selectedCustomer.name}, we received your payment and credited your KayKay's Milk digital wallet. Your new wallet balance is ${formatCurrency(selectedCustomer.walletBalance || 0)}.` }
                          ].map((t, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setMessageText(t.text)}
                              className="p-2.5 text-left bg-app-card border border-app-border hover:border-amber-500/25 rounded-xl text-[10px] font-bold leading-tight transition cursor-pointer text-app-text hover:bg-app-card/80"
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Custom outreach text box */}
                      <div className="flex flex-col gap-1 mt-1">
                        <label className="text-[9px] font-black text-app-text-muted uppercase">Outreach Message Body</label>
                        <textarea
                          rows={6}
                          value={messageText}
                          onChange={(e) => setMessageText(e.target.value)}
                          placeholder="Type customer message or statement here..."
                          className="bg-app-card border border-app-border rounded-xl px-3.5 py-3 text-xs text-app-text focus:outline-none focus:border-amber-500 font-medium leading-relaxed font-sans"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3 mt-1.5">
                        <button
                          type="button"
                          onClick={() => ReceiptShareService.shareTextViaWhatsApp(selectedCustomer.phone, messageText)}
                          className="py-2.5 bg-[#25D366] text-white hover:bg-[#20ba59] font-black rounded-xl text-[11px] text-center flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
                        >
                          <Send size={12} />
                          <span>WhatsApp dispatch</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => ReceiptShareService.shareTextViaEmail(selectedCustomer.email, "KayKay's Milk Account Update", messageText)}
                          className="py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-[11px] text-center flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
                        >
                          <Mail size={12} />
                          <span>Email dispatch</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. SEND INVOICE TAB */}
                {activeDetailTab === "invoice" && (
                  <div className="flex flex-col gap-4 text-xs">
                    <div className="bg-app-bg p-4 border border-app-border rounded-2xl flex flex-col gap-3.5">
                      <div className="flex justify-between items-center border-b border-app-border/40 pb-1.5 mb-1">
                        <h4 className="text-[10.5px] font-extrabold text-app-text uppercase tracking-wider">Invoice Builder</h4>
                        {activeInvoiceData && activeInvoiceData.customerId === selectedCustomer.id && (
                          <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/25 rounded-md text-[8px] font-black text-red-500 uppercase tracking-widest ">
                            SMART PRE-POPULATED
                          </span>
                        )}
                      </div>

                      {/* Add Item Row selector */}
                      <div className="bg-app-card p-3.5 border border-app-border rounded-2xl flex flex-col gap-2.5">
                        <span className="text-[9px] font-black text-app-text-muted uppercase">Select Product Line</span>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 md:items-center">
                          <div className="md:col-span-7">
                            <SearchableDropdown
                              items={products.map(p => ({
                                id: p.id,
                                label: p.name,
                                sublabel: formatCurrency(p.price)
                              }))}
                              selectedValue={selectedInvoiceProdId}
                              onChange={(val) => setSelectedInvoiceProdId(val)}
                              placeholder="Choose product..."
                            />
                          </div>
                          <div className="md:col-span-3">
                            <input
                              type="number"
                              id="invoice_prod_qty"
                              placeholder="Qty"
                              defaultValue={1}
                              className="w-full bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-center text-app-text focus:outline-none font-bold font-mono h-[38px]"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedInvoiceProdId) {
                                  const prodId = selectedInvoiceProdId;
                                  const qtyEl = document.getElementById("invoice_prod_qty") as HTMLInputElement;
                                  if (qtyEl) {
                                    const qty = parseFloat(qtyEl.value) || 1;
                                    setInvoiceItems(prev => {
                                      const exists = prev.find(i => i.productId === prodId);
                                      if (exists) {
                                        return prev.map(i => i.productId === prodId ? { ...i, quantity: i.quantity + qty } : i);
                                      }
                                      return [...prev, { productId: prodId, quantity: qty }];
                                    });
                                  }
                                }
                              }}
                              className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider cursor-pointer transition shadow-xs h-[38px]"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Items list */}
                      <div className="flex flex-col gap-2">
                        <span className="text-[9px] font-black text-app-text-muted uppercase">Line Invoice breakdown</span>
                        {invoiceItems.length === 0 ? (
                          <div className="p-4 bg-app-card border border-app-border rounded-xl text-center text-[10.5px] text-app-text-muted font-bold">
                            No items added to custom invoice yet.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 bg-app-card p-3.5 border border-app-border rounded-xl">
                            {invoiceItems.map((item, idx) => {
                              const product = products.find(p => p.id === item.productId);
                              if (!product) return null;
                              return (
                                <div key={idx} className="flex justify-between items-center text-[11px] font-bold">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setInvoiceItems(prev => prev.filter(i => i.productId !== item.productId))}
                                      className="text-red-500 hover:bg-red-500/15 p-1 rounded transition cursor-pointer"
                                      title="Remove product"
                                    >
                                      <X size={11} />
                                    </button>
                                    <span className="text-app-text font-medium">{product.name} <span className="text-app-text-muted text-[10px]">x{item.quantity}</span></span>
                                  </div>
                                  <span className="font-mono">{formatCurrency(product.price * item.quantity)}</span>
                                </div>
                              );
                            })}

                            <div className="h-[1px] bg-app-border my-1.5" />

                            {/* Total calculation */}
                            {(() => {
                              const total = invoiceItems.reduce((acc, item) => {
                                const product = products.find(p => p.id === item.productId);
                                return acc + (product ? product.price * item.quantity : 0);
                              }, 0);
                              return (
                                <div className="flex justify-between items-center font-extrabold text-[11px] text-app-text">
                                  <span>GRAND TOTAL:</span>
                                  <span className="text-amber-500 text-xs md:text-sm font-black font-mono">{formatCurrency(total)}</span>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>

                      {/* Invoice Sharing Buttons */}
                      {invoiceItems.length > 0 && (
                        <div className="flex flex-col gap-2 mt-1">
                          {(() => {
                            const total = invoiceItems.reduce((acc, item) => {
                              const product = products.find(p => p.id === item.productId);
                              return acc + (product ? product.price * item.quantity : 0);
                            }, 0);
                            const itemsText = invoiceItems.map(item => {
                              const product = products.find(p => p.id === item.productId);
                              return `${product ? product.name : "Product"} (x${item.quantity}): ${formatCurrency((product ? product.price : 0) * item.quantity)}`;
                            }).join("\n");
                            
                            const shareText = `*INVOICE STATEMENT*\n*KayKay's Milk rewards Club*\n\n*Customer Name:* ${selectedCustomer.name}\n*Reference Phone:* ${selectedCustomer.phone}\n*Date:* ${new Date().toLocaleDateString()}\n\n*Line Breakdown:*\n${itemsText}\n\n----------------------------\n*Grand Invoice Total:* *${formatCurrency(total)}*\n----------------------------\n\nThank you for choosing KayKay's Milk! Please settle this invoice.`;

                            return (
                              <div className="grid grid-cols-2 gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    ReceiptShareService.shareTextViaWhatsApp(selectedCustomer.phone, shareText);
                                    if (activeInvoiceData) setActiveInvoiceData(null);
                                  }}
                                  className="py-2.5 bg-[#25D366] text-white hover:bg-[#20ba59] font-black rounded-xl text-[11px] text-center flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
                                >
                                  <Share2 size={12} />
                                  <span>Share via WhatsApp</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    alert(`Invoice copied to clipboard and simulated email dispatch to: ${selectedCustomer.email}`);
                                    navigator.clipboard.writeText(shareText);
                                    if (activeInvoiceData) setActiveInvoiceData(null);
                                    setSuccessMsg("Invoice shared successfully!");
                                    setTimeout(() => setSuccessMsg(""), 3000);
                                  }}
                                  className="py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-[11px] text-center flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
                                >
                                  <Check size={12} />
                                  <span>Print statement</span>
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Status feedback toast banner */}
              {successMsg && (
                <div className="absolute bottom-4 left-4 right-4 bg-emerald-500 text-white p-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-md z-50 text-[10px] font-black uppercase tracking-wider animate-bounce">
                  <CheckCircle2 size={12} />
                  <span>{successMsg}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-app-text-muted">
            <div className="p-5 border border-app-border bg-app-card rounded-3xl max-w-sm flex flex-col items-center gap-3 shadow-xs">
              <div className="p-3 bg-amber-500/10 text-amber-500 rounded-full">
                <Award size={24} className="" />
              </div>
              <h3 className="text-xs font-black uppercase tracking-wider text-app-text">Club Records</h3>
              <p className="text-[10.5px] leading-relaxed font-bold">
                Select a customer loyalty profile from the list to view outstanding balance ledgers, historical shopping receipts, custom invoice builders, or dispatch targeted communications.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Add Customer Modal */}
      <AnimatePresence>
        {isAdding && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdding(false)}
              className="absolute inset-0 bg-black z-40"
            />

            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 max-h-[90%] md:max-h-[85%] bg-app-card rounded-t-[32px] border-t border-app-border shadow-2xl p-5 flex flex-col z-50 overflow-y-auto md:overflow-hidden"
            >
              <div className="w-12 h-1 bg-app-border rounded-full mx-auto mb-4 shrink-0" />

              <h3 className="text-sm font-black font-display text-app-text uppercase tracking-wide">Enroll Loyalty Member</h3>
              <p className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider mt-0.5">Register customer in KayKay's rewards program</p>

              <div className="h-[1px] bg-app-border my-3 shrink-0" />

              <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col gap-3.5 pb-20 text-xs font-semibold">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">Full Name *</label>
                  <input
                    type="text"
                    name="name"
                    placeholder="e.g., Sarah Jenkins"
                    value={values.name}
                    onChange={handleChange}
                    className={`bg-app-bg border ${errors.name ? "border-red-500" : "border-app-border"} rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500`}
                  />
                  {errors.name && <span className="text-[9px] text-red-500 font-bold">{errors.name}</span>}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">Phone Number *</label>
                  <div className="grid grid-cols-4 gap-2">
                    <SearchableDropdown
                      items={SUPPORTED_COUNTRIES.map((country) => ({ id: country.code, label: `${country.flag} ${country.code}` }))}
                      selectedValue={selectedCountryCode}
                      onChange={(val) => setSelectedCountryCode(val)}
                      placeholder="Code"
                      className="w-28 shrink-0 col-span-1" 
                    />
                    <input
                      type="tel"
                      name="phone"
                      inputMode="tel"
                      placeholder="e.g., 0712345678"
                      value={values.phone}
                      onChange={handleChange}
                      className={`flex-1 bg-app-bg border col-span-3 ${errors.phone ? "border-red-500" : "border-app-border"} rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500 font-bold`}
                    />
                  </div>
                  <span className="text-[8.5px] text-app-text-muted">Stored E.164: {normalizePhone(values.phone, selectedCountryCode)}</span>
                  {errors.phone && <span className="text-[9px] text-red-500 font-bold">{errors.phone}</span>}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">Email Address</label>
                  <input
                    type="email"
                    name="email"
                    placeholder="e.g., sarah.j@outlook.com"
                    value={values.email}
                    onChange={handleChange}
                    className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">Starting Tier</label>
                    <SearchableDropdown
                      items={[
                        { id: "Bronze", label: "Bronze" },
                        { id: "Silver", label: "Silver" },
                        { id: "Gold", label: "Gold" }
                      ]}
                      selectedValue={values.tier}
                      onChange={(val) => handleChange({ target: { name: "tier", value: val } } as any)}
                      placeholder="Select starting tier..."
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">Starting Points</label>
                    <input
                      type="number"
                      name="startingPoints"
                      inputMode="numeric"
                      value={values.startingPoints}
                      onChange={handleChange}
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500 h-[38px] font-mono font-bold"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">Customer Description / Notes</label>
                  <textarea
                    name="description"
                    rows={3}
                    placeholder="e.g., Prefers raw whole milk, delivers before 8 AM"
                    value={values.description}
                    onChange={handleChange}
                    className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500 font-sans"
                  />
                </div>

                <div className="pt-4 border-t border-app-border flex gap-3 mt-4 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setIsAdding(false);
                    }}
                    className="px-4 py-2.5 border border-app-border rounded-xl text-xs font-bold text-app-text hover:bg-app-bg transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-2.5 bg-amber-500 text-slate-950 font-black rounded-xl text-xs shadow hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" />
                        <span>Enrolling...</span>
                      </>
                    ) : (
                      "Enroll Customer Profile"
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Success Notification */}
      <AnimatePresence>
        {successBanner && (
          <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 bg-emerald-500 text-white px-4 py-2 rounded-full flex items-center gap-1.5 shadow-lg z-50 text-xs font-bold animate-bounce">
            <CheckCircle2 size={14} />
            <span>Loyalty Customer Account Registered!</span>
          </div>
        )}
      </AnimatePresence>

      {/* Floating AI CRM Assistant */}
      <motion.div
        drag
        dragMomentum={false}
        className="fixed bottom-6 right-6 z-50 flex flex-col items-end cursor-grab active:cursor-grabbing"
      >
        {/* Expanded AI Panel */}
        <AnimatePresence>
          {isAIOpen && (
            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 15, scale: 0.95 }}
              className="bg-app-card border border-app-border rounded-2xl shadow-2xl w-[280px] sm:w-[310px] h-[380px] flex flex-col overflow-hidden mb-2.5 mr-1 text-[11px] font-semibold"
            >
              {/* Panel Header */}
              <div className="bg-gradient-to-r from-amber-500/10 to-transparent p-3 border-b border-app-border flex items-center justify-between shrink-0">
                <div className="flex items-center gap-1.5">
                  <div className="p-1 bg-amber-500/15 text-amber-500 rounded-md">
                    <Brain size={13} />
                  </div>
                  <div>
                    <h3 className="text-[10px] font-extrabold text-app-text uppercase tracking-wider font-display">CRM Assistant</h3>
                    <span className="text-[8px] text-amber-500 font-bold uppercase tracking-wider block">Assistant Kim</span>
                  </div>
                </div>
                <button
                  onClick={() => setIsAIOpen(false)}
                  className="p-1 hover:bg-app-bg border border-app-border rounded-md text-app-text-muted hover:text-app-text transition"
                >
                  <X size={10} />
                </button>
              </div>

              {/* Message scroll viewport */}
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 bg-app-bg/15">
                {aiMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col max-w-[85%] ${
                      msg.role === "user" ? "self-end items-end" : "self-start items-start"
                    }`}
                  >
                    <span className="text-[7.5px] font-black uppercase text-app-text-muted mb-0.5 px-0.5">
                      {msg.role === "user" ? "You" : "Kim"}
                    </span>
                    <div
                      className={`p-2.5 rounded-xl text-[10px] leading-relaxed font-medium whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-amber-500 text-slate-950 rounded-tr-none font-bold shadow-xs"
                          : "bg-app-card border border-app-border rounded-tl-none text-app-text shadow-2xs"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}

                {aiLoading && (
                  <div className="self-start flex flex-col items-start max-w-[85%]">
                    <span className="text-[7.5px] font-black uppercase text-app-text-muted mb-0.5 px-0.5">Kim</span>
                    <div className="bg-app-card border border-app-border rounded-xl rounded-tl-none p-2 text-[10px] text-app-text-muted flex items-center gap-1.5">
                      <div className="w-1 h-1 bg-amber-500 rounded-full animate-bounce" />
                      <div className="w-1 h-1 bg-amber-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1 h-1 bg-amber-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                      <span>Thinking...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Suggestions shortcuts */}
              <div className="p-2 border-t border-app-border bg-app-bg/25 flex flex-col gap-1 shrink-0">
                <span className="text-[7.5px] font-black text-app-text-muted uppercase tracking-wider px-0.5">Quick Prompts</span>
                <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-none select-none">
                  {selectedCustomer && (
                    <button
                      onClick={() => {
                        const prompt = `Draft a beautiful, highly personalized loyalty milestone message for ${selectedCustomer.name} (Phone: ${selectedCustomer.phone}, Member Tier: ${selectedCustomer.tier}, Loyalty Stars: ${selectedCustomer.loyaltyPoints}). Thank them and suggest they redeem some stars. Keep it SMS length.`;
                        handleSendAiMessage(prompt);
                      }}
                      className="px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20 rounded-md text-[8.5px] font-black uppercase tracking-wide shrink-0 transition"
                    >
                      Milestone Message ⭐
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const overdueList = customers
                        .filter(c => c.debtBalance && c.debtBalance > 0)
                        .map(c => `• ${c.name} (${formatCurrency(c.debtBalance || 0)})`)
                        .join("\n");
                      const prompt = overdueList
                        ? `Here is the current active client debt roster:\n${overdueList}\n\nProvide an analysis of who we should prioritize contacting and write a polite, professional corporate template we can use for collective follow-ups.`
                        : "Roster status: Perfect. No client currently carries outstanding debt balance. Draft a generic premium VIP promotional newsletter instead!";
                      handleSendAiMessage(prompt);
                    }}
                    className="px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-md text-[8.5px] font-black uppercase tracking-wide shrink-0 transition"
                  >
                    Analyze Debt 📋
                  </button>
                  <button
                    onClick={() => handleSendAiMessage("List 3 unique, high-yield ideas to increase customer retention and milk order subscriptions this week.")}
                    className="px-2 py-0.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 border border-blue-500/20 rounded-md text-[8.5px] font-black uppercase tracking-wide shrink-0 transition"
                  >
                    Retention Tips 💡
                  </button>
                </div>
              </div>

              {/* Chat panel controls */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendAiMessage();
                }}
                className="p-2 border-t border-app-border bg-app-card flex gap-1.5 shrink-0 items-center"
              >
                <input
                  type="text"
                  placeholder="Ask Kim anything about CRM..."
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  className="flex-1 bg-app-bg border border-app-border rounded-xl px-2.5 py-1.5 text-[10px] text-app-text focus:outline-none focus:border-amber-500 font-medium"
                />
                <button
                  type="submit"
                  disabled={aiLoading || !aiInput.trim()}
                  className="p-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 rounded-xl cursor-pointer transition shadow-xs shrink-0"
                >
                  <Send size={11} />
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Toggle Button (Scaled down to 40% of standard size) */}
        <button
          onClick={() => setIsAIOpen(!isAIOpen)}
          className="w-10 h-10 bg-gradient-to-tr from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 rounded-full shadow-2xl flex items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95 select-none border border-amber-400/20 group relative shrink-0"
          title="Drag me! Click to open CRM Assistant"
        >
          <Brain size={15} className="group-hover:rotate-6 transition-transform" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 border border-app-card rounded-full animate-ping" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 border border-app-card rounded-full" />
        </button>
      </motion.div>
    </div>
  );
}
