import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { TeamList } from "./TeamList";
import type { TeamMemberDto } from "./team-api";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderList(renderRowAction?: (m: TeamMemberDto) => React.ReactNode) {
  return render(
    <LocaleProvider initialLocale="en">
      <TeamList renderRowAction={renderRowAction} />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe("TeamList", () => {
  it("shows the empty state when the caller has no team to see", async () => {
    mockedApiFetch.mockResolvedValueOnce([]);
    renderList();
    expect(await screen.findByText("No team members to show.")).toBeInTheDocument();
  });

  it("renders exactly what /employees returns, with no client-side filtering", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      { id: "e1", userId: "u1", fullName: "Alice", jobTitle: "Engineer", departmentId: "d1", branchId: "b1", hireDate: "2024-01-01T00:00:00.000Z", status: "active" },
      { id: "e2", userId: "u2", fullName: "Bob", jobTitle: "Designer", departmentId: "d1", branchId: "b1", hireDate: "2023-06-15T00:00:00.000Z", status: "on_leave" },
    ]);
    renderList();

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText(/On leave/)).toBeInTheDocument();
    expect(mockedApiFetch).toHaveBeenCalledWith("/employees");
  });

  it("renders a per-row action when provided, scoped to that row's own employee id", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      { id: "e1", userId: "u1", fullName: "Alice", jobTitle: "Engineer", departmentId: "d1", branchId: "b1", hireDate: "2024-01-01T00:00:00.000Z", status: "active" },
    ]);
    renderList((member) => <button>action for {member.id}</button>);

    expect(await screen.findByText("action for e1")).toBeInTheDocument();
  });
});
