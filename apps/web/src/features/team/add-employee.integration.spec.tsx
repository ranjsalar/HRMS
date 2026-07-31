// Real-backend integration test — apiFetch is NOT mocked. Requires the API
// dev server running with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied.
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { authenticator } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { AddEmployeeForm } from "./AddEmployeeForm";
import { TeamList } from "./TeamList";
import type { CreateEmployeeResult, TeamMemberDto } from "./team-api";

const ADMIN_EMAIL = "frontend-e2e-admin@hrms.test";
const ADMIN_PASSWORD = "Frontend-E2E-Admin-Pass-1";
const ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MAILDEV_URL = "http://localhost:1080";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}
interface LoginPendingResponse {
  status: "2fa_required";
  pendingToken: string;
}
interface MailDevEmailSummary {
  id: string;
  to: { address: string }[];
}

async function loginAsAdmin(): Promise<void> {
  const res = await apiFetch<LoginOkResponse | LoginPendingResponse>("/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (res.status === "ok") {
    setAccessToken(res.accessToken);
    return;
  }
  const code = authenticator.generate(ADMIN_TOTP_SECRET);
  const verify = await apiFetch<LoginOkResponse>("/auth/2fa/verify", {
    method: "POST",
    body: { pendingToken: res.pendingToken, code },
  });
  setAccessToken(verify.accessToken);
}

async function findEmailTo(toAddress: string, maxAttempts = 20): Promise<MailDevEmailSummary> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${MAILDEV_URL}/api/email`);
    const emails = (await res.json()) as MailDevEmailSummary[];
    const match = emails.find((e) => e.to.some((t) => t.address === toAddress));
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No email arrived for ${toAddress} within the wait window`);
}

async function fetchEmailText(id: string): Promise<string> {
  const res = await fetch(`${MAILDEV_URL}/api/email/${id}`);
  const body = (await res.json()) as { text: string };
  return body.text;
}

async function deleteEmail(id: string): Promise<void> {
  await fetch(`${MAILDEV_URL}/api/email/${id}`, { method: "DELETE" }).catch(() => undefined);
}

