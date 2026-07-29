// Real-backend integration test — apiFetch is NOT mocked. Requires the API
// dev server running with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied (that
// fixture now grants the employee role documents:create at self scope —
// see DECISIONS.md, step 9.4).
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { DocumentsPanel } from "./DocumentsPanel";

const EMPLOYEE_EMAIL = "frontend-e2e-employee@hrms.test";
const EMPLOYEE_PASSWORD = "Frontend-E2E-Employee-Pass-1";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}

// Real magic bytes for a minimal PDF — same convention as the backend's
// own employee-management.e2e-spec.ts.
const PDF_BYTES = new Uint8Array(
  Buffer.from("%PDF-1.4\n%test-document\n1 0 obj\n<< >>\nendobj\n"),
);
// Real Windows PE/MZ executable header — attached with a ".pdf" filename
// and an honest application/pdf File `type`, to prove the backend is
// consulting the BYTES, not the filename or claimed content-type.
const EXE_BYTES = new Uint8Array([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00,
  0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function renderPanel() {
  return render(
    <LocaleProvider initialLocale="en">
      <DocumentsPanel />
    </LocaleProvider>,
  );
}

beforeAll(async () => {
  const res = await apiFetch<LoginOkResponse>("/auth/login", {
    method: "POST",
    body: { email: EMPLOYEE_EMAIL, password: EMPLOYEE_PASSWORD },
  });
  setAccessToken(res.accessToken);
}, 15000);

afterAll(() => {
  setAccessToken(null);
});

describe("DocumentsPanel — real backend integration", () => {
  it("uploads a real PDF, lists it, and views it via a real signed URL", async () => {
    const { container } = renderPanel();
    await screen.findByText("Upload a document", {}, { timeout: 10000 });

    await userEvent.selectOptions(screen.getByLabelText("Document type"), "certificate");
    const file = new File([PDF_BYTES], "cert.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Choose file"), file);
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Document uploaded.", {}, { timeout: 10000 })).toBeInTheDocument();

    // Find the new row by its real id (not by rendered type text, which
    // repeats across every past "certificate" upload this fixture
    // employee has accumulated — same lesson as the leave/payslips
    // integration tests, applied proactively here — see DECISIONS.md).
    const mine = await apiFetch<{ id: string; type: string; uploadedAt: string }[]>("/documents/me");
    const myDocId = mine[0].id; // newest first
    let row: HTMLElement | null = null;
    await waitFor(
      () => {
        row = container.querySelector(`[data-document-id="${myDocId}"]`);
        expect(row).not.toBeNull();
      },
      { timeout: 10000 },
    );

    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    await userEvent.click(within(row!).getByRole("button", { name: "View" }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1), { timeout: 10000 });

    const openedUrl = openSpy.mock.calls[0][0] as string;
    expect(openedUrl).toContain("/documents/download?token=");

    const downloadRes = await fetch(openedUrl);
    expect(downloadRes.status).toBe(200);
    const bytes = new Uint8Array(await downloadRes.arrayBuffer());
    expect(Buffer.from(bytes).equals(Buffer.from(PDF_BYTES))).toBe(true);
  }, 30000);

  it("a real invalid file (renamed executable) is rejected with the real server message, not silently accepted", async () => {
    renderPanel();
    await screen.findByText("Upload a document", {}, { timeout: 10000 });

    await userEvent.selectOptions(screen.getByLabelText("Document type"), "certificate");
    const badFile = new File([EXE_BYTES], "totally-a-cert.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Choose file"), badFile);
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(
      await screen.findByText(/not allowed|Could not determine/, {}, { timeout: 10000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Document uploaded.")).not.toBeInTheDocument();
  }, 15000);
});
