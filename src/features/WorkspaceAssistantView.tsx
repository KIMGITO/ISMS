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
      const loggedInUser = currentEmployee?.name || authUser?.name || 'Owner';
      const rawRole = currentEmployee?.role || 'Owner';
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
        // Owners and Admins also get one plain line on what to fix (the server only
        // sends it to them).
        if (response.success === false && response.ownerHint) {
          replyText += `\n\nFor the owner: ${response.ownerHint}`;
        }

        // Handle AI Pending Action Drafts & Action Triggers
        // Supports both [PENDING_ACTION: {...}] and plain PENDING_ACTION: {...}
        // Uses brace-counting to correctly extract nested JSON objects.
        const extractPendingActions = (text: string) => {
          const tagRegex = /\[?(PENDING_?ACTION|ACTION_TRIGGER):\s*\{/gi;
          const results: { fullMatch: string; jsonStr: string }[] = [];
          let tagMatch: RegExpExecArray | null;
          while ((tagMatch = tagRegex.exec(text)) !== null) {
            // Start of the JSON object is the position of '{'
            const jsonStart = tagMatch.index + tagMatch[0].length - 1;
            let depth = 0;
            let inString = false;
            let escape = false;
            let i = jsonStart;
            for (; i < text.length; i++) {
              const ch = text[i];
              if (escape) { escape = false; continue; }
              if (ch === '\\' && inString) { escape = true; continue; }
              if (ch === '"') { inString = !inString; continue; }
              if (inString) continue;
              if (ch === '{') depth++;
              else if (ch === '}') {
                depth--;
                if (depth === 0) break;
              }
            }
            if (depth === 0) {
              const jsonStr = text.slice(jsonStart, i + 1);
              // Include optional closing ] if present
              const afterJson = text.slice(i + 1);
              const closingBracket = afterJson.match(/^\s*\]/);
              const fullMatch = text.slice(tagMatch.index, i + 1 + (closingBracket ? closingBracket[0].length : 0));
              results.push({ fullMatch, jsonStr });
            }
          }
          return results;
        };

        const actionMatches = extractPendingActions(replyText);
        let queued = 0;
        for (const { jsonStr } of actionMatches) {
          try {
            const draftData = JSON.parse(jsonStr);
            const type = draftData.type || draftData.action;
            if (!type) continue;
            // Nothing runs yet: the person confirms in Pending Actions, where the app
            // checks their own permission for this type (not what the AI wrote).
            usePendingActionStore.getState().addPendingAction({
              type,
              title: draftData.title || 'Assistant task',
              summary: draftData.summary || '',
              requiredPermission: '',
              params: draftData.params || {},
              createdBy: `${aiName} (assistant)`,
            });
            queued++;
          } catch (e) {
            console.error('Failed to parse pending action trigger:', e, jsonStr);
          }
        }
        if (queued > 0) usePendingActionStore.getState().setDrawerOpen(true);

        // Clean all matched action blocks from the visible chat bubble reply
        for (const { fullMatch } of actionMatches) {
          replyText = replyText.replace(fullMatch, '');
        }
        replyText = replyText.trim();

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
          content: navigator.onLine
            ? `Sorry, I couldn't answer that just now. Please try again in a minute.`
            : `You're offline, so I can't answer right now. I'll be here when you're back online.`,
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
    <div className="flex-1 flex flex-col h-full bg-app-bg text-app-text relative overflow-hidden font-sans max-md:pb-[calc(var(--mobile-nav-height)+var(--mobile-nav-gap)*2+var(--inset-bottom))]">
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
