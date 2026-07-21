// src/features/ProductionBOMView.tsx
// Production Batching & Bill of Materials Management View

import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useExtraModulesStore, ProductionBatch } from '../stores/extraModulesStore';
import { useAuthStore } from '../stores/authStore';
import { useBusinessStore } from '../stores/businessStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { hasRolePermission } from '../utils/permissions';
import { SupabaseService } from '../services/supabaseService';
import { BillOfMaterials, BomIngredient, ProductionBatchInput } from '../types';
import SearchableDropdown from '../components/SearchableDropdown';
import { handleNumberInput } from '../utils/helpers';
import {
  Plus,
  FlaskConical,
  Package,
  Layers,
  Beaker,
  Trash2,
  Edit3,
  Save,
  X,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Search,
  ClipboardList,
  Factory,
  ArrowRight,
  Loader2,
  FileText,
  Scale,
  Droplets,
  Gauge,
  Clock,
  User,
  CheckCircle2,
  AlertTriangle,
  Ban,
  RefreshCw,
  Play,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useOverlay } from '../hooks/useOverlay';

type ViewMode = 'list' | 'create-bom' | 'create-batch' | 'bom-detail';

interface RestockItemState {
  productId: string;
  productName: string;
  consumedQty: number;
  currentStock: number;
  returnQty: number;
  isDamaged: boolean;
  wasteReason: string;
}

