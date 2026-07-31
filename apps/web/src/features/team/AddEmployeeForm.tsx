"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { fetchBranches, fetchDepartments, type BranchDto, type DepartmentDto } from "@/features/org/org-api";
import { ApiError, ConflictError } from "@/lib/api-client";
import { useTranslation } from "@/lib/locale-context";
import { createEmployee, type CreateEmployeeResult } from "./team-api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A department/branch/role/locale picker is offered here, but the real
 * boundaries are enforced server-side regardless of what this form shows
 * or hides: a manager submitting a department outside their own is a real
 * 403 from EmployeesService.create(), not something this form prevents —
 * matches this build's standing "the frontend hiding a control is a UX
 * nicety, not a security boundary" principle. The role selector IS hidden
 * for a non-admin (managers can never grant "manager" — see
 * EmployeesService.create()), since there's no legitimate reason to show
 * a choice that would always be rejected.
 *
 * `isAdmin` is a prop, not an internal useAuth() read — the caller
 * (team/page.tsx) already has a session via AuthProvider and can derive
 * this once; keeping it a plain prop makes this a pure presentational
 * form with no context dependency of its own.
 */
export function AddEmployeeForm({
  isAdmin,
  onCreated,
  onCancel,
}: {
  isAdmin: boolean;
  onCreated: (result: CreateEmployeeResult) => void;
  onCancel: () => void;
}) {
  const { t, dir } = useTranslation();

  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [branches, setBranches] = useState<BranchDto[]>([]);

  useEffect(() => {
    void fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
    void fetchBranches().then(setBranches).catch(() => setBranches([]));
  }, []);

  const [fullName, setFullName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [salaryBase, setSalaryBase] = useState("");
  const [currency, setCurrency] = useState<"IQD" | "USD">("IQD");
  const [bankAccount, setBankAccount] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"employee" | "manager">("employee");
  const [locale, setLocale] = useState<"" | "en" | "ar" | "ku">("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const errors: Record<string, string> = {};
      if (!fullName.trim()) errors.fullName = t("common.validation.required");
      if (!nationalId.trim()) errors.nationalId = t("common.validation.required");
      if (!jobTitle.trim()) errors.jobTitle = t("common.validation.required");
      if (!hireDate) errors.hireDate = t("common.validation.required");
      if (!salaryBase || Number(salaryBase) <= 0) errors.salaryBase = t("common.validation.required");
      const trimmedEmail = email.trim();
      if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
        errors.email = t("common.validation.emailInvalid");
      }
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;

      setFormError(null);
      setSubmitting(true);
      try {
        const result = await createEmployee({
          fullName: fullName.trim(),
          nationalId: nationalId.trim(),
          jobTitle: jobTitle.trim(),
          departmentId: departmentId || undefined,
          branchId: branchId || undefined,
          hireDate,
          salaryBase: Number(salaryBase),
          currency,
          bankAccount: bankAccount.trim() || undefined,
          email: trimmedEmail || undefined,
          role: trimmedEmail ? role : undefined,
          locale: trimmedEmail && locale ? locale : undefined,
        });
        onCreated(result);
      } catch (error) {
        if (error instanceof ConflictError) {
          setFormError(t("team.addEmployee.emailTaken"));
        } else if (error instanceof ApiError) {
          setFormError(error.message);
        } else {
          setFormError(t("common.errors.generic.message"));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [
      fullName,
      nationalId,
      jobTitle,
      departmentId,
      branchId,
      hireDate,
      salaryBase,
      currency,
      bankAccount,
      email,
      role,
      locale,
      onCreated,
      t,
    ],
  );

  return (
    <form
      dir={dir}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-neutral-100 p-3"
      noValidate
    >
      <h3 className="font-body text-sm font-semibold text-neutral-900">{t("team.addEmployee.title")}</h3>

      <TextField
        label={t("team.addEmployee.fullName")}
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        error={fieldErrors.fullName}
      />
      <TextField
        label={t("team.addEmployee.nationalId")}
        value={nationalId}
        onChange={(e) => setNationalId(e.target.value)}
        error={fieldErrors.nationalId}
      />
      <TextField
        label={t("team.jobTitle")}
        value={jobTitle}
        onChange={(e) => setJobTitle(e.target.value)}
        error={fieldErrors.jobTitle}
      />

      <Select
        label={t("team.addEmployee.department")}
        value={departmentId}
        onChange={(e) => setDepartmentId(e.target.value)}
      >
        <option value="">{t("team.addEmployee.departmentPlaceholder")}</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>

      <Select label={t("team.addEmployee.branch")} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
        <option value="">{t("team.addEmployee.branchPlaceholder")}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>

      <TextField
        type="date"
        label={t("team.hireDate")}
        value={hireDate}
        onChange={(e) => setHireDate(e.target.value)}
        error={fieldErrors.hireDate}
      />

      <TextField
        type="number"
        label={t("team.addEmployee.salaryBase")}
        value={salaryBase}
        onChange={(e) => setSalaryBase(e.target.value)}
        error={fieldErrors.salaryBase}
      />
      <Select
        label={t("team.addEmployee.currency")}
        value={currency}
        onChange={(e) => setCurrency(e.target.value as "IQD" | "USD")}
      >
        <option value="IQD">IQD</option>
        <option value="USD">USD</option>
      </Select>

      <TextField
        label={t("team.addEmployee.bankAccount")}
        value={bankAccount}
        onChange={(e) => setBankAccount(e.target.value)}
      />

      <div className="flex flex-col gap-2 rounded-md border border-neutral-300 bg-white p-3">
        <p className="font-body text-xs font-medium text-neutral-900">
          {t("team.addEmployee.loginSectionTitle")}
        </p>
        <TextField
          type="email"
          label={t("team.addEmployee.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        {isAdmin ? (
          <Select
            label={t("team.addEmployee.role")}
            value={role}
            onChange={(e) => setRole(e.target.value as "employee" | "manager")}
          >
            <option value="employee">{t("team.addEmployee.roleEmployee")}</option>
            <option value="manager">{t("team.addEmployee.roleManager")}</option>
          </Select>
        ) : null}
        <Select
          label={t("team.addEmployee.locale")}
          value={locale}
          onChange={(e) => setLocale(e.target.value as typeof locale)}
        >
          <option value="">{t("team.addEmployee.localeDefault")}</option>
          <option value="en">English</option>
          <option value="ar">العربية</option>
          <option value="ku">کوردی</option>
        </Select>
        <p className="font-body text-xs text-neutral-600">{t("team.addEmployee.loginHint")}</p>
      </div>

      {formError ? (
        <p role="alert" className="font-body text-xs text-danger">
          {formError}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={submitting}>
          {submitting ? t("team.addEmployee.submitting") : t("team.addEmployee.submit")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          {t("team.addEmployee.cancel")}
        </Button>
      </div>
    </form>
  );
}
