import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ReceiptLine } from '../../services/receipt/layout';
import { code128Modules } from '../../services/receipt/code128';
import { PaperWidth } from '../../services/receipt/types';

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
  return src ? <img src={src} alt="QR code" className="mx-auto w-[18ch] h-[18ch] [image-rendering:pixelated]" /> : <div className="mx-auto w-[18ch] h-[18ch]" />;
}

function Barcode({ data }: { data: string }) {
  const modules = code128Modules(data);
  return (
    <svg viewBox={`0 0 ${modules.length} 40`} preserveAspectRatio="none" className="mx-auto h-10 w-[70%]" role="img" aria-label={`Barcode ${data}`}>
      {modules.map((bar, i) => (bar ? <rect key={i} x={i} y={0} width={1} height={40} fill="#000" /> : null))}
    </svg>
  );
}

/**
 * The receipt as it comes out of the printer: same lines, same characters per line.
 * Paper is always black on white, in light and dark themes.
 */
export function ReceiptPaper({ lines, columns, paperWidth }: { lines: ReceiptLine[]; columns: number; paperWidth: PaperWidth }) {
  return (
    <div className="overflow-x-auto">
      <div
        className="mx-auto bg-white text-black font-mono shadow-sm ring-1 ring-black/10 px-[2ch] py-4 text-[11px] leading-[1.35] sm:text-xs"
        style={{ width: `calc(${columns}ch + 4ch)` }}
        aria-label={`Receipt preview on ${paperWidth} paper`}
      >
        {lines.map((line, i) => {
          if (line.t === 'text') {
            return (
              <div
                key={i}
                className={`whitespace-pre ${line.bold ? 'font-bold' : ''} ${line.big ? 'text-[2em] leading-[1.2]' : ''}`}
                style={{ textAlign: line.align }}
              >
                {line.text || ' '}
              </div>
            );
          }
          if (line.t === 'rule') return <div key={i} className="whitespace-pre overflow-hidden">{line.ch.repeat(columns)}</div>;
          if (line.t === 'blank') return <div key={i}>&nbsp;</div>;
          if (line.t === 'barcode') {
            return (
              <div key={i} className="py-1 text-center">
                <Barcode data={line.data} />
                <div>{line.data}</div>
              </div>
            );
          }
          return (
            <div key={i} className="py-1 text-center">
              <QrImage data={line.data} />
              {line.caption && <div>{line.caption}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
