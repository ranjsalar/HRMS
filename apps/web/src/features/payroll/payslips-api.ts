import { apiFetch } from "@/lib/api-client";

export interface PayslipDto {
  id: string;
  employeeId: string;
  payrollRunId: string;
  gross: string; // Decimal over JSON — see leave-api.ts's note on LeaveBalanceDto.balance
  deductions: string;
  net: string;
  currency: string;
  pdfUrl: string | null;
  generatedAt: string | null;
  payrollRun?: { periodStart: string; periodEnd: string };
}

export interface SignedPayslipUrl {
  url: string;
  expiresAt: string;
}

export function fetchMyPayslips(): Promise<PayslipDto[]> {
  return apiFetch<PayslipDto[]>("/payslips/me");
}

/** A fresh signed URL every call — never cached/reused beyond its short TTL. See DECISIONS.md. */
export function fetchSignedPayslipUrl(payslipId: string): Promise<SignedPayslipUrl> {
  return apiFetch<SignedPayslipUrl>(`/payslips/${payslipId}/signed-url`);
}
