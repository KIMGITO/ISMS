// src/components/shared/ProgressBar.tsx
//
// The one way to show a wait that can take more than a moment: a label, a percentage and a bar
// that fills to 100%. Use it instead of a spinning icon, which tells the user nothing about how
// long is left and reads as "stuck" after a few seconds.

interface ProgressBarProps {
  /** 0 to 100. Values outside are clamped. */
  percent: number;
  /** What is happening, e.g. "Uploading photo". */
  label: string;
  /** Optional second line, e.g. "About 20 s left". */
  detail?: string;
  className?: string;
  /** "compact" is for toolbars and tight spaces. */
  size?: "normal" | "compact";
}

export default function ProgressBar({ percent, label, detail, className = "", size = "normal" }: ProgressBarProps) {
  const value = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
  const compact = size === "compact";
  return (
    <div className={`w-full ${className}`}>
      <div className={`flex items-baseline justify-between gap-3 ${compact ? "text-[11px]" : "text-xs"}`}>
        <span className="min-w-0 truncate font-semibold text-app-text">{label}</span>
        <span className="shrink-0 font-bold tabular-nums text-app-text">{value}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className={`mt-1 w-full overflow-hidden rounded-full bg-app-border ${compact ? "h-1" : "h-2"}`}
      >
        <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300 ease-out" style={{ width: `${value}%` }} />
      </div>
      {detail && <p className={`mt-1 text-app-text-muted ${compact ? "text-[10px]" : "text-[11px]"}`}>{detail}</p>}
    </div>
  );
}
