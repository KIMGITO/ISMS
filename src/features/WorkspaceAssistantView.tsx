import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { usePendingActionStore } from '../stores/pendingActionStore';
import { useCustomerStore } from '../stores/customerStore';
import { Send, ChevronDown, ChevronUp, Bot } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { SupabaseService } from '../services/supabaseService';
import type { ChatMessage } from '../stores/uiStore';
import { parseAssistantReply } from '../utils/assistantReply';
import ActionCard from '../components/assistant/ActionCard';
import QuestionCard from '../components/assistant/QuestionCard';

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
      case 'Admin':
        return [
          'How did sales go this week?',
          'Which products are running low?',
          'Who owes us the most money?',
          'How do I invite a new worker?',
        ];
      case 'Manager':
      case 'Store Supervisor':
        return [
          'Which products are running low?',
          'How were sales today?',
          'Who is clocked in right now?',
          'How do I change what a role can do?',
        ];
      case 'Cashier':
        return [
          'How do I sell on credit?',
          'How do I add a customer to a sale?',
          'How do I take an M-Pesa payment?',
          'How do loyalty points work?',
        ];
      case 'Rider':
        return [
          'Which deliveries are waiting for me?',
          'How do I mark a delivery as done?',
          'How do I give back a delivery?',
          'What did I earn this week?',
        ];
      case 'Inventory Clerk':
        return [
          'Which products are running low?',
          'How do I record damaged stock?',
          'How do I send stock to another branch?',
          'How do I receive a supplier delivery?',
        ];
      case 'Accountant':
        return [
          'What was our profit this month?',
          'How do I record an expense?',
          'Which supplier bills are due?',
          'Who owes us money?',
        ];
      case 'Marketing Officer':
        return [
          'Write an SMS about this week\'s offer',
          'Which customers have not bought in a while?',
          'How do I make a promotion code?',
          'Which products sell best?',
        ];
      case 'Receptionist':
        return [
          'How do I add a new customer?',
          'How do I reply to customer feedback?',
          'How do loyalty points work?',
          'What do the customer tiers mean?',
        ];
      default:
        return [
          'How do I make a sale?',
          'Which products are running low?',
          'How do I clock in and out?',
          'How do loyalty points work?',
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

  /** answering: the message and question index this text answers, so its choices lock. */
  const handleSendMessage = async (text: string, answering?: { msg: number; q: number }) => {
    if (!text.trim() || aiIsLoading) return;
    if (answering) {
      setAiChatHistory((prev) =>
        prev.map((m, i) =>
          i === answering.msg && m.questions
            ? { ...m, questions: m.questions.map((q, j) => (j === answering.q ? { ...q, answer: text } : q)) }
            : m,
        ),
      );
    }

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

      // 3. Use the latestHistory variable we just created
      // The model only sees text, so tell it what its cards were and what became of them.
      const allActions = usePendingActionStore.getState().pendingActions;
      const statusWord = { pending_review: 'waiting for the person to confirm', verified: 'waiting for the person to confirm', executed: 'done', rejected: 'discarded by the person' } as const;
      const apiMessages = latestHistory.map((m) => {
        const notes: string[] = [];
        for (const id of m.actionIds || []) {
          const a = allActions.find((x) => x.id === id);
          if (a) notes.push(`(Prepared task "${a.title}": ${statusWord[a.status]})`);
        }
        for (const q of m.questions || []) notes.push(`(Asked: ${q.question} Choices: ${q.options.join(' / ')})`);
        return { role: m.role, content: [m.content, ...notes].filter(Boolean).join('\n') };
      });

      const response = await SupabaseService.callEdgeFunction('chat', {
        messages: apiMessages,
        activeRole: currentRole,
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
          response.reply || "Sorry, I don't have an answer for that.";
        // Owners and Admins also get one plain line on what to fix (the server only
        // sends it to them).
        if (response.success === false && response.ownerHint) {
          replyText += `\n\nFor the owner: ${response.ownerHint}`;
        }

        // Tasks and questions come as tagged JSON lines; they show as cards under the
        // reply. Nothing runs until the person taps Confirm on the card, where the app
        // checks their own permission for the task (not what the AI wrote).
        const parsed = parseAssistantReply(replyText);
        const actionIds = parsed.drafts.map((d) =>
          usePendingActionStore.getState().addPendingAction({
            type: d.type as any,
            title: d.title,
            summary: d.summary,
            requiredPermission: '',
            params: d.params,
            createdBy: `${aiName} (assistant)`,
          }).id,
        );
        replyText = parsed.text || (actionIds.length ? 'Here it is. Check the details and tap Confirm.' : parsed.questions.length ? '' : replyText);

        // 4. Update history with assistant reply
        setAiChatHistory((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: replyText,
            timestamp: new Date().toISOString(),
            ...(actionIds.length ? { actionIds } : {}),
            ...(parsed.questions.length ? { questions: parsed.questions } : {}),
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
      showToast('Stopped', 'The question was cancelled.');
    }
  };

  const pendingActions = usePendingActionStore((st) => st.pendingActions);
  const actionById = new Map(pendingActions.map((a) => [a.id, a]));
  // Drafts made before tasks moved into the chat, still waiting: shown at the end.
  const linkedIds = new Set(aiChatHistory.flatMap((m) => m.actionIds || []));
  const olderDrafts = pendingActions.filter(
    (a) => !linkedIds.has(a.id) && (a.status === 'pending_review' || a.status === 'verified'),
  );
  const lastAssistantIdx = aiChatHistory.map((m) => m.role).lastIndexOf('assistant');
  const showStarters = !isSuggestionsCollapsed;

  return (
    <div className="nav-room flex-1 flex flex-col h-full bg-app-bg text-app-text relative overflow-hidden font-sans max-md:pb-[calc(var(--mobile-nav-height)+var(--mobile-nav-gap)*2+var(--inset-bottom))]">
      {/* Header */}
      <div className="bg-app-card border-b border-app-border px-4 py-3 flex items-center gap-2.5 shrink-0 shadow-xs z-10">
        <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
          <Bot size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold font-display text-app-text">{aiName}</h2>
          <span className="text-[10px] text-app-text-muted font-medium">
            Ask anything, or ask {aiName} to do a task. You confirm every change.
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6 flex flex-col gap-4">
        <div className="w-full max-w-3xl mx-auto flex flex-col gap-4">
          {groupedMessageSections.map((section) => (
            <div key={section.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5 my-1">
                <div className="h-px flex-1 bg-app-border" />
                <span className="text-[11px] font-semibold text-app-text-muted">{section.label}</span>
                <div className="h-px flex-1 bg-app-border" />
              </div>

              {section.messages.map((msg) => {
                const index = aiChatHistory.indexOf(msg);
                const isUser = msg.role === 'user';
                const actions = (msg.actionIds || []).map((id) => actionById.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof actionById.get>>[];
                return (
                  <div
                    key={`${msg.timestamp}-${index}`}
                    className={`flex flex-col gap-2 animate-fade-in ${isUser ? 'items-end ml-auto max-w-[85%]' : 'items-start w-full max-w-[92%] md:max-w-[85%]'}`}
                  >
                    {msg.content && (
                      <div
                        className={`px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed shadow-xs ${
                          isUser
                            ? 'bg-amber-500 text-slate-950 font-semibold rounded-tr-sm'
                            : 'bg-app-card text-app-text rounded-tl-sm border border-app-border/70'
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      </div>
                    )}

                    {actions.map((a) => (
                      <ActionCard key={a.id} action={a} />
                    ))}

                    {(msg.questions || []).map((q, qi) => (
                      <QuestionCard
                        key={qi}
                        question={q}
                        enabled={index === lastAssistantIdx && !aiIsLoading}
                        onAnswer={(answer) => handleSendMessage(answer, { msg: index, q: qi })}
                      />
                    ))}

                    <span className="text-[11px] text-app-text-muted px-1">
                      {isUser ? currentEmployee?.name || 'You' : aiName}
                      {msg.timestamp ? ` · ${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}

          {olderDrafts.length > 0 && (
            <div className="flex flex-col gap-2 w-full max-w-[92%] md:max-w-[85%]">
              <span className="text-[10px] font-bold text-app-text-muted px-1">Still waiting from before</span>
              {olderDrafts.map((a) => (
                <ActionCard key={a.id} action={a} />
              ))}
            </div>
          )}

          {aiIsLoading && (
            <div className="flex items-center gap-1.5 bg-app-card px-4 rounded-2xl rounded-tl-sm self-start border border-app-border/70 shadow-xs h-11" aria-label={`${aiName} is typing`}>
              {[0, 150, 300].map((d) => (
                <span key={d} className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="bg-app-card border-t border-app-border shrink-0 z-20">
        <div className="w-full max-w-3xl mx-auto px-3 pt-2 pb-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSuggestionsCollapsed}
              aria-expanded={showStarters}
              className="flex items-center gap-1 text-[10px] font-bold text-app-text-muted hover:text-app-text cursor-pointer"
            >
              Ideas
              {showStarters ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            </button>
          </div>
          {showStarters && (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
              {suggestedPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={aiIsLoading}
                  onClick={() => handleSendMessage(p)}
                  className="shrink-0 min-h-8 px-3 rounded-full border border-app-border bg-app-bg text-[11px] text-app-text hover:border-amber-500 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              placeholder={`Message ${aiName}… e.g. "Jane paid 500 by M-Pesa"`}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(input);
                  (e.target as HTMLTextAreaElement).style.height = 'auto';
                }
              }}
              disabled={aiIsLoading}
              className="flex-1 resize-none bg-app-bg text-[13px] px-4 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-app-text transition disabled:opacity-50 max-h-32"
            />
            {aiIsLoading ? (
              <button
                onClick={handleCancelPrompt}
                className="h-10 px-3 bg-red-500/15 hover:bg-red-500/25 text-red-500 rounded-xl transition cursor-pointer font-bold text-xs"
                title="Stop"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={() => handleSendMessage(input)}
                disabled={!input.trim()}
                aria-label="Send"
                className="w-10 h-10 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-slate-950 rounded-xl transition cursor-pointer flex items-center justify-center"
              >
                <Send size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
