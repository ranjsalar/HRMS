import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { OrgChartView } from "./OrgChartView";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderChart() {
  return render(
    <LocaleProvider initialLocale="en">
      <OrgChartView />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe("OrgChartView", () => {
  it("shows the empty state when there are no departments", async () => {
    mockedApiFetch.mockResolvedValueOnce([]);
    renderChart();
    expect(await screen.findByText("No departments to show.")).toBeInTheDocument();
  });

  it("renders a department with its manager and employee count", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      { id: "d1", name: "Sales", managerEmployeeId: "e1", managerName: "Alice", employeeCount: 4, children: [] },
    ]);
    renderChart();

    expect(await screen.findByText("Sales")).toBeInTheDocument();
    expect(screen.getByText(/Manager: Alice/)).toBeInTheDocument();
    expect(screen.getByText(/4 employee\(s\)/)).toBeInTheDocument();
  });

  it("renders 'No manager assigned' when a department has none", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      { id: "d1", name: "Sales", managerEmployeeId: null, managerName: null, employeeCount: 0, children: [] },
    ]);
    renderChart();
    expect(await screen.findByText(/No manager assigned/)).toBeInTheDocument();
  });

  it("renders nested child departments, exactly as the server tree returned them", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      {
        id: "d1",
        name: "Engineering",
        managerEmployeeId: null,
        managerName: null,
        employeeCount: 1,
        children: [
          { id: "d2", name: "Frontend", managerEmployeeId: null, managerName: null, employeeCount: 3, children: [] },
        ],
      },
    ]);
    renderChart();

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    const frontend = screen.getByText("Frontend");
    expect(frontend).toBeInTheDocument();
    // Nested under the parent's own <li>, not a sibling at the root.
    const parentLi = screen.getByText("Engineering").closest("li[data-department-id]");
    expect(parentLi).toContainElement(frontend);
  });
});
