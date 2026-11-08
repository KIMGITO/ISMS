// The invoice as it will look on A5 paper. Same sections as invoicePdf.ts.
// It scales with its container (sizes are in cqw), so it fits any screen without overflowing.
import React from 'react';
import { InvoiceDocument } from '../../services/invoice/types';
import { formatInvoiceDate, formatInvoiceMoney, formatPeriod, formatQty, headingNumber } from '../../services/invoice/invoiceDraft';
import { initials, stampLines } from '../../services/invoice/invoicePdf';

export function InvoicePaper({ doc, className = '' }: { doc: InvoiceDocument; className?: string }) {
  const t = doc.texts;
  const cur = doc.currency;
  const accent = doc.accent;
  const money = (v: number) => formatInvoiceMoney(v, '').trim();
  const [logoFailed, setLogoFailed] = React.useState(false);

  return (
    <div className={`w-full ${className}`} style={{ containerType: 'inline-size' }}>
      <div
        className="relative bg-white text-[#111827] shadow-sm ring-1 ring-black/10 flex flex-col overflow-hidden"
        // A5 is 148 x 210 mm; 1mm = 100cqw / 148. At least one page tall; long invoices grow
        // here, while the PDF moves them onto more pages.
        style={{ minHeight: 'calc(100cqw * 210 / 148)', fontSize: 'calc(100cqw / 148 * 2.9)' }}
        aria-label="Invoice preview"
      >
        <div style={{ height: '1.35%', background: accent }} />
        <div className="flex-1 flex flex-col" style={{ padding: '0 8.1%' }}>
          {/* Logo */}
          <div style={{ marginTop: '6.8%', height: '8.2cqw' }}>
            {doc.logoUrl && !logoFailed ? (
              <img src={doc.logoUrl} alt="" onError={() => setLogoFailed(true)} className="h-full w-auto object-contain" />
            ) : (
              <span className="inline-grid place-items-center rounded-full text-white font-bold h-full aspect-square" style={{ background: accent, fontSize: '0.95em' }}>
                {initials(doc.from.name)}
              </span>
            )}
          </div>

          {/* Title and number */}
          <div className="flex items-baseline justify-between gap-2" style={{ marginTop: '6%' }}>
            <h2 style={{ fontSize: '2.05em', lineHeight: 1.1 }}>{[t.title, headingNumber(doc)].filter(Boolean).join(' ')}</h2>
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
              {t.showStamp && <Stamp doc={doc} />}
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
          <div className="flex-1" style={{ minHeight: '1.5em' }} />
        </div>

        {/* Footer band */}
        <div className="flex items-center justify-between gap-3 bg-[#f6f8fb]" style={{ padding: '4.5% 8.1%' }}>
          <span style={{ fontSize: '1.65em' }}>{t.thankYou}</span>
          <span className="text-[#78808e] text-right min-w-0 break-words" style={{ fontSize: '0.85em' }}>{t.footer}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[#78808e]">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}

/** The business stamp, drawn the same way as in the PDF. */
function Stamp({ doc }: { doc: InvoiceDocument }) {
  const st = stampLines(doc);
  const c = doc.texts.stampColor;
  // Text sits inside the inner ring: two name lines at 29 and 38, one at 38.
  const nameY = (i: number) => (st.name.length > 1 ? 29 + i * 9 : 38);
  return (
    <svg viewBox="0 0 100 100" className="shrink-0" style={{ width: '17.5cqw', height: '17.5cqw', opacity: 0.85 }} role="img" aria-label={`Stamp: ${doc.from.name}`}>
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
