// A5 invoice PDF. Mirrors InvoicePaper (the on-screen preview), section by section.
import { jsPDF } from "jspdf";
import { InvoiceDocument } from "./types";
import { formatInvoiceDate, formatInvoiceMoney, formatPeriod, formatQty, headingNumber } from "./invoiceDraft";

const W = 148;
const H = 210;
const M = 12; // side margin
const FOOTER_H = 18;

type RGB = [number, number, number];
const INK: RGB = [17, 24, 39];
const MUTED: RGB = [120, 128, 142];
const RULE: RGB = [226, 230, 236];
const BAND: RGB = [246, 248, 251];

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [31, 111, 235];
}

/** Loads the logo as a PNG data URL, or null when it cannot be read (offline, no CORS). */
export async function loadLogo(url?: string): Promise<string | null> {
  if (!url || typeof document === "undefined") return null;
  if (url.startsWith("data:image/png") || url.startsWith("data:image/jpeg")) return url;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 5000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const size = 256;
        const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "•";
}

/** What the stamp says, shared with the on-screen preview. */
export function stampLines(inv: InvoiceDocument): { name: string[]; date: string; label: string; phone: string } {
  const words = (inv.from.name || "").toUpperCase().split(/\s+/).filter(Boolean);
  const name: string[] = [];
  for (const w of words) {
    const last = name[name.length - 1];
    if (last && (last + " " + w).length <= 14) name[name.length - 1] = last + " " + w;
    else name.push(w.slice(0, 16));
  }
  return { name: name.slice(0, 2), date: formatInvoiceDate(inv.issuedAt), label: (inv.texts.stampLabel || "").toUpperCase().slice(0, 18), phone: inv.from.phone || "" };
}

/** A rubber-stamp style seal: two rings, the business name, the date and a label, slightly tilted. */
function drawStamp(doc: jsPDF, inv: InvoiceDocument, cx: number, cy: number, r: number) {
  const c = hexToRgb(inv.texts.stampColor);
  const angle = 12; // degrees, counter-clockwise
  const a = (angle * Math.PI) / 180;
  const g = (doc as any).GState ? new (doc as any).GState({ opacity: 0.85 }) : null;
  if (g) doc.setGState(g);
  doc.setDrawColor(c[0], c[1], c[2]);
  doc.setTextColor(c[0], c[1], c[2]);
  doc.setLineWidth(0.7);
  doc.circle(cx, cy, r, "S");
  doc.setLineWidth(0.3);
  doc.circle(cx, cy, r - 1.6, "S");

  // Places centred text at a vertical offset from the centre, turned with the stamp.
  const put = (text: string, dy: number, size: number, bold: boolean, charSpace = 0) => {
    if (!text) return;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const w = doc.getTextWidth(text) + charSpace * Math.max(0, text.length - 1);
    const x = cx + (-w / 2) * Math.cos(a) + dy * Math.sin(a);
    const y = cy + (w / 2) * Math.sin(a) + dy * Math.cos(a);
    doc.text(text, x, y, { angle, charSpace } as any);
  };
  const rule = (dy: number, half: number) => {
    const p = (dx: number) => [cx + dx * Math.cos(a) + dy * Math.sin(a), cy - dx * Math.sin(a) + dy * Math.cos(a)];
    const [x1, y1] = p(-half);
    const [x2, y2] = p(half);
    doc.line(x1, y1, x2, y2);
  };

  const s = stampLines(inv);
  const nameTop = s.name.length > 1 ? -5.6 : -3.6;
  s.name.forEach((line, i) => put(line, nameTop + i * 2.6, 6, true, 0.15));
  rule(-1.1, r - 3.2);
  put(s.date, 2.4, 7.5, true);
  rule(3.6, r - 3.2);
  put(s.label, 6.2, 5.2, true, 0.4);
  put(s.phone, 8.6, 4.2, false);
  if (g) doc.setGState(new (doc as any).GState({ opacity: 1 }));
}

