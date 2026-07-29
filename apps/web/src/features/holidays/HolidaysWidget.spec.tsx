import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { HolidaysWidget } from "./HolidaysWidget";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderWidget() {
  return render(
    <LocaleProvider initialLocale="en">
      <HolidaysWidget />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe("HolidaysWidget", () => {
  it("renders each upcoming holiday's name and formatted date", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      { id: "h1", name: "Iraq Republic Day", date: "2026-08-14T00:00:00.000Z", companyId: null },
      { id: "h2", name: "Company Retreat", date: "2026-09-01T00:00:00.000Z", companyId: "c1" },
    ]);
    renderWidget();

    expect(await screen.findByText("Iraq Republic Day")).toBeInTheDocument();
    expect(screen.getByText("August 14, 2026")).toBeInTheDocument();
    expect(screen.getByText("Company Retreat")).toBeInTheDocument();
    expect(screen.getByText("September 1, 2026")).toBeInTheDocument();
  });

  it("shows the empty state when there are no upcoming holidays", async () => {
    mockedApiFetch.mockResolvedValueOnce([]);
    renderWidget();

    expect(await screen.findByText("No upcoming holidays.")).toBeInTheDocument();
  });

  it("renders the generic error state with a working retry", async () => {
    mockedApiFetch.mockRejectedValueOnce(new Error("network down"));
    mockedApiFetch.mockResolvedValueOnce([]);
    renderWidget();

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No upcoming holidays.")).toBeInTheDocument();
  });
});
