/**
 * The single receipt layout. The printer, the PDF, the on-screen preview and the
 * WhatsApp/email text are all drawn from these lines, so every copy matches the paper.
 */
import { BusinessReceiptSettings, ReceiptContent, PaperWidth } from "./types";
import { getShortId } from "../../utils/idUtils";

export type Align = "left" | "center" | "right";

export type ReceiptLine =
  | { t: "text"; text: string; align: Align; bold?: boolean; big?: boolean; italic?: boolean; tone?: "green" }
  | { t: "rule"; ch: "-" | "=" }
  | { t: "blank" }
  | { t: "qr"; data: string; caption?: string }
  | { t: "barcode"; data: string };

/** Characters per line in the printer's standard font. */
export function columnsFor(settings: Pick<BusinessReceiptSettings, "paperWidth" | "charsPerLine">): number {
  if (settings.charsPerLine) return settings.charsPerLine;
  return settings.paperWidth === "80mm" ? 48 : 32;
}

/** Printable dots across the head at 203 dpi. */
export function dotsFor(paper: PaperWidth): number {
  return paper === "80mm" ? 576 : 384;
}

export function formatMoney(value: number): string {
  return (Number(value) || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatQty(value: number): string {
  return String(Math.round((Number(value) || 0) * 1000) / 1000);
}

/** Word-wraps to width, breaking words that are longer than a line. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of String(text).replace(/\r/g, "").split("\n")) {
    // Leading spaces are layout (item detail indent), so the first line keeps them.
    const indent = (paragraph.match(/^ */)?.[0] ?? "").slice(0, Math.max(0, width - 1));
    let line = indent;
    for (let word of paragraph.split(/\s+/).filter(Boolean)) {
      while (word.length > width) {
        if (line.trim()) out.push(line);
        line = "";
        out.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!line.trim()) line = line.length + word.length <= width ? line + word : word;
      else if (line.length + 1 + word.length <= width) line += " " + word;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Left and right text on one line, or right moved to its own line when both do not fit. */
export function pair(left: string, right: string, width: number): string[] {
  if (left.length + 1 + right.length <= width) {
    return [left + " ".repeat(width - left.length - right.length) + right];
  }
  const lines = wrap(left, width);
  for (const r of wrap(right, width)) lines.push(" ".repeat(Math.max(0, width - r.length)) + r);
  return lines;
}

/** Splits a long code into groups of four for readability: ABCD-EFGH-IJKL. */
function grouped(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").match(/.{1,4}/g)?.join("-") || code;
}

export function buildReceiptLines(content: ReceiptContent, settings: BusinessReceiptSettings): ReceiptLine[] {
  const w = columnsFor(settings);
  const lines: ReceiptLine[] = [];
  const text = (value: string, align: Align = "left", extra: { bold?: boolean; big?: boolean; italic?: boolean; tone?: "green" } = {}) => {
    // Large print is double width, so it holds half as many characters.
    const width = extra.big ? Math.floor(w / 2) : w;
    for (const l of wrap(value, width)) lines.push({ t: "text", text: l, align, ...extra });
  };
  const row = (left: string, right: string, bold = false) => {
    for (const l of pair(left, right, w)) lines.push({ t: "text", text: l, align: "left", bold });
  };
  const rule = (ch: "-" | "=" = "-") => lines.push({ t: "rule", ch });
  const cur = settings.currencyFormat || "KSh";

  // Header
  if (settings.businessName) text(settings.businessName.toUpperCase(), "center", { bold: true, big: true });
  if (settings.headerMessage) text(settings.headerMessage, "center");
  if (settings.address) text(settings.address, "center");
  if (settings.phone) text(`Tel: ${settings.phone}`, "center");
  if (settings.email) text(settings.email, "center");
  if (settings.website) text(settings.website, "center");
  if (settings.pinNumber) text(`PIN: ${settings.pinNumber}`, "center");
  if (settings.registrationNumber) text(`Reg No: ${settings.registrationNumber}`, "center");
  rule("=");

  // Sale details
  row("Receipt:", content.receiptNumber, true);
  row("Date:", `${content.transactionDate} ${content.transactionTime}`);
  if (content.cashierName) row("Served by:", content.cashierName);
  if (content.customerName) row("Customer:", content.customerName);
  if (content.customerPhone) row("Phone:", content.customerPhone);
  rule();

  // Items
  row("ITEM", "TOTAL", true);
  rule();
  for (const item of content.items) {
    text(item.name, "left", { bold: true });
    const unit = item.unit && !/^(unit|units|pcs?|piece|pieces)$/i.test(item.unit) ? ` ${item.unit}` : "";
    row(`  ${formatQty(item.quantity)}${unit} x ${formatMoney(item.unitPrice)}`, formatMoney(item.total));
    if (item.discountPercentage > 0) text(`  Less ${formatQty(item.discountPercentage)}% discount`);
  }
  rule();

  // Totals
  row("Subtotal", formatMoney(content.subtotal));
  if (content.discount > 0) row("Discount", `-${formatMoney(content.discount)}`);
  if (content.taxTotal > 0) row(content.taxRate ? `VAT ${formatQty(content.taxRate)}%` : "VAT", formatMoney(content.taxTotal));
  if (content.deliveryFee > 0) row("Delivery", formatMoney(content.deliveryFee));
  rule("=");
  row("TOTAL", `${cur} ${formatMoney(content.grandTotal)}`, true);
  if (content.amountPaid > 0) row(`Paid (${content.paymentMethod})`, `${cur} ${formatMoney(content.amountPaid)}`);
  if (content.balanceDue > 0) {
    row("Payment:", content.paymentMethod);
    row("BALANCE DUE", `${cur} ${formatMoney(content.balanceDue)}`, true);
  }
  rule("=");

  // Footer
  if (content.note) text(`Note: ${content.note}`);
  if (settings.footerMessage) text(settings.footerMessage, "center");
  if (settings.showBarcode) {
    lines.push({ t: "blank" });
    lines.push({ t: "barcode", data: getShortId(content.receiptId) });
  }

  // KRA block: only for a sale KRA has actually signed.
  const kra = content.kra;
  if (kra) {
    lines.push({ t: "blank" });
    text(kra.environment === "sandbox" ? "KRA eTIMS (TEST - NOT VALID)" : "KRA eTIMS TAX INVOICE", "center", { bold: true });
    rule();
    row("PIN:", kra.pin);
    row("CU Serial No:", kra.sdcId);
    row("CU Invoice No:", `${kra.sdcId}/${kra.rcptNo}`);
    if (kra.signedAt) row("CU Date:", kra.signedAt);
    text("Internal Data:");
    text(grouped(kra.internalData));
    text("Receipt Signature:");
    text(grouped(kra.signature));
    lines.push({ t: "qr", data: kra.qrUrl, caption: "Scan to verify with KRA" });
  }

  if (content.extraQr) {
    lines.push({ t: "blank" });
    lines.push({ t: "qr", data: content.extraQr.url, caption: content.extraQr.caption });
  }

  // The returns policy and the thank-you line always close the receipt.
  if (settings.returnPolicy || settings.thankYouMessage) lines.push({ t: "blank" });
  if (settings.returnPolicy) text(settings.returnPolicy, "center", { italic: true });
  if (settings.thankYouMessage) text(settings.thankYouMessage, "center", { bold: true, tone: "green" });
  return lines;
}

function alignText(value: string, align: Align, width: number): string {
  if (align === "left" || value.length >= width) return value;
  const pad = width - value.length;
  return align === "right" ? " ".repeat(pad) + value : " ".repeat(Math.floor(pad / 2)) + value;
}

/**
 * The paper receipt as monospaced text. Codes cannot be drawn in text, so their
 * links are returned separately to be sent after the receipt.
 */
export function linesToText(lines: ReceiptLine[], width: number): { body: string; links: Array<{ caption: string; url: string }> } {
  const out: string[] = [];
  const links: Array<{ caption: string; url: string }> = [];
  for (const line of lines) {
    if (line.t === "text") out.push(alignText(line.text, line.align, width));
    else if (line.t === "rule") out.push(line.ch.repeat(width));
    else if (line.t === "blank") out.push("");
    else if (line.t === "barcode") out.push(alignText(`|| ${line.data} ||`, "center", width));
    else if (line.t === "qr") {
      links.push({ caption: line.caption || "Link", url: line.data });
      if (line.caption) for (const l of wrap(`(${line.caption} below)`, width)) out.push(alignText(l, "center", width));
    }
  }
  return { body: out.map((l) => l.replace(/\s+$/, "")).join("\n"), links };
}

/** Re-lays the receipt at a narrower width (phone chat bubbles fit about 32 monospaced characters). */
export function buildReceiptText(content: ReceiptContent, settings: BusinessReceiptSettings, maxWidth?: number) {
  const width = Math.min(columnsFor(settings), maxWidth || 999);
  const lines = buildReceiptLines(content, { ...settings, charsPerLine: width });
  return { ...linesToText(lines, width), width };
}

/**
 * Splits off the styled closing lines (returns policy, thank-you) so chat apps can show
 * them with their own italic/bold formatting, which a monospaced block cannot carry.
 */
export function splitStyledTail(lines: ReceiptLine[]): { main: ReceiptLine[]; tail: Array<{ text: string; italic: boolean; bold: boolean }> } {
  let start = lines.length;
  while (start > 0) {
    const l = lines[start - 1];
    if (l.t === "text" && (l.italic || l.tone)) start--;
    else break;
  }
  const main = lines.slice(0, start);
  while (main.length && main[main.length - 1].t === "blank") main.pop();
  const tail: Array<{ text: string; italic: boolean; bold: boolean }> = [];
  for (const l of lines.slice(start)) {
    if (l.t !== "text") continue;
    const prev = tail[tail.length - 1];
    const italic = !!l.italic;
    const bold = !!l.bold;
    // A wrapped paragraph becomes one line again.
    if (prev && prev.italic === italic && prev.bold === bold) prev.text += " " + l.text.trim();
    else tail.push({ text: l.text.trim(), italic, bold });
  }
  return { main, tail };
}
