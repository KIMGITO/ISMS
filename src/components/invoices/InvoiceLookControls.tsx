// Logo size, closing texts, QR code and stamp position: shared by the invoice sheet and
// Settings → Invoices, so both change the same things the same way.
import React from 'react';
import { Minus, Plus, RotateCcw, ZoomIn } from 'lucide-react';
import { Switch } from '../shared/Switch';
import { InvoiceDocument, InvoiceTexts } from '../../services/invoice/types';
import { LOGO_SIZE } from '../../services/invoice/invoiceSettings';

interface Props {
  texts: InvoiceTexts;
  set: (patch: Partial<InvoiceTexts>) => void;
  /** What the receipt settings give the invoice right now. */
  receipt: Pick<InvoiceDocument, 'closing' | 'qr'>;
  hasLogo: boolean;
}

export function InvoiceLookControls({ texts, set, receipt, hasLogo }: Props) {
  const size = texts.logoSize ?? LOGO_SIZE.default;
  const setSize = (n: number) => set({ logoSize: Math.min(LOGO_SIZE.max, Math.max(LOGO_SIZE.min, Math.round(n))) });
  const moved = !!texts.stampOffset && (texts.stampOffset.x !== 0 || texts.stampOffset.y !== 0);
  const closingParts = [receipt.closing?.message && 'line after the totals', receipt.closing?.policy && 'returns policy', receipt.closing?.thankYou && 'thank-you line'].filter(Boolean);
  const iconBtn = 'size-8 grid place-items-center rounded-lg bg-app-bg hover:bg-app-border/50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="space-y-3">
      <div>
        <span className="flex items-center justify-between text-xs font-medium text-app-text-muted mb-1">
          <span className="flex items-center gap-1.5"><ZoomIn size={13} /> Logo size</span>
          <span className="tabular-nums">{size} mm{size === LOGO_SIZE.default ? ' (standard)' : ''}</span>
        </span>
        <div className="flex items-center gap-2">
          <button type="button" className={iconBtn} onClick={() => setSize(size - 2)} disabled={size <= LOGO_SIZE.min} aria-label="Smaller logo"><Minus size={14} /></button>
          <input
            type="range"
            min={LOGO_SIZE.min}
            max={LOGO_SIZE.max}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="flex-1 accent-amber-500 cursor-pointer"
            aria-label="Logo size"
          />
          <button type="button" className={iconBtn} onClick={() => setSize(size + 2)} disabled={size >= LOGO_SIZE.max} aria-label="Bigger logo"><Plus size={14} /></button>
        </div>
        {!hasLogo && <span className="block mt-1 text-[11px] text-app-text-muted">No logo yet. Add one in Business settings.</span>}
      </div>

      <Switch
        checked={texts.closingFromReceipt !== false}
        onChange={(on) => set({ closingFromReceipt: on })}
        label="Close like the receipt"
        description={
          closingParts.length
            ? `The receipt's ${closingParts.join(', ')}, styled as on the receipt.`
            : 'The receipt has no closing texts yet (Settings → Receipts → Messages).'
        }
      />
      <Switch
        checked={texts.showQr !== false}
        onChange={(on) => set({ showQr: on })}
        label="QR code"
        description={receipt.qr ? `The receipt's QR code: ${receipt.qr.caption}.` : 'No QR code is chosen for receipts (Settings → Receipts → Codes).'}
      />
      {texts.showStamp && (
        <div className="flex items-center justify-between gap-2 text-xs text-app-text-muted">
          <span>Drag the stamp on the preview to move it.</span>
          {moved && (
            <button type="button" onClick={() => set({ stampOffset: { x: 0, y: 0 } })} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-app-bg hover:bg-app-border/50 text-app-text cursor-pointer">
              <RotateCcw size={12} /> Put back
            </button>
          )}
        </div>
      )}
    </div>
  );
}
