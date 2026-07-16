import React from "react";
import { ReceiptContent, BusinessReceiptSettings } from "../types";

interface TemplateProps {
  content: ReceiptContent;
  settings: BusinessReceiptSettings;
}

export function ModernTemplate({ content, settings }: TemplateProps) {
  const is58 = settings.paperWidth === "58mm";
  const is80 = settings.paperWidth === "80mm";
  const isA4 = settings.paperWidth === "A4";

  const widthClass = is58 
    ? "w-[210px] p-2.5 text-[9.5px]" 
    : is80 
      ? "w-[300px] p-5 text-[11px]" 
      : "w-full max-w-xl mx-auto p-8 text-sm rounded-3xl shadow-xl border border-slate-100";

  return (
    <div className={`bg-white text-slate-900 font-sans leading-normal select-none ${widthClass}`}>
      {/* Brand Header */}
      <div className="flex flex-col items-center text-center border-b border-slate-100 pb-3 mb-3">
        {settings.logoUrl && (
          <img 
            src={settings.logoUrl} 
            alt="Logo" 
            className="w-12 h-12 rounded-2xl object-cover mb-2 border border-slate-100" 
            referrerPolicy="no-referrer"
          />
        )}
        <h1 className="font-black text-sm uppercase tracking-wider text-slate-950">
          {settings.businessName}
        </h1>
        {settings.headerMessage && (
          <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full font-semibold text-slate-500 mt-1">
            {settings.headerMessage}
          </span>
        )}
        
        <div className="text-[9px] text-slate-400 mt-2 font-medium">
          {settings.address && <p>{settings.address}</p>}
          {settings.phone && <p className="font-mono mt-0.5">📞 {settings.phone}</p>}
          {settings.email && <p className="font-mono">{settings.email}</p>}
          {settings.pinNumber && <p className="font-mono mt-0.5">VAT PIN: {settings.pinNumber}</p>}
        </div>
      </div>

      {/* Transaction Summary Badge */}
      <div className="bg-slate-50 rounded-xl p-2 mb-3 text-[9px] flex flex-col gap-1 text-slate-600 border border-slate-100/50">
        <div className="flex justify-between items-center">
          <span className="font-bold text-slate-400 uppercase tracking-wider text-[8px]">Receipt ID</span>
          <span className="font-mono font-bold text-slate-900">{content.receiptNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>Date & Time</span>
          <span className="font-mono">{content.transactionDate} {content.transactionTime}</span>
        </div>
        <div className="flex justify-between">
          <span>Served By</span>
          <span className="font-medium text-slate-800">{content.cashierName}</span>
        </div>
        <div className="flex justify-between">
          <span>Method</span>
          <span className="font-extrabold uppercase text-slate-900">{content.paymentMethod}</span>
        </div>

        {/* Customer Block */}
        {(content.customerName || content.customerPhone) && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-200/60">
            {content.customerName && (
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-400 uppercase tracking-wider text-[8px]">Client</span>
                <span className="font-bold text-slate-900">{content.customerName}</span>
              </div>
            )}
            {content.customerPhone && (
              <div className="flex justify-between font-mono">
                <span>Phone</span>
                <span>{content.customerPhone}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Items Section */}
      <div className="mb-3">
        <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-2 border-b border-slate-100 pb-1">
          Purchased Items
        </div>
        
        <div className="space-y-2">
          {content.items.map((item, idx) => (
            <div key={idx} className="flex justify-between items-start text-[9.5px]">
              <div className="flex-1 pr-2">
                <span className="font-bold text-slate-900 block leading-tight">{item.name}</span>
                <span className="text-[8.5px] text-slate-400 font-mono">
                  {item.quantity} x {settings.currencyFormat} {item.unitPrice.toFixed(0)}
                </span>
                {item.discountAmount && item.discountAmount > 0 && (
                  <span className="text-[8px] text-emerald-600 block italic font-semibold">
                    Saved {settings.currencyFormat} {item.discountAmount.toFixed(0)}
                  </span>
                )}
              </div>
              <span className="font-mono font-bold text-slate-900 text-right shrink-0">
                {settings.currencyFormat} {item.total.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Total Calculations */}
      <div className="border-t border-slate-100 pt-2 mb-3 flex flex-col gap-1.5 text-[9.5px]">
        <div className="flex justify-between text-slate-500">
          <span>Subtotal</span>
          <span className="font-mono">{settings.currencyFormat} {content.subtotal.toFixed(2)}</span>
        </div>

        {content.overallDiscount && content.overallDiscount > 0 && (
          <div className="flex justify-between text-emerald-600 font-bold">
            <span>Bundle discount</span>
            <span className="font-mono">-{settings.currencyFormat} {content.overallDiscount.toFixed(2)}</span>
          </div>
        )}

        {settings.isTaxEnabled && content.taxTotal !== undefined && content.taxTotal > 0 && (
          <div className="flex justify-between text-slate-500">
            <span>Includes Tax ({settings.taxPercentage}%)</span>
            <span className="font-mono">{settings.currencyFormat} {content.taxTotal.toFixed(2)}</span>
          </div>
        )}

        {content.deliveryFee !== undefined && content.deliveryFee > 0 && (
          <div className="flex justify-between text-slate-500">
            <span>Delivery Service</span>
            <span className="font-mono">+{settings.currencyFormat} {content.deliveryFee.toFixed(2)}</span>
          </div>
        )}

        <div className="bg-slate-900 text-white rounded-xl p-2.5 flex justify-between items-center my-1">
          <span className="font-bold uppercase tracking-wider text-[8.5px]">Grand Total</span>
          <span className="font-mono font-black text-sm">
            {settings.currencyFormat} {content.grandTotal.toFixed(2)}
          </span>
        </div>

        <div className="flex justify-between text-slate-500 px-1 text-[9px]">
          <span>Cash Paid</span>
          <span className="font-mono">{settings.currencyFormat} {content.amountPaid.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-slate-500 px-1 text-[9px]">
          <span>Change Returned</span>
          <span className="font-mono font-semibold text-slate-950">
            {settings.currencyFormat} {content.changeGiven.toFixed(2)}
          </span>
        </div>

        {content.outstandingBalance !== undefined && content.outstandingBalance > 0 && (
          <div className="bg-red-50 text-red-700 rounded-lg p-2 flex justify-between items-center font-bold text-[9px] mt-1 border border-red-100">
            <span>Outstanding Balance</span>
            <span className="font-mono">{settings.currencyFormat} {content.outstandingBalance.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Barcode / QR Authenticator */}
      <div className="flex flex-col items-center gap-2 border-t border-slate-100 pt-3">
        {content.barcodeValue && (
          <div className="w-full flex flex-col items-center mb-1">
            <span className="text-[7.5px] font-bold text-slate-400 tracking-widest uppercase mb-1">DIGITAL COMPLIANCE CODE</span>
            <div 
              className="w-full flex justify-center py-1 bg-white" 
              dangerouslySetInnerHTML={{ __html: content.barcodeValue }}
            />
          </div>
        )}

        {content.qrCodeValue && !is58 && (
          <div className="p-1 rounded-xl border border-slate-100 bg-white shadow-inner flex items-center justify-center w-20 h-20"
               dangerouslySetInnerHTML={{ __html: content.qrCodeValue }}
          />
        )}
      </div>

      {/* Modern Card Footer */}
      <div className="text-center text-[8.5px] text-slate-400 mt-4 space-y-1">
        {settings.thankYouMessage && <p className="font-black text-slate-700 uppercase tracking-wider">{settings.thankYouMessage}</p>}
        {settings.footerMessage && <p className="leading-tight">{settings.footerMessage}</p>}
        {settings.returnPolicy && <p className="text-[8px] italic text-slate-400">Return Policy: {settings.returnPolicy}</p>}
        {settings.termsAndConditions && (
          <p className="text-[7.5px] leading-relaxed border-t border-slate-50 pt-1 text-slate-300">
            {settings.termsAndConditions}
          </p>
        )}
      </div>
    </div>
  );
}