export async function buildInvoicePdf(inv: InvoiceDocument): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait" });
  const accent = hexToRgb(inv.accent);
  const t = inv.texts;
  const cur = inv.currency;
  const logo = await loadLogo(inv.logoUrl);

  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, style: "normal" | "bold" = "normal") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
  };
  const rule = (y: number) => {
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.setLineWidth(0.2);
    doc.line(M, y, W - M, y);
  };
  const topBar = () => {
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.rect(0, 0, W, 2, "F");
  };

  // Table columns: product takes what the numbers leave.
  const colAmountR = W - M;
  const colQtyX = W - M - 46;
  const colPriceX = W - M - 72;
  const productW = colPriceX - M - 4;

  const tableHeader = (y: number) => {
    rule(y);
    font(6.5, "normal");
    color(MUTED);
    const cs = 0.6;
    const opts = { charSpace: cs } as any;
    doc.text(t.productHeader.toUpperCase(), M, y + 5, opts);
    doc.text(t.priceHeader.toUpperCase(), colPriceX, y + 5, opts);
    doc.text(t.qtyHeader.toUpperCase(), colQtyX, y + 5, opts);
    // Letter spacing is not counted by right alignment, so place it by its real width.
    const amount = t.amountHeader.toUpperCase();
    doc.text(amount, colAmountR - doc.getTextWidth(amount) - cs * Math.max(0, amount.length - 1), y + 5, opts);
    rule(y + 8);
    return y + 8;
  };

  // ---- Page 1 header ----
  topBar();
  let y = 10;
  if (logo) {
    const props = doc.getImageProperties(logo);
    const h = 12;
    const w = Math.min(36, (props.width / props.height) * h);
    doc.addImage(logo, "PNG", M, y, w, h);
  } else {
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.circle(M + 6, y + 6, 6, "F");
    font(8.5, "bold");
    doc.setTextColor(255, 255, 255);
    doc.text(initials(inv.from.name), M + 6, y + 7.3, { align: "center" });
  }
  y += 22;

  font(16);
  color(INK);
  const heading = [t.title, headingNumber(inv)].filter(Boolean).join(" ");
  doc.text(heading, M, y);
  if (inv.invoiceNo) {
    font(8);
    color(MUTED);
    doc.text(inv.invoiceNo, W - M, y, { align: "right" });
  }
  y += 5;
  rule(y);
  y += 6;

  // Note on the left, dates on the right.
  font(7.5);
  color(MUTED);
  const dateBlock = `Date:  ${formatInvoiceDate(inv.issuedAt)}`;
  const dueBlock = inv.dueAt ? `Due date:  ${formatInvoiceDate(inv.dueAt)}` : "";
  doc.text(dueBlock || dateBlock, W - M, y, { align: "right" });
  if (dueBlock) doc.text(dateBlock, W - M - doc.getTextWidth(dueBlock) - 6, y, { align: "right" });
  const noteText = [t.note, inv.period ? `Period: ${formatPeriod(inv.period)}` : ""].filter(Boolean);
  if (noteText.length) {
    const room = W - 2 * M - doc.getTextWidth(dateBlock + dueBlock) - 14;
    // The note and the period each keep a line of their own.
    const noteLines = noteText.map((l) => doc.splitTextToSize(l, Math.max(30, room))[0] as string).slice(0, 2);
    font(7.5, "bold");
    color(INK);
    doc.text(noteLines, M, y);
    if (noteLines.length > 1) y += 3.5;
  }
  y += 4;
  rule(y);
  y += 7;

  // From / To
  const party = (p: InvoiceDocument["from"], label: string, right: boolean) => {
    const x = right ? W - M : M;
    const align = right ? "right" : "left";
    let py = y;
    font(6.5, "bold");
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text(label.toUpperCase() + ":", x, py, { align });
    py += 4.5;
    font(10, "bold");
    color(INK);
    for (const l of doc.splitTextToSize(p.name || "", 58).slice(0, 2)) {
      doc.text(l, x, py, { align });
      py += 4.5;
    }
    py += 1;
    font(7.5);
    for (const [v, c] of [[p.address, MUTED], [p.phone, INK], [p.email, INK], [p.extra, MUTED]] as Array<[string | undefined, RGB]>) {
      if (!v) continue;
      color(c);
      for (const l of doc.splitTextToSize(v, 58).slice(0, 2)) {
        doc.text(l, x, py, { align });
        py += 3.8;
      }
    }
    return py;
  };
  const endFrom = party(inv.from, t.fromLabel, false);
  const endTo = party(inv.to, t.toLabel, true);
  y = Math.max(endFrom, endTo) + 5;

  // ---- Lines ----
  y = tableHeader(y);
  const bottomLimit = H - FOOTER_H - 8;
  inv.lines.forEach((line, i) => {
    font(8.5, "normal");
    const desc = doc.splitTextToSize(line.description || " ", productW) as string[];
    const rowH = 3 + desc.length * 3.6 + (line.date ? 2.9 : 0) + 1.8;
    if (y + rowH > bottomLimit) {
      font(7);
      color(MUTED);
      doc.text("Continued on the next page", W - M, H - 8, { align: "right" });
      doc.addPage();
      topBar();
      y = tableHeader(12);
    }
    if (i % 2 === 1) {
      doc.setFillColor(BAND[0], BAND[1], BAND[2]);
      doc.rect(M - 2, y + 0.4, W - 2 * M + 4, rowH - 0.8, "F");
    }
    let ry = y + 4.6;
    font(8.5, "normal");
    color(INK);
    doc.text(desc, M, ry);
    doc.text(formatInvoiceMoney(line.unitPrice, "").trim(), colPriceX, ry);
    const qty = formatQty(line.quantity);
    doc.text(qty, colQtyX, ry);
    if (line.unit) {
      font(7);
      color(MUTED);
      doc.text(line.unit, colQtyX + doc.getTextWidth(qty) + 2.5, ry);
    }
    font(8.5, "bold");
    color(INK);
    doc.text(formatInvoiceMoney(line.amount, "").trim(), colAmountR, ry, { align: "right" });
    if (line.date) {
      font(6.5);
      color(MUTED);
      doc.text(formatInvoiceDate(line.date), M, ry + desc.length * 3.6 - 0.6);
    }
    y += rowH;
  });
  rule(y);
  y += 6;

  // ---- Totals ----
  const totals: Array<[string, string, boolean?]> = [[`Subtotal`, formatInvoiceMoney(inv.totals.subtotal, cur)]];
  if (inv.totals.tax > 0) totals.push(["Tax", formatInvoiceMoney(inv.totals.tax, cur)]);
  totals.push(["Discount", inv.totals.discount > 0 ? `-${formatInvoiceMoney(inv.totals.discount, cur)}` : "-"]);
  if (inv.totals.paid > 0) totals.push(["Already paid", `-${formatInvoiceMoney(inv.totals.paid, cur)}`]);
  const owedNowNote = inv.totals.owedNow !== undefined && Math.abs(inv.totals.owedNow - inv.totals.balance) > 0.009;
  // The totals block; payment details and the stamp sit beside it, not below.
  const needed = Math.max(totals.length * 5.2 + 8 + (owedNowNote ? 5 : 0), t.showStamp ? 30 : 0);
  if (y + needed > H - FOOTER_H - 4) {
    doc.addPage();
    topBar();
    y = 16;
  }
  const labelX = W - M - 62;
  for (const [label, value] of totals) {
    font(8);
    color(MUTED);
    doc.text(label, labelX, y);
    font(8, "bold");
    color(INK);
    doc.text(value, W - M, y, { align: "right" });
    y += 5.2;
  }
  y += 1.5;
  font(8.5);
  color(MUTED);
  doc.text(`Balance due (${cur})`, labelX, y + 1);
  font(13, "bold");
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(formatInvoiceMoney(inv.totals.balance, cur), W - M, y + 1.5, { align: "right" });
  if (owedNowNote) {
    font(6.5);
    color(MUTED);
    doc.text(`Owed on the whole account: ${formatInvoiceMoney(inv.totals.owedNow!, cur)}`, W - M, y + 6.5, { align: "right" });
  }

  const blockTop = y - totals.length * 5.2 - 1.5;
  const stampR = 13;
  if (t.showStamp) drawStamp(doc, inv, labelX - stampR - 4, blockTop + stampR - 2, stampR);
  if (t.showPaymentDetails && t.paymentInstructions) {
    font(7.5);
    color(MUTED);
    const room = labelX - M - 6 - (t.showStamp ? stampR * 2 + 4 : 0);
    const lines = doc.splitTextToSize(t.paymentInstructions, Math.max(24, room)).slice(0, 6);
    const top = blockTop;
    font(6.5, "bold");
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text("HOW TO PAY", M, top, { charSpace: 0.5 } as any);
    font(7.5);
    color(INK);
    doc.text(lines, M, top + 4.5);
  }

  // ---- Footer band (last page) ----
  doc.setFillColor(BAND[0], BAND[1], BAND[2]);
  doc.rect(0, H - FOOTER_H, W, FOOTER_H, "F");
  font(13);
  color(INK);
  if (t.thankYou) doc.text(t.thankYou, M, H - FOOTER_H / 2 + 1.8);
  if (t.footer) {
    font(7);
    color(MUTED);
    const room = W - 2 * M - (t.thankYou ? doc.getTextWidth(t.thankYou) * (13 / 7) + 8 : 0);
    const f = doc.splitTextToSize(t.footer, Math.max(40, room)).slice(0, 2);
    doc.text(f, W - M, H - FOOTER_H / 2 + (f.length > 1 ? -0.6 : 1.2), { align: "right" });
  }
  return doc;
}
