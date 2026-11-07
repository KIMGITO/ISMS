import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bluetooth, Wifi, RefreshCw, Printer, X, Plus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { printerService } from '../../services/printer/PrinterService';
import { DiscoveredPrinter, PrinterTarget } from '../../services/printer/types';
import { useOverlay } from '../../hooks/useOverlay';

interface Props {
  open: boolean;
  /** What will be printed, shown in the confirm button ("Print receipt", "Print test page"). */
  actionLabel: string;
  onCancel: () => void;
  /** Called with the confirmed printer. Throw to show the error and keep the picker open. */
  onConfirm: (printer: PrinterTarget) => Promise<void>;
}

const kbd = 'hidden sm:inline-block ml-1.5 px-1 rounded border border-current/30 text-[10px] font-mono opacity-70';

/**
 * Searches for printers every time it opens, then asks which one to use.
 * Only printers that answered the search can be chosen.
 */
export function PrinterPicker({ open, actionLabel, onCancel, onConfirm }: Props) {
  const support = printerService.support();
  const [searching, setSearching] = useState(false);
  const [printers, setPrinters] = useState<DiscoveredPrinter[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualIp, setManualIp] = useState('');
  const [adding, setAdding] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRun = useRef(0);

  useOverlay(open, onCancel, 'dialog');

  const search = useCallback(async () => {
    const run = ++searchRun.current;
    setSearching(true);
    setError(null);
    setProblems([]);
    try {
      const result = await printerService.discover();
      if (run !== searchRun.current) return;
      setPrinters(result.printers);
      setProblems(result.problems);
      const usable = result.printers.filter((p) => p.available);
      const preferred = printerService.getPrefs().defaultId;
      setSelected((current) =>
        usable.some((p) => p.id === current) ? current : usable.find((p) => p.id === preferred)?.id ?? usable[0]?.id ?? null,
      );
    } finally {
      if (run === searchRun.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPrinters([]);
    setSelected(null);
    setError(null);
    if (printerService.canPrint()) search();
    dialogRef.current?.focus();
    return () => {
      searchRun.current++;
    };
  }, [open, search]);

  const chosen = printers.find((p) => p.id === selected && p.available) || null;

  const confirm = useCallback(async () => {
    if (!chosen || printing) return;
    setPrinting(true);
    setError(null);
    try {
      await onConfirm(chosen);
      printerService.remember(chosen, true);
    } catch (err: any) {
      setError(err?.message || 'The printer did not print. Check that it is on and has paper.');
    } finally {
      setPrinting(false);
    }
  }, [chosen, printing, onConfirm]);

  const addByIp = async () => {
    if (!manualIp.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const printer = await printerService.addNetworkPrinter(manualIp);
      setManualIp('');
      await search();
      setSelected(printer.id);
    } catch (err: any) {
      setError(err?.message || 'Could not add that printer.');
    } finally {
      setAdding(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') {
      if (e.key === 'Enter') {
        e.preventDefault();
        addByIp();
      }
      return;
    }
    const usable = printers.filter((p) => p.available);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    } else if (e.key.toLowerCase() === 'r' && !searching) {
      e.preventDefault();
      search();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && usable.length) {
      e.preventDefault();
      const index = usable.findIndex((p) => p.id === selected);
      const next = e.key === 'ArrowDown' ? Math.min(usable.length - 1, index + 1) : Math.max(0, index - 1);
      setSelected(usable[next].id);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={onCancel}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="printer-picker-title"
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-app-card text-app-text rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85dvh] outline-none pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
          <h2 id="printer-picker-title" className="text-base font-semibold flex items-center gap-2">
            <Printer size={18} className="text-amber-500" /> Choose a printer
          </h2>
          <button type="button" onClick={onCancel} aria-label="Cancel" className="p-2 -mr-2 rounded-full hover:bg-app-bg cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {!printerService.canPrint() ? (
          <p className="px-4 pb-5 text-sm text-app-text-muted">{support.reason}</p>
        ) : (
          <>
            <div className="px-4 pb-2 flex items-center justify-between text-xs text-app-text-muted">
              <span>
                {searching
                  ? `Searching ${[support.bluetooth && 'Bluetooth', support.network && 'Wi-Fi'].filter(Boolean).join(' and ')}…`
                  : `${printers.filter((p) => p.available).length} printer(s) found`}
              </span>
              <button
                type="button"
                onClick={search}
                disabled={searching}
                className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-app-bg disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw size={13} className={searching ? 'animate-spin' : ''} /> Search again<span className={kbd}>R</span>
              </button>
            </div>

            <ul className="flex-1 min-h-0 overflow-y-auto px-2" role="listbox" aria-label="Printers">
              {printers.map((p) => {
                const Icon = p.kind === 'bluetooth' ? Bluetooth : Wifi;
                const isSelected = p.id === selected && p.available;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={!p.available}
                      onClick={() => setSelected(p.id)}
                      onDoubleClick={() => p.available && confirm()}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left cursor-pointer disabled:cursor-not-allowed ${
                        isSelected ? 'bg-amber-500/15 ring-1 ring-amber-500' : 'hover:bg-app-bg'
                      } ${p.available ? '' : 'opacity-50'}`}
                    >
                      <Icon size={18} className={p.available ? 'text-amber-500' : 'text-app-text-muted'} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{p.name}</span>
                        <span className="block text-xs text-app-text-muted truncate">
                          {p.kind === 'network' ? `${p.address}:${p.port ?? 9100}` : p.address}
                          {' · '}
                          {p.available ? (p.kind === 'bluetooth' ? (p.paired ? 'Paired, nearby' : 'Nearby, will pair') : 'Answering') : 'Not found — is it on?'}
                        </span>
                      </span>
                      {isSelected && <CheckCircle2 size={18} className="text-amber-500 shrink-0" />}
                    </button>
                  </li>
                );
              })}
              {!searching && printers.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-app-text-muted">
                  No printers found. Switch the printer on{support.bluetooth ? ', keep it close to this phone' : ''}
                  {support.network ? ', and make sure it is on the same Wi-Fi' : ''}.
                </li>
              )}
            </ul>

            {problems.length > 0 && (
              <div className="mx-4 mt-2 p-2.5 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs space-y-0.5">
                {problems.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            )}

            {support.network && (
              <div className="px-4 pt-3 flex gap-2">
                <input
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  inputMode="decimal"
                  placeholder="Add Wi-Fi printer by IP, e.g. 192.168.1.50"
                  aria-label="Printer IP address"
                  className="flex-1 min-w-0 bg-app-bg px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={addByIp}
                  disabled={adding || !manualIp.trim()}
                  className="px-3 py-2 rounded-lg bg-app-bg text-sm font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                >
                  {adding ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />} Add
                </button>
              </div>
            )}

            {error && (
              <p role="alert" className="mx-4 mt-3 p-2.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-sm flex gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
              </p>
            )}

            <div className="p-4 flex gap-2">
              <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl bg-app-bg text-sm font-medium cursor-pointer">
                Cancel<span className={kbd}>Esc</span>
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={!chosen || printing}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {printing ? <RefreshCw size={15} className="animate-spin" /> : <Printer size={15} />}
                {printing ? 'Printing…' : chosen ? `${actionLabel} on ${chosen.name}` : actionLabel}
                {!printing && <span className={kbd}>Enter</span>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
