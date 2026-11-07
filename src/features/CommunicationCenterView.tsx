import { Customer } from "../types";
import React, { useState, useMemo, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { useBusinessStore } from "../stores/businessStore";
import { useNotificationStore } from "../stores/notificationStore";
import {
  MessageSquare,
  Search,
  Filter,
  CheckSquare,
  Square,
  Send,
  Wand2,
  Phone,
  ShieldAlert,
  Calendar,
  BellRing,
  Clock,
  ChevronRight
} from "lucide-react";
import { titleCase, getFirstName, searchMatch } from "../utils/stringUtils";
import { normalizePhone, SUPPORTED_COUNTRIES } from "../utils/phoneUtils";
import { ReceiptShareService } from "../services/receipt/ReceiptShareService";
import { SupabaseService } from "../services/supabaseService";
import { hasRolePermission } from "../utils/permissions";
import SearchableDropdown from "../components/SearchableDropdown";

export default function CommunicationCenterView() {
  const { customers, currentEmployee, showToast, activeBusinessId, businesses, setActiveTab } = useAppStore();
  const currentBusiness = businesses.find(b => b.id === activeBusinessId);

  const [activeChannel, setActiveChannel] = useState<"customers" | "reminders">("customers");

  // Staff Reminder feed (in-app) across all shifts/sessions for the current user.
  const scheduleReminders = useNotificationStore((s) => s.scheduleReminders);
  const unreadReminderCount = useNotificationStore((s) => s.unreadReminderCount);
  const markReminderAsRead = useNotificationStore((s) => s.markReminderAsRead);

  // Rehydrate reminders when this view mounts (ensures fresh data + live updates)
  useEffect(() => {
    useNotificationStore.getState().initScheduleReminders();
  }, []);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterTier, setFilterTier] = useState<string>("All");
  const [filterDebt, setFilterDebt] = useState<string>("All");
  const [filterActive, setFilterActive] = useState<string>("All");

  const [sendMode, setSendMode] = useState<"auto" | "whatsapp" | "sms" | "email" | "manual">("auto");
  const [manualQueue, setManualQueue] = useState<Customer[]>([]);
  const [messagePurpose, setMessagePurpose] = useState<"service" | "promotion">("service");
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [messageTemplate, setMessageTemplate] = useState("Hello {first_name}, from {business_name}. ");

  const [isAiDrafting, setIsAiDrafting] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiChatHistory, setAiChatHistory] = useState<{role: 'user'|'assistant'|'system', content: string}[]>([]);

  const canViewCustomers = currentEmployee ? hasRolePermission(currentEmployee.role, "communication.view") : false;

  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      // Text Search
      if (searchQuery && !searchMatch(c.name, searchQuery) && !searchMatch(c.phone, searchQuery)) {
        return false;
      }
      // Tier Filter
      if (filterTier !== "All" && c.tier !== filterTier) return false;
      // Debt Filter
      if (filterDebt === "Has Debt" && (!c.debtBalance || c.debtBalance <= 0)) return false;
      if (filterDebt === "No Debt" && (c.debtBalance && c.debtBalance > 0)) return false;
      // Active Status Filter
      if (filterActive === "Active" && c.purchasesCount === 0) return false;
      if (filterActive === "Inactive" && c.purchasesCount > 0) return false;

      return true;
    });
  }, [customers, searchQuery, filterTier, filterDebt, filterActive]);

  const handleSelectAllVisible = () => {
    const newSelected = new Set<string>();
    filteredCustomers.forEach(c => newSelected.add(c.id));
    setSelectedCustomerIds(newSelected);
  };

  const handleDeselectAll = () => {
    setSelectedCustomerIds(new Set());
  };

  const toggleCustomerSelection = (id: string) => {
    const newSelected = new Set(selectedCustomerIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedCustomerIds(newSelected);
  };

  const handleDraftWithAi = async () => {
    if (!aiPrompt.trim()) {
      showToast("Validation", "Please describe the message you want AI to draft.", undefined, "error");
      return;
    }

    setIsAiDrafting(true);
    try {
      const userMessage = { role: 'user' as const, content: aiPrompt };
      const newHistory = [...aiChatHistory, userMessage];
      setAiChatHistory(newHistory);
      setAiPrompt("");

      const messages = [
        { role: 'system', content: `You are an SMS/WhatsApp drafting assistant. Keep it under 160 characters. Use placeholders {first_name} and {business_name}. Do not include quotes. Your work is drafting messages only, not doing actions. If the user prompt is unclear or lacks details, ask follow-up questions instead of drafting. If you are providing the final draft, you MUST prefix the message exactly with [DRAFT] so the system can parse it.` },
        ...newHistory
      ];

      const data = await SupabaseService.callEdgeFunction('chat', {
          messages,
          activeRole: currentEmployee?.role,
          permissions: currentEmployee ? [currentEmployee.role] : [],
          employeeName: currentEmployee?.name,
          businessId: activeBusinessId || currentBusiness?.id,
      });

      if (data && data.success) {
        const reply = data.reply.trim();
        if (reply.startsWith('[DRAFT]')) {
          setMessageTemplate(reply.replace('[DRAFT]', '').trim());
          setAiChatHistory([...newHistory, { role: 'assistant', content: "I've drafted the message for you in the composer below. Feel free to tweak it before sending!" }]);
          showToast("AI Draft", "Message drafted successfully.", undefined, "success");
        } else {
          setAiChatHistory([...newHistory, { role: 'assistant', content: reply }]);
        }
      } else {
        showToast("Error", data?.error || "Failed to draft message.", undefined, "error");
      }
    } catch (err: any) {
      console.error(err);
      showToast("Error", "Could not connect to AI service.", undefined, "error");
    } finally {
      setIsAiDrafting(false);
    }
  };

  const generateMessage = (customer: typeof customers[0]) => {
    const firstName = getFirstName(customer.name) || "Valued Customer";
    const businessName = currentBusiness?.name || "Our Business";
    return messageTemplate
      .replace(/{first_name}/g, firstName)
      .replace(/{business_name}/g, businessName);
  };

  // The customer's own choice decides, whichever way the message would be sent.
  const allowsMessage = (customer: Customer) =>
    messagePurpose === "promotion" ? !!customer.notifyPromotions : customer.notifyService !== false;

  const sendThrough = async (channel: "whatsapp" | "sms" | "email", customer: Customer, body: string): Promise<boolean> => {
    if (channel === "email") {
      if (!customer.email || customer.email === "no-email@kaykays.com") return false;
      const result = await SupabaseService.callEdgeFunction("send-email", {
        to: customer.email,
        type: "customer_message",
        variables: { body },
        businessId: activeBusinessId,
        purpose: messagePurpose,
      });
      return result?.success !== false;
    }
    const result = await SupabaseService.callEdgeFunction(channel === "whatsapp" ? "whatsapp-config" : "sms-config", {
      action: "send",
      businessId: activeBusinessId,
      to: customer.phone,
      body,
      purpose: messagePurpose,
    });
    return !!result?.success;
  };

  const selectedOptedIn = customers.filter((c) => selectedCustomerIds.has(c.id) && allowsMessage(c)).length;

  const handleSendBulk = async () => {
    if (selectedCustomerIds.size === 0) {
      showToast("Validation", "Select at least one customer.", undefined, "error");
      return;
    }
    if (!messageTemplate.trim()) {
      showToast("Validation", "Message cannot be empty.", undefined, "error");
      return;
    }

    const chosen = customers.filter(c => selectedCustomerIds.has(c.id));
    const selectedCustomers = chosen.filter(allowsMessage);
    const skipped = chosen.length - selectedCustomers.length;
    if (skipped > 0) {
      showToast(
        "Some Customers Skipped",
        `${skipped} ${skipped === 1 ? "customer has" : "customers have"} not agreed to this kind of message.`,
        undefined,
        "info",
      );
    }
    if (selectedCustomers.length === 0) return;

    if (sendMode === "manual") {
      setManualQueue(selectedCustomers);
      handleDeselectAll();
      return;
    }

    // Automatic tries WhatsApp then SMS. Whoever can't be reached goes to the by-hand list.
    const channels: ("whatsapp" | "sms" | "email")[] = sendMode === "auto" ? ["whatsapp", "sms"] : [sendMode];
    const unsent: Customer[] = [];
    let sent = 0;
    showToast("Sending Messages", `Sending to ${selectedCustomers.length} customers...`, undefined, "info");

    for (const customer of selectedCustomers) {
      let delivered = false;
      for (const channel of channels) {
        try {
          delivered = await sendThrough(channel, customer, generateMessage(customer));
        } catch (err) {
          console.error(`Sending by ${channel} failed:`, err);
        }
        if (delivered) break;
      }
      if (delivered) sent++;
      else unsent.push(customer);
    }

    setManualQueue(unsent);
    if (unsent.length === 0) {
      showToast("Messages Sent", `Sent ${sent} messages.`, undefined, "success");
    } else {
      showToast("Some Need Sending by Hand", `Sent ${sent}. ${unsent.length} are listed below to send yourself.`, undefined, "info");
    }

    handleDeselectAll();
  };

  const handleManualSend = async (customer: Customer) => {
    await ReceiptShareService.shareTextViaWhatsApp(customer.phone, generateMessage(customer));
    setManualQueue((queue) => queue.filter((c) => c.id !== customer.id));
  };

  if (!canViewCustomers) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-app-bg text-center font-sans">
        <div className="p-4 bg-red-500/10 rounded-2xl border border-red-500/20 text-red-500 max-w-sm flex flex-col items-center gap-2.5 shadow">
          <ShieldAlert size={36} />
          <div>
            <h4 className="font-extrabold text-sm uppercase tracking-wider">Access Restrained</h4>
            <p className="text-xs text-app-text-muted mt-1 leading-relaxed">
              Your role does not have permission to access the Communication Center.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isAllVisibleSelected = filteredCustomers.length > 0 && filteredCustomers.every(c => selectedCustomerIds.has(c.id));

  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg text-app-text font-sans p-3 sm:p-4 md:p-6 pb-nav overflow-y-auto animate-fade-in">

      {/* Header */}
     

      {/* Channel Tabs */}
      <div className="flex items-stretch sm:items-center gap-2 mb-5 shrink-0">
        <button
          onClick={() => setActiveChannel("customers")}
          className={`flex-1 sm:flex-none px-3 sm:px-4 py-2.5 sm:py-2 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
            activeChannel === "customers"
              ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
              : "bg-app-card border border-app-border text-app-text-muted hover:border-app-border/80"
          }`}
        >
          <MessageSquare size={13} className="shrink-0" />
          <span className="truncate">Customer Messaging</span>
        </button>
        <button
          onClick={() => setActiveChannel("reminders")}
          className={`flex-1 sm:flex-none px-3 sm:px-4 py-2.5 sm:py-2 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
            activeChannel === "reminders"
              ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
              : "bg-app-card border border-app-border text-app-text-muted hover:border-app-border/80"
          }`}
        >
          <BellRing size={13} className="shrink-0" />
          <span className="truncate">Staff Reminders</span>
          {unreadReminderCount > 0 && (
            <span className="px-1.5 py-0.5 bg-red-500 text-white rounded-full text-[9px] font-bold shrink-0">
              {unreadReminderCount}
            </span>
          )}
        </button>
      </div>

      {activeChannel === "reminders" ? (
        /* STAFF REMINDERS FEED — in-app schedule reminders for the current user */
        <div className="flex-1 flex flex-col bg-app-card border border-app-border rounded-3xl p-3 sm:p-4 md:p-5 shadow-xs min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-4 shrink-0 gap-2">
            <h2 className="text-xs sm:text-sm font-extrabold uppercase tracking-wide flex items-center gap-2">
              <Calendar size={14} className="text-amber-500 shrink-0" />
              My Shift Reminders
            </h2>
            <span className="text-[10px] text-app-text-muted font-bold bg-app-bg px-2 py-1 rounded-lg border border-app-border/40 shrink-0">
              {scheduleReminders.length} total
            </span>
          </div>

          <div className="flex-1 overflow-y-auto border border-app-border rounded-xl">
            {scheduleReminders.length === 0 ? (
              <div className="p-8 sm:p-10 text-center text-xs text-app-text-muted font-bold flex flex-col items-center gap-2">
                <BellRing size={24} className="opacity-30" />
                No schedule reminders yet. When a shift is assigned to you,
                a reminder will appear here automatically.
              </div>
            ) : (
              <div className="divide-y divide-app-border">
                {scheduleReminders.map((rem) => {
                  let payload: any = {};
                  try {
                    payload = typeof rem.payload === "string" ? JSON.parse(rem.payload) : rem.payload;
                  } catch(e) {}
                  const isUnread = !rem.read_at;
                  const shiftDate = payload?.shift_date || "";
                  const startTime = payload?.start_time || "";

                  return (
                    <div
                      key={rem.id}
                      onClick={() => {
                        if (isUnread) markReminderAsRead(rem.id);
                        setActiveTab("dashboard");
                      }}
                      className={`p-3 sm:p-4 cursor-pointer transition-colors flex items-center gap-3 hover:bg-app-bg/50 ${
                        isUnread ? "bg-amber-500/5" : "opacity-70"
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isUnread ? "bg-amber-500/15 text-amber-500 border border-amber-500/20" : "bg-app-bg text-app-text-muted border border-app-border"
                      }`}>
                        <Clock size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className={`text-[13px] font-extrabold truncate ${isUnread ? "text-app-text" : "text-app-text-muted"}`}>
                            {rem.title}
                          </h4>
                          {isUnread && (
                            <span className="px-1.5 py-0.5 bg-red-500/10 text-red-500 border border-red-500/20 rounded-full text-[8px] font-bold uppercase tracking-wider shrink-0">
                              Unread
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-app-text-muted font-medium mt-0.5 leading-relaxed">
                          {rem.message}
                        </p>
                        {(shiftDate || startTime) && (
                          <p className="text-[10px] font-mono text-amber-500/80 mt-1 font-bold">
                            📅 {shiftDate || "—"} {startTime ? `at ${startTime}` : ""}
                          </p>
                        )}
                      </div>
                      <ChevronRight size={15} className="text-app-text-muted shrink-0" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-5 flex-1 min-h-0">

        {/* Left Side: Audience Selection */}
        <div className="flex-1 lg:flex-[1.4] flex flex-col bg-app-card border border-app-border rounded-3xl p-3 sm:p-4 md:p-5 shadow-xs overflow-hidden min-h-[420px]">
          <h2 className="text-xs sm:text-sm font-extrabold uppercase tracking-wide mb-3 sm:mb-4 flex items-center gap-2">
            <span className="w-5 h-5 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
            Select Audience
          </h2>

          {/* Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2 mb-3 shrink-0">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search size={13} className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-app-text-muted" />
              <input
                type="text"
                placeholder="Search name/phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-[38px] bg-app-bg text-xs pl-8 pr-3 py-1.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none transition font-bold"
              />
            </div>
            <div className='flex w-full  gap-2 sm:gap-3 lg:gap-2.5 '>
            <SearchableDropdown
              items={[
                { id: "All", label: "All Tiers" },
                { id: "Bronze", label: "Bronze" },
                { id: "Silver", label: "Silver" },
                { id: "Gold", label: "Gold" },
              ]}
              selectedValue={filterTier}
              onChange={setFilterTier}
              placeholder="Tier Filter"
            />
            <SearchableDropdown
              items={[
                { id: "All", label: "Any Debt" },
                { id: "Has Debt", label: "Has Debt" },
                { id: "No Debt", label: "No Debt" },
              ]}
              selectedValue={filterDebt}
              onChange={setFilterDebt}
              placeholder="Debt Filter"
            />
            <SearchableDropdown
              items={[
                { id: "All", label: "All Activity" },
                { id: "Active", label: "Active (Has Purchases)" },
                { id: "Inactive", label: "Inactive (No Purchases)" },
              ]}
              selectedValue={filterActive}
              onChange={setFilterActive}
              placeholder="Activity Filter"
            />
            </div>
          </div>

          {/* Selection Controls */}
          <div className="flex items-center gap-3 mb-2 pb-2 border-b border-app-border shrink-0">
            <button
              onClick={isAllVisibleSelected ? handleDeselectAll : handleSelectAllVisible}
              className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-amber-500 hover:text-amber-600 transition py-1"
            >
              {isAllVisibleSelected ? <CheckSquare size={15} /> : <Square size={15} />}
              {isAllVisibleSelected ? "Deselect All" : "Select Visible"}
            </button>
            <span className="text-[10px] sm:text-[11px] text-app-text-muted font-bold ml-auto bg-app-bg px-2 py-1 rounded-lg border border-app-border/40 shrink-0">
              {selectedCustomerIds.size} Selected
            </span>
          </div>

          {/* List: cards on mobile, table from sm up */}
          <div className="flex-1 overflow-y-auto border border-app-border rounded-xl">
            {filteredCustomers.length === 0 ? (
              <div className="p-8 text-center text-xs text-app-text-muted font-bold">
                No customers match these filters.
              </div>
            ) : (
              <>
                {/* Mobile card list */}
                <div className="sm:hidden divide-y divide-app-border">
                  {filteredCustomers.map(c => {
                    const isSelected = selectedCustomerIds.has(c.id);
                    return (
                      <div
                        key={c.id}
                        onClick={() => toggleCustomerSelection(c.id)}
                        className={`p-3 flex items-center gap-3 cursor-pointer transition-colors active:bg-app-bg/70 ${isSelected ? 'bg-amber-500/10' : ''}`}
                      >
                        {isSelected ? (
                          <CheckSquare size={18} className="text-amber-500 shrink-0" />
                        ) : (
                          <Square size={18} className="text-app-text-muted shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-extrabold truncate">{titleCase(c.name)}</span>
                            <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase ${
                              c.tier === "Gold" ? "bg-amber-500/15 text-amber-500 border border-amber-500/20" :
                              c.tier === "Silver" ? "bg-slate-500/15 text-slate-400 border border-slate-500/20" :
                              "bg-orange-500/15 text-orange-600 border border-orange-500/20"
                            }`}>
                              {c.tier}
                            </span>
                          </div>
                          <span className="flex items-center gap-1.5 text-[11px] font-mono text-app-text-muted mt-0.5">
                            <Phone size={10} />
                            {c.phone}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Table from sm up, horizontally scrollable if needed */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[520px]">
                    <thead className="bg-app-bg sticky top-0 z-10 text-[9px] font-bold uppercase text-app-text-muted tracking-widest shadow-sm">
                      <tr>
                        <th className="p-2 border-b border-app-border w-10 text-center"></th>
                        <th className="p-2 border-b border-app-border">First Name</th>
                        <th className="p-2 border-b border-app-border">Full Name</th>
                        <th className="p-2 border-b border-app-border">Phone Number</th>
                        <th className="p-2 border-b border-app-border text-right">Tier</th>
                      </tr>
                    </thead>
                    <tbody className="text-[11px] font-bold divide-y divide-app-border">
                      {filteredCustomers.map(c => {
                        const isSelected = selectedCustomerIds.has(c.id);
                        return (
                          <tr
                            key={c.id}
                            onClick={() => toggleCustomerSelection(c.id)}
                            className={`cursor-pointer transition-colors ${isSelected ? 'bg-amber-500/10' : 'hover:bg-app-bg/50'}`}
                          >
                            <td className="p-2 text-center">
                              {isSelected ? (
                                <CheckSquare size={14} className="text-amber-500 inline-block" />
                              ) : (
                                <Square size={14} className="text-app-text-muted inline-block" />
                              )}
                            </td>
                            <td className="p-2 text-amber-500 font-extrabold">{getFirstName(c.name)}</td>
                            <td className="p-2">{titleCase(c.name)}</td>
                            <td className="p-2 font-mono">
                              <span className="flex items-center gap-1.5 opacity-80">
                                <Phone size={10} />
                                {c.phone}
                              </span>
                            </td>
                            <td className="p-2 text-right">
                              <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-bold uppercase inline-block ${
                                c.tier === "Gold" ? "bg-amber-500/15 text-amber-500 border border-amber-500/20" :
                                c.tier === "Silver" ? "bg-slate-500/15 text-slate-400 border border-slate-500/20" :
                                "bg-orange-500/15 text-orange-600 border border-orange-500/20"
                              }`}>
                                {c.tier}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Side: Message Composer */}
        <div className="w-full lg:w-[380px] xl:w-[420px] flex flex-col gap-4 shrink-0">
          <div className="bg-app-card border border-app-border rounded-3xl p-3 sm:p-4 md:p-5 shadow-xs flex-1 flex flex-col">
            <h2 className="text-xs sm:text-sm font-extrabold uppercase tracking-wide mb-1 flex items-center gap-2">
              <span className="w-5 h-5 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
              Compose Message
            </h2>
            <p className="text-[10px] sm:text-[11px] text-app-text-muted font-bold mb-4 ml-7">Placeholders: {'{first_name}'}, {'{business_name}'}</p>

            {/* AI Assistant Box */}
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-3 mb-4 flex flex-col">
              <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold text-amber-500 uppercase tracking-wider">
                <Wand2 size={12} />
                Message Drafting Assistant
              </div>

              {/* Chat History */}
              {aiChatHistory.length > 0 && (
                <div className="mb-3 space-y-2 max-h-[150px] overflow-y-auto p-2 bg-app-bg border border-app-border/50 rounded-xl">
                  {aiChatHistory.map((msg, idx) => (
                    <div key={idx} className={`text-[11px] p-2 rounded-lg ${msg.role === 'user' ? 'bg-amber-500/10 text-amber-600 ml-4' : 'bg-slate-100 dark:bg-slate-800 text-app-text-muted mr-4'}`}>
                      <span className="font-bold opacity-50 block mb-0.5">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
                      {msg.content}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <textarea
                  placeholder="Describe the message..."
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  className="flex-1 min-w-0 bg-app-bg text-xs px-3 py-2.5 rounded border border-app-border focus:border-amber-500 focus:outline-none transition font-bold"
                  onKeyDown={e => { if(e.key === 'Enter') handleDraftWithAi(); }}
                />
                <button
                  onClick={handleDraftWithAi}
                  disabled={isAiDrafting || !aiPrompt.trim()}
                  className="px-3 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 font-bold rounded-xl text-[10px] uppercase tracking-wider disabled:opacity-50 transition shrink-0"
                >
                  {isAiDrafting ? "..." : "Send"}
                </button>
              </div>
            </div>

            <textarea
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              className="w-full flex-1 min-h-[140px] bg-app-bg border border-app-border rounded-2xl p-4 text-sm text-app-text focus:outline-none focus:border-amber-500 transition font-medium resize-none mb-4 shadow-inner"
              placeholder="Type your message here..."
            />

            {/* Preview Box */}
            <div className="bg-app-bg border border-app-border/60 rounded-2xl p-3 mb-4 text-xs text-app-text-muted relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-500/50 rounded-l-2xl"></div>
              <div className="font-bold uppercase tracking-wider mb-1 text-[9px] pl-2 text-amber-500/70">Live Preview:</div>
              <div className="italic leading-relaxed pl-2 whitespace-pre-wrap">
                {generateMessage({ name: "James Mwangi", phone: "+254700000000" } as any)}
              </div>
            </div>

            <label className="flex flex-col gap-1 text-xs font-medium text-app-text mb-3">
              Message type
              <SearchableDropdown
                items={[
                  { id: 'service', label: 'Order update or reminder' },
                  { id: 'promotion', label: 'Offer or promotion' },
                ]}
                selectedValue={messagePurpose}
                onChange={(value) => setMessagePurpose(value as typeof messagePurpose)}
                placeholder="Message type"
              />
              <span className="font-normal text-app-text-muted">
                {messagePurpose === "promotion"
                  ? `${selectedOptedIn} of ${selectedCustomerIds.size} selected agreed to offers.`
                  : `${selectedOptedIn} of ${selectedCustomerIds.size} selected accept updates and reminders.`}
              </span>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-app-text">
              Send by
              <SearchableDropdown
                items={[
                  { id: 'auto', label: 'Automatic: WhatsApp API, then SMS' },
                  { id: 'whatsapp', label: 'WhatsApp API' },
                  { id: 'sms', label: 'SMS' },
                  { id: 'email', label: 'Email' },
                  { id: 'manual', label: 'By hand: open each WhatsApp chat' },
                ]}
                selectedValue={sendMode}
                onChange={(value) => setSendMode(value as typeof sendMode)}
                placeholder="How to send"
              />
            </label>

            <button
              onClick={handleSendBulk}
              disabled={selectedCustomerIds.size === 0 || !messageTemplate.trim()}
              className="w-full py-4 sm:py-3.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 font-bold rounded-2xl text-xs uppercase tracking-widest transition shadow flex items-center justify-center gap-2 sticky bottom-0"
            >
              <Send size={16} />
              Dispatch to {selectedCustomerIds.size} Customer {selectedCustomerIds.size === 1 ? "" : "s"}
            </button>

            {manualQueue.length > 0 && (
              <div className="flex flex-col gap-2 border-t border-app-border pt-3">
                <p className="text-xs font-semibold text-app-text">Send these yourself ({manualQueue.length} left)</p>
                {manualQueue.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => handleManualSend(customer)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-app-border bg-app-bg px-3 py-2 text-left text-xs text-app-text"
                  >
                    <span className="min-w-0 truncate">{customer.name}</span>
                    <span className="shrink-0 font-semibold text-amber-500">Open WhatsApp</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}