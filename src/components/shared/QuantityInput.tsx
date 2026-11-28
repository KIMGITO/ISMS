import React, { useState, useEffect, useRef } from "react";
import { tidyNumberText } from "./Input";
import type { CartItem } from "../../types";

/**
 * POS cart quantity: − / + or type. Tapping the number selects it, so typing replaces it
 * whole (no deleting the old number first). Enter or leaving the box applies it; 0 removes
 * the line; Esc puts the old number back.
 */
interface QuantityInputProps {
  item: CartItem;
  updateCartQty: (productId: string, quantity: number) => void;
  removeFromCart: (productId: string) => void;
}

export function QuantityInput({ item, updateCartQty, removeFromCart }: QuantityInputProps) {
  const [inputValue, setInputValue] = useState(String(item.quantity ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);
  // A click focuses, then its mouseup would drop the selection; the first mouseup is ignored.
  const keepSelection = useRef(false);

  // Synchronize local input with parent state ONLY when user is NOT focused/typing
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setInputValue(String(item.quantity ?? ""));
    }
  }, [item.quantity]);

  // Finalizes quantity when user clicks outside (blur) or presses Enter
  const handleCommit = () => {
    const parsed = parseFloat(inputValue.replace(",", "."));

    if (isNaN(parsed) || parsed <= 0) {
      removeFromCart(item.product.id);
    } else {
      const rounded = Math.round(parsed * 100) / 100;
      updateCartQty(item.product.id, rounded);
      setInputValue(String(rounded));
    }
  };

  return (
    <div className="flex items-center bg-app-card rounded-lg p-1 border border-app-border">
      {/* Decrease Button */}
      <button
        type="button"
        aria-label={`One less ${item.product.name}`}
        onClick={() => {
          const current = item.quantity || 0;
          const newQty = Math.round(Math.max(0, current - 1) * 100) / 100;
          if (newQty <= 0) {
            removeFromCart(item.product.id);
          } else {
            updateCartQty(item.product.id, newQty);
          }
        }}
        className="w-6 h-6 flex items-center justify-center font-bold text-app-text hover:bg-app-bg rounded transition cursor-pointer select-none"
      >
        -
      </button>

      {/* Editable Quantity Input */}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={`Quantity of ${item.product.name}`}
        value={inputValue}
        onFocus={(e) => {
          keepSelection.current = true;
          const el = e.target;
          el.select();
          requestAnimationFrame(() => el.select());
        }}
        onMouseUp={(e) => {
          if (keepSelection.current) {
            e.preventDefault();
            keepSelection.current = false;
          }
        }}
        onChange={(e) => {
          keepSelection.current = false;
          const val = tidyNumberText(e.target.value);

          // Allow digits and a single optional decimal point
          if (/^\d*([.,]\d*)?$/.test(val)) {
            setInputValue(val);

            const parsed = parseFloat(val.replace(",", "."));
            if (!isNaN(parsed) && parsed > 0 && !/[.,]$/.test(val)) {
              const rounded = Math.round(parsed * 100) / 100;
              updateCartQty(item.product.id, rounded);
            }
          }
        }}
        onBlur={handleCommit}
        onKeyDown={(e) => {
          // The POS + / − / Delete keys act on the cart; inside the box they type.
          // Complete sale (F9, Ctrl+Enter) still works from here.
          const completeSale = e.key === "F9" || (e.key === "Enter" && (e.ctrlKey || e.metaKey));
          if (!completeSale) e.stopPropagation();
          if (e.key === "Enter" && !completeSale) {
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            setInputValue(String(item.quantity ?? ""));
            // Blur commits the value just put back, so nothing changes.
            requestAnimationFrame(() => inputRef.current?.blur());
          }
        }}
        className="w-12 text-center text-xs font-bold text-app-text bg-transparent outline-none rounded focus:ring-2 focus:ring-amber-500 selection:bg-amber-500/40 tabular-nums"
      />

      {/* Increase Button */}
      <button
        type="button"
        aria-label={`One more ${item.product.name}`}
        onClick={() => {
          const current = item.quantity || 0;
          const newQty = Math.round((current + 1) * 100) / 100;
          updateCartQty(item.product.id, newQty);
        }}
        className="w-6 h-6 flex items-center justify-center font-bold text-app-text hover:bg-app-bg rounded transition cursor-pointer select-none"
      >
        +
      </button>
    </div>
  );
}
