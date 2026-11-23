// A record's reference (receipt number, EXP-2026-000123, JE-120…) that copies itself when tapped.
// Tapping it never opens or swipes the row it sits in: the row keeps its own tap for details.
import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Copies text, with the old fallback for browsers or webviews without the clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* blocked: try the fallback */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

interface Props {
  value: string;
  /** What the reference is, for screen readers: "receipt", "expense", "log entry". */
  label?: string;
  className?: string;
}

export function CopyRef({ value, label = 'reference', className = '' }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!value) return null;

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = await copyText(value);
    setState(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1600);
  };

  return (
    <button
      type="button"
      data-no-swipe
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      title={`Copy ${value}`}
      aria-label={`Copy ${label} ${value}`}
      className={`inline-flex items-center gap-1 max-w-full rounded-md border px-1.5 py-0.5 font-mono text-[11px] leading-tight transition cursor-pointer align-middle ${
        state === 'copied'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'border-app-border bg-app-bg text-app-text-muted hover:text-app-text hover:border-amber-500/50'
      } ${className}`}
    >
      <span className="truncate">{value}</span>
      {state === 'copied' ? <Check size={11} aria-hidden="true" className="shrink-0" /> : <Copy size={11} aria-hidden="true" className="shrink-0" />}
      <span className="sr-only" aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : ''}</span>
      {state !== 'idle' && <span aria-hidden="true" className="font-sans text-[10px] font-semibold shrink-0">{state === 'copied' ? 'Copied' : 'Not copied'}</span>}
    </button>
  );
}
