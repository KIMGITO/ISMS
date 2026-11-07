import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Printer, MessageCircle, Mail, FileDown, Copy, X, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Transaction } from '../../types';
import { useCustomerStore } from '../../stores/customerStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useBusinessStore } from '../../stores/businessStore';
import { ReceiptService, ReceiptShareService } from '../../services/receipt/ReceiptService';
import { BusinessReceiptSettings, ReceiptContent } from '../../services/receipt/types';
import { columnsFor } from '../../services/receipt/layout';
import { printerService } from '../../services/printer/PrinterService';
import { PrinterTarget } from '../../services/printer/types';
import { kraService, useKraStatus } from '../../services/kra/kraService';
import { useOverlay } from '../../hooks/useOverlay';
import { toUserMessage } from '../../utils/userError';
import { ReceiptPaper } from './ReceiptPaper';
import { PrinterPicker } from './PrinterPicker';

interface Props {
  transaction: Transaction | null;
  onClose: () => void;
  /** Open the printer choice straight away (the "print after sale" setting). */
  startPrinting?: boolean;
}

type Busy = null | 'whatsapp' | 'email' | 'pdf' | 'copy';
type KraState = 'off' | 'checking' | 'signing' | 'signed' | 'failed' | 'unsaved';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="hidden md:inline-block ml-auto px-1.5 rounded border border-current/25 text-[10px] font-mono opacity-60">{children}</kbd>;
}

