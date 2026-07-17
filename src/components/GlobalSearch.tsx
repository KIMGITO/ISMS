import React, { useState, useRef, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { useInventoryStore } from "../stores/inventoryStore";
import { useAuthStore } from "../stores/authStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useExtraModulesStore } from "../stores/extraModulesStore";
import { ALL_PERMISSIONS, hasRolePermission, getDynamicRoles } from "../utils/permissions";
import { 
  Search, X, ShoppingBag, User, Receipt, Users, Sliders, 
  Bell, Key, FileText, Clock, Home, Bot, Shield, Settings,
  Briefcase, Tag, Boxes, History, Truck, ShoppingCart, CreditCard,
  FilePlus, Package, Factory, Layers, BookOpen, TrendingDown,
  DollarSign, Mail, Activity, HardDrive, File
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getSupabase } from "../services/supabaseClient";

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  businessName?: string;
  status?: string;
  relevance: number; // Relevance score for sorting
  action: () => void;
}

interface GlobalSearchProps {
  onNavigateTab: (
    tab: 
      | "home" 
      | "pos" 
      | "inventory" 
      | "sales" 
      | "customers" 
      | "feedback" 
      | "workers" 
      | "permissions" 
      | "ai" 
      | "profile" 
      | "settings" 
      | "dashboard" 
      | "notifications"
  ) => void;
}

