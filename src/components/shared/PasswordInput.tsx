import React, { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}

export const PasswordInput: React.FC<PasswordInputProps> = ({
  label = 'Choose Password',
  value,
  onChange,
  placeholder = 'Minimum 6 characters',
  required = true,
}) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-1">
      {label && (
        <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
          {label} {required && '*'}
        </label>
      )}
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-slate-950 text-slate-100 pl-8 pr-10 py-2.5 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none text-xs placeholder:text-slate-600 transition-colors"
        />
        <Lock
          size={13}
          className="absolute left-3 top-3.5 text-slate-500 pointer-events-none"
        />
        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          className="absolute right-3 top-3 text-slate-500 hover:text-slate-300 focus:outline-none transition-colors p-0.5 rounded"
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
};

export  default PasswordInput;