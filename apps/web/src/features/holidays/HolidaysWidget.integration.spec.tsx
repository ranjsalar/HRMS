// Real-backend integration test — apiFetch is NOT mocked here, unlike
// HolidaysWidget.spec.tsx. Requires the API dev server running
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
import { HolidaysWidget } from "./HolidaysWidget";

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

describe("HolidaysWidget — real backend integration", () => {
  // Reads the real seeded 2026 system-wide holiday calendar
  // (database/seeds/holidays.ts) — no per-test fixture data needed. As of
  // this test being written (2026-07-28), "Iraq Republic Day" (2026-07-14)
  // is already past and "Iraq Independence Day" (2026-10-03) is the
  // nearest real upcoming system holiday.
  it("renders real upcoming holidays from the seeded system calendar", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <HolidaysWidget />
      </LocaleProvider>,
    );

    expect(
      await screen.findByText("Iraq Independence Day", {}, { timeout: 10000 }),
    ).toBeInTheDocument();
  }, 15000);
});
