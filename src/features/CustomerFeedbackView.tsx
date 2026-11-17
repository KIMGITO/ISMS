// Feedback: what customers said about us (reviews), messages we send them, and the
// signed-in person's own shift reminders. Three tabs on one screen.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { SwipeRow, RowAction } from '../components/shared/SwipeRow';
import { ComplaintService } from '../services/complaintService';
import { toUserMessage } from '../utils/userError';
import {
  MessageSquare,
  Star,
  Search,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Send,
  RefreshCw,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BarChart2,
  X,
  BellRing,
  Megaphone,
  Lightbulb,
  PenLine,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useUiStore } from '../stores/uiStore';
import { SupabaseService } from '../services/supabaseService';
import { hasRolePermission } from '../utils/permissions';
import { searchMatch } from '../utils/stringUtils';
import SearchableDropdown from '../components/SearchableDropdown';
import CommunicationCenterView, { ShiftRemindersPanel } from './CommunicationCenterView';
import { TabOption, Tabs } from '../components/TabOptions';
import { appDialog } from '../components/AppDialog';

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
  sentiment: 'positive' | 'neutral' | 'negative';
  branch: string;
  replies: CommentReply[];
  archivedAt?: string | null;
}

interface CohortAnalytics {
  overallSummary: string;
  categories: { category: string; count: number; percentage: number }[];
  recurringProblems: string[];
  operationalImprovements: string[];
}

type TabType = 'reviews' | 'messages' | 'reminders';
type StatusFilter = 'all' | 'open' | 'resolved';

const SENTIMENT_STYLE: Record<CustomerComment['sentiment'], { label: string; chip: string; dot: string }> = {
  positive: { label: 'Happy', chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  neutral: { label: 'Neutral', chip: 'bg-slate-500/10 text-app-text-muted', dot: 'bg-slate-400' },
  negative: { label: 'Unhappy', chip: 'bg-red-500/10 text-red-600 dark:text-red-400', dot: 'bg-red-500' },
};

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Strips the assistant's action tags so only the words are left. */
const cleanAiText = (text: string) => text.replace(/\[PENDING_ACTION:.*?\]/g, '').trim();

function Stars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center text-amber-500" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} size={size} fill={s <= Math.round(value) ? 'currentColor' : 'none'} className="shrink-0" />
      ))}
    </span>
  );
}

