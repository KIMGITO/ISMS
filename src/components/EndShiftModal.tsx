import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Send, Check } from 'lucide-react';
import { useInventoryStore } from '../stores/inventoryStore';
import { useTransactionStore } from '../stores/transactionStore';
import { useCustomerStore } from '../stores/customerStore';
import { useAuthStore } from '../stores/authStore';
import { useAppStore } from '../stores/appStore';
import { useExtraModulesStore, ProductionBatch } from '../stores/extraModulesStore';
import { Shift, Transaction, BillOfMaterials } from '../types';
import { useOverlay } from '../hooks/useOverlay';

interface EndShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reportText: string, customMessage: string) => void;
}

export default function EndShiftModal({ isOpen, onClose, onConfirm }: EndShiftModalProps) {
  useOverlay(isOpen, onClose, 'dialog');
  
  const { products } = useInventoryStore();
  const { transactions, debtPayments } = useTransactionStore();
  const { customers } = useCustomerStore();
  const { activeShift, currentEmployee } = useAuthStore();
  const { productionBatches, billOfMaterials } = useExtraModulesStore();

  const [customMessage, setCustomMessage] = useState("");
  const [copied, setCopied] = useState(false);

  // Compute shift statistics
  const { reportText, reportPreview } = useMemo(() => {
    if (!activeShift || !currentEmployee) return { reportText: '', reportPreview: '' };

    const shiftStart = new Date(activeShift.startTime).getTime();
    
    // 1. Filter transactions for this shift
    const shiftTransactions = transactions.filter(t => {
      const tTime = new Date(t.timestamp).getTime();
      const shiftEnd = activeShift.endTime ? new Date(activeShift.endTime).getTime() : Date.now();
      return tTime >= shiftStart && tTime <= shiftEnd && t.staffId === currentEmployee.id;
    });

    // Debt Payments made during shift
    const shiftDebtPayments = debtPayments.filter(dp => {
      const dpTime = dp.created_at ? new Date(dp.created_at).getTime() : 0;
      const shiftEnd = activeShift.endTime ? new Date(activeShift.endTime).getTime() : Date.now();
      return dpTime >= shiftStart && dpTime <= shiftEnd && dp.recordedBy === currentEmployee.name;
    });

    // 2. Financials
    let cash = 0;
    let mpesa = 0;
    let debt = 0;
    
    // 3. Products
    const productSales: Record<string, { name: string, sold: number, closing: number, opening: number, earned: number }> = {};
    
    // 4. Debt & Credit Tracking
    const customersAtCredit: Record<string, { name: string, items: string[], amount: number, currentDebt: number }> = {};

    // 5. Deliveries
    let deliveries = 0;

    // 6. Production Batches during this shift (BOM production)
    const shiftProduction = productionBatches.filter(b => {
      const bTime = new Date(b.date).getTime();
      const shiftEnd = activeShift.endTime ? new Date(activeShift.endTime).getTime() : Date.now();
      return bTime >= shiftStart && bTime <= shiftEnd && b.staffName === currentEmployee.name;
    });

    // Track BOM raw material consumption per product (e.g., milk consumed for mala)
    const productionConsumption: Record<string, number> = {};
    // Track production output (finished goods added to stock, e.g., mala produced)
    const productionOutput: Record<string, number> = {};

    shiftProduction.forEach(batch => {
      // Find the BOM recipe to know which raw materials were consumed
      const bom = billOfMaterials.find(b => b.id === batch.bomId);
      if (bom && bom.ingredients) {
        bom.ingredients.forEach(ing => {
          const consumedQty = Number((ing.quantityRequired * (1 + (ing.wastePercentage || 0) / 100) * batch.quantityProduced).toFixed(3));
          productionConsumption[ing.productId] = (productionConsumption[ing.productId] || 0) + consumedQty;
        });
      }
      // Track produced finished goods
      if (batch.productId) {
        productionOutput[batch.productId] = (productionOutput[batch.productId] || 0) + batch.quantityProduced;
      }
    });

    // Populate data
    shiftTransactions.forEach(tx => {
      if (tx.isDelivery) deliveries += 1;

      // Money
      if (tx.paymentMethod === 'Cash') cash += tx.finalTotal;
      else if (tx.paymentMethod === 'M-Pesa' || tx.paymentMethod === 'Mobile_Wallet') mpesa += tx.finalTotal;
      else if (tx.paymentMethod === 'Credit_Debt' || tx.paymentMethod === 'Credit') {
        debt += tx.finalTotal;
        if (tx.customerId) {
          if (!customersAtCredit[tx.customerId]) {
            const cust = customers.find(c => c.id === tx.customerId);
            customersAtCredit[tx.customerId] = {
              name: tx.customerName || cust?.name || 'Unknown Customer',
              items: [],
              amount: 0,
              currentDebt: cust?.debtBalance || 0
            };
          }
          customersAtCredit[tx.customerId].amount += tx.finalTotal;
          tx.items.forEach(i => customersAtCredit[tx.customerId].items.push(`${i.quantity}x ${i.product.name}`));
        }
      }

      // Products
      tx.items.forEach(item => {
        const pid = item.product.id;
        if (!productSales[pid]) {
          const currentStock = products.find(p => p.id === pid)?.stock || 0;
          productSales[pid] = {
            name: item.product.name,
            sold: 0,
            closing: currentStock,
            opening: 0, // calculated later
            earned: 0
          };
        }
        productSales[pid].sold += item.quantity;
        const itemTotal = (item.product.price * item.quantity) * (1 - item.discountPercentage / 100);
        productSales[pid].earned += itemTotal;
      });
    });

    // Calculate opening stock for sold products + account for production consumption and output
    Object.values(productSales).forEach(ps => {
      const pid = Object.keys(productSales).find(key => productSales[key] === ps);
      const consumed = pid ? (productionConsumption[pid] || 0) : 0;
      const produced = pid ? (productionOutput[pid] || 0) : 0;
      // opening = closing + sold + consumedThisShift - producedThisShift
      ps.opening = Math.max(0, Math.round((ps.closing + ps.sold + consumed - produced) * 100) / 100);
    });

    // Format text
    const dateStr = new Date().toLocaleDateString('en-KE', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
    
    let text = `*SHIFT REPORT - ${currentEmployee.name}*\n`;
    text += `Date: ${dateStr} @ ${timeStr}\n\n`;
    
    // ========== FINANCIALS ==========
    text += `*FINANCIALS*\n`;
    text += `- Cash: Ksh ${cash.toLocaleString()}\n`;
    text += `- M-Pesa: Ksh ${mpesa.toLocaleString()}\n`;
    text += `- Debt: Ksh ${debt.toLocaleString()}\n\n`;

    if (deliveries > 0) {
      text += `*TASKS*\n`;
      text += `- Deliveries completed: ${deliveries}\n\n`;
    }

    // ========== PRODUCT PERFORMANCE + INVENTORY ==========
    if (Object.keys(productSales).length > 0 || Object.keys(productionConsumption).length > 0 || Object.keys(productionOutput).length > 0) {
      text += `*INVENTORY SUMMARY*\n`;
      
      // Track all unique product IDs involved (sold, consumed, or produced)
      const allProductIds = new Set<string>([
        ...Object.keys(productSales),
        ...Object.keys(productionConsumption),
        ...Object.keys(productionOutput)
      ]);

      allProductIds.forEach(pid => {
        const prod = products.find(p => p.id === pid);
        const name = prod?.name || productSales[pid]?.name || 'Product';
        const unit = prod?.unit || 'units';
        
        const ps = productSales[pid];
        const sold = ps?.sold || 0;
        const opened = ps?.opening || 0;
        const closed = prod?.stock ?? ps?.closing ?? 0;
        const consumed = productionConsumption[pid] || 0;
        const produced = productionOutput[pid] || 0;
        const earnedKsh = Math.round(ps?.earned || 0);

        // Build info line
        const infoParts: string[] = [];
        if (opened > 0) infoParts.push(`Opened: ${opened} ${unit}`);
        if (sold > 0) infoParts.push(`Sold: ${sold} ${unit}`);
        if (consumed > 0) infoParts.push(`Consumed(BOM): ${consumed} ${unit}`);
        if (produced > 0) infoParts.push(`Produced: ${produced} ${unit}`);
        if (closed >= 0) infoParts.push(`Closed: ${closed} ${unit}`);
        if (earned > 0) infoParts.push(`Earned: Ksh ${earned.toLocaleString()}`);

        if (infoParts.length > 0) {
          text += `- ${name}: ${infoParts.join(' | ')}\n`;
        }
      });
      text += `\n`;
    }

    // ========== BOM PRODUCTION LOG ==========
    if (shiftProduction.length > 0) {
      text += `*PRODUCTION / BOM*\n`;
      shiftProduction.forEach(batch => {
        const bomName = batch.recipeName;
        const produced = batch.quantityProduced;
        const unit = batch.unit || 'units';
        const rawUsed = getRawMaterialSummary(batch, billOfMaterials);
        text += `- ${bomName}: Produced ${produced} ${unit}`;
        if (rawUsed) text += ` | Raw: ${rawUsed}`;
        text += `\n`;
      });
      text += `\n`;
    }

    if (Object.keys(customersAtCredit).length > 0) {
      text += `*CREDIT TAKEN*\n`;
      Object.values(customersAtCredit).forEach(c => {
        text += `- ${c.name}: Took ${c.items.join(', ')} (Ksh ${c.amount.toLocaleString()})\n`;
        text += `  > Total Debt to Date: Ksh ${c.currentDebt.toLocaleString()}\n`;
      });
      text += `\n`;
    }

    if (shiftDebtPayments.length > 0) {
      text += `*DEBT REPAID*\n`;
      shiftDebtPayments.forEach(dp => {
        const cName = customers.find(c => c.id === dp.customerId)?.name || 'Unknown Customer';
        text += `- ${cName} paid Ksh ${dp.amountPaid.toLocaleString()} via ${dp.paymentMethod}\n`;
        text += `  > Remaining Debt: Ksh ${dp.remainingDebt.toLocaleString()}\n`;
      });
      text += `\n`;
    }

    if (customMessage.trim()) {
      text += `*NOTES*\n${customMessage.trim()}\n`;
    }

    return { reportText: text, reportPreview: text };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShift, currentEmployee, transactions, debtPayments, products, customers, productionBatches, billOfMaterials, customMessage]);

  const handleCopy = () => {
    navigator.clipboard.writeText(reportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConfirm = () => {
    onConfirm(reportText, customMessage);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
          onClick={onClose}
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-lg bg-app-card border border-app-border rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-app-border bg-app-bg/50">
            <div>
              <h2 className="text-sm font-black text-app-text uppercase tracking-wider font-display">
                End Shift Report
              </h2>
              <p className="text-[10px] text-app-text-muted mt-0.5">
                Review your shift summary before punching out.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-app-bg rounded-xl transition text-app-text-muted hover:text-app-text"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="p-5 overflow-y-auto custom-scrollbar space-y-4 flex-1">
            
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-app-text-muted uppercase tracking-wider pl-1">
                Custom Message / Notes (Optional)
              </label>
              <textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="E.g., Left 500 in the drawer, everything looks good..."
                className="w-full bg-app-bg text-app-text text-xs p-3 rounded-2xl border border-app-border focus:border-amber-500 focus:outline-none transition min-h-[80px] resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between pl-1">
                <label className="text-[10px] font-bold text-app-text-muted uppercase tracking-wider">
                  Report Preview
                </label>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-[9px] font-bold text-amber-500 hover:text-amber-400 transition"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'COPIED' : 'COPY TO WHATSAPP'}
                </button>
              </div>
              <div className="bg-app-bg border border-app-border rounded-2xl p-4 text-[11px] text-app-text-muted font-mono whitespace-pre-wrap leading-relaxed select-text">
                {reportPreview}
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="p-5 border-t border-app-border bg-app-bg/50 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-app-bg hover:bg-app-card border border-app-border text-app-text rounded-2xl text-[11px] font-black uppercase tracking-wider transition"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-[2] py-3 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-2xl text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition"
            >
              <Send size={14} />
              End Shift & Notify Owners
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}


/** Helper to format raw materials consumed for a production batch */
function getRawMaterialSummary(batch: ProductionBatch, boms: BillOfMaterials[]): string {
  const bom = boms.find(b => b.id === batch.bomId);
  if (!bom || !bom.ingredients || bom.ingredients.length === 0) return '';
  
  const parts = bom.ingredients.map(ing => {
    const qty = Number((ing.quantityRequired * (1 + (ing.wastePercentage || 0) / 100) * batch.quantityProduced).toFixed(2));
    return `${qty}${ing.unit} ${ing.productName}`;
  });
  return parts.join(', ');
}