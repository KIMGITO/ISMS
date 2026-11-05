import React, { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  /** 'auth' is the always-dark sign-in screens. 'app' follows the staff app's light or dark theme. */
  variant?: 'auth' | 'app';
  autoComplete?: string;
}

const VARIANTS = {
  auth: {
    label: 'text-[10px] text-slate-400 font-bold uppercase tracking-wider block',
    input: 'bg-slate-950 text-slate-100 pl-8 border-slate-800',
    icon: 'text-slate-500 hover:text-slate-300',
  },
  app: {
    label: 'text-[10px] text-app-text-muted font-bold uppercase tracking-wider block',
    input: 'bg-app-bg text-app-text pl-3 border-app-border',
    icon: 'text-app-text-muted hover:text-app-text',
  },
};

export const PasswordInput: React.FC<PasswordInputProps> = ({
  label = 'Choose Password',
  value,
  onChange,
  placeholder = 'Minimum 6 characters',
  required = true,
  variant = 'auth',
  autoComplete,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const styles = VARIANTS[variant];

  return (
    <div className="space-y-1">
      {label && (
        <label className={styles.label}>
          {label} {required && '*'}
        </label>
      )}
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full pr-10 py-2.5 rounded-xl border focus:border-amber-500 outline-none text-xs font-bold ${styles.input}`}
        />
        {variant === 'auth' && (
          <Lock
            size={13}
            className="absolute left-3 top-3.5 text-slate-500 pointer-events-none"
          />
        )}
        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          className={`absolute right-3 top-3 focus:outline-none transition-colors ${styles.icon}`}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
};

export  default PasswordInput;
