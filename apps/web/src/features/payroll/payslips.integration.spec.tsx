// Real-backend integration test — apiFetch is NOT mocked. Requires the API
// dev server running (`pnpm --filter @hrms/api dev`, including its
// in-process BullMQ payroll-PDF worker) with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied.
//
// This is the heaviest integration test in the frontend suite so far:
// unlike the other self-service screens, an employee has no self-service
// way to CREATE a payslip — only a company_admin can create+finalize a
// PayrollRun, and only that produces one. So this test's beforeAll logs
// in as BOTH fixture users: the admin creates and finalizes a real
// payroll run (acknowledging the seeded rule is unverified, same as
// payroll.e2e-spec.ts does), then the employee session (what the
// component under test actually uses) reads the resulting real payslip.
import { authenticator } from "otplib";
import { render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import type { PayslipDto } from "./payslips-api";
import { PayslipsList } from "./PayslipsList";

const ADMIN_EMAIL = "frontend-e2e-admin@hrms.test";
const ADMIN_PASSWORD = "Frontend-E2E-Admin-Pass-1";
const ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const EMPLOYEE_EMAIL = "frontend-e2e-employee@hrms.test";
const EMPLOYEE_PASSWORD = "Frontend-E2E-Employee-Pass-1";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}
interface LoginPendingResponse {
  status: "2fa_required";
  pendingToken: string;
}
interface PayrollRunStatus {
  id: string;
  status: string;
}

async function loginAdmin(): Promise<string> {
  const res = await apiFetch<LoginOkResponse | LoginPendingResponse>("/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (res.status === "ok") return res.accessToken;
  const code = authenticator.generate(ADMIN_TOTP_SECRET);
  const verifyRes = await apiFetch<LoginOkResponse>("/auth/2fa/verify", {
    method: "POST",
    body: { pendingToken: res.pendingToken, code },
  });
  return verifyRes.accessToken;
}

async function waitForFinalized(runId: string, adminToken: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    setAccessToken(adminToken);
    const run = await apiFetch<PayrollRunStatus>(`/payroll/runs/${runId}`);
    if (run.status === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for PayrollRun ${runId} to reach "finalized"`);
}

let employeeToken: string;
let myPayslipId: string;

beforeAll(async () => {
  const adminToken = await loginAdmin();
  setAccessToken(adminToken);

  // The period itself doesn't need to be unique — createDraft() doesn't
  // reject overlapping/duplicate periods, and this test never identifies
  // "its" row by period text anyway (see below for why that used to be
  // the bug here).
  const offsetMonths = Date.now() % 1000;
  const periodStart = new Date(Date.UTC(2030, offsetMonths % 12, 1));
  const periodEnd = new Date(Date.UTC(2030, (offsetMonths % 12) + 1, 0));
  const run = await apiFetch<PayrollRunStatus>("/payroll/runs", {
    method: "POST",
    body: {
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
    },
  });

  await apiFetch(`/payroll/runs/${run.id}/finalize`, {
    method: "POST",
    body: { acknowledgeUnverifiedRates: true },
  });
  await waitForFinalized(run.id, adminToken);

  const employeeLogin = await apiFetch<LoginOkResponse>("/auth/login", {
    method: "POST",
    body: { email: EMPLOYEE_EMAIL, password: EMPLOYEE_PASSWORD },
  });
  employeeToken = employeeLogin.accessToken;
  setAccessToken(employeeToken);

  // Identify THIS run's own payslip by its real payrollRunId (a UUID we
  // just minted ourselves — no collision possible, unlike the formatted
  // period TEXT this test used to match on: with only 12 possible months
  // in the date-generation logic above, two runs landing on the same
  // month is inevitable after enough accumulated real runs, and
  // "October 1, 2030 – October 31, 2030" stopped being unique on disk long
  // before this test was rewritten to stop assuming it was. See
  // DECISIONS.md.
  const mine = await apiFetch<PayslipDto[]>("/payslips/me");
  const mySlip = mine.find((p) => p.payrollRunId === run.id);
  if (!mySlip) throw new Error("Expected a payslip for the run just created");
  myPayslipId = mySlip.id;
}, 120000);

afterAll(() => {
  setAccessToken(null);
});

describe("PayslipsList — real backend integration", () => {
  it("lists a real finalized payslip and downloads it via a real, freshly-generated signed URL", async () => {
    setAccessToken(employeeToken);
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);

    const { container } = render(
      <LocaleProvider initialLocale="en">
        <PayslipsList />
      </LocaleProvider>,
    );

    // Scoped to THIS run's own row via its real id (see beforeAll), not a
    // page-wide role query or any rendered text — this fixture company's
    // payslip history accumulates a real row across every past run of
    // this test.
    let row: HTMLElement | null = null;
    await waitFor(
      () => {
        row = container.querySelector(`[data-payslip-id="${myPayslipId}"]`);
        expect(row).not.toBeNull();
      },
      { timeout: 15000 },
    );
    const downloadButton = within(row!).getByRole("button", { name: "Download" });
    await userEvent.click(downloadButton);

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1), { timeout: 10000 });
    const openedUrl = openSpy.mock.calls[0][0] as string;
    expect(openedUrl).toContain("/payslips/download?token=");

    // Prove the signed URL is REAL — actually fetch it and confirm it
    // returns a real PDF, not just that a URL-shaped string was produced.
    const pdfRes = await fetch(openedUrl);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
  }, 45000);
});
