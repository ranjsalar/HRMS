import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import ForgotPasswordPage from "./page";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderPage(initialLocale: "en" | "ar" | "ku" = "en") {
  return render(
    <LocaleProvider initialLocale={initialLocale}>
      <ForgotPasswordPage />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe("ForgotPasswordPage", () => {
  it("validates email client-side before ever calling the API", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("This field is required.")).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it("shows the same 'sent' confirmation regardless of whether the account exists — matches the backend's anti-enumeration response", async () => {
    mockedApiFetch.mockResolvedValue({ message: "ok" });
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "someone@e2e.test");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText(/password reset link was sent/)).toBeInTheDocument();
  });

  it("sends the page's current locale along with the email — the backend has no other way to know it for this unauthenticated request", async () => {
    mockedApiFetch.mockResolvedValue({ message: "ok" });
    renderPage("ar");

    await userEvent.type(screen.getByLabelText("البريد الإلكتروني"), "someone@e2e.test");
    await userEvent.click(screen.getByRole("button", { name: "إرسال رابط إعادة التعيين" }));

    expect(mockedApiFetch).toHaveBeenCalledWith("/auth/password-reset/request", {
      method: "POST",
      body: { email: "someone@e2e.test", locale: "ar" },
    });
  });

  it("a genuine network/server failure shows the generic error, not the sent confirmation", async () => {
    mockedApiFetch.mockRejectedValue(new Error("network down"));
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "someone@e2e.test");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(
      await screen.findByText("An unexpected error occurred. Please try again."),
    ).toBeInTheDocument();
  });
});
