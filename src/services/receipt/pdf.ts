// Receipt PDF drawn from the same lines as the paper receipt, at the configured roll width.
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { ReceiptLine, columnsFor } from "./layout";
import { code128Modules } from "./code128";
import { BusinessReceiptSettings } from "./types";

const PT_TO_MM = 25.4 / 72;
// Courier glyphs are 0.6 em wide.
const COURIER_WIDTH = 0.6;

interface Metrics {
  page: number;
  margin: number;
  printable: number;
  cols: number;
  fontPt: number;
  lineMm: number;
  qrMm: number;
  barHeightMm: number;
}

function metrics(settings: BusinessReceiptSettings): Metrics {
  const page = settings.paperWidth === "80mm" ? 80 : 58;
  const printable = settings.paperWidth === "80mm" ? 72 : 48;
  const cols = columnsFor(settings);
  const fontPt = printable / cols / COURIER_WIDTH / PT_TO_MM;
  return {
    page,
    margin: (page - printable) / 2,
    printable,
    cols,
    fontPt,
    lineMm: fontPt * 1.35 * PT_TO_MM,
    qrMm: Math.min(printable * 0.6, 38),
    barHeightMm: 10,
  };
}

function lineHeight(line: ReceiptLine, m: Metrics): number {
  switch (line.t) {
    case "text":
      return line.big ? m.lineMm * 2 : m.lineMm;
    case "qr":
      return m.qrMm + 2 + (line.caption ? m.lineMm : 0);
    case "barcode":
      return m.barHeightMm + m.lineMm + 2;
    default:
      return m.lineMm;
  }
}

export async function buildReceiptPdf(lines: ReceiptLine[], settings: BusinessReceiptSettings): Promise<jsPDF> {
  const m = metrics(settings);
  const top = 6;
  const bottom = 8;
  const height = top + lines.reduce((sum, l) => sum + lineHeight(l, m), 0) + bottom;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [m.page, Math.max(height, 60)] });
  doc.setTextColor(0, 0, 0);
  const center = m.page / 2;
  let y = top;

  const write = (text: string, align: "left" | "center" | "right", bold = false, big = false, italic = false, green = false) => {
    doc.setFont("courier", bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal");
    if (green) doc.setTextColor(21, 128, 61);
    else doc.setTextColor(0, 0, 0);
    doc.setFontSize(big ? m.fontPt * 2 : m.fontPt);
    const h = big ? m.lineMm * 2 : m.lineMm;
    const baseline = y + h * 0.78;
    const x = align === "left" ? m.margin : align === "right" ? m.page - m.margin : center;
    // Leading spaces matter in a monospaced layout, so left text is drawn as-is.
    doc.text(text, x, baseline, { align });
    y += h;
  };

  for (const line of lines) {
    if (line.t === "text") write(line.text, line.align, line.bold, line.big, line.italic, line.tone === "green");
    else if (line.t === "rule") write(line.ch.repeat(m.cols), "left");
    else if (line.t === "blank") y += m.lineMm;
    else if (line.t === "qr") {
      const url = await QRCode.toDataURL(line.data, { errorCorrectionLevel: "M", margin: 1, width: 360 });
      doc.addImage(url, "PNG", center - m.qrMm / 2, y + 1, m.qrMm, m.qrMm);
      y += m.qrMm + 2;
      if (line.caption) write(line.caption, "center");
    } else if (line.t === "barcode") {
      const modules = code128Modules(line.data);
      const moduleMm = Math.min(0.35, (m.printable * 0.9) / modules.length);
      let x = center - (modules.length * moduleMm) / 2;
      doc.setFillColor(0, 0, 0);
      for (const bar of modules) {
        if (bar) doc.rect(x, y + 1, moduleMm, m.barHeightMm, "F");
        x += moduleMm;
      }
      y += m.barHeightMm + 2;
      write(line.data, "center");
    }
  }
  return doc;
}