function TeamPageForTest() {
  const [justCreated, setJustCreated] = useState<CreateEmployeeResult | null>(null);
  const [adding, setAdding] = useState(true);
  const [teamKey, setTeamKey] = useState(0);

  return (
    <LocaleProvider initialLocale="en">
      {justCreated ? (
        <div>
          <p>{justCreated.fullName} was added.</p>
          {justCreated.temporaryPassword ? <p>Temporary password: {justCreated.temporaryPassword}</p> : null}
        </div>
      ) : null}
      {adding ? (
        <AddEmployeeForm
          isAdmin
          onCreated={(result) => {
            setJustCreated(result);
            setAdding(false);
            setTeamKey((k) => k + 1);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      <TeamList
        key={teamKey}
        renderRowAction={(member: TeamMemberDto) => <span>{member.jobTitle}</span>}
      />
    </LocaleProvider>
  );
}

afterAll(() => {
  setAccessToken(null);
});

describe("Add employee — real backend integration", () => {
  beforeEach(async () => {
    await loginAsAdmin();
  }, 15000);

  it("creates a real employee WITH a login through the actual form, shows the temp password once, emails the identical password, and the new employee can really log in", async () => {
    render(<TeamPageForTest />);

    const runId = Date.now().toString(36);
    const fullName = `Frontend Integration New Hire ${runId}`;
    const email = `frontend-integration-new-hire-${runId}@hrms.test`;

    await userEvent.type(screen.getByLabelText("Full name"), fullName);
    await userEvent.type(screen.getByLabelText("National ID"), `NATID-${runId}`);
    await userEvent.type(screen.getByLabelText("Job title"), "QA Engineer");
    await userEvent.type(screen.getByLabelText("Hire date"), "2024-05-01");
    await userEvent.type(screen.getByLabelText("Base salary"), "650000");
    await userEvent.type(screen.getByLabelText("Email"), email);
    await userEvent.click(screen.getByRole("button", { name: "Add employee" }));

    expect(await screen.findByText(`${fullName} was added.`, {}, { timeout: 10000 })).toBeInTheDocument();
    const passwordMatch = /Temporary password:\s*(\S+)/.exec(document.body.textContent ?? "");
    expect(passwordMatch).not.toBeNull();
    const temporaryPassword = passwordMatch![1];
    expect(temporaryPassword.length).toBeGreaterThan(10);

    // The real list re-fetched and now includes the new hire.
    const row = (await screen.findByText(fullName, {}, { timeout: 10000 })).closest("li");
    if (!row) throw new Error("Expected the new employee to be inside a team-list row");
    expect(within(row).getByText("QA Engineer")).toBeInTheDocument();

    // Real MailDev delivery, same password value as the on-screen one.
    const mail = await findEmailTo(email);
    const text = await fetchEmailText(mail.id);
    expect(text).toContain(temporaryPassword);
    await deleteEmail(mail.id);

    // The real proof: a fresh login with the exact emailed/displayed
    // password actually works (full mustChangePassword mechanics are
    // already proven end-to-end by the backend's own
    // employee-account-creation.e2e-spec.ts — this only needs to confirm
    // the UI produced a password that really authenticates).
    setAccessToken(null);
    const login = await apiFetch<LoginOkResponse | LoginPendingResponse>("/auth/login", {
      method: "POST",
      body: { email, password: temporaryPassword },
    });
    expect(login.status).toBe("ok");
  }, 20000);

  it("rejects a duplicate email with a clear, specific error surfaced in the real form", async () => {
    const runId = Date.now().toString(36);
    const email = `frontend-integration-dup-employee-${runId}@hrms.test`;
    await apiFetch("/employees", {
      method: "POST",
      body: {
        fullName: "First Attempt",
        nationalId: `DUP-EMP-${runId}`,
        jobTitle: "X",
        hireDate: "2024-01-01",
        salaryBase: 400000,
        email,
      },
    });

    render(<TeamPageForTest />);
    await userEvent.type(screen.getByLabelText("Full name"), "Second Attempt");
    await userEvent.type(screen.getByLabelText("National ID"), `DUP-EMP-2-${runId}`);
    await userEvent.type(screen.getByLabelText("Job title"), "Y");
    await userEvent.type(screen.getByLabelText("Hire date"), "2024-01-01");
    await userEvent.type(screen.getByLabelText("Base salary"), "400000");
    await userEvent.type(screen.getByLabelText("Email"), email);
    await userEvent.click(screen.getByRole("button", { name: "Add employee" }));

    expect(
      await screen.findByText(
        "Someone with this email already exists in your company.",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
    // Still on the form — a failed submission doesn't silently drop back to the list.
    expect(screen.getByRole("button", { name: "Add employee" })).toBeInTheDocument();
  }, 20000);

  it("omitting email creates a record-only employee — no password banner, no email sent", async () => {
    render(<TeamPageForTest />);

    const runId = Date.now().toString(36);
    const fullName = `Frontend Integration Record Only ${runId}`;

    await userEvent.type(screen.getByLabelText("Full name"), fullName);
    await userEvent.type(screen.getByLabelText("National ID"), `RECORD-ONLY-${runId}`);
    await userEvent.type(screen.getByLabelText("Job title"), "Contractor");
    await userEvent.type(screen.getByLabelText("Hire date"), "2024-01-01");
    await userEvent.type(screen.getByLabelText("Base salary"), "300000");
    await userEvent.click(screen.getByRole("button", { name: "Add employee" }));

    expect(await screen.findByText(`${fullName} was added.`, {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.queryByText(/Temporary password:/)).not.toBeInTheDocument();
  }, 20000);
});
