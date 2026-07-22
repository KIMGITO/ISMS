// src/components/PendingActionsDrawer.tsx
// Pending Actions (Drafts) Review & Human-in-the-Loop Verification Drawer

import React, { useCallback, useState } from 'react';
import { usePendingActionStore } from '../stores/pendingActionStore';
import { PendingAction, PendingActionType } from '../types';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Play,
  Edit3,
  Trash2,
  Sparkles,
  ShoppingBag,
  UserPlus,
  PackagePlus,
  FlaskConical,
  Truck,
  ArrowRightLeft,
  DollarSign,
  MessageSquare,
  ShieldAlert,
  Loader2,
  Layers,
  Edit2Icon,
  Edit,
  ActivitySquareIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useOverlay } from '../hooks/useOverlay';

export default function PendingActionsDrawer() {
  const {
    pendingActions,
    isDrawerOpen,
    setDrawerOpen,
    executePendingAction,
    rejectPendingAction,
    verifyPendingAction,
    clearCompletedActions,
  } = usePendingActionStore();

  const handleClose = useCallback(() => {
    setDrawerOpen(false);
  }, [setDrawerOpen]);

  useOverlay(isDrawerOpen, handleClose, 'drawer');

  const [filterType, setFilterType] = useState<string>('all');
  const [editingAction, setEditingAction] = useState<PendingAction | null>(null);
  const [editedParamsJson, setEditedParamsJson] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState<string | null>(null);

  const activePending = pendingActions.filter(
    (a) => a.status === 'pending_review' || a.status === 'verified'
  );

  const filteredActions = pendingActions.filter((a) => {
    if (filterType === 'all') return true;
    if (filterType === 'pending') return a.status === 'pending_review' || a.status === 'verified';
    if (filterType === 'executed') return a.status === 'executed';
    if (filterType === 'rejected') return a.status === 'rejected';
    return a.type === filterType;
  });

  const getActionIcon = (type: PendingActionType) => {
    switch (type) {
      case 'create_checkout': return <ShoppingBag size={15} className="text-amber-500" />;
      case 'create_customer': return <UserPlus size={15} className="text-blue-500" />;
      case 'create_product': return <PackagePlus size={15} className="text-emerald-500" />;
      case 'create_recipe_bom': return <FlaskConical size={15} className="text-amber-500" />;
      case 'create_purchase': return <Truck size={15} className="text-purple-500" />;
      case 'adjust_stock': return <ArrowRightLeft size={15} className="text-indigo-500" />;
      case 'create_expense': return <DollarSign size={15} className="text-red-500" />;
      case 'create_feedback_reply': return <MessageSquare size={15} className="text-teal-500" />;
      default: return <Edit size={15} className="text-amber-500" />;
    }
  };

  const openEditModal = (action: PendingAction) => {
    setEditingAction(action);
    setEditedParamsJson(JSON.stringify(action.params, null, 2));
    setJsonError(null);
  };

  const handleSaveVerifiedParams = () => {
    if (!editingAction) return;
    try {
      const parsed = JSON.parse(editedParamsJson);
      verifyPendingAction(editingAction.id, parsed);
      setEditingAction(null);
    } catch (err: any) {
      setJsonError('Invalid JSON format. Please check syntax.');
    }
  };

  const handleExecute = async (id: string) => {
    setIsExecuting(id);
    try {
      await executePendingAction(id);
    } finally {
      setIsExecuting(null);
    }
  };

  if (!isDrawerOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          exit={{ opacity: 0 }}
          onClick={() => setDrawerOpen(false)}
          className="absolute inset-0 bg-black backdrop-blur-xs"
        />

        {/* Drawer Content */}
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="relative w-full max-w-xl bg-app-card border-l border-app-border h-full flex flex-col shadow-2xl z-10"
        >
          {/* Header */}
          <div className="p-4 border-b border-app-border flex items-center justify-between shrink-0 bg-app-card">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <ActivitySquareIcon size={16} className="text-amber-500" />
              </div>
              <div>
                <h2 className="text-sm font-black text-app-text flex items-center gap-2">
                  Pending Actions (Drafts)
                  <span className="bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full text-[10px] font-black">
                    {activePending.length}
                  </span>
                </h2>
                <p className="text-[10px] text-app-text-muted">
                  Human Review & Execution Verification
                </p>
              </div>
            </div>
            <button
              onClick={() => setDrawerOpen(false)}
              className="p-1.5 hover:bg-slate-800 text-slate-500 hover:text-slate-300 rounded-lg transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Filter Tabs */}
          <div className="px-4 py-2 border-b border-app-border flex items-center gap-1.5 overflow-x-auto shrink-0 text-[10px] font-bold">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                filterType === 'all'
                  ? 'bg-amber-500 text-slate-950 font-black'
                  : 'bg-app-bg text-app-text hover:bg-slate-800'
              }`}
            >
              All ({pendingActions.length})
            </button>
            <button
              onClick={() => setFilterType('pending')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                filterType === 'pending'
                  ? 'bg-amber-500 text-slate-950 font-black'
                  : 'bg-app-bg text-app-text hover:bg-slate-800'
              }`}
            >
              Pending ({activePending.length})
            </button>
            <button
              onClick={() => setFilterType('executed')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                filterType === 'executed'
                  ? 'bg-emerald-500 text-slate-950 font-black'
                  : 'bg-app-bg text-app-text hover:bg-slate-800'
              }`}
            >
              Executed
            </button>
            <button
              onClick={() => setFilterType('rejected')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                filterType === 'rejected'
                  ? 'bg-red-500 text-white font-black'
                  : 'bg-app-bg text-app-text hover:bg-slate-800'
              }`}
            >
              Rejected
            </button>
            {pendingActions.some((a) => a.status === 'executed' || a.status === 'rejected') && (
              <button
                onClick={clearCompletedActions}
                className="ml-auto text-[9px] text-slate-500 hover:text-slate-400 font-bold cursor-pointer"
              >
                Clear History
              </button>
            )}
          </div>

          {/* Actions List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {filteredActions.length === 0 ? (
              <div className="text-center py-12 text-slate-500 space-y-2">
                <Layers size={36} className="mx-auto opacity-40 text-amber-500" />
                <p className="text-xs font-bold">No pending draft actions found.</p>
                <p className="text-[10px] text-slate-600 max-w-xs mx-auto">
                  Ask the AI Copilot to create sales, customers, products, recipes, BOMs, purchases, or expenses. Drafts will appear here for your verification.
                </p>
              </div>
            ) : (
              filteredActions.map((action) => {
                const isPending = action.status === 'pending_review' || action.status === 'verified';
                const isExecuted = action.status === 'executed';
                const isRejected = action.status === 'rejected';

                return (
                  <motion.div
                    key={action.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`bg-app-bg border rounded-2xl p-3.5 space-y-3 transition ${
                      isPending
                        ? 'border-app-border hover:border-amber-500/30'
                        : isExecuted
                        ? 'border-emerald-500/20 opacity-75'
                        : 'border-red-500/20 opacity-60'
                    }`}
                  >
                    {/* Draft Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1.5 rounded-lg bg-app-card border border-app-border shrink-0">
                          {getActionIcon(action.type)}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-app-text truncate">{action.title}</h4>
                          <span className="text-[9px] text-app-text-muted font-mono block">
                            By {action.createdBy} · {new Date(action.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0">
                        {isPending && action.validation.isValid && (
                          <span className="text-[9px] font-black text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={10} /> Verified
                          </span>
                        )}
                        {isPending && !action.validation.isValid && (
                          <span className="text-[9px] font-black text-red-500 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <AlertTriangle size={10} /> Needs Attention
                          </span>
                        )}
                        {isExecuted && (
                          <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                            Executed
                          </span>
                        )}
                        {isRejected && (
                          <span className="text-[9px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
                            Rejected
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="p-2.5 bg-app-card rounded-xl border border-app-border text-xs text-app-text leading-relaxed font-medium">
                      {action.summary}
                    </div>

                    {/* Validation Errors & Warnings */}
                    {isPending && action.validation.errors.length > 0 && (
                      <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl space-y-1">
                        <span className="text-[9px] font-black text-red-500 uppercase tracking-wider flex items-center gap-1">
                          <ShieldAlert size={10} /> Action Blocked:
                        </span>
                        {action.validation.errors.map((err, i) => (
                          <p key={i} className="text-[10px] text-red-400 font-medium">
                            • {err}
                          </p>
                        ))}
                      </div>
                    )}

                    {isPending && action.validation.warnings.length > 0 && (
                      <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-0.5">
                        {action.validation.warnings.map((warn, i) => (
                          <p key={i} className="text-[9.5px] text-amber-400 font-medium">
                            ⚠️ {warn}
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Verification & Action Controls */}
                    {isPending && (
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-app-border/60">
                        <button
                          onClick={() => openEditModal(action)}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold transition cursor-pointer flex items-center gap-1"
                        >
                          <Edit3 size={11} /> Review & Edit
                        </button>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => rejectPendingAction(action.id)}
                            className="px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 rounded-lg text-[10px] font-bold transition cursor-pointer flex items-center gap-1"
                          >
                            <Ban size={11} /> Discard
                          </button>
                          <button
                            onClick={() => handleExecute(action.id)}
                            disabled={!action.validation.isValid || isExecuting === action.id}
                            className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-lg text-[10px] transition cursor-pointer disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            {isExecuting === action.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Play size={11} />
                            )}
                            Confirm & Execute
                          </button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>

      {/* EDIT & VERIFY MODAL */}
      {editingAction && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-app-card border border-app-border rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-black text-app-text flex items-center gap-2">
                  <Edit3 size={14} className="text-amber-500" /> Inspect & Edit Draft Parameters
                </h3>
                <p className="text-[10px] text-app-text-muted mt-0.5">{editingAction.title}</p>
              </div>
              <button
                onClick={() => setEditingAction(null)}
                className="p-1 hover:bg-slate-800 text-slate-500 hover:text-slate-300 rounded-lg transition cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                Raw JSON Parameters
              </label>
              <textarea
                value={editedParamsJson}
                onChange={(e) => {
                  setEditedParamsJson(e.target.value);
                  setJsonError(null);
                }}
                rows={10}
                className="w-full bg-app-bg border border-app-border text-app-text p-3 rounded-xl font-mono text-xs focus:outline-none focus:border-amber-500/50"
              />
              {jsonError && <p className="text-[10px] text-red-500 font-bold">{jsonError}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
              <button
                onClick={() => setEditingAction(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveVerifiedParams}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 size={12} /> Save & Mark Verified
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
