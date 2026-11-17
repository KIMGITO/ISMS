// src/components/shared/Input.tsx
// The app's text boxes. Use these everywhere instead of a bare <input>, so every form looks
// and behaves the same: one height (44px on phones), one border, one focus ring.
//
//   <Field label="Name"><TextInput value={v} onChange={(e) => set(e.target.value)} /></Field>
//   <Field label="Price"><NumberInput prefix="KSh" value={n} onChange={setN} /></Field>
//
// NumberInput is a text box with the number keyboard, not <input type="number">: no spinner
// arrows, the mouse wheel doesn't change it, a comma works as the decimal point, tapping it
// selects the number so typing replaces it, and money shows with thousands separators.

import React, { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { Search, X, CalendarDays } from 'lucide-react';

type Size = 'md' | 'sm';

// A plain width class from the caller (w-24, w-[5rem]…) replaces the default full width and keeps it from shrinking;
// both in one class list would leave which wins up to CSS order.
const ownWidth = (className: string) => /(^|\s)w-(?!full\b)/.test(className);

const shell = (size: Size, disabled?: boolean, invalid?: boolean, className = '') =>
  `flex items-center gap-2 ${ownWidth(className) ? 'shrink-0' : 'w-full'} min-w-0 rounded-xl border bg-app-bg text-app-text transition-colors focus-within:ring-1 ${
    invalid ? 'border-red-500 focus-within:ring-red-500' : 'border-app-border focus-within:ring-amber-500 focus-within:border-amber-500/60'
  } ${size === 'sm' ? 'h-9 px-2.5' : 'h-11 sm:h-10 px-3'} ${disabled ? 'opacity-60' : ''}`;

const inner = 'flex-1 min-w-0 h-full bg-transparent text-sm text-app-text placeholder:text-app-text-muted/70 outline-none border-0 p-0 focus:ring-0';

const affix = 'shrink-0 text-xs font-medium text-app-text-muted select-none whitespace-nowrap';

export interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  /** An icon at the start of the box. */
  icon?: React.ReactNode;
  /** Short text before the value, e.g. "KSh". */
  prefix?: React.ReactNode;
  /** Short text or a small button after the value, e.g. "%" or a generate button. */
  suffix?: React.ReactNode;
  size?: Size;
  invalid?: boolean;
  /** Classes for the outer box (width, background). */
  className?: string;
  inputClassName?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { icon, prefix, suffix, size = 'md', invalid, className = '', inputClassName = '', disabled, ...rest },
  ref,
) {
  return (
    <div className={`${shell(size, disabled, invalid, className)} ${className}`}>
      {icon && <span className="shrink-0 text-app-text-muted [&>svg]:size-4">{icon}</span>}
      {prefix != null && <span className={affix}>{prefix}</span>}
      <input ref={ref} disabled={disabled} aria-invalid={invalid || undefined} className={`${inner} ${inputClassName}`} {...rest} />
      {suffix != null && <span className={affix}>{suffix}</span>}
    </div>
  );
});

