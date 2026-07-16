// src/features/analytics/infrastructure/ReportExporterImpl.ts
import { jsPDF } from "jspdf";
import { ReportExporterPort, ExporterData } from "../domain/ports";

export class ReportExporterImpl implements ReportExporterPort {
  public async exportPDF(data: ExporterData): Promise<boolean> {
    try {
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      const primaryColor = [245, 158, 11]; // Golden Amber
      const textColor = [15, 23, 42]; // Slate 900
      const mutedTextColor = [100, 116, 139]; // Slate 500
      const lightBgColor = [248, 250, 252]; // Slate 50

      let yPos = 15;

      // 1. PAGE HEADER
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text("KAYKAY'S MILK", 15, yPos);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 145, yPos);
      
      yPos += 6;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text("EXECUTIVE BUSINESS INTELLIGENCE REPORT", 15, yPos);
      
      yPos += 5;
      doc.setDrawColor(226, 232, 240); // Slate 200
      doc.line(15, yPos, 195, yPos);
      
      // 2. METADATA & FILTERS
      yPos += 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Report Configuration", 15, yPos);
      
      yPos += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Timeframe: ${data.filter.timeframe.toUpperCase()}`, 15, yPos);
      doc.text(`Cashier Filter: ${data.filter.cashierId || "All"}`, 75, yPos);
      doc.text(`Payment Method: ${data.filter.paymentMethod || "All"}`, 135, yPos);
      
      yPos += 4.5;
      doc.text(`Product Filter: ${data.filter.productId || "All"}`, 15, yPos);
      doc.text(`Category: ${data.filter.category || "All"}`, 75, yPos);
      doc.text(`Role: ${data.filter.role || "All"}`, 135, yPos);
      
      // 3. KEY PERFORMANCE METRICS PANEL
      yPos += 9;
      doc.setFillColor(lightBgColor[0], lightBgColor[1], lightBgColor[2]);
      doc.rect(15, yPos, 180, 24, "F");
      doc.rect(15, yPos, 180, 24, "S");
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
      
      // Headers
      doc.text("TOTAL REVENUE", 22, yPos + 6);
      doc.text("TOTAL EXPENSES", 67, yPos + 6);
      doc.text("NET PROFIT", 112, yPos + 6);
      doc.text("SALES COUNT", 157, yPos + 6);
      
      // Values
      doc.setFontSize(11);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text(`KSh ${data.metrics.totalSales.toLocaleString()}`, 22, yPos + 15);
      
      doc.setTextColor(239, 68, 68); // Red
      doc.text(`KSh ${data.metrics.totalExpenses.toLocaleString()}`, 67, yPos + 15);
      
      doc.setTextColor(16, 185, 129); // Emerald Green
      doc.text(`KSh ${data.metrics.netProfit.toLocaleString()}`, 112, yPos + 15);
      
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text(`${data.metrics.orderCount}`, 157, yPos + 15);

      yPos += 30;

      // 4. EMBEDDED VECTOR CHART (SALES VS EXPENSES COMPARISON)
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Financial Breakdown Chart (Vectorized)", 15, yPos);
      
      yPos += 5;
      
      // Draw Chart Canvas Box
      doc.setFillColor(250, 250, 250);
      doc.rect(15, yPos, 180, 35, "F");
      doc.rect(15, yPos, 180, 35, "S");

      // Draw vector bars inside the PDF!
      const totalAmount = data.metrics.totalSales + data.metrics.totalExpenses || 1;
      const maxVal = Math.max(data.metrics.totalSales, data.metrics.totalExpenses, 1);
      
      const salesBarWidth = (data.metrics.totalSales / maxVal) * 120;
      const expBarWidth = (data.metrics.totalExpenses / maxVal) * 120;

      // Sales Bar
      doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.rect(45, yPos + 8, salesBarWidth, 6, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text("Sales", 20, yPos + 12);
      doc.text(`KSh ${data.metrics.totalSales.toLocaleString()}`, 50 + salesBarWidth, yPos + 12);

      // Expenses Bar
      doc.setFillColor(239, 68, 68);
      doc.rect(45, yPos + 20, expBarWidth, 6, "F");
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text("Expenses", 20, yPos + 24);
      doc.text(`KSh ${data.metrics.totalExpenses.toLocaleString()}`, 50 + expBarWidth, yPos + 24);

      yPos += 42;

      // 5. TRANSACTIONS SUMMARY LIST
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Recent Synced Sales Log", 15, yPos);

      yPos += 5;
      
      // Table Header
      doc.setFillColor(241, 245, 249); // slate-100
      doc.rect(15, yPos, 180, 6, "F");
      doc.rect(15, yPos, 180, 6, "S");
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text("TX ID", 18, yPos + 4);
      doc.text("TIMESTAMP", 45, yPos + 4);
      doc.text("CUSTOMER", 85, yPos + 4);
      doc.text("CASHIER", 125, yPos + 4);
      doc.text("METHOD", 155, yPos + 4);
      doc.text("TOTAL (KSh)", 175, yPos + 4);

      doc.setFont("helvetica", "normal");
      let rowY = yPos + 6;
      
      data.transactions.slice(0, 10).forEach(t => {
        if (rowY > 270) {
          doc.addPage();
          rowY = 15;
        }
        
        doc.rect(15, rowY, 180, 6, "S");
        doc.text(t.id.slice(0, 10), 18, rowY + 4);
        doc.text(new Date(t.timestamp).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }), 45, rowY + 4);
        doc.text(t.customerName || "Walk-In Client", 85, rowY + 4);
        doc.text(t.staffName, 125, rowY + 4);
        doc.text(t.paymentMethod || "Cash", 155, rowY + 4);
        doc.text((t.finalTotal || t.total || 0).toLocaleString(), 175, rowY + 4);
        rowY += 6;
      });

      if (data.transactions.length === 0) {
        doc.rect(15, rowY, 180, 6, "S");
        doc.text("No transactions logged in this period.", 75, rowY + 4);
        rowY += 6;
      }

      yPos = rowY + 8;

      // 6. EXPENSES SUMMARY LIST
      if (yPos > 240) {
        doc.addPage();
        yPos = 15;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text("Business Expenses Log", 15, yPos);

      yPos += 5;
      
      // Expense Table Header
      doc.setFillColor(241, 245, 249);
      doc.rect(15, yPos, 180, 6, "F");
      doc.rect(15, yPos, 180, 6, "S");
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text("DATE", 18, yPos + 4);
      doc.text("CATEGORY", 45, yPos + 4);
      doc.text("STAFF", 85, yPos + 4);
      doc.text("DESCRIPTION", 115, yPos + 4);
      doc.text("AMOUNT (KSh)", 175, yPos + 4);

      doc.setFont("helvetica", "normal");
      rowY = yPos + 6;

      data.expenses.slice(0, 10).forEach(e => {
        if (rowY > 270) {
          doc.addPage();
          rowY = 15;
        }
        
        doc.rect(15, rowY, 180, 6, "S");
        doc.text(new Date(e.date).toLocaleDateString(), 18, rowY + 4);
        doc.text(e.category, 45, rowY + 4);
        doc.text(e.staffName, 85, rowY + 4);
        doc.text(e.description.slice(0, 30), 115, rowY + 4);
        doc.text(e.amount.toLocaleString(), 175, rowY + 4);
        rowY += 6;
      });

      if (data.expenses.length === 0) {
        doc.rect(15, rowY, 180, 6, "S");
        doc.text("No expenses logged in this period.", 75, rowY + 4);
        rowY += 6;
      }

      yPos = rowY + 8;

      // 7. PAYMENTS SUMMARY LIST
      if (yPos > 240) {
        doc.addPage();
        yPos = 15;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text("Business Payments Log", 15, yPos);

      yPos += 5;
      
      // Payment Table Header
      doc.setFillColor(241, 245, 249);
      doc.rect(15, yPos, 180, 6, "F");
      doc.rect(15, yPos, 180, 6, "S");
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text("DATE", 18, yPos + 4);
      doc.text("PAYEE / SENDER", 45, yPos + 4);
      doc.text("METHOD", 95, yPos + 4);
      doc.text("REFERENCE CODE", 125, yPos + 4);
      doc.text("STATUS", 155, yPos + 4);
      doc.text("AMOUNT (KSh)", 175, yPos + 4);

      doc.setFont("helvetica", "normal");
      rowY = yPos + 6;

      const pays = data.payments || [];
      pays.slice(0, 10).forEach(p => {
        if (rowY > 270) {
          doc.addPage();
          rowY = 15;
        }
        
        doc.rect(15, rowY, 180, 6, "S");
        doc.text(new Date(p.date).toLocaleDateString(), 18, rowY + 4);
        doc.text(p.senderName || "Unknown", 45, rowY + 4);
        doc.text(p.method, 95, rowY + 4);
        doc.text(p.referenceCode, 125, rowY + 4);
        doc.text(p.status || "Success", 155, rowY + 4);
        doc.text(p.amount.toLocaleString(), 175, rowY + 4);
        rowY += 6;
      });

      if (pays.length === 0) {
        doc.rect(15, rowY, 180, 6, "S");
        doc.text("No business payments logged in this period.", 75, rowY + 4);
        rowY += 6;
      }

      // Save PDF
      doc.save(`KKM_BI_Report_${data.filter.timeframe}_${Date.now()}.pdf`);
      return true;
    } catch (err) {
      console.error("PDF Export failed:", err);
      return false;
    }
  }

  public async exportCSV(data: ExporterData): Promise<boolean> {
    try {
      let csvContent = "data:text/csv;charset=utf-8,";
      
      // Report metadata
      csvContent += `Report,KayKay's Milk Business Intelligence Export\n`;
      csvContent += `Timeframe,${data.filter.timeframe}\n`;
      csvContent += `Generated,${new Date().toISOString()}\n\n`;

      // Metrics Summary
      csvContent += `Summary Metrics\n`;
      csvContent += `Total Revenue,Total Expenses,Net Profit,Orders Count\n`;
      csvContent += `${data.metrics.totalSales},${data.metrics.totalExpenses},${data.metrics.netProfit},${data.metrics.orderCount}\n\n`;

      // Sales Transactions
      csvContent += `Sales Transactions Log\n`;
      csvContent += `Tx ID,Timestamp,Customer,Cashier,Payment Method,Discount,Tax,Final Total\n`;
      
      data.transactions.forEach(t => {
        csvContent += `"${t.id}","${t.timestamp}","${t.customerName || "Walk-In"}","${t.staffName}","${t.paymentMethod || "Cash"}",${t.discount},${t.tax},${t.finalTotal || t.total}\n`;
      });
      
      csvContent += "\n";

      // Expenses
      csvContent += `Business Expenses Log\n`;
      csvContent += `Expense ID,Date,Category,Description,Recorded By,Amount\n`;
      data.expenses.forEach(e => {
        csvContent += `"${e.id}","${e.date}","${e.category}","${e.description.replace(/"/g, '""')}","${e.staffName}",${e.amount}\n`;
      });

      csvContent += "\n";

      // Payments
      csvContent += `Business Payments Log\n`;
      csvContent += `Payment ID,Date,Reference Code,Method,Sender Name,Sender Phone,Status,Amount\n`;
      const pays = data.payments || [];
      pays.forEach(p => {
        csvContent += `"${p.id}","${p.date}","${p.referenceCode}","${p.method}","${p.senderName || "Unknown"}","${p.senderPhone || ""}","${p.status || "Success"}",${p.amount}\n`;
      });

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `KKM_BI_Report_${data.filter.timeframe}_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      return true;
    } catch (err) {
      console.error("CSV Export failed:", err);
      return false;
    }
  }

  public async exportExcel(data: ExporterData): Promise<boolean> {
    // CSV is parsed automatically by Excel as a spreadsheet.
    // For maximum convenience and offline-first compliance, we can export CSV with Excel formatting.
    return this.exportCSV(data);
  }

  public async print(data: ExporterData): Promise<boolean> {
    try {
      const printWindow = window.open("", "_blank");
      if (!printWindow) return false;

      const html = `
        <html>
          <head>
            <title>KayKay's Milk - BI Report Print</title>
            <style>
              body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 24px; color: #0f172a; }
              .header { display: flex; justify-content: space-between; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 24px; }
              .title { color: #f59e0b; font-size: 24px; font-weight: bold; }
              .meta { font-size: 11px; color: #64748b; text-align: right; }
              .grid { display: grid; grid-template-cols: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
              .card { background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; }
              .card-label { font-size: 10px; color: #64748b; font-weight: bold; text-transform: uppercase; }
              .card-value { font-size: 18px; font-weight: bold; margin-top: 6px; }
              table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12px; }
              th { background-color: #f1f5f9; text-align: left; padding: 8px; border: 1px solid #e2e8f0; }
              td { padding: 8px; border: 1px solid #e2e8f0; }
              .text-red { color: #ef4444; }
              .text-green { color: #16a34a; }
            </style>
          </head>
          <body>
            <div class="header">
              <div>
                <div class="title">KAYKAY'S MILK</div>
                <div style="font-size: 14px; font-weight: bold; margin-top: 4px;">Executive Reports & Analytics Portal</div>
              </div>
              <div class="meta">
                <div>Printed: ${new Date().toLocaleString()}</div>
                <div>Filter timeframe: ${data.filter.timeframe.toUpperCase()}</div>
              </div>
            </div>

            <div class="grid">
              <div class="card">
                <div class="card-label">Total Revenue</div>
                <div class="card-value">KSh ${data.metrics.totalSales.toLocaleString()}</div>
              </div>
              <div class="card">
                <div class="card-label">Total Expenses</div>
                <div class="card-value text-red">KSh ${data.metrics.totalExpenses.toLocaleString()}</div>
              </div>
              <div class="card">
                <div class="card-label">Net Profit</div>
                <div class="card-value text-green">KSh ${data.metrics.netProfit.toLocaleString()}</div>
              </div>
              <div class="card">
                <div class="card-label">Sales Volume</div>
                <div class="card-value">${data.metrics.orderCount} Orders</div>
              </div>
            </div>

            <h2>Synced Sales Transactions Log</h2>
            <table>
              <thead>
                <tr>
                  <th>Tx ID</th>
                  <th>Timestamp</th>
                  <th>Customer</th>
                  <th>Cashier</th>
                  <th>Method</th>
                  <th>Final Total</th>
                </tr>
              </thead>
              <tbody>
                ${data.transactions.map(t => `
                  <tr>
                    <td>${t.id.slice(0, 12)}</td>
                    <td>${new Date(t.timestamp).toLocaleString()}</td>
                    <td>${t.customerName || "Walk-In"}</td>
                    <td>${t.staffName}</td>
                    <td>${t.paymentMethod || "Cash"}</td>
                    <td>KSh ${(t.finalTotal || t.total || 0).toLocaleString()}</td>
                  </tr>
                `).join("")}
                ${data.transactions.length === 0 ? "<tr><td colspan='6' style='text-align:center;'>No transactions matching filter constraints.</td></tr>" : ""}
              </tbody>
            </table>

            <h2>Business Expenses Log</h2>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Staff Member</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${data.expenses.map(e => `
                  <tr>
                    <td>${new Date(e.date).toLocaleDateString()}</td>
                    <td>${e.category}</td>
                    <td>${e.description}</td>
                    <td>${e.staffName}</td>
                    <td class="text-red">KSh ${e.amount.toLocaleString()}</td>
                  </tr>
                `).join("")}
                ${data.expenses.length === 0 ? "<tr><td colspan='5' style='text-align:center;'>No expenses logged in this timeframe.</td></tr>" : ""}
              </tbody>
            </table>

            <h2>Business Payments Log</h2>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee / Sender</th>
                  <th>Method</th>
                  <th>Reference Code</th>
                  <th>Status</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${(data.payments || []).map(p => `
                  <tr>
                    <td>${new Date(p.date).toLocaleDateString()}</td>
                    <td>${p.senderName || "Unknown"}</td>
                    <td>${p.method}</td>
                    <td>${p.referenceCode}</td>
                    <td>${p.status || "Success"}</td>
                    <td class="text-green">KSh ${p.amount.toLocaleString()}</td>
                  </tr>
                `).join("")}
                ${(!data.payments || data.payments.length === 0) ? "<tr><td colspan='6' style='text-align:center;'>No business payments logged in this timeframe.</td></tr>" : ""}
              </tbody>
            </table>

            <script>
              window.onload = function() {
                window.print();
                setTimeout(function() { window.close(); }, 500);
              };
            </script>
          </body>
        </html>
      `;

      printWindow.document.write(html);
      printWindow.document.close();
      return true;
    } catch (err) {
      console.error("Print failed:", err);
      return false;
    }
  }

  public async share(data: ExporterData): Promise<boolean> {
    try {
      const totalPayments = (data.payments || []).reduce((acc, p) => acc + p.amount, 0);
      const summaryText = `KayKay's Milk Business Intelligence Summary (${data.filter.timeframe.toUpperCase()}):\n` +
        `- Total Sales: KSh ${data.metrics.totalSales.toLocaleString()}\n` +
        `- Total Expenses: KSh ${data.metrics.totalExpenses.toLocaleString()}\n` +
        `- Business Payments Received: KSh ${totalPayments.toLocaleString()}\n` +
        `- Net Profit: KSh ${data.metrics.netProfit.toLocaleString()}\n` +
        `- Sales Tickets: ${data.metrics.orderCount}\n` +
        `- AOV: KSh ${data.metrics.averageOrderValue.toLocaleString()}\n` +
        `Generated from the offline-first BI analytics command center.`;

      if (navigator.share) {
        await navigator.share({
          title: "KayKay's Milk BI Report Summary",
          text: summaryText
        });
        return true;
      } else {
        // Fallback: Copy to clipboard
        await navigator.clipboard.writeText(summaryText);
        return true;
      }
    } catch (err) {
      console.error("Share failed:", err);
      return false;
    }
  }
}
