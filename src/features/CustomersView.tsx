import { toUserMessage } from "../utils/userError";
import { customerName } from '../utils/stringUtils';
import { SheetLayer } from '../components/shared/SheetLayer';
import { useBusinessStore } from '../stores/businessStore';
import { InvoiceSheet } from '../components/invoices/InvoiceSheet';
import { PointsReport } from '../components/loyalty/PointsReport';
import { PointsSettings, canConfigurePoints } from '../components/loyalty/PointsSettings';
import { usePointsEnabled } from '../services/loyalty/pointValue';
import { listInvoices, IssuedInvoice, setInvoiceArchived, deleteInvoice } from '../services/invoice/invoiceData';
import { SwipeRow } from '../components/shared/SwipeRow';
import type { InvoiceDocument } from '../services/invoice/types';
import { formatInvoiceDate } from '../services/invoice/invoiceDraft';
import React, { useState, useEffect } from "react";
import { useOverlay } from "../hooks/useOverlay";
import { useAppStore } from "../stores/appStore";
import { 
  UserPlus, Search, Phone, Mail, Award, CheckCircle2, Star, ShieldAlert, 
  X, ChevronRight, Trash2, Send, Share2, Check, ArrowLeft,
  Brain, RefreshCw,
  Coins, ShoppingBag, CreditCard, Wallet, ChevronDown, ChevronUp, Filter, FileText, Gift, PanelLeftClose, PanelLeftOpen, Archive, ArchiveRestore
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useForm } from "../hooks/useForm";
import { hasRolePermission } from "../utils/permissions";
import { formatCurrency, formatDate } from "../utils/helpers";
import SearchableDropdown from "../components/SearchableDropdown";
import { Tabs } from "../components/TabOptions";
import { titleCase, searchMatch, getFirstName } from "../utils/stringUtils";
import { normalizePhone, validatePhone, SUPPORTED_COUNTRIES } from "../utils/phoneUtils";
import { formatReceiptNumber } from "../utils/idUtils";
import { SupabaseService } from "../services/supabaseService";
import { ReceiptShareService } from "../services/receipt/ReceiptShareService";
import { ReceiptSheet } from "../components/receipts/ReceiptSheet";
import { Transaction, DebtPayment, CustomerLedgerEntry, CUSTOMER_TYPE_LABELS, PAYMENT_TERMS_LABELS, DELIVERY_FREQUENCY_LABELS, type MoneyMethod } from "../types";
import { MONEY_METHODS } from "../utils/paymentMethods";
import CustomerGroupFields, { CustomerGroupValues } from "../components/CustomerGroupFields";
import DuplicateCustomers from "../components/DuplicateCustomers";
import { findDuplicateCustomers, phoneKey } from "../services/customerMerge";
import CustomerRewards from "../components/CustomerRewards";
import { appDialog } from '../components/AppDialog';

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

const customerGroupLabels = (c: {
  customerType?: keyof typeof CUSTOMER_TYPE_LABELS;
  paymentTerms?: keyof typeof PAYMENT_TERMS_LABELS;
  deliveryFrequency?: keyof typeof DELIVERY_FREQUENCY_LABELS;
}) => [
  CUSTOMER_TYPE_LABELS[c.customerType ?? 'individual'],
  PAYMENT_TERMS_LABELS[c.paymentTerms ?? 'pay_now'],
  DELIVERY_FREQUENCY_LABELS[c.deliveryFrequency ?? 'none'],
];

