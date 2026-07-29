import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { AttendanceCorrectionForm } from "./AttendanceCorrectionForm";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);
const onClose = vi.fn();

function renderForm() {
  return render(
    <LocaleProvider initialLocale="en">
      <AttendanceCorrectionForm employeeId="e1" employeeName="Alice" onClose={onClose} />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
  onClose.mockReset();
});

describe("AttendanceCorrectionForm", () => {
  it("cannot be submitted without a note — client-side validation blocks the call entirely", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Clock in"), "2026-08-01T09:00");
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));

    expect(await screen.findByText("A note is required to explain this correction.")).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it("submits with employeeId + note, and clearly labels the result as admin_override, not a normal clock-in", async () => {
    mockedApiFetch.mockResolvedValueOnce({
      id: "r1",
      employeeId: "e1",
      clockIn: "2026-08-01T09:00:00.000Z",
      clockOut: null,
      source: "admin_override",
      note: "Forgot to clock in",
    });
    renderForm();

    await userEvent.type(screen.getByLabelText("Clock in"), "2026-08-01T09:00");
    await userEvent.type(screen.getByLabelText("Note"), "Forgot to clock in");
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));

    expect(
      await screen.findByText(/Correction saved — recorded as an admin override/),
    ).toBeInTheDocument();
    expect(screen.getByText(/admin_override/)).toBeInTheDocument();
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/attendance/override",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ employeeId: "e1", note: "Forgot to clock in" }),
      }),
    );
  });

  it("Cancel closes the form without submitting", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});
