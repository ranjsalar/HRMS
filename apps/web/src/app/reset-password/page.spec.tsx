import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSearchParams } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import ResetPasswordPage from "./page";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("next/navigation", () => ({ useSearchParams: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);
const mockedUseSearchParams = vi.mocked(useSearchParams);

function renderPage() {
  return render(
    <LocaleProvider initialLocale="en">
      <ResetPasswordPage />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe("ResetPasswordPage", () => {
  it("shows an invalid-link state with no form when there's no token in the URL", () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    );
    renderPage();

    expect(screen.getByText("This reset link is invalid or has expired.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update password" })).not.toBeInTheDocument();
  });

  it("a successful confirm shows the success message and calls the API with the URL's token", async () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ token: "real-token" }) as unknown as ReturnType<typeof useSearchParams>,
    );
    mockedApiFetch.mockResolvedValue({ message: "ok" });
    renderPage();

    await userEvent.type(screen.getByLabelText("New password"), "new-password-123");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText(/Your password has been updated/)).toBeInTheDocument();
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/auth/password-reset/confirm",
      expect.objectContaining({ body: { token: "real-token", newPassword: "new-password-123" } }),
    );
  });

  it("an invalid/expired token shows the mapped error message", async () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ token: "bad-token" }) as unknown as ReturnType<typeof useSearchParams>,
    );
    mockedApiFetch.mockRejectedValue(new Error("expired"));
    renderPage();

    await userEvent.type(screen.getByLabelText("New password"), "new-password-123");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("This reset link is invalid or has expired.")).toBeInTheDocument();
  });

  it("validates the new password's minimum length client-side, without calling the API", async () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ token: "real-token" }) as unknown as ReturnType<typeof useSearchParams>,
    );
    renderPage();

    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});
