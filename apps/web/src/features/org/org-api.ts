import { apiFetch } from "@/lib/api-client";

export interface DepartmentDto {
  id: string;
  name: string;
}

export interface BranchDto {
  id: string;
  name: string;
}

/** Used by AddEmployeeForm's department picker — org:view scope "all" for both manager and company_admin (see fetchOrgChart's own comment), so this always returns the whole company's department list regardless of caller role. A manager's own_department creation restriction is still enforced server-side on the actual POST /employees call, not by narrowing this list. */
export function fetchDepartments(): Promise<DepartmentDto[]> {
  return apiFetch<DepartmentDto[]>("/departments");
}

/** Same reasoning as fetchDepartments — org:view, scope "all". */
export function fetchBranches(): Promise<BranchDto[]> {
  return apiFetch<BranchDto[]>("/branches");
}

export interface OrgChartNode {
  id: string;
  name: string;
  managerEmployeeId: string | null;
  managerName: string | null;
  employeeCount: number;
  children: OrgChartNode[];
}

/**
 * `org:view` is deliberately company-WIDE scope for both manager and
 * company_admin (see default-role-permissions.ts's own comment: "seeing
 * the org chart is a different thing from acting on employees within
 * it"), not `own_department` — so this deliberately renders the entire
 * tree the backend returns, not a client-narrowed one. A plain employee
 * has no `org:view` grant at all and can't reach this endpoint (403);
 * `AppNav` already reflects that by omitting the link for that role, but
 * the real boundary is server-side, same as everywhere else in this app.
 * See DECISIONS.md.
 */
export function fetchOrgChart(): Promise<OrgChartNode[]> {
  return apiFetch<OrgChartNode[]>("/departments/org-chart");
}
