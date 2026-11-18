import React, { useState, useRef, useEffect } from "react";
import { pressShortcut } from "../utils/pressShortcut";
import { useAppStore } from "../stores/appStore";
import { useInventoryStore } from "../stores/inventoryStore";
import { useAuthStore } from "../stores/authStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useExtraModulesStore } from "../stores/extraModulesStore";
import { useUiStore } from "../stores/uiStore";
import { ALL_PERMISSIONS, hasRolePermission, getDynamicRoles } from "../utils/permissions";
import { 
  Search, X, ShoppingBag, User, Receipt, Users, Sliders, 
  Bell, Key, FileText, Clock, Home, Bot, Shield, Settings,
  Briefcase, Tag, Boxes, History, Truck, ShoppingCart, CreditCard,
  FilePlus, Package, Factory, Layers, BookOpen, TrendingDown,
  DollarSign, Mail, Activity
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getSupabase } from "../services/supabaseClient";
import { SCREENS, canOpenScreen, type ScreenId } from "../utils/screens";
import { featuresFor, shortcutsFor, scopeLabel } from "../utils/shortcuts";
import { formatReceiptNumber, toUuid } from "../utils/idUtils";
import { receiptCode, matchesReceipt, mentionsReceipt } from "../utils/references";
import { formatReceiptNo } from "../services/receipt/ReceiptGenerator";
import { ReceiptService } from "../services/receipt/ReceiptService";
import { formatInvoiceMoney } from "../services/invoice/invoiceDraft";
import { spotlight } from "../utils/searchSpotlight";
import { listPurchases, listAudit, purchaseRef, describeAction, type PurchaseOrder, type AuditEntry } from "../services/operations";
import { formatCurrency } from '../utils/helpers';

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  businessName?: string;
  status?: string;
  relevance: number; // Relevance score for sorting
  action: () => void;
  /** What to highlight once the screen opens; defaults to a row tagged with `id`, else the title text. */
  spot?: { id?: string; text?: string; press?: string } | false;
}

// Results that open a whole screen or panel rather than one row on it.
const NO_SPOTLIGHT = new Set([
  "Screens", "Features", "Keyboard Shortcuts", "Quick Actions", "Reports", "Settings",
  "Home Dashboard", "Communication Center", "Invoices", "Stock History", "AI Conversations", "Permissions",
  "Audit Logs",
]);

interface GlobalSearchProps {
  onNavigateTab: (tab: ScreenId) => void;
  /** Focus the box as soon as it appears, e.g. after tapping the search icon on a phone. */
  autoFocus?: boolean;
}

