// Real-backend integration test — apiFetch is NOT mocked. Requires the API
// dev server running with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied.
import { render, screen } from "@testing-library/react";
import { afterAll, describe, expect, it } from "vitest";
import { apiFetch, ForbiddenError, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { OrgChartView } from "./OrgChartView";

const MANAGER_EMAIL = "frontend-e2e-manager@hrms.test";
const MANAGER_PASSWORD = "Frontend-E2E-Manager-Pass-1";
const EMPLOYEE_EMAIL = "frontend-e2e-employee@hrms.test";
const EMPLOYEE_PASSWORD = "Frontend-E2E-Employee-Pass-1";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}

afterAll(() => {
  setAccessToken(null);
});

describe("OrgChartView — real backend integration", () => {
  it("a manager sees the REAL company-wide tree — including the department they do NOT manage — confirming org:view is deliberately scope 'all', not own_department (see DECISIONS.md, step 5)", async () => {
    const res = await apiFetch<LoginOkResponse>("/auth/login", {
      method: "POST",
      body: { email: MANAGER_EMAIL, password: MANAGER_PASSWORD },
    });
    setAccessToken(res.accessToken);

    render(
      <LocaleProvider initialLocale="en">
        <OrgChartView />
      </LocaleProvider>,
    );

    // Their own department (which they manage)...
    expect(
      await screen.findByText("Frontend E2E Department", {}, { timeout: 10000 }),
    ).toBeInTheDocument();
    // ...AND the second department from step 9.5's fixtures, which they
    // do NOT manage and have no employees:edit reach into — proving this
    // is genuinely the whole company's tree, not narrowed to what they
    // manage.
    expect(screen.getByText("Frontend E2E Department (Other)")).toBeInTheDocument();
  }, 15000);

  it("a plain employee has no org:view grant at all and is rejected by the real backend (403), not just hidden by the nav", async () => {
    const res = await apiFetch<LoginOkResponse>("/auth/login", {
      method: "POST",
      body: { email: EMPLOYEE_EMAIL, password: EMPLOYEE_PASSWORD },
    });
    setAccessToken(res.accessToken);

    const attempt = apiFetch("/departments/org-chart");
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
  }, 15000);
});
