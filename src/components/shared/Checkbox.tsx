// src/components/shared/Checkbox.tsx
// The app's checkbox, for choosing items from a list or agreeing to something.

import React, { useId } from 'react';
import { Check, Minus } from 'lucide-react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  /** Some, but not all, items below are chosen. */
  indeterminate?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function Checkbox({
  checked, onChange, label, description, disabled = false, indeterminate = false, ariaLabel, className = '',
}: CheckboxProps) {
  const id = useId();
  const on = checked || indeterminate;
  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? 'mixed' : checked}
        aria-label={label ? undefined : ariaLabel}
        aria-labelledby={label ? `${id}-label` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`mt-px h-5 w-5 shrink-0 rounded-md border-2 flex items-center justify-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 focus-visible:ring-offset-app-card ${
          on ? 'bg-amber-500 border-amber-500 text-slate-950' : 'bg-app-bg border-app-border text-transparent'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-amber-500'}`}
      >
        {indeterminate ? <Minus size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
      </button>
      {label && (
        <div className="min-w-0">
          <label id={`${id}-label`} htmlFor={id} className={`block text-xs font-medium text-app-text ${disabled ? '' : 'cursor-pointer'}`}>
            {label}
          </label>
          {description && <span className="block text-[11px] text-app-text-muted mt-0.5">{description}</span>}
        </div>
      )}
    </div>
  );
}

export default Checkbox;
