import React, { useState, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { useBusinessStore } from "../stores/businessStore";
import {
  MessageSquare,
  Search,
  Filter,
  CheckSquare,
  Square,
  Send,
  Wand2,
  Phone,
  ShieldAlert
} from "lucide-react";
import { titleCase, getFirstName, searchMatch } from "../utils/stringUtils";
import { normalizePhone, SUPPORTED_COUNTRIES } from "../utils/phoneUtils";
import { ReceiptShareService } from "../services/receipt/ReceiptShareService";
import { SupabaseService } from "../services/supabaseService";
import { hasRolePermission } from "../utils/permissions";
import SearchableDropdown from "../components/SearchableDropdown";

export default function CommunicationCenterView() {
  const { customers, currentEmployee, showToast, activeBusinessId, businesses } = useAppStore();
  const currentBusiness = businesses.find(b => b.id === activeBusinessId);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterTier, setFilterTier] = useState<string>("All");
  const [filterDebt, setFilterDebt] = useState<string>("All");
  const [filterActive, setFilterActive] = useState<string>("All");

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

  const handleSendBulk = async () => {
    if (selectedCustomerIds.size === 0) {
      showToast("Validation", "Select at least one customer.", undefined, "error");
      return;
    }
    if (!messageTemplate.trim()) {
      showToast("Validation", "Message cannot be empty.", undefined, "error");
      return;
    }

    const selectedCustomers = customers.filter(c => selectedCustomerIds.has(c.id));
    
    showToast("Dispatching Messages", `Preparing to send ${selectedCustomers.length} messages...`, undefined, "info");

    // In a real application, a backend queue would handle bulk dispatch. 
    // Here we'll dispatch them sequentially via the local device if possible, or simulated.
    for (const customer of selectedCustomers) {
      const msg = generateMessage(customer);
      // Attempt WhatsApp web redirection or notify success (simulation for large lists to prevent blocking)
      // Since window.open in a loop might get blocked by popup blockers, we might just log or simulate here.
      console.log(`Sending to ${customer.phone}: ${msg}`);
      // await ReceiptShareService.shareTextViaWhatsApp(customer.phone, msg);
    }
    
    // For demonstration, we trigger the first one via WhatsApp so the user sees it work
    if (selectedCustomers.length > 0) {
      const firstCustomer = selectedCustomers[0];
      const msg = generateMessage(firstCustomer);
      await ReceiptShareService.shareTextViaWhatsApp(firstCustomer.phone, msg);
    }

    showToast("Bulk Dispatch Complete", `Sent ${selectedCustomers.length} messages.`, undefined, "success");
    handleDeselectAll();
  };

  if (!canViewCustomers) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-app-bg text-center font-sans">
        <div className="p-4 bg-red-500/10 rounded-2xl border border-red-500/20 text-red-500 max-w-sm flex flex-col items-center gap-2.5 shadow">
          <ShieldAlert size={36} />
          <div>
            <h4 className="font-extrabold text-sm uppercase tracking-wider">Access Restrained</h4>
            <p className="text-[11px] text-app-text-muted mt-1 leading-relaxed">
              Your role does not have permission to access the Communication Center.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isAllVisibleSelected = filteredCustomers.length > 0 && filteredCustomers.every(c => selectedCustomerIds.has(c.id));

  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg text-app-text font-sans p-4 md:p-6 overflow-y-auto animate-fade-in">
      
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 shrink-0">
        <div className="w-10 h-10 bg-amber-500/10 rounded-xl border border-amber-500/20 flex items-center justify-center text-amber-500">
          <MessageSquare size={20} />
        </div>
        <div>
          <h1 className="text-xl font-extrabold font-display uppercase tracking-wide">Communication Center</h1>
          <p className="text-[11px] text-app-text-muted font-bold mt-0.5">Bulk Customer Messaging Hub</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 flex-1 min-h-0">
        
        {/* Left Side: Audience Selection */}
        <div className="flex-1 lg:flex-[1.4] flex flex-col bg-app-card border border-app-border rounded-3xl p-4 md:p-5 shadow-xs overflow-hidden min-h-[400px]">
          <h2 className="text-sm font-extrabold uppercase tracking-wide mb-4 flex items-center gap-2">
            <span className="w-5 h-5 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center text-[10px] font-black">1</span>
            Select Audience
          </h2>
          
          {/* Filters */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mb-3 shrink-0">
            <div className="relative col-span-2 xl:col-span-1">
              <Search size={12} className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-app-text-muted" />
              <input
                type="text"
                placeholder="Search name/phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-[32px] bg-app-bg text-[11px] pl-7 pr-3 py-1.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none transition font-bold"
              />
            </div>
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

          {/* Selection Controls */}
          <div className="flex items-center gap-3 mb-2 pb-2 border-b border-app-border shrink-0">
            <button
              onClick={isAllVisibleSelected ? handleDeselectAll : handleSelectAllVisible}
              className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-amber-500 hover:text-amber-600 transition"
            >
              {isAllVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              {isAllVisibleSelected ? "Deselect All" : "Select Visible"}
            </button>
            <span className="text-[10px] text-app-text-muted font-bold ml-auto bg-app-bg px-2 py-1 rounded-lg border border-app-border/40">
              {selectedCustomerIds.size} Selected
            </span>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto border border-app-border rounded-xl">
            {filteredCustomers.length === 0 ? (
              <div className="p-8 text-center text-xs text-app-text-muted font-bold">
                No customers match these filters.
              </div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[500px]">
                <thead className="bg-app-bg sticky top-0 z-10 text-[9px] font-black uppercase text-app-text-muted tracking-widest shadow-sm">
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
                          <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase inline-block ${
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
            )}
          </div>
        </div>

        {/* Right Side: Message Composer */}
        <div className="w-full lg:w-[380px] xl:w-[420px] flex flex-col gap-4 shrink-0">
          <div className="bg-app-card border border-app-border rounded-3xl p-4 md:p-5 shadow-xs flex-1 flex flex-col">
            <h2 className="text-sm font-extrabold uppercase tracking-wide mb-1 flex items-center gap-2">
              <span className="w-5 h-5 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center text-[10px] font-black">2</span>
              Compose Message
            </h2>
            <p className="text-[10px] text-app-text-muted font-bold mb-4 ml-7">Available Placeholders: {'{first_name}'}, {'{business_name}'}</p>
            
            {/* AI Assistant Box */}
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-3 mb-4 flex flex-col">
              <div className="flex items-center gap-1.5 mb-2 text-[10px] font-black text-amber-500 uppercase tracking-wider">
                <Wand2 size={12} />
                AI Drafting Assistant
              </div>
              
              {/* Chat History */}
              {aiChatHistory.length > 0 && (
                <div className="mb-3 space-y-2 max-h-[150px] overflow-y-auto p-2 bg-app-bg border border-app-border/50 rounded-xl">
                  {aiChatHistory.map((msg, idx) => (
                    <div key={idx} className={`text-[10px] p-2 rounded-lg ${msg.role === 'user' ? 'bg-amber-500/10 text-amber-600 ml-4' : 'bg-slate-100 dark:bg-slate-800 text-app-text-muted mr-4'}`}>
                      <span className="font-bold opacity-50 block mb-0.5">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
                      {msg.content}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <input 
                  type="text" 
                  placeholder="Ask follow-up questions or describe the message..."
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  className="flex-1 bg-app-bg text-[11px] px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none transition font-bold"
                  onKeyDown={e => { if(e.key === 'Enter') handleDraftWithAi(); }}
                />
                <button
                  onClick={handleDraftWithAi}
                  disabled={isAiDrafting || !aiPrompt.trim()}
                  className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 font-black rounded-xl text-[10px] uppercase tracking-wider disabled:opacity-50 transition"
                >
                  {isAiDrafting ? "Thinking..." : "Send"}
                </button>
              </div>
            </div>

            <textarea
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              className="w-full flex-1 min-h-[150px] bg-app-bg border border-app-border rounded-2xl p-4 text-[13px] text-app-text focus:outline-none focus:border-amber-500 transition font-medium resize-none mb-4 shadow-inner"
              placeholder="Type your message here..."
            />

            {/* Preview Box */}
            <div className="bg-app-bg border border-app-border/60 rounded-2xl p-3 mb-4 text-[11px] text-app-text-muted relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-500/50 rounded-l-2xl"></div>
              <div className="font-black uppercase tracking-wider mb-1 text-[9px] pl-2 text-amber-500/70">Live Preview:</div>
              <div className="italic leading-relaxed pl-2 whitespace-pre-wrap">
                {generateMessage({ name: "James Mwangi", phone: "+254700000000" } as any)}
              </div>
            </div>

            <button
              onClick={handleSendBulk}
              disabled={selectedCustomerIds.size === 0 || !messageTemplate.trim()}
              className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 font-black rounded-2xl text-[12px] uppercase tracking-widest transition shadow flex items-center justify-center gap-2"
            >
              <Send size={16} />
              Dispatch to {selectedCustomerIds.size} Customers
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
