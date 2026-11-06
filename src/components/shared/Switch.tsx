// src/components/shared/Switch.tsx
// The app's on/off switch. Use it instead of a checkbox for a setting that takes effect.

import React, { useId } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Shown beside the switch; also its accessible name. */
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  /** Name for screen readers when there is no visible label. */
  ariaLabel?: string;
  className?: string;
}

export function Switch({ checked, onChange, label, description, disabled = false, ariaLabel, className = '' }: SwitchProps) {
  const id = useId();
  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? `${id}-label` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-app-card ${
        checked ? 'bg-amber-500' : 'bg-app-border'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white dark:bg-slate-900 shadow transition-transform duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );

  if (!label) return <span className={className}>{control}</span>;

  return (
    <div className={`flex items-center justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <label id={`${id}-label`} htmlFor={id} className={`block text-xs font-bold text-app-text ${disabled ? '' : 'cursor-pointer'}`}>
          {label}
        </label>
        {description && <span className="block text-[11px] text-app-text-muted mt-0.5">{description}</span>}
      </div>
      {control}
    </div>
  );
}

export default Switch;
