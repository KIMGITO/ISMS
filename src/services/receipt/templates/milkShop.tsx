import React from "react";
import { ReceiptContent, BusinessReceiptSettings } from "../types";

interface TemplateProps {
  content: ReceiptContent;
  settings: BusinessReceiptSettings;
}

export function MilkShopTemplate({ content, settings }: TemplateProps) {
  const is58 = settings.paperWidth === "58mm";
  const is80 = settings.paperWidth === "80mm";

  const widthClass = is58 
    ? "w-[210px] p-2 text-[9px]" 
    : is80 
      ? "w-[300px] p-4 text-[11px]" 
      : "w-full max-w-xl mx-auto p-6 text-sm border-2 border-emerald-600/30 rounded-3xl shadow-lg";

  const bannerColor = "bg-emerald-50 text-emerald-800 border-emerald-100";

  return (
    <div className={`bg-white text-slate-950 font-mono select-none leading-normal ${widthClass}`}>
      {/* Decorative Milk Theme Top Banner */}
      {!is58 && (
        <div className={`text-center py-1 rounded-xl font-extrabold uppercase text-[8.5px] border mb-3 flex items-center justify-center gap-1 ${bannerColor}`}>
          <span>🥛</span>
          <span>Fresh Local Farm Milk</span>
          <span>🥛</span>
        </div>
      )}

      {/* Brand Header */}
      <div className="text-center">
        <h1 className="font-extrabold text-sm uppercase tracking-wide text-emerald-950">
          {settings.businessName}
        </h1>
        {settings.headerMessage && (
          <p className="text-[9px] text-emerald-600 italic font-semibold mt-0.5">
            "{settings.headerMessage}"
          </p>
        )}
        
        <div className="text-[8px] text-slate-500 mt-1.5 space-y-0.5">
          {settings.address && <p>{settings.address}</p>}
          {settings.phone && <p>📱 Delivery Hotline: {settings.phone}</p>}
          {settings.email && <p>✉️ {settings.email}</p>}
          {settings.pinNumber && <p className="font-semibold text-[8px]">KRA PIN: {settings.pinNumber}</p>}
        </div>
      </div>

      <div className="border-t border-dashed border-emerald-600/30 my-2.5" />

      {/* Transaction info block */}
      <div className="text-[8.5px] text-slate-600 space-y-0.5">
        <div className="flex justify-between">
          <span>TX REFERENCE:</span>
          <span className="font-bold text-emerald-950">{content.receiptNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>DATE & TIME:</span>
          <span>{content.transactionDate} {content.transactionTime}</span>
        </div>
        <div className="flex justify-between">
          <span>DISPATCH ORIGIN:</span>
          <span>{content.cashierName}</span>
        </div>
        <div className="flex justify-between">
          <span>PAY METHOD:</span>
          <span className="font-extrabold text-emerald-900">{(content.paymentMethod || "Cash").toUpperCase()}</span>
        </div>

        {/* Client details */}
        {(content.customerName || content.customerPhone) && (
          <div className="mt-1.5 pt-1 border-t border-dotted border-emerald-600/20">
            {content.customerName && (
              <div className="flex justify-between">
                <span>MILK PATRON:</span>
                <span className="font-bold text-slate-900">{content.customerName}</span>
              </div>
            )}
            {content.customerPhone && (
              <div className="flex justify-between">
                <span>MOBILE NO:</span>
                <span>{content.customerPhone}</span>
              </div>
            )}
          </div>
        )}

        {/* Delivery / Rider details */}
        {(content.deliveryFee !== undefined && content.deliveryFee > 0) && (
          <div className="mt-1 pt-1 border-t border-dotted border-emerald-600/20 text-emerald-800">
            <div className="flex justify-between font-bold">
              <span>ROUTE CARRIER:</span>
              <span>RIDER COURIER</span>
            </div>
            {content.customNotes && (
              <div className="text-[8px] text-slate-500 italic mt-0.5">
                Notes: {content.customNotes}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-dashed border-emerald-600/30 my-2.5" />

      {/* Items Section */}
      <div>
        <div className="grid grid-cols-4 font-bold text-[8.5px] text-emerald-900 uppercase border-b border-dashed border-emerald-600/20 pb-1 mb-1.5">
          <span className="col-span-2">Dairy Product</span>
          <span className="text-center">Qty</span>
          <span className="text-right">Total</span>
        </div>

        <div className="space-y-1.5">
          {content.items.map((item, index) => (
            <div key={index} className="text-[8.5px] leading-tight">
              <div className="grid grid-cols-4">
                <span className="col-span-2 text-slate-900 truncate font-semibold">{item.name}</span>
                <span className="text-center text-slate-600">x{item.quantity}</span>
                <span className="text-right text-slate-900">
                  {settings.currencyFormat} {item.total.toFixed(2)}
                </span>
              </div>
              {item.discountPercentage !== undefined && item.discountPercentage > 0 && (
                <div className="text-[7.5px] text-emerald-600 italic">
                  * Swahili Waiver applied: {item.discountPercentage}% Off
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-dashed border-emerald-600/30 my-2.5" />

      {/* Calculations block */}
      <div className="text-[8.5px] flex flex-col gap-1 text-slate-700">
        <div className="flex justify-between">
          <span>SUBTOTAL ITEMS</span>
          <span>{settings.currencyFormat} {content.subtotal.toFixed(2)}</span>
        </div>

        {content.overallDiscount && content.overallDiscount > 0 && (
          <div className="flex justify-between text-emerald-600 font-bold">
            <span>DISCOUNT SAVED</span>
            <span>-{settings.currencyFormat} {content.overallDiscount.toFixed(2)}</span>
          </div>
        )}

        {settings.isTaxEnabled && content.taxTotal !== undefined && content.taxTotal > 0 && (
          <div className="flex justify-between">
            <span>KENYAN VAT ({settings.taxPercentage}%)</span>
            <span>{settings.currencyFormat} {content.taxTotal.toFixed(2)}</span>
          </div>
        )}

        {content.deliveryFee !== undefined && content.deliveryFee > 0 && (
          <div className="flex justify-between text-slate-900">
            <span>ROUTE DELIVERY FEE</span>
            <span>+{settings.currencyFormat} {content.deliveryFee.toFixed(2)}</span>
          </div>
        )}

        <div className="border-t border-emerald-200 my-1" />
        <div className="flex justify-between font-black text-emerald-950 text-xs">
          <span>GRAND TOTAL</span>
          <span>{settings.currencyFormat} {content.grandTotal.toFixed(2)}</span>
        </div>

        <div className="flex justify-between text-slate-500">
          <span>CASH RECVD</span>
          <span>{settings.currencyFormat} {content.amountPaid.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-slate-500">
          <span>CHANGE RETD</span>
          <span>{settings.currencyFormat} {content.changeGiven.toFixed(2)}</span>
        </div>

        {content.outstandingBalance !== undefined && content.outstandingBalance > 0 && (
          <div className="flex justify-between text-red-600 font-bold">
            <span>LEDGER OUTSTANDING BAL</span>
            <span>{settings.currencyFormat} {content.outstandingBalance.toFixed(2)}</span>
          </div>
        )}
      </div>

      <div className="border-t border-dashed border-emerald-600/30 my-3" />

      {/* Barcode representation */}
      <div className="text-center text-slate-400 font-mono tracking-widest text-[8px] select-none flex flex-col items-center">
        {content.barcodeValue && (
          <div className="w-full flex flex-col items-center mb-1 bg-white">
            <span className="block text-[7.5px] text-emerald-800 font-bold mb-1">DAIRY DIGITAL AUTHENTICATOR</span>
            <div 
              className="w-full flex justify-center bg-white" 
              dangerouslySetInnerHTML={{ __html: content.barcodeValue }}
            />
          </div>
        )}
      </div>

      <div className="text-center text-[8px] text-slate-400 mt-3 leading-relaxed italic">
        {settings.thankYouMessage && <p className="font-extrabold text-emerald-700 tracking-wide">{settings.thankYouMessage}</p>}
        {settings.footerMessage && <p className="mt-0.5">{settings.footerMessage}</p>}
        {settings.returnPolicy && <p className="mt-1">Exchange Policy: {settings.returnPolicy}</p>}
      </div>
    </div>
  );
}
