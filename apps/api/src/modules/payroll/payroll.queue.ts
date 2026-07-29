export const PAYROLL_PDF_QUEUE_NAME = "payroll-pdf-generation";
export const PAYROLL_PDF_QUEUE = "PAYROLL_PDF_QUEUE";

export interface PayslipPdfJobData {
  payrollRunId: string;
  companyId: string;
  actorUserId: string;
}
