import React, { useState, useEffect, useRef } from "react";

export function QuantityInput({ item, updateCartQty, removeFromCart }) {
  const [inputValue, setInputValue] = useState(String(item.quantity ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);

  // Synchronize local input with parent state ONLY when user is NOT focused/typing
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setInputValue(String(item.quantity ?? ""));
    }
  }, [item.quantity]);

  // Finalizes quantity when user clicks outside (blur) or presses Enter
  const handleCommit = () => {
    const parsed = parseFloat(inputValue);

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
        value={inputValue}
        onChange={(e) => {
          const val = e.target.value;

          // Allow digits and a single optional decimal point
          if (/^\d*\.?\d*$/.test(val)) {
            setInputValue(val);

            const parsed = parseFloat(val);
            if (!isNaN(parsed) && parsed > 0 && !val.endsWith(".")) {
              const rounded = Math.round(parsed * 100) / 100;
              updateCartQty(item.product.id, rounded);
            }
          }
        }}
        onBlur={handleCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleCommit();
            inputRef.current?.blur();
          }
        }}
        className="w-12 text-center text-xs font-bold text-app-text bg-transparent outline-none"
      />

      {/* Increase Button */}
      <button
        type="button"
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