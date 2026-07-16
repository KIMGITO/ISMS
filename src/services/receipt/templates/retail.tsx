import React from "react";
import { ReceiptContent, BusinessReceiptSettings } from "../types";

interface TemplateProps {
  content: ReceiptContent;
  settings: BusinessReceiptSettings;
}

export function RetailTemplate({ content, settings }: TemplateProps) {
  const is58 = settings.paperWidth === "58mm";
  const is80 = settings.paperWidth === "80mm";

  const widthClass = is58 
    ? "w-[210px] p-2 text-[9px]" 
    : is80 
      ? "w-[300px] p-4 text-[11px]" 
      : "w-full max-w-xl mx-auto p-6 text-sm border border-slate-300 shadow-sm";

  const doubleLine = "border-t-2 border-double border-slate-900 my-2";
  const singleLine = "border-t border-slate-300 my-1.5";

  return (
    <div className={`bg-white text-slate-950 font-mono leading-tight select-none ${widthClass}`}>
      {/* Retail Logo & Banner */}
      <div className="text-center font-bold">
        <div className="text-sm tracking-wider uppercase">{settings.businessName}</div>
        <div className="text-[9.5px] mt-0.5 font-normal uppercase">Superstore Retail Dept</div>
        <div className="text-[8.5px] text-slate-500 font-normal mt-1 leading-normal">
          {settings.address && <div>{settings.address}</div>}
          {settings.phone && <div>TEL: {settings.phone}</div>}
          {settings.pinNumber && <div>TAX REG PIN: {settings.pinNumber}</div>}
        </div>
      </div>

      <div className={doubleLine} />

      {/* Audit Trail Metadata */}
      <div className="text-[8.5px] text-slate-600 space-y-0.5">
        <div className="flex justify-between">
          <span>TICKET NO:</span>
          <span className="font-bold text-slate-900">{content.receiptNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>DATE / TIME:</span>
          <span>{content.transactionDate} {content.transactionTime}</span>
        </div>
        <div className="flex justify-between">
          <span>TERMINAL / CSHR:</span>
          <span>TERM-01 / {content.cashierName}</span>
        </div>
        <div className="flex justify-between">
          <span>PAYMENT OPT:</span>
          <span className="font-bold text-slate-900">{content.paymentMethod}</span>
        </div>
        {content.customerName && (
          <div className="flex justify-between font-bold text-slate-800">
            <span>MEMBERSHIP CLIENT:</span>
            <span>{content.customerName}</span>
          </div>
        )}
      </div>

      <div className={singleLine} />

      {/* Grid Header */}
      <div className="grid grid-cols-6 font-bold text-[8.5px] uppercase border-b border-slate-300 pb-1 mb-1.5">
        <span className="col-span-3">Item Name</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Price</span>
        <span className="text-right">Total</span>
      </div>

      {/* Retail Item Row */}
      <div className="space-y-1.5">
        {content.items.map((item, index) => (
          <div key={index} className="text-[8.5px]">
            <div className="grid grid-cols-6 items-baseline">
              <span className="col-span-3 truncate text-slate-900 font-bold">{item.name}</span>
              <span className="text-center text-slate-600 font-mono">x{item.quantity}</span>
              <span className="text-right text-slate-600 font-mono">{item.unitPrice.toFixed(0)}</span>
              <span className="text-right text-slate-900 font-bold font-mono">
                {item.total.toFixed(0)}
              </span>
            </div>
            {item.discountAmount && item.discountAmount > 0 && (
              <div className="text-[7.5px] text-red-600 italic">
                * DISCOUNT SAVING: -{settings.currencyFormat} {item.discountAmount.toFixed(0)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={doubleLine} />

      {/* Calculations Block */}
      <div className="text-[9px] font-bold flex flex-col gap-1 text-slate-800">
        <div className="flex justify-between font-normal text-slate-600">
          <span>SUBTOTAL ITEMS ({content.items.reduce((sum, item) => sum + item.quantity, 0)})</span>
          <span>{settings.currencyFormat} {content.subtotal.toFixed(2)}</span>
        </div>

        {content.overallDiscount && content.overallDiscount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>PROMOTIONAL REBATE</span>
            <span>-{settings.currencyFormat} {content.overallDiscount.toFixed(2)}</span>
          </div>
        )}

        {settings.isTaxEnabled && content.taxTotal !== undefined && content.taxTotal > 0 && (
          <div className="flex justify-between font-normal text-slate-500">
            <span>TAXABLE BASE (VAT 16%)</span>
            <span>{settings.currencyFormat} {content.taxTotal.toFixed(2)}</span>
          </div>
        )}

        {content.deliveryFee !== undefined && content.deliveryFee > 0 && (
          <div className="flex justify-between font-normal">
            <span>SHIPPING / HOME DELIVERY</span>
            <span>+{settings.currencyFormat} {content.deliveryFee.toFixed(2)}</span>
          </div>
        )}

        <div className={singleLine} />

        <div className="flex justify-between text-xs font-black text-slate-950">
          <span>TOTAL DUE</span>
          <span>{settings.currencyFormat} {content.grandTotal.toFixed(2)}</span>
        </div>

        <div className="flex justify-between font-normal text-slate-600 text-[8.5px]">
          <span>TENDERED PAYMENT</span>
          <span>{settings.currencyFormat} {content.amountPaid.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-normal text-slate-600 text-[8.5px]">
          <span>CHANGE DUE</span>
          <span>{settings.currencyFormat} {content.changeGiven.toFixed(2)}</span>
        </div>
      </div>

      <div className={singleLine} />

      {/* Audit/Return instructions */}
      <div className="text-center text-[7.5px] text-slate-500 leading-relaxed space-y-0.5">
        {settings.thankYouMessage && <div className="font-extrabold uppercase tracking-wide text-slate-800">{settings.thankYouMessage}</div>}
        {settings.footerMessage && <div>{settings.footerMessage}</div>}
        <div>PLEASE RETAIN TICKET FOR EXCHANGE OR REFUND</div>
        {settings.returnPolicy && <div className="italic">"{settings.returnPolicy}"</div>}
      </div>

      <div className="my-3 border-t border-dashed border-slate-300" />

      {/* Barcode scanner */}
      <div className="flex flex-col items-center">
        {content.barcodeValue && (
          <div 
            className="w-full flex justify-center py-1 bg-white" 
            dangerouslySetInnerHTML={{ __html: content.barcodeValue }}
          />
        )}
        <span className="text-[7.5px] text-slate-400 font-mono tracking-widest uppercase mt-1">POS INVENTORY CONTROL TICKET</span>
      </div>
    </div>
  );
}
