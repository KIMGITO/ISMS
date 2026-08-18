// Script to generate APP_DOCUMENTATION.pdf from APP_DOCUMENTATION.txt
import { jsPDF } from "jspdf";
import fs from "fs";
import path from "path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const txtPath = path.resolve(__dirname, "../APP_DOCUMENTATION.txt");
const pdfPath = path.resolve(__dirname, "../APP_DOCUMENTATION.pdf");

const text = fs.readFileSync(txtPath, "utf8");

// Page dimensions for A4
const pageWidth = 210; // mm
const pageHeight = 297; // mm
const margin = 20;
const contentWidth = pageWidth - margin * 2;
const lineHeight = 5;
const fontSize = 9;

const doc = new jsPDF({ unit: "mm", format: "a4" });
doc.setFont("helvetica", "normal");
doc.setFontSize(fontSize);

let y = margin;

const writeLine = (line) => {
  // Handle long lines by wrapping
  const words = line.split(" ");
  let currentLine = "";
  for (const word of words) {
    const test = currentLine ? currentLine + " " + word : word;
    const width = doc.getTextWidth(test);
    if (width > contentWidth && currentLine) {
      doc.text(currentLine, margin, y);
      y += lineHeight;
      currentLine = word;
    } else {
      currentLine = test;
    }
  }
  if (currentLine) {
    doc.text(currentLine, margin, y);
    y += lineHeight;
  }
};

const lines = text.split("\n");

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();

  // Section header detection (===== lines)
  if (trimmed.startsWith("===")) {
    // Skip the separator itself
    continue;
  }

  // Detect section titles (lines like "1. OVERVIEW" or "ISMS - MILK BUSINESS MANAGEMENT SYSTEM")
  if (/^[0-9]+\.\s+[A-Z]/.test(trimmed) || trimmed === "ISMS - MILK BUSINESS MANAGEMENT SYSTEM") {
    // Check if next non-empty line is a ===== separator
    let next = i + 1;
    while (next < lines.length && lines[next].trim() === "") next++;
    if (next < lines.length && lines[next].trim().startsWith("===")) {
      // Section header
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(trimmed, margin, y);
      y += lineHeight + 2;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(fontSize);
      continue;
    }
  }

  // Sub-section header detection (-------
  if (trimmed.startsWith("---")) {
    continue;
  }

  // Sub-section titles (e.g., "4.1 POS Checkout (POSView)")
  if (/^[0-9]+\.[0-9]+\s+[A-Z]/.test(trimmed)) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(trimmed, margin, y);
    y += lineHeight + 1;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    continue;
  }

  // Page break check
  if (y > pageHeight - margin) {
    doc.addPage();
    y = margin;
  }

  if (trimmed === "") {
    y += lineHeight * 0.6;
  } else {
    writeLine(line);
  }
}

// Save PDF
doc.save(pdfPath);