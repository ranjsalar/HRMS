import { apiFetch } from "@/lib/api-client";

export interface EmployeeProfileDto {
  id: string;
  fullName: string;
  jobTitle: string;
  hireDate: string;
  status: string;
  phone: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

export interface UpdateOwnProfileInput {
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

export function fetchMyProfile(): Promise<EmployeeProfileDto> {
  return apiFetch<EmployeeProfileDto>("/employees/me");
}

/**
 * The backend route this calls (`PATCH /employees/me`) is structurally
 * incapable of accepting salaryBase/nationalId/bankAccount/departmentId/
 * branchId/fullName/jobTitle/hireDate/currency — its DTO
 * (`UpdateOwnEmployeeDto`) simply has no such properties, and the global
 * whitelist pipe strips/rejects anything else. `UpdateOwnProfileInput`
 * mirrors that on purpose — this file has no way to even construct a
 * request that could smuggle a restricted field through. See DECISIONS.md.
 */
export function updateMyProfile(input: UpdateOwnProfileInput): Promise<EmployeeProfileDto> {
  return apiFetch<EmployeeProfileDto>("/employees/me", { method: "PATCH", body: input });
}