export default function GlobalSearch({ onNavigateTab, autoFocus = false }: GlobalSearchProps) {
  const { products, customers, transactions, employees, businesses, activeBusinessId, toggleNetwork } = useAppStore();
  const aiName = import.meta.env?.VITE_AI_NAME || "Kim";
  const { shifts, activeShift, currentEmployee, invitations, users } = useAuthStore();
  const { notifications } = useNotificationStore();
  const setSearchTarget = useUiStore((st) => st.setSearchTarget);
  const setSelectedCustomerId = useUiStore((st) => st.setSelectedCustomerId);
  
  // Extra modules state
  const extra = useExtraModulesStore();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen || !activeBusinessId) return;

    let active = true;
    const fetchSearchData = async () => {
      try {
        const client = getSupabase();
        
        // Fetch suppliers
        const { data: sups } = await client
          .from("suppliers")
          .select("*")
          .eq("business_id", activeBusinessId)
          .is("deleted_at", null);
        
        if (active && sups) {
          setSuppliers(sups);
        }

        // Fetch expenses
        const { data: exps } = await client
          .from("expenses")
          .select("*")
          .eq("business_id", activeBusinessId)
          .is("deleted_at", null);
          
        if (active && exps) {
          setExpenses(exps);
        }

        // Purchases and the audit log, each only for a role that may see it.
        const role = currentEmployee?.role || "Guest";
        const may = (...codes: string[]) => codes.some((c) => hasRolePermission(role, c as any));
        const quiet = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
        const [pur, aud] = await Promise.all([
          may("purchases.view") ? quiet(listPurchases(activeBusinessId, 200)) : Promise.resolve([]),
          may("audit.view") ? quiet(listAudit(activeBusinessId, { limit: 200 })) : Promise.resolve([]),
        ]);
        if (active) {
          setPurchases(pur as PurchaseOrder[]);
          setAuditLogs(aud as AuditEntry[]);
        }
      } catch (e) {
        console.error("Error loading suppliers/expenses for global search:", e);
      }
    };

    fetchSearchData();
    return () => {
      active = false;
    };
  }, [isOpen, activeBusinessId]);

  // Centralized security gate mapping for Global Search modules
  const hasAccessToCategory = (cat: string): boolean => {
    if (!currentEmployee) return false;
    
    // Admins always have master access
    if (currentEmployee.role === "Admin" || currentEmployee.role === "Owner" || currentEmployee.role === "Administrator") {
      return true;
    }

    switch (cat) {
      case "Businesses":
        return hasRolePermission(currentEmployee.role, "business.view");
      case "Products":
      case "Product Categories":
        return hasRolePermission(currentEmployee.role, "products.view");
      case "Inventory":
      case "Inventory Transactions":
        return hasRolePermission(currentEmployee.role, "inventory.view");
      case "Stock History":
        return canOpenScreen(currentEmployee.role, "stock-history");
      case "Customers":
      case "Invoices":
        return hasRolePermission(currentEmployee.role, "customers.view");
      case "Suppliers":
        return hasRolePermission(currentEmployee.role, "suppliers.view");
      case "Sales":
      case "Sale Items":
      case "Payments":
        return canOpenScreen(currentEmployee.role, "money");
      case "Purchases":
      case "Purchase Items":
        return hasRolePermission(currentEmployee.role, "purchases.view");
      case "Production":
      case "Production Batches":
      case "Recipes / BOM":
        return hasRolePermission(currentEmployee.role, "production.view");
      case "Expenses":
        return hasRolePermission(currentEmployee.role, "expenses.view");
      case "Team Members":
      case "Users":
      case "Invitations":
        return hasRolePermission(currentEmployee.role, "staff.view");
      case "Roles":
      case "Permissions":
        return hasRolePermission(currentEmployee.role, "staff.roles");
      case "Wallets":
      case "Debts":
        return hasRolePermission(currentEmployee.role, "customers.view") || hasRolePermission(currentEmployee.role, "customers.loyalty");
      case "AI Conversations":
        return hasRolePermission(currentEmployee.role, "ai.use") || hasRolePermission(currentEmployee.role, "ai.insights");
      case "Notifications":
        return true; // standard alerts
      case "Communication Center":
        return hasRolePermission(currentEmployee.role, "communication.view");
      case "Reports":
        return hasRolePermission(currentEmployee.role, "reports.view");
      case "AI Insights":
        return hasRolePermission(currentEmployee.role, "ai.insights");
      case "Audit Logs":
        return hasRolePermission(currentEmployee.role, "audit.view");
      case "Settings":
        return hasRolePermission(currentEmployee.role, "settings.view");
      case "Features": // already limited to what this role can open and do
      case "Keyboard Shortcuts": // same
      case "Screens": // already limited to screens this role can open
      case "Quick Actions":
      case "Home Dashboard":
      case "Shifts":
        return true;
      default:
        return false;
    }
  };

  // Invoices are kept on the server only: look their numbers up shortly after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || !activeBusinessId || !hasAccessToCategory("Invoices")) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await getSupabase()
          .from("invoices")
          .select("id, invoice_no, customer_id, balance_due, issued_at")
          .eq("business_id", toUuid(activeBusinessId))
          .ilike("invoice_no", `%${q.replace(/[%_,()]/g, "")}%`)
          .order("number", { ascending: false })
          .limit(8);
        if (!live || error || !data?.length) return;
        const exact = q.toLowerCase();
        const hits: SearchResult[] = data.map((r: any) => {
          const customer = customers.find((c) => c.id === r.customer_id);
          return {
            id: `invoice-${r.id}`,
            title: `Invoice ${r.invoice_no}${customer ? ` · ${customer.name}` : ""}`,
            subtitle: `Issued ${String(r.issued_at || "").slice(0, 10).split("-").reverse().join("/")} · Balance due ${formatInvoiceMoney(Number(r.balance_due) || 0, "KSh")} · Opens on the customer's invoices`,
            category: "Invoices",
            relevance: String(r.invoice_no).toLowerCase() === exact ? 115 : 95,
            action: () => {
              setSearchTarget({ kind: "invoice", customerId: r.customer_id, invoiceId: r.id });
              setSelectedCustomerId(r.customer_id);
              onNavigateTab("customers");
              setIsOpen(false);
              setQuery("");
            },
          };
        });
        setResults((prev) => {
          const rest = prev.filter((x) => x.category !== "Invoices");
          return [...hits, ...rest].sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : b.relevance - a.relevance));
        });
      } catch {
        // Offline or invoices not set up: the other results still show.
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, activeBusinessId, isOpen]);

  const handleSearch = (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setResults([]);
      return;
    }

    const matched: SearchResult[] = [];
    const lower = text.toLowerCase().trim();
    // A receipt number in any form (RCT-2026-ABCD1234, TXN-ABCD1234, ABCD1234).
    const code = receiptCode(text);
    const receiptSettings = activeBusinessId ? ReceiptService.getSettings(activeBusinessId) : null;

    // Helper to calculate relevance score
    const getRelevance = (field: string, targetQuery: string) => {
      const target = field.toLowerCase();
      if (target === targetQuery) return 100; // Perfect match
      if (target.startsWith(targetQuery)) return 80; // Prefix match
      if (target.includes(targetQuery)) return 50; // Middle match
      return 0;
    };

    const activeBizName = businesses.find(b => b.id === activeBusinessId)?.name || "Primary Business";

    // Screens this person can open
    const staticPages = SCREENS
      .filter((screen) => canOpenScreen(currentEmployee?.role, screen.id))
      .map((screen) => ({
        id: `nav-${screen.id}`,
        title: screen.title,
        subtitle: screen.description,
        category: "Screens",
        tab: screen.id,
        keywords: screen.keywords,
      }));

    staticPages.forEach(p => {
      const matchTitle = getRelevance(p.title, lower);
      const matchSubtitle = getRelevance(p.subtitle, lower);
      const matchKeyword = p.keywords.some(k => k.includes(lower)) ? 60 : 0;
      const score = Math.max(matchTitle, matchSubtitle, matchKeyword);
      
      if (score > 0) {
        matched.push({
          id: p.id,
          title: p.title,
          subtitle: p.subtitle,
          category: p.category,
          businessName: activeBizName,
          relevance: score + 20, // High relevance for navigation shortcuts
          action: () => {
            onNavigateTab(p.tab);
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // Features by name, and keyboard shortcuts, limited to what this role can do
    const go = (tab: ScreenId) => {
      onNavigateTab(tab);
      setIsOpen(false);
      setQuery("");
    };
    featuresFor(currentEmployee?.role).forEach((f) => {
      const score = Math.max(
        getRelevance(f.title, lower),
        getRelevance(f.description, lower) ? 40 : 0,
        f.keywords.some((k) => k.includes(lower) || (lower.length > 3 && lower.includes(k))) ? 60 : 0,
      );
      if (score > 0) {
        matched.push({
          id: `feature-${f.id}`,
          title: f.title,
          subtitle: f.description,
          category: "Features",
          businessName: activeBizName,
          relevance: score + 15,
          action: () => {
            go(f.screen);
            // Open the exact panel, e.g. Points on Loyalty. A button the role can't use isn't rendered.
            if (f.target) setTimeout(() => {
              pressShortcut(f.target!, document, { skipIfPressed: true });
              if (f.id === "points-settings") setTimeout(() => document.getElementById("points-settings")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
            }, 350);
            if (f.id === "keyboard-shortcuts") setTimeout(() => {
              const section = document.getElementById("keyboard-shortcuts");
              if (section instanceof HTMLDetailsElement) section.open = true;
              section?.scrollIntoView({ behavior: "smooth" });
            }, 300);
          },
        });
      }
    });
    if (lower.length >= 2) {
      shortcutsFor(currentEmployee?.role).forEach((sc) => {
        const score = Math.max(
          getRelevance(sc.action, lower),
          (sc.keywords || []).some((k) => k.includes(lower)) ? 45 : 0,
          /shortcut|keyboard|hotkey/.test(lower) ? 30 : 0,
        );
        if (score > 0) {
          matched.push({
            id: `shortcut-${sc.id}`,
            title: `${sc.action}  ·  ${sc.keys}`,
            subtitle: `Keyboard shortcut · ${scopeLabel(sc.scope)}`,
            category: "Keyboard Shortcuts",
            businessName: activeBizName,
            relevance: score,
            action: () => go(sc.scope === "everywhere" ? "about" : sc.scope),
          });
        }
      });
    }

    // 1. Search Businesses
    businesses.forEach(b => {
      const matchName = getRelevance(b.name, lower);
      const matchDesc = b.description ? getRelevance(b.description, lower) : 0;
      const score = Math.max(matchName, matchDesc);
      if (score > 0) {
        matched.push({
          id: `biz-${b.id}`,
          title: b.name,
          subtitle: b.description || b.address || "Branch",
          category: "Businesses",
          businessName: b.name,
          relevance: score + 10,
          action: () => {
            onNavigateTab(currentEmployee && canOpenScreen(currentEmployee.role, "business-management") ? "business-management" : "settings");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 2. Search Products
    products.forEach(p => {
      const matchName = getRelevance(p.name, lower);
      const matchSku = getRelevance(p.sku, lower);
      const matchCategory = getRelevance(p.category, lower);
      const score = Math.max(matchName, matchSku, matchCategory);
      if (score > 0) {
        matched.push({
          id: `prod-${p.id}`,
          title: p.name,
          subtitle: `${p.category} · Stock: ${p.stock} ${p.unit} · SKU: ${p.sku} · Cost: ${formatCurrency(p.cost)} · Price: ${formatCurrency(p.price)}`,
          category: "Products",
          businessName: activeBizName,
          relevance: score + (matchSku > 0 ? 15 : 0),
          action: () => {
            onNavigateTab("pos");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 3. Search Product Categories
    const uniqueCategories = Array.from(new Set(products.map(p => p.category)));
    uniqueCategories.forEach(cat => {
      const score = getRelevance(cat, lower);
      if (score > 0) {
        matched.push({
          id: `cat-${cat}`,
          title: `${cat} Category`,
          subtitle: `${products.filter(p => p.category === cat).length} products`,
          category: "Product Categories",
          businessName: activeBizName,
          relevance: score,
          spot: { text: cat },
          action: () => {
            onNavigateTab("inventory");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 4. Search Inventory Stock Level Alerts
    products.forEach(p => {
      const isLow = p.stock <= p.minStock;
      const scoreName = getRelevance(p.name, lower);
      const scoreSku = getRelevance(p.sku, lower);
      const score = Math.max(scoreName, scoreSku);
      if (score > 0) {
        matched.push({
          id: `inv-${p.id}`,
          title: `Stock of ${p.name}`,
          subtitle: `Current stock: ${p.stock} ${p.unit} (restock at ${p.minStock})`,
          category: "Inventory",
          businessName: activeBizName,
          status: isLow ? "Low Stock" : "Healthy",
          relevance: score + (isLow ? 10 : 0),
          spot: { text: p.name },
          action: () => {
            onNavigateTab("inventory");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 5. Search Inventory Stock history adjustments (Inventory Transactions)
    const adjustments = useInventoryStore.getState().adjustments || [];
    adjustments.forEach(adj => {
      const matchProd = getRelevance(adj.productName, lower);
      const matchReason = getRelevance(adj.reason || "", lower);
      const matchType = getRelevance(adj.type, lower);
      const matchRef = adj.referenceNumber ? getRelevance(adj.referenceNumber, lower) : 0;
      const score = Math.max(matchProd, matchReason, matchType, matchRef);
      if (score > 0) {
        matched.push({
          id: `adj-${adj.id}`,
          title: `Adjustment: ${adj.productName}`,
          subtitle: `Change: ${adj.quantityAdjusted > 0 ? "+" : ""}${adj.quantityAdjusted} · Type: ${adj.type} · Reason: ${adj.reason} · By: ${adj.staffName}`,
          category: "Inventory Transactions",
          businessName: activeBizName,
          relevance: score,
          spot: { text: adj.productName },
          action: () => {
            onNavigateTab(currentEmployee && canOpenScreen(currentEmployee.role, "stock-history") ? "stock-history" : "inventory");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 5b. A receipt number: the stock that sale moved, all in one result that opens the
    // stock log filtered to that receipt.
    if (code) {
      const moved = adjustments.filter((adj) => mentionsReceipt(adj.referenceNumber, code) || mentionsReceipt(adj.notes, code));
      if (moved.length) {
        const ref = moved[0].referenceNumber || `TXN-${code}`;
        matched.push({
          id: `stock-ref-${code}`,
          title: `Stock moved by receipt ${ref}`,
          subtitle: moved.slice(0, 3).map((a) => `${a.productName} ${a.quantityAdjusted > 0 ? "+" : ""}${a.quantityAdjusted}`).join(" · ") + (moved.length > 3 ? ` · and ${moved.length - 3} more` : ""),
          category: "Stock History",
          businessName: activeBizName,
          relevance: 90,
          action: () => {
            setSearchTarget({ kind: "stock", query: ref });
            onNavigateTab("stock-history");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    }

    // 6. Search Customers
    customers.forEach(c => {
      const matchName = getRelevance(c.name, lower);
      const matchPhone = getRelevance(c.phone, lower);
      const matchEmail = getRelevance(c.email || "", lower);
      const matchAccount = c.accountNumber ? getRelevance(c.accountNumber, lower) : 0;
      const score = Math.max(matchName, matchPhone, matchEmail, matchAccount);
      if (score > 0) {
        matched.push({
          id: `cust-${c.id}`,
          title: c.name,
          subtitle: `${c.accountNumber ? `Account ${c.accountNumber} · ` : ""}${c.tier} Tier · Points: ${c.loyaltyPoints} · Phone: ${c.phone} · Owes: ${formatCurrency(c.debtBalance || 0)}`,
          category: "Customers",
          businessName: activeBizName,
          relevance: score + 10,
          action: () => {
            onNavigateTab("customers");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 7. Search Suppliers
    suppliers.forEach(s => {
      const matchName = getRelevance(s.name, lower);
      const matchCompany = getRelevance(s.company || "", lower);
      const matchPhone = getRelevance(s.phone, lower);
      const score = Math.max(matchName, matchCompany, matchPhone);
      if (score > 0) {
        matched.push({
          id: `sup-${s.id}`,
          title: s.name,
          subtitle: `${s.company ? `${s.company} · ` : ""}Supplies: ${s.product_supplied || "—"} · ${s.phone}`,
          category: "Suppliers",
          businessName: activeBizName,
          relevance: score,
          spot: { text: s.name, press: "suppliers-tab" },
          action: () => {
            onNavigateTab("suppliers");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 8. Search Sales, by any form of the receipt number, customer or payment method
    transactions.forEach(t => {
      const receipt = formatReceiptNumber(t.id);
      const printed = receiptSettings ? formatReceiptNo(t.id, t.timestamp, receiptSettings) : receipt;
      const matchCode = code && matchesReceipt(t.id, code) ? (code.length >= 8 ? 100 : 85) : 0;
      const matchId = Math.max(matchCode, getRelevance(receipt, lower), getRelevance(printed, lower));
      const matchCust = t.customerName ? getRelevance(t.customerName, lower) : 0;
      const matchMethod = getRelevance(t.paymentMethod, lower);
      const score = Math.max(matchId, matchCust, matchMethod);
      if (score > 0) {
        matched.push({
          id: `sale-${t.id}`,
          title: `Receipt ${printed}${t.customerName ? ` · ${t.customerName}` : ""}`,
          subtitle: `${new Date(t.timestamp).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })} · ${formatCurrency(t.finalTotal)} · ${t.paymentMethod} · By ${t.staffName}${printed !== receipt ? ` · Logs: ${receipt}` : ""}`,
          category: "Sales",
          businessName: activeBizName,
          status: t.status,
          relevance: score + 15,
          action: () => {
            setSearchTarget({ kind: "sale", id: t.id });
            onNavigateTab("sales");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 9. Search Sale Items
    transactions.forEach(t => {
      t.items.forEach((item, index) => {
        const score = getRelevance(item.product.name, lower);
        if (score > 0) {
          matched.push({
            id: `sale-item-${t.id}-${index}`,
            title: `Item: ${item.product.name} (receipt ${formatReceiptNumber(t.id)})`,
            subtitle: `Sold: ${item.quantity} · Discount: ${item.discountPercentage}% · Total: ${formatCurrency(item.product.price * item.quantity)}`,
            category: "Sale Items",
            businessName: activeBizName,
            relevance: score,
            spot: { id: `sale-${t.id}`, text: formatReceiptNumber(t.id) },
            action: () => {
              onNavigateTab("sales");
              setIsOpen(false);
              setQuery("");
            }
          });
        }
      });
    });

    // 10. Search Purchases, by supplier, number or note
    purchases.forEach(p => {
      const ref = purchaseRef(p);
      const score = Math.max(getRelevance(p.supplierName, lower), getRelevance(ref, lower), p.notes ? getRelevance(p.notes, lower) : 0);
      if (score > 0) {
        matched.push({
          id: `pur-${p.id}`,
          title: `Purchase ${ref} · ${p.supplierName}`,
          subtitle: `${new Date(p.date).toLocaleDateString()} · ${formatCurrency(p.total)} · ${p.status === "Pending" ? "Draft" : p.status} · ${p.lines.length} items`,
          category: "Purchases",
          businessName: activeBizName,
          status: p.status,
          relevance: score + 10,
          spot: { text: p.supplierName, press: "purchases-tab" },
          action: () => {
            onNavigateTab("suppliers");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 11. Search Purchase Items: lands on the purchase they belong to
    purchases.forEach(p => {
      p.lines.forEach((item, idx) => {
        const score = getRelevance(item.name, lower);
        if (score > 0) {
          matched.push({
            id: `pur-item-${p.id}-${idx}`,
            title: `Item: ${item.name} (purchase ${purchaseRef(p)} from ${p.supplierName})`,
            subtitle: `Ordered: ${item.quantity} ${item.unit} · ${formatCurrency(item.price)} each · ${formatCurrency(item.quantity * item.price)}`,
            category: "Purchase Items",
            businessName: activeBizName,
            relevance: score,
            spot: { id: `pur-${p.id}`, text: p.supplierName, press: "purchases-tab" },
            action: () => {
              onNavigateTab("suppliers");
              setIsOpen(false);
              setQuery("");
            }
          });
        }
      });
    });

    // 12. Search Production Batches
    const batches = extra.productionBatches || [];
    batches.forEach(b => {
      const matchRef = b.referenceNumber ? getRelevance(b.referenceNumber, lower) : 0;
      const matchRecipe = getRelevance(b.recipeName, lower);
      const score = Math.max(matchRef, matchRecipe);
      if (score > 0) {
        matched.push({
          id: `batch-${b.id}`,
          title: `Production batch: ${b.recipeName}${b.referenceNumber ? ` · Ref ${b.referenceNumber}` : ""}`,
          spot: { text: b.recipeName },
          subtitle: `${b.quantityProduced} ${b.unit} · By ${b.staffName} · ${b.status}`,
          category: "Production Batches",
          businessName: activeBizName,
          status: b.status,
          relevance: score + 10,
          action: () => {
            onNavigateTab("production");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 14. Search Expenses
    expenses.forEach(e => {
      const matchCat = getRelevance(e.category, lower);
      const matchDesc = getRelevance(e.description, lower);
      const score = Math.max(matchCat, matchDesc);
      if (score > 0) {
        matched.push({
          id: `exp-${e.id}`,
          title: `Expense: ${e.category}`,
          subtitle: `Amount: ${formatCurrency(e.amount)} · Note: ${e.description} · Date: ${new Date(e.date).toLocaleDateString()}`,
          category: "Expenses",
          businessName: activeBizName,
          relevance: score,
          spot: { text: e.description, press: "money-expenses" },
          action: () => {
            onNavigateTab("money");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 16. Search Team Members (Employees list)
    employees.forEach(e => {
      const matchName = getRelevance(e.name, lower);
      const matchRole = getRelevance(e.role, lower);
      const matchEmail = getRelevance(e.email, lower);
      const score = Math.max(matchName, matchRole, matchEmail);
      if (score > 0) {
        matched.push({
          id: `worker-${e.id}`,
          title: e.name,
          subtitle: `${e.role} · ${e.email} · ${e.phone}`,
          category: "Team Members",
          businessName: activeBizName,
          relevance: score + 10,
          action: () => {
            onNavigateTab("workers");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 17. Search Users
    const appUsers = users || [];
    appUsers.forEach(u => {
      const matchName = getRelevance(u.name, lower);
      const matchEmail = getRelevance(u.email, lower);
      const score = Math.max(matchName, matchEmail);
      if (score > 0) {
        matched.push({
          id: `user-${u.id}`,
          title: u.name,
          subtitle: `${u.email}${u.isVerified ? "" : " · email not verified"}`,
          category: "Users",
          businessName: activeBizName,
          status: u.isVerified ? "Verified" : "Pending",
          relevance: score,
          action: () => {
            onNavigateTab("workers");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 18. Search Invitations
    const appInvitations = invitations || [];
    appInvitations.forEach(inv => {
      const matchName = getRelevance(inv.name, lower);
      const matchEmail = getRelevance(inv.email, lower);
      const matchRole = getRelevance(inv.role, lower);
      const score = Math.max(matchName, matchEmail, matchRole);
      if (score > 0) {
        matched.push({
          id: `invitation-${inv.id}`,
          title: `Invitation for ${inv.name}`,
          spot: { text: `${inv.name}'s invitation` },
          subtitle: `Role: ${inv.role} · Sent to: ${inv.email} · Status: ${inv.status} · Expires: ${new Date(inv.expiresAt).toLocaleDateString()}`,
          category: "Invitations",
          businessName: activeBizName,
          status: inv.status,
          relevance: score,
          action: () => {
            onNavigateTab("workers");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 19. Search Roles configurations
    const dynamicRoles = getDynamicRoles();
    Object.keys(dynamicRoles).forEach(roleKey => {
      const r = dynamicRoles[roleKey];
      const matchName = getRelevance(r.name, lower);
      const matchDesc = getRelevance(r.description, lower);
      const score = Math.max(matchName, matchDesc);
      if (score > 0) {
        matched.push({
          id: `role-${roleKey}`,
          title: `Role: ${r.name}`,
          subtitle: `${r.description} · ${r.permissions.length} permissions`,
          category: "Roles",
          businessName: activeBizName,
          relevance: score,
          action: () => {
            onNavigateTab("permissions");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 20. Search Permissions Registry
    ALL_PERMISSIONS.forEach(p => {
      const matchCode = getRelevance(p.code, lower);
      const matchDesc = getRelevance(p.description, lower);
      const matchCategory = getRelevance(p.category, lower);
      const score = Math.max(matchCode, matchDesc, matchCategory);
      if (score > 0) {
        matched.push({
          id: `perm-${p.code}`,
          title: p.description || p.code,
          subtitle: `Permission · ${p.category}`,
          category: "Permissions",
          businessName: activeBizName,
          relevance: score,
          action: () => {
            localStorage.setItem("kkm_perm_search_target", p.code);
            onNavigateTab("permissions");
            window.dispatchEvent(new Event("kkm_perm_search_trigger"));
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 21. Search Notifications
    notifications.forEach(n => {
      const matchSender = getRelevance(n.title || "System", lower);
      const matchMsg = getRelevance(n.message, lower);
      const score = Math.max(matchSender, matchMsg);
      if (score > 0) {
        matched.push({
          id: `notif-${n.id}`,
          title: `Alert: ${n.title || "System"}`,
          spot: { text: n.title || n.message },
          subtitle: `"${n.message.slice(0, 75)}..." · Time: ${new Date(n.created_at).toLocaleTimeString()}`,
          category: "Notifications",
          businessName: activeBizName,
          relevance: score,
          action: () => {
            onNavigateTab("notifications");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 24. Search Audit Logs
    auditLogs.forEach(log => {
      const action = describeAction(log);
      const score = Math.max(getRelevance(action, lower), getRelevance(log.label, lower), getRelevance(log.by, lower));
      if (score > 0) {
        matched.push({
          id: `audit-${log.id}`,
          title: `${action}${log.label ? `: ${log.label}` : ""}`,
          subtitle: `${log.by ? `By ${log.by} · ` : ""}${new Date(log.at).toLocaleString()}`,
          category: "Audit Logs",
          businessName: activeBizName,
          relevance: score,
          action: () => {
            onNavigateTab("audit");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 25. Search Settings Configurations
    const settingTerms = [
      { term: "connections sms whatsapp ai keys", name: "Connections", desc: `SMS, WhatsApp and ${aiName} settings` },
      { term: "tax kra etims vat", name: "KRA eTIMS and VAT", desc: "Connect eTIMS and set tax on receipts" },
      { term: "dark mode theme", name: "Light or dark look", desc: "Switch the app colours" },
      { term: "ai assistant", name: `${aiName} settings`, desc: "Turn the assistant on and give it instructions" }
    ];
    settingTerms.forEach(st => {
      const scoreTerm = getRelevance(st.term, lower);
      const scoreName = getRelevance(st.name, lower);
      const score = Math.max(scoreTerm, scoreName);
      if (score > 0) {
        matched.push({
          id: `setting-${st.term}`,
          title: st.name,
          subtitle: st.desc,
          category: "Settings",
          businessName: activeBizName,
          relevance: score,
          action: () => {
            onNavigateTab("settings");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 28. Shifts
    shifts.forEach(s => {
      const emp = employees.find(e => e.id === s.employeeId);
      const empName = emp ? emp.name : "Former staff member";
      const scoreName = getRelevance(empName, lower);
      const scoreStatus = getRelevance(s.status, lower);
      const score = Math.max(scoreName, scoreStatus);
      if (score > 0) {
        matched.push({
          id: `shift-${s.id}`,
          title: `${empName}'s Shift Log`,
          spot: { text: empName },
          subtitle: `Status: ${s.status} · Started: ${new Date(s.startTime).toLocaleTimeString()} · Sales Total: ${formatCurrency(s.salesTotal || 0)}`,
          category: "Shifts",
          businessName: activeBizName,
          status: s.status,
          relevance: score,
          action: () => {
            onNavigateTab("dashboard");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 29. Home Dashboard Widgets
    if ("home dashboard".includes(lower) || "kpis".includes(lower) || "analytics".includes(lower)) {
      matched.push({
        id: "home-panel",
        title: "Main Home Dashboard",
        subtitle: "Review system-wide gross sales, active couriers, and daily milestones",
        category: "Home Dashboard",
        businessName: activeBizName,
        relevance: 40,
        action: () => {
          onNavigateTab("home");
          setIsOpen(false);
          setQuery("");
        }
      });
    }

    // 30. Quick Actions
    if ("toggle offline".includes(lower) || "network".includes(lower) || "offline".includes(lower)) {
      matched.push({
        id: "act-offline",
        title: "Toggle Network Connection",
        subtitle: "Simulate cellular connection drops to test background sync queues",
        category: "Quick Actions",
        businessName: activeBizName,
        relevance: 50,
        action: () => {
          toggleNetwork();
          onNavigateTab("dashboard");
          setIsOpen(false);
          setQuery("");
        }
      });
    }

    if (`ask ${aiName.toLowerCase()}`.includes(lower) || "ai assistant".includes(lower) || "chat with bot".includes(lower)) {
      matched.push({
        id: "act-ai",
        title: `Chat with ${aiName} AI Co-Pilot`,
        subtitle: `Let ${aiName} compile milk production reports or search files with AI`,
        category: "Quick Actions",
        businessName: activeBizName,
        relevance: 65,
        action: () => {
          onNavigateTab("ai");
          setIsOpen(false);
          setQuery("");
        }
      });
    }

    if ("communication center".includes(lower) || "bulk message".includes(lower) || "outreach".includes(lower) || "messaging".includes(lower)) {
      matched.push({
        id: "act-communication",
        title: "Message customers",
        subtitle: "Send bulk SMS, WhatsApp, and Emails to filtered customer segments",
        category: "Communication Center",
        businessName: activeBizName,
        relevance: 60,
        action: () => {
          setSearchTarget({ kind: "feedback", tab: "messages" });
          onNavigateTab("feedback");
          setIsOpen(false);
          setQuery("");
        }
      });
    }

    // 31. Wallets & Debts
    customers.forEach(c => {
      if (c.walletBalance && c.walletBalance > 0) {
        if ("wallet".includes(lower) || getRelevance(c.name, lower) > 0) {
          matched.push({
            id: `wallet-${c.id}`,
            spot: { id: `cust-${c.id}`, text: c.name },
            title: `${c.name}'s Wallet`,
            subtitle: `Current Balance: ${formatCurrency(c.walletBalance)}`,
            category: "Wallets",
            businessName: activeBizName,
            relevance: 50 + getRelevance(c.name, lower),
            action: () => { onNavigateTab("customers"); setIsOpen(false); setQuery(""); }
          });
        }
      }
      if (c.debtBalance && c.debtBalance > 0) {
        if ("debt".includes(lower) || "credit".includes(lower) || getRelevance(c.name, lower) > 0) {
          matched.push({
            id: `debt-${c.id}`,
            spot: { id: `cust-${c.id}`, text: c.name },
            title: `${c.name}'s Debt`,
            subtitle: `Outstanding Debt: ${formatCurrency(c.debtBalance)}`,
            category: "Debts",
            businessName: activeBizName,
            status: "Unpaid",
            relevance: 50 + getRelevance(c.name, lower),
            action: () => { onNavigateTab("customers"); setIsOpen(false); setQuery(""); }
          });
        }
      }
    });

    // 32. AI Conversations
    const aiChatHistory = useUiStore.getState().aiChatHistory || [];
    aiChatHistory.forEach((msg, idx) => {
      const score = getRelevance(msg.content, lower);
      if (score > 0) {
        matched.push({
          id: `ai-msg-${idx}`,
          title: `AI Chat: ${msg.role === 'user' ? 'You' : aiName}`,
          subtitle: `"${msg.content.substring(0, 50)}..."`,
          category: "AI Conversations",
          businessName: activeBizName,
          relevance: score,
          action: () => { onNavigateTab("ai"); setIsOpen(false); setQuery(""); }
        });
      }
    });

    // Filter results through security check and sort by relevance score
    const permittedResults = matched
      .filter(item => hasAccessToCategory(item.category))
      .sort((a, b) => b.relevance - a.relevance);

    // Limit duplicates (matching id)
    const uniqueResults: SearchResult[] = [];
    const seen = new Set<string>();
    permittedResults.forEach(r => {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        uniqueResults.push(r);
      }
    });

    // Sort by category to match visual grouping order
    uniqueResults.sort((a, b) => {
      if (a.category < b.category) return -1;
      if (a.category > b.category) return 1;
      return b.relevance - a.relevance; // Within category, sort by relevance
    });

    setResults(uniqueResults);
    setActiveIndex(-1);
  };

  // Records fetched when the box opens can arrive after the first letters: search again.
  useEffect(() => {
    if (query.trim()) handleSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers, expenses, purchases, auditLogs]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(prev => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) {
        openResult(results[activeIndex]);
      }
    }
  };

  // Open the screen, then centre and highlight the exact row the result was about.
  const openResult = (res: SearchResult) => {
    res.action();
    if (res.spot === false || (!res.spot && NO_SPOTLIGHT.has(res.category))) return;
    spotlight(res.spot?.id ?? res.id, res.spot?.text ?? res.title, res.spot?.press);
  };

  // Helper to highlight matched query string in results
  const renderHighlightedText = (text: string, search: string) => {
    if (!search.trim()) return <span>{text}</span>;
    const parts = text.split(new RegExp(`(${search.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")})`, "gi"));
    return (
      <span>
        {parts.map((part, i) => 
          part.toLowerCase() === search.toLowerCase() ? (
            <mark key={i} className="bg-amber-500/30 text-amber-500 font-semibold rounded px-0.5">{part}</mark>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  return (
    <div ref={searchRef} data-global-search className="relative flex-1 max-w-xl select-none font-sans">
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-app-text-muted" />
        <input
          type="search"
          enterKeyHint="search"
          autoFocus={autoFocus}
          aria-label="Search the app"
          placeholder="Search screens, products, customers, payments..."
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full bg-app-card text-[11px] font-medium pl-8 pr-8 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none focus:bg-app-bg text-app-text transition"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
            }}
            className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-app-text-muted hover:text-app-text"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {isOpen && query.trim() && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute top-11 left-0 right-0 md:-left-16 md:-right-16 max-h-[min(450px,calc(100dvh-8rem))] bg-app-card rounded-2xl border border-app-border shadow-2xl overflow-y-auto z-50 p-3.5 flex flex-col gap-1.5 scrollbar-thin"
          >
            {results.length === 0 ? (
              <div className="p-6 text-center text-xs text-app-text-muted">
                Nothing found.
              </div>
            ) : (
              // Grouped Results
              <div className="flex flex-col gap-2">
                {(() => {
                  let globalItemIndex = -1;
                  return Array.from(new Set(results.map(r => r.category))).map((cat) => (
                  <div key={cat} className="flex flex-col gap-1 border-b border-app-border/20 pb-2 last:border-b-0">
                    <span className="text-[11px] font-semibold text-amber-500 px-2 pt-1 block">
                      {cat}
                    </span>
                    {results
                      .filter(r => r.category === cat)
                      .map((res) => {
                        globalItemIndex++;
                        const isActive = globalItemIndex === activeIndex;
                        const Icon = 
                          res.category === "Businesses" ? Briefcase :
                          res.category === "Products" ? ShoppingBag :
                          res.category === "Product Categories" ? Tag :
                          res.category === "Inventory" ? Boxes :
                          res.category === "Inventory Transactions" ? History :
                          res.category === "Customers" ? User :
                          res.category === "Suppliers" ? Truck :
                          res.category === "Sales" ? Receipt :
                          res.category === "Sale Items" ? ShoppingCart :
                          res.category === "Purchases" ? CreditCard :
                          res.category === "Purchase Items" ? Package :
                          res.category === "Production" ? Factory :
                          res.category === "Production Batches" ? Layers :
                          res.category === "Recipes / BOM" ? BookOpen :
                          res.category === "Expenses" ? TrendingDown :
                          res.category === "Payments" ? DollarSign :
                          res.category === "Team Members" ? Users :
                          res.category === "Users" ? User :
                          res.category === "Invitations" ? Mail :
                          res.category === "Roles" ? Key :
                          res.category === "Permissions" ? Shield :
                          res.category === "Notifications" ? Bell :
                          res.category === "Reports" ? FileText :
                          res.category === "AI Insights" ? Bot :
                          res.category === "Audit Logs" ? Activity :
                          res.category === "Settings" ? Settings : Sliders;

                        return (
                          <div
                            key={res.id}
                            onClick={() => openResult(res)}
                            className={`p-2 rounded-xl cursor-pointer flex items-start gap-2.5 transition ${
                              isActive ? 'bg-amber-500/10 border border-amber-500/30' : 'hover:bg-app-bg border border-transparent'
                            }`}
                          >
                            <div className="p-1.5 bg-app-bg rounded-lg text-app-text shrink-0 border border-app-border/45">
                              <Icon size={12} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="text-[11px] font-bold text-app-text truncate">
                                  {renderHighlightedText(res.title, query)}
                                </h4>
                                <div className="flex items-center gap-1 shrink-0">
                                  {res.status && (
                                    <span className={`text-[11px] px-1 py-0.2 rounded font-semibold ${
                                      ["Success", "Approved", "Completed", "Active", "Verified"].includes(res.status)
                                        ? "bg-emerald-500/10 text-emerald-500"
                                        : ["Pending", "In_Progress", "Under_Maintenance"].includes(res.status)
                                        ? "bg-amber-500/10 text-amber-500"
                                        : "bg-red-500/10 text-red-500"
                                    }`}>
                                      {res.status}
                                    </span>
                                  )}
                                  {res.businessName && (
                                    <span className="text-[11px] bg-slate-200 dark:bg-slate-800 text-app-text-muted px-1.5 py-0.2 rounded-md font-bold max-w-[80px] truncate">
                                      {res.businessName}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <p className="text-[11px] text-app-text-muted truncate mt-0.5 leading-normal">
                                {renderHighlightedText(res.subtitle, query)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ))})()}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