const parse = (raw: string): number | null => {
  const t = raw.replace(/[\s,](?=\d{3}(\D|$))/g, '').replace(',', '.').trim();
  if (t === '' || t === '-' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const show = (v: number | null | undefined, grouping: boolean, decimals: number) => {
  if (v == null || !Number.isFinite(v)) return '';
  if (!grouping) return String(v);
  return v.toLocaleString('en-KE', { maximumFractionDigits: decimals });
};

export interface NumberInputProps extends Omit<TextInputProps, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'defaultValue'> {
  value: number | string | null | undefined;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Most decimal places allowed. 0 = whole numbers only. Default 2. */
  decimals?: number;
  /** Thousands separators while not typing. Default on. */
  grouping?: boolean;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onChange, min, max, decimals = 2, grouping = true, onFocus, onBlur, inputMode, ...rest },
  ref,
) {
  const num = typeof value === 'string' ? parse(value) : value ?? null;
  const [text, setText] = useState(() => show(num, grouping, decimals));
  const [focused, setFocused] = useState(false);
  const keepSelection = useRef(false);

  // Follow the value from outside while the person isn't typing in this box.
  useEffect(() => {
    if (!focused) setText(show(num, grouping, decimals));
  }, [num, focused, grouping, decimals]);

  const allowNeg = min == null || min < 0;
  const pattern = new RegExp(`^${allowNeg ? '-?' : ''}\\d*${decimals > 0 ? `([.,]\\d{0,${decimals}})?` : ''}$`);

  return (
    <TextInput
      ref={ref}
      type="text"
      inputMode={inputMode ?? (decimals > 0 ? 'decimal' : 'numeric')}
      autoComplete="off"
      enterKeyHint="done"
      {...rest}
      value={text}
      onFocus={(e) => {
        setFocused(true);
        setText(num == null ? '' : String(num));
        keepSelection.current = true;
        const el = e.target;
        requestAnimationFrame(() => el.select());
        onFocus?.(e);
      }}
      onMouseUp={(e) => {
        if (keepSelection.current) {
          e.preventDefault();
          keepSelection.current = false;
        }
      }}
      onChange={(e) => {
        keepSelection.current = false;
        const v = e.target.value.replace(/\s/g, '');
        if (!pattern.test(v)) return;
        setText(v);
        onChange(parse(v));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        rest.onKeyDown?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        let n = parse(text);
        if (n != null) {
          if (min != null && n < min) n = min;
          if (max != null && n > max) n = max;
          if (n !== parse(text)) onChange(n);
        }
        setText(show(n, grouping, decimals));
        onBlur?.(e);
      }}
    />
  );
});

/** A search box with a clear button. */
export function SearchInput({ value, onChange, placeholder = 'Search', className = '', size = 'md', autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  size?: Size;
  autoFocus?: boolean;
}) {
  return (
    <TextInput
      type="search"
      size={size}
      icon={<Search />}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={className}
      inputClassName="[&::-webkit-search-cancel-button]:hidden"
      suffix={
        value ? (
          <button type="button" onClick={() => onChange('')} aria-label="Clear" className="grid place-items-center size-6 -mr-1 rounded-full hover:bg-app-border/50 cursor-pointer">
            <X size={14} />
          </button>
        ) : undefined
      }
    />
  );
}

/** Date and time box. Value is an ISO time or null; the box shows local time. */
export function DateTimeInput({ value, onChange, size = 'md', className = '', withTime = true, ...rest }: {
  value: string | null;
  onChange: (iso: string | null) => void;
  size?: Size;
  className?: string;
  withTime?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size' | 'type'>) {
  const local = (() => {
    if (!value) return '';
    const d = new Date(value);
    const s = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
    return withTime ? s.slice(0, 16) : s.slice(0, 10);
  })();
  return (
    <TextInput
      type={withTime ? 'datetime-local' : 'date'}
      size={size}
      icon={<CalendarDays />}
      value={local}
      onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
      className={className}
      inputClassName="[&::-webkit-calendar-picker-indicator]:opacity-60 [color-scheme:light] dark:[color-scheme:dark]"
      suffix={
        value ? (
          <button type="button" onClick={() => onChange(null)} aria-label="Clear date" className="grid place-items-center size-6 -mr-1 rounded-full text-app-text-muted hover:bg-app-border/50 cursor-pointer">
            <X size={14} />
          </button>
        ) : undefined
      }
      {...rest}
    />
  );
}

/**
 * A label above a control, with an optional hint or error below. For a single text box the
 * label is a real <label>; pass `group` for a row of buttons (a Segmented, a ChoiceGrid) so a
 * tap on the label doesn't press the first button.
 */
export function Field({ label, hint, error, group, className = '', children }: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  group?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const head = <span id={id} className="block text-xs font-medium text-app-text-muted mb-1.5">{label}</span>;
  const foot = (error || hint) && (
    <span className={`block mt-1 text-[11px] ${error ? 'text-red-600 dark:text-red-400' : 'text-app-text-muted'}`}>{error || hint}</span>
  );
  if (group) {
    return (
      <div role="group" aria-labelledby={id} className={`min-w-0 ${className}`}>
        {head}
        {children}
        {foot}
      </div>
    );
  }
  return (
    <label className={`block min-w-0 ${className}`}>
      {head}
      {children}
      {foot}
    </label>
  );
}

export default TextInput;
