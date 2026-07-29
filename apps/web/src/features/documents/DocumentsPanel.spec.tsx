import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { DocumentsPanel } from "./DocumentsPanel";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);
const openSpy = vi.fn();

const PROFILE = {
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

function renderPanel() {
  return render(
    <LocaleProvider initialLocale="en">
      <DocumentsPanel />
    </LocaleProvider>,
  );
}

function mockBase(documents: unknown[]): void {
  mockedApiFetch.mockImplementation(async (path) => {
    const p = String(path);
    if (p === "/employees/me") return PROFILE;
    if (p === "/documents/me") return documents;
    throw new Error(`unexpected ${p}`);
  });
}

beforeEach(() => {
  mockedApiFetch.mockReset();
  openSpy.mockReset();
  vi.stubGlobal("open", openSpy);
});

describe("DocumentsPanel", () => {
  it("shows the empty state when there are no documents", async () => {
    mockBase([]);
    renderPanel();
    expect(await screen.findByText("No documents yet.")).toBeInTheDocument();
  });

  it("lists documents with type, upload date, and expiry when set", async () => {
    mockBase([
      { id: "d1", employeeId: "e1", type: "passport", expiryDate: "2030-01-01T00:00:00.000Z", uploadedAt: "2026-01-01T00:00:00.000Z" },
      { id: "d2", employeeId: "e1", type: "contract", expiryDate: null, uploadedAt: "2026-02-01T00:00:00.000Z" },
    ]);
    renderPanel();

    const list = await screen.findByRole("list");
    expect(within(list).getByText("Passport")).toBeInTheDocument();
    expect(within(list).getByText(/Uploaded January 1, 2026/)).toBeInTheDocument();
    expect(within(list).getByText(/Expires January 1, 2030/)).toBeInTheDocument();
    expect(within(list).getByText("Contract")).toBeInTheDocument();
  });

  it("clicking View fetches a fresh signed URL and opens it", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      const p = String(path);
      if (p === "/employees/me") return PROFILE;
      if (p === "/documents/me") {
        return [{ id: "d1", employeeId: "e1", type: "id", expiryDate: null, uploadedAt: "2026-01-01T00:00:00.000Z" }];
      }
      if (p === "/documents/d1/signed-url") {
        return { url: "/documents/download?token=tok", expiresAt: "2026-01-01T00:10:00.000Z" };
      }
      throw new Error(`unexpected ${p}`);
    });
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "View" }));

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("/documents/download?token=tok"),
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("requires a file and a type before submitting", async () => {
    mockBase([]);
    renderPanel();
    await screen.findByText("No documents yet.");

    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Choose a file to upload.")).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalledWith("/documents", expect.anything());
  });

  it("uploads successfully and prepends the new document to the list", async () => {
    mockedApiFetch.mockImplementation(async (path, options) => {
      const p = String(path);
      if (p === "/employees/me") return PROFILE;
      if (p === "/documents/me") return [];
      if (p === "/documents" && options?.method === "POST") {
        return { id: "d-new", employeeId: "e1", type: "id", expiryDate: null, uploadedAt: "2026-03-01T00:00:00.000Z" };
      }
      throw new Error(`unexpected ${p}`);
    });
    renderPanel();
    await screen.findByText("No documents yet.");

    await userEvent.selectOptions(screen.getByLabelText("Document type"), "id");
    const file = new File(["hello"], "id.pdf", { type: "application/pdf" });
    const fileInput = screen.getByLabelText("Choose file") as HTMLInputElement;
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Document uploaded.")).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getByText("ID")).toBeInTheDocument();
  });

  it("shows the REAL server rejection message when the backend rejects an invalid file", async () => {
    mockedApiFetch.mockImplementation(async (path, options) => {
      const p = String(path);
      if (p === "/employees/me") return PROFILE;
      if (p === "/documents/me") return [];
      if (p === "/documents" && options?.method === "POST") {
        const { ValidationError } = await import("@/lib/api-client");
        throw new ValidationError('File type "application/x-msdownload" is not allowed', 400, null);
      }
      throw new Error(`unexpected ${p}`);
    });
    renderPanel();
    await screen.findByText("No documents yet.");

    await userEvent.selectOptions(screen.getByLabelText("Document type"), "id");
    const file = new File(["MZ"], "malware.pdf", { type: "application/pdf" });
    const fileInput = screen.getByLabelText("Choose file") as HTMLInputElement;
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(
      await screen.findByText('File type "application/x-msdownload" is not allowed'),
    ).toBeInTheDocument();
  });
});
