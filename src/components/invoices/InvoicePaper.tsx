// The invoice as it will look on A5 paper. Same sections as invoicePdf.ts.
// It scales with its container (sizes are in cqw), so it fits any screen without overflowing.
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { InvoiceDocument } from '../../services/invoice/types';
import { formatInvoiceDate, formatInvoiceMoney, formatPeriod, formatQty } from '../../services/invoice/invoiceDraft';
import { closingOf, initials, logoHeightOf, stampLines, stampOffsetOf, STAMP_LIMITS, THANKS_GREEN } from '../../services/invoice/invoicePdf';

/** mm on the A5 page as a CSS length that scales with the preview. */
const mm = (v: number) => `calc(${v} * 100cqw / 148)`;

interface Props {
  doc: InvoiceDocument;
  className?: string;
  /** When given, the stamp can be dragged (or moved with the arrow keys) and this gets its new place. */
  onStampMove?: (offset: { x: number; y: number }) => void;
}

export function InvoicePaper({ doc, className = '', onStampMove }: Props) {
  const t = doc.texts;
  const closing = closingOf(doc);
  const cur = doc.currency;
  const accent = doc.accent;
  const money = (v: number) => formatInvoiceMoney(v, '').trim();
  const [logoFailed, setLogoFailed] = React.useState(false);

  return (
    <div className={`w-full ${className}`} style={{ containerType: 'inline-size' }}>
      <div
        data-invoice-paper
        className="relative bg-white text-[#111827] shadow-sm ring-1 ring-black/10 flex flex-col overflow-hidden"
        // A5 is 148 x 210 mm; 1mm = 100cqw / 148. At least one page tall; long invoices grow
        // here, while the PDF moves them onto more pages.
        style={{ minHeight: 'calc(100cqw * 210 / 148)', fontSize: 'calc(100cqw / 148 * 2.9)' }}
        aria-label="Invoice preview"
      >
        <div style={{ height: '1.35%', background: accent }} />
        <div className="flex-1 flex flex-col" style={{ padding: '0 8.1%' }}>
          {/* Logo */}
          <div style={{ marginTop: '6.8%', height: mm(logoHeightOf(doc)) }}>
            {doc.logoUrl && !logoFailed ? (
              <img src={doc.logoUrl} alt="" onError={() => setLogoFailed(true)} className="h-full w-auto object-contain object-left" style={{ maxWidth: mm(logoHeightOf(doc) * 3) }} />
            ) : (
              <span className="inline-grid place-items-center rounded-full text-white font-bold h-full aspect-square" style={{ background: accent, fontSize: mm(logoHeightOf(doc) * 0.35) }}>
                {initials(doc.from.name)}
              </span>
            )}
          </div>

          {/* Title and number */}
          <div className="flex items-baseline justify-between gap-2" style={{ marginTop: '6%' }}>
            <h2 style={{ fontSize: '2.05em', lineHeight: 1.1 }}>{t.title}</h2>
            <span className="text-[#78808e]" style={{ fontSize: '0.95em' }}>{doc.invoiceNo || 'Number given when issued'}</span>
          </div>
          <div className="border-t border-[#e2e6ec]" style={{ marginTop: '3%' }} />

          {/* Note and dates */}
          <div className="flex items-start justify-between gap-3" style={{ padding: '3.2% 0', fontSize: '0.9em' }}>
            <span className="font-semibold min-w-0">
              {t.note && <span className="block truncate">{t.note}</span>}
              {doc.period && <span className="block">Period: {formatPeriod(doc.period)}</span>}
            </span>
            <span className="shrink-0 text-[#78808e] whitespace-nowrap">
              Date: <b className="text-[#111827]">{formatInvoiceDate(doc.issuedAt)}</b>
              {doc.dueAt && (
                <>
                  <span style={{ marginLeft: '1.4em' }}>Due date: </span>
                  <b className="text-[#111827]">{formatInvoiceDate(doc.dueAt)}</b>
                </>
              )}
            </span>
          </div>
          <div className="border-t border-[#e2e6ec]" />

          {/* From / To */}
          <div className="grid grid-cols-2 gap-4" style={{ marginTop: '5%' }}>
            {[
              { p: doc.from, label: t.fromLabel, right: false },
              { p: doc.to, label: t.toLabel, right: true },
            ].map(({ p, label, right }) => (
              <div key={label} className={`min-w-0 ${right ? 'text-right' : ''}`} style={{ fontSize: '0.9em', lineHeight: 1.45 }}>
                <div className="font-bold uppercase" style={{ color: accent, fontSize: '0.85em' }}>{label}:</div>
                <div className="font-bold break-words" style={{ fontSize: '1.3em', lineHeight: 1.25, marginBottom: '0.4em' }}>{p.name}</div>
                {p.address && <div className="text-[#78808e] break-words">{p.address}</div>}
                {p.phone && <div className="break-words">{p.phone}</div>}
                {p.email && <div className="break-all">{p.email}</div>}
                {p.extra && <div className="text-[#78808e] break-words">{p.extra}</div>}
              </div>
            ))}
          </div>

          {/* Lines */}
          <div style={{ marginTop: '6%', fontSize: '0.95em' }}>
            <div className="grid border-y border-[#e2e6ec] text-[#78808e] uppercase" style={{ gridTemplateColumns: 'minmax(0,1fr) 18% 17% 22%', padding: '0.9em 0', fontSize: '0.75em', letterSpacing: '0.12em' }}>
              <span>{t.productHeader}</span>
              <span>{t.priceHeader}</span>
              <span>{t.qtyHeader}</span>
              <span className="text-right">{t.amountHeader}</span>
            </div>
            {doc.lines.map((l, i) => (
              <div
                key={l.id}
                className="grid items-start"
                style={{ gridTemplateColumns: 'minmax(0,1fr) 18% 17% 22%', padding: '0.85em 0.4em', margin: '0 -0.4em', background: i % 2 ? '#f6f8fb' : undefined }}
              >
                <span className="min-w-0 break-words pr-2">
                  {l.description}
                  {l.date && <span className="block text-[#78808e]" style={{ fontSize: '0.78em' }}>{formatInvoiceDate(l.date)}</span>}
                </span>
                <span className="tabular-nums">{money(l.unitPrice)}</span>
                <span className="tabular-nums">
                  {formatQty(l.quantity)}
                  {l.unit && <span className="text-[#78808e]" style={{ fontSize: '0.85em' }}> {l.unit}</span>}
                </span>
                <span className="text-right font-bold tabular-nums">{money(l.amount)}</span>
              </div>
            ))}
            <div className="border-t border-[#e2e6ec]" />
          </div>

          {/* Totals */}
          <div className="flex gap-4 justify-between" style={{ marginTop: '4%', fontSize: '0.9em' }}>
            <div className="min-w-0 flex-1 flex items-start gap-3">
              <div className="min-w-0 flex-1">
              {t.showPaymentDetails && t.paymentInstructions && (
                <>
                  <div className="font-bold uppercase" style={{ color: accent, fontSize: '0.8em', letterSpacing: '0.08em' }}>How to pay</div>
                  <div className="whitespace-pre-line break-words" style={{ marginTop: '0.3em' }}>{t.paymentInstructions}</div>
                </>
              )}
              </div>
              {t.showStamp && <Stamp doc={doc} onMove={onStampMove} />}
            </div>
            <div className="shrink-0" style={{ width: '48%', lineHeight: 1.9 }}>
              <Row label="Subtotal" value={formatInvoiceMoney(doc.totals.subtotal, cur)} />
              {doc.totals.tax > 0 && <Row label="Tax" value={formatInvoiceMoney(doc.totals.tax, cur)} />}
              <Row label="Discount" value={doc.totals.discount > 0 ? `-${formatInvoiceMoney(doc.totals.discount, cur)}` : '-'} />
              {doc.totals.paid > 0 && <Row label="Already paid" value={`-${formatInvoiceMoney(doc.totals.paid, cur)}`} />}
              <div className="flex items-baseline justify-between gap-2" style={{ marginTop: '0.3em' }}>
                <span className="text-[#78808e]">Balance due ({cur})</span>
                <span className="font-bold tabular-nums" style={{ color: accent, fontSize: '1.55em' }}>{formatInvoiceMoney(doc.totals.balance, cur)}</span>
              </div>
              {doc.totals.owedNow !== undefined && Math.abs(doc.totals.owedNow - doc.totals.balance) > 0.009 && (
                <div className="text-right text-[#78808e]" style={{ fontSize: '0.8em' }}>Owed on the whole account: {formatInvoiceMoney(doc.totals.owedNow, cur)}</div>
              )}
            </div>
          </div>

          {/* Closing, as on the receipt: the line after the totals, the returns policy, the QR code */}
          {(closing.message || closing.policy || closing.qr) && (
            <div className="flex items-end justify-between gap-4" style={{ marginTop: '5%', fontSize: '0.85em', lineHeight: 1.45 }}>
              <div className="min-w-0 flex-1 text-center">
                {closing.message && <div className="whitespace-pre-line break-words">{closing.message}</div>}
                {closing.policy && <div className="italic text-[#78808e] whitespace-pre-line break-words" style={{ marginTop: closing.message ? '0.5em' : 0 }}>{closing.policy}</div>}
              </div>
              {closing.qr && (
                <div className="shrink-0 text-center" style={{ width: mm(24) }}>
                  <QrImage data={closing.qr.url} />
                  <div className="text-[#78808e]" style={{ fontSize: '0.85em', lineHeight: 1.2 }}>{closing.qr.caption}</div>
                </div>
              )}
            </div>
          )}
          <div className="flex-1" style={{ minHeight: '1.5em' }} />
        </div>

        {/* Footer band */}
        <div className="flex items-center justify-between gap-3 bg-[#f6f8fb]" style={{ padding: '4.5% 8.1%' }}>
          <span
            className={closing.thankYouStyled ? 'font-bold' : ''}
            style={{ fontSize: closing.thankYouStyled ? '1.35em' : '1.65em', color: closing.thankYouStyled ? THANKS_GREEN : undefined }}
          >
            {closing.thankYou}
          </span>
          <span className="text-[#78808e] text-right min-w-0 break-words" style={{ fontSize: '0.85em' }}>{t.footer}</span>
        </div>
      </div>
    </div>
  );
}