export function ReceiptSheet({ transaction, onClose, startPrinting }: Props) {
  const open = !!transaction;
  const { customers } = useCustomerStore();
  const { showToast } = useNotificationStore();
  const activeBusinessId = useBusinessStore((s) => s.activeBusinessId);
  const businessId = transaction?.businessId || activeBusinessId;
  const { status: kraStatus } = useKraStatus(businessId);

  const [receipt, setReceipt] = useState<{ content: ReceiptContent; settings: BusinessReceiptSettings } | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [kraState, setKraState] = useState<KraState>('off');
  const [kraError, setKraError] = useState<string | null>(null);
  const autoPrinted = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Take focus from whatever screen opened the receipt so its shortcuts do not fire underneath.
  useEffect(() => {
    if (open) requestAnimationFrame(() => dialogRef.current?.focus());
  }, [open, transaction?.id]);

  useOverlay(open && !pickerOpen, onClose, 'dialog');

  const customer = transaction?.customerId ? customers.find((c) => c.id === transaction.customerId) : undefined;

  // Build the receipt and default the contact fields to the sale's customer.
  useEffect(() => {
    if (!transaction || !businessId) {
      setReceipt(null);
      return;
    }
    let live = true;
    setReceipt(null);
    setKraError(null);
    setKraState('off');
    setPhone(customer?.phone || '');
    setEmail(customer?.email || '');
    ReceiptService.buildForTransaction(transaction, businessId, { customerPhone: customer?.phone, customerEmail: customer?.email })
      .then((r) => live && setReceipt(r))
      .catch((err) => live && showToast('Receipt', toUserMessage(err, 'Could not prepare the receipt.'), undefined, 'error'));
    return () => {
      live = false;
    };
  }, [transaction?.id, businessId, customer?.id]);

  // When KRA is connected and this sale has no signature yet, ask KRA for one.
  const signWithKra = useCallback(async () => {
    if (!transaction || !businessId || !receipt) return;
    if (!kraService.isSavedSale(transaction.id)) {
      setKraState('unsaved');
      return;
    }
    setKraState('signing');
    setKraError(null);
    try {
      const kra = await kraService.signSale(businessId, transaction.id);
      setReceipt((r) => (r ? { ...r, content: { ...r.content, kra } } : r));
      setKraState('signed');
    } catch (err) {
      setKraState('failed');
      setKraError(toUserMessage(err, 'KRA did not sign this sale.'));
    }
  }, [transaction?.id, businessId, !!receipt]);

  useEffect(() => {
    if (!receipt) return;
    if (receipt.content.kra) setKraState('signed');
    else if (!kraStatus) setKraState('checking');
    else if (!kraStatus.connected) setKraState('off');
    else if (kraState === 'off' || kraState === 'checking') signWithKra();
  }, [receipt, kraStatus?.connected]);

  const lines = useMemo(() => (receipt ? ReceiptService.lines(receipt.content, receipt.settings) : []), [receipt]);

  const canPrint = printerService.canPrint();
  const kraPending = kraState === 'signing' || kraState === 'checking';

  const startPrint = useCallback(() => {
    if (!receipt) return;
    if (!canPrint) {
      showToast('Printing', printerService.support().reason || 'Printing is not available here.', undefined, 'info');
      return;
    }
    setPickerOpen(true);
  }, [receipt, canPrint]);

  // "Print after sale": open the printer choice once, after any KRA signature has arrived.
  useEffect(() => {
    if (!startPrinting || !receipt || !transaction || kraPending || autoPrinted.current === transaction.id) return;
    autoPrinted.current = transaction.id;
    if (canPrint) setPickerOpen(true);
  }, [startPrinting, receipt, kraPending, transaction?.id]);

  const doPrint = async (printer: PrinterTarget) => {
    if (!receipt) return;
    await ReceiptService.print(receipt.content, receipt.settings, printer);
    setPickerOpen(false);
    showToast('Printed', `Receipt ${receipt.content.receiptNumber} sent to ${printer.name}.`, undefined, 'success');
  };

  const run = async (kind: Exclude<Busy, null>, task: () => Promise<string | void>) => {
    if (!receipt || busy) return;
    setBusy(kind);
    try {
      const message = await task();
      if (message) showToast('Receipt', message, undefined, 'success');
    } catch (err) {
      showToast('Receipt', toUserMessage(err, 'That did not work. Please try again.'), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const sendWhatsApp = () =>
    run('whatsapp', async () => {
      await ReceiptShareService.whatsapp(receipt!.content, receipt!.settings, phone.trim());
    });

  const sendEmail = () =>
    run('email', async () => {
      const to = email.trim();
      if (to && !EMAIL.test(to)) throw new Error('Enter a valid email address.');
      const how = await ReceiptShareService.email(receipt!.content, receipt!.settings, to);
      return how === 'text_only' ? 'PDF saved. Attach it to the email that just opened.' : undefined;
    });

  const sharePdf = () =>
    run('pdf', async () => {
      const result = await ReceiptShareService.sharePdf(receipt!.content, receipt!.settings);
      return result === 'downloaded' ? 'Receipt PDF downloaded.' : undefined;
    });

  const copy = () =>
    run('copy', async () => {
      const ok = await ReceiptShareService.copyText(receipt!.content, receipt!.settings);
      if (!ok) throw new Error('Could not copy the receipt.');
      return 'Receipt text copied.';
    });

  // Keyboard shortcuts while the sheet is open (not while typing or choosing a printer).
  useEffect(() => {
    if (!open || pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        startPrint();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (typing) target.blur();
        else onClose();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const actions: Record<string, () => void> = { p: startPrint, w: sendWhatsApp, e: sendEmail, d: sharePdf, c: copy };
      const action = actions[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const columns = receipt ? columnsFor(receipt.settings) : 32;
  const actionClass =
    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

  return (
    <>
    <AnimatePresence>
      {transaction && (
        <motion.div
          key="receipt-sheet"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Receipt"
            className="outline-none w-full sm:max-w-3xl bg-app-card text-app-text rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[94dvh] pb-[env(safe-area-inset-bottom,0px)]"
          >
            <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-app-border/60">
              <div className="min-w-0">
                <h2 className="text-base font-semibold truncate">Receipt {receipt?.content.receiptNumber}</h2>
                {receipt && (
                  <p className="text-xs text-app-text-muted">
                    {receipt.content.transactionDate} {receipt.content.transactionTime} · {receipt.settings.paperWidth} paper
                  </p>
                )}
              </div>
              <button type="button" onClick={onClose} aria-label="Close receipt" className="p-2 -mr-2 rounded-full hover:bg-app-bg cursor-pointer flex items-center gap-1">
                <Kbd>Esc</Kbd>
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden grid md:grid-cols-[1fr_17rem]">
              <div className="md:overflow-y-auto bg-app-bg p-3 sm:p-4">
                {receipt ? (
                  <ReceiptPaper lines={lines} columns={columns} paperWidth={receipt.settings.paperWidth} />
                ) : (
                  <div className="py-16 flex justify-center text-app-text-muted">
                    <RefreshCw size={18} className="animate-spin" />
                  </div>
                )}
              </div>

              <div className="md:overflow-y-auto p-3 sm:p-4 space-y-3 border-t md:border-t-0 md:border-l border-app-border/60">
                {kraState !== 'off' && (
                  <div
                    className={`p-2.5 rounded-xl text-xs flex gap-2 ${
                      kraState === 'signed'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : kraState === 'failed' || kraState === 'unsaved'
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                          : 'bg-app-bg text-app-text-muted'
                    }`}
                  >
                    {kraState === 'signed' ? <ShieldCheck size={15} className="shrink-0" /> : kraPending ? <RefreshCw size={15} className="shrink-0 animate-spin" /> : <ShieldAlert size={15} className="shrink-0" />}
                    <div className="min-w-0">
                      {kraState === 'signed' && (receipt?.content.kra?.environment === 'sandbox' ? 'Signed by the KRA test system (not a valid tax invoice).' : 'Signed by KRA eTIMS.')}
                      {kraPending && 'Getting the KRA signature…'}
                      {kraState === 'unsaved' && 'This sale is not saved online yet, so KRA cannot sign it.'}
                      {kraState === 'failed' && (
                        <>
                          <p>Not signed by KRA. The receipt has no KRA section.</p>
                          {kraError && <p className="mt-0.5 opacity-80">{kraError}</p>}
                          <button type="button" onClick={signWithKra} className="mt-1 underline font-medium cursor-pointer">
                            Try again
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={startPrint}
                  disabled={!receipt || kraPending}
                  title={canPrint ? undefined : printerService.support().reason}
                  className={`${actionClass} bg-amber-500 hover:bg-amber-600 text-white`}
                >
                  <Printer size={16} /> Print
                  <Kbd>P</Kbd>
                </button>
                {!canPrint && <p className="text-xs text-app-text-muted -mt-1.5">{printerService.support().reason}</p>}

                <div className="space-y-1.5 pt-1">
                  <label className="block text-xs font-medium text-app-text-muted" htmlFor="receipt-phone">
                    WhatsApp number {customer?.phone && phone === customer.phone ? `(${customer.name})` : ''}
                  </label>
                  <input
                    id="receipt-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="tel"
                    placeholder="0712 345 678 (or leave empty to pick a chat)"
                    className="w-full bg-app-bg px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={sendWhatsApp}
                    disabled={!receipt || busy !== null || kraPending}
                    className={`${actionClass} bg-[#25D366]/15 text-[#128C7E] dark:text-[#25D366] hover:bg-[#25D366]/25`}
                  >
                    {busy === 'whatsapp' ? <RefreshCw size={16} className="animate-spin" /> : <MessageCircle size={16} />} Send on WhatsApp
                    <Kbd>W</Kbd>
                  </button>
                </div>

                <div className="space-y-1.5 pt-1">
                  <label className="block text-xs font-medium text-app-text-muted" htmlFor="receipt-email">
                    Email {customer?.email && email === customer.email ? `(${customer.name})` : ''}
                  </label>
                  <input
                    id="receipt-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    inputMode="email"
                    type="email"
                    placeholder="customer@example.com"
                    className="w-full bg-app-bg px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={sendEmail}
                    disabled={!receipt || busy !== null || kraPending}
                    className={`${actionClass} bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20`}
                  >
                    {busy === 'email' ? <RefreshCw size={16} className="animate-spin" /> : <Mail size={16} />} Email receipt (PDF)
                    <Kbd>E</Kbd>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button type="button" onClick={sharePdf} disabled={!receipt || busy !== null || kraPending} className={`${actionClass} bg-app-bg hover:bg-app-border/60`}>
                    {busy === 'pdf' ? <RefreshCw size={16} className="animate-spin" /> : <FileDown size={16} />} PDF
                    <Kbd>D</Kbd>
                  </button>
                  <button type="button" onClick={copy} disabled={!receipt || busy !== null} className={`${actionClass} bg-app-bg hover:bg-app-border/60`}>
                    <Copy size={16} /> Copy
                    <Kbd>C</Kbd>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    <PrinterPicker open={pickerOpen} actionLabel="Print receipt" onCancel={() => setPickerOpen(false)} onConfirm={doPrint} />
    </>
  );
}

export default ReceiptSheet;
