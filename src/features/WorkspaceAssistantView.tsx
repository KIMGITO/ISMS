import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  Send,
  RefreshCw,
  Bot,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Brain,
} from 'lucide-react';
import { getDynamicRoles } from '../utils/permissions';
import { SupabaseService } from '../services/supabaseService';

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

  const executeWorkspaceAction = (actionData: any) => {
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

    try {
      const inventoryStatus = products
        .map((p) => `${p.name} (SKU: ${p.sku}, Stock: ${p.stock})`)
        .join('\n');

      const loggedInUser = currentEmployee?.name || 'Staff Operator';
      const currentRole = currentEmployee?.role || 'Staff';
      const rolePermissions = getDynamicRoles()[currentRole]?.permissions || [];

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
      });

      console.log('Full AI Response Object:', response);

      if (response && (response.success || response.reply)) {
        let replyText =
          response.reply || 'I received your message, but I have no response.';

        // Handle Action Triggers
        const actionRegex = /\[ACTION_TRIGGER:\s*(\{.*?\})\s*\]/g;
        let match;
        while ((match = actionRegex.exec(replyText)) !== null) {
          try {
            const actionData = JSON.parse(match[1]);
            if (actionData && actionData.action) {
              executeWorkspaceAction(actionData);
            }
          } catch (e) {
            console.error('Failed to parse action trigger:', e);
          }
        }

        replyText = replyText
          .replace(/\[ACTION_TRIGGER:\s*(\{.*?\})\s*\]/g, '')
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
      setAiIsLoading(false);
    }
  };
  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg text-app-text relative overflow-hidden font-sans pb-[74px] md:pb-0">
      {/* Header */}
      <div className="bg-app-card border-b border-app-border p-3.5 flex items-center gap-2 shrink-0 shadow-xs z-10">
        <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl ">
          <Brain size={18} />
        </div>
        <div>
          <h2 className="text-sm font-extrabold font-display text-app-text flex items-center gap-1">
            <span>{aiName} </span>
          </h2>
          <span className="text-[10px] text-app-text-muted font-medium">
            Workspace Assistant
          </span>
        </div>
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
          className="flex-1 bg-app-bg text-xs px-4 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none focus:bg-app-card text-app-text transition"
        />
        <button
          onClick={() => handleSendMessage(input)}
          className="p-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl transition cursor-pointer flex items-center justify-center"
          title="Send Query"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