function QrImage({ data }: { data: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(data, { errorCorrectionLevel: 'M', margin: 1, width: 240 })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(''));
    return () => {
      live = false;
    };
  }, [data]);
  return src ? <img src={src} alt="QR code" className="w-full aspect-square [image-rendering:pixelated]" /> : <div className="w-full aspect-square" />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[#78808e]">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}

/** The business stamp, drawn the same way as in the PDF. Draggable when `onMove` is given. */
function Stamp({ doc, onMove }: { doc: InvoiceDocument; onMove?: (offset: { x: number; y: number }) => void }) {
  const st = stampLines(doc);
  const c = doc.texts.stampColor;
  const saved = stampOffsetOf(doc);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ px: number; py: number; ox: number; oy: number; mmPerPx: number } | null>(null);
  const pos = drag || saved;
  const clampPos = (x: number, y: number) => ({
    x: Math.round(Math.min(STAMP_LIMITS.maxX, Math.max(STAMP_LIMITS.minX, x)) * 10) / 10,
    y: Math.round(Math.min(STAMP_LIMITS.maxY, Math.max(STAMP_LIMITS.minY, y)) * 10) / 10,
  });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onMove || e.button > 0) return;
    const paper = e.currentTarget.closest('[data-invoice-paper]') as HTMLElement | null;
    if (!paper) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, ox: saved.x, oy: saved.y, mmPerPx: 148 / paper.clientWidth };
    setDrag(saved);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const s = start.current;
    if (!s) return;
    setDrag(clampPos(s.ox + (e.clientX - s.px) * s.mmPerPx, s.oy + (e.clientY - s.py) * s.mmPerPx));
  };
  const onPointerUp = () => {
    if (!start.current) return;
    start.current = null;
    if (drag && onMove) onMove(drag);
    setDrag(null);
  };
  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (!onMove) return;
    const step = e.shiftKey ? 5 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    onMove(clampPos(saved.x + d[0], saved.y + d[1]));
  };

  // Text sits inside the inner ring: two name lines at 29 and 38, one at 38.
  const nameY = (i: number) => (st.name.length > 1 ? 29 + i * 9 : 38);
  return (
    <svg
      viewBox="0 0 100 100"
      className={`shrink-0 relative z-10 ${onMove ? 'cursor-move touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-full' : ''}`}
      style={{ width: mm(26), height: mm(26), opacity: 0.85, transform: `translate(${mm(pos.x)}, ${mm(pos.y)})` }}
      role="img"
      aria-label={onMove ? `Stamp: ${doc.from.name}. Drag, or use the arrow keys, to move it.` : `Stamp: ${doc.from.name}`}
      tabIndex={onMove ? 0 : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {onMove && <title>Drag to move the stamp</title>}
      <g transform="rotate(-12 50 50)" fill={c} stroke={c} fontFamily="Helvetica, Arial, sans-serif" textAnchor="middle">
        <circle cx="50" cy="50" r="48" fill="none" strokeWidth="2.6" />
        <circle cx="50" cy="50" r="42" fill="none" strokeWidth="1.1" />
        {st.name.map((line, i) => (
          <text key={i} x="50" y={nameY(i)} fontSize="8" fontWeight="700" stroke="none" letterSpacing="0.4">{line}</text>
        ))}
        <line x1="22" y1="46" x2="78" y2="46" strokeWidth="1.1" />
        <text x="50" y="59" fontSize="11.5" fontWeight="700" stroke="none">{st.date}</text>
        <line x1="22" y1="63.5" x2="78" y2="63.5" strokeWidth="1.1" />
        <text x="50" y="73" fontSize="7.5" fontWeight="700" stroke="none" letterSpacing="1.5">{st.label}</text>
        {st.phone && <text x="50" y="81" fontSize="6" stroke="none">{st.phone}</text>}
      </g>
    </svg>
  );
}
