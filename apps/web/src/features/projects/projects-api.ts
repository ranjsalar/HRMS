import { apiFetch } from "@/lib/api-client";

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled";

export interface ProjectDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberDto {
  id: string;
  employeeId: string;
  employee: { id: string; fullName: string; departmentId: string | null };
}

export interface ProjectDetailDto extends ProjectDto {
  members: ProjectMemberDto[];
}

/**
 * Deliberately no query params or client-side filtering — same reasoning
 * as team-api.ts's fetchTeam: GET /projects already resolves the
 * caller's scope server-side (all/own_department/self), so rendering
 * exactly what comes back is the point.
 */
export function fetchProjects(): Promise<ProjectDto[]> {
  return apiFetch<ProjectDto[]>("/projects");
}

export function fetchProject(id: string): Promise<ProjectDetailDto> {
  return apiFetch<ProjectDetailDto>(`/projects/${id}`);
}
