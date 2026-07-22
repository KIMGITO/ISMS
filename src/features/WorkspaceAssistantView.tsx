import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { usePendingActionStore } from '../stores/pendingActionStore';
import { useCustomerStore } from '../stores/customerStore';
import {
  Send,
  RefreshCw,
  Bot,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Brain,
  ActivitySquareIcon,
} from 'lucide-react';
import { getDynamicRoles, ALL_PERMISSIONS } from '../utils/permissions';
import { useAuthStore } from '../stores/authStore';
import { SupabaseService } from '../services/supabaseService';
import { ProductRepository, CustomerRepository, ExpenseRepository } from '../services/repositories';
import { useExtraModulesStore } from '../stores/extraModulesStore';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export default function WorkspaceAssistantView() {
  const {
    products,
    transactions,
    currentEmployee,
    aiChatHistory,
    setAiChatHistory,
    showNav,
    employees,
    adjustStock,
    addToCart,
    clearCart,
    checkout,
    updateCartQty,
    showToast,
    setActiveTab,
    activeBusinessId,
    aiIsLoading,
    setAiIsLoading,
  } = useAppStore();
  const [input, setInput] = useState('');
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [isSuggestionsCollapsed, setIsSuggestionsCollapsed] = useState(() => {
    return localStorage.getItem('kkm_suggestions_collapsed') === 'true';
  });

  const toggleSuggestionsCollapsed = () => {
    const nextVal = !isSuggestionsCollapsed;
    setIsSuggestionsCollapsed(nextVal);
    localStorage.setItem('kkm_suggestions_collapsed', String(nextVal));
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const getSuggestedPromptsForRole = () => {
    const role: string = currentEmployee?.role || 'Staff';

    switch (role) {
      case 'Owner':
        return [
          'Explain Owner operational privileges?',
          'How to audit registered staff credentials?',
          'Review distribution center analytics?',
          'Offline system synchronization rules?',
        ];
      case 'Manager':
      case 'Store Supervisor':
        return [
          'How do I manage worker shifts?',
          'Verify inventory restock threshold alerts?',
          'Generate daily operations summary?',
          'Review active worker permissions matrix?',
        ];
      case 'Cashier':
        return [
          'How to process POS milk checkouts?',
          'How to assign customer loyalty profiles?',
          'What is my cashier offline cash-limit?',
          'How do loyalty reward points calculate?',
        ];
      case 'Rider':
        return [
          'Check active milk delivery dispatches?',
          'How do I record dispatch logistics?',
          'Offline mode delivery sync guidelines?',
          'Update delivery route and travel status?',
        ];
      case 'Inventory Clerk':
        return [
          'Check critical low-stock alerts?',
          'How to reconcile truck inventory levels?',
          'Report milk batch spoilage & wastage?',
          'Check upcoming batch expiry warnings?',
        ];
      case 'Accountant':
        return [
          'Explain daily sales margin calculations?',
          'How to record system operational expenses?',
          'Generate tax & sales revenue reports?',
          'Review cash flow and credit accounts?',
        ];
      case 'Marketing Officer':
        return [
          'Generate milk sale SMS template?',
          'How to target high-tier loyalty members?',
          'Draft weekend promotional notification?',
          'Suggest dynamic discounts on surplus stock?',
        ];
      case 'Receptionist':
        return [
          'How to register a customer loyalty profile?',
          'Log customer feedback and complaints?',
          'Check incoming store notifications?',
          'Explain customer tier list rewards?',
        ];
      default:
        return [
          'POS workflow check?',
          'Check inventory alerts?',
          'Generate milk sale SMS template?',
          'Offline limit rule details?',
        ];
    }
  };

  const suggestedPrompts = getSuggestedPromptsForRole();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [aiChatHistory, aiIsLoading]);

  const executeWorkspaceAction = async (actionData: any) => {
    const { action, params } = actionData;
    const currentRole: string = currentEmployee?.role || 'Staff';

    if (action === 'create_schedule') {
      const isAuthorized =
        currentRole === 'Owner' ||
        currentRole === 'Manager' ||
        currentRole === 'Admin';
      if (!isAuthorized) {
        showToast(
          'Access Denied',
          'Your active role does not have permission to create schedules.',
        );
        return;
      }

      const assignedWorker = employees.find(
        (emp) =>
          emp.id === params.workerId ||
          emp.name.toLowerCase().includes(params.workerName?.toLowerCase()),
      );
      if (!assignedWorker) {
        showToast(
          'Action Failed',
          `Could not find worker "${
            params.workerName || params.workerId || ''
          }" to schedule.`,
        );
        return;
      }

      const LOCAL_SCHED_KEY = 'kkm_schedules_v1_store';
      const saved = localStorage.getItem(LOCAL_SCHED_KEY);
      const currentSchedules = saved ? JSON.parse(saved) : [];

      const newSched = {
        id: `sch-${Date.now()}`,
        employeeId: assignedWorker.id,
        employeeName: assignedWorker.name,
        title: params.title || 'Assistant Guided Shift',
        date: params.date || new Date().toISOString().split('T')[0],
        startTime: params.startTime || '09:00',
        endTime: params.endTime || '17:00',
        repeat: params.repeat || 'None',
        notes: params.notes || 'Assigned via Ai.',
        color: params.color || '#3b82f6',
      };

      const updated = [...currentSchedules, newSched];
      localStorage.setItem(LOCAL_SCHED_KEY, JSON.stringify(updated));
      showToast(
        'Schedule Created',
        `Successfully scheduled "${newSched.title}" for ${assignedWorker.name}.`,
        assignedWorker.avatar,
      );
    } else if (action === 'adjust_stock') {
      const isAuthorized =
        currentRole === 'Owner' ||
        currentRole === 'Manager' ||
        currentRole === 'Admin' ||
        currentRole === 'Inventory Clerk' ||
        currentRole === 'Store Supervisor';
      if (!isAuthorized) {
        showToast(
          'Access Denied',
          'Your active role does not have permission to adjust stock.',
        );
        return;
      }

      const prod = products.find(
        (p) =>
          p.id === params.productId ||
          p.name.toLowerCase().includes(params.productName?.toLowerCase()),
      );
      if (!prod) {
        showToast(
          'Action Failed',
          `Could not find product "${
            params.productName || params.productId || ''
          }" to adjust.`,
        );
        return;
      }

      const adjType = params.type === 'damage' ? 'Damage' : 'Restock';
      const qty = parseFloat(params.quantity);
      if (isNaN(qty) || qty <= 0) {
        showToast('Action Failed', 'Invalid stock adjustment quantity.');
        return;
      }

      const changeVal = adjType === 'Damage' ? qty * -1 : qty;
      adjustStock(
        prod.id,
        changeVal,
        adjType,
        params.reason || 'Adjusted via Workspace Assistant',
      );
      showToast(
        'Stock Adjusted',
        `Successfully logged ${adjType} of ${qty} for ${prod.name}.`,
      );
    } else if (action === 'create_checkout') {
      const isAuthorized =
        currentRole === 'Owner' ||
        currentRole === 'Cashier' ||
        currentRole === 'Manager' ||
        currentRole === 'Admin';
      if (!isAuthorized) {
        showToast(
          'Access Denied',
          'Your active role does not have permission to process sales.',
        );
        return;
      }

      clearCart();
      const items = params.items || [];
      let addedAny = false;

      for (const item of items) {
        const prod = products.find(
          (p) =>
            p.id === item.productId ||
            p.name.toLowerCase().includes(item.productName?.toLowerCase()),
        );
        if (prod) {
          addToCart(prod);
          const qty = parseFloat(item.quantity) || 1;
          if (qty > 1) {
            updateCartQty(prod.id, qty);
          }
          addedAny = true;
        }
      }

      if (!addedAny) {
        showToast(
          'Action Failed',
          'Could not match any products to build the checkout cart.',
        );
        return;
      }

      // Redirect to the POS screen and prompt the user to manually review and complete the sale.
      setActiveTab('pos');
      const totalCount = items.reduce(
        (sum: number, item: any) => sum + (parseFloat(item.quantity) || 1),
        0,
      );
      showToast(
        'POS Cart Loaded',
        `Workspace Assistant queued ${totalCount} item(s) in your active POS tab. Review and checkout here!`,
      );
    } else if (action === 'create_product') {
      const isAuthorized = currentRole === 'Owner' || currentRole === 'Manager' || currentRole === 'Admin';
      if (!isAuthorized) {
        showToast('Access Denied', 'Your active role does not have permission to create products.');
        return;
      }
      try {
        await ProductRepository.add({
          name: params.name,
          category: params.category || 'General Dairy',
          price: parseFloat(params.price) || 0,
          cost: parseFloat(params.cost) || 0,
          image: params.image || '',
          stock: parseFloat(params.stock) || 0,
          minStock: parseFloat(params.minStock) || 5,
          unit: params.unit || 'Unit',
          sku: params.sku || `SKU-${Date.now().toString().slice(-4)}`,
          description: params.description || '',
          businessId: activeBusinessId,
        });
        showToast('Product Created', `Successfully added ${params.name} to the catalog.`);
      } catch (err) {
        showToast('Action Failed', 'Failed to create product.');
      }
    } else if (action === 'create_customer') {
      const isAuthorized = currentRole === 'Owner' || currentRole === 'Manager';
      if (!isAuthorized) {
        showToast('Access Denied', 'Your active role does not have permission to create customers.');
        return;
      }
      try {
        await CustomerRepository.add({
          name: params.name,
          phone: params.phone || '',
          email: params.email || '',
          tier: params.tier || 'Bronze',
          loyaltyPoints: params.loyaltyPoints || 0,
          joinDate: new Date().toISOString().split('T')[0],
          purchasesCount: 0,
          businessId: activeBusinessId,
        });
        showToast('Customer Created', `Successfully added ${params.name} to your customers.`);
      } catch (err) {
        showToast('Action Failed', 'Failed to create customer.');
      }
    } else if (action === 'create_expense') {
      const isAuthorized = currentRole === 'Owner' || currentRole === 'Manager' || currentRole === 'Accountant';
      if (!isAuthorized) {
        showToast('Access Denied', 'Your active role does not have permission to record expenses.');
        return;
      }
      try {
        await ExpenseRepository.add({
          amount: parseFloat(params.amount) || 0,
          category: params.category || 'Supplies',
          description: params.description || 'AI Logged Expense',
          date: new Date().toISOString(),
          staffName: currentEmployee?.name || 'AI Assistant',
          businessId: activeBusinessId,
        });
        showToast('Expense Logged', `Successfully logged expense for ${params.category}.`);
      } catch (err) {
        showToast('Action Failed', 'Failed to log expense.');
      }
    } else if (action === 'create_purchase') {
      const isAuthorized = currentRole === 'Owner' || currentRole === 'Manager' || currentRole === 'Admin';
      if (!isAuthorized) {
        showToast('Access Denied', 'Your active role does not have permission to create purchases.');
        return;
      }
      try {
        useExtraModulesStore.getState().addPurchase({
          id: `PO-${Date.now().toString().slice(-6)}`,
          businessId: activeBusinessId,
          supplierName: params.supplierName || 'Supplier',
          items: params.items || [],
          totalAmount: parseFloat(params.totalAmount) || 0,
          status: 'Approved',
          date: new Date().toISOString(),
        });
        showToast('Purchase Created', `Successfully logged purchase from ${params.supplierName}.`);
      } catch (err) {
        showToast('Action Failed', 'Failed to log purchase.');
      }
    } else if (action === 'create_recipe_bom') {
      const isAuthorized = currentRole === 'Owner' || currentRole === 'Manager' || currentRole === 'Production Staff';
      if (!isAuthorized) {
        showToast('Access Denied', 'Your active role does not have permission to create recipes.');
        return;
      }
      try {
        await SupabaseService.createBom({
          businessId: activeBusinessId,
          productId: params.productId,
          name: params.name,
          yieldQuantity: parseFloat(params.yieldQuantity) || 1,
          yieldUnit: params.yieldUnit || 'Unit',
          ingredients: params.ingredients || [],
        });
        showToast('Recipe Created', `Successfully created recipe: ${params.name}.`);
      } catch (err) {
        showToast('Action Failed', 'Failed to create recipe.');
      }
    }
  };

  const aiName = import.meta.env?.VITE_AI_NAME || 'Kim';

  const groupMessages = () => {
    const today: ChatMessage[] = [];
    const yesterday: ChatMessage[] = [];
    const thisWeek: ChatMessage[] = [];
    const older: ChatMessage[] = [];

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOf7DaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;

    aiChatHistory.forEach((msg) => {
      const msgTime = msg.timestamp
        ? new Date(msg.timestamp).getTime()
        : Date.now();
      if (msgTime >= startOfToday) {
        today.push(msg);
      } else if (msgTime >= startOfYesterday) {
        yesterday.push(msg);
      } else if (msgTime >= startOf7DaysAgo) {
        thisWeek.push(msg);
      } else {
        older.push(msg);
      }
    });

    return [
      { id: 'older', label: 'Historic Archives', messages: older },
      { id: 'weekly', label: 'Weekly Archives', messages: thisWeek },
      { id: 'yesterday', label: "Yesterday's Operations", messages: yesterday },
      { id: 'today', label: "Today's Operations", messages: today },
    ].filter((g) => g.messages.length > 0);
  };

  const groupedMessageSections = groupMessages();

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || aiIsLoading) return;

    // 1. Prepare the user message
    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    // 2. Use a functional update to get the latest state immediately
    let latestHistory: ChatMessage[] = [];
    setAiChatHistory((prev) => {
      latestHistory = [...prev, userMessage];
      return latestHistory;
    });

    setInput('');
    setAiIsLoading(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const inventoryStatus = products
        .map((p) => `${p.name} (SKU: ${p.sku}, Stock: ${p.stock})`)
        .join('\n');

      const authUser = useAuthStore.getState().currentUser;
      const loggedInUser = currentEmployee?.name || authUser?.full_name || 'Owner';
      const rawRole = currentEmployee?.role || authUser?.role || 'Owner';
      const isOwner = rawRole.toLowerCase() === 'owner' || !currentEmployee;
      const currentRole = isOwner ? 'Owner' : rawRole;
      const rolePermissions = isOwner ? ALL_PERMISSIONS : (getDynamicRoles()[currentRole]?.permissions || []);

      // 3. Use the latestHistory variable we just created
      const apiMessages = [
        ...latestHistory.map((m) => ({ role: m.role, content: m.content })),
      ];

      const response = await SupabaseService.callEdgeFunction('chat', {
        messages: apiMessages,
        activeRole: currentRole,
        permissions: rolePermissions,
        employeeName: loggedInUser,
        businessId: activeBusinessId,
        clientProducts: products.map((p) => ({
          name: p.name,
          price: p.price,
          stock: p.stock,
          unit: p.unit || 'units',
          sku: p.sku,
          category: p.category,
        })),
        clientCustomers: useCustomerStore.getState().customers.map((c) => ({
          name: c.name,
          phone: c.phone,
          debtBalance: c.debtBalance,
          walletBalance: c.walletBalance,
          loyaltyPoints: c.loyaltyPoints,
        })),
        clientEmployees: employees.map((e) => ({
          name: e.name,
          role: e.role,
          phone: e.phone,
        })),
      });

      if (controller.signal.aborted) {
        return; // Ignore response if cancelled
      }

      console.log('Full AI Response Object:', response);

      if (response && (response.success || response.reply)) {
        let replyText =
          response.reply || 'I received your message, but I have no response.';

        // Handle AI Pending Action Drafts & Action Triggers
        const pendingActionRegex = /\[(PENDING_?ACTION|ACTION_TRIGGER):\s*(\{[\s\S]*?\})\s*\]/gi;
        let pMatch;
        while ((pMatch = pendingActionRegex.exec(replyText)) !== null) {
          try {
            const rawJson = pMatch[2].replace(/```json\n?|```\n?/g, '').trim();
            const draftData = JSON.parse(rawJson);
            const rawType = (draftData.type || draftData.action || '').toLowerCase().replace(/_/g, '');
            const normalizedType = draftData.type || draftData.action || 'custom_action';
            
            if (rawType) {
              // 1. ALWAYS route ALL AI actions to Pending Actions Store for human review
              usePendingActionStore.getState().addPendingAction({
                type: normalizedType === 'createcheckout' ? 'create_checkout' : normalizedType,
                title: draftData.title || `${normalizedType.replace(/_/g, ' ').toUpperCase()} Draft`,
                summary: draftData.summary || 'Draft action queued for human verification',
                requiredPermission: draftData.requiredPermission || 'pos.create_sale',
                params: draftData.params || {},
                createdBy: `${aiName} AI Copilot`,
              });

              // 2. For POS checkouts, also populate the active POS cart
              if (rawType === 'createcheckout') {
                executeWorkspaceAction({
                  action: 'create_checkout',
                  params: draftData.params || {},
                });
              }
            }
          } catch (e) {
            console.error('Failed to parse pending action trigger:', e);
          }
        }

        // Clean any action triggers or pending action JSON blocks from the chat bubble reply
        replyText = replyText
          .replace(/\[(PENDING_?ACTION|ACTION_TRIGGER):\s*\{[\s\S]*?\}\s*\]/gi, '')
          .trim();

        // 4. Update history with assistant reply
        setAiChatHistory((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: replyText,
            timestamp: new Date().toISOString(),
          },
        ]);
      } else {
        throw new Error(response?.error || 'Empty response from assistant');
      }
    } catch (err: any) {
      if (controller.signal.aborted) return;
      console.error('Chat Error:', err);  
      setAiChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `${aiName} is currently experiencing technical difficulties.`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      if (!controller.signal.aborted) {
        setAiIsLoading(false);
        setAbortController(null);
      }
    }
  };

  const handleCancelPrompt = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setAiIsLoading(false);
      showToast('Prompt Cancelled', 'Your query was cancelled.');
    }
  };

  const { pendingActions, setDrawerOpen } = usePendingActionStore();
  const activePendingCount = pendingActions.filter(
    (a) => a.status === 'pending_review' || a.status === 'verified'
  ).length;

  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg text-app-text relative overflow-hidden font-sans pb-[74px] md:pb-0">
      {/* Header */}
      <div className="bg-app-card border-b border-app-border p-3.5 flex items-center justify-between gap-2 shrink-0 shadow-xs z-10">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl ">
            <Brain size={18} />
          </div>
          <div>
            <h2 className="text-sm font-extrabold font-display text-app-text flex items-center gap-1">
              <span>{aiName} </span>
            </h2>
            <span className="text-[10px] text-app-text-muted font-medium">
              Enterprise AI Copilot
            </span>
          </div>
        </div>

        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-500 rounded-xl text-xs font-black transition cursor-pointer"
        >
          <ActivitySquareIcon size={13} />
          <span>Pending Actions ({activePendingCount})</span>
        </button>
      </div>

      {/* Messages viewport */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        {groupedMessageSections.map((section) => (
          <div key={section.id} className="space-y-3">
            {/* Group Label Separator */}
            <div className="flex items-center gap-2.5 my-2.5">
              <div className="h-[1px] flex-1 bg-slate-200 dark:bg-slate-800" />
              <span className="text-[9px] font-black uppercase text-amber-500 bg-amber-500/5 px-2.5 py-1 rounded-full border border-amber-500/10 tracking-widest">
                {section.label}
              </span>
              <div className="h-[1px] flex-1 bg-slate-200 dark:bg-slate-800" />
            </div>

            {section.messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={idx}
                  className={`flex flex-col max-w-[85%] animate-fade-in ${
                    isUser
                      ? 'self-end items-end ml-auto'
                      : 'self-start items-start'
                  }`}
                >
                  <div
                    className={`p-3.5 rounded-2xl text-xs leading-relaxed shadow-xs ${
                      isUser
                        ? 'bg-amber-500 text-slate-950 font-bold rounded-tr-xs'
                        : 'bg-app-card text-app-text rounded-tl-xs border border-app-border/70'
                    }`}
                  >
                    {/* Clean plain-text rendering (no markdown rendering as specified by user) */}
                    <p className="whitespace-pre-wrap font-sans">
                      {msg.content}
                    </p>
                  </div>
                  <span className="text-[8px] text-app-text-muted font-mono mt-1 px-1">
                    {isUser
                      ? currentEmployee
                        ? currentEmployee.name
                        : 'Staff Operator'
                      : `${aiName} (AI)`}
                  </span>
                </div>
              );
            })}
          </div>
        ))}

        {aiIsLoading && (
          <div className="flex items-center gap-1.5 bg-app-card p-4 rounded-2xl rounded-tl-xs self-start border border-app-border/70 shadow-xs h-[44px]">
            <span 
              className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" 
              style={{ animationDelay: '0ms' }}
            />
            <span 
              className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" 
              style={{ animationDelay: '150ms' }}
            />
            <span 
              className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" 
              style={{ animationDelay: '300ms' }}
            />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      

      {/* Chat input box */}
      <div className="bg-app-card p-3 border-t border-app-border flex items-center gap-2 shrink-0 z-20 shadow-lg">
        <input
          type="text"
          placeholder={`Ask ${aiName} about milk levels, workflows, promotions...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(input)}
          disabled={aiIsLoading}
          className="flex-1 bg-app-bg text-xs px-4 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none focus:bg-app-card text-app-text transition disabled:opacity-50"
        />
        {aiIsLoading ? (
          <button
            onClick={handleCancelPrompt}
            className="p-2.5 bg-red-500/20 hover:bg-red-500/30 text-red-500 rounded-xl transition cursor-pointer flex items-center justify-center font-bold text-xs"
            title="Cancel Prompt"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => handleSendMessage(input)}
            className="p-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl transition cursor-pointer flex items-center justify-center"
            title="Send Query"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
