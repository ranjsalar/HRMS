// Real-backend integration test — apiFetch is NOT mocked here, unlike
// LeaveBalanceWidget.spec.tsx. Requires the API dev server running
// (`pnpm --filter @hrms/api dev`) with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied.
//
// Credentials duplicated from
// apps/api/src/database/seeds/seed-frontend-auth-fixtures.ts on purpose,
// same convention as login.integration.spec.tsx — keep in sync by hand.
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { LeaveBalanceWidget } from "./LeaveBalanceWidget";

const EMPLOYEE_EMAIL = "frontend-e2e-employee@hrms.test";
const EMPLOYEE_PASSWORD = "Frontend-E2E-Employee-Pass-1";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}

beforeAll(async () => {
  const res = await apiFetch<LoginOkResponse>("/auth/login", {
    method: "POST",
    body: { email: EMPLOYEE_EMAIL, password: EMPLOYEE_PASSWORD },
  });
  setAccessToken(res.accessToken);
}, 15000);

afterAll(() => {
  setAccessToken(null);
});

describe("LeaveBalanceWidget — real backend integration", () => {
  // This fixture employee has never had a leave request approved (see
  // seed-frontend-auth-fixtures.ts), and LeaveBalance rows are lazily
  // created only on first approval (step 7) — so the real, correct
  // response for this employee IS an empty balance list. Proves the real
  // /leave-balances/me + /leave-types round trip and the join logic
  // against a genuinely empty case, not a mocked one.
  it("renders the real empty state for an employee with no approved leave history yet", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <LeaveBalanceWidget />
      </LocaleProvider>,
    );

    expect(
      await screen.findByText("No leave balances yet.", {}, { timeout: 10000 }),
    ).toBeInTheDocument();
  }, 15000);
});
