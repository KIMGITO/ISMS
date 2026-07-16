import React from "react";
import { ReceiptContent, BusinessReceiptSettings } from "../types";

interface TemplateProps {
  content: ReceiptContent;
  settings: BusinessReceiptSettings;
}

export function CompactTemplate({ content, settings }: TemplateProps) {
  const is58 = settings.paperWidth === "58mm";
  const is80 = settings.paperWidth === "80mm";

  const widthClass = is58 
    ? "w-[210px] p-1 text-[8.5px]" 
    : is80 
      ? "w-[300px] p-2 text-[10px]" 
      : "w-full max-w-sm mx-auto p-4 text-xs";

  return (
    <div className={`bg-white text-slate-950 font-mono leading-none select-none ${widthClass}`}>
      {/* Super compact header */}
      <div className="text-center">
        <h3 className="font-extrabold uppercase">{settings.businessName}</h3>
        <p className="text-[8px] text-slate-500 font-bold">{settings.phone}</p>
      </div>

      <div className="border-t border-dotted border-slate-400 my-1.5" />

      {/* Basic metadata */}
      <div className="text-[8px] flex flex-col gap-0.5 text-slate-600">
        <div className="flex justify-between">
          <span>ID: {content.receiptNumber}</span>
          <span>{content.transactionDate} {content.transactionTime}</span>
        </div>
        <div className="flex justify-between">
          <span>OP: {content.cashierName}</span>
          <span className="font-bold">{content.paymentMethod}</span>
        </div>
      </div>

      <div className="border-t border-dotted border-slate-400 my-1.5" />

      {/* Tight item layout */}
      <div className="space-y-1">
        {content.items.map((item, idx) => (
          <div key={idx} className="flex justify-between text-[8.5px]">
            <span className="truncate max-w-[70%]">{item.name} x{item.quantity}</span>
            <span className="font-bold">{settings.currencyFormat} {item.total.toFixed(0)}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-dotted border-slate-400 my-1.5" />

      {/* Core Math block */}
      <div className="flex flex-col gap-0.5 text-[8.5px]">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{settings.currencyFormat} {content.subtotal.toFixed(0)}</span>
        </div>
        {content.overallDiscount && content.overallDiscount > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>Discount</span>
            <span>-{settings.currencyFormat} {content.overallDiscount.toFixed(0)}</span>
          </div>
        )}
        <div className="flex justify-between font-black text-[10px]">
          <span>TOTAL</span>
          <span>{settings.currencyFormat} {content.grandTotal.toFixed(0)}</span>
        </div>
        <div className="flex justify-between text-slate-500 text-[8px]">
          <span>Paid</span>
          <span>{settings.currencyFormat} {content.amountPaid.toFixed(0)}</span>
        </div>
        {content.changeGiven > 0 && (
          <div className="flex justify-between text-slate-500 text-[8px]">
            <span>Change</span>
            <span>{settings.currencyFormat} {content.changeGiven.toFixed(0)}</span>
          </div>
        )}
      </div>

      <div className="border-t border-dotted border-slate-400 my-1.5" />

      {/* Tiny compliance code */}
      <div className="flex flex-col items-center">
        {content.barcodeValue && (
          <div 
            className="w-[120px] opacity-90" 
            dangerouslySetInnerHTML={{ __html: content.barcodeValue }}
          />
        )}
        <span className="text-[7px] text-slate-400 mt-1 uppercase">
          Asante Sana! {settings.thankYouMessage || "Thank you!"}
        </span>
      </div>
    </div>
  );
}