export default function GlobalSearch({ onNavigateTab }: GlobalSearchProps) {
  const { products, customers, transactions, employees, businesses, activeBusinessId, toggleNetwork } = useAppStore();
  const aiName = import.meta.env?.VITE_AI_NAME || "Kim";
  const { shifts, activeShift, currentEmployee, invitations, users } = useAuthStore();
  const { notifications } = useNotificationStore();
  
  // Extra modules state
  const extra = useExtraModulesStore();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);

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
          .eq("business_id", activeBusinessId);
        
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
      case "Customers":
        return hasRolePermission(currentEmployee.role, "customers.view");
      case "Suppliers":
        return hasRolePermission(currentEmployee.role, "suppliers.view");
      case "Sales":
      case "Sale Items":
      case "Payments":
        return hasRolePermission(currentEmployee.role, "orders.view") || hasRolePermission(currentEmployee.role, "payments.view");
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
      case "Notifications":
        return true; // standard alerts
      case "Reports":
        return hasRolePermission(currentEmployee.role, "reports.view");
      case "AI Insights":
        return hasRolePermission(currentEmployee.role, "ai.insights");
      case "Audit Logs":
        return hasRolePermission(currentEmployee.role, "audit.view");
      case "Settings":
        return hasRolePermission(currentEmployee.role, "settings.view");
      case "Storage Files":
        return hasRolePermission(currentEmployee.role, "files.view");
      case "Business Assets":
        return hasRolePermission(currentEmployee.role, "assets.view");
      case "Quick Actions":
      case "Home Dashboard":
      case "Shifts":
        return true;
      default:
        return false;
    }
  };

  const handleSearch = (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setResults([]);
      return;
    }

    const matched: SearchResult[] = [];
    const lower = text.toLowerCase().trim();

    // Helper to calculate relevance score
    const getRelevance = (field: string, targetQuery: string) => {
      const target = field.toLowerCase();
      if (target === targetQuery) return 100; // Perfect match
      if (target.startsWith(targetQuery)) return 80; // Prefix match
      if (target.includes(targetQuery)) return 50; // Middle match
      return 0;
    };

    const activeBizName = businesses.find(b => b.id === activeBusinessId)?.name || "Primary Business";

    // Static pages shortcuts
    const staticPages = [
      {
        id: "nav-settings",
        title: "Settings & System Configuration",
        subtitle: "Manage Twilio SMS, Google Sheets backups, Firebase notifications, and system presets",
        category: "Settings",
        tab: "settings" as const,
        keywords: ["settings", "twilio", "sms", "backup", "firebase", "notifications", "printer", "fcm"]
      },
      {
        id: "nav-permissions",
        title: "Staff Roles & Access Permissions Registry",
        subtitle: "Configure cashier, manager, owner, driver roles and manage security privileges",
        category: "Permissions",
        tab: "permissions" as const,
        keywords: ["permissions", "roles", "privileges", "access", "clearance", "security"]
      },
      {
        id: "nav-profile",
        title: "Personal Profile details & Shift logs",
        subtitle: "Check shift history, reset employee PIN code, update profile info",
        category: "Profile",
        tab: "profile" as const,
        keywords: ["profile", "pin", "shift", "personal", "employee", "account"]
      },
      {
        id: "nav-business-management",
        title: "Business Management (Multi-Tenant & Branding)",
        subtitle: "Configure business details, tenant branches, dynamic brand colors, and logos",
        category: "Business Management",
        tab: "business-management" as const,
        keywords: ["business", "management", "branches", "tenant", "branding", "colors", "logo"]
      }
    ];

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

    // 1. Search Businesses
    businesses.forEach(b => {
      const matchName = getRelevance(b.name, lower);
      const matchDesc = b.description ? getRelevance(b.description, lower) : 0;
      const score = Math.max(matchName, matchDesc);
      if (score > 0) {
        matched.push({
          id: `biz-${b.id}`,
          title: b.name,
          subtitle: b.description || "Sister Dairy Distribution Branch",
          category: "Businesses",
          businessName: b.name,
          relevance: score + 10,
          action: () => {
            onNavigateTab("settings");
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
          subtitle: `${p.category} · Stock: ${p.stock} ${p.unit} · SKU: ${p.sku} · Cost: KSh ${p.cost} · Price: KSh ${p.price}`,
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
          subtitle: `Active products logged: ${products.filter(p => p.category === cat).length}`,
          category: "Product Categories",
          businessName: activeBizName,
          relevance: score,
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
          subtitle: `Current stock: ${p.stock} ${p.unit} (Safety Threshold: ${p.minStock})`,
          category: "Inventory",
          businessName: activeBizName,
          status: isLow ? "Low Stock" : "Healthy",
          relevance: score + (isLow ? 10 : 0),
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
      const score = Math.max(matchProd, matchReason, matchType);
      if (score > 0) {
        matched.push({
          id: `adj-${adj.id}`,
          title: `Adjustment: ${adj.productName}`,
          subtitle: `Quantity adjusted: ${adj.quantityAdjusted > 0 ? "+" : ""}${adj.quantityAdjusted} · Type: ${adj.type} · Reason: ${adj.reason} · By: ${adj.staffName}`,
          category: "Inventory Transactions",
          businessName: activeBizName,
          relevance: score,
          action: () => {
            onNavigateTab("inventory");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 6. Search Customers
    customers.forEach(c => {
      const matchName = getRelevance(c.name, lower);
      const matchPhone = getRelevance(c.phone, lower);
      const matchEmail = getRelevance(c.email || "", lower);
      const score = Math.max(matchName, matchPhone, matchEmail);
      if (score > 0) {
        matched.push({
          id: `cust-${c.id}`,
          title: c.name,
          subtitle: `${c.tier} Tier Customer · Points: ${c.loyaltyPoints} · Phone: ${c.phone} · Balance: KSh ${c.debtBalance || 0}`,
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
      const matchCompany = getRelevance(s.company, lower);
      const matchPhone = getRelevance(s.phone, lower);
      const score = Math.max(matchName, matchCompany, matchPhone);
      if (score > 0) {
        matched.push({
          id: `sup-${s.id}`,
          title: s.name,
          subtitle: `Company: ${s.company} · Supplies: ${s.productSupplied} · Contact: ${s.phone}`,
          category: "Suppliers",
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

    // 8. Search Sales
    transactions.forEach(t => {
      const matchId = getRelevance(t.id, lower);
      const matchCust = t.customerName ? getRelevance(t.customerName, lower) : 0;
      const matchMethod = getRelevance(t.paymentMethod, lower);
      const score = Math.max(matchId, matchCust, matchMethod);
      if (score > 0) {
        matched.push({
          id: `sale-${t.id}`,
          title: `Sale Reference #${t.id}`,
          subtitle: `Total: KSh ${t.finalTotal.toFixed(2)} · Method: ${t.paymentMethod} · Operator: ${t.staffName} · Status: ${t.status}`,
          category: "Sales",
          businessName: activeBizName,
          status: t.status,
          relevance: score + 15,
          action: () => {
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
            title: `Item: ${item.product.name} (in Sale #${t.id})`,
            subtitle: `Quantity sold: ${item.quantity} · Discount: ${item.discountPercentage}% · Total: KSh ${(item.product.price * item.quantity).toFixed(2)}`,
            category: "Sale Items",
            businessName: activeBizName,
            relevance: score,
            action: () => {
              onNavigateTab("sales");
              setIsOpen(false);
              setQuery("");
            }
          });
        }
      });
    });

    // 10. Search Purchases (Bulk milk orders)
    const purchases = extra.purchases || [];
    purchases.forEach(p => {
      const matchId = getRelevance(p.id, lower);
      const matchSup = getRelevance(p.supplierName, lower);
      const score = Math.max(matchId, matchSup);
      if (score > 0) {
        matched.push({
          id: `pur-${p.id}`,
          title: `Purchase Order ${p.id}`,
          subtitle: `Supplier: ${p.supplierName} · Cost: KSh ${p.totalAmount.toFixed(2)} · Status: ${p.status} · Date: ${new Date(p.date).toLocaleDateString()}`,
          category: "Purchases",
          businessName: activeBizName,
          status: p.status,
          relevance: score + 10,
          action: () => {
            onNavigateTab("settings");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 11. Search Purchase Items
    purchases.forEach(p => {
      p.items.forEach((item, idx) => {
        const score = getRelevance(item.name, lower);
        if (score > 0) {
          matched.push({
            id: `pur-item-${p.id}-${idx}`,
            title: `Item: ${item.name} (Purchase Order ${p.id})`,
            subtitle: `Quantity Ordered: ${item.quantity} ${item.unit} · Unit Price: KSh ${item.price} · Subtotal: KSh ${(item.quantity * item.price).toFixed(2)}`,
            category: "Purchase Items",
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
    });

    // 12. Search Production Batches
    const batches = extra.productionBatches || [];
    batches.forEach(b => {
      const matchId = getRelevance(b.id, lower);
      const matchRecipe = getRelevance(b.recipeName, lower);
      const score = Math.max(matchId, matchRecipe);
      if (score > 0) {
        matched.push({
          id: `batch-${b.id}`,
          title: `Production Batch: ${b.id}`,
          subtitle: `Formula: ${b.recipeName} · Yield: ${b.quantityProduced} ${b.unit} · Operator: ${b.staffName} · Status: ${b.status}`,
          category: "Production Batches",
          businessName: activeBizName,
          status: b.status,
          relevance: score + 10,
          action: () => {
            onNavigateTab("inventory");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 13. Recipes & Bill of Materials (BOM)
    const recipes = extra.recipes || [];
    recipes.forEach(r => {
      const matchName = getRelevance(r.name, lower);
      const matchCode = getRelevance(r.code, lower);
      const score = Math.max(matchName, matchCode);
      if (score > 0) {
        matched.push({
          id: `recipe-${r.id}`,
          title: r.name,
          subtitle: `Formula Code: ${r.code} · Yield: ${r.yieldQuantity} ${r.yieldUnit} · Ingredients count: ${r.ingredients.length}`,
          category: "Recipes / BOM",
          businessName: activeBizName,
          relevance: score,
          action: () => {
            onNavigateTab("inventory");
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
          subtitle: `Amount: KSh ${e.amount.toFixed(2)} · Note: ${e.description} · Date: ${new Date(e.date).toLocaleDateString()}`,
          category: "Expenses",
          businessName: activeBizName,
          relevance: score,
          action: () => {
            onNavigateTab("inventory");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 15. Search Payments (Verified cash registers and M-Pesa API references)
    const payments = extra.payments || [];
    payments.forEach(pay => {
      const matchCode = getRelevance(pay.referenceCode, lower);
      const matchSender = getRelevance(pay.senderName, lower);
      const score = Math.max(matchCode, matchSender);
      if (score > 0) {
        matched.push({
          id: `pay-${pay.id}`,
          title: `Payment Ref: ${pay.referenceCode}`,
          subtitle: `Amount: KSh ${pay.amount.toFixed(2)} · Method: ${pay.method} · From: ${pay.senderName} · Status: ${pay.status}`,
          category: "Payments",
          businessName: activeBizName,
          status: pay.status,
          relevance: score + 15,
          action: () => {
            onNavigateTab("sales");
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
          subtitle: `Workspace Role: ${e.role} · Email: ${e.email} · Phone: ${e.phone} · Tasks Assigned: ${e.tasks?.length || 0}`,
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
          subtitle: `User Login Email: ${u.email} · Verified status: ${u.isVerified ? "Yes" : "No"}`,
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
          title: `Role Config: ${r.name}`,
          subtitle: `${r.description} · Configured privileges count: ${r.permissions.length}`,
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
          title: `Permission Key: ${p.code}`,
          subtitle: `Category: ${p.category} · Clearance: ${p.description}`,
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
      const matchSender = getRelevance(n.sender || "System", lower);
      const matchMsg = getRelevance(n.message, lower);
      const score = Math.max(matchSender, matchMsg);
      if (score > 0) {
        matched.push({
          id: `notif-${n.id}`,
          title: `Alert: ${n.sender || "System"}`,
          subtitle: `"${n.message.slice(0, 75)}..." · Time: ${new Date(n.timestamp).toLocaleTimeString()}`,
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

    // 22. Search Reports
    const reportTerms = [
      { term: "sales report", name: "Daily Sales Performance & Revenue Ledger", desc: "Browse charts, gross profits, and download PDF catalogs", key: "sales" },
      { term: "inventory velocity", name: "Dairy Stock Outflow Velocity Analytics", desc: "Reconcile truck stock, receive raw milk batches", key: "inventory" },
      { term: "customer retention", name: "Loyalty Tier Metrics & Demographics", desc: "Analyze Bronze, Silver, Gold and subscription frequency", key: "customers" },
      { term: "profit margin", name: "Operational Profitability Audit Ledger", desc: "Cross-reference KRA VAT tax liabilities and expenses", key: "dashboard" },
      { term: "expense chart", name: "Raw Milk Spillages & cooling diesel logs", desc: "Review operational costs and waste logging", key: "inventory" }
    ];
    reportTerms.forEach(rt => {
      const scoreTerm = getRelevance(rt.term, lower);
      const scoreName = getRelevance(rt.name, lower);
      const score = Math.max(scoreTerm, scoreName);
      if (score > 0) {
        matched.push({
          id: `report-${rt.term}`,
          title: rt.name,
          subtitle: rt.desc,
          category: "Reports",
          businessName: activeBizName,
          relevance: score,
          action: () => {
            onNavigateTab(rt.key as any);
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 23. Search AI Insights
    const insights = extra.aiInsights || [];
    insights.forEach(ins => {
      const matchTitle = getRelevance(ins.title, lower);
      const matchContent = getRelevance(ins.content, lower);
      const score = Math.max(matchTitle, matchContent);
      if (score > 0) {
        matched.push({
          id: `insight-${ins.id}`,
          title: `AI Recommendation: ${ins.title}`,
          subtitle: ins.content,
          category: "AI Insights",
          businessName: activeBizName,
          relevance: score + 10,
          action: () => {
            onNavigateTab("ai");
            setIsOpen(false);
            setQuery("");
          }
        });
      }
    });

    // 24. Search Audit Logs
    const auditLogs = extra.auditLogs || [];
    auditLogs.forEach(log => {
      const matchAction = getRelevance(log.action, lower);
      const matchDetails = getRelevance(log.details, lower);
      const matchStaff = getRelevance(log.staffName, lower);
      const score = Math.max(matchAction, matchDetails, matchStaff);
      if (score > 0) {
        matched.push({
          id: `audit-${log.id}`,
          title: `Audit: [${log.action}]`,
          subtitle: `${log.details} · By: ${log.staffName} · Date: ${new Date(log.date).toLocaleString()}`,
          category: "Audit Logs",
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

    // 25. Search Settings Configurations
    const settingTerms = [
      { term: "integrations", name: "API Credentials & Secret Keys Panel", desc: `Configure ${aiName} AI, WhatsApp, Twilio, and Firebase integrations` },
      { term: "tax configuration", name: "Kenya Revenue Authority VAT settings", desc: "Configure KRA VAT rate and PIN registration values" },
      { term: "dark mode theme", name: "Appearance Themes & Accessibility Settings", desc: "Toggle interface colors and high contrast slate layout" },
      { term: "ai config", name: "AI Workspace Assistant Model Customization", desc: "Manage system instructions or custom models" }
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

    // 26. Search Storage Files
    const storageFiles = extra.storageFiles || [];
    storageFiles.forEach(file => {
      const matchName = getRelevance(file.name, lower);
      const matchBy = getRelevance(file.uploadedBy, lower);
      const score = Math.max(matchName, matchBy);
      if (score > 0) {
        matched.push({
          id: `file-${file.id}`,
          title: file.name,
          subtitle: `Size: ${file.size} · Type: ${file.type} · Uploaded by: ${file.uploadedBy} · Date: ${new Date(file.date).toLocaleDateString()}`,
          category: "Storage Files",
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

    // 27. Search Business Assets
    const assets = extra.assets || [];
    assets.forEach(asset => {
      const matchName = getRelevance(asset.name, lower);
      const matchCode = getRelevance(asset.code, lower);
      const score = Math.max(matchName, matchCode);
      if (score > 0) {
        matched.push({
          id: `asset-${asset.id}`,
          title: asset.name,
          subtitle: `Asset Code: ${asset.code} · Serial: ${asset.serialNumber} · Value: KSh ${asset.value.toLocaleString()} · Status: ${asset.status}`,
          category: "Business Assets",
          businessName: activeBizName,
          status: asset.status,
          relevance: score + 5,
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
      const empName = emp ? emp.name : `Employee ID: ${s.employeeId}`;
      const scoreName = getRelevance(empName, lower);
      const scoreStatus = getRelevance(s.status, lower);
      const score = Math.max(scoreName, scoreStatus);
      if (score > 0) {
        matched.push({
          id: `shift-${s.id}`,
          title: `${empName}'s Shift Log`,
          subtitle: `Status: ${s.status} · Started: ${new Date(s.startTime).toLocaleTimeString()} · Sales Total: KSh ${(s.salesTotal || 0).toFixed(2)}`,
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

    setResults(uniqueResults);
  };

  // Helper to highlight matched query string in results
  const renderHighlightedText = (text: string, search: string) => {
    if (!search.trim()) return <span>{text}</span>;
    const parts = text.split(new RegExp(`(${search.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")})`, "gi"));
    return (
      <span>
        {parts.map((part, i) => 
          part.toLowerCase() === search.toLowerCase() ? (
            <mark key={i} className="bg-amber-500/30 text-amber-500 font-extrabold rounded px-0.5">{part}</mark>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  return (
    <div ref={searchRef} className="relative flex-1 max-w-xl select-none font-sans">
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-app-text-muted" />
        <input
          type="text"
          placeholder="Search products, orders, BOM recipes, payments, suppliers, invitations..."
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => handleSearch(e.target.value)}
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
            className="absolute top-11 left-0 right-0 md:-left-16 md:-right-16 max-h-[450px] bg-app-card rounded-2xl border border-app-border shadow-2xl overflow-y-auto z-50 p-3.5 flex flex-col gap-1.5 scrollbar-thin"
          >
            {results.length === 0 ? (
              <div className="p-6 text-center text-xs text-app-text-muted">
                No matching records, documents, batches, assets, audit logs, or settings found.
              </div>
            ) : (
              // Grouped Results
              <div className="flex flex-col gap-2">
                {Array.from(new Set(results.map(r => r.category))).map((cat) => (
                  <div key={cat} className="flex flex-col gap-1 border-b border-app-border/20 pb-2 last:border-b-0">
                    <span className="text-[9px] font-black text-amber-500 uppercase tracking-wider px-2 pt-1 block">
                      {cat}
                    </span>
                    {results
                      .filter(r => r.category === cat)
                      .map((res) => {
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
                          res.category === "Settings" ? Settings :
                          res.category === "Storage Files" ? File :
                          res.category === "Business Assets" ? HardDrive : Sliders;

                        return (
                          <div
                            key={res.id}
                            onClick={res.action}
                            className="p-2 hover:bg-app-bg rounded-xl cursor-pointer flex items-start gap-2.5 transition"
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
                                    <span className={`text-[7.5px] px-1 py-0.2 rounded font-black uppercase tracking-wider ${
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
                                    <span className="text-[7.5px] bg-slate-200 dark:bg-slate-800 text-app-text-muted px-1.5 py-0.2 rounded-md font-bold max-w-[80px] truncate">
                                      {res.businessName}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <p className="text-[9px] text-app-text-muted truncate mt-0.5 leading-normal">
                                {renderHighlightedText(res.subtitle, query)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
