import { apiFetch } from "@/lib/api-client";

export interface TeamMemberDto {
  id: string;
  userId: string | null;
  fullName: string;
  jobTitle: string;
  departmentId: string | null;
  branchId: string | null;
  hireDate: string;
  status: "active" | "on_leave" | "terminated";
}

/**
 * Deliberately no query params, no client-side filtering of the result —
 * `GET /employees` already resolves the caller's scope server-side
 * (own_department for a manager, all for company_admin, self for a plain
 * employee) via RbacGuard + EmployeesService.scopeWhere. Rendering
 * exactly what comes back, unfiltered, is the point: if the server ever
 * returned someone outside the caller's department, that should be
 * visibly wrong here, not silently corrected by this file. See
 * DECISIONS.md.
 */
export function fetchTeam(): Promise<TeamMemberDto[]> {
  return apiFetch<TeamMemberDto[]>("/employees");
}

export interface CreateEmployeeInput {
  fullName: string;
  nationalId: string;
  jobTitle: string;
  departmentId?: string;
  branchId?: string;
  hireDate: string;
  salaryBase: number;
  currency?: "IQD" | "USD";
  bankAccount?: string;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  // Present together or not at all — providing `email` is what triggers
  // real login provisioning server-side (see EmployeesService.create()).
  // Omitting it creates a record-only Employee with no account, the same
  // behavior this endpoint always had.
  email?: string;
  role?: "employee" | "manager";
  locale?: "en" | "ar" | "ku";
}

export interface CreateEmployeeResult extends TeamMemberDto {
  nationalId: string;
  bankAccount: string | null;
  // Present only when `email` was provided — shown exactly once, matching
  // the Super Admin dashboard's identical one-time-display convention.
  temporaryPassword?: string;
}

export function createEmployee(input: CreateEmployeeInput): Promise<CreateEmployeeResult> {
  return apiFetch<CreateEmployeeResult>("/employees", { method: "POST", body: input });
}
