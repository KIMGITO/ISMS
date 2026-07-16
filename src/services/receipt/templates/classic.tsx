import React from "react";
import { ReceiptContent, BusinessReceiptSettings } from "../types";

interface TemplateProps {
  content: ReceiptContent;
  settings: BusinessReceiptSettings;
}

export function ClassicTemplate({ content, settings }: TemplateProps) {
  const is58 = settings.paperWidth === "58mm";
  const is80 = settings.paperWidth === "80mm";
  const isA4 = settings.paperWidth === "A4";

  // Width container classes
  const widthClass = is58 
    ? "w-[210px] p-2 text-[9px]" 
    : is80 
      ? "w-[300px] p-4 text-[11px]" 
      : "w-full max-w-xl mx-auto p-8 text-sm";

  const dividerClass = "border-t border-dashed border-slate-300 my-2";

  return (
    <div className={`bg-white text-slate-950 font-mono select-none leading-tight ${widthClass}`}>
      {/* Header */}
      <div className="text-center">
        {settings.logoUrl && !is58 && (
          <img 
            src={settings.logoUrl} 
            alt="Logo" 
            className="w-10 h-10 object-contain mx-auto mb-1.5" 
            referrerPolicy="no-referrer"
          />
        )}
        <h2 className="font-extrabold uppercase tracking-wide text-center">
          {settings.businessName}
        </h2>
        {settings.headerMessage && (
          <p className="text-[9.5px] text-slate-500 italic mt-0.5">{settings.headerMessage}</p>
        )}
        <div className="text-[8.5px] text-slate-500 mt-1 flex flex-col gap-0.5">
          {settings.address && <div>{settings.address}</div>}
          {settings.phone && <div>Tel: {settings.phone}</div>}
          {settings.email && <div>Email: {settings.email}</div>}
          {settings.pinNumber && <div>PIN: {settings.pinNumber}</div>}
          {settings.registrationNumber && <div>Reg No: {settings.registrationNumber}</div>}
        </div>
      </div>

      <div className={dividerClass} />

      {/* Transaction Info */}
      <div className="flex flex-col gap-0.5 text-[9px] text-slate-600">
        <div className="flex justify-between">
          <span>RECEIPT:</span>
          <span className="font-bold text-slate-950">{content.receiptNumber}</span>
        </div>
        {content.invoiceNumber && (
          <div className="flex justify-between">
            <span>INVOICE:</span>
            <span>{content.invoiceNumber}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>DATE:</span>
          <span>{content.transactionDate} {content.transactionTime}</span>
        </div>
        <div className="flex justify-between">
          <span>CASHIER:</span>
          <span>{content.cashierName}</span>
        </div>
        <div className="flex justify-between">
          <span>PAYMENT:</span>
          <span className="font-bold text-slate-950">{content.paymentMethod}</span>
        </div>

        {/* Customer Info (Conditional) */}
        {(content.customerName || content.customerPhone) && (
          <div className="mt-1 pt-1 border-t border-dashed border-slate-200">
            {content.customerName && (
              <div className="flex justify-between">
                <span>CUSTOMER:</span>
                <span className="font-bold text-slate-950">{content.customerName}</span>
              </div>
            )}
            {content.customerPhone && (
              <div className="flex justify-between">
                <span>PHONE:</span>
                <span>{content.customerPhone}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={dividerClass} />

      {/* Items List */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-4 font-bold text-[9px] text-slate-700 uppercase border-b border-dashed border-slate-200 pb-1">
          <span className="col-span-2">Item</span>
          <span className="text-center">Qty</span>
          <span className="text-right">Total</span>
        </div>

        {content.items.map((item, idx) => (
          <div key={idx} className="flex flex-col">
            <div className="grid grid-cols-4 text-[9px]">
              <span className="col-span-2 text-slate-900 truncate">{item.name}</span>
              <span className="text-center text-slate-600">x{item.quantity}</span>
              <span className="text-right text-slate-900">
                {settings.currencyFormat} {item.total.toFixed(2)}
              </span>
            </div>
            {item.discountAmount && item.discountAmount > 0 && (
              <span className="text-[8px] text-amber-600 italic">
                * Discount: -{settings.currencyFormat} {item.discountAmount.toFixed(2)}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className={dividerClass} />

      {/* Summary Calculations */}
      <div className="text-[9px] flex flex-col gap-1 text-slate-700">
        <div className="flex justify-between">
          <span>SUBTOTAL</span>
          <span>{settings.currencyFormat} {content.subtotal.toFixed(2)}</span>
        </div>

        {content.overallDiscount && content.overallDiscount > 0 && (
          <div className="flex justify-between text-amber-600 font-bold">
            <span>OVERALL DISCOUNT</span>
            <span>-{settings.currencyFormat} {content.overallDiscount.toFixed(2)}</span>
          </div>
        )}

        {settings.isTaxEnabled && content.taxTotal !== undefined && content.taxTotal > 0 && (
          <div className="flex justify-between">
            <span>VAT ({settings.taxPercentage}%)</span>
            <span>{settings.currencyFormat} {content.taxTotal.toFixed(2)}</span>
          </div>
        )}

        {content.deliveryFee !== undefined && content.deliveryFee > 0 && (
          <div className="flex justify-between">
            <span>DELIVERY FEE</span>
            <span>+{settings.currencyFormat} {content.deliveryFee.toFixed(2)}</span>
          </div>
        )}

        {content.shippingFee !== undefined && content.shippingFee > 0 && (
          <div className="flex justify-between">
            <span>SHIPPING FEE</span>
            <span>+{settings.currencyFormat} {content.shippingFee.toFixed(2)}</span>
          </div>
        )}

        <div className="border-t border-slate-200 my-1" />
        <div className="flex justify-between font-black text-slate-950 text-xs">
          <span>GRAND TOTAL</span>
          <span>{settings.currencyFormat} {content.grandTotal.toFixed(2)}</span>
        </div>

        <div className="flex justify-between text-slate-600">
          <span>AMOUNT PAID</span>
          <span>{settings.currencyFormat} {content.amountPaid.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>CHANGE</span>
          <span>{settings.currencyFormat} {content.changeGiven.toFixed(2)}</span>
        </div>

        {content.outstandingBalance !== undefined && content.outstandingBalance > 0 && (
          <div className="flex justify-between text-red-600 font-bold">
            <span>OUTSTANDING BAL</span>
            <span>{settings.currencyFormat} {content.outstandingBalance.toFixed(2)}</span>
          </div>
        )}
      </div>

      <div className={dividerClass} />

      {/* Barcode & QR Code Section */}
      <div className="flex flex-col items-center gap-3 py-1">
        {content.barcodeValue && (
          <div className="w-full max-w-[160px] text-center flex flex-col items-center">
            <span className="text-[7.5px] text-slate-500 font-bold uppercase mb-1">SCAN FOR LOOKUP</span>
            <div 
              className="w-full flex justify-center bg-white" 
              dangerouslySetInnerHTML={{ __html: content.barcodeValue }}
            />
          </div>
        )}

        {content.qrCodeValue && !is58 && (
          <div className="w-20 h-20 bg-white flex items-center justify-center border border-slate-100"
               dangerouslySetInnerHTML={{ __html: content.qrCodeValue }}
          />
        )}
      </div>

      {/* Footer message / Notes */}
      <div className="text-center text-[8px] text-slate-500 mt-2.5 leading-relaxed">
        {settings.thankYouMessage && <p className="font-bold">{settings.thankYouMessage}</p>}
        {settings.footerMessage && <p className="mt-0.5">{settings.footerMessage}</p>}
        {settings.returnPolicy && <p className="mt-1 italic">Policy: {settings.returnPolicy}</p>}
        {settings.termsAndConditions && <p className="mt-0.5 text-[7.5px] text-slate-400">{settings.termsAndConditions}</p>}
      </div>
    </div>
  );
}
