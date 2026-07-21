import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Send, Check } from 'lucide-react';
import { useInventoryStore } from '../stores/inventoryStore';
import { useTransactionStore } from '../stores/transactionStore';
import { useCustomerStore } from '../stores/customerStore';
import { useAuthStore } from '../stores/authStore';
import { useAppStore } from '../stores/appStore';
import { Shift, Transaction } from '../types';
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

    // Calculate opening stock for sold products
    Object.values(productSales).forEach(ps => {
      ps.opening = ps.closing + ps.sold;
    });

    // Format text
    const dateStr = new Date().toLocaleDateString('en-KE', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
    
    let text = `*SHIFT REPORT - ${currentEmployee.name}*\n`;
    text += `Date: ${dateStr} @ ${timeStr}\n\n`;
    
    text += `*FINANCIALS*\n`;
    text += `- Cash: Ksh ${cash.toLocaleString()}\n`;
    text += `- M-Pesa: Ksh ${mpesa.toLocaleString()}\n`;
    text += `- Debt: Ksh ${debt.toLocaleString()}\n\n`;

    if (deliveries > 0) {
      text += `*TASKS*\n`;
      text += `- Deliveries completed: ${deliveries}\n\n`;
    }

    if (Object.keys(productSales).length > 0) {
      text += `*PRODUCT PERFORMANCE*\n`;
      Object.values(productSales).forEach(ps => {
        text += `- ${ps.name}: Earned Ksh ${Math.round(ps.earned).toLocaleString()} (Opened: ${ps.opening} -> Sold: ${ps.sold} -> Closed: ${ps.closing})\n`;
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

  }, [activeShift, currentEmployee, transactions, debtPayments, products, customers, customMessage]);

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
