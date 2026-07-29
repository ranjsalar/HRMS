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
