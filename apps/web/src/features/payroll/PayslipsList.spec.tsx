import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { PayslipsList } from "./PayslipsList";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);
const openSpy = vi.fn();

function renderList() {
  return render(
    <LocaleProvider initialLocale="en">
      <PayslipsList />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
  openSpy.mockReset();
  vi.stubGlobal("open", openSpy);
});

describe("PayslipsList", () => {
  it("shows the empty state when there are no payslips", async () => {
    mockedApiFetch.mockResolvedValueOnce([]);
    renderList();
    expect(await screen.findByText("No payslips yet.")).toBeInTheDocument();
  });

  it("renders period, gross, and net with Decimal-safe (string-parsed) formatting", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      {
        id: "p1",
        employeeId: "e1",
        payrollRunId: "r1",
        gross: "1500000.00",
        deductions: "75000.00",
        net: "1425000.00",
        currency: "IQD",
        pdfUrl: "companyid/p1.pdf",
        generatedAt: "2026-08-01T00:00:00.000Z",
        payrollRun: { periodStart: "2026-07-01T00:00:00.000Z", periodEnd: "2026-07-31T00:00:00.000Z" },
      },
    ]);
    renderList();

    expect(await screen.findByText("July 1, 2026 – July 31, 2026")).toBeInTheDocument();
    expect(screen.getByText(/1,500,000\.00 IQD/)).toBeInTheDocument();
    expect(screen.getByText(/1,425,000\.00 IQD/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("shows 'not ready' instead of a Download button when pdfUrl is null — never a broken/dead button", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      {
        id: "p1",
        employeeId: "e1",
        payrollRunId: "r1",
        gross: "1500000.00",
        deductions: "0.00",
        net: "1500000.00",
        currency: "IQD",
        pdfUrl: null,
        generatedAt: null,
        payrollRun: { periodStart: "2026-07-01T00:00:00.000Z", periodEnd: "2026-07-31T00:00:00.000Z" },
      },
    ]);
    renderList();

    expect(await screen.findByText("This payslip's PDF isn't ready yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });

  it("clicking Download fetches a FRESH signed URL and opens it — a second click fetches again, not a cached URL", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      const p = String(path);
      if (p === "/payslips/me") {
        return [
          {
            id: "p1",
            employeeId: "e1",
            payrollRunId: "r1",
            gross: "1500000.00",
            deductions: "0.00",
            net: "1500000.00",
            currency: "IQD",
            pdfUrl: "companyid/p1.pdf",
            generatedAt: "2026-08-01T00:00:00.000Z",
            payrollRun: { periodStart: "2026-07-01T00:00:00.000Z", periodEnd: "2026-07-31T00:00:00.000Z" },
          },
        ];
      }
      if (p === "/payslips/p1/signed-url") {
        return { url: `/payslips/download?token=tok-${Date.now()}-${Math.random()}`, expiresAt: "2026-08-01T00:10:00.000Z" };
      }
      throw new Error(`unexpected ${p}`);
    });
    renderList();

    const button = await screen.findByRole("button", { name: "Download" });
    await userEvent.click(button);
    await userEvent.click(button);

    expect(mockedApiFetch).toHaveBeenCalledWith("/payslips/p1/signed-url");
    const signedUrlCalls = mockedApiFetch.mock.calls.filter(([p]) => p === "/payslips/p1/signed-url");
    expect(signedUrlCalls.length).toBe(2);
    expect(openSpy).toHaveBeenCalledTimes(2);
    const firstUrl = openSpy.mock.calls[0][0] as string;
    const secondUrl = openSpy.mock.calls[1][0] as string;
    expect(firstUrl).not.toBe(secondUrl);
  });
});
