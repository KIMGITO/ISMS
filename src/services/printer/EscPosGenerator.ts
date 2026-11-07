// src/services/printer/EscPosGenerator.ts
// Turns receipt lines into ESC/POS bytes for 58mm/80mm thermal printers.
import QRCode from "qrcode";
import { ReceiptLine, Align, wrap } from "../receipt/layout";
import { code128Value } from "../receipt/code128";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export interface EscPosOptions {
  /** Characters per line in font A. */
  columns: number;
  /** Printable dots across the head (384 on 58mm, 576 on 80mm). */
  dots: number;
  autoCut: boolean;
  openDrawer?: boolean;
}

/** Printers use single-byte code pages; accents are folded and anything else becomes "?". */
export function toPrinterText(value: string): string {
  const folded = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...");
  // Per character, not per UTF-16 unit, so an emoji becomes one "?".
  return Array.from(folded, (ch) => (/^[\x20-\x7e]$/.test(ch) ? ch : "?")).join("");
}

class ByteWriter {
  private parts: number[] = [];
  push(...bytes: number[]) {
    for (const b of bytes) this.parts.push(b & 0xff);
  }
  text(value: string) {
    const clean = toPrinterText(value);
    for (let i = 0; i < clean.length; i++) this.parts.push(clean.charCodeAt(i));
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

const ALIGN: Record<Align, number> = { left: 0, center: 1, right: 2 };

function align(w: ByteWriter, a: Align) {
  w.push(ESC, 0x61, ALIGN[a]);
}

/** Draws a QR code as a raster image, which every ESC/POS printer supports (GS ( k does not). */
function rasterQr(w: ByteWriter, data: string, dots: number) {
  const qr = QRCode.create(data, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const quiet = 2;
  const target = Math.min(Math.floor(dots * 0.6), 300);
  const scale = Math.max(2, Math.floor(target / (size + quiet * 2)));
  const imagePx = (size + quiet * 2) * scale;
  const widthBytes = dots / 8;
  const left = Math.floor((dots - imagePx) / 2);

  const rows: Uint8Array[] = [];
  for (let y = 0; y < imagePx; y++) {
    const row = new Uint8Array(widthBytes);
    const my = Math.floor(y / scale) - quiet;
    for (let x = 0; x < imagePx; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const dark = my >= 0 && mx >= 0 && my < size && mx < size && qr.modules.get(my, mx);
      if (dark) {
        const px = left + x;
        row[px >> 3] |= 0x80 >> (px & 7);
      }
    }
    rows.push(row);
  }

  // Sent in bands; some printers drop a single tall image.
  align(w, "left");
  const band = 120;
  for (let start = 0; start < rows.length; start += band) {
    const slice = rows.slice(start, start + band);
    w.push(GS, 0x76, 0x30, 0x00, widthBytes & 0xff, widthBytes >> 8, slice.length & 0xff, slice.length >> 8);
    for (const row of slice) w.push(...row);
  }
}

function barcode(w: ByteWriter, data: string) {
  const value = code128Value(toPrinterText(data));
  if (!value) return;
  const payload = "{B" + value;
  align(w, "center");
  w.push(GS, 0x68, 60); // height in dots
  w.push(GS, 0x77, 2); // module width
  w.push(GS, 0x48, 2); // human-readable text below
  w.push(GS, 0x66, 0); // font A for that text
  w.push(GS, 0x6b, 73, payload.length);
  w.text(payload);
  w.push(LF);
}

export class EscPosGenerator {
  public static fromLines(lines: ReceiptLine[], options: EscPosOptions): Uint8Array {
    const w = new ByteWriter();
    w.push(ESC, 0x40); // initialise
    w.push(ESC, 0x74, 0); // code page PC437
    if (options.openDrawer) w.push(ESC, 0x70, 0, 25, 250);

    let bold = false;
    let big = false;
    for (const line of lines) {
      if (line.t === "text") {
        if (!!line.bold !== bold) {
          bold = !!line.bold;
          w.push(ESC, 0x45, bold ? 1 : 0);
        }
        if (!!line.big !== big) {
          big = !!line.big;
          w.push(GS, 0x21, big ? 0x11 : 0x00);
        }
        align(w, line.align);
        w.text(line.text);
        w.push(LF);
        continue;
      }
      if (bold) {
        bold = false;
        w.push(ESC, 0x45, 0);
      }
      if (big) {
        big = false;
        w.push(GS, 0x21, 0);
      }
      if (line.t === "rule") {
        align(w, "left");
        w.text(line.ch.repeat(options.columns));
        w.push(LF);
      } else if (line.t === "blank") {
        w.push(LF);
      } else if (line.t === "barcode") {
        barcode(w, line.data);
      } else if (line.t === "qr") {
        rasterQr(w, line.data, options.dots);
        if (line.caption) {
          align(w, "center");
          for (const l of wrap(line.caption, options.columns)) {
            w.text(l);
            w.push(LF);
          }
        }
      }
    }

    align(w, "left");
    w.push(ESC, 0x45, 0, GS, 0x21, 0);
    w.push(ESC, 0x64, 4); // feed past the tear bar
    if (options.autoCut) w.push(GS, 0x56, 66, 0); // partial cut
    return w.bytes();
  }
}
