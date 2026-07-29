// Real-backend integration test — apiFetch is NOT mocked. Requires the API
// dev server running with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { ProfileView } from "./ProfileView";

const EMPLOYEE_EMAIL = "frontend-e2e-employee@hrms.test";
const EMPLOYEE_PASSWORD = "Frontend-E2E-Employee-Pass-1";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}

function renderView() {
  return render(
    <LocaleProvider initialLocale="en">
      <ProfileView />
    </LocaleProvider>,
  );
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

describe("ProfileView — real backend integration", () => {
  it("loads the real profile, saves real contact-field changes, and the change survives a fresh reload", async () => {
    const uniquePhone = `+964-750-${Date.now() % 1000000}`;

    const first = renderView();
    expect(await screen.findByText("Frontend E2E Employee", {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText("Software Engineer")).toBeInTheDocument();

    const phoneInput = screen.getByLabelText("Phone");
    await userEvent.clear(phoneInput);
    await userEvent.type(phoneInput, uniquePhone);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Profile updated.", {}, { timeout: 10000 })).toBeInTheDocument();
    first.unmount();

    // Fresh mount, fresh GET /employees/me — proves the write actually
    // persisted server-side, not just local component state.
    renderView();
    expect(await screen.findByDisplayValue(uniquePhone, {}, { timeout: 10000 })).toBeInTheDocument();
  }, 30000);
});
