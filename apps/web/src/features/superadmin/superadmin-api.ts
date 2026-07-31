import { apiFetch } from "@/lib/api-client";

export interface CompanyListItem {
  id: string;
  name: string;
  city: string;
  status: "active" | "suspended" | "archived";
  employeeCount: number;
  createdAt: string;
}

export interface CreateCompanyInput {
  name: string;
  city: string;
  timezone?: string;
  localeDefault?: "en" | "ar" | "ku";
  adminName: string;
  adminEmail: string;
}

export interface CreateCompanyResult {
  company: { id: string; name: string; city: string; status: string; createdAt: string };
  admin: { id: string; email: string };
  // Present exactly once, in this one response — never fetchable again
  // afterward. See DECISIONS.md.
  temporaryPassword: string;
}

export function fetchCompanies(): Promise<CompanyListItem[]> {
  return apiFetch<CompanyListItem[]>("/superadmin/companies");
}

export function createCompany(input: CreateCompanyInput): Promise<CreateCompanyResult> {
  return apiFetch<CreateCompanyResult>("/superadmin/companies", { method: "POST", body: input });
}

export function setCompanyStatus(
  id: string,
  status: "active" | "suspended",
): Promise<{ id: string; status: string }> {
  return apiFetch<{ id: string; status: string }>(`/superadmin/companies/${id}/status`, {
    method: "PATCH",
    body: { status },
  });
}
