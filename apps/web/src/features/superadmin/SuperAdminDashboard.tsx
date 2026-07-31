"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import { ApiError, ConflictError, ForbiddenError } from "@/lib/api-client";
import { formatDate } from "@/lib/locale";
import {
  createCompany,
  fetchCompanies,
  setCompanyStatus,
  type CompanyListItem,
  type CreateCompanyResult,
} from "./superadmin-api";

type View = "list" | "create";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Deliberately English-only — this surface is used exclusively by the
 * founder (the only superadmin), never by a pilot company's own
 * employees. No useTranslation()/t() anywhere in this file, on purpose —
 * see DECISIONS.md, "Super Admin dashboard: frontend" for why this isn't
 * routed through the ar/ku LocaleProvider pattern the rest of the app
 * uses. Dates are still formatted via the shared formatDate() helper,
 * pinned to the "en" locale explicitly rather than the viewer's cookie.
 */
export function SuperAdminDashboard() {
  const [view, setView] = useState<View>("list");
  const [companies, setCompanies] = useState<CompanyListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreateCompanyResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setCompanies(await fetchCompanies());
    } catch {
      setLoadError("Couldn't load the company list. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggleStatus(company: CompanyListItem) {
    const nextStatus = company.status === "active" ? "suspended" : "active";
    setRowError(null);
    setStatusUpdatingId(company.id);
    try {
      const updated = await setCompanyStatus(company.id, nextStatus);
      // Patch just this row from the real server response, rather than
      // re-running load() (which flips the top-level `loading` flag and
      // replaces the whole list with the skeleton placeholder — every
      // row, including this one, would briefly unmount and remount for
      // one status change). Found live: that unmount/remount broke a
      // real-backend integration test holding a reference to this row
      // across the update — same bug would have hit any real user
      // watching the list flicker on every suspend/reactivate click.
      setCompanies((prev) =>
        prev
          ? prev.map((c) =>
              c.id === updated.id ? { ...c, status: updated.status as CompanyListItem["status"] } : c,
            )
          : prev,
      );
    } catch {
      setRowError(`Couldn't update ${company.name}'s status. Please try again.`);
    } finally {
      setStatusUpdatingId(null);
    }
  }

  if (view === "create") {
    return (
      <CreateCompanyForm
        onCreated={(result) => {
          setJustCreated(result);
          setView("list");
          void load();
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {justCreated ? (
        <TemporaryPasswordBanner result={justCreated} onDismiss={() => setJustCreated(null)} />
      ) : null}

      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold text-neutral-900">Companies</h2>
        <Button onClick={() => setView("create")}>New company</Button>
      </div>

      {rowError ? (
        <p role="alert" className="font-body text-sm text-danger">
          {rowError}
        </p>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-4"
        >
          <p className="font-body text-sm text-neutral-900">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-danger px-3 py-1 font-body text-sm text-danger hover:bg-danger/10"
          >
            Retry
          </button>
        </div>
      ) : companies && companies.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {companies.map((company) => (
            <li
              key={company.id}
              data-company-id={company.id}
              className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-body text-sm font-medium text-neutral-900">
                  {company.name}
                </span>
                <span className="font-body text-xs text-neutral-600">
                  {company.city} · <StatusBadge status={company.status} /> ·{" "}
                  {company.employeeCount} employee{company.employeeCount === 1 ? "" : "s"} ·
                  created {formatDate(new Date(company.createdAt), "en")}
                </span>
              </div>
              {company.status === "archived" ? null : (
                <Button
                  variant="secondary"
                  loading={statusUpdatingId === company.id}
                  onClick={() => void handleToggleStatus(company)}
                >
                  {company.status === "active" ? "Suspend" : "Reactivate"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-sm text-neutral-600">No companies yet.</p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CompanyListItem["status"] }) {
  const color =
    status === "active" ? "text-success" : status === "suspended" ? "text-danger" : "text-neutral-500";
  return <span className={color}>{status}</span>;
}

function TemporaryPasswordBanner({
  result,
  onDismiss,
}: {
  result: CreateCompanyResult;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-4">
      <p className="font-heading text-base font-semibold text-neutral-900">
        {result.company.name} created
      </p>
      <p className="font-body text-sm text-neutral-900">
        Admin: {result.admin.email}
        <br />
        Temporary password:{" "}
        <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-sm">
          {result.temporaryPassword}
        </code>
      </p>
      <p className="font-body text-xs text-neutral-600">
        This password is shown once, here, and was also emailed to the admin. It cannot be
        retrieved again after you leave this page — save it now if you need a record of it.
      </p>
      <Button variant="secondary" onClick={onDismiss} className="self-start">
        Done
      </Button>
    </div>
  );
}

function CreateCompanyForm({
  onCreated,
  onCancel,
}: {
  onCreated: (result: CreateCompanyResult) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [timezone, setTimezone] = useState("");
  const [localeDefault, setLocaleDefault] = useState<"" | "en" | "ar" | "ku">("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Required";
    if (!city.trim()) errors.city = "Required";
    if (!adminName.trim()) errors.adminName = "Required";
    if (!adminEmail.trim()) errors.adminEmail = "Required";
    else if (!EMAIL_PATTERN.test(adminEmail)) errors.adminEmail = "Enter a valid email";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setFormError(null);
    setSubmitting(true);
    try {
      const result = await createCompany({
        name: name.trim(),
        city: city.trim(),
        timezone: timezone.trim() || undefined,
        localeDefault: localeDefault || undefined,
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
      });
      onCreated(result);
    } catch (error) {
      if (error instanceof ConflictError) {
        setFormError(`A company named "${name.trim()}" already exists.`);
      } else if (error instanceof ForbiddenError) {
        setFormError("You don't have permission to do this.");
      } else if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4" noValidate>
      <h2 className="font-heading text-lg font-semibold text-neutral-900">New company</h2>

      <TextField
        label="Company name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fieldErrors.name}
      />
      <TextField
        label="City"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        error={fieldErrors.city}
      />
      <TextField
        label="Timezone (optional)"
        placeholder="Asia/Baghdad"
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
      />
      <Select
        label="Default locale (optional)"
        value={localeDefault}
        onChange={(e) => setLocaleDefault(e.target.value as typeof localeDefault)}
      >
        <option value="">Use default (English)</option>
        <option value="en">English</option>
        <option value="ar">Arabic</option>
        <option value="ku">Kurdish (Sorani)</option>
      </Select>

      <TextField
        label="Admin's name"
        value={adminName}
        onChange={(e) => setAdminName(e.target.value)}
        error={fieldErrors.adminName}
      />
      <TextField
        label="Admin's email"
        type="email"
        value={adminEmail}
        onChange={(e) => setAdminEmail(e.target.value)}
        error={fieldErrors.adminEmail}
      />

      {formError ? (
        <p role="alert" className="font-body text-sm text-danger">
          {formError}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" loading={submitting}>
          Create company
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
