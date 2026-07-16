import React, { useRef, useEffect } from "react";

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  alphanumeric?: boolean;
}

export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  alphanumeric = false,
}: OtpInputProps) {
  const inputsRef = useRef<HTMLInputElement[]>([]);

  // Keep inputsRef clean with the correct length
  useEffect(() => {
    inputsRef.current = inputsRef.current.slice(0, length);
  }, [length]);

  // Focus the first input on load/mount
  useEffect(() => {
    setTimeout(() => {
      if (inputsRef.current[0] && !disabled) {
        inputsRef.current[0].focus();
      }
    }, 100);
  }, [disabled]);

  const handleChange = (index: number, val: string) => {
    // Sanitize input to only accept digits (or alphanumeric if enabled)
    const sanitizedVal = val.trim();
    if (sanitizedVal) {
      const regex = alphanumeric ? /^[a-zA-Z0-9]$/ : /^[0-9]$/;
      if (!regex.test(sanitizedVal)) return;
    }

    const newValue = value.split("");
    // Ensure array is padded to length
    while (newValue.length < length) {
      newValue.push("");
    }
    newValue[index] = alphanumeric ? sanitizedVal.toUpperCase() : sanitizedVal;
    
    const combinedValue = newValue.slice(0, length).join("");
    onChange(combinedValue);

    // If a value is entered, automatically advance focus to next input
    if (sanitizedVal && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }

    // Trigger complete callback when fully populated
    if (combinedValue.length === length && onComplete) {
      onComplete(combinedValue);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      // If current box is empty, delete previous and move focus back
      if (!value[index] && index > 0) {
        const newValue = value.split("");
        newValue[index - 1] = "";
        const combined = newValue.join("");
        onChange(combined);
        inputsRef.current[index - 1]?.focus();
      } else {
        // Just clear current box
        const newValue = value.split("");
        newValue[index] = "";
        onChange(newValue.join(""));
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    let pastedData = e.clipboardData.getData("text").trim();
    
    // If it starts with INV- or inv-, remove it (for invitation token support)
    if (pastedData.toUpperCase().startsWith("INV-")) {
      pastedData = pastedData.slice(4);
    }
    
    // Validate pasted code string matches regex
    const regex = alphanumeric ? /^[a-zA-Z0-9]+$/ : /^[0-9]+$/;
    if (!regex.test(pastedData)) return;

    const code = alphanumeric ? pastedData.slice(0, length).toUpperCase() : pastedData.slice(0, length);
    onChange(code);

    // Focus last input index of pasted code
    const targetIdx = Math.min(code.length, length - 1);
    inputsRef.current[targetIdx]?.focus();

    if (code.length === length && onComplete) {
      onComplete(code);
    }
  };

  return (
    <div className="flex justify-center gap-2 sm:gap-2.5" role="group" aria-label="Verification Code Input">
      {Array.from({ length }).map((_, index) => {
        const char = value[index] || "";
        return (
          <input
            key={index}
            ref={(el) => {
              if (el) inputsRef.current[index] = el;
            }}
            type="text"
            inputMode={alphanumeric ? "text" : "numeric"}
            pattern={alphanumeric ? "[a-zA-Z0-9]*" : "[0-9]*"}
            maxLength={1}
            value={char}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            disabled={disabled}
            className="w-10 h-12 sm:w-11 sm:h-13 text-center text-lg sm:text-xl font-bold bg-slate-950 border border-slate-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-xl text-slate-100 outline-none transition-all disabled:opacity-50"
            aria-label={`Code Digit ${index + 1}`}
          />
        );
      })}
    </div>
  );
}

export default OtpInput;
