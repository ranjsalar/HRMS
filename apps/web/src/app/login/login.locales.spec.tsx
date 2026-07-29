// Verifies the login screen's actual RENDERED OUTPUT in ar/ku, not just
// that translation keys exist (locale-parity.spec.ts already covers
// that). jsdom can't compute real CSS (no visual RTL layout/transform
// verification here — see DECISIONS.md for what that gap means and how
// it was covered instead), but it DOES render real Unicode text and
// expose the actual `dir` attribute/className values React produced,
// which is the load-bearing part: does useTranslation() + the ckb Intl
// tag actually produce correct Arabic/Sorani output for THIS screen with
// THIS screen's real validation error strings, not a generic sample.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, UnauthorizedError } from "@/lib/api-client";
import { AuthProvider } from "@/lib/auth-context";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/locale";
import LoginPage from "./page";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);
const replace = vi.fn();

function renderLoginPage(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>);
  replace.mockClear();
  mockedApiFetch.mockReset();
  mockedApiFetch.mockImplementation(async (path) => {
    if (path === "/auth/refresh") throw new Error("401");
    throw new Error(`unexpected path ${String(path)}`);
  });
});

describe.each([
  { locale: "ar" as const, title: "تسجيل الدخول", email: "البريد الإلكتروني", password: "كلمة المرور" },
  { locale: "ku" as const, title: "چوونە ژوورەوە", email: "ئیمەیل", password: "وشەی نهێنی" },
])("LoginPage rendered in $locale", ({ locale, title, email, password }) => {
  it("renders the real translated title and field labels, with dir=rtl on the page root", async () => {
    renderLoginPage(locale);
    await waitFor(() => expect(screen.getByRole("button", { name: title })).toBeInTheDocument());

    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByLabelText(email)).toBeInTheDocument();
    expect(screen.getByLabelText(password)).toBeInTheDocument();

    const main = document.querySelector("main");
    expect(main).toHaveAttribute("dir", "rtl");
  });

  it("client-side validation errors render in the same language as the form, using real form interaction", async () => {
    renderLoginPage(locale);
    await waitFor(() => expect(screen.getByRole("button", { name: title })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: title }));

    // Both empty-field errors use the same "required" string — two
    // real, rendered error messages in the target language, not English.
    const requiredMessage = locale === "ar" ? "هذا الحقل مطلوب." : "ئەم خانەیە پێویستە.";
    expect(await screen.findAllByText(requiredMessage)).toHaveLength(2);
  });

  it("a real 401 from a mocked backend call is mapped to the translated invalid-credentials message", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      if (path === "/auth/login") throw new UnauthorizedError("Invalid email or password", 401, null);
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderLoginPage(locale);
    await waitFor(() => expect(screen.getByRole("button", { name: title })).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(email), "a@e2e.test");
    await userEvent.type(screen.getByLabelText(password), "wrong");
    await userEvent.click(screen.getByRole("button", { name: title }));

    const invalidMessage =
      locale === "ar" ? "البريد الإلكتروني أو كلمة المرور غير صحيحة." : "ئیمەیل یان وشەی نهێنی هەڵەیە.";
    expect(await screen.findByText(invalidMessage)).toBeInTheDocument();
  });
});
