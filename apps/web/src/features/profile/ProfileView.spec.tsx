import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { ProfileView } from "./ProfileView";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

const BASE_PROFILE = {
  id: "e1",
  fullName: "Jane Doe",
  jobTitle: "Analyst",
  hireDate: "2024-01-01T00:00:00.000Z",
  status: "active",
  phone: null,
  address: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
};

function renderView() {
  return render(
    <LocaleProvider initialLocale="en">
      <ProfileView />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe("ProfileView", () => {
  it("renders read-only identity fields and empty contact fields", async () => {
    mockedApiFetch.mockResolvedValueOnce(BASE_PROFILE);
    renderView();

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toHaveValue("");
  });

  it("does NOT render any input for salaryBase/nationalId/bankAccount/departmentId/branchId/fullName/jobTitle — only the four contact fields are editable", async () => {
    mockedApiFetch.mockResolvedValueOnce(BASE_PROFILE);
    renderView();
    await screen.findByText("Jane Doe");

    // Exactly 4 text inputs on the whole page — the contact fields. No
    // input for fullName, jobTitle, or anything HR-controlled.
    const textboxes = screen.getAllByRole("textbox");
    expect(textboxes).toHaveLength(4);
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();
    expect(screen.getByLabelText("Address")).toBeInTheDocument();
    expect(screen.getByLabelText("Emergency contact name")).toBeInTheDocument();
    expect(screen.getByLabelText("Emergency contact phone")).toBeInTheDocument();
  });

  it("saves the contact fields and shows a success message", async () => {
    mockedApiFetch.mockImplementation(async (path, options) => {
      const p = String(path);
      if (p === "/employees/me" && (!options || options.method === undefined)) return BASE_PROFILE;
      if (p === "/employees/me" && options?.method === "PATCH") {
        return { ...BASE_PROFILE, ...(options.body as object) };
      }
      throw new Error(`unexpected ${p}`);
    });
    renderView();
    await screen.findByText("Jane Doe");

    await userEvent.type(screen.getByLabelText("Phone"), "555-1234");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Profile updated.")).toBeInTheDocument();
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/employees/me",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