export default function ProductionBOMView() {
  const { products, currentEmployee, showToast } = useAppStore();
  const { activeBusinessId } = useBusinessStore();
  const extra = useExtraModulesStore();
  const { currentEmployee: authEmployee } = useAuthStore();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBom, setSelectedBom] = useState<BillOfMaterials | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Cancellation Modal state
  const [cancellingBatch, setCancellingBatch] = useState<ProductionBatch | null>(null);
  const [cancellationItems, setCancellationItems] = useState<RestockItemState[]>([]);

  useOverlay(cancellingBatch !== null, () => setCancellingBatch(null), 'dialog');

  // BOM Creation form state
  const [bomName, setBomName] = useState('');
  const [bomProductId, setBomProductId] = useState('');
  const [bomYieldQty, setBomYieldQty] = useState(1);
  const [bomYieldUnit, setBomYieldUnit] = useState('Unit');
  const [bomIngredients, setBomIngredients] = useState<Array<{
    productId: string;
    productName: string;
    quantityRequired: number;
    unit: string;
    wastePercentage: number;
  }>>([]);

  // Batch creation form state
  const [batchBomId, setBatchBomId] = useState('');
  const [batchProductId, setBatchProductId] = useState('');
  const [batchRecipeName, setBatchRecipeName] = useState('');
  const [batchQty, setBatchQty] = useState(1);
  const [batchUnit, setBatchUnit] = useState('Unit');
  const [batchStatus, setBatchStatus] = useState<'Pending' | 'In Progress' | 'Completed' | 'Cancelled'>('In Progress');
  const [batchStaffName, setBatchStaffName] = useState('');

  const staffName = currentEmployee?.name || authEmployee?.name || 'Staff';

  // Filtered BOMs
  const filteredBoms = useMemo(() => {
    if (!searchQuery.trim()) return extra.billOfMaterials;
    const lower = searchQuery.toLowerCase();
    return extra.billOfMaterials.filter(b =>
      b.name.toLowerCase().includes(lower) ||
      b.productName?.toLowerCase().includes(lower) ||
      b.recipeName?.toLowerCase().includes(lower)
    );
  }, [extra.billOfMaterials, searchQuery]);

  // Filtered batches
  const filteredBatches = useMemo(() => {
    if (!searchQuery.trim()) return extra.productionBatches;
    const lower = searchQuery.toLowerCase();
    return extra.productionBatches.filter(b =>
      b.recipeName.toLowerCase().includes(lower) ||
      b.id.toLowerCase().includes(lower) ||
      (b.referenceNumber && b.referenceNumber.toLowerCase().includes(lower)) ||
      b.staffName.toLowerCase().includes(lower)
    );
  }, [extra.productionBatches, searchQuery]);

  // Load BOMs & Batches from Supabase on mount
  useEffect(() => {
    if (activeBusinessId) {
      SupabaseService.fetchBoms(activeBusinessId)
        .then(boms => extra.setBillOfMaterials(boms))
        .catch(err => console.error('Failed to load BOMs:', err));

      SupabaseService.fetchProductionBatches(activeBusinessId)
        .then(batches => useExtraModulesStore.setState({ productionBatches: batches }))
        .catch(err => console.error('Failed to load batches:', err));
    }
  }, [activeBusinessId]);

  const canCreate = hasRolePermission(currentEmployee?.role || '', 'bom.create');
  const canView = hasRolePermission(currentEmployee?.role || '', 'bom.view');
  const canDelete = hasRolePermission(currentEmployee?.role || '', 'bom.delete');
  const canCreateBatch = hasRolePermission(currentEmployee?.role || '', 'production.create');

  // Ingredient availability calculation for batch creation
  const selectedBomForBatch = useMemo(() => {
    return extra.billOfMaterials.find(b => b.id === batchBomId) || null;
  }, [extra.billOfMaterials, batchBomId]);

  const ingredientAvailability = useMemo(() => {
    if (!selectedBomForBatch || !selectedBomForBatch.ingredients) return [];
    return selectedBomForBatch.ingredients.map(ing => {
      const prod = products.find(p => p.id === ing.productId);
      const requiredQty = Number((ing.quantityRequired * (1 + (ing.wastePercentage || 0) / 100) * batchQty).toFixed(3));
      const currentStock = prod ? Number(prod.stock) : 0;
      const isSufficient = currentStock >= requiredQty;
      return {
        productId: ing.productId,
        productName: ing.productName || prod?.name || 'Raw Material',
        unit: ing.unit,
        requiredQty,
        currentStock,
        isSufficient,
        shortage: Math.max(0, Number((requiredQty - currentStock).toFixed(3))),
      };
    });
  }, [selectedBomForBatch, batchQty, products]);

  const hasInsufficientIngredients = useMemo(() => {
    return ingredientAvailability.some(i => !i.isSufficient);
  }, [ingredientAvailability]);

  // Add ingredient to BOM form
  const addIngredient = () => {
    setBomIngredients(prev => [...prev, {
      productId: '',
      productName: '',
      quantityRequired: 1,
      unit: 'Liters',
      wastePercentage: 0,
    }]);
  };

  const updateIngredient = (index: number, field: string, value: any) => {
    setBomIngredients(prev => {
      const updated = [...prev];
      (updated[index] as any)[field] = value;
      if (field === 'productId') {
        const product = products.find(p => p.id === value);
        updated[index].productName = product?.name || '';
        updated[index].unit = product?.unit || 'Liters';
      }
      return updated;
    });
  };

  const removeIngredient = (index: number) => {
    setBomIngredients(prev => prev.filter((_, i) => i !== index));
  };

  // Open Batch Cancellation Workflow Modal
  const openCancelModal = (batch: ProductionBatch) => {
    const bom = extra.billOfMaterials.find(b => b.id === batch.bomId);
    const items: RestockItemState[] = [];

    if (bom && bom.ingredients) {
      bom.ingredients.forEach(ing => {
        const prod = products.find(p => p.id === ing.productId);
        const consumedQty = Number((ing.quantityRequired * (1 + (ing.wastePercentage || 0) / 100) * batch.quantityProduced).toFixed(3));
        items.push({
          productId: ing.productId,
          productName: ing.productName || prod?.name || 'Raw Material',
          consumedQty,
          currentStock: prod ? Number(prod.stock) : 0,
          returnQty: consumedQty,
          isDamaged: false,
          wasteReason: 'Production batch cancellation damage'
        });
      });
    }

    setCancellationItems(items);
    setCancellingBatch(batch);
  };

  // Submit Cancellation Workflow
  const handleConfirmCancellation = async () => {
    if (!cancellingBatch) return;
    setIsSubmitting(true);
    try {
      const returnPayload = cancellationItems.map(item => ({
        productId: item.productId,
        returnQty: item.isDamaged ? 0 : Math.min(item.consumedQty, Math.max(0, Number(item.returnQty))),
        wasteReason: item.wasteReason || 'Batch cancellation write-off'
      }));

      const result = await extra.cancelProductionBatch(cancellingBatch.id, staffName, returnPayload);

      if (result.success) {
        showToast?.('Batch Cancelled', 'Batch cancelled. Stock reversal and waste logs recorded.', undefined, 'info');
        setCancellingBatch(null);
      } else {
        showToast?.('Error', result.error || 'Failed to cancel batch.', undefined, 'error');
      }
    } catch (err: any) {
      showToast?.('Error', err.message || 'An unexpected error occurred.', undefined, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteBatch = async (id: string) => {
    try {
      const res = await extra.deleteProductionBatch(id);
      if (res.success) {
        showToast?.('Deleted', 'Production batch record removed.', undefined, 'success');
      } else {
        showToast?.('Error', res.error || 'Failed to delete batch.', undefined, 'error');
      }
    } catch (err: any) {
      showToast?.('Error', err.message || 'An unexpected error occurred.', undefined, 'error');
    }
  };

  // Update batch status (Completion / In Progress)
  const handleUpdateBatchStatus = async (batchId: string, newStatus: 'Pending' | 'In Progress' | 'Completed' | 'Cancelled') => {
    if (newStatus === 'Cancelled') {
      const batch = extra.productionBatches.find(b => b.id === batchId);
      if (batch) openCancelModal(batch);
      return;
    }

    
    setIsSubmitting(true);
    try {
      const result = await extra.updateProductionBatch(batchId, { status: newStatus, staffName });
      if (result.success) {
        showToast?.('Success', `Batch status updated to ${newStatus}`, undefined, 'success');
      } else {
        showToast?.('Error', result.error || 'Failed to update batch status.', undefined, 'error');
      }
    } catch (err: any) {
      showToast?.('Error', err.message || 'An unexpected error occurred.', undefined, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit BOM
  const handleCreateBom = async () => {
    if (!bomName.trim() || !bomProductId || !activeBusinessId) {
      showToast?.('Validation Error', 'Please fill in all required fields.', undefined, 'error');
      return;
    }
    if (bomIngredients.length === 0) {
      showToast?.('Validation Error', 'Add at least one ingredient.', undefined, 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await SupabaseService.createBom({
        businessId: activeBusinessId,
        productId: bomProductId,
        name: bomName,
        yieldQuantity: bomYieldQty,
        yieldUnit: bomYieldUnit,
        ingredients: bomIngredients.map(ing => ({
          productId: ing.productId,
          quantityRequired: ing.quantityRequired,
          unit: ing.unit,
          wastePercentage: ing.wastePercentage,
        })),
      });

      const boms = await SupabaseService.fetchBoms(activeBusinessId);
      extra.setBillOfMaterials(boms);

      showToast?.('Success', `BOM "${bomName}" created successfully.`, undefined, 'success');
      resetBomForm();
      setViewMode('list');
    } catch (err: any) {
      showToast?.('Error', err.message || 'Failed to create BOM.', undefined, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete BOM
  const handleDeleteBom = async (id: string) => {
    try {
      await SupabaseService.deleteBom(id);
      extra.removeBillOfMaterial(id);
      showToast?.('Deleted', 'BOM removed successfully.', undefined, 'success');
    } catch (err: any) {
      showToast?.('Error', err.message || 'Failed to delete BOM.', undefined, 'error');
    }
  };

  // Submit Production Batch (Immediate Consumption)
  const handleCreateBatch = async () => {
    if (!batchBomId || !activeBusinessId) {
      showToast?.('Validation Error', 'Please select a BOM and fill in all fields.', undefined, 'error');
      return;
    }

    if (hasInsufficientIngredients) {
      showToast?.('Stock Insufficient', 'Required raw materials exceed current inventory stock.', undefined, 'error');
      return;
    }

    const selectedBomData = extra.billOfMaterials.find(b => b.id === batchBomId);
    if (!selectedBomData) return;

    setIsSubmitting(true);
    try {
      const input: ProductionBatchInput = {
        businessId: activeBusinessId,
        recipeName: batchRecipeName || selectedBomData.name,
        productId: selectedBomData.productId,
        bomId: batchBomId,
        quantityProduced: batchQty,
        unit: batchUnit || selectedBomData.yieldUnit,
        status: batchStatus,
        staffName: batchStaffName || staffName,
      };

      const result = await extra.createProductionBatch(input);

      if (result.success) {
        showToast?.('Batch Started', `Production batch created & raw materials deducted immediately.`, undefined, 'success');
        resetBatchForm();
        setViewMode('list');
      } else {
        showToast?.('Error', result.error || 'Failed to create batch.', undefined, 'error');
      }
    } catch (err: any) {
      showToast?.('Error', err.message || 'An unexpected error occurred.', undefined, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetBomForm = () => {
    setBomName('');
    setBomProductId('');
    setBomYieldQty(1);
    setBomYieldUnit('Unit');
    setBomIngredients([]);
  };

  const resetBatchForm = () => {
    setBatchBomId('');
    setBatchProductId('');
    setBatchRecipeName('');
    setBatchQty(1);
    setBatchUnit('Unit');
    setBatchStatus('In Progress');
    setBatchStaffName('');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Completed': return <span className="flex items-center gap-1 text-[10px] font-black text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20"><CheckCircle2 size={10} /> Completed</span>;
      case 'In_Progress':
      case 'In Progress': return <span className="flex items-center gap-1 text-[10px] font-black text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20"><Loader2 size={10} className="animate-spin" /> In Progress</span>;
      case 'Pending': return <span className="flex items-center gap-1 text-[10px] font-black text-slate-400 bg-slate-500/10 px-2 py-0.5 rounded-full border border-slate-500/20"><Clock size={10} /> Pending</span>;
      case 'Cancelled': return <span className="flex items-center gap-1 text-[10px] font-black text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20"><Ban size={10} /> Cancelled</span>;
      default: return <span className="text-[10px] font-black text-slate-400">{status}</span>;
    }
  };

  if (!canView) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <Ban size={40} className="text-slate-600 mx-auto" />
          <h3 className="text-sm font-black text-slate-400">Access Denied</h3>
          <p className="text-xs text-slate-500">You don't have permission to view Production & BOM.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-app-bg">
      {/* Header */}
      <div className="px-4 py-3 border-b border-app-border bg-app-card flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <FlaskConical size={16} className="text-amber-500" />
          </div>
          <div>
            <h2 className="text-sm font-black text-app-text">Production & BOM</h2>
            <p className="text-[10px] text-app-text-muted">Recipe Formulations, Real-Time Deduction & Batch Output</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'list' && (
            <>
              {canCreateBatch && (
                <button
                  onClick={() => { resetBatchForm(); setViewMode('create-batch'); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-lg text-[10px] font-black hover:bg-emerald-500/20 transition cursor-pointer"
                >
                  <Plus size={12} /> New Batch
                </button>
              )}
              {canCreate && (
                <button
                  onClick={() => { resetBomForm(); setViewMode('create-bom'); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-lg text-[10px] font-black hover:bg-amber-500/20 transition cursor-pointer"
                >
                  <Plus size={12} /> New BOM
                </button>
              )}
            </>
          )}
          {viewMode !== 'list' && (
            <button
              onClick={() => setViewMode('list')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-[10px] font-black hover:bg-slate-700 transition cursor-pointer"
            >
              <X size={12} /> Back
            </button>
          )}
        </div>
      </div>

      {/* Search Bar (list mode only) */}
      {viewMode === 'list' && (
        <div className="px-4 py-2 border-b border-app-border">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search BOMs or batches..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-app-bg border border-app-border text-app-text pl-8 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-amber-500/50"
            />
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6 pb-24">
        {viewMode === 'list' && (
          <>
            {/* BOMs Section */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <FileText size={14} className="text-amber-500" />
                <h3 className="text-xs font-black text-app-text uppercase tracking-wider">Bill of Materials</h3>
                <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-full">{filteredBoms.length}</span>
              </div>
              {filteredBoms.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Layers size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No BOMs found. {canCreate ? 'Create one to get started.' : ''}</p>
                </div>
              ) : (
                <div className="grid gap-2">
                  {filteredBoms.map(bom => (
                    <motion.div
                      key={bom.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-app-card border border-app-border rounded-xl p-3 hover:border-amber-500/20 transition cursor-pointer"
                      onClick={() => { setSelectedBom(bom); setViewMode('bom-detail'); }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-bold text-app-text truncate">{bom.name}</h4>
                          <p className="text-[10px] text-app-text-muted mt-0.5">
                            {bom.productName || 'No product linked'} · Yield: {bom.yieldQuantity} {bom.yieldUnit}
                          </p>
                          <p className="text-[9px] text-slate-500 mt-1">
                            {bom.ingredients?.length || 0} ingredient{bom.ingredients?.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        {canDelete && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteBom(bom.id); }}
                            className="p-1.5 hover:bg-red-500/10 text-slate-500 hover:text-red-500 rounded-lg transition cursor-pointer shrink-0"
                            title="Delete BOM"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </section>

            {/* Production Batches Section */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Factory size={14} className="text-emerald-500" />
                <h3 className="text-xs font-black text-app-text uppercase tracking-wider">Production Batches</h3>
                <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-full">{filteredBatches.length}</span>
              </div>
              {filteredBatches.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Package size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No production batches recorded yet.</p>
                </div>
              ) : (
                <div className="grid gap-2">
                  {filteredBatches.map(batch => (
                    <motion.div
                      key={batch.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-app-card border border-app-border rounded-xl p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-xs font-bold text-app-text truncate">{batch.recipeName}</h4>
                            {getStatusBadge(batch.status)}
                          </div>
                          <p className="text-[10px] text-app-text-muted mt-1 font-mono">
                            {batch.referenceNumber ? `Ref: ${batch.referenceNumber}` : `ID: ${batch.id.substring(0,8).toUpperCase()}`}
                          </p>
                          <p className="text-[10px] text-app-text-muted mt-0.5">
                            Yield Target: <span className="font-bold text-app-text">{batch.quantityProduced} {batch.unit}</span> · Operator: {batch.staffName}
                          </p>
                          <p className="text-[9px] text-slate-500 mt-0.5">
                            {new Date(batch.date).toLocaleString()}
                          </p>
                        </div>
                        {canCreateBatch && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            {batch.status !== 'Completed' && batch.status !== 'Cancelled' ? (
                              <>
                                {(batch.status === 'Pending' || batch.status === 'In_Progress' || batch.status === 'In Progress') && (
                                  <button
                                    onClick={() => handleUpdateBatchStatus(batch.id, 'Completed')}
                                    className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-500 rounded-lg text-[10px] font-black transition cursor-pointer flex items-center gap-1"
                                    title="Mark as Completed (Adds Finished Goods to Stock)"
                                  >
                                    <CheckCircle2 size={11} /> Complete Batch
                                  </button>
                                )}
                                <button
                                  onClick={() => openCancelModal(batch)}
                                  className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 rounded-lg text-[10px] font-black transition cursor-pointer flex items-center gap-1"
                                  title="Cancel Batch & Launch Restock Workflow"
                                >
                                  <Ban size={11} /> Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleDeleteBatch(batch.id)}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition"
                                title="Delete from view"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* Create BOM Form */}
        {viewMode === 'create-bom' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl mx-auto space-y-4 pb-20"
          >
            <div className="bg-app-card border border-app-border rounded-xl p-4 space-y-4">
              <h3 className="text-xs font-black text-app-text flex items-center gap-2">
                <Layers size={14} className="text-amber-500" /> New Bill of Materials
              </h3>

              {/* BOM Name */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">BOM Name *</label>
                <input
                  type="text"
                  value={bomName}
                  onChange={(e) => setBomName(e.target.value)}
                  placeholder="e.g. Yogurt Production Formula"
                  className="w-full bg-app-bg border border-app-border text-app-text px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-amber-500/50"
                />
              </div>

              {/* Finished Good Product */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Finished Good Product *</label>
                <SearchableDropdown
                  items={products.map(p => ({
                    id: p.id,
                    label: p.name,
                    sublabel: p.sku || p.category
                  }))}
                  selectedValue={bomProductId}
                  onChange={setBomProductId}
                  placeholder="Select finished product..."
                  searchPlaceholder="Search products..."
                />
              </div>

              {/* Yield */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Yield Quantity</label>
                  <input
                    type="number"
                    value={bomYieldQty}
                    onChange={(e) => handleNumberInput(e.target.value, setBomYieldQty, 0.001)}
                    min={0.001}
                    step={0.001}
                    className="w-full bg-app-bg border border-app-border text-app-text px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-amber-500/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Yield Unit</label>
                  <input
                    type="text"
                    value={bomYieldUnit}
                    onChange={(e) => setBomYieldUnit(e.target.value)}
                    placeholder="Liters, Kg, Units"
                    className="w-full bg-app-bg border border-app-border text-app-text px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>

              {/* Ingredients */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Ingredients (Raw Materials)</label>
                  <button
                    onClick={addIngredient}
                    className="flex items-center gap-1 px-2 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-lg text-[9px] font-black hover:bg-amber-500/20 transition cursor-pointer"
                  >
                    <Plus size={10} /> Add Ingredient
                  </button>
                </div>

                {bomIngredients.length === 0 && (
                  <p className="text-[10px] text-slate-500 text-center py-4">No ingredients added yet.</p>
                )}

                {bomIngredients.map((ing, idx) => (
                  <div key={idx} className="bg-app-bg border border-app-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black text-slate-400 uppercase">Ingredient #{idx + 1}</span>
                      <button
                        onClick={() => removeIngredient(idx)}
                        className="p-1 hover:bg-red-500/10 text-slate-500 hover:text-red-500 rounded transition cursor-pointer"
                      >
                        <X size={10} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[8px] text-slate-500 font-bold uppercase">Product *</label>
                        <SearchableDropdown
                          items={products.map(p => ({
                            id: p.id,
                            label: p.name,
                            sublabel: p.unit
                          }))}
                          selectedValue={ing.productId}
                          onChange={(value) => updateIngredient(idx, 'productId', value)}
                          placeholder="Select ingredient..."
                          searchPlaceholder="Search products..."
                          className="text-[10px]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] text-slate-500 font-bold uppercase">Qty Required *</label>
                        <input
                          type="number"
                          value={ing.quantityRequired}
                          onChange={(e) => handleNumberInput(e.target.value, (val) => updateIngredient(idx, 'quantityRequired', val), 0.001)}
                          min={0.001}
                          step={0.001}
                          className="w-full bg-app-card border border-app-border text-app-text px-2 py-1.5 rounded text-[10px] focus:outline-none focus:border-amber-500/50"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[8px] text-slate-500 font-bold uppercase">Unit</label>
                        <input
                          type="text"
                          value={ing.unit}
                          onChange={(e) => updateIngredient(idx, 'unit', e.target.value)}
                          className="w-full bg-app-card border border-app-border text-app-text px-2 py-1.5 rounded text-[10px] focus:outline-none focus:border-amber-500/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] text-slate-500 font-bold uppercase">Waste %</label>
                        <input
                          type="number"
                          value={ing.wastePercentage}
                          onChange={(e) => updateIngredient(idx, 'wastePercentage', Number(e.target.value))}
                          min={0}
                          max={100}
                          step={0.1}
                          className="w-full bg-app-card border border-app-border text-app-text px-2 py-1.5 rounded text-[10px] focus:outline-none focus:border-amber-500/50"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Submit */}
              <button
                onClick={handleCreateBom}
                disabled={isSubmitting}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 text-slate-950 font-black rounded-lg text-xs transition cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {isSubmitting ? 'Creating...' : 'Create Bill of Materials'}
              </button>
            </div>
          </motion.div>
        )}

        {/* Create Batch Form */}
        {viewMode === 'create-batch' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl mx-auto space-y-4 pb-20"
          >
            <div className="bg-app-card border border-app-border rounded-xl p-4 space-y-4">
              <h3 className="text-xs font-black text-app-text flex items-center gap-2">
                <Factory size={14} className="text-emerald-500" /> New Production Batch
              </h3>

              {/* Immediate Deduction Notice */}
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2.5">
                <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[10.5px] text-amber-400 font-medium leading-relaxed">
                  <strong className="font-bold text-amber-300">Immediate Stock Deduction:</strong> Required raw materials will be instantly deducted from inventory upon batch creation, even before production is completed.
                </p>
              </div>

              {/* Select BOM */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Bill of Materials *</label>
                <SearchableDropdown
                  items={extra.billOfMaterials.map(bom => ({
                    id: bom.id,
                    label: bom.name,
                    sublabel: `${bom.productName || 'No product'} (${bom.yieldQuantity} ${bom.yieldUnit})`
                  }))}
                  selectedValue={batchBomId}
                  onChange={(value) => {
                    const bom = extra.billOfMaterials.find(b => b.id === value);
                    setBatchBomId(value);
                    if (bom) {
                      setBatchRecipeName(bom.name);
                      setBatchUnit(bom.yieldUnit);
                      setBatchProductId(bom.productId);
                    }
                  }}
                  placeholder="Select BOM..."
                  searchPlaceholder="Search BOMs..."
                />
              </div>

              {/* Recipe Name */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Recipe / Product Name</label>
                <input
                  type="text"
                  value={batchRecipeName}
                  onChange={(e) => setBatchRecipeName(e.target.value)}
                  placeholder="Auto-filled from BOM"
                  className="w-full bg-app-bg border border-app-border text-app-text px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-amber-500/50"
                />
              </div>

              {/* Quantity & Unit */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Quantity Produced *</label>
                  <input
                    type="number"
                    value={batchQty}
                    onChange={(e) => handleNumberInput(e.target.value, setBatchQty, 0.001)}
                    min={0.001}
                    step={0.001}
                    className="w-full bg-app-bg border border-app-border text-app-text px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-amber-500/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Unit</label>
                  <input
                    type="text"
                    value={batchUnit}
                    onChange={(e) => setBatchUnit(e.target.value)}
                    className="w-full bg-app-bg border border-app-border text-app-text px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>

              {/* RAW MATERIAL AVAILABILITY CHECK TABLE */}
              {selectedBomForBatch && ingredientAvailability.length > 0 && (
                <div className="space-y-2 border-t border-app-border/60 pt-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <Beaker size={12} className="text-amber-500" /> Raw Material Inventory Pre-Check
                    </label>
                    {hasInsufficientIngredients ? (
                      <span className="text-[9px] font-black text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                        Insufficient Stock
                      </span>
                    ) : (
                      <span className="text-[9px] font-black text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                        Stock Available
                      </span>
                    )}
                  </div>

                  <div className="border border-app-border rounded-xl overflow-hidden divide-y divide-app-border/60">
                    {ingredientAvailability.map((ing, idx) => (
                      <div
                        key={idx}
                        className={`p-2.5 text-xs flex items-center justify-between gap-2 ${
                          ing.isSufficient ? 'bg-app-bg/40' : 'bg-red-500/10 border-l-4 border-l-red-500'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-bold text-app-text block truncate">{ing.productName}</span>
                          <span className="text-[9.5px] text-app-text-muted">
                            Need: <strong className="text-app-text">{ing.requiredQty} {ing.unit}</strong> · Stock: <strong className={ing.isSufficient ? 'text-emerald-400' : 'text-red-400'}>{ing.currentStock} {ing.unit}</strong>
                          </span>
                        </div>
                        <div className="shrink-0 text-right">
                          {ing.isSufficient ? (
                            <span className="text-[9px] font-black text-emerald-500 flex items-center gap-1">
                              <CheckCircle2 size={11} /> OK
                            </span>
                          ) : (
                            <span className="text-[9px] font-black text-red-500 flex items-center gap-1">
                              <AlertCircle size={11} /> Shortage (-{ing.shortage} {ing.unit})
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Initial Batch Status</label>
                <select
                  value={batchStatus}
                  onChange={(e) => setBatchStatus(e.target.value as any)}
                  className="w-full bg-app-bg border border-app-border text-app-text px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-amber-500/50"
                >
                  <option value="In Progress">In Progress (Deducts raw materials now)</option>
                  <option value="Pending">Pending (Deducts raw materials now)</option>
                  <option value="Completed">Completed (Deducts raw materials & adds finished good)</option>
                </select>
              </div>

              {/* Staff Name */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Staff / Operator</label>
                <input
                  type="text"
                  value={batchStaffName}
                  onChange={(e) => setBatchStaffName(e.target.value)}
                  placeholder={staffName}
                  className="w-full bg-app-bg border border-app-border text-app-text px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-amber-500/50"
                />
              </div>

              {/* Submit */}
              <button
                onClick={handleCreateBatch}
                disabled={isSubmitting || hasInsufficientIngredients}
                className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black rounded-lg text-xs transition cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {isSubmitting
                  ? 'Creating Batch...'
                  : hasInsufficientIngredients
                  ? 'Cannot Start: Insufficient Raw Materials'
                  : 'Start Production Batch & Deduct Inventory'}
              </button>
            </div>
          </motion.div>
        )}

        {/* BOM Detail View */}
        {viewMode === 'bom-detail' && selectedBom && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl mx-auto space-y-4"
          >
            <div className="bg-app-card border border-app-border rounded-xl p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-black text-app-text">{selectedBom.name}</h3>
                  <p className="text-[10px] text-app-text-muted mt-1">
                    {selectedBom.productName && <>Finished Good: <span className="text-amber-500 font-bold">{selectedBom.productName}</span> · </>}
                    Yield: {selectedBom.yieldQuantity} {selectedBom.yieldUnit}
                  </p>
                </div>
                <button
                  onClick={() => setViewMode('list')}
                  className="p-1.5 hover:bg-slate-800 text-slate-500 hover:text-slate-300 rounded-lg transition cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Ingredients List */}
              <div>
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Ingredients</h4>
                {selectedBom.ingredients.length === 0 ? (
                  <p className="text-[10px] text-slate-500">No ingredients defined.</p>
                ) : (
                  <div className="space-y-1.5">
                    {selectedBom.ingredients.map((ing, idx) => (
                      <div key={ing.id || idx} className="flex items-center justify-between bg-app-bg border border-app-border rounded-lg px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-bold text-app-text">{ing.productName || 'Unknown Product'}</span>
                          <span className="text-[9px] text-slate-500 ml-2">per unit of finished good</span>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <span className="text-xs font-black text-amber-500">{ing.quantityRequired} {ing.unit}</span>
                          {ing.wastePercentage > 0 && (
                            <span className="text-[9px] text-slate-500 ml-1">(+{ing.wastePercentage}% waste)</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Batch Action */}
              {canCreateBatch && (
                <button
                  onClick={() => {
                    setBatchBomId(selectedBom.id);
                    setBatchRecipeName(selectedBom.name);
                    setBatchUnit(selectedBom.yieldUnit);
                    setBatchProductId(selectedBom.productId);
                    setViewMode('create-batch');
                  }}
                  className="w-full py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-lg text-[10px] font-black hover:bg-emerald-500/20 transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <Plus size={12} /> Start Production Batch from this BOM
                </button>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* BATCH CANCELLATION & RESTOCK WORKFLOW MODAL */}
      <AnimatePresence>
        {cancellingBatch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-app-card border border-app-border rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-2xl"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-black text-app-text flex items-center gap-2">
                    <RotateCcw size={16} className="text-amber-500" /> Cancel Production Batch Workflow
                  </h3>
                  <p className="text-[10.5px] text-app-text-muted mt-0.5 font-mono">
                    Ref: {cancellingBatch.referenceNumber || cancellingBatch.id.substring(0,8).toUpperCase()} · {cancellingBatch.recipeName}
                  </p>
                </div>
                <button
                  onClick={() => setCancellingBatch(null)}
                  className="p-1 hover:bg-slate-800 text-slate-500 hover:text-slate-300 rounded-lg transition cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Prompt Question */}
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2.5">
                <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-amber-300">Do you want to return any raw materials to stock?</h4>
                  <p className="text-[10px] text-amber-400/90 mt-0.5 leading-relaxed">
                    Raw materials were deducted when this batch started. Select which ingredients to restore to stock, or write off damaged quantities.
                  </p>
                </div>
              </div>

              {/* Ingredients Restock Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Consumed Ingredients</span>
                  <button
                    onClick={() => {
                      setCancellationItems(prev => prev.map(item => ({ ...item, returnQty: item.consumedQty, isDamaged: false })));
                    }}
                    className="text-[9.5px] font-black text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    Return All Ingredients
                  </button>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {cancellationItems.map((item, idx) => (
                    <div key={idx} className="bg-app-bg border border-app-border rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-app-text">{item.productName}</span>
                        <span className="text-[10px] text-app-text-muted">
                          Consumed: <strong className="text-app-text">{item.consumedQty}</strong> · Current Stock: <strong className="text-slate-300">{item.currentStock}</strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="space-y-1">
                          <label className="text-[8px] text-slate-400 font-bold uppercase">Qty to Return to Stock</label>
                          <input
                            type="number"
                            value={item.isDamaged ? 0 : item.returnQty}
                            disabled={item.isDamaged}
                            onChange={(e) => {
                              const val = Math.min(item.consumedQty, Math.max(0, Number(e.target.value)));
                              setCancellationItems(prev => {
                                const copy = [...prev];
                                copy[idx].returnQty = val;
                                return copy;
                              });
                            }}
                            min={0}
                            max={item.consumedQty}
                            step={0.001}
                            className="w-full bg-app-card border border-app-border text-app-text px-2 py-1 rounded text-xs focus:outline-none focus:border-amber-500/50 disabled:opacity-40"
                          />
                        </div>

                        <div className="flex items-center justify-end pt-4">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none text-[10px] text-slate-400 hover:text-slate-300">
                            <input
                              type="checkbox"
                              checked={item.isDamaged}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setCancellationItems(prev => {
                                  const copy = [...prev];
                                  copy[idx].isDamaged = checked;
                                  if (checked) copy[idx].returnQty = 0;
                                  else copy[idx].returnQty = copy[idx].consumedQty;
                                  return copy;
                                });
                              }}
                              className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
                            />
                            <span>Mark as Damaged/Wasted</span>
                          </label>
                        </div>
                      </div>

                      {item.isDamaged && (
                        <div className="space-y-1 pt-1">
                          <label className="text-[8px] text-slate-400 font-bold uppercase">Damage / Waste Reason</label>
                          <input
                            type="text"
                            value={item.wasteReason}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCancellationItems(prev => {
                                const copy = [...prev];
                                copy[idx].wasteReason = val;
                                return copy;
                              });
                            }}
                            placeholder="Reason for waste (e.g. Spilled, Contaminated)"
                            className="w-full bg-app-card border border-app-border text-app-text px-2 py-1 rounded text-[10px] focus:outline-none focus:border-amber-500/50"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-app-border">
                <button
                  onClick={() => setCancellingBatch(null)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  Close
                </button>
                <button
                  onClick={handleConfirmCancellation}
                  disabled={isSubmitting}
                  className="flex-1 py-2 bg-red-500 hover:bg-red-600 disabled:bg-slate-800 text-white font-black rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-2"
                >
                  {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                  {isSubmitting ? 'Cancelling...' : 'Cancel Batch & Apply Restock'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}