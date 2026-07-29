import PDFDocument from "pdfkit";

export interface PayslipPdfData {
  employeeName: string;
  companyName: string;
  periodStart: Date;
  periodEnd: Date;
  currency: string;
  gross: string;
  deductions: string;
  net: string;
  breakdown: Record<string, unknown> | null;
}

/**
 * Minimal, functional payslip PDF — English only for v1. The architecture
 * doc's goal of backend-generated PDFs rendering in the employee's
 * selected language (Arabic/Sorani, RTL layout) is a known, documented
 * scope cut for this step, not silently dropped — see DECISIONS.md.
 */
export function renderPayslipPdf(data: PayslipPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (error: unknown) =>
      reject(error instanceof Error ? error : new Error(String(error))),
    );

    doc.fontSize(18).text(data.companyName);
    doc.moveDown(0.5);
    doc.fontSize(14).text("Payslip");
    doc.moveDown();

    doc.fontSize(11);
    doc.text(`Employee: ${data.employeeName}`);
    doc.text(`Period: ${formatDate(data.periodStart)} - ${formatDate(data.periodEnd)}`);
    doc.text(`Currency: ${data.currency}`);
    doc.moveDown();

    doc.text(`Gross: ${data.gross} ${data.currency}`);
    doc.text(`Deductions: ${data.deductions} ${data.currency}`);
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Net Pay: ${data.net} ${data.currency}`, { underline: true });
    doc.moveDown();

    if (data.breakdown) {
      doc.fontSize(10).text("Breakdown", { underline: true });
      for (const [key, value] of Object.entries(data.breakdown)) {
        doc.text(`${key}: ${String(value)}`);
      }
    }

    doc.end();
  });
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
