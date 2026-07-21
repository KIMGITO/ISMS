// src/features/InventoryView.tsx
// Complete Re-engineered Strict Online-First Inventory & Local Log Hiding Framework

import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  Plus,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  History,
  ShieldAlert,
  CheckCircle2,
  Camera,
  Upload,
  Trash2,
  Tag,
  Pencil,
  Edit3,
  Save,
  Check,
  X,
  Eye,
  EyeOff,
  Square,
  CheckSquare,
  RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Product, AdjustmentType, ProductCategory } from '../types';
import { useForm } from '../hooks/useForm';
import { formatCurrency, formatDate } from '../utils/helpers';
import { hasRolePermission } from '../utils/permissions';
import SearchableDropdown from '../components/SearchableDropdown';
import { titleCase, searchMatch } from '../utils/stringUtils';
import UnifiedUploader from '../components/shared/UnifiedUploader';

export default function InventoryView() {
  const {
    products,
    adjustments,
    adjustStock,
    currentEmployee,
    addProduct,
    updateProduct,
    deleteProduct,
    categories,
    addCategory,
    updateCategory,
    showToast,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [adjustmentType, setAdjustmentType] =
    useState<AdjustmentType>('Restock');
  const [adjustQty, setAdjustQty] = useState<number>(10);
  const [reason, setReason] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingProduct, setIsDeletingProduct] = useState(false);
  const [isAdjustingStock, setIsAdjustingStock] = useState(false);

  // ── LOCAL-ONLY LOG VISIBILITY STATES ──
  const [hiddenLogIds, setHiddenLogIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('kkm_hidden_inventory_logs');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);

  // Product editing form state
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isEditingProduct, setIsEditingProduct] = useState(false);
  const [editProductImage, setEditProductImage] = useState('');
  const [isEditingUploadingPic, setIsEditingUploadingPic] = useState(false);
  const [editValues, setEditValues] = useState({
    name: '',
    sku: '',
    category: '',
    price: 0,
    cost: 0,
    unit: '',
    stock: 0,
    minStock: 0,
    description: '',
    perishable: false,
    expiryDays: 7,
  });
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // Dynamic category management state
  const [isManagingCategories, setIsManagingCategories] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryName, setEditingCategoryName] = useState<string | null>(
    null,
  );
  const [editingCategoryValue, setEditingCategoryValue] = useState('');

  // New product form handling using the custom useForm hook
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [productImage, setProductImage] = useState(
    'https://images.unsplash.com/photo-1561715276-a2d087060f1d?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NHx8c2hvcHBpbmclMjBiYWd8ZW58MHx8MHx8fDA%3D',
  );
  const [isUploadingPic, setIsUploadingPic] = useState(false);

  // Centralized permission validations
  const canCreateProduct = currentEmployee
    ? hasRolePermission(currentEmployee.role, 'products.create')
    : false;
  const canDeleteProduct = currentEmployee
    ? hasRolePermission(currentEmployee.role, 'products.delete')
    : false;
  const canAdjustStock = currentEmployee
    ? hasRolePermission(currentEmployee.role, 'inventory.adjust_stock')
    : false;
  const canViewHistory = currentEmployee
    ? hasRolePermission(currentEmployee.role, 'inventory.stock_history')
    : false;
  const canManageCategories = currentEmployee
    ? hasRolePermission(currentEmployee.role, 'products.manage_categories')
    : false;
  const canEditProduct = currentEmployee
    ? hasRolePermission(currentEmployee.role, 'products.update')
    : false;

  // Persist local hidden visibility metrics
  useEffect(() => {
    localStorage.setItem(
      'kkm_hidden_inventory_logs',
      JSON.stringify(hiddenLogIds),
    );
  }, [hiddenLogIds]);

  // Safe Store Array Guards
  const safeProducts = useMemo(
    () => (Array.isArray(products) ? products : []),
    [products],
  );
  const safeAdjustments = useMemo(
    () => (Array.isArray(adjustments) ? adjustments : []),
    [adjustments],
  );
  const safeCategories = useMemo(
    () => (Array.isArray(categories) ? categories : []),
    [categories],
  );

  const filteredProducts = useMemo(() => {
    return safeProducts.filter(
      (p) =>
        searchMatch(p.name, searchQuery) || searchMatch(p.sku, searchQuery),
    );
  }, [safeProducts, searchQuery]);

  const visibleAdjustments = useMemo(() => {
    return safeAdjustments.filter((adj) => !hiddenLogIds.includes(adj.id));
  }, [safeAdjustments, hiddenLogIds]);

  const {
    values,
    errors,
    handleChange,
    handleCustomChange,
    handleSubmit,
    isSubmitting,
    resetForm,
    setValues,
  } = useForm({
    initialValues: {
      name: '',
      sku: '',
      category: 'Milk' as ProductCategory,
      price: 100,
      cost: 50,
      unit: 'Litre',
      stock: 20,
      minStock: 10,
      description: '',
      perishable: false,
      expiryDays: 7,
    },
    validate: (vals) => {
      const errs: Record<string, string> = {};
      if (!vals.name.trim()) errs.name = 'Product name is required.';
      if (!vals.sku.trim()) errs.sku = 'SKU is required.';
      if (vals.price <= 0) errs.price = 'Selling price must be > 0.';
      if (vals.cost < 0) errs.cost = 'Cost must be >= 0.';
      if (vals.stock < 0) errs.stock = 'Initial stock must be >= 0.';
      if (vals.minStock < 1) errs.minStock = 'Min stock must be >= 1.';
      if (vals.perishable && (!vals.expiryDays || vals.expiryDays < 1)) {
        errs.expiryDays = 'Shelf life must be at least 1 day.';
      }
      return errs;
    },
    onSubmit: async (vals) => {
      try {
        await addProduct({
          id: `prod-${Date.now()}`,
          name: vals.name,
          sku: vals.sku,
          category: vals.category,
          price: vals.price,
          cost: vals.cost,
          unit: vals.unit,
          stock: vals.stock,
          minStock: vals.minStock,
          image: productImage,
          description: vals.description || undefined,
          perishable: vals.perishable || undefined,
          expiryDays: vals.perishable ? vals.expiryDays : undefined,
        });
        setIsAddingProduct(false);
        setSuccessMsg(true);
        setTimeout(() => setSuccessMsg(false), 2000);
        showToast(
          'Product Added',
          `"${vals.name}" successfully created in database.`,
          undefined,
          'success',
        );
      } catch (err: any) {
        showToast(
          'Database Error',
          `Failed to add product: ${err.message}`,
          undefined,
          'error',
        );
      }
    },
  });

  const validateEditForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!editValues.name.trim()) errs.name = 'Product name is required.';
    if (!editValues.sku.trim()) errs.sku = 'SKU is required.';
    if (editValues.price <= 0) errs.price = 'Selling price must be > 0.';
    if (editValues.cost < 0) errs.cost = 'Cost must be >= 0.';
    if (editValues.stock < 0) errs.stock = 'Stock must be >= 0.';
    if (editValues.minStock < 1) errs.minStock = 'Min stock must be >= 1.';
    if (
      editValues.perishable &&
      (!editValues.expiryDays || editValues.expiryDays < 1)
    ) {
      errs.expiryDays = 'Shelf life must be at least 1 day.';
    }
    setEditErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSaveProductEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || isSavingEdit) return;
    if (!validateEditForm()) {
      showToast(
        'Validation Error',
        'Please correct editing configuration errors.',
        undefined,
        'error',
      );
      return;
    }
    setIsSavingEdit(true);
    try {
      await updateProduct({
        ...editingProduct,
        name: editValues.name,
        sku: editValues.sku,
        category: editValues.category as any,
        price: editValues.price,
        cost: editValues.cost,
        unit: editValues.unit,
        stock: editValues.stock,
        minStock: editValues.minStock,
        image: editProductImage,
        description: editValues.description || undefined,
        perishable: editValues.perishable,
        expiryDays: editValues.perishable ? editValues.expiryDays : undefined,
      });
      setIsEditingProduct(false);
      setSuccessMsg(true);
      setTimeout(() => setSuccessMsg(false), 2000);
      showToast(
        'Product Updated',
        `"${editValues.name}" catalog config updated successfully.`,
        undefined,
        'success',
      );
    } catch (err: any) {
      showToast(
        'Update Error',
        `Failed to save catalog edit: ${err.message}`,
        undefined,
        'error',
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleAdjustStock = async () => {
    if (!selectedProduct || isAdjustingStock) return;

    if (adjustQty <= 0) {
      alert('Adjustment quantity must be greater than zero.');
      return;
    }

    const sign = adjustmentType === 'Damage' ? -1 : 1;
    const finalStockValue = selectedProduct.stock + adjustQty * sign;

    if (
      adjustmentType === 'Damage' &&
      finalStockValue > selectedProduct.stock
    ) {
      alert('For damage logs, final stock must be less than initial stock.');
      return;
    }
    if (
      adjustmentType === 'Restock' &&
      finalStockValue < selectedProduct.stock
    ) {
      alert(
        'For restock logs, final stock must be greater than initial stock.',
      );
      return;
    }

    setIsAdjustingStock(true);
    try {
      await adjustStock(
        selectedProduct.id,
        adjustQty * sign,
        adjustmentType,
        reason || `${adjustmentType} logged by staff`,
      );
      setSuccessMsg(true);
      setIsAdjusting(false);
      setReason('');
      setAdjustQty(10);
      setTimeout(() => setSuccessMsg(false), 2000);
      showToast(
        'Stock Adjusted',
        `Stock for "${selectedProduct.name}" successfully adjusted in database.`,
        undefined,
        'success',
      );
    } catch (err: any) {
      showToast(
        'Database Error',
        `Failed to adjust stock: ${err.message}`,
        undefined,
        'error',
      );
    } finally {
      setIsAdjustingStock(false);
    }
  };

  // ── LOCAL HIDING VISIBILITY LOGIC METHODS ──
  const handleToggleSelectLog = (id: string) => {
    setSelectedLogIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const handleSelectAllVisibleLogs = () => {
    if (selectedLogIds.length === visibleAdjustments.length) {
      setSelectedLogIds([]);
    } else {
      setSelectedLogIds(visibleAdjustments.map((a) => a.id));
    }
  };

  const handleHideSelectedLogs = () => {
    if (selectedLogIds.length === 0) return;
    setHiddenLogIds((prev) => [...prev, ...selectedLogIds]);
    setSelectedLogIds([]);
    showToast(
      'Logs Cleared Locally',
      `${selectedLogIds.length} adjustments hidden on this view workspace.`,
      undefined,
      'info',
    );
  };

  const handleRestoreAllLogs = () => {
    setHiddenLogIds([]);
    setSelectedLogIds([]);
    showToast(
      'Logs Restored',
      'All hidden discrepancy logs are now visible.',
      undefined,
      'success',
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg text-app-text relative overflow-hidden font-sans">
      {/* SEARCH & ACTIONS RESPONSIVE WRAPPING HEADER */}
      <div className="bg-app-card border-b border-app-border p-3 shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shadow-xs">
        <input
          type="text"
          placeholder="Search inventory items or SKUs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-app-bg text-xs px-4 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-app-text transition"
        />

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {canManageCategories && (
            <button
              onClick={() => {
                setNewCategoryName('');
                setEditingCategoryName(null);
                setIsManagingCategories(true);
              }}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-app-card hover:bg-app-bg text-amber-500 font-extrabold rounded-xl text-xs border border-app-border transition flex items-center justify-center gap-1.5 shadow-xs shrink-0 cursor-pointer"
              title="Manage Product Categories"
            >
              <Tag size={13} />
              <span>Categories</span>
            </button>
          )}
          {canCreateProduct && (
            <button
              onClick={() => {
                resetForm();
                setProductImage(
                  'https://images.unsplash.com/photo-1561715276-a2d087060f1d?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NHx8c2hvcHBpbmclMjBiYWd8ZW58MHx8MHx8fDA%3D',
                );
                handleCustomChange(
                  'sku',
                  `KK-MILK-${Math.floor(100 + Math.random() * 900)}`,
                );
                setIsAddingProduct(true);
              }}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-amber-500 text-slate-950 font-black rounded-xl text-xs hover:bg-amber-600 transition flex items-center justify-center gap-1 shadow-sm shrink-0 cursor-pointer"
            >
              <Plus size={14} />
              <span>Add Product</span>
            </button>
          )}
        </div>
      </div>

      {/* SCROLLABLE MAIN DATA CONTAINER */}
      <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-5 pb-24">
        {/* CURRENT STOCK LIST SECTION */}
        <div className="flex flex-col gap-2.5">
          <h2 className="text-[10px] font-black text-app-text-muted uppercase tracking-wider px-1">
            Current Stock Levels
          </h2>
          {filteredProducts.map((p) => {
            const isLow = p.stock <= p.minStock;
            const percentage = Math.min(100, (p.stock / 100) * 100);

            return (
              <div
                key={p.id}
                className="bg-app-card rounded-2xl border border-app-border p-3.5 flex items-center justify-between gap-4 shadow-xs"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-mono font-bold text-app-text-muted">
                      {p.sku}
                    </span>
                    <span className="text-[8.5px] px-1.5 py-0.5 bg-app-bg rounded-md font-bold text-app-text border border-app-border truncate max-w-[120px]">
                      {titleCase(p.category)}
                    </span>
                    <span
                      className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0 ${
                        (p as any).sync_status === 'synced'
                          ? 'bg-emerald-500/15 text-emerald-500'
                          : 'bg-amber-500/15 text-amber-500 '
                      }`}
                    >
                      <span className="w-1 h-1 rounded-full bg-current" />
                      <span>
                        {(p as any).sync_status === 'synced'
                          ? 'Synced'
                          : 'Offline'}
                      </span>
                    </span>
                  </div>
                  <h3 className="text-xs font-bold font-display text-app-text mt-1 truncate">
                    {titleCase(p.name)}
                  </h3>
                  <span className="text-[10px] text-app-text-muted mt-0.5 block">
                    Unit size: {titleCase(p.unit)}
                  </span>

                  <div className="w-full h-1.5 bg-app-bg border border-app-border rounded-full mt-2.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        p.stock === 0
                          ? 'bg-red-500'
                          : isLow
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-col items-end shrink-0 gap-1.5">
                  <div className="text-right">
                    <span
                      className={`text-sm font-black ${
                        isLow ? 'text-amber-500' : 'text-app-text'
                      }`}
                    >
                      {p.stock}
                    </span>
                    <span className="text-[10px] text-app-text-muted font-medium">
                      {' '}
                      / {p.minStock} min
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {canEditProduct && (
                      <button
                        onClick={() => {
                          setEditingProduct(p);
                          setEditValues({
                            name: p.name,
                            sku: p.sku,
                            category: p.category,
                            price: p.price,
                            cost: p.cost,
                            unit: p.unit,
                            stock: p.stock,
                            minStock: p.minStock,
                            description: p.description || '',
                            perishable: !!p.perishable,
                            expiryDays: p.expiryDays || 7,
                          });
                          setEditProductImage(p.image || 'https://images.unsplash.com/photo-1561715276-a2d087060f1d?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NHx8c2hvcHBpbmclMjBiYWd8ZW58MHx8MHx8fDA%3D');
                          setEditErrors({});
                          setIsEditingProduct(true);
                        }}
                        className="p-1.5 hover:bg-amber-500/10 text-slate-400 hover:text-amber-500 border border-transparent hover:border-amber-500/20 rounded-lg transition shrink-0 cursor-pointer"
                        title="Edit Product Details"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    {canDeleteProduct && (
                      <button
                        disabled={isDeletingProduct}
                        onClick={async () => {
                          if (
                            confirm(
                              `Are you sure you want to delete "${p.name}"?`,
                            )
                          ) {
                            setIsDeletingProduct(true);
                            try {
                              await deleteProduct(p.id);
                              showToast(
                                'Product Deleted',
                                `"${p.name}" successfully deleted.`,
                                undefined,
                                'success',
                              );
                            } catch (err: any) {
                              showToast(
                                'Database Error',
                                'Failed to delete item records.',
                                undefined,
                                'error',
                              );
                            } finally {
                              setIsDeletingProduct(false);
                            }
                          }
                        }}
                        className="p-1.5 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed text-slate-400 hover:text-red-500 border border-transparent hover:border-red-500/20 rounded-lg transition shrink-0 cursor-pointer"
                        title="Delete Product"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    {canAdjustStock && (
                      <button
                        onClick={() => {
                          setSelectedProduct(p);
                          setIsAdjusting(true);
                        }}
                        className="px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/25 rounded-lg text-[10px] font-black transition flex items-center gap-1 cursor-pointer"
                      >
                        <span>Adjust</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* AUDIT LOG PIPELINE WITH SELECTIVE HIDING CONTROLS */}
        {canViewHistory && (
          <div className="flex flex-col gap-2.5 mt-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-app-border/60 pb-2 px-1">
              <h2 className="text-[10px] font-black text-app-text-muted uppercase tracking-wider flex items-center gap-1.5">
                <History size={13} className="text-amber-500" />
                <span>
                  Audit & Adjustment Logs ({visibleAdjustments.length})
                </span>
              </h2>

              <div className="flex items-center gap-2 self-end">
                {hiddenLogIds.length > 0 && (
                  <button
                    onClick={handleRestoreAllLogs}
                    className="px-2 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-500 text-[9px] font-black uppercase rounded-lg transition flex items-center gap-1 cursor-pointer"
                  >
                    <Eye size={10} /> Restore ({hiddenLogIds.length})
                  </button>
                )}
                {visibleAdjustments.length > 0 && (
                  <button
                    onClick={handleHideSelectedLogs}
                    disabled={selectedLogIds.length === 0}
                    className="px-2 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 text-[9px] font-black uppercase rounded-lg transition disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                  >
                    <EyeOff size={10} /> Hide Selected
                  </button>
                )}
              </div>
            </div>

            {visibleAdjustments.length === 0 ? (
              <div className="p-8 bg-app-card rounded-2xl border border-dashed border-app-border text-center text-xs text-app-text-muted font-medium">
                No active audit or restock logs to display.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 p-1.5 bg-app-card/60 border border-app-border rounded-xl px-3 text-[10px] text-app-text-muted font-bold">
                  <button
                    type="button"
                    onClick={handleSelectAllVisibleLogs}
                    className="text-app-text hover:text-amber-500 transition cursor-pointer"
                  >
                    {selectedLogIds.length === visibleAdjustments.length ? (
                      <CheckSquare size={13} className="text-amber-500" />
                    ) : (
                      <Square size={13} />
                    )}
                  </button>
                  <span>Select All Logs To Clear Locally</span>
                </div>

                {visibleAdjustments.map((adj) => {
                  const isPositive = adj.quantityAdjusted > 0;
                  const isChecked = selectedLogIds.includes(adj.id);
                  return (
                    <div
                      key={adj.id}
                      className="bg-app-card rounded-2xl border border-app-border p-3 text-xs flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => handleToggleSelectLog(adj.id)}
                          className="text-app-text-muted hover:text-amber-500 transition shrink-0 cursor-pointer"
                        >
                          {isChecked ? (
                            <CheckSquare size={13} className="text-amber-500" />
                          ) : (
                            <Square size={13} />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-app-text truncate">
                              {adj.productName}
                            </span>
                            {adj.type && (
                              <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase ${
                                adj.type === 'Production Consumption' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' :
                                adj.type === 'Production Output' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                                adj.type === 'Production Reversal' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                                adj.type === 'Production Waste' ? 'bg-purple-500/10 text-purple-500 border border-purple-500/20' :
                                adj.type === 'Restock' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                                'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                              }`}>
                                {adj.type}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-app-text-muted mt-0.5 truncate font-medium">
                            {adj.reason} · By {adj.staffName} {adj.referenceNumber ? `(Ref: ${adj.referenceNumber})` : ''}
                          </p>
                          <span className="text-[9px] font-mono text-app-text-muted block mt-0.5">
                            {new Date(adj.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10.5px] font-mono text-app-text-muted text-right">
                          {adj.previousStock} → {adj.newStock}
                        </span>
                        <div
                          className={`px-2 py-1 rounded font-bold flex items-center gap-0.5 text-[10px] ${
                            isPositive
                              ? 'bg-emerald-500/10 text-emerald-500'
                              : 'bg-red-500/10 text-red-500'
                          }`}
                        >
                          {isPositive ? (
                            <ArrowUpRight size={10} />
                          ) : (
                            <ArrowDownRight size={10} />
                          )}
                          <span>
                            {isPositive
                              ? `+${adj.quantityAdjusted}`
                              : adj.quantityAdjusted}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ADJUST STOCK DRAWER */}
      <AnimatePresence>
        {isAdjusting && selectedProduct && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdjusting(false)}
              className="absolute inset-0 bg-black z-40"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 max-h-[85%] bg-app-card rounded-t-[32px] border-t border-app-border shadow-2xl p-5 flex flex-col z-50 overflow-hidden"
            >
              <div className="w-12 h-1 bg-app-border rounded-full mx-auto mb-4 shrink-0" />
              <h3 className="text-base font-extrabold font-display text-app-text uppercase tracking-wide">
                Manual Stock Adjustment
              </h3>
              <p className="text-[10px] text-app-text-muted font-bold uppercase mt-0.5 tracking-wider">
                ITEM: {selectedProduct.name} ({selectedProduct.sku})
              </p>
              <div className="h-[1px] bg-app-border my-3 shrink-0" />

              <div className="flex-1 overflow-y-auto flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9.5px] font-black text-app-text-muted uppercase">
                    Adjustment Type
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-app-bg p-1 rounded-xl border border-app-border">
                    <button
                      onClick={() => setAdjustmentType('Restock')}
                      className={`py-2 rounded-lg text-xs font-bold uppercase transition flex items-center justify-center gap-1 cursor-pointer ${
                        adjustmentType === 'Restock'
                          ? 'bg-amber-500 text-slate-950 shadow'
                          : 'text-app-text-muted'
                      }`}
                    >
                      <Plus size={12} />
                      <span>Restock (+)</span>
                    </button>
                    <button
                      onClick={() => setAdjustmentType('Damage')}
                      className={`py-2 rounded-lg text-xs font-bold uppercase transition flex items-center justify-center gap-1 cursor-pointer ${
                        adjustmentType === 'Damage'
                          ? 'bg-red-500 text-white shadow'
                          : 'text-app-text-muted'
                      }`}
                    >
                      <Minus size={12} />
                      <span>Damage (-)</span>
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9.5px] font-black text-app-text-muted uppercase">
                    Quantity to Adjust
                  </label>
                  <div className="flex items-center justify-between bg-app-bg rounded-2xl p-2 border border-app-border">
                    <button
                      type="button"
                      onClick={() =>
                        setAdjustQty(
                          Math.max(
                            0.5,
                            Math.round((adjustQty - 0.5) * 10) / 10,
                          ),
                        )
                      }
                      className="w-10 h-10 bg-app-card border border-app-border rounded-xl flex items-center justify-center font-bold text-app-text shadow-xs cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      step="any"
                      value={adjustQty === 0 ? '' : adjustQty}
                      placeholder="0.0"
                      onChange={(e) => {
                        const val = e.target.value;
                        setAdjustQty(val === '' ? 0 : parseFloat(val) || 0);
                      }}
                      onBlur={() => {
                        if (adjustQty <= 0) setAdjustQty(0.5);
                      }}
                      className="text-center font-black text-lg text-app-text w-24 bg-transparent outline-none border-none focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setAdjustQty(Math.round((adjustQty + 0.5) * 10) / 10)
                      }
                      className="w-10 h-10 bg-app-card border border-app-border rounded-xl flex items-center justify-center font-bold text-app-text shadow-xs cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="bg-app-bg p-3 border border-app-border rounded-xl flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between">
                    <span>Initial Stock:</span>
                    <span className="font-bold">
                      {selectedProduct.stock} {selectedProduct.unit}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Adjustment:</span>
                    <span
                      className={`font-bold ${
                        adjustmentType === 'Damage'
                          ? 'text-red-500'
                          : 'text-emerald-500'
                      }`}
                    >
                      {adjustmentType === 'Damage' ? '-' : '+'}
                      {adjustQty}
                    </span>
                  </div>
                  <div className="h-[1px] bg-app-border/40 my-0.5" />
                  <div className="flex justify-between font-bold">
                    <span>Final Stock Preview:</span>
                    <span className="text-emerald-500">
                      {adjustmentType === 'Damage'
                        ? Math.max(0, selectedProduct.stock - adjustQty)
                        : selectedProduct.stock + adjustQty}{' '}
                      {selectedProduct.unit}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9.5px] font-black text-app-text-muted uppercase">
                    Audit Note / Reason
                  </label>
                  <input
                    type="text"
                    placeholder="Audit contexts descriptor notes..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="bg-app-bg border border-app-border rounded-xl px-3 py-2.5 text-xs text-app-text focus:outline-none"
                  />
                </div>
              </div>
              <div className="pt-4 border-t border-app-border flex gap-3 mt-4 shrink-0">
                <button
                  onClick={() => setIsAdjusting(false)}
                  className="px-4 py-2.5 border border-app-border rounded-xl text-xs font-bold text-app-text hover:bg-app-bg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdjustStock}
                  disabled={isAdjustingStock}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black rounded-xl text-xs flex items-center justify-center gap-1.5 shadow cursor-pointer"
                >
                  {isAdjustingStock ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Adjusting...</span>
                    </>
                  ) : (
                    "Log Stock Adjustment"
                  )}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ADD PRODUCT DRAWER OVERLAY */}
      <AnimatePresence>
        {isAddingProduct && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingProduct(false)}
              className="absolute inset-0 bg-black/50 z-40"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 h-[92%] bg-app-card rounded-t-[32px] border-t border-app-border shadow-2xl p-5 flex flex-col z-50 overflow-hidden"
            >
              <div className="w-12 h-1 bg-app-border rounded-full mx-auto mb-4 shrink-0" />
              <div className="flex items-center justify-between shrink-0 mb-2">
                <div>
                  <h3 className="text-sm font-black font-display text-app-text uppercase tracking-wide">
                    Add New Product
                  </h3>
                  <p className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                    Catalog Entry Management (KSh KES)
                  </p>
                </div>
                <button
                  onClick={() => setIsAddingProduct(false)}
                  className="px-3 py-1 bg-app-bg border border-app-border text-app-text font-bold rounded-lg text-xs cursor-pointer"
                >
                  Close
                </button>
              </div>
              <div className="h-[1px] bg-app-border mb-3 shrink-0" />

              <form
                onSubmit={handleSubmit}
                className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3.5 pb-24 text-xs font-medium"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Product Name *
                    </label>
                    <input
                      type="text"
                      name="name"
                      placeholder="Organic Whole Milk"
                      value={values.name}
                      onChange={handleChange}
                      className={`bg-app-bg border ${
                        errors.name ? 'border-red-500' : 'border-app-border'
                      } rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500`}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      SKU Code *
                    </label>
                    <input
                      type="text"
                      name="sku"
                      placeholder="KK-MILK-105"
                      value={values.sku}
                      onChange={handleChange}
                      className={`bg-app-bg border ${
                        errors.sku ? 'border-red-500' : 'border-app-border'
                      } rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500`}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Category
                    </label>
                    <SearchableDropdown
                      source={safeCategories}
                      items={safeCategories.map((c) => ({ id: c, label: c }))}
                      selectedValue={values.category}
                      onChange={(val) =>
                        handleChange({
                          target: { name: 'category', value: val },
                        } as any)
                      }
                      placeholder="Select category..."
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Unit size *
                    </label>
                    <input
                      type="text"
                      name="unit"
                      placeholder="1 Litre Pack"
                      value={values.unit}
                      onChange={handleChange}
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Price (KSh) *
                    </label>
                    <input
                      type="number"
                      name="price"
                      value={values.price === 0 ? '' : values.price}
                      onChange={handleChange}
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Cost (KSh) *
                    </label>
                    <input
                      type="number"
                      name="cost"
                      value={values.cost === 0 ? '' : values.cost}
                      onChange={handleChange}
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Initial Stock Level *
                    </label>
                    <input
                      type="number"
                      name="stock"
                      value={values.stock === 0 ? '' : values.stock}
                      onChange={handleChange}
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Min Safety Alert *
                    </label>
                    <input
                      type="number"
                      name="minStock"
                      value={values.minStock === 0 ? '' : values.minStock}
                      onChange={handleChange}
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-3 mt-2">
                    {/* The Custom Switch Container */}
                    <div
                      onClick={() =>
                        setValues({ ...values, perishable: !values.perishable })
                      }
                      className={`
      relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent 
      transition-colors duration-200 ease-in-out focus:outline-none
      ${values.perishable ? 'bg-amber-500' : 'bg-app-border/40'}
    `}
                    >
                      <span
                        className={`
          pointer-events-none inline-block h-4 w-4 transform rounded-full bg-app-bg shadow ring-0 
          transition duration-200 ease-in-out
          ${values.perishable ? 'translate-x-4' : 'translate-x-0'}
        `}
                      />
                    </div>

                    {/* Interactive Label */}
                    <label
                      className="text-[10px] font-bold text-app-text-muted uppercase cursor-pointer select-none"
                      onClick={() =>
                        setValues({ ...values, perishable: !values.perishable })
                      }
                    >
                      Perishable Product
                    </label>
                  </div>
                  {values.perishable && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-app-text-muted uppercase">
                        Shelf Life (Days) *
                      </label>
                      <input
                        type="number"
                        name="expiryDays"
                        value={values.expiryDays === 0 ? '' : values.expiryDays}
                        onChange={handleChange}
                        className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">
                    Description / Notes
                  </label>
                  <textarea
                    name="description"
                    rows={2}
                    placeholder="Describe catalog specifications..."
                    value={values.description}
                    onChange={handleChange}
                    className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none resize-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">
                    Product Image
                  </label>
                  <div className="flex items-center gap-3 bg-app-bg border border-app-border rounded-xl p-2">
                    <img
                      src={productImage}
                      alt="Product Preview"
                      className="w-12 h-12 rounded-lg object-cover border border-app-border"
                    />
                    <UnifiedUploader
                      allowedTypes={["image"]}
                      buttonText="Upload Image"
                      onUploadSuccess={(url) => setProductImage(url)}
                      bucketName="product-images"
                    />
                  </div>
                </div>
              </form>

              <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-app-border bg-app-card flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAddingProduct(false)}
                  className="px-4 py-2.5 border border-app-border rounded-xl text-xs font-bold text-app-text hover:bg-app-bg transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSubmit}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black rounded-xl text-xs flex items-center justify-center gap-1 shadow cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Adding to Catalog...</span>
                    </>
                  ) : (
                    <>
                      <Plus size={13} />
                      <span>Add Product to Catalog</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* CATEGORY DRAWER COMPONENT MAP */}
      <AnimatePresence>
        {isManagingCategories && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsManagingCategories(false)}
              className="absolute inset-0 bg-black/50 z-40"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 h-[85%] bg-app-card rounded-t-[32px] border-t border-app-border shadow-2xl p-5 flex flex-col z-50 overflow-hidden"
            >
              <div className="w-12 h-1 bg-app-border rounded-full mx-auto mb-4 shrink-0" />
              <div className="flex items-center justify-between shrink-0 mb-2">
                <div>
                  <h3 className="text-sm font-black font-display text-app-text uppercase tracking-wide">
                    Manage Categories
                  </h3>
                </div>
                <button
                  onClick={() => setIsManagingCategories(false)}
                  className="px-3 py-1 bg-app-bg border border-app-border text-app-text font-bold rounded-lg text-xs"
                >
                  Close
                </button>
              </div>
              <div className="h-[1px] bg-app-border mb-4 shrink-0" />
              <div className="flex gap-2 mb-4 shrink-0">
                <input
                  type="text"
                  placeholder="Type new category..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="flex-1 bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none"
                />
                <button
                  onClick={() => {
                    if (!newCategoryName.trim()) return;
                    addCategory(newCategoryName.trim());
                    setNewCategoryName('');
                  }}
                  className="px-4 py-2 bg-amber-500 text-slate-950 font-black rounded-xl text-xs hover:bg-amber-600 transition"
                >
                  Create
                </button>
              </div>
              <div className="flex-1 overflow-y-auto flex flex-col gap-2 pb-16">
                {safeCategories.map((cat) => (
                  <div
                    key={cat}
                    className="bg-app-bg border border-app-border rounded-xl p-2.5 flex items-center justify-between text-xs font-bold text-app-text"
                  >
                    <span>{cat}</span>
                    <button
                      onClick={() => {
                        const val = prompt('Rename category:', cat);
                        if (val?.trim()) updateCategory(cat, val.trim());
                      }}
                      className="p-1.5 text-slate-400 hover:text-amber-500"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* EDIT DETAILED PRODUCT DRAWER OVERLAY */}
      <AnimatePresence>
        {isEditingProduct && editingProduct && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditingProduct(false)}
              className="absolute inset-0 bg-black/50 z-40"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 h-[92%] bg-app-card rounded-t-[32px] border-t border-app-border shadow-2xl p-5 flex flex-col z-50 overflow-hidden"
            >
              <div className="w-12 h-1 bg-app-border rounded-full mx-auto mb-4 shrink-0" />
              <div className="flex items-center justify-between shrink-0 mb-2">
                <div>
                  <h3 className="text-sm font-black font-display text-app-text uppercase tracking-wide">
                    Edit Product Details
                  </h3>
                </div>
                <button
                  onClick={() => setIsEditingProduct(false)}
                  className="px-3 py-1 bg-app-bg border border-app-border text-app-text font-bold rounded-lg text-xs"
                >
                  Close
                </button>
              </div>
              <div className="h-[1px] bg-app-border mb-3 shrink-0" />

              <form
                onSubmit={handleSaveProductEdit}
                className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3.5 pb-24 text-xs font-medium"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Product Name *
                    </label>
                    <input
                      type="text"
                      value={editValues.name}
                      onChange={(e) =>
                        setEditValues({ ...editValues, name: e.target.value })
                      }
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      SKU Code *
                    </label>
                    <input
                      type="text"
                      value={editValues.sku}
                      onChange={(e) =>
                        setEditValues({ ...editValues, sku: e.target.value })
                      }
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Category
                    </label>
                    <SearchableDropdown
                      source={safeCategories}
                      items={safeCategories.map((c) => ({ id: c, label: c }))}
                      selectedValue={editValues.category}
                      onChange={(val) =>
                        setEditValues({ ...editValues, category: val })
                      }
                      placeholder="Select category..."
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Unit *
                    </label>
                    <input
                      type="text"
                      value={editValues.unit}
                      onChange={(e) =>
                        setEditValues({ ...editValues, unit: e.target.value })
                      }
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Price (KSh) *
                    </label>
                    <input
                      type="number"
                      value={editValues.price === 0 ? '' : editValues.price}
                      onChange={(e) =>
                        setEditValues({
                          ...editValues,
                          price: Number(e.target.value),
                        })
                      }
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Cost (KSh) *
                    </label>
                    <input
                      type="number"
                      value={editValues.cost === 0 ? '' : editValues.cost}
                      onChange={(e) =>
                        setEditValues({
                          ...editValues,
                          cost: Number(e.target.value),
                        })
                      }
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Current Stock Level *
                    </label>
                    <input
                      type="number"
                      value={editValues.stock === 0 ? '' : editValues.stock}
                      onChange={(e) =>
                        setEditValues({
                          ...editValues,
                          stock: Number(e.target.value),
                        })
                      }
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-app-text-muted uppercase">
                      Min Safety Alert *
                    </label>
                    <input
                      type="number"
                      value={
                        editValues.minStock === 0 ? '' : editValues.minStock
                      }
                      onChange={(e) =>
                        setEditValues({
                          ...editValues,
                          minStock: Number(e.target.value),
                        })
                      }
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
  <div className="flex items-center gap-3 mt-2">
    {/* The Custom Switch Container */}
    <div
      onClick={() =>
        setEditValues({ ...editValues, perishable: !editValues.perishable })
      }
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent 
        transition-colors duration-200 ease-in-out focus:outline-none
        ${editValues.perishable ? 'bg-amber-500' : 'bg-app-border/40'}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-4 w-4 transform rounded-full bg-app-bg shadow ring-0 
          transition duration-200 ease-in-out
          ${editValues.perishable ? 'translate-x-4' : 'translate-x-0'}
        `}
      />
    </div>

    {/* Interactive Label */}
    <label
      className="text-[10px] font-bold text-app-text-muted uppercase cursor-pointer select-none"
      onClick={() =>
        setEditValues({ ...editValues, perishable: !editValues.perishable })
      }
    >
      Perishable Product
    </label>
  </div>
  
  {editValues.perishable && (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-app-text-muted uppercase">
        Shelf Life (Days) *
      </label>
      <input
        type="number"
        name="edit-expiryDays"
        value={
          editValues.expiryDays === 0
            ? ''
            : editValues.expiryDays
        }
        onChange={(e) =>
          setEditValues({
            ...editValues,
            expiryDays: Number(e.target.value),
          })
        }
        className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none focus:border-amber-500"
      />
    </div>
  )}
</div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">
                    Description / Notes
                  </label>
                  <textarea
                    value={editValues.description}
                    onChange={(e) =>
                      setEditValues({
                        ...editValues,
                        description: e.target.value,
                      })
                    }
                    rows={2}
                    placeholder="Describe catalog specifications..."
                    className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text focus:outline-none resize-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-app-text-muted uppercase">
                    Product Image
                  </label>
                  <div className="flex items-center gap-3 bg-app-bg border border-app-border rounded-xl p-2">
                    <img
                      src={editProductImage}
                      alt="Product Preview"
                      className="w-12 h-12 rounded-lg object-cover border border-app-border"
                    />
                    <UnifiedUploader
                      allowedTypes={["image"]}
                      buttonText="Change Image"
                      onUploadSuccess={(url) => setEditProductImage(url)}
                      bucketName="product-images"
                    />
                  </div>
                </div>
              </form>

              <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-app-border bg-app-card flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsEditingProduct(false)}
                  className="px-4 py-2.5 border border-app-border rounded-xl text-xs font-bold text-app-text hover:bg-app-bg transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingEdit}
                  onClick={handleSaveProductEdit}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black rounded-xl text-xs flex items-center justify-center gap-1 shadow cursor-pointer"
                >
                  {isSavingEdit ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save size={13} />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* FIXED TOAST BANNER SUCCESS POPUP */}
      <AnimatePresence>
        {successMsg && (
          <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 bg-emerald-500 text-white px-4 py-2 rounded-full flex items-center gap-1.5 shadow-lg z-50 text-xs font-bold">
            <CheckCircle2 size={14} />
            <span>Success: Catalog configuration synced!</span>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
