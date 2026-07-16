import React, { useState, useEffect, useMemo } from "react";
import { 
  MessageSquare, Star, Search, Filter, ArrowUpDown, CornerDownRight, 
  CheckCircle2, AlertCircle, Download, CheckCircle, 
  Trash2, Send, RefreshCw, ThumbsUp, ThumbsDown, HelpCircle, Eye, EyeOff,
  Brain, Lock, Wand2, BarChart2
} from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import { useAppStore } from "../stores/appStore";
import { hasRolePermission } from "../utils/permissions";
import { searchMatch } from "../utils/stringUtils";
import SearchableDropdown from "../components/SearchableDropdown";

interface CommentReply {
  id: string;
  author: string;
  role: string;
  message: string;
  timestamp: string;
}

interface CustomerComment {
  id: string;
  customerName: string;
  rating: number; // 1-5
  comment: string;
  timestamp: string;
  resolved: boolean;
  sentiment: "positive" | "neutral" | "negative";
  branch: string;
  replies: CommentReply[];
}

const LOCAL_FEEDBACK_KEY = "kkm_customer_feedback_v1";

const INITIAL_COMMENTS: CustomerComment[] = [];

export default function CustomerFeedbackView() {
  const { currentEmployee } = useAuthStore();
  const { activeBusinessId } = useAppStore();
  const aiName = (import.meta as any).env?.VITE_AI_NAME || "Kim";
  const hasAiPermission = currentEmployee ? hasRolePermission(currentEmployee.role, "ai.use") : false;

  const [comments, setComments] = useState<CustomerComment[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [ratingFilter, setRatingFilter] = useState<number | "all">("all");
  const [sentimentFilter, setSentimentFilter] = useState<"positive" | "neutral" | "negative" | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "resolved" | "unresolved">("all");
  const [sortBy, setSortBy] = useState<"latest" | "rating-high" | "rating-low">("latest");

  // New Comment Form (Simulating internal mock addition of customer review)
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newRating, setNewRating] = useState(5);
  const [newComment, setNewComment] = useState("");
  const [newBranch, setNewBranch] = useState("Karen Hub");

  // Reply States (mapped by Comment ID)
  const [replyMessage, setReplyMessage] = useState<Record<string, string>>({});

  // Workspace CRM assistant state
  const [analyzingCommentId, setAnalyzingCommentId] = useState<string | null>(null);
  const [aiAnalysisResults, setAiAnalysisResults] = useState<Record<string, { sentiment: string; severity: string; summary: string; escalationRecommendation: string; suggestedResolution: string }>>({});
  const [generatingReplyId, setGeneratingReplyId] = useState<string | null>(null);
  const [improvingReplyId, setImprovingReplyId] = useState<string | null>(null);

  const [isTogglingResolved, setIsTogglingResolved] = useState<Record<string, boolean>>({});
  const [isDeletingComment, setIsDeletingComment] = useState<Record<string, boolean>>({});
  const [isAddingReply, setIsAddingReply] = useState<Record<string, boolean>>({});

  // Customer insights analytics state
  const [isGeneratingAnalytics, setIsGeneratingAnalytics] = useState(false);
  const [aiCohortAnalytics, setAiCohortAnalytics] = useState<{ overallSummary: string; categories: { category: string; count: number; percentage: number }[]; recurringProblems: string[]; operationalImprovements: string[] } | null>(null);
  const [showAiAnalyticsPanel, setShowAiAnalyticsPanel] = useState(false);

  const handleAiAnalyze = async (comment: CustomerComment) => {
    if (!hasAiPermission) return;
    setAnalyzingCommentId(comment.id);
    try {
      const response = await fetch("/api/gemini/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze", comment, businessId: activeBusinessId })
      });
      const data = await response.json();
      if (data.success && data.analysis) {
        setAiAnalysisResults(prev => ({ ...prev, [comment.id]: data.analysis }));
        // Sync local sentiment with AI detected sentiment for accuracy
        if (data.analysis.sentiment) {
          const detectedSentiment = data.analysis.sentiment.toLowerCase();
          if (["positive", "neutral", "negative"].includes(detectedSentiment)) {
            const updated = comments.map(c => {
              if (c.id === comment.id) {
                return { ...c, sentiment: detectedSentiment as any };
              }
              return c;
            });
            saveToStorage(updated);
          }
        }
      } else {
        setAiAnalysisResults(prev => ({ 
          ...prev, 
          [comment.id]: {
            sentiment: "neutral",
            severity: "medium",
            summary: `${aiName} is not available.`,
            escalationRecommendation: "N/A",
            suggestedResolution: `${aiName} is not available.`
          }
        }));
      }
    } catch (err) {
      console.error("AI Analysis error:", err);
      setAiAnalysisResults(prev => ({ 
        ...prev, 
        [comment.id]: {
          sentiment: "neutral",
          severity: "medium",
          summary: `${aiName} is not available.`,
          escalationRecommendation: "N/A",
          suggestedResolution: `${aiName} is not available.`
        }
      }));
    } finally {
      setAnalyzingCommentId(null);
    }
  };

  const handleAiGenerateReply = async (comment: CustomerComment) => {
    if (!hasAiPermission) return;
    setGeneratingReplyId(comment.id);
    const draftText = replyMessage[comment.id] || "";
    try {
      const response = await fetch("/api/gemini/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_reply", comment, draftText, businessId: activeBusinessId })
      });
      const data = await response.json();
      if (data.success && data.replyText) {
        setReplyMessage(prev => ({ ...prev, [comment.id]: data.replyText }));
      } else {
        setReplyMessage(prev => ({ ...prev, [comment.id]: `${aiName} is not available.` }));
      }
    } catch (err) {
      console.error("AI Reply generation error:", err);
      setReplyMessage(prev => ({ ...prev, [comment.id]: `${aiName} is not available.` }));
    } finally {
      setGeneratingReplyId(null);
    }
  };

  const handleAiImproveReply = async (comment: CustomerComment) => {
    if (!hasAiPermission || !replyMessage[comment.id]) return;
    setImprovingReplyId(comment.id);
    try {
      const response = await fetch("/api/gemini/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "improve_reply", comment, draftText: replyMessage[comment.id], businessId: activeBusinessId })
      });
      const data = await response.json();
      if (data.success && data.improvedText) {
        setReplyMessage(prev => ({ ...prev, [comment.id]: data.improvedText }));
      } else {
        setReplyMessage(prev => ({ ...prev, [comment.id]: `${aiName} is not available.` }));
      }
    } catch (err) {
      console.error("AI Reply improvement error:", err);
      setReplyMessage(prev => ({ ...prev, [comment.id]: `${aiName} is not available.` }));
    } finally {
      setImprovingReplyId(null);
    }
  };

  const handleAiCohortAnalytics = async () => {
    if (!hasAiPermission) return;
    setIsGeneratingAnalytics(true);
    setShowAiAnalyticsPanel(true);
    try {
      const response = await fetch("/api/gemini/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cohort_analytics", comments, businessId: activeBusinessId })
      });
      const data = await response.json();
      if (data.success && data.analytics) {
        setAiCohortAnalytics(data.analytics);
      } else {
        setAiCohortAnalytics({
          overallSummary: `${aiName} is not available.`,
          categories: [],
          recurringProblems: [],
          operationalImprovements: []
        });
      }
    } catch (err) {
      console.error("AI Cohort Analytics error:", err);
      setAiCohortAnalytics({
        overallSummary: `${aiName} is not available.`,
        categories: [],
        recurringProblems: [],
        operationalImprovements: []
      });
    } finally {
      setIsGeneratingAnalytics(false);
    }
  };

  // Load saved reviews
  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_FEEDBACK_KEY);
    if (saved) {
      try {
        setComments(JSON.parse(saved));
      } catch {
        setComments(INITIAL_COMMENTS);
      }
    } else {
      setComments(INITIAL_COMMENTS);
      localStorage.setItem(LOCAL_FEEDBACK_KEY, JSON.stringify(INITIAL_COMMENTS));
    }
  }, []);

  const saveToStorage = (updatedList: CustomerComment[]) => {
    setComments(updatedList);
    localStorage.setItem(LOCAL_FEEDBACK_KEY, JSON.stringify(updatedList));
  };

  // Local AI Sentiment analyzer
  const analyzeSentiment = (text: string, rating: number): "positive" | "neutral" | "negative" => {
    const lower = text.toLowerCase();
    const positiveWords = ["love", "great", "excellent", "stellar", "creamy", "fresh", "best", "good", "happy", "fast", "friendly"];
    const negativeWords = ["disappointed", "leak", "frustrated", "slow", "refused", "delay", "bad", "squished", "worst", "poor", "unhappy"];

    let score = 0;
    positiveWords.forEach(w => { if (lower.includes(w)) score += 1; });
    negativeWords.forEach(w => { if (lower.includes(w)) score -= 1; });

    if (rating >= 4) score += 1;
    if (rating <= 2) score -= 1;

    if (score > 0) return "positive";
    if (score < 0) return "negative";
    return "neutral";
  };

  const toggleResolved = async (commentId: string) => {
    if (isTogglingResolved[commentId]) return;
    setIsTogglingResolved(prev => ({ ...prev, [commentId]: true }));
    try {
      const updated = comments.map(c => {
        if (c.id === commentId) {
          return { ...c, resolved: !c.resolved };
        }
        return c;
      });
      saveToStorage(updated);
      showToast("Status Synced", "Comment resolution toggled successfully.", undefined, "success");
    } finally {
      setIsTogglingResolved(prev => ({ ...prev, [commentId]: false }));
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (isDeletingComment[commentId]) return;
    if (confirm("Are you sure you want to delete this customer feedback record permanently?")) {
      setIsDeletingComment(prev => ({ ...prev, [commentId]: true }));
      try {
        const updated = comments.filter(c => c.id !== commentId);
        saveToStorage(updated);
        showToast("Record Purged", "Feedback deleted.", undefined, "success");
      } finally {
        setIsDeletingComment(prev => ({ ...prev, [commentId]: false }));
      }
    }
  };

  const handleAddReply = async (commentId: string) => {
    if (isAddingReply[commentId]) return;
    const msg = replyMessage[commentId];
    if (!msg || !msg.trim()) return;

    setIsAddingReply(prev => ({ ...prev, [commentId]: true }));
    try {
      const updated = comments.map(c => {
        if (c.id === commentId) {
          return {
            ...c,
            replies: [
              ...c.replies,
              {
                id: `rep-${Date.now()}`,
                author: currentEmployee?.name || "Workspace Assistant",
                role: currentEmployee?.role || "Staff",
                message: msg.trim(),
                timestamp: new Date().toISOString()
              }
            ]
          };
        }
        return c;
      });
      saveToStorage(updated);
      setReplyMessage(prev => ({ ...prev, [commentId]: "" }));
      showToast("Response Logged", "Your response has been published.", undefined, "success");
    } finally {
      setIsAddingReply(prev => ({ ...prev, [commentId]: false }));
    }
  };

  // Export as CSV
  const handleExportCSV = () => {
    const headers = ["ID", "Customer Name", "Rating", "Comment", "Timestamp", "Resolved", "Sentiment", "Branch"];
    const rows = comments.map(c => [
      c.id,
      `"${c.customerName.replace(/"/g, '""')}"`,
      c.rating,
      `"${c.comment.replace(/"/g, '""')}"`,
      c.timestamp,
      c.resolved ? "YES" : "NO",
      c.sentiment.toUpperCase(),
      c.branch
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `KKM_Customer_Feedback_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Calculations for dashboard summary
  const summaryMetrics = useMemo(() => {
    const total = comments.length;
    if (total === 0) return { avgRating: 0, posPct: 0, neuPct: 0, negPct: 0, unresCount: 0 };

    const sumRating = comments.reduce((acc, c) => acc + c.rating, 0);
    const avgRating = Math.round((sumRating / total) * 10) / 10;

    const positive = comments.filter(c => c.sentiment === "positive").length;
    const neutral = comments.filter(c => c.sentiment === "neutral").length;
    const negative = comments.filter(c => c.sentiment === "negative").length;
    const unresCount = comments.filter(c => !c.resolved).length;

    return {
      avgRating,
      posPct: Math.round((positive / total) * 100),
      neuPct: Math.round((neutral / total) * 100),
      negPct: Math.round((negative / total) * 100),
      unresCount
    };
  }, [comments]);

  // Filters mapping
  const filteredComments = useMemo(() => {
    return comments
      .filter(c => {
        // Search
        const matchesSearch = searchMatch(c.customerName, searchQuery) ||
                              searchMatch(c.comment, searchQuery) ||
                              searchMatch(c.branch, searchQuery);
        
        // Rating
        const matchesRating = ratingFilter === "all" || c.rating === ratingFilter;

        // Sentiment
        const matchesSentiment = sentimentFilter === "all" || c.sentiment === sentimentFilter;

        // Status
        const matchesStatus = statusFilter === "all" || 
                              (statusFilter === "resolved" && c.resolved) ||
                              (statusFilter === "unresolved" && !c.resolved);

        return matchesSearch && matchesRating && matchesSentiment && matchesStatus;
      })
      .sort((a, b) => {
        if (sortBy === "latest") return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        if (sortBy === "rating-high") return b.rating - a.rating;
        if (sortBy === "rating-low") return a.rating - b.rating;
        return 0;
      });
  }, [comments, searchQuery, ratingFilter, sentimentFilter, statusFilter, sortBy]);

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 space-y-6 bg-app-bg text-app-text font-sans">
      
      {/* Page Header */}
      <div className="bg-app-card border border-app-border rounded-3xl p-4.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
        <div>
          <h2 className="text-base font-extrabold font-display text-app-text flex items-center gap-2">
            <MessageSquare size={18} className="text-amber-500" />
            Customer Review & Sentiment Console
          </h2>
          <p className="text-[11px] text-app-text-muted mt-1 leading-normal">
            Track user commentaries, filter rating metrics, resolve grievances, and audit positive/neutral/negative branch vibes.
          </p>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 bg-app-card hover:bg-app-border border border-app-border text-app-text text-[10.5px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer flex items-center gap-1.5"
          >
            <Download size={12} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Dashboard Stats Panel */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Metric 1: Total & Resolved */}
        <div className="bg-app-card border border-app-border rounded-3xl p-4 flex flex-col justify-between shadow-xs">
          <span className="text-[9px] font-black text-app-text-muted uppercase tracking-widest block">Total Logged Feedback</span>
          <div className="mt-2.5">
            <span className="text-2xl font-extrabold text-app-text tracking-tight font-mono">{comments.length}</span>
            <span className="text-[10px] text-red-500 font-extrabold ml-2 bg-red-500/10 px-1.5 py-0.5 rounded-md">
              {summaryMetrics.unresCount} pending
            </span>
          </div>
        </div>

        {/* Metric 2: Avg Rating */}
        <div className="bg-app-card border border-app-border rounded-3xl p-4 flex flex-col justify-between shadow-xs">
          <span className="text-[9px] font-black text-app-text-muted uppercase tracking-widest block">Average Trust Rating</span>
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-2xl font-extrabold text-app-text tracking-tight font-mono">{summaryMetrics.avgRating}</span>
            <div className="flex items-center text-amber-500">
              {[1, 2, 3, 4, 5].map(star => (
                <Star 
                  key={star} 
                  size={12} 
                  fill={star <= Math.round(summaryMetrics.avgRating) ? "currentColor" : "none"} 
                  className="shrink-0"
                />
              ))}
            </div>
          </div>
        </div>

        {/* Metric 3: Sentiment Audit */}
        <div className="bg-app-card border border-app-border rounded-3xl p-4 col-span-1 md:col-span-2 shadow-xs flex flex-col justify-between">
          <span className="text-[9px] font-black text-app-text-muted uppercase tracking-widest block">Vibe & Sentiment Breakdown</span>
          
          <div className="mt-3.5 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-bold">
              <span className="text-emerald-500 flex items-center gap-1">Positive ({summaryMetrics.posPct}%)</span>
              <span className="text-app-text-muted flex items-center gap-1">Neutral ({summaryMetrics.neuPct}%)</span>
              <span className="text-red-500 flex items-center gap-1">Negative ({summaryMetrics.negPct}%)</span>
            </div>
            {/* Visual stacked progress bar */}
            <div className="h-2 w-full bg-app-bg rounded-full overflow-hidden flex">
              <div style={{ width: `${summaryMetrics.posPct}%` }} className="bg-emerald-500 h-full" />
              <div style={{ width: `${summaryMetrics.neuPct}%` }} className="bg-slate-400 h-full" />
              <div style={{ width: `${summaryMetrics.negPct}%` }} className="bg-red-500 h-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Gemini AI CRM Insights Engine Board */}
      {hasAiPermission ? (
        <div className="bg-gradient-to-tr from-slate-900 via-slate-950 to-slate-900 border border-purple-500/20 rounded-3xl p-5 shadow-lg relative overflow-hidden">
          <div className="absolute right-0 top-0 w-32 h-32 bg-purple-500/5 blur-3xl rounded-full" />
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-purple-500/10 rounded-2xl border border-purple-500/20 text-purple-400 shrink-0">
                <Brain size={20} className="" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                  {aiName} CRM Insights Engine
                </h3>
                <p className="text-[10.5px] text-slate-400 mt-1 leading-normal">
                  Leverage our insights engine to analyze sentiment clusters, systematic dairy delivery complaints, and generate operational QA recommendations.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAiCohortAnalytics}
              disabled={isGeneratingAnalytics}
              className="w-full md:w-auto px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-[10.5px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-purple-900/20 disabled:opacity-50 shrink-0"
            >
              {isGeneratingAnalytics ? (
                <>
                  <RefreshCw size={12} className="animate-spin" />
                  <span>Running Cohort Audit...</span>
                </>
              ) : (
                <>
                  <Wand2 size={12} />
                  <span>Audit Customer Cohort</span>
                </>
              )}
            </button>
          </div>

          {/* AI Analytics Expansion Panel */}
          {showAiAnalyticsPanel && (
            <div className="mt-5 border-t border-slate-800 pt-5 space-y-4 text-xs">
              {isGeneratingAnalytics ? (
                <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
                  <div className="relative">
                    <Brain size={28} className="text-purple-500 " />
                  </div>
                  <div>
                    <p className="font-extrabold text-xs text-purple-200">Processing CRM Feedback Pipeline...</p>
                    <p className="text-[10px] text-slate-400 mt-1">Classifying complaint categories and formulating systematic recommendations.</p>
                  </div>
                </div>
              ) : aiCohortAnalytics ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 animate-fadeIn">
                  {/* Left col: Executive summary and categories */}
                  <div className="md:col-span-2 space-y-4">
                    <div className="bg-slate-950/80 border border-slate-800/60 rounded-2xl p-4">
                      <span className="text-[9px] font-black text-purple-300 uppercase tracking-widest block mb-2">Executive Summary & Vibe Check</span>
                      <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
                        {aiCohortAnalytics.overallSummary}
                      </p>
                    </div>

                    <div className="bg-slate-950/80 border border-slate-800/60 rounded-2xl p-4">
                      <span className="text-[9px] font-black text-purple-300 uppercase tracking-widest block mb-3">AI Classified Pain Points</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {aiCohortAnalytics.categories?.map((cat, i) => (
                          <div key={i} className="bg-slate-900 border border-slate-800/50 rounded-xl p-3 flex flex-col justify-between">
                            <span className="text-[10.5px] font-bold text-slate-200">{cat.category}</span>
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/40">
                              <span className="text-[10px] text-purple-400 font-bold">{cat.count} comments</span>
                              <span className="text-[10px] text-slate-400 font-extrabold">{cat.percentage}% share</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right col: Bottlenecks & Action Items */}
                  <div className="space-y-4">
                    <div className="bg-slate-950/80 border border-slate-800/60 rounded-2xl p-4">
                      <span className="text-[9px] font-black text-red-400 uppercase tracking-widest block mb-2.5">Systemic Bottlenecks</span>
                      <ul className="space-y-2">
                        {aiCohortAnalytics.recurringProblems?.map((prob, i) => (
                          <li key={i} className="flex items-start gap-2 text-[10.5px] text-slate-300 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-1.5" />
                            <span>{prob}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-slate-950/80 border border-slate-800/60 rounded-2xl p-4">
                      <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest block mb-2.5">QA Operational Remedies</span>
                      <ul className="space-y-2">
                        {aiCohortAnalytics.operationalImprovements?.map((imp, i) => (
                          <li key={i} className="flex items-start gap-2 text-[10.5px] text-slate-300 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 mt-1.5" />
                            <span>{imp}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-slate-400 text-center py-4">No AI data processed. Click "Audit Customer Cohort" above.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-app-card border border-app-border rounded-3xl p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative opacity-75">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-app-bg rounded-2xl border border-app-border text-app-text-muted shrink-0">
              <Lock size={20} />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-app-text flex items-center gap-1.5">
                {aiName} AI CRM Insights Engine
              </h3>
              <p className="text-[10.5px] text-app-text-muted mt-1 leading-normal">
                Leverage our AI Insights Engine to analyze sentiment clusters, systematic dairy delivery complaints, and generate operational QA recommendations.
              </p>
            </div>
          </div>
          <div className="px-3.5 py-1.5 bg-app-bg border border-app-border text-app-text-muted text-[9px] font-black uppercase tracking-widest rounded-xl flex items-center gap-1 shrink-0">
            <Lock size={10} />
            <span>Access Locked (AI.USE)</span>
          </div>
        </div>
      )}

      

      {/* Advanced Filter Matrix controls */}
      <div className="bg-app-card border border-app-border rounded-3xl p-4 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-amber-500" />
            <span className="text-xs font-black uppercase tracking-wider">Advanced Filters</span>
          </div>

          <button
            onClick={() => {
              setSearchQuery("");
              setRatingFilter("all");
              setSentimentFilter("all");
              setStatusFilter("all");
              setSortBy("latest");
            }}
            className="text-[9.5px] text-app-text-muted hover:text-amber-500 font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition"
          >
            <RefreshCw size={11} />
            <span>Reset filters</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3.5">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-app-text-muted" size={13} />
            <input
              type="text"
              placeholder="Search comments..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-app-bg border border-app-border rounded-xl pl-8.5 pr-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Rating */}
          <SearchableDropdown
            items={[
              { id: "all", label: "⭐ All Ratings" },
              { id: "5", label: "⭐ 5 Stars Only" },
              { id: "4", label: "⭐ 4 Stars Only" },
              { id: "3", label: "⭐ 3 Stars Only" },
              { id: "2", label: "⭐ 2 Stars Only" },
              { id: "1", label: "⭐ 1 Star Only" }
            ]}
            selectedValue={String(ratingFilter)}
            onChange={(val) => setRatingFilter(val === "all" ? "all" : Number(val))}
            placeholder="Rating"
            className="w-40"
          />

          {/* Sentiment */}
          <SearchableDropdown
            items={[
              { id: "all", label: "🔮 All Sentiments" },
              { id: "positive", label: "🟢 Positive Vibes" },
              { id: "neutral", label: "⚪ Neutral Reviews" },
              { id: "negative", label: "🔴 Negative Grievances" }
            ]}
            selectedValue={sentimentFilter}
            onChange={(val) => setSentimentFilter(val as any)}
            placeholder="Sentiment"
            className="w-44"
          />

          {/* Resolution Status */}
          <SearchableDropdown
            items={[
              { id: "all", label: "🗳️ All Statuses" },
              { id: "resolved", label: "✅ Resolved Logs" },
              { id: "unresolved", label: "⚠️ Pending Resolution" }
            ]}
            selectedValue={statusFilter}
            onChange={(val) => setStatusFilter(val as any)}
            placeholder="Status"
            className="w-44"
          />

          {/* Sorting */}
          <SearchableDropdown
            items={[
              { id: "latest", label: "📅 Latest Comments" },
              { id: "rating-high", label: "📈 Rating: High to Low" },
              { id: "rating-low", label: "📉 Rating: Low to High" }
            ]}
            selectedValue={sortBy}
            onChange={(val) => setSortBy(val as any)}
            placeholder="Sort by"
            className="w-44"
          />
        </div>
      </div>

      {/* Main Feedback List */}
      <div className="space-y-4">
        {filteredComments.length === 0 ? (
          <div className="bg-app-card border border-app-border border-dashed rounded-3xl p-16 text-center max-w-xl mx-auto flex flex-col items-center justify-center gap-3">
            <MessageSquare size={24} className="text-app-text-muted/60" />
            <div>
              <span className="font-extrabold text-xs block text-app-text">No reviews found matching queries</span>
              <span className="text-[10px] text-app-text-muted block mt-1">Adjust your rating or sentiment filters to locate logs.</span>
            </div>
          </div>
        ) : (
          filteredComments.map(comment => {
            const dateStr = new Date(comment.timestamp).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            });

            return (
              <div 
                key={comment.id} 
                className={`bg-app-card border rounded-3xl p-4.5 space-y-4 relative overflow-hidden transition-all duration-200 ${
                  comment.resolved 
                    ? "border-app-border opacity-90" 
                    : "border-amber-500/15 bg-gradient-to-tr from-amber-500/[0.01] to-transparent shadow-xs"
                }`}
              >
                {/* Sentiment side-border */}
                <span className={`absolute left-0 top-0 bottom-0 w-1 ${
                  comment.sentiment === "positive" 
                    ? "bg-emerald-500" 
                    : comment.sentiment === "negative" 
                      ? "bg-red-500" 
                      : "bg-slate-400"
                }`} />

                {/* Top Info line */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 text-amber-500 font-extrabold text-xs flex items-center justify-center border border-amber-500/15">
                      {comment.customerName.charAt(0)}
                    </div>
                    <div>
                      <span className="text-[11.5px] font-extrabold text-app-text block uppercase tracking-wide">{comment.customerName}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] text-app-text-muted font-bold block">{dateStr}</span>
                        <span className="text-[9px] text-app-text-muted/40 font-bold">•</span>
                        <span className="text-[8.5px] text-amber-500 font-black uppercase tracking-wider bg-amber-500/10 px-1.5 py-0.2 rounded">
                          {comment.branch}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Stars Display */}
                    <div className="flex items-center text-amber-500 mr-2">
                      {[1, 2, 3, 4, 5].map(star => (
                        <Star 
                          key={star} 
                          size={11} 
                          fill={star <= comment.rating ? "currentColor" : "none"} 
                          className="shrink-0"
                        />
                      ))}
                    </div>

                    {/* Sentiment Tag */}
                    <span className={`text-[8.5px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg ${
                      comment.sentiment === "positive" 
                        ? "bg-emerald-500/10 text-emerald-500" 
                        : comment.sentiment === "negative" 
                          ? "bg-red-500/10 text-red-500 " 
                          : "bg-slate-500/10 text-slate-400"
                    }`}>
                      {comment.sentiment}
                    </span>

                    {/* Resolved Button Toggle */}
                    <button
                      onClick={() => toggleResolved(comment.id)}
                      disabled={isTogglingResolved[comment.id]}
                      className={`px-2.5 py-1 text-[8.5px] font-black uppercase tracking-widest rounded-lg border transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1 ${
                        comment.resolved
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                          : "bg-app-bg border-app-border text-app-text-muted hover:text-app-text hover:border-amber-500/30"
                      }`}
                    >
                      {comment.resolved ? (
                        <>
                          <CheckCircle2 size={11} />
                          <span>Resolved</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle size={11} />
                          <span>Mark Resolved</span>
                        </>
                      )}
                    </button>
 
                    {/* Delete button */}
                    <button
                      onClick={() => handleDeleteComment(comment.id)}
                      disabled={isDeletingComment[comment.id]}
                      className="p-1 text-app-text-muted hover:text-red-500 hover:bg-red-500/5 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition cursor-pointer"
                      title="Delete log"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Comment Body Text */}
                <p className="text-[11.5px] text-app-text font-medium leading-relaxed pl-1">
                  "{comment.comment}"
                </p>

                {/* AI Assistant Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {hasAiPermission ? (
                    <button
                      type="button"
                      onClick={() => handleAiAnalyze(comment)}
                      disabled={analyzingCommentId === comment.id}
                      className="px-2.5 py-1 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 text-purple-400 text-[9.5px] font-extrabold uppercase tracking-wider rounded-lg transition cursor-pointer flex items-center gap-1"
                    >
                      {analyzingCommentId === comment.id ? (
                        <RefreshCw size={11} className="animate-spin" />
                      ) : (
                        <Brain size={11} />
                      )}
                      <span>{aiAnalysisResults[comment.id] ? "Re-Analyze Grievance" : "Analyze Grievance"}</span>
                    </button>
                  ) : (
                    <div className="px-2.5 py-1 bg-app-bg border border-app-border text-app-text-muted text-[8.5px] font-bold uppercase tracking-wider rounded-lg flex items-center gap-1 select-none">
                      <Lock size={9} />
                      <span>Smart Assist Locked</span>
                    </div>
                  )}
                </div>

                {/* AI Diagnostics Panel */}
                {aiAnalysisResults[comment.id] && (
                  <div className="bg-purple-950/25 border border-purple-500/20 rounded-2xl p-3.5 space-y-2.5 text-xs animate-fadeIn">
                    <div className="flex items-center justify-between border-b border-purple-500/10 pb-1.5">
                      <span className="text-[9px] font-black text-purple-400 uppercase tracking-widest flex items-center gap-1">
                        <Brain size={10} />
                        {aiName} Diagnostic
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded ${
                          aiAnalysisResults[comment.id].sentiment === "positive"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : aiAnalysisResults[comment.id].sentiment === "negative"
                              ? "bg-red-500/10 text-red-400 "
                              : "bg-slate-500/10 text-slate-400"
                        }`}>
                          {aiAnalysisResults[comment.id].sentiment} Sentiment
                        </span>
                        <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded ${
                          aiAnalysisResults[comment.id].severity === "critical"
                            ? "bg-red-500 text-white  font-extrabold"
                            : aiAnalysisResults[comment.id].severity === "high"
                              ? "bg-amber-500/20 text-amber-400 font-extrabold"
                              : "bg-blue-500/15 text-blue-400"
                        }`}>
                          {aiAnalysisResults[comment.id].severity} Severity
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-[10.5px]">
                      <div>
                        <strong className="text-purple-300 font-bold uppercase text-[8px] tracking-wider block">Grievance Summary:</strong>
                        <span className="text-purple-100 font-medium leading-relaxed">"{aiAnalysisResults[comment.id].summary}"</span>
                      </div>
                      <div>
                        <strong className="text-purple-300 font-bold uppercase text-[8px] tracking-wider block">Escalation Path:</strong>
                        <span className="text-purple-100 font-medium leading-relaxed">{aiAnalysisResults[comment.id].escalationRecommendation}</span>
                      </div>
                      <div>
                        <strong className="text-purple-300 font-bold uppercase text-[8px] tracking-wider block">Proposed Resolution:</strong>
                        <span className="text-purple-100 font-medium leading-relaxed">{aiAnalysisResults[comment.id].suggestedResolution}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Replies Thread */}
                {comment.replies.length > 0 && (
                  <div className="bg-app-bg/60 border border-app-border/40 rounded-2xl p-3 space-y-3 mt-1.5">
                    {comment.replies.map(reply => (
                      <div key={reply.id} className="flex items-start gap-2.5 text-xs">
                        <CornerDownRight size={13} className="text-amber-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase tracking-wider text-amber-500">{reply.author}</span>
                            <span className="text-[8px] bg-amber-500/10 text-amber-500 px-1 py-0.1 rounded font-extrabold uppercase">{reply.role}</span>
                            <span className="text-[8px] text-app-text-muted font-bold">
                              {new Date(reply.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-[10.5px] text-app-text-muted font-medium mt-1 leading-relaxed">
                            {reply.message}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Reply Input field */}
                <div className="space-y-1.5 pt-1 border-t border-app-border/30">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Write an official response to this customer comment..."
                      value={replyMessage[comment.id] || ""}
                      onChange={e => setReplyMessage(prev => ({ ...prev, [comment.id]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          handleAddReply(comment.id);
                        }
                      }}
                      className="flex-1 bg-app-bg border border-app-border rounded-xl px-3 py-1.5 text-xs text-app-text focus:outline-none focus:border-amber-500 font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddReply(comment.id)}
                      disabled={isAddingReply[comment.id]}
                      className="p-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 rounded-xl transition cursor-pointer shrink-0"
                      title="Send response"
                    >
                      <Send size={12} />
                    </button>
                  </div>

                  {/* AI Smart Reply Actions Row */}
                  {hasAiPermission && (
                    <div className="flex flex-wrap items-center gap-2 pl-1 text-[10px]">
                      <span className="text-app-text-muted/60 font-bold text-[9px] uppercase tracking-wider">Smart Assist:</span>
                      <button
                        type="button"
                        onClick={() => handleAiGenerateReply(comment)}
                        disabled={generatingReplyId === comment.id}
                        className="text-purple-400 hover:text-purple-300 font-extrabold flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
                      >
                        {generatingReplyId === comment.id ? (
                          <RefreshCw size={10} className="animate-spin" />
                        ) : (
                          <Brain size={10} />
                        )}
                        <span>Draft Response</span>
                      </button>

                      {replyMessage[comment.id] && replyMessage[comment.id].trim().length > 0 && (
                        <>
                          <span className="text-app-text-muted/30">•</span>
                          <button
                            type="button"
                            onClick={() => handleAiImproveReply(comment)}
                            disabled={improvingReplyId === comment.id}
                            className="text-amber-500 hover:text-amber-400 font-extrabold flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
                          >
                            {improvingReplyId === comment.id ? (
                              <RefreshCw size={10} className="animate-spin" />
                            ) : (
                              <Wand2 size={10} />
                            )}
                            <span>Polish My Draft</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

              </div>
            );
          })
        )}
      </div>

    </div>
  );
}