export default function CustomerFeedbackView() {
  const { currentEmployee } = useAuthStore();
  const { activeBusinessId } = useAppStore();
  const showToast = useNotificationStore.getState().showToast;
  const unreadReminderCount = useNotificationStore((s) => s.unreadReminderCount);
  const aiName = import.meta.env?.VITE_AI_NAME || 'Kim';

  const role = currentEmployee?.role;
  const canReply = role ? hasRolePermission(role, 'complaints.reply') : false;
  const canMessage = role ? hasRolePermission(role, 'communication.view') : false;
  const hasAiPermission = role ? hasRolePermission(role, 'ai.use') : false;

  const [activeTab, setActiveTab] = useState<TabType>('reviews');

  // Search can open this screen on a particular tab.
  const searchTarget = useUiStore((st) => st.searchTarget);
  useEffect(() => {
    if (searchTarget?.kind !== 'feedback') return;
    setActiveTab(searchTarget.tab === 'messages' && !canMessage ? 'reviews' : searchTarget.tab);
    useUiStore.getState().setSearchTarget(null);
  }, [searchTarget, canMessage]);
  const [comments, setComments] = useState<CustomerComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedbackView, setFeedbackView] = useState<'active' | 'archived'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [ratingFilter, setRatingFilter] = useState<number | 'all'>('all');
  const [sentimentFilter, setSentimentFilter] = useState<CustomerComment['sentiment'] | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<'latest' | 'rating-high' | 'rating-low'>('latest');

  // Reply drafts, keyed by review id.
  const [replyMessage, setReplyMessage] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, 'resolve' | 'delete' | 'reply' | 'analyze' | 'draft' | 'polish' | undefined>>({});
  const setBusyFor = (id: string, what?: (typeof busy)[string]) => setBusy((prev) => ({ ...prev, [id]: what }));

  // What the assistant made of each review, keyed by review id.
  const [aiNotes, setAiNotes] = useState<Record<string, string>>({});

  const [showInsights, setShowInsights] = useState(false);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const [insights, setInsights] = useState<CohortAnalytics | null>(null);

  const askAi = async (prompt: string): Promise<string | null> => {
    const response = await SupabaseService.callEdgeFunction('chat', {
      messages: [{ role: 'user', content: prompt }],
      businessId: activeBusinessId,
      activeRole: role || 'Staff',
      permissions: ['ai.use'],
      employeeName: currentEmployee?.name || 'Staff',
    });
    return response?.reply ? cleanAiText(response.reply) : null;
  };

  const aiUnavailable = () =>
    showToast(aiName, `${aiName} could not answer right now. Try again in a moment.`, undefined, 'error');

  const handleAiAnalyze = async (comment: CustomerComment) => {
    if (!hasAiPermission || !activeBusinessId || busy[comment.id]) return;
    setBusyFor(comment.id, 'analyze');
    try {
      const note = await askAi(
        `A customer left this feedback. In two or three short plain sentences, say what the problem is (if any) and what the shop should do about it.
Customer: ${comment.customerName}
Rating: ${comment.rating}/5
Branch: ${comment.branch || 'not given'}
Feedback: "${comment.comment}"`,
      );
      if (note) setAiNotes((prev) => ({ ...prev, [comment.id]: note }));
      else aiUnavailable();
    } catch (err) {
      console.error('AI analysis error:', err);
      aiUnavailable();
    } finally {
      setBusyFor(comment.id);
    }
  };

  // The draft goes into the reply box; nothing is sent until a person presses Send.
  const handleAiGenerateReply = async (comment: CustomerComment) => {
    if (!hasAiPermission || !activeBusinessId || busy[comment.id]) return;
    setBusyFor(comment.id, 'draft');
    try {
      const draft = await askAi(
        `Draft a polite, warm reply to customer ${comment.customerName} about their feedback: "${comment.comment}" (${comment.rating}/5 stars${comment.branch ? ` at ${comment.branch}` : ''}). Under 3 sentences. Reply with the message only.`,
      );
      if (draft) setReplyMessage((prev) => ({ ...prev, [comment.id]: draft }));
      else aiUnavailable();
    } catch (err) {
      console.error('AI reply error:', err);
      aiUnavailable();
    } finally {
      setBusyFor(comment.id);
    }
  };

  const handleAiImproveReply = async (comment: CustomerComment) => {
    const current = replyMessage[comment.id]?.trim();
    if (!hasAiPermission || !current || !activeBusinessId || busy[comment.id]) return;
    setBusyFor(comment.id, 'polish');
    try {
      const improved = await askAi(
        `Improve this reply to customer ${comment.customerName}: "${current}". Make it kinder, shorter and clear. Reply with the message only.`,
      );
      if (improved) setReplyMessage((prev) => ({ ...prev, [comment.id]: improved }));
      else aiUnavailable();
    } catch (err) {
      console.error('AI polish error:', err);
      aiUnavailable();
    } finally {
      setBusyFor(comment.id);
    }
  };

  const handleInsights = async () => {
    if (!hasAiPermission) return;
    setShowInsights(true);
    setIsGeneratingInsights(true);
    const empty: CohortAnalytics = {
      overallSummary: `${aiName} is not available right now.`,
      categories: [],
      recurringProblems: [],
      operationalImprovements: [],
    };
    try {
      const data = await SupabaseService.callEdgeFunction('complaints', {
        action: 'analytics',
        comments: comments.filter((c) => !c.archivedAt),
        businessId: activeBusinessId,
      });
      setInsights(data?.success && data.analytics ? data.analytics : empty);
    } catch (err) {
      console.error('AI insights error:', err);
      setInsights(empty);
    } finally {
      setIsGeneratingInsights(false);
    }
  };

  // Feedback lives in the database so that every device, and the website, sees the same inbox.
  const loadComments = useCallback(async () => {
    if (!activeBusinessId) return;
    setIsLoading(true);
    try {
      setComments(await ComplaintService.list(activeBusinessId));
    } catch (err) {
      console.error('Failed to load feedback:', err);
      showToast('Feedback', toUserMessage(err, 'Could not load customer feedback.'), undefined, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [activeBusinessId, showToast]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const toggleResolved = async (comment: CustomerComment) => {
    if (busy[comment.id]) return;
    setBusyFor(comment.id, 'resolve');
    try {
      await ComplaintService.setResolved(comment.id, !comment.resolved);
      setComments((list) => list.map((c) => (c.id === comment.id ? { ...c, resolved: !c.resolved } : c)));
      showToast(
        comment.resolved ? 'Reopened' : 'Resolved',
        comment.resolved ? 'This feedback is open again.' : 'Marked as dealt with.',
        undefined,
        'success',
      );
    } catch (err) {
      showToast('Feedback', toUserMessage(err, 'Could not update this feedback.'), undefined, 'error');
    } finally {
      setBusyFor(comment.id);
    }
  };

  const toggleArchived = async (comment: CustomerComment) => {
    const archive = !comment.archivedAt;
    const set = (archivedAt: string | null | undefined) =>
      setComments((list) => list.map((c) => (c.id === comment.id ? { ...c, archivedAt } : c)));
    set(archive ? new Date().toISOString() : null);
    try {
      await ComplaintService.setArchived(comment.id, archive);
      showToast(
        archive ? 'Feedback archived' : 'Feedback restored',
        archive ? 'Find it under Archived.' : 'It is back in the list.',
        undefined,
        'success',
      );
    } catch (err) {
      set(comment.archivedAt);
      showToast('Feedback', toUserMessage(err, 'Could not change this feedback.'), undefined, 'error');
    }
  };

  const handleDeleteComment = async (comment: CustomerComment) => {
    if (busy[comment.id]) return;
    const ok = await appDialog.confirm({
      title: 'Delete this feedback?',
      message: 'It is removed for good.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setBusyFor(comment.id, 'delete');
    try {
      await ComplaintService.remove(comment.id);
      setComments((list) => list.filter((c) => c.id !== comment.id));
      showToast('Deleted', 'Feedback deleted.', undefined, 'success');
    } catch (err) {
      showToast('Feedback', toUserMessage(err, 'Could not delete this feedback.'), undefined, 'error');
    } finally {
      setBusyFor(comment.id);
    }
  };

  const handleAddReply = async (comment: CustomerComment) => {
    const msg = replyMessage[comment.id]?.trim();
    if (!canReply || !msg || busy[comment.id]) return;
    setBusyFor(comment.id, 'reply');
    try {
      const reply = await ComplaintService.addReply(
        comment.id,
        currentEmployee?.name || 'Staff',
        role || 'Staff',
        msg,
      );
      setComments((list) => list.map((c) => (c.id === comment.id ? { ...c, replies: [...c.replies, reply] } : c)));
      setReplyMessage((prev) => ({ ...prev, [comment.id]: '' }));
      showToast('Reply posted', 'The customer can see your reply.', undefined, 'success');
    } catch (err) {
      showToast('Feedback', toUserMessage(err, 'Could not save your reply.'), undefined, 'error');
    } finally {
      setBusyFor(comment.id);
    }
  };

  // Summary figures are for the main list only; archived feedback is out of the way.
  const summary = useMemo(() => {
    const live = comments.filter((c) => !c.archivedAt);
    const total = live.length;
    const count = (s: CustomerComment['sentiment']) => live.filter((c) => c.sentiment === s).length;
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    return {
      total,
      open: live.filter((c) => !c.resolved).length,
      avgRating: total ? Math.round((live.reduce((a, c) => a + c.rating, 0) / total) * 10) / 10 : 0,
      pos: pct(count('positive')),
      neu: pct(count('neutral')),
      neg: pct(count('negative')),
      archived: comments.length - total,
    };
  }, [comments]);

  const filtersActive =
    !!searchQuery || ratingFilter !== 'all' || sentimentFilter !== 'all' || statusFilter !== 'all' || sortBy !== 'latest';

  const resetFilters = () => {
    setSearchQuery('');
    setRatingFilter('all');
    setSentimentFilter('all');
    setStatusFilter('all');
    setSortBy('latest');
  };

  const filteredComments = useMemo(() => {
    return comments
      .filter((c) => {
        if (feedbackView === 'archived' ? !c.archivedAt : !!c.archivedAt) return false;
        if (
          searchQuery &&
          !searchMatch(c.customerName, searchQuery) &&
          !searchMatch(c.comment, searchQuery) &&
          !searchMatch(c.branch, searchQuery)
        )
          return false;
        if (ratingFilter !== 'all' && c.rating !== ratingFilter) return false;
        if (sentimentFilter !== 'all' && c.sentiment !== sentimentFilter) return false;
        if (statusFilter === 'open' && c.resolved) return false;
        if (statusFilter === 'resolved' && !c.resolved) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'rating-high') return b.rating - a.rating;
        if (sortBy === 'rating-low') return a.rating - b.rating;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
  }, [comments, feedbackView, searchQuery, ratingFilter, sentimentFilter, statusFilter, sortBy]);

  const tabs: TabOption<TabType>[] = [
    { id: 'reviews', label: 'Reviews', icon: <MessageSquare size={13} />, badge: summary.open },
    ...(canMessage ? [{ id: 'messages' as const, label: 'Message customers', icon: <Megaphone size={13} /> }] : []),
    { id: 'reminders', label: 'My reminders', icon: <BellRing size={13} />, badge: unreadReminderCount },
  ];

  const card = 'bg-app-card border border-app-border rounded-2xl shadow-xs';
  const chipBtn =
    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg text-app-text font-sans pb-nav">
      <div className="max-w-6xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 space-y-4">
        <header className="flex items-start gap-3">
          <span className="grid place-items-center size-10 shrink-0 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <MessageSquare size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-app-text">Feedback</h1>
            <p className="text-xs text-app-text-muted">
              Read and answer what customers say, and send them messages.
            </p>
          </div>
        </header>

        <Tabs<TabType> tabs={tabs} activeTab={activeTab} onChange={setActiveTab} className="pb-3" />

        {activeTab === 'messages' && canMessage && <CommunicationCenterView />}

        {activeTab === 'reminders' && <ShiftRemindersPanel />}

        {activeTab === 'reviews' && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className={`${card} p-4`}>
                <p className="text-xs text-app-text-muted">Reviews</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{summary.total}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFeedbackView('active');
                  setStatusFilter(statusFilter === 'open' ? 'all' : 'open');
                }}
                className={`${card} p-4 text-left transition hover:border-amber-500/40 ${
                  statusFilter === 'open' ? 'border-amber-500/60' : ''
                }`}
              >
                <p className="text-xs text-app-text-muted">Not resolved</p>
                <p
                  className={`mt-1 text-2xl font-semibold tabular-nums ${
                    summary.open > 0 ? 'text-amber-600 dark:text-amber-400' : ''
                  }`}
                >
                  {summary.open}
                </p>
              </button>
              <div className={`${card} p-4`}>
                <p className="text-xs text-app-text-muted">Average rating</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-2xl font-semibold tabular-nums">{summary.total ? summary.avgRating : '—'}</span>
                  {summary.total > 0 && <Stars value={summary.avgRating} />}
                </div>
              </div>
              <div className={`${card} p-4 col-span-2 lg:col-span-1`}>
                <p className="text-xs text-app-text-muted">How customers feel</p>
                <div className="mt-2.5 h-2 w-full bg-app-bg rounded-full overflow-hidden flex">
                  <div style={{ width: `${summary.pos}%` }} className="bg-emerald-500 h-full" />
                  <div style={{ width: `${summary.neu}%` }} className="bg-slate-400 h-full" />
                  <div style={{ width: `${summary.neg}%` }} className="bg-red-500 h-full" />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-app-text-muted">
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-emerald-500" /> Happy {summary.pos}%
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-slate-400" /> Neutral {summary.neu}%
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-red-500" /> Unhappy {summary.neg}%
                  </span>
                </div>
              </div>
            </div>

            {/* Search and filters */}
            <div className={`${card} p-3 space-y-3`}>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
                  <input
                    type="search"
                    placeholder="Search by customer, words or branch"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-10 bg-app-bg border border-app-border rounded-xl pl-9 pr-3 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div className="flex shrink-0 rounded-xl border border-app-border bg-app-bg p-0.5" role="group" aria-label="Status">
                  {(
                    [
                      ['all', 'All'],
                      ['open', 'Not resolved'],
                      ['resolved', 'Resolved'],
                    ] as [StatusFilter, string][]
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setStatusFilter(id)}
                      aria-pressed={statusFilter === id}
                      className={`flex-1 sm:flex-none whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                        statusFilter === id
                          ? 'bg-app-card text-app-text shadow-xs'
                          : 'text-app-text-muted hover:text-app-text'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <SearchableDropdown
                  items={[
                    { id: 'all', label: 'Any rating' },
                    { id: '5', label: '5 stars' },
                    { id: '4', label: '4 stars' },
                    { id: '3', label: '3 stars' },
                    { id: '2', label: '2 stars' },
                    { id: '1', label: '1 star' },
                  ]}
                  selectedValue={String(ratingFilter)}
                  onChange={(val) => setRatingFilter(val === 'all' ? 'all' : Number(val))}
                  placeholder="Rating"
                />
                <SearchableDropdown
                  items={[
                    { id: 'all', label: 'Any feeling' },
                    { id: 'positive', label: 'Happy' },
                    { id: 'neutral', label: 'Neutral' },
                    { id: 'negative', label: 'Unhappy' },
                  ]}
                  selectedValue={sentimentFilter}
                  onChange={(val) => setSentimentFilter(val as typeof sentimentFilter)}
                  placeholder="Feeling"
                />
                <SearchableDropdown
                  items={[
                    { id: 'latest', label: 'Newest first' },
                    { id: 'rating-high', label: 'Highest rating first' },
                    { id: 'rating-low', label: 'Lowest rating first' },
                  ]}
                  selectedValue={sortBy}
                  onChange={(val) => setSortBy(val as typeof sortBy)}
                  placeholder="Sort"
                />
              </div>
            </div>

            {/* List header */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 min-w-0">
                {feedbackView === 'archived' && (
                  <button
                    type="button"
                    onClick={() => setFeedbackView('active')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
                  >
                    <ArrowLeft size={13} /> Back
                  </button>
                )}
                <span className="text-xs font-medium text-app-text-muted">
                  {feedbackView === 'archived' ? 'Archived' : 'Showing'} {filteredComments.length}
                  {filtersActive && ` of ${feedbackView === 'archived' ? summary.archived : summary.total}`}
                </span>
                {filtersActive && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1 text-xs text-app-text-muted hover:text-app-text"
                  >
                    <X size={12} /> Clear filters
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {hasAiPermission && summary.total > 0 && (
                  <button
                    type="button"
                    onClick={handleInsights}
                    disabled={isGeneratingInsights}
                    className={`${chipBtn} border border-app-border bg-app-card text-app-text hover:border-amber-500/40`}
                  >
                    {isGeneratingInsights ? <RefreshCw size={13} className="animate-spin" /> : <BarChart2 size={13} />}
                    Ask {aiName} for a summary
                  </button>
                )}
                {feedbackView === 'active' && summary.archived > 0 && (
                  <button
                    type="button"
                    onClick={() => setFeedbackView('archived')}
                    className={`${chipBtn} text-app-text-muted hover:text-app-text`}
                  >
                    <Archive size={13} /> Archived ({summary.archived})
                  </button>
                )}
                <button
                  type="button"
                  onClick={loadComments}
                  disabled={isLoading}
                  title="Refresh"
                  aria-label="Refresh"
                  className={`${chipBtn} text-app-text-muted hover:text-app-text`}
                >
                  <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* What the assistant made of all the feedback */}
            {showInsights && (
              <div className={`${card} p-4 space-y-3`}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Lightbulb size={15} className="text-app-text-muted" /> What customers are saying
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowInsights(false)}
                    aria-label="Close summary"
                    className="p-1 rounded-lg text-app-text-muted hover:text-app-text hover:bg-app-bg"
                  >
                    <X size={15} />
                  </button>
                </div>
                {isGeneratingInsights || !insights ? (
                  <p className="text-sm text-app-text-muted">{aiName} is reading the feedback…</p>
                ) : (
                  <div className="space-y-3 text-sm">
                    <p className="leading-relaxed">{insights.overallSummary}</p>
                    {insights.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {insights.categories.map((c) => (
                          <span key={c.category} className="rounded-lg bg-app-bg border border-app-border px-2 py-1 text-xs">
                            {c.category} · {c.count}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {insights.recurringProblems.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-app-text-muted mb-1">Keeps coming up</p>
                          <ul className="list-disc pl-5 space-y-0.5">
                            {insights.recurringProblems.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {insights.operationalImprovements.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-app-text-muted mb-1">What to change</p>
                          <ul className="list-disc pl-5 space-y-0.5">
                            {insights.operationalImprovements.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Feedback list */}
            {filteredComments.length === 0 ? (
              <div className={`${card} border-dashed p-10 text-center flex flex-col items-center gap-2`}>
                <MessageSquare size={22} className="text-app-text-muted/60" />
                <p className="text-sm font-medium">
                  {isLoading
                    ? 'Loading feedback…'
                    : filtersActive
                    ? 'Nothing matches these filters'
                    : feedbackView === 'archived'
                    ? 'Nothing archived'
                    : 'No feedback yet'}
                </p>
                <p className="text-xs text-app-text-muted max-w-xs">
                  {filtersActive
                    ? 'Try a different search, or clear the filters.'
                    : 'Reviews customers leave on the website show up here.'}
                </p>
                {filtersActive && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="md:hidden px-1 text-[11px] text-app-text-muted">
                  Swipe a review left to archive or delete it. Hold it for more.
                </p>
                {filteredComments.map((comment) => {
                  const state = busy[comment.id];
                  const tone = SENTIMENT_STYLE[comment.sentiment] || SENTIMENT_STYLE.neutral;
                  const draft = replyMessage[comment.id] || '';

                  const archiveAction: RowAction = {
                    label: comment.archivedAt ? 'Restore' : 'Archive',
                    icon: comment.archivedAt ? <ArchiveRestore size={18} /> : <Archive size={18} />,
                    tone: 'sky',
                    hidden: !canReply,
                    onClick: () => toggleArchived(comment),
                  };
                  const deleteAction: RowAction = {
                    label: 'Delete',
                    icon: <Trash2 size={18} />,
                    tone: 'red',
                    hidden: !canReply,
                    disabled: state === 'delete',
                    onClick: () => handleDeleteComment(comment),
                  };

                  return (
                    <SwipeRow
                      key={comment.id}
                      title={comment.customerName}
                      subtitle={comment.comment}
                      actions={[archiveAction, deleteAction]}
                      more={[
                        {
                          label: comment.resolved ? 'Mark not resolved' : 'Mark resolved',
                          icon: comment.resolved ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />,
                          hidden: !canReply,
                          onClick: () => toggleResolved(comment),
                        },
                        {
                          label: `Ask ${aiName} about it`,
                          icon: <Lightbulb size={16} />,
                          hidden: !hasAiPermission,
                          onClick: () => handleAiAnalyze(comment),
                        },
                        {
                          label: `Draft a reply with ${aiName}`,
                          icon: <PenLine size={16} />,
                          hidden: !hasAiPermission || !canReply,
                          onClick: () => handleAiGenerateReply(comment),
                        },
                        { ...archiveAction, icon: comment.archivedAt ? <ArchiveRestore size={16} /> : <Archive size={16} /> },
                        { ...deleteAction, icon: <Trash2 size={16} /> },
                      ]}
                      className={`border rounded-2xl overflow-hidden ${
                        comment.resolved ? 'border-app-border' : 'border-amber-500/30 shadow-xs'
                      }`}
                      contentClassName="p-4 space-y-3"
                    >
                      {/* Who, when, rating */}
                      <div className="flex items-start gap-3">
                        <div className="relative size-9 shrink-0 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold text-sm grid place-items-center">
                          {(comment.customerName || '?').charAt(0).toUpperCase()}
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-app-card ${tone.dot}`}
                            aria-hidden
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold truncate">{comment.customerName}</span>
                            <Stars value={comment.rating} size={12} />
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-app-text-muted">
                            <span>{formatWhen(comment.timestamp)}</span>
                            {comment.branch && (
                              <>
                                <span aria-hidden>·</span>
                                <span>{comment.branch}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className={`hidden sm:inline rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone.chip}`}>
                            {tone.label}
                          </span>
                          {comment.resolved ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 size={12} /> Resolved
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                              <AlertCircle size={12} /> Open
                            </span>
                          )}
                        </div>
                      </div>

                      {/* What they said */}
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{comment.comment}</p>

                      {/* The assistant's read on it */}
                      {aiNotes[comment.id] && (
                        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 text-sm">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400">
                              <Lightbulb size={13} /> {aiName}'s view
                            </span>
                            <button
                              type="button"
                              aria-label="Hide"
                              onClick={() =>
                                setAiNotes((prev) => {
                                  const next = { ...prev };
                                  delete next[comment.id];
                                  return next;
                                })
                              }
                              className="p-0.5 rounded text-app-text-muted hover:text-app-text"
                            >
                              <X size={13} />
                            </button>
                          </div>
                          <p className="leading-relaxed whitespace-pre-wrap">{aiNotes[comment.id]}</p>
                        </div>
                      )}

                      {/* Replies so far */}
                      {comment.replies.length > 0 && (
                        <div className="space-y-2 border-l-2 border-amber-500/30 pl-3">
                          {comment.replies.map((reply) => (
                            <div key={reply.id} className="text-sm">
                              <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-app-text-muted">
                                <span className="font-medium text-app-text">{reply.author}</span>
                                <span>{reply.role}</span>
                                <span aria-hidden>·</span>
                                <span>{formatWhen(reply.timestamp)}</span>
                              </div>
                              <p className="mt-0.5 leading-relaxed whitespace-pre-wrap break-words">{reply.message}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply box */}
                      {canReply && (
                        <div className="space-y-2 border-t border-app-border pt-3">
                          <div className="flex items-end gap-2">
                            <textarea
                              rows={draft.length > 80 ? 3 : 1}
                              placeholder="Write a reply…"
                              value={draft}
                              onChange={(e) => setReplyMessage((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleAddReply(comment);
                                }
                              }}
                              className="flex-1 min-w-0 resize-none bg-app-bg border border-app-border rounded-xl px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddReply(comment)}
                              disabled={!!state || !draft.trim()}
                              aria-label="Post reply"
                              className="h-9 shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 text-sm font-medium text-slate-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
                            >
                              {state === 'reply' ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                              <span className="hidden sm:inline">Reply</span>
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {hasAiPermission && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleAiGenerateReply(comment)}
                                  disabled={!!state}
                                  className={`${chipBtn} text-violet-600 dark:text-violet-400 hover:bg-violet-500/10`}
                                >
                                  {state === 'draft' ? <RefreshCw size={12} className="animate-spin" /> : <PenLine size={12} />}
                                  Draft reply
                                </button>
                                {draft.trim() && (
                                  <button
                                    type="button"
                                    onClick={() => handleAiImproveReply(comment)}
                                    disabled={!!state}
                                    className={`${chipBtn} text-violet-600 dark:text-violet-400 hover:bg-violet-500/10`}
                                  >
                                    {state === 'polish' ? <RefreshCw size={12} className="animate-spin" /> : <PenLine size={12} />}
                                    Improve my reply
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleAiAnalyze(comment)}
                                  disabled={!!state}
                                  className={`${chipBtn} text-violet-600 dark:text-violet-400 hover:bg-violet-500/10`}
                                >
                                  {state === 'analyze' ? <RefreshCw size={12} className="animate-spin" /> : <Lightbulb size={12} />}
                                  Ask {aiName}
                                </button>
                              </>
                            )}
                            <span className="flex-1" />
                            <button
                              type="button"
                              onClick={() => toggleResolved(comment)}
                              disabled={!!state}
                              className={`${chipBtn} ${
                                comment.resolved
                                  ? 'text-app-text-muted hover:bg-app-bg'
                                  : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                              }`}
                            >
                              {state === 'resolve' ? (
                                <RefreshCw size={12} className="animate-spin" />
                              ) : comment.resolved ? (
                                <AlertCircle size={12} />
                              ) : (
                                <CheckCircle2 size={12} />
                              )}
                              {comment.resolved ? 'Reopen' : 'Mark resolved'}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleArchived(comment)}
                              title={comment.archivedAt ? 'Restore' : 'Archive'}
                              aria-label={comment.archivedAt ? 'Restore' : 'Archive'}
                              className={`${chipBtn} hidden md:inline-flex text-app-text-muted hover:bg-app-bg hover:text-app-text`}
                            >
                              {comment.archivedAt ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteComment(comment)}
                              disabled={!!state}
                              title="Delete"
                              aria-label="Delete"
                              className={`${chipBtn} hidden md:inline-flex text-app-text-muted hover:bg-red-500/10 hover:text-red-500`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      )}
                    </SwipeRow>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