export default function CustomersView() {
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const { 
    customers, addCustomer, currentEmployee, 
    updateCustomer, deleteCustomer, products,
    selectedCustomerId, setSelectedCustomerId, 
    transactions,
    debtPayments,
    showToast,activeBusinessId,
    payCustomerDebt, depositCustomerWallet, spendCustomerWallet, adjustCustomerDebt
  } = useAppStore();
  // The phone's back button closes a customer's details before leaving the screen.
  useOverlay(!!selectedCustomerId, () => setSelectedCustomerId(null), 'screen');
  const pointsOn = usePointsEnabled(activeBusinessId); // off: points are hidden here
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [newGroups, setNewGroups] = useState<CustomerGroupValues>({
    customerType: "individual",
    paymentTerms: "pay_now",
    deliveryFrequency: "none",
    notifyService: true,
    notifyPromotions: false,
  });
  const [editGroups, setEditGroups] = useState<CustomerGroupValues>({
    customerType: "individual",
    paymentTerms: "pay_now",
    deliveryFrequency: "none",
    notifyService: true,
    notifyPromotions: false,
  });
  const [isAdding, setIsAdding] = useState(false);
  const [successBanner, setSuccessBanner] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<"money" | "overview" | "history" | "invoice" | "message" | "ledger">("money");
  // Invoices: a new one for this customer, or one issued earlier.
  const [invoiceFor, setInvoiceFor] = useState<typeof customers[number] | null>(null);
  const [openInvoice, setOpenInvoice] = useState<InvoiceDocument | null>(null);
  const [invoices, setInvoices] = useState<IssuedInvoice[]>([]);
  const [invoicesState, setInvoicesState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [invoicesError, setInvoicesError] = useState('');
  const [invoiceView, setInvoiceView] = useState<'active' | 'archived'>('active');
  const [payMethod, setPayMethod] = useState<MoneyMethod>('Cash');
  const [adjustNote, setAdjustNote] = useState('');
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  // Customer History & Event Log State
  const [historyFilter, setHistoryFilter] = useState<'all' | 'sales' | 'credit' | 'wallet'>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyDateRange, setHistoryDateRange] = useState<'all' | '7days' | '30days'>('all');
  const [customerDebtPayments, setCustomerDebtPayments] = useState<DebtPayment[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);

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

  const [successMsg, setSuccessMsg] = useState("");

  // CRM AI Assistant local states
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [aiMessages, setAiMessages] = useState<
    { role: 'user' | 'assistant'; content: string }[]
  >([
    {
      role: 'assistant',
      content:
        'Jambo! I am Kim, your KayKay\'s CRM Assistant. Click any prompt below or type your message to help manage customer relationships!',
    },
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
    if (selectedCustomerId && (activeDetailTab === "ledger" || activeDetailTab === "history")) {
      setLoadingLedger(true);
      setLoadingHistory(true);
      Promise.all([
        SupabaseService.fetchCustomerLedger(selectedCustomerId).catch(err => {
          console.warn("Failed to fetch customer ledger:", err);
          return [];
        }),
        SupabaseService.fetchDebtPayments(selectedCustomerId).catch(err => {
          console.warn("Failed to fetch debt payments:", err);
          return [];
        }),
      ])
        .then(([entries, payments]) => {
          setLedgerEntries(entries || []);
          setCustomerDebtPayments(payments || []);
        })
        .catch(err => {
          showToast("Error", toUserMessage(err, "Failed to load history."), undefined, "error");
        })
        .finally(() => {
          setLoadingLedger(false);
          setLoadingHistory(false);
        });
    }
  }, [activeDetailTab, selectedCustomerId]);

  // Centralized permission validations
  const canViewCustomers = currentEmployee ? hasRolePermission(currentEmployee.role, "customers.view") : false;
  const canAdjustPoints = currentEmployee ? hasRolePermission(currentEmployee.role, "loyalty.adjust") : false;
  const canConfigurePointsHere = canConfigurePoints(currentEmployee?.role);
  const [pointsReportKey, setPointsReportKey] = useState(0);
  const canCreateCustomers = currentEmployee ? hasRolePermission(currentEmployee.role, "customers.create") : false;
  const canDeleteCustomers = currentEmployee ? hasRolePermission(currentEmployee.role, "customers.delete") : false;
  const canMergeCustomers = currentEmployee ? hasRolePermission(currentEmployee.role, "customers.manage") : false;
  const canInvoice = currentEmployee ? hasRolePermission(currentEmployee.role, "customers.debts") : false;
  const [showDuplicates, setShowDuplicates] = useState(false);
  // The points report shows in the right panel instead of a customer.
  const [showPoints, setShowPoints] = useState(false);
  // Wide screens: the customer list can fold away to give the customer more room (remembered).
  const [listCollapsed, setListCollapsed] = useState(() => {
    try {
      return localStorage.getItem('kkm_loyalty_list_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleList = () =>
    setListCollapsed((v) => {
      try {
        localStorage.setItem('kkm_loyalty_list_collapsed', v ? '0' : '1');
      } catch {
        /* storage blocked */
      }
      return !v;
    });
  const openCustomer = (id: string) => {
    setShowPoints(false);
    setSelectedCustomerId(id);
  };
  const [duplicateCount, setDuplicateCount] = useState(0);

  const refreshDuplicateCount = React.useCallback(() => {
    if (!canMergeCustomers || !activeBusinessId) return;
    findDuplicateCustomers(activeBusinessId)
      .then((groups) => setDuplicateCount(groups.length))
      .catch((err) => console.error("Could not check for duplicate customers:", err));
  }, [canMergeCustomers, activeBusinessId]);

  useEffect(refreshDuplicateCount, [refreshDuplicateCount, customers.length]);

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
          email: vals.email || "no-email@kaykays.com",
          loyaltyPoints: 0,
          tier: vals.tier,
          description: vals.description,
          ...newGroups,
        });
        setIsAdding(false);
        setNewGroups({ customerType: "individual", paymentTerms: "pay_now", deliveryFrequency: "none", notifyService: true, notifyPromotions: false });
        setSuccessBanner(true);
        setTimeout(() => setSuccessBanner(false), 2000);
        showToast("Customer Added", `"${vals.name}" successfully created.`, undefined, "success");
      } catch (err: any) {
        showToast("Database Error", toUserMessage(err, "Failed to add customer."), undefined, "error");
      }
    },
  });

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  const shopName = useBusinessStore((st) => st.businesses.find((b) => b.id === st.activeBusinessId)?.name) || 'us';

  const enteredPhoneKey = phoneKey(normalizePhone(values.phone, selectedCountryCode));
  const samePhoneCustomer = enteredPhoneKey ? customers.find((c) => phoneKey(c.phone) === enteredPhoneKey) : undefined;

  // Unified History Event Timeline Builder
  const historyEvents = React.useMemo(() => {
    if (!selectedCustomerId) return [];

    const events: Array<{
      id: string;
      eventType: 'sale' | 'credit_payment' | 'wallet_ledger';
      timestamp: string;
      title: string;
      subtitle?: string;
      amount: number;
      paymentStatusLabel?: string;
      paymentStatusStyle?: string;
      paymentMethod?: string;
      rawSale?: Transaction;
      rawPayment?: DebtPayment;
      rawLedger?: CustomerLedgerEntry;
    }> = [];

    // 1. Sales Done (Transactions)
    const custTxs = transactions.filter((t) => t.customerId === selectedCustomerId);
    custTxs.forEach((tx) => {
      const isCredit = tx.paymentMethod === 'Credit_Debt' || tx.paymentMethod === 'Credit' || (tx.paymentMethod as string) === 'Account';
      const isWallet = (tx.paymentMethod as string) === 'Wallet';

      let statusLabel = `Paid (${tx.paymentMethod || 'Cash'})`;
      let statusStyle = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';

      if (isCredit) {
        statusLabel = 'Credit Debt (Unpaid)';
        statusStyle = 'bg-red-500/10 text-red-500 border-red-500/30';
      } else if (isWallet) {
        statusLabel = 'Paid via Wallet';
        statusStyle = 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      } else if (tx.paymentMethod === 'Cash') {
        statusLabel = 'Paid in Full (Cash)';
      } else if (tx.paymentMethod === 'M-Pesa') {
        statusLabel = 'Paid in Full (M-Pesa)';
      } else if (tx.paymentMethod === 'Card') {
        statusLabel = 'Paid in Full (Card)';
      } else if (tx.paymentMethod === 'Bank') {
        statusLabel = 'Paid in Full (Bank)';
      }

      events.push({
        id: `sale-${tx.id}`,
        eventType: 'sale',
        timestamp: tx.timestamp,
        title: isCredit ? 'Credit Sale Transaction' : 'Sale Transaction',
        subtitle: `Receipt #${formatReceiptNumber(tx.id)}`,
        amount: tx.finalTotal,
        paymentStatusLabel: statusLabel,
        paymentStatusStyle: statusStyle,
        paymentMethod: tx.paymentMethod,
        rawSale: tx,
      });
    });

    // 2. Credit Repayments
    const mergedPaymentsMap = new Map<string, DebtPayment>();
    (debtPayments || [])
      .filter((dp) => dp.customerId === selectedCustomerId)
      .forEach((dp) => mergedPaymentsMap.set(dp.id, dp));
    (customerDebtPayments || []).forEach((dp) => mergedPaymentsMap.set(dp.id, dp));

    mergedPaymentsMap.forEach((dp) => {
      events.push({
        id: `credit-${dp.id}`,
        eventType: 'credit_payment',
        timestamp: dp.created_at || new Date().toISOString(),
        title: 'Credit / Debt Repayment',
        subtitle: `Paid via ${dp.paymentMethod || 'Cash'}`,
        amount: dp.amountPaid,
        paymentStatusLabel: 'Debt Repayment Received',
        paymentStatusStyle: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
        paymentMethod: dp.paymentMethod,
        rawPayment: dp,
      });
    });

    // 3. Wallet & Balance Ledger Events
    (ledgerEntries || []).forEach((entry: CustomerLedgerEntry) => {
      if (entry.type === 'wallet_topup' || entry.type === 'wallet_usage' || entry.type === 'debt_adjustment') {
        let title = 'Wallet & Balance Adjustment';
        let statusStyle = 'bg-blue-500/10 text-blue-400 border-blue-500/30';

        if (entry.type === 'wallet_topup') {
          title = 'Wallet Deposit / Top-Up';
          statusStyle = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
        } else if (entry.type === 'wallet_usage') {
          title = 'Wallet Balance Spent';
          statusStyle = 'bg-purple-500/10 text-purple-400 border-purple-500/30';
        }

        events.push({
          id: `ledger-${entry.id}`,
          eventType: 'wallet_ledger',
          timestamp: entry.created_at || new Date().toISOString(),
          title,
          subtitle: entry.recordedBy ? `Recorded by ${entry.recordedBy}` : undefined,
          amount: entry.amount,
          paymentStatusLabel: titleCase(entry.type.replace('_', ' ')),
          paymentStatusStyle: statusStyle,
          rawLedger: entry,
        });
      }
    });

    // Sort newest first
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return events;
  }, [selectedCustomerId, transactions, debtPayments, customerDebtPayments, ledgerEntries]);

  // Filtered timeline based on category, date range, and search
  const filteredHistoryEvents = React.useMemo(() => {
    return historyEvents.filter((ev) => {
      // Category filter
      if (historyFilter === 'sales' && ev.eventType !== 'sale') return false;
      if (historyFilter === 'credit' && ev.eventType !== 'credit_payment') return false;
      if (historyFilter === 'wallet' && ev.eventType !== 'wallet_ledger') return false;

      // Date Range filter
      if (historyDateRange !== 'all') {
        const evDate = new Date(ev.timestamp).getTime();
        const now = Date.now();
        const days = historyDateRange === '7days' ? 7 : 30;
        if (now - evDate > days * 24 * 60 * 60 * 1000) return false;
      }

      // Search Query
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase();
        const matchesTitle = ev.title.toLowerCase().includes(q);
        const matchesSubtitle = ev.subtitle?.toLowerCase().includes(q);
        const matchesMethod = ev.paymentMethod?.toLowerCase().includes(q);

        let matchesProduct = false;
        if (ev.rawSale && ev.rawSale.items) {
          matchesProduct = ev.rawSale.items.some((it: any) =>
            it.product?.name?.toLowerCase().includes(q)
          );
        }

        let matchesNote = false;
        if (ev.rawSale?.note) matchesNote = ev.rawSale.note.toLowerCase().includes(q);
        if (ev.rawPayment?.note) matchesNote = ev.rawPayment.note.toLowerCase().includes(q);
        if (ev.rawLedger?.note) matchesNote = ev.rawLedger.note.toLowerCase().includes(q);

        if (!matchesTitle && !matchesSubtitle && !matchesMethod && !matchesProduct && !matchesNote) {
          return false;
        }
      }

      return true;
    });
  }, [historyEvents, historyFilter, historyDateRange, historySearch]);

  // History Statistics metrics
  const historyStats = React.useMemo(() => {
    const saleEvents = historyEvents.filter((e) => e.eventType === 'sale');
    const creditPaymentEvents = historyEvents.filter((e) => e.eventType === 'credit_payment');

    const totalSalesAmt = saleEvents.reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const creditSalesAmt = saleEvents
      .filter((e) => e.rawSale?.paymentMethod === 'Credit_Debt' || e.rawSale?.paymentMethod === 'Credit')
      .reduce((acc, curr) => acc + (curr.amount || 0), 0);

    const totalRepaymentsAmt = creditPaymentEvents.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    return {
      salesCount: saleEvents.length,
      totalSalesAmt,
      creditSalesAmt,
      totalRepaymentsAmt,
    };
  }, [historyEvents]);


  useEffect(() => {
    if (selectedCustomer) {
      setEditName(selectedCustomer.name);
      setEditEmail(selectedCustomer.email);
      setEditTier(selectedCustomer.tier);
      setEditPoints(selectedCustomer.loyaltyPoints);
      setEditDescription(selectedCustomer.description || "");
      setEditGroups({
        customerType: selectedCustomer.customerType ?? "individual",
        paymentTerms: selectedCustomer.paymentTerms ?? "pay_now",
        deliveryFrequency: selectedCustomer.deliveryFrequency ?? "none",
        notifyService: selectedCustomer.notifyService ?? true,
        notifyPromotions: selectedCustomer.notifyPromotions ?? false,
      });
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
    }
  }, [selectedCustomerId, selectedCustomer]);

  // A different customer starts on their money; their invoices load when that tab opens.
  useEffect(() => {
    setActiveDetailTab("money");
    setInvoices([]);
    setInvoicesState('idle');
    setInvoiceView('active');
  }, [selectedCustomerId]);

  const loadInvoices = React.useCallback(() => {
    if (!selectedCustomerId) return;
    setInvoicesState('loading');
    listInvoices(selectedCustomerId)
      .then((rows) => {
        setInvoices(rows);
        setInvoicesState('idle');
      })
      .catch((err) => {
        setInvoicesError(toUserMessage(err, 'Could not load invoices.'));
        setInvoicesState('error');
      });
  }, [selectedCustomerId]);

  useEffect(() => {
    if (activeDetailTab === 'invoice') loadInvoices();
  }, [activeDetailTab, loadInvoices]);

  const removeCustomer = async (cust: { id: string; name: string }) => {
    if (
      !(await appDialog.confirm({
        title: `Delete ${cust.name}?`,
        message: 'Their profile is removed for good.',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    ) return;
    setIsDeletingCustomer(true);
    try {
      await deleteCustomer(cust.id);
      if (selectedCustomerId === cust.id) setSelectedCustomerId(null);
      showToast('Customer Deleted', `"${cust.name}" successfully deleted from database.`, undefined, 'success');
    } catch (err: any) {
      showToast('Database Error', toUserMessage(err, "Failed to delete customer."), undefined, 'error');
    } finally {
      setIsDeletingCustomer(false);
    }
  };

  const toggleInvoiceArchived = async (inv: IssuedInvoice) => {
    const archive = !inv.archivedAt;
    const stamp = archive ? new Date().toISOString() : null;
    setInvoices((list) => list.map((i) => (i.id === inv.id ? { ...i, archivedAt: stamp } : i)));
    try {
      await setInvoiceArchived(inv.id, archive);
      showToast(archive ? 'Invoice archived' : 'Invoice restored', archive ? `${inv.invoiceNo} is under Archived.` : `${inv.invoiceNo} is back in the list.`, undefined, 'success');
    } catch (err) {
      setInvoices((list) => list.map((i) => (i.id === inv.id ? { ...i, archivedAt: inv.archivedAt } : i)));
      showToast('Invoices', toUserMessage(err, 'Could not change that invoice.'), undefined, 'error');
    }
  };

  const removeInvoice = async (inv: IssuedInvoice) => {
    const ok = await appDialog.confirm({
      title: `Delete invoice ${inv.invoiceNo}?`,
      message: 'It is removed for good. What the customer owes does not change, and the number is not used again. Archive it instead to keep a copy.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteInvoice(inv.id);
      setInvoices((list) => list.filter((i) => i.id !== inv.id));
      showToast('Invoice deleted', `${inv.invoiceNo} was deleted.`, undefined, 'success');
    } catch (err) {
      showToast('Invoices', toUserMessage(err, 'Could not delete that invoice.'), undefined, 'error');
    }
  };

  // groupFilter is "field:value", such as "paymentTerms:weekly".
  const matchesGroup = (c: typeof customers[number]) => {
    if (groupFilter === "all") return true;
    const [field, value] = groupFilter.split(":");
    if (field === "customerType") return (c.customerType ?? "individual") === value;
    if (field === "paymentTerms") return (c.paymentTerms ?? "pay_now") === value;
    return (c.deliveryFrequency ?? "none") === value;
  };

  const filteredCustomers = customers.filter(c => matchesGroup(c) && (
    searchMatch(c.name, searchQuery) || 
    searchMatch(c.phone, searchQuery) ||
    searchMatch(c.email, searchQuery) ||
    searchMatch(c.tier, searchQuery)
  ));

  // Generate automated debt breakdown text for WhatsApp
  const getDebtBreakdownMessage = (cust: typeof selectedCustomer) => {
    if (!cust) return "";
    const debtTx = transactions.filter(t => t.customerId === cust.id && (t.paymentMethod === 'Credit_Debt' || t.paymentMethod === 'Credit'));
    
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

    let msg = `Hi *${getFirstName(cust.name)}*,\n\n`;
    msg += `This is a friendly statement regarding your outstanding balance of *KSh ${(
      cust.debtBalance || 0
    ).toFixed(0)}* at ${shopName}.\n\n`;
    if (itemSummary) {
      msg += `*Included Products:*\n${itemSummary}\n`;
    }
    if (totalDelivery > 0) {
      msg += `*Delivery Fees:* KSh ${totalDelivery.toFixed(0)}\n`;
    }
    if (totalTax > 0) {
      msg += `*VAT:* KSh ${totalTax.toFixed(0)}\n`;
    }
    msg += `\nPlease settle this balance at your earliest convenience. Thank you!`;
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

  // Runs a money action and reports it; the amount and note clear when it worked.
  const runMoney = async (
    setFlag: (busy: boolean) => void,
    run: () => Promise<unknown>,
    done: { banner: string; title: string; text: string },
  ) => {
    setFlag(true);
    try {
      await run();
      playSfx('save');
      setAdjustAmt(0);
      setAdjustNote('');
      setSuccessMsg(done.banner);
      setTimeout(() => setSuccessMsg(''), 3000);
      showToast(done.title, done.text, undefined, 'success');
    } catch (err) {
      showToast('Not saved', toUserMessage(err, 'That did not go through. Try again.'), undefined, 'error');
    } finally {
      setFlag(false);
    }
  };

  const tierTone = (tier?: string) =>
    tier === 'Gold'
      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
      : tier === 'Silver'
      ? 'bg-slate-500/15 text-slate-600 dark:text-slate-300'
      : 'bg-orange-500/15 text-orange-600 dark:text-orange-400';
  const initials = (name: string) =>
    name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || '?';
  const openTab = (tab: typeof activeDetailTab) => {
    setActiveDetailTab(tab);
    setSuccessMsg('');
    requestAnimationFrame(() => document.getElementById('customer-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full bg-app-bg text-app-text relative overflow-hidden font-sans">
      {/* LIST: on phones it's the whole screen until a customer is opened */}
      <div
        className={`w-full lg:w-80 xl:w-[21rem] shrink-0 flex-col lg:border-r border-app-border h-full min-h-0 bg-app-card ${
          selectedCustomerId || showPoints ? 'hidden lg:flex' : 'flex'
        } ${listCollapsed ? 'lg:!hidden' : ''}`}
      >
        {/* Title and actions */}
        <div className="px-4 pt-4 pb-3 shrink-0 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-app-text leading-tight">Customers</h2>
              <span className="text-xs text-app-text-muted">
                {filteredCustomers.length} {filteredCustomers.length === 1 ? 'customer' : 'customers'}
              </span>
            </div>
            <button
              onClick={toggleList}
              aria-label="Hide the customer list"
              title="Hide the list for more room"
              className="hidden lg:grid place-items-center size-9 rounded-xl text-app-text-muted hover:bg-app-bg cursor-pointer"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(pointsOn || canConfigurePointsHere) && (
              <button
                data-shortcut="points"
                title={canConfigurePointsHere ? 'Points report and points settings' : 'Points report'}
                onClick={() => {
                  setSelectedCustomerId(null);
                  setShowPoints(true);
                }}
                aria-pressed={showPoints}
                className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 cursor-pointer ${showPoints ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-app-bg text-app-text'}`}
              >
                <Gift size={15} /> Points
              </button>
            )}
            {canMergeCustomers && (
              <button
                onClick={() => setShowDuplicates(true)}
                className="relative px-3 py-2 rounded-xl bg-app-bg text-app-text text-sm font-medium cursor-pointer"
              >
                Duplicates
                {duplicateCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-slate-950 text-[11px] font-semibold grid place-items-center">
                    {duplicateCount}
                  </span>
                )}
              </button>
            )}
            {canCreateCustomers && (
              <button
                onClick={() => {
                  resetForm();
                  setIsAdding(true);
                }}
                data-shortcut="new"
                className="ml-auto px-3.5 py-2 bg-amber-500 text-slate-950 font-semibold rounded-xl text-sm flex items-center gap-1.5 hover:bg-amber-600 cursor-pointer"
              >
                <UserPlus size={16} />
                <span>Add</span>
              </button>
            )}
          </div>
        </div>

        {/* Search and filter */}
        <div className="px-3 pb-3 shrink-0 flex flex-col gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
            <input
              type="search"
              placeholder="Name, phone or account no."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-app-bg text-sm pl-9 pr-3 py-2.5 rounded-xl focus:outline-none text-app-text"
            />
          </div>
          <SearchableDropdown
            items={[
              { id: 'all', label: 'All customers' },
              ...Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => ({ id: `customerType:${value}`, label, sublabel: 'Customer type' })),
              ...Object.entries(PAYMENT_TERMS_LABELS).map(([value, label]) => ({ id: `paymentTerms:${value}`, label, sublabel: 'Payment terms' })),
              ...Object.entries(DELIVERY_FREQUENCY_LABELS).map(([value, label]) => ({ id: `deliveryFrequency:${value}`, label, sublabel: 'Delivery schedule' })),
            ]}
            selectedValue={groupFilter}
            onChange={setGroupFilter}
            placeholder="All customers"
            searchPlaceholder="Search groups"
          />
        </div>

        {/* Customers */}
        <div className="flex-1 min-h-0 overflow-y-auto pb-nav">
          {filteredCustomers.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm font-medium text-app-text">No customers found</p>
              <p className="text-xs text-app-text-muted mt-1">
                {searchQuery || groupFilter !== 'all' ? 'Try another search or filter.' : 'Add your first customer with the Add button.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-app-border">
              {filteredCustomers.map((c) => {
                const isSelected = selectedCustomerId === c.id;
                const debt = c.debtBalance || 0;
                const offline = (c as any).sync_status && (c as any).sync_status !== 'synced';
                return (
                  <SwipeRow
                    key={c.id}
                    title={customerName(c.name)}
                    subtitle={`${c.phone}${debt > 0 ? ` · owes ${formatCurrency(debt)}` : ''}`}
                    actions={[{ label: 'Delete', icon: <Trash2 size={18} />, tone: 'red', hidden: !canDeleteCustomers, disabled: isDeletingCustomer, onClick: () => removeCustomer(c) }]}
                    more={[
                      { label: 'Open', icon: <ChevronRight size={16} />, onClick: () => openCustomer(c.id) },
                      { label: 'Make invoice', icon: <FileText size={16} />, hidden: !canInvoice || debt <= 0, onClick: () => setInvoiceFor(c) },
                      { label: 'Delete customer', icon: <Trash2 size={16} />, tone: 'red', hidden: !canDeleteCustomers, disabled: isDeletingCustomer, onClick: () => removeCustomer(c) },
                    ]}
                  >
                  <button
                    onClick={() => openCustomer(c.id)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-3 cursor-pointer ${
                      isSelected ? 'bg-amber-500/10' : 'hover:bg-app-bg'
                    }`}
                  >
                    <span className={`grid place-items-center size-10 rounded-full shrink-0 text-sm font-semibold ${tierTone(c.tier)}`}>
                      {initials(c.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-medium text-app-text truncate">{customerName(c.name)}</span>
                        {offline && <span className="shrink-0 size-1.5 rounded-full bg-amber-500" title="Not synced yet" />}
                      </span>
                      <span className="block text-xs text-app-text-muted truncate">
                        {c.phone}
                        {c.tier ? ` · ${c.tier}` : ''}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      {debt > 0 ? (
                        <>
                          <span className="block text-sm font-semibold text-red-600 dark:text-red-400 tabular-nums">{formatCurrency(debt)}</span>
                          <span className="block text-[11px] text-app-text-muted">owes</span>
                        </>
                      ) : pointsOn ? (
                        <>
                          <span className="block text-sm font-semibold text-app-text tabular-nums">{(c.loyaltyPoints || 0).toLocaleString()}</span>
                          <span className="block text-[11px] text-app-text-muted">points</span>
                        </>
                      ) : null}
                    </span>
                  </button>
                  </SwipeRow>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* CUSTOMER: one scroll on phones; side panel on large screens */}
      <div
        className={`relative flex-1 min-w-0 flex-col h-full min-h-0 bg-app-bg ${
          !selectedCustomerId && !showPoints ? 'hidden lg:flex' : 'flex'
        }`}
      >
        {/* Brings the folded customer list back (wide screens) */}
        {listCollapsed && (
          <button
            onClick={toggleList}
            aria-label="Show the customer list"
            title="Show the customer list"
            className="hidden lg:flex absolute left-2 top-3 z-30 items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-app-card ring-1 ring-app-border text-sm font-medium shadow-sm hover:bg-app-bg cursor-pointer"
          >
            <PanelLeftOpen size={16} /> Customers
          </button>
        )}
        {showPoints && !selectedCustomer && activeBusinessId ? (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className={`px-3 pt-3 pb-nav lg:px-5 lg:pb-6 max-w-5xl mx-auto w-full ${listCollapsed ? 'lg:pt-14' : 'lg:pt-4'}`}>
              {pointsOn ? (
                <PointsReport
                  key={pointsReportKey}
                  businessId={activeBusinessId}
                  customers={customers}
                  onBack={() => setShowPoints(false)}
                  onOpenCustomer={openCustomer}
                  settings={canConfigurePointsHere ? <PointsSettings businessId={activeBusinessId} onSaved={() => setPointsReportKey((k) => k + 1)} /> : undefined}
                />
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setShowPoints(false)} aria-label="Back" className="p-2 -ml-2 rounded-xl hover:bg-app-card cursor-pointer lg:hidden">
                      <ArrowLeft size={20} />
                    </button>
                    <h2 className="text-base font-semibold">Loyalty points are off</h2>
                  </div>
                  {canConfigurePointsHere && <PointsSettings businessId={activeBusinessId} />}
                </div>
              )}
            </div>
          </div>
        ) : selectedCustomer ? (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {/* Top bar: back, name, close */}
            <div className="sticky top-0 z-20 h-14 bg-app-bg/95 backdrop-blur px-2 flex items-center gap-1 lg:hidden">
              <button
                onClick={() => setSelectedCustomerId(null)}
                aria-label="Back to customers"
                className="p-2 rounded-xl text-app-text hover:bg-app-card"
              >
                <ArrowLeft size={20} />
              </button>
              <span className="text-sm font-semibold text-app-text truncate">{customerName(selectedCustomer.name)}</span>
            </div>

            <div className={`px-3 pb-nav lg:px-5 lg:pb-6 max-w-5xl mx-auto w-full ${listCollapsed ? 'lg:pt-14' : 'lg:pt-4'}`}>
            {/* Who they are */}
            <aside className="bg-app-card rounded-2xl p-3 mb-3 lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-4 lg:items-start">
              <div className="min-w-0">
              <div className="flex items-start gap-3">
                <span className={`grid place-items-center size-10 rounded-full shrink-0 text-sm font-semibold ${tierTone(selectedCustomer.tier)}`}>
                  {initials(selectedCustomer.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-semibold text-app-text truncate">{customerName(selectedCustomer.name)}</h2>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 ${tierTone(selectedCustomer.tier)}`}>
                      <Award size={11} />
                      {selectedCustomer.tier}
                    </span>
                  </div>
                  <p className="text-xs text-app-text-muted mt-0.5">
                    {selectedCustomer.phone}
                    {selectedCustomer.accountNumber ? ` · Acc. ${selectedCustomer.accountNumber}` : ''}
                  </p>
                  {customerGroupLabels(selectedCustomer).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {customerGroupLabels(selectedCustomer).map((label) => (
                        <span key={label} className="px-2 py-0.5 rounded-full bg-app-bg text-[11px] text-app-text-muted">
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedCustomerId(null)}
                  className="hidden lg:flex p-1.5 rounded-lg text-app-text-muted hover:text-app-text hover:bg-app-bg cursor-pointer"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Balances */}
              <div className={`grid ${pointsOn ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5 mt-3`}>
                {pointsOn && (
                  <div className="rounded-lg bg-app-bg px-2.5 py-1.5">
                    <div className="text-[11px] text-app-text-muted">Points</div>
                    <div className="text-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums flex items-center gap-1">
                      <Star size={12} className="fill-current" />
                      {(selectedCustomer.loyaltyPoints || 0).toLocaleString()}
                    </div>
                  </div>
                )}
                <div className={`rounded-lg px-2.5 py-1.5 ${(selectedCustomer.debtBalance || 0) > 0 ? 'bg-red-500/10' : 'bg-app-bg'}`}>
                  <div className="text-[11px] text-app-text-muted">Owes (KSh)</div>
                  <div className={`text-sm font-semibold tabular-nums leading-tight break-all ${(selectedCustomer.debtBalance || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-app-text'}`}>
                    {(selectedCustomer.debtBalance || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div className={`rounded-lg px-2.5 py-1.5 ${(selectedCustomer.walletBalance || 0) > 0 ? 'bg-emerald-500/10' : 'bg-app-bg'}`}>
                  <div className="text-[11px] text-app-text-muted">Wallet (KSh)</div>
                  <div className={`text-sm font-semibold tabular-nums leading-tight break-all ${(selectedCustomer.walletBalance || 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-app-text'}`}>
                    {(selectedCustomer.walletBalance || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {/* Quick actions: what people come here to do */}
              <div className="grid grid-cols-4 gap-1.5 mt-2">
                <a
                  href={`tel:${selectedCustomer.phone}`}
                  className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 rounded-lg bg-app-bg py-1.5 px-1 text-app-text hover:bg-app-border/50"
                >
                  <Phone size={15} />
                  <span className="text-[11px] font-medium">Call</span>
                </a>
                <button onClick={() => openTab('message')} className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 rounded-lg bg-app-bg py-1.5 px-1 text-app-text hover:bg-app-border/50 cursor-pointer">
                  <Send size={15} />
                  <span className="text-[11px] font-medium">Message</span>
                </button>
                <button onClick={() => openTab('money')} className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 rounded-lg bg-app-bg py-1.5 px-1 text-app-text hover:bg-app-border/50 cursor-pointer">
                  <Wallet size={15} />
                  <span className="text-[11px] font-medium">Pay / top up</span>
                </button>
                <button
                  onClick={() => (canInvoice && (selectedCustomer.debtBalance || 0) > 0 ? setInvoiceFor(selectedCustomer) : openTab('invoice'))}
                  className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 rounded-lg bg-app-bg py-1.5 px-1 text-app-text hover:bg-app-border/50 cursor-pointer"
                >
                  <FileText size={15} />
                  <span className="text-[11px] font-medium">Invoice</span>
                </button>
              </div>

              </div>
              <div className="mt-2 lg:mt-0">
                <CustomerRewards customer={selectedCustomer} formatCurrency={formatCurrency} />
              </div>
            </aside>

            {/* Sections */}
            <section id="customer-tabs" className="bg-app-card rounded-2xl px-3 pb-4 sm:px-4 scroll-mt-14">
              {/* Pinned while the section scrolls: under the phone's top bar, at the top on wider screens */}
              <div className="sticky top-14 lg:top-0 z-10 bg-app-card -mx-3 sm:-mx-4 px-3 sm:px-4 pt-3 mb-3 rounded-t-2xl">
                <Tabs<typeof activeDetailTab>
                  tabs={[
                    { id: 'money', label: 'Money' },
                    { id: 'invoice', label: 'Invoices' },
                    { id: 'history', label: 'History' },
                    { id: 'ledger', label: 'Ledger' },
                    { id: 'message', label: 'Message' },
                    { id: 'overview', label: 'Profile' },
                  ]}
                  activeTab={activeDetailTab}
                  onChange={(tab) => {
                    setActiveDetailTab(tab);
                    setSuccessMsg('');
                  }}
                  className="!pb-2.5"
                />
              </div>

              {/* Scrollable Viewport */}
              <div>
                {/* MONEY TAB: debt payments, wallet, debt added by hand */}
                {activeDetailTab === 'money' && (() => {
                  const debt = selectedCustomer.debtBalance || 0;
                  const wallet = selectedCustomer.walletBalance || 0;
                  const amount = adjustAmt;
                  const cashier = currentEmployee?.name || 'System';
                  const card = 'rounded-2xl ring-1 ring-app-border p-4';
                  const action = 'w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
                  return (
                    <div className="flex flex-col gap-3">
                      <div className="rounded-2xl bg-app-bg p-4">
                        <label htmlFor="money-amount" className="block text-xs font-medium text-app-text-muted mb-1">Amount (KSh)</label>
                        <input
                          id="money-amount"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          placeholder="0"
                          value={amount === 0 ? '' : amount}
                          onChange={(e) => setAdjustAmt(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full bg-app-card rounded-xl px-3 py-3 text-2xl font-semibold tabular-nums text-app-text focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                        <label htmlFor="money-note" className="block text-xs font-medium text-app-text-muted mt-3 mb-1">Note (optional)</label>
                        <input
                          id="money-note"
                          type="text"
                          value={adjustNote}
                          onChange={(e) => setAdjustNote(e.target.value)}
                          placeholder="M-Pesa code, reason…"
                          className="w-full bg-app-card rounded-xl px-3 py-2.5 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>

                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className={card}>
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="text-sm font-semibold">Debt payment</h4>
                            <span className={`text-sm font-semibold tabular-nums ${debt > 0 ? 'text-red-600 dark:text-red-400' : 'text-app-text-muted'}`}>Owes {formatCurrency(debt)}</span>
                          </div>
                          <p className="text-xs text-app-text-muted mt-0.5">Money paid towards what they owe.</p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3" role="radiogroup" aria-label="Paid by">
                            {MONEY_METHODS.map((m) => (
                              <button
                                key={m}
                                type="button"
                                role="radio"
                                aria-checked={payMethod === m}
                                onClick={() => setPayMethod(m)}
                                className={`py-2 rounded-xl text-sm font-medium cursor-pointer ring-1 ${payMethod === m ? 'bg-amber-500/10 ring-amber-500 text-amber-700 dark:text-amber-400' : 'ring-app-border text-app-text-muted'}`}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                          {debt > 0 && amount !== debt && (
                            <button type="button" onClick={() => setAdjustAmt(debt)} className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline cursor-pointer">
                              Pay all {formatCurrency(debt)}
                            </button>
                          )}
                          {amount > debt && debt > 0 && <p className="mt-2 text-xs text-red-600 dark:text-red-400">That is more than they owe.</p>}
                          <button
                            type="button"
                            disabled={amount <= 0 || debt <= 0 || amount > debt || isPayingDebt}
                            onClick={() =>
                              runMoney(setIsPayingDebt, () => payCustomerDebt(selectedCustomer.id, amount, payMethod, cashier, adjustNote, `pay-${Date.now()}`), {
                                banner: 'Payment recorded.',
                                title: 'Payment recorded',
                                text: `${formatCurrency(amount)} by ${payMethod} from ${selectedCustomer.name}.`,
                              })
                            }
                            className={`${action} mt-3 bg-emerald-600 hover:bg-emerald-700 text-white`}
                          >
                            {isPayingDebt ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />} Record payment
                          </button>
                        </div>

                        <div className={card}>
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="text-sm font-semibold">Wallet</h4>
                            <span className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(wallet)}</span>
                          </div>
                          <p className="text-xs text-app-text-muted mt-0.5">Money kept for their next purchases.</p>
                          <div className="grid grid-cols-2 gap-2 mt-3">
                            <button
                              type="button"
                              disabled={amount <= 0 || isDepositingWallet}
                              onClick={() =>
                                runMoney(setIsDepositingWallet, () => depositCustomerWallet(selectedCustomer.id, amount, cashier, adjustNote, `dep-${Date.now()}`), {
                                  banner: 'Added to the wallet.',
                                  title: 'Wallet topped up',
                                  text: `${formatCurrency(amount)} added for ${selectedCustomer.name}.`,
                                })
                              }
                              className={`${action} bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20`}
                            >
                              {isDepositingWallet ? <RefreshCw size={15} className="animate-spin" /> : null} Add
                            </button>
                            <button
                              type="button"
                              disabled={amount <= 0 || wallet < amount || isSpendingWallet}
                              onClick={() =>
                                runMoney(setIsSpendingWallet, () => spendCustomerWallet(selectedCustomer.id, amount, cashier, adjustNote, `spend-${Date.now()}`), {
                                  banner: 'Taken from the wallet.',
                                  title: 'Wallet used',
                                  text: `${formatCurrency(amount)} used from ${selectedCustomer.name}'s wallet.`,
                                })
                              }
                              className={`${action} bg-app-bg hover:bg-app-border/50 text-app-text`}
                            >
                              {isSpendingWallet ? <RefreshCw size={15} className="animate-spin" /> : null} Use
                            </button>
                          </div>
                          {amount > wallet && amount > 0 && <p className="mt-2 text-xs text-app-text-muted">The wallet has less than this, so it can only be added.</p>}
                        </div>
                      </div>

                      <div className={card}>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-semibold">Add to their debt</h4>
                            <p className="text-xs text-app-text-muted mt-0.5">For money owed outside a sale, such as an old balance. Credit sales are added by themselves.</p>
                          </div>
                          <button
                            type="button"
                            disabled={amount <= 0 || isAddingDebt}
                            onClick={() =>
                              runMoney(setIsAddingDebt, () => adjustCustomerDebt(selectedCustomer.id, amount, 'add', cashier, adjustNote, `debt-${Date.now()}`), {
                                banner: 'Added to their debt.',
                                title: 'Debt added',
                                text: `${formatCurrency(amount)} added to what ${selectedCustomer.name} owes.`,
                              })
                            }
                            className={`${action} sm:w-auto sm:px-4 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20`}
                          >
                            {isAddingDebt ? <RefreshCw size={15} className="animate-spin" /> : null} Add to debt
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 1. OVERVIEW & PROFILE TAB */}
                {activeDetailTab === 'overview' && (
                  <div className="flex flex-col gap-4 text-xs">
                    {/* Basic Info editing */}
                    <div className="flex flex-col gap-3 bg-app-bg p-4 border border-app-border rounded-2xl">
                      <h4 className="text-sm font-semibold text-app-text">
                        Details
                      </h4>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-app-text-muted">
                            Name
                          </label>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="bg-app-card border border-app-border rounded-xl px-3 py-2 text-sm text-app-text focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-app-text-muted">
                            Phone
                          </label>
                          <div className="grid  grid-cols-4 gap-1.5">
                            <SearchableDropdown
                              items={SUPPORTED_COUNTRIES.map((country) => ({
                                id: country.code,
                                label: `${country.code}`,
                              }))}
                              selectedValue={editCountryCode}
                              onChange={(val) => setEditCountryCode(val)}
                              placeholder="Code"
                              className="w-28 shrink-0 col-span-1 "
                            />
                            <input
                              type="text"
                              value={editPhone}
                              onChange={(e) => setEditPhone(e.target.value)}
                              className="flex-1 col-span-3 bg-app-card border border-app-border rounded-xl px-3 py-2 text-sm text-app-text focus:outline-none focus:border-amber-500 tabular-nums"
                            />
                          </div>
                        </div>
                      </div>

                      <CustomerGroupFields
                        values={editGroups}
                        onChange={(key, value) => setEditGroups((prev) => ({ ...prev, [key]: value }))}
                      />

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-app-text-muted">
                            Points
                          </label>
                          <input
                            type="number"
                            value={editPoints}
                            disabled={!canAdjustPoints}
                            onChange={(e) =>
                              setEditPoints(parseInt(e.target.value) || 0)
                            }
                            className="bg-app-card border border-app-border rounded-xl px-3 py-2 text-sm text-app-text focus:outline-none focus:border-amber-500 tabular-nums"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-app-text-muted">
                            Tier
                          </label>
                          <SearchableDropdown
                            items={[
                              { id: 'Bronze', label: 'Bronze Tier Club' },
                              { id: 'Silver', label: 'Silver Tier Club' },
                              { id: 'Gold', label: 'Gold Tier Club' },
                            ]}
                            selectedValue={editTier}
                            onChange={(val) => setEditTier(val as any)}
                            placeholder="Select badge..."
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-app-text-muted">
                          Email
                        </label>
                        <input
                          type="email"
                          disabled
                          value={editEmail}
                          className="bg-app-card/50 border border-app-border/40 opacity-70 rounded-xl px-3 py-2 text-xs text-app-text cursor-not-allowed font-medium"
                          title="Emails are secured for fraud prevention."
                        />
                      </div>

                <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-app-text-muted">
                          Notes
                        </label>
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
                            showToast(
                              'Input Validation',
                              'Customer name cannot be empty.',
                              undefined,
                              'error',
                            );
                            return;
                          }
                          const fullPhone = normalizePhone(
                            editPhone,
                            editCountryCode,
                          );
                          if (!validatePhone(fullPhone)) {
                            showToast(
                              'Input Validation',
                              'Invalid phone number or length for the selected country.',
                              undefined,
                              'error',
                            );
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
                              ...editGroups,
                            });
                            playSfx('save');
                            setSuccessMsg(
                              'Customer record updated successfully!',
                            );
                            setTimeout(() => setSuccessMsg(''), 3000);
                            showToast(
                              'Profile Updated',
                              `Customer "${editName}" successfully updated in database.`,
                              undefined,
                              'success',
                            );
                          } catch (err: any) {
                            showToast(
                              'Database Error',
                              toUserMessage(err, "Failed to update customer."),
                              undefined,
                              'error',
                            );
                          } finally {
                            setIsSavingProfile(false);
                          }
                        }}
                        className="w-full mt-2.5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-semibold rounded-xl text-sm transition cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        {isSavingProfile ? (
                          <>
                            <RefreshCw size={13} className="animate-spin" />
                            <span>Saving…</span>
                          </>
                        ) : (
                          'Save changes'
                        )}
                      </button>
                    </div>

                    {/* Dangerous Action: Delete Profile */}
                    {canDeleteCustomers && (
                      <div className="bg-red-500/5 p-4 border border-red-500/15 rounded-2xl flex flex-col gap-2 mt-2">
                        <div>
                          <h4 className="text-[10px] font-extrabold text-red-500 uppercase tracking-wider font-display">
                            Delete customer
                          </h4>
                          <p className="text-[9px] text-app-text-muted mt-0.5 font-bold">
                            Delete this customer loyalty account permanently.
                            All accumulated perks, wallet credits, and history
                            will be lost.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isDeletingCustomer}
                          onClick={() => removeCustomer(selectedCustomer)}
                          className="w-full py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-1 transition cursor-pointer"
                        >
                          {isDeletingCustomer ? (
                            <>
                              <RefreshCw size={13} className="animate-spin" />
                              <span>Deleting…</span>
                            </>
                          ) : (
                            <>
                              <Trash2 size={13} />
                              <span>Delete customer</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 5. CUSTOMER LEDGER TAB */}
                {activeDetailTab === 'ledger' && (
                  <div className="flex flex-col gap-2.5 text-xs">
                    <div className="flex items-center justify-between border-b border-app-border/40 pb-1.5 mb-1">
                      <h4 className="text-sm font-semibold text-app-text">
                        Wallet and debt record
                      </h4>
                      <button
                        onClick={async () => {
                          setLoadingLedger(true);
                          try {
                            const entries =
                              await SupabaseService.fetchCustomerLedger(
                                selectedCustomer.id,
                              );
                            setLedgerEntries(entries);
                          } finally {
                            setLoadingLedger(false);
                          }
                        }}
                        className="text-[9px] font-black text-amber-500 hover:underline uppercase transition cursor-pointer"
                      >
                        Refresh
                      </button>
                    </div>

                    {loadingLedger ? (
                      <div className="py-8 text-center text-xs text-app-text-muted font-bold flex items-center justify-center gap-2">
                        <RefreshCw
                          size={12}
                          className="animate-spin text-amber-500"
                        />
                        <span>Loading ledger history...</span>
                      </div>
                    ) : ledgerEntries.length === 0 ? (
                      <div className="p-8 text-center text-xs text-app-text-muted bg-app-bg border border-app-border rounded-2xl font-bold">
                        No ledger transactions recorded yet for this customer.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {ledgerEntries.map((entry) => {
                          let typeLabel = entry.type;
                          let typeColor = 'text-app-text';
                          let amountSign = '';

                          switch (entry.type) {
                            case 'wallet_topup':
                              typeLabel = 'Wallet Top-up';
                              typeColor = 'text-emerald-500';
                              amountSign = '+';
                              break;
                            case 'wallet_usage':
                              typeLabel = 'Wallet Spending';
                              typeColor = 'text-amber-500';
                              amountSign = '-';
                              break;
                            case 'debt_creation':
                              typeLabel = 'Debt Incurred';
                              typeColor = 'text-red-500';
                              amountSign = '+';
                              break;
                            case 'debt_payment':
                              typeLabel = 'Debt Payment';
                              typeColor = 'text-emerald-500';
                              amountSign = '-';
                              break;
                            case 'debt_adjustment':
                              typeLabel = 'Debt Adjustment';
                              typeColor = 'text-blue-500';
                              break;
                            case 'refund':
                              typeLabel = 'Refund';
                              typeColor = 'text-purple-500';
                              amountSign = '+';
                              break;
                          }

                          return (
                            <div
                              key={entry.id}
                              className="bg-app-bg p-3 border border-app-border rounded-2xl flex flex-col gap-1 shadow-xs"
                            >
                              <div className="flex justify-between items-center text-[10.5px]">
                                <span className={`font-black ${typeColor}`}>
                                  {typeLabel}
                                </span>
                                <span className="text-app-text-muted text-[9px] font-bold">
                                  {entry.created_at
                                    ? new Date(
                                        entry.created_at,
                                      ).toLocaleString()
                                    : ''}
                                </span>
                              </div>

                              <div className="flex justify-between items-center font-bold text-xs mt-1">
                                <span className="text-app-text-muted">
                                  Amount:
                                </span>
                                <span
                                  className={`font-mono font-black ${typeColor}`}
                                >
                                  {amountSign}KSh{' '}
                                  {entry.amount.toLocaleString()}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-2 text-[10px] text-app-text-muted border-t border-app-border/40 pt-1.5 mt-1 font-bold">
                                <div>
                                  Wallet: KSh{' '}
                                  {entry.walletBalance.toLocaleString()}
                                </div>
                                <div className="text-right">
                                  Debt: KSh {entry.debtBalance.toLocaleString()}
                                </div>
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

                {/* 2. CUSTOMER HISTORY & EVENT LOG TAB */}
                {activeDetailTab === 'history' && (
                  <div className="flex flex-col gap-4 text-xs">
                    {/* Summary Metric Header */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="bg-app-bg p-3 border border-app-border rounded-2xl flex flex-col gap-1">
                        <span className="text-xs text-app-text-muted">Total Sales Done</span>
                        <span className="text-sm font-black font-mono text-amber-500">{formatCurrency(historyStats.totalSalesAmt)}</span>
                        <span className="text-[9px] font-semibold text-app-text-muted">{historyStats.salesCount} transaction{historyStats.salesCount === 1 ? '' : 's'}</span>
                      </div>
                      <div className="bg-app-bg p-3 border border-app-border rounded-2xl flex flex-col gap-1">
                        <span className="text-xs text-app-text-muted">Credit Sales (Unpaid)</span>
                        <span className="text-sm font-black font-mono text-red-500">{formatCurrency(historyStats.creditSalesAmt)}</span>
                        <span className="text-[9px] font-semibold text-app-text-muted">Purchases on Credit</span>
                      </div>
                      <div className="bg-app-bg p-3 border border-app-border rounded-2xl flex flex-col gap-1">
                        <span className="text-xs text-app-text-muted">Credit Repayments</span>
                        <span className="text-sm font-black font-mono text-emerald-500">{formatCurrency(historyStats.totalRepaymentsAmt)}</span>
                        <span className="text-[9px] font-semibold text-app-text-muted">Paid for Debt</span>
                      </div>
                      <div className="bg-app-bg p-3 border border-app-border rounded-2xl flex flex-col gap-1">
                        <span className="text-xs text-app-text-muted">Current Debt / Wallet</span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-black font-mono text-red-500">D: {formatCurrency(selectedCustomer.debtBalance || 0)}</span>
                          <span className="text-[10px] text-app-text-muted">|</span>
                          <span className="text-xs font-black font-mono text-emerald-500">W: {formatCurrency(selectedCustomer.walletBalance || 0)}</span>
                        </div>
                        <span className="text-[9px] font-semibold text-app-text-muted">Live Account Balances</span>
                      </div>
                    </div>

                    {/* Search & Filter Controls */}
                    <div className="bg-app-bg p-3 border border-app-border rounded-2xl flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
                      {/* Category Filter Chips */}
                      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
                        {[
                          { id: 'all', label: 'All Events' },
                          { id: 'sales', label: 'Sales & Purchases' },
                          { id: 'credit', label: 'Credit Repayments' },
                          { id: 'wallet', label: 'Wallet & Ledger' },
                        ].map((f) => (
                          <button
                            key={f.id}
                            onClick={() => setHistoryFilter(f.id as any)}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-extrabold transition cursor-pointer border shrink-0 ${
                              historyFilter === f.id
                                ? 'bg-amber-500 text-black border-amber-500 font-black'
                                : 'bg-app-card border-app-border/60 text-app-text-muted hover:text-app-text'
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>

                      {/* Date Range & Search Input */}
                      <div className="flex items-center gap-2">
                        <SearchableDropdown
                          className="sm:w-36"
                          items={[
                            { id: 'all', label: 'All Time' },
                            { id: '7days', label: 'Last 7 Days' },
                            { id: '30days', label: 'Last 30 Days' },
                          ]}
                          selectedValue={historyDateRange}
                          onChange={(value) => setHistoryDateRange(value as typeof historyDateRange)}
                          placeholder="Date range"
                        />

                        <div className="relative flex-1 sm:w-44">
                          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-app-text-muted" />
                          <input
                            type="text"
                            placeholder="Search events, products..."
                            value={historySearch}
                            onChange={(e) => setHistorySearch(e.target.value)}
                            className="w-full bg-app-card border border-app-border rounded-xl pl-8 pr-7 py-1.5 text-[10px] text-app-text focus:outline-none focus:border-amber-500 font-semibold"
                          />
                          {historySearch && (
                            <button
                              onClick={() => setHistorySearch('')}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-app-text-muted hover:text-app-text cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Event Timeline List */}
                    {loadingHistory ? (
                      <div className="p-8 text-center text-xs text-app-text-muted bg-app-bg border border-app-border rounded-2xl font-bold flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-amber-500" />
                        Loading history events...
                      </div>
                    ) : filteredHistoryEvents.length === 0 ? (
                      <div className="p-8 text-center text-xs text-app-text-muted bg-app-bg border border-app-border rounded-2xl font-bold">
                        {historySearch || historyFilter !== 'all' || historyDateRange !== 'all'
                          ? 'No history events match your selected filters.'
                          : 'No history events recorded yet for this customer.'}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {filteredHistoryEvents.map((ev) => {
                          const evDateStr = new Date(ev.timestamp).toLocaleString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          });

                          // RENDER SALE EVENT
                          if (ev.eventType === 'sale' && ev.rawSale) {
                            const tx: Transaction = ev.rawSale;
                            const isExpanded = expandedTxId === tx.id;

                            return (
                              <div
                                key={ev.id}
                                className="bg-app-bg p-4 border border-app-border rounded-2xl flex flex-col gap-3 shadow-xs hover:border-app-border/80 transition"
                              >
                                {/* Event Header */}
                                <div className="flex flex-wrap justify-between items-start gap-2">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                                      <ShoppingBag className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-extrabold text-app-text text-xs">{ev.title}</span>
                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${ev.paymentStatusStyle}`}>
                                          {ev.paymentStatusLabel}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2 text-[10px] text-app-text-muted font-mono mt-0.5">
                                        <span>{ev.subtitle}</span>
                                        <span>•</span>
                                        <span>{evDateStr}</span>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-black font-mono text-amber-500">
                                      {formatCurrency(tx.finalTotal)}
                                    </span>
                                    <button
                                      onClick={() => setExpandedTxId(isExpanded ? null : tx.id)}
                                      className="p-1 text-app-text-muted hover:text-app-text rounded-lg hover:bg-app-card transition cursor-pointer"
                                      title={isExpanded ? 'Collapse products' : 'Expand products details'}
                                    >
                                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    </button>
                                  </div>
                                </div>

                                {/* Products Itemized Table */}
                                <div className="bg-app-card border border-app-border/60 rounded-xl p-3 flex flex-col gap-2">
                                  <div className="text-[9.5px] font-black uppercase text-app-text-muted tracking-wider border-b border-app-border/40 pb-1 flex justify-between">
                                    <span>Products Purchased ({tx.items?.length || 0})</span>
                                    <span>Amount</span>
                                  </div>

                                  <div className="flex flex-col gap-1.5">
                                    {tx.items?.map((item, idx) => {
                                      const lineTotal = (item.product?.price || 0) * item.quantity;
                                      return (
                                        <div key={idx} className="flex justify-between items-center text-[11px]">
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-bold text-app-text">{item.product?.name || 'Item'}</span>
                                            <span className="text-[10px] font-extrabold text-amber-500 bg-amber-500/10 px-1.5 py-0.2 rounded-md">
                                              x{item.quantity}
                                            </span>
                                            <span className="text-[10px] text-app-text-muted font-mono">
                                              @ {formatCurrency(item.product?.price || 0)}
                                            </span>
                                          </div>
                                          <span className="font-mono font-bold text-app-text">{formatCurrency(lineTotal)}</span>
                                        </div>
                                      );
                                    })}
                                  </div>

                                  {/* Financial Details (subtotal, tax, discount, delivery) */}
                                  <div className="border-t border-app-border/40 pt-2 mt-1 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-semibold text-app-text-muted">
                                    <div>Subtotal: <span className="font-mono text-app-text">{formatCurrency(tx.total)}</span></div>
                                    {tx.discount > 0 && <div>Discount: <span className="font-mono text-emerald-500">-{formatCurrency(tx.discount)}</span></div>}
                                    {tx.tax > 0 && <div>Tax: <span className="font-mono text-app-text">{formatCurrency(tx.tax)}</span></div>}
                                    {tx.isDelivery && <div>Delivery: <span className="font-mono text-blue-400">{formatCurrency(tx.deliveryFee || 0)}</span></div>}
                                  </div>
                                </div>

                                {/* Footer details: Payment Status & Staff & Receipt Share */}
                                <div className="flex flex-wrap justify-between items-center text-[10px] text-app-text-muted font-semibold pt-0.5">
                                  <div className="flex items-center gap-3">
                                    <span>Method: <strong className="text-app-text font-extrabold">{tx.paymentMethod}</strong></span>
                                    <span>Staff: <strong className="text-app-text font-extrabold">{tx.staffName || 'Cashier'}</strong></span>
                                    {tx.riderName && <span>Rider: <strong className="text-blue-400 font-extrabold">{tx.riderName}</strong></span>}
                                  </div>

                                  <button
                                    onClick={() => setReceiptTx(tx)}
                                    className="flex items-center gap-1 text-[10px] font-extrabold text-amber-500 hover:text-amber-400 transition cursor-pointer"
                                  >
                                    <Share2 className="w-3 h-3" />
                                    <span>Receipt</span>
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          // RENDER CREDIT / DEBT REPAYMENT EVENT
                          if (ev.eventType === 'credit_payment' && ev.rawPayment) {
                            const dp: DebtPayment = ev.rawPayment;
                            return (
                              <div
                                key={ev.id}
                                className="bg-app-bg p-4 border border-emerald-500/30 rounded-2xl flex flex-col gap-2.5 shadow-xs"
                              >
                                <div className="flex flex-wrap justify-between items-start gap-2">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
                                      <CreditCard className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-extrabold text-app-text text-xs">{ev.title}</span>
                                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                                          Credit Payment
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-app-text-muted font-mono mt-0.5">
                                        {evDateStr} • Paid via {dp.paymentMethod || 'Cash'}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="text-right">
                                    <span className="text-sm font-black font-mono text-emerald-500">
                                      + {formatCurrency(dp.amountPaid)}
                                    </span>
                                    <div className="text-[9.5px] font-bold text-app-text-muted font-mono">
                                      Remaining Debt: {formatCurrency(dp.remainingDebt)}
                                    </div>
                                  </div>
                                </div>

                                {(dp.note || dp.recordedBy) && (
                                  <div className="bg-app-card border border-app-border/40 rounded-xl p-2 flex justify-between items-center text-[10px] text-app-text-muted font-medium">
                                    {dp.note && <span>Note: <i className="text-app-text font-normal">{dp.note}</i></span>}
                                    {dp.recordedBy && <span className="ml-auto font-bold text-app-text-muted">Recorded By: {dp.recordedBy}</span>}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          // RENDER WALLET / LEDGER ADJUSTMENT EVENT
                          if (ev.eventType === 'wallet_ledger' && ev.rawLedger) {
                            const entry: CustomerLedgerEntry = ev.rawLedger;
                            const isDeposit = entry.type === 'wallet_topup';
                            const isSpent = entry.type === 'wallet_usage';

                            return (
                              <div
                                key={ev.id}
                                className="bg-app-bg p-4 border border-app-border rounded-2xl flex flex-col gap-2.5 shadow-xs"
                              >
                                <div className="flex flex-wrap justify-between items-start gap-2">
                                  <div className="flex items-center gap-2.5">
                                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                                      isDeposit ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500' :
                                      isSpent ? 'bg-purple-500/10 border border-purple-500/20 text-purple-400' :
                                      'bg-blue-500/10 border border-blue-500/20 text-blue-400'
                                    }`}>
                                      <Wallet className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-extrabold text-app-text text-xs">{ev.title}</span>
                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${ev.paymentStatusStyle}`}>
                                          {ev.paymentStatusLabel}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-app-text-muted font-mono mt-0.5">
                                        {evDateStr}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="text-right">
                                    <span className={`text-sm font-black font-mono ${isDeposit ? 'text-emerald-500' : isSpent ? 'text-purple-400' : 'text-blue-400'}`}>
                                      {isDeposit ? '+' : isSpent ? '-' : ''} {formatCurrency(entry.amount)}
                                    </span>
                                    <div className="text-[9.5px] font-bold text-app-text-muted font-mono">
                                      Wallet: {formatCurrency(entry.walletBalance)} | Debt: {formatCurrency(entry.debtBalance)}
                                    </div>
                                  </div>
                                </div>

                                {(entry.note || entry.recordedBy) && (
                                  <div className="bg-app-card border border-app-border/40 rounded-xl p-2 flex justify-between items-center text-[10px] text-app-text-muted font-medium">
                                    {entry.note && <span>Note: <i className="text-app-text font-normal">{entry.note}</i></span>}
                                    {entry.recordedBy && <span className="ml-auto font-bold text-app-text-muted">Recorded By: {entry.recordedBy}</span>}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return null;
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. SEND MESSAGE TAB */}
                {activeDetailTab === 'message' && (
                  <div className="flex flex-col gap-4 text-xs">
                    <div className="bg-app-bg p-4 border border-app-border rounded-2xl flex flex-col gap-3.5">
                      <h4 className="text-sm font-semibold text-app-text">
                        Send a message
                      </h4>

                      {/* Debt breakdown automated card if has debt */}
                      {selectedCustomer.debtBalance !== undefined &&
                        selectedCustomer.debtBalance > 0 && (
                          <div className="bg-red-500/5 border border-red-500/15 p-3.5 rounded-2xl flex flex-col gap-2 animate-fade-in">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-red-500 font-extrabold uppercase text-[10px] tracking-wider">
                                <Brain size={13} className="text-red-500" />
                                <span>
                                  What they owe, item by item
                                </span>
                              </div>
                            </div>
                            <p className="text-[9.5px] text-app-text-muted leading-relaxed font-bold">
                              Generate and load a detailed billing breakdown
                              including all unpaid items, quantities, taxes, and
                              delivery fees for this client.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                const debtMsg =
                                  getDebtBreakdownMessage(selectedCustomer);
                                setMessageText(debtMsg);
                                setSuccessMsg(
                                  'Loaded detailed debt statement breakdown!',
                                );
                                setTimeout(() => setSuccessMsg(''), 3000);
                              }}
                              className="self-start px-3.5 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-[9.5px] font-black uppercase transition cursor-pointer flex items-center gap-1 shadow-sm"
                            >
                              <Coins size={11} />
                              <span>Use this in the message</span>
                            </button>
                          </div>
                        )}

                      {/* Outreach Templates */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-app-text-muted">
                          Templates
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {[
                            {
                              label: 'Payment reminder',
                              text: `Hi ${getFirstName(selectedCustomer.name)}, this is a reminder that your balance at ${shopName} is ${formatCurrency(
                                selectedCustomer.debtBalance || 0,
                              )}. Please pay when you can. Thank you!`,
                            },
                            {
                              label: 'Thank you',
                              text: `Hi ${getFirstName(selectedCustomer.name)}, thank you for shopping at ${shopName}. We appreciate you!`,
                            },
                            {
                              label: 'Points balance',
                              text: `Hi ${getFirstName(selectedCustomer.name)}, you have ${selectedCustomer.loyaltyPoints || 0} loyalty points at ${shopName}.`,
                            },
                            {
                              label: 'Wallet balance',
                              text: `Hi ${getFirstName(selectedCustomer.name)}, your wallet balance at ${shopName} is ${formatCurrency(
                                selectedCustomer.walletBalance || 0,
                              )}.`,
                            },
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
                        <label className="text-xs font-medium text-app-text-muted">
                          Message
                        </label>
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
                          onClick={() =>
                            ReceiptShareService.shareTextViaWhatsApp(
                              selectedCustomer.phone,
                              messageText,
                            )
                          }
                          className="py-2.5 bg-[#25D366] text-white hover:bg-[#20ba59] font-black rounded-xl text-[11px] text-center flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
                        >
                          <Send size={12} />
                          <span>WhatsApp</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            ReceiptShareService.shareTextViaEmail(
                              selectedCustomer.email,
                              `Your account at ${shopName}`,
                              messageText,
                            )
                          }
                          className="py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-[11px] text-center flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
                        >
                          <Mail size={12} />
                          <span>Email</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. INVOICES TAB */}
                {activeDetailTab === 'invoice' && (
                  <div className="flex flex-col gap-4">
                    <div className="rounded-2xl bg-app-bg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-app-text-muted">Owes now</div>
                        <div className={`text-xl font-semibold tabular-nums ${(selectedCustomer.debtBalance || 0) > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                          {formatCurrency(selectedCustomer.debtBalance || 0)}
                        </div>
                        <p className="text-xs text-app-text-muted mt-0.5">
                          {(selectedCustomer.debtBalance || 0) > 0
                            ? 'An invoice lists every unpaid credit sale, delivery and balance, and gets the next invoice number.'
                            : 'Nothing is owed, so there is nothing to invoice.'}
                        </p>
                      </div>
                      {canInvoice && (
                        <button
                          type="button"
                          disabled={(selectedCustomer.debtBalance || 0) <= 0}
                          onClick={() => setInvoiceFor(selectedCustomer)}
                          className="shrink-0 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <FileText size={16} /> Make invoice
                        </button>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h4 className="text-sm font-semibold">{invoiceView === 'archived' ? 'Archived invoices' : 'Invoices sent'}</h4>
                        <div className="flex items-center gap-3">
                          {(invoiceView === 'archived' || invoices.some((i) => i.archivedAt)) && (
                            <button
                              type="button"
                              onClick={() => setInvoiceView(invoiceView === 'archived' ? 'active' : 'archived')}
                              className="text-xs font-medium text-app-text-muted hover:text-app-text flex items-center gap-1 cursor-pointer"
                            >
                              {invoiceView === 'archived' ? <><ArrowLeft size={13} /> Back</> : <><Archive size={13} /> Archived ({invoices.filter((i) => i.archivedAt).length})</>}
                            </button>
                          )}
                          <button type="button" onClick={loadInvoices} className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline cursor-pointer">
                            Refresh
                          </button>
                        </div>
                      </div>
                      {(() => {
                        const shown = invoices.filter((i) => (invoiceView === 'archived' ? !!i.archivedAt : !i.archivedAt));
                        if (invoicesState === 'loading') return <div className="py-8 flex justify-center text-app-text-muted"><RefreshCw size={16} className="animate-spin" /></div>;
                        if (invoicesState === 'error') return <p className="p-4 rounded-2xl bg-app-bg text-sm text-app-text-muted">{invoicesError}</p>;
                        if (shown.length === 0) {
                          return (
                            <p className="p-4 rounded-2xl bg-app-bg text-sm text-app-text-muted">
                              {invoiceView === 'archived' ? 'No archived invoices.' : invoices.length > 0 ? 'Every invoice is archived.' : 'No invoices yet.'}
                            </p>
                          );
                        }
                        return (
                          <>
                            <ul className="rounded-2xl bg-app-bg divide-y divide-app-border/60 overflow-hidden">
                              {shown.map((inv) => {
                                const archived = !!inv.archivedAt;
                                const archiveAction = {
                                  label: archived ? 'Restore' : 'Archive',
                                  icon: archived ? <ArchiveRestore size={18} /> : <Archive size={18} />,
                                  tone: 'sky' as const,
                                  hidden: !canInvoice,
                                  onClick: () => toggleInvoiceArchived(inv),
                                };
                                const deleteAction = {
                                  label: 'Delete',
                                  icon: <Trash2 size={18} />,
                                  tone: 'red' as const,
                                  hidden: !canInvoice,
                                  onClick: () => removeInvoice(inv),
                                };
                                return (
                                  <SwipeRow
                                    key={inv.id}
                                    as="li"
                                    surfaceClassName="bg-app-bg"
                                    title={`Invoice ${inv.invoiceNo}`}
                                    subtitle={`${formatInvoiceDate(inv.issuedAt)} · ${formatCurrency(inv.balanceDue)}`}
                                    actions={[archiveAction, deleteAction]}
                                    more={[
                                      { label: 'Open and share', icon: <FileText size={16} />, onClick: () => setOpenInvoice(inv.document) },
                                      { ...archiveAction, icon: archived ? <ArchiveRestore size={16} /> : <Archive size={16} /> },
                                      { ...deleteAction, icon: <Trash2 size={16} /> },
                                    ]}
                                  >
                                    <div className="flex items-center group">
                                      <button
                                        type="button"
                                        onClick={() => setOpenInvoice(inv.document)}
                                        className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left hover:bg-app-card cursor-pointer"
                                      >
                                        <span className="size-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0"><FileText size={16} /></span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block text-sm font-medium">{inv.invoiceNo}</span>
                                          <span className="block text-xs text-app-text-muted truncate">
                                            {formatInvoiceDate(inv.issuedAt)}{inv.createdBy ? ` · by ${inv.createdBy}` : ''}
                                          </span>
                                        </span>
                                        <span className="text-sm font-semibold tabular-nums shrink-0">{formatCurrency(inv.balanceDue)}</span>
                                      </button>
                                      {canInvoice && (
                                        // Desktop: buttons on hover. Phones swipe or hold instead.
                                        <div className="hidden md:flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                          <button type="button" onClick={() => toggleInvoiceArchived(inv)} title={archived ? 'Restore' : 'Archive'} aria-label={archived ? 'Restore invoice' : 'Archive invoice'} className="p-1.5 rounded-lg text-app-text-muted hover:text-sky-600 hover:bg-app-card cursor-pointer">
                                            {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                                          </button>
                                          <button type="button" onClick={() => removeInvoice(inv)} title="Delete" aria-label="Delete invoice" className="p-1.5 rounded-lg text-app-text-muted hover:text-red-500 hover:bg-app-card cursor-pointer">
                                            <Trash2 size={15} />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </SwipeRow>
                                );
                              })}
                            </ul>
                            {canInvoice && <p className="mt-2 text-center text-[11px] text-app-text-muted md:hidden">Swipe an invoice left to archive or delete · hold for more</p>}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
</div>

              {/* Confirmation after an action */}
              {successMsg && (
                <div className="mt-3 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-3 py-2.5 rounded-xl flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}
            </section>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-app-text-muted">
            <div className="max-w-xs flex flex-col items-center gap-3">
              <div className="p-3 bg-amber-500/10 text-amber-500 rounded-full">
                <Award size={24} />
              </div>
              <h3 className="text-base font-semibold text-app-text">Pick a customer</h3>
              <p className="text-sm leading-relaxed">
                See what they owe, take payments, make invoices, and look through their purchases.
              </p>
            </div>
          </div>
        )}
      </div>

      <InvoiceSheet
        customer={invoiceFor}
        issued={openInvoice}
        onClose={() => {
          setInvoiceFor(null);
          setOpenInvoice(null);
        }}
        onIssued={() => {
          if (activeDetailTab === 'invoice') loadInvoices();
        }}
      />

      {/* Add Customer Modal */}
      <SheetLayer>
      <AnimatePresence>
        {showDuplicates && activeBusinessId && (
          <DuplicateCustomers
            businessId={activeBusinessId}
            customers={customers}
            onClose={() => {
              setShowDuplicates(false);
              refreshDuplicateCount();
            }}
            onMerged={setSelectedCustomerId}
          />
        )}

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
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 max-h-[90%] md:max-h-[85%] bg-app-card rounded-t-[32px] border-t border-app-border shadow-2xl p-5 pb-[calc(1.25rem+var(--inset-bottom))] flex flex-col z-50 overflow-y-auto md:overflow-hidden"
            >
              <div className="w-12 h-1 bg-app-border rounded-full mx-auto mb-4 shrink-0" />

              <h3 className="text-sm font-black font-display text-app-text uppercase tracking-wide">
                Enroll Loyalty Member
              </h3>
              <p className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider mt-0.5">
                Add them to your customer list
              </p>

              <div className="h-[1px] bg-app-border my-3 shrink-0" />

              <form
                onSubmit={handleSubmit}
                className="flex-1 overflow-y-auto flex flex-col gap-3.5 pb-20 text-xs font-semibold"
              >
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">
                    Name *
                  </label>
                  <input
                    type="text"
                    name="name"
                    placeholder="e.g., Sarah Jenkins"
                    value={values.name}
                    onChange={handleChange}
                    className={`bg-app-bg border ${
                      errors.name ? 'border-red-500' : 'border-app-border'
                    } rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500`}
                  />
                  {errors.name && (
                    <span className="text-[9px] text-red-500 font-bold">
                      {errors.name}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">
                    Phone *
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    <SearchableDropdown
                      items={SUPPORTED_COUNTRIES.map((country) => ({
                        id: country.code,
                        label: `${country.flag} ${country.code}`,
                      }))}
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
                      className={`flex-1 bg-app-bg border col-span-3 ${
                        errors.phone ? 'border-red-500' : 'border-app-border'
                      } rounded-xl px-3 py-2 text-sm text-app-text focus:outline-none focus:border-amber-500`}
                    />
                  </div>
                  <span className="text-[8.5px] text-app-text-muted">
                    Stored E.164:{' '}
                    {normalizePhone(values.phone, selectedCountryCode)}
                  </span>
                  {samePhoneCustomer && (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-app-text">
                      <span>{titleCase(samePhoneCustomer.name)} already has this number. Open their record, or continue if this is someone else.</span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAdding(false);
                          setSelectedCustomerId(samePhoneCustomer.id);
                        }}
                        className="shrink-0 font-bold text-amber-500 underline cursor-pointer"
                      >
                        Open
                      </button>
                    </div>
                  )}
                  {errors.phone && (
                    <span className="text-[9px] text-red-500 font-bold">
                      {errors.phone}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">
                    Email Address
                  </label>
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
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Starting Tier
                    </label>
                    <SearchableDropdown
                      items={[
                        { id: 'Bronze', label: 'Bronze' },
                        { id: 'Silver', label: 'Silver' },
                        { id: 'Gold', label: 'Gold' },
                      ]}
                      selectedValue={values.tier}
                      onChange={(val) =>
                        handleChange({
                          target: { name: 'tier', value: val },
                        } as any)
                      }
                      placeholder="Select starting tier..."
                    />
                  </div>
                </div>

                <CustomerGroupFields
                  values={newGroups}
                  onChange={(key, value) => setNewGroups((prev) => ({ ...prev, [key]: value }))}
                />

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">
                    Notes
                  </label>
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
                      'Enroll Customer Profile'
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      </SheetLayer>

      {/* Success Notification */}
      <AnimatePresence>
        {successBanner && (
          <div className="absolute bottom-(--mobile-nav-space) md:bottom-6 left-1/2 transform -translate-x-1/2 bg-emerald-500 text-white px-4 py-2 rounded-full flex items-center gap-1.5 shadow-lg z-50 text-xs font-bold animate-bounce">
            <CheckCircle2 size={14} />
            <span>Loyalty Customer Account Registered!</span>
          </div>
        )}
      </AnimatePresence>

      {/* Floating AI CRM Assistant */}
      <motion.div
        drag
        dragMomentum={false}
        style={{ bottom: 'calc(var(--mobile-nav-space) - 0.5rem)' }}
        className="fixed right-3 md:!bottom-6 md:right-6 z-50 flex flex-col items-end cursor-grab active:cursor-grabbing"
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
                    <h3 className="text-[10px] font-extrabold text-app-text uppercase tracking-wider font-display">
                      CRM Assistant
                    </h3>
                    <span className="text-[8px] text-amber-500 font-bold uppercase tracking-wider block">
                      Assistant Kim
                    </span>
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
                      msg.role === 'user'
                        ? 'self-end items-end'
                        : 'self-start items-start'
                    }`}
                  >
                    <span className="text-[7.5px] font-black uppercase text-app-text-muted mb-0.5 px-0.5">
                      {msg.role === 'user' ? 'You' : 'Kim'}
                    </span>
                    <div
                      className={`p-2.5 rounded-xl text-[10px] leading-relaxed font-medium whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-amber-500 text-slate-950 rounded-tr-none font-bold shadow-xs'
                          : 'bg-app-card border border-app-border rounded-tl-none text-app-text shadow-2xs'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}

                {aiLoading && (
                  <div className="self-start flex flex-col items-start max-w-[85%]">
                    <span className="text-[7.5px] font-black uppercase text-app-text-muted mb-0.5 px-0.5">
                      Kim
                    </span>
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
                <span className="text-[7.5px] font-black text-app-text-muted uppercase tracking-wider px-0.5">
                  Quick Prompts
                </span>
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
                        .filter((c) => c.debtBalance && c.debtBalance > 0)
                        .map(
                          (c) =>
                            `• ${c.name} (${formatCurrency(
                              c.debtBalance || 0,
                            )})`,
                        )
                        .join('\n');
                      const prompt = overdueList
                        ? `Here is the current active client debt roster:\n${overdueList}\n\nProvide an analysis of who we should prioritize contacting and write a polite, professional corporate template we can use for collective follow-ups.`
                        : 'Roster status: Perfect. No client currently carries outstanding debt balance. Draft a generic premium VIP promotional newsletter instead!';
                      handleSendAiMessage(prompt);
                    }}
                    className="px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-md text-[8.5px] font-black uppercase tracking-wide shrink-0 transition"
                  >
                    Analyze Debt 📋
                  </button>
                  <button
                    onClick={() =>
                      handleSendAiMessage(
                        'List 3 unique, high-yield ideas to increase customer retention and milk order subscriptions this week.',
                      )
                    }
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
          <Brain
            size={15}
            className="group-hover:rotate-6 transition-transform"
          />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 border border-app-card rounded-full animate-ping" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 border border-app-card rounded-full" />
        </button>
      </motion.div>
      <ReceiptSheet transaction={receiptTx} onClose={() => setReceiptTx(null)} />
    </div>
  );
}
